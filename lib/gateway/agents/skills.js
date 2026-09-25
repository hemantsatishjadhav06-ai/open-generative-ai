// Agent skills = the OpenRouter function tools an agent may call. Each skill
// generates media through the catalog (runFal → fal.ai), so the workspace
// budget, URL checks and output normalisation all apply exactly as in the
// studios. The browser only ever toggles skill ids; tool arguments come from
// the model and are validated here before anything is submitted.

import { getCatalog } from '../catalogLoader.js';
import { GatewayError, toGatewayError } from '../errors.js';
import { runFal } from '../generation.js';

const IMAGE_ASPECTS = ['1:1', '16:9', '9:16', '4:5', '4:3', '3:4'];
const VIDEO_ASPECTS = ['16:9', '9:16', '1:1'];
const FLUX_SIZES = {
    '1:1': 'square_hd',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:5': 'portrait_4_3',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3',
};
const MAX_PROMPT = 2_000;
const MAX_SPOKEN_TEXT = 2_500;

// Catalog keys in order of preference; the first enabled one is used, so a
// model disabled in the catalog falls back instead of breaking the skill.
const MODELS = {
    image: ['nano-banana-2', 'flux-schnell-image', 'nano-banana-pro'],
    edit: ['nano-banana-2-edit', 'nano-banana-pro-edit', 'flux-kontext-pro-i2i'],
    textToVideo: ['seedance-lite-t2v', 'kling-v2.5-turbo-pro-t2v', 'seedance-pro-t2v-fast'],
    imageToVideo: ['seedance-lite-i2v', 'kling-v2.1-standard-i2v', 'seedance-pro-i2v-fast'],
    voiceover: ['elevenlabs-tts-turbo-2-5', 'minimax-speech-2.6-turbo'],
    music: ['minimax-music-3.0'],
};
// Sound effects run on a fixed endpoint (its catalog key contains a '/').
const SOUND_EFFECT = { key: 'mmaudio-v2/text-to-audio', endpoint: 'fal-ai/mmaudio-v2/text-to-audio', usd: 0.05 };

export class ToolInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolInputError';
    }
}

function text(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

function requirePrompt(args, field = 'prompt', max = MAX_PROMPT) {
    const value = text(args?.[field], max);
    if (!value) throw new ToolInputError(`${field} is required.`);
    return value;
}

function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

// Media URLs the model passes must already be part of this conversation
// (an attachment or something the agent generated) — the model cannot point
// fal at arbitrary links pulled from a prompt.
function knownUrl(value, known) {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url) return '';
    if (!known.has(url)) throw new ToolInputError('Use the exact link of an image the user attached or one you generated earlier in this chat.');
    return url;
}

function pickKey(catalog, keys) {
    for (const key of keys) {
        const entry = catalog.getEntry(key);
        if (entry?.enabled && entry.fal) return { key, entry };
    }
    throw new GatewayError(503, 'model_disabled', 'This kind of generation is not available on Aquora right now.');
}

function mediaFrom(result, type) {
    const urls = [];
    if (type === 'image') {
        for (const image of Array.isArray(result?.images) ? result.images : []) {
            const url = typeof image === 'string' ? image : image?.url;
            if (url) urls.push(url);
        }
    }
    if (type === 'video' && result?.video?.url) urls.push(result.video.url);
    if (type === 'audio' && result?.audio?.url) urls.push(result.audio.url);
    if (!urls.length) for (const url of Array.isArray(result?.outputs) ? result.outputs : []) if (typeof url === 'string') urls.push(url);
    return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))].map((url) => ({ type, url }));
}

