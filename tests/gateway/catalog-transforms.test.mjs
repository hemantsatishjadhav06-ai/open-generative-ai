// Unit tests for every catalog transform op, the enum snapper and the
// variant `when` matcher (lib/gateway/catalog/transforms.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import catalog from '../../lib/gateway/catalog/catalog.json';
import {
    OPS,
    OP_NAMES,
    applyTransforms,
    getPath,
    matchesWhen,
    parseNumeric,
    parsePath,
    parseRatio,
    setPath,
    snapToEnum,
} from '../../lib/gateway/catalog/transforms.js';

const run = (op, work, args = {}, ctx = {}) => {
    OPS[op](work, args, ctx);
    return work;
};

function opsUsedByCatalog() {
    const used = new Set();
    const visit = (spec) => (spec?.transforms || []).forEach((step) => used.add(step.op));
    for (const entry of catalog.entries) {
        visit(entry.input);
        for (const variant of entry.variants || []) visit(variant.input);
    }
    return used;
}

test('every op referenced by catalog.json is implemented and unit-tested here', () => {
    const tested = new Set([
        'rename_nested', 'to_string', 'to_int', 'to_number', 'to_bool', 'snap_enum', 'clamp', 'wrap_array',
        'first_of_array', 'slice_array', 'split_array', 'omit_if_negative', 'omit_if', 'lowercase', 'uppercase',
        'map_values', 'aspect_to_image_size', 'dims_to_image_size', 'duration_to_frames', 'default_if_empty',
        'copy', 'capitalize_ref_tokens', 'concat_arrays', 'remap_items', 'join_items', 'concat_text',
        'to_object_array', 'unwrap_single', 'drop',
    ]);
    for (const op of opsUsedByCatalog()) {
        assert.ok(OP_NAMES.includes(op), `catalog uses unknown op ${op}`);
        assert.ok(tested.has(op), `op ${op} has no unit test`);
    }
    for (const op of OP_NAMES) assert.ok(tested.has(op), `op ${op} has no unit test`);
    assert.throws(() => applyTransforms([{ op: 'nope' }], {}), /Unknown catalog transform op/);
});

test('path helpers', () => {
    assert.deepEqual(parsePath('voice_setting.voice_id'), ['voice_setting', 'voice_id']);
    assert.deepEqual(parsePath('loras[0].path'), ['loras', 0, 'path']);
    const target = {};
    setPath(target, 'loras[0].path', 'https://x/y.safetensors');
    setPath(target, 'loras[0].scale', 0.8);
    assert.deepEqual(target, { loras: [{ path: 'https://x/y.safetensors', scale: 0.8 }] });
    assert.equal(getPath(target, 'loras[0].scale'), 0.8);
    assert.equal(getPath(target, 'missing.deep'), undefined);
});

test('parse helpers', () => {
    assert.deepEqual(parseRatio('16:9'), { width: 16, height: 9, value: 16 / 9 });
    assert.equal(parseRatio('auto'), null);
    assert.equal(parseRatio('0:9'), null);
    assert.deepEqual(parseNumeric('720p'), { n: 720, unit: 'p' });
    assert.deepEqual(parseNumeric('8s'), { n: 8, unit: 's' });
    assert.deepEqual(parseNumeric(5), { n: 5, unit: '' });
    assert.equal(parseNumeric('high'), null);
});

