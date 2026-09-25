// Desktop / Vite renderer: the gateway client (src/lib/gateway.js), the
// access-code error copy and the one-time storage cleanup.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = (path) => import(path);

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        removeItem: (key) => { map.delete(key); },
        dump: () => Object.fromEntries(map),
    };
}

// Routes fetch() calls to handlers keyed by "METHOD path"; records every call.
function stubFetch(routes) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        const path = String(url);
        calls.push({ method, path, init });
        const handler = routes[`${method} ${path}`] || routes[`${method} *`];
        if (!handler) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
        const { status = 200, body } = handler({ method, path, init });
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
}

test('migrateLegacyStorage renames image history, drops unusable data and the old key', async () => {
    const { migrateLegacyStorage, IMAGE_HISTORY_KEY } = await load('../src/lib/legacyStorage.js');
    // The storage names older builds used (named after the former provider).
    const legacy = 'muapi';
    const storage = memoryStorage({
        [`${legacy}_history`]: '[{"url":"https://example.com/a.png"}]',
        [`${legacy}_pending_jobs`]: '[{"requestId":"old"}]',
        [`${legacy}_uploads`]: '[{"uploadedUrl":"https://example.com/u.png"}]',
        [`${legacy}_key`]: 'secret',
        video_history: '[1]',
        og_lang: 'zh-CN',
    });
    migrateLegacyStorage({ localStorage: storage, document: { cookie: '' }, location: { protocol: 'aquora:' } });
    assert.deepEqual(storage.dump(), {
        [IMAGE_HISTORY_KEY]: '[{"url":"https://example.com/a.png"}]',
        video_history: '[1]',
        og_lang: 'zh-CN',
    });

    // Never overwrites history the new key already holds; safe to run again.
    const again = memoryStorage({ [`${legacy}_history`]: '[old]', [IMAGE_HISTORY_KEY]: '[new]' });
    migrateLegacyStorage({ localStorage: again, document: { cookie: '' }, location: {} });
    migrateLegacyStorage({ localStorage: again, document: { cookie: '' }, location: {} });
    assert.deepEqual(again.dump(), { [IMAGE_HISTORY_KEY]: '[new]' });

    // Storage that throws is ignored.
    assert.doesNotThrow(() => migrateLegacyStorage({ get localStorage() { throw new Error('denied'); }, document: {}, location: {} }));
});

test('gateway.generateImage submits to /api/v1/<model>, polls the job token and refreshes the budget', async () => {
    const { gateway } = await load('../src/lib/gateway.js');
    const { setModelAvailability } = await load('../packages/studio/src/modelAvailability.js');
    setModelAvailability(null);
    const fetchStub = stubFetch({
        'POST /api/v1/flux-schnell-image': () => ({ body: { request_id: 'job.token', status: 'processing' } }),
        'GET /api/v1/predictions/job.token/result': () => ({
            body: { status: 'completed', outputs: ['https://v3.fal.media/files/out.png'], images: [{ url: 'https://v3.fal.media/files/out.png' }] },
        }),
        'GET /api/session': () => ({ body: { authenticated: true, gate: 'codes', workspace: 'team', budget: { spentUsd: 0.04, capUsd: 10 } } }),
    });
    try {
        const seen = [];
        const result = await gateway.generateImage({
            model: 'flux-schnell-image',
            prompt: 'a lighthouse at dusk',
            aspect_ratio: '1:1',
            onRequestId: (id) => seen.push(id),
        });
        assert.equal(result.url, 'https://v3.fal.media/files/out.png');
        assert.deepEqual(seen, ['job.token']);

        const submit = fetchStub.calls.find((call) => call.method === 'POST');
        assert.equal(submit.path, '/api/v1/flux-schnell-image', 'same-origin relative path');
        assert.equal(submit.init.credentials, 'same-origin');
        const headers = Object.keys(submit.init.headers || {}).map((name) => name.toLowerCase());
        assert.ok(!headers.some((name) => name.includes('key') || name === 'authorization'), 'no key header is ever sent');
        assert.equal(JSON.parse(submit.init.body).prompt, 'a lighthouse at dusk');
        assert.ok(fetchStub.calls.some((call) => call.path === '/api/session'), 'budget refreshed after the run');
    } finally {
        fetchStub.restore();
    }
});

test('gateway refuses a model the gateway has disabled before sending anything', async () => {
    const { gateway, pickableModels, defaultModel } = await load('../src/lib/gateway.js');
    const { setModelAvailability } = await load('../packages/studio/src/modelAvailability.js');
    setModelAvailability({ enabled: ['flux-schnell-image'], disabled: ['nano-banana'], disabled_models: [] });
    const fetchStub = stubFetch({});
    try {
        await assert.rejects(
            gateway.generateImage({ model: 'nano-banana', prompt: 'x' }),
            (error) => error.code === 'model_unavailable' && /isn't available/.test(error.message),
        );
        assert.equal(fetchStub.calls.length, 0);

        const local = { id: 'wan2gp:flux-dev', name: 'Local', provider: 'wan2gp' };
        const models = [{ id: 'nano-banana', name: 'NB' }, { id: 'flux-schnell-image', name: 'FS' }, local];
        assert.deepEqual(pickableModels(models).map((m) => m.id), ['flux-schnell-image', 'wan2gp:flux-dev']);
        assert.equal(defaultModel(models).id, 'flux-schnell-image');
    } finally {
        fetchStub.restore();
        setModelAvailability(null);
    }
});

test('gateway.pollForResult resumes a saved job and surfaces failures', async () => {
    const { gateway } = await load('../src/lib/gateway.js');
    const fetchStub = stubFetch({
        'GET /api/v1/predictions/ok.token/result': () => ({ body: { status: 'completed', video: { url: 'https://v3.fal.media/v.mp4' }, outputs: ['https://v3.fal.media/v.mp4'] } }),
        'GET /api/v1/predictions/bad.token/result': () => ({ body: { status: 'failed', error: "That prompt was blocked by the model's safety filter" } }),
        'GET /api/session': () => ({ body: { authenticated: true } }),
    });
    try {
        const ok = await gateway.pollForResult('ok.token', 2, 1);
        assert.equal(ok.url, 'https://v3.fal.media/v.mp4');
        await assert.rejects(gateway.pollForResult('bad.token', 2, 1), /safety filter/);
    } finally {
        fetchStub.restore();
    }
});

test('describeSignInError maps gateway answers to friendly copy', async () => {
    const { describeSignInError } = await load('../src/components/AccessCodeModal.js');
    assert.match(describeSignInError({ status: 401, code: 'invalid_code' }), /isn't valid/);
    assert.match(describeSignInError({ status: 429, retryAfter: 42 }), /42s/);
    assert.match(describeSignInError({ status: 503, code: 'setup_required' }), /isn't set up yet/);
    assert.match(describeSignInError(new TypeError('Failed to fetch')), /Couldn't reach Aquora/);
    assert.match(describeSignInError({ status: 502, code: 'upstream_unreachable' }), /Couldn't reach Aquora/);
    assert.match(describeSignInError({ status: 500 }), /Something went wrong/);
});
