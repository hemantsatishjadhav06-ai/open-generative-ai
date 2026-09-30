// Optional protection for generation POST retries. This cache is shared by
// Next route bundles in one process; it is not durable across server restarts
// or replicas. Job tokens belong to a session, so keys are session/workspace
// scoped rather than returning another session's unpollable token.
import crypto from 'node:crypto';
import { GatewayError } from './errors.js';
import { shared } from './state.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
export const MAX_IDEMPOTENCY_ENTRIES = 2000;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
const entries = () => shared('submitIdempotency', () => new Map());

function canonical(value, depth = 0) {
    if (depth > 32) throw new GatewayError(400, 'invalid_input', 'The request settings are nested too deeply.');
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export async function idempotentSubmit({ key, sid, cid, name, payload }, submit) {
    if (key === null || key === undefined) return { body: await submit(), replayed: false };
    if (typeof key !== 'string' || !KEY.test(key)) {
        throw new GatewayError(400, 'invalid_idempotency_key', 'Idempotency-Key must contain 8–128 letters, numbers, dots, colons, underscores or hyphens.');
    }
    const digest = crypto.createHash('sha256').update(canonical({ name, payload })).digest('hex');
    const identity = JSON.stringify([cid, sid, key]);
    const map = entries();
    const now = Date.now();
    for (const [id, entry] of map) if (entry.done && entry.until <= now) map.delete(id);
    const existing = map.get(identity);
    if (existing) {
        if (existing.digest !== digest) {
            throw new GatewayError(409, 'idempotency_conflict', 'This request key was already used with different settings. Start a new generation.');
        }
        return { body: structuredClone(await existing.promise), replayed: true };
    }
    // Do not evict a live key: a retry could otherwise create another charge.
    if (map.size >= MAX_IDEMPOTENCY_ENTRIES) {
        throw new GatewayError(503, 'request_capacity', 'The generation service has reached its request capacity. Try again later.', { retryable: true, retryAfter: 60 });
    }
    const entry = { digest, done: false, started: false, until: now + IDEMPOTENCY_TTL_MS, promise: null };
    // The caller marks the boundary immediately before a provider POST or
    // after pipeline validation/budget checks when an accepted job can run.
    // Only certified pre-submission failures may be evicted: inferring this
    // from an HTTP status is unsafe (a sync 408, for example, may be billed).
    entry.promise = Promise.resolve().then(() => submit(() => { entry.started = true; }))
        .catch((error) => {
            if (!entry.started && map.get(identity) === entry) map.delete(identity);
            throw error;
        })
        .finally(() => { entry.done = true; });
    // Lost replies after the boundary may already be billed; retain them.
    entry.promise.catch(() => {});
    map.set(identity, entry);
    return { body: structuredClone(await entry.promise), replayed: false };
}

export function resetIdempotency() {
    entries().clear();
}
