// Agent skills (OpenRouter tools → catalog → fal) and the chat prompt helpers,
// against the mock upstream and the real catalog.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyMockEnv, startMockUpstream } from '../../scripts/mock-upstream.mjs';
import { setCatalogForTesting } from '../../lib/gateway/catalogLoader.js';
import { budgetStatus, flushLedger, resetLimits } from '../../lib/gateway/limits.js';
import { resetJobs } from '../../lib/gateway/jobs.js';
import { listSkills, normalizeSkillIds, runToolCall, toolsForSkills } from '../../lib/gateway/agents/skills.js';
import { historyMessages, pulsesFrom, stripMediaLinks, systemPromptFor, userMessage, withoutImageParts } from '../../lib/gateway/agents/chat.js';
import { cleanTheme, isSafeColor } from '../../lib/gateway/agents/validate.js';
import { slugify } from '../../lib/gateway/agents/store.js';
import { listTemplates } from '../../lib/gateway/agents/templates.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-agent-tools-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_SESSION_SECRET: 'agent-tools-secret-'.padEnd(48, 'q'),
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

const session = { sid: 'tools-session', cid: 'tools-ws' };
const ALL = new Set(['generate_image', 'edit_image', 'generate_video', 'generate_audio']);

function env(known = []) {
    return { session, signal: new AbortController().signal, known: new Set(known), allowed: ALL };
}

