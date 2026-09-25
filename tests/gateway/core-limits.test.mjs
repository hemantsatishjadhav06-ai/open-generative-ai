// Gateway core: token buckets, concurrency slots and the daily budget ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    MAX_JOBS_IN_FLIGHT,
    RULES,
    acquireJobSlot,
    assertBudget,
    assertJobSlot,
    budgetStatus,
    chargeBudget,
    checkRate,
    clientIp,
    enforceRate,
    flushLedger,
    jobsInFlight,
    releaseJobSlot,
    reserveBudget,
    resetLimits,
    settleJob,
    utcDay,
} from '../../lib/gateway/limits.js';
import * as store from '../../lib/gateway/store.js';
import { isGatewayError } from '../../lib/gateway/errors.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquora-limits-'));
process.env.AQUORA_DATA_DIR = dataDir;
process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '1';
process.env.AQUORA_DAILY_BUDGET_USD = '2';

test.beforeEach(() => resetLimits());
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('submit bucket: 10 per minute per session, refills over time', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) assert.equal(checkRate('submit', { sid: 's1' }, t0), 0, `call ${i + 1}`);
    const wait = checkRate('submit', { sid: 's1' }, t0);
    assert.ok(wait >= 1 && wait <= 6, `retry after ${wait}s`);
    // Another session is unaffected.
    assert.equal(checkRate('submit', { sid: 's2' }, t0), 0);
    // 6 s later one token (60 s / 10) is back.
    assert.equal(checkRate('submit', { sid: 's1' }, t0 + 6_000), 0);
    assert.ok(checkRate('submit', { sid: 's1' }, t0 + 6_000) > 0);
});

test('per-IP bucket is 3× the per-session one; a rejected call drains nothing', () => {
    const t0 = 2_000_000;
    // 30 submits from 3 sessions on one IP fill the IP bucket (10 × 3).
    for (let s = 0; s < 3; s++) {
        for (let i = 0; i < 10; i++) assert.equal(checkRate('submit', { sid: `s${s}`, ip: '1.2.3.4' }, t0), 0);
    }
    assert.ok(checkRate('submit', { sid: 'fresh', ip: '1.2.3.4' }, t0) > 0, 'IP exhausted');
    // The fresh session's own bucket was not charged by the refused attempt.
    assert.equal(checkRate('submit', { sid: 'fresh', ip: '9.9.9.9' }, t0), 0);
});

test('daily submit cap (300/day) applies even when the minute bucket has room', () => {
    const start = 3_000_000;
    let t = start;
    let allowed = 0;
    for (let i = 0; i < 320; i++) {
        t += 6_000; // one per 6 s keeps the minute bucket topped up
        if (checkRate('submit', { sid: 'daily' }, t) === 0) allowed += 1;
    }
    // 300 up front plus what the day bucket refills in 32 min (1 per 288 s).
    const refilled = Math.floor((t - start) / (86_400_000 / 300));
    assert.ok(allowed >= 300 && allowed <= 300 + refilled + 1, `allowed ${allowed}`);
    assert.ok(allowed < 320, 'the daily cap refused some calls');
});

test('rule table matches the spec', () => {
    assert.deepEqual(RULES.submit.map((r) => r.capacity), [10, 300]);
    assert.equal(RULES.poll[0].capacity, 240);
    assert.equal(RULES.llm[0].capacity, 30);
    assert.equal(RULES.upload[0].capacity, 30);
    assert.equal(RULES.login[0].capacity, 5);
});

test('login: 5 per minute per IP → 429 with Retry-After', () => {
    for (let i = 0; i < 5; i++) enforceRate('login', { ip: '5.5.5.5' });
    assert.throws(() => enforceRate('login', { ip: '5.5.5.5' }), (e) => isGatewayError(e) && e.status === 429 && e.code === 'rate_limited' && e.retryAfter >= 1);
    assert.doesNotThrow(() => enforceRate('login', { ip: '6.6.6.6' }));
});

