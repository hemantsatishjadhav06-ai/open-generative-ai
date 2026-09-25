// Cost estimates (USD) used by the budget ledger and the workflow cost badge.
// 1) the catalog's estimateUsd(entry, payload) (static, from category
//    defaults: t2i/i2i 0.04, t2v/i2v 0.4 per 5 s, v2v 0.5, lipsync 0.3,
//    audio 0.05, tools 0.02), then
// 2) optionally refined by fal's account-specific price
//    GET {FAL_API_BASE}/v1/models/pricing?endpoint_id=… (cached 1 h;
//    failures are ignored and cached briefly).
// Both are computed from the input fal will actually receive (after the
// catalog's renames, fixed values and clamps), scaled by a quality
// multiplier (resolution / audio), and the larger of the two is used, so a
// refined price can never undercut the static estimate.

import { falKey, upstream } from './config.js';
import { shared } from './state.js';
import { logGateway } from './log.js';

export const CATEGORY_DEFAULT_USD = {
    image: 0.04,
    video: 0.4, // per 5 s
    v2v: 0.5,
    lipsync: 0.3,
    audio: 0.05,
    tool: 0.02,
};

const PRICE_TTL_MS = 60 * 60_000;
const FAILURE_TTL_MS = 10 * 60_000;
const PRICE_TIMEOUT_MS = 3000;

const cache = () => shared('falPrices', () => new Map());

const round = (n) => Math.round(n * 10_000) / 10_000;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export const DEFAULT_FPS = 24;

// Seconds requested by a fal input: duration / duration_seconds /
// seconds_total, else num_frames ÷ fps (DEFAULT_FPS when fps is absent).
export function requestedSeconds(payload, fallback = 5) {
    let best = null;
    for (const key of ['duration', 'duration_seconds', 'seconds_total', 'seconds', 'length']) {
        const n = num(String(payload?.[key] ?? '').replace(/s$/i, ''));
        if (n && n > 0) {
            best = n;
            break;
        }
    }
    const frames = num(payload?.num_frames);
    if (frames && frames > 0) {
        const fps = num(payload?.fps ?? payload?.frames_per_second);
        const seconds = frames / (fps && fps > 0 ? fps : DEFAULT_FPS);
        best = Math.max(best || 0, seconds);
    }
    return best ? Math.min(best, 600) : fallback;
}

// Price multiplier for settings fal charges extra for: higher resolutions
// and generated audio. Deliberately rounded up (budget estimates).
export function qualityMultiplier(input) {
    if (!input || typeof input !== 'object') return 1;
    let factor = 1;
    const res = ['resolution', 'video_quality', 'quality', 'image_size', 'output_resolution', 'upscale_factor']
        .map((key) => input[key])
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).toLowerCase())
        .join(' ');
    if (/(^|\D)(4k|2160p?|4096)(\D|$)/.test(res)) factor *= 2;
    else if (/(^|\D)(2k|1440p?|2048)(\D|$)/.test(res)) factor *= 1.5;
    else if (/(^|\D)1080p?(\D|$)/.test(res)) factor *= 1.25;
    const upscale = num(input.upscale_factor ?? input.scale);
    if (upscale && upscale > 2) factor *= Math.min(4, upscale / 2);
    if (input.generate_audio === true || input.with_audio === true || input.enable_audio === true) factor *= 1.5;
    return factor;
}

function countOf(payload) {
    for (const key of ['num_images', 'n', 'batch_size', 'num_outputs', 'max_images']) {
        const n = num(payload?.[key]);
        if (n && n >= 1) return Math.min(Math.floor(n), 8);
    }
    return 1;
}

export function defaultEstimate(entry, payload) {
    const kind = entry?.kind;
    if (kind === 'video') {
        const v2v = entry?.category === 'v2v' || /video-to-video|upscale\/video/.test(String(entry?.fal || ''));
        const perFive = v2v ? CATEGORY_DEFAULT_USD.v2v : CATEGORY_DEFAULT_USD.video;
        return round(perFive * Math.max(1, requestedSeconds(payload) / 5));
    }
    if (kind === 'lipsync') return CATEGORY_DEFAULT_USD.lipsync;
    if (kind === 'audio') return CATEGORY_DEFAULT_USD.audio;
    if (kind === 'tool') return CATEGORY_DEFAULT_USD.tool;
    return round(CATEGORY_DEFAULT_USD.image * countOf(payload));
}

