// Abuse and spend controls (in-memory; one Railway instance):
// - token buckets per session id, per workspace (access code) AND per client IP
// - at most MAX_JOBS_IN_FLIGHT generation jobs per session
// - a daily USD budget ledger: an estimate is debited at submit and refunded
//   when the job fails; per-workspace and global caps answer 402.
// The ledger is mirrored to the JSON store so a restart does not reset
// today's spend.

import { clientIpHeader, dailyBudgetUsd, sessionDailyBudgetUsd, trustedProxyHops } from './config.js';
import { GatewayError, errors } from './errors.js';
import { shared } from './state.js';
import * as store from './store.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// capacity tokens refilled evenly over windowMs. The per-IP and
// per-workspace buckets are IP_FACTOR / WORKSPACE_FACTOR times larger
// (several people can share one office IP or one access code); the workspace
// bucket stops a caller from resetting the per-sid limits by signing in again.
export const RULES = {
    submit: [{ capacity: 10, windowMs: MINUTE }, { capacity: 300, windowMs: DAY }],
    poll: [{ capacity: 240, windowMs: MINUTE }],
    llm: [{ capacity: 30, windowMs: MINUTE }],
    upload: [{ capacity: 30, windowMs: MINUTE }],
    estimate: [{ capacity: 120, windowMs: MINUTE }],
    session: [{ capacity: 60, windowMs: MINUTE }],
    login: [{ capacity: 5, windowMs: MINUTE }],
};
const IP_FACTOR = 3;
const WORKSPACE_FACTOR = 3;
// Failed sign-ins per network prefix (/24 for IPv4, /64 for IPv6), counted
// only on failure, so a guesser on many addresses of one network is slowed
// down while correct codes elsewhere are never affected. There is
// deliberately no global login bucket: one client could drain it and lock
// everyone out. Brute force is made infeasible by code strength instead
// (config.js rejects weak AQUORA_ACCESS_CODES in production).
const LOGIN_FAIL_PREFIX = { capacity: 20, windowMs: MINUTE };

export const MAX_JOBS_IN_FLIGHT = 4;
const JOB_SLOT_TTL_MS = 30 * MINUTE;

const buckets = () => shared('rateBuckets', () => new Map());
const slots = () => shared('jobSlots', () => new Map());

function takeToken(key, { capacity, windowMs }, now) {
    const map = buckets();
    const ratePerMs = capacity / windowMs;
    let bucket = map.get(key);
    if (!bucket) {
        bucket = { tokens: capacity, at: now };
        map.set(key, bucket);
    } else {
        bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.at) * ratePerMs);
        bucket.at = now;
    }
    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return 0;
    }
    return Math.ceil((1 - bucket.tokens) / ratePerMs / 1000);
}

function sweepBuckets(now) {
    const map = buckets();
    if (map.size < 5000) return;
    for (const [key, bucket] of map) if (now - bucket.at > DAY) map.delete(key);
}

// Returns 0 when allowed, else the seconds to wait. Tokens are only consumed
// when every bucket (all windows × sid and ip) has room.
function waitFor(plan, now) {
    const map = buckets();
    let wait = 0;
    for (const [key, window] of plan) {
        const bucket = map.get(key);
        if (!bucket) continue;
        const ratePerMs = window.capacity / window.windowMs;
        const tokens = Math.min(window.capacity, bucket.tokens + (now - bucket.at) * ratePerMs);
        if (tokens < 1) wait = Math.max(wait, Math.ceil((1 - tokens) / ratePerMs / 1000));
    }
    return wait;
}

export function checkRate(ruleName, { sid, cid, ip } = {}, now = Date.now()) {
    const windows = RULES[ruleName];
    if (!windows) throw new Error(`unknown rate rule ${ruleName}`);
    sweepBuckets(now);
    const plan = [];
    windows.forEach((window, index) => {
        if (sid) plan.push([`${ruleName}:${index}:sid:${sid}`, window]);
        if (cid) plan.push([`${ruleName}:${index}:ws:${cid}`, { ...window, capacity: window.capacity * WORKSPACE_FACTOR }]);
        if (ip) {
            const capacity = ruleName === 'login' ? window.capacity : window.capacity * IP_FACTOR;
            plan.push([`${ruleName}:${index}:ip:${ip}`, { ...window, capacity }]);
        }
    });
    // Dry run first so a rejected request does not drain the other buckets.
    const wait = waitFor(plan, now);
    if (wait) return wait;
    for (const [key, window] of plan) takeToken(key, window, now);
    return 0;
}

