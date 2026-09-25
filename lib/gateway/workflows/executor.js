// Workflow executor: a run is one 'workflow-run' pipeline job (budget, job
// slot, timeout and cancel come from lib/gateway/pipelines). The job walks
// the node graph in topological order (up to NODE_CONCURRENCY steps at once),
// resolves {{ node.outputs[i].value }} placeholders from earlier steps and
// runs each step:
//   passthrough "Input" nodes → their own value (links must be public http(s))
//   text nodes                → OpenRouter (fast / agent / vision purpose)
//   image / video / audio     → the gateway catalog on fal.ai (runFal)
//   prompt-concatenator       → joins the connected texts
//   video-combiner            → fal-ai/ffmpeg-api/merge-videos
// Progress is written to the run record after every step, which the builder
// polls at /api/workflow/run/<runId>/status. After the first failure no new
// step starts (steps already running finish); the rest are marked skipped.

import { isConfigured, isLlmConfigured } from '../config.js';
import { GatewayError, errors, toGatewayError } from '../errors.js';
import { getJob } from '../jobs.js';
import { register, startPipelineJob } from '../pipelines/index.js';
import { estimateCost } from '../router.js';
import { assertPublicMediaUrl } from '../ssrf.js';
import { shared } from '../state.js';
import { deriveParams, referencedNodes, resolvePlaceholders, topoOrder } from './graph.js';
import { PASSTHROUGH, resolveNodeModel, schemaPropertiesFor } from './schemas.js';
import { getRun, listRuns, newRunKey, pruneRuns, putRun, runIdOf, updateRun } from './store.js';
import { LIMITS, cleanOutputs, cleanValue, isHttpUrl } from './validate.js';

export const PIPELINE = 'workflow-run';
const NODE_CONCURRENCY = 3;
const MAX_MEDIA_STEPS = 24;
const TEXT_STEP_USD = 0.01;
const MERGE_USD = 0.02;
const MERGE_ENDPOINT = 'fal-ai/ffmpeg-api/merge-videos';
const LLM_MAX_TOKENS = 1500;
const UI_KEYS = new Set(['make_output', 'make_input', 'is_workflow_input']);
const INTERRUPTED = 'This run was interrupted (the server restarted). Run it again.';

const trustedInputs = () => shared('workflowRunInputs', () => new WeakSet());
// Job ids whose executor is still writing results (a stopped job is marked
// cancelled at once, but its steps are still winding down).
const activeJobs = () => shared('workflowActiveJobs', () => new Set());

const DEFAULT_TYPE = { image: 'image_url', video: 'video_url', audio: 'audio_url', text: 'text' };

function nowIso() {
    return new Date().toISOString();
}

// ── Planning ────────────────────────────────────────────────────────────────
function stepError(nodeId, message, code = 'invalid_workflow') {
    return new GatewayError(400, code, `Step "${nodeId}": ${message}`, { field: nodeId });
}

async function planItem(node, edges, { locale }) {
    const model = await resolveNodeModel(node.category, node.model);
    if (!model) throw stepError(node.id, "its model isn't available on Aquora. Pick another model for this step.", 'model_unavailable');
    if (model.kind === 'text' && !isLlmConfigured()) throw errors.notConfigured('The AI text service');
    const properties = await schemaPropertiesFor(node.category, node.model, { locale });
    if (!properties) throw stepError(node.id, "its model isn't available on Aquora. Pick another model for this step.", 'model_unavailable');
    return {
        id: node.id,
        category: node.category,
        model: node.model,
        kind: model,
        properties,
        params: deriveParams(node, edges, properties),
        make_output: node.input_params?.make_output === true,
    };
}

// Output steps: the ones marked "Output", else every final non-input step.
function outputNodeIds(items, edges) {
    const marked = items.filter((item) => item.make_output).map((item) => item.id);
    if (marked.length) return marked;
    const hasOutgoing = new Set(edges.map((edge) => edge.source));
    const sinks = items.filter((item) => !hasOutgoing.has(item.id) && item.kind.kind !== 'passthrough').map((item) => item.id);
    return sinks.length ? sinks : items.filter((item) => !hasOutgoing.has(item.id)).map((item) => item.id);
}

