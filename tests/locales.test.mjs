import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getLocaleFromPathname,
    localizeStudioPath,
    mergeCopy,
    resolveStudioCopy,
    getCommonCopy,
    LOCALE_CONFIGS,
    localizePath,
    pageTitle,
} from '../lib/locales.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localeRoot } from '../packages/studio/src/i18nUtils.js';
import { getAgentCopy, localePath as agentLocalePath } from '../packages/Open-Poe-AI/packages/agents/src/i18n.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

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

test('/agents and /workflow have a /zh mirror so Chinese navigation stays Chinese', () => {
    const pages = (root) => {
        const out = [];
        const walk = (dir) => {
            for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name);
                if (fs.statSync(full).isDirectory()) walk(full);
                else if (name === 'page.js' || name === 'layout.js') out.push(path.relative(root, full));
            }
        };
        walk(root);
        return out.sort();
    };
    for (const tree of ['agents', 'workflow']) {
        assert.deepEqual(pages(path.join(APP, 'zh', tree)), pages(path.join(APP, tree)), `app/zh/${tree} mirrors app/${tree}`);
    }
    assert.equal(localizePath('zh', '/agents/abc'), '/zh/agents/abc');
    assert.equal(localizePath('en', '/workflow/1/builder'), '/workflow/1/builder');
    assert.equal(localeRoot('zh'), '/zh');
    assert.equal(localeRoot('en'), '');
    assert.equal(agentLocalePath('zh', '/agents/edit/x'), '/zh/agents/edit/x');
    assert.equal(agentLocalePath('en', '/agents'), '/agents');
});

test('agent and workflow page titles are translated', () => {
    for (const key of ['agentChat', 'createAgent', 'editAgent', 'workflow']) {
        assert.notEqual(pageTitle('zh', key), pageTitle('en', key), key);
        assert.match(pageTitle('zh', key), /Aquora$/);
    }
    assert.equal(pageTitle('zh', 'agentNamed', { name: '小助手' }), '小助手 — Aquora');
});

test('agent create/edit pages are fully translated (en and zh have the same keys, zh differs)', () => {
    const en = getAgentCopy('en');
    const zh = getAgentCopy('zh');
    for (const section of ['create', 'edit']) {
        assert.deepEqual(Object.keys(zh[section]).sort(), Object.keys(en[section]).sort(), section);
        for (const key of Object.keys(en[section])) {
            if (key === 'realign') continue;
            assert.match(zh[section][key], /[一-鿿]/, `${section}.${key} is Chinese`);
        }
    }
});
