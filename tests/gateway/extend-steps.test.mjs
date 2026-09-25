// Extend flows, multi-step catalog entries (catalog-steps pipeline), layer
// decomposition and the picker metadata (thumbnails / "Runs on …"), run
// through the real route handlers + the real catalog against the local mock
// upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { resetGenerationCache, runFal } from '../../lib/gateway/generation.js';
import { resetPricingCache } from '../../lib/gateway/pricing.js';
import * as catalog from '../../lib/gateway/catalog/index.js';

import * as sessionRoute from '../../app/api/session/route.js';
import * as submitRoute from '../../app/api/v1/[...path]/route.js';
import * as resultRoute from '../../app/api/v1/predictions/[token]/result/route.js';
import * as modelsRoute from '../../app/api/v1/models/available/route.js';

const ORIGIN = 'http://localhost:3000';
const CODE = 'test-code-extend-123';
const CODE_B = 'test-code-extend-456';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-extend-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_ACCESS_CODES: `${CODE},${CODE_B}`,
    AQUORA_SESSION_SECRET: 'extend-test-secret-'.padEnd(48, 'x'),
    AQUORA_SESSION_DAILY_BUDGET_USD: '50',
    AQUORA_DAILY_BUDGET_USD: '100',
    AQUORA_LOG_LEVEL: 'silent',
    FAL_POLL_INTERVAL_MS: '20',
});

let mock;
let IMG; // a mock-hosted image (public media URLs are DNS-checked)

test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 1 });
    applyMockEnv(mock);
    IMG = `${mock.url}/media/sample.png`;
    setCatalogForTesting(catalog);
});

test.after(async () => {
    setCatalogForTesting(null);
    await flushLedger();
    await mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test.beforeEach(() => {
    resetLimits();
    resetGenerationCache();
    resetPricingCache();
});

async function call(handler, { method = 'GET', url = '/', body, cookie, params = {} } = {}) {
    const headers = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin' };
    if (cookie) headers.cookie = cookie;
    const init = { method, headers };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        headers['content-type'] = 'application/json';
    }
    const response = await handler(new Request(`${ORIGIN}${url}`, init), { params: Promise.resolve(params) });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, body: type.includes('json') ? await response.json() : await response.text() };
}