// Applies Playground inputs ({text1: {prompt}|"…", image1: {image_url}}) to
// the matching input nodes.
function applyOverrides(items, overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    for (const item of items) {
        if (item.kind.kind !== 'passthrough' || !(item.id in overrides)) continue;
        const raw = overrides[item.id];
        const field = item.kind.field;
        const value = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? raw[field] ?? raw.prompt ?? raw.image_url ?? raw.video_url ?? raw.audio_url ?? raw.value
            : raw;
        if (typeof value === 'string') item.params[field] = value.slice(0, LIMITS.text);
    }
}

async function estimateItem(item) {
    if (item.kind.kind === 'text') return TEXT_STEP_USD;
    if (item.kind.kind === 'utility') return item.kind.op === 'merge-videos' ? MERGE_USD : 0;
    if (item.kind.kind !== 'catalog') return 0;
    const cost = await estimateCost(item.model, stripPlaceholders(item.params)).catch(() => null);
    return Number.isFinite(cost) ? cost : 0;
}

function stripPlaceholders(params) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => !(typeof value === 'string' && value.includes('{{')) && !Array.isArray(value)));
}

// → {items (topological order), deps, outputIds, estimate}
export async function planWorkflow(workflow, { locale = 'en', overrides } = {}) {
    const nodes = workflow?.data?.nodes || [];
    const edges = workflow?.edges || [];
    if (!nodes.length) throw new GatewayError(400, 'empty_workflow', 'Add at least one step to the workflow first.');
    const items = [];
    for (const node of nodes) items.push(await planItem(node, edges, { locale }));
    applyOverrides(items, overrides);
    const ids = new Set(items.map((item) => item.id));
    const deps = new Map();
    for (const item of items) {
        const set = new Set(edges.filter((edge) => edge.target === item.id && ids.has(edge.source)).map((edge) => edge.source));
        for (const ref of referencedNodes(item.params)) {
            if (!ids.has(ref)) throw stepError(item.id, `it uses the result of "${ref}", which isn't in this workflow.`);
            set.add(ref);
        }
        set.delete(item.id);
        deps.set(item.id, [...set]);
    }
    const order = topoOrder(items.map((item) => item.id), deps);
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = order.map((id) => byId.get(id));
    const mediaSteps = ordered.filter((item) => item.kind.kind === 'catalog').length;
    if (mediaSteps > MAX_MEDIA_STEPS) throw new GatewayError(400, 'workflow_too_large', `A run can include at most ${MAX_MEDIA_STEPS} generation steps.`);
    let estimate = 0;
    for (const item of ordered) estimate += await estimateItem(item);
    return { items: ordered, deps, outputIds: outputNodeIds(ordered, edges), estimate: Math.round(estimate * 10_000) / 10_000 };
}

// ── Step execution ──────────────────────────────────────────────────────────
function cleanModelParams(params) {
    const out = {};
    for (const [key, value] of Object.entries(params || {})) {
        if (UI_KEYS.has(key) || key.startsWith('_')) continue;
        if (value === null || value === undefined || value === '') continue;
        if (Array.isArray(value)) {
            const list = value.filter((item) => item !== null && item !== undefined && item !== '');
            if (list.length) out[key] = list;
            continue;
        }
        out[key] = value;
    }
    return out;
}

function mediaOutputs(result, category) {
    const images = new Set((result.images || []).map((image) => image?.url).filter(Boolean));
    const outputs = (Array.isArray(result.outputs) ? result.outputs : []).filter(isHttpUrl).map((url) => {
        let type = DEFAULT_TYPE[category] || 'image_url';
        if (result.video?.url === url) type = 'video_url';
        else if (result.audio?.url === url) type = 'audio_url';
        else if (images.has(url)) type = 'image_url';
        return { type, value: url };
    });
    if (outputs.length) return outputs.slice(0, 16);
    if (typeof result.output?.text === 'string' && result.output.text.trim()) return [{ type: 'text', value: result.output.text.slice(0, LIMITS.text) }];
    throw new GatewayError(502, 'empty_result', "The model finished but didn't return a file. Try again.");
}

