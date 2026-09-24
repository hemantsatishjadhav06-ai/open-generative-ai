import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../packages/studio/src/utils/notify.js');

function withWindow(fn) {
    const target = new EventTarget();
    const alerts = [];
    globalThis.window = Object.assign(target, { alert: (m) => alerts.push(m) });
    try { return fn(target, alerts); } finally { delete globalThis.window; }
}

test('notify dispatches a cancelable studio:notify event the shell can claim', async () => {
    const { notify, STUDIO_NOTIFY_EVENT } = await load();
    withWindow((win, alerts) => {
        const seen = [];
        win.addEventListener(STUDIO_NOTIFY_EVENT, (e) => { e.preventDefault(); seen.push(e.detail); });
        notify('Enter a prompt first');
        assert.deepEqual(seen, [{ message: 'Enter a prompt first', type: 'info' }]);
        assert.deepEqual(alerts, [], 'claimed notices must not fall back to alert()');
    });
});

test('notify falls back to window.alert when no host listens', async () => {
    const { notifyError } = await load();
    withWindow((_win, alerts) => {
        notifyError(new Error('Upload failed'));
        assert.deepEqual(alerts, ['Upload failed']);
    });
});

test('friendlyError hides proxy envelopes and raw upstream text', async () => {
    const { friendlyError } = await load();
    const err = new Error('File upload failed: 403 - upstream_unavailable: The AI service returned an unexpected response. Try again in a moment.');
    assert.equal(friendlyError(err), "Couldn't reach the AI service. Try again in a sec.");
});
