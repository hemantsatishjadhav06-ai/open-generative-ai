// Result envelopes in the shape the studios' poll loop already understands
// (GET /api/v1/predictions/<token>/result):
//   queued/running → 200 {status:'processing'}            (never 202/404)
//   success        → 200 {status:'completed', request_id, id, url, outputs:[...urls],
//                         images?:[{url}], video?:{url}, audio?:{url}, output:{raw fal output}}
//   failure        → 200 {status:'failed', error:'<friendly message>'}

const str = (value) => (typeof value === 'string' && value.length > 0 ? value : null);
const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function fileUrl(value) {
    return str(value) || str(obj(value).url);
}

function mediaFile(value) {
    const o = obj(value);
    const url = fileUrl(value);
    if (!url) return null;
    const out = { url };
    for (const key of ['content_type', 'file_name', 'file_size', 'width', 'height']) {
        if (o[key] !== undefined && o[key] !== null) out[key] = o[key];
    }
    return out;
}

// Defensive extraction over every fal output shape we know:
// images[].url | image.url | video.url | videos[].url | audio.url |
// audio_file.url | audio_url | model_mesh.url | url (+ video_url, image_url,
// output.* wrappers, outputs[] of strings).
export function extractMedia(output) {
    const root = obj(output);
    const images = [];
    const videos = [];
    const audios = [];
    const others = [];

    const pushImage = (value) => {
        const file = mediaFile(value);
        if (file) images.push(file);
    };

    if (Array.isArray(root.images)) root.images.forEach(pushImage);
    if (root.image) pushImage(root.image);
    if (str(root.image_url)) pushImage(root.image_url);
    if (Array.isArray(root.image_urls)) root.image_urls.forEach(pushImage);

    const video = mediaFile(root.video) || mediaFile(root.video_url);
    if (video) videos.push(video);
    if (Array.isArray(root.videos)) root.videos.forEach((v) => { const f = mediaFile(v); if (f) videos.push(f); });

    const audio = mediaFile(root.audio) || mediaFile(root.audio_file) || mediaFile(root.audio_url);
    if (audio) audios.push(audio);
    if (Array.isArray(root.audios)) root.audios.forEach((a) => { const f = mediaFile(a); if (f) audios.push(f); });

    const mesh = mediaFile(root.model_mesh) || mediaFile(root.model_glb) || mediaFile(root.mesh);
    if (mesh) others.push(mesh);

    // Wrapped outputs ({output:{video:{url}}}) and plain url fields.
    if (!images.length && !videos.length && !audios.length && !others.length) {
        const nested = obj(root.output);
        if (Object.keys(nested).length && nested !== root) {
            const inner = extractMedia(nested);
            if (inner.urls.length) return inner;
        }
        if (Array.isArray(root.outputs)) {
            root.outputs.forEach((value) => { const f = mediaFile(value); if (f) others.push(f); });
        }
        const direct = str(root.url) || str(root.output_url) || str(root.file_url);
        if (direct) others.push({ url: direct });
    }

    const urls = [...new Set([...videos, ...images, ...audios, ...others].map((f) => f.url))];
    const result = { urls };
    if (images.length) result.images = images;
    if (videos.length) result.video = videos[0];
    if (audios.length) result.audio = audios[0];
    return result;
}

// Merges the catalog's extractOutputs() result (preferred) with the
// defensive extraction so a sparse catalog mapping never loses a URL.
export function mergeExtracted(primary, fallback) {
    const p = primary && typeof primary === 'object' ? primary : {};
    const f = fallback || { urls: [] };
    const urls = [...new Set([...(Array.isArray(p.urls) ? p.urls.filter(str) : []), ...f.urls])];
    const toFile = (v) => (typeof v === 'string' ? { url: v } : mediaFile(v));
    const images = Array.isArray(p.images) && p.images.length ? p.images.map(toFile).filter(Boolean) : f.images;
    const video = (p.video && toFile(p.video)) || f.video;
    const audio = (p.audio && toFile(p.audio)) || f.audio;
    const out = { urls };
    if (images?.length) out.images = images;
    if (video) out.video = video;
    if (audio) out.audio = audio;
    return out;
}

export function processingResult(extra = {}) {
    return { status: 'processing', ...extra };
}

export function failedResult(message, extra = {}) {
    return { status: 'failed', error: typeof message === 'string' && message ? message : 'Generation failed.', ...extra };
}

export function completedResult({ requestId, model, falEndpoint, output, extracted }) {
    const media = extracted || extractMedia(output);
    const body = {
        status: 'completed',
        request_id: requestId,
        id: requestId,
        url: media.urls[0] || null,
        outputs: media.urls,
    };
    if (media.images?.length) body.images = media.images;
    if (media.video) body.video = media.video;
    if (media.audio) body.audio = media.audio;
    body.output = output && typeof output === 'object' ? output : {};
    if (model) body.model = model;
    if (falEndpoint) body.fal_endpoint = falEndpoint;
    return body;
}

// Maps a raw fal status body to an envelope for a queued/running/failed job
// (completed jobs need the result fetch, so they return null here).
export function envelopeForStatus(interpreted, { requestId } = {}) {
    if (interpreted.state === 'queued') {
        return processingResult({ request_id: requestId, id: requestId, stage: 'queued', ...(Number.isFinite(interpreted.queuePosition) ? { queue_position: interpreted.queuePosition } : {}) });
    }
    if (interpreted.state === 'running') return processingResult({ request_id: requestId, id: requestId, stage: 'running' });
    if (interpreted.state === 'failed') return failedResult(interpreted.error?.message, { request_id: requestId, id: requestId });
    if (interpreted.state === 'unknown') return processingResult({ request_id: requestId, id: requestId });
    return null;
}
