// Gateway core: result normalization for every fal output shape, status
// interpretation (incl. COMPLETED-with-error) and fal error mapping.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    completedResult,
    envelopeForStatus,
    extractMedia,
    failedResult,
    mergeExtracted,
    processingResult,
} from '../../lib/gateway/normalize.js';
import {
    falErrorDetail,
    falFailureFromStatus,
    friendlyFalMessage,
    interpretStatus,
    mapFalError,
} from '../../lib/gateway/fal.js';

const PNG = 'https://v3.fal.media/files/a/out.png';
const JPG = 'https://v3.fal.media/files/a/out2.jpg';
const MP4 = 'https://v3.fal.media/files/a/out.mp4';
const MP3 = 'https://v3b.fal.media/files/b/out.mp3';
const GLB = 'https://v3.fal.media/files/a/mesh.glb';

test('images[] (t2i / i2i / edits)', () => {
    const media = extractMedia({ images: [{ url: PNG, width: 1024, height: 768, content_type: 'image/png' }, { url: JPG }], seed: 1 });
    assert.deepEqual(media.urls, [PNG, JPG]);
    assert.equal(media.images.length, 2);
    assert.deepEqual(media.images[0], { url: PNG, content_type: 'image/png', width: 1024, height: 768 });
    assert.equal(media.video, undefined);
});

test('image (background removal / upscalers)', () => {
    const media = extractMedia({ image: { url: PNG, content_type: 'image/png' }, mask_image: { url: JPG } });
    assert.deepEqual(media.urls, [PNG]);
    assert.deepEqual(media.images, [{ url: PNG, content_type: 'image/png' }]);
});

test('video (t2v / i2v / lipsync / ffmpeg) and videos[]', () => {
    assert.deepEqual(extractMedia({ video: { url: MP4, content_type: 'video/mp4' } }).video, { url: MP4, content_type: 'video/mp4' });
    assert.deepEqual(extractMedia({ videos: [{ url: MP4 }] }).urls, [MP4]);
    assert.deepEqual(extractMedia({ video_url: MP4 }).urls, [MP4]);
});

test('audio (tts), audio_file (music/sfx) and audio_url (legacy tts)', () => {
    assert.deepEqual(extractMedia({ audio: { url: MP3 } }).audio, { url: MP3 });
    assert.deepEqual(extractMedia({ audio_file: { url: MP3, file_size: 10 } }).audio, { url: MP3, file_size: 10 });
    assert.deepEqual(extractMedia({ audio_url: MP3 }).urls, [MP3]);
});

test('model_mesh (3D), bare url, output wrapper and outputs[] of strings', () => {
    assert.deepEqual(extractMedia({ model_mesh: { url: GLB } }).urls, [GLB]);
    assert.deepEqual(extractMedia({ url: PNG }).urls, [PNG]);
    assert.deepEqual(extractMedia({ output: { video: { url: MP4 } } }).urls, [MP4]);
    assert.deepEqual(extractMedia({ outputs: [PNG, JPG] }).urls, [PNG, JPG]);
});

test('video with a poster image: the video comes first in outputs', () => {
    const media = extractMedia({ video: { url: MP4 }, image: { url: PNG } });
    assert.deepEqual(media.urls, [MP4, PNG]);
    assert.equal(completedResult({ requestId: 't', output: { video: { url: MP4 }, image: { url: PNG } } }).url, MP4);
});

test('garbage never throws and yields no URLs', () => {
    for (const value of [null, undefined, 'x', 42, [], { images: 'nope' }, { images: [null, 5] }, { video: {} }]) {
        assert.deepEqual(extractMedia(value).urls, [], JSON.stringify(value));
    }
});

test('completed envelope matches the studio contract', () => {
    const output = { images: [{ url: PNG }], seed: 3 };
    const body = completedResult({ requestId: 'tok.sig', model: 'flux-dev-image', falEndpoint: 'fal-ai/flux/dev', output });
    assert.equal(body.status, 'completed');
    assert.equal(body.request_id, 'tok.sig');
    assert.equal(body.id, 'tok.sig');
    assert.equal(body.url, PNG);
    assert.deepEqual(body.outputs, [PNG]);
    assert.deepEqual(body.images, [{ url: PNG }]);
    assert.deepEqual(body.output, output);
    assert.equal(body.model, 'flux-dev-image');
    assert.equal(body.fal_endpoint, 'fal-ai/flux/dev');
    const video = completedResult({ requestId: 'v', output: { video: { url: MP4 } } });
    assert.deepEqual(video.video, { url: MP4 });
    assert.equal(video.images, undefined);
    const audio = completedResult({ requestId: 'a', output: { audio_file: { url: MP3 } } });
    assert.deepEqual(audio.audio, { url: MP3 });
    assert.equal(audio.url, MP3);
});

test('catalog extraction is preferred and merged with the defensive one', () => {
    const merged = mergeExtracted({ urls: [MP4], video: { url: MP4 } }, extractMedia({ video: { url: MP4 }, image: { url: PNG } }));
    assert.deepEqual(merged.urls, [MP4, PNG]);
    assert.deepEqual(merged.video, { url: MP4 });
    const fromStrings = mergeExtracted({ urls: [PNG], images: [PNG] }, { urls: [] });
    assert.deepEqual(fromStrings.images, [{ url: PNG }]);
    assert.deepEqual(mergeExtracted(null, extractMedia({ url: PNG })).urls, [PNG]);
});

