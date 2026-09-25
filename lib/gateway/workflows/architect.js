// Workflow architect: "describe what you want" → a workflow graph, drafted by
// OpenRouter (OPENROUTER_MODEL_AGENT, JSON reply) and checked here against the
// node schemas before the builder sees it. One request = one
// 'workflow-architect' pipeline job; the builder polls
// GET /api/workflow/poll-architect/<token>/result.
//
// Reply shape (what NodeFlow.jsx reads):
//   {status:'completed', message, suggestions:[…], workflow:{nodes:[{id,
//    category, model, params, input_params, position}], edges:[{source,
//    target, sourceHandle, targetHandle}]}}

import { GatewayError, errors } from '../errors.js';
import { loadJob, verifyJobToken } from '../jobs.js';
import { parseJsonReply } from '../openrouter.js';
import { register, startPipelineJob } from '../pipelines/index.js';
import { shared } from '../state.js';
import { SOURCE_HANDLES, topoOrder } from './graph.js';
import { nodeSchemas } from './schemas.js';
import { cleanText } from './validate.js';

export const PIPELINE = 'workflow-architect';
const MAX_NODES = 12;
const MAX_HISTORY = 10;

const trustedInputs = () => shared('workflowArchitectInputs', () => new WeakSet());

// Models the architect may use, per purpose, when they're enabled. The
// builder offers every catalog model; the architect sticks to a short,
// dependable list so its drafts run.
const PREFERRED = {
    text: ['text-passthrough', 'llm-fast', 'llm-smart', 'llm-vision'],
    image: ['image-passthrough', 'nano-banana-pro', 'flux-2-pro', 'bytedance-seedream-v4.5', 'gpt-image-1.5', 'wan2.5-text-to-image', 'nano-banana-pro-edit', 'flux-2-pro-edit', 'bytedance-seedream-v4.5-edit', 'qwen-image-edit-plus', 'ai-background-remover', 'seedvr2-image-upscale'],
    video: ['video-passthrough', 'seedance-pro-t2v', 'seedance-pro-i2v', 'veo3.1-fast-text-to-video', 'veo3.1-fast-image-to-video', 'kling-v2.6-pro-i2v', 'wan2.6-image-to-video', 'omnihuman-1-5', 'sync-lipsync'],
    audio: ['audio-passthrough', 'minimax-speech-2.6-hd', 'elevenlabs-tts-turbo-2-5', 'minimax-music-3.0'],
    utility: ['prompt-concatenator', 'video-combiner'],
};

// Target field → the builder handle that fills it, per node category.
const TARGET_HANDLES = {
    text: { prompt: 'textInput', image_url: 'textInput2', images_list: 'textInput3', system_prompt: 'textInput4' },
    image: { prompt: 'imageInput', images_list: 'imageInput2', image_url: 'imageInput3' },
    video: { prompt: 'videoInput', image_url: 'videoInput2', last_image: 'videoInput3', video_url: 'videoInput4', audio_url: 'videoInput5', images_list: 'videoInput6', videos_list: 'videoInput7' },
    audio: { audio_url: 'audioInput', prompt: 'audioInput2', image_url: 'audioInput3', video_url: 'audioInput4' },
    'prompt-concatenator': { prompt: 'concatInput' },
    'video-combiner': { videos_list: 'videoInput7' },
};
// Which fields an output kind may fill.
const FIELD_ACCEPTS = {
    text: ['prompt', 'system_prompt'],
    image: ['image_url', 'images_list', 'last_image'],
    video: ['video_url', 'videos_list'],
    audio: ['audio_url'],
};
const LINK_FIELDS = ['prompt', 'system_prompt', 'image_url', 'images_list', 'last_image', 'video_url', 'audio_url', 'videos_list'];

function modelsFor(schemas) {
    const allowed = {};
    for (const [category, ids] of Object.entries(PREFERRED)) {
        const models = schemas.categories?.[category]?.models || {};
        allowed[category] = ids.filter((id) => models[id]).map((id) => ({ id, ...models[id] }));
    }
    return allowed;
}

function describeModels(allowed) {
    const lines = [];
    for (const [category, models] of Object.entries(allowed)) {
        for (const model of models) {
            const props = model.input_schema?.schemas?.input_data?.properties || {};
            const fields = Object.keys(props).slice(0, 10).join(', ');
            lines.push(`- ${model.id} [${category}${model.group ? `/${model.group}` : ''}] ${model.name}. Fields: ${fields || 'none'}`);
        }
    }
    return lines.join('\n');
}

