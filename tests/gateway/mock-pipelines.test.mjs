// Pipelines: registry, ctx (falCall / llm / emit / store / signal), the
// submit router's pipeline-first routing, agent result shapes and cancel —
// all against the local mock upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { jobEvents, listPipelines, loadPipeline, register, startPipelineJob, unregister } from '../../lib/gateway/pipelines/index.js';
import { decodeJobToken, resetJobs } from '../../lib/gateway/jobs.js';
import * as store from '../../lib/gateway/store.js';
import { OPEN_WORKSPACE } from '../../lib/gateway/session.js';

import * as submitRoute from '../../app/api/v1/[...path]/route.js';
import * as resultRoute from '../../app/api/v1/predictions/[token]/result/route.js';
import * as cancelRoute from '../../app/api/v1/predictions/[token]/cancel/route.js';
import * as estimateRoute from '../../app/api/v1/estimate/route.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-pipes-'));
// Open (dev) gate: every request without a cookie gets a fresh session, so
// these tests carry the minted cookie forward like a browser would.
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'pipeline-test-secret-'.padEnd(48, 'y'),
    AQUORA_LOG_LEVEL: 'silent',
    FAL_POLL_INTERVAL_MS: '20',
});
delete process.env.AQUORA_ACCESS_CODES;
delete process.env.NODE_ENV;

const ENTRIES = {
    'flux-dev-image': { key: 'flux-dev-image', enabled: true, fal: 'fal-ai/flux/dev', kind: 'image', est_usd: 0.04 },
};
setCatalogForTesting({
    getEntry: (key) => ENTRIES[key] || null,
    listAvailable: () => ({ enabled: Object.keys(ENTRIES), disabled: [] }),
    buildFalInput: (entry, payload) => ({ input: { ...payload } }),
    extractOutputs: () => ({ urls: [] }),
    estimateUsd: (entry) => entry.est_usd,
});

