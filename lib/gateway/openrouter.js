// OpenRouter chat client (server-only). `Authorization: Bearer` plus the
// app-attribution headers. Model allowlist = the three purpose models +
// OPENROUTER_ALLOWED_MODELS; max_tokens is capped server-side; 408/429/5xx
// are retried with backoff (at most 2 retries) before a stream is committed.

import crypto from 'node:crypto';
import { allowedLlmModels, llmModels, openrouterKey, upstream } from './config.js';
import { GatewayError, errors } from './errors.js';
import { logGateway } from './log.js';
import { normalizeUpstream, sleep, backoffMs, withTimeout } from '../upstream.js';
import { SITE_URL } from '../siteUrl.js';

export const MAX_TOKENS_CAP = 4000;
const MAX_RETRIES = 2;
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 524, 529]);
const PURPOSES = new Set(['fast', 'agent', 'vision']);
const ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);
const MAX_MESSAGES = 200;
const MAX_TOTAL_CHARS = 400_000;

export function modelForPurpose(purpose) {
    const models = llmModels();
    return models[PURPOSES.has(purpose) ? purpose : 'fast'];
}

// Picks the model for a call. An explicit `model` must be on the allowlist.
export function resolveModel({ purpose, model } = {}) {
    if (model !== undefined && model !== null && model !== '') {
        if (typeof model !== 'string' || !allowedLlmModels().has(model)) {
            throw new GatewayError(400, 'model_not_allowed', 'That AI model is not available here.', { field: 'model' });
        }
        return model;
    }
    return modelForPurpose(purpose);
}

// Hashes the workspace into a stable, non-reversible end-user id.
export function endUserId(cid) {
    return cid ? crypto.createHash('sha256').update(`aquora:user:${cid}`).digest('hex').slice(0, 24) : undefined;
}

function checkContentPart(part, index) {
    if (!part || typeof part !== 'object') throw errors.badRequest('Invalid message content.', `messages[${index}].content`);
    if (part.type === 'text') {
        if (typeof part.text !== 'string') throw errors.badRequest('Invalid text part.', `messages[${index}].content`);
        return { type: 'text', text: part.text };
    }
    if (part.type === 'image_url') {
        const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
        if (typeof url !== 'string' || !(/^https:\/\//i.test(url) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url))) {
            throw errors.badRequest('Images must be https URLs or base64 data URLs.', `messages[${index}].content`);
        }
        const detail = ['auto', 'low', 'high'].includes(part.image_url?.detail) ? part.image_url.detail : undefined;
        return { type: 'image_url', image_url: detail ? { url, detail } : { url } };
    }
    throw errors.badRequest('Unsupported message content type.', `messages[${index}].content`);
}

// Validates and copies chat messages. `trusted` (server-side callers) may use
// every role and tool fields; browser input is limited to system/user/assistant.
export function sanitizeMessages(messages, { trusted = false } = {}) {
    if (!Array.isArray(messages) || !messages.length) throw errors.badRequest('messages must be a non-empty array.', 'messages');
    if (messages.length > MAX_MESSAGES) throw errors.badRequest('Too many messages.', 'messages');
    let chars = 0;
    const out = messages.map((message, index) => {
        if (!message || typeof message !== 'object') throw errors.badRequest('Invalid message.', `messages[${index}]`);
        const role = message.role;
        const allowed = trusted ? ROLES.has(role) : ['system', 'user', 'assistant'].includes(role);
        if (!allowed) throw errors.badRequest('Invalid message role.', `messages[${index}].role`);
        const copy = { role };
        if (typeof message.content === 'string') {
            copy.content = message.content;
            chars += message.content.length;
        } else if (Array.isArray(message.content)) {
            copy.content = message.content.map((part) => checkContentPart(part, index));
            chars += JSON.stringify(copy.content).length;
        } else if (message.content === null && trusted && role === 'assistant') {
            copy.content = null;
        } else {
            throw errors.badRequest('Invalid message content.', `messages[${index}].content`);
        }
        if (trusted) {
            if (Array.isArray(message.tool_calls)) copy.tool_calls = message.tool_calls;
            if (typeof message.tool_call_id === 'string') copy.tool_call_id = message.tool_call_id;
            if (typeof message.name === 'string') copy.name = message.name;
        }
        return copy;
    });
    if (chars > MAX_TOTAL_CHARS) throw errors.tooLarge('The conversation is too long.');
    return out;
}

function sanitizeResponseFormat(format) {
    if (format === undefined || format === null) return undefined;
    if (format?.type === 'json_object') return { type: 'json_object' };
    if (format?.type === 'json_schema' && format.json_schema && typeof format.json_schema === 'object') {
        const { name, schema, strict, description } = format.json_schema;
        if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name) || !schema || typeof schema !== 'object') {
            throw errors.badRequest('Invalid response_format.', 'response_format');
        }
        const out = { type: 'json_schema', json_schema: { name, schema } };
        if (typeof strict === 'boolean') out.json_schema.strict = strict;
        if (typeof description === 'string') out.json_schema.description = description.slice(0, 500);
        return out;
    }
    if (format?.type === 'text') return undefined;
    throw errors.badRequest('Invalid response_format.', 'response_format');
}

