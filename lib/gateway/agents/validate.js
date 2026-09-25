// Field sanitisers for agent documents and chat turns. Everything that comes
// from the browser (or from an LLM draft) passes through here before it is
// stored or sent to a model: control characters are stripped, lengths are
// bounded, URLs must be plain http(s), theme colours cannot load resources.

import { errors } from '../errors.js';

export const LIMITS = {
    name: 80,
    description: 600,
    systemPrompt: 12_000,
    welcomeMessage: 1_200,
    category: 40,
    suggestionLabel: 80,
    suggestionPrompt: 800,
    suggestions: 6,
    message: 8_000,
    attachments: 4,
    url: 2_048,
};

// C0/C1 control characters except tab and newline; also the Unicode
// bidi-override and zero-width-joiner family that can disguise text.
const CONTROL_MULTILINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
const CONTROL_SINGLE = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

// Cleans a string. Too long → 400 (or truncated when `truncate`).
export function cleanText(value, { field, max, required = false, multiline = true, truncate = false } = {}) {
    if (value === undefined || value === null) {
        if (required) throw errors.badRequest(`${field} is required.`, field);
        return '';
    }
    if (typeof value !== 'string') throw errors.badRequest(`${field} must be text.`, field);
    let text = value.replace(/\r\n?/g, '\n').replace(multiline ? CONTROL_MULTILINE : CONTROL_SINGLE, multiline ? '' : ' ');
    text = multiline ? text.trim() : text.replace(/\s+/g, ' ').trim();
    if (required && !text) throw errors.badRequest(`${field} is required.`, field);
    if (max && text.length > max) {
        if (!truncate) throw errors.badRequest(`${field} is too long (max ${max} characters).`, field);
        text = text.slice(0, max).trim();
    }
    return text;
}

// Plain http(s) URL without credentials, or '' when empty.
export function cleanUrl(value, { field = 'url', required = false } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) throw errors.badRequest(`${field} is required.`, field);
        return '';
    }
    if (typeof value !== 'string' || value.length > LIMITS.url) throw errors.badRequest('That link is not valid.', field);
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        throw errors.badRequest('That link is not valid.', field);
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
        throw errors.badRequest('Links must start with https://.', field);
    }
    return url.toString();
}

// Icon: an http(s) URL or one of the inline SVG icons the templates use.
const SVG_ICON = /^data:image\/svg\+xml;utf8,[A-Za-z0-9%._~!*'()-]+$/;

export function cleanIconUrl(value) {
    if (typeof value === 'string' && value.length <= 8_192 && SVG_ICON.test(value)) return value;
    return cleanUrl(value, { field: 'icon_url' });
}

// [{label, prompt}] (strings are accepted as both label and prompt). Extra
// entries beyond LIMITS.suggestions are dropped.
export function cleanSuggestions(value, { field = 'initial_suggestions' } = {}) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw errors.badRequest(`${field} must be a list.`, field);
    const out = [];
    for (const item of value.slice(0, LIMITS.suggestions * 2)) {
        if (out.length >= LIMITS.suggestions) break;
        const raw = typeof item === 'string' ? { label: item, prompt: item } : item;
        if (!raw || typeof raw !== 'object') continue;
        const text = (v) => (typeof v === 'string' ? v : undefined);
        const prompt = cleanText(text(raw.prompt) ?? text(raw.label), { field, max: LIMITS.suggestionPrompt, truncate: true });
        const label = cleanText(text(raw.label) ?? text(raw.prompt), { field, max: LIMITS.suggestionLabel, multiline: false, truncate: true });
        if (!label || !prompt) continue;
        out.push({ label, prompt });
    }
    return out;
}

// ── Themes ──────────────────────────────────────────────────────────────────
// The chat UI ships named themes (cosmic, midnight, …) and a "custom" theme
// object with 13 colour slots. Colour values end up in inline styles, so only
// colour syntax is allowed: no url(), image(), var() or anything that could
// fetch a resource or break out of the declaration.
export const THEME_COLOR_KEYS = [
    'background', 'foreground', 'muted', 'border', 'componentBg', 'componentHover', 'headerBg',
    'userBubble', 'userText', 'agentBubble', 'agentText', 'inputBg', 'accent', 'accentText',
];
const THEME_ID = /^[a-z0-9-]{1,32}$/;
const COLOR_CHARS = /^[#a-zA-Z0-9(),.%\s-]{1,200}$/;
const COLOR_FUNCTIONS = /\b([a-z-]+)\(/gi;
const ALLOWED_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'linear-gradient', 'radial-gradient', 'conic-gradient', 'color-mix', 'oklch', 'oklab']);

export function isSafeColor(value) {
    if (typeof value !== 'string' || !COLOR_CHARS.test(value)) return false;
    for (const match of value.matchAll(COLOR_FUNCTIONS)) {
        if (!ALLOWED_FUNCTIONS.has(match[1].toLowerCase())) return false;
    }
    return true;
}

export function cleanTheme(value) {
    if (value === undefined || value === null || value === '') return 'cosmic';
    if (typeof value === 'string') {
        if (!THEME_ID.test(value)) throw errors.badRequest('Unknown theme.', 'theme');
        return value;
    }
    if (typeof value !== 'object' || Array.isArray(value) || !value.colors || typeof value.colors !== 'object') {
        throw errors.badRequest('Unknown theme.', 'theme');
    }
    const colors = {};
    for (const key of THEME_COLOR_KEYS) {
        const color = value.colors[key];
        if (color === undefined) continue;
        if (!isSafeColor(color)) throw errors.badRequest('Theme colours must be plain CSS colours or gradients.', 'theme');
        colors[key] = color.trim();
    }
    const id = typeof value.id === 'string' && THEME_ID.test(value.id) ? value.id : 'custom';
    const name = cleanText(value.name ?? 'Custom Theme', { field: 'theme', max: 40, multiline: false, truncate: true }) || 'Custom Theme';
    return { id, name, colors };
}

// ── Chat turns ──────────────────────────────────────────────────────────────
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export function isConversationId(value) {
    return typeof value === 'string' && CONVERSATION_ID.test(value);
}

export function cleanConversationId(value) {
    if (value === undefined || value === null || value === '') return null;
    if (!isConversationId(value)) throw errors.badRequest('Invalid conversation id.', 'conversation_id');
    return value;
}

export function cleanAttachments(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw errors.badRequest('attachments must be a list of links.', 'attachments');
    if (value.length > LIMITS.attachments) throw errors.badRequest(`Attach at most ${LIMITS.attachments} images.`, 'attachments');
    const urls = value.map((item) => cleanUrl(typeof item === 'string' ? item : item?.url, { field: 'attachments', required: true }));
    return [...new Set(urls)];
}