export function enforceRate(ruleName, identity, message) {
    const wait = checkRate(ruleName, identity);
    if (wait) throw errors.rateLimited(wait, message);
}

// Network prefix used for the failed-login bucket: /24 (IPv4) or /64 (IPv6).
export function ipPrefix(ip) {
    const value = String(ip || '');
    if (!value || value === 'unknown') return null;
    const v4 = value.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i);
    if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
    if (value.includes(':')) {
        const [head] = value.split('::');
        const groups = head.split(':').filter(Boolean);
        return `${groups.slice(0, 4).join(':')}::/64`;
    }
    return null;
}

// Before comparing a submitted code: 429 while the caller's network has used
// up its failed-attempt allowance (the per-IP 'login' bucket is enforced
// separately and counts every attempt).
export function assertLoginAllowed(ip, message, now = Date.now()) {
    const prefix = ipPrefix(ip);
    if (!prefix) return;
    const wait = waitFor([[`loginfail:${prefix}`, LOGIN_FAIL_PREFIX]], now);
    if (wait) throw errors.rateLimited(wait, message);
}

// After a wrong code: one token from the network's failure bucket.
export function recordLoginFailure(ip, now = Date.now()) {
    const prefix = ipPrefix(ip);
    if (prefix) takeToken(`loginfail:${prefix}`, LOGIN_FAIL_PREFIX, now);
}

