// Catalog coverage: every studio model resolves to a catalog entry, and every
// enabled entry turns the payload its studio actually posts into a fal input
// that only uses schema fields and carries every required one.
//
// The payload builders below mirror the studio client's per-studio request
// assembly (generateImage / generateI2I / generateVideo / generateI2V /
// processV2V / processLipSync / processRecast / processMotionControl /
// generateAudio and the image tools) using the studio's own helpers, so a
// change to a model definition shows up here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import catalog from '../../lib/gateway/catalog/catalog.json';
import {
    buildFalInput,
    estimateUsd,
    getEntry,
    listAvailable,
    listEntries,
} from '../../lib/gateway/catalog/index.js';
import * as models from '../../packages/studio/src/models.js';
import { buildSupplementalInputPayload, createModelParameterValues } from '../../packages/studio/src/modelParameters.js';
import { buildImageSizePayload } from '../../packages/studio/src/imageSizing.js';
import {
    buildImageInputPayload,
    getAuxiliaryImageInputs,
    getImageInputContract,
    normalizePrimaryImageUrls,
} from '../../packages/studio/src/imageInputContracts.js';
import { buildReferenceParams, getModelMediaCapabilities, mapReferenceParams } from '../../packages/studio/src/modelCapabilities.js';
import {
    buildVideoToolPayload,
    getDefaultVideoToolOptions,
    serializeVideoToolOptions,
} from '../../packages/studio/src/videoToolCapabilities.js';
import { getGroupedVideoConfiguration } from '../../packages/studio/src/groupedVideoModels.js';

const IMG = 'https://media.example.com/in/portrait.png';
const IMG2 = 'https://media.example.com/in/product.png';
const VID = 'https://media.example.com/in/clip.mp4';
const AUD = 'https://media.example.com/in/voice.mp3';
const PROMPT = 'A calm turquoise lake at sunrise, cinematic wide shot';

const LISTS = ['t2iModels', 'i2iModels', 't2vModels', 'i2vModels', 'v2vModels', 'lipsyncModels', 'recastModels', 'motionControlModels', 'audioModels'];

function defaultOf(input) {
    if (!input) return undefined;
    if (input.default !== undefined && input.default !== null && input.default !== '') return input.default;
    if (Array.isArray(input.enum) && input.enum.length) return input.enum[0];
    return undefined;
}

function optionsOf(input) {
    if (!input) return [];
    if (Array.isArray(input.enum)) return input.enum;
    if (Array.isArray(input.options)) return input.options.map((option) => (option && typeof option === 'object' ? option.value : option));
    return [];
}

function includeRequiredArrayDefaults(model, payload) {
    const defaults = {};
    for (const field of model?.required || []) {
        if (payload[field] !== undefined || model?.inputs?.[field]?.type !== 'array') continue;
        defaults[field] = [];
    }
    return Object.keys(defaults).length > 0 ? { ...defaults, ...payload } : payload;
}

function mediaFor(model, { images = 1 } = {}) {
    const capabilities = getModelMediaCapabilities(model);
    const imageUrls = capabilities.image.field ? [IMG, IMG2].slice(0, Math.min(images, capabilities.image.maxItems || 1)) : [];
    return buildReferenceParams(model, {
        imageUrls,
        videoUrls: capabilities.video.field ? [VID] : [],
        audioUrls: capabilities.audio.field ? [AUD] : [],
    });
}

/* ───────────── studio request builders (mirror the studio client) ───────────── */

