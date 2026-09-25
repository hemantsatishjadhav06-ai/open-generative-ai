// Request handlers behind the /api/v1 routes (kept out of app/ so they can be
// exercised directly in tests):
//   submit  POST /api/v1/<name>                    → pipeline <name> or catalog key <name>
//   result  GET  /api/v1/predictions/<token>/result → normalized envelope (always 200 while running)
//   cancel  POST /api/v1/predictions/<token>/cancel

import { getCatalog } from './catalogLoader.js';
import { errors } from './errors.js';
import { json, readJson } from './http.js';
import { buildInput, cancelFalJob, pollFalJob, submitCatalogJob } from './generation.js';
import { verifyJobToken } from './jobs.js';
import { checkRate } from './limits.js';
import { processingResult } from './normalize.js';
import { estimateUsd } from './pricing.js';
import { cancelPipelineJob, loadPipeline, pollPipelineJob, startPipelineJob } from './pipelines/index.js';

// Catalog keys may contain '/' (e.g. mmaudio-v2/text-to-audio); they are only
// ever looked up in the catalog, never used as a fal endpoint.
const NAME = /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

// Estimated USD for running <name> with <payload>, or null when unknown
// (the workflow cost badge simply hides). Never calls the model.
export async function estimateCost(name, payload = {}) {
    if (typeof name !== 'string' || !NAME.test(name)) return null;
    const found = await loadPipeline(name).catch(() => null);
    const pipeline = found && !found.internal ? found : null;
    if (pipeline) {
        if (typeof pipeline.estimateUsd !== 'function') return null;
        const n = Number(await pipeline.estimateUsd(payload || {}));
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 10_000) / 10_000 : null;
    }
    const catalog = await getCatalog();
    const entry = catalog.getEntry(name);
    if (!entry || !entry.enabled || !entry.fal) return null;
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    // Price the endpoint this payload would actually route to (variants).
    let endpoint = entry.fal;
    let input;
    try {
        ({ endpoint, input } = buildInput(catalog, entry, body));
    } catch {
        // an incomplete form still gets the entry's default price
    }
    // Priced from the input fal would receive, like a real submit.
    return estimateUsd(catalog, { ...entry, fal: endpoint }, body, { input });
}

const MAX_SUBMIT_BYTES = 16 * 1024 * 1024;

function nameFrom(params) {
    const segments = Array.isArray(params?.path) ? params.path : [params?.path].filter(Boolean);
    // Only single-segment names exist; anything deeper is not ours.
    if (segments.length !== 1) throw errors.notFound("This endpoint doesn't exist.");
    // Next leaves %2F encoded, and some catalog keys contain a slash.
    try {
        return decodeURIComponent(String(segments[0]));
    } catch {
        throw errors.notFound("This endpoint doesn't exist.");
    }
}

export async function handleSubmit(request, { params, session }) {
    const name = nameFrom(params);
    const payload = await readJson(request, { maxBytes: MAX_SUBMIT_BYTES });
    const pipeline = await loadPipeline(name);
    if (pipeline && !pipeline.internal) {
        const { body } = await startPipelineJob({ name, input: payload, session });
        return json(body);
    }
    return json(await submitCatalogJob({ key: name, payload, session }));
}

export async function handleResult(request, { params, session, ip }) {
    const token = String(params?.token || '');
    const claims = verifyJobToken(token, session.sid);
    // The studios abort polling on any 4xx, so an over-eager poller is
    // throttled with a "still processing" answer that skips the upstream.
    if (checkRate('poll', { sid: session.sid, ip })) {
        return json(processingResult({ request_id: token, id: token, throttled: true }), { headers: { 'Retry-After': '2' } });
    }
    if (claims.k === 'fal') return json(await pollFalJob(claims, token));
    const { status, body } = await pollPipelineJob(claims, token, session);
    return json(body, { status });
}

export async function handleCancel(request, { params, session }) {
    const token = String(params?.token || '');
    const claims = verifyJobToken(token, session.sid);
    if (claims.k === 'fal') return json(await cancelFalJob(claims, token));
    const outcome = await cancelPipelineJob(claims, session);
    return json({ request_id: token, id: token, ...outcome });
}
