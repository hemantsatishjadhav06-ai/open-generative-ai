// Media generation over the catalog: submit (queue or sync), poll, cancel,
// and the internal runFal() that pipelines and agent tools use. The browser
// only ever names a catalog key; the fal endpoint and input come from the
// catalog, and every media URL in the input is checked before fal sees it.

import { getCatalog } from './catalogLoader.js';
import { GatewayError, errors, toGatewayError } from './errors.js';
import { assertEndpointId, falCancel, falResult, falRun, falStatus, falSubmit, falWait, interpretStatus } from './fal.js';
import { decodeJobToken, newJobId, signJobToken } from './jobs.js';
import { acquireJobSlot, assertJobSlot, releaseJobSlot, reserveBudget, settleJob } from './limits.js';
import { completedResult, envelopeForStatus, extractMedia, failedResult, mergeExtracted, processingResult } from './normalize.js';
import { CATEGORY_DEFAULT_USD, estimateUsd } from './pricing.js';
import { assertPublicMediaUrl } from './ssrf.js';
import { shared } from './state.js';
import { isConfigured } from './config.js';
import { logGateway } from './log.js';

// Catalog keys may contain '/' (e.g. mmaudio-v2/text-to-audio); they are only
// ever looked up in the catalog, never used as a fal endpoint.
const KEY = /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SETTLED_TTL_MS = 15 * 60_000;

const settledCache = () => shared('settledResults', () => new Map());

function remember(requestId, body) {
    const map = settledCache();
    const now = Date.now();
    if (map.size > 2000) {
        for (const [id, hit] of map) if (hit.until < now) map.delete(id);
    }
    map.set(requestId, { body, until: now + SETTLED_TTL_MS });
    return body;
}

function recall(requestId) {
    const hit = settledCache().get(requestId);
    if (!hit) return null;
    if (hit.until < Date.now()) {
        settledCache().delete(requestId);
        return null;
    }
    return hit.body;
}

// ── Catalog lookups ─────────────────────────────────────────────────────────
export async function resolveCatalogEntry(key) {
    if (typeof key !== 'string' || !KEY.test(key)) throw new GatewayError(404, 'unknown_model', "This model isn't available.");
    const catalog = await getCatalog();
    const entry = catalog.getEntry(key);
    if (!entry) throw new GatewayError(404, 'unknown_model', "This model isn't available.");
    if (!entry.enabled || !entry.fal) throw new GatewayError(404, 'model_disabled', "This model isn't available on Aquora yet.");
    return { catalog, entry };
}

// → {input, endpoint}. A catalog entry may route to a sibling fal endpoint
// (variant) depending on the payload; `endpoint` is what to submit to.
export function buildInput(catalog, entry, payload) {
    let built;
    try {
        built = catalog.buildFalInput(entry, payload || {});
    } catch (error) {
        if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
            throw new GatewayError(400, typeof error.code === 'string' && /^[a-z_]{3,40}$/.test(error.code) ? error.code : 'invalid_input', String(error.message || 'Some settings are not valid for this model.').slice(0, 300), {
                field: typeof error.field === 'string' ? error.field : undefined,
            });
        }
        throw toGatewayError(error);
    }
    const input = built && typeof built === 'object' && built.input && typeof built.input === 'object' ? built.input : null;
    if (!input) throw new GatewayError(500, 'internal_error', 'This model is misconfigured.');
    const endpoint = typeof built.endpoint === 'string' && built.endpoint ? built.endpoint : entry.fal;
    return { input, endpoint: assertEndpointId(endpoint) };
}

function extractFromCatalog(catalog, entry, output, endpoint) {
    let primary = null;
    try {
        primary = entry && typeof catalog?.extractOutputs === 'function' ? catalog.extractOutputs(entry, output, endpoint) : null;
    } catch {
        primary = null;
    }
    return mergeExtracted(primary, extractMedia(output));
}