function mapOpenRouterError(status, body) {
    const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 240) : '';
    if (status === 401 || (status === 403 && !/moderation|flagged|guardrail/i.test(message))) {
        logGateway({ event: 'openrouter_auth_failed', provider: 'openrouter', status, code: 'check_OPENROUTER_API_KEY' }, 'error');
        return errors.notConfigured('The AI text service');
    }
    if (status === 403) return new GatewayError(422, 'content_policy_violation', 'That message was blocked by the model provider\'s safety filter.');
    if (status === 402) {
        logGateway({ event: 'openrouter_out_of_credits', provider: 'openrouter', status, code: 'top_up_openrouter' }, 'error');
        return new GatewayError(503, 'upstream_unavailable', 'The AI text service is temporarily unavailable. Ask the site owner to check its credits.', { retryable: false });
    }
    if (status === 400 || status === 404 || status === 413 || status === 422) {
        return new GatewayError(400, 'invalid_request', message ? `The AI model rejected the request: ${message}` : 'The AI model rejected the request.');
    }
    if (status === 429) return new GatewayError(429, 'upstream_busy', 'The AI text service is busy. Try again in a moment.', { retryable: true, retryAfter: 5 });
    return new GatewayError(502, 'upstream_unavailable', 'The AI text service had a problem. Try again in a moment.', { retryable: true });
}

function buildBody({ model, messages, tools, tool_choice, response_format, max_tokens, temperature, user, stream, reasoning, trusted }) {
    const body = {
        model,
        messages: sanitizeMessages(messages, { trusted }),
        max_tokens: Math.max(1, Math.min(MAX_TOKENS_CAP, Number.isFinite(Number(max_tokens)) && Number(max_tokens) > 0 ? Math.floor(Number(max_tokens)) : MAX_TOKENS_CAP)),
    };
    if (Number.isFinite(Number(temperature)) && temperature !== null && temperature !== undefined) {
        body.temperature = Math.max(0, Math.min(2, Number(temperature)));
    }
    const format = sanitizeResponseFormat(response_format);
    if (format) body.response_format = format;
    if (Array.isArray(tools) && tools.length) {
        body.tools = tools;
        if (tool_choice !== undefined) body.tool_choice = tool_choice;
    }
    if (reasoning && typeof reasoning === 'object') body.reasoning = reasoning;
    if (user) body.user = String(user).slice(0, 128);
    if (stream) {
        body.stream = true;
        body.stream_options = { include_usage: true };
    }
    return body;
}

function headers() {
    const key = openrouterKey();
    if (!key) throw errors.notConfigured('The AI text service');
    return {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': 'Aquora',
        'X-OpenRouter-Title': 'Aquora',
    };
}