function replySchema(allowed) {
    const ids = Object.values(allowed).flat().map((model) => model.id);
    return {
        type: 'object',
        properties: {
            message: { type: 'string', description: 'One or two sentences telling the user what the workflow does and what to fill in.' },
            suggestions: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'Short follow-up requests the user might send next.' },
            workflow: {
                type: 'object',
                properties: {
                    nodes: {
                        type: 'array',
                        minItems: 1,
                        maxItems: MAX_NODES,
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', description: 'Unique id such as text1, image1, video1, audio1, concat1.' },
                                category: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'utility'] },
                                model: { type: 'string', enum: ids },
                                params: { type: 'object', description: 'Field values (e.g. {"prompt": "…", "aspect_ratio": "16:9"}). Leave connected fields out.', additionalProperties: true },
                            },
                            required: ['id', 'category', 'model', 'params'],
                        },
                    },
                    edges: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string' },
                                target: { type: 'string' },
                                field: { type: 'string', enum: LINK_FIELDS, description: 'The target field the source output fills.' },
                            },
                            required: ['source', 'target', 'field'],
                        },
                    },
                },
                required: ['nodes', 'edges'],
            },
        },
        required: ['message', 'suggestions', 'workflow'],
    };
}

function systemPrompt(allowed) {
    return [
        "You design node workflows for Aquora's workflow builder, where each node is one step and edges pass one step's result into another step's field.",
        'Node categories: text (typed text or an LLM step), image, video, audio, utility (prompt-concatenator joins texts; video-combiner joins clips).',
        'Use *-passthrough models for things the user types or uploads (text-passthrough holds a prompt the user can edit; image/video/audio-passthrough hold an uploaded file, leave them empty).',
        'Outputs: text nodes give text, image nodes give an image, video nodes give a video, audio nodes give audio. An edge must connect a result to a field of the same kind: text → prompt or system_prompt; image → image_url, images_list or last_image; video → video_url or videos_list; audio → audio_url.',
        'Only use fields listed for a model. Keep workflows small (2–6 steps unless asked for more) because every generation costs money. Write prompts in params in the language the user writes in.',
        'If a current workflow is given, change it as asked and keep the steps the user did not mention.',
        'Allowed models:',
        describeModels(allowed),
        'Reply with JSON only.',
    ].join('\n');
}

function compactWorkflow(workflow) {
    const nodes = (workflow?.data?.nodes || []).slice(0, 30).map((node) => ({
        id: node.id,
        category: node.category,
        model: node.model,
        ...(typeof node.input_params?.prompt === 'string' && node.input_params.prompt ? { prompt: node.input_params.prompt.slice(0, 300) } : {}),
    }));
    const edges = (workflow?.edges || []).slice(0, 60).map((edge) => ({ source: edge.source, target: edge.target, targetHandle: edge.targetHandle }));
    return nodes.length ? JSON.stringify({ nodes, edges }) : '';
}

function historyMessages(history) {
    if (!Array.isArray(history)) return [];
    return history.slice(-MAX_HISTORY).flatMap((item) => {
        const role = item?.role === 'assistant' || item?.role === 'agent' ? 'assistant' : item?.role === 'user' ? 'user' : null;
        const content = typeof item?.content === 'string' ? item.content.trim().slice(0, 2_000) : '';
        return role && content ? [{ role, content }] : [];
    });
}

// ── Checking the draft ──────────────────────────────────────────────────────
function outputKind(node) {
    if (node.category === 'utility') return node.model === 'video-combiner' ? 'video' : 'text';
    return node.category;
}

function propsOf(schemas, category, model) {
    return schemas.categories?.[category]?.models?.[model]?.input_schema?.schemas?.input_data?.properties || null;
}

function cleanParams(raw, props) {
    const params = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return params;
    for (const [key, value] of Object.entries(raw)) {
        const meta = props[key];
        if (!meta) continue;
        if (typeof value === 'string') {
            if (/^\s*[a-z][a-z0-9+.-]*:/i.test(value)) continue; // no links from the model
            if (meta.enum && !meta.enum.includes(value)) continue;
            params[key] = value.slice(0, 4_000);
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            if (meta.enum && !meta.enum.includes(value)) continue;
            params[key] = value;
        } else if (typeof value === 'boolean') {
            params[key] = value;
        }
    }
    return params;
}