function t2iPayload(model, overrides = {}) {
    const values = createModelParameterValues(model);
    const needsImage = getImageInputContract(model, 't2i').primaryImageRequired;
    const params = {
        model: model.id,
        ...buildSupplementalInputPayload(model, values),
        ...(needsImage ? buildReferenceParams(model, { imageUrls: [IMG] }) : {}),
        prompt: PROMPT,
        aspect_ratio: defaultOf(model.inputs?.aspect_ratio) ?? models.getAspectRatiosForModel(model.id)[0] ?? '1:1',
    };
    const qualityField = models.getQualityFieldForModel(model.id);
    const quality = defaultOf(model.inputs?.[qualityField]) ?? models.getResolutionsForModel(model.id)[0];
    if (qualityField && quality) params[qualityField] = quality;
    Object.assign(params, overrides);

    const payload = { ...buildSupplementalInputPayload(model, params), prompt: params.prompt };
    Object.assign(payload, buildImageSizePayload(model, params.aspect_ratio));
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.image_url) {
        payload.image_url = params.image_url;
        payload.strength = params.strength || 0.6;
    } else if (params.images_list) {
        payload.images_list = params.images_list;
    } else {
        payload.image_url = null;
    }
    if (params.seed && params.seed !== -1) payload.seed = params.seed;
    return payload;
}

function i2iPayload(model, overrides = {}) {
    const values = createModelParameterValues(model);
    const params = {
        model: model.id,
        ...buildSupplementalInputPayload(model, values),
        images_list: [IMG],
        image_url: IMG,
        aspect_ratio: defaultOf(model.inputs?.aspect_ratio) ?? models.getAspectRatiosForI2IModel(model.id)[0],
        prompt: PROMPT,
    };
    if (model.swapField) params.swap_url = IMG2;
    for (const { field } of getAuxiliaryImageInputs(model, 'i2i')) params[field] = IMG2;
    const qualityField = models.getQualityFieldForI2IModel(model.id);
    const quality = defaultOf(model.inputs?.[qualityField]) ?? models.getResolutionsForI2IModel(model.id)[0];
    if (qualityField && quality) params[qualityField] = quality;
    const effect = models.getDefaultEffectForI2IModel(model.id);
    if (effect) params.name = effect;
    Object.assign(params, overrides);

    const imageField = model?.imageField || 'image_url';
    const imagesList = normalizePrimaryImageUrls(params.images_list, params.image_url);
    const payload = {
        ...mapReferenceParams(model, params),
        ...buildSupplementalInputPayload(model, params),
        ...buildImageInputPayload(model, 'i2i', params),
    };
    if (imagesList.length > 0) {
        if (imageField === 'images_list') payload.images_list = imagesList;
        else payload[imageField] = imagesList[0];
    }
    Object.assign(payload, buildImageSizePayload(model, params.aspect_ratio));
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (model?.inputs?.name) payload.name = params.name || model.inputs.name.default;
    return payload;
}

function videoCommonParams(model, getters) {
    const params = {};
    const aspect = defaultOf(model.inputs?.aspect_ratio) ?? getters.aspect?.(model.id)?.[0];
    if (aspect) params.aspect_ratio = aspect;
    const duration = defaultOf(model.inputs?.duration) ?? getters.duration?.(model.id)?.[0];
    if (duration !== undefined) params.duration = duration;
    const resolution = defaultOf(model.inputs?.resolution) ?? getters.resolution?.(model.id)?.[0];
    if (resolution) params.resolution = resolution;
    const quality = defaultOf(model.inputs?.quality);
    if (quality) params.quality = quality;
    return params;
}

function t2vPayload(model, overrides = {}) {
    const params = {
        model: model.id,
        ...buildSupplementalInputPayload(model, createModelParameterValues(model)),
        ...mediaFor(model),
        prompt: PROMPT,
        ...videoCommonParams(model, {
            duration: models.getDurationsForModel,
            resolution: (id) => models.getResolutionsForVideoModel(id),
            aspect: models.getAspectRatiosForVideoModel,
        }),
    };
    if (model.requiresRequestId) params.request_id = 'sample-request-id';
    const mode = defaultOf(model.inputs?.mode);
    if (mode) params.mode = mode;
    params.options = getDefaultVideoToolOptions(model);
    Object.assign(params, overrides);

    const capabilities = getModelMediaCapabilities(model);
    let payload = { ...mapReferenceParams(model, params), ...buildSupplementalInputPayload(model, params) };
    if (params.prompt) payload.prompt = params.prompt;
    if (params.request_id) payload.request_id = params.request_id;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (typeof params.generate_audio === 'boolean') payload.generate_audio = params.generate_audio;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (!capabilities.image.field && params.image_url) payload.image_url = params.image_url;
    if (!capabilities.image.field && params.images_list?.length > 0) payload.images_list = params.images_list;
    if (!capabilities.video.field && params.videos_list?.length > 0) payload.videos_list = params.videos_list;
    if (!capabilities.video.field && params.video_files?.length > 0) payload.video_files = params.video_files;
    Object.assign(payload, serializeVideoToolOptions(model, params.options));
    return includeRequiredArrayDefaults(model, payload);
}

