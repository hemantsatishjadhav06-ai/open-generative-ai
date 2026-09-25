// Route-level tests: the real Next route handlers are called with Request
// objects while the gateway talks to the local mock upstream. The catalog is
// a small stub with the documented interface (the generated catalog has its
// own tests); one smoke test uses the real catalog when it is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { resetLimits, checkRate, flushLedger } from '../../lib/gateway/limits.js';
import { resetGenerationCache } from '../../lib/gateway/generation.js';
import { resetPricingCache } from '../../lib/gateway/pricing.js';
import { uploadToFal, MULTIPART_THRESHOLD } from '../../lib/gateway/falStorage.js';
import { SESSION_COOKIE, codeId, createSessionCookie } from '../../lib/gateway/session.js';

import * as health from '../../app/api/health/route.js';
import * as sessionRoute from '../../app/api/session/route.js';
import * as submitRoute from '../../app/api/v1/[...path]/route.js';
import * as resultRoute from '../../app/api/v1/predictions/[token]/result/route.js';
import * as cancelRoute from '../../app/api/v1/predictions/[token]/cancel/route.js';
import * as uploadRoute from '../../app/api/v1/upload_file/route.js';
import * as modelsRoute from '../../app/api/v1/models/available/route.js';
import * as estimateRoute from '../../app/api/v1/estimate/route.js';
import * as costRoute from '../../app/api/app/calculate_dynamic_cost/route.js';
import * as llmRoute from '../../app/api/llm/chat/route.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'media');
const ORIGIN = 'http://localhost:3000';
const CODE = 'test-code-alpha-123';
const CODE_B = 'test-code-beta-456';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-routes-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_ACCESS_CODES: `${CODE},${CODE_B}`,
    AQUORA_SESSION_SECRET: 'route-test-secret-'.padEnd(48, 'x'),
    AQUORA_SESSION_DAILY_BUDGET_USD: '10',
    AQUORA_DAILY_BUDGET_USD: '25',
    AQUORA_LOG_LEVEL: 'silent',
});

// ── Stub catalog (same interface as lib/gateway/catalog/index.js) ───────────
const ENTRIES = {
    'flux-dev-image': { key: 'flux-dev-image', enabled: true, fal: 'fal-ai/flux/dev', kind: 'image', est_usd: 0.04, requires: ['prompt'] },
    'seedance-i2v': { key: 'seedance-i2v', enabled: true, fal: 'fal-ai/bytedance/seedance/v1/pro/image-to-video', kind: 'video', est_usd: 0.4, requires: ['prompt'] },
    'video-extend': { key: 'video-extend', enabled: true, fal: 'fal-ai/bytedance/seedance/v1/pro/extend-video', kind: 'video', est_usd: 0.4, requires: ['video_url'] },
    'ai-background-remover': { key: 'ai-background-remover', enabled: true, fal: 'fal-ai/birefnet/v2', kind: 'tool', est_usd: 0.02, requires: ['image_url'] },
    'stable-audio': { key: 'stable-audio', enabled: true, fal: 'fal-ai/stable-audio', kind: 'audio', est_usd: 0.05, requires: ['prompt'] },
    'legacy-model': { key: 'legacy-model', enabled: false, fal: null, kind: 'image' },
};
const stubCatalog = {
    getEntry: (key) => ENTRIES[key] || null,
    listAvailable: () => ({
        enabled: Object.values(ENTRIES).filter((e) => e.enabled).map((e) => e.key),
        disabled: Object.values(ENTRIES).filter((e) => !e.enabled).map((e) => e.key),
    }),
    buildFalInput(entry, payload) {
        for (const field of entry.requires || []) {
            if (payload[field] === undefined || payload[field] === '') throw Object.assign(new Error(`${field} is required`), { status: 400, field });
        }
        const input = {};
        for (const [key, value] of Object.entries(payload)) {
            if (value === null || value === undefined) continue;
            if (key === 'images_list') input.image_urls = value;
            else input[key] = value;
        }
        return { input };
    },
    extractOutputs: () => ({ urls: [] }),
    estimateUsd: (entry) => entry.est_usd,
};