const text = (value) => (Array.isArray(value) ? value.map((item) => String(item ?? '')).join(' ') : String(value ?? '')).trim();

async function runPassthrough(item, params) {
    const { field, type } = item.kind;
    const value = params[field];
    if (type === 'text') return [{ type, value: text(value).slice(0, LIMITS.text) }];
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url) throw new GatewayError(400, 'missing_input', `Add a file to "${item.id}" first.`);
    await assertPublicMediaUrl(url, { field: item.id });
    return [{ type, value: url }];
}

function imageLinks(params) {
    const links = [];
    for (const value of [params.image_url, ...(Array.isArray(params.images_list) ? params.images_list : [])]) {
        if (typeof value === 'string' && /^https:\/\//i.test(value.trim()) && !links.includes(value.trim())) links.push(value.trim());
    }
    return links.slice(0, 4);
}

async function runText(ctx, item, params) {
    if (!isLlmConfigured()) throw errors.notConfigured('The AI text service');
    const prompt = text(params.prompt);
    if (!prompt) throw new GatewayError(400, 'missing_input', `Step "${item.id}" needs a prompt.`);
    const images = imageLinks(params);
    const purpose = images.length ? 'vision' : item.kind.purpose;
    const system = text(params.system_prompt)
        || 'You are a writing step inside a creative workflow. Reply with the requested text only: no preamble, no notes, no Markdown headings.';
    const user = images.length
        ? { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] }
        : { role: 'user', content: prompt };
    const result = await ctx.llm({
        purpose,
        messages: [{ role: 'system', content: system.slice(0, 8_000) }, user],
        max_tokens: LLM_MAX_TOKENS,
        temperature: 0.7,
    });
    const content = typeof result.content === 'string' ? result.content.trim() : '';
    if (!content) throw new GatewayError(502, 'empty_reply', "The text model didn't reply. Try again.");
    return [{ type: 'text', value: content.slice(0, LIMITS.text) }];
}

async function runUtility(ctx, item, params) {
    if (item.kind.op === 'concat') return [{ type: 'text', value: text(params.prompt).slice(0, LIMITS.text) }];
    const clips = [...(Array.isArray(params.videos_list) ? params.videos_list : []), ...(Array.isArray(params.video_files) ? params.video_files : [])]
        .filter((url) => isHttpUrl(url))
        .slice(0, 20);
    if (!clips.length) throw new GatewayError(400, 'missing_input', `Connect or upload at least one clip for "${item.id}".`);
    if (clips.length === 1) return [{ type: 'video_url', value: clips[0] }];
    if (!isConfigured()) throw errors.notConfigured('The AI service');
    const result = await ctx.falCall({ endpoint: MERGE_ENDPOINT }, { video_urls: clips, target_fps: 30, resolution_aspect_ratio_video_index: 0 }, { estUsd: MERGE_USD });
    const url = result.video?.url || result.outputs?.[0];
    if (!isHttpUrl(url)) throw new GatewayError(502, 'empty_result', "The clips couldn't be combined. Try again.");
    return [{ type: 'video_url', value: url }];
}

async function runCatalog(ctx, item, params) {
    if (!isConfigured()) throw errors.notConfigured('The AI service');
    // Always a catalog key (schema allowlist, enums, pricing), even when it contains '/'.
    const result = await ctx.falCall({ key: item.model }, cleanModelParams(params));
    return mediaOutputs(result, item.category);
}

export async function executeStep(ctx, item, params) {
    switch (item.kind.kind) {
        case 'passthrough': return runPassthrough(item, params);
        case 'text': return runText(ctx, item, params);
        case 'utility': return runUtility(ctx, item, params);
        case 'catalog': return runCatalog(ctx, item, params);
        default: throw new GatewayError(400, 'model_unavailable', `Step "${item.id}" can't run here.`);
    }
}

