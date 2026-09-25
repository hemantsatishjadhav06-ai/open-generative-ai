// Security regressions: spend controls.
//   - LLM calls reserve a worst case before they are sent and settle to
//     usage.cost; aborting a request never makes a call free.
//   - runFal keeps the debit for a job fal already ran (cancel / abort /
//     timeout after IN_PROGRESS) and refunds only when fal did no work.
//   - estimates are priced from the input fal receives.
//   - AI Clipping only takes this workspace's uploads, priced by length.
//   - a catalog key containing '/' is still a catalog key (schema allowlist).
// Fake fal / OpenRouter servers here give precise control over timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { runFal } from '../../lib/gateway/generation.js';
import { llmCeilingUsd, meteredChat, resetLlmPrices } from '../../lib/gateway/llmBudget.js';
import { resetPricingCache } from '../../lib/gateway/pricing.js';
import { estimateCost } from '../../lib/gateway/router.js';
import { createSessionCookie } from '../../lib/gateway/session.js';
import { falTarget, register, startPipelineJob, unregister } from '../../lib/gateway/pipelines/index.js';
import { estimateClippingUsd, maxClippingSeconds, validateClippingInput } from '../../lib/gateway/pipelines/clipping.js';
import { resetJobs } from '../../lib/gateway/jobs.js';
import { recordUpload } from '../../lib/gateway/uploads.js';
import * as llmRoute from '../../app/api/llm/chat/route.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-sec-billing-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'security-billing-secret-'.padEnd(48, 's'),
    AQUORA_LOG_LEVEL: 'silent',
    AQUORA_SESSION_DAILY_BUDGET_USD: '10',
    AQUORA_DAILY_BUDGET_USD: '100',
    FAL_KEY: 'test-fal',
    OPENROUTER_API_KEY: 'test-or',
    FAL_POLL_INTERVAL_MS: '10',
});
delete process.env.AQUORA_ACCESS_CODES;
delete process.env.NODE_ENV;
setCatalogForTesting(null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = 'http://localhost:3000';
const sameOrigin = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin' };
const LLM_COST = 0.004;

// ── fake upstreams ──────────────────────────────────────────────────────────
const upstream = {
    chat: 0,
    fal: { submits: [], cancels: 0, statusPolls: 0, state: {}, next: 'IN_QUEUE' },
};

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

let server;
let base;

async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
    };
    // OpenRouter
    if (url.pathname === '/or/models') {
        return send(200, { data: [{ id: 'openai/gpt-6-luna', pricing: { prompt: '0.000001', completion: '0.00001' } }] });
    }
    if (url.pathname === '/or/chat/completions') {
        upstream.chat += 1;
        const body = JSON.parse(await readBody(req));
        const text = String(body.messages.at(-1)?.content || '');
        if (text.includes('ERR400')) return send(400, { error: { code: 400, message: 'bad request' } });
        const usage = { prompt_tokens: 10, completion_tokens: 20, cost: LLM_COST };
        if (body.stream) {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            for (let i = 0; i < 20; i++) {
                if (res.destroyed) return;
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `w${i} ` } }] })}\n\n`);
                await sleep(20);
            }
            res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
            return res.end('data: [DONE]\n\n');
        }
        await sleep(text.includes('SLOW') ? 250 : 0);
        return send(200, { model: body.model, choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage });
    }
    // fal queue
    const queue = url.pathname.match(/^\/q\/(.+)$/);
    if (queue) {
        const rest = queue[1];
        const reqMatch = rest.match(/^([^/]+\/[^/]+)\/requests\/([^/]+)(\/status|\/cancel)?$/);
        if (reqMatch) {
            const [, , id, tail] = reqMatch;
            if (tail === '/status') {
                upstream.fal.statusPolls += 1;
                const s = upstream.fal.state[id] || 'IN_QUEUE';
                return send(200, s === 'FAILED' ? { status: 'COMPLETED', error: 'boom', error_type: 'internal_server_error' } : { status: s });
            }
            if (tail === '/cancel') {
                upstream.fal.cancels += 1;
                return send(202, { status: 'CANCELLATION_REQUESTED' });
            }
            return send(200, { audio: { url: 'https://v3.fal.media/files/out.wav' }, video: { url: 'https://v3.fal.media/files/out.mp4' } });
        }
        const input = JSON.parse(await readBody(req) || '{}');
        const id = `r${upstream.fal.submits.length + 1}`;
        upstream.fal.submits.push({ endpoint: rest, input });
        upstream.fal.state[id] = upstream.fal.next;
        const [owner, alias] = rest.split('/');
        const prefix = `${base}/q/${owner}/${alias}/requests/${id}`;
        return send(200, { request_id: id, status_url: `${prefix}/status`, response_url: prefix, cancel_url: `${prefix}/cancel` });
    }
    const run = url.pathname.match(/^\/run\/(.+)$/);
    if (run) {
        const input = JSON.parse(await readBody(req) || '{}');
        if (input.prompt === 'E422') return send(422, { detail: [{ type: 'value_error', msg: 'bad', loc: ['body', 'prompt'] }] });
        if (input.prompt === 'E500') return send(500, { detail: 'runner crashed' });
        return send(200, { image: { url: 'https://v3.fal.media/files/x.png' } });
    }
    return send(404, { detail: 'not found' });
}

test.before(async () => {
    server = http.createServer((req, res) => { handle(req, res).catch(() => res.destroy()); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, {
        OPENROUTER_BASE_URL: `${base}/or`,
        FAL_QUEUE_BASE: `${base}/q`,
        FAL_RUN_BASE: `${base}/run`,
        FAL_API_BASE: `${base}/api`,
        FAL_REST_BASE: `${base}/rest`,
    });
});
test.after(async () => {
    resetJobs();
    await flushLedger();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => {
    resetLimits();
    resetLlmPrices();
    resetPricingCache();
});

let wsCounter = 0;
const workspace = () => `sec-ws-${++wsCounter}-${process.pid}`;
const spent = async (cid) => (await budgetStatus(cid)).spentUsd;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

function llmRequest(cid, body, signal) {
    const cookie = `aquora_session=${createSessionCookie({ codeId: cid }).value}`;
    return new Request(`${ORIGIN}/api/llm/chat`, {
        method: 'POST',
        headers: { ...sameOrigin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
}

// ── H1: LLM spend ───────────────────────────────────────────────────────────
test('LLM: the worst case is reserved while the call runs, then settled to usage.cost', async () => {
    const cid = workspace();
    const options = { purpose: 'fast', max_tokens: 1000, messages: [{ role: 'user', content: 'SLOW hello' }] };
    const ceiling = await llmCeilingUsd(options);
    assert.ok(ceiling > LLM_COST, `ceiling ${ceiling} covers the reply`);
    const pending = meteredChat({ cid, ...options });
    await sleep(80);
    near(await spent(cid), ceiling, 'reserved during the call');
    await pending;
    near(await spent(cid), LLM_COST, 'settled to the real cost');
});

test('LLM: aborting a non-streamed /api/llm/chat request still charges the call', async () => {
    const cid = workspace();
    const controller = new AbortController();
    const before = upstream.chat;
    const reply = llmRoute.POST(llmRequest(cid, { purpose: 'fast', max_tokens: 500, messages: [{ role: 'user', content: 'SLOW abort me' }] }, controller.signal), {});
    await sleep(40);
    controller.abort();
    await reply;
    await sleep(20);
    assert.equal(upstream.chat, before + 1, 'the call reached OpenRouter');
    near(await spent(cid), LLM_COST, 'charged its real cost although the client left');
});

test('LLM: a stream cut before the usage chunk keeps the reservation (never free)', async () => {
    const cid = workspace();
    const controller = new AbortController();
    const body = { purpose: 'agent', stream: true, max_tokens: 4000, messages: [{ role: 'user', content: 'stream please' }] };
    const res = await llmRoute.POST(llmRequest(cid, body, controller.signal), {});
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    await reader.read();
    await reader.cancel();
    controller.abort();
    await sleep(80);
    const now = await spent(cid);
    assert.ok(now > 0, 'budget moved');
    near(now, await llmCeilingUsd({ purpose: 'agent', max_tokens: 4000, messages: body.messages }), 'the worst case is kept');
});

test('LLM: a completed stream settles to usage.cost; an upstream 400 is refunded', async () => {
    const cid = workspace();
    const res = await llmRoute.POST(llmRequest(cid, { purpose: 'fast', stream: true, max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }), {});
    await res.text();
    await sleep(30);
    near(await spent(cid), LLM_COST, 'full stream settles');
    const bad = await llmRoute.POST(llmRequest(cid, { purpose: 'fast', messages: [{ role: 'user', content: 'ERR400' }] }), {});
    assert.equal(bad.status, 400);
    near(await spent(cid), LLM_COST, 'rejected call refunded');
});

test('LLM: a call whose worst case does not fit the budget is refused before it is sent', async () => {
    const cid = workspace();
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0.01';
    try {
        const before = upstream.chat;
        const res = await llmRoute.POST(llmRequest(cid, { purpose: 'agent', max_tokens: 4000, messages: [{ role: 'user', content: 'x'.repeat(100_000) }] }), {});
        assert.equal(res.status, 402);
        assert.equal((await res.json()).error, 'budget_exceeded');
        assert.equal(upstream.chat, before, 'nothing reached OpenRouter');
    } finally {
        process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '10';
    }
});

// ── H3: runFal refunds ──────────────────────────────────────────────────────
async function runWith(state, { abortAfterPolls = 2, ...extra } = {}) {
    const cid = workspace();
    upstream.fal.next = state;
    const controller = new AbortController();
    const polls = upstream.fal.statusPolls;
    const cancels = upstream.fal.cancels;
    const job = runFal({ endpoint: 'test/model', input: { prompt: 'x' }, session: { sid: 'sid-sec', cid }, signal: controller.signal, estUsd: 1, ...extra });
    job.catch(() => {});
    if (abortAfterPolls) {
        while (upstream.fal.statusPolls < polls + abortAfterPolls) await sleep(5);
        controller.abort(Object.assign(new Error('cancelled'), { status: 499, code: 'cancelled' }));
    }
    await assert.rejects(job);
    await sleep(10);
    return { spent: await spent(cid), cancels: upstream.fal.cancels - cancels };
}

test('runFal: cancelling a job fal is already running keeps the debit (and still cancels it)', async () => {
    const out = await runWith('IN_PROGRESS');
    near(out.spent, 1, 'debit kept');
    assert.equal(out.cancels, 1, 'fal cancel sent');
});

test('runFal: cancelling a job that is still queued refunds it', async () => {
    const out = await runWith('IN_QUEUE');
    near(out.spent, 0, 'refunded');
    assert.equal(out.cancels, 1);
});

test('runFal: a timeout while running keeps the debit; a terminal failure is refunded', async () => {
    const timedOut = await runWith('IN_PROGRESS', { abortAfterPolls: 0, timeoutMs: 80 });
    near(timedOut.spent, 1, 'timeout keeps the debit');
    const failed = await runWith('FAILED', { abortAfterPolls: 0 });
    near(failed.spent, 0, 'fal-reported failure refunded');
});

test('runFal (sync): a 4xx rejection is refunded, a 5xx keeps the debit', async () => {
    for (const [prompt, expected] of [['E422', 0], ['E500', 1]]) {
        const cid = workspace();
        await assert.rejects(runFal({ endpoint: 'test/sync', sync: true, input: { prompt }, session: { sid: 'sid-sync', cid }, estUsd: 1 }));
        near(await spent(cid), expected, prompt);
    }
});

// ── M: estimates from the built fal input ───────────────────────────────────
test('estimates use the input fal receives (fixed duration, num_frames, 4K)', async () => {
    const image = 'https://v3.fal.media/files/a.png';
    // Veo is fixed to 8 s with audio: asking for 4 s must not halve the price.
    const veo4 = await estimateCost('veo3-image-to-video', { prompt: 'x', image_url: image, duration: '4s' });
    const veo8 = await estimateCost('veo3-image-to-video', { prompt: 'x', image_url: image, duration: '8s' });
    assert.equal(veo4, veo8);
    assert.ok(veo8 >= 0.64 * 1.5 - 1e-9, `8 s with audio (${veo8})`);
    const frames = await estimateCost('seedance-lite-t2v', { prompt: 'x', num_frames: 289 });
    const fiveSeconds = await estimateCost('seedance-lite-t2v', { prompt: 'x', duration: 5 });
    assert.ok(frames >= fiveSeconds * 2.3, `289 frames ≈ 12 s (${frames} vs ${fiveSeconds})`);
    const k1 = await estimateCost('nano-banana-pro', { prompt: 'x', resolution: '1K' });
    const k4 = await estimateCost('nano-banana-pro', { prompt: 'x', resolution: '4K' });
    assert.ok(k4 > k1, `4K (${k4}) costs more than 1K (${k1})`);
});

// ── M: clipping transcription ──────────────────────────────────────────────
test('clipping: only this workspace\'s uploads are accepted, priced and capped by length', async () => {
    const cid = workspace();
    const session = { sid: 'sid-clip', cid };
    const url = 'https://v3.fal.media/files/talk.mp4';
    await assert.rejects(validateClippingInput({ video_url: 'https://example.com/four-hours.mp4' }, { session }), (e) => e.status === 400 && e.code === 'upload_required');
    await assert.rejects(validateClippingInput({ video_url: url }, { session }), (e) => e.code === 'upload_required', 'not uploaded by this workspace');
    await recordUpload(cid, { url, bytes: 150 * 1024 * 1024, mime: 'video/mp4', kind: 'video', seconds: 3600 });
    await assert.rejects(validateClippingInput({ video_url: url }, { session: { sid: 'x', cid: workspace() } }), (e) => e.code === 'upload_required', 'another workspace');
    const hour = await validateClippingInput({ video_url: url, return_coordinates_only: true }, { session });
    assert.equal(hour.media_seconds, 3600);
    const short = estimateClippingUsd({ ...hour, media_seconds: 60 });
    const long = estimateClippingUsd(hour);
    assert.ok(long >= short + 0.3, `an hour of media costs more to transcribe (${short} → ${long})`);
    const long2 = 'https://v3.fal.media/files/long.mp4';
    await recordUpload(cid, { url: long2, bytes: 1_000_000, mime: 'video/mp4', kind: 'video', seconds: maxClippingSeconds() + 60 });
    await assert.rejects(validateClippingInput({ video_url: long2 }, { session }), (e) => e.code === 'video_too_long');
    // Without a container duration the size gives a conservative length.
    const noDuration = 'https://v3.fal.media/files/unknown.webm';
    await recordUpload(cid, { url: noDuration, bytes: 190 * 1024 * 1024, mime: 'video/webm', kind: 'video', seconds: null });
    const guessed = await validateClippingInput({ video_url: noDuration }, { session });
    assert.ok(guessed.media_seconds > 3000);
});

// ── L: catalog keys with '/' ────────────────────────────────────────────────
test('falCall: a string is always a catalog key, so slash keys keep the schema allowlist', async () => {
    assert.deepEqual(falTarget('mmaudio-v2/text-to-audio'), { key: 'mmaudio-v2/text-to-audio' });
    assert.deepEqual(falTarget({ endpoint: 'fal-ai/whisper' }), { endpoint: 'fal-ai/whisper' });
    assert.throws(() => falTarget(42));
    upstream.fal.next = 'COMPLETED';
    const seen = [];
    register('sec-slash', async (ctx) => {
        const ok = await ctx.falCall('mmaudio-v2/text-to-audio', { prompt: 'rain', injected_field: 'x', num_steps: 9999 });
        seen.push(ok.url);
        try {
            await ctx.falCall('fal-ai/some/raw-endpoint', { prompt: 'x' });
            seen.push('raw endpoint reached');
        } catch (error) {
            seen.push(error.code);
        }
        return { outputs: [] };
    });
    try {
        const cid = workspace();
        const before = upstream.fal.submits.length;
        const { job } = await startPipelineJob({ name: 'sec-slash', input: {}, session: { sid: 'sid-slash', cid } });
        while (job.status === 'processing') await sleep(10);
        assert.equal(job.status, 'completed', job.error);
        const submits = upstream.fal.submits.slice(before);
        assert.equal(submits.length, 1, 'only the catalog call reached fal');
        assert.equal(submits[0].endpoint, 'fal-ai/mmaudio-v2/text-to-audio', "the catalog's fal endpoint, not the key");
        assert.equal('injected_field' in submits[0].input, false, 'unknown fields dropped');
        assert.ok(submits[0].input.num_steps <= 50, `num_steps clamped (${submits[0].input.num_steps})`);
        assert.deepEqual(seen.slice(1), ['unknown_model'], 'a non-catalog string is not treated as a raw endpoint');
    } finally {
        unregister('sec-slash');
    }
});
