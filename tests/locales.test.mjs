import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getLocaleFromPathname,
    localizeStudioPath,
    mergeCopy,
    resolveStudioCopy,
    getCommonCopy,
    LOCALE_CONFIGS,
} from '../lib/locales.js';

test('getLocaleFromPathname derives the locale from the path prefix only', () => {
    assert.equal(getLocaleFromPathname('/zh'), 'zh');
    assert.equal(getLocaleFromPathname('/zh/studio/video'), 'zh');
    assert.equal(getLocaleFromPathname('/zhx'), 'en');
    assert.equal(getLocaleFromPathname(''), 'en');
    assert.equal(getLocaleFromPathname('/studio'), 'en');
});

test('localizeStudioPath', () => {
    assert.equal(localizeStudioPath('zh', 'video'), '/zh/studio/video');
    assert.equal(localizeStudioPath('en', 'image'), '/studio/image');
    assert.equal(localizeStudioPath('fr'), '/studio');
});

test('mergeCopy merges objects per key and replaces arrays', () => {
    assert.deepEqual(mergeCopy({ a: { b: 1, c: 2 }, arr: [1, 2] }, { a: { b: 9 }, arr: [3] }), { a: { b: 9, c: 2 }, arr: [3] });
    const base = { a: 1 };
    assert.equal(mergeCopy(base, undefined), base);
});

test('resolveStudioCopy returns the English bundle unchanged for en', () => {
    const enBundle = { x: 1 };
    assert.equal(resolveStudioCopy(enBundle, { x: 2 }, 'en'), enBundle);
});

function leafPaths(obj, prefix = '') {
    const out = [];
    for (const [k, v] of Object.entries(obj || {})) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p));
        else out.push(p);
    }
    return out;
}

function has(obj, path) {
    return path.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj) !== undefined;
}

test('en and zh common bundles have the same keys', () => {
    const zhRaw = LOCALE_CONFIGS.zh.messages.common;
    const enRaw = LOCALE_CONFIGS.en.messages.common;
    const missingInZh = leafPaths(enRaw).filter((p) => !has(zhRaw, p));
    const orphanInZh = leafPaths(zhRaw).filter((p) => !has(enRaw, p));
    assert.deepEqual(missingInZh, [], `zh is missing: ${missingInZh.join(', ')}`);
    assert.deepEqual(orphanInZh, [], `zh has keys en lacks: ${orphanInZh.join(', ')}`);
    // merged copy always has every English key
    const merged = getCommonCopy('zh');
    assert.deepEqual(leafPaths(enRaw).filter((p) => !has(merged, p)), []);
});