let mock;

test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 2 });
    applyMockEnv(mock);
    setCatalogForTesting(stubCatalog);
});

test.after(async () => {
    await flushLedger();
    await mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────
async function call(handler, { method = 'GET', url = '/', body, cookie, headers = {}, params = {} } = {}) {
    const init = { method, headers: { host: 'localhost:3000', ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        init.headers['content-type'] = 'application/json';
    }
    const response = await handler(new Request(`${ORIGIN}${url}`, init), { params: Promise.resolve(params) });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: data, headers: response.headers };
}

const sameOrigin = { origin: ORIGIN, 'sec-fetch-site': 'same-origin' };

async function login(code = CODE) {
    const res = await call(sessionRoute.POST, { method: 'POST', url: '/api/session', body: { code }, headers: sameOrigin });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.headers.get('set-cookie').split(';')[0];
}

const submit = (cookie, key, payload) => call(submitRoute.POST, { method: 'POST', url: `/api/v1/${key}`, body: payload, cookie, headers: sameOrigin, params: { path: [key] } });
const poll = (cookie, token) => call(resultRoute.GET, { url: `/api/v1/predictions/${token}/result`, cookie, params: { token } });

async function pollUntilDone(cookie, token, max = 10) {
    const seen = [];
    for (let i = 0; i < max; i++) {
        const res = await poll(cookie, token);
        assert.equal(res.status, 200, `poll must stay 200 (${JSON.stringify(res.body)})`);
        seen.push(res.body.stage || res.body.status);
        if (res.body.status !== 'processing') return { final: res.body, seen };
    }
    throw new Error(`still processing after ${max} polls: ${seen.join(',')}`);
}

async function budget(cookie) {
    return (await call(sessionRoute.GET, { url: '/api/session', cookie })).body.budget;
}

function freshState() {
    resetLimits();
    resetGenerationCache();
    resetPricingCache();
}

// ── Health & session ────────────────────────────────────────────────────────
test('GET /api/health reports providers, gate and storage without secrets', async () => {
    const res = await call(health.GET, { url: '/api/health' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, fal: true, openrouter: true, gate: 'codes', storage: 'persistent' });
});

test('session: wrong code 401, cross-site 403, right code sets an HttpOnly cookie, sign-out clears it', async () => {
    freshState();
    const anon = await call(sessionRoute.GET, { url: '/api/session' });
    assert.deepEqual(anon.body, { authenticated: false, gate: 'codes', features: { fal: true, openrouter: true } });

    const wrong = await call(sessionRoute.POST, { method: 'POST', url: '/api/session', body: { code: 'nope' }, headers: sameOrigin });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'invalid_code');
    assert.equal(wrong.headers.get('set-cookie'), null);

    const cross = await call(sessionRoute.POST, { method: 'POST', url: '/api/session', body: { code: CODE }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);

    const ok = await call(sessionRoute.POST, { method: 'POST', url: '/api/session', body: { code: CODE }, headers: sameOrigin });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.authenticated, true);
    assert.equal(ok.body.workspace, codeId(CODE));
    assert.deepEqual(ok.body.budget, { spentUsd: 0, capUsd: 10 });
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /^aquora_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    assert.ok(!JSON.stringify(ok.body).includes(CODE), 'the code is never echoed');

    const cookie = setCookie.split(';')[0];
    const me = await call(sessionRoute.GET, { url: '/api/session', cookie });
    assert.equal(me.body.authenticated, true);
    assert.equal(me.body.workspace, codeId(CODE));

    const out = await call(sessionRoute.DELETE, { method: 'DELETE', url: '/api/session', cookie, headers: sameOrigin });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /^aquora_session=; .*Max-Age=0/);
});

test('login attempts are rate limited per IP (5/min)', async () => {
    freshState();
    const attempt = () => call(sessionRoute.POST, { method: 'POST', url: '/api/session', body: { code: 'guess' }, headers: { ...sameOrigin, 'x-forwarded-for': '203.0.113.9' } });
    for (let i = 0; i < 5; i++) assert.equal((await attempt()).status, 401);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});

