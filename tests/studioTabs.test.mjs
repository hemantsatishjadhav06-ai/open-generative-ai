import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RETIRED_STUDIO_TAB_IDS,
    STUDIO_TAB_IDS,
    isRetiredStudioSlug,
    isValidStudioSlug,
} from '../lib/studioTabs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// lib/studios.js and the shell are JSX, so they are checked as source text.
const tabIdsIn = (source) => [...source.matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1]);

test('lib/studios.js TABS follow STUDIO_TAB_IDS exactly (same ids, same order)', () => {
    assert.deepEqual(tabIdsIn(read('lib/studios.js')), STUDIO_TAB_IDS);
});

test('retired tabs are gone from the registry and redirect instead of 404ing', () => {
    assert.deepEqual([...RETIRED_STUDIO_TAB_IDS].sort(), ['apps', 'vibe-motion']);
    for (const id of RETIRED_STUDIO_TAB_IDS) {
        assert.ok(!STUDIO_TAB_IDS.includes(id));
        assert.equal(isValidStudioSlug([id]), false);
        assert.equal(isRetiredStudioSlug([id]), true);
    }
    assert.equal(isRetiredStudioSlug(['image']), false);
    assert.equal(isRetiredStudioSlug(undefined), false);
    for (const page of ['app/studio/[[...slug]]/page.js', 'app/zh/studio/[[...slug]]/page.js']) {
        assert.match(read(page), /isRetiredStudioSlug\(slug\)\) redirect\(/, page);
    }
});

test('isValidStudioSlug accepts the root, every tab and the workflow alias', () => {
    assert.equal(isValidStudioSlug(undefined), true);
    assert.equal(isValidStudioSlug([]), true);
    for (const id of STUDIO_TAB_IDS) assert.equal(isValidStudioSlug([id, 'x']), true, id);
    assert.equal(isValidStudioSlug(['workflow', 'abc']), true);
    assert.equal(isValidStudioSlug(['not-a-tab']), false);
});

test('the shell nav lists every tab exactly once and nothing retired', () => {
    const shell = read('components/StandaloneShell.js');
    const navTabs = [...shell.matchAll(/tabIds: \[([^\]]*)\]/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    assert.deepEqual([...navTabs].sort(), [...STUDIO_TAB_IDS].sort());
    assert.equal(new Set(navTabs).size, navTabs.length);
});

test('the shell no longer loads retired studios or handles provider keys', () => {
    const shell = read('components/StandaloneShell.js');
    for (const name of ['VibeMotionStudio', 'AppsStudio', 'McpCliStudio', 'ApiKeyModal']) {
        assert.doesNotMatch(shell, new RegExp(name), name);
    }
    assert.doesNotMatch(shell, /muapi/i);
    assert.doesNotMatch(shell, /from 'axios'|interceptors|x-api-key|document\.cookie|localStorage\.setItem\([^)]*key/i);
    assert.match(shell, /from 'studio\/session'/);
    assert.match(shell, /SESSION_REQUIRED_EVENT/);
    assert.ok(!fs.existsSync(path.join(ROOT, 'components/ApiKeyModal.js')));
});

test('sitemap paths come from the registry (no retired tab URLs)', () => {
    const sitemap = read('app/sitemap.js');
    assert.match(sitemap, /STUDIO_TAB_IDS\.map/);
});
