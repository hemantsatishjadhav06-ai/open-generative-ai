const test = require('node:test');
const assert = require('node:assert/strict');

const en = require('../messages/en/common.json');
const zh = require('../messages/zh/common.json');

test('both locales ship a landing namespace', () => {
    assert.ok(en.landing, 'en.landing missing');
    assert.ok(zh.landing, 'zh.landing missing');
    for (const key of ['h1', 'sub', 'ctaPrimary', 'ctaSecondary', 'reeltyTitle', 'trust']) {
        assert.ok(en.landing[key], `en.landing.${key} missing`);
        assert.ok(zh.landing[key], `zh.landing.${key} missing`);
    }
});

test('every studio tab has a landing blurb in en and zh', () => {
    for (const id of Object.keys(en.tabs)) {
        assert.ok(en.landing.blurbs?.[id], `en.landing.blurbs.${id} missing`);
        assert.ok(zh.landing.blurbs?.[id], `zh.landing.blurbs.${id} missing`);
    }
});