// ── Media URL validation ────────────────────────────────────────────────────
const URLISH_KEY = /(^|_)(url|urls|uri|uris|image|images|video|videos|audio|audios|mask|masks|file|files|reference|references|frame|frames|avatar|source|target|start|end|last|first)(_|$)/i;
const TEXT_KEY = /(^|_)(prompt|prompts|text|lyrics|script|caption|title|description|style|name|negative|instruction|instructions|message)(_|$)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DATA_MEDIA = /^data:(image|audio|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_DATA_URI = 12 * 1024 * 1024;
const MAX_URLS = 64;

function collectUrls(value, key, path, out, depth = 0) {
    if (depth > 6 || out.length > MAX_URLS) return;
    if (typeof value === 'string') {
        const s = value.trim();
        const urlKey = key && URLISH_KEY.test(key) && !TEXT_KEY.test(key);
        const looksLikeUrl = SCHEME.test(s) && !/\s/.test(s) && (s.includes('//') || /^data:|^blob:|^javascript:/i.test(s));
        if ((urlKey && s && SCHEME.test(s)) || looksLikeUrl) out.push({ value: s, field: path });
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectUrls(item, key, `${path}[${index}]`, out, depth + 1));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) collectUrls(v, k, path ? `${path}.${k}` : k, out, depth + 1);
    }
}

// Every URL-looking string in a fal input must be a public http(s) URL (or a
// small base64 media data: URI). blob: URLs mean the browser skipped upload.
export async function validateMediaInputs(input) {
    const found = [];
    collectUrls(input, '', '', found);
    if (found.length > MAX_URLS) throw errors.badRequest('Too many media URLs in one request.');
    const unique = new Map();
    for (const item of found) {
        if (/^data:/i.test(item.value)) {
            if (!DATA_MEDIA.test(item.value) || item.value.length > MAX_DATA_URI) {
                throw new GatewayError(400, 'invalid_url', 'Inline files must be small base64 images, audio or video. Upload the file instead.', { field: item.field });
            }
            continue;
        }
        if (/^blob:/i.test(item.value)) {
            throw new GatewayError(400, 'invalid_url', 'That file has not been uploaded yet. Upload it and try again.', { field: item.field });
        }
        if (!unique.has(item.value)) unique.set(item.value, item.field);
    }
    await Promise.all([...unique].map(([value, field]) => assertPublicMediaUrl(value, { field })));
}

// ── Extend flows: payload.request_id = one of our job tokens ───────────────
async function sourceUrlFromToken(token, session) {
    const claims = decodeJobToken(token);
    if (!claims || claims.sid !== session.sid || claims.k !== 'fal') return null;
    const cached = recall(claims.r);
    if (cached?.status === 'completed') return cached.video?.url || cached.url || null;
    try {
        const output = await falResult({ su: claims.su, ru: claims.ru, cu: claims.cu }, { endpoint: claims.e });
        const media = extractMedia(output);
        return media.video?.url || media.urls[0] || null;
    } catch {
        return null;
    }
}

async function resolveReferencedJob(payload, session) {
    if (typeof payload.request_id !== 'string') {
        delete payload.request_id;
        return payload;
    }
    const token = payload.request_id;
    delete payload.request_id;
    if (!token.includes('.')) return payload;
    const url = await sourceUrlFromToken(token, session);
    if (url && payload.video_url === undefined) payload.video_url = url;
    return payload;
}

