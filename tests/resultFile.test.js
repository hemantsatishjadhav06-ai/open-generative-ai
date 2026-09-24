const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../packages/studio/src/utils/resultFile.js');

test('slugifyPrompt makes short, safe filename slugs', async () => {
    const { slugifyPrompt } = await load();
    assert.equal(slugifyPrompt('A cat in a hat!'), 'a-cat-in-a-hat');
    assert.equal(slugifyPrompt('  Café   déjà vu  '), 'cafe-deja-vu');
    assert.equal(slugifyPrompt('一只戴帽子的猫'), '');
    assert.equal(slugifyPrompt(undefined), '');
    assert.ok(slugifyPrompt('x'.repeat(100)).length <= 40);
    assert.ok(!slugifyPrompt('word '.repeat(20)).endsWith('-'));
});

test('buildResultFilename uses the prompt slug, then the id, then the index', async () => {
    const { buildResultFilename } = await load();
    assert.match(buildResultFilename({ prompt: 'Neon city', id: 'abc', idx: 0, ext: 'jpg' }), /^creator-agency-neon-city-\d+\.jpg$/);
    assert.match(buildResultFilename({ prompt: '霓虹城市', id: 'abc', idx: 0, ext: 'mp4' }), /^creator-agency-abc-\d+\.mp4$/);
    assert.match(buildResultFilename({ idx: 3, ext: 'jpg' }), /^creator-agency-3-\d+\.jpg$/);
    assert.ok(!buildResultFilename({ prompt: 'x', ext: 'jpg' }).includes('muapi'));
});
