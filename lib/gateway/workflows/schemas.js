// Node schemas for the workflow builder (GET /api/workflow/<id>/node-schemas),
// in the shape the builder reads:
//   {categories: {text|image|video|audio|utility: {models: {<model id>: {
//       name, group, input_schema: {schemas: {input_data: {properties, required}}}}}}},
//    features: {text, architect}}
//
// Media models are the enabled gateway catalog entries (the model id is the
// catalog key, i.e. what the node posts through runFal). Their fields use the
// studio's names (prompt, image_url, images_list, last_image, video_url,
// audio_url, …) — the names the builder's handles fill in and the catalog
// transforms into fal inputs. Titles, defaults and enums come from the studio
// model list (packages/studio/src/models.js); media fields the catalog needs
// are added when that list leaves them to the studio UI.
//
// Text nodes run on OpenRouter (three purpose models); utility nodes and the
// passthrough "Input" nodes run inside the executor. There is no `api`
// category: bring-your-own-key API nodes are not part of Aquora.

import { getCatalog } from '../catalogLoader.js';
import { isLlmConfigured } from '../config.js';
import { shared } from '../state.js';

// ── Built-in (non-catalog) models ───────────────────────────────────────────
export const PASSTHROUGH = Object.freeze({
    'text-passthrough': { category: 'text', field: 'prompt', type: 'text' },
    'image-passthrough': { category: 'image', field: 'image_url', type: 'image_url' },
    'video-passthrough': { category: 'video', field: 'video_url', type: 'video_url' },
    'audio-passthrough': { category: 'audio', field: 'audio_url', type: 'audio_url' },
});

// Text models → OpenRouter purpose (OPENROUTER_MODEL_FAST / _AGENT / _VISION).
export const TEXT_MODELS = Object.freeze({
    'llm-fast': { purpose: 'fast' },
    'llm-smart': { purpose: 'agent' },
    'llm-vision': { purpose: 'vision' },
});

export const UTILITY_MODELS = Object.freeze({
    'prompt-concatenator': { op: 'concat' },
    'video-combiner': { op: 'merge-videos', fal: 'fal-ai/ffmpeg-api/merge-videos' },
});

export const CATEGORIES = ['text', 'image', 'video', 'audio', 'utility'];

const COPY = {
    en: {
        inputText: 'Input Text',
        inputImage: 'Input Image',
        inputVideo: 'Input Video',
        inputAudio: 'Input Audio',
        llmFast: 'Text · Fast',
        llmSmart: 'Text · Smart',
        llmVision: 'Vision (describe images)',
        concat: 'Prompt Concatenator',
        combiner: 'Video Combiner',
        prompt: 'Prompt',
        promptHelp: 'What the model should write.',
        visionPromptHelp: 'What to do with the image(s), e.g. "Describe this image as a detailed prompt."',
        instructions: 'Instructions (optional)',
        instructionsHelp: 'Standing instructions for the model, such as tone or format.',
        image: 'Image',
        images: 'Images',
        video: 'Video',
        audio: 'Audio',
        lastFrame: 'Last frame',
        text: 'Text',
        textHelp: 'Text passed on to the next step.',
        imageHelp: 'Upload an image or paste a public link.',
        videoHelp: 'Upload a video or paste a public link.',
        audioHelp: 'Upload an audio file or paste a public link.',
        concatHelp: 'Joined text from the connected steps.',
        clips: 'Video clips',
        clipsHelp: 'Clips joined in order. The result uses the size of the first clip.',
    },
    zh: {
        inputText: '输入文本',
        inputImage: '输入图片',
        inputVideo: '输入视频',
        inputAudio: '输入音频',
        llmFast: '文本 · 快速',
        llmSmart: '文本 · 高质量',
        llmVision: '视觉（描述图片）',
        concat: '提示词拼接',
        combiner: '视频拼接',
        prompt: '提示词',
        promptHelp: '希望模型写出的内容。',
        visionPromptHelp: '要对图片做什么，例如“把这张图描述成详细的提示词”。',
        instructions: '指令（可选）',
        instructionsHelp: '给模型的固定指令，例如语气或格式。',
        image: '图片',
        images: '图片',
        video: '视频',
        audio: '音频',
        lastFrame: '尾帧',
        text: '文本',
        textHelp: '传给下一步的文本。',
        imageHelp: '上传图片或粘贴公开链接。',
        videoHelp: '上传视频或粘贴公开链接。',
        audioHelp: '上传音频或粘贴公开链接。',
        concatHelp: '已连接步骤的文本拼接结果。',
        clips: '视频片段',
        clipsHelp: '按顺序拼接片段，结果使用第一个片段的尺寸。',
    },
};