// ── Submit ──────────────────────────────────────────────────────────────────
export async function submitCatalogJob({ key, payload, session }) {
    if (!isConfigured()) throw errors.notConfigured('The AI service');
    const { catalog, entry } = await resolveCatalogEntry(key);
    const body = { ...(payload || {}) };
    const sync = body.sync === true;
    delete body.sync;
    await resolveReferencedJob(body, session);
    const { input, endpoint } = buildInput(catalog, entry, body);
    await validateMediaInputs(input);

    const usd = await estimateUsd(catalog, { ...entry, fal: endpoint }, body, { input });
    const localId = newJobId();
    assertJobSlot(session.sid);
    const day = await reserveBudget({ cid: session.cid, usd, jobId: localId });
    acquireJobSlot(session.sid, localId);

    if (sync) {
        try {
            const output = await falRun(endpoint, input);
            const result = completedResult({ requestId: localId, model: key, falEndpoint: endpoint, output, extracted: extractFromCatalog(catalog, entry, output, endpoint) });
            await settleJob({ jobId: localId, refund: false, day });
            // A synchronous answer carries no request_id (the studio client
            // would otherwise poll for it); `url`/`outputs` are the result.
            delete result.request_id;
            return result;
        } catch (error) {
            await settleJob({ jobId: localId, refund: syncRejected(error), day });
            throw error;
        } finally {
            releaseJobSlot(session.sid, localId);
        }
    }

    let submitted;
    try {
        submitted = await falSubmit(endpoint, input);
    } catch (error) {
        await settleJob({ jobId: localId, refund: submitRejected(error), day });
        releaseJobSlot(session.sid, localId);
        throw error;
    }
    const token = signJobToken({
        k: 'fal',
        e: endpoint,
        m: key,
        r: submitted.request_id,
        su: submitted.status_url,
        ru: submitted.response_url,
        cu: submitted.cancel_url,
        sid: session.sid,
        j: localId,
        w: session.cid,
        u: usd,
        d: day,
    });
    logGateway({ event: 'job_submitted', kind: 'fal', endpoint, usd });
    return processingResult({ request_id: token, id: token, ...(Number.isFinite(submitted.queue_position) ? { queue_position: submitted.queue_position } : {}) });
}

// ── Poll ────────────────────────────────────────────────────────────────────
async function finalize(claims, { ok, body }) {
    await settleJob({ jobId: claims.j, refund: !ok, day: claims.d });
    releaseJobSlot(claims.sid, claims.j);
    return remember(claims.r, body);
}

export async function pollFalJob(claims, token) {
    const cached = recall(claims.r);
    if (cached) return cached;
    const urls = { su: claims.su, ru: claims.ru, cu: claims.cu };
    let statusBody;
    try {
        statusBody = await falStatus(urls, { endpoint: claims.e });
    } catch (error) {
        if (error?.status === 404) return finalize(claims, { ok: false, body: failedResult('This generation could not be found. It may have expired.', { request_id: token, id: token }) });
        throw error;
    }
    const status = interpretStatus(statusBody);
    if (status.state === 'failed') return finalize(claims, { ok: false, body: envelopeForStatus(status, { requestId: token }) });
    if (status.state !== 'completed') return envelopeForStatus(status, { requestId: token });

    let output;
    try {
        output = await falResult(urls, { endpoint: claims.e });
    } catch (error) {
        if (error?.retryable) throw error;
        return finalize(claims, { ok: false, body: failedResult(toGatewayError(error).message, { request_id: token, id: token }) });
    }
    let catalog = null;
    let entry = null;
    try {
        catalog = await getCatalog();
        entry = claims.m ? catalog.getEntry(claims.m) : null;
    } catch {
        entry = null;
    }
    const media = extractFromCatalog(catalog, entry, output, claims.e);
    if (!media.urls.length && typeof output?.text !== 'string') {
        // fal finished (and billed) but produced no media: no refund.
        await settleJob({ jobId: claims.j, refund: false, day: claims.d });
        releaseJobSlot(claims.sid, claims.j);
        return remember(claims.r, failedResult("The model finished but didn't return a file. Try again.", { request_id: token, id: token }));
    }
    const body = completedResult({ requestId: token, model: claims.m, falEndpoint: claims.e, output, extracted: media });
    return finalize(claims, { ok: true, body });
}

// ── Refund rules ────────────────────────────────────────────────────────────
// fal bills a job once a runner picks it up, and cannot always stop one that
// is already running. So an estimate is refunded only when fal certainly did
// no billable work:
//   - the submit (or a sync run) was answered with a rejection status,
//   - fal reported a terminal failure,
//   - the job was still IN_QUEUE when it was cancelled and fal accepted it.
// Aborts, timeouts and result-fetch errors after IN_PROGRESS keep the debit.

// A queue submit that fal answered with an error status never ran.
export function submitRejected(error) {
    return Number.isInteger(error?.upstreamStatus);
}

// A synchronous run answered with a 4xx (bad input, auth, rate limit) never
// ran; a 5xx / 408 / timeout may have run and been billed.
export function syncRejected(error) {
    const status = error?.upstreamStatus;
    return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408;
}

