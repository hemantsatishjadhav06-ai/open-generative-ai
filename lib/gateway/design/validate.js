// Field sanitisers for the design agent (CreativeCanvas). Everything the
// browser sends — session names, chat text, the canvas snapshot, the saved
// transcript — passes through here before it is stored or shown to a model:
// control characters are stripped, sizes are bounded and every URL must be
// plain http(s).

import { errors } from '../errors.js';
import { cleanText, cleanUrl } from '../agents/validate.js';

export { cleanText, cleanUrl };

export const LIMITS = {
    name: 80,
    message: 8_000,
    skillInput: 4_000,
    content: 20_000,
    transcript: 200,
    events: 120,
    eventBytes: 6_000,
    attachments: 8,
    sessions: 200,
    assets: 500,
    canvasNodes: 150,
    prompt: 2_000,
};

export const ASSET_KINDS = ['image', 'video', 'audio'];
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const JOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ASSET_LABEL = /^asset_[1-9][0-9]{0,4}$/;
const EVENT_TYPES = new Set(['text', 'info', 'error', 'tool_call', 'tool_result', 'plan_propose', 'canvas_op']);

export function isSessionId(value) {
    return typeof value === 'string' && SESSION_ID.test(value);
}

export function isJobId(value) {
    return typeof value === 'string' && JOB_ID.test(value);
}

// "asset_3", "@asset_3" or " Asset_3 " → "asset_3"; anything else → ''.
export function assetLabel(value) {
    if (typeof value !== 'string') return '';
    const label = value.trim().replace(/^@/, '').toLowerCase();
    return ASSET_LABEL.test(label) ? label : '';
}

// Labels the user referenced in a message (@asset_3 or plain asset_3).
export function mentionedLabels(text) {
    const found = new Set();
    for (const match of String(text || '').matchAll(/(?:^|[^A-Za-z0-9_])@?(asset_[1-9][0-9]{0,4})(?![A-Za-z0-9_])/gi)) {
        found.add(match[1].toLowerCase());
    }
    return [...found];
}

export function cleanLabels(value, { max = LIMITS.attachments } = {}) {
    const list = Array.isArray(value) ? value : [value];
    const out = [];
    for (const item of list) {
        const label = assetLabel(typeof item === 'object' && item ? item.asset_label : item);
        if (label && !out.includes(label)) out.push(label);
        if (out.length >= max) break;
    }
    return out;
}

export function cleanSessionName(value, { required = false } = {}) {
    return cleanText(value, { field: 'name', max: LIMITS.name, required, multiline: false, truncate: true });
}

const finite = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

// Canvas snapshot from CanvasArea.getCanvasState(): only labelled asset
// nodes, rounded numbers, bounded count.
export function cleanCanvasState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const nodes = [];
    for (const node of Array.isArray(value.nodes) ? value.nodes.slice(0, LIMITS.canvasNodes) : []) {
        const label = assetLabel(node?.asset_id);
        if (!label) continue;
        nodes.push({
            asset_id: label,
            kind: ASSET_KINDS.includes(node.kind) ? node.kind : 'image',
            x: Math.round(finite(node.x)),
            y: Math.round(finite(node.y)),
            w: Math.max(1, Math.round(finite(node.w, 200))),
            h: Math.max(1, Math.round(finite(node.h, 200))),
        });
    }
    const viewport = value.viewport && typeof value.viewport === 'object'
        ? { w: Math.round(finite(value.viewport.w, 1200)), h: Math.round(finite(value.viewport.h, 800)) }
        : null;
    return { nodes, selected: assetLabel(value.selected) || null, ...(viewport ? { viewport } : {}) };
}

function httpUrl(value) {
    if (typeof value !== 'string' || value.length > 2_048) return null;
    try {
        const url = new URL(value);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.toString();
    } catch {
        // not a URL
    }
    return null;
}

function cleanAssetRef(value) {
    if (!value || typeof value !== 'object') return null;
    const url = httpUrl(value.url);
    const label = assetLabel(value.asset_label);
    if (!url && !label) return null;
    return {
        ...(label ? { asset_label: label } : {}),
        ...(url ? { url } : {}),
        kind: ASSET_KINDS.includes(value.kind) ? value.kind : 'image',
    };
}

function shortText(value, max) {
    return typeof value === 'string' ? cleanText(value, { field: 'text', max, truncate: true }) : undefined;
}

// A plain JSON copy (drops functions, cycles, huge values). Returns
// undefined when the value does not fit `maxBytes`.
function boundedJson(value, maxBytes) {
    if (value === undefined) return undefined;
    try {
        const text = JSON.stringify(value);
        if (text === undefined || text.length > maxBytes) return undefined;
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function cleanEvent(event) {
    if (!event || typeof event !== 'object' || !EVENT_TYPES.has(event.type)) return null;
    const out = { type: event.type };
    if (Number.isInteger(event.id) && event.id > 0) out.id = event.id;
    if (isJobId(event.job_id)) out.job_id = event.job_id;
    if (event.handled === true) out.handled = true;
    const content = shortText(event.content, LIMITS.content);
    if (content !== undefined) out.content = content;
    const message = shortText(event.message, 1_000);
    if (message !== undefined) out.message = message;
    if (typeof event.name === 'string' && /^[a-z_]{1,40}$/.test(event.name)) out.name = event.name;
    const args = boundedJson(event.args, 2_000);
    if (args && typeof args === 'object') out.args = args;
    const result = boundedJson(event.result, 2_000);
    if (result && typeof result === 'object') out.result = result;
    const asset = cleanAssetRef(event.asset);
    if (asset) out.asset = asset;
    return boundedJson(out, LIMITS.eventBytes) ? out : null;
}

function cleanMessage(message) {
    if (!message || typeof message !== 'object') return null;
    if (message.role !== 'user' && message.role !== 'assistant') return null;
    const out = { role: message.role, content: shortText(message.content, LIMITS.content) || '' };
    if (typeof message.timestamp === 'string' && message.timestamp.length <= 40 && !Number.isNaN(Date.parse(message.timestamp))) {
        out.timestamp = message.timestamp;
    }
    const skill = shortText(message.skill_name, LIMITS.name);
    if (skill) out.skill_name = skill;
    if (isJobId(message.job_id)) out.job_id = message.job_id;
    if (Array.isArray(message.attachments) && message.attachments.length) {
        const attachments = message.attachments.slice(0, LIMITS.attachments).map(cleanAssetRef).filter(Boolean);
        if (attachments.length) out.attachments = attachments;
    }
    if (Array.isArray(message.events) && message.events.length) {
        const events = message.events.slice(-LIMITS.events).map(cleanEvent).filter(Boolean);
        if (events.length) out.events = events;
    }
    return out;
}

// The chat transcript the canvas saves (PATCH …/messages). Invalid entries
// are dropped; the newest LIMITS.transcript messages are kept.
export function cleanTranscript(value) {
    if (!Array.isArray(value)) throw errors.badRequest('messages must be a list.', 'messages');
    return value.slice(-LIMITS.transcript).map(cleanMessage).filter(Boolean);
}

export { cleanEvent as cleanTranscriptEvent };
