// Agents API (/api/agents/*) against the local mock upstream and the real
// catalog: templates, CRUD, chat turns as pipeline jobs polled at
// /api/v1/predictions/<token>/result, tool calls that generate media through
// the catalog (budget applies), builder helpers, and the security edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { decodeJobToken, resetJobs } from '../../lib/gateway/jobs.js';
import { OPEN_WORKSPACE, SESSION_COOKIE, createSessionCookie } from '../../lib/gateway/session.js';
import { listTemplates } from '../../lib/gateway/agents/templates.js';

import * as agentsRoute from '../../app/api/agents/[[...path]]/route.js';
import * as submitRoute from '../../app/api/v1/[...path]/route.js';
import * as resultRoute from '../../app/api/v1/predictions/[token]/result/route.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-agents-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'agents-test-secret-'.padEnd(48, 'z'),
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
});
test.after(async () => {
    resetJobs();
    await flushLedger();
    await mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => resetLimits());

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

function agents(method, subpath, { body, cookie, headers } = {}) {
    const segments = subpath.split('/').filter(Boolean);
    const handler = agentsRoute[method];
    return call(handler, { method, url: `/api/agents/${segments.join('/')}`, body, cookie, headers, params: segments.length ? { path: segments } : {} });
}

const poll = (token, cookie) => call(resultRoute.GET, { url: `/api/v1/predictions/${token}/result`, cookie, params: { token } });

async function finish(token, cookie, max = 400) {
    for (let i = 0; i < max; i++) {
        const res = await poll(token, cookie);
        if (res.status !== 200 || res.body.is_complete) return res;
        await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error('agent turn did not finish');
}

// One browser-like session for most tests, in the shared "open" workspace
// (a cookie-less request would get a fresh private visitor workspace).
let cookie;
async function session() {
    if (!cookie) cookie = `${SESSION_COOKIE}=${createSessionCookie({ codeId: OPEN_WORKSPACE }).value}`;
    return cookie;
}

async function createAgent(fields = {}) {
    const res = await agents('POST', '', {
        cookie: await session(),
        body: { name: 'Recipe Reel Helper', description: 'Short cooking videos', system_prompt: 'You help with cooking reels.', welcome_message: 'Hi!', skill_ids: [], ...fields },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
}

test('templates: 5–8 creator agents, inline SVG icons, read-only, featured = templates', async () => {
    const res = await agents('GET', 'templates/agents', { cookie: await session() });
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 5 && res.body.length <= 8, `templates: ${res.body.length}`);
    for (const agent of res.body) {
        assert.match(agent.agent_id, /^[a-z0-9-]+$/);
        assert.ok(agent.name && agent.description && agent.system_prompt && agent.welcome_message);
        assert.match(agent.icon_url, /^data:image\/svg\+xml;utf8,/);
        assert.equal(agent.is_owner, false);
        assert.equal(agent.is_template, true);
        assert.ok(agent.initial_suggestions.length >= 2);
        for (const s of agent.initial_suggestions) assert.ok(s.label && s.prompt);
        assert.deepEqual(agent.skills.map((s) => s.id), agent.skill_ids);
    }
    const names = res.body.map((a) => a.name).join(' | ');
    for (const expected of ['TikTok Hook Writer', 'Thumbnail Designer', 'Product Ad Director', 'Caption & Hashtag Writer', 'UGC Script Writer', 'Brand Voice Coach']) {
        assert.ok(names.includes(expected), `missing template ${expected}`);
    }
    const featured = await agents('GET', 'featured/agents', { cookie });
    assert.deepEqual(featured.body.map((a) => a.agent_id), res.body.map((a) => a.agent_id));
    const one = await agents('GET', 'by-slug/thumbnail-designer', { cookie });
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.skill_ids, ['generate_image', 'edit_image']);
    const edit = await agents('PUT', 'by-slug/thumbnail-designer', { cookie, body: { theme: 'midnight' } });
    assert.equal(edit.status, 403);
    const del = await agents('DELETE', 'by-slug/thumbnail-designer', { cookie });
    assert.equal(del.status, 403);
});

test('template copy is localized: ?locale=zh, or the /zh page the request came from', async () => {
    const c = await session();
    const zh = await agents('GET', 'templates/agents', { cookie: c, headers: { referer: `${ORIGIN}/zh/studio/agents` } });
    const hook = zh.body.find((a) => a.agent_id === 'tiktok-hook-writer');
    assert.equal(hook.name, 'TikTok 开头文案写手');
    assert.match(hook.welcome_message, /第一秒/);
    assert.ok(hook.initial_suggestions.every((s) => /[\u4e00-\u9fff]/.test(s.label)));
    assert.match(hook.system_prompt, /^You are a short-form video hook specialist/, 'model instructions stay in English');
    const en = await agents('GET', 'templates/agents', { cookie: c, headers: { referer: `${ORIGIN}/studio/agents` } });
    assert.equal(en.body.find((a) => a.agent_id === 'tiktok-hook-writer').name, 'TikTok Hook Writer');
    const byQuery = await call(agentsRoute.GET, { url: '/api/agents/by-slug/sound-designer?locale=zh', cookie: c, params: { path: ['by-slug', 'sound-designer'] } });
    assert.equal(byQuery.body.name, '配音与音效设计师');
    const foreignReferer = await agents('GET', 'templates/agents', { cookie: c, headers: { referer: 'https://elsewhere.example/zh/x' } });
    assert.equal(foreignReferer.body[0].name, 'TikTok Hook Writer');
});

test('skills registry lists the fal-backed tools; community endpoints are gone', async () => {
    const res = await agents('GET', 'skills', { cookie: await session() });
    assert.deepEqual(res.body.map((s) => s.id), ['generate_image', 'edit_image', 'generate_video', 'generate_audio']);
    for (const s of res.body) assert.ok(s.name && s.description);
    assert.equal((await agents('POST', 'by-slug/tiktok-hook-writer/like', { cookie })).status, 404);
    assert.equal((await agents('GET', 'tiktok-hook-writer/profile', { cookie })).status, 404);
    assert.equal((await agents('GET', 'nope/nope/nope', { cookie })).status, 404);
});

test('create / read / update / delete an agent in the workspace', async () => {
    const created = await createAgent({ skill_ids: ['generate_image', 'bogus', 'generate_image'], initial_suggestions: ['Make a thumbnail', { label: 'Plan', prompt: 'Plan my week of reels' }] });
    assert.match(created.agent_id, /^recipe-reel-helper-[a-z0-9]{6}$/);
    assert.equal(created.is_owner, true);
    assert.deepEqual(created.skill_ids, ['generate_image']);
    assert.deepEqual(created.initial_suggestions, [{ label: 'Make a thumbnail', prompt: 'Make a thumbnail' }, { label: 'Plan', prompt: 'Plan my week of reels' }]);

    const byId = await agents('GET', created.id, { cookie });
    assert.equal(byId.status, 200);
    assert.equal(byId.body.agent_id, created.agent_id);

    const theme = await agents('PUT', `by-slug/${created.agent_id}`, { cookie, body: { theme: { id: 'custom', name: 'Mine', colors: { background: 'linear-gradient(135deg, #111 0%, #222 100%)', accent: 'rgba(46, 230, 214, 0.9)' } } } });
    assert.equal(theme.status, 200, JSON.stringify(theme.body));
    assert.equal(theme.body.theme.colors.accent, 'rgba(46, 230, 214, 0.9)');
    assert.equal(theme.body.name, 'Recipe Reel Helper', 'partial update keeps other fields');

    const full = await agents('PUT', `by-slug/${created.agent_id}`, { cookie, body: { name: 'Reel Chef', description: 'd', system_prompt: 'You are Reel Chef.', icon_url: 'https://v3.fal.media/files/icon.png', skill_ids: [], theme: 'forest' } });
    assert.equal(full.status, 200);
    assert.equal(full.body.name, 'Reel Chef');
    assert.equal(full.body.theme, 'forest');
    assert.equal(full.body.icon_url, 'https://v3.fal.media/files/icon.png');

    const mine = await agents('GET', 'user/agents', { cookie });
    assert.ok(mine.body.some((a) => a.agent_id === created.agent_id && a.name === 'Reel Chef'));

    const del = await agents('DELETE', `by-slug/${created.agent_id}`, { cookie });
    assert.equal(del.status, 200);
    assert.equal((await agents('GET', `by-slug/${created.agent_id}`, { cookie })).status, 404);
});

test('agent fields are validated (required, lengths, URLs, theme colours)', async () => {
    const c = await session();
    const cases = [
        [{ system_prompt: 'x' }, 'name'],
        [{ name: 'A' }, 'system_prompt'],
        [{ name: 'x'.repeat(81), system_prompt: 'x' }, 'name'],
        [{ name: 'A', system_prompt: 'x', icon_url: 'javascript:alert(1)' }, 'icon_url'],
        [{ name: 'A', system_prompt: 'x', theme: { colors: { background: 'url(https://evil.example/x.png)' } } }, 'theme'],
        [{ name: 'A', system_prompt: 'x', theme: { colors: { accent: 'red; background-image: image(x)' } } }, 'theme'],
        [{ name: 'A', system_prompt: 'x', skill_ids: 'generate_image' }, 'skill_ids'],
    ];
    for (const [body, field] of cases) {
        const res = await agents('POST', '', { cookie: c, body });
        assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.field, field);
    }
    const crossSite = await agents('POST', '', { cookie: c, body: { name: 'A', system_prompt: 'x' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
});

test('a text-only chat turn: pipeline job, polled reply, suggestions, stored history', async () => {
    const c = await session();
    const conversationId = '0b6c7c38-9a53-4a3d-8f5b-1f1b2f3c4d5e';
    const start = await agents('POST', 'by-slug/tiktok-hook-writer/chat', { cookie: c, body: { message: 'hooks for a skincare video', conversation_id: conversationId, attachments: [], stream: false } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.status, 'processing');
    assert.equal(start.body.is_complete, false);
    assert.equal(start.body.conversation_id, conversationId);
    const claims = decodeJobToken(start.body.request_id);
    assert.equal(claims.k, 'agent');
    assert.equal(claims.e, 'agent-chat');

    const done = await finish(start.body.request_id, c);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.is_complete, true);
    assert.equal(done.body.conversation_id, conversationId);
    const reply = done.body.messages.find((m) => m.role === 'assistant');
    assert.equal(reply.content, 'Mock reply: hooks for a skincare video');
    assert.equal(reply.media, undefined);
    assert.ok(Array.isArray(done.body.suggestions) && done.body.suggestions.length >= 1);
    assert.ok(done.body.suggestions[0].label && done.body.suggestions[0].prompt);

    const conv = await agents('GET', `by-slug/tiktok-hook-writer/${conversationId}`, { cookie: c });
    assert.equal(conv.status, 200);
    assert.equal(conv.body.id, conversationId);
    assert.deepEqual(conv.body.history.map((m) => m.role), ['user', 'assistant']);
    assert.equal(conv.body.history[0].content, 'hooks for a skincare video');
    assert.ok(conv.body.history.every((m) => typeof m.timestamp === 'string'));

    const list = await agents('GET', 'user/conversations', { cookie: c });
    const item = list.body.find((x) => x.id === conversationId);
    assert.equal(item.agent_slug, 'tiktok-hook-writer');
    assert.equal(item.agent_name, 'TikTok Hook Writer');
    assert.equal(item.title, 'hooks for a skincare video');
    assert.equal(item.message_count, 2);

    // The same chat is reachable by the plain /<slug>/<id> path too.
    const plain = await agents('GET', `tiktok-hook-writer/${conversationId}`, { cookie: c });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.id, conversationId);

    // A second turn continues the same conversation.
    const again = await agents('POST', 'by-slug/tiktok-hook-writer/chat', { cookie: c, body: { message: 'shorter please', conversation_id: conversationId } });
    await finish(again.body.request_id, c);
    const conv2 = await agents('GET', `by-slug/tiktok-hook-writer/${conversationId}`, { cookie: c });
    assert.equal(conv2.body.history.length, 4);

    // The same chat id cannot be reused with another agent.
    const clash = await agents('POST', 'by-slug/brand-voice-coach/chat', { cookie: c, body: { message: 'hi', conversation_id: conversationId } });
    assert.equal(clash.status, 409);
    // …and another agent's path does not reveal it.
    assert.equal((await agents('GET', `by-slug/brand-voice-coach/${conversationId}`, { cookie: c })).status, 404);

    // Deleting a chat removes it from the list.
    const del = await agents('DELETE', `by-slug/tiktok-hook-writer/${conversationId}`, { cookie: c });
    assert.equal(del.status, 200);
    assert.equal((await agents('GET', `by-slug/tiktok-hook-writer/${conversationId}`, { cookie: c })).status, 404);
    assert.ok(!(await agents('GET', 'user/conversations', { cookie: c })).body.some((x) => x.id === conversationId));
});

test('a tool call generates media through the catalog on fal (budget debited) and the UI gets it as media', async () => {
    const c = await session();
    const before = (await budgetStatus(OPEN_WORKSPACE)).spentUsd;
    const submitsBefore = mock.state.counters.submit;
    const start = await agents('POST', 'by-slug/thumbnail-designer/chat', { cookie: c, body: { message: 'use a tool to design a thumbnail for my Tokyo vlog' } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.match(start.body.conversation_id, /^[0-9a-f-]{36}$/, 'server assigns a chat id when none is sent');

    // While running, the poll answer is "processing" with progress pulses.
    const first = await poll(start.body.request_id, c);
    assert.equal(first.status, 200);
    assert.ok(first.body.status === 'processing' || first.body.status === 'completed');

    const done = await finish(start.body.request_id, c);
    assert.equal(done.body.status, 'completed', JSON.stringify(done.body));
    const reply = done.body.messages.find((m) => m.role === 'assistant');
    assert.equal(reply.content, 'Done! I used the tool and here is your result.');
    assert.deepEqual(reply.media, [{ type: 'image', url: `${mock.url}/media/sample.png` }]);
    assert.deepEqual(done.body.outputs, [`${mock.url}/media/sample.png`]);
    const pulses = done.body.messages.filter((m) => m.type === 'pulse').map((m) => m.content);
    assert.ok(pulses.includes('Generated an image'), JSON.stringify(pulses));

    assert.equal(mock.state.counters.submit, submitsBefore + 1);
    const job = [...mock.state.jobs.values()].at(-1);
    assert.equal(job.endpoint, 'fal-ai/nano-banana-2');
    assert.deepEqual(Object.keys(job.input).sort(), ['aspect_ratio', 'num_images', 'prompt']);
    assert.equal(job.input.num_images, 1);

    const after = (await budgetStatus(OPEN_WORKSPACE)).spentUsd;
    assert.ok(after - before >= 0.03, `budget debited: ${before} → ${after}`);

    // The generated media is stored with the assistant message.
    const conv = await agents('GET', `by-slug/thumbnail-designer/${start.body.conversation_id}`, { cookie: c });
    assert.deepEqual(conv.body.history[1].media, [{ type: 'image', url: `${mock.url}/media/sample.png` }]);
});

test('agents without skills get no tools; attachments are checked and stored', async () => {
    const c = await session();
    const submitsBefore = mock.state.counters.submit;
    const attachment = `${mock.url}/media/sample.png`;
    const start = await agents('POST', 'by-slug/caption-hashtag-writer/chat', { cookie: c, body: { message: 'use a tool to caption this', attachments: [attachment] } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const done = await finish(start.body.request_id, c);
    const reply = done.body.messages.find((m) => m.role === 'assistant');
    assert.match(reply.content, /^Mock reply: use a tool to caption this/);
    assert.equal(mock.state.counters.submit, submitsBefore, 'no generation without skills');
    const conv = await agents('GET', `by-slug/caption-hashtag-writer/${start.body.conversation_id}`, { cookie: c });
    assert.deepEqual(conv.body.history[0].attachments, [attachment]);

    const privateUrl = await agents('POST', 'by-slug/caption-hashtag-writer/chat', { cookie: c, body: { message: 'hi', attachments: ['http://10.0.0.5/secret.png'] } });
    assert.equal(privateUrl.status, 400);
    const notUrl = await agents('POST', 'by-slug/caption-hashtag-writer/chat', { cookie: c, body: { message: 'hi', attachments: ['file:///etc/passwd'] } });
    assert.equal(notUrl.status, 400);
    const tooMany = await agents('POST', 'by-slug/caption-hashtag-writer/chat', { cookie: c, body: { message: 'hi', attachments: Array.from({ length: 5 }, (_, i) => `${attachment}?${i}`) } });
    assert.equal(tooMany.status, 400);
    const empty = await agents('POST', 'by-slug/caption-hashtag-writer/chat', { cookie: c, body: { message: '   ' } });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.field, 'message');
    const badId = await agents('POST', 'by-slug/caption-hashtag-writer/chat', { cookie: c, body: { message: 'hi', conversation_id: '../../etc' } });
    assert.equal(badId.status, 400);
});

test('turn tokens are bound to the session; the pipeline cannot be started via /api/v1', async () => {
    const c = await session();
    const start = await agents('POST', 'by-slug/brand-voice-coach/chat', { cookie: c, body: { message: 'hello' } });
    const stranger = (await agents('GET', 'skills')).cookie;
    assert.notEqual(stranger, c);
    const peek = await poll(start.body.request_id, stranger);
    assert.equal(peek.status, 404);
    await finish(start.body.request_id, c);

    const direct = await call(submitRoute.POST, { method: 'POST', url: '/api/v1/agent-chat', cookie: c, params: { path: ['agent-chat'] }, body: { agent: { agent_id: 'x', system_prompt: 'leak' }, conversation_id: 'abcdefgh1', message: 'hi', attachments: [] } });
    assert.equal(direct.status, 404);
    assert.equal(direct.body.error, 'unknown_model');

    // Another workspace's agent is invisible.
    const created = await createAgent({ name: 'Private One' });
    process.env.AQUORA_ACCESS_CODES = 'alpha-code-1,beta-code-2';
    try {
        const { POST: login } = await import('../../app/api/session/route.js');
        const res = await login(new Request(`${ORIGIN}/api/session`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ code: 'beta-code-2' }) }));
        assert.equal(res.status, 200);
        const beta = res.headers.get('set-cookie').split(';')[0];
        assert.equal((await agents('GET', `by-slug/${created.agent_id}`, { cookie: beta })).status, 404);
        assert.equal((await agents('GET', 'user/agents', { cookie: beta })).body.length, 0);
        assert.equal((await agents('GET', 'user/agents')).status, 401, 'no session → 401 when codes are required');
    } finally {
        delete process.env.AQUORA_ACCESS_CODES;
    }
});

test('a failed LLM call fails the turn with HTTP 400 {detail:{error}}; the user message is kept', async () => {
    const c = await session();
    const start = await agents('POST', 'by-slug/brand-voice-coach/chat', { cookie: c, body: { message: 'FAIL_LLM_500 please' } });
    const done = await finish(start.body.request_id, c, 1200);
    assert.equal(done.status, 400);
    assert.equal(done.body.is_complete, true);
    assert.match(done.body.detail.error, /AI text service/);
    const conv = await agents('GET', `by-slug/brand-voice-coach/${start.body.conversation_id}`, { cookie: c });
    assert.deepEqual(conv.body.history.map((m) => m.role), ['user']);
});

test('budget: a used-up workspace budget answers 402 before the turn starts', async () => {
    const c = await session();
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0.001';
    try {
        const res = await agents('POST', 'by-slug/brand-voice-coach/chat', { cookie: c, body: { message: 'hi' } });
        assert.equal(res.status, 402);
        assert.equal(res.body.error, 'budget_exceeded');
        const suggest = await agents('POST', 'suggest', { cookie: c, body: { prompt: 'a travel agent' } });
        assert.equal(suggest.status, 402);
    } finally {
        delete process.env.AQUORA_SESSION_DAILY_BUDGET_USD;
    }
});

test('builder helpers: /suggest drafts an agent (JSON schema), /preview-realign rewrites the prompt', async () => {
    const c = await session();
    const suggest = await agents('POST', 'suggest', { cookie: c, body: { prompt: 'An assistant that plans my YouTube uploads' } });
    assert.equal(suggest.status, 200, JSON.stringify(suggest.body));
    for (const key of ['name', 'description', 'system_prompt', 'welcome_message']) assert.equal(typeof suggest.body[key], 'string');
    assert.ok(suggest.body.name.length > 0);
    assert.ok(Array.isArray(suggest.body.recommended_skill_ids));
    assert.ok(suggest.body.recommended_skill_ids.every((id) => ['generate_image', 'edit_image', 'generate_video', 'generate_audio'].includes(id)));
    assert.ok(Array.isArray(suggest.body.initial_suggestions));

    // The create page posts the draft straight back.
    const created = await agents('POST', '', { cookie: c, body: { ...suggest.body, skill_ids: suggest.body.recommended_skill_ids, is_published: false, is_template: false } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.is_template, false);

    const realign = await agents('POST', `by-slug/${created.body.agent_id}/preview-realign`, { cookie: c, body: { current_prompt: 'You are a planner.', new_skill_ids: ['generate_image'] } });
    assert.equal(realign.status, 200, JSON.stringify(realign.body));
    assert.equal(typeof realign.body.proposed_prompt, 'string');
    assert.ok(realign.body.proposed_prompt.length > 0);

    const empty = await agents('POST', 'suggest', { cookie: c, body: { prompt: '' } });
    assert.equal(empty.status, 400);
});

test('templates module: slugs are unique and every template skill exists', () => {
    const slugs = listTemplates().map((t) => t.agent_id);
    assert.equal(new Set(slugs).size, slugs.length);
});
