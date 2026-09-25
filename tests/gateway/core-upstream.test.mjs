// Gateway core: provider-neutral upstream helpers (lib/upstream.js), the
// JSON store, SSRF checks and the OpenRouter request helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { backoffMs, mapProxyError, normalizeUpstream, sleep } from '../../lib/upstream.js';
import * as store from '../../lib/gateway/store.js';
import { assertPublicMediaUrl, isPrivateAddress, parsePublicUrl, privateIpv4, privateIpv6, safeFetch } from '../../lib/gateway/ssrf.js';
import { createSseParser, parseJsonReply, resolveModel, sanitizeMessages } from '../../lib/gateway/openrouter.js';
import { dataDir, storageKind, trustedMediaHosts } from '../../lib/gateway/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-store-'));
process.env.AQUORA_DATA_DIR = tmp;
process.env.AQUORA_LOG_LEVEL = 'silent';
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('normalizeUpstream: JSON passes through, HTML becomes a tag-free envelope', () => {
    assert.deepEqual(normalizeUpstream(200, '{"ok":true}'), { status: 200, body: { ok: true } });
    const html = normalizeUpstream(502, '<html><body><h1>502 Bad Gateway</h1></body></html>');
    assert.equal(html.status, 502);
    assert.equal(html.body.error, 'upstream_unavailable');
    assert.ok(!html.body.detail.includes('<'));
    assert.equal(normalizeUpstream(403, 'nope').status, 403);
    assert.equal(normalizeUpstream(200, '<html>maintenance</html>').status, 502);
    assert.deepEqual(normalizeUpstream(204, ''), { status: 204, body: null });
    assert.deepEqual(normalizeUpstream(200, ''), { status: 200, body: {} });
});

test('mapProxyError: timeouts 504, network failures 502 without internal detail', () => {
    assert.equal(mapProxyError({ name: 'TimeoutError' }).status, 504);
    assert.equal(mapProxyError({ name: 'AbortError' }).status, 504);
    const net = mapProxyError(new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.1:443'));
    assert.equal(net.status, 502);
    assert.equal(net.body.error, 'upstream_unreachable');
    assert.ok(!JSON.stringify(net.body).includes('10.0.0.1'));
});

test('sleep honours abort signals; backoff grows', async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await assert.rejects(pending);
    assert.ok(backoffMs(3) > backoffMs(0) / 2);
    assert.ok(backoffMs(10) <= 8000);
});

test('store: put/get/update/list/del with atomic files under AQUORA_DATA_DIR', async () => {
    assert.equal(dataDir(), path.resolve(tmp));
    await store.put('things', 'a1', { n: 1 });
    await store.put('things', 'a2', { n: 2 });
    await store.put('things', 'b1', { n: 3 });
    assert.deepEqual(await store.get('things', 'a1'), { n: 1 });
    assert.equal(await store.get('things', 'missing'), null);
    assert.ok(fs.existsSync(path.join(tmp, 'things', 'a1.json')));
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'things')).filter((f) => f.endsWith('.tmp')), [], 'no temp files left');
    const prefixed = await store.list('things', { prefix: 'a', sort: (x, y) => x.n - y.n });
    assert.deepEqual(prefixed.map((d) => d.n), [1, 2]);
    assert.deepEqual((await store.list('things', { filter: (d) => d.n > 1 })).map((d) => d.n).sort(), [2, 3]);
    // Concurrent read-modify-write never loses an increment.
    await store.put('counters', 'c', { n: 0 });
    await Promise.all(Array.from({ length: 25 }, () => store.update('counters', 'c', (doc) => ({ n: doc.n + 1 }))));
    assert.equal((await store.get('counters', 'c')).n, 25);
    await store.del('things', 'a1');
    assert.equal(await store.get('things', 'a1'), null);
    assert.deepEqual(await store.list('nothing-here'), []);
});

test('store: workspaces are isolated and ids are validated', async () => {
    const ws1 = store.forWorkspace('ws1');
    const ws2 = store.forWorkspace('ws2');
    await ws1.put('agents', 'x', { owner: 1 });
    assert.equal(await ws2.get('agents', 'x'), null);
    assert.deepEqual(await ws1.get('agents', 'x'), { owner: 1 });
    assert.ok(fs.existsSync(path.join(tmp, 'ws', 'ws1', 'agents', 'x.json')));
    for (const bad of ['../escape', 'a/b', '', '.hidden', 'x'.repeat(200), 'a..b']) {
        await assert.rejects(store.get('agents', bad), (e) => e.status === 400, bad);
    }
    assert.throws(() => store.forWorkspace('../../etc'));
    await assert.rejects(store.put('../up', 'x', {}), (e) => e.status === 400);
});

