// Registry of files uploaded through POST /api/v1/upload_file, per
// workspace: {url, bytes, mime, kind, seconds}. Pipelines whose cost scales
// with the length of a user's media (AI Clipping transcription) only accept
// files from here, so the input is bounded by the upload caps and its length
// is known before anything is billed.

import crypto from 'node:crypto';
import * as store from './store.js';

const COLLECTION = 'uploads';

export function uploadId(url) {
    return crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 40);
}

export async function recordUpload(cid, { url, bytes, mime, kind, seconds }) {
    if (!cid || typeof url !== 'string' || !url) return null;
    const doc = {
        url,
        bytes: Number(bytes) || 0,
        mime: String(mime || ''),
        kind: String(kind || ''),
        seconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 100) / 100 : null,
        at: new Date().toISOString(),
    };
    await store.forWorkspace(cid).put(COLLECTION, uploadId(url), doc);
    return doc;
}

export async function findUpload(cid, url) {
    if (!cid || typeof url !== 'string' || !url) return null;
    const doc = await store.forWorkspace(cid).get(COLLECTION, uploadId(url)).catch(() => null);
    return doc && doc.url === url ? doc : null;
}
