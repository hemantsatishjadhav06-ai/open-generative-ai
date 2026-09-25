// Internal pipeline `catalog-steps`: catalog entries that need server-side
// fal steps around the main model (see `steps` in lib/gateway/catalog):
//
//   before: last_frame   → fal-ai/ffmpeg-api/extract-frame (frame_type 'last')
//                          of the source clip, prepended to the payload list
//                          named by `into` (Seedance 2.0 extend: @image1)
//   main:   the catalog entry itself (same allowlist, pricing and budget)
//   after:  merge_source → fal-ai/ffmpeg-api/merge-videos [source, new clip]
//           upscale      → fal-ai/seedvr/upscale/video to a target resolution
//
// Started only by generation.submitCatalogJob (options.internal), with the
// source clip already resolved from a job token of the same session.

import { getCatalog } from '../catalogLoader.js';
import { GatewayError } from '../errors.js';
import { buildInput } from '../generation.js';
import { CATEGORY_DEFAULT_USD, estimateUsd as estimateCatalogUsd, requestedSeconds } from '../pricing.js';
import { register } from './index.js';

export const STEP_ENDPOINTS = Object.freeze({
    last_frame: 'fal-ai/ffmpeg-api/extract-frame',
    merge_source: 'fal-ai/ffmpeg-api/merge-videos',
    upscale: 'fal-ai/seedvr/upscale/video',
});
const TARGETS = new Set(['720p', '1080p', '1440p', '2160p']);
// Placeholder used only to validate the payload shape before the real frame exists.
const FRAME_PLACEHOLDER = 'https://frame.invalid/last-frame.png';

function stepUsd(step, payload) {
    if (step.op === 'last_frame') return 0.01;
    if (step.op === 'merge_source') return 0.02;
    if (step.op === 'upscale') return Math.round(CATEGORY_DEFAULT_USD.video * (requestedSeconds(payload, 5) / 5) * 10_000) / 10_000;
    return CATEGORY_DEFAULT_USD.tool;
}

function urlOf(result) {
    const url = result?.video?.url || result?.images?.[0]?.url || result?.url || (Array.isArray(result?.outputs) ? result.outputs[0] : null);
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new GatewayError(502, 'upstream_error', "A step of this generation didn't return a file. Try again.");
    }
    return url;
}

async function entryFor(key) {
    const catalog = await getCatalog();
    const entry = typeof key === 'string' ? catalog.getEntry(key) : null;
    if (!entry || !entry.enabled || !entry.fal || typeof catalog.stepsOf !== 'function') {
        throw new GatewayError(404, 'unknown_model', "This model isn't available.");
    }
    const steps = catalog.stepsOf(entry);
    for (const step of [...steps.before, ...steps.after]) {
        if (!STEP_ENDPOINTS[step?.op]) throw new GatewayError(500, 'internal_error', 'This model is misconfigured.');
    }
    return { catalog, entry, steps };
}

export async function validate(input) {
    const key = input?.key;
    const payload = input?.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
    const sourceUrl = typeof input?.source_url === 'string' && /^https?:\/\//i.test(input.source_url) ? input.source_url : null;
    const { catalog, entry, steps } = await entryFor(key);
    const needsSource = steps.before.some((step) => step.op === 'last_frame') || steps.after.some((step) => step.op === 'merge_source');
    if (needsSource && !sourceUrl) {
        throw new GatewayError(400, 'source_required', 'Pick a clip you generated in this session to continue from.', { field: 'request_id' });
    }
    // Same 400s as a direct submit, before any money is spent.
    const probe = catalog.applyResolvedSource(entry, payload, { lastFrameUrl: needsSource ? FRAME_PLACEHOLDER : undefined });
    buildInput(catalog, entry, probe);
    return { key, payload, source_url: sourceUrl };
}

export async function estimateUsd(input) {
    const { catalog, entry, steps } = await entryFor(input?.key);
    const payload = input?.payload || {};
    let usd = 0;
    try {
        usd = await estimateCatalogUsd(catalog, entry, payload);
    } catch {
        usd = Number(entry.est_usd) || CATEGORY_DEFAULT_USD.video;
    }
    for (const step of [...steps.before, ...steps.after]) usd += stepUsd(step, payload);
    return Math.round(usd * 10_000) / 10_000;
}

export async function run(ctx) {
    const { key, payload, source_url: sourceUrl } = ctx.input;
    const { catalog, entry, steps } = await entryFor(key);
    const total = steps.before.length + steps.after.length + 1;
    let done = 0;
    const advance = (message) => {
        done += 1;
        ctx.progress(Math.round((done / (total + 1)) * 100), message);
    };

    let lastFrameUrl;
    for (const step of steps.before) {
        if (step.op === 'last_frame') {
            ctx.emit('info', { step: 'last_frame' });
            const frame = await ctx.falCall({ endpoint: STEP_ENDPOINTS.last_frame }, { video_url: sourceUrl, frame_type: 'last' }, { estUsd: stepUsd(step, payload) });
            lastFrameUrl = urlOf(frame);
            advance('Picked the last frame of your clip');
        }
    }

    const mainPayload = catalog.applyResolvedSource(entry, payload, { lastFrameUrl });
    ctx.emit('info', { step: 'generate', model: key });
    const main = await ctx.falCall(key, mainPayload, { asStep: true });
    let url = urlOf(main);
    advance('Generated the new clip');

    for (const step of steps.after) {
        if (step.op === 'merge_source') {
            ctx.emit('info', { step: 'merge_source' });
            const merged = await ctx.falCall({ endpoint: STEP_ENDPOINTS.merge_source }, { video_urls: [sourceUrl, url] }, { estUsd: stepUsd(step, payload) });
            url = urlOf(merged);
            advance('Joined it to your clip');
        } else if (step.op === 'upscale') {
            const target = TARGETS.has(step.target_resolution) ? step.target_resolution : '2160p';
            ctx.emit('info', { step: 'upscale', target });
            const upscaled = await ctx.falCall(
                { endpoint: STEP_ENDPOINTS.upscale },
                { video_url: url, upscale_mode: 'target', target_resolution: target },
                { estUsd: stepUsd(step, payload), timeoutMs: 30 * 60_000 },
            );
            url = urlOf(upscaled);
            advance(`Upscaled to ${target}`);
        }
    }

    return { url, outputs: [url], video: { url }, model: key };
}

register('catalog-steps', run, { internal: true, validate, estimateUsd, timeoutMs: 45 * 60_000 });