function toolCall(name, args) {
    return { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function lastJob() {
    return [...mock.state.jobs.values()].at(-1);
}

test('tool definitions: one per skill, strict JSON schema objects, registry order', () => {
    const tools = toolsForSkills(['generate_audio', 'generate_image', 'nope']);
    assert.deepEqual(tools.map((t) => t.function.name), ['generate_image', 'generate_audio']);
    for (const tool of toolsForSkills([...ALL])) {
        assert.equal(tool.type, 'function');
        assert.equal(tool.function.parameters.type, 'object');
        assert.equal(tool.function.parameters.additionalProperties, false);
        assert.ok(tool.function.parameters.required.length >= 1);
        assert.ok(tool.function.description.length > 20);
    }
    assert.deepEqual(normalizeSkillIds(['edit_image', 'edit_image', 1, null, 'x']), ['edit_image']);
    assert.equal(listSkills().length, 4);
    for (const template of listTemplates()) assert.deepEqual(normalizeSkillIds(template.skill_ids), template.skill_ids);
});

test('generate_image → nano-banana-2 with a clean input; aspect ratios are snapped', async () => {
    const outcome = await runToolCall(toolCall('generate_image', { prompt: 'a neon sign that says "OPEN"', aspect_ratio: '16:9', extra: 'ignored' }), env());
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.equal(outcome.type, 'image');
    assert.deepEqual(outcome.media, [{ type: 'image', url: `${mock.url}/media/sample.png` }]);
    assert.equal(lastJob().endpoint, 'fal-ai/nano-banana-2');
    assert.deepEqual(lastJob().input, { prompt: 'a neon sign that says "OPEN"', aspect_ratio: '16:9', num_images: 1 });

    await runToolCall(toolCall('generate_image', { prompt: 'x', aspect_ratio: '7:3' }), env());
    assert.equal(lastJob().input.aspect_ratio, '1:1');
});

test('edit_image only accepts images from the conversation', async () => {
    const attached = `${mock.url}/media/sample.jpg`;
    const refused = await runToolCall(toolCall('edit_image', { prompt: 'make it blue', image_urls: ['https://example.com/cat.png'] }), env([attached]));
    assert.equal(refused.ok, false);
    assert.match(refused.error, /image the user attached/);

    const edited = await runToolCall(toolCall('edit_image', { prompt: 'make it blue', image_urls: [attached] }), env([attached]));
    assert.equal(edited.ok, true, JSON.stringify(edited));
    assert.equal(lastJob().endpoint, 'fal-ai/nano-banana-2/edit');
    assert.deepEqual(lastJob().input, { prompt: 'make it blue', image_urls: [attached], aspect_ratio: 'auto', num_images: 1 });
});

test('generate_video: text-to-video and image-to-video routes; one budget debit per clip', async () => {
    const before = (await budgetStatus(session.cid)).spentUsd;
    const t2v = await runToolCall(toolCall('generate_video', { prompt: 'waves at sunset', aspect_ratio: '9:16', duration: '5' }), env());
    assert.equal(t2v.ok, true, JSON.stringify(t2v));
    assert.deepEqual(t2v.media, [{ type: 'video', url: `${mock.url}/media/sample.mp4` }]);
    assert.equal(lastJob().endpoint, 'fal-ai/bytedance/seedance/v1/lite/text-to-video');
    assert.deepEqual(lastJob().input, { prompt: 'waves at sunset', duration: '5', resolution: '720p', aspect_ratio: '9:16' });

    const frame = `${mock.url}/media/sample.png`;
    const i2v = await runToolCall(toolCall('generate_video', { prompt: 'slow push in', image_url: frame, duration: '10' }), env([frame]));
    assert.equal(i2v.ok, true, JSON.stringify(i2v));
    assert.equal(lastJob().endpoint, 'fal-ai/bytedance/seedance/v1/lite/image-to-video');
    assert.equal(lastJob().input.image_url, frame);
    assert.equal(lastJob().input.duration, '10');

    const unknownFrame = await runToolCall(toolCall('generate_video', { prompt: 'x', image_url: 'https://example.com/a.png' }), env());
    assert.equal(unknownFrame.ok, false);

    const spent = (await budgetStatus(session.cid)).spentUsd - before;
    assert.ok(spent >= 0.4, `videos debited ${spent}`);
});

test('generate_audio: voiceover, music (instrumental by default) and sound effects', async () => {
    const voice = await runToolCall(toolCall('generate_audio', { type: 'voiceover', text: 'Welcome back to the channel!' }), env());
    assert.equal(voice.ok, true, JSON.stringify(voice));
    assert.equal(voice.media[0].type, 'audio');
    assert.equal(lastJob().endpoint, 'fal-ai/elevenlabs/tts/turbo-v2.5');
    assert.deepEqual(lastJob().input, { text: 'Welcome back to the channel!' });

    const music = await runToolCall(toolCall('generate_audio', { type: 'music', text: 'calm lo-fi beat', duration_seconds: 20 }), env());
    assert.equal(music.ok, true, JSON.stringify(music));
    assert.equal(lastJob().endpoint, 'minimax/music-3');
    assert.deepEqual(lastJob().input, { prompt: 'calm lo-fi beat', lyrics: '[instrumental]', duration: 20 });

    const sfx = await runToolCall(toolCall('generate_audio', { type: 'sound_effect', text: 'cinematic whoosh', duration_seconds: 90 }), env());
    assert.equal(sfx.ok, true, JSON.stringify(sfx));
    assert.equal(lastJob().endpoint, 'fal-ai/mmaudio-v2/text-to-audio');
    assert.deepEqual(lastJob().input, { prompt: 'cinematic whoosh', duration: 30 });
});

test('tool errors come back to the model instead of failing the turn', async () => {
    const notAllowed = await runToolCall(toolCall('generate_video', { prompt: 'x' }), { ...env(), allowed: new Set(['generate_image']) });
    assert.equal(notAllowed.ok, false);
    assert.match(notAllowed.error, /not enabled/);
    const badJson = await runToolCall({ id: 'c', function: { name: 'generate_image', arguments: '{not json' } }, env());
    assert.equal(badJson.ok, false);
    const noPrompt = await runToolCall(toolCall('generate_image', { prompt: '  ' }), env());
    assert.equal(noPrompt.ok, false);
    assert.match(noPrompt.error, /prompt is required/);
    const policy = await runToolCall(toolCall('generate_image', { prompt: 'FAIL_POLICY' }), env());
    assert.equal(policy.ok, false);
    assert.match(policy.error, /safety filter/);

    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0.01';
    try {
        const broke = await runToolCall(toolCall('generate_image', { prompt: 'x' }), env());
        assert.equal(broke.ok, false);
        assert.equal(broke.code, 'budget_exceeded');
    } finally {
        delete process.env.AQUORA_SESSION_DAILY_BUDGET_USD;
    }

    const controller = new AbortController();
    controller.abort(Object.assign(new Error('cancelled'), { name: 'GatewayError', status: 499, code: 'cancelled' }));
    await assert.rejects(runToolCall(toolCall('generate_image', { prompt: 'x' }), { ...env(), signal: controller.signal }));
});

test('prompt helpers: system prompt, history window, vision parts, link stripping', () => {
    const withTools = systemPromptFor({ name: 'Thumbs', system_prompt: 'You design thumbnails.', skill_ids: ['generate_image'] });
    assert.match(withTools, /^You design thumbnails\./);
    assert.match(withTools, /generate_image/);
    assert.match(withTools, /never paste their links/);
    const textOnly = systemPromptFor({ name: 'Writer', system_prompt: '', skill_ids: [] });
    assert.match(textOnly, /You are Writer/);
    assert.match(textOnly, /can't create images/);

    const history = [
        { role: 'assistant', content: 'welcome' },
        { role: 'user', content: 'make a cat', attachments: ['https://v3.fal.media/files/in.png'] },
        { role: 'assistant', content: 'Here you go', media: [{ type: 'image', url: 'https://v3.fal.media/files/out.png' }] },
        { role: 'system', content: 'ignored' },
    ];
    const msgs = historyMessages(history);
    assert.equal(msgs[0].role, 'user', 'history starts with a user turn');
    assert.match(msgs[0].content, /\[Attached image: https:\/\/v3\.fal\.media\/files\/in\.png\]/);
    assert.match(msgs[1].content, /\[Generated image: https:\/\/v3\.fal\.media\/files\/out\.png\]/);
    const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    assert.ok(historyMessages(long).length <= 24);
    assert.equal(historyMessages(long).at(-1).content, 'm59');

    const vision = userMessage('what is this?', ['https://v3.fal.media/a.png', 'http://127.0.0.1:9/b.png']);
    assert.equal(vision.content[0].type, 'text');
    assert.deepEqual(vision.content.slice(1), [{ type: 'image_url', image_url: { url: 'https://v3.fal.media/a.png' } }]);
    assert.match(vision.content[0].text, /Attached image: http:\/\/127\.0\.0\.1:9\/b\.png/);
    assert.equal(typeof userMessage('hi', []).content, 'string');
    const textOnlyTurn = withoutImageParts([{ role: 'system', content: 's' }, vision]);
    assert.equal(textOnlyTurn[0].content, 's');
    assert.equal(typeof textOnlyTurn[1].content, 'string');
    assert.match(textOnlyTurn[1].content, /what is this\?/);
    assert.match(textOnlyTurn[1].content, /Attached image: https:\/\/v3\.fal\.media\/a\.png/);

    const url = 'https://v3.fal.media/files/x (1).png';
    const stripped = stripMediaLinks(`Here it is:\n\n![thumb](${url})\n\nAlso [link](${url}) and ${url}. Keep https://aquora.app ok.`, [{ url }]);
    assert.equal(stripped, 'Here it is:\n\nAlso link and . Keep https://aquora.app ok.');
});

test('live progress lines: pulses are added, rewritten when done, removed on failure', () => {
    const events = [
        { id: 1, type: 'pulse', payload: { content: 'Sure — making it now' } },
        { id: 2, type: 'pulse', payload: { content: 'Generating an image…' } },
        { id: 3, type: 'tool_result', payload: {} },
        { id: 4, type: 'pulse_update', payload: { id: 2, content: 'Generated an image' } },
        { id: 5, type: 'pulse', payload: { content: 'Generating a video…' } },
        { id: 6, type: 'pulse_update', payload: { id: 5, content: null } },
        { id: 7, type: 'pulse', payload: { content: "Couldn't finish: budget" } },
        { id: 8, type: 'pulse_update', payload: { id: 99, content: 'ignored' } },
    ];
    assert.deepEqual(pulsesFrom(events).map((p) => p.content), ['Sure — making it now', 'Generated an image', "Couldn't finish: budget"]);
    assert.deepEqual(pulsesFrom(undefined), []);
});

test('validation helpers: colours, themes, slugs', () => {
    assert.ok(isSafeColor('#fff'));
    assert.ok(isSafeColor('radial-gradient(circle at 50% -20%, #1e293b 0%, #0b0f1a 80%)'));
    assert.ok(isSafeColor('rgba(255, 255, 255, 0.1)'));
    assert.equal(isSafeColor('url(https://x)'), false);
    assert.equal(isSafeColor('var(--x)'), false);
    assert.equal(isSafeColor('red;}body{display:none'), false);
    assert.equal(isSafeColor('expression(alert(1))'), false);
    assert.equal(cleanTheme(undefined), 'cosmic');
    assert.equal(cleanTheme('ocean'), 'ocean');
    assert.throws(() => cleanTheme('<script>'), (e) => e.status === 400);
    assert.deepEqual(cleanTheme({ colors: { accent: '#123456', evil: 'url(x)' } }), { id: 'custom', name: 'Custom Theme', colors: { accent: '#123456' } });
    assert.equal(slugify('  Crème Brûlée Coach!! '), 'creme-brulee-coach');
    assert.equal(slugify('日本語'), 'agent');
});