async function session(code = CODE) {
    const headers = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    const response = await sessionRoute.POST(new Request(`${ORIGIN}/api/session`, { method: 'POST', headers, body: JSON.stringify({ code }) }), { params: Promise.resolve({}) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
}

const submit = (cookie, key, payload) => call(submitRoute.POST, { method: 'POST', url: `/api/v1/${key}`, body: payload, cookie, params: { path: [key] } });

async function waitDone(cookie, token, max = 400) {
    for (let i = 0; i < max; i++) {
        const res = await call(resultRoute.GET, { url: `/api/v1/predictions/${token}/result`, cookie, params: { token } });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        if (res.body.status !== 'processing') return res.body;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('job did not finish');
}

function jobsFor(pattern) {
    return [...mock.state.jobs.values()].filter((job) => pattern.test(job.endpoint));
}

async function generate(cookie, key, payload) {
    const sub = await submit(cookie, key, payload);
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    const final = await waitDone(cookie, sub.body.request_id);
    assert.equal(final.status, 'completed', JSON.stringify(final));
    assert.match(final.url, /^http/);
    return { token: sub.body.request_id, final };
}

test('models/available exposes fal thumbnails for enabled keys and "Runs on" names', async () => {
    const res = await call(modelsRoute.GET, { url: '/api/v1/models/available' });
    assert.equal(res.status, 200);
    const { enabled, disabled, thumbnails, served_by: servedBy } = res.body;
    assert.ok(thumbnails && typeof thumbnails === 'object');
    const keys = Object.keys(thumbnails);
    assert.ok(keys.length >= enabled.length * 0.9, `most enabled models have a thumbnail (${keys.length}/${enabled.length})`);
    for (const key of keys) {
        assert.ok(enabled.includes(key), `${key}: thumbnails only for enabled keys`);
        assert.match(thumbnails[key], /^https:\/\/([a-z0-9-]+\.)*(fal\.media|fal\.ai|storage\.googleapis\.com)\//, `${key}: fal-hosted https thumbnail`);
    }
    assert.ok(!disabled.some((key) => key in thumbnails));
    assert.equal(thumbnails['flux-dev-image'], 'https://storage.googleapis.com/fal_cdn/fal/Upscale-1.jpeg');
    assert.equal(servedBy['bytedance-seedream-image'], 'Seedream 4.0');
    assert.match(servedBy['seedance-2.5-text-to-video-4k'], /SeedVR 4K/);
    assert.ok(!('flux-dev-image' in servedBy), 'exact models carry no "Runs on" hint');
    assert.ok(!JSON.stringify(res.body).match(/muapi|cloudfront/i));
});

test('Veo 3.1 extend: request_id (a job token of this session) becomes the source video_url', async () => {
    const cookie = await session();
    const { token, final: source } = await generate(cookie, 'veo3.1-text-to-video', { prompt: 'a lighthouse at dusk', aspect_ratio: '16:9', duration: 8 });
    const { final } = await generate(cookie, 'veo3.1-extend-video', { prompt: 'the camera keeps pulling back', request_id: token });
    const job = jobsFor(/veo3\.1\/extend-video$/).at(-1);
    assert.equal(job.input.video_url, source.url, 'the extend input carries the source clip');
    assert.equal(job.input.prompt, 'the camera keeps pulling back');
    assert.ok(!('request_id' in job.input));
    assert.match(final.video?.url || final.url, /sample\.mp4/);
});

test('extend: missing, foreign and tampered tokens are a friendly 400', async () => {
    const cookie = await session();
    const other = await session(CODE_B);
    const { token } = await generate(other, 'veo3.1-text-to-video', { prompt: 'x', aspect_ratio: '16:9' });
    for (const requestId of [undefined, 'not-a-token', token, `${token.split('.')[0]}.AAAA`]) {
        const res = await submit(cookie, 'grok-imagine-extend', { prompt: 'more', ...(requestId ? { request_id: requestId } : {}) });
        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.equal(res.body.error, 'source_required');
        assert.equal(res.body.field, 'request_id');
    }
});

test('Seedance 2.0 extend: last frame → Seedance (frame as @image1) → merged with the source', async () => {
    const cookie = await session();
    const { token, final: source } = await generate(cookie, 'seedance-v2.0-t2v', { prompt: 'a dancer spins', duration: 5, quality: 'high' });
    const before = mock.state.jobs.size;
    const { final } = await generate(cookie, 'seedance-v2.0-extend', { prompt: 'she keeps spinning', request_id: token, duration: 5 });
    const jobs = [...mock.state.jobs.values()].slice(before);
    const endpoints = jobs.map((job) => job.endpoint);
    assert.deepEqual(endpoints, ['fal-ai/ffmpeg-api/extract-frame', 'bytedance/seedance-2.0/image-to-video', 'fal-ai/ffmpeg-api/merge-videos']);
    assert.deepEqual(jobs[0].input, { video_url: source.url, frame_type: 'last' });
    assert.match(jobs[1].input.image_url, /sample\.(png|jpg)/, 'the extracted last frame starts the new clip');
    assert.equal(jobs[1].input.prompt, 'she keeps spinning');
    assert.equal(jobs[2].input.video_urls[0], source.url);
    assert.equal(jobs[2].input.video_urls.length, 2);
    assert.match(final.url, /sample\.mp4/);
    assert.equal(final.video.url, final.url);

    // A pipeline result is itself a valid source: extend the extended clip.
    const again = await generate(cookie, 'sd-2-vip-extend', { prompt: 'and bows', request_id: final.request_id || final.id, images_list: [IMG] });
    const last = [...mock.state.jobs.values()].slice(-3);
    assert.equal(last[0].input.video_url, final.url);
    assert.equal(last[1].endpoint, 'bytedance/seedance-2.0/reference-to-video', 'extra references route to reference-to-video');
    assert.deepEqual(last[1].input.image_urls.slice(1), [IMG], 'the last frame is @image1, user references follow');
    assert.match(again.final.url, /sample\.mp4/);
});

test('4K entries: generate at 1080p, then SeedVR upscales to 2160p', async () => {
    const cookie = await session();
    const before = mock.state.jobs.size;
    const { final } = await generate(cookie, 'seedance-2.5-text-to-video-4k', { prompt: 'city at night', duration: 5, aspect_ratio: '16:9' });
    const jobs = [...mock.state.jobs.values()].slice(before);
    assert.deepEqual(jobs.map((job) => job.endpoint), ['bytedance/seedance-2.5/text-to-video', 'fal-ai/seedvr/upscale/video']);
    assert.equal(jobs[0].input.resolution, '1080p');
    assert.deepEqual({ mode: jobs[1].input.upscale_mode, target: jobs[1].input.target_resolution }, { mode: 'target', target: '2160p' });
    assert.match(final.url, /sample\.mp4/);

    // Veo 3.1 → 4K: the source clip is upscaled directly (a plain queue job).
    const { token, final: source } = await generate(cookie, 'veo3.1-text-to-video', { prompt: 'waves', aspect_ratio: '16:9' });
    await generate(cookie, 'veo3.1-4k-video', { request_id: token });
    const upscale = jobsFor(/seedvr\/upscale\/video$/).at(-1);
    assert.equal(upscale.input.video_url, source.url);
    assert.equal(upscale.input.target_resolution, '2160p');
});

test('catalog-steps is internal: not reachable by name, and studio-only entries refuse workflow/agent calls', async () => {
    const cookie = await session();
    const direct = await submit(cookie, 'catalog-steps', { key: 'seedance-2.5-text-to-video-4k', payload: { prompt: 'x' } });
    assert.equal(direct.status, 404);
    await assert.rejects(
        runFal({ key: 'seedance-2.5-text-to-video-4k', input: { prompt: 'x' }, session: { sid: 's', cid: 'c' } }),
        (error) => error.status === 400 && error.code === 'studio_only',
    );
    const bad = await submit(cookie, 'seedance-2.5-text-to-video-4k', { duration: 5 });
    assert.equal(bad.status, 400, 'input errors surface before any step runs');
});

test('layer decomposition returns the base image followed by each layer', async () => {
    const cookie = await session();
    const { final } = await generate(cookie, 'bytedance-seedream-5.0-pro-layer', { image_url: IMG, prompt: 'Split into 3 layers', resolution: '2K', output_format: 'png' });
    const job = jobsFor(/layerize$/).at(-1);
    assert.deepEqual(job.input, { image_url: IMG, prompt: 'Split into 3 layers', image_size: 'auto_2K' });
    assert.equal(final.outputs.length, 4);
    assert.equal(final.images.length, 4);
});
