// Edge-safe request guards used by middleware.js for every /api/* request.
// No Node APIs here.

import { MAX_UPLOAD_REQUEST_BYTES } from './uploadPolicy.js';

// POST /api/v1/upload_file carries the file itself (video cap 200 MB).
export const UPLOAD_PATH = '/api/v1/upload_file';
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_REQUEST_BYTES;
// Every other API route takes JSON (inline data: URIs stay well below this).
export const MAX_JSON_BODY_BYTES = 20 * 1024 * 1024;
// Kept for callers that do not pass a pathname: the largest legitimate body.
export const MAX_PROXY_BODY_BYTES = MAX_UPLOAD_BODY_BYTES;

export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function maxBodyBytes(pathname) {
    if (typeof pathname !== 'string') return MAX_PROXY_BODY_BYTES;
    return pathname === UPLOAD_PATH ? MAX_UPLOAD_BODY_BYTES : MAX_JSON_BODY_BYTES;
}

// Requests without a content-length (e.g. chunked) are let through here; the
// route handlers enforce their own byte caps while reading.
export function bodyTooLarge(headers, pathname) {
    const raw = headers?.get?.('content-length');
    if (raw === null || raw === undefined || raw === '') return false;
    const n = Number(raw);
    return Number.isFinite(n) && n > maxBodyBytes(pathname);
}

