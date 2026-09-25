// Studio client tests: the gateway transport (gateway.js), the session
// client (session.js), the model-availability filter and workspace-scoped
// history keys. Browser globals (window, fetch, XMLHttpRequest, localStorage)
// are small in-memory fakes; nothing leaves the process.
//
// Run: node --import ./tests/support/register.mjs --test packages/studio/tests/*.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── browser fakes (installed before the modules load) ─────────────────────

const realSetTimeout = globalThis.setTimeout;
// Polling waits 2s between attempts; run those waits immediately.
globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

const windowTarget = new EventTarget();
globalThis.window = windowTarget;
const events = [];
for (const type of ['aquora:session-required', 'aquora:budget-exceeded', 'aquora:session-changed']) {
  windowTarget.addEventListener(type, (event) => events.push({ type, detail: event.detail }));
}

class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(i) { return [...this.#map.keys()][i] ?? null; }
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
  keys() { return [...this.#map.keys()]; }
}
globalThis.localStorage = new MemoryStorage();

const calls = [];
let handler = () => new Response('not found', { status: 404 });
globalThis.fetch = async (url, init = {}) => {
  const call = { url: String(url), method: init.method || 'GET', init, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(call);
  return handler(call);
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let xhrHandler = () => ({ status: 404, body: '' });
globalThis.XMLHttpRequest = class {
  upload = {};
  open(method, url) { this.method = method; this.url = url; this.headers = {}; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) {
    const { status, body: text } = xhrHandler({ method: this.method, url: this.url, headers: this.headers, body });
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.status = status;
      this.statusText = status === 200 ? 'OK' : 'Error';
      this.responseText = text;
      this.onload?.();
    });
  }
};

const gateway = await import('../src/gateway.js');
const session = await import('../src/session.js');
const availability = await import('../src/modelAvailability.js');
const persist = await import('../src/persistKey.js');
const { t2iModels } = await import('../src/models.js');

beforeEach(() => {
  calls.length = 0;
  events.length = 0;
  handler = () => new Response('not found', { status: 404 });
});

const t2i = t2iModels.find((m) => m.endpoint && !m.inputs?.image_url) || t2iModels[0];
const t2iKey = t2i.endpoint || t2i.id;
const OUT = 'https://v3.fal.media/files/out/result.png';

// ─── media generation ──────────────────────────────────────────────────────

test('generateImage posts to /api/v1/<key> with the session cookie and polls the job token', async () => {
  let polls = 0;
  handler = (call) => {
    if (call.method === 'POST' && call.url === `/api/v1/${encodeURIComponent(t2iKey)}`) {
      return json(200, { request_id: 'job.tok-1', status: 'processing' });
    }
    if (call.url === '/api/v1/predictions/job.tok-1/result') {
      polls += 1;
      return polls < 2
        ? json(200, { status: 'processing' })
        : json(200, { status: 'completed', request_id: 'job.tok-1', outputs: [OUT], images: [{ url: OUT }] });
    }
    return json(404, {});
  };
  const seen = [];
  const result = await gateway.generateImage('ignored-api-key', {
    model: t2i.id,
    prompt: 'a lighthouse',
    aspect_ratio: '1:1',
    onRequestId: (id) => seen.push(id),
  });
  assert.equal(result.url, OUT);
  assert.equal(result.request_id, 'job.tok-1');
  assert.deepEqual(seen, ['job.tok-1']);
  assert.equal(polls, 2);
  const submit = calls.find((c) => c.method === 'POST');
  assert.equal(submit.init.credentials, 'same-origin');
  assert.equal(submit.body.prompt, 'a lighthouse');
  for (const call of calls) {
    const headers = Object.keys(call.init.headers || {}).map((h) => h.toLowerCase());
    assert.ok(!headers.includes('x-api-key') && !headers.includes('authorization'), `${call.url} sends no key header`);
    assert.ok(!call.url.includes('ignored-api-key'), 'the apiKey argument is never sent');
    assert.ok(call.url.startsWith('/api/'), `${call.url} stays on our origin`);
  }
});

test('a synchronous tool answer is returned without polling', async () => {
  handler = () => json(200, { status: 'completed', outputs: [OUT] });
  const result = await gateway.removeBackground(null, { image_url: 'https://v3.fal.media/in.png' });
  assert.equal(result.url, OUT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/ai-background-remover');
});

test('401 fires aquora:session-required and throws', async () => {
  handler = () => json(401, { error: 'session_required', message: 'Sign in to continue.' });
  await assert.rejects(gateway.generateImage(null, { model: t2i.id, prompt: 'x' }), (err) => err.status === 401);
  assert.deepEqual(events.map((e) => e.type), ['aquora:session-required']);
});

test('402 throws the friendly budget message and fires aquora:budget-exceeded (no sign-in prompt)', async () => {
  handler = () => json(402, { error: 'budget_exceeded', message: "Today's AI budget is used up.", scope: 'session', spentUsd: 10, capUsd: 10 });
  await assert.rejects(gateway.generateImage(null, { model: t2i.id, prompt: 'x' }), (err) => {
    assert.equal(err.status, 402);
    assert.equal(err.code, 'budget_exceeded');
    assert.equal(err.message, "Today's AI budget is used up.");
    return true;
  });
  assert.deepEqual(events, [{ type: 'aquora:budget-exceeded', detail: { scope: 'session', spentUsd: 10, capUsd: 10 } }]);
});

test('503 setup_required / not_configured are plain errors, not sign-in prompts', async () => {
  for (const code of ['setup_required', 'not_configured']) {
    handler = () => json(503, { error: code, message: "The AI service isn't configured" });
    await assert.rejects(gateway.generateImage(null, { model: t2i.id, prompt: 'x' }), (err) => err.status === 503 && err.code === code);
  }
  assert.equal(events.length, 0);
});

test('polling rides out 429/5xx and reports a failed job with its message', async () => {
  const replies = [json(429, { error: 'rate_limited' }), json(502, {}), json(200, { status: 'failed', error: "That prompt was blocked by the model's safety filter" })];
  handler = (call) => (call.method === 'POST' ? json(200, { request_id: 'job.tok-2' }) : replies.shift());
  await assert.rejects(
    gateway.generateImage(null, { model: t2i.id, prompt: 'x' }),
    (err) => err.message === "Generation failed: That prompt was blocked by the model's safety filter" && err.requestId === 'job.tok-2',
  );
  assert.equal(events.length, 0);
});

test('decomposeLayers flattens images [{url}] to URL strings', async () => {
  handler = () => json(200, { status: 'completed', images: [{ url: 'https://v3.fal.media/a.png' }, { url: 'https://v3.fal.media/b.png' }] });
  const result = await gateway.decomposeLayers(null, { image_url: 'https://v3.fal.media/in.png' });
  assert.deepEqual(result.images, ['https://v3.fal.media/a.png', 'https://v3.fal.media/b.png']);
});

test('estimateCost is silent on errors and returns a number or null', async () => {
  handler = () => json(200, { cost: 0.04, currency: 'USD' });
  assert.equal(await gateway.estimateCost('ai-background-remover', {}), 0.04);
  assert.deepEqual(calls[0].body, { model: 'ai-background-remover', payload: {} });
  handler = () => json(200, { cost: null });
  assert.equal(await gateway.estimateCost('x', {}), null);
  handler = () => json(401, { error: 'session_required' });
  await assert.rejects(gateway.estimateCost('x', {}));
  assert.equal(events.length, 0, 'a background estimate never opens the access-code dialog');
});

test('calculateDynamicCost posts {task_name, payload} to our own route', async () => {
  handler = () => json(200, { cost: 0.4 });
  assert.deepEqual(await gateway.calculateDynamicCost(null, 'kling-v3.0-pro-t2v', { duration: 5 }), { cost: 0.4 });
  assert.equal(calls[0].url, '/api/app/calculate_dynamic_cost');
  assert.deepEqual(calls[0].body, { task_name: 'kling-v3.0-pro-t2v', payload: { duration: 5 } });
});

test('workflow and agent helpers call /api/workflow/* and /api/agents/* with encoded ids', async () => {
  handler = () => json(200, { ok: true });
  await gateway.getWorkflowData(null, 'wf/1');
  await gateway.runSingleNode(null, 'wf1', 'node 2', { a: 1 });
  await gateway.getAgentBySlug(null, 'creator-coach');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET /api/workflow/get-workflow-def/wf%2F1',
    'POST /api/workflow/wf1/node/node%202/run',
    'GET /api/agents/by-slug/creator-coach',
  ]);
});

test('pollAgentChatResult polls the prediction route until the turn is complete', async () => {
  const replies = [json(200, { status: 'processing' }), json(200, { is_complete: true, conversation_id: 'c1', messages: [] })];
  handler = () => replies.shift();
  const data = await gateway.pollAgentChatResult(null, 'agent.tok');
  assert.equal(data.conversation_id, 'c1');
  assert.ok(calls.every((c) => c.url === '/api/v1/predictions/agent.tok/result'));
});

// ─── uploads ───────────────────────────────────────────────────────────────

test('uploadFile posts multipart to /api/v1/upload_file and resolves the stored URL', async () => {
  let seen;
  xhrHandler = (req) => { seen = req; return { status: 200, body: JSON.stringify({ url: 'https://v3.fal.media/files/up.png' }) }; };
  const progress = [];
  const url = await gateway.uploadFile('ignored', new Blob(['x'], { type: 'image/png' }), (p) => progress.push(p));
  assert.equal(url, 'https://v3.fal.media/files/up.png');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/v1/upload_file');
  assert.ok(seen.body instanceof FormData && seen.body.get('file'));
  assert.ok(!('x-api-key' in seen.headers));
  assert.deepEqual(progress, [50, 100]);
});

test('uploadFile maps 402 to the budget error and 401 to the sign-in event', async () => {
  xhrHandler = () => ({ status: 402, body: JSON.stringify({ error: 'budget_exceeded', message: 'Budget used up.' }) });
  await assert.rejects(gateway.uploadFile(null, new Blob(['x'])), (err) => err.code === 'budget_exceeded' && err.message === 'Budget used up.');
  xhrHandler = () => ({ status: 401, body: JSON.stringify({ error: 'session_required' }) });
  await assert.rejects(gateway.uploadFile(null, new Blob(['x'])), (err) => err.status === 401);
  assert.deepEqual(events.map((e) => e.type), ['aquora:budget-exceeded', 'aquora:session-required']);
});

// ─── session client ────────────────────────────────────────────────────────

test('getSessionStatus caches one request, force refreshes, and announces workspace changes', async () => {
  let n = 0;
  handler = () => { n += 1; return json(200, { authenticated: true, gate: 'codes', workspace: 'ws_alpha', budget: { spentUsd: 1.2, capUsd: 10 }, features: { fal: true, openrouter: true } }); };
  const [a, b] = await Promise.all([session.getSessionStatus({ force: true }), session.getSessionStatus()]);
  assert.equal(n, 1);
  assert.equal(a, b);
  assert.equal(a.workspace, 'ws_alpha');
  await session.getSessionStatus();
  assert.equal(n, 1, 'a ready session is served from memory');
  await session.getSessionStatus({ force: true });
  assert.equal(n, 2);
  assert.ok(events.some((e) => e.type === 'aquora:session-changed' && e.detail.workspace === 'ws_alpha'));
  assert.deepEqual(session.describeBudget(a.budget), { spent: '$1.20', cap: '$10.00', remaining: '$8.80', fraction: 0.12 });
});

test('signIn surfaces status, code and retryAfter; signOut clears the workspace', async () => {
  handler = () => json(429, { error: 'rate_limited', message: 'Too many attempts.', retry_after: 30 });
  await assert.rejects(session.signIn(' code '), (err) => err.status === 429 && err.code === 'rate_limited' && err.retryAfter === 30 && err.message === 'Too many attempts.');
  assert.deepEqual(calls[0].body, { code: 'code' }, 'the code is trimmed and sent in the body only');
  handler = () => json(200, { authenticated: true, workspace: 'ws_beta', budget: { spentUsd: 0, capUsd: 10 } });
  const signedIn = await session.signIn('good-code');
  assert.equal(signedIn.workspace, 'ws_beta');
  handler = () => new Response(null, { status: 204 });
  await session.signOut();
  assert.equal(session.getSessionSnapshot().session.authenticated, false);
  assert.equal(session.getWorkspaceScope(), null);
});

// ─── model availability ────────────────────────────────────────────────────

test('model availability: everything runs until the list arrives, then disabled models hide', async () => {
  availability.setModelAvailability(null);
  assert.equal(availability.isModelAvailable('anything'), true);
  const [first, second] = t2iModels.filter((m) => m.endpoint);
  availability.setModelAvailability({ enabled: [second.endpoint], disabled: [first.endpoint], disabled_models: [] });
  assert.equal(availability.isModelAvailable(first), false);
  assert.equal(availability.isModelAvailable(second.id), true);
  assert.deepEqual(availability.filterAvailableModels([first, second]).map((m) => m.id), [second.id]);
  assert.equal(availability.firstAvailableModel([first, second], [first.id]).id, second.id, 'a disabled preferred model is skipped');
  availability.setModelAvailability({ enabled: [second.endpoint], disabled_models: [second.id] });
  assert.equal(availability.isModelAvailable(second), false, 'disabled_models hides a model even when its endpoint is enabled');
});

test('loadModelAvailability fetches the list once per page', async () => {
  availability.setModelAvailability(null);
  let n = 0;
  handler = () => { n += 1; return json(200, { enabled: ['a'], disabled: ['b'], disabled_models: [], configured: true }); };
  await Promise.all([availability.loadModelAvailability(), availability.loadModelAvailability()]);
  await availability.loadModelAvailability();
  assert.equal(n, 1);
  assert.equal(calls[0].url, '/api/v1/models/available');
  assert.equal(availability.isEndpointAvailable('a'), true);
  assert.equal(availability.isEndpointAvailable('b'), false);
  availability.setModelAvailability(null);
});

// ─── workspace-scoped history ──────────────────────────────────────────────

test('legacy history moves into the first workspace once, largest copy wins', () => {
  localStorage.clear();
  localStorage.setItem('hg_image_studio_persistent', '{"h":[1]}');
  localStorage.setItem('hg_image_studio_persistent:1a2b3c', '{"h":[1,2,3]}');
  localStorage.setItem('hg_image_studio_persistent_other', 'keep');
  const key = persist.workspacePersistKey('hg_image_studio_persistent', 'abc123');
  assert.equal(key, 'hg_image_studio_persistent:ws-abc123');
  persist.migrateLegacyPersistKey('hg_image_studio_persistent', key);
  assert.equal(localStorage.getItem(key), '{"h":[1,2,3]}');
  assert.deepEqual(localStorage.keys().sort(), ['hg_image_studio_persistent:ws-abc123', 'hg_image_studio_persistent_other']);
  // A second workspace starts empty: nothing legacy is left to inherit.
  const other = persist.workspacePersistKey('hg_image_studio_persistent', 'zzz999');
  persist.migrateLegacyPersistKey('hg_image_studio_persistent', other);
  assert.equal(localStorage.getItem(other), null);
});

test('scopedPersistKey follows the signed-in workspace and never stores its id', async () => {
  localStorage.clear();
  handler = () => json(200, { authenticated: true, workspace: 'ws_secretish', budget: null });
  await session.getSessionStatus({ force: true });
  const key = persist.scopedPersistKey('hg_audio_studio_persistent');
  assert.match(key, /^hg_audio_studio_persistent:ws-[0-9a-z]+$/);
  assert.ok(!key.includes('ws_secretish'));
  handler = () => new Response(null, { status: 204 });
  await session.signOut();
  assert.equal(persist.scopedPersistKey('hg_audio_studio_persistent'), 'hg_audio_studio_persistent');
});
