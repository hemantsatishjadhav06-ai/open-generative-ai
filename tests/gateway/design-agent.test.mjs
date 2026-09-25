// Design agent API (/api/v1/creative-agent/*) against the local mock upstream
// and the real catalog: canvas sessions, the asset registry, transcript
// storage, agent runs as pipeline jobs with a cursor event log, tools over
// the catalog (budget applies), skills, cancel and the security edges. A
// small scripted OpenRouter stand-in drives the tool loop step by step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { resetJobs } from '../../lib/gateway/jobs.js';
import { createSessionCookie } from '../../lib/gateway/session.js';
import { layoutNodes } from '../../lib/gateway/design/tools.js';
import { designSystemPrompt, userTurn } from '../../lib/gateway/design/run.js';
import { cleanCanvasState, cleanTranscript, mentionedLabels } from '../../lib/gateway/design/validate.js';

import * as designRoute from '../../app/api/v1/creative-agent/[[...path]]/route.js';
import * as submitRoute from '../../app/api/v1/[...path]/route.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-design-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'design-test-secret-'.padEnd(48, 'd'),
    AQUORA_LOG_LEVEL: 'silent',
    FAL_POLL_INTERVAL_MS: '10',
});
delete process.env.AQUORA_ACCESS_CODES;
delete process.env.AQUORA_SESSION_DAILY_BUDGET_USD;
delete process.env.NODE_ENV;
setCatalogForTesting(null);