test('paid routes need a session (401), expired cookies too', async () => {
    freshState();
    assert.equal((await submit(undefined, 'flux-dev-image', { prompt: 'x' })).status, 401);
    assert.equal((await call(uploadRoute.POST, { method: 'POST', url: '/api/v1/upload_file', headers: sameOrigin, body: new FormData() })).status, 401);
    assert.equal((await call(llmRoute.POST, { method: 'POST', url: '/api/llm/chat', headers: sameOrigin, body: { messages: [{ role: 'user', content: 'x' }] } })).status, 401);
    const expired = createSessionCookie({ codeId: codeId(CODE), now: Math.floor(Date.now() / 1000) - 31 * 24 * 3600 });
    const res = await submit(`${SESSION_COOKIE}=${expired.value}`, 'flux-dev-image', { prompt: 'x' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'session_required');
});

test('GET /api/v1/models/available lists enabled and disabled keys (public)', async () => {
    const res = await call(modelsRoute.GET, { url: '/api/v1/models/available' });
    assert.equal(res.status, 200);
    assert.ok(res.body.enabled.includes('flux-dev-image'));
    assert.deepEqual(res.body.disabled, ['legacy-model']);
    assert.equal(res.body.configured, true);
});

// ── Generation ──────────────────────────────────────────────────────────────
test('image: submit → processing (queued, running) → completed with the studio envelope; budget debited', async () => {
    freshState();
    const cookie = await login();
    const before = await budget(cookie);
    const sub = await submit(cookie, 'flux-dev-image', { prompt: 'a turquoise lake', num_images: 1, image_url: null });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.status, 'processing');
    const token = sub.body.request_id;
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(sub.body.id, token);

    const { final, seen } = await pollUntilDone(cookie, token);
    assert.deepEqual(seen, ['queued', 'running', 'completed']);
    assert.equal(final.status, 'completed');
    assert.equal(final.request_id, token);
    assert.equal(final.url, `${mock.url}/media/sample.png`);
    assert.deepEqual(final.outputs, [final.url]);
    assert.equal(final.images[0].url, final.url);
    assert.equal(final.model, 'flux-dev-image');
    assert.equal(final.fal_endpoint, 'fal-ai/flux/dev');
    assert.equal(final.output.images.length, 1);
    // null fields were dropped before fal saw the input.
    const job = [...mock.state.jobs.values()].pop();
    assert.equal('image_url' in job.input, false);
    assert.equal(job.endpoint, 'fal-ai/flux/dev');
    // max(static $0.04, fal pricing $0.03 at the mock): a refined price
    // never undercuts the static estimate.
    const after = await budget(cookie);
    assert.equal(Math.round((after.spentUsd - before.spentUsd) * 1000) / 1000, 0.04);
    // Polling a finished job again answers from cache without calling fal.
    const results = mock.state.counters.result;
    assert.equal((await poll(cookie, token)).body.status, 'completed');
    assert.equal(mock.state.counters.result, results);
    // The media URL is fetchable.
    const media = await fetch(final.url);
    assert.equal(media.status, 200);
});

test('a job token is useless to another session (404) and to tampering (404)', async () => {
    freshState();
    const owner = await login();
    const other = await login();
    const { body } = await submit(owner, 'flux-dev-image', { prompt: 'mine' });
    const stolen = await poll(other, body.request_id);
    assert.equal(stolen.status, 404);
    const [p, s] = body.request_id.split('.');
    assert.equal((await poll(owner, `${p}x.${s}`)).status, 404);
    assert.equal((await call(cancelRoute.POST, { method: 'POST', url: '/x', cookie: other, headers: sameOrigin, params: { token: body.request_id } })).status, 404);
});

test('video (i2v) completes with video.url', async () => {
    freshState();
    const cookie = await login();
    const { body } = await submit(cookie, 'seedance-i2v', { prompt: 'waves', image_url: `${mock.url}/media/sample.png`, duration: 5 });
    const { final } = await pollUntilDone(cookie, body.request_id);
    assert.equal(final.video.url, `${mock.url}/media/sample.mp4`);
    assert.equal(final.url, final.video.url);
});