export function staticEstimate(catalog, entry, payload) {
    try {
        const n = catalog?.estimateUsd?.(entry, payload || {});
        if (Number.isFinite(n) && n >= 0) return round(n);
    } catch {
        // fall back to the entry's static price / category defaults
    }
    if (Number.isFinite(entry?.est_usd) && entry.est_usd >= 0) return round(entry.est_usd);
    return defaultEstimate(entry, payload);
}

// Cached unit price for one fal endpoint → {unit_price, unit} | null.
export async function falUnitPrice(endpointId) {
    if (!endpointId || !falKey()) return null;
    const map = cache();
    const hit = map.get(endpointId);
    if (hit && hit.until > Date.now()) return hit.price;
    let price = null;
    let ttl = FAILURE_TTL_MS;
    try {
        const url = `${upstream.falApi()}/v1/models/pricing?endpoint_id=${encodeURIComponent(endpointId)}`;
        const response = await fetch(url, { headers: { Authorization: `Key ${falKey()}`, Accept: 'application/json' }, signal: AbortSignal.timeout(PRICE_TIMEOUT_MS) });
        if (response.ok) {
            const data = await response.json();
            const row = Array.isArray(data?.prices) ? data.prices.find((p) => p?.endpoint_id === endpointId) || data.prices[0] : null;
            const unitPrice = num(row?.unit_price);
            if (row && unitPrice !== null && unitPrice >= 0 && (!row.currency || row.currency === 'USD')) {
                price = { unit_price: unitPrice, unit: String(row.unit || '').toLowerCase() };
                ttl = PRICE_TTL_MS;
            }
        } else {
            logGateway({ event: 'fal_pricing', provider: 'fal', status: response.status });
        }
    } catch {
        // pricing is optional
    }
    if (map.size > 1000) map.clear();
    map.set(endpointId, { price, until: Date.now() + ttl });
    return price;
}

// unit price × units for the units we understand; null otherwise.
export function refineWithPrice(price, entry, payload) {
    if (!price) return null;
    const unit = price.unit.replace(/s$/, '');
    if (unit === 'image') return round(price.unit_price * countOf(payload));
    if (unit === 'video' || unit === 'request' || unit === 'call' || unit === 'generation') return round(price.unit_price);
    if (unit === 'second') return round(price.unit_price * requestedSeconds(payload, entry?.kind === 'audio' ? 30 : 5));
    if (unit === 'minute') return round(price.unit_price * (requestedSeconds(payload, 60) / 60));
    return null;
}

// The fal input a browser payload builds to, or null when it doesn't build.
function builtInput(catalog, entry, payload) {
    try {
        const built = entry?.enabled ? catalog?.buildFalInput?.(entry, payload || {}) : null;
        return built?.input && typeof built.input === 'object' ? built.input : null;
    } catch {
        return null;
    }
}

// estimateUsd(catalog, entry, payload, {input}) → number (USD, 4 dp).
// `input` is the built fal input when the caller already has it; otherwise
// the payload is built here (raw browser values are only a fallback).
export async function estimateUsd(catalog, entry, payload, { refine = true, input } = {}) {
    const falInput = input && typeof input === 'object' ? input : (builtInput(catalog, entry, payload) || payload || {});
    const multiplier = qualityMultiplier(falInput);
    const base = round(staticEstimate(catalog, entry, payload) * multiplier);
    if (!refine || !entry?.fal) return base;
    const refined = refineWithPrice(await falUnitPrice(entry.fal), entry, falInput);
    return refined !== null ? Math.max(base, round(refined * multiplier)) : base;
}

export function resetPricingCache() {
    cache().clear();
}
