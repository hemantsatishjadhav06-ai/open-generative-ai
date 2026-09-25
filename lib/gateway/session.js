// Access-code sessions for the gateway.
//
// Cookie `aquora_session` = base64url(JSON {sid, cid, iat, exp, v}) + '.' +
// base64url(HMAC-SHA256(secret, payload)). HttpOnly, SameSite=Lax, Path=/,
// 30 days, Secure in production. `sid` is a random per-login id (rate limits,
// job ownership); `cid` is the workspace: a hash of the access code, so
// everyone who signs in with the same code shares one workspace, and removing
// a code from AQUORA_ACCESS_CODES revokes its sessions. Signing out revokes
// that one sid server-side (a small revocation list in the store, kept until
// the cookie would have expired anyway), so a copied cookie stops working.

import crypto from 'node:crypto';
import { accessCodes, gateMode, isProduction, sessionSecrets, allowedOrigins } from './config.js';
import { GatewayError, errors } from './errors.js';
import { shared } from './state.js';
import * as store from './store.js';

export const SESSION_COOKIE = 'aquora_session';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
export const SESSION_VERSION = 1;
// Re-issue the cookie once less than half its lifetime is left.
const REFRESH_AFTER_SEC = SESSION_MAX_AGE_SEC / 2;
export const OPEN_WORKSPACE = 'open';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(secret, data) {
    return crypto.createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    if (x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
}

const nowSec = () => Math.floor(Date.now() / 1000);

export function newId(bytes = 16) {
    return crypto.randomBytes(bytes).toString('base64url');
}

// Workspace id for an access code (never the code itself).
export function codeId(code) {
    return crypto.createHash('sha256').update(`aquora:code:${code}`).digest('hex').slice(0, 16);
}

// Timing-safe lookup of a submitted code against AQUORA_ACCESS_CODES: sha256
// digests (equal length) are compared for every configured code, with no
// early exit. Returns the workspace id or null.
export function matchAccessCode(submitted) {
    if (typeof submitted !== 'string') return null;
    const candidate = submitted.trim();
    if (!candidate || candidate.length > 256) return null;
    const digest = crypto.createHash('sha256').update(candidate).digest();
    let match = null;
    for (const code of accessCodes()) {
        const expected = crypto.createHash('sha256').update(code).digest();
        if (crypto.timingSafeEqual(digest, expected) && match === null) match = codeId(code);
    }
    return match;
}

export function signSession(payload, secret) {
    const body = b64url(JSON.stringify(payload));
    return `${body}.${b64url(hmac(secret, body))}`;
}

// Parses and verifies a raw cookie value. Returns the payload (plus
// `needsRefresh`) or null for anything malformed, tampered, expired or
// signed with a retired secret.
export function verifySessionValue(value, { now = nowSec(), secrets = sessionSecrets() } = {}) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const dot = value.indexOf('.');
    if (dot <= 0 || dot !== value.lastIndexOf('.')) return null;
    const body = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    let signedWith = -1;
    secrets.forEach((secret, index) => {
        if (signedWith === -1 && safeEqual(b64url(hmac(secret, body)), sig)) signedWith = index;
    });
    if (signedWith === -1) return null;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    const { sid, cid, iat, exp, v } = payload;
    if (v !== SESSION_VERSION) return null;
    if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(sid)) return null;
    if (typeof cid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(cid)) return null;
    if (!Number.isInteger(iat) || !Number.isInteger(exp) || exp <= now || iat > now + 300) return null;
    return {
        sid,
        cid,
        iat,
        exp,
        v,
        // Signed with an older (rotated) secret, or past half-life.
        needsRefresh: signedWith > 0 || now - iat > REFRESH_AFTER_SEC,
    };
}

// ── Revocation (sign out) ──────────────────────────────────────────────────
// sid → exp (seconds). Mirrored to store 'sessions/revoked' so a restart
// keeps it; entries are pruned once the cookie would have expired.
const MAX_REVOKED = 20_000;
const revocations = () => shared('revokedSessions', () => ({ map: new Map(), loading: null, writing: Promise.resolve() }));

function pruneRevoked(map, now = nowSec()) {
    for (const [sid, exp] of map) if (!(exp > now)) map.delete(sid);
    if (map.size > MAX_REVOKED) {
        const oldest = [...map.entries()].sort((a, b) => a[1] - b[1]).slice(0, map.size - MAX_REVOKED);
        for (const [sid] of oldest) map.delete(sid);
    }
}

// Loads the persisted revocation list once per process. route() awaits it
// before resolving a session, so a restart never re-admits a revoked cookie.
export function loadRevocations() {
    const state = revocations();
    if (!state.loading) {
        state.loading = store.get('sessions', 'revoked')
            .then((doc) => {
                const sids = doc?.sids && typeof doc.sids === 'object' ? doc.sids : {};
                for (const [sid, exp] of Object.entries(sids)) {
                    if (Number.isInteger(exp) && !state.map.has(sid)) state.map.set(sid, exp);
                }
                pruneRevoked(state.map);
            })
            .catch(() => {});
    }
    return state.loading;
}

export function isSessionRevoked(sid) {
    const exp = revocations().map.get(sid);
    if (exp === undefined) return false;
    if (exp <= nowSec()) {
        revocations().map.delete(sid);
        return false;
    }
    return true;
}

