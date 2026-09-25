// Aquora gateway client for the studio components.
//
// Every call goes to this site's own API (same origin, cookie auth):
//   media generation   POST /api/v1/<model key>             → {request_id, status:'processing'}
//   polling            GET  /api/v1/predictions/<token>/result
//   uploads            POST /api/v1/upload_file (multipart field `file`) → {url}
//   cost estimates     POST /api/v1/estimate {model, payload} → {cost, currency}
//                      POST /api/app/calculate_dynamic_cost {task_name, payload}
//   workflows          /api/workflow/*
//   agents             /api/agents/*
// The gateway runs the models on fal.ai / OpenRouter with server-side keys;
// the browser never holds a provider key. Every exported function keeps its
// old first parameter (`apiKey`) so existing callers don't change; it is
// ignored — the HttpOnly session cookie authenticates the request.
//
// Errors: 401 dispatches `aquora:session-required` (the shell shows the
// access-code dialog); 402 throws the gateway's friendly budget message and
// dispatches `aquora:budget-exceeded`; everything else throws
// `<prefix>: <status> - <message>` for formatErrorMessage to tidy up.
import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getRecastModelById, getLipSyncModelById, getAudioModelById } from './models.js';
import {
    buildVideoToolPayload,
    serializeVideoToolOptions,
} from './videoToolCapabilities.js';
import { buildImageSizePayload } from './imageSizing.js';
import { buildImageInputPayload, getImageInputValidationError, normalizePrimaryImageUrls } from './imageInputContracts.js';
import { pollForGenerationResult, describeApiError } from './utils/generationLifecycle.js';
import { getModelMediaCapabilities, mapReferenceParams } from './modelCapabilities.js';
import { buildSupplementalInputPayload } from './modelParameters.js';
import { getGroupedVideoConfiguration } from './groupedVideoModels.js';
import { notifyBudgetExceeded, notifySessionRequired } from './session.js';
import { loadModelAvailability } from './modelAvailability.js';

export { describeApiError };
export {
    BUDGET_EXCEEDED_EVENT,
    SESSION_CHANGED_EVENT,
    SESSION_REQUIRED_EVENT,
    describeBudget,
    formatUsd,
    getSessionSnapshot,
    getSessionStatus,
    signIn,
    signOut,
    subscribeSession,
} from './session.js';

const API_V1 = '/api/v1';
const WORKFLOW_BASE = '/api/workflow';
const AGENTS_BASE = '/api/agents';
const FILE_UPLOAD_TIMEOUT_MS = 300_000;
const FILE_UPLOAD_PENDING_PROGRESS = 99;
const BUDGET_FALLBACK_MESSAGE = "Today's AI budget is used up. It resets at 00:00 UTC.";

// Start fetching the runnable-model list as soon as a studio loads, so the
// pickers rarely render before it arrives (browser only; once per page).
if (typeof window !== 'undefined') loadModelAvailability();

// ─── transport ──────────────────────────────────────────────────────────────

function parseJson(text) {
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}

// Turns a non-2xx gateway response into an Error (and fires the session /
// budget events). `withStatusText` keeps the historic
// "API Request Failed: 500 Internal Server Error - …" shape of media calls.
// `silent` skips the session/budget events (background calls such as cost
// estimates must not open the access-code dialog on their own).
async function responseError(response, prefix, { withStatusText = false, silent = false } = {}) {
    const text = await response.text().catch(() => '');
    const body = parseJson(text);
    if (!silent) notifySessionRequired(response.status, text);
    if (response.status === 402 || body?.error === 'budget_exceeded') {
        if (!silent) notifyBudgetExceeded(body || {});
        const error = new Error(typeof body?.message === 'string' && body.message ? body.message : BUDGET_FALLBACK_MESSAGE);
        error.status = 402;
        error.code = 'budget_exceeded';
        return error;
    }
    const statusText = withStatusText && response.statusText ? ` ${response.statusText}` : '';
    const error = new Error(`${prefix}: ${response.status}${statusText} - ${describeApiError(text)}`);
    error.status = response.status;
    if (typeof body?.error === 'string') error.code = body.error;
    if (typeof body?.field === 'string') error.field = body.field;
    if (typeof body?.retry_after === 'number') error.retryAfter = body.retry_after;
    return error;
}