export function schemaCopy(locale) {
    return COPY[locale] || COPY.en;
}

function schema(properties, required = []) {
    return { schemas: { input_data: { properties, required: required.filter((key) => key in properties) } } };
}

function builtinModels(locale, { llm }) {
    const t = schemaCopy(locale);
    const text = {
        'text-passthrough': {
            name: t.inputText,
            group: 'input',
            input_schema: schema({ prompt: { type: 'string', title: t.text, name: 'prompt', description: t.textHelp } }, ['prompt']),
        },
    };
    if (llm) {
        const promptField = (help) => ({ type: 'string', title: t.prompt, name: 'prompt', description: help });
        const instructions = { type: 'string', title: t.instructions, name: 'system_prompt', description: t.instructionsHelp };
        text['llm-fast'] = { name: t.llmFast, group: 'text', input_schema: schema({ prompt: promptField(t.promptHelp), system_prompt: instructions }, ['prompt']) };
        text['llm-smart'] = { name: t.llmSmart, group: 'text', input_schema: schema({ prompt: promptField(t.promptHelp), system_prompt: instructions }, ['prompt']) };
        text['llm-vision'] = {
            name: t.llmVision,
            group: 'text',
            input_schema: schema({
                prompt: promptField(t.visionPromptHelp),
                image_url: { type: 'string', title: t.image, name: 'image_url', field: 'image', description: t.imageHelp },
                images_list: { type: 'array', title: t.images, name: 'images_list', field: 'images_list', items: { type: 'string' }, maxItems: 4 },
                system_prompt: instructions,
            }, ['prompt']),
        };
    }
    return {
        text,
        image: {
            'image-passthrough': {
                name: t.inputImage,
                group: 'input',
                input_schema: schema({ image_url: { type: 'string', title: t.image, name: 'image_url', field: 'image', description: t.imageHelp } }, ['image_url']),
            },
        },
        video: {
            'video-passthrough': {
                name: t.inputVideo,
                group: 'input',
                input_schema: schema({ video_url: { type: 'string', title: t.video, name: 'video_url', field: 'video', description: t.videoHelp } }, ['video_url']),
            },
        },
        audio: {
            'audio-passthrough': {
                name: t.inputAudio,
                group: 'input',
                input_schema: schema({ audio_url: { type: 'string', title: t.audio, name: 'audio_url', field: 'audio', description: t.audioHelp } }, ['audio_url']),
            },
        },
        utility: {
            'prompt-concatenator': {
                name: t.concat,
                group: 'utility',
                input_schema: schema({ prompt: { type: 'string', title: t.prompt, name: 'prompt', description: t.concatHelp } }, ['prompt']),
            },
            'video-combiner': {
                name: t.combiner,
                group: 'utility',
                input_schema: schema({
                    videos_list: { type: 'array', title: t.clips, name: 'videos_list', field: 'videos_list', items: { type: 'string' }, maxItems: 20, description: t.clipsHelp },
                }, ['videos_list']),
            },
        },
    };
}

// ── Catalog models ──────────────────────────────────────────────────────────
// Catalog category → builder node category.
const NODE_CATEGORY = { t2i: 'image', i2i: 'image', tool: 'image', t2v: 'video', i2v: 'video', v2v: 'video', lipsync: 'video', audio: 'audio' };
const GROUP = { t2i: 'generate', i2i: 'edit', tool: 'tools', t2v: 'generate', i2v: 'generate', v2v: 'edit', lipsync: 'lipsync', audio: 'generate' };
// Studio model lists to borrow field titles/defaults from, per catalog category.
const STUDIO_LISTS = {
    t2i: ['t2iModels'],
    i2i: ['i2iModels'],
    t2v: ['t2vModels'],
    i2v: ['i2vModels'],
    v2v: ['v2vModels', 'recastModels', 'motionControlModels'],
    lipsync: ['lipsyncModels'],
    audio: ['audioModels'],
    tool: [],
};

export function nodeCategoryFor(entry) {
    return NODE_CATEGORY[entry?.category] || null;
}

const PROP_KEYS = ['type', 'title', 'name', 'description', 'default', 'enum', 'examples', 'items', 'minValue', 'maxValue', 'step', 'minimum', 'maximum', 'field', 'maxItems', 'minItems', 'format'];
const URL_TEXT = /^\s*[a-z][a-z0-9+.-]*:\/\//i;

function isUrlish(value) {
    return typeof value === 'string' && URL_TEXT.test(value);
}