async function post(body, { signal, timeoutMs }) {
    const url = `${upstream.openrouter()}/chat/completions`;
    for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        let response;
        try {
            response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: withTimeout(signal, timeoutMs) });
        } catch (error) {
            if (signal?.aborted) throw error;
            logGateway({ event: 'openrouter_request', provider: 'openrouter', status: null, ms: Date.now() - t0, code: error?.name || 'network' }, 'error');
            if (attempt < MAX_RETRIES && error?.name !== 'TimeoutError') {
                await sleep(backoffMs(attempt), signal);
                continue;
            }
            if (error?.name === 'TimeoutError') throw new GatewayError(504, 'upstream_timeout', 'The AI text service took too long. Try again.', { retryable: true });
            throw new GatewayError(502, 'upstream_unreachable', "Couldn't reach the AI text service. Try again.", { retryable: true });
        }
        logGateway({ event: 'openrouter_request', provider: 'openrouter', status: response.status, ms: Date.now() - t0 });
        if (response.ok) return response;
        const text = await response.text().catch(() => '');
        if (RETRY_STATUS.has(response.status) && attempt < MAX_RETRIES) {
            const retryAfter = Number(response.headers.get('retry-after'));
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(10_000, retryAfter * 1000) : backoffMs(attempt), signal);
            continue;
        }
        // OpenRouter answered with an error status: nothing was generated.
        throw notBilled(mapOpenRouterError(response.status, normalizeUpstream(response.status, text).body));
    }
}

// Marks an error raised before any tokens could be billed (invalid input,
// not configured, an upstream error status), so llmBudget refunds it.
function notBilled(error) {
    if (error && typeof error === 'object') error.llmNotBilled = true;
    return error;
}

// chat({...}) → {content, tool_calls, usage:{…, cost}, model, finish_reason}
// chat({..., stream:true}) → {stream: ReadableStream (SSE bytes), model, usage: Promise}
export async function chat(options = {}) {
    let model;
    let body;
    try {
        model = options.model && options.skipAllowlist ? options.model : resolveModel(options);
        body = buildBody({ ...options, model });
        headers();
    } catch (error) {
        throw notBilled(error);
    }
    const signal = options.signal;
    if (body.stream) {
        const response = await post(body, { signal, timeoutMs: options.timeoutMs || 300_000 });
        const tap = tapSse(response.body);
        return { stream: tap.stream, model, usage: tap.usage };
    }
    const response = await post(body, { signal, timeoutMs: options.timeoutMs || 120_000 });
    const text = await response.text();
    const data = normalizeUpstream(response.status, text).body || {};
    if (data.error) throw mapOpenRouterError(Number(data.error.code) || 502, data);
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const message = choice?.message || {};
    return {
        content: typeof message.content === 'string' ? message.content : (message.content ?? ''),
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        finish_reason: choice?.finish_reason || null,
        model: data.model || model,
        usage: { ...(data.usage || {}), cost: Number(data.usage?.cost) || 0, costReported: data.usage?.cost !== undefined && data.usage?.cost !== null },
    };
}

// Parses SSE text: calls onEvent(parsedJson) for every `data:` line except
// [DONE]; keep-alive comments (': ...') are ignored.
export function createSseParser(onEvent) {
    let buffer = '';
    return (chunkText, flush = false) => {
        buffer += chunkText;
        const lines = buffer.split(/\r?\n/);
        buffer = flush ? '' : lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
                onEvent(JSON.parse(data));
            } catch {
                // partial / non-JSON line
            }
        }
    };
}

// Passes the upstream SSE bytes through unchanged while watching for the
// usage chunk (cost) and mid-stream error events.
export function tapSse(body) {
    let resolveUsage;
    const usage = new Promise((resolve) => { resolveUsage = resolve; });
    let seen = { cost: 0, costReported: false };
    let failed = null;
    const decoder = new TextDecoder();
    const parse = createSseParser((event) => {
        if (event?.usage) seen = { ...event.usage, cost: Number(event.usage.cost) || 0, costReported: event.usage.cost !== undefined && event.usage.cost !== null };
        if (event?.error) failed = event.error;
    });
    const reader = body.getReader();
    const stream = new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    parse(decoder.decode(), true);
                    resolveUsage({ ...seen, error: failed });
                    controller.close();
                    return;
                }
                parse(decoder.decode(value, { stream: true }));
                controller.enqueue(value);
            } catch (error) {
                resolveUsage({ ...seen, error: failed || { message: 'stream interrupted' } });
                controller.error(error);
            }
        },
        cancel(reason) {
            resolveUsage({ ...seen, error: failed, cancelled: true });
            return reader.cancel(reason);
        },
    });
    return { stream, usage };
}

// Strips code fences and returns the first JSON object/array in a reply.
export function parseJsonReply(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.search(/[[{]/);
        if (start === -1) return null;
        const open = raw[start];
        const close = open === '{' ? '}' : ']';
        const end = raw.lastIndexOf(close);
        if (end <= start) return null;
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}