// ── Run records ─────────────────────────────────────────────────────────────
function patchEntry(run, nodeId, nodeRunId, patch) {
    const list = run.nodes?.[nodeId];
    if (!Array.isArray(list)) return run;
    const index = list.findIndex((entry) => entry.node_run_id === nodeRunId);
    if (index === -1) return run;
    list[index] = { ...list[index], ...patch };
    return run;
}

function failurePatch(error, { cancelled = false } = {}) {
    const err = toGatewayError(error);
    const message = cancelled ? 'The run was stopped.' : err.message;
    return {
        status: cancelled ? 'cancelled' : 'failed',
        finished_at: nowIso(),
        error: message,
        ...(err.code && !cancelled ? { code: err.code } : {}),
        result: { outputs: [{ type: 'error', value: { error: message } }] },
    };
}

// The pipeline job behind every run.
async function runWorkflowJob(ctx) {
    activeJobs().add(ctx.jobId);
    try {
        return await executeRun(ctx);
    } finally {
        activeJobs().delete(ctx.jobId);
    }
}

async function executeRun(ctx) {
    const { workflowId, runKey, items, deps, entryIds, seed, outputIds, mode } = ctx.input;
    const cid = ctx.cid;
    const outputs = new Map(Object.entries(seed || {}));
    const state = new Map(items.map((item) => [item.id, 'pending']));
    const running = new Map();
    let failure = null;

    const write = (fn) => updateRun(cid, workflowId, runKey, (run) => fn(run) || run).catch(() => null);

    const startStep = (item) => {
        state.set(item.id, 'processing');
        const nodeRunId = entryIds[item.id];
        const task = (async () => {
            await write((run) => patchEntry(run, item.id, nodeRunId, { status: 'processing', started_at: nowIso() }));
            ctx.emit('step', { node: item.id, status: 'processing' });
            try {
                if (ctx.signal.aborted) throw ctx.signal.reason || new GatewayError(499, 'cancelled', 'The run was stopped.');
                const params = resolvePlaceholders(item.params, outputs);
                const result = await executeStep(ctx, item, params);
                outputs.set(item.id, result);
                state.set(item.id, 'succeeded');
                await write((run) => patchEntry(run, item.id, nodeRunId, {
                    status: 'succeeded',
                    finished_at: nowIso(),
                    result: { id: nodeRunId, outputs: result },
                }));
                ctx.emit('step', { node: item.id, status: 'succeeded' });
            } catch (error) {
                const cancelled = ctx.signal.aborted && toGatewayError(ctx.signal.reason || error).code === 'cancelled';
                state.set(item.id, cancelled ? 'cancelled' : 'failed');
                if (!failure) failure = { node: item.id, error: toGatewayError(error), cancelled };
                await write((run) => patchEntry(run, item.id, nodeRunId, failurePatch(error, { cancelled })));
                ctx.emit('step', { node: item.id, status: cancelled ? 'cancelled' : 'failed' });
            } finally {
                running.delete(item.id);
            }
        })();
        running.set(item.id, task);
    };

    const total = items.length;
    for (;;) {
        if (!failure && !ctx.signal.aborted) {
            for (const item of items) {
                if (running.size >= NODE_CONCURRENCY) break;
                if (state.get(item.id) !== 'pending') continue;
                if ((deps[item.id] || []).every((dep) => state.get(dep) === 'succeeded' || (!state.has(dep) && outputs.has(dep)))) startStep(item);
            }
        }
        if (!running.size) break;
        await Promise.race(running.values());
        const done = [...state.values()].filter((value) => value !== 'pending' && value !== 'processing').length;
        ctx.progress(Math.round((done / total) * 100));
    }

    const aborted = ctx.signal.aborted;
    const leftover = items.filter((item) => state.get(item.id) === 'pending');
    const collected = [];
    for (const id of outputIds || []) {
        for (const output of outputs.get(id) || []) collected.push({ id, ...output });
    }
    const cancelled = aborted && (failure?.cancelled || toGatewayError(ctx.signal.reason).code === 'cancelled');
    const timedOut = aborted && !cancelled;
    const status = cancelled ? 'cancelled' : (failure || leftover.length || timedOut) ? 'failed' : 'completed';
    const error = cancelled
        ? 'The run was stopped.'
        : failure
            ? `${failure.node}: ${failure.error.message}`
            : timedOut ? toGatewayError(ctx.signal.reason).message : null;
    await write((run) => {
        for (const item of leftover) {
            patchEntry(run, item.id, entryIds[item.id], {
                status: cancelled ? 'cancelled' : 'skipped',
                finished_at: nowIso(),
                error: cancelled ? 'The run was stopped.' : 'Skipped because an earlier step failed.',
            });
        }
        // Single-step runs leave the run's own status alone.
        if (mode !== 'node') {
            run.status = status;
            run.finished_at = nowIso();
            run.outputs = collected;
            run.error = error;
            if (failure?.error?.code) run.code = failure.error.code;
        }
        return run;
    });
    return { run_id: runIdOf(workflowId, runKey), status, outputs: collected.map((item) => item.value), url: collected[0]?.value || null };
}