// Cancels a queue job → {state, outcome, refund}. `refund` is true only when
// the job was still queued (never ran) and fal accepted the cancellation.
export async function cancelQueuedJob(urls, endpoint) {
    let state = 'unknown';
    try {
        state = interpretStatus(await falStatus(urls, { endpoint, logs: false })).state;
    } catch {
        state = 'unknown';
    }
    let outcome = { accepted: false, status: 'UNKNOWN' };
    try {
        outcome = await falCancel(urls, { endpoint });
    } catch {
        // keep the debit when the cancel could not be confirmed
    }
    return { state, outcome, refund: state === 'queued' && outcome.accepted === true };
}

// ── Cancel ──────────────────────────────────────────────────────────────────
export async function cancelFalJob(claims, token) {
    const cached = recall(claims.r);
    if (cached) return { status: cached.status, request_id: token, id: token };
    const urls = { su: claims.su, ru: claims.ru, cu: claims.cu };
    const { outcome, refund } = await cancelQueuedJob(urls, claims.e);
    if (outcome.status === 'ALREADY_COMPLETED') return { status: 'completed', request_id: token, id: token, cancelled: false };
    // A queued job never runs, so its estimate is refunded; a running one may
    // still be billed by fal and keeps its debit.
    const body = { status: 'cancelled', error: 'The generation was cancelled.', request_id: token, id: token };
    await settleJob({ jobId: claims.j, refund, day: claims.d });
    releaseJobSlot(claims.sid, claims.j);
    remember(claims.r, body);
    return { ...body, cancelled: outcome.accepted, refunded: refund };
}

// ── Internal generation for pipelines / agent tools ─────────────────────────
// runFal({key | endpoint, input, session}) waits for the result and returns
// the normalized completed envelope; throws GatewayError on failure. Budget
// is debited per call and refunded only under the refund rules above.
export async function runFal({ key, endpoint, input, session, signal, sync = false, estUsd, timeoutMs, onStatus }) {
    if (!isConfigured()) throw errors.notConfigured('The AI service');
    if (!session?.cid) throw new Error('runFal needs a session');
    let catalog = null;
    let entry = null;
    let falEndpoint;
    let falInput;
    if (key) {
        ({ catalog, entry } = await resolveCatalogEntry(key));
        ({ input: falInput, endpoint: falEndpoint } = buildInput(catalog, entry, { ...(input || {}) }));
    } else {
        falEndpoint = assertEndpointId(endpoint);
        falInput = { ...(input || {}) };
    }
    await validateMediaInputs(falInput);
    const usd = Number.isFinite(estUsd) ? estUsd : (entry ? await estimateUsd(catalog, { ...entry, fal: falEndpoint }, input || {}, { input: falInput }) : CATEGORY_DEFAULT_USD.tool);
    const ledgerId = newJobId();
    const day = await reserveBudget({ cid: session.cid, usd, jobId: ledgerId });
    let urls = null;
    let lastState = null;
    const watch = (status) => {
        lastState = status?.state || lastState;
        onStatus?.(status);
    };
    try {
        let output;
        if (sync) {
            output = await falRun(falEndpoint, falInput, { signal });
        } else {
            urls = await falSubmit(falEndpoint, falInput, { signal });
            output = await falWait(urls, { signal, endpoint: falEndpoint, timeoutMs, onStatus: watch });
        }
        await settleJob({ jobId: ledgerId, refund: false, day });
        return completedResult({ requestId: ledgerId, model: key, falEndpoint, output, extracted: extractFromCatalog(catalog, entry, output, falEndpoint) });
    } catch (error) {
        let refund = false;
        if (sync) {
            refund = !signal?.aborted && syncRejected(error);
        } else if (!urls) {
            refund = !signal?.aborted && submitRejected(error);
        } else if (lastState === 'failed') {
            // fal reported a terminal failure: nothing billable was produced.
            refund = true;
        } else if (lastState !== 'completed') {
            // Aborted / timed out / status errors: stop the job; refund only
            // if it never left the queue. A job fal already finished keeps it.
            const cancel = await cancelQueuedJob(urls, falEndpoint);
            refund = cancel.refund && lastState !== 'running';
        }
        await settleJob({ jobId: ledgerId, refund, day });
        throw error;
    }
}

export function resetGenerationCache() {
    settledCache().clear();
}