export async function revokeSession({ sid, exp }) {
    if (typeof sid !== 'string' || !sid) return;
    await loadRevocations();
    const state = revocations();
    state.map.set(sid, Number.isInteger(exp) ? exp : nowSec() + SESSION_MAX_AGE_SEC);
    pruneRevoked(state.map);
    const snapshot = { sids: Object.fromEntries(state.map) };
    state.writing = state.writing.then(() => store.put('sessions', 'revoked', snapshot)).catch(() => {});
    await state.writing;
}

export function resetRevocations() {
    const state = revocations();
    state.map.clear();
    state.loading = null;
}

export function parseCookies(header) {
    const out = {};
    if (typeof header !== 'string' || !header) return out;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        if (!name || name in out) continue;
        let value = part.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        try {
            out[name] = decodeURIComponent(value);
        } catch {
            out[name] = value;
        }
    }
    return out;
}

// `verifySession(cookieHeader)` → session payload or null.
export function verifySession(cookieHeader, options) {
    return verifySessionValue(parseCookies(cookieHeader)[SESSION_COOKIE], options);
}

function isLoopbackRequest(request) {
    try {
        const host = new URL(request?.url || '').hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    } catch {
        return false;
    }
}

export function cookieSecure(request) {
    return isProduction() && !isLoopbackRequest(request);
}

function serializeCookie(value, { maxAge, secure }) {
    const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (secure) parts.push('Secure');
    return parts.join('; ');
}

// `createSessionCookie({codeId})` → { value, header, session }.
export function createSessionCookie({ codeId: cid, sid = newId(), now = nowSec(), secure = isProduction(), secrets = sessionSecrets() } = {}) {
    if (!secrets.length) throw errors.setupRequired();
    const workspace = typeof cid === 'string' && cid ? cid : OPEN_WORKSPACE;
    const session = { sid, cid: workspace, iat: now, exp: now + SESSION_MAX_AGE_SEC, v: SESSION_VERSION };
    const value = signSession(session, secrets[0]);
    return { value, header: serializeCookie(value, { maxAge: SESSION_MAX_AGE_SEC, secure }), session };
}

export function clearSessionCookie({ secure = isProduction() } = {}) {
    return serializeCookie('', { maxAge: 0, secure });
}

// Resolves the caller's session or throws.
// - setup_required → 503
// - codes          → valid cookie whose workspace code still exists, else 401
// - open (dev)     → valid cookie, or a fresh session (cookie set on reply)
// The returned object may carry `setCookie`; the route wrapper sends it.
export function getSession(request) {
    const mode = gateMode();
    if (mode === 'setup_required') return { mode, session: null };
    let session = verifySession(request?.headers?.get?.('cookie') || '');
    if (session && isSessionRevoked(session.sid)) session = null;
    if (session && mode === 'codes') {
        const live = accessCodes().some((code) => codeId(code) === session.cid);
        if (!live) return { mode, session: null };
    }
    return { mode, session };
}

export function requireSession(request) {
    const { mode, session } = getSession(request);
    if (mode === 'setup_required') throw errors.setupRequired();
    const secure = cookieSecure(request);
    if (session) {
        if (session.needsRefresh) {
            const fresh = createSessionCookie({ codeId: session.cid, sid: session.sid, secure });
            return { ...fresh.session, setCookie: fresh.header };
        }
        return { sid: session.sid, cid: session.cid, iat: session.iat, exp: session.exp };
    }
    if (mode === 'open') {
        const fresh = createSessionCookie({ codeId: OPEN_WORKSPACE, secure });
        return { ...fresh.session, setCookie: fresh.header, minted: true };
    }
    throw errors.unauthorized();
}

// ── CSRF: same-origin check for state-changing requests ─────────────────────
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hostsForRequest(request) {
    const hosts = new Set();
    const h = request.headers;
    const add = (value) => {
        if (value) hosts.add(String(value).split(',')[0].trim().toLowerCase());
    };
    add(h.get('host'));
    add(h.get('x-forwarded-host'));
    try {
        hosts.add(new URL(request.url).host.toLowerCase());
    } catch {
        // ignore
    }
    for (const origin of allowedOrigins()) {
        try {
            hosts.add(new URL(origin).host.toLowerCase());
        } catch {
            // ignore
        }
    }
    for (const env of [process.env.NEXT_PUBLIC_SITE_URL, process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]) {
        try {
            if (env) hosts.add(new URL(env).host.toLowerCase());
        } catch {
            // ignore
        }
    }
    hosts.delete('');
    return hosts;
}

// Throws 403 for cross-site browser writes. Browsers send Sec-Fetch-Site
// and/or Origin on every cross-site POST; requests with neither are not from
// a browser page (curl, server-to-server) and carry no ambient-cookie risk.
export function assertSameOrigin(request) {
    const method = String(request?.method || 'GET').toUpperCase();
    if (!UNSAFE.has(method)) return;
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') throw errors.forbiddenOrigin();
    const origin = request.headers.get('origin');
    if (origin) {
        if (origin === 'null') throw errors.forbiddenOrigin();
        let host;
        try {
            host = new URL(origin).host.toLowerCase();
        } catch {
            throw errors.forbiddenOrigin();
        }
        if (!hostsForRequest(request).has(host)) throw errors.forbiddenOrigin();
    }
}

export { GatewayError };
