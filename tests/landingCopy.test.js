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

test('brand is Aquora in both locales, with the new hero tagline', () => {
    for (const copy of [en, zh]) {
        assert.equal(copy.shell.brand, 'Aquora');
        assert.equal(copy.apiKeyModal.title, 'Aquora');
        assert.match(copy.meta.siteTitle, /^Aquora — /);
        assert.doesNotMatch(JSON.stringify(copy), /Creator Agency/);
    }
    assert.equal(en.landing.h1, 'Make anything. Ship everything.');
    assert.match(en.meta.description, /^Make anything\. Ship everything\./);
});

test('package metadata carries the Aquora identity', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.name, 'aquora');
    assert.equal(pkg.build.productName, 'Aquora');
    assert.equal(pkg.build.appId, 'ai.aquora.studio');
    assert.match(pkg.description, /^Aquora — AI studio for creators/);
});

test('settings + change-key copy exists in en and zh', () => {
    for (const copy of [en, zh]) {
        assert.ok(copy.settingsModal.removeKey);
        assert.ok(copy.apiKeyModal.changeKeyTitle);
        assert.ok(copy.apiKeyModal.changeKeySubtitle);
    }
});