function i2vPayload(model, overrides = {}, media = {}) {
    const params = {
        model: model.id,
        ...buildSupplementalInputPayload(model, createModelParameterValues(model)),
        ...mediaFor(model, media),
        prompt: PROMPT,
        ...videoCommonParams(model, {
            duration: models.getDurationsForI2VModel,
            resolution: (id) => models.getResolutionsForI2VModel(id),
            aspect: models.getAspectRatiosForI2VModel,
        }),
    };
    const effect = models.getDefaultEffectForI2VModel(model.id);
    if (effect) params.name = effect;
    const mode = defaultOf(model.inputs?.mode);
    if (mode) params.mode = mode;
    Object.assign(params, overrides);

    let payload = { ...mapReferenceParams(model, params), ...buildSupplementalInputPayload(model, params) };
    if (params.prompt) payload.prompt = params.prompt;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (typeof params.generate_audio === 'boolean') payload.generate_audio = params.generate_audio;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (model?.inputs?.name) payload.name = params.name || model.inputs.name.default;
    return includeRequiredArrayDefaults(model, payload);
}

function v2vPayload(model, overrides = {}) {
    const params = {
        model: model.id,
        ...buildSupplementalInputPayload(model, createModelParameterValues(model)),
        ...buildReferenceParams(model, { videoUrls: [VID], imageUrls: [IMG], audioUrls: [AUD] }),
        video_url: VID,
        options: getDefaultVideoToolOptions(model),
        ...videoCommonParams(model, {}),
    };
    if (model.imageField) params.image_url = IMG;
    if (model.hasPrompt) params.prompt = PROMPT;
    Object.assign(params, overrides);

    const toolPayload = buildVideoToolPayload(model, params);
    let payload = { ...buildSupplementalInputPayload(model, params), ...toolPayload, ...mapReferenceParams(model, params) };
    if (model?.hasPrompt && params.prompt) payload.prompt = params.prompt;
    if (getGroupedVideoConfiguration(model?.id)) {
        for (const field of ['duration', 'aspect_ratio', 'resolution', 'quality']) {
            if (model.inputs?.[field] && params[field] !== undefined) payload[field] = params[field];
        }
    }
    return includeRequiredArrayDefaults(model, payload);
}

function lipsyncPayload(model, overrides = {}) {
    const params = { model: model.id, audio_url: AUD };
    if (model.category === 'image') params.image_url = IMG;
    else params.video_url = VID;
    if (model.hasPrompt) params.prompt = PROMPT;
    const resolution = defaultOf(model.inputs?.resolution);
    if (resolution) params.resolution = resolution;
    if (model.hasSeed) params.seed = -1;
    Object.assign(params, overrides);
    const payload = {};
    if (params.audio_url) payload.audio_url = params.audio_url;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.video_url) payload.video_url = params.video_url;
    if (model?.hasPrompt) payload.prompt = params.prompt || '';
    if (params.resolution) payload.resolution = params.resolution;
    if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;
    return payload;
}

