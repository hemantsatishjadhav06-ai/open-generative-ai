const test = require('node:test');
const assert = require('node:assert/strict');

const en = require('../messages/en/common.json');
const zh = require('../messages/zh/common.json');
const catalog = require('../lib/gateway/catalog/catalog.json');

const strings = (value) => (typeof value === 'string'
    ? [value]
    : Array.isArray(value)
        ? value.flatMap(strings)
        : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

test('both locales ship a landing namespace', () => {
    assert.ok(en.landing, 'en.landing missing');
    assert.ok(zh.landing, 'zh.landing missing');
    for (const key of ['h1', 'sub', 'ctaPrimary', 'ctaSecondary', 'reeltyTitle', 'trust', 'footerRuns']) {
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
        assert.equal(copy.accessCodeModal.title, 'Aquora');
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

test('access-code, settings and budget copy exists in en and zh', () => {
    for (const copy of [en, zh]) {
        for (const key of ['label', 'placeholder', 'submit', 'invalidCode', 'rateLimited', 'unavailable', 'sessionEndedTitle', 'sessionEndedSubtitle', 'setupTitle', 'setupBody', 'offlineTitle', 'retry', 'reeltyOnly']) {
            assert.ok(copy.accessCodeModal[key], `accessCodeModal.${key} missing`);
        }
        for (const key of ['workspaceHeading', 'signedInWithCode', 'workspaceId', 'budgetHeading', 'signOut', 'close']) {
            assert.ok(copy.settingsModal[key], `settingsModal.${key} missing`);
        }
        assert.match(copy.shell.budgetToday, /\{spent\}.*\{cap\}/);
        assert.match(copy.settingsModal.workspaceId, /\{id\}/);
        assert.match(copy.accessCodeModal.rateLimited, /\{seconds\}/);
        for (const key of ['sessionExpired', 'budgetExceeded', 'rateLimited']) {
            assert.ok(copy.notifications[key], `notifications.${key} missing`);
        }
    }
});

test('shell copy never mentions the old provider or bring-your-own keys', () => {
    for (const copy of [en, zh]) {
        assert.doesNotMatch(JSON.stringify(copy), /muapi/i);
        assert.equal(copy.apiKeyModal, undefined, 'the API-key namespace is gone');
    }
    assert.doesNotMatch(JSON.stringify(en), /\bAPI key\b|your (own )?key|free key/i);
    assert.match(en.landing.footerRuns, /fal\.ai \+ OpenRouter/);
    assert.match(zh.landing.footerRuns, /fal\.ai \+ OpenRouter/);
});

test('retired tabs (Explore Apps, Vibe Motion) have no copy left', () => {
    for (const copy of [en, zh]) {
        for (const id of ['apps', 'vibe-motion']) {
            assert.equal(copy.tabs[id], undefined, `tabs.${id}`);
            assert.equal(copy.landing.blurbs[id], undefined, `landing.blurbs.${id}`);
        }
    }
});

test('model-count claims never exceed what the gateway catalog enables', () => {
    const enabled = catalog.entries.filter((entry) => entry.enabled);
    const falEndpoints = new Set(enabled.map((entry) => entry.fal));
    const imageEndpoints = new Set(enabled.filter((entry) => entry.kind === 'image').map((entry) => entry.fal));
    let claims = 0;
    for (const copy of [en, zh]) {
        for (const text of strings(copy)) {
            for (const [, n] of text.matchAll(/(\d+)\+\s*(?:个\s*)?(?:AI\s*)?(?:models|模型)/gi)) {
                claims += 1;
                assert.ok(Number(n) <= falEndpoints.size, `"${text}" claims ${n}+ models; ${falEndpoints.size} enabled`);
            }
            for (const [, n] of text.matchAll(/(\d+)\+\s*(?:image models|图像模型)/gi)) {
                claims += 1;
                assert.ok(Number(n) <= imageEndpoints.size, `"${text}" claims ${n}+ image models; ${imageEndpoints.size} enabled`);
            }
        }
    }
    assert.ok(claims > 0, 'the regexes found no claims to check');
});

test('studio counts come from the tab registry, not hard-coded numbers', async () => {
    const { STUDIO_TAB_IDS } = await import('../lib/studioTabs.js');
    for (const copy of [en, zh]) {
        for (const text of strings(copy)) {
            assert.doesNotMatch(text, /\d+\s*(?:studios|个工作室)/, `hard-coded studio count in "${text}"`);
        }
        assert.match(copy.landing.studiosHeading, /\{count\}/);
        assert.ok(copy.landing.chips.some((chip) => chip.includes('{studios}')));
        assert.ok(copy.accessCodeModal.chips.some((chip) => chip.includes('{studios}')));
        assert.deepEqual(Object.keys(copy.tabs).sort(), [...STUDIO_TAB_IDS].sort());
    }
});
