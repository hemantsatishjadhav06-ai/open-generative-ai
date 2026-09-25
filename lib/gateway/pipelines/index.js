// Server-side multi-step jobs ("pipelines"), e.g. ai-clipping, agent chat
// turns, design-agent runs, workflow runs.
//
// A pipeline lives in lib/gateway/pipelines/<name>.js and either calls
// register(name, run, options) at import time or default-exports
// `run(ctx)` / `{ run, ...options }`. It is loaded on first use, so
// POST /api/v1/<name> reaches it without any central list.
//
// run(ctx) receives:
//   ctx.input     parsed JSON body (after options.validate, if given)
//   ctx.sid, ctx.cid, ctx.jobId
//   ctx.emit(type, payload) | ctx.emit({type, payload})  → cursor event log
//   ctx.progress(pct, message)
//   ctx.falCall(catalogKey | {key} | {endpoint}, input, {sync, estUsd}) → normalized result envelope
//                 a string is always a catalog key (schema allowlist + pricing);
//                 a raw fal endpoint must be passed as {endpoint} and only for
//                 server-owned constants, never for user-supplied values
//   ctx.llm({purpose, messages, tools, response_format, ...}) → {content, tool_calls, usage}
//   ctx.store     workspace-scoped JSON store
//   ctx.signal    AbortSignal (cancel / timeout)
// and returns the job result (merged into {status:'completed', ...}).
//
// options: { kind: 'pipeline'|'agent', validate(input), estimateUsd(input),
//            format(job, token) → {status, body}, timeoutMs,
//            internal: true → only startable by the gateway (startPipelineJob
//            with internal:true), never via POST /api/v1/<name> }

import { GatewayError, toGatewayError, errors } from '../errors.js';
import { runFal } from '../generation.js';
import { appendEvent, cancelJob, createJob, finishJob, loadJob, readEvents, signJobToken } from '../jobs.js';
import { acquireJobSlot, assertBudget, assertJobSlot, releaseJobSlot } from '../limits.js';
import { meteredChat } from '../llmBudget.js';
import { shared } from '../state.js';
import * as store from '../store.js';
import { logGateway } from '../log.js';

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Pipelines whose module file isn't named after the pipeline. A static import
// isn't possible here: clipping.js imports this module back.
const FILES = { 'ai-clipping': 'clipping', 'catalog-steps': 'catalogSteps' };
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

const registry = () => shared('pipelines', () => new Map());
const missing = () => shared('pipelinesMissing', () => new Set());

export function register(name, run, options = {}) {
    if (!NAME.test(name) || name === 'index') throw new Error(`invalid pipeline name: ${name}`);
    const def = typeof run === 'function' ? { ...options, run } : { ...(run || {}), ...options };
    if (typeof def.run !== 'function') throw new Error(`pipeline ${name} needs a run(ctx) function`);
    def.name = name;
    def.kind = def.kind === 'agent' ? 'agent' : 'pipeline';
    registry().set(name, def);
    missing().delete(name);
    return def;
}

export function unregister(name) {
    registry().delete(name);
}

export function getPipeline(name) {
    return registry().get(name) || null;
}

export function listPipelines() {
    return [...registry().keys()];
}

// Loads lib/gateway/pipelines/<name>.js on first use (bundled by webpack as
// a context module; negative results are cached).
export async function loadPipeline(name) {
    if (typeof name !== 'string' || !NAME.test(name) || name === 'index') return null;
    // A module file is only reachable under its pipeline name.
    if (Object.values(FILES).includes(name) && !Object.hasOwn(FILES, name)) return null;
    const known = getPipeline(name);
    if (known) return known;
    if (missing().has(name)) return null;
    try {
        const mod = await import(`./${Object.hasOwn(FILES, name) ? FILES[name] : name}.js`);
        const again = getPipeline(name);
        if (again) return again;
        if (mod?.default) return register(name, mod.default);
    } catch (error) {
        const notFound = error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(error?.message));
        if (!notFound) {
            logGateway({ event: 'pipeline_load_failed', route: name, code: error?.name || 'load_error' }, 'error');
            throw new GatewayError(500, 'internal_error', 'This feature is temporarily unavailable.');
        }
    }
    missing().add(name);
    return null;
}

// A string is a catalog key; only {endpoint} names a raw fal endpoint.
export function falTarget(target) {
    if (typeof target === 'string') return { key: target };
    if (target && typeof target === 'object') {
        if (typeof target.key === 'string') return { key: target.key };
        if (typeof target.endpoint === 'string') return { endpoint: target.endpoint };
    }
    throw new GatewayError(500, 'internal_error', 'This feature is misconfigured.');
}

function makeContext(job, def, session) {
    const signal = job.controller.signal;
    return {
        input: job.input,
        sid: job.sid,
        cid: job.cid,
        jobId: job.id,
        signal,
        store: store.forWorkspace(job.cid),
        emit(type, payload) {
            if (type && typeof type === 'object') return appendEvent(job, String(type.type || 'info'), type.payload ?? {});
            return appendEvent(job, String(type || 'info'), payload ?? {});
        },
        progress(pct, message) {
            job.progress = { pct: Math.max(0, Math.min(100, Number(pct) || 0)), ...(message ? { message: String(message).slice(0, 200) } : {}) };
            job.updatedAt = Date.now();
        },
        async falCall(target, input, options = {}) {
            if (signal.aborted) throw signal.reason || errors.notFound();
            return runFal({
                ...falTarget(target),
                input,
                session,
                signal,
                sync: Boolean(options.sync),
                estUsd: options.estUsd,
                timeoutMs: options.timeoutMs,
                asStep: def.internal === true && options.asStep === true,
            });
        },
        async llm(options = {}) {
            if (signal.aborted) throw signal.reason || errors.notFound();
            // Worst case reserved up front, settled to usage.cost; a cancel
            // stops waiting but the call still settles to its real cost.
            return meteredChat({ ...options, cid: job.cid, signal, trusted: true });
        },
    };
}

