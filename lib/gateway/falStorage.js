// Server-side upload to fal's CDN (same flow as the official fal-js client):
//   1) POST {FAL_REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3
//      {content_type, file_name} (Authorization: Key) → {upload_url, file_url}
//   2) PUT the bytes to upload_url with NO Authorization header (presigned)
//   3) return file_url (public, usable as any model's *_url input)
// Files over 90 MB use initiate-multipart with 10 MB parts + /complete.

import { falKey, upstream } from './config.js';
import { GatewayError, errors } from './errors.js';
import { logGateway } from './log.js';
import { normalizeUpstream, sleep, backoffMs } from '../upstream.js';
import { safeDownload } from './ssrf.js';

export const MULTIPART_THRESHOLD = 90 * 1024 * 1024;
export const MULTIPART_CHUNK = 10 * 1024 * 1024;
const PART_ATTEMPTS = 3;

function extensionFor(contentType) {
    const [, sub = 'bin'] = String(contentType || '').split('/');
    return (sub.split(/[-;+]/)[0] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

export function safeFileName(name, contentType) {
    const base = String(name || '').split(/[\\/]/).pop() || '';
    const cleaned = base.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(-100);
    return cleaned && /\.[A-Za-z0-9]{1,8}$/.test(cleaned) ? cleaned : `${Date.now()}.${extensionFor(contentType)}`;
}

async function initiate(path, contentType, fileName) {
    const key = falKey();
    if (!key) throw errors.notConfigured('File uploads');
    const t0 = Date.now();
    let response;
    let text;
    try {
        response = await fetch(`${upstream.falRest()}${path}?storage_type=fal-cdn-v3`, {
            method: 'POST',
            headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ content_type: contentType, file_name: fileName }),
            signal: AbortSignal.timeout(30_000),
        });
        text = await response.text();
    } catch (error) {
        logGateway({ event: 'fal_upload_initiate', provider: 'fal', status: null, ms: Date.now() - t0, code: error?.name || 'network' }, 'error');
        throw new GatewayError(502, 'upstream_unreachable', "Couldn't reach the upload service. Try again.", { retryable: true });
    }
    logGateway({ event: 'fal_upload_initiate', provider: 'fal', status: response.status, ms: Date.now() - t0 });
    const { body } = normalizeUpstream(response.status, text);
    if (response.status === 401 || response.status === 403) {
        logGateway({ event: 'fal_auth_failed', provider: 'fal', route: 'storage', status: response.status, code: 'check_FAL_KEY' }, 'error');
        throw errors.notConfigured('File uploads');
    }
    if (!response.ok || typeof body?.upload_url !== 'string' || typeof body?.file_url !== 'string') {
        throw new GatewayError(502, 'upstream_unavailable', 'The upload service had a problem. Try again.', { retryable: true });
    }
    return { uploadUrl: body.upload_url, fileUrl: body.file_url };
}

async function putBytes(url, bytes, contentType) {
    const headers = contentType ? { 'Content-Type': contentType } : {};
    const response = await fetch(url, { method: 'PUT', headers, body: bytes, signal: AbortSignal.timeout(300_000) });
    const text = await response.text().catch(() => '');
    return { response, text };
}

async function uploadPart(url, chunk) {
    let lastStatus = null;
    for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
        try {
            const { response, text } = await putBytes(url, chunk);
            lastStatus = response.status;
            if (response.ok) {
                let etag = response.headers.get('etag');
                try {
                    etag = JSON.parse(text)?.etag || etag;
                } catch {
                    // header only
                }
                if (etag) return etag;
            } else if (response.status < 500 && response.status !== 429) {
                break;
            }
        } catch {
            lastStatus = null;
        }
        await sleep(backoffMs(attempt));
    }
    throw new GatewayError(502, 'upstream_unavailable', `The upload failed (part error${lastStatus ? ` ${lastStatus}` : ''}). Try again.`, { retryable: true });
}

async function multipartUpload(buffer, contentType, fileName) {
    const { uploadUrl, fileUrl } = await initiate('/storage/upload/initiate-multipart', contentType, fileName);
    const parsed = new URL(uploadUrl);
    const parts = [];
    const count = Math.ceil(buffer.byteLength / MULTIPART_CHUNK);
    for (let i = 0; i < count; i++) {
        const chunk = buffer.subarray(i * MULTIPART_CHUNK, Math.min(buffer.byteLength, (i + 1) * MULTIPART_CHUNK));
        const partNumber = i + 1;
        const etag = await uploadPart(`${parsed.origin}${parsed.pathname}/${partNumber}${parsed.search}`, chunk);
        parts.push({ partNumber, etag });
    }
    const response = await fetch(`${parsed.origin}${parsed.pathname}/complete${parsed.search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new GatewayError(502, 'upstream_unavailable', 'The upload could not be completed. Try again.', { retryable: true });
    return fileUrl;
}

// uploadToFal(buffer, contentType, fileName) → public file_url.
export async function uploadToFal(buffer, contentType = 'application/octet-stream', fileName) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const name = safeFileName(fileName, contentType);
    const t0 = Date.now();
    let url;
    if (bytes.byteLength > MULTIPART_THRESHOLD) {
        url = await multipartUpload(bytes, contentType, name);
    } else {
        const { uploadUrl, fileUrl } = await initiate('/storage/upload/initiate', contentType, name);
        let result;
        try {
            result = await putBytes(uploadUrl, bytes, contentType);
        } catch {
            throw new GatewayError(502, 'upstream_unreachable', "Couldn't reach the upload service. Try again.", { retryable: true });
        }
        if (!result.response.ok) {
            throw new GatewayError(502, 'upstream_unavailable', 'The upload service had a problem. Try again.', { retryable: true });
        }
        url = fileUrl;
    }
    logGateway({ event: 'fal_upload', provider: 'fal', status: 200, ms: Date.now() - t0 });
    return url;
}

// Downloads a user-supplied URL through the SSRF guard and re-hosts it on
// fal's CDN (for pipelines that need a stable, fal-fetchable copy).
export async function rehostToFal(url, { maxBytes = 200 * 1024 * 1024, fileName, signal } = {}) {
    const { buffer, contentType } = await safeDownload(url, { maxBytes, signal });
    return uploadToFal(buffer, contentType.split(';')[0].trim() || 'application/octet-stream', fileName);
}
