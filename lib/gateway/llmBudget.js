// Budgeted OpenRouter calls. Every chat call reserves a worst-case amount
// on the workspace ledger BEFORE it is sent and settles to the real
// usage.cost afterwards:
//
//   ceiling = prompt tokens (≈ chars / 4, plus a flat allowance per image)
//             × prompt price + max_tokens × completion price + per-request fee
//
// Prices come from a cached OpenRouter GET /models lookup (1 h; failures are
// cached briefly) with conservative defaults (AQUORA_LLM_PROMPT_USD_PER_MTOK /
// AQUORA_LLM_COMPLETION_USD_PER_MTOK) when a model is not listed.
//
// Settlement rules (OpenRouter bills generated tokens even when the client
// goes away):
//   - reply with a reported usage.cost      → settle to that cost
//   - upstream answered with an error status → refund (nothing was generated)
//   - abort, timeout, network error, stream cut before the usage chunk, or
//     no usage reported                      → keep the reservation
// Non-streamed calls are never tied to the caller's AbortSignal: an abort
// only stops the caller from waiting, and the call still settles to its
// real cost when it finishes.

import crypto from 'node:crypto';
import { openrouterKey, upstream } from './config.js';
import { errors } from './errors.js';
import { reserveBudget, settleCharge, settleJob } from './limits.js';
import { chat, endUserId, MAX_TOKENS_CAP, resolveModel } from './openrouter.js';
import { shared } from './state.js';

const PRICE_TTL_MS = 60 * 60_000;
const FAILURE_TTL_MS = 10 * 60_000;
const PRICE_TIMEOUT_MS = 3000;
// Allowance per image part (OpenRouter bills images as prompt tokens).
export const IMAGE_TOKENS = 1600;
// Tool/format schemas and message framing.
const OVERHEAD_TOKENS = 64;

function perMillion(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n / 1e6 : fallback / 1e6;
}

// USD per token when a model's price is unknown (deliberately high).
export function defaultLlmPrice() {
    return {
        prompt: perMillion('AQUORA_LLM_PROMPT_USD_PER_MTOK', 5),
        completion: perMillion('AQUORA_LLM_COMPLETION_USD_PER_MTOK', 25),
        request: 0,
        image: 0,
    };
}

const priceCache = () => shared('openrouterPrices', () => ({ until: 0, byModel: null, loading: null }));

async function fetchPrices() {
    const key = openrouterKey();
    if (!key) return null;
    const response = await fetch(`${upstream.openrouter()}/models`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const byModel = new Map();
    for (const row of Array.isArray(data?.data) ? data.data : []) {
        const p = row?.pricing;
        if (typeof row?.id !== 'string' || !p) continue;
        const n = (v) => {
            const x = Number(v);
            return Number.isFinite(x) && x >= 0 ? x : null;
        };
        const prompt = n(p.prompt);
        const completion = n(p.completion);
        if (prompt === null || completion === null) continue;
        byModel.set(row.id, { prompt, completion, request: n(p.request) || 0, image: n(p.image) || 0 });
    }
    return byModel;
}

// → {prompt, completion, request, image} in USD per token / request / image.
export async function llmPrice(model) {
    const cache = priceCache();
    if (!cache.byModel || cache.until <= Date.now()) {
        if (!cache.loading) {
            cache.loading = fetchPrices()
                .then((map) => {
                    cache.byModel = map || cache.byModel || new Map();
                    cache.until = Date.now() + (map ? PRICE_TTL_MS : FAILURE_TTL_MS);
                })
                .catch(() => {
                    cache.byModel = cache.byModel || new Map();
                    cache.until = Date.now() + FAILURE_TTL_MS;
                })
                .finally(() => { cache.loading = null; });
        }
        await cache.loading;
    }
    return cache.byModel?.get(model) || defaultLlmPrice();
}

export function resetLlmPrices() {
    const cache = priceCache();
    cache.until = 0;
    cache.byModel = null;
    cache.loading = null;
}

// Rough prompt size: text chars / 4, IMAGE_TOKENS per image part (their
// base64 bytes are not counted as text).
export function promptTokens({ messages, tools, response_format } = {}) {
    let chars = 0;
    let images = 0;
    for (const message of Array.isArray(messages) ? messages : []) {
        if (!message || typeof message !== 'object') continue;
        if (typeof message.content === 'string') chars += message.content.length;
        else if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part?.type === 'image_url') images += 1;
                else if (typeof part?.text === 'string') chars += part.text.length;
            }
        }
        if (Array.isArray(message.tool_calls)) chars += JSON.stringify(message.tool_calls).length;
        chars += 16;
    }
    if (Array.isArray(tools) && tools.length) chars += JSON.stringify(tools).length;
    if (response_format && typeof response_format === 'object') chars += JSON.stringify(response_format).length;
    return { tokens: Math.ceil(chars / 4) + images * IMAGE_TOKENS + OVERHEAD_TOKENS, images };
}

