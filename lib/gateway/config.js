// Server-only configuration for the Aquora gateway. Every value is read from
// process.env at call time (never captured at import), so tests and a
// restarted container always see the current environment. Nothing here is
// ever NEXT_PUBLIC_ or baked into the client bundle.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { shared } from './state.js';

const DEFAULTS = {
    FAL_QUEUE_BASE: 'https://queue.fal.run',
    FAL_RUN_BASE: 'https://fal.run',
    FAL_REST_BASE: 'https://rest.fal.ai',
    FAL_API_BASE: 'https://api.fal.ai',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_MODEL_FAST: 'openai/gpt-6-luna',
    OPENROUTER_MODEL_AGENT: 'anthropic/claude-sonnet-5',
    OPENROUTER_MODEL_VISION: 'google/gemini-3.8-flash',
    AQUORA_DAILY_BUDGET_USD: 25,
    AQUORA_SESSION_DAILY_BUDGET_USD: 10,
};

export const MIN_SECRET_BYTES = 32;

function read(name) {
    const value = process.env[name];
    return typeof value === 'string' ? value.trim() : '';
}

function list(name) {
    return read(name)
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function base(name) {
    const raw = read(name) || DEFAULTS[name];
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad protocol');
        return raw.replace(/\/+$/, '');
    } catch {
        return DEFAULTS[name];
    }
}

function money(name) {
    const raw = read(name);
    if (raw === '') return DEFAULTS[name];
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULTS[name];
}

export function isProduction() {
    return process.env.NODE_ENV === 'production';
}

// ── Provider keys ───────────────────────────────────────────────────────────
export function falKey() {
    return read('FAL_KEY') || null;
}

export function falAdminKey() {
    return read('FAL_ADMIN_KEY') || null;
}

export function openrouterKey() {
    return read('OPENROUTER_API_KEY') || null;
}

// Media generation is possible (fal key present).
export function isConfigured() {
    return Boolean(falKey());
}

export function isLlmConfigured() {
    return Boolean(openrouterKey());
}

// ── Upstream bases (test-only overrides point these at the local mock) ─────
export const upstream = {
    falQueue: () => base('FAL_QUEUE_BASE'),
    falRun: () => base('FAL_RUN_BASE'),
    falRest: () => base('FAL_REST_BASE'),
    falApi: () => base('FAL_API_BASE'),
    openrouter: () => base('OPENROUTER_BASE_URL'),
};

// Hosts of the configured upstreams plus AQUORA_TRUSTED_MEDIA_HOSTS. Media
// URLs on these hosts skip the private-address check (the local mock upstream
// lives on 127.0.0.1 in tests; in production these are fal's public hosts).
export function trustedMediaHosts() {
    const hosts = new Set();
    for (const get of Object.values(upstream)) {
        try {
            const url = new URL(get());
            // Only an explicit override can make a non-public host trusted.
            hosts.add(url.hostname.toLowerCase());
        } catch {
            // ignore
        }
    }
    for (const host of list('AQUORA_TRUSTED_MEDIA_HOSTS')) hosts.add(host.toLowerCase().replace(/\.$/, ''));
    return hosts;
}

// ── Access gate ─────────────────────────────────────────────────────────────
// The access code is the only credential, so production ignores codes that
// could be guessed: shorter than MIN_ACCESS_CODE_LENGTH characters or made of
// fewer than MIN_ACCESS_CODE_DISTINCT different characters ('1234',
// 'aaaaaaaaaaaa'). Generate codes with `openssl rand -base64 18`.
export const MIN_ACCESS_CODE_LENGTH = 12;
export const MIN_ACCESS_CODE_DISTINCT = 6;

export function isStrongAccessCode(code) {
    const value = String(code || '');
    return value.length >= MIN_ACCESS_CODE_LENGTH && new Set(value).size >= MIN_ACCESS_CODE_DISTINCT;
}

function configuredCodes() {
    return [...new Set(list('AQUORA_ACCESS_CODES'))];
}

// Number of configured codes production ignores as too weak (never the values).
export function weakAccessCodeCount() {
    return configuredCodes().filter((code) => !isStrongAccessCode(code)).length;
}

export function accessCodes() {
    const codes = configuredCodes();
    if (!isProduction()) return codes;
    const strong = codes.filter(isStrongAccessCode);
    if (strong.length !== codes.length) {
        const warned = shared('weakCodeWarning', () => ({ count: -1 }));
        if (warned.count !== codes.length - strong.length) {
            warned.count = codes.length - strong.length;
            // The count only: never log a code.
            console.warn(`[gateway] ignoring ${warned.count} weak AQUORA_ACCESS_CODES entr${warned.count === 1 ? 'y' : 'ies'} (min ${MIN_ACCESS_CODE_LENGTH} characters, ${MIN_ACCESS_CODE_DISTINCT} different)`);
        }
    }
    return strong;
}

