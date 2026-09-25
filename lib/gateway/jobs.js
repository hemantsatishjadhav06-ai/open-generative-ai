// Job tokens and the in-memory job registry.
//
// Token = base64url(JSON {k, e, m, r, su, ru, cu, sid, j, w, u, d, t}) + '.' + HMAC
//   k   'fal' | 'pipeline' | 'agent'
//   e   fal endpoint id or pipeline name
//   m   catalog key (the endpoint id the studio posted), fal jobs only
//   r   fal request_id or pipeline job id
//   su/ru/cu  fal status/response/cancel URLs ('~' = relative to FAL_QUEUE_BASE)
//   sid session id that owns the job; j ledger/slot id; w workspace;
//   u estimated USD; d ledger day
//   t   issued-at (ms)
// The poll route verifies the HMAC AND that token.sid === caller sid, so a
// token is useless to anyone else and cannot be pointed at another URL.

import crypto from 'node:crypto';
import { sessionSecrets, upstream } from './config.js';
import { GatewayError, errors } from './errors.js';
import { shared } from './state.js';
import * as store from './store.js';

const KINDS = new Set(['fal', 'pipeline', 'agent']);
const MAX_TOKEN_LENGTH = 4096;
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;

function jobKey(secret) {
    return crypto.createHmac('sha256', secret).update('aquora-job-token-v1').digest();
}

function sign(body, secret) {
    return crypto.createHmac('sha256', jobKey(secret)).update(body).digest('base64url');
}

function compact(url) {
    if (typeof url !== 'string' || !url) return undefined;
    const base = upstream.falQueue();
    return url.startsWith(`${base}/`) ? `~${url.slice(base.length)}` : url;
}

function expand(url) {
    if (typeof url !== 'string' || !url) return undefined;
    return url.startsWith('~') ? `${upstream.falQueue()}${url.slice(1)}` : url;
}

