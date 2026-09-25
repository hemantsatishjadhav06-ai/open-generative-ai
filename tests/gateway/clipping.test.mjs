// AI Clipping pipeline ('ai-clipping'): transcript parsing, highlight
// selection (snapping, bounds, overlap), the full job through the submit and
// poll routes against the local mock upstream (fal whisper → OpenRouter JSON
// → fal trim + centre crop), timecodes-only mode, and the fallbacks when a
// fal step is unavailable (driven with a stub context).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { GatewayError } from '../../lib/gateway/errors.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { resetJobs } from '../../lib/gateway/jobs.js';
import { createSessionCookie } from '../../lib/gateway/session.js';
import { recordUpload } from '../../lib/gateway/uploads.js';
import {
    FRAME_SIZES,
    SCALE_ENDPOINT,
    TRANSCRIBE_ENDPOINT,
    TRIM_ENDPOINT,
    estimateClippingUsd,
    parseTranscript,
    reframeAvailable,
    registerClipping,
    resetClippingState,
    runClipping,
    selectHighlights,
    transcriptForModel,
    validateClippingInput,
} from '../../lib/gateway/pipelines/clipping.js';

import * as submitRoute from '../../app/api/v1/[...path]/route.js';
import * as resultRoute from '../../app/api/v1/predictions/[token]/result/route.js';
import * as estimateRoute from '../../app/api/v1/estimate/route.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-clipping-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'clipping-test-secret-'.padEnd(48, 'c'),
    AQUORA_LOG_LEVEL: 'silent',
    FAL_POLL_INTERVAL_MS: '10',
});
delete process.env.AQUORA_ACCESS_CODES;
delete process.env.AQUORA_SESSION_DAILY_BUDGET_USD;
delete process.env.NODE_ENV;
setCatalogForTesting(null);