async function gatewayRequest(path, { method = 'GET', body, signal, failure, withStatusText = false, silent = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
    });
    if (!response.ok) throw await responseError(response, failure, { withStatusText, silent });
    return response;
}

async function gatewayJson(path, options) {
    const response = await gatewayRequest(path, options);
    const text = await response.text();
    const data = parseJson(text);
    if (data === null && text.trim()) {
        throw new Error(`${options?.failure || 'Request failed'}: ${response.status} - ${describeApiError(text)}`);
    }
    return data ?? {};
}

function segment(value) {
    return encodeURIComponent(String(value ?? ''));
}

// ─── media generation ───────────────────────────────────────────────────────

function assertRequiredPrompt(model, params) {
    if (model?.promptRequired && !String(params.prompt || '').trim()) {
        throw new Error('Prompt is required for this model.');
    }
}

function includeRequiredArrayDefaults(model, payload) {
    const defaults = {};
    for (const field of model?.required || []) {
        if (payload[field] !== undefined || model?.inputs?.[field]?.type !== 'array') continue;
        defaults[field] = [];
    }
    return Object.keys(defaults).length > 0 ? { ...defaults, ...payload } : payload;
}

function outputUrlOf(result) {
    return result?.outputs?.[0] || result?.url || result?.output?.url;
}

function normalizePredictionResult(submitData, result) {
    const requestId = submitData?.request_id || submitData?.id || result?.request_id || result?.id;
    return {
        ...result,
        ...(requestId ? { request_id: requestId } : {}),
        url: outputUrlOf(result),
    };
}

async function submitAndPoll(endpoint, payload, onRequestId, maxAttempts = 60) {
    const submitData = await gatewayJson(`${API_V1}/${segment(endpoint)}`, {
        method: 'POST',
        body: payload,
        failure: 'API Request Failed',
        withStatusText: true,
    });
    const requestId = submitData.request_id || submitData.id;
    // A synchronous tool answers with the finished result straight away.
    if (!requestId) return { ...submitData, url: outputUrlOf(submitData) };
    if (onRequestId) onRequestId(requestId);
    const result = await pollForGenerationResult({
        requestId,
        maxAttempts,
        interval: 2000,
        onAuthRequired: notifySessionRequired,
    });
    return normalizePredictionResult(submitData, result);
}

export async function generateImage(_apiKey, params) {
    const modelInfo = getModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {
        ...buildSupplementalInputPayload(modelInfo, params),
        prompt: params.prompt
    };
    if (modelInfo) Object.assign(payload, buildImageSizePayload(modelInfo, params.aspect_ratio));
    else if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
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
    return submitAndPoll(endpoint, payload, params.onRequestId, 60);
}

export async function generateI2I(_apiKey, params) {
    const modelInfo = getI2IModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const imageField = modelInfo?.imageField || 'image_url';
    const imagesList = normalizePrimaryImageUrls(params.images_list, params.image_url);
    const inputError = getImageInputValidationError(modelInfo, 'i2i', {
        prompt: params.prompt,
        primaryImageUrls: imagesList,
        auxiliaryImageUrls: params,
    });
    if (inputError) throw new Error(inputError);
    const payload = {
        ...mapReferenceParams(modelInfo, params),
        ...buildSupplementalInputPayload(modelInfo, params),
        ...buildImageInputPayload(modelInfo, 'i2i', params)
    };
    if (imagesList.length > 0) {
        if (imageField === 'images_list') payload.images_list = imagesList;
        else payload[imageField] = imagesList[0];
    }
    if (modelInfo) Object.assign(payload, buildImageSizePayload(modelInfo, params.aspect_ratio));
    else if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    return submitAndPoll(endpoint, payload, params.onRequestId, 60);
}

export const DECOMPOSE_LAYERS_MODEL = 'bytedance-seedream-5.0-pro-layer';

