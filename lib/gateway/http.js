// Route plumbing shared by every gateway handler: JSON replies, bounded body
// reading, and a wrapper that applies the same-origin check, the session
// gate and rate limits, maps errors to JSON and forwards refreshed cookies.
// Uses only web-standard Request/Response (no next/server), so handlers can
// be called directly from node:test.

import { toGatewayError } from './errors.js';
import { assertSameOrigin, loadRevocations, requireSession } from './session.js';
import { clientIp, enforceRate } from './limits.js';
import { logGateway } from './log.js';
import { newReqId } from '../log.js';

export const NO_STORE = { 'Cache-Control': 'no-store' };

// Set here too because the upload route is excluded from middleware.js (so
// Next does not buffer 200 MB bodies for it) and misses its headers.
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', ...NO_STORE };

export function json(body, { status = 200, headers = {} } = {}) {
    const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...BASE_HEADERS, ...headers });
    return new Response(JSON.stringify(body), { status, headers: h });
}

export function errorResponse(error, { reqId } = {}) {
    const err = toGatewayError(error);
    const headers = {};
    if (err.retryAfter) headers['Retry-After'] = String(err.retryAfter);
    if (reqId) headers['x-request-id'] = reqId;
    return json(err.toBody(), { status: err.status, headers });
}

// Reads a JSON body with a hard byte cap. Empty body → {} when allowEmpty.
export async function readJson(request, { maxBytes = 2 * 1024 * 1024, allowEmpty = true } = {}) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw toGatewayError({ status: 413, code: 'payload_too_large', message: 'The request is too large.' });
    let text = '';
    if (request.body) {
        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => {});
                throw toGatewayError({ status: 413, code: 'payload_too_large', message: 'The request is too large.' });
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
    }
    if (!text.trim()) {
        if (allowEmpty) return {};
        throw toGatewayError({ status: 400, code: 'invalid_json', message: 'The request body must be JSON.' });
    }
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        return parsed;
    } catch {
        throw toGatewayError({ status: 400, code: 'invalid_json', message: 'The request body must be a JSON object.' });
    }
}

// Wraps a request body so reading it fails once more than maxBytes have
// arrived (chunked bodies carry no Content-Length) → {stream, exceeded()}.
export function limitBody(body, maxBytes) {
    let total = 0;
    let over = false;
    const stream = body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            total += chunk.byteLength;
            if (total > maxBytes) {
                over = true;
                controller.error(toGatewayError({ status: 413, code: 'payload_too_large', message: 'The request is too large.' }));
                return;
            }
            controller.enqueue(chunk);
        },
    }));
    return { stream, exceeded: () => over };
}

// handler(request, ctx) where ctx = {params, session, ip, reqId}.
// options:
//   session: true            → requireSession (401/503) before the handler
//   rate: 'submit' | …       → token bucket per sid and IP (429)
//   sameOrigin: default true for unsafe methods
export function route(label, handler, { session = false, rate, sameOrigin = true } = {}) {
    return async function gatewayRoute(request, context = {}) {
        const reqId = newReqId();
        const t0 = Date.now();
        let setCookie = null;
        let response;
        try {
            if (sameOrigin) assertSameOrigin(request);
            const ip = clientIp(request);
            let sess = null;
            await loadRevocations();
            if (session) {
                sess = requireSession(request);
                if (sess.setCookie) setCookie = sess.setCookie;
            }
            if (rate) enforceRate(rate, { sid: sess?.sid, cid: sess?.cid, ip });
            const params = context?.params ? await context.params : {};
            response = await handler(request, { params, session: sess, ip, reqId, setCookie: (value) => { setCookie = value; } });
        } catch (error) {
            const err = toGatewayError(error);
            if (err.status >= 500) {
                logGateway({ event: 'route_error', route: label, method: request.method, status: err.status, ms: Date.now() - t0, req_id: reqId, code: err.code }, 'error');
                if (err.code === 'internal_error' && err.cause) {
                    // Error name + stack frames only: messages can quote user input.
                    const frames = String(err.cause?.stack || '').split('\n').slice(1, 5).map((line) => line.trim()).join(' | ');
                    console.error(`[gateway] ${label} internal error: ${err.cause?.name || 'Error'} ${frames}`);
                }
            }
            response = errorResponse(err, { reqId });
        }
        response.headers.set('x-request-id', reqId);
        if (setCookie) response.headers.append('Set-Cookie', setCookie);
        return response;
    };
}