function tokenFor(def, job) {
    return signJobToken({ k: def.kind, e: def.name, r: job.id, sid: job.sid, w: job.cid });
}

// Starts a pipeline job for the session → {token, job, body}. Used by the
// /api/v1 submit router and by other routes (agents, workflows, design agent).
export async function startPipelineJob({ name, input = {}, session, internal = false }) {
    const def = await loadPipeline(name);
    // Internal pipelines (options.internal) are started by the gateway itself,
    // never by name from the browser.
    if (!def || (def.internal && !internal)) throw new GatewayError(404, 'unknown_model', "This feature isn't available.");
    let value = input;
    if (typeof def.validate === 'function') {
        try {
            value = (await def.validate(input, { session: { sid: session.sid, cid: session.cid } })) ?? input;
        } catch (error) {
            throw toGatewayError(error.status ? error : Object.assign(error, { status: 400 }));
        }
    }
    const estimate = typeof def.estimateUsd === 'function' ? Number(await def.estimateUsd(value)) || 0 : 0;
    await assertBudget(session.cid, estimate);
    assertJobSlot(session.sid);
    const job = createJob({ name, kind: def.kind, sid: session.sid, cid: session.cid, input: value });
    acquireJobSlot(session.sid, job.id);
    const ctx = makeContext(job, def, { sid: session.sid, cid: session.cid });
    const timeoutMs = Number(def.timeoutMs) > 0 ? Number(def.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => job.controller.abort(new GatewayError(504, 'timeout', 'This job took too long and was stopped.')), timeoutMs);
    timer.unref?.();
    const t0 = Date.now();
    Promise.resolve()
        .then(() => def.run(ctx))
        .then((result) => {
            if (job.controller.signal.aborted) throw job.controller.signal.reason;
            finishJob(job, { status: 'completed', result: result ?? {} });
            logGateway({ event: 'pipeline_done', route: name, kind: def.kind, status: 200, ms: Date.now() - t0 });
        })
        .catch((error) => {
            const err = toGatewayError(error);
            const cancelled = err.code === 'cancelled';
            if (job.status === 'processing') {
                appendEvent(job, 'error', { message: err.message });
                finishJob(job, { status: cancelled ? 'cancelled' : 'failed', error: err.message });
            }
            logGateway({ event: 'pipeline_failed', route: name, kind: def.kind, status: err.status, ms: Date.now() - t0, code: err.code }, err.status >= 500 && !cancelled ? 'error' : 'warn');
        })
        .finally(() => {
            clearTimeout(timer);
            releaseJobSlot(job.sid, job.id);
        });
    const token = tokenFor(def, job);
    return { token, job, body: defaultBody(def.kind, job, token) };
}

function defaultBody(kind, job, token) {
    const base = { request_id: token, id: token };
    if (job.status === 'processing') {
        return { ...base, status: 'processing', ...(job.progress ? { progress: job.progress } : {}), ...(kind === 'agent' ? { is_complete: false } : {}) };
    }
    if (job.status === 'completed') {
        const result = job.result && typeof job.result === 'object' ? job.result : { value: job.result };
        const body = { ...result, ...base, status: 'completed' };
        if (!Array.isArray(body.outputs)) body.outputs = typeof body.url === 'string' ? [body.url] : [];
        if (!('url' in body)) body.url = body.outputs[0] || null;
        if (kind === 'agent') body.is_complete = true;
        return body;
    }
    return { ...base, status: job.status === 'cancelled' ? 'cancelled' : 'failed', error: job.error || 'This job failed.', ...(kind === 'agent' ? { is_complete: true } : {}) };
}

// → {status (HTTP), body} for GET /api/v1/predictions/<token>/result.
export function formatJob(job, token) {
    const def = getPipeline(job.name);
    if (def && typeof def.format === 'function') {
        const custom = def.format(job, token);
        if (custom && Number.isInteger(custom.status) && custom.body) return custom;
    }
    const kind = def?.kind || job.kind || 'pipeline';
    const body = defaultBody(kind, job, token);
    // Agent chat clients read HTTP 400 {detail:{error}} as a failed turn.
    if (kind === 'agent' && (job.status === 'failed' || job.status === 'cancelled')) {
        return { status: 400, body: { detail: { error: body.error }, status: body.status, is_complete: true } };
    }
    return { status: 200, body };
}

// Poll helper for the result route: resolves a pipeline token for a session.
export async function pollPipelineJob(claims, token, session) {
    const job = await loadJob(claims.r, session.cid);
    if (!job) {
        const body = { request_id: token, id: token, status: 'failed', error: 'This job was interrupted (the server restarted). Please try again.' };
        return claims.k === 'agent' ? { status: 400, body: { detail: { error: body.error }, ...body, is_complete: true } } : { status: 200, body };
    }
    if (job.sid !== session.sid) throw errors.notFound('This generation could not be found.');
    return formatJob(job, token);
}

export async function cancelPipelineJob(claims, session) {
    const job = await loadJob(claims.r, session.cid);
    if (!job || job.sid !== session.sid) throw errors.notFound('This generation could not be found.');
    const cancelled = cancelJob(job);
    return { status: job.status, cancelled };
}

// For routes that expose a job's event log (design agent).
export async function jobEvents({ jobId, session, since }) {
    const job = await loadJob(jobId, session.cid);
    if (!job || job.sid !== session.sid) throw errors.notFound('This job could not be found.');
    return readEvents({ events: job.events || [], seq: job.seq || 0, status: job.status }, since);
}