test('audio (music) completes with audio.url', async () => {
    freshState();
    const cookie = await login();
    const { body } = await submit(cookie, 'stable-audio', { prompt: 'lofi beat' });
    const { final } = await pollUntilDone(cookie, body.request_id);
    assert.equal(final.audio.url, `${mock.url}/media/sample.mp3`);
    assert.equal(final.url, final.audio.url);
});

test('COMPLETED-with-error → failed with friendly copy, and the estimate is refunded', async () => {
    freshState();
    const cookie = await login(CODE_B);
    const start = (await budget(cookie)).spentUsd;
    const { body } = await submit(cookie, 'flux-dev-image', { prompt: 'FAIL_POLICY' });
    assert.ok((await budget(cookie)).spentUsd > start, 'debited at submit');
    const { final } = await pollUntilDone(cookie, body.request_id);
    assert.equal(final.status, 'failed');
    assert.equal(final.error, "That prompt was blocked by the model's safety filter. Try rephrasing it.");
    assert.equal((await budget(cookie)).spentUsd, start, 'refunded');
    // Polling again neither refunds twice nor calls fal.
    await poll(cookie, body.request_id);
    assert.equal((await budget(cookie)).spentUsd, start);
});

test('422 on the result → failed with the field named; refunded', async () => {
    freshState();
    const cookie = await login(CODE_B);
    const start = (await budget(cookie)).spentUsd;
    const { body } = await submit(cookie, 'flux-dev-image', { prompt: 'FAIL_422' });
    const { final } = await pollUntilDone(cookie, body.request_id);
    assert.equal(final.status, 'failed');
    assert.equal(final.error, 'The model rejected "prompt": Input should be a shorter prompt');
    assert.equal((await budget(cookie)).spentUsd, start);
});

