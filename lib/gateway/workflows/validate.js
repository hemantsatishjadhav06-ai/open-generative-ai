// Input checks for the workflows API: ids, names, and the workflow document
// the builder saves ({name, category, edges, data:{nodes}}). Everything the
// browser sends is copied into a fresh, size-bounded object; unknown keys are
// dropped. Media links are only kept when they are http(s).

import { GatewayError } from '../errors.js';
import { getLocaleFromPathname, isSupportedLocale } from '../../locales.js';

export const LIMITS = Object.freeze({
    nodes: 60,
    edges: 200,
    name: 120,
    category: 60,
    text: 20_000,
    listItems: 50,
    history: 20,
    runsKept: 30,
});

export const NODE_CATEGORIES = new Set(['text', 'image', 'video', 'audio', 'utility']);
const NODE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const HANDLE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const OUTPUT_TYPES = new Set(['text', 'image_url', 'video_url', 'audio_url']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function badRequest(message, field) {
    return new GatewayError(400, 'invalid_input', message, { field });
}

export function isWorkflowId(value) {
    return typeof value === 'string' && DOC_ID.test(value);
}

export function isNodeId(value) {
    return typeof value === 'string' && NODE_ID.test(value);
}

export function requireWorkflowId(value) {
    if (!isWorkflowId(value)) throw new GatewayError(404, 'not_found', "This workflow doesn't exist.");
    return value;
}

export function cleanText(value, { max = LIMITS.text, field = 'text', fallback = '' } = {}) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') throw badRequest(`${field} must be text.`, field);
    // Control characters (except tab/newline) never belong in names or prompts.
    const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return clean.length > max ? clean.slice(0, max) : clean;
}

export function cleanName(value, fallback = 'Untitled Workflow') {
    const name = cleanText(value, { max: LIMITS.name, field: 'name' }).replace(/\s+/g, ' ').trim();
    return name || fallback;
}

export function cleanCategory(value) {
    const category = cleanText(value, { max: LIMITS.category, field: 'category' }).replace(/\s+/g, ' ').trim();
    return category || 'General';
}

export function isHttpUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return false;
    try {
        const url = new URL(value.trim());
        return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
        return false;
    }
}

// JSON-ish copy with depth/size bounds and no prototype keys.
export function cleanValue(value, depth = 0) {
    if (depth > 6) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') return value.length > LIMITS.text ? value.slice(0, LIMITS.text) : value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.slice(0, LIMITS.listItems).map((item) => cleanValue(item, depth + 1)).filter((item) => item !== undefined);
    }
    if (typeof value === 'object') {
        const out = {};
        let count = 0;
        for (const [key, child] of Object.entries(value)) {
            if (UNSAFE_KEYS.has(key) || key.length > 64) continue;
            if (++count > 80) break;
            const copy = cleanValue(child, depth + 1);
            if (copy !== undefined) out[key] = copy;
        }
        return out;
    }
    return undefined;
}

function cleanObject(value) {
    const copy = value && typeof value === 'object' && !Array.isArray(value) ? cleanValue(value) : {};
    return copy && typeof copy === 'object' && !Array.isArray(copy) ? copy : {};
}

// Node outputs as the builder stores them: [{type, value}] where media values
// are http(s) links and text is bounded.
export function cleanOutputs(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list.slice(0, 16)) {
        const type = OUTPUT_TYPES.has(item?.type) ? item.type : null;
        if (!type) continue;
        if (type === 'text') {
            if (typeof item.value === 'string') out.push({ type, value: item.value.slice(0, LIMITS.text) });
        } else if (isHttpUrl(item.value)) {
            out.push({ type, value: item.value.trim() });
        }
    }
    return out;
}

function cleanPosition(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    return {
        x: Number.isFinite(x) ? Math.max(-1e6, Math.min(1e6, Math.round(x * 10) / 10)) : 0,
        y: Number.isFinite(y) ? Math.max(-1e6, Math.min(1e6, Math.round(y * 10) / 10)) : 0,
    };
}

function cleanNode(raw) {
    if (!raw || typeof raw !== 'object' || !isNodeId(raw.id)) return null;
    const category = typeof raw.category === 'string' ? raw.category : '';
    // Bring-your-own-key API nodes (category 'api') are not supported.
    if (!NODE_CATEGORIES.has(category)) return null;
    const model = typeof raw.model === 'string' && MODEL_ID.test(raw.model) ? raw.model : `${category}-passthrough`;
    const outputs = cleanOutputs(raw.output_params?.outputs);
    const resultUrl = raw.output_params?.resultUrl;
    return {
        id: raw.id,
        category,
        model,
        input_params: cleanObject(raw.input_params),
        output_params: {
            resultUrl: typeof resultUrl === 'string' && (isHttpUrl(resultUrl) || outputs.some((o) => o.value === resultUrl)) ? resultUrl.slice(0, LIMITS.text) : null,
            outputs,
        },
        params: cleanObject(raw.params),
        position: cleanPosition(raw.position),
    };
}

function cleanEdge(raw, ids) {
    if (!raw || typeof raw !== 'object') return null;
    const { source, target } = raw;
    if (!ids.has(source) || !ids.has(target) || source === target) return null;
    const handle = (value) => (typeof value === 'string' && HANDLE.test(value) ? value : null);
    const id = typeof raw.id === 'string' && raw.id.length <= 120 && /^[A-Za-z0-9_.:-]+$/.test(raw.id) ? raw.id : `e-${source}-${target}`;
    return { id, source, target, sourceHandle: handle(raw.sourceHandle), targetHandle: handle(raw.targetHandle) };
}

// {nodes, edges} from a builder payload ({edges, data:{nodes}}), bounded.
export function cleanGraph(body) {
    const rawNodes = Array.isArray(body?.data?.nodes) ? body.data.nodes : Array.isArray(body?.nodes) ? body.nodes : [];
    if (rawNodes.length > LIMITS.nodes) throw badRequest(`A workflow can have at most ${LIMITS.nodes} steps.`, 'nodes');
    const rawEdges = Array.isArray(body?.edges) ? body.edges : [];
    if (rawEdges.length > LIMITS.edges) throw badRequest(`A workflow can have at most ${LIMITS.edges} connections.`, 'edges');
    const nodes = [];
    const ids = new Set();
    for (const raw of rawNodes) {
        const node = cleanNode(raw);
        if (!node || ids.has(node.id)) continue;
        ids.add(node.id);
        nodes.push(node);
    }
    const edges = [];
    const seen = new Set();
    for (const raw of rawEdges) {
        const edge = cleanEdge(raw, ids);
        if (!edge) continue;
        const key = `${edge.source}|${edge.target}|${edge.sourceHandle}|${edge.targetHandle}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(edge);
    }
    return { nodes, edges };
}

// Locale for server-made copy (node names, template names): ?locale=<code>,
// else the page the request came from (/zh/studio/… → zh), else English.
export function requestLocale(request) {
    const url = new URL(request.url);
    const explicit = url.searchParams.get('locale');
    if (isSupportedLocale(explicit)) return explicit;
    // Only the language is taken from the referring page, so its host
    // doesn't matter (behind a proxy request.url may name another host).
    const referer = request.headers.get('referer');
    if (referer) {
        try {
            return getLocaleFromPathname(new URL(referer).pathname);
        } catch {
            // ignore
        }
    }
    return 'en';
}
