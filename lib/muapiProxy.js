import { NextResponse } from 'next/server';
import {
    MUAPI_BASE,
    getApiKey,
    buildUpstreamHeaders,
    normalizeUpstream,
    mapProxyError,
    PROXY_TIMEOUT_MS,
} from './muapiUpstream.js';
import { hasApiKey, WRITE_METHODS } from './proxyGuards.js';
import { newReqId, logProxy } from './log.js';

// Shared MuAPI proxy used by every /api/* catch-all route handler.
// - forwards the key as x-api-key (never cookies)
// - refuses keyless writes (the deployment is not an open relay)
// - times out slow upstreams
// - never turns a non-JSON upstream reply into a JSON.parse 500
// - logs one structured line per request and returns x-request-id
export async function proxyToMuapi(request, targetUrl, { method = 'GET', transform, route = 'muapi' } = {}) {
    const reqId = newReqId();
    const withId = (response) => {
        response.headers.set('x-request-id', reqId);
        return response;
    };

    if (WRITE_METHODS.has(method) && !hasApiKey(request.headers)) {
        return withId(NextResponse.json({ error: 'Unauthorized: Missing API key' }, { status: 401 }));
    }

    const apiKey = getApiKey(request.headers);
    const headers = buildUpstreamHeaders(request.headers, apiKey);
    const init = { method, headers, signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) };
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        init.body = await request.arrayBuffer();
    }

    const t0 = Date.now();
    let response;
    let text;
    try {
        response = await fetch(targetUrl, init);
        text = await response.text();
    } catch (error) {
        logProxy({ route, method, status: null, ms: Date.now() - t0, reqId, error });
        const mapped = mapProxyError(error);
        return withId(NextResponse.json(mapped.body, { status: mapped.status }));
    }
    logProxy({ route, method, status: response.status, ms: Date.now() - t0, reqId });

    const normalized = normalizeUpstream(response.status, text);
    let body = normalized.body;
    if (body === null) return withId(new NextResponse(null, { status: normalized.status }));
    if (transform && normalized.status < 400) body = transform(body) ?? body;
    return withId(NextResponse.json(body, { status: normalized.status }));
}

// Route label for logs: family plus first path segment only.
export function routeLabel(family, pathSegments) {
    const first = Array.isArray(pathSegments) && pathSegments[0] ? String(pathSegments[0]).slice(0, 40) : '';
    return first ? `${family}/${first}` : family;
}

export { MUAPI_BASE, getApiKey };