function recastPayload(model, overrides = {}) {
    const params = { model: model.id, video_url: VID, image_url: IMG };
    const aspect = defaultOf(model.inputs?.aspect_ratio);
    if (aspect) params.aspect_ratio = aspect;
    if (model.hasPrompt) params.prompt = PROMPT;
    if (model.id === 'kling-v3.0-pro-recast') params.character_orientation = 'image';
    Object.assign(params, overrides);
    const videoField = model?.videoField || 'video_url';
    const payload = { [videoField]: params.video_url };
    if (model?.imageField && params.image_url) payload[model.imageField] = params.image_url;
    if (model?.hasPrompt && params.prompt) payload.prompt = params.prompt;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.character_orientation) payload.character_orientation = params.character_orientation;
    return payload;
}

function motionControlPayload(model, overrides = {}) {
    const params = {
        model: model.id, mode: 'motion_transfer', video_url: VID, images_list: [IMG], prompt: '',
        aspect_ratio: '16:9', duration: 5, quality: 'high', high_bitrate: false, generate_audio: false, seed: -1,
        ...overrides,
    };
    const internalPrompt = params.mode === 'objects_swap'
        ? 'Keep the rest of the scene as filmed, swap the characters, products, or clothes with the reference images.'
        : 'Extract motion from the reference video and rebuild the scene with the new characters and assets, preserving the original motion, choreography, and camera movements.';
    const userPrompt = String(params.prompt || '').trim();
    const payload = {
        video_url: params.video_url,
        images_list: params.images_list,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: Number(params.duration) || 5,
        generate_audio: !!params.generate_audio,
        prompt: userPrompt ? `${internalPrompt} ${userPrompt}` : internalPrompt,
    };
    if (model.id === 'seedance-2-motion-control') {
        payload.duration = Math.min(15, Math.max(4, payload.duration));
        payload.quality = params.quality === 'basic' ? 'basic' : 'high';
        if (params.seed !== undefined && params.seed !== -1) payload.seed = Number(params.seed);
    } else {
        payload.duration = Math.min(30, Math.max(4, payload.duration));
        payload.high_bitrate = !!params.high_bitrate;
        if (params.seed !== undefined && params.seed !== -1) payload.seed = Number(params.seed);
    }
    return payload;
}

function sampleFor(name, input, force = false) {
    const value = defaultOf(input);
    if (value !== undefined && !(force && Array.isArray(value) && value.length === 0)) return value;
    if (Array.isArray(input?.examples) && input.examples.length) return input.examples[0];
    const type = String(input?.type || 'string');
    // The media kind comes from the studio's `field` hint, else the name.
    const media = ['image', 'video', 'audio'].includes(input?.field) ? input.field : '';
    const isKind = (kind) => media === kind || (!media && new RegExp(kind).test(name));
    if (type !== 'array' && (/url$/.test(name) || media)) {
        if (isKind('audio')) return AUD;
        if (isKind('video')) return VID;
        return IMG;
    }
    if (type === 'array') {
        if (isKind('audio')) return [AUD];
        if (isKind('video')) return [VID];
        if (isKind('image')) return [IMG];
        if (/lora/.test(name)) return [{ path: 'https://huggingface.co/sample/style-lora/resolve/main/lora.safetensors', scale: 1 }];
        return [];
    }
    if (type === 'boolean') return false;
    if (['int', 'integer', 'number', 'float'].includes(type)) return input.minValue ?? input.minimum ?? 1;
    if (name === 'prompt' || name === 'text' || name === 'lyrics') return PROMPT;
    return 'sample';
}

function audioPayload(model, overrides = {}) {
    const params = {};
    for (const [name, input] of Object.entries(model.inputs || {})) {
        const value = sampleFor(name, input);
        if (value !== undefined && value !== '') params[name] = value;
    }
    for (const field of model.required || []) {
        if (params[field] === undefined || (Array.isArray(params[field]) && params[field].length === 0) || params[field] === 'sample') {
            params[field] = sampleFor(field, { type: model.inputs?.[field]?.type });
            if (Array.isArray(params[field]) && params[field].length === 0) params[field] = [{ text: PROMPT, voice_id: 'Rachel', speaker_id: 'Speaker 1' }];
        }
    }
    Object.assign(params, overrides);
    const payload = {};
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) payload[key] = value;
    return payload;
}