register(PIPELINE, runWorkflowJob, {
    kind: 'pipeline',
    timeoutMs: 45 * 60_000,
    estimateUsd: (input) => Number(input?.estimate) || 0,
    // Inputs are built by startWorkflowRun(); POST /api/v1/workflow-run can't
    // start one around the workflows API.
    validate(input) {
        if (!input || typeof input !== 'object' || !trustedInputs().has(input)) {
            throw new GatewayError(404, 'unknown_model', "This feature isn't available.");
        }
        return input;
    },
});

function entryFor(nodeRunId, item) {
    return {
        node_run_id: nodeRunId,
        status: 'pending',
        model: item.model,
        category: item.category,
        created_at: nowIso(),
        started_at: nowIso(),
    };
}

function serializableItems(items) {
    return items.map(({ id, category, model, kind, params }) => ({ id, category, model, kind, params }));
}

async function launch({ session, input, onStartFailed }) {
    trustedInputs().add(input);
    try {
        const { job } = await startPipelineJob({ name: PIPELINE, input, session });
        return job;
    } catch (error) {
        await onStartFailed?.();
        throw error;
    }
}

// Full run ('full' from the builder, 'api' from the Playground) → {run_id}.
export async function startWorkflowRun({ session, workflow, mode = 'full', overrides, locale = 'en' }) {
    const plan = await planWorkflow(workflow, { locale, overrides: mode === 'api' ? overrides : undefined });
    const runKey = newRunKey();
    const workflowId = workflow.workflow_id;
    const runId = runIdOf(workflowId, runKey);
    const entryIds = {};
    const nodes = {};
    plan.items.forEach((item, index) => {
        entryIds[item.id] = `${runId}.${index}`;
        nodes[item.id] = [entryFor(entryIds[item.id], item)];
    });
    const run = {
        id: runKey,
        run_id: runId,
        workflow_id: workflowId,
        kind: mode,
        status: 'processing',
        seq: plan.items.length,
        nodes,
        output_nodes: plan.outputIds,
        outputs: [],
        error: null,
        estimate_usd: plan.estimate,
        created_at: nowIso(),
        updated_at: nowIso(),
    };
    await putRun(session.cid, run);
    const deps = Object.fromEntries(plan.deps);
    const job = await launch({
        session,
        input: { workflowId, runKey, mode, items: serializableItems(plan.items), deps, entryIds, seed: {}, outputIds: plan.outputIds, estimate: plan.estimate },
        onStartFailed: () => updateRun(session.cid, workflowId, runKey, (current) => ({ ...current, status: 'failed', error: 'The run could not start.', nodes: {} })).catch(() => null),
    });
    await updateRun(session.cid, workflowId, runKey, (current) => ({ ...current, job_id: job.id })).catch(() => null);
    pruneRuns(session.cid, workflowId).catch(() => {});
    return { run_id: runId, status: 'processing' };
}

