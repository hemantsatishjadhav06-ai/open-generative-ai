// Security regressions: sign-in, client IPs, uploads, SSRF and sign-out.
//   - X-Real-IP from a client is ignored unless the operator configures it.
//   - no global login bucket: failed guesses can't lock other people out.
//   - production ignores weak access codes.
//   - the upload route cuts a chunked body off at the cap, and limits
//     concurrent uploads per session.
//   - IPv4-compatible / Teredo / site-local IPv6 forms are private.
//   - signing out revokes the session server-side (also after a restart).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { accessCodes, gateMode, weakAccessCodeCount } from '../../lib/gateway/config.js';
import { acquireUploadSlot, clientIp, flushLedger, ipPrefix, resetLimits } from '../../lib/gateway/limits.js';
import { resetRevocations, SESSION_COOKIE } from '../../lib/gateway/session.js';
import { assertPublicMediaUrl, privateIpv6 } from '../../lib/gateway/ssrf.js';
import { limitBody } from '../../lib/gateway/http.js';
import { MAX_UPLOAD_REQUEST_BYTES } from '../../lib/uploadPolicy.js';
import * as sessionRoute from '../../app/api/session/route.js';
import * as uploadRoute from '../../app/api/v1/upload_file/route.js';
import * as llmRoute from '../../app/api/llm/chat/route.js';

const CODE = 'Correct-Horse-9f3k2';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-sec-web-'));
Object.assign(process.env, {
    AQUORA_DATA_DIR: dataDir,
    AQUORA_ACCESS_CODES: CODE,
    AQUORA_SESSION_SECRET: 'security-web-secret-'.padEnd(48, 'w'),
    AQUORA_LOG_LEVEL: 'silent',
    FAL_KEY: 'test-fal',
    OPENROUTER_API_KEY: 'test-or',
    // Nothing listens here: no test in this file may reach an upstream.
    FAL_REST_BASE: 'http://127.0.0.1:9/rest',
    OPENROUTER_BASE_URL: 'http://127.0.0.1:9/or',
});
delete process.env.NODE_ENV;
delete process.env.AQUORA_CLIENT_IP_HEADER;
delete process.env.AQUORA_TRUSTED_PROXY_HOPS;

const ORIGIN = 'http://localhost:3000';
const sameOrigin = { host: 'localhost:3000', origin: ORIGIN, 'sec-fetch-site': 'same-origin' };

test.after(async () => {
    await flushLedger();
    fs.rmSync(dataDir, { recursive: true, force: true });
});
test.beforeEach(() => resetLimits());

async function login(code, headers = {}) {
    const res = await sessionRoute.POST(new Request(`${ORIGIN}/api/session`, {
        method: 'POST',
        headers: { ...sameOrigin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ code }),
    }), {});
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    return { status: res.status, cookie };
}

// ── client IP ───────────────────────────────────────────────────────────────
test('a client-sent X-Real-IP cannot rotate the per-IP login limit', async () => {
    const statuses = [];
    for (let i = 0; i < 8; i++) {
        statuses.push((await login('wrong-code-guess', { 'x-real-ip': `198.18.0.${i}`, 'x-forwarded-for': '192.0.2.50' })).status);
    }
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.ok(statuses.slice(5).every((s) => s === 429), statuses.join(','));
    assert.equal(clientIp(new Request('http://x/', { headers: { 'x-real-ip': '6.6.6.6' } })), 'unknown');
});

test('AQUORA_TRUSTED_PROXY_HOPS=0 trusts no forwarding header at all', () => {
    process.env.AQUORA_TRUSTED_PROXY_HOPS = '0';
    try {
        assert.equal(clientIp(new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4' } })), 'unknown');
    } finally {
        delete process.env.AQUORA_TRUSTED_PROXY_HOPS;
    }
});

// ── login lockout ──────────────────────────────────────────────────────────
test('60 wrong guesses from many networks do not lock a real user out', async () => {
    for (let i = 0; i < 70; i++) {
        const res = await login(`guess-${i}-xxxxxxxx`, { 'x-forwarded-for': `198.51.${i}.7` });
        assert.equal(res.status, 401, `guess ${i}`);
    }
    const real = await login(CODE, { 'x-forwarded-for': '203.0.113.200' });
    assert.equal(real.status, 200);
    assert.match(real.cookie, new RegExp(`^${SESSION_COOKIE}=`));
});

test('failed guesses are limited per network prefix, not globally', async () => {
    assert.equal(ipPrefix('203.0.113.9'), '203.0.113.0/24');
    assert.equal(ipPrefix('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
    for (let i = 0; i < 20; i++) assert.equal((await login('nope-nope-nope', { 'x-forwarded-for': `192.0.2.${i}` })).status, 401);
    assert.equal((await login(CODE, { 'x-forwarded-for': '192.0.2.99' })).status, 429, 'same /24 is slowed down');
    assert.equal((await login(CODE, { 'x-forwarded-for': '192.0.3.1' })).status, 200, 'another network is not');
});

// ── access code strength ───────────────────────────────────────────────────
test('production ignores weak access codes and needs setup when only weak ones exist', () => {
    const saved = { codes: process.env.AQUORA_ACCESS_CODES, env: process.env.NODE_ENV };
    process.env.NODE_ENV = 'production';
    const warn = console.warn;
    const warnings = [];
    console.warn = (line) => warnings.push(String(line));
    try {
        process.env.AQUORA_ACCESS_CODES = `1234,aaaaaaaaaaaaaaaa,${CODE}`;
        assert.deepEqual(accessCodes(), [CODE]);
        assert.equal(weakAccessCodeCount(), 2);
        assert.equal(gateMode(), 'codes');
        assert.ok(warnings.some((w) => /ignoring 2 weak/.test(w)));
        assert.ok(!warnings.some((w) => w.includes('1234')), 'never logs a code');
        process.env.AQUORA_ACCESS_CODES = '1234,password';
        assert.deepEqual(accessCodes(), []);
        assert.equal(gateMode(), 'setup_required');
    } finally {
        console.warn = warn;
        process.env.AQUORA_ACCESS_CODES = saved.codes;
        if (saved.env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = saved.env;
    }
});

// ── uploads ─────────────────────────────────────────────────────────────────
test('limitBody errors as soon as a stream passes the cap', async () => {
    const source = new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1024)); },
    });
    const limited = limitBody(source, 10 * 1024);
    const reader = limited.stream.getReader();
    let got = 0;
    await assert.rejects(async () => {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            got += value.byteLength;
        }
    }, (e) => e.status === 413);
    assert.ok(limited.exceeded());
    assert.ok(got <= 10 * 1024);
});

