// buildFalInput validation/safety, endpoint variants, and extractOutputs over
// every fal output shape the gateway can meet.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFalInput, extractOutputs, getEntry, listAvailable } from '../../lib/gateway/catalog/index.js';

const IMG = 'https://media.example.com/a.png';
const IMG2 = 'https://media.example.com/b.png';
const VID = 'https://media.example.com/c.mp4';
const AUD = 'https://media.example.com/d.mp3';

function entry(key) {
    const found = getEntry(key);
    assert.ok(found, `catalog has ${key}`);
    return found;
}

function rejects(fn, { code = 'invalid_input', field } = {}) {
    let caught;
    try { fn(); } catch (error) { caught = error; }
    assert.ok(caught, 'expected a 400');
    assert.equal(caught.status, 400);
    assert.equal(caught.code, code);
    assert.deepEqual(caught.body, { error: code, field: caught.field, message: caught.message });
    if (field) assert.equal(caught.field, field);
    return caught;
}

/* ─────────────────────────── buildFalInput ─────────────────────────── */

test('unknown, disabled and malformed requests are 400s', () => {
    rejects(() => buildFalInput(null, {}), { code: 'unknown_model', field: 'model' });
    const disabledKey = listAvailable().disabled[0];
    rejects(() => buildFalInput(entry(disabledKey), { prompt: 'x' }), { code: 'model_unavailable', field: 'model' });
    rejects(() => buildFalInput(entry('flux-schnell-image'), 'prompt=x'), { field: 'payload' });
    rejects(() => buildFalInput(entry('flux-schnell-image'), [1, 2]), { field: 'payload' });
});

test('drops unknown and browser-forbidden keys; fixed params win', () => {
    const { input, endpoint } = buildFalInput(entry('flux-schnell-image'), {
        model: 'flux-schnell',
        prompt: 'a fox',
        width: 1024,
        height: 768,
        sync_mode: true,
        enable_safety_checker: false,
        webhook_url: 'https://evil.example/hook',
        totally_unknown: 1,
        image_url: null,
        _modelId: 'x',
    });
    assert.equal(endpoint, 'fal-ai/flux/schnell');
    assert.deepEqual(input, { prompt: 'a fox', image_size: { width: 1024, height: 768 } });

    const upscale = buildFalInput(entry('ai-image-upscale'), { image_url: IMG, scale: 8 }).input;
    assert.equal(upscale.scale, 2, 'fixed scale overrides the browser value');
});

test('prototype-changing keys never reach the fal input', () => {
    const payload = JSON.parse('{"prompt":"x","__proto__":{"polluted":true},"constructor":{"a":1},"loras":[{"path":"owner/repo","scale":1,"__proto__":{"evil":1}}]}');
    const { input } = buildFalInput(entry('qwen-image-text-to-image-lora'), payload);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.getPrototypeOf(input), Object.prototype);
    assert.deepEqual(input.loras, [{ path: 'owner/repo', scale: 1 }]);
    assert.equal(Object.getPrototypeOf(input.loras[0]), Object.prototype);
});

test('does not mutate the payload and entries are frozen', () => {
    const payload = { images_list: [IMG], prompt: 'edit', aspect_ratio: '16:9' };
    const copy = structuredClone(payload);
    buildFalInput(entry('nano-banana-pro-edit'), payload);
    assert.deepEqual(payload, copy);
    const flux = entry('flux-schnell-image');
    assert.ok(Object.isFrozen(flux) && Object.isFrozen(flux.input.allowed));
});

test('required fields: 400 names the studio field', () => {
    rejects(() => buildFalInput(entry('nano-banana-pro-edit'), { prompt: 'edit' }), { field: 'images_list' });
    rejects(() => buildFalInput(entry('flux-schnell-image'), { prompt: '   ' }), { field: 'prompt' });
});