// Latest successful outputs per node: saved builder outputs, overridden by
// the run's own results.
function seedOutputs(workflow, run) {
    const seed = {};
    for (const node of workflow?.data?.nodes || []) {
        const saved = cleanOutputs(node.output_params?.outputs);
        if (saved.length) seed[node.id] = saved;
    }
    for (const [nodeId, entries] of Object.entries(run?.nodes || {})) {
        const done = [...entries].reverse().find((entry) => entry.status === 'succeeded' && Array.isArray(entry.result?.outputs));
        if (done) seed[nodeId] = done.result.outputs;
    }
    return seed;
}

// One step ("Generate" on a node) → {run_id}. The browser sends the node's
// current field values; placeholders in them resolve against earlier results.
export async function startNodeRun({ session, workflow, nodeId, model, params, runId, locale = 'en' }) {
    const node = (workflow?.data?.nodes || []).find((candidate) => candidate.id === nodeId);
    if (!node) throw new GatewayError(404, 'not_found', 'Save the workflow first: this step is not in the saved version.');
    const chosen = typeof model === 'string' && model ? model : node.model;
    const item = await planItem({ ...node, model: chosen }, workflow.edges || [], { locale });
    if (params && typeof params === 'object' && !Array.isArray(params)) {
        const given = cleanValue(params) || {};
        const next = {};
        for (const key of Object.keys(item.properties)) {
            if (given[key] !== undefined && given[key] !== null) next[key] = given[key];
            else if (item.params[key] !== undefined) next[key] = item.params[key];
        }
        item.params = next;
    }
    const workflowId = workflow.workflow_id;
    let existing = null;
    const parsed = typeof runId === 'string' ? runId.split('.') : [];
    if (parsed.length === 2 && parsed[0] === workflowId) existing = await getRun(session.cid, workflowId, parsed[1]).catch(() => null);
    const runKey = existing?.id || newRunKey();
    const fullRunId = runIdOf(workflowId, runKey);
    const seed = seedOutputs(workflow, existing);
    for (const ref of referencedNodes(item.params)) {
        if (!seed[ref]) throw new GatewayError(400, 'missing_input', `Step "${ref}" hasn't produced anything for "${nodeId}" yet. Run the whole workflow first.`);
    }
    const estimate = await estimateItem(item);
    let nodeRunId;
    const entry = (seq) => entryFor(`${fullRunId}.${seq}`, item);
    if (existing) {
        await updateRun(session.cid, workflowId, runKey, (run) => {
            const seq = Number(run.seq) || Object.values(run.nodes || {}).flat().length;
            nodeRunId = `${fullRunId}.${seq}`;
            run.seq = seq + 1;
            run.nodes = run.nodes || {};
            run.nodes[nodeId] = [...(run.nodes[nodeId] || []), entry(seq)].slice(-LIMITS.history);
            return run;
        });
    } else {
        nodeRunId = `${fullRunId}.0`;
        await putRun(session.cid, {
            id: runKey,
            run_id: fullRunId,
            workflow_id: workflowId,
            kind: 'node',
            status: 'completed',
            seq: 1,
            nodes: { [nodeId]: [entry(0)] },
            output_nodes: [nodeId],
            outputs: [],
            error: null,
            created_at: nowIso(),
            updated_at: nowIso(),
        });
    }
    const job = await launch({
        session,
        input: {
            workflowId,
            runKey,
            mode: 'node',
            items: serializableItems([item]),
            deps: { [nodeId]: [] },
            entryIds: { [nodeId]: nodeRunId },
            seed,
            outputIds: [nodeId],
            estimate,
        },
        onStartFailed: () => updateRun(session.cid, workflowId, runKey, (run) => {
            run.nodes[nodeId] = (run.nodes[nodeId] || []).filter((candidate) => candidate.node_run_id !== nodeRunId);
            return run;
        }).catch(() => null),
    });
    await updateRun(session.cid, workflowId, runKey, (run) => patchEntry(run, nodeId, nodeRunId, { job_id: job.id })).catch(() => null);
    if (!existing) pruneRuns(session.cid, workflowId).catch(() => {});
    return { run_id: fullRunId, node_run_id: nodeRunId, status: 'processing' };
}