let mock;
test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 1 });
    applyMockEnv(mock);
    registerClipping();
    // AI Clipping only accepts this workspace's own uploads (length known).
    await recordUpload('open', { url: media('sample.mp4'), bytes: 10_000, mime: 'video/mp4', kind: 'video', seconds: 1 });
});
test.after(async () => {
    resetJobs();
    await flushLedger();
    await mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => {
    resetLimits();
    resetClippingState();
});

const ORIGIN = 'http://localhost:3000';
const HEADERS = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const COOKIE = `aquora_session=${createSessionCookie({ codeId: 'open' }).value}`;

async function call(handler, { method = 'GET', url, body, params }) {
    const response = await handler(new Request(`${ORIGIN}${url}`, {
        method,
        headers: { ...HEADERS, cookie: COOKIE },
        body: body === undefined ? undefined : JSON.stringify(body),
    }), { params: Promise.resolve(params) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}

const submit = (body) => call(submitRoute.POST, { method: 'POST', url: '/api/v1/ai-clipping', body, params: { path: ['ai-clipping'] } });
const poll = (token) => call(resultRoute.GET, { url: `/api/v1/predictions/${token}/result`, params: { token } });

async function finish(token, max = 600) {
    for (let i = 0; i < max; i++) {
        const res = await poll(token);
        if (res.status !== 200 || res.body.status !== 'processing') return res;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('clipping job did not finish');
}

const media = (name) => `${mock.url}/media/${name}`;

async function mockRequests() {
    const state = await fetch(`${mock.url}/__mock/state`).then((r) => r.json());
    return state.requests;
}

// Stub pipeline context for the fallback paths.
function stubContext({ input, transcript, highlights, onFal = () => null }) {
    const calls = [];
    const events = [];
    return {
        calls,
        events,
        input,
        signal: new AbortController().signal,
        progress: (pct, message) => events.push({ pct, message }),
        emit: () => null,
        async falCall(target, falInput) {
            const endpoint = typeof target === 'string' ? target : target.endpoint || target.key;
            calls.push({ endpoint, input: falInput });
            const override = await onFal(endpoint, falInput, calls.length);
            if (override) return override;
            if (endpoint === TRANSCRIBE_ENDPOINT) return { output: transcript };
            return { video: { url: `https://v3.fal.media/files/${endpoint.split('/').pop()}-${calls.length}.mp4` }, outputs: [`https://v3.fal.media/files/${endpoint.split('/').pop()}-${calls.length}.mp4`] };
        },
        llmCalls: [],
        async llm(options) {
            this.llmCalls.push(options);
            return { content: JSON.stringify({ highlights }), tool_calls: [], usage: { cost: 0 } };
        },
    };
}

const LONG_TRANSCRIPT = {
    text: 'long talk',
    chunks: [
        { timestamp: [0, 12.4], text: 'Intro and welcome.' },
        { timestamp: [12.4, 31], text: 'Here is the surprising thing nobody tells you.' },
        { timestamp: [31, 58.2], text: 'It changed how I work forever.' },
        { timestamp: [58.2, 80], text: 'Now the second story.' },
        { timestamp: [80, 118.5], text: 'The punchline lands right here.' },
        { timestamp: [118.5, null], text: 'Thanks for watching and see you next time.' },
    ],
};

// ── pure helpers ────────────────────────────────────────────────────────────
test('parseTranscript: whisper chunks and segments, null ends, junk dropped, sorted', () => {
    const parsed = parseTranscript(LONG_TRANSCRIPT);
    assert.equal(parsed.length, 6);
    assert.deepEqual(parsed[0], { start: 0, end: 12.4, text: 'Intro and welcome.' });
    assert.ok(parsed[5].end > 118.5, 'a missing end gets an estimate');
    assert.deepEqual(parseTranscript({ segments: [{ start: 5, end: 6, text: ' b ' }, { start: 1, end: 2, text: 'a' }, { start: 'x', text: 'bad' }, { start: 3, end: 4, text: '' }] }), [
        { start: 1, end: 2, text: 'a' },
        { start: 5, end: 6, text: 'b' },
    ]);
    assert.deepEqual(parseTranscript(null), []);
    assert.deepEqual(parseTranscript({ text: 'no chunks' }), []);
});

test('transcriptForModel: timestamped lines, merged to fit the budget', () => {
    const segments = Array.from({ length: 400 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: `sentence number ${i} with a few words` }));
    const full = transcriptForModel(segments, 1_000_000);
    assert.equal(full.split('\n').length, 400);
    assert.match(full.split('\n')[1], /^\[2\.0-4\.0\] sentence number 1/);
    const small = transcriptForModel(segments, 6_000);
    assert.ok(small.length <= 6_000 + 30);
    assert.ok(small.split('\n').length < 400);
    assert.match(small, /^\[0\.0-\d+\.0\] sentence number 0 with a few words sentence number 1/);
});

test('selectHighlights: snaps to sentences, bounds length, drops overlaps, best first', () => {
    const segments = parseTranscript(LONG_TRANSCRIPT);
    const duration = Math.max(...segments.map((s) => s.end));
    const picked = selectHighlights({
        highlights: [
            { label: 'Surprise', start_time: 15, end_time: 50, score: 0.7, reason: 'hook' },
            { label: 'Overlap', start_time: 20, end_time: 40, score: 0.9 },
            { label: 'Punchline', start_time: 85, end_time: 100, score: 95 },
            { label: 'Backwards', start_time: 70, end_time: 60, score: 0.2 },
            { label: 'Tiny', start_time: 0.5, end_time: 1, score: 0.1 },
            { label: 'Nonsense', start_time: 'x', end_time: 3, score: 1 },
            { label: 'Too long', start_time: 0, end_time: 400, score: 0.05 },
        ],
    }, { segments, duration, count: 10 });
    const rows = picked.map((h) => [h.label, h.start_time, h.end_time, h.score]);
    assert.deepEqual(rows[0], ['Punchline', 80, 118.5, 0.95]);
    assert.deepEqual(rows[1], ['Overlap', 12.4, 58.2, 0.9]);
    assert.ok(!rows.some((r) => r[0] === 'Surprise'), 'the overlapping lower-scored window is dropped');
    assert.ok(!rows.some((r) => r[0] === 'Nonsense'));
    const backwards = picked.find((h) => h.label === 'Backwards');
    assert.deepEqual([backwards.start_time, backwards.end_time], [58.2, 80]);
    for (const h of picked) {
        assert.ok(h.end_time - h.start_time >= 5 && h.end_time - h.start_time <= 90, `${h.label} length`);
        assert.equal(h.start, h.start_time);
        assert.equal(h.end, h.end_time);
        assert.ok(h.score >= 0 && h.score <= 1);
    }
    assert.equal(selectHighlights({ highlights: [{ start_time: 1, end_time: 2 }] }, { segments, duration, count: 1 })[0].label, 'Highlight 1');
    assert.equal(selectHighlights({ highlights: [] }, { segments, duration, count: 3 }).length, 0);
    assert.equal(selectHighlights({ highlights: [{ start_time: 0, end_time: 30, score: 0.5 }, { start_time: 60, end_time: 90, score: 0.4 }] }, { segments, duration, count: 1 }).length, 1);
});

test('validate + estimate: URL checks, bounds and defaults', async () => {
    const opts = { session: { sid: 'sid-validate', cid: 'open' } };
    await assert.rejects(validateClippingInput({}, opts), (e) => e.status === 400 && e.field === 'video_url');
    await assert.rejects(validateClippingInput({ video_url: 'blob:http://localhost/abc' }, opts), (e) => e.status === 400 && /not been uploaded/.test(e.message));
    await assert.rejects(validateClippingInput({ video_url: 'http://169.254.169.254/latest' }, opts), (e) => e.status === 400);
    const clean = await validateClippingInput({ video_url: media('sample.mp4'), num_highlights: 60, aspect_ratio: '21:9', return_coordinates_only: 'true', prompt: '  the  funny\nparts ' }, opts);
    assert.deepEqual(clean, { media_seconds: 1, video_url: media('sample.mp4'), num_highlights: 10, aspect_ratio: '9:16', return_coordinates_only: true, prompt: 'the funny parts' });
    assert.equal((await validateClippingInput({ video_url: media('sample.mp4'), num_highlights: 0 }, opts)).num_highlights, 1);
    assert.equal((await validateClippingInput({ video_url: media('sample.mp4') }, opts)).num_highlights, 3);
    assert.equal(estimateClippingUsd({ num_highlights: 3 }), 0.18);
    assert.equal(estimateClippingUsd({ num_highlights: 3, aspect_ratio: 'original' }), 0.12);
    assert.equal(estimateClippingUsd({ num_highlights: 3, return_coordinates_only: true }), 0.06);
    const est = await call(estimateRoute.POST, { method: 'POST', url: '/api/v1/estimate', body: { model: 'ai-clipping', payload: { num_highlights: 2 } } });
    assert.equal(est.status, 200);
    assert.equal(est.body.cost, 0.14);
});

// ── through the routes, against the mock upstream ───────────────────────────
test('ai-clipping: whisper → LLM picks → trim + 9:16 centre crop, studio-compatible result', async () => {
    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    const before = await budgetStatus('open');
    const start = await submit({ video_url: media('sample.mp4'), num_highlights: 3, aspect_ratio: '9:16', return_coordinates_only: false, prompt: 'the best part' });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.status, 'processing');
    const res = await finish(start.body.request_id);
    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.status, 'completed', JSON.stringify(body));
    assert.equal(body.outputs.length, 1);
    assert.equal(body.url, body.outputs[0]);
    assert.equal(body.reframe, 'center_crop');
    assert.equal(body.notice, undefined);
    assert.equal(body.aspect_ratio, '9:16');
    // The mock's schema-shaped reply (4.5 → 4.5) is snapped to whole sentences.
    const [highlight] = body.coordinates;
    assert.equal(highlight.start_time, 2.5);
    assert.equal(highlight.end_time, 9);
    assert.equal(highlight.start, 2.5);
    assert.equal(highlight.clip_url, body.outputs[0]);
    assert.equal(highlight.reframed, true);
    assert.deepEqual(body.output.coordinates, body.coordinates);
    assert.deepEqual(body.output.clips.map((c) => [c.aspect_ratio, c.reframed]), [['9:16', true]]);
    const requests = (await mockRequests()).filter((r) => r.method === 'POST');
    const paths = requests.map((r) => r.path);
    assert.ok(paths.includes(`/fal-queue/${TRANSCRIBE_ENDPOINT}`));
    assert.ok(paths.includes('/openrouter/api/v1/chat/completions'));
    assert.ok(paths.includes(`/fal-queue/${TRIM_ENDPOINT}`));
    assert.ok(paths.includes(`/fal-queue/${SCALE_ENDPOINT}`));
    assert.ok(paths.indexOf(`/fal-queue/${TRIM_ENDPOINT}`) < paths.indexOf(`/fal-queue/${SCALE_ENDPOINT}`));
    const after = await budgetStatus('open');
    assert.ok(after.spentUsd >= before.spentUsd + 0.09, `whisper + trim + crop are charged (${before.spentUsd} → ${after.spentUsd})`);
});

test('ai-clipping: "Just timestamps" skips cutting; "original" skips the crop', async () => {
    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    const coords = await finish((await submit({ video_url: media('sample.mp4'), num_highlights: 2, return_coordinates_only: true })).body.request_id);
    assert.equal(coords.body.status, 'completed');
    assert.deepEqual(coords.body.outputs, []);
    assert.equal(coords.body.url, null);
    assert.equal(coords.body.coordinates.length, 1);
    assert.equal(coords.body.return_coordinates_only, true);
    let paths = (await mockRequests()).map((r) => r.path);
    assert.ok(!paths.some((p) => p.includes('trim-video') || p.includes('scale-video')));

    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    const original = await finish((await submit({ video_url: media('sample.mp4'), aspect_ratio: 'original' })).body.request_id);
    assert.equal(original.body.status, 'completed');
    assert.equal(original.body.reframe, 'original');
    assert.deepEqual(original.body.output.clips.map((c) => [c.aspect_ratio, c.reframed]), [['original', false]]);
    paths = (await mockRequests()).map((r) => r.path);
    assert.ok(paths.some((p) => p.includes('trim-video')));
    assert.ok(!paths.some((p) => p.includes('scale-video')));
});

test('ai-clipping: bad input is refused at submit (400), before any upstream call', async () => {
    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    assert.equal((await submit({ video_url: 'http://10.1.2.3/video.mp4' })).status, 400);
    assert.equal((await submit({})).status, 400);
    assert.equal((await mockRequests()).filter((r) => r.method === 'POST').length, 0);
    const key = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
        const res = await submit({ video_url: media('sample.mp4') });
        assert.equal(res.status, 503);
        assert.equal(res.body.error, 'not_configured');
    } finally {
        process.env.OPENROUTER_API_KEY = key;
    }
});