// ── scripted OpenRouter ─────────────────────────────────────────────────────
// script(body, n) → {content?, tool_calls?, delayMs?, status?}
function startScriptedLlm() {
    const state = { script: () => ({ content: 'ok' }), requests: [] };
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            state.requests.push(body);
            const reply = await state.script(body, state.requests.length - 1);
            if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
            if (reply.status) {
                res.writeHead(reply.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { code: reply.status, message: reply.message || 'scripted failure' } }));
                return;
            }
            const toolCalls = (reply.tool_calls || []).map((call, i) => ({
                id: `call_${state.requests.length}_${i}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: `gen-${state.requests.length}`,
                model: body.model,
                choices: [{ index: 0, finish_reason: toolCalls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: reply.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 },
            }));
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        state,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
    })));
}

let mock;
let llm;
test.before(async () => {
    mock = await startMockUpstream({ port: 0, pollsToComplete: 1 });
    applyMockEnv(mock);
    llm = await startScriptedLlm();
});
test.after(async () => {
    resetJobs();
    await flushLedger();
    await mock.close();
    await llm.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => {
    resetLimits();
    process.env.OPENROUTER_BASE_URL = mock.env.OPENROUTER_BASE_URL;
});

// Runs `fn` with OpenRouter pointed at the scripted server.
async function withScript(script, fn) {
    llm.state.script = script;
    llm.state.requests = [];
    process.env.OPENROUTER_BASE_URL = llm.url;
    try {
        return await fn();
    } finally {
        process.env.OPENROUTER_BASE_URL = mock.env.OPENROUTER_BASE_URL;
    }
}

const ORIGIN = 'http://localhost:3000';
const HEADERS = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

async function call(handler, { method = 'GET', url, body, cookie, params, headers = {} }) {
    const request = new Request(`${ORIGIN}${url}`, {
        method,
        headers: { ...HEADERS, ...headers, ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await handler(request, { params: Promise.resolve(params) });
    const setCookie = response.headers.get('set-cookie');
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

function api(method, subpath, { body, cookie, headers } = {}) {
    const [pathname, query] = subpath.split('?');
    const segments = pathname.split('/').filter(Boolean);
    return call(designRoute[method], {
        method,
        url: `/api/v1/creative-agent/${segments.join('/')}${query ? `?${query}` : ''}`,
        body,
        cookie,
        headers,
        params: segments.length ? { path: segments } : {},
    });
}

function cookieFor(codeId, sid) {
    const { value } = createSessionCookie({ codeId, ...(sid ? { sid } : {}) });
    return `aquora_session=${value}`;
}

const MAIN = cookieFor('open');
const media = (name) => `${mock.url}/media/${name}`;

async function newSession(cookie = MAIN, body = {}) {
    const res = await api('POST', 'sessions', { cookie, body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
}

async function drain(jobId, cookie = MAIN, max = 600) {
    const events = [];
    let cursor = 0;
    for (let i = 0; i < max; i++) {
        const res = await api('GET', `jobs/${jobId}/events?since=${cursor}`, { cookie });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        events.push(...res.body.events);
        cursor = res.body.cursor;
        if (res.body.done) return { events, final: res.body };
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('design run did not finish');
}

// ── pure helpers ────────────────────────────────────────────────────────────
test('validate: mentions, canvas snapshot and transcript are bounded and URL-safe', () => {
    assert.deepEqual(mentionedLabels('edit @asset_2 and asset_10, not myasset_3 or asset_0'), ['asset_2', 'asset_10']);
    const canvas = cleanCanvasState({ nodes: [{ asset_id: '@asset_1', kind: 'image', x: 10.6, y: '20', w: 300, h: 200 }, { asset_id: 'evil', x: 1 }], selected: 'asset_1', viewport: { w: 1000, h: 700, zoom: 1 } });
    assert.deepEqual(canvas, { nodes: [{ asset_id: 'asset_1', kind: 'image', x: 11, y: 20, w: 300, h: 200 }], selected: 'asset_1', viewport: { w: 1000, h: 700 } });
    const transcript = cleanTranscript([
        { role: 'user', content: 'hi', attachments: [{ asset_label: 'asset_1', url: 'javascript:alert(1)', kind: 'image' }, { asset_label: 'asset_2', url: 'https://v3.fal.media/x.png', kind: 'image' }] },
        { role: 'system', content: 'drop me' },
        { role: 'assistant', content: 'done', events: [{ type: 'tool_result', name: 'generate_image', result: { ok: true }, asset: { asset_label: 'asset_3', url: 'data:text/html,x', kind: 'image' } }, { type: 'bogus' }] },
    ]);
    assert.equal(transcript.length, 2);
    assert.deepEqual(transcript[0].attachments, [{ asset_label: 'asset_1', kind: 'image' }, { asset_label: 'asset_2', url: 'https://v3.fal.media/x.png', kind: 'image' }]);
    assert.deepEqual(transcript[1].events, [{ type: 'tool_result', name: 'generate_image', result: { ok: true }, asset: { asset_label: 'asset_3', kind: 'image' } }]);
});

test('layout: grid, row and column keep the top-left corner and a 32px gap', () => {
    const nodes = [
        { asset_id: 'asset_1', x: 100, y: 50, w: 200, h: 100 },
        { asset_id: 'asset_2', x: 900, y: 400, w: 100, h: 300 },
        { asset_id: 'asset_3', x: 400, y: 80, w: 150, h: 150 },
    ];
    assert.deepEqual(layoutNodes(nodes, { layout: 'row' }).map((m) => [m.x, m.y]), [[100, 50], [332, 50], [464, 50]]);
    assert.deepEqual(layoutNodes(nodes, { layout: 'column' }).map((m) => [m.x, m.y]), [[100, 50], [100, 182], [100, 514]]);
    assert.deepEqual(layoutNodes(nodes, { layout: 'grid' }).map((m) => [m.x, m.y]), [[100, 50], [332, 50], [100, 382]]);
});

test('prompt: registry, canvas, skill recipe and image parts for attached/mentioned images', () => {
    const assets = [
        { asset_label: 'asset_1', kind: 'image', url: 'https://v3.fal.media/a.png', source_tool: 'upload' },
        { asset_label: 'asset_2', kind: 'image', url: 'https://v3.fal.media/b.png', source_tool: 'generate_image', prompt: 'a red fox' },
        { asset_label: 'asset_3', kind: 'video', url: 'https://v3.fal.media/c.mp4', source_tool: 'image_to_video', source_asset_id: 'asset_2' },
    ];
    const prompt = designSystemPrompt({ assets, canvas: { nodes: [{ asset_id: 'asset_2', kind: 'image', x: 1, y: 2, w: 3, h: 4 }], selected: 'asset_2' }, skill: { name: 'Storyboard', instructions: 'RECIPE-TEXT' } });
    assert.match(prompt, /asset_1 — image — uploaded by the user/);
    assert.match(prompt, /asset_2 — image — generate_image — "a red fox"/);
    assert.match(prompt, /asset_3 — video — image_to_video \(from asset_2\)/);
    assert.match(prompt, /Selected by the user: asset_2/);
    assert.match(prompt, /RECIPE-TEXT/);
    const byLabel = new Map(assets.map((a) => [a.asset_label, a]));
    const turn = userTurn({ text: 'make @asset_2 brighter', attachments: ['asset_1', 'asset_3'], assetsByLabel: byLabel });
    assert.match(turn.historyText, /\[Attached: asset_1 \(image\), asset_3 \(video\)\]/);
    const urls = turn.message.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url);
    assert.deepEqual(urls, ['https://v3.fal.media/a.png', 'https://v3.fal.media/b.png']);
});

// ── skills & sessions ───────────────────────────────────────────────────────
test('agent-skills: six recipes with ids and one input, localized for /zh pages', async () => {
    const en = await api('GET', 'agent-skills', { cookie: MAIN });
    assert.equal(en.status, 200);
    assert.equal(en.body.length, 6);
    for (const skill of en.body) {
        assert.match(skill.id, /^[a-z-]+$/);
        assert.ok(skill.name && skill.description);
        assert.equal(skill.inputs.length, 1);
    }
    const zh = await api('GET', 'agent-skills', { cookie: MAIN, headers: { referer: `${ORIGIN}/zh/studio/design-agent` } });
    assert.deepEqual(zh.body.map((s) => s.id), en.body.map((s) => s.id));
    assert.notEqual(zh.body[0].name, en.body[0].name);
});

test('sessions: create, list, rename, get, delete; unknown ids are 404', async () => {
    const created = await newSession(MAIN, { name: '  Launch   kit ' });
    assert.equal(created.name, 'Launch kit');
    assert.equal(created.asset_count, 0);
    const untitled = await newSession();
    assert.equal(untitled.name, 'Untitled canvas');
    const list = await api('GET', 'sessions', { cookie: MAIN });
    assert.ok(list.body.some((s) => s.id === created.id) && list.body.some((s) => s.id === untitled.id));
    const renamed = await api('PATCH', `sessions/${created.id}`, { cookie: MAIN, body: { name: 'Spring drop' } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Spring drop');
    assert.equal((await api('PATCH', `sessions/${created.id}`, { cookie: MAIN, body: { name: '   ' } })).status, 400);
    assert.equal((await api('GET', `sessions/${created.id}`, { cookie: MAIN })).body.name, 'Spring drop');
    const del = await api('DELETE', `sessions/${created.id}`, { cookie: MAIN });
    assert.deepEqual(del.body, { deleted: true, id: created.id });
    assert.equal((await api('GET', `sessions/${created.id}/messages`, { cookie: MAIN })).status, 404);
    assert.equal((await api('GET', 'sessions/..%2F..%2Fetc/assets', { cookie: MAIN })).status, 404);
    assert.equal((await api('GET', 'sessions/abc/assets/extra', { cookie: MAIN })).status, 404);
    assert.equal((await api('GET', 'nope', { cookie: MAIN })).status, 404);
});

test('workspaces are isolated: another access code cannot see or touch a canvas', async () => {
    const mine = await newSession();
    const other = cookieFor('other-workspace');
    const theirs = await api('GET', 'sessions', { cookie: other });
    assert.ok(!theirs.body.some((s) => s.id === mine.id));
    assert.equal((await api('GET', `sessions/${mine.id}/assets`, { cookie: other })).status, 404);
    assert.equal((await api('DELETE', `sessions/${mine.id}`, { cookie: other })).status, 404);
});

test('assets: uploads register as asset_N; private, non-http and duplicate URLs are handled', async () => {
    const s = await newSession();
    const a = await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: media('sample.png'), kind: 'image', source_tool: 'upload' } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.asset_label, 'asset_1');
    assert.equal(a.body.source_tool, 'upload');
    const b = await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: media('sample.mp4'), kind: 'video' } });
    assert.equal(b.body.asset_label, 'asset_2');
    const again = await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: media('sample.png'), kind: 'image' } });
    assert.equal(again.body.asset_label, 'asset_1');
    assert.equal((await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: 'http://10.0.0.5/secret.png', kind: 'image' } })).status, 400);
    assert.equal((await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: 'file:///etc/passwd', kind: 'image' } })).status, 400);
    assert.equal((await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: media('sample.png'), kind: 'pdf' } })).status, 400);
    const list = await api('GET', `sessions/${s.id}/assets`, { cookie: MAIN });
    assert.deepEqual(list.body.map((x) => [x.asset_label, x.kind]), [['asset_1', 'image'], ['asset_2', 'video']]);
    assert.equal((await api('GET', 'sessions', { cookie: MAIN })).body.find((x) => x.id === s.id).asset_count, 2);
});

test('messages: the canvas transcript round-trips sanitized', async () => {
    const s = await newSession();
    const saved = await api('PATCH', `sessions/${s.id}/messages`, {
        cookie: MAIN,
        body: { messages: [{ role: 'assistant', content: 'What are we making today?', timestamp: '2026-09-24T10:00:00.000Z' }, { role: 'user', content: 'x'.repeat(30_000) }, { role: 'tool', content: 'no' }] },
    });
    assert.deepEqual(saved.body, { saved: 2 });
    const back = await api('GET', `sessions/${s.id}/messages`, { cookie: MAIN });
    assert.equal(back.body[0].content, 'What are we making today?');
    assert.equal(back.body[1].content.length, 20_000);
    assert.equal((await api('PATCH', `sessions/${s.id}/messages`, { cookie: MAIN, body: { messages: 'nope' } })).status, 400);
});

// ── runs ────────────────────────────────────────────────────────────────────
test('chat run (mock LLM): generate_image → asset registered, events, transcript, history, budget', async () => {
    const s = await newSession();
    const before = await budgetStatus('open');
    const start = await api('POST', `sessions/${s.id}/chat`, {
        cookie: MAIN,
        body: { message: 'A neon poster for a jazz night, use a tool', model: 'gpt-5-mini', messages_snapshot: [{ role: 'user', content: 'ignored' }], canvas_state: { nodes: [] } },
    });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.match(start.body.job_id, /^[A-Za-z0-9_-]{8,64}$/);
    const { events, final } = await drain(start.body.job_id);
    assert.equal(final.status, 'completed');
    assert.equal(final.approved, null);
    const types = events.map((e) => e.type);
    assert.deepEqual(types.filter((t) => t !== 'text'), ['tool_call', 'tool_result']);
    const call = events.find((e) => e.type === 'tool_call');
    assert.equal(call.payload.name, 'generate_image');
    assert.equal(call.job_id, start.body.job_id);
    const result = events.find((e) => e.type === 'tool_result');
    assert.equal(result.payload.result.ok, true);
    assert.deepEqual(result.payload.asset, { asset_label: 'asset_1', url: media('sample.png'), kind: 'image' });
    assert.ok(events.some((e) => e.type === 'text' && /Done!/.test(e.payload.content)));
    // ids are a strictly increasing cursor
    assert.deepEqual(events.map((e) => e.id), events.map((_, i) => i + 1));
    const assets = await api('GET', `sessions/${s.id}/assets`, { cookie: MAIN });
    assert.equal(assets.body[0].source_tool, 'generate_image');
    assert.equal(assets.body[0].prompt, 'mock prompt');
    const transcript = (await api('GET', `sessions/${s.id}/messages`, { cookie: MAIN })).body;
    assert.equal(transcript.length, 2);
    assert.equal(transcript[0].role, 'user');
    assert.match(transcript[0].content, /neon poster/);
    assert.equal(transcript[1].job_id, start.body.job_id);
    assert.match(transcript[1].content, /Done!/);
    assert.deepEqual(transcript[1].events.map((e) => e.type), ['tool_call', 'tool_result', 'text']);
    const jobs = await api('GET', `sessions/${s.id}/jobs`, { cookie: MAIN });
    assert.deepEqual(jobs.body.map((j) => [j.id, j.status]), [[start.body.job_id, 'completed']]);
    const status = await api('GET', `jobs/${start.body.job_id}/status`, { cookie: MAIN });
    assert.deepEqual(status.body, { id: start.body.job_id, status: 'completed', done: true });
    const renamed = (await api('GET', `sessions/${s.id}`, { cookie: MAIN })).body;
    assert.equal(renamed.name, 'A neon poster for a jazz night');
    const after = await budgetStatus('open');
    assert.ok(after.spentUsd > before.spentUsd, 'image + LLM cost is charged');
    // A replay from an older cursor only returns newer events.
    const tail = await api('GET', `jobs/${start.body.job_id}/events?since=${events.length - 1}`, { cookie: MAIN });
    assert.equal(tail.body.events.length, 1);
});

test('tool loop (scripted): edit, animate, enhance and layout by asset label; bad labels come back to the model', async () => {
    const s = await newSession();
    await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: media('sample.png'), kind: 'image' } });
    await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: media('sample.jpg'), kind: 'image' } });
    const script = (body, n) => {
        if (n === 0) {
            return {
                content: 'On it.',
                tool_calls: [
                    { name: 'edit_image', args: { image: '@asset_1', prompt: 'swap the background for a beach', reference_images: ['asset_2'], aspect_ratio: 'auto' } },
                    { name: 'edit_image', args: { image: 'asset_99', prompt: 'nope' } },
                ],
            };
        }
        if (n === 1) {
            return {
                tool_calls: [
                    { name: 'image_to_video', args: { image: 'asset_3', prompt: 'slow push in', duration: '5' } },
                    { name: 'enhance_image', args: { image: 'asset_3' } },
                    { name: 'arrange_canvas', args: { layout: 'row', asset_ids: ['asset_1', 'asset_3', 'asset_4', 'asset_5'] } },
                ],
            };
        }
        return { content: 'Here you go: asset_3 is the beach edit, asset_4 animates it.' };
    };
    const { events, requests } = await withScript(script, async () => {
        const start = await api('POST', `sessions/${s.id}/chat`, {
            cookie: MAIN,
            body: { message: 'Put @asset_1 on a beach', attachments: ['asset_2'], canvas_state: { nodes: [{ asset_id: 'asset_1', kind: 'image', x: 10, y: 20, w: 400, h: 300 }], selected: 'asset_1' } },
        });
        assert.equal(start.status, 200, JSON.stringify(start.body));
        const drained = await drain(start.body.job_id);
        assert.equal(drained.final.status, 'completed');
        return { events: drained.events, requests: llm.state.requests };
    });
    const results = events.filter((e) => e.type === 'tool_result').map((e) => e.payload);
    assert.deepEqual(results.map((r) => [r.name, r.result.ok]), [
        ['edit_image', true],
        ['edit_image', false],
        ['image_to_video', true],
        ['enhance_image', true],
        ['arrange_canvas', true],
    ]);
    assert.equal(results[0].result.source_asset_id, 'asset_1');
    assert.deepEqual(results[0].asset, { asset_label: 'asset_3', url: media('sample.png'), kind: 'image' });
    assert.match(results[1].result.error, /asset_99 does not exist\. Available images: asset_1, asset_2, asset_3\./);
    assert.deepEqual(results[2].asset, { asset_label: 'asset_4', url: media('sample.mp4'), kind: 'video' });
    assert.equal(results[2].result.source_asset_id, 'asset_3');
    assert.equal(results[3].asset.asset_label, 'asset_5');
    const op = events.find((e) => e.type === 'canvas_op').payload;
    assert.equal(op.op, 'layout');
    assert.equal(op.args.layout, 'row');
    assert.deepEqual(op.args.asset_ids, ['asset_1', 'asset_3', 'asset_4', 'asset_5']);
    assert.deepEqual(op.args.moves.map((m) => [m.asset_id, m.x, m.y]), [['asset_1', 0, 0], ['asset_3', 432, 0], ['asset_4', 864, 0], ['asset_5', 1296, 0]]);
    const calls = events.filter((e) => e.type === 'tool_call').map((e) => e.payload);
    assert.deepEqual(calls[0].args, { image: 'asset_1', prompt: 'swap the background for a beach', reference_images: ['asset_2'], aspect_ratio: 'auto' });
    for (const event of events) assert.ok(!JSON.stringify(event.payload.args || {}).includes('http'), 'tool_call args never carry URLs');
    // The model saw the registry, the canvas and the attachment.
    const first = requests[0];
    assert.equal(first.model, 'anthropic/claude-sonnet-5');
    assert.ok(first.tools.map((t) => t.function.name).includes('arrange_canvas'));
    const system = first.messages[0].content;
    assert.match(system, /asset_1 — image — uploaded by the user/);
    assert.match(system, /asset_1 \(image\) at x=10, y=20, 400×300/);
    // (The mock's media is plain http, so no image parts: those need https.)
    const user = first.messages.at(-1);
    assert.equal(typeof user.content, 'string');
    assert.match(user.content, /Put @asset_1 on a beach\n\n\[Attached: asset_2 \(image\)\]/);
    // Tool results fed back to the model name labels, never URLs.
    const toolMessages = requests[1].messages.filter((m) => m.role === 'tool');
    assert.deepEqual(JSON.parse(toolMessages[0].content).created, [{ asset_label: 'asset_3', kind: 'image' }]);
    assert.equal(JSON.parse(toolMessages[1].content).ok, false);
    assert.ok(!toolMessages.some((m) => m.content.includes('http')));
    const assets = (await api('GET', `sessions/${s.id}/assets`, { cookie: MAIN })).body;
    assert.deepEqual(assets.map((a) => [a.asset_label, a.source_tool, a.source_asset_id || null]), [
        ['asset_1', 'upload', null],
        ['asset_2', 'upload', null],
        ['asset_3', 'edit_image', 'asset_1'],
        ['asset_4', 'image_to_video', 'asset_3'],
        ['asset_5', 'enhance_image', 'asset_3'],
    ]);
    // The next turn carries the server-side history.
    await withScript(() => ({ content: 'Sure.' }), async () => {
        const start = await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: 'thanks' } });
        await drain(start.body.job_id);
        const messages = llm.state.requests[0].messages;
        assert.equal(messages[1].role, 'user');
        assert.match(messages[1].content, /Put @asset_1 on a beach/);
        assert.match(messages[2].content, /\[Created: asset_3 \(image\), asset_4 \(video\), asset_5 \(image\)\]/);
    });
});

test('limits: at most two videos per message; a text-only model gets the images as labels', async () => {
    const s = await newSession();
    process.env.AQUORA_TRUSTED_MEDIA_HOSTS = 'v3.fal.media';
    const added = await api('POST', `sessions/${s.id}/assets`, { cookie: MAIN, body: { url: 'https://v3.fal.media/files/demo/photo.png', kind: 'image' } });
    delete process.env.AQUORA_TRUSTED_MEDIA_HOSTS;
    assert.equal(added.status, 201, JSON.stringify(added.body));
    let sawImageParts = 0;
    const script = (body, n) => {
        if (body.messages.some((m) => Array.isArray(m.content))) {
            sawImageParts += 1;
            return { status: 400, message: 'This model does not support image input' };
        }
        if (n <= 1) return { tool_calls: [1, 2, 3].map(() => ({ name: 'generate_video', args: { prompt: 'waves', aspect_ratio: '9:16' } })) };
        return { content: 'Made two clips.' };
    };
    const events = await withScript(script, async () => {
        const start = await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: 'three wave clips from @asset_1' } });
        return (await drain(start.body.job_id)).events;
    });
    assert.equal(sawImageParts, 1);
    const results = events.filter((e) => e.type === 'tool_result').map((e) => e.payload.result.ok);
    assert.deepEqual(results, [true, true]);
    assert.equal(events.filter((e) => e.type === 'tool_call').length, 2);
});

test('rounds are bounded: the last round keeps the tools declared but forces a text answer', async () => {
    const s = await newSession();
    const script = (body) => (body.tool_choice === 'none' ? { content: 'That is all for now.' } : { tool_calls: [{ name: 'arrange_canvas', args: { layout: 'grid' } }] });
    const { events } = await withScript(script, async () => {
        const start = await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: 'tidy up forever' } });
        return drain(start.body.job_id);
    });
    const requests = llm.state.requests;
    assert.equal(requests.length, 8);
    assert.ok(requests.slice(0, 7).every((r) => r.tool_choice === 'auto'));
    assert.equal(requests[7].tool_choice, 'none');
    assert.ok(requests[7].tools.length > 0);
    assert.ok(events.some((e) => e.type === 'text' && /That is all for now/.test(e.payload.content)));
    // Nothing to arrange on an empty canvas: each attempt is a tool error, not a crash.
    assert.ok(events.filter((e) => e.type === 'tool_result').every((e) => e.payload.result.ok === false));
});

test('run-skill: the recipe goes into the system prompt; unknown skills are 400', async () => {
    const s = await newSession();
    assert.equal((await api('POST', `sessions/${s.id}/run-skill`, { cookie: MAIN, body: { skill_name: 'nope', inputs: { x: 'y' } } })).status, 400);
    await withScript(() => ({ content: 'Four frames coming up.' }), async () => {
        const start = await api('POST', `sessions/${s.id}/run-skill`, { cookie: MAIN, body: { skill_id: 'storyboard', skill_name: 'Storyboard', inputs: { premise: 'A cat learns to surf' }, model: 'gpt-5-mini' } });
        assert.equal(start.status, 200, JSON.stringify(start.body));
        await drain(start.body.job_id);
        const request = llm.state.requests[0];
        assert.match(request.messages[0].content, /The user pinned the skill "Storyboard"/);
        assert.match(request.messages.at(-1).content, /A cat learns to surf/);
    });
    const transcript = (await api('GET', `sessions/${s.id}/messages`, { cookie: MAIN })).body;
    assert.equal(transcript[0].skill_name, 'Storyboard');
    // A localized display name still resolves.
    await withScript(() => ({ content: 'ok' }), async () => {
        const start = await api('POST', `sessions/${s.id}/run-skill`, { cookie: MAIN, body: { skill_name: '故事板', inputs: { premise: '小猫学冲浪' } } });
        assert.equal(start.status, 200);
        await drain(start.body.job_id);
    });
});

test('cancel: a running job stops, reports cancelled and approve is refused', async () => {
    const s = await newSession();
    await withScript(() => ({ content: 'slow', delayMs: 400 }), async () => {
        const start = await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: 'take your time' } });
        const jobId = start.body.job_id;
        const running = await api('GET', `sessions/${s.id}/jobs`, { cookie: MAIN });
        assert.equal(running.body[0].status, 'processing');
        assert.equal((await api('POST', `jobs/${jobId}/approve`, { cookie: MAIN })).status, 409);
        const cancelled = await api('POST', `jobs/${jobId}/cancel`, { cookie: MAIN });
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.cancelled, true);
        assert.equal(cancelled.body.status, 'cancelled');
        const { final } = await drain(jobId);
        assert.equal(final.status, 'cancelled');
        assert.equal(final.done, true);
    });
});

test('security: jobs are bound to the browser session, the pipeline is not directly reachable, cross-site writes are refused', async () => {
    const s = await newSession();
    const start = await withScript(() => ({ content: 'hi' }), async () => {
        const res = await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: 'hello' } });
        await drain(res.body.job_id);
        return res;
    });
    const sameWorkspaceOtherBrowser = cookieFor('open');
    assert.equal((await api('GET', `jobs/${start.body.job_id}/events?since=0`, { cookie: sameWorkspaceOtherBrowser })).status, 404);
    assert.equal((await api('POST', `jobs/${start.body.job_id}/cancel`, { cookie: sameWorkspaceOtherBrowser })).status, 404);
    assert.deepEqual((await api('GET', `sessions/${s.id}/jobs`, { cookie: sameWorkspaceOtherBrowser })).body, []);
    assert.equal((await api('GET', 'jobs/not-a-job/events', { cookie: MAIN })).status, 404);
    const direct = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/design-agent-run', cookie: MAIN, body: { session_id: s.id, text: 'x' }, params: { path: ['design-agent-run'] } });
    assert.equal(direct.status, 404);
    const cross = await api('POST', 'sessions', { cookie: MAIN, body: {}, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);
    assert.equal((await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: '' } })).status, 400);
    const key = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
        const res = await api('POST', `sessions/${s.id}/chat`, { cookie: MAIN, body: { message: 'hi' } });
        assert.equal(res.status, 503);
        assert.equal(res.body.error, 'not_configured');
    } finally {
        process.env.OPENROUTER_API_KEY = key;
    }
});

test('budget: a used-up budget ends the run with the budget message; paid files are kept', async () => {
    const s = await newSession(cookieFor('tight-budget'));
    const cookie = cookieFor('tight-budget');
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0.06';
    try {
        const script = (body, n) => (n < 3 ? { tool_calls: [{ name: 'generate_image', args: { prompt: `poster ${n}` } }] } : { content: 'done' });
        const { events, final } = await withScript(script, async () => {
            const start = await api('POST', `sessions/${s.id}/chat`, { cookie, body: { message: 'three posters' } });
            assert.equal(start.status, 200, JSON.stringify(start.body));
            return drain(start.body.job_id, cookie);
        });
        assert.equal(final.status, 'failed');
        assert.match(final.error, /budget for today is used up/);
        assert.equal(events.filter((e) => e.type === 'tool_result' && e.payload.result.ok).length, 1);
        assert.match(events.at(-1).payload.message, /budget/);
        const budget = events.find((e) => e.type === 'budget');
        assert.equal(budget.payload.scope, 'session');
        assert.equal(budget.payload.capUsd, 0.06);
        const assets = (await api('GET', `sessions/${s.id}/assets`, { cookie })).body;
        assert.equal(assets.length, 1);
        const transcript = (await api('GET', `sessions/${s.id}/messages`, { cookie })).body;
        assert.ok(transcript.at(-1).events.some((e) => e.type === 'error' && /budget/.test(e.message)));
    } finally {
        delete process.env.AQUORA_SESSION_DAILY_BUDGET_USD;
    }
});