test('enums snap when safe, otherwise 400; numbers clamp to the fal range', () => {
    const veo = buildFalInput(entry('veo3.1-text-to-video'), { prompt: 'x', duration: 5, aspect_ratio: '1:1', resolution: '4k' }).input;
    assert.equal(veo.duration, '6s');
    assert.ok(['16:9', '9:16'].includes(veo.aspect_ratio) || veo.aspect_ratio === undefined);
    const ideogram = buildFalInput(entry('ideogram-v3-t2i'), { prompt: 'x', style: 'Realistic', num_images: 99 }).input;
    assert.equal(ideogram.style, 'REALISTIC');
    assert.ok(ideogram.num_images <= 8);
    rejects(() => buildFalInput(entry('generate_wan_ai_effects'), { image_url: IMG, name: 'Kamehameha' }), { field: 'name' });
    rejects(() => buildFalInput(entry('pixverse-v5.5-i2v'), { images_list: [IMG], prompt: 'x', style: 'watercolor' }), { field: 'style' });
});

test('URL safety: only public-looking http(s) media URLs pass', () => {
    const edit = entry('nano-banana-pro-edit');
    for (const bad of [
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'file:///etc/passwd',
        'ftp://files.example.com/a.png',
        'gopher://x',
        'https://user:secret@media.example.com/a.png',
        'not a url',
        '//media.example.com/a.png',
    ]) {
        rejects(() => buildFalInput(edit, { prompt: 'x', images_list: [bad] }), { field: 'images_list' });
    }
    rejects(() => buildFalInput(entry('flux-schnell-image'), { prompt: 'file:///etc/passwd' }), { field: 'prompt' });
    rejects(() => buildFalInput(entry('qwen-image-text-to-image-lora'), { prompt: 'x', loras: [{ path: 'file:///etc/shadow', scale: 1 }] }), { field: 'loras' });
    const hf = buildFalInput(entry('qwen-image-text-to-image-lora'), { prompt: 'x', loras: [{ path: 'owner/repo-lora', scale: 1 }] }).input;
    assert.deepEqual(hf.loras, [{ path: 'owner/repo-lora', scale: 1 }], 'Hugging Face repo ids are not URLs and pass');
    const ok = buildFalInput(edit, { prompt: 'see https://example.com for style', images_list: [IMG, IMG2] }).input;
    assert.deepEqual(ok.image_urls, [IMG, IMG2]);
});

/* ────────────────────────────── variants ────────────────────────────── */

test('seedance 2.0: image count and quality tier pick the fal endpoint', () => {
    const i2v = entry('seedance-v2.0-i2v');
    const base = { prompt: 'dance @image1', duration: 10, aspect_ratio: 'adaptive' };
    let built = buildFalInput(i2v, { ...base, images_list: [IMG], quality: 'high' });
    assert.equal(built.endpoint, 'bytedance/seedance-2.0/image-to-video');
    assert.deepEqual(built.input, { prompt: 'dance @Image1', duration: '10', aspect_ratio: 'auto', image_url: IMG });
    built = buildFalInput(i2v, { ...base, images_list: [IMG, IMG2], quality: 'high' });
    assert.equal(built.endpoint, 'bytedance/seedance-2.0/reference-to-video');
    assert.deepEqual(built.input.image_urls, [IMG, IMG2]);
    built = buildFalInput(i2v, { ...base, images_list: [IMG], quality: 'basic' });
    assert.equal(built.endpoint, 'bytedance/seedance-2.0/fast/image-to-video');
    built = buildFalInput(i2v, { ...base, images_list: [IMG, IMG2], quality: 'basic' });
    assert.equal(built.endpoint, 'bytedance/seedance-2.0/fast/reference-to-video');

    const t2v = buildFalInput(entry('seedance-v2.0-t2v'), { prompt: 'x', duration: 15, quality: 'high' });
    assert.equal(t2v.endpoint, 'bytedance/seedance-2.0/text-to-video');
    assert.deepEqual(t2v.input, { prompt: 'x', duration: '15', resolution: '720p' });
});