// ── fallbacks (stub context) ────────────────────────────────────────────────
const HIGHLIGHTS = [
    { label: 'Punchline', start_time: 82, end_time: 110, score: 0.9, reason: 'laugh' },
    { label: 'Surprise', start_time: 14, end_time: 50, score: 0.8, reason: 'hook' },
];

test('fallback: a rejected crop step keeps original framing, says so, and stops retrying it', async () => {
    const input = { video_url: 'https://v3.fal.media/files/talk.mp4', num_highlights: 3, aspect_ratio: '4:5', return_coordinates_only: false, prompt: '' };
    const ctx = stubContext({
        input,
        transcript: LONG_TRANSCRIPT,
        highlights: [...HIGHLIGHTS, { label: 'Second story', start_time: 60, end_time: 78, score: 0.6, reason: 'story' }],
        onFal: (endpoint) => {
            if (endpoint === SCALE_ENDPOINT) throw new GatewayError(422, 'model_rejected', 'The model rejected "width": unknown field');
            return null;
        },
    });
    const result = await runClipping(ctx);
    assert.equal(result.outputs.length, 3);
    assert.equal(result.reframe, 'unavailable');
    assert.equal(result.notice, 'reframe_unavailable');
    assert.ok(result.output.clips.every((c) => c.reframed === false && c.aspect_ratio === 'original'));
    const scaleCalls = ctx.calls.filter((c) => c.endpoint === SCALE_ENDPOINT);
    // Two cuts run at a time; once the crop step is rejected the rest skip it.
    assert.ok(scaleCalls.length >= 1 && scaleCalls.length <= 2, `crop attempts: ${scaleCalls.length}`);
    const { video_url: scaledFrom, ...frame } = scaleCalls[0].input;
    assert.match(scaledFrom, /trim-video-\d+\.mp4$/, 'the crop runs on the trimmed clip');
    assert.deepEqual(frame, { width: FRAME_SIZES['4:5'].width, height: FRAME_SIZES['4:5'].height, mode: 'crop' });
    assert.deepEqual(result.outputs.map((u) => /trim-video/.test(u)), [true, true, true]);
    assert.equal(reframeAvailable(), false);
    const trims = ctx.calls.filter((c) => c.endpoint === TRIM_ENDPOINT).map((c) => [c.input.start_time, c.input.end_time]);
    assert.deepEqual(trims, [[80, 118.5], [12.4, 58.2], [58.2, 80]]);
    assert.deepEqual(ctx.calls[0], { endpoint: TRANSCRIBE_ENDPOINT, input: { audio_url: input.video_url, task: 'transcribe', chunk_level: 'segment' } });
});