test('snapToEnum: exact, case, alias, number/string, ratio, units, ties', () => {
    assert.equal(snapToEnum('16:9', ['16:9', '9:16']), '16:9');
    assert.equal(snapToEnum('480p', ['480P', '768P']), '480P');
    assert.equal(snapToEnum('1k', ['1K', '2K', '4K']), '1K');
    assert.equal(snapToEnum('adaptive', ['auto', '16:9'], { adaptive: 'auto' }), 'auto');
    assert.equal(snapToEnum(5, ['5', '10']), '5');
    assert.equal(snapToEnum('10', [5, 10]), 10);
    assert.equal(snapToEnum('9:21', ['21:9', '16:9', '9:16']), '9:16');
    assert.equal(snapToEnum('16:21', ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']), '3:4');
    assert.equal(snapToEnum(7, ['5', '10']), '5');
    assert.equal(snapToEnum(5, ['4s', '6s', '8s']), '6s', 'ties round up');
    assert.equal(snapToEnum(7, ['4s', '6s', '8s']), '8s', 'ties round up');
    assert.equal(snapToEnum(12, ['4s', '6s', '8s']), '8s');
    assert.equal(snapToEnum('1080p', ['480p', '720p']), '720p');
    assert.equal(snapToEnum('4k', ['720p', '1080p', '1440p', '2160p']), '2160p', '4k compares as 2160 lines');
    assert.equal(snapToEnum('8k', ['720p', '1080p', '1440p', '2160p']), '2160p');
    assert.equal(snapToEnum('2k', ['720p', '1080p', '1440p', '2160p']), '1440p');
    assert.equal(snapToEnum(15, ['auto', '4', '5', '10', '15']), '15');
    assert.equal(snapToEnum('Cyberpunk', ['anime', 'clay']), undefined);
    assert.equal(snapToEnum('auto', ['16:9', '9:16']), undefined);
});

test('rename_nested moves a flat key into a nested object', () => {
    assert.deepEqual(run('rename_nested', { voice_id: 'Wise_Woman', speed: 1 }, { from: 'voice_id', to: 'voice_setting.voice_id' }),
        { speed: 1, voice_setting: { voice_id: 'Wise_Woman' } });
    assert.deepEqual(run('rename_nested', { voice_id: '' }, { from: 'voice_id', to: 'voice_setting.voice_id' }), {});
    assert.deepEqual(run('rename_nested', {}, { from: 'voice_id', to: 'voice_setting.voice_id' }), {});
});

test('to_string / to_int / to_number / to_bool', () => {
    assert.deepEqual(run('to_string', { duration: 5 }, { field: 'duration' }), { duration: '5' });
    assert.deepEqual(run('to_string', { flag: true }, { field: 'flag' }), { flag: 'true' });
    assert.deepEqual(run('to_string', { duration: '5' }, { field: 'duration' }), { duration: '5' });
    assert.deepEqual(run('to_int', { duration: '8s' }, { field: 'duration' }), { duration: 8 });
    assert.deepEqual(run('to_int', { n: 4.6 }, { field: 'n' }), { n: 5 });
    assert.deepEqual(run('to_int', { n: 'many' }, { field: 'n' }), { n: 'many' });
    assert.deepEqual(run('to_number', { scale: '1.5' }, { field: 'scale' }), { scale: 1.5 });
    assert.deepEqual(run('to_bool', { a: 'true' }, { field: 'a' }), { a: true });
    assert.deepEqual(run('to_bool', { a: 0 }, { field: 'a' }), { a: false });
    assert.deepEqual(run('to_bool', { a: 'maybe' }, { field: 'a' }), { a: 'maybe' });
});

test('snap_enum uses args.values or the entry enum, with on_miss', () => {
    assert.deepEqual(run('snap_enum', { duration: 7 }, { field: 'duration', values: ['5', '10'] }), { duration: '5' });
    assert.deepEqual(run('snap_enum', { resolution: '1080p' }, { field: 'resolution' }, { enums: { resolution: ['480p', '720p'] } }), { resolution: '720p' });
    assert.deepEqual(run('snap_enum', { style: 'odd' }, { field: 'style', values: ['anime'], on_miss: 'omit' }), {});
    assert.deepEqual(run('snap_enum', { style: 'odd' }, { field: 'style', values: ['anime'] }), { style: 'odd' });
    assert.deepEqual(run('snap_enum', {}, { field: 'style', values: ['anime'] }), {});
});

test('clamp uses args or entry ranges', () => {
    assert.deepEqual(run('clamp', { duration: 3 }, { field: 'duration', min: 5, max: 15 }), { duration: 5 });
    assert.deepEqual(run('clamp', { duration: '40' }, { field: 'duration' }, { ranges: { duration: [5, 15] } }), { duration: 15 });
    assert.deepEqual(run('clamp', { n: 2 }, { field: 'n' }, { ranges: { n: [null, 4] } }), { n: 2 });
    assert.deepEqual(run('clamp', { n: 'x' }, { field: 'n', min: 1 }), { n: 'x' });
});

test('wrap_array / first_of_array / slice_array / split_array', () => {
    assert.deepEqual(run('wrap_array', { video_urls: 'https://a/v.mp4' }, { field: 'video_urls' }), { video_urls: ['https://a/v.mp4'] });
    assert.deepEqual(run('wrap_array', { video_url: 'https://a/v.mp4' }, { field: 'video_urls', from: 'video_url' }), { video_urls: ['https://a/v.mp4'] });
    assert.deepEqual(run('wrap_array', { list: ['a', '', null, 'b'] }, { field: 'list' }), { list: ['a', 'b'] });
    assert.deepEqual(run('wrap_array', { list: '' }, { field: 'list' }), {});
    assert.deepEqual(run('first_of_array', { image_url: ['', 'https://a/1.png', 'https://a/2.png'] }, { field: 'image_url' }), { image_url: 'https://a/1.png' });
    assert.deepEqual(run('first_of_array', { images_list: ['https://a/1.png'] }, { field: 'image_url', from: 'images_list' }), { image_url: 'https://a/1.png' });
    assert.deepEqual(run('first_of_array', { image_url: [] }, { field: 'image_url' }), {});
    assert.deepEqual(run('first_of_array', { image_url: 'https://a/1.png' }, { field: 'image_url' }), { image_url: 'https://a/1.png' });
    assert.deepEqual(run('slice_array', { image_urls: [1, 2, 3, 4] }, { field: 'image_urls', max: 2 }), { image_urls: [1, 2] });
    assert.deepEqual(run('split_array', { images_list: ['https://a/1.png', 'https://a/2.png'] }, { from: 'images_list', to: ['image_url', 'end_image_url'] }),
        { image_url: 'https://a/1.png', end_image_url: 'https://a/2.png' });
    assert.deepEqual(run('split_array', { images_list: ['https://a/1.png'] }, { from: 'images_list', to: ['image_url', 'end_image_url'] }),
        { image_url: 'https://a/1.png' });
    assert.deepEqual(run('split_array', { images_list: 'https://a/1.png' }, { from: 'images_list', to: ['image_url'] }), { image_url: 'https://a/1.png' });
});

test('omit_if_negative / omit_if / lowercase / uppercase / drop', () => {
    assert.deepEqual(run('omit_if_negative', { seed: -1 }, { field: 'seed' }), {});
    assert.deepEqual(run('omit_if_negative', { seed: '' }, { field: 'seed' }), {});
    assert.deepEqual(run('omit_if_negative', { seed: 42 }, { field: 'seed' }), { seed: 42 });
    assert.deepEqual(run('omit_if', { aspect_ratio: 'Auto' }, { field: 'aspect_ratio', values: ['auto'] }), {});
    assert.deepEqual(run('omit_if', { aspect_ratio: '16:9' }, { field: 'aspect_ratio', values: ['auto'] }), { aspect_ratio: '16:9' });
    assert.deepEqual(run('lowercase', { mode: 'FAST' }, { field: 'mode' }), { mode: 'fast' });
    assert.deepEqual(run('uppercase', { style: 'Realistic' }, { field: 'style' }), { style: 'REALISTIC' });
    assert.deepEqual(run('uppercase', { style: 3 }, { field: 'style' }), { style: 3 });
    assert.deepEqual(run('drop', { a: 1, b: 2 }, { field: 'a' }), { b: 2 });
});

test('map_values: same key, cross key, booleans, nested, defaults', () => {
    assert.deepEqual(run('map_values', { output_format: 'jpg' }, { field: 'output_format', map: { jpg: 'jpeg' } }), { output_format: 'jpeg' });
    assert.deepEqual(run('map_values', { output_format: 'png' }, { field: 'output_format', map: { jpg: 'jpeg' } }), { output_format: 'png' });
    assert.deepEqual(run('map_values', { high_bitrate: true }, { field: 'bitrate_mode', from: 'high_bitrate', map: { true: 'high', false: 'standard' } }), { bitrate_mode: 'high' });
    assert.deepEqual(run('map_values', { high_bitrate: false }, { field: 'bitrate_mode', from: 'high_bitrate', map: { true: 'high', false: 'standard' } }), { bitrate_mode: 'standard' });
    assert.deepEqual(run('map_values', { quality: 'Medium' }, { field: 'turbo_mode', from: 'quality', map: { medium: true, high: false } }), { turbo_mode: true });
    assert.deepEqual(run('map_values', { style: 'none' }, { field: 'style', map: { none: null } }), {});
    assert.deepEqual(run('map_values', { is_instrumental: false, lyrics: 'la la' }, { field: 'lyrics', from: 'is_instrumental', map: { true: '[instrumental]' }, keep_unmapped: false }), { lyrics: 'la la' });
    assert.deepEqual(run('map_values', { is_instrumental: true, lyrics: 'la la' }, { field: 'lyrics', from: 'is_instrumental', map: { true: '[instrumental]' }, keep_unmapped: false }), { lyrics: '[instrumental]' });
    assert.deepEqual(run('map_values', { audio_setting: { format: 'wav' } }, { field: 'audio_setting.format', map: { wav: 'flac' } }), { audio_setting: { format: 'flac' } });
    assert.deepEqual(run('map_values', {}, { field: 'preset', map: {}, default: 'hustle' }), { preset: 'hustle' });
    assert.deepEqual(run('map_values', { theme: 'Unknown' }, { field: 'preset', from: 'theme', map: { Ali: 'ali' }, default: 'hustle' }), { preset: 'hustle' });
});

test('aspect_to_image_size: presets, ~1MP objects, tiers, auto, bounds', () => {
    const presets = { '1:1': 'square_hd', '16:9': 'landscape_16_9', '3:2': { width: 1216, height: 832 } };
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '16:9' }, { presets, measure: 'area', base: 1048576 }), { image_size: 'landscape_16_9' });
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '3:2' }, { presets }), { image_size: { width: 1216, height: 832 } });
    const mp = run('aspect_to_image_size', { aspect_ratio: '21:9' }, { presets, measure: 'area', base: 1048576, multiple: 16 }).image_size;
    assert.equal(mp.width % 16, 0);
    assert.equal(mp.height % 16, 0);
    assert.ok(Math.abs(mp.width * mp.height - 1048576) / 1048576 < 0.05);
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '16:9', resolution: '4K' }, { tier_from: 'resolution', tiers: { '1K': 1024, '2K': 2048, '4K': 4096 } }),
        { image_size: { width: 4096, height: 2304 } });
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '9:16', resolution: '2K' }, { tier_from: 'resolution', tiers: { '2K': 2048 } }),
        { image_size: { width: 1152, height: 2048 } });
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '1:1', quality: 'high' }, { tier_from: 'quality', tiers: { basic: 2048 ** 2, high: 3072 ** 2 }, measure: 'area' }),
        { image_size: { width: 3072, height: 3072 } });
    assert.deepEqual(run('aspect_to_image_size', { resolution: '4K' }, { tier_from: 'resolution', tiers: { '2K': 2048, '4K': 4096 }, auto: { '2K': 'auto_2K', '4K': 'auto_4K', default: 'auto_2K' } }),
        { image_size: 'auto_4K' });
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: 'auto' }, { auto: { default: 'auto' } }), { image_size: 'auto' });
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: 'auto' }, {}), {});
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '16:9' }, { field: 'video_size', tier_from: 'resolution', tiers: { '720p': 1280 }, multiple: 32 }),
        { video_size: { width: 1280, height: 704 } }, 'no tier sent → first tier');
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '16:9', resolution: '720p' }, { field: 'video_size', tier_from: 'resolution', tiers: { '720p': 1280 }, multiple: 32 }),
        { video_size: { width: 1280, height: 704 } });
    assert.deepEqual(run('aspect_to_image_size', { aspect_ratio: '1:4' }, { base: 4096, max: 2048 }), { image_size: { width: 1024, height: 2048 } });
});