export async function decomposeLayers(_apiKey, params) {
    const payload = {
        image_url: params.image_url,
        prompt: params.prompt || '',
        resolution: params.resolution || 'auto',
        output_format: params.output_format || 'png'
    };
    const result = await submitAndPoll(DECOMPOSE_LAYERS_MODEL, payload, params.onRequestId, 300);
    // The gateway returns `outputs` as URL strings and `images` as [{url}].
    const raw = result.outputs?.length ? result.outputs : (result.images || result.output?.images || (result.url ? [result.url] : []));
    const images = (Array.isArray(raw) ? raw : [raw])
        .map((item) => (typeof item === 'string' ? item : item?.url))
        .filter(Boolean);
    return { ...result, images };
}

export async function generateVideo(_apiKey, params) {
    const modelInfo = getVideoModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const mediaCapabilities = getModelMediaCapabilities(modelInfo);
    assertRequiredPrompt(modelInfo, params);
    let payload = {
        ...mapReferenceParams(modelInfo, params),
        ...buildSupplementalInputPayload(modelInfo, params)
    };
    if (params.prompt) payload.prompt = params.prompt;
    if (params.request_id) payload.request_id = params.request_id;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (typeof params.generate_audio === 'boolean') payload.generate_audio = params.generate_audio;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (!mediaCapabilities.image.field && params.image_url) payload.image_url = params.image_url;
    if (!mediaCapabilities.image.field && params.images_list?.length > 0) payload.images_list = params.images_list;
    if (!mediaCapabilities.video.field && params.videos_list?.length > 0) payload.videos_list = params.videos_list;
    if (!mediaCapabilities.video.field && params.video_files?.length > 0) payload.video_files = params.video_files;
    Object.assign(payload, serializeVideoToolOptions(modelInfo, params.options));
    payload = includeRequiredArrayDefaults(modelInfo, payload);
    return submitAndPoll(endpoint, payload, params.onRequestId, 900);
}

export async function generateI2V(_apiKey, params) {
    const modelInfo = getI2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    assertRequiredPrompt(modelInfo, params);
    let payload = {
        ...mapReferenceParams(modelInfo, params),
        ...buildSupplementalInputPayload(modelInfo, params)
    };
    if (params.prompt) payload.prompt = params.prompt;
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (typeof params.generate_audio === 'boolean') payload.generate_audio = params.generate_audio;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    if (modelInfo?.inputs?.name) {
        payload.name = params.name || modelInfo.inputs.name.default;
    }
    payload = includeRequiredArrayDefaults(modelInfo, payload);
    return submitAndPoll(endpoint, payload, params.onRequestId, 900);
}

export function getMarketingStudioAdModel(resolution) {
    return resolution === '1080p' ? 'sd-2-vip-omni-reference-1080p' : 'seedance-2-vip-omni-reference';
}

export async function generateMarketingStudioAd(_apiKey, params) {
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: params.duration || 5,
        images_list: params.images_list || [],
        video_files: params.video_files || []
    };
    return submitAndPoll(getMarketingStudioAdModel(params.resolution), payload, params.onRequestId, 900);
}

export async function processV2V(_apiKey, params) {
    const modelInfo = getV2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const toolPayload = buildVideoToolPayload(modelInfo, params);
    let payload = {
        ...buildSupplementalInputPayload(modelInfo, params),
        ...toolPayload,
        ...mapReferenceParams(modelInfo, params),
    };
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    if (getGroupedVideoConfiguration(modelInfo?.id)) {
        for (const field of ['duration', 'aspect_ratio', 'resolution', 'quality']) {
            if (modelInfo.inputs?.[field] && params[field] !== undefined) {
                payload[field] = params[field];
            }
        }
    }
    payload = includeRequiredArrayDefaults(modelInfo, payload);
    return submitAndPoll(endpoint, payload, params.onRequestId, 900);
}

