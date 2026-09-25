// fal.ai transport (server-only). Auth header is `Authorization: Key $FAL_KEY`.
// Queue flow: POST {FAL_QUEUE_BASE}/{endpointId} (verbatim id, never
// URL-encoded) → {request_id, status_url, response_url, cancel_url}; always
// use the returned URLs (status/result/cancel drop the endpoint sub-path).
// COMPLETED with `error`/`error_type` is a failure.

import { falKey, upstream } from './config.js';
import { GatewayError, errors } from './errors.js';
import { logGateway } from './log.js';
import { normalizeUpstream, sleep, backoffMs, withTimeout } from '../upstream.js';

export const TIMEOUTS = { submit: 30_000, status: 15_000, result: 60_000, cancel: 15_000, run: 60_000 };

const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,6}$/;

export function assertEndpointId(endpointId) {
    if (typeof endpointId !== 'string' || !ENDPOINT_ID.test(endpointId) || endpointId.includes('..')) {
        throw new GatewayError(500, 'internal_error', 'This model is misconfigured.');
    }
    return endpointId;
}

function authHeaders(extra = {}) {
    const key = falKey();
    if (!key) throw errors.notConfigured('The AI service');
    return { Authorization: `Key ${key}`, Accept: 'application/json', ...extra };
}

// ── Error mapping ───────────────────────────────────────────────────────────
// fal 422 detail[].type → user copy. Branch on `type`, never on `msg`.
const FRIENDLY = {
    content_policy_violation: "That prompt was blocked by the model's safety filter. Try rephrasing it.",
    no_media_generated: "The model didn't produce a result for that prompt. Try again or rephrase it.",
    file_download_error: "The model couldn't download one of your files. Re-upload it and try again.",
    image_load_error: "The model couldn't read that image. Try a PNG or JPEG.",
    image_too_small: 'That image is too small for this model.',
    image_too_large: 'That image is too large for this model.',
    file_too_large: 'That file is too large for this model.',
    unsupported_image_format: "This model doesn't support that image format. Try PNG or JPEG.",
    unsupported_audio_format: "This model doesn't support that audio format. Try MP3 or WAV.",
    unsupported_video_format: "This model doesn't support that video format. Try MP4.",
    audio_duration_too_long: 'That audio is too long for this model.',
    audio_duration_too_short: 'That audio is too short for this model.',
    video_duration_too_long: 'That video is too long for this model.',
    video_duration_too_short: 'That video is too short for this model.',
    face_detection_error: "The model couldn't find a face in that image or video.",
    feature_not_supported: "This model doesn't support that option.",
    generation_timeout: 'The model took too long. Try again.',
    request_timeout: 'The model took too long to start. Try again.',
    startup_timeout: 'The model took too long to start. Try again.',
    client_cancelled: 'The generation was cancelled.',
    client_disconnected: 'The generation was cancelled.',
};

const RETRYABLE_TYPES = new Set([
    'internal_server_error', 'generation_timeout', 'downstream_service_error', 'downstream_service_unavailable',
    'request_timeout', 'startup_timeout', 'runner_scheduling_failure', 'runner_connection_timeout', 'runner_disconnected',
    'runner_connection_refused', 'runner_connection_error', 'runner_incomplete_response', 'runner_server_error', 'internal_error',
]);

