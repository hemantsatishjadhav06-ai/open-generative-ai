#!/usr/bin/env node
// Local stand-in for fal.ai and OpenRouter, for tests and offline E2E runs.
// Plain node:http, no dependencies, everything in memory.
//
//   npm run mock:upstream            (port from MOCK_UPSTREAM_PORT, default 4010)
//
// Point the gateway at it with:
//   FAL_KEY=mock-key OPENROUTER_API_KEY=mock-key
//   FAL_QUEUE_BASE=http://127.0.0.1:4010/fal-queue
//   FAL_RUN_BASE=http://127.0.0.1:4010/fal-run
//   FAL_REST_BASE=http://127.0.0.1:4010/fal-rest
//   FAL_API_BASE=http://127.0.0.1:4010/fal-api
//   OPENROUTER_BASE_URL=http://127.0.0.1:4010/openrouter/api/v1
//
// Behaviour
// - fal queue: POST /fal-queue/<endpoint id> → {request_id, status_url,
//   response_url, cancel_url} (owner/alias URLs, like real fal). Status goes
//   IN_QUEUE → IN_PROGRESS → COMPLETED: `pollsToComplete` non-terminal polls
//   (MOCK_POLLS_TO_COMPLETE, default 2), then COMPLETED. The result shape follows the
//   endpoint family: images[] / image / video / audio_file / audio / text.
//   Prompt markers: "FAIL_POLICY" → COMPLETED with error
//   content_policy_violation; "FAIL_422" → 422 on the result;
//   "FAIL_SUBMIT_422" → 422 on submit.
// - fal run (sync): POST /fal-run/<endpoint id> → the result immediately.
// - fal storage: POST /fal-rest/storage/upload/initiate(-multipart) + PUT
//   upload_url (must carry NO Authorization); files served at /files/….
// - fal pricing: GET /fal-api/v1/models/pricing?endpoint_id=….
// - OpenRouter: POST /openrouter/api/v1/chat/completions (JSON; tool_calls
//   when tools are sent and the last user message contains "use a tool";
//   SSE when stream:true; json_object/json_schema replies synthesised from
//   the schema; "FAIL_LLM_500" → 500) and GET /openrouter/api/v1/models.
// - Sample media at /media/<fixture> (tests/fixtures/media).
// - Test hooks: GET /__mock/state, POST /__mock/reset.
// Keys are only checked for presence/prefix ("bad-key" → 401); nothing is
// ever logged.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', 'tests', 'fixtures', 'media');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