export async function processRecast(_apiKey, params) {
    const modelInfo = getRecastModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const videoField = modelInfo?.videoField || 'video_url';
    const payload = { [videoField]: params.video_url };
    if (modelInfo?.imageField && params.image_url) {
        payload[modelInfo.imageField] = params.image_url;
    }
    if (modelInfo?.hasPrompt && params.prompt) {
        payload.prompt = params.prompt;
    }
    if (params.aspect_ratio) {
        payload.aspect_ratio = params.aspect_ratio;
    }
    if (params.character_orientation) {
        payload.character_orientation = params.character_orientation;
    }
    return submitAndPoll(endpoint, payload, params.onRequestId, 900);
}

export async function processMotionControl(_apiKey, params) {
    const model = params.model || 'seedance-2.5-motion-control';
    const mode = params.mode || 'motion_transfer';
    const internalPrompt = mode === 'objects_swap'
        ? "Keep the rest of the scene as filmed, swap the characters, products, or clothes with the reference images."
        : "Extract motion from the reference video and rebuild the scene with the new characters and assets, preserving the original motion, choreography, and camera movements.";

    const userPrompt = String(params.prompt || '').trim();
    const finalPrompt = userPrompt ? `${internalPrompt} ${userPrompt}` : internalPrompt;

    let imagesList = [];
    if (Array.isArray(params.images_list)) {
        imagesList = params.images_list;
    } else if (params.images) {
        imagesList = Array.isArray(params.images) ? params.images : [params.images];
    } else if (params.image_url) {
        imagesList = [params.image_url];
    }

    const payload = {
        video_url: params.video_url,
        images_list: imagesList,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: Number(params.duration) || 5,
        generate_audio: !!params.generate_audio,
        prompt: finalPrompt
    };

    if (model === 'seedance-2-motion-control') {
        if (payload.duration > 15) payload.duration = 15;
        if (payload.duration < 4) payload.duration = 4;
        if (payload.images_list.length > 9) payload.images_list = payload.images_list.slice(0, 9);
        payload.quality = params.quality === 'basic' ? 'basic' : 'high';
        if (params.seed !== undefined && params.seed !== -1) payload.seed = Number(params.seed);
    } else {
        if (payload.duration > 30) payload.duration = 30;
        if (payload.duration < 4) payload.duration = 4;
        if (payload.images_list.length > 30) payload.images_list = payload.images_list.slice(0, 30);
        payload.high_bitrate = !!params.high_bitrate;
        if (params.seed !== undefined && params.seed !== -1) payload.seed = Number(params.seed);
    }

    return submitAndPoll(model, payload, params.onRequestId, 900);
}

export async function processLipSync(_apiKey, params) {
    const modelInfo = getLipSyncModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const payload = {};
    if (params.audio_url) payload.audio_url = params.audio_url;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.video_url) payload.video_url = params.video_url;
    if (modelInfo?.hasPrompt) payload.prompt = params.prompt || '';
    if (params.resolution) payload.resolution = params.resolution;
    if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;
    return submitAndPoll(endpoint, payload, params.onRequestId, 900);
}

export async function generateAudio(_apiKey, params) {
    const modelId = params._modelId || params.model;
    const modelInfo = getAudioModelById(modelId);
    const endpoint = modelInfo?.endpoint || modelId;
    const payload = {};
    const skipKeys = ['_modelId', 'onRequestId'];
    for (const key in params) {
        if (!skipKeys.includes(key) && params[key] !== undefined && params[key] !== null) {
            payload[key] = params[key];
        }
    }
    return submitAndPoll(endpoint, payload, params.onRequestId, 900);
}

export async function runClipping(_apiKey, params) {
    const payload = {
        video_url: params.video_url,
        num_highlights: params.num_highlights || 3,
        aspect_ratio: params.aspect_ratio || "9:16",
        return_coordinates_only: !!params.return_coordinates_only,
        ...(typeof params.prompt === "string" && params.prompt.trim() ? { prompt: params.prompt.trim() } : {})
    };
    return submitAndPoll("ai-clipping", payload, params.onRequestId, 900);
}

export async function runMotionGraphics(_apiKey, params) {
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || "16:9",
        duration_seconds: params.duration_seconds || 6,
    };
    return submitAndPoll("motion-graphics", payload, params.onRequestId, 900);
}

