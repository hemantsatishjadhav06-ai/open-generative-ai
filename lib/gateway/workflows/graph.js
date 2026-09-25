// Pure graph helpers for the workflow executor: which node field an edge
// fills, the run params of a node (input_params + defaults + placeholders for
// connected inputs, the same rules as the builder's buildWorkflowPayload),
// placeholder resolution and topological order.

import { GatewayError } from '../errors.js';

// Target handle → the field it fills. `list: true` collects every connection.
export const HANDLE_FIELDS = Object.freeze({
    textInput: { field: 'prompt' },
    imageInput: { field: 'prompt' },
    videoInput: { field: 'prompt' },
    audioInput2: { field: 'prompt' },
    textInput4: { field: 'system_prompt' },
    textInput3: { field: 'images_list', list: true },
    imageInput2: { field: 'images_list', list: true },
    videoInput6: { field: 'images_list', list: true },
    textInput2: { field: 'image_url' },
    videoInput2: { field: 'image_url' },
    imageInput3: { field: 'image_url' },
    audioInput3: { field: 'image_url' },
    videoInput3: { field: 'last_image' },
    videoInput4: { field: 'video_url' },
    audioInput4: { field: 'video_url' },
    videoInput7: { field: 'videos_list', alt: 'video_files', list: true },
    videoInput8: { field: 'audios_list', alt: 'audio_files', list: true },
    audioInput: { field: 'audio_url' },
    videoInput5: { field: 'audio_url' },
    concatInput: { field: 'prompt', list: true },
});

// Node types the builder uses for each category (for the architect).
export const SOURCE_HANDLES = Object.freeze({ text: 'textOutput', image: 'imageOutput', video: 'videoOutput', audio: 'audioOutput' });

export const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,47})\.outputs\[(\d{1,2})\]\.value\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\s*\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,47})\.outputs\[(\d{1,2})\]\.value\s*\}\}\s*$/;

export function placeholderFor(nodeId, index = 0) {
    return `{{ ${nodeId}.outputs[${index}].value }}`;
}

// Field a connection fills on the target node, given its schema properties.
export function fieldForHandle(targetHandle, properties, category) {
    if (category === 'utility' && targetHandle === 'videoInput7') {
        return { field: properties && 'video_files' in properties ? 'video_files' : 'videos_list', list: true };
    }
    const spec = HANDLE_FIELDS[targetHandle];
    if (!spec) return null;
    if (spec.alt && properties && !(spec.field in properties) && spec.alt in properties) return { field: spec.alt, list: spec.list };
    return { field: spec.field, list: Boolean(spec.list) };
}

// Run params for a node: every schema field (saved value, else the schema
// default), connected fields replaced by placeholders of their sources.
export function deriveParams(node, edges, properties) {
    const values = node.input_params && typeof node.input_params === 'object' ? node.input_params : {};
    const params = {};
    for (const [key, meta] of Object.entries(properties || {})) {
        if (values[key] !== undefined && values[key] !== null) params[key] = values[key];
        else if (meta && meta.default !== undefined) params[key] = meta.default;
    }
    const incoming = edges.filter((edge) => edge.target === node.id);
    const lists = new Map();
    const scalars = new Map();
    for (const edge of incoming) {
        const target = fieldForHandle(edge.targetHandle, properties, node.category);
        if (!target || !properties || !(target.field in properties)) continue;
        const value = placeholderFor(edge.source);
        if (target.list) {
            const list = lists.get(target.field) || [];
            if (!list.includes(value)) list.push(value);
            lists.set(target.field, list);
        } else if (!scalars.has(target.field)) {
            scalars.set(target.field, value);
        }
    }
    for (const [field, list] of lists) params[field] = list;
    for (const [field, value] of scalars) params[field] = value;
    return params;
}

// Node ids a value's placeholders point at.
export function referencedNodes(value, out = new Set()) {
    if (typeof value === 'string') {
        for (const match of value.matchAll(PLACEHOLDER)) out.add(match[1]);
    } else if (Array.isArray(value)) {
        value.forEach((item) => referencedNodes(item, out));
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach((item) => referencedNodes(item, out));
    }
    return out;
}

function missing(source, index) {
    return new GatewayError(400, 'missing_input', index > 0
        ? `Step "${source}" didn't produce output #${index + 1} for this step.`
        : `Step "${source}" hasn't produced anything for this step yet. Run it first.`);
}

// Replaces {{ node.outputs[i].value }} with the outputs of earlier steps.
// A field that is exactly one placeholder takes the raw value; placeholders
// inside longer text are substituted as text.
export function resolvePlaceholders(value, outputsById) {
    const lookup = (source, index) => {
        const outputs = outputsById.get ? outputsById.get(source) : outputsById[source];
        const hit = Array.isArray(outputs) ? outputs[index] : undefined;
        if (!hit || hit.value === undefined || hit.value === null || hit.value === '') throw missing(source, index);
        return hit.value;
    };
    if (typeof value === 'string') {
        const whole = WHOLE_PLACEHOLDER.exec(value);
        if (whole) return lookup(whole[1], Number(whole[2]));
        if (!value.includes('{{')) return value;
        return value.replace(PLACEHOLDER, (_, source, index) => String(lookup(source, Number(index))));
    }
    if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, outputsById));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolvePlaceholders(item, outputsById)]));
    }
    return value;
}

// Kahn's algorithm over dependencies → ordered node ids. Throws 400 on a loop.
export function topoOrder(nodeIds, depsById) {
    const indegree = new Map(nodeIds.map((id) => [id, 0]));
    const dependents = new Map(nodeIds.map((id) => [id, []]));
    for (const id of nodeIds) {
        for (const dep of depsById.get(id) || []) {
            if (!indegree.has(dep)) continue;
            indegree.set(id, indegree.get(id) + 1);
            dependents.get(dep).push(id);
        }
    }
    const queue = nodeIds.filter((id) => indegree.get(id) === 0);
    const order = [];
    while (queue.length) {
        const id = queue.shift();
        order.push(id);
        for (const next of dependents.get(id)) {
            indegree.set(next, indegree.get(next) - 1);
            if (indegree.get(next) === 0) queue.push(next);
        }
    }
    if (order.length !== nodeIds.length) {
        throw new GatewayError(400, 'workflow_cycle', 'This workflow has a loop: a step depends on its own result. Remove one of the connections and try again.');
    }
    return order;
}