test('clientIp uses the proxy-appended XFF hop; X-Real-IP only when configured', () => {
    const r = (headers) => new Request('http://x/', { headers });
    // A client-sent X-Real-IP is ignored by default.
    assert.equal(clientIp(r({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' })), '1.1.1.1');
    assert.equal(clientIp(r({ 'x-forwarded-for': 'spoofed, 7.7.7.7' })), '7.7.7.7');
    assert.equal(clientIp(r({})), 'unknown');
    process.env.AQUORA_CLIENT_IP_HEADER = 'x-real-ip';
    try {
        assert.equal(clientIp(r({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' })), '8.8.8.8');
    } finally {
        delete process.env.AQUORA_CLIENT_IP_HEADER;
    }
});

test(`concurrency: at most ${MAX_JOBS_IN_FLIGHT} jobs in flight per session`, () => {
    for (let i = 0; i < MAX_JOBS_IN_FLIGHT; i++) acquireJobSlot('c1', `job${i}`);
    assert.equal(jobsInFlight('c1'), MAX_JOBS_IN_FLIGHT);
    assert.throws(() => assertJobSlot('c1'), (e) => e.status === 429 && e.code === 'too_many_jobs');
    assert.throws(() => acquireJobSlot('c1', 'job-extra'), (e) => e.status === 429);
    assert.doesNotThrow(() => assertJobSlot('c2'));
    releaseJobSlot('c1', 'job0');
    assert.doesNotThrow(() => acquireJobSlot('c1', 'job-next'));
});

test('budget: reserve until the workspace cap, then 402 budget_exceeded', async () => {
    await reserveBudget({ cid: 'w1', usd: 0.4, jobId: 'a' });
    await reserveBudget({ cid: 'w1', usd: 0.4, jobId: 'b' });
    await assert.rejects(reserveBudget({ cid: 'w1', usd: 0.4, jobId: 'c' }), (e) => {
        assert.equal(e.status, 402);
        assert.equal(e.code, 'budget_exceeded');
        assert.equal(e.toBody().scope, 'session');
        assert.equal(e.toBody().capUsd, 1);
        return true;
    });
    const status = await budgetStatus('w1');
    assert.equal(status.spentUsd, 0.8);
    assert.equal(status.capUsd, 1);
    // The refused reservation did not change the ledger.
    assert.equal((await budgetStatus('w1')).globalSpentUsd, 0.8);
});

test('budget: the global cap applies across workspaces', async () => {
    await reserveBudget({ cid: 'g1', usd: 0.9, jobId: 'g1a' });
    await reserveBudget({ cid: 'g2', usd: 0.9, jobId: 'g2a' });
    await assert.rejects(reserveBudget({ cid: 'g3', usd: 0.3, jobId: 'g3a' }), (e) => e.status === 402 && e.toBody().scope === 'global');
});

test('refund on failure is exact and idempotent; success keeps the debit', async () => {
    const day = await reserveBudget({ cid: 'r1', usd: 0.5, jobId: 'fail-1' });
    await reserveBudget({ cid: 'r1', usd: 0.25, jobId: 'ok-1' });
    assert.equal((await budgetStatus('r1')).spentUsd, 0.75);
    assert.equal(await settleJob({ jobId: 'fail-1', refund: true, day }), true);
    assert.equal(await settleJob({ jobId: 'fail-1', refund: true, day }), false, 'second refund ignored');
    assert.equal((await budgetStatus('r1')).spentUsd, 0.25);
    assert.equal(await settleJob({ jobId: 'ok-1', refund: false, day }), false);
    assert.equal(await settleJob({ jobId: 'ok-1', refund: true, day }), false, 'already settled as kept');
    assert.equal((await budgetStatus('r1')).spentUsd, 0.25);
    // Refund frees room for a new job.
    await reserveBudget({ cid: 'r1', usd: 0.7, jobId: 'next' });
});

test('assertBudget(cid, 0) blocks once the cap is reached; charges are post-hoc', async () => {
    await assertBudget('m1', 0);
    await chargeBudget({ cid: 'm1', usd: 1 });
    await assert.rejects(assertBudget('m1', 0), (e) => e.status === 402);
    await chargeBudget({ cid: 'm1', usd: -5 });
    assert.equal((await budgetStatus('m1')).spentUsd, 1, 'negative charges ignored');
});

test('the ledger persists to the store and survives a restart', async () => {
    await reserveBudget({ cid: 'p1', usd: 0.3, jobId: 'persist-1' });
    await flushLedger();
    const doc = await store.get('ledger', utcDay());
    assert.equal(doc.byWorkspace.p1, 0.3);
    resetLimits(); // forget the in-memory copy
    assert.equal((await budgetStatus('p1')).spentUsd, 0.3);
    assert.equal(await settleJob({ jobId: 'persist-1', refund: true, day: utcDay() }), true, 'debit remembered across restart');
    assert.equal((await budgetStatus('p1')).spentUsd, 0);
});

test('a zero budget blocks everything', async () => {
    process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '0';
    try {
        await assert.rejects(assertBudget('z1', 0), (e) => e.status === 402);
        await assert.rejects(reserveBudget({ cid: 'z1', usd: 0.01, jobId: 'z' }), (e) => e.status === 402);
    } finally {
        process.env.AQUORA_SESSION_DAILY_BUDGET_USD = '1';
    }
});