function cleanMsg(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function friendlyFalMessage(type, msg, loc) {
    if (type && FRIENDLY[type]) return FRIENDLY[type];
    if (type && RETRYABLE_TYPES.has(type)) return 'The AI service had a problem running this model. Try again in a moment.';
    const field = Array.isArray(loc) ? loc.filter((p) => p !== 'body').join('.') : '';
    const text = cleanMsg(msg);
    if (text) return field ? `The model rejected "${field}": ${text}` : `The model rejected the request: ${text}`;
    return 'The model rejected the request.';
}

// First meaningful {type,msg,loc} out of a fal error body.
export function falErrorDetail(body) {
    const detail = body?.detail;
    if (Array.isArray(detail) && detail.length) {
        const first = detail.find((d) => d && typeof d === 'object') || {};
        return { type: first.type || null, msg: first.msg || '', loc: first.loc || null };
    }
    if (typeof detail === 'string') return { type: body?.error_type || null, msg: detail, loc: null };
    if (body?.error && typeof body.error === 'object') return { type: body.error.type || null, msg: body.error.message || '', loc: null };
    return { type: body?.error_type || null, msg: typeof body?.error === 'string' ? body.error : '', loc: null };
}

// Maps an upstream HTTP failure to a GatewayError:
//   422/400 → 422 with friendly copy (non-retryable)
//   401/403 → owner misconfiguration: logged, user sees "isn't configured"
//   404     → request unknown / expired
//   429/5xx → retryable
export function mapFalError(args) {
    const error = mapFalErrorInner(args);
    // fal answered this request with an error status (billing decisions in
    // generation.js depend on whether fal replied at all).
    error.upstreamStatus = args.status;
    return error;
}

function mapFalErrorInner({ status, body, headers, where = 'fal', endpoint }) {
    const { type, msg, loc } = falErrorDetail(body);
    const errorType = type || headers?.get?.('x-fal-error-type') || null;
    if (status === 401 || status === 403) {
        logGateway({ event: 'fal_auth_failed', provider: 'fal', route: where, endpoint, status, code: 'check_FAL_KEY' }, 'error');
        return new GatewayError(503, 'not_configured', "The AI service isn't configured. Ask the site owner to check the server keys.");
    }
    if (status === 404) {
        return new GatewayError(404, 'not_found', 'This generation could not be found. It may have expired.', { extra: { upstream: 'fal' } });
    }
    if (status === 429) {
        return new GatewayError(429, 'upstream_busy', 'The AI service is busy right now. Try again in a moment.', { retryable: true, retryAfter: 5 });
    }
    if (status >= 500 || RETRYABLE_TYPES.has(errorType)) {
        return new GatewayError(status === 504 ? 504 : 502, 'upstream_unavailable', friendlyFalMessage(errorType, '', null), { retryable: true, extra: errorType ? { error_type: errorType } : undefined });
    }
    // 400 / 422 and anything else in the 4xx range: the model rejected the input.
    return new GatewayError(422, errorType === 'content_policy_violation' ? 'content_policy_violation' : 'model_rejected', friendlyFalMessage(errorType, msg, loc), {
        retryable: false,
        extra: errorType ? { error_type: errorType } : undefined,
    });
}

// COMPLETED status bodies that carry error/error_type → GatewayError, else null.
export function falFailureFromStatus(statusBody) {
    if (!statusBody || typeof statusBody !== 'object') return null;
    if (!statusBody.error && !statusBody.error_type) return null;
    const type = typeof statusBody.error_type === 'string' ? statusBody.error_type : null;
    const message = friendlyFalMessage(type, typeof statusBody.error === 'string' ? statusBody.error : '', null);
    return new GatewayError(422, type === 'content_policy_violation' ? 'content_policy_violation' : 'generation_failed', message, {
        retryable: false,
        extra: type ? { error_type: type } : undefined,
    });
}

function networkError(error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return new GatewayError(504, 'upstream_timeout', 'The AI service took too long to respond. Try again.', { retryable: true });
    }
    return new GatewayError(502, 'upstream_unreachable', "Couldn't reach the AI service. Try again in a moment.", { retryable: true });
}

async function falFetch(url, { method = 'GET', body, timeoutMs, signal, where, endpoint }) {
    const init = { method, headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}), signal: withTimeout(signal, timeoutMs) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const t0 = Date.now();
    let response;
    let text;
    try {
        response = await fetch(url, init);
        text = await response.text();
    } catch (error) {
        if (signal?.aborted) throw error;
        logGateway({ event: 'fal_request', provider: 'fal', route: where, endpoint, method, status: null, ms: Date.now() - t0, code: error?.name || 'network' }, 'error');
        throw networkError(error);
    }
    const parsed = normalizeUpstream(response.status, text);
    const ms = Date.now() - t0;
    // Status polls run every couple of seconds per job: only log the unusual ones.
    if (where !== 'status' || !response.ok || ms > 3000) {
        logGateway({ event: 'fal_request', provider: 'fal', route: where, endpoint, method, status: response.status, ms });
    }
    return { status: response.status, ok: response.ok, body: parsed.body, headers: response.headers };
}