// Copies a studio input definition, keeping only display/validation keys and
// never an example or default that is a link (the builder pre-fills fields
// from them, and a stale link would be sent to the model).
function cleanProp(key, raw) {
    const prop = {};
    for (const name of PROP_KEYS) {
        if (raw?.[name] === undefined) continue;
        let value = raw[name];
        if (name === 'examples') {
            const list = (Array.isArray(value) ? value : [value]).filter((item) => typeof item !== 'string' || !isUrlish(item));
            if (!list.length || isMediaName(key)) continue;
            value = list.slice(0, 1).map((item) => (typeof item === 'string' ? item.slice(0, 2000) : item));
        }
        if (name === 'default' && (isUrlish(value) || (Array.isArray(value) && value.some(isUrlish)))) continue;
        if (name === 'enum' && Array.isArray(value)) value = [...value];
        if (name === 'items' && value && typeof value === 'object') value = { ...value };
        if (name === 'description' && typeof value === 'string') value = value.slice(0, 500);
        prop[name] = value;
    }
    prop.name = key;
    if (!prop.type) prop.type = 'string';
    return prop;
}

// Media inputs: link fields (…_url / …_urls) and the studio's list fields.
const MEDIA_NAME = /(_url|_urls)$|^(images_list|videos_list|audios_list|video_files|audio_files|last_image|reference_images|reference_videos|reference_audios)$/;
const NOT_MEDIA = /^(web_url|pdf_url|srt_url|srt_file_url|lora_url|file_url|webhook_url)$/;

function isMediaName(key) {
    return MEDIA_NAME.test(key) && !NOT_MEDIA.test(key);
}

function isListName(key) {
    return /(_list|_urls|_files)$/.test(key) || /^reference_(images|videos|audios)$/.test(key);
}

function mediaKind(key) {
    if (/audio/.test(key)) return 'audio';
    if (/video/.test(key)) return 'video';
    return 'image';
}

// The builder's upload widget for a media field: `field` is image | video |
// audio for one link, images_list | videos_list | audios_list for a list.
function mediaField(key) {
    const kind = mediaKind(key);
    return isListName(key) ? `${kind}s_list` : kind;
}

// Display definition for a media field the studio UI supplies itself.
function mediaProp(key, t, extra = {}) {
    const kind = mediaKind(key);
    const title = key === 'last_image' ? t.lastFrame : kind === 'audio' ? t.audio : kind === 'video' ? t.video : (isListName(key) ? t.images : t.image);
    return isListName(key)
        ? { type: 'array', title, name: key, field: mediaField(key), items: { type: 'string' }, ...extra }
        : { type: 'string', title, name: key, field: mediaField(key), ...extra };
}

// Studio-side name the catalog reads a fal field from.
function studioName(spec, falField) {
    for (const [source, target] of Object.entries(spec?.rename || {})) {
        if (target === falField) return source;
    }
    for (const step of spec?.transforms || []) {
        if (step.field === falField && typeof step.from === 'string') return step.from;
    }
    return falField;
}

function specsOf(entry) {
    return [entry.input, ...(entry.variants || []).map((variant) => variant.input)].filter(Boolean);
}

async function studioIndex() {
    return shared('workflowStudioModels', () => ({ promise: null })).promise ||= import('../../../packages/studio/src/models.js')
        .then((mod) => {
            const byList = {};
            for (const name of ['t2iModels', 't2vModels', 'i2iModels', 'i2vModels', 'v2vModels', 'lipsyncModels', 'recastModels', 'motionControlModels', 'audioModels']) {
                byList[name] = Array.isArray(mod[name]) ? mod[name] : [];
            }
            return byList;
        })
        .catch(() => ({}));
}

function findStudioModel(index, entry) {
    const lists = (STUDIO_LISTS[entry.category] || []).map((name) => index[name] || []);
    const ids = new Set([entry.key, ...(entry.models || [])]);
    for (const list of lists) {
        const hit = list.find((model) => model?.id === entry.key) || list.find((model) => ids.has(model?.id));
        if (hit) return hit;
    }
    for (const list of lists) {
        const hit = list.find((model) => model?.endpoint === entry.key);
        if (hit) return hit;
    }
    return null;
}

