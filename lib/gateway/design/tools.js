// The design agent's tools (OpenRouter function calling). Media tools run
// through the catalog on fal.ai (runFal: the workspace budget, URL checks
// and output normalisation apply exactly as in the studios); arrange_canvas
// only moves nodes on the user's canvas and costs nothing.
//
// The model never sees or passes URLs: it names files by their asset label
// (asset_1, asset_2, …) and the label is resolved server-side against the
// session's asset registry, so it cannot point fal at an arbitrary link.

import { GatewayError, toGatewayError } from '../errors.js';
import { runFal } from '../generation.js';
import { assetLabel } from './validate.js';

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
const MAX_REFERENCES = 3;

// Catalog keys in order of preference; the first enabled one is used.
export const DESIGN_MODELS = {
    image: ['nano-banana-2', 'flux-schnell-image', 'nano-banana-pro'],
    edit: ['nano-banana-2-edit', 'nano-banana-pro-edit', 'flux-kontext-pro-i2i'],
    textToVideo: ['seedance-lite-t2v', 'kling-v2.5-turbo-pro-t2v', 'seedance-pro-t2v-fast'],
    imageToVideo: ['seedance-lite-i2v', 'kling-v2.1-standard-i2v', 'seedance-pro-i2v-fast'],
    upscale: ['seedvr2-image-upscale', 'ai-image-upscale'],
};

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

function requirePrompt(args) {
    const value = text(args?.prompt, MAX_PROMPT);
    if (!value) throw new ToolInputError('prompt is required.');
    return value;
}

function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function pickKey(catalog, keys) {
    for (const key of keys) {
        const entry = catalog.getEntry(key);
        if (entry?.enabled && entry.fal) return { key, entry };
    }
    throw new GatewayError(503, 'model_disabled', 'This kind of generation is not available on Aquora right now.');
}

function describeAvailable(assets, kind) {
    const list = [...assets.values()].filter((asset) => !kind || asset.kind === kind).slice(-12).map((asset) => asset.asset_label);
    return list.length ? `Available ${kind || 'asset'}s: ${list.join(', ')}.` : `There are no ${kind || 'asset'}s on this canvas yet.`;
}

// Resolves an asset label the model passed → the registered asset.
function requireAsset(value, env, kind, field = 'image') {
    const label = assetLabel(value);
    if (!label) throw new ToolInputError(`${field} must be an asset label such as "asset_1". ${describeAvailable(env.assets, kind)}`);
    const asset = env.assets.get(label);
    if (!asset) throw new ToolInputError(`${label} does not exist. ${describeAvailable(env.assets, kind)}`);
    if (kind && asset.kind !== kind) throw new ToolInputError(`${label} is a ${asset.kind}, not an ${kind}. ${describeAvailable(env.assets, kind)}`);
    return asset;
}

function mediaFrom(result, kind) {
    const urls = [];
    if (kind === 'image') {
        for (const image of Array.isArray(result?.images) ? result.images : []) {
            const url = typeof image === 'string' ? image : image?.url;
            if (url) urls.push(url);
        }
    }
    if (kind === 'video' && result?.video?.url) urls.push(result.video.url);
    if (!urls.length) for (const url of Array.isArray(result?.outputs) ? result.outputs : []) if (typeof url === 'string') urls.push(url);
    return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))].map((url) => ({ kind, url }));
}

// ── canvas layout (arrange_canvas) ──────────────────────────────────────────
const GAP = 32;