test('422 on submit → 422 content_policy_violation, nothing debited', async () => {
    freshState();
    const cookie = await login(CODE_B);
    const start = (await budget(cookie)).spentUsd;
    const res = await submit(cookie, 'flux-dev-image', { prompt: 'FAIL_SUBMIT_422' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'content_policy_violation');
    assert.match(res.body.message, /safety filter/);
    assert.equal((await budget(cookie)).spentUsd, start);
});

test('input validation: catalog 400 with field, unknown / disabled models 404, bad JSON 400', async () => {
    freshState();
    const cookie = await login();
    const missing = await submit(cookie, 'flux-dev-image', { num_images: 1 });
    assert.equal(missing.status, 400);
    assert.deepEqual([missing.body.error, missing.body.field], ['invalid_input', 'prompt']);
    assert.equal((await submit(cookie, 'no-such-model', { prompt: 'x' })).body.error, 'unknown_model');
    assert.equal((await submit(cookie, 'legacy-model', { prompt: 'x' })).body.error, 'model_disabled');
    const bad = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/flux-dev-image', body: '{not json', cookie, headers: sameOrigin, params: { path: ['flux-dev-image'] } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_json');
    const nested = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/a/b', body: {}, cookie, headers: sameOrigin, params: { path: ['a', 'b'] } });
    assert.equal(nested.status, 404);
    // Next hands the segment over still percent-encoded (keys may contain '/').
    const encoded = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/flux%2Ddev%2Dimage', body: { prompt: 'x' }, cookie, headers: sameOrigin, params: { path: ['flux%2Ddev%2Dimage'] } });
    assert.equal(encoded.status, 200);
    assert.ok(encoded.body.request_id);
    const malformed = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/%E0%A4%A', body: {}, cookie, headers: sameOrigin, params: { path: ['%E0%A4%A'] } });
    assert.equal(malformed.status, 404);
    const get = await call(submitRoute.GET, { url: '/api/v1/account/balance', cookie });
    assert.equal(get.status, 404);
    assert.equal(get.body.error, 'not_found');
});

test('media inputs must be public: private/loopback/blob URLs are refused before fal sees them', async () => {
    freshState();
    const cookie = await login();
    const submits = mock.state.counters.submit;
    for (const url of ['http://10.0.0.5/x.png', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'blob:http://localhost:3000/abc']) {
        const res = await submit(cookie, 'ai-background-remover', { image_url: url });
        assert.equal(res.status, 400, url);
        assert.equal(res.body.error, 'invalid_url');
        assert.equal(res.body.field, 'image_url');
    }
    const list = await submit(cookie, 'flux-dev-image', { prompt: 'x', images_list: [`${mock.url}/media/sample.png`, 'http://192.168.1.1/y.png'] });
    assert.equal(list.status, 400);
    assert.equal(list.body.field, 'image_urls[1]');
    assert.equal(mock.state.counters.submit, submits, 'nothing reached fal');
});

test('sync tools answer immediately with outputs (no request_id to poll)', async () => {
    freshState();
    const cookie = await login();
    const res = await submit(cookie, 'ai-background-remover', { image_url: `${mock.url}/media/sample.png`, sync: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.request_id, undefined);
    assert.deepEqual(res.body.outputs, [`${mock.url}/media/sample.png`]);
    assert.equal(res.body.url, res.body.outputs[0]);
    const job = mock.state.requests.filter((r) => r.path.startsWith('/fal-run/')).pop();
    assert.equal(job.path, '/fal-run/fal-ai/birefnet/v2');
});

test('extend flows: payload.request_id (our token) becomes the source video_url', async () => {
    freshState();
    const cookie = await login();
    const first = await submit(cookie, 'seedance-i2v', { prompt: 'clip one' });
    const { final } = await pollUntilDone(cookie, first.body.request_id);
    const extend = await submit(cookie, 'video-extend', { prompt: 'continue', request_id: first.body.request_id });
    assert.equal(extend.status, 200, JSON.stringify(extend.body));
    const job = [...mock.state.jobs.values()].pop();
    assert.equal(job.input.video_url, final.video.url);
    assert.equal('request_id' in job.input, false, 'our token never reaches fal');
    // Someone else's token cannot be used as a source.
    const other = await login();
    const theft = await submit(other, 'video-extend', { prompt: 'x', request_id: first.body.request_id });
    assert.equal(theft.status, 400);
    assert.equal(theft.body.field, 'video_url');
});

test('cancel while queued → cancelled + refunded; the poller then sees a terminal status', async () => {
    freshState();
    const cookie = await login(CODE_B);
    const start = (await budget(cookie)).spentUsd;
    const { body } = await submit(cookie, 'seedance-i2v', { prompt: 'cancel me' });
    const cancel = await call(cancelRoute.POST, { method: 'POST', url: '/x', cookie, headers: sameOrigin, params: { token: body.request_id } });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, 'cancelled');
    assert.equal(cancel.body.refunded, true);
    assert.equal((await budget(cookie)).spentUsd, start);
    const after = await poll(cookie, body.request_id);
    assert.equal(after.body.status, 'cancelled');
});

test('concurrency: the 5th parallel job is refused (429 too_many_jobs); finishing one frees a slot', async () => {
    freshState();
    const cookie = await login();
    const tokens = [];
    for (let i = 0; i < 4; i++) tokens.push((await submit(cookie, 'flux-dev-image', { prompt: `job ${i}` })).body.request_id);
    const fifth = await submit(cookie, 'flux-dev-image', { prompt: 'job 5' });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.error, 'too_many_jobs');
    await pollUntilDone(cookie, tokens[0]);
    assert.equal((await submit(cookie, 'flux-dev-image', { prompt: 'job 6' })).status, 200);
});