test('a chunked upload over the cap is refused with 413 without reading it all', async () => {
    const { cookie } = await login(CODE, { 'x-forwarded-for': '198.18.5.1' });
    let pulled = 0;
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('--b\r\nContent-Disposition: form-data; name="file"; filename="z.mp4"\r\nContent-Type: video/mp4\r\n\r\n'));
        },
        pull(controller) {
            pulled += chunk.byteLength;
            if (pulled > 400 * 1024 * 1024) return controller.close();
            controller.enqueue(chunk);
        },
    });
    const res = await uploadRoute.POST(new Request(`${ORIGIN}/api/v1/upload_file`, {
        method: 'POST',
        headers: { ...sameOrigin, cookie, 'content-type': 'multipart/form-data; boundary=b' },
        body,
        duplex: 'half',
    }), {});
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error, 'payload_too_large');
    assert.ok(pulled < MAX_UPLOAD_REQUEST_BYTES + 32 * 1024 * 1024, `stopped reading near the cap (${Math.round(pulled / 1048576)} MB)`);
});

test('each session may run only two uploads at once', () => {
    const session = { sid: 'sid-up', cid: 'ws-up' };
    const a = acquireUploadSlot(session);
    const b = acquireUploadSlot(session);
    assert.throws(() => acquireUploadSlot(session), (e) => e.status === 429 && e.code === 'too_many_uploads');
    a();
    a();
    const c = acquireUploadSlot(session);
    b();
    c();
});

// ── SSRF ────────────────────────────────────────────────────────────────────
test('IPv4-compatible, Teredo and site-local IPv6 media URLs are refused', async () => {
    for (const url of ['http://[::7f00:1]/', 'http://[::a9fe:a9fe]/', 'http://[2001::a9fe:a9fe]/', 'http://[fec0::1]/', 'http://[::ffff:7f00:1]/', 'http://[64:ff9b::a9fe:a9fe]/']) {
        await assert.rejects(assertPublicMediaUrl(url, { field: 'image_url' }), (e) => e.status === 400, url);
    }
    for (const address of ['::127.0.0.1', '100::1', '2001:db8::5', 'ff02::1', '3fff::1']) assert.equal(privateIpv6(address), true, address);
    for (const address of ['2606:4700::1111', '2a00:1450:4001:82a::200e', '::ffff:8.8.8.8']) assert.equal(privateIpv6(address), false, address);
});

// ── sign-out revocation ────────────────────────────────────────────────────
test('signing out revokes the old cookie, also after a restart', async () => {
    const { cookie } = await login(CODE, { 'x-forwarded-for': '198.18.9.9' });
    const me = () => sessionRoute.GET(new Request(`${ORIGIN}/api/session`, { headers: { ...sameOrigin, cookie } }), {}).then((r) => r.json());
    assert.equal((await me()).authenticated, true);
    const out = await sessionRoute.DELETE(new Request(`${ORIGIN}/api/session`, { method: 'DELETE', headers: { ...sameOrigin, cookie } }), {});
    assert.equal(out.status, 200);
    assert.equal((await me()).authenticated, false, 'the copied cookie no longer signs in');
    const paid = () => llmRoute.POST(new Request(`${ORIGIN}/api/llm/chat`, {
        method: 'POST',
        headers: { ...sameOrigin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
    }), {});
    assert.equal((await paid()).status, 401);
    resetRevocations(); // a fresh process reloads the list from the store
    assert.equal((await paid()).status, 401);
    assert.equal((await me()).authenticated, false);
    // A new sign-in works as usual.
    const again = await login(CODE, { 'x-forwarded-for': '198.18.9.10' });
    assert.equal(again.status, 200);
});