test('first/last frame, multi-image and transition routes', () => {
    let built = buildFalInput(entry('veo3.1-image-to-video'), { image_url: IMG, last_image: IMG2, prompt: 'x', duration: 8 });
    assert.equal(built.endpoint, 'fal-ai/veo3.1/first-last-frame-to-video');
    assert.equal(built.input.first_frame_url, IMG);
    assert.equal(built.input.last_frame_url, IMG2);
    assert.equal(built.input.duration, '8s');

    built = buildFalInput(entry('flux-kontext-pro-i2i'), { images_list: [IMG, IMG2], prompt: 'merge' });
    assert.equal(built.endpoint, 'fal-ai/flux-pro/kontext/multi');
    assert.deepEqual(built.input.image_urls, [IMG, IMG2]);
    built = buildFalInput(entry('flux-kontext-pro-i2i'), { images_list: [IMG], prompt: 'edit', aspect_ratio: '16:21' });
    assert.equal(built.endpoint, 'fal-ai/flux-pro/kontext');
    assert.equal(built.input.image_url, IMG);
    assert.equal(built.input.aspect_ratio, '3:4');

    built = buildFalInput(entry('pixverse-v5-i2v'), { images_list: [IMG, IMG2], prompt: 'morph', aspect_ratio: '9:16', duration: 7 });
    assert.equal(built.endpoint, 'fal-ai/pixverse/v5/transition');
    assert.equal(built.input.first_image_url, IMG);
    assert.equal(built.input.end_image_url, IMG2);
    assert.equal(built.input.aspect_ratio, '9:16');
    assert.equal(built.input.duration, '8');

    built = buildFalInput(entry('vidu-v2.0-i2v'), { images_list: [IMG, IMG2], prompt: 'x' });
    assert.equal(built.endpoint, 'fal-ai/vidu/start-end-to-video');
    assert.deepEqual([built.input.start_image_url, built.input.end_image_url], [IMG, IMG2]);
});

test('mode, media-presence and effect-name routes', () => {
    let built = buildFalInput(entry('wan2.2-animate'), { image_url: IMG, video_url: VID, mode: 'replace', resolution: '720p' });
    assert.equal(built.endpoint, 'fal-ai/wan/v2.2-14b/animate/replace');
    built = buildFalInput(entry('wan2.2-animate'), { image_url: IMG, video_url: VID });
    assert.equal(built.endpoint, 'fal-ai/wan/v2.2-14b/animate/move');

    built = buildFalInput(entry('kling-o1-reference-to-video'), { images_list: [IMG], video_url: VID, prompt: 'x', keep_original_sound: true, duration: 5 });
    assert.equal(built.endpoint, 'fal-ai/kling-video/o1/video-to-video/reference');
    assert.equal(built.input.keep_audio, true);
    assert.equal(built.input.video_url, VID);

    built = buildFalInput(entry('gemini-omni-flash-1-1-text-to-video'), { prompt: 'x', video_url: VID, resolution: '1080p' });
    assert.equal(built.endpoint, 'google/gemini-omni-flash/v1.1/edit');
    built = buildFalInput(entry('gemini-omni-flash-1-1-text-to-video'), { prompt: 'x', image_urls: [IMG] });
    assert.equal(built.endpoint, 'google/gemini-omni-flash/v1.1/reference-to-video');
    built = buildFalInput(entry('gemini-omni-flash-1-1-text-to-video'), { prompt: 'x', duration: 6 });
    assert.equal(built.endpoint, 'google/gemini-omni-flash/v1.1/text-to-video');

    built = buildFalInput(entry('flux-kontext-effects'), { image_url: IMG, name: 'Cartoonify', prompt: 'ignored' });
    assert.equal(built.endpoint, 'fal-ai/image-editing/cartoonify');
    assert.deepEqual(built.input, { image_url: IMG });
    built = buildFalInput(entry('flux-kontext-effects'), { image_url: IMG, name: 'Hair Change', prompt: 'curly red hair' });
    assert.equal(built.endpoint, 'fal-ai/image-editing/hair-change');
    assert.equal(built.input.prompt, 'curly red hair');

    built = buildFalInput(entry('depth-anything'), { image_url: IMG });
    assert.equal(built.endpoint, 'fal-ai/image-preprocessors/depth-anything/v2');
    built = buildFalInput(entry('depth-anything'), { video_url: VID });
    assert.equal(built.endpoint, 'fal-ai/depth-anything-video');
});