test('submit rate limit: 10 per minute per session → 429 with Retry-After', async () => {
    freshState();
    const cookie = await login();
    for (let i = 0; i < 10; i++) assert.equal((await submit(cookie, 'no-such-model', {})).status, 404);
    const limited = await submit(cookie, 'no-such-model', {});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('over-eager polling is throttled with a 200 "processing" (the studio poller would abort on 429)', async () => {
    freshState();
    const cookie = await login();
    const { body } = await submit(cookie, 'flux-dev-image', { prompt: 'throttle' });
    const sid = JSON.parse(Buffer.from(decodeURIComponent(cookie.split('=')[1]).split('.')[0], 'base64url').toString()).sid;
    while (checkRate('poll', { sid, ip: 'unknown' }) === 0) { /* drain */ }
    const statusCalls = mock.state.counters.status;
    const res = await poll(cookie, body.request_id);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'processing');
    assert.equal(res.body.throttled, true);
    assert.equal(mock.state.counters.status, statusCalls, 'fal not called');
});

test('budget cap → 402 budget_exceeded before anything is submitted', async () => {
    freshState();
    const cookie = await login(CODE_B);
    const spent = (await budget(cookie)).spentUsd;
    // Room for a $0.03 image but not for a 5 s video ($0.10/s at the mock).
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = String(spent + 0.1);
    try {
        const image = await submit(cookie, 'flux-dev-image', { prompt: 'cheap' });
        assert.equal(image.status, 200, JSON.stringify(image.body));
        const submits = mock.state.counters.submit;
        const video = await submit(cookie, 'seedance-i2v', { prompt: 'expensive', duration: 5 });
        assert.equal(video.status, 402);
        assert.equal(video.body.error, 'budget_exceeded');
        assert.equal(video.body.scope, 'session');
        assert.equal(mock.state.counters.submit, submits);
    } finally {
        process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '10';
    }
});

test('a bad FAL_KEY is an owner problem: 503 not_configured, never 401', async () => {
    freshState();
    const cookie = await login();
    const saved = process.env.FAL_KEY;
    process.env.FAL_KEY = 'bad-key';
    try {
        const res = await submit(cookie, 'flux-dev-image', { prompt: 'x' });
        assert.equal(res.status, 503);
        assert.equal(res.body.error, 'not_configured');
    } finally {
        process.env.FAL_KEY = saved;
    }
    delete process.env.FAL_KEY;
    try {
        assert.equal((await submit(cookie, 'flux-dev-image', { prompt: 'x' })).body.error, 'not_configured');
    } finally {
        process.env.FAL_KEY = saved;
    }
});

// ── Uploads ─────────────────────────────────────────────────────────────────
function formWith(name, type, filename) {
    const form = new FormData();
    const bytes = typeof name === 'string' && fs.existsSync(path.join(FIXTURES, name)) ? fs.readFileSync(path.join(FIXTURES, name)) : Buffer.from(name);
    form.append('file', new Blob([bytes], { type }), filename);
    return { form, bytes };
}

test('upload: image → fal storage URL that serves the same bytes; no key on the presigned PUT', async () => {
    freshState();
    const cookie = await login();
    const { form, bytes } = formWith('sample.png', 'image/png', 'my photo (1).png');
    const res = await call(uploadRoute.POST, { method: 'POST', url: '/api/v1/upload_file', body: form, cookie, headers: sameOrigin });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.url, res.body.file_url);
    assert.match(res.body.url, new RegExp(`^${mock.url}/files/[0-9a-f]+/my_photo_1_.png$`));
    assert.equal(res.body.content_type, 'image/png');
    const served = Buffer.from(await (await fetch(res.body.url)).arrayBuffer());
    assert.ok(served.equals(bytes));
    const put = mock.state.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/upload/')).pop();
    assert.equal(put.auth, null);
    // The uploaded URL is accepted as a generation input (trusted upstream host).
    assert.equal((await submit(cookie, 'ai-background-remover', { image_url: res.body.url })).status, 200);
});