// ── Skill definitions ───────────────────────────────────────────────────────
// run(args, env) → {type, model, media:[{type,url}]}; env = {catalog, known,
// call(catalogKey | {endpoint}, input, extra)}.
const SKILLS = [
    {
        id: 'generate_image',
        name: 'Image generation',
        description: 'Creates images from a description: thumbnails, product shots, social posts, concept art.',
        pulse: 'Generating an image…',
        done: 'Generated an image',
        tool: {
            description: 'Create one image from a detailed description. Use it whenever the user wants a picture, thumbnail, product shot, poster or social post visual.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Detailed visual description: subject, setting, style, lighting, composition, and any short text that must appear in the image (in quotes).' },
                    aspect_ratio: { type: 'string', enum: IMAGE_ASPECTS, description: '16:9 for YouTube thumbnails, 9:16 for Reels/TikTok/Stories, 1:1 or 4:5 for feed posts.' },
                },
                required: ['prompt'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const prompt = requirePrompt(args);
            const aspect = oneOf(args?.aspect_ratio, IMAGE_ASPECTS, '1:1');
            const { key, entry } = pickKey(env.catalog, MODELS.image);
            const input = key === 'flux-schnell-image'
                ? { prompt, image_size: FLUX_SIZES[aspect], num_images: 1 }
                : { prompt, aspect_ratio: aspect, num_images: 1 };
            const result = await env.call(key, input);
            return { type: 'image', model: entry.name || key, media: mediaFrom(result, 'image') };
        },
    },
    {
        id: 'edit_image',
        name: 'Image editing',
        description: 'Edits an attached or generated image: change the background, add text, restyle, combine products.',
        pulse: 'Editing the image…',
        done: 'Edited the image',
        tool: {
            description: 'Edit one or more existing images (attached by the user or generated earlier in this chat) following an instruction.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'What to change, stated as an instruction ("replace the background with a sunset beach, keep the product unchanged").' },
                    image_urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'Exact links of the images to edit, copied from the conversation.' },
                    aspect_ratio: { type: 'string', enum: ['auto', ...IMAGE_ASPECTS], description: 'Output shape; "auto" keeps the input shape.' },
                },
                required: ['prompt', 'image_urls'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const prompt = requirePrompt(args);
            const list = Array.isArray(args?.image_urls) ? args.image_urls : [args?.image_urls].filter(Boolean);
            const urls = [...new Set(list.slice(0, 4).map((url) => knownUrl(url, env.known)).filter(Boolean))];
            if (!urls.length) throw new ToolInputError('image_urls needs at least one image from this chat.');
            const aspect = oneOf(args?.aspect_ratio, ['auto', ...IMAGE_ASPECTS], 'auto');
            const { key, entry } = pickKey(env.catalog, MODELS.edit);
            const input = key === 'flux-kontext-pro-i2i'
                ? { prompt, images_list: urls, ...(aspect !== 'auto' ? { aspect_ratio: aspect } : {}) }
                : { prompt, image_urls: urls, aspect_ratio: aspect, num_images: 1 };
            const result = await env.call(key, input);
            return { type: 'image', model: entry.name || key, media: mediaFrom(result, 'image') };
        },
    },
    {
        id: 'generate_video',
        name: 'Video generation',
        description: 'Makes 5–10 second video clips from a description, or animates an attached or generated image.',
        pulse: 'Generating a video (this can take a minute or two)…',
        done: 'Generated a video',
        video: true,
        tool: {
            description: 'Create a short video clip (5 or 10 seconds). Pass image_url to animate an existing image from this chat; otherwise the clip is made from the prompt alone.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'The shot: subject, action, camera movement, mood and style.' },
                    image_url: { type: 'string', description: 'Optional. Exact link of an image from this chat to use as the first frame.' },
                    aspect_ratio: { type: 'string', enum: VIDEO_ASPECTS, description: '9:16 for Reels/TikTok/Shorts, 16:9 for YouTube, 1:1 for feed.' },
                    duration: { type: 'string', enum: ['5', '10'], description: 'Length in seconds. Prefer 5 unless the user asks for longer.' },
                },
                required: ['prompt'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const prompt = requirePrompt(args);
            const imageUrl = knownUrl(args?.image_url, env.known);
            const aspect = oneOf(args?.aspect_ratio, VIDEO_ASPECTS, '9:16');
            const duration = oneOf(String(args?.duration ?? '5'), ['5', '10'], '5');
            const { key, entry } = pickKey(env.catalog, imageUrl ? MODELS.imageToVideo : MODELS.textToVideo);
            let input;
            if (key.startsWith('kling')) {
                input = imageUrl ? { prompt, image_url: imageUrl, duration } : { prompt, aspect_ratio: aspect, duration };
            } else {
                input = { prompt, duration, resolution: '720p', aspect_ratio: imageUrl ? 'auto' : aspect, ...(imageUrl ? { image_url: imageUrl } : {}) };
            }
            const result = await env.call(key, input);
            return { type: 'video', model: entry.name || key, media: mediaFrom(result, 'video') };
        },
    },
    {
        id: 'generate_audio',
        name: 'Voiceover & music',
        description: 'Records voiceovers from a script, composes short music tracks and creates sound effects.',
        pulse: 'Creating audio…',
        done: 'Created audio',
        tool: {
            description: 'Create audio: a spoken voiceover of a script, a music track, or a sound effect.',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['voiceover', 'music', 'sound_effect'], description: 'voiceover = read `text` aloud; music = compose a track in the style described by `text`; sound_effect = the sound described by `text`.' },
                    text: { type: 'string', description: 'The exact script for a voiceover, or a description of the music style / sound.' },
                    lyrics: { type: 'string', description: 'Music only, optional: song lyrics. Leave empty for an instrumental.' },
                    duration_seconds: { type: 'integer', minimum: 1, maximum: 60, description: 'Music and sound effects only: approximate length.' },
                },
                required: ['type', 'text'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const kind = oneOf(args?.type, ['voiceover', 'music', 'sound_effect'], 'voiceover');
            const seconds = Math.max(1, Math.min(60, Math.round(Number(args?.duration_seconds) || 0)));
            if (kind === 'voiceover') {
                const script = requirePrompt(args, 'text', MAX_SPOKEN_TEXT);
                const { key, entry } = pickKey(env.catalog, MODELS.voiceover);
                const input = key.startsWith('elevenlabs') ? { text: script } : { prompt: script };
                return { type: 'audio', model: entry.name || key, media: mediaFrom(await env.call(key, input), 'audio') };
            }
            if (kind === 'music') {
                const style = requirePrompt(args, 'text');
                const lyrics = text(args?.lyrics, 3_000) || '[instrumental]';
                const { key, entry } = pickKey(env.catalog, MODELS.music);
                const input = { prompt: style, lyrics, duration: args?.duration_seconds ? seconds : 30 };
                return { type: 'audio', model: entry.name || key, media: mediaFrom(await env.call(key, input), 'audio') };
            }
            const description = requirePrompt(args, 'text');
            const entry = env.catalog.getEntry(SOUND_EFFECT.key);
            if (!entry?.enabled) throw new GatewayError(503, 'model_disabled', 'Sound effects are not available on Aquora right now.');
            const input = { prompt: description, duration: Math.min(30, args?.duration_seconds ? seconds : 8) };
            const result = await env.call({ endpoint: SOUND_EFFECT.endpoint }, input, { estUsd: SOUND_EFFECT.usd });
            return { type: 'audio', model: entry.name || 'MMAudio', media: mediaFrom(result, 'audio') };
        },
    },
];

const BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

export const SKILL_IDS = SKILLS.map((skill) => skill.id);

// Public registry for GET /api/agents/skills.
export function listSkills() {
    return SKILLS.map(({ id, name, description }) => ({ id, name, description }));
}

export function getSkill(id) {
    return BY_ID.get(id) || null;
}

// Known ids only, de-duplicated, registry order.
export function normalizeSkillIds(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
    return SKILL_IDS.filter((id) => wanted.has(id));
}

export function expandSkills(ids) {
    return normalizeSkillIds(ids).map((id) => {
        const { name, description } = BY_ID.get(id);
        return { id, name, description };
    });
}

// OpenRouter `tools` for an agent's skills (empty when it has none).
export function toolsForSkills(ids) {
    return normalizeSkillIds(ids).map((id) => {
        const skill = BY_ID.get(id);
        return { type: 'function', function: { name: skill.id, description: skill.tool.description, parameters: skill.tool.parameters } };
    });
}

function parseArguments(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        throw new ToolInputError('The tool arguments were not valid JSON.');
    }
}

// Runs one tool call for a turn.
//   call     OpenRouter tool call {id, function:{name, arguments}}
//   env      {session:{sid,cid}, signal, known:Set<url>, allowed:Set<skill id>, catalog?}
// → {ok:true, type, model, media} | {ok:false, error}. Cancellation propagates.
export async function runToolCall(call, env) {
    const name = call?.function?.name;
    const skill = typeof name === 'string' && env.allowed.has(name) ? BY_ID.get(name) : null;
    if (!skill) return { ok: false, error: `The tool "${String(name || '').slice(0, 40)}" is not enabled for this agent.` };
    try {
        const args = parseArguments(call.function.arguments);
        const catalog = env.catalog || await getCatalog();
        // A string is a catalog key; server constants pass {endpoint}.
        const invoke = (target, input, extra = {}) => runFal({
            ...(typeof target === 'string' ? { key: target } : { endpoint: target.endpoint }),
            input,
            session: env.session,
            signal: env.signal,
            ...extra,
        });
        const outcome = await skill.run(args, { catalog, known: env.known, call: invoke });
        if (!outcome.media.length) return { ok: false, error: "The model finished but didn't return a file." };
        return { ok: true, ...outcome };
    } catch (error) {
        if (env.signal?.aborted) throw env.signal.reason || error;
        if (error instanceof ToolInputError) return { ok: false, error: error.message };
        const err = toGatewayError(error);
        if (err.code === 'cancelled') throw err;
        return { ok: false, error: err.message, code: err.code };
    }
}