test('dims_to_image_size', () => {
    assert.deepEqual(run('dims_to_image_size', { width: 1024, height: 768 }, {}), { image_size: { width: 1024, height: 768 } });
    assert.deepEqual(run('dims_to_image_size', { width: '1000', height: 999 }, { multiple: 16, max: 992 }), { image_size: { width: 992, height: 992 } });
    assert.deepEqual(run('dims_to_image_size', { width: 1024 }, {}), {});
});

test('duration_to_frames: formula, table, bounds', () => {
    assert.deepEqual(run('duration_to_frames', { duration: 5 }, { fps: 24, add: 1 }), { num_frames: 121 });
    assert.deepEqual(run('duration_to_frames', { duration: '10' }, { fps: 25, multiple: 8, add: 1 }), { num_frames: 249 });
    assert.deepEqual(run('duration_to_frames', { duration: 5 }, { fps: 16, map: { 5: 81, 10: 100 } }), { num_frames: 81 });
    assert.deepEqual(run('duration_to_frames', { duration: 10 }, { fps: 16, map: { 5: 81 }, max: 100 }), { num_frames: 100 });
    assert.deepEqual(run('duration_to_frames', { duration: 30 }, { fps: 24, add: 1, max: 481 }), { num_frames: 481 });
    assert.deepEqual(run('duration_to_frames', { duration: 'x' }, { fps: 24 }), {});
});