function devSecret() {
    // Per-process random secret for local development only: sessions and job
    // tokens simply stop verifying after a restart.
    return shared('devSecret', () => crypto.randomBytes(32).toString('base64url'));
}

// Secrets for HMAC signing. AQUORA_SESSION_SECRET may hold a comma-separated
// list for rotation: the first entry signs, every entry verifies.
export function sessionSecrets() {
    const configured = list('AQUORA_SESSION_SECRET').filter((s) => Buffer.byteLength(s, 'utf8') >= MIN_SECRET_BYTES);
    if (configured.length) return configured;
    if (isProduction()) return [];
    return [devSecret()];
}

export function sessionSecretProblem() {
    const raw = list('AQUORA_SESSION_SECRET');
    if (!raw.length) return 'missing';
    if (Buffer.byteLength(raw[0], 'utf8') < MIN_SECRET_BYTES) return 'too_short';
    return null;
}

// AQUORA_PUBLIC_ACCESS=true opens the studio to everyone: no access code,
// each visitor gets a private workspace. The daily budgets and rate limits
// still apply, so AQUORA_DAILY_BUDGET_USD caps what the whole site can spend.
export function publicAccess() {
    return /^(1|true|yes|on)$/i.test(read('AQUORA_PUBLIC_ACCESS'));
}

// 'open'           – no access code: every visitor gets a session (public
//                    access, or development without access codes).
// 'codes'          – an access code is required.
// 'setup_required' – production without a usable secret, or without codes
//                    and public access: paid endpoints answer 503.
export function gateMode() {
    if (publicAccess()) {
        return isProduction() && sessionSecretProblem() ? 'setup_required' : 'open';
    }
    const codes = accessCodes();
    if (isProduction()) {
        if (!codes.length) return 'setup_required';
        if (sessionSecretProblem()) return 'setup_required';
        return 'codes';
    }
    return codes.length ? 'codes' : 'open';
}

// ── Budgets ─────────────────────────────────────────────────────────────────
export function dailyBudgetUsd() {
    return money('AQUORA_DAILY_BUDGET_USD');
}

export function sessionDailyBudgetUsd() {
    return money('AQUORA_SESSION_DAILY_BUDGET_USD');
}

// ── OpenRouter models ───────────────────────────────────────────────────────
export function llmModels() {
    return {
        fast: read('OPENROUTER_MODEL_FAST') || DEFAULTS.OPENROUTER_MODEL_FAST,
        agent: read('OPENROUTER_MODEL_AGENT') || DEFAULTS.OPENROUTER_MODEL_AGENT,
        vision: read('OPENROUTER_MODEL_VISION') || DEFAULTS.OPENROUTER_MODEL_VISION,
    };
}

export function allowedLlmModels() {
    const models = llmModels();
    return new Set([models.fast, models.agent, models.vision, ...list('OPENROUTER_ALLOWED_MODELS')]);
}

// ── Storage ─────────────────────────────────────────────────────────────────
function writable(dir) {
    try {
        fs.accessSync(dir, fs.constants.W_OK);
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

export function dataDir() {
    const explicit = read('AQUORA_DATA_DIR');
    if (explicit) return path.resolve(explicit);
    if (writable('/data')) return '/data';
    return path.resolve(process.cwd(), '.aquora-data');
}

// 'persistent' when the data dir survives a redeploy: an explicit
// AQUORA_DATA_DIR, a Railway volume, or any local disk outside Railway.
export function storageKind() {
    const dir = dataDir();
    const volume = read('RAILWAY_VOLUME_MOUNT_PATH');
    if (volume && (dir === path.resolve(volume) || dir.startsWith(path.resolve(volume) + path.sep))) return 'persistent';
    if (read('AQUORA_DATA_DIR')) return 'persistent';
    if (read('RAILWAY_ENVIRONMENT') || read('RAILWAY_ENVIRONMENT_NAME')) return 'ephemeral';
    return 'persistent';
}

// Number of trusted reverse proxies in front of the app (Railway's edge = 1).
export function trustedProxyHops() {
    const n = Number(read('AQUORA_TRUSTED_PROXY_HOPS') || 1);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
}

// Header a trusted proxy overwrites with the client address (e.g.
// 'x-real-ip'). Unset (default): the proxy-appended X-Forwarded-For hop.
export function clientIpHeader() {
    const name = read('AQUORA_CLIENT_IP_HEADER').toLowerCase();
    return /^[a-z0-9-]{1,64}$/.test(name) ? name : '';
}

// Extra origins allowed to POST (besides the request's own host).
export function allowedOrigins() {
    return list('AQUORA_ALLOWED_ORIGINS');
}