// Only URLs on the configured queue origin are ever called with the key.
function checkQueueUrl(url) {
    try {
        const u = new URL(url);
        const base = new URL(upstream.falQueue());
        if (u.origin === base.origin) return u.toString();
        // Real fal returns queue.fal.run URLs; accept https *.fal.run as well.
        if (u.protocol === 'https:' && (u.hostname === 'queue.fal.run' || u.hostname.endsWith('.fal.run'))) return u.toString();
    } catch {
        // fall through
    }
    throw new GatewayError(502, 'upstream_unavailable', 'The AI service returned an unexpected response.', { retryable: false });
}

function urlsOf(urls) {
    return {
        status_url: urls?.status_url || urls?.su,
        response_url: urls?.response_url || urls?.ru,
        cancel_url: urls?.cancel_url || urls?.cu,
    };
}

// Submit a queue job. Returns {request_id, status_url, response_url, cancel_url, queue_position}.
export async function falSubmit(endpointId, input, { signal, timeoutMs = TIMEOUTS.submit } = {}) {
    assertEndpointId(endpointId);
    const res = await falFetch(`${upstream.falQueue()}/${endpointId}`, { method: 'POST', body: input || {}, timeoutMs, signal, where: 'submit', endpoint: endpointId });
    if (!res.ok) throw mapFalError({ status: res.status, body: res.body, headers: res.headers, where: 'submit', endpoint: endpointId });
    const b = res.body || {};
    if (typeof b.request_id !== 'string' || !b.request_id) {
        throw new GatewayError(502, 'upstream_unavailable', 'The AI service returned an unexpected response.', { retryable: true });
    }
    const base = upstream.falQueue();
    const [owner, alias] = endpointId.split('/');
    const namespaced = owner === 'workflows' || owner === 'comfy';
    const prefix = namespaced ? endpointId.split('/').slice(0, 3).join('/') : `${owner}/${alias}`;
    const fallback = `${base}/${prefix}/requests/${b.request_id}`;
    return {
        request_id: b.request_id,
        status_url: checkQueueUrl(b.status_url || `${fallback}/status`),
        response_url: checkQueueUrl(b.response_url || fallback),
        cancel_url: checkQueueUrl(b.cancel_url || `${fallback}/cancel`),
        queue_position: Number.isFinite(b.queue_position) ? b.queue_position : null,
    };
}

// GET status_url?logs=1 → raw status body {status, queue_position?, logs?, error?, error_type?}.
export async function falStatus(urls, { signal, timeoutMs = TIMEOUTS.status, logs = true, endpoint } = {}) {
    const { status_url } = urlsOf(urls);
    const url = checkQueueUrl(status_url);
    const target = logs ? `${url}${url.includes('?') ? '&' : '?'}logs=1` : url;
    const res = await falFetch(target, { timeoutMs, signal, where: 'status', endpoint });
    if (!res.ok) throw mapFalError({ status: res.status, body: res.body, headers: res.headers, where: 'status', endpoint });
    return res.body || {};
}

// GET response_url → the model's output JSON (no envelope).
export async function falResult(urls, { signal, timeoutMs = TIMEOUTS.result, endpoint } = {}) {
    const { response_url } = urlsOf(urls);
    const res = await falFetch(checkQueueUrl(response_url), { timeoutMs, signal, where: 'result', endpoint });
    if (!res.ok) throw mapFalError({ status: res.status, body: res.body, headers: res.headers, where: 'result', endpoint });
    return res.body || {};
}

