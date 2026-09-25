// POST /api/v1/upload_file — multipart field `file` → {url, file_url}.
// The file is checked (blocked types, magic bytes, per-kind size caps) and
// stored on fal's CDN server-side, so the returned URL works as a model input.
//
// The byte cap is enforced while the body streams in (a chunked request has
// no Content-Length), so an oversized upload is cut off at the cap instead of
// being buffered whole; each session may run MAX_UPLOADS_IN_FLIGHT uploads at
// a time. Uploads are recorded per workspace (lib/gateway/uploads.js).
import { isConfigured } from '../../../../lib/gateway/config.js';
import { GatewayError, errors } from '../../../../lib/gateway/errors.js';
import { json, limitBody, route } from '../../../../lib/gateway/http.js';
import { uploadToFal } from '../../../../lib/gateway/falStorage.js';
import { acquireUploadSlot } from '../../../../lib/gateway/limits.js';
import { recordUpload } from '../../../../lib/gateway/uploads.js';
import { MAX_UPLOAD_REQUEST_BYTES, checkUpload, mediaDurationSeconds } from '../../../../lib/uploadPolicy.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const TOO_LARGE = 'That file is too large (max 200 MB for video).';

export const POST = route('v1-upload', async (request, { session }) => {
    if (!isConfigured()) throw errors.notConfigured('File uploads');
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_REQUEST_BYTES) throw errors.tooLarge(TOO_LARGE);
    const type = request.headers.get('content-type') || '';
    if (!/^multipart\/form-data/i.test(type)) throw new GatewayError(415, 'invalid_upload', 'Send the file as multipart/form-data in a field named "file".');
    if (!request.body) throw new GatewayError(400, 'invalid_upload', 'No file was attached (expected a field named "file").', { field: 'file' });

    const release = acquireUploadSlot(session);
    try {
        const limited = limitBody(request.body, MAX_UPLOAD_REQUEST_BYTES);
        let form;
        try {
            form = await new Response(limited.stream, { headers: { 'content-type': type } }).formData();
        } catch {
            if (limited.exceeded()) throw errors.tooLarge(TOO_LARGE);
            throw new GatewayError(400, 'invalid_upload', "The upload couldn't be read. Try again.");
        }
        const file = form.get('file');
        if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
            throw new GatewayError(400, 'invalid_upload', 'No file was attached (expected a field named "file").', { field: 'file' });
        }
        const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
        const verdict = checkUpload({ name: file.name || '', type: file.type || '', size: file.size, head });
        if (!verdict.ok) throw new GatewayError(verdict.status, verdict.error, verdict.message, { field: 'file' });

        // Buffer.from(ArrayBuffer) is a view, not another copy.
        const buffer = Buffer.from(await file.arrayBuffer());
        const url = await uploadToFal(buffer, verdict.mime, file.name || '');
        const seconds = verdict.kind === 'image' ? null : mediaDurationSeconds(buffer);
        await recordUpload(session.cid, { url, bytes: buffer.byteLength, mime: verdict.mime, kind: verdict.kind, seconds }).catch(() => {});
        return json({ url, file_url: url, content_type: verdict.mime, kind: verdict.kind, size: buffer.byteLength });
    } finally {
        release();
    }
}, { session: true, rate: 'upload' });