// Client IP as seen by the trusted proxies in front of the app. By default
// the X-Forwarded-For entry appended by the nearest AQUORA_TRUSTED_PROXY_HOPS
// proxies (Railway's edge = 1 hop) is used; client-supplied entries to the
// left of it are ignored. A single-value header such as X-Real-IP is only
// read when the operator names it in AQUORA_CLIENT_IP_HEADER (and a proxy
// that overwrites it is configured), because any client can send it.
// With AQUORA_TRUSTED_PROXY_HOPS=0 (no proxy) the IP is 'unknown'.
export function clientIp(request) {
    const h = request?.headers;
    if (!h?.get) return 'unknown';
    const hops = trustedProxyHops();
    if (hops <= 0) return 'unknown';
    const header = clientIpHeader();
    if (header) {
        const value = (h.get(header) || '').split(',').map((s) => s.trim()).filter(Boolean).pop();
        return value ? value.slice(0, 64) : 'unknown';
    }
    const chain = (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (chain.length >= hops) return chain[chain.length - hops].slice(0, 64);
    return 'unknown';
}

// ── Upload concurrency ──────────────────────────────────────────────────────
// Uploads are buffered in memory (up to the 200 MB cap), so each session may
// only have MAX_UPLOADS_IN_FLIGHT at a time (and a workspace 3× that).
export const MAX_UPLOADS_IN_FLIGHT = 2;
const uploads = () => shared('uploadSlots', () => new Map());

export function acquireUploadSlot({ sid, cid }) {
    const map = uploads();
    const bySid = map.get(`sid:${sid}`) || 0;
    const byWs = cid ? map.get(`ws:${cid}`) || 0 : 0;
    if (bySid >= MAX_UPLOADS_IN_FLIGHT || byWs >= MAX_UPLOADS_IN_FLIGHT * WORKSPACE_FACTOR) {
        throw new GatewayError(429, 'too_many_uploads', 'Another upload is still in progress. Wait for it to finish.', { retryAfter: 5 });
    }
    map.set(`sid:${sid}`, bySid + 1);
    if (cid) map.set(`ws:${cid}`, byWs + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        for (const key of [`sid:${sid}`, ...(cid ? [`ws:${cid}`] : [])]) {
            const n = (map.get(key) || 1) - 1;
            if (n > 0) map.set(key, n);
            else map.delete(key);
        }
    };
}

// ── Concurrency slots ───────────────────────────────────────────────────────
function liveSlots(sid, now = Date.now()) {
    const map = slots();
    const mine = map.get(sid);
    if (!mine) return new Map();
    for (const [jobId, at] of mine) if (now - at > JOB_SLOT_TTL_MS) mine.delete(jobId);
    if (!mine.size) map.delete(sid);
    return mine;
}

export function jobsInFlight(sid) {
    return liveSlots(sid).size;
}

// Throws 429 when the session already has MAX_JOBS_IN_FLIGHT jobs running.
export function assertJobSlot(sid) {
    if (liveSlots(sid).size >= MAX_JOBS_IN_FLIGHT) {
        throw new GatewayError(429, 'too_many_jobs', `You already have ${MAX_JOBS_IN_FLIGHT} generations running. Wait for one to finish.`, { retryAfter: 10 });
    }
}

export function acquireJobSlot(sid, jobId) {
    assertJobSlot(sid);
    const map = slots();
    if (!map.has(sid)) map.set(sid, new Map());
    map.get(sid).set(jobId, Date.now());
}

export function releaseJobSlot(sid, jobId) {
    const mine = slots().get(sid);
    if (!mine) return;
    mine.delete(jobId);
    if (!mine.size) slots().delete(sid);
}

// ── Budget ledger ───────────────────────────────────────────────────────────
// Day document: { day, globalUsd, byWorkspace: {cid: usd}, settled: {jobId: 'refunded'|'kept'}, debits: {jobId: {cid, usd}} }

export function utcDay(ms = Date.now()) {
    return new Date(ms).toISOString().slice(0, 10);
}

const MAX_TRACKED_JOBS = 5000;
const round = (n) => Math.round(n * 1e6) / 1e6;

function ledgerState() {
    return shared('ledger', () => ({ days: new Map(), loading: new Map(), writing: Promise.resolve() }));
}

async function loadDay(day) {
    const state = ledgerState();
    if (state.days.has(day)) return state.days.get(day);
    if (!state.loading.has(day)) {
        state.loading.set(day, (async () => {
            let doc = null;
            try {
                doc = await store.get('ledger', day);
            } catch {
                doc = null;
            }
            const fresh = {
                day,
                globalUsd: Number(doc?.globalUsd) || 0,
                byWorkspace: doc?.byWorkspace && typeof doc.byWorkspace === 'object' ? { ...doc.byWorkspace } : {},
                settled: doc?.settled && typeof doc.settled === 'object' ? { ...doc.settled } : {},
                debits: doc?.debits && typeof doc.debits === 'object' ? { ...doc.debits } : {},
            };
            if (!state.days.has(day)) state.days.set(day, fresh);
            // Only today and yesterday stay in memory.
            for (const key of state.days.keys()) if (key < utcDay(Date.now() - DAY)) state.days.delete(key);
            return state.days.get(day);
        })().finally(() => state.loading.delete(day)));
    }
    return state.loading.get(day);
}

function persist(doc) {
    const state = ledgerState();
    const snapshot = JSON.parse(JSON.stringify(doc));
    state.writing = state.writing
        .then(() => store.put('ledger', doc.day, snapshot))
        .catch(() => {});
    return state.writing;
}

function trimTracked(doc) {
    for (const field of ['settled', 'debits']) {
        const keys = Object.keys(doc[field]);
        if (keys.length > MAX_TRACKED_JOBS) {
            for (const key of keys.slice(0, keys.length - MAX_TRACKED_JOBS)) delete doc[field][key];
        }
    }
}

function budgetError(scope, spentUsd, capUsd) {
    const message = scope === 'global'
        ? "Aquora's AI budget for today is used up. It resets at 00:00 UTC."
        : "Your AI budget for today is used up. It resets at 00:00 UTC.";
    return new GatewayError(402, 'budget_exceeded', message, {
        extra: { scope, spentUsd: round(spentUsd), capUsd },
    });
}

export async function budgetStatus(cid, day = utcDay()) {
    const doc = await loadDay(day);
    return {
        spentUsd: round(doc.byWorkspace[cid] || 0),
        capUsd: sessionDailyBudgetUsd(),
        globalSpentUsd: round(doc.globalUsd),
        globalCapUsd: dailyBudgetUsd(),
        day,
    };
}

// Throws 402 unless `usd` more fits under both caps (usd may be 0 for a
// pre-check before metered calls).
export async function assertBudget(cid, usd = 0, day = utcDay()) {
    const doc = await loadDay(day);
    const spent = doc.byWorkspace[cid] || 0;
    const sessionCap = sessionDailyBudgetUsd();
    const globalCap = dailyBudgetUsd();
    const epsilon = 1e-9;
    if (spent + usd > sessionCap + epsilon || (usd === 0 && spent >= sessionCap)) throw budgetError('session', spent, sessionCap);
    if (doc.globalUsd + usd > globalCap + epsilon || (usd === 0 && doc.globalUsd >= globalCap)) throw budgetError('global', doc.globalUsd, globalCap);
    return doc;
}

// Debits an estimate for a job at submit. Throws 402 when a cap would be
// exceeded. Returns the ledger day (stored in the job token for refunds).
export async function reserveBudget({ cid, usd, jobId }) {
    const amount = Math.max(0, Number(usd) || 0);
    const day = utcDay();
    const doc = await assertBudget(cid, amount, day);
    doc.byWorkspace[cid] = round((doc.byWorkspace[cid] || 0) + amount);
    doc.globalUsd = round(doc.globalUsd + amount);
    if (jobId) doc.debits[jobId] = { cid, usd: amount };
    trimTracked(doc);
    persist(doc);
    return day;
}

// Settles a reservation to the actual cost (metered OpenRouter calls): the
// debit made by reserveBudget({jobId}) is replaced by `usd`. Idempotent.
export async function settleCharge({ jobId, usd, day = utcDay() }) {
    if (!jobId) return false;
    const doc = await loadDay(day);
    if (doc.settled[jobId]) return false;
    const debit = doc.debits[jobId];
    doc.settled[jobId] = 'kept';
    if (debit) {
        const actual = Math.max(0, Number(usd) || 0);
        const delta = actual - debit.usd;
        doc.byWorkspace[debit.cid] = round(Math.max(0, (doc.byWorkspace[debit.cid] || 0) + delta));
        doc.globalUsd = round(Math.max(0, doc.globalUsd + delta));
    }
    delete doc.debits[jobId];
    trimTracked(doc);
    persist(doc);
    return true;
}

// Post-hoc charge for metered calls (OpenRouter usage.cost). Never throws for
// the cap: the call already happened.
export async function chargeBudget({ cid, usd }) {
    const amount = Math.max(0, Number(usd) || 0);
    if (!amount) return;
    const doc = await loadDay(utcDay());
    doc.byWorkspace[cid] = round((doc.byWorkspace[cid] || 0) + amount);
    doc.globalUsd = round(doc.globalUsd + amount);
    persist(doc);
}

// Marks a job final. `refund: true` gives its estimate back (failed jobs).
// Idempotent: a job is settled once, so repeated polls never double-refund.
export async function settleJob({ jobId, refund, day = utcDay() }) {
    if (!jobId) return false;
    const doc = await loadDay(day);
    if (doc.settled[jobId]) return false;
    const debit = doc.debits[jobId];
    doc.settled[jobId] = refund ? 'refunded' : 'kept';
    if (refund && debit) {
        doc.byWorkspace[debit.cid] = round(Math.max(0, (doc.byWorkspace[debit.cid] || 0) - debit.usd));
        doc.globalUsd = round(Math.max(0, doc.globalUsd - debit.usd));
    }
    delete doc.debits[jobId];
    trimTracked(doc);
    persist(doc);
    return Boolean(refund && debit);
}

export async function flushLedger() {
    await ledgerState().writing;
}

export function resetLimits() {
    buckets().clear();
    slots().clear();
    uploads().clear();
    const state = ledgerState();
    state.days.clear();
    state.loading.clear();
}
