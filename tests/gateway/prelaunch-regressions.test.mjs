import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { storageKind } from '../../lib/gateway/config.js';
import { cancelFalJob, pollFalJob, resetGenerationCache, submitCatalogJob, validateMediaInputs } from '../../lib/gateway/generation.js';
import { decodeJobToken } from '../../lib/gateway/jobs.js';
import { budgetStatus, flushLedger, jobsInFlight, reserveBudget, resetLimits } from '../../lib/gateway/limits.js';
import { IDEMPOTENCY_TTL_MS, MAX_IDEMPOTENCY_ENTRIES, idempotentSubmit, resetIdempotency } from '../../lib/gateway/idempotency.js';
import { resetPricingCache } from '../../lib/gateway/pricing.js';
import { handleSubmit } from '../../lib/gateway/router.js';
import { chat } from '../../lib/gateway/openrouter.js';

// Every provider URL points at this loopback server. No real generation,
// provider account, or production data is used by these regressions.
let server;
let base;
let dataDir;
const dirs = [];
const observed = { submits: 0, cancels: 0, chats: 0, cancelStatus: 202, state: 'IN_PROGRESS' };
const session = { sid: 'launch-session-123', cid: 'launch-workspace' };
const payload = { prompt: 'A test image' };
const catalog = {
    getEntry(key) { return key === 'launch-test' ? { key, enabled: true, fal: 'test/model', kind: 'image', est_usd: 0.1 } : null; },
    buildFalInput(entry, input) { return { endpoint: entry.fal, input }; },
    estimateUsd() { return 0.1; },
};
const response = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

test.before(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://test');
        if (url.pathname === '/or/chat/completions') {
            observed.chats += 1;
            req.resume();
            return response(res, 200, { choices: [{ message: { content: 'Local test reply' } }], usage: { cost: 0.001 } });
        }
        if (url.pathname.includes('/models/pricing')) return response(res, 200, { prices: [] });
        if (url.pathname.endsWith('/status')) return response(res, 200, { status: observed.state });
        if (url.pathname.endsWith('/cancel')) { observed.cancels += 1; return response(res, observed.cancelStatus, {}); }
        if (url.pathname.includes('/requests/')) return response(res, 200, { image: { url: 'https://v3.fal.media/files/local-test.png' } });
        if (req.method === 'POST' && url.pathname === '/q/test/model') {
            observed.submits += 1;
            const id = `test-request-${observed.submits}`;
            const prefix = `${base}/q/test/model/requests/${id}`;
            req.resume();
            return response(res, 200, { request_id: id, status_url: `${prefix}/status`, response_url: prefix, cancel_url: `${prefix}/cancel` });
        }
        return response(res, 404, {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, { FAL_KEY: 'local-only-test', FAL_QUEUE_BASE: `${base}/q`, FAL_API_BASE: `${base}/api`, OPENROUTER_API_KEY: 'local-only-test', OPENROUTER_BASE_URL: `${base}/or`, AQUORA_SESSION_SECRET: 'prelaunch-test-secret-'.padEnd(48, 's'), AQUORA_LOG_LEVEL: 'silent' });
});

test.beforeEach(async () => {
    await flushLedger();
    resetLimits();
    resetPricingCache();
    resetGenerationCache();
    resetIdempotency();
    setCatalogForTesting(catalog);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-prelaunch-'));
    dirs.push(dataDir);
    Object.assign(process.env, { AQUORA_DATA_DIR: dataDir, AQUORA_SESSION_DAILY_BUDGET_USD: '10', AQUORA_DAILY_BUDGET_USD: '100' });
    Object.assign(observed, { submits: 0, cancels: 0, chats: 0, cancelStatus: 202, state: 'IN_PROGRESS' });
});

test.after(async () => {
    await flushLedger();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

test('concurrent reservations cannot exceed the workspace budget', async () => {
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '1';
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserveBudget({ cid: session.cid, usd: 0.2, jobId: `workspace-race-${i}` })));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 5);
    assert.equal(results.filter((item) => item.status === 'rejected' && item.reason.code === 'budget_exceeded').length, 5);
    assert.equal((await budgetStatus(session.cid)).spentUsd, 1);
});