test('upload: nameless blob (canvas export), video and audio are accepted with sniffed types', async () => {
    freshState();
    const cookie = await login();
    for (const [file, declared, expected] of [['sample.jpg', '', 'image/jpeg'], ['sample.mp4', 'video/mp4', 'video/mp4'], ['sample.mp3', 'audio/mpeg', 'audio/mpeg'], ['sample.wav', 'audio/wav', 'audio/wav']]) {
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(path.join(FIXTURES, file))], declared ? { type: declared } : {}));
        const res = await call(uploadRoute.POST, { method: 'POST', url: '/api/v1/upload_file', body: form, cookie, headers: sameOrigin });
        assert.equal(res.status, 200, `${file}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.content_type, expected, file);
    }
});

test('upload: HTML/SVG/disguised/missing files are refused', async () => {
    freshState();
    const cookie = await login();
    const cases = [
        [formWith('<html><script>x</script></html>', 'text/html', 'x.html').form, 415, 'blocked_file_type'],
        [formWith('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml', 'x.svg').form, 415, 'blocked_file_type'],
        [formWith('<html>not an image</html>', 'image/png', 'x.png').form, 415, 'unsupported_file_type'],
        [new FormData(), 400, 'invalid_upload'],
    ];
    for (const [form, status, error] of cases) {
        const res = await call(uploadRoute.POST, { method: 'POST', url: '/api/v1/upload_file', body: form, cookie, headers: sameOrigin });
        assert.equal(res.status, status, error);
        assert.equal(res.body.error, error);
    }
    const json = await call(uploadRoute.POST, { method: 'POST', url: '/api/v1/upload_file', body: { url: 'x' }, cookie, headers: sameOrigin });
    assert.equal(json.status, 415);
    const tooBig = await call(uploadRoute.POST, { method: 'POST', url: '/api/v1/upload_file', body: 'x', cookie, headers: { ...sameOrigin, 'content-length': String(300 * 1024 * 1024) } });
    assert.equal(tooBig.status, 413);
});

test('uploads above 90 MB use fal multipart (10 MB parts + complete)', async () => {
    const big = Buffer.alloc(MULTIPART_THRESHOLD + 3 * 1024 * 1024, 7);
    fs.readFileSync(path.join(FIXTURES, 'sample.mp4')).copy(big, 0);
    const url = await uploadToFal(big, 'video/mp4', 'long.mp4');
    assert.match(url, /\/files\/[0-9a-f]+\/long\.mp4$/);
    const served = Buffer.from(await (await fetch(url)).arrayBuffer());
    assert.equal(served.length, big.length);
    assert.ok(served.equals(big));
    const parts = mock.state.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/upload-mp/'));
    assert.equal(parts.length, Math.ceil(big.length / (10 * 1024 * 1024)));
    assert.ok(parts.every((p) => p.auth === null));
});

// ── LLM ─────────────────────────────────────────────────────────────────────
const llm = (cookie, body) => call(llmRoute.POST, { method: 'POST', url: '/api/llm/chat', body, cookie, headers: sameOrigin });

test('llm chat (JSON): purpose picks the model, content comes back, cost is charged', async () => {
    freshState();
    const cookie = await login();
    const before = (await budget(cookie)).spentUsd;
    const res = await llm(cookie, { purpose: 'fast', messages: [{ role: 'user', content: 'make my prompt better' }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.content, 'Mock reply: make my prompt better');
    assert.equal(res.body.model, 'openai/gpt-6-luna');
    assert.equal(res.body.cost, 0.0001);
    const after = (await budget(cookie)).spentUsd;
    assert.equal(Math.round((after - before) * 1e6) / 1e6, 0.0001);
});

test('llm chat: json_schema replies are parsed; disallowed models and bad purposes are 400', async () => {
    freshState();
    const cookie = await login();
    const schema = { type: 'object', properties: { enhanced: { type: 'string' } }, required: ['enhanced'] };
    const res = await llm(cookie, { purpose: 'agent', messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_schema', json_schema: { name: 'enhance', schema } } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.json, { enhanced: 'mock enhanced' });
    assert.equal(res.body.model, 'anthropic/claude-sonnet-5');
    assert.equal((await llm(cookie, { model: 'openai/o1-pro', messages: [{ role: 'user', content: 'x' }] })).body.error, 'model_not_allowed');
    assert.equal((await llm(cookie, { purpose: 'admin', messages: [{ role: 'user', content: 'x' }] })).status, 400);
    assert.equal((await llm(cookie, { messages: [{ role: 'tool', content: 'x' }] })).status, 400);
    assert.equal((await llm(cookie, { messages: [] })).status, 400);
});

test('llm chat (SSE): the stream passes through and usage is charged when it ends', async () => {
    freshState();
    const cookie = await login(CODE_B);
    const before = (await budget(cookie)).spentUsd;
    const res = await llm(cookie, { purpose: 'fast', stream: true, messages: [{ role: 'user', content: 'stream please' }] });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    assert.equal(res.headers.get('x-aquora-model'), 'openai/gpt-6-luna');
    const text = res.body;
    const content = text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6))).map((c) => c.choices?.[0]?.delta?.content || '').join('');
    assert.equal(content, 'Mock reply: stream please');
    assert.match(text, /data: \[DONE\]/);
    await new Promise((r) => setTimeout(r, 20));
    const after = (await budget(cookie)).spentUsd;
    assert.equal(Math.round((after - before) * 1e6) / 1e6, 0.0001);
});

test('llm chat: upstream 5xx is retried twice, then 502 upstream_unavailable', async () => {
    freshState();
    const cookie = await login();
    const calls = mock.state.counters.chat;
    const res = await llm(cookie, { messages: [{ role: 'user', content: 'FAIL_LLM_500' }] });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'upstream_unavailable');
    assert.equal(mock.state.counters.chat - calls, 3);
});

// ── Estimates ───────────────────────────────────────────────────────────────
test('estimates: /api/v1/estimate and /api/app/calculate_dynamic_cost', async () => {
    freshState();
    const cookie = await login();
    const est = await call(estimateRoute.POST, { method: 'POST', url: '/api/v1/estimate', body: { model: 'flux-dev-image', payload: { num_images: 2 } }, cookie, headers: sameOrigin });
    assert.equal(est.status, 200);
    assert.deepEqual(est.body, { cost: 0.06, currency: 'USD', model: 'flux-dev-image' });
    const video = await call(costRoute.POST, { method: 'POST', url: '/api/app/calculate_dynamic_cost', body: { task_name: 'seedance-i2v', payload: { duration: 10 } }, cookie, headers: sameOrigin });
    assert.deepEqual(video.body, { cost: 1, currency: 'USD' });
    const unknown = await call(costRoute.POST, { method: 'POST', url: '/api/app/calculate_dynamic_cost', body: { task_name: 'passthrough-node', payload: {} }, cookie, headers: sameOrigin });
    assert.deepEqual(unknown.body, { cost: null, currency: 'USD' });
    assert.equal((await call(estimateRoute.POST, { method: 'POST', url: '/api/v1/estimate', body: { model: 'flux-dev-image' }, headers: sameOrigin })).status, 401);
});

// ── Real catalog smoke test ─────────────────────────────────────────────────
test('real catalog (when present): an enabled key submits and completes against the mock', async (t) => {
    let real;
    try {
        real = await import('../../lib/gateway/catalog/index.js');
    } catch {
        t.skip('lib/gateway/catalog/index.js not built yet');
        return;
    }
    const catalog = real.default && typeof real.getEntry !== 'function' ? real.default : real;
    const key = ['flux-2-dev', 'flux-dev-image', ...catalog.listAvailable().enabled].find((k) => catalog.getEntry(k)?.enabled && catalog.getEntry(k)?.kind === 'image');
    if (!key) {
        t.skip('no enabled image entry');
        return;
    }
    setCatalogForTesting(catalog);
    try {
        freshState();
        const cookie = await login();
        const res = await submit(cookie, key, { prompt: 'a turquoise lake at sunrise', aspect_ratio: '1:1', num_images: 1 });
        assert.equal(res.status, 200, `${key}: ${JSON.stringify(res.body)}`);
        const { final } = await pollUntilDone(cookie, res.body.request_id);
        assert.equal(final.status, 'completed');
        assert.ok(final.url);
    } finally {
        setCatalogForTesting(stubCatalog);
    }
});