// PUT cancel_url. 202 accepted, 400 already completed, 404 unknown — none fatal.
export async function falCancel(urls, { signal, timeoutMs = TIMEOUTS.cancel, endpoint } = {}) {
    const { cancel_url } = urlsOf(urls);
    if (!cancel_url) return { accepted: false, status: 'NOT_FOUND' };
    const res = await falFetch(checkQueueUrl(cancel_url), { method: 'PUT', timeoutMs, signal, where: 'cancel', endpoint });
    if (res.status === 202 || res.ok) return { accepted: true, status: res.body?.status || 'CANCELLATION_REQUESTED' };
    if (res.status === 400) return { accepted: false, status: res.body?.status || 'ALREADY_COMPLETED' };
    if (res.status === 404) return { accepted: false, status: 'NOT_FOUND' };
    throw mapFalError({ status: res.status, body: res.body, headers: res.headers, where: 'cancel', endpoint });
}

// Synchronous run for fast tools: POST {FAL_RUN_BASE}/{endpointId}. Retries
// 429 concurrent_requests_limit with backoff (1s, 2s).
export async function falRun(endpointId, input, { signal, timeoutMs = TIMEOUTS.run, retries = 2 } = {}) {
    assertEndpointId(endpointId);
    for (let attempt = 0; ; attempt++) {
        const res = await falFetch(`${upstream.falRun()}/${endpointId}`, { method: 'POST', body: input || {}, timeoutMs, signal, where: 'run', endpoint: endpointId });
        if (res.ok) return res.body || {};
        const retryable = res.status === 429 || res.headers?.get?.('x-fal-needs-retry') === '1';
        if (retryable && attempt < retries) {
            await sleep(1000 * 2 ** attempt, signal);
            continue;
        }
        throw mapFalError({ status: res.status, body: res.body, headers: res.headers, where: 'run', endpoint: endpointId });
    }
}

// Reduces a status body to {state, queuePosition, error}. state is one of
// 'queued' | 'running' | 'completed' | 'failed' | 'unknown'.
export function interpretStatus(statusBody) {
    const raw = String(statusBody?.status || '').toUpperCase();
    if (raw === 'IN_QUEUE') return { state: 'queued', queuePosition: Number.isFinite(statusBody.queue_position) ? statusBody.queue_position : null };
    if (raw === 'IN_PROGRESS') return { state: 'running' };
    if (raw === 'COMPLETED' || raw === 'OK' || raw === 'SUCCEEDED' || raw === 'SUCCESS') {
        const failure = falFailureFromStatus(statusBody);
        return failure ? { state: 'failed', error: failure } : { state: 'completed' };
    }
    if (raw === 'FAILED' || raw === 'ERROR' || raw === 'CANCELLED' || raw === 'CANCELED') {
        return { state: 'failed', error: falFailureFromStatus({ error: statusBody?.error || 'failed', error_type: statusBody?.error_type }) };
    }
    return { state: 'unknown' };
}

function pollIntervalMs() {
    const n = Number(process.env.FAL_POLL_INTERVAL_MS);
    return Number.isFinite(n) && n >= 10 ? n : 1500;
}

// Server-side wait for a queue job (pipelines): polls until terminal, then
// returns the raw output. Throws GatewayError on failure.
export async function falWait(urls, { signal, intervalMs = pollIntervalMs(), timeoutMs = 15 * 60_000, endpoint, onStatus } = {}) {
    const deadline = Date.now() + timeoutMs;
    let transientFailures = 0;
    while (Date.now() < deadline) {
        await sleep(intervalMs, signal);
        let body;
        try {
            body = await falStatus(urls, { signal, endpoint });
            transientFailures = 0;
        } catch (error) {
            if (error?.retryable && transientFailures < 5 && !signal?.aborted) {
                transientFailures += 1;
                await sleep(backoffMs(transientFailures), signal);
                continue;
            }
            throw error;
        }
        const status = interpretStatus(body);
        onStatus?.(status);
        if (status.state === 'failed') throw status.error;
        if (status.state === 'completed') return falResult(urls, { signal, endpoint });
    }
    throw new GatewayError(504, 'upstream_timeout', 'The model took too long to finish. Try again.', { retryable: true });
}