test('default_if_empty / copy / capitalize_ref_tokens', () => {
    assert.deepEqual(run('default_if_empty', { prompt: '  ' }, { field: 'prompt', value: 'A person is talking' }), { prompt: 'A person is talking' });
    assert.deepEqual(run('default_if_empty', { prompt: 'hello' }, { field: 'prompt', value: 'x' }), { prompt: 'hello' });
    assert.deepEqual(run('default_if_empty', {}, { field: 'character_orientation', value: 'image' }), { character_orientation: 'image' });
    assert.deepEqual(run('copy', { prompt: 'cat' }, { field: 'subject', from: 'prompt' }), { prompt: 'cat', subject: 'cat' });
    assert.deepEqual(run('copy', { prompt: 'cat', subject: 'dog' }, { field: 'subject', from: 'prompt' }), { prompt: 'cat', subject: 'dog' });
    assert.deepEqual(run('capitalize_ref_tokens', { prompt: 'put @image1 next to @VIDEO2 with @audio1' }, {}), { prompt: 'put @Image1 next to @Video2 with @Audio1' });
});

test('concat_arrays / to_object_array', () => {
    assert.deepEqual(run('concat_arrays', { image_url: 'a', images_list: ['b', 'a', 'c'] }, { field: 'reference_image_urls', from: ['image_url', 'images_list'], max: 2 }),
        { reference_image_urls: ['a', 'b'] });
    assert.deepEqual(run('concat_arrays', {}, { field: 'x', from: ['a'] }), {});
    assert.deepEqual(run('to_object_array', { lora_url: 'https://h/l.safetensors', lora_weight: '0.7' }, { field: 'loras', props: { path: 'lora_url', scale: 'lora_weight' }, required: ['path'], numeric: ['scale'] }),
        { loras: [{ path: 'https://h/l.safetensors', scale: 0.7 }] });
    assert.deepEqual(run('to_object_array', { lora_weight: '1' }, { field: 'loras', props: { path: 'lora_url', scale: 'lora_weight' }, required: ['path'] }), {});
});