// Turns the model's draft into builder nodes/edges, dropping anything that
// isn't runnable. Ids follow the builder's scheme (text1, image1, concat1…).
export function sanitizeDraft(draft, schemas) {
    const rawNodes = Array.isArray(draft?.nodes) ? draft.nodes.slice(0, MAX_NODES) : [];
    const counts = {};
    const idMap = new Map();
    const nodes = [];
    for (const raw of rawNodes) {
        const category = typeof raw?.category === 'string' ? raw.category : '';
        let model = typeof raw?.model === 'string' ? raw.model : '';
        if (!schemas.categories?.[category]) continue;
        if (!propsOf(schemas, category, model)) {
            // A model from another category: keep the step with that category's input model.
            const fallback = category === 'utility' ? 'prompt-concatenator' : `${category}-passthrough`;
            if (!propsOf(schemas, category, fallback)) continue;
            model = fallback;
        }
        const prefix = category === 'utility' ? (model === 'video-combiner' ? 'vidConcat' : 'concat') : category;
        counts[prefix] = (counts[prefix] || 0) + 1;
        const id = `${prefix}${counts[prefix]}`;
        if (typeof raw?.id === 'string' && !idMap.has(raw.id)) idMap.set(raw.id, id);
        const params = cleanParams(raw.params, propsOf(schemas, category, model));
        nodes.push({ id, category, model, params, input_params: params });
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = [];
    const seen = new Set();
    for (const raw of Array.isArray(draft?.edges) ? draft.edges.slice(0, 40) : []) {
        const source = byId.get(idMap.get(raw?.source));
        const target = byId.get(idMap.get(raw?.target));
        if (!source || !target || source === target) continue;
        const field = typeof raw?.field === 'string' ? raw.field : 'prompt';
        const kind = outputKind(source);
        if (!(FIELD_ACCEPTS[kind] || []).includes(field)) continue;
        const handles = TARGET_HANDLES[target.category === 'utility' ? target.model : target.category] || {};
        const targetHandle = handles[field];
        if (!targetHandle || !(field in (propsOf(schemas, target.category, target.model) || {}))) continue;
        const sourceHandle = source.category === 'utility'
            ? (source.model === 'video-combiner' ? 'videoOutput' : 'concatOutput')
            : SOURCE_HANDLES[source.category];
        const key = `${source.id}|${target.id}|${targetHandle}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ id: `e-${source.id}-${target.id}-${targetHandle}`, source: source.id, target: target.id, sourceHandle, targetHandle });
        // A connected field is filled at run time.
        delete target.params[field];
        delete target.input_params[field];
    }
    // Lay out left → right by dependency depth.
    const deps = new Map(nodes.map((node) => [node.id, edges.filter((edge) => edge.target === node.id).map((edge) => edge.source)]));
    let order;
    try {
        order = topoOrder(nodes.map((node) => node.id), deps);
    } catch {
        return { nodes: [], edges: [] };
    }
    const depth = new Map();
    for (const id of order) depth.set(id, Math.max(0, ...deps.get(id).map((dep) => (depth.get(dep) ?? -1) + 1)));
    const rows = new Map();
    for (const node of nodes) {
        const column = depth.get(node.id) || 0;
        const row = rows.get(column) || 0;
        rows.set(column, row + 1);
        node.position = { x: column * 400, y: row * 340 };
    }
    return { nodes, edges };
}

// ── Pipeline ────────────────────────────────────────────────────────────────
async function runArchitect(ctx) {
    const { prompt, history, current, locale } = ctx.input;
    const schemas = await nodeSchemas({ locale });
    const allowed = modelsFor(schemas);
    const messages = [
        { role: 'system', content: systemPrompt(allowed) },
        ...historyMessages(history),
        { role: 'user', content: current ? `Current workflow: ${current}\n\nRequest: ${prompt}` : prompt },
    ];
    const result = await ctx.llm({
        purpose: 'agent',
        messages,
        max_tokens: 2_500,
        temperature: 0.4,
        response_format: { type: 'json_schema', json_schema: { name: 'workflow_draft', strict: false, schema: replySchema(allowed) } },
    });
    const reply = parseJsonReply(result.content);
    if (!reply || typeof reply !== 'object') throw new GatewayError(502, 'bad_reply', "The architect's reply couldn't be read. Try rephrasing your request.");
    const workflow = sanitizeDraft(reply.workflow, schemas);
    if (!workflow.nodes.length) throw new GatewayError(502, 'bad_reply', "The architect couldn't build a workflow for that. Try describing the steps you want.");
    const suggestions = (Array.isArray(reply.suggestions) ? reply.suggestions : [])
        .filter((item) => typeof item === 'string' && item.trim())
        .slice(0, 3)
        .map((item) => item.trim().slice(0, 160));
    const message = typeof reply.message === 'string' && reply.message.trim() ? reply.message.trim().slice(0, 1_200) : '';
    return { message, suggestions, workflow };
}

register(PIPELINE, runArchitect, {
    kind: 'pipeline',
    timeoutMs: 3 * 60_000,
    estimateUsd: () => 0.02,
    validate(input) {
        if (!input || typeof input !== 'object' || !trustedInputs().has(input)) {
            throw new GatewayError(404, 'unknown_model', "This feature isn't available.");
        }
        return input;
    },
});

// POST /api/workflow/architect → {request_id, status}
export async function startArchitect({ session, body, workflow, locale }) {
    const prompt = cleanText(body?.prompt, { max: 4_000, field: 'prompt' }).trim();
    if (!prompt) throw errors.badRequest('Describe the workflow you want.', 'prompt');
    const input = { prompt, history: historyMessages(body?.history), current: compactWorkflow(workflow), locale };
    trustedInputs().add(input);
    const { token } = await startPipelineJob({ name: PIPELINE, input, session });
    return { request_id: token, status: 'processing' };
}

// GET /api/workflow/poll-architect/<token>/result
export async function pollArchitect({ token, session }) {
    const claims = verifyJobToken(token, session.sid);
    if (claims.e !== PIPELINE) throw errors.notFound('This request could not be found.');
    const job = await loadJob(claims.r, session.cid);
    if (!job || job.sid !== session.sid) {
        return { status: 'failed', error: 'This request was interrupted (the server restarted). Please try again.' };
    }
    if (job.status === 'processing') return { status: 'processing' };
    if (job.status === 'completed') return { status: 'completed', ...(job.result || {}) };
    return { status: 'failed', error: job.error || 'The architect could not finish.' };
}