test('storage kind: explicit data dir is persistent; Railway without a volume is ephemeral', () => {
    assert.equal(storageKind(), 'persistent');
    const saved = { dir: process.env.AQUORA_DATA_DIR, rail: process.env.RAILWAY_ENVIRONMENT, vol: process.env.RAILWAY_VOLUME_MOUNT_PATH };
    try {
        delete process.env.AQUORA_DATA_DIR;
        process.env.RAILWAY_ENVIRONMENT = 'production';
        if (!fs.existsSync('/data')) assert.equal(storageKind(), 'ephemeral');
        process.env.RAILWAY_VOLUME_MOUNT_PATH = path.dirname(dataDir());
        assert.equal(storageKind(), 'persistent', 'data dir on the mounted volume');
    } finally {
        process.env.AQUORA_DATA_DIR = saved.dir;
        if (saved.rail === undefined) delete process.env.RAILWAY_ENVIRONMENT; else process.env.RAILWAY_ENVIRONMENT = saved.rail;
        if (saved.vol === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH; else process.env.RAILWAY_VOLUME_MOUNT_PATH = saved.vol;
    }
});

test('SSRF: private, loopback, link-local, metadata and mapped addresses are private', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1']) {
        assert.equal(privateIpv4(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '151.101.1.1']) assert.equal(privateIpv4(ip), false, ip);
    for (const ip of ['::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '2002:c0a8::1', '64:ff9b::a00:1', 'ff02::1']) {
        assert.equal(privateIpv6(ip), true, ip);
    }
    assert.equal(privateIpv6('2606:4700::1111'), false);
    assert.equal(isPrivateAddress('10.0.0.1', 4), true);
    assert.equal(isPrivateAddress('2606:4700::1111', 6), false);
});

test('SSRF: media URLs must be public http(s) without credentials', async () => {
    const bad = async (url) => assert.rejects(assertPublicMediaUrl(url, { field: 'image_url' }), (e) => e.status === 400 && e.field === 'image_url', url);
    await bad('file:///etc/passwd');
    await bad('ftp://example.com/x.png');
    await bad('javascript:alert(1)');
    await bad('http://127.0.0.1/x.png');
    await bad('http://[::1]/x.png');
    await bad('http://169.254.169.254/latest/meta-data');
    await bad('http://10.0.0.5/x.png');
    await bad('http://localhost:3000/x.png');
    await bad('http://metadata.google.internal/');
    await bad('http://printer.local/');
    await bad('https://user:pass@v3.fal.media/x.png');
    await bad('not a url');
    await bad('');
    // fal's CDN is trusted without a DNS lookup.
    assert.ok(await assertPublicMediaUrl('https://v3.fal.media/files/a/b.png'));
    assert.ok(await assertPublicMediaUrl('https://v3b.fal.media/files/b/c.mp4'));
    assert.ok(await assertPublicMediaUrl('https://8.8.8.8/x.png'), 'public IP literal');
    assert.throws(() => parsePublicUrl('https://'), (e) => e.status === 400);
});

test('SSRF: configured upstream hosts (the local mock) are trusted, others are not', async () => {
    const saved = process.env.FAL_REST_BASE;
    process.env.FAL_REST_BASE = 'http://127.0.0.1:4999/fal-rest';
    try {
        assert.ok(trustedMediaHosts().has('127.0.0.1'));
        assert.ok(await assertPublicMediaUrl('http://127.0.0.1:4999/files/x.png'));
    } finally {
        if (saved === undefined) delete process.env.FAL_REST_BASE; else process.env.FAL_REST_BASE = saved;
    }
    await assert.rejects(assertPublicMediaUrl('http://127.0.0.1:4999/files/x.png'));
});

test('safeFetch refuses private targets before connecting', async () => {
    await assert.rejects(safeFetch('http://127.0.0.1:1/'), (e) => e.status === 400);
    await assert.rejects(safeFetch('http://[::ffff:10.0.0.1]/'), (e) => e.status === 400);
});

test('OpenRouter helpers: model allowlist, message validation, JSON + SSE parsing', () => {
    assert.equal(resolveModel({ purpose: 'fast' }), 'openai/gpt-6-luna');
    assert.equal(resolveModel({ purpose: 'agent' }), 'anthropic/claude-sonnet-5');
    assert.equal(resolveModel({ purpose: 'vision' }), 'google/gemini-3.8-flash');
    assert.throws(() => resolveModel({ model: 'openai/gpt-4-32k-expensive' }), (e) => e.status === 400 && e.code === 'model_not_allowed');
    process.env.OPENROUTER_ALLOWED_MODELS = 'deepseek/deepseek-v4.1-flash';
    try {
        assert.equal(resolveModel({ model: 'deepseek/deepseek-v4.1-flash' }), 'deepseek/deepseek-v4.1-flash');
    } finally {
        delete process.env.OPENROUTER_ALLOWED_MODELS;
    }

    assert.deepEqual(sanitizeMessages([{ role: 'user', content: 'hi', extra: 'dropped' }]), [{ role: 'user', content: 'hi' }]);
    assert.throws(() => sanitizeMessages([]), (e) => e.status === 400);
    assert.throws(() => sanitizeMessages([{ role: 'tool', content: 'x' }]), (e) => e.field === 'messages[0].role', 'browser cannot send tool messages');
    assert.ok(sanitizeMessages([{ role: 'tool', content: 'x', tool_call_id: 'c1' }], { trusted: true })[0].tool_call_id);
    assert.throws(() => sanitizeMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://10.0.0.1/x.png' } }] }]), (e) => e.status === 400);
    assert.ok(sanitizeMessages([{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'https://v3.fal.media/x.png', detail: 'low' } }] }]));
    assert.throws(() => sanitizeMessages([{ role: 'user', content: 'x'.repeat(400_001) }]), (e) => e.status === 413);

    assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonReply('Sure! {"b":[1,2]} hope that helps'), { b: [1, 2] });
    assert.equal(parseJsonReply('no json here'), null);

    const events = [];
    const parse = createSseParser((e) => events.push(e));
    parse(': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"Hel');
    parse('lo"}}]}\n\ndata: {"usage":{"cost":0.002}}\n\ndata: [DONE]\n\n');
    assert.equal(events.length, 2);
    assert.equal(events[0].choices[0].delta.content, 'Hello');
    assert.equal(events[1].usage.cost, 0.002);
});