test('processing and failed envelopes', () => {
    assert.deepEqual(processingResult({ request_id: 'x' }), { status: 'processing', request_id: 'x' });
    assert.deepEqual(failedResult('Nope'), { status: 'failed', error: 'Nope' });
    assert.equal(failedResult('').error, 'Generation failed.');
});

test('fal status: IN_QUEUE / IN_PROGRESS / COMPLETED / COMPLETED-with-error', () => {
    const queued = interpretStatus({ status: 'IN_QUEUE', queue_position: 3 });
    assert.deepEqual(queued, { state: 'queued', queuePosition: 3 });
    assert.deepEqual(envelopeForStatus(queued, { requestId: 't' }), { status: 'processing', request_id: 't', id: 't', stage: 'queued', queue_position: 3 });
    assert.equal(envelopeForStatus(interpretStatus({ status: 'IN_PROGRESS', logs: [] }), { requestId: 't' }).status, 'processing');
    assert.deepEqual(interpretStatus({ status: 'COMPLETED', metrics: {} }), { state: 'completed' });
    assert.equal(envelopeForStatus({ state: 'completed' }), null, 'completed needs the result fetch');

    const policy = interpretStatus({ status: 'COMPLETED', error: 'Content policy violation detected', error_type: 'content_policy_violation' });
    assert.equal(policy.state, 'failed');
    assert.equal(policy.error.code, 'content_policy_violation');
    const env = envelopeForStatus(policy, { requestId: 't' });
    assert.equal(env.status, 'failed');
    assert.equal(env.error, "That prompt was blocked by the model's safety filter. Try rephrasing it.");

    const timeout = interpretStatus({ status: 'COMPLETED', error: 'Request timed out', error_type: 'request_timeout' });
    assert.equal(timeout.state, 'failed');
    assert.match(timeout.error.message, /too long/);
    // error without a type still fails
    assert.equal(interpretStatus({ status: 'COMPLETED', error: 'boom' }).state, 'failed');
    assert.equal(interpretStatus({ status: 'WEIRD' }).state, 'unknown');
    assert.equal(envelopeForStatus(interpretStatus({ status: 'WEIRD' })).status, 'processing');
    assert.equal(falFailureFromStatus({ status: 'COMPLETED' }), null);
});

test('fal error mapping: 422 detail types → friendly copy, never raw internals', () => {
    const policy = mapFalError({ status: 422, body: { detail: [{ loc: ['body', 'prompt'], msg: 'flagged', type: 'content_policy_violation' }] } });
    assert.equal(policy.status, 422);
    assert.equal(policy.code, 'content_policy_violation');
    assert.equal(policy.message, "That prompt was blocked by the model's safety filter. Try rephrasing it.");
    assert.equal(policy.retryable, false);

    const download = mapFalError({ status: 422, body: { detail: [{ loc: ['body', 'image_url'], msg: 'x', type: 'file_download_error' }] } });
    assert.match(download.message, /couldn't download/);

    const unknown = mapFalError({ status: 422, body: { detail: [{ loc: ['body', 'num_images'], msg: 'Input should be less than or equal to 4', type: 'less_than_equal' }] } });
    assert.equal(unknown.code, 'model_rejected');
    assert.equal(unknown.message, 'The model rejected "num_images": Input should be less than or equal to 4');

    const html = mapFalError({ status: 400, body: { detail: '<b>bad</b> request' } });
    assert.equal(html.status, 422);
    assert.ok(!html.message.includes('<'));
});

test('fal error mapping: auth → not configured (never 401 to the browser), 429/5xx retryable, 404 expired', () => {
    for (const status of [401, 403]) {
        const err = mapFalError({ status, body: { detail: 'Invalid key' } });
        assert.equal(err.status, 503, 'a 401 would pop the access-code modal');
        assert.equal(err.code, 'not_configured');
        assert.match(err.message, /isn't configured/);
    }
    const busy = mapFalError({ status: 429, body: { detail: 'concurrent_requests_limit' } });
    assert.equal(busy.status, 429);
    assert.equal(busy.retryable, true);
    for (const status of [500, 502, 503]) {
        const err = mapFalError({ status, body: { detail: 'Runner disconnected', error_type: 'runner_disconnected' } });
        assert.equal(err.status, 502);
        assert.equal(err.code, 'upstream_unavailable');
        assert.equal(err.retryable, true);
    }
    assert.equal(mapFalError({ status: 504, body: { detail: 'Request timed out', error_type: 'request_timeout' } }).status, 504);
    const expired = mapFalError({ status: 404, body: { status: 'NOT_FOUND' } });
    assert.equal(expired.status, 404);
    // The infrastructure error type can come from the header alone.
    const headerOnly = mapFalError({ status: 422, body: {}, headers: new Headers({ 'x-fal-error-type': 'content_policy_violation' }) });
    assert.equal(headerOnly.code, 'content_policy_violation');
});

test('falErrorDetail reads list, string and platform error bodies', () => {
    assert.deepEqual(falErrorDetail({ detail: [{ type: 'missing', msg: 'Field required', loc: ['body', 'prompt'] }] }), { type: 'missing', msg: 'Field required', loc: ['body', 'prompt'] });
    assert.deepEqual(falErrorDetail({ detail: 'Request timed out', error_type: 'request_timeout' }), { type: 'request_timeout', msg: 'Request timed out', loc: null });
    assert.deepEqual(falErrorDetail({ error: { type: 'not_found', message: 'nope' } }), { type: 'not_found', msg: 'nope', loc: null });
    assert.equal(friendlyFalMessage(null, '', null), 'The model rejected the request.');
});