export function catalogModelSchema(entry, studioModel, t) {
    const properties = {};
    for (const [key, raw] of Object.entries(studioModel?.inputs || {})) {
        if (!key || key.startsWith('_')) continue;
        properties[key] = cleanProp(key, raw);
        const type = properties[key].type;
        if (isMediaName(key) && !properties[key].field && (type === 'string' || type === 'array')) properties[key].field = mediaField(key);
    }
    // Media fields the studio UI adds on its own (upload widgets).
    const media = [
        studioModel?.imageField,
        studioModel?.lastImageField,
        studioModel?.videoField,
        studioModel?.audioField,
        studioModel?.swapField,
    ].filter((key) => typeof key === 'string' && key);
    for (const key of media) {
        if (!properties[key]) {
            const extra = key === studioModel?.imageField && Number(studioModel?.maxImages) > 0 && /list|urls/.test(key) ? { maxItems: Number(studioModel.maxImages) } : {};
            properties[key] = mediaProp(key, t, extra);
        }
    }
    // Fields the catalog requires or accepts as media, named as the studio posts them.
    const required = new Set();
    for (const spec of specsOf(entry)) {
        for (const falField of spec.required || []) {
            const key = studioName(spec, falField);
            if (spec === entry.input) required.add(key);
            if (!properties[key]) {
                if (key === 'prompt') properties.prompt = { type: 'string', title: t.prompt, name: 'prompt' };
                else if (isMediaName(key)) properties[key] = mediaProp(key, t);
            }
        }
        for (const falField of spec.allowed || []) {
            const key = studioName(spec, falField);
            if (properties[key]) continue;
            if (key === 'prompt' && studioModel?.hasPrompt !== false) properties.prompt = { type: 'string', title: t.prompt, name: 'prompt' };
            else if (isMediaName(key) && spec === entry.input && !/mask/.test(key)) properties[key] = mediaProp(key, t);
        }
    }
    for (const key of studioModel?.required || []) required.add(key);
    // Prompt first, then media, then the rest (the properties panel order).
    const ordered = {};
    const keys = Object.keys(properties);
    for (const key of keys.filter((k) => k === 'prompt')) ordered[key] = properties[key];
    for (const key of keys.filter((k) => k !== 'prompt' && isMediaName(k))) ordered[key] = properties[key];
    for (const key of keys) if (!(key in ordered)) ordered[key] = properties[key];
    return {
        name: String(studioModel?.name || entry.name || entry.key),
        group: GROUP[entry.category] || 'generate',
        ...(studioModel?.description ? { description: String(studioModel.description).slice(0, 300) } : {}),
        input_schema: schema(ordered, [...required]),
    };
}

// Builds (and caches per locale / LLM availability) the full node-schema
// document from the catalog.
export async function nodeSchemas({ locale = 'en' } = {}) {
    const llm = isLlmConfigured();
    const catalog = await getCatalog();
    const cache = shared('workflowNodeSchemas', () => new Map());
    const cacheKey = `${locale}:${llm ? 1 : 0}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.catalog === catalog) return cached.value;

    const t = schemaCopy(locale);
    const categories = builtinModels(locale, { llm });
    const index = await studioIndex();
    const entries = typeof catalog.listEntries === 'function'
        ? catalog.listEntries({ enabled: true })
        : (catalog.listAvailable?.().enabled || []).map((key) => catalog.getEntry(key)).filter(Boolean);
    for (const entry of entries) {
        const category = nodeCategoryFor(entry);
        if (!category || !entry.enabled || !entry.fal) continue;
        if (categories[category][entry.key]) continue;
        categories[category][entry.key] = catalogModelSchema(entry, findStudioModel(index, entry), t);
    }
    const value = {
        categories: Object.fromEntries(CATEGORIES.map((name) => [name, { models: categories[name] }])),
        features: { text: llm, architect: llm },
    };
    cache.set(cacheKey, { catalog, value });
    return value;
}

// What a node's model is: {kind: 'passthrough'|'text'|'utility'|'catalog', …}
// or null when the model can't run here. Catalog models must be enabled and
// belong to the node's category.
export async function resolveNodeModel(category, model) {
    if (typeof model !== 'string' || !model || model.length > 128) return null;
    const pass = PASSTHROUGH[model];
    if (pass) return pass.category === category ? { kind: 'passthrough', ...pass } : null;
    if (TEXT_MODELS[model]) return category === 'text' ? { kind: 'text', ...TEXT_MODELS[model] } : null;
    if (UTILITY_MODELS[model]) return category === 'utility' ? { kind: 'utility', ...UTILITY_MODELS[model] } : null;
    if (!['image', 'video', 'audio'].includes(category)) return null;
    const catalog = await getCatalog();
    const entry = catalog.getEntry(model);
    if (!entry || !entry.enabled || !entry.fal) return null;
    const nodeCategory = nodeCategoryFor(entry) || entry.kind;
    if (nodeCategory !== category) return null;
    return { kind: 'catalog', key: model, category, entryCategory: entry.category };
}

// Property names of a model's schema (used to derive a node's run params).
export async function schemaPropertiesFor(category, model, { locale = 'en' } = {}) {
    const doc = await nodeSchemas({ locale });
    return doc.categories?.[category]?.models?.[model]?.input_schema?.schemas?.input_data?.properties || null;
}

export function resetSchemaCache() {
    shared('workflowNodeSchemas', () => new Map()).clear();
}