test('structured audio payloads: dialogue, speakers, instrumental', () => {
    let { input } = buildFalInput(entry('gemini-3-1-flash-tts'), {
        dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Halt!' }, { speaker_id: 'Speaker 2', text: 'Why?' }],
        speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Fenrir', accent: 'RP' }, { speaker_id: 'Speaker 2', voice_name: 'Puck' }],
        scene: 'A windy mountain pass.',
        sample_context: 'Radio drama.',
        temperature: 5,
    });
    assert.equal(input.prompt, 'Speaker1: Halt!\nSpeaker2: Why?');
    assert.deepEqual(input.speakers, [{ speaker_id: 'Speaker1', voice: 'Fenrir' }, { speaker_id: 'Speaker2', voice: 'Puck' }]);
    assert.equal(input.style_instructions, 'A windy mountain pass. Radio drama.');
    assert.equal(input.temperature, 2, 'clamped to the fal maximum');
    assert.equal(input.output_format, 'mp3');

    ({ input } = buildFalInput(entry('gemini-3-1-flash-tts'), {
        dialogue_turns: [{ speaker_id: 'Narrator', text: 'Once upon a time.' }],
        speakers: [{ speaker_id: 'Narrator', voice_name: 'Puck' }],
    }));
    assert.equal(input.voice, 'Puck', 'a single speaker becomes the top-level voice');
    assert.equal(input.speakers, undefined);

    ({ input } = buildFalInput(entry('elevenlabs-text-to-dialogue-v3'), { dialogue: [{ text: 'Hi', voice_id: 'Rachel' }], stability: 0.5 }));
    assert.deepEqual(input.inputs, [{ text: 'Hi', voice: 'Rachel' }]);

    ({ input } = buildFalInput(entry('minimax-music-3.0'), { prompt: 'synth pop', lyrics: 'la la la la la', is_instrumental: true }));
    assert.equal(input.lyrics, '[instrumental]');

    ({ input } = buildFalInput(entry('minimax-speech-2.6-hd'), { prompt: 'Hello', voice_id: 'Wise_Woman', speed: 1, format: 'wav' }));
    assert.equal(input.voice_setting.voice_id, 'Wise_Woman');
    assert.equal(input.audio_setting.format, 'flac');
    assert.equal(input.output_format, 'url');
});

test('LoRA and reference-list payloads', () => {
    let { input } = buildFalInput(entry('flux-1-dev-style-lora-inference'), { prompt: 'x', lora_url: 'https://huggingface.co/a/b.safetensors', lora_weight: '0.8', aspect_ratio: '3:2' });
    assert.deepEqual(input.loras, [{ path: 'https://huggingface.co/a/b.safetensors', scale: 0.8 }]);
    assert.deepEqual(input.image_size, { width: 1216, height: 832 });
    ({ input } = buildFalInput(entry('flux-1-dev-style-lora-inference'), { prompt: 'x', lora_weight: '1' }));
    assert.equal(input.loras, undefined, 'no LoRA path → no LoRA item');

    ({ input } = buildFalInput(entry('wan2.7-reference-to-video'), { prompt: 'x', image_url: IMG, images_list: [IMG2, IMG], duration: 5 }));
    assert.deepEqual(input.reference_image_urls, [IMG, IMG2]);
});

test('size transforms: aspect presets, tiers and dimensions', () => {
    const pulid = buildFalInput(entry('flux-pulid'), { prompt: 'x', image_url: IMG, aspect_ratio: '9:16', strength: 0.6 }).input;
    assert.deepEqual(pulid, { prompt: 'x', reference_image_url: IMG, image_size: 'portrait_16_9' });
    const seedream = buildFalInput(entry('bytedance-seedream-edit-v4'), { prompt: 'x', images_list: [IMG], aspect_ratio: '16:9', resolution: '4K' }).input;
    assert.deepEqual(seedream.image_size, { width: 4096, height: 2304 });
    const flux = buildFalInput(entry('flux-schnell-image'), { prompt: 'x', width: 1344, height: 768 }).input;
    assert.deepEqual(flux.image_size, { width: 1344, height: 768 });
});