// → [{asset_id, x, y}] for the nodes to arrange, laid out from the top-left
// of their current bounding box.
export function layoutNodes(nodes, { layout = 'grid', gap = GAP } = {}) {
    if (!nodes.length) return [];
    const originX = Math.min(...nodes.map((n) => n.x));
    const originY = Math.min(...nodes.map((n) => n.y));
    const moves = [];
    if (layout === 'row') {
        let x = originX;
        for (const node of nodes) {
            moves.push({ asset_id: node.asset_id, x, y: originY });
            x += node.w + gap;
        }
        return moves;
    }
    if (layout === 'column') {
        let y = originY;
        for (const node of nodes) {
            moves.push({ asset_id: node.asset_id, x: originX, y });
            y += node.h + gap;
        }
        return moves;
    }
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const cellW = Math.max(...nodes.map((n) => n.w));
    const rows = [];
    nodes.forEach((node, index) => {
        const row = Math.floor(index / columns);
        (rows[row] ||= []).push(node);
    });
    let y = originY;
    rows.forEach((row) => {
        row.forEach((node, col) => moves.push({ asset_id: node.asset_id, x: originX + col * (cellW + gap), y }));
        y += Math.max(...row.map((n) => n.h)) + gap;
    });
    return moves;
}

// ── tool definitions ────────────────────────────────────────────────────────
// run(args, env) → {outputs:[{kind,url}], model, prompt, source?} or
// {canvasOp} for arrange_canvas. env = {catalog, assets: Map<label, asset>,
// canvas, call(key, input)}.
const TOOLS = [
    {
        name: 'generate_image',
        video: false,
        tool: {
            description: 'Create one new image from a detailed description. Call it once per image you want on the canvas.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Detailed visual description: subject, setting, style, lighting, composition, and any short text that must appear (in quotes).' },
                    aspect_ratio: { type: 'string', enum: IMAGE_ASPECTS, description: 'Shape of the image. 1:1 feed, 4:5 portrait post, 9:16 story/reel, 16:9 thumbnail/banner.' },
                },
                required: ['prompt'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const prompt = requirePrompt(args);
            const aspect = oneOf(args?.aspect_ratio, IMAGE_ASPECTS, '1:1');
            const { key, entry } = pickKey(env.catalog, DESIGN_MODELS.image);
            const input = key === 'flux-schnell-image'
                ? { prompt, image_size: FLUX_SIZES[aspect], num_images: 1 }
                : { prompt, aspect_ratio: aspect, num_images: 1 };
            const result = await env.call(key, input);
            return { outputs: mediaFrom(result, 'image').slice(0, 1), model: entry.name || key, prompt };
        },
    },
    {
        name: 'edit_image',
        video: false,
        tool: {
            description: 'Change an existing image on the canvas following an instruction (background, style, text, objects). Optional reference images are combined into the result.',
            parameters: {
                type: 'object',
                properties: {
                    image: { type: 'string', description: 'Asset label of the image to edit, e.g. "asset_2".' },
                    prompt: { type: 'string', description: 'The change, as an instruction ("replace the background with a sunset beach, keep the product unchanged").' },
                    reference_images: { type: 'array', items: { type: 'string' }, maxItems: MAX_REFERENCES, description: 'Optional asset labels of up to 3 more images to use (a logo, a product, a style reference).' },
                    aspect_ratio: { type: 'string', enum: ['auto', ...IMAGE_ASPECTS], description: '"auto" keeps the shape of the source image.' },
                },
                required: ['image', 'prompt'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const source = requireAsset(args?.image, env, 'image');
            const prompt = requirePrompt(args);
            const refs = (Array.isArray(args?.reference_images) ? args.reference_images : [])
                .slice(0, MAX_REFERENCES)
                .map((value) => requireAsset(value, env, 'image', 'reference_images'))
                .filter((asset) => asset.asset_label !== source.asset_label);
            const urls = [...new Set([source.url, ...refs.map((asset) => asset.url)])];
            const aspect = oneOf(args?.aspect_ratio, ['auto', ...IMAGE_ASPECTS], 'auto');
            const { key, entry } = pickKey(env.catalog, DESIGN_MODELS.edit);
            const input = key === 'flux-kontext-pro-i2i'
                ? { prompt, images_list: [urls[0]], ...(aspect !== 'auto' ? { aspect_ratio: aspect } : {}) }
                : { prompt, image_urls: urls, aspect_ratio: aspect, num_images: 1 };
            const result = await env.call(key, input);
            return { outputs: mediaFrom(result, 'image').slice(0, 1), model: entry.name || key, prompt, source: source.asset_label };
        },
    },
    {
        name: 'generate_video',
        video: true,
        tool: {
            description: 'Create a short video clip (5 or 10 seconds) from a description alone. To animate an existing image use image_to_video instead.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'The shot: subject, action, camera movement, mood and style.' },
                    aspect_ratio: { type: 'string', enum: VIDEO_ASPECTS, description: '9:16 for Reels/TikTok/Shorts, 16:9 for YouTube, 1:1 for feed.' },
                    duration: { type: 'string', enum: ['5', '10'], description: 'Length in seconds. Prefer 5.' },
                },
                required: ['prompt'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const prompt = requirePrompt(args);
            const aspect = oneOf(args?.aspect_ratio, VIDEO_ASPECTS, '16:9');
            const duration = oneOf(String(args?.duration ?? '5'), ['5', '10'], '5');
            const { key, entry } = pickKey(env.catalog, DESIGN_MODELS.textToVideo);
            const input = key.startsWith('kling')
                ? { prompt, aspect_ratio: aspect, duration }
                : { prompt, duration, resolution: '720p', aspect_ratio: aspect };
            const result = await env.call(key, input);
            return { outputs: mediaFrom(result, 'video').slice(0, 1), model: entry.name || key, prompt };
        },
    },
    {
        name: 'image_to_video',
        video: true,
        tool: {
            description: 'Animate an existing image on the canvas into a short video clip that starts from that image.',
            parameters: {
                type: 'object',
                properties: {
                    image: { type: 'string', description: 'Asset label of the image to animate, e.g. "asset_1".' },
                    prompt: { type: 'string', description: 'The motion: what moves, camera movement, mood.' },
                    duration: { type: 'string', enum: ['5', '10'], description: 'Length in seconds. Prefer 5.' },
                },
                required: ['image', 'prompt'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const source = requireAsset(args?.image, env, 'image');
            const prompt = requirePrompt(args);
            const duration = oneOf(String(args?.duration ?? '5'), ['5', '10'], '5');
            const { key, entry } = pickKey(env.catalog, DESIGN_MODELS.imageToVideo);
            const input = key.startsWith('kling')
                ? { prompt, image_url: source.url, duration }
                : { prompt, image_url: source.url, duration, resolution: '720p', aspect_ratio: 'auto' };
            const result = await env.call(key, input);
            return { outputs: mediaFrom(result, 'video').slice(0, 1), model: entry.name || key, prompt, source: source.asset_label };
        },
    },
    {
        name: 'enhance_image',
        video: false,
        tool: {
            description: 'Upscale an image on the canvas to a sharper, higher-resolution version (no creative changes).',
            parameters: {
                type: 'object',
                properties: {
                    image: { type: 'string', description: 'Asset label of the image to upscale.' },
                },
                required: ['image'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const source = requireAsset(args?.image, env, 'image');
            const { key, entry } = pickKey(env.catalog, DESIGN_MODELS.upscale);
            const result = await env.call(key, { image_url: source.url });
            return { outputs: mediaFrom(result, 'image').slice(0, 1), model: entry.name || key, prompt: null, source: source.asset_label };
        },
    },
    {
        name: 'arrange_canvas',
        video: false,
        free: true,
        tool: {
            description: 'Tidy the canvas: lay out assets in a grid, a row or a column. Free; use it after creating a set of related assets.',
            parameters: {
                type: 'object',
                properties: {
                    layout: { type: 'string', enum: ['grid', 'row', 'column'] },
                    asset_ids: { type: 'array', items: { type: 'string' }, description: 'Asset labels to arrange, in order. Omit to arrange everything on the canvas.' },
                },
                required: ['layout'],
                additionalProperties: false,
            },
        },
        async run(args, env) {
            const layout = oneOf(args?.layout, ['grid', 'row', 'column'], 'grid');
            const onCanvas = new Map((env.canvas?.nodes || []).map((node) => [node.asset_id, node]));
            const wanted = Array.isArray(args?.asset_ids) && args.asset_ids.length
                ? args.asset_ids.map(assetLabel).filter(Boolean)
                : [...onCanvas.keys(), ...[...env.assets.keys()].filter((label) => !onCanvas.has(label))];
            const nodes = [];
            for (const label of [...new Set(wanted)]) {
                // Files made during this run are not in the snapshot yet; the
                // canvas shows new files at most 400px on their long side.
                const node = onCanvas.get(label) || (env.assets.has(label) ? { asset_id: label, x: 0, y: 0, w: 400, h: 400 } : null);
                if (node) nodes.push(node);
            }
            if (!nodes.length) throw new ToolInputError('There is nothing on the canvas to arrange yet.');
            const moves = layoutNodes(nodes, { layout });
            // Later tools see the new positions.
            for (const move of moves) {
                const node = onCanvas.get(move.asset_id);
                if (node) Object.assign(node, { x: move.x, y: move.y });
            }
            // The canvas lays the nodes out with their real sizes ('layout');
            // `moves` is the server's estimate for canvases that can't.
            return {
                outputs: [],
                canvasOp: { op: 'layout', args: { layout, asset_ids: nodes.map((node) => node.asset_id), moves } },
                arranged: moves.length,
            };
        },
    },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export const DESIGN_TOOL_NAMES = TOOLS.map((tool) => tool.name);

export function designTools() {
    return TOOLS.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.tool.description, parameters: tool.tool.parameters } }));
}

export function getDesignTool(name) {
    return BY_NAME.get(name) || null;
}

export function parseToolArguments(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        throw new ToolInputError('The tool arguments were not valid JSON.');
    }
}

// Arguments as shown on the canvas (tool_call events): labels and short
// text only, never URLs.
export function displayArgs(args) {
    const out = {};
    for (const [key, value] of Object.entries(args || {})) {
        if (key === 'image' || key === 'video' || key === 'audio') {
            const label = assetLabel(value);
            if (label) out[key] = label;
        } else if (key === 'reference_images' || key === 'asset_ids') {
            const labels = (Array.isArray(value) ? value : []).map(assetLabel).filter(Boolean).slice(0, 12);
            if (labels.length) out[key] = labels;
        } else if (typeof value === 'string') {
            out[key] = value.slice(0, 300);
        }
    }
    return out;
}

// Errors a model cannot fix by retrying: they end the run.
const FATAL = new Set(['budget_exceeded', 'not_configured', 'setup_required', 'cancelled', 'timeout']);

// Runs one tool call.
//   env = {session:{sid,cid}, signal, catalog, assets:Map, canvas}
// → {ok:true, tool, outputs, model, prompt, source, canvasOp} | {ok:false, tool, error}
export async function runDesignTool(call, env) {
    const name = call?.function?.name;
    const tool = typeof name === 'string' ? BY_NAME.get(name) : null;
    if (!tool) return { ok: false, tool: null, error: `There is no tool called "${String(name || '').slice(0, 40)}".` };
    try {
        const args = parseToolArguments(call.function.arguments);
        const invoke = (key, input) => runFal({ key, input, session: env.session, signal: env.signal });
        const outcome = await tool.run(args, { catalog: env.catalog, assets: env.assets, canvas: env.canvas, call: invoke });
        if (!tool.free && !outcome.outputs.length) return { ok: false, tool, error: "The model finished but didn't return a file." };
        return { ok: true, tool, ...outcome };
    } catch (error) {
        if (env.signal?.aborted) throw env.signal.reason || error;
        if (error instanceof ToolInputError) return { ok: false, tool, error: error.message };
        const err = toGatewayError(error);
        if (FATAL.has(err.code)) throw err;
        return { ok: false, tool, error: err.message, code: err.code };
    }
}