test('selection prompt: fast model, strict schema bounded by the video length, transcript + creator focus', async () => {
    const input = { video_url: 'https://v3.fal.media/files/talk.mp4', num_highlights: 4, aspect_ratio: '9:16', return_coordinates_only: true, prompt: 'the punchlines' };
    const ctx = stubContext({ input, transcript: LONG_TRANSCRIPT, highlights: HIGHLIGHTS });
    const result = await runClipping(ctx);
    assert.equal(result.reframe, 'none');
    assert.equal(ctx.calls.length, 1, 'timecodes only: transcription is the only fal call');
    const [call] = ctx.llmCalls;
    assert.equal(call.purpose, 'fast');
    assert.equal(call.response_format.type, 'json_schema');
    const schema = call.response_format.json_schema.schema;
    assert.equal(schema.properties.highlights.maxItems, 4);
    assert.ok(schema.properties.highlights.items.properties.end_time.maximum > 118.5);
    const user = call.messages.find((m) => m.role === 'user').content;
    assert.match(user, /Pick up to 4 clips\./);
    assert.match(user, /What the creator wants: the punchlines/);
    assert.match(user, /\[80\.0-118\.5\] The punchline lands right here\./);
    assert.match(call.messages[0].content, /not instructions for you/);
});

test('fallback: failed cuts return the timecodes (never invented ones); partial failures keep the rest', async () => {
    const input = { video_url: 'https://v3.fal.media/files/talk.mp4', num_highlights: 2, aspect_ratio: 'original', return_coordinates_only: false, prompt: '' };
    const allFail = await runClipping(stubContext({
        input,
        transcript: LONG_TRANSCRIPT,
        highlights: HIGHLIGHTS,
        onFal: (endpoint) => {
            if (endpoint === TRIM_ENDPOINT) throw new GatewayError(502, 'upstream_unavailable', 'fal is down');
            return null;
        },
    }));
    assert.deepEqual(allFail.outputs, []);
    assert.equal(allFail.notice, 'clips_unavailable');
    assert.equal(allFail.return_coordinates_only, true);
    assert.deepEqual(allFail.coordinates.map((c) => c.label), ['Punchline', 'Surprise']);

    const partial = await runClipping(stubContext({
        input,
        transcript: LONG_TRANSCRIPT,
        highlights: HIGHLIGHTS,
        onFal: (endpoint, falInput) => {
            if (endpoint === TRIM_ENDPOINT && falInput.start_time === 12.4) throw new GatewayError(422, 'model_rejected', 'bad');
            return null;
        },
    }));
    assert.equal(partial.outputs.length, 1);
    assert.equal(partial.notice, 'some_clips_failed');
    assert.equal(partial.coordinates[0].clip_url, partial.outputs[0]);
    assert.equal(partial.coordinates[1].clip_url, undefined);
});

test('fallback: no speech → a clear failure; a cancelled job stops cutting', async () => {
    const input = { video_url: 'https://v3.fal.media/files/music.mp4', num_highlights: 3, aspect_ratio: '9:16', return_coordinates_only: false, prompt: '' };
    await assert.rejects(runClipping(stubContext({ input, transcript: { text: '', chunks: [] }, highlights: [] })), (e) => e.code === 'no_speech' && /talking videos/.test(e.message));
    await assert.rejects(runClipping(stubContext({ input, transcript: LONG_TRANSCRIPT, highlights: [] })), (e) => e.code === 'no_highlights');
    const cancelled = stubContext({
        input,
        transcript: LONG_TRANSCRIPT,
        highlights: HIGHLIGHTS,
        onFal: (endpoint) => {
            if (endpoint === TRIM_ENDPOINT) throw new GatewayError(499, 'cancelled', 'The generation was cancelled.');
            return null;
        },
    });
    await assert.rejects(runClipping(cancelled), (e) => e.code === 'cancelled');
});