test('remap_items / join_items / concat_text (dialogue → TTS inputs)', () => {
    const dialogue = [{ text: 'Hi', voice_id: 'Rachel' }, { text: '', voice_id: 'x' }, { text: 'Yo', voice_id: 'Adam' }];
    assert.deepEqual(run('remap_items', { dialogue }, { field: 'inputs', from: 'dialogue', props: { text: 'text', voice: 'voice_id' } }),
        { inputs: [{ text: 'Hi', voice: 'Rachel' }, { voice: 'x' }, { text: 'Yo', voice: 'Adam' }] });
    assert.deepEqual(run('remap_items', { speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Fenrir', accent: 'RP' }] },
        { field: 'speakers', props: { speaker_id: 'speaker_id', voice: 'voice_name' }, alias: ['speaker_id'] }),
    { speakers: [{ speaker_id: 'Speaker1', voice: 'Fenrir' }] });
    assert.deepEqual(run('join_items', { turns: [{ speaker_id: 'Speaker 1', text: '[shouting] Halt!' }, { speaker_id: 'Speaker 2', text: 'Why?' }] },
        { field: 'prompt', from: 'turns', template: '{speaker_id}: {text}', alias: ['speaker_id'] }),
    { prompt: 'Speaker1: [shouting] Halt!\nSpeaker2: Why?' });
    assert.deepEqual(run('join_items', { turns: [{ speaker_id: 'S' }] }, { field: 'prompt', from: 'turns', template: '{speaker_id}: {text}' }), {});
    assert.deepEqual(run('concat_text', { scene: 'A quiet room.', sample_context: '', mood: 'Gentle.' }, { field: 'style_instructions', from: ['scene', 'sample_context', 'mood'] }),
        { style_instructions: 'A quiet room. Gentle.' });
});

test('unwrap_single', () => {
    assert.deepEqual(run('unwrap_single', { speakers: [{ voice: 'Puck' }] }, { field: 'speakers', to: 'voice', prop: 'voice' }), { voice: 'Puck' });
    assert.deepEqual(run('unwrap_single', { speakers: [{ voice: 'Puck' }], voice: 'Kore' }, { field: 'speakers', to: 'voice', prop: 'voice' }), { voice: 'Kore' });
    const two = { speakers: [{ voice: 'Puck' }, { voice: 'Kore' }] };
    assert.deepEqual(run('unwrap_single', structuredClone(two), { field: 'speakers', to: 'voice', prop: 'voice' }), two);
});

test('applyTransforms runs ops in order', () => {
    const work = { duration: 7, seed: -1, images_list: ['https://a/1.png'] };
    applyTransforms([
        { op: 'to_string', field: 'duration' },
        { op: 'snap_enum', field: 'duration', values: ['5', '10'] },
        { op: 'omit_if_negative', field: 'seed' },
        { op: 'first_of_array', field: 'image_url', from: 'images_list' },
    ], work);
    assert.deepEqual(work, { duration: '5', image_url: 'https://a/1.png' });
});

test('matchesWhen clauses', () => {
    assert.equal(matchesWhen(null, {}), true);
    assert.equal(matchesWhen({ field: 'quality', equals: 'basic' }, { quality: 'Basic' }), true);
    assert.equal(matchesWhen({ field: 'quality', equals: 'basic' }, { quality: 'high' }), false);
    assert.equal(matchesWhen({ field: 'quality', equals: 'basic' }, {}), false);
    assert.equal(matchesWhen({ field: 'mode', in: ['replace', 'swap'] }, { mode: 'swap' }), true);
    assert.equal(matchesWhen({ field: 'images_list', min_items: 2 }, { images_list: ['a', 'b'] }), true);
    assert.equal(matchesWhen({ field: 'images_list', min_items: 2 }, { images_list: ['a', ''] }), false);
    assert.equal(matchesWhen({ field: 'images_list', max_items: 1 }, { images_list: ['a'] }), true);
    assert.equal(matchesWhen({ field: 'last_image', present: true }, { last_image: 'x' }), true);
    assert.equal(matchesWhen({ field: 'last_image', present: true }, { last_image: '' }), false);
    assert.equal(matchesWhen({ field: 'video_url', present: false }, {}), true);
    assert.equal(matchesWhen([{ field: 'quality', equals: 'basic' }, { field: 'images_list', min_items: 2 }], { quality: 'basic', images_list: ['a', 'b'] }), true);
    assert.equal(matchesWhen([{ field: 'quality', equals: 'basic' }, { field: 'images_list', min_items: 2 }], { quality: 'basic', images_list: ['a'] }), false);
    assert.equal(matchesWhen({ field: 'x' }, { x: 1 }), false, 'a clause without a test never matches');
});