export function signJobToken(claims) {
    const secrets = sessionSecrets();
    if (!secrets.length) throw errors.setupRequired();
    if (!KINDS.has(claims?.k)) throw new Error('invalid job kind');
    const payload = {
        k: claims.k,
        e: claims.e,
        ...(claims.m ? { m: claims.m } : {}),
        r: claims.r,
        ...(claims.su ? { su: compact(claims.su) } : {}),
        ...(claims.ru ? { ru: compact(claims.ru) } : {}),
        ...(claims.cu ? { cu: compact(claims.cu) } : {}),
        sid: claims.sid,
        ...(claims.j ? { j: claims.j } : {}),
        ...(claims.w ? { w: claims.w } : {}),
        ...(Number.isFinite(claims.u) ? { u: claims.u } : {}),
        ...(claims.d ? { d: claims.d } : {}),
        t: claims.t || Date.now(),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${sign(body, secrets[0])}`;
}

// Returns the claims (URLs expanded) or null when malformed/tampered/expired.
export function decodeJobToken(token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [body, sig] = parts;
    const given = Buffer.from(sig);
    const ok = sessionSecrets().some((secret) => {
        const expected = Buffer.from(sign(body, secret));
        return expected.length === given.length && crypto.timingSafeEqual(expected, given);
    });
    if (!ok) return null;
    let claims;
    try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!claims || !KINDS.has(claims.k) || typeof claims.r !== 'string' || typeof claims.sid !== 'string') return null;
    if (!Number.isFinite(claims.t) || Date.now() - claims.t > TOKEN_TTL_MS) return null;
    return { ...claims, su: expand(claims.su), ru: expand(claims.ru), cu: expand(claims.cu) };
}

// Verifies a token for the calling session. A valid token owned by someone
// else answers exactly like an unknown one (404).
export function verifyJobToken(token, sid) {
    const claims = decodeJobToken(token);
    if (!claims || !sid || claims.sid !== sid) throw errors.notFound('This generation could not be found.');
    return claims;
}

// ── Pipeline job registry ───────────────────────────────────────────────────
const MAX_EVENTS = 2000;
const KEEP_FINISHED_MS = 60 * 60_000;

const registry = () => shared('jobs', () => new Map());

export function newJobId() {
    return crypto.randomBytes(12).toString('base64url').replace(/^[_-]/, 'j');
}

function sweep() {
    const map = registry();
    const now = Date.now();
    for (const [id, job] of map) {
        if (job.status !== 'processing' && now - job.updatedAt > KEEP_FINISHED_MS) map.delete(id);
    }
}

export function createJob({ id = newJobId(), name, kind = 'pipeline', sid, cid, input }) {
    sweep();
    const now = Date.now();
    const job = {
        id,
        name,
        kind,
        sid,
        cid,
        input,
        status: 'processing',
        progress: null,
        result: null,
        error: null,
        events: [],
        seq: 0,
        createdAt: now,
        updatedAt: now,
        controller: new AbortController(),
    };
    registry().set(id, job);
    return job;
}

export function getJob(id) {
    return registry().get(id) || null;
}

export function appendEvent(job, type, payload = {}) {
    job.seq += 1;
    const event = { id: job.seq, job_id: job.id, type, payload, ts: Date.now() };
    job.events.push(event);
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
    job.updatedAt = event.ts;
    return event;
}

// Events after cursor `since` → {events, cursor, done}.
export function readEvents(job, since = 0) {
    const after = Number(since) || 0;
    const events = job.events.filter((event) => event.id > after);
    return { events, cursor: job.seq, done: job.status !== 'processing' };
}

// Finished jobs are persisted (per workspace) so a poll after a restart still
// gets the final answer. Running jobs cannot survive a restart.
async function persistFinished(job) {
    try {
        await store.forWorkspace(job.cid).put('jobs', job.id, {
            id: job.id,
            name: job.name,
            kind: job.kind,
            sid: job.sid,
            status: job.status,
            result: job.result,
            error: job.error,
            events: job.events.slice(-200),
            seq: job.seq,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        });
    } catch {
        // persistence is best effort
    }
}

// Persisted job documents are only reachable through a token, and tokens
// expire after TOKEN_TTL_MS, so older documents are pruned (at most hourly
// per workspace, in the background).
const PRUNE_EVERY_MS = 60 * 60_000;
const pruned = () => shared('jobsPruned', () => new Map());

async function pruneWorkspace(cid) {
    const last = pruned().get(cid) || 0;
    if (Date.now() - last < PRUNE_EVERY_MS) return;
    pruned().set(cid, Date.now());
    try {
        const ws = store.forWorkspace(cid);
        const cutoff = Date.now() - TOKEN_TTL_MS;
        const stale = await ws.list('jobs', { filter: (doc) => Number(doc?.updatedAt) < cutoff, limit: 5000 });
        for (const doc of stale) if (typeof doc.id === 'string') await ws.del('jobs', doc.id).catch(() => {});
    } catch {
        // best effort
    }
}

export function finishJob(job, { status, result = null, error = null }) {
    if (job.status !== 'processing') return job;
    job.status = status;
    job.result = result;
    job.error = error;
    job.updatedAt = Date.now();
    persistFinished(job).then(() => pruneWorkspace(job.cid));
    return job;
}

// Registry lookup with a fallback to the persisted copy.
export async function loadJob(id, cid) {
    const live = getJob(id);
    if (live) return live;
    if (!cid || typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
    try {
        return await store.forWorkspace(cid).get('jobs', id);
    } catch {
        return null;
    }
}

export function cancelJob(job, reason = 'cancelled') {
    if (!job || job.status !== 'processing') return false;
    try {
        job.controller?.abort(new GatewayError(499, 'cancelled', 'The generation was cancelled.'));
    } catch {
        // ignore
    }
    finishJob(job, { status: 'cancelled', error: reason === 'cancelled' ? 'The generation was cancelled.' : reason });
    return true;
}

export function resetJobs() {
    for (const job of registry().values()) {
        try {
            job.controller?.abort();
        } catch {
            // ignore
        }
    }
    registry().clear();
}
