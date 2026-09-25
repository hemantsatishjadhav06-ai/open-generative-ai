import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLegacyKeyStorage } from '../lib/legacyKeyCleanup.js';

// The storage name browsers from the bring-your-own-key era still hold.
const LEGACY = ['mu', 'api_key'].join('');

function fakeWindow({ stored, cookie = '', protocol = 'https:', storageThrows = false } = {}) {
    const items = new Map(stored === undefined ? [] : [[LEGACY, stored]]);
    items.set('sidebar_collapsed', 'true');
    const written = [];
    const localStorage = {
        getItem: (k) => {
            if (storageThrows) throw new Error('SecurityError');
            return items.has(k) ? items.get(k) : null;
        },
        removeItem: (k) => items.delete(k),
        setItem: (k, v) => items.set(k, String(v)),
    };
    const document = {
        get cookie() { return cookie; },
        set cookie(value) { written.push(value); },
    };
    return { win: { localStorage, document, location: { protocol } }, items, written };
}

test('removes the legacy key from localStorage and expires its cookie', () => {
    const { win, items, written } = fakeWindow({ stored: 'sk-old-secret', cookie: `other=1; ${LEGACY}=sk-old-secret` });
    assert.equal(clearLegacyKeyStorage(win), true);
    assert.equal(items.has(LEGACY), false);
    assert.equal(items.get('sidebar_collapsed'), 'true', 'other preferences are kept');
    assert.equal(written.length, 1);
    assert.match(written[0], new RegExp(`^${LEGACY}=; path=/; max-age=0; SameSite=Lax; Secure$`));
    assert.ok(!written[0].includes('sk-old-secret'));
});

test('no Secure flag over plain http (local dev)', () => {
    const { win, written } = fakeWindow({ cookie: `${LEGACY}=x`, protocol: 'http:' });
    assert.equal(clearLegacyKeyStorage(win), true);
    assert.equal(written[0], `${LEGACY}=; path=/; max-age=0; SameSite=Lax`);
});

test('is a no-op when nothing is stored, and never throws', () => {
    const clean = fakeWindow({ cookie: 'aquora_theme=dark' });
    assert.equal(clearLegacyKeyStorage(clean.win), false);
    assert.deepEqual(clean.written, []);
    assert.equal(clearLegacyKeyStorage(fakeWindow({ storageThrows: true }).win), false);
    assert.equal(clearLegacyKeyStorage(undefined), false);
    assert.doesNotThrow(() => clearLegacyKeyStorage({}));
});
