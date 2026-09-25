const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/analytics.js');

function stubBrowser() {
    const dispatched = [];
    globalThis.window = {
        location: { pathname: '/studio/image' },
        dispatchEvent(e) { dispatched.push(e); },
        __ca_events: undefined,
    };
    globalThis.CustomEvent = class {
        constructor(type, opts) { this.type = type; this.detail = opts?.detail; }
    };
    return dispatched;
}

test('track() buffers events with event/ts/path and dispatches ca:track', async () => {
    const { track } = await load();
    const dispatched = stubBrowser();
    track('studio_view', { tab: 'image', locale: 'en' });
    const [e] = globalThis.window.__ca_events;
    assert.equal(e.event, 'studio_view');
    assert.equal(e.path, '/studio/image');
    assert.equal(typeof e.ts, 'number');
    assert.equal(e.tab, 'image');
    assert.equal(dispatched[0].type, 'ca:track');
    delete globalThis.window;
});

test('sanitize() drops secrets, user content and non-scalar values', async () => {
    const { sanitize } = await load();
    const out = sanitize({ key: 'k', apiKey: 'k', api_key: 'k', prompt: 'p', url: 'u', resultUrl: 'r', email: 'e', nested: { a: 1 }, ok: true, n: 3, s: 'x' });
    assert.deepEqual(out, { ok: true, n: 3, s: 'x' });
});

test('sanitize() drops access codes, session identifiers and cookies', async () => {
    const { sanitize } = await load();
    const out = sanitize({
        code: 'c', accessCode: 'c', access_code: 'c', session: 's', sessionId: 's', sid: 's',
        cookie: 'aquora_session=x', token: 't', workspace: 'w', gate: 'codes', ok: false, reason: 'invalid_code',
    });
    assert.deepEqual(out, { gate: 'codes', ok: false, reason: 'invalid_code' });
});

test('the event buffer is capped at 200', async () => {
    const { track } = await load();
    stubBrowser();
    for (let i = 0; i < 250; i++) track('tick', { i });
    assert.equal(globalThis.window.__ca_events.length, 200);
    assert.equal(globalThis.window.__ca_events[0].i, 50);
    delete globalThis.window;
});

test('track() is a no-op without a window', async () => {
    const { track } = await load();
    delete globalThis.window;
    assert.doesNotThrow(() => track('anything', { tab: 'x' }));
});