function readBody(req, limit = 300 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > limit) {
                reject(Object.assign(new Error('too large'), { code: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function send(res, status, body, headers = {}) {
    const isBuffer = Buffer.isBuffer(body);
    const payload = isBuffer ? body : (body === undefined ? '' : JSON.stringify(body));
    res.writeHead(status, {
        'Content-Type': isBuffer ? (headers['Content-Type'] || 'application/octet-stream') : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
    });
    res.end(payload);
}

function parseJson(buffer) {
    try {
        return buffer.length ? JSON.parse(buffer.toString('utf8')) : {};
    } catch {
        return null;
    }
}

function textOfInput(input) {
    try {
        return JSON.stringify(input || {});
    } catch {
        return '';
    }
}

// Which output shape an endpoint family returns.
export function familyOf(endpoint) {
    const e = String(endpoint).toLowerCase();
    if (/whisper|wizper|speech-to-text|transcri|\bstt\b/.test(e)) return 'transcript';
    if (/stable-audio|music|cassetteai|sound-effect|sfx|lyria|ace-step|beatoven|audio-gen/.test(e)) return 'audio_file';
    if (/tts|text-to-speech|speech|voice|elevenlabs|chatterbox|kokoro|dia-tts/.test(e)) return 'audio';
    // Image endpoints under video-family names (e.g. fal-ai/wan-25-preview/text-to-image).
    if (/(^|\/)(text-to-image|image-to-image)(\/|$)/.test(e)) return 'images';
    if (/video|lipsync|lip-sync|i2v|t2v|kling|seedance|hailuo|wan-|veo|mmaudio|pixverse|luma|ray-|latentsync|infinitalk|omnihuman|ffmpeg|merge|animate|motion|reference-to-video|trim/.test(e)) return 'video';
    if (/birefnet|background|rembg|upscale|seedvr|esrgan|clarity|expand|outpaint|extension|inpaint|bria|ben\/|feynobg|pixelcut/.test(e)) return 'image';
    return 'images';
}

function envInt(name, fallback) {
    const n = Number(process.env[name]);
    return process.env[name] !== undefined && process.env[name] !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
}

export async function startMockUpstream({ port = envInt('MOCK_UPSTREAM_PORT', 0), host = '127.0.0.1', pollsToComplete = envInt('MOCK_POLLS_TO_COMPLETE', 2) } = {}) {
    const state = {
        jobs: new Map(),
        files: new Map(),
        multipart: new Map(),
        counters: { submit: 0, status: 0, result: 0, cancel: 0, run: 0, initiate: 0, put: 0, pricing: 0, chat: 0, chatStream: 0, models: 0 },
        requests: [],
        options: { pollsToComplete },
    };
    let origin = '';

    const media = (name) => `${origin}/media/${name}`;

    function outputFor(endpoint, input) {
        const family = familyOf(endpoint);
        const seed = Number.isInteger(input?.seed) ? input.seed : 42;
        if (family === 'transcript') {
            return {
                text: 'Welcome to the show. This is the best part. Thanks for watching.',
                chunks: [
                    { timestamp: [0, 2.5], text: 'Welcome to the show.' },
                    { timestamp: [2.5, 6], text: 'This is the best part.' },
                    { timestamp: [6, 9], text: 'Thanks for watching.' },
                ],
            };
        }
        if (family === 'audio_file') return { audio_file: { url: media('sample.mp3'), content_type: 'audio/mpeg', file_name: 'sample.mp3', file_size: 4510 } };
        if (family === 'audio') return { audio: { url: media('sample.mp3'), content_type: 'audio/mpeg' } };
        if (family === 'video') return { video: { url: media('sample.mp4'), content_type: 'video/mp4', file_name: 'sample.mp4', file_size: 10817 }, seed };
        if (family === 'image') return { image: { url: media('sample.png'), content_type: 'image/png', width: 64, height: 64 } };
        const count = Math.max(1, Math.min(4, Number(input?.num_images) || 1));
        return {
            images: Array.from({ length: count }, (_, i) => ({ url: media(i % 2 ? 'sample.jpg' : 'sample.png'), width: 64, height: 64, content_type: i % 2 ? 'image/jpeg' : 'image/png' })),
            seed,
            has_nsfw_concepts: Array.from({ length: count }, () => false),
            prompt: typeof input?.prompt === 'string' ? input.prompt : '',
        };
    }

    function requireFalKey(req, res) {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Key ') || !auth.slice(4).trim()) {
            send(res, 401, { detail: 'Missing authorization header' });
            return false;
        }
        if (auth.slice(4).trim() === 'bad-key') {
            send(res, 401, { detail: 'Invalid key' });
            return false;
        }
        return true;
    }

    function requireBearer(req, res) {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) {
            send(res, 401, { error: { code: 401, message: 'No auth credentials found' } });
            return false;
        }
        if (auth.slice(7).trim() === 'bad-key') {
            send(res, 401, { error: { code: 401, message: 'User not found.' } });
            return false;
        }
        return true;
    }

    function statusBody(job) {
        const base = { request_id: job.id, status_url: job.urls.status_url, response_url: job.urls.response_url, cancel_url: job.urls.cancel_url };
        if (job.cancelled) return { ...base, status: 'COMPLETED', logs: [], error: 'Request was cancelled', error_type: 'client_cancelled' };
        const step = job.polls;
        if (step <= Math.max(0, state.options.pollsToComplete - 1)) return { ...base, status: 'IN_QUEUE', queue_position: 0 };
        if (step <= state.options.pollsToComplete) return { ...base, status: 'IN_PROGRESS', logs: [] };
        if (job.text.includes('FAIL_POLICY')) {
            return { ...base, status: 'COMPLETED', logs: [], metrics: { inference_time: 0.1 }, error: 'Content policy violation detected', error_type: 'content_policy_violation' };
        }
        return { ...base, status: 'COMPLETED', logs: [], metrics: { inference_time: 0.1 } };
    }

    // ── fal queue ───────────────────────────────────────────────────────────
    async function falQueue(req, res, rest) {
        if (!requireFalKey(req, res)) return;
        const match = rest.match(/^(.+?)\/requests\/([^/]+)(\/status|\/cancel)?$/);
        if (match) {
            const [, , id, action] = match;
            const job = state.jobs.get(id);
            if (!job) return send(res, 404, action === '/cancel' ? { status: 'NOT_FOUND' } : { detail: 'Request not found' });
            if (action === '/status' && req.method === 'GET') {
                state.counters.status += 1;
                job.polls += 1;
                return send(res, 200, statusBody(job));
            }
            if (action === '/cancel' && req.method === 'PUT') {
                state.counters.cancel += 1;
                const current = statusBody(job).status;
                if (current === 'COMPLETED') return send(res, 400, { status: 'ALREADY_COMPLETED' });
                job.cancelled = true;
                return send(res, 202, { status: 'CANCELLATION_REQUESTED' });
            }
            if (!action && req.method === 'GET') {
                state.counters.result += 1;
                const st = statusBody(job);
                if (st.status !== 'COMPLETED') return send(res, 400, { detail: 'Request is still in progress' });
                if (st.error) return send(res, 422, { detail: [{ loc: ['body'], msg: st.error, type: st.error_type }] });
                if (job.text.includes('FAIL_422')) {
                    return send(res, 422, { detail: [{ loc: ['body', 'prompt'], msg: 'Input should be a shorter prompt', type: 'value_error' }] });
                }
                return send(res, 200, outputFor(job.endpoint, job.input));
            }
            return send(res, 405, { detail: 'Method not allowed' });
        }
        if (req.method !== 'POST') return send(res, 405, { detail: 'Method not allowed' });
        const input = parseJson(await readBody(req));
        if (input === null) return send(res, 422, { detail: [{ loc: ['body'], msg: 'Invalid JSON', type: 'value_error' }] });
        state.counters.submit += 1;
        const text = textOfInput(input);
        if (text.includes('FAIL_SUBMIT_422')) {
            return send(res, 422, { detail: [{ loc: ['body', 'prompt'], msg: 'The prompt was flagged', type: 'content_policy_violation' }] });
        }
        const endpoint = rest;
        const id = crypto.randomUUID();
        const segments = endpoint.split('/');
        const prefix = segments[0] === 'workflows' || segments[0] === 'comfy' ? segments.slice(0, 3).join('/') : segments.slice(0, 2).join('/');
        const baseUrl = `${origin}/fal-queue/${prefix}/requests/${id}`;
        const urls = { status_url: `${baseUrl}/status`, response_url: baseUrl, cancel_url: `${baseUrl}/cancel` };
        state.jobs.set(id, { id, endpoint, input, text, polls: 0, cancelled: false, urls });
        return send(res, 200, { request_id: id, ...urls, queue_position: 0 });
    }

    // ── fal run (sync) ──────────────────────────────────────────────────────
    async function falRun(req, res, endpoint) {
        if (!requireFalKey(req, res)) return;
        if (req.method !== 'POST') return send(res, 405, { detail: 'Method not allowed' });
        const input = parseJson(await readBody(req));
        if (input === null) return send(res, 422, { detail: [{ loc: ['body'], msg: 'Invalid JSON', type: 'value_error' }] });
        state.counters.run += 1;
        const text = textOfInput(input);
        if (text.includes('FAIL_422') || text.includes('FAIL_SUBMIT_422')) {
            return send(res, 422, { detail: [{ loc: ['body', 'prompt'], msg: 'Input should be a shorter prompt', type: 'value_error' }] });
        }
        if (text.includes('FAIL_POLICY')) {
            return send(res, 422, { detail: [{ loc: ['body', 'prompt'], msg: 'Content policy violation', type: 'content_policy_violation' }] });
        }
        return send(res, 200, outputFor(endpoint, input));
    }

    // ── fal storage ─────────────────────────────────────────────────────────
    async function falRest(req, res, rest, url) {
        if (!requireFalKey(req, res)) return;
        if (req.method !== 'POST' || (rest !== 'storage/upload/initiate' && rest !== 'storage/upload/initiate-multipart')) {
            return send(res, 404, { detail: 'Not found' });
        }
        if (url.searchParams.get('storage_type') !== 'fal-cdn-v3') return send(res, 400, { detail: 'storage_type must be fal-cdn-v3' });
        const body = parseJson(await readBody(req));
        if (!body || typeof body.content_type !== 'string' || typeof body.file_name !== 'string') return send(res, 422, { detail: 'content_type and file_name are required' });
        state.counters.initiate += 1;
        const id = crypto.randomBytes(8).toString('hex');
        const name = body.file_name.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'file.bin';
        const fileUrl = `${origin}/files/${id}/${name}`;
        if (rest.endsWith('multipart')) {
            state.multipart.set(id, { parts: new Map(), contentType: body.content_type, name });
            return send(res, 200, { upload_url: `${origin}/upload-mp/${id}?sig=mock`, file_url: fileUrl });
        }
        state.files.set(id, { pending: true, contentType: body.content_type, name });
        return send(res, 200, { upload_url: `${origin}/upload/${id}?sig=mock`, file_url: fileUrl });
    }

    async function uploadPut(req, res, id) {
        if (req.headers.authorization) return send(res, 400, { detail: 'presigned uploads must not carry Authorization' });
        const record = state.files.get(id);
        if (!record || req.method !== 'PUT') return send(res, 404, { detail: 'Unknown upload' });
        const bytes = await readBody(req);
        state.counters.put += 1;
        state.files.set(id, { pending: false, contentType: req.headers['content-type'] || record.contentType, name: record.name, bytes });
        return send(res, 200, {});
    }

    async function uploadMultipart(req, res, id, part) {
        if (req.headers.authorization) return send(res, 400, { detail: 'presigned uploads must not carry Authorization' });
        const record = state.multipart.get(id);
        if (!record) return send(res, 404, { detail: 'Unknown upload' });
        if (part === 'complete' && req.method === 'POST') {
            const body = parseJson(await readBody(req));
            const parts = Array.isArray(body?.parts) ? body.parts : [];
            const ordered = parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => {
                const stored = record.parts.get(Number(p.partNumber));
                if (!stored || stored.etag !== p.etag) throw Object.assign(new Error('bad part'), { code: 400 });
                return stored.bytes;
            });
            state.files.set(id, { pending: false, contentType: record.contentType, name: record.name, bytes: Buffer.concat(ordered) });
            state.multipart.delete(id);
            return send(res, 200, { ok: true });
        }
        if (req.method === 'PUT' && /^\d+$/.test(part)) {
            const bytes = await readBody(req);
            const etag = `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
            record.parts.set(Number(part), { bytes, etag });
            state.counters.put += 1;
            return send(res, 200, { etag }, { ETag: etag });
        }
        return send(res, 405, { detail: 'Method not allowed' });
    }

    function serveFile(res, id) {
        const record = state.files.get(id);
        if (!record || record.pending) return send(res, 404, { detail: 'Not found' });
        return send(res, 200, record.bytes, { 'Content-Type': record.contentType });
    }

    function serveMedia(res, name) {
        const safe = path.basename(name);
        const file = path.join(FIXTURES, safe);
        if (!fs.existsSync(file)) return send(res, 404, { detail: 'Not found' });
        const bytes = fs.readFileSync(file);
        return send(res, 200, bytes, { 'Content-Type': MIME[path.extname(safe)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
    }

    // ── fal pricing ─────────────────────────────────────────────────────────
    function falApi(req, res, rest, url) {
        if (!requireFalKey(req, res)) return;
        if (rest !== 'v1/models/pricing' || req.method !== 'GET') return send(res, 404, { error: { type: 'not_found', message: 'Not found' } });
        state.counters.pricing += 1;
        const ids = url.searchParams.getAll('endpoint_id').flatMap((v) => v.split(',')).filter(Boolean);
        const prices = ids.map((id) => {
            const family = familyOf(id);
            if (family === 'video') return { endpoint_id: id, unit_price: 0.1, unit: 'second', currency: 'USD' };
            if (family === 'audio' || family === 'audio_file' || family === 'transcript') return { endpoint_id: id, unit_price: 0.02, unit: 'request', currency: 'USD' };
            return { endpoint_id: id, unit_price: 0.03, unit: 'image', currency: 'USD' };
        });
        return send(res, 200, { prices, next_cursor: null, has_more: false });
    }

    // ── OpenRouter ──────────────────────────────────────────────────────────
    function sample(schema, key = 'value', depth = 0) {
        if (!schema || typeof schema !== 'object' || depth > 6) return `mock ${key}`;
        if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
        if (schema.const !== undefined) return schema.const;
        const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
        if (type === 'object' || schema.properties) {
            const out = {};
            const props = schema.properties || {};
            const required = Array.isArray(schema.required) ? schema.required : Object.keys(props);
            for (const name of Object.keys(props)) if (required.includes(name) || depth < 2) out[name] = sample(props[name], name, depth + 1);
            return out;
        }
        if (type === 'array') {
            const count = Math.max(1, Number(schema.minItems) || 1);
            return Array.from({ length: Math.min(count, 3) }, (_, i) => sample(schema.items, `${key}_${i + 1}`, depth + 1));
        }
        if (type === 'number' || type === 'integer') {
            const min = Number.isFinite(schema.minimum) ? schema.minimum : 0;
            const max = Number.isFinite(schema.maximum) ? schema.maximum : min + 10;
            return type === 'integer' ? Math.round((min + max) / 2) : (min + max) / 2;
        }
        if (type === 'boolean') return false;
        return `mock ${key}`;
    }

    function lastUserText(messages) {
        const last = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m?.role === 'user');
        if (!last) return '';
        if (typeof last.content === 'string') return last.content;
        if (Array.isArray(last.content)) return last.content.filter((p) => p?.type === 'text').map((p) => p.text).join(' ');
        return '';
    }

    function completionFor(body) {
        const userText = lastUserText(body.messages);
        const tools = Array.isArray(body.tools) ? body.tools : [];
        const lastRole = Array.isArray(body.messages) && body.messages.length ? body.messages[body.messages.length - 1].role : null;
        if (tools.length && /use a tool/i.test(userText) && lastRole !== 'tool') {
            const tool = tools[0]?.function || {};
            const args = sample(tool.parameters || { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] }, 'arg');
            return { tool_calls: [{ id: `call_mock_${state.counters.chat}`, type: 'function', function: { name: tool.name || 'tool', arguments: JSON.stringify(args) } }], content: null, finish_reason: 'tool_calls' };
        }
        const format = body.response_format;
        if (format?.type === 'json_schema') return { content: JSON.stringify(sample(format.json_schema?.schema || {}, 'result')), finish_reason: 'stop' };
        if (format?.type === 'json_object') return { content: JSON.stringify({ result: 'mock', ok: true }), finish_reason: 'stop' };
        if (lastRole === 'tool') return { content: 'Done! I used the tool and here is your result.', finish_reason: 'stop' };
        const echo = userText.replace(/\s+/g, ' ').trim().slice(0, 60);
        return { content: echo ? `Mock reply: ${echo}` : 'Mock reply.', finish_reason: 'stop' };
    }

    const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, cost: 0.0001 };

    async function openrouter(req, res, rest) {
        if (!requireBearer(req, res)) return;
        if (rest === 'models' && req.method === 'GET') {
            state.counters.models += 1;
            return send(res, 200, { data: ['openai/gpt-6-luna', 'anthropic/claude-sonnet-5', 'google/gemini-3.8-flash'].map((id) => ({ id, name: id, context_length: 1_000_000, pricing: { prompt: '0.0000001', completion: '0.0000005' } })) });
        }
        if (rest !== 'chat/completions' || req.method !== 'POST') return send(res, 404, { error: { code: 404, message: 'Not found' } });
        const body = parseJson(await readBody(req));
        if (!body || !Array.isArray(body.messages) || !body.messages.length) return send(res, 400, { error: { code: 400, message: 'messages is required' } });
        if (typeof body.model !== 'string' || !body.model) return send(res, 400, { error: { code: 400, message: 'model is required' } });
        state.counters.chat += 1;
        if (/FAIL_LLM_500/.test(lastUserText(body.messages))) return send(res, 500, { error: { code: 500, message: 'Internal error' } });
        const reply = completionFor(body);
        const id = `gen-mock-${state.counters.chat}`;
        const created = Math.floor(Date.now() / 1000);
        if (body.stream) {
            state.counters.chatStream += 1;
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Generation-Id': id });
            const chunk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
            res.write(': OPENROUTER PROCESSING\n\n');
            res.write(chunk({ role: 'assistant', content: '' }));
            if (reply.tool_calls) {
                res.write(chunk({ tool_calls: reply.tool_calls.map((call, index) => ({ index, ...call })) }));
            } else {
                for (const word of String(reply.content).split(/(?<= )/)) res.write(chunk({ content: word }));
            }
            res.write(chunk({}, reply.finish_reason));
            res.write(chunk({}, reply.finish_reason, { usage }));
            res.end('data: [DONE]\n\n');
            return;
        }
        return send(res, 200, {
            id,
            object: 'chat.completion',
            created,
            model: body.model,
            choices: [{ index: 0, finish_reason: reply.finish_reason, message: { role: 'assistant', content: reply.content, ...(reply.tool_calls ? { tool_calls: reply.tool_calls } : {}) } }],
            usage,
        }, { 'X-Generation-Id': id });
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://mock');
        const p = url.pathname;
        state.requests.push({ method: req.method, path: p, auth: req.headers.authorization ? req.headers.authorization.split(' ')[0] : null });
        if (state.requests.length > 500) state.requests.shift();
        try {
            if (p === '/__mock/state') return send(res, 200, { counters: state.counters, jobs: state.jobs.size, files: state.files.size, requests: state.requests.slice(-50) });
            if (p === '/__mock/reset' && req.method === 'POST') {
                state.jobs.clear();
                state.files.clear();
                state.multipart.clear();
                state.requests.length = 0;
                for (const key of Object.keys(state.counters)) state.counters[key] = 0;
                return send(res, 200, { ok: true });
            }
            if (p === '/health') return send(res, 200, { ok: true });
            if (p.startsWith('/media/')) return serveMedia(res, decodeURIComponent(p.slice(7)));
            if (p.startsWith('/files/')) return serveFile(res, p.split('/')[2]);
            if (p.startsWith('/upload/')) return uploadPut(req, res, p.split('/')[2]);
            if (p.startsWith('/upload-mp/')) {
                const [, , id, part] = p.split('/');
                return uploadMultipart(req, res, id, part);
            }
            if (p.startsWith('/fal-queue/')) return falQueue(req, res, p.slice('/fal-queue/'.length));
            if (p.startsWith('/fal-run/')) return falRun(req, res, p.slice('/fal-run/'.length));
            if (p.startsWith('/fal-rest/')) return falRest(req, res, p.slice('/fal-rest/'.length), url);
            if (p.startsWith('/fal-api/')) return falApi(req, res, p.slice('/fal-api/'.length), url);
            if (p.startsWith('/openrouter/api/v1/')) return openrouter(req, res, p.slice('/openrouter/api/v1/'.length));
            return send(res, 404, { detail: 'Not found' });
        } catch (error) {
            if (!res.headersSent) send(res, Number.isInteger(error?.code) ? error.code : 500, { detail: 'mock error' });
            else res.end();
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
    });
    const address = server.address();
    origin = `http://${host}:${address.port}`;

    return {
        url: origin,
        port: address.port,
        state,
        env: {
            FAL_QUEUE_BASE: `${origin}/fal-queue`,
            FAL_RUN_BASE: `${origin}/fal-run`,
            FAL_REST_BASE: `${origin}/fal-rest`,
            FAL_API_BASE: `${origin}/fal-api`,
            OPENROUTER_BASE_URL: `${origin}/openrouter/api/v1`,
        },
        close: () => new Promise((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        }),
    };
}

// Sets the gateway's upstream overrides (plus mock keys unless provided).
export function applyMockEnv(mock, env = process.env) {
    Object.assign(env, mock.env);
    if (!env.FAL_KEY) env.FAL_KEY = 'mock-fal-key';
    if (!env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = 'mock-openrouter-key';
    return env;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const mock = await startMockUpstream({ port: envInt('MOCK_UPSTREAM_PORT', 4010) });
    process.stdout.write(`Mock upstream listening on ${mock.url}\n`);
    process.stdout.write('Set these for the gateway:\n');
    for (const [key, value] of Object.entries(mock.env)) process.stdout.write(`  ${key}=${value}\n`);
    process.stdout.write('  FAL_KEY=mock-fal-key\n  OPENROUTER_API_KEY=mock-openrouter-key\n');
    const stop = () => mock.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