const BUILDERS = {
    t2iModels: t2iPayload,
    i2iModels: i2iPayload,
    t2vModels: t2vPayload,
    i2vModels: i2vPayload,
    v2vModels: v2vPayload,
    lipsyncModels: lipsyncPayload,
    recastModels: recastPayload,
    motionControlModels: motionControlPayload,
    audioModels: audioPayload,
};

// Helper-tool requests the studios post directly (not from a model list).
const TOOL_REQUESTS = [
    ['seedvr2-image-upscale', { image_url: IMG, resolution: '4k' }],
    ['topaz-image-upscale', { image_url: IMG, upscale_factor: 2 }],
    ['ai-image-upscale', { image_url: IMG }],
    ['ai-background-remover', { image_url: IMG }],
    ['ai-image-extension', { image_url: IMG }],
    ['seedance-2-vip-omni-reference', { prompt: PROMPT, aspect_ratio: '16:9', duration: 5, images_list: [IMG], video_files: [] }],
    ['sd-2-vip-omni-reference-1080p', { prompt: PROMPT, aspect_ratio: '16:9', duration: 5, images_list: [IMG], video_files: [] }],
];

function variantInput(entry, endpoint) {
    const variant = (entry.variants || []).find((candidate) => candidate.fal === endpoint);
    return variant ? variant.input : entry.input;
}

function checkBuilt(entry, payload) {
    const { input, endpoint } = buildFalInput(entry, payload);
    const spec = variantInput(entry, endpoint);
    const allowed = new Set(spec.allowed);
    const extra = Object.keys(input).filter((key) => !allowed.has(key));
    assert.deepEqual(extra, [], `${entry.key}: fields outside the fal schema: ${extra.join(', ')}`);
    const missing = spec.required.filter((field) => input[field] === undefined);
    assert.deepEqual(missing, [], `${entry.key}: missing required: ${missing.join(', ')}`);
    return { input, endpoint };
}

function describeFailure(error) {
    return `${error.status || 'crash'} ${error.field ? `[${error.field}] ` : ''}${error.message}`;
}

// Build the payload the studio would post; when fal rejects it only because
// the user has not filled a field the studio itself asks for (a LoRA, an end
// frame), fill that field like a user would and try again.
function buildForModel(entry, list, model, overrides = {}) {
    let extra = { ...overrides };
    let media = {};
    for (let attempt = 0; attempt < 4; attempt++) {
        const payload = BUILDERS[list](model, extra, media);
        try {
            return { ...checkBuilt(entry, payload), payload };
        } catch (error) {
            if (error.status !== 400 || !/is required/.test(error.message)) throw Object.assign(error, { payload });
            const field = error.field;
            if (model.inputs?.[field] && extra[field] === undefined) {
                extra = { ...extra, [field]: sampleFor(field, model.inputs[field], true) };
                continue;
            }
            const capability = getModelMediaCapabilities(model).image;
            if (/last|end|tail/.test(field) && capability.maxItems >= 2 && !media.images) {
                media = { images: 2 };
                continue;
            }
            throw Object.assign(error, { payload });
        }
    }
    throw new Error('retry budget exhausted');
}