// ── Reading runs ────────────────────────────────────────────────────────────
function jobAlive(jobId) {
    if (!jobId) return null;
    if (activeJobs().has(jobId)) return true;
    const job = getJob(jobId);
    return job ? job.status === 'processing' : false;
}

function staleEntries(run) {
    const stale = [];
    for (const [nodeId, entries] of Object.entries(run.nodes || {})) {
        for (const entry of entries) {
            if (entry.status !== 'pending' && entry.status !== 'processing') continue;
            if (jobAlive(entry.job_id || run.job_id) === false) stale.push([nodeId, entry.node_run_id]);
        }
    }
    return stale;
}

// Marks steps whose job no longer exists (server restart) as failed. The
// check is repeated on the current record inside the write, so a run that
// finished meanwhile is left alone.
export async function reconcileRun(cid, run) {
    if (!run) return run;
    const runStale = (doc) => doc.status === 'processing' && jobAlive(doc.job_id) === false;
    if (!staleEntries(run).length && !runStale(run)) return run;
    let changed = false;
    const next = await updateRun(cid, run.workflow_id, run.id, (current) => {
        const stale = staleEntries(current);
        for (const [nodeId, nodeRunId] of stale) {
            patchEntry(current, nodeId, nodeRunId, failurePatch(new GatewayError(503, 'interrupted', INTERRUPTED)));
        }
        const whole = runStale(current);
        if (whole) {
            current.status = 'failed';
            current.error = INTERRUPTED;
        }
        changed = stale.length > 0 || whole;
        return changed ? current : undefined;
    });
    return next || run;
}

// Builder status view: {run_id, status, nodes:{id:[{status, result, node_run_id, started_at, error}]}}.
// Queued steps read as 'processing' (the builder shows a spinner for them).
export function presentRunStatus(run) {
    const nodes = {};
    for (const [nodeId, entries] of Object.entries(run.nodes || {})) {
        nodes[nodeId] = entries.map((entry) => ({
            node_run_id: entry.node_run_id,
            status: entry.status === 'pending' ? 'processing' : entry.status,
            ...(entry.status === 'pending' ? { queued: true } : {}),
            started_at: entry.started_at || entry.created_at,
            ...(entry.finished_at ? { finished_at: entry.finished_at } : {}),
            model: entry.model,
            ...(entry.error ? { error: entry.error } : {}),
            ...(entry.code ? { code: entry.code } : {}),
            result: entry.result || { id: entry.node_run_id, outputs: [] },
        }));
    }
    return { run_id: run.run_id, workflow_id: run.workflow_id, status: run.status, ...(run.error ? { error: run.error } : {}), nodes };
}

// Playground view: {run_id, status, error?, outputs:[{id, type, value}]}.
// A stopped run reads as failed (the studio client stops polling on it).
export function presentRunOutputs(run) {
    const status = run.status === 'cancelled' ? 'failed' : run.status;
    return {
        run_id: run.run_id,
        status,
        ...(run.error ? { error: run.error } : {}),
        outputs: Array.isArray(run.outputs) ? run.outputs : [],
    };
}

// {nodeId: [succeeded entries, oldest first]} across a workflow's runs.
export async function runHistory(cid, workflowId) {
    const runs = await listRuns(cid, workflowId);
    const history = {};
    for (const run of runs) {
        for (const [nodeId, entries] of Object.entries(run.nodes || {})) {
            for (const entry of entries) {
                if (entry.status !== 'succeeded' || !entry.result?.outputs?.length) continue;
                if (PASSTHROUGH[entry.model]) continue;
                (history[nodeId] ||= []).push({
                    node_run_id: entry.node_run_id,
                    status: 'succeeded',
                    started_at: entry.started_at || entry.created_at,
                    result: entry.result,
                });
            }
        }
    }
    for (const nodeId of Object.keys(history)) {
        history[nodeId] = history[nodeId]
            .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
            .slice(-LIMITS.history);
    }
    return { history, lastRunId: runs[0]?.run_id || null };
}
