// Gateway core: job tokens (HMAC + session binding) and the pipeline job registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    appendEvent,
    cancelJob,
    createJob,
    decodeJobToken,
    finishJob,
    getJob,
    loadJob,
    readEvents,
    resetJobs,
    signJobToken,
    verifyJobToken,
} from '../../lib/gateway/jobs.js';
import { isGatewayError } from '../../lib/gateway/errors.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-jobs-'));
process.env.AQUORA_DATA_DIR = dataDir;
process.env.AQUORA_SESSION_SECRET = 's'.repeat(48);
process.env.FAL_QUEUE_BASE = 'https://queue.fal.run';

test.after(() => {
    resetJobs();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

const claims = {
    k: 'fal',
    e: 'fal-ai/flux/dev',
    m: 'flux-dev-image',
    r: 'req-123',
    su: 'https://queue.fal.run/fal-ai/flux/requests/req-123/status',
    ru: 'https://queue.fal.run/fal-ai/flux/requests/req-123',
    cu: 'https://queue.fal.run/fal-ai/flux/requests/req-123/cancel',
    sid: 'session-aaaaaaaa',
    j: 'ledger-1',
    w: 'ws1',
    u: 0.04,
    d: '2026-09-24',
};

test('token round-trips and compacts fal URLs', () => {
    const token = signJobToken(claims);
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(!token.includes('queue.fal.run'), 'URLs are stored relative to the queue base');
    const decoded = verifyJobToken(token, claims.sid);
    for (const key of ['k', 'e', 'm', 'r', 'su', 'ru', 'cu', 'sid', 'j', 'w', 'u', 'd']) assert.equal(decoded[key], claims[key], key);
    assert.ok(Number.isFinite(decoded.t));
});

test('a token only works for the session that created it (404, not 403)', () => {
    const token = signJobToken(claims);
    assert.throws(() => verifyJobToken(token, 'someone-else-1'), (e) => isGatewayError(e) && e.status === 404);
    assert.throws(() => verifyJobToken(token, ''), (e) => e.status === 404);
});

test('tampering with any byte of the payload or signature is detected', () => {
    const token = signJobToken(claims);
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const swapUrl = Buffer.from(JSON.stringify({ ...payload, su: 'https://evil.example/steal' })).toString('base64url');
    assert.equal(decodeJobToken(`${swapUrl}.${sig}`), null, 'URL swap');
    const swapSid = Buffer.from(JSON.stringify({ ...payload, sid: 'attacker-12345' })).toString('base64url');
    assert.equal(decodeJobToken(`${swapSid}.${sig}`), null, 'sid swap');
    assert.equal(decodeJobToken(`${body}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`), null, 'signature flip');
    assert.equal(decodeJobToken(`${body}`), null);
    assert.equal(decodeJobToken(`${body}.${sig}.x`), null);
    assert.equal(decodeJobToken('x'.repeat(5000)), null);
    assert.equal(decodeJobToken(null), null);
});

test('tokens signed with another secret, of unknown kind or expired are rejected', () => {
    const token = signJobToken(claims);
    const saved = process.env.AQUORA_SESSION_SECRET;
    process.env.AQUORA_SESSION_SECRET = 'z'.repeat(48);
    try {
        assert.equal(decodeJobToken(token), null);
    } finally {
        process.env.AQUORA_SESSION_SECRET = saved;
    }
    assert.throws(() => signJobToken({ ...claims, k: 'shell' }));
    const old = signJobToken({ ...claims, t: Date.now() - 8 * 24 * 60 * 60_000 });
    assert.equal(decodeJobToken(old), null, 'older than 7 days');
});

test('rotation: a token signed with the previous secret still verifies', () => {
    const token = signJobToken(claims);
    const saved = process.env.AQUORA_SESSION_SECRET;
    process.env.AQUORA_SESSION_SECRET = `${'n'.repeat(48)},${saved}`;
    try {
        assert.ok(decodeJobToken(token));
    } finally {
        process.env.AQUORA_SESSION_SECRET = saved;
    }
});

test('pipeline registry: events with cursor, finish, cancel, persistence', async () => {
    const job = createJob({ name: 'demo', sid: 'session-aaaaaaaa', cid: 'ws1', input: { a: 1 } });
    assert.equal(getJob(job.id), job);
    appendEvent(job, 'text', { content: 'hello' });
    appendEvent(job, 'tool_call', { name: 'generate_image' });
    const first = readEvents(job, 0);
    assert.equal(first.events.length, 2);
    assert.equal(first.cursor, 2);
    assert.equal(first.done, false);
    assert.deepEqual(readEvents(job, 1).events.map((e) => e.type), ['tool_call']);
    assert.equal(readEvents(job, 2).events.length, 0);

    finishJob(job, { status: 'completed', result: { url: 'https://v3.fal.media/x.png' } });
    finishJob(job, { status: 'failed', error: 'late' });
    assert.equal(job.status, 'completed', 'a finished job cannot change state');
    assert.equal(readEvents(job, 0).done, true);

    // Survives a registry wipe via the per-workspace store.
    await new Promise((r) => setTimeout(r, 50));
    resetJobs();
    const restored = await loadJob(job.id, 'ws1');
    assert.equal(restored.status, 'completed');
    assert.equal(restored.result.url, 'https://v3.fal.media/x.png');
    assert.equal(await loadJob(job.id, 'other-ws'), null, 'workspace scoped');

    const running = createJob({ name: 'demo', sid: 's', cid: 'ws1', input: {} });
    assert.equal(cancelJob(running), true);
    assert.equal(running.status, 'cancelled');
    assert.equal(running.controller.signal.aborted, true);
    assert.equal(cancelJob(running), false);
});