export async function runMotionGraphicsEdit(_apiKey, params) {
    const payload = {
        request_id: params.request_id,
        edit_prompt: params.edit_prompt,
        aspect_ratio: params.aspect_ratio || "16:9",
        duration_seconds: params.duration_seconds || 6,
    };
    return submitAndPoll("motion-graphics-edit", payload, params.onRequestId, 900);
}

// Studio model key for each upscaler the Layers studio offers.
export function getUpscaleModelKey(model) {
    return model === "ai-image-upscaler" ? "ai-image-upscale" : model;
}

export function buildUpscalePayload({ model, image_url, resolution, upscale_factor }) {
    const payload = { image_url };
    if (model === "seedvr2-image-upscale") payload.resolution = resolution || "4k";
    else if (model === "topaz-image-upscale") payload.upscale_factor = Number(upscale_factor) || 2;
    return payload;
}

export async function upscaleImage(_apiKey, { model, image_url, resolution, upscale_factor, onRequestId }) {
    const payload = buildUpscalePayload({ model, image_url, resolution, upscale_factor });
    return submitAndPoll(getUpscaleModelKey(model), payload, onRequestId, 90);
}

export const REMOVE_BACKGROUND_MODEL = "ai-background-remover";
export const EXPAND_IMAGE_MODEL = "ai-image-extension";

export async function removeBackground(_apiKey, { image_url, onRequestId }) {
    return submitAndPoll(REMOVE_BACKGROUND_MODEL, { image_url }, onRequestId, 90);
}

export async function expandImage(_apiKey, { image_url, onRequestId }) {
    return submitAndPoll(EXPAND_IMAGE_MODEL, { image_url }, onRequestId, 90);
}

/**
 * Estimated USD cost of one run, from the gateway's price table (never runs a
 * model). Resolves to a number, or null when the model has no estimate.
 * Silent: a failed estimate never prompts for the access code.
 */