let mock;
test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 1 });
    applyMockEnv(mock);
});
test.after(async () => {
    resetJobs();
    await flushLedger();
    await mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => resetLimits());

const ORIGIN = 'http://localhost:3000';
const headers = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

async function call(handler, { method, url, body, cookie, params }) {
    const response = await handler(new Request(`${ORIGIN}${url}`, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
    const setCookie = response.headers.get('set-cookie');
    return { status: response.status, body: await response.json(), cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

const submit = (name, body, cookie) => call(submitRoute.POST, { method: 'POST', url: `/api/v1/${name}`, body, cookie, params: { path: [name] } });
const poll = (token, cookie) => call(resultRoute.GET, { method: 'GET', url: `/api/v1/predictions/${token}/result`, cookie, params: { token } });

async function until(token, cookie, done = (r) => r.body.status !== 'processing', max = 100) {
    for (let i = 0; i < max; i++) {
        const res = await poll(token, cookie);
        if (done(res)) return res;
        await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('pipeline did not finish');
}

test('POST /api/v1/<pipeline> runs the pipeline with falCall, llm, emit, progress and a workspace store', async () => {
    let seen;
    register('demo-pipe', async (ctx) => {
        seen = ctx;
        ctx.emit('info', { content: 'starting' });
        ctx.progress(10, 'Generating');
        const image = await ctx.falCall('flux-dev-image', { prompt: ctx.input.prompt });
        ctx.emit({ type: 'tool_result', payload: { asset: { url: image.url, kind: 'image' } } });
        const quick = await ctx.falCall({ endpoint: 'fal-ai/birefnet/v2' }, { image_url: image.url }, { sync: true });
        const reply = await ctx.llm({ purpose: 'fast', messages: [{ role: 'user', content: `caption ${ctx.input.prompt}` }] });
        await ctx.store.put('notes', 'last', { caption: reply.content });
        return { url: image.url, outputs: [image.url, quick.url], caption: reply.content };
    });
    assert.ok(listPipelines().includes('demo-pipe'));

    const start = await submit('demo-pipe', { prompt: 'a lighthouse' });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.status, 'processing');
    const token = start.body.request_id;
    const claims = decodeJobToken(token);
    assert.equal(claims.k, 'pipeline');
    assert.equal(claims.e, 'demo-pipe');

    const done = await until(token, start.cookie);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.request_id, token);
    assert.equal(done.body.url, `${mock.url}/media/sample.png`);
    assert.deepEqual(done.body.outputs, [`${mock.url}/media/sample.png`, `${mock.url}/media/sample.png`]);
    assert.equal(done.body.caption, 'Mock reply: caption a lighthouse');

    assert.equal(seen.cid, OPEN_WORKSPACE);
    assert.deepEqual(await store.forWorkspace(OPEN_WORKSPACE).get('notes', 'last'), { caption: 'Mock reply: caption a lighthouse' });
    const session = { sid: claims.sid, cid: OPEN_WORKSPACE };
    const log = await jobEvents({ jobId: claims.r, session, since: 0 });
    assert.deepEqual(log.events.map((e) => e.type), ['info', 'tool_result']);
    assert.equal(log.done, true);
    assert.deepEqual((await jobEvents({ jobId: claims.r, session, since: 1 })).events.map((e) => e.type), ['tool_result']);
    await assert.rejects(jobEvents({ jobId: claims.r, session: { sid: 'someone-else', cid: OPEN_WORKSPACE }, since: 0 }), (e) => e.status === 404);
    // Budget: two fal calls + the LLM cost were charged to the workspace.
    const spent = (await budgetStatus(OPEN_WORKSPACE)).spentUsd;
    assert.ok(spent >= 0.03 + 0.02, `spent ${spent}`);
    unregister('demo-pipe');
});

test('a pipeline name wins over a catalog key with the same name', async () => {
    register('flux-dev-image', async () => ({ url: 'https://v3.fal.media/pipeline.png' }));
    try {
        const start = await submit('flux-dev-image', { prompt: 'x' });
        const done = await until(start.body.request_id, start.cookie);
        assert.equal(done.body.url, 'https://v3.fal.media/pipeline.png');
    } finally {
        unregister('flux-dev-image');
    }
});

test('a failing fal call fails the pipeline with friendly copy and refunds that call', async () => {
    register('fails', async (ctx) => {
        await ctx.falCall('flux-dev-image', { prompt: 'FAIL_POLICY' });
        return {};
    });
    const before = (await budgetStatus(OPEN_WORKSPACE)).spentUsd;
    const start = await submit('fails', {});
    const done = await until(start.body.request_id, start.cookie);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'failed');
    assert.match(done.body.error, /safety filter/);
    assert.equal((await budgetStatus(OPEN_WORKSPACE)).spentUsd, before);
    unregister('fails');
});

test('validate() rejects bad input with 400 before any job starts; estimateUsd feeds /api/v1/estimate', async () => {
    register('validated', async () => ({}), {
        validate(input) {
            if (!input.video_url) throw Object.assign(new Error('video_url is required'), { status: 400, field: 'video_url' });
            return { video_url: input.video_url };
        },
        estimateUsd: () => 0.25,
    });
    const bad = await submit('validated', {});
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'video_url');
    const est = await call(estimateRoute.POST, { method: 'POST', url: '/api/v1/estimate', body: { model: 'validated', payload: {} }, cookie: bad.cookie });
    assert.equal(est.body.cost, 0.25);
    unregister('validated');
});

test('agent pipelines: completed → is_complete; failure → HTTP 400 {detail:{error}}', async () => {
    register('agent-ok', async (ctx) => ({ conversation_id: 'c1', messages: [{ role: 'assistant', content: `hi ${ctx.input.message}` }] }), { kind: 'agent' });
    register('agent-bad', async () => { throw new Error('boom'); }, { kind: 'agent' });
    const ok = await submit('agent-ok', { message: 'there' });
    assert.equal(ok.body.is_complete, false);
    const okDone = await until(ok.body.request_id, ok.cookie);
    assert.equal(okDone.status, 200);
    assert.equal(okDone.body.is_complete, true);
    assert.equal(okDone.body.messages[0].content, 'hi there');
    assert.equal(decodeJobToken(ok.body.request_id).k, 'agent');

    const bad = await submit('agent-bad', {}, ok.cookie);
    const badDone = await until(bad.body.request_id, ok.cookie, (r) => r.status === 400);
    assert.equal(badDone.status, 400);
    assert.equal(badDone.body.detail.error, 'Something went wrong on our side. Try again.', 'internal errors never leak');
    unregister('agent-ok');
    unregister('agent-bad');
});

test('cancel stops a running pipeline (signal aborted) and the poller sees "cancelled"', async () => {
    let aborted = false;
    register('slow', (ctx) => new Promise((resolve, reject) => {
        ctx.signal.addEventListener('abort', () => { aborted = true; reject(ctx.signal.reason); });
    }));
    const start = await submit('slow', {});
    const cancel = await call(cancelRoute.POST, { method: 'POST', url: '/x', cookie: start.cookie, params: { token: start.body.request_id } });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, 'cancelled');
    assert.equal(aborted, true);
    const after = await poll(start.body.request_id, start.cookie);
    assert.equal(after.body.status, 'cancelled');
    unregister('slow');
});

test('startPipelineJob is usable by other routes; the job survives a registry wipe once finished', async () => {
    register('quick', async (ctx) => ({ echo: ctx.input.value }));
    const session = { sid: 'route-session-1', cid: 'wsx' };
    const { token } = await startPipelineJob({ name: 'quick', input: { value: 42 }, session });
    await new Promise((r) => setTimeout(r, 30));
    resetJobs();
    const claims = decodeJobToken(token);
    const { pollPipelineJob } = await import('../../lib/gateway/pipelines/index.js');
    const persisted = await pollPipelineJob(claims, token, session);
    assert.equal(persisted.status, 200);
    assert.equal(persisted.body.status, 'completed');
    assert.equal(persisted.body.echo, 42);
    await assert.rejects(pollPipelineJob(claims, token, { sid: 'other-session', cid: 'wsx' }), (e) => e.status === 404);
    unregister('quick');
});

test('unknown names fall through to the catalog; lazy loading caches misses', async () => {
    assert.equal(await loadPipeline('definitely-not-a-pipeline'), null);
    assert.equal(await loadPipeline('../index'), null);
    assert.equal(await loadPipeline('index'), null);
    const res = await submit('definitely-not-a-pipeline', {});
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'unknown_model');
});
