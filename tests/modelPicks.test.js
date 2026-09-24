const test = require('node:test');
const assert = require('node:assert/strict');

const loadPicks = () => import('../packages/studio/src/modelPicks.js');
const loadFamilies = () => import('../packages/studio/src/modelFamilies.js');

test('every curated pick resolves to a real picker entry', async () => {
    const { IMAGE_PICK_IDS, VIDEO_PICK_IDS, resolvePicks } = await loadPicks();
    const { imageModelPickerEntries, videoModelMenuEntries } = await loadFamilies();
    assert.equal(resolvePicks(imageModelPickerEntries, IMAGE_PICK_IDS).length, IMAGE_PICK_IDS.length);
    assert.equal(resolvePicks(videoModelMenuEntries, VIDEO_PICK_IDS).length, VIDEO_PICK_IDS.length);
});

test('task words like "thumbnail" find models', async () => {
    const { matchesSearch } = await loadPicks();
    const { imageModelPickerEntries } = await loadFamilies();
    assert.ok(imageModelPickerEntries.some((e) => matchesSearch(e, 'thumbnail')));
    assert.ok(imageModelPickerEntries.every((e) => matchesSearch(e, '')));
});

test('internal endpoints are hidden from the picker but still resolvable', async () => {
    const { HIDDEN_PICKER_MODEL_IDS, isToolEntry } = await loadPicks();
    const { imageModelCatalog } = await loadFamilies();
    assert.ok(HIDDEN_PICKER_MODEL_IDS.has('Api Node'));
    assert.ok(imageModelCatalog.variantById.get('Api Node'));
    assert.equal(isToolEntry({ name: 'Topaz Image Upscale' }), true);
    assert.equal(isToolEntry({ name: 'Nano Banana' }), false);
});