test('concurrent reservations across workspaces cannot exceed the global budget', async () => {
    process.env.AQUORA_DAILY_BUDGET_USD = '1';
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserveBudget({ cid: `workspace-${i}`, usd: 0.2, jobId: `global-race-${i}` })));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 5);
    assert.equal((await budgetStatus('workspace-0')).globalSpentUsd, 1);
});

test('a fifth concurrent generation is refused without reserving budget', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => submitCatalogJob({ key: 'launch-test', payload, session })));
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 4);
    assert.equal(results.find((item) => item.status === 'rejected').reason.code, 'too_many_jobs');
    assert.equal(observed.submits, 4);
    assert.equal(jobsInFlight(session.sid), 4);
    assert.equal((await budgetStatus(session.cid)).spentUsd, 0.4);
});

test('a refused budget reservation releases the generation slot', async () => {
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0.05';
    await assert.rejects(submitCatalogJob({ key: 'launch-test', payload, session }), (error) => error.code === 'budget_exceeded');
    assert.equal(jobsInFlight(session.sid), 0);
    assert.equal(observed.submits, 0);
});

test('a failed provider cancellation remains pollable and keeps its slot', async () => {
    const started = await submitCatalogJob({ key: 'launch-test', payload, session });
    const claims = decodeJobToken(started.request_id);
    observed.cancelStatus = 500;
    const cancelled = await cancelFalJob(claims, started.request_id);
    assert.equal(cancelled.status, 'processing');
    assert.equal(cancelled.cancelled, false);
    assert.equal(jobsInFlight(session.sid), 1);
    assert.equal((await budgetStatus(session.cid)).spentUsd, 0.1);
    observed.state = 'COMPLETED';
    const done = await pollFalJob(claims, started.request_id);
    assert.equal(done.status, 'completed');
    assert.equal(jobsInFlight(session.sid), 0);
});

test('an accepted queued cancellation refunds exactly once', async () => {
    observed.state = 'IN_QUEUE';
    const started = await submitCatalogJob({ key: 'launch-test', payload, session });
    const claims = decodeJobToken(started.request_id);
    assert.equal((await cancelFalJob(claims, started.request_id)).refunded, true);
    assert.equal((await budgetStatus(session.cid)).spentUsd, 0);
    await cancelFalJob(claims, started.request_id);
    assert.equal(observed.cancels, 1);
});

function submitRequest(key, value = payload) {
    return new Request('http://localhost:3000/api/v1/launch-test', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(value) });
}

test('concurrent generation retries with the same key return one job and one charge', async () => {
    const ctx = { params: { path: ['launch-test'] }, session };
    const responses = await Promise.all([handleSubmit(submitRequest('launch-key-001'), ctx), handleSubmit(submitRequest('launch-key-001'), ctx)]);
    const replies = await Promise.all(responses.map((item) => item.json()));
    assert.equal(replies[0].request_id, replies[1].request_id);
    assert.deepEqual(responses.map((item) => item.headers.get('idempotency-replayed')).sort(), ['false', 'true']);
    assert.equal(observed.submits, 1);
    assert.equal((await budgetStatus(session.cid)).spentUsd, 0.1);
    await assert.rejects(handleSubmit(submitRequest('launch-key-001', { prompt: 'Changed' }), ctx), (error) => error.status === 409 && error.code === 'idempotency_conflict');
    assert.equal(observed.submits, 1);
});

test('invalid idempotency keys are refused before any provider call', async () => {
    const ctx = { params: { path: ['launch-test'] }, session };
    for (const key of ['', 'short', 'bad key 123', 'x'.repeat(129)]) {
        await assert.rejects(handleSubmit(submitRequest(key), ctx), (error) => error.code === 'invalid_idempotency_key');
    }
    assert.equal(observed.submits, 0);
});

test('idempotency treats object order as equivalent and isolates sessions', async () => {
    let calls = 0;
    const call = (sid, value) => idempotentSubmit({ key: 'launch-key-ordered', cid: session.cid, sid, name: 'test', payload: value }, () => ({ call: ++calls }));
    assert.equal((await call(session.sid, { a: 1, b: 2 })).body.call, 1);
    assert.equal((await call(session.sid, { b: 2, a: 1 })).body.call, 1);
    assert.equal((await call('other-session', { b: 2, a: 1 })).body.call, 2);
});