export function maxOutputTokens(maxTokens) {
    const n = Number(maxTokens);
    return Math.max(1, Math.min(MAX_TOKENS_CAP, Number.isFinite(n) && n > 0 ? Math.floor(n) : MAX_TOKENS_CAP));
}

// Worst-case USD for one call.
export async function llmCeilingUsd(options = {}) {
    const model = options.model && options.skipAllowlist ? options.model : resolveModel(options);
    const price = await llmPrice(model);
    const { tokens, images } = promptTokens(options);
    const usd = tokens * price.prompt + maxOutputTokens(options.max_tokens) * price.completion + price.request + images * price.image;
    return Math.max(0.0001, Math.ceil(usd * 1e6) / 1e6);
}

// The reservation is refunded only when OpenRouter answered with an error
// status (or the request never left: invalid input / not configured).
function refundable(error) {
    return error?.llmNotBilled === true;
}

function reportedCost(usage) {
    const cost = Number(usage?.cost);
    return usage?.costReported === true && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

function abortPromise(signal) {
    if (!signal) return null;
    return new Promise((_, reject) => {
        const fail = () => reject(signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
    });
}

// meteredChat({cid, ...chatOptions}) → same shape as chat().
// Throws 402 before sending when the worst case does not fit the budget.
export async function meteredChat({ cid, ...options }) {
    if (!cid) throw new Error('meteredChat needs a workspace');
    if (!openrouterKey()) throw errors.notConfigured('The AI text service');
    const ceiling = await llmCeilingUsd(options);
    const jobId = `llm_${crypto.randomBytes(9).toString('base64url')}`;
    const day = await reserveBudget({ cid, usd: ceiling, jobId });
    const user = options.user || endUserId(cid);

    if (options.stream) {
        let result;
        try {
            result = await chat({ ...options, user });
        } catch (error) {
            await settleJob({ jobId, refund: refundable(error), day });
            throw error;
        }
        result.usage.then(async (usage) => {
            const cost = reportedCost(usage);
            // A cancelled / broken stream may already be billed: keep the reservation.
            if (cost !== null && !usage?.cancelled && !usage?.error) await settleCharge({ jobId, usd: cost, day });
            else await settleJob({ jobId, refund: false, day });
        }).catch(() => {});
        return { ...result, reservedUsd: ceiling };
    }

    const { signal, ...rest } = options;
    const call = chat({ ...rest, user }).then(
        async (result) => {
            const cost = reportedCost(result.usage);
            if (cost !== null) await settleCharge({ jobId, usd: cost, day });
            else await settleJob({ jobId, refund: false, day });
            return result;
        },
        async (error) => {
            await settleJob({ jobId, refund: refundable(error), day });
            throw error;
        },
    );
    const aborted = abortPromise(signal);
    if (!aborted) return call;
    call.catch(() => {});
    aborted.catch(() => {});
    return Promise.race([call, aborted]);
}
