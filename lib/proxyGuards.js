// Edge-safe request guards for the MuAPI proxies and the /api/v1 rewrite in
// middleware.js. No Node APIs here.

// Above ClippingStudio's 100 MB upload limit plus multipart overhead.
export const MAX_PROXY_BODY_BYTES = 110 * 1024 * 1024;

export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function hasApiKey(headers) {
    const auth = headers?.get?.('authorization') || '';
    if (auth.startsWith('Bearer ') && auth.slice(7).trim()) return true;
    const key = headers?.get?.('x-api-key');
    return Boolean(key && key.trim());
}

// Requests without a content-length (e.g. chunked) are let through; browsers
// always send one for fetch/XHR bodies.
export function bodyTooLarge(headers) {
    const raw = headers?.get?.('content-length');
    if (raw === null || raw === undefined || raw === '') return false;
    const n = Number(raw);
    return Number.isFinite(n) && n > MAX_PROXY_BODY_BYTES;
}