test('an uncertain failed submission is retained for same-key retries', async () => {
    let calls = 0;
    const options = { key: 'launch-key-failed', cid: session.cid, sid: session.sid, name: 'test', payload };
    const fail = (markStarted) => { markStarted(); calls += 1; throw new Error('Lost upstream response'); };
    await assert.rejects(idempotentSubmit(options, fail));
    await assert.rejects(idempotentSubmit(options, fail));
    assert.equal(calls, 1);
});

test('clean pre-provider rejections cannot poison the global idempotency capacity', async () => {
    const ctx = { params: { path: ['missing-test-model'] }, session };
    for (let i = 0; i < MAX_IDEMPOTENCY_ENTRIES + 1; i++) {
        await assert.rejects(handleSubmit(submitRequest(`launch-rejected-${i}`), ctx), (error) => error.code === 'unknown_model');
    }
    const valid = await handleSubmit(submitRequest('launch-after-rejections'), { ...ctx, params: { path: ['launch-test'] } });
    assert.equal((await valid.json()).status, 'processing');
    assert.equal(observed.submits, 1);
});

test('a clean budget rejection can be retried after funding is restored', async () => {
    const ctx = { params: { path: ['launch-test'] }, session };
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0';
    await assert.rejects(handleSubmit(submitRequest('launch-budget-retry'), ctx), (error) => error.code === 'budget_exceeded');
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '10';
    const retry = await handleSubmit(submitRequest('launch-budget-retry'), ctx);
    assert.equal((await retry.json()).status, 'processing');
    assert.equal(observed.submits, 1);
});

test('idempotency entries expire after 24 hours and the cache is bounded', async (t) => {
    const start = Date.now();
    let now = start;
    t.mock.method(Date, 'now', () => now);
    const options = { key: 'launch-key-expiring', cid: session.cid, sid: session.sid, name: 'test', payload };
    let calls = 0;
    const submit = () => ({ call: ++calls });
    await idempotentSubmit(options, submit);
    now += IDEMPOTENCY_TTL_MS + 1;
    assert.equal((await idempotentSubmit(options, submit)).body.call, 2);
    resetIdempotency();
    for (let i = 0; i < MAX_IDEMPOTENCY_ENTRIES; i++) await idempotentSubmit({ ...options, key: `launch-bounded-${i}` }, submit);
    await assert.rejects(idempotentSubmit({ ...options, key: 'launch-key-extra' }, submit), (error) => error.code === 'request_capacity');
});

test('a Railway data directory is persistent only inside a mounted volume', () => {
    const saved = { environment: process.env.RAILWAY_ENVIRONMENT, volume: process.env.RAILWAY_VOLUME_MOUNT_PATH };
    process.env.RAILWAY_ENVIRONMENT = 'production';
    try {
        delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
        assert.equal(storageKind(), 'ephemeral');
        process.env.RAILWAY_VOLUME_MOUNT_PATH = path.dirname(dataDir);
        assert.equal(storageKind(), 'persistent');
        process.env.RAILWAY_VOLUME_MOUNT_PATH = `${dataDir}-another-volume`;
        assert.equal(storageKind(), 'ephemeral');
    } finally {
        for (const [key, value] of [['RAILWAY_ENVIRONMENT', saved.environment], ['RAILWAY_VOLUME_MOUNT_PATH', saved.volume]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('deeply nested media input cannot bypass URL validation', async () => {
    let input = { image_url: 'http://127.0.0.1/private.png' };
    for (let i = 0; i < 7; i++) input = { reference: input };
    await assert.rejects(validateMediaInputs(input), (error) => error.status === 400);
    assert.equal(observed.submits, 0);
});

test('OpenRouter vision rejects private HTTPS URLs before the provider call', async () => {
    const messages = (url) => [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }];
    // 127.0.0.1 is intentionally trusted by our explicit local provider base;
    // other private/loopback destinations must still be refused.
    for (const url of ['https://10.0.0.1/private.png', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/private.png', 'https://localhost/private.png']) {
        await assert.rejects(chat({ messages: messages(url) }), (error) => error.status === 400 && error.llmNotBilled === true);
    }
    assert.equal(observed.chats, 0);
    assert.equal((await chat({ messages: messages('https://v3.fal.media/files/test.png') })).content, 'Local test reply');
    assert.equal(observed.chats, 1);
});