test('catalog.json is self-contained and scrubbed', () => {
    const text = JSON.stringify(catalog);
    assert.ok(!/muapi/i.test(text), 'catalog must not mention the legacy vendor');
    assert.ok(!/scratchpad|\/tmp\//.test(text), 'catalog must not reference scratch paths');
    assert.equal(catalog.entries.length, catalog.counts.entries);
    for (const entry of catalog.entries) {
        assert.equal(typeof entry.key, 'string');
        assert.ok(['image', 'video', 'audio', 'lipsync', 'tool'].includes(entry.kind), `${entry.key} kind`);
        if (entry.enabled) {
            assert.ok(entry.fal && entry.input && ['high', 'medium'].includes(entry.confidence), `${entry.key} enabled rule`);
            assert.ok(Array.isArray(entry.input.allowed) && entry.input.allowed.length > 0, `${entry.key} allowed`);
            assert.ok(entry.output, `${entry.key} output path`);
            for (const field of ['sync_mode', 'enable_safety_checker', 'safety_tolerance']) {
                if (!(field in (entry.input.fixed || {}))) assert.ok(!entry.input.allowed.includes(field), `${entry.key} must not let the browser set ${field}`);
            }
        } else {
            assert.ok(entry.reason, `${entry.key} disabled without a reason`);
        }
    }
});

test('catalog.json is reproducible from lib/gateway/catalog/sources', () => {
    const script = fileURLToPath(new URL('../../scripts/build-gateway-catalog.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    assert.match(output, /up to date/);
});

test('keys are unique and listAvailable() partitions the catalog', () => {
    const keys = catalog.entries.map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length);
    const { enabled, disabled } = listAvailable();
    assert.equal(enabled.length + disabled.length, keys.length);
    assert.equal(enabled.length, listEntries({ enabled: true }).length);
    assert.ok(enabled.every((key) => getEntry(key).enabled));
    assert.ok(disabled.every((key) => !getEntry(key).enabled));
    assert.equal(getEntry('definitely-not-a-model'), null);
    assert.equal(getEntry(undefined), null);
});

test('duplicate studio endpoints resolve to one entry that keeps every list membership', () => {
    for (const [key, lists] of [
        ['flux-pulid', ['t2iModels', 'i2iModels']],
        ['kling-v3.0-pro-motion-control', ['v2vModels', 'recastModels']],
        ['infinitetalk-video-to-video', ['v2vModels', 'lipsyncModels']],
        ['wan2.2-animate', ['v2vModels', 'recastModels']],
    ]) {
        const entry = getEntry(key);
        assert.ok(entry, key);
        for (const list of lists) assert.ok(entry.lists.includes(list), `${key} in ${list}`);
    }
    // Same list, two studio ids posting the same endpoint.
    assert.deepEqual([...getEntry("seedream-5.0").models].sort(), ['bytedance-seedream-v5.0', 'seedream-5.0']);
    // flux-redux: the image-to-image mapping (prompt + aspect ratio) wins.
    assert.equal(getEntry('flux-redux').list, 'i2iModels');
});

test('every studio model has a catalog entry, and every enabled one builds a valid fal input', () => {
    const failures = [];
    const summary = {};
    for (const list of LISTS) {
        summary[list] = { models: 0, enabled: 0, disabled: 0, built: 0 };
        for (const model of models[list]) {
            const key = model.endpoint || model.id;
            const entry = getEntry(key);
            summary[list].models += 1;
            if (!entry) { failures.push(`${list}/${model.id}: no catalog entry for ${key}`); continue; }
            if (!entry.lists.includes(list)) failures.push(`${list}/${model.id}: entry ${key} is missing list ${list}`);
            if (!entry.enabled) { summary[list].disabled += 1; continue; }
            summary[list].enabled += 1;
            if ((entry.unsupported_models || []).includes(model.id)) { summary[list].disabled += 1; summary[list].enabled -= 1; continue; }
            try {
                buildForModel(entry, list, model);
                summary[list].built += 1;
            } catch (error) {
                failures.push(`${list}/${model.id} (${key} → ${entry.fal}): ${describeFailure(error)} | payload ${JSON.stringify(error.payload || {}).slice(0, 300)}`);
            }
        }
    }
    console.log('catalog coverage (studio models):');
    for (const [list, counts] of Object.entries(summary)) {
        console.log(`  ${list.padEnd(20)} models ${String(counts.models).padStart(3)}  enabled ${String(counts.enabled).padStart(3)}  disabled ${String(counts.disabled).padStart(3)}  built ${String(counts.built).padStart(3)}`);
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

test('studio helper tools build valid fal inputs', () => {
    const failures = [];
    for (const [key, payload] of TOOL_REQUESTS) {
        const entry = getEntry(key);
        if (!entry) { failures.push(`${key}: missing`); continue; }
        if (!entry.enabled) { failures.push(`${key}: disabled (${entry.reason})`); continue; }
        try {
            checkBuilt(entry, payload);
        } catch (error) {
            failures.push(`${key}: ${describeFailure(error)}`);
        }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
    const layers = getEntry('bytedance-seedream-5.0-pro-layer');
    assert.ok(layers, 'layer decomposition has an entry');
    assert.equal(layers.enabled, false);
    assert.match(layers.reason, /schema/);
});

test('every selectable aspect ratio / resolution / duration / quality option builds', () => {
    const failures = [];
    let checked = 0;
    for (const list of ['t2iModels', 'i2iModels', 't2vModels', 'i2vModels', 'v2vModels', 'lipsyncModels']) {
        for (const model of models[list]) {
            const entry = getEntry(model.endpoint || model.id);
            if (!entry?.enabled || (entry.unsupported_models || []).includes(model.id)) continue;
            for (const field of ['aspect_ratio', 'resolution', 'duration', 'quality']) {
                for (const option of optionsOf(model.inputs?.[field])) {
                    checked += 1;
                    try {
                        buildForModel(entry, list, model, { [field]: option });
                    } catch (error) {
                        failures.push(`${list}/${model.id} ${field}=${option}: ${describeFailure(error)}`);
                    }
                }
            }
        }
    }
    console.log(`  option sweep: ${checked} option payloads checked, ${failures.length} rejected`);
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

test('estimateUsd follows the category defaults', () => {
    const t2i = getEntry('flux-schnell-image');
    assert.equal(estimateUsd(t2i, { prompt: 'x' }), 0.04);
    assert.equal(estimateUsd(t2i, { prompt: 'x', num_images: 3 }), 0.12);
    assert.equal(estimateUsd(t2i, { prompt: 'x', num_images: 99 }), 0.16, 'clamped to what fal accepts (max 4)');
    assert.equal(estimateUsd(t2i, {}), 0.04, 'an invalid payload still gets the default estimate');
    const noCount = getEntry('nano-banana-pro');
    assert.ok(noCount.input.allowed.includes('num_images') ? true : estimateUsd(noCount, { prompt: 'x', num_images: 4 }) === 0.04);
    const t2v = getEntry('kling-v2.1-master-t2v');
    assert.equal(estimateUsd(t2v, { prompt: 'x', duration: 5 }), 0.4);
    assert.equal(estimateUsd(t2v, { prompt: 'x', duration: '10' }), 0.8);
    const veo = getEntry('veo3.1-text-to-video');
    assert.equal(estimateUsd(veo, { prompt: 'x', duration: 30 }), 0.64, 'Veo clips are at most 8s');
    assert.equal(estimateUsd(veo, { duration: '8s' }), 0.64);
    const frames = getEntry('ltx-2.3-text-to-video');
    assert.equal(estimateUsd(frames, { prompt: 'x', duration: 5, aspect_ratio: '16:9', resolution: '720p' }), 0.4033, '121 frames at 24 fps → 5.04 s');
    const v2v = listEntries({ enabled: true, category: 'v2v' })[0];
    assert.equal(estimateUsd(v2v, { duration: 30 }), 0.5);
    const lipsync = listEntries({ enabled: true, category: 'lipsync' })[0];
    assert.equal(estimateUsd(lipsync, {}), 0.3);
    assert.equal(estimateUsd(getEntry('ai-background-remover'), {}), 0.02);
    assert.equal(estimateUsd(getEntry('minimax-music-3.0'), {}), 0.05);
    assert.equal(estimateUsd(null, {}), 0);
    for (const entry of listEntries({ enabled: true })) {
        const usd = estimateUsd(entry, {});
        assert.ok(Number.isFinite(usd) && usd > 0 && usd <= 5, `${entry.key} estimate ${usd}`);
        assert.equal(entry.est_usd, usd, `${entry.key} static est_usd matches the default estimate`);
    }
});