export async function estimateCost(model, payload = {}, { signal } = {}) {
    const data = await gatewayJson(`${API_V1}/estimate`, {
        method: 'POST',
        body: { model, payload },
        signal,
        silent: true,
        failure: 'Cost estimate failed',
    });
    const cost = Number(data?.cost);
    return data?.cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

// ─── uploads ────────────────────────────────────────────────────────────────

export function uploadFile(_apiKey, file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_V1}/upload_file`);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.timeout = FILE_UPLOAD_TIMEOUT_MS;

        if (onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.min(
                        Math.round((event.loaded / event.total) * 100),
                        FILE_UPLOAD_PENDING_PROGRESS
                    );
                    onProgress(percentComplete);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const data = parseJson(xhr.responseText);
                const fileUrl = data?.url || data?.file_url || data?.data?.url;
                if (!data) {
                    reject(new Error('Failed to parse upload response'));
                } else if (!fileUrl) {
                    reject(new Error('No URL returned from file upload'));
                } else {
                    onProgress?.(100);
                    resolve(fileUrl);
                }
                return;
            }
            const errObj = parseJson(xhr.responseText);
            notifySessionRequired(xhr.status, xhr.responseText);
            if (xhr.status === 402 || errObj?.error === 'budget_exceeded') {
                notifyBudgetExceeded(errObj || {});
                reject(Object.assign(new Error(errObj?.message || BUDGET_FALLBACK_MESSAGE), { status: 402, code: 'budget_exceeded' }));
                return;
            }
            let detail = xhr.statusText;
            if (errObj) {
                // Unreachable/non-JSON upstreams come back as an `upstream_*`
                // envelope: surface the code + friendly message.
                if (typeof errObj.error === 'string' && errObj.error.startsWith('upstream_')) {
                    detail = `${errObj.error}: ${errObj.message || ''}`.trim();
                } else {
                    const d = [errObj.message, errObj.detail, errObj.error].find((v) => typeof v === 'string' && v);
                    if (d) detail = d;
                }
            }
            reject(Object.assign(new Error(`File upload failed: ${xhr.status} - ${detail}`), {
                status: xhr.status,
                ...(typeof errObj?.error === 'string' ? { code: errObj.error } : {}),
            }));
        };

        xhr.onerror = () => reject(new Error('Network error during file upload'));
        xhr.ontimeout = () => reject(new Error('File upload timed out. Please try again.'));
        xhr.send(formData);
    });
}

// ─── workflows (/api/workflow/*) ────────────────────────────────────────────

export async function getTemplateWorkflows() {
    return gatewayJson(`${WORKFLOW_BASE}/get-template-workflows`, { failure: 'Failed to fetch template workflows' });
}

export async function getUserWorkflows() {
    return gatewayJson(`${WORKFLOW_BASE}/get-workflow-defs`, { failure: 'Failed to fetch user workflows' });
}

export async function getPublishedWorkflows() {
    return gatewayJson(`${WORKFLOW_BASE}/get-published-workflows`, { failure: 'Failed to fetch published workflows' });
}

export async function createWorkflow(_apiKey, payload) {
    return gatewayJson(`${WORKFLOW_BASE}/create`, { method: 'POST', body: payload, failure: 'Failed to create workflow' });
}

export async function updateWorkflowName(_apiKey, workflowId, name) {
    return gatewayJson(`${WORKFLOW_BASE}/update-name/${segment(workflowId)}`, {
        method: 'POST',
        body: { name },
        failure: 'Failed to rename workflow',
    });
}

export async function deleteWorkflow(_apiKey, workflowId) {
    return gatewayJson(`${WORKFLOW_BASE}/delete-workflow-def/${segment(workflowId)}`, {
        method: 'DELETE',
        failure: 'Failed to delete workflow',
    });
}

export async function getWorkflowInputs(_apiKey, workflowId) {
    return gatewayJson(`${WORKFLOW_BASE}/${segment(workflowId)}/api-inputs`, { failure: 'Failed to fetch workflow inputs' });
}

export async function getAllNodeSchemas(_apiKey, workflowId) {
    return gatewayJson(`${WORKFLOW_BASE}/${segment(workflowId)}/node-schemas`, { failure: 'Failed to fetch node schemas' });
}

export async function getWorkflowData(_apiKey, workflowId) {
    return gatewayJson(`${WORKFLOW_BASE}/get-workflow-def/${segment(workflowId)}`, { failure: 'Failed to fetch workflow data' });
}

export async function getNodeSchemas(_apiKey, workflowId) {
    return gatewayJson(`${WORKFLOW_BASE}/${segment(workflowId)}/api-node-schemas`, { failure: 'Failed to fetch node schemas' });
}

export async function runSingleNode(_apiKey, workflowId, nodeId, payload) {
    return gatewayJson(`${WORKFLOW_BASE}/${segment(workflowId)}/node/${segment(nodeId)}/run`, {
        method: 'POST',
        body: payload ?? {},
        failure: 'Failed to run single node',
    });
}

export async function deleteNodeRun(_apiKey, nodeRunId) {
    return gatewayJson(`${WORKFLOW_BASE}/node-run/${segment(nodeRunId)}`, {
        method: 'DELETE',
        failure: 'Failed to delete node run',
    });
}

export async function getNodeStatus(_apiKey, runId) {
    return gatewayJson(`${WORKFLOW_BASE}/run/${segment(runId)}/status`, { failure: 'Failed to get node status' });
}

// Workflow builder cost badge: {cost} in USD for one run of `taskName`.
// Silent, like estimateCost: a failed estimate never prompts for the code.
export async function calculateDynamicCost(_apiKey, taskName, payload) {
    return gatewayJson('/api/app/calculate_dynamic_cost', {
        method: 'POST',
        body: { task_name: taskName, payload: payload ?? {} },
        silent: true,
        failure: 'Failed to calculate dynamic cost',
    });
}

export async function executeWorkflow(_apiKey, workflowId, inputs) {
    const submitData = await gatewayJson(`${WORKFLOW_BASE}/${segment(workflowId)}/api-execute`, {
        method: 'POST',
        body: { inputs },
        failure: 'Failed to execute workflow',
    });
    const runId = submitData.run_id || submitData.id;
    if (!runId) return submitData;
    return pollWorkflowResult(runId);
}

async function pollWorkflowResult(runId, maxAttempts = 900, interval = 2000) {
    const pollUrl = `${WORKFLOW_BASE}/run/${segment(runId)}/api-outputs`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        let response;
        try {
            response = await fetch(pollUrl, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            continue;
        }
        if (!response.ok) {
            if ((response.status >= 500 || response.status === 429) && attempt < maxAttempts) continue;
            throw await responseError(response, 'Poll Failed');
        }
        const data = await response.json().catch(() => null);
        if (!data) continue;
        const status = data.status?.toLowerCase();
        if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
        if (status === 'failed' || status === 'error') {
            throw new Error(`Workflow failed: ${typeof data.error === 'string' ? data.error : data.error?.message || 'Unknown error'}`);
        }
    }
    throw new Error('Workflow timed out after polling.');
}

// ─── agents (/api/agents/*) ─────────────────────────────────────────────────

function agentList(data) {
    return Array.isArray(data) ? data : (data?.agents || data?.items || []);
}

export async function getTemplateAgents() {
    return agentList(await gatewayJson(`${AGENTS_BASE}/templates/agents`, { failure: 'Failed to fetch template agents' }));
}

export async function getUserAgents() {
    return agentList(await gatewayJson(`${AGENTS_BASE}/user/agents`, { failure: 'Failed to fetch user agents' }));
}

// The signed-in workspace's chat history across all agents.
export async function getUserConversations() {
    const data = await gatewayJson(`${AGENTS_BASE}/user/conversations`, { failure: 'Failed to fetch conversations' });
    return Array.isArray(data) ? data : (data?.conversations || data?.items || []);
}

export async function getAgentBySlug(_apiKey, slug) {
    return gatewayJson(`${AGENTS_BASE}/by-slug/${segment(slug)}`, { failure: 'Failed to fetch agent' });
}

export async function getAgentConversation(_apiKey, agentSlug, conversationId) {
    return gatewayJson(`${AGENTS_BASE}/by-slug/${segment(agentSlug)}/${segment(conversationId)}`, { failure: 'Failed to fetch conversation' });
}

// Sends one chat turn; returns {request_id} to poll with pollAgentChatResult.
export async function sendAgentChatMessage(_apiKey, agentSlug, { message, conversationId, attachments } = {}) {
    return gatewayJson(`${AGENTS_BASE}/by-slug/${segment(agentSlug)}/chat`, {
        method: 'POST',
        body: {
            message,
            conversation_id: conversationId || null,
            attachments: attachments || null,
            stream: false,
        },
        failure: 'Failed to send message',
    });
}

// Polls the agent turn until it is complete. A finished turn is the
// {conversation_id, messages, is_complete, suggestions} envelope rather than
// a media URL; a failed turn is HTTP 400 {detail:{error}}.
export async function pollAgentChatResult(_apiKey, requestId, { maxAttempts = 150, interval = 2000 } = {}) {
    const url = `${API_V1}/predictions/${segment(requestId)}/result`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        let response;
        try {
            response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            continue;
        }
        if (response.status === 400) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody?.detail?.error || errBody?.error || 'Agent failed to respond');
        }
        if (response.status === 401 || response.status === 402 || response.status === 403 || response.status === 404) {
            throw await responseError(response, 'Poll failed');
        }
        if (!response.ok) {
            if (attempt === maxAttempts) throw new Error(`Poll failed: ${response.status}`);
            continue;
        }
        const data = await response.json().catch(() => null);
        if (data?.status === 'failed') throw new Error(data.error || 'Agent failed to respond');
        if (data?.is_complete) return data;
    }
    throw new Error('Agent response timed out.');
}

// Creates a persona agent ({name, description, system_prompt, welcome_message, skill_ids}).
export async function createAgent(_apiKey, payload) {
    return gatewayJson(AGENTS_BASE, { method: 'POST', body: payload, failure: 'Failed to create agent' });
}