/* ─────────────────────────── extractOutputs ─────────────────────────── */

test('extractOutputs covers every fal output shape', () => {
    const image = entry('flux-schnell-image');
    const video = entry('veo3.1-text-to-video');
    const audio = entry('minimax-speech-2.6-hd');
    const tool = entry('ai-background-remover');

    let out = extractOutputs(image, { images: [{ url: IMG, width: 1024, height: 1024, content_type: 'image/png' }, { url: IMG2 }], seed: 1 });
    assert.deepEqual(out.urls, [IMG, IMG2]);
    assert.equal(out.kind, 'image');
    assert.deepEqual(out.images[0], { url: IMG, width: 1024, height: 1024, content_type: 'image/png' });
    assert.equal(out.video, null);

    out = extractOutputs(tool, { image: { url: IMG }, mask_image: { url: IMG2 } });
    assert.deepEqual(out.urls, [IMG]);
    assert.equal(out.kind, 'image');

    out = extractOutputs(video, { video: { url: VID, content_type: 'video/mp4' } });
    assert.deepEqual(out.urls, [VID]);
    assert.deepEqual(out.video, { url: VID, content_type: 'video/mp4' });

    out = extractOutputs(video, { videos: [{ url: VID }] });
    assert.deepEqual(out.urls, [VID]);
    assert.equal(out.kind, 'video');

    out = extractOutputs(audio, { audio: { url: AUD }, duration_ms: 1200 });
    assert.deepEqual(out.audio, { url: AUD });
    out = extractOutputs(audio, { audio_file: { url: AUD, file_size: 10 } });
    assert.deepEqual(out.urls, [AUD]);
    assert.equal(out.kind, 'audio');
    out = extractOutputs(audio, { audio_url: AUD });
    assert.deepEqual(out.urls, [AUD]);
    out = extractOutputs(null, { audio_url: { url: AUD } });
    assert.deepEqual(out.urls, [AUD]);

    out = extractOutputs(image, { model_mesh: { url: 'https://media.example.com/m.glb' } });
    assert.deepEqual(out.urls, ['https://media.example.com/m.glb']);
    assert.equal(out.kind, 'model');

    out = extractOutputs(video, { output: { video: { url: VID } } });
    assert.deepEqual(out.urls, [VID]);
    out = extractOutputs(image, { output: { images: [{ url: IMG }] } });
    assert.deepEqual(out.images, [{ url: IMG }]);
    out = extractOutputs(null, { url: VID });
    assert.deepEqual(out.urls, [VID]);
    out = extractOutputs(null, { outputs: [IMG, 'data:image/png;base64,AA', IMG] });
    assert.deepEqual(out.urls, [IMG], 'non-http values dropped, duplicates removed');
    out = extractOutputs(image, { images: ['https://media.example.com/plain.png'] });
    assert.deepEqual(out.urls, ['https://media.example.com/plain.png']);

    out = extractOutputs(image, { images: [{ url: 'data:image/png;base64,AA' }] });
    assert.deepEqual(out.urls, []);
    assert.deepEqual(extractOutputs(image, null).urls, []);
    assert.deepEqual(extractOutputs(image, 'garbage').urls, []);

    // Variant-specific output path (depth image route returns image.url).
    const depth = entry('depth-anything');
    out = extractOutputs(depth, { image: { url: IMG } }, 'fal-ai/image-preprocessors/depth-anything/v2');
    assert.deepEqual(out.urls, [IMG]);
    assert.equal(out.kind, 'image');
});

test('listAvailable flags studio models whose presets fal cannot serve', () => {
    const { disabled_models: disabledModels } = listAvailable();
    assert.ok(disabledModels.includes('motion-controls'));
    assert.ok(disabledModels.includes('vfx'));
    assert.ok(getEntry('generate_wan_ai_effects').enabled, 'AI Video Effects itself stays enabled');
});
