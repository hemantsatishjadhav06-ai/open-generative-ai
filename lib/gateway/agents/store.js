// Agents and conversations, stored per workspace in the gateway's JSON store
// (everyone signed in with the same access code shares a workspace, so every
// workspace agent is editable by its members).
//
//   ws/<cid>/agents/<slug>                  agent document
//   ws/<cid>/conversations/<id>             full conversation (history)
//   ws/<cid>/conversation-meta/<id>         list-view summary (cheap to list)
//
// Built-in templates (templates.js) are merged in on read and are read-only.

import crypto from 'node:crypto';
import { GatewayError, errors } from '../errors.js';
import * as store from '../store.js';
import { cleanIconUrl, cleanSuggestions, cleanText, cleanTheme, LIMITS } from './validate.js';
import { expandSkills, normalizeSkillIds } from './skills.js';
import { getTemplate, isTemplateSlug, listTemplates } from './templates.js';

const AGENTS = 'agents';
const CONVERSATIONS = 'conversations';
const META = 'conversation-meta';

export const MAX_AGENTS_PER_WORKSPACE = 200;
export const MAX_CONVERSATIONS_PER_WORKSPACE = 500;
export const MAX_HISTORY_MESSAGES = 200;
const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;

const nowIso = () => new Date().toISOString();

function ws(cid) {
    return store.forWorkspace(cid);
}

// ── Agents ──────────────────────────────────────────────────────────────────
export function slugify(name) {
    const base = String(name || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');
    return base || 'agent';
}

function randomSuffix() {
    return crypto.randomBytes(4).toString('hex').slice(0, 6);
}

export function isAgentSlug(value) {
    return typeof value === 'string' && SLUG.test(value);
}

// Client shape (the Open-Poe-AI UI + the studio's AgentStudio). Templates
// come back in the caller's locale.
export function presentAgent(input, { owner = false, locale = 'en' } = {}) {
    const doc = input?.is_template ? getTemplate(input.agent_id, locale) || input : input;
    if (!doc) return null;
    const skillIds = normalizeSkillIds(doc.skill_ids);
    return {
        agent_id: doc.agent_id,
        id: doc.id,
        name: doc.name,
        description: doc.description || '',
        system_prompt: doc.system_prompt || '',
        welcome_message: doc.welcome_message || '',
        icon_url: doc.icon_url || null,
        theme: doc.theme || 'cosmic',
        category: doc.category || null,
        skills: expandSkills(skillIds),
        skill_ids: skillIds,
        initial_suggestions: Array.isArray(doc.initial_suggestions) ? doc.initial_suggestions : [],
        is_owner: Boolean(owner && !doc.is_template),
        is_template: Boolean(doc.is_template),
        is_published: false,
        created_at: doc.created_at || null,
        updated_at: doc.updated_at || null,
    };
}

// Validated agent fields from a create/update body. `partial` keeps absent
// fields out of the result (PUT {theme} only changes the theme).
export function agentFields(body, { partial = false } = {}) {
    const out = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    if (!partial || has('name')) out.name = cleanText(body.name, { field: 'name', max: LIMITS.name, required: true, multiline: false });
    if (!partial || has('description')) out.description = cleanText(body.description, { field: 'description', max: LIMITS.description });
    if (!partial || has('system_prompt')) out.system_prompt = cleanText(body.system_prompt, { field: 'system_prompt', max: LIMITS.systemPrompt, required: !partial });
    if (partial && has('system_prompt') && !out.system_prompt) throw errors.badRequest('system_prompt is required.', 'system_prompt');
    if (!partial || has('welcome_message')) out.welcome_message = cleanText(body.welcome_message, { field: 'welcome_message', max: LIMITS.welcomeMessage });
    if (!partial || has('category')) out.category = cleanText(body.category, { field: 'category', max: LIMITS.category, multiline: false, truncate: true }) || null;
    if (!partial || has('icon_url')) out.icon_url = cleanIconUrl(body.icon_url) || null;
    if (!partial || has('theme')) out.theme = cleanTheme(body.theme);
    if (!partial || has('skill_ids')) {
        if (has('skill_ids') && !Array.isArray(body.skill_ids)) throw errors.badRequest('skill_ids must be a list.', 'skill_ids');
        out.skill_ids = normalizeSkillIds(body.skill_ids);
    }
    if (!partial || has('initial_suggestions')) out.initial_suggestions = cleanSuggestions(body.initial_suggestions);
    return out;
}

export async function listWorkspaceAgents(cid) {
    const docs = await ws(cid).list(AGENTS, { limit: MAX_AGENTS_PER_WORKSPACE * 2 });
    return docs
        .filter((doc) => doc && isAgentSlug(doc.agent_id))
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

// → {doc, template:boolean} | null. Accepts a slug or the agent's `id`.
export async function findAgent(cid, slugOrId, { locale = 'en' } = {}) {
    if (typeof slugOrId !== 'string' || !slugOrId) return null;
    const template = getTemplate(slugOrId, locale);
    if (template) return { doc: template, template: true };
    const key = slugOrId.toLowerCase();
    if (isAgentSlug(key)) {
        const doc = await ws(cid).get(AGENTS, key);
        if (doc) return { doc, template: false };
    }
    if (/^[A-Za-z0-9_-]{8,64}$/.test(slugOrId)) {
        const match = (await listWorkspaceAgents(cid)).find((doc) => doc.id === slugOrId);
        if (match) return { doc: match, template: false };
    }
    return null;
}

export async function createAgent(cid, body) {
    const fields = agentFields(body);
    const existing = await ws(cid).list(AGENTS, { limit: MAX_AGENTS_PER_WORKSPACE + 1 });
    if (existing.length >= MAX_AGENTS_PER_WORKSPACE) {
        throw new GatewayError(409, 'limit_reached', `This workspace already has ${MAX_AGENTS_PER_WORKSPACE} agents. Delete one to create another.`);
    }
    const base = slugify(fields.name);
    let slug = '';
    for (let attempt = 0; attempt < 8 && !slug; attempt++) {
        const candidate = `${base}-${randomSuffix()}`;
        if (!isTemplateSlug(candidate) && !(await ws(cid).get(AGENTS, candidate))) slug = candidate;
    }
    if (!slug) throw new GatewayError(500, 'internal_error', "Couldn't create the agent. Try again.");
    const now = nowIso();
    const doc = {
        ...fields,
        agent_id: slug,
        id: store.newDocId(),
        is_template: false,
        created_at: now,
        updated_at: now,
    };
    await ws(cid).put(AGENTS, slug, doc);
    return doc;
}

async function ownAgent(cid, slug) {
    const found = await findAgent(cid, slug);
    if (!found) throw errors.notFound("This agent doesn't exist.");
    if (found.template) throw new GatewayError(403, 'read_only', 'Built-in templates cannot be changed. Create your own agent to customise it.');
    return found.doc;
}

export async function updateAgent(cid, slug, body) {
    const current = await ownAgent(cid, slug);
    const fields = agentFields(body, { partial: true });
    const next = await ws(cid).update(AGENTS, current.agent_id, (doc) => {
        if (!doc) throw errors.notFound("This agent doesn't exist.");
        return { ...doc, ...fields, updated_at: nowIso() };
    });
    return next;
}

// Deletes the agent and its conversations.
export async function deleteAgent(cid, slug) {
    const current = await ownAgent(cid, slug);
    await ws(cid).del(AGENTS, current.agent_id);
    const metas = await ws(cid).list(META, { filter: (meta) => meta?.agent_id === current.agent_id, limit: MAX_CONVERSATIONS_PER_WORKSPACE * 2 });
    for (const meta of metas) await deleteConversation(cid, meta.id);
    return { deleted: true, agent_id: current.agent_id };
}

export function listTemplateAgents(locale = 'en') {
    return listTemplates(locale).map((doc) => presentAgent(doc, { locale }));
}

// ── Conversations ───────────────────────────────────────────────────────────
export async function getConversation(cid, id) {
    return ws(cid).get(CONVERSATIONS, id);
}

// {id, created_at, history:[{role, content, attachments?, media?, timestamp}]}
export function presentConversation(doc) {
    return {
        id: doc.id,
        agent_id: doc.agent_id,
        title: doc.title || null,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        history: (Array.isArray(doc.history) ? doc.history : []).map((message) => ({
            role: message.role,
            content: message.content || '',
            ...(message.attachments?.length ? { attachments: message.attachments } : {}),
            ...(message.media?.length ? { media: message.media } : {}),
            timestamp: message.timestamp,
        })),
    };
}

export async function listConversations(cid, { limit = 200, locale = 'en' } = {}) {
    const metas = await ws(cid).list(META, { limit: MAX_CONVERSATIONS_PER_WORKSPACE * 2 });
    return metas
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .slice(0, limit)
        .map((meta) => ({
            id: meta.id,
            title: meta.title || null,
            agent_id: meta.agent_id,
            agent_slug: meta.agent_id,
            agent_name: getTemplate(meta.agent_id, locale)?.name || meta.agent_name || null,
            agent_icon_url: meta.agent_icon_url || null,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            message_count: meta.message_count || 0,
        }));
}

export async function deleteConversation(cid, id) {
    await ws(cid).del(CONVERSATIONS, id);
    await ws(cid).del(META, id);
}

function titleFrom(text) {
    const line = String(text || '').replace(/\s+/g, ' ').trim();
    return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line || null;
}

async function pruneConversations(cid, keepId) {
    const metas = await ws(cid).list(META, { limit: MAX_CONVERSATIONS_PER_WORKSPACE * 2 });
    if (metas.length <= MAX_CONVERSATIONS_PER_WORKSPACE) return;
    const stale = metas
        .filter((meta) => meta.id !== keepId)
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
        .slice(0, metas.length - MAX_CONVERSATIONS_PER_WORKSPACE);
    for (const meta of stale) await deleteConversation(cid, meta.id);
}

// Appends messages to a conversation (creating it for `agent` when new) and
// refreshes its summary. Throws 409 when the id belongs to another agent.
// → the updated conversation document.
export async function appendMessages(cid, conversationId, agent, messages) {
    let created = false;
    const doc = await ws(cid).update(CONVERSATIONS, conversationId, (current) => {
        if (current && current.agent_id !== agent.agent_id) {
            throw new GatewayError(409, 'conversation_mismatch', 'This chat belongs to a different agent. Start a new chat.');
        }
        const now = nowIso();
        const base = current || { id: conversationId, agent_id: agent.agent_id, created_at: now, history: [] };
        created = !current;
        const history = [...(base.history || []), ...messages].slice(-MAX_HISTORY_MESSAGES);
        const firstUser = history.find((message) => message.role === 'user');
        return { ...base, title: base.title || titleFrom(firstUser?.content), history, updated_at: now };
    });
    await ws(cid).put(META, conversationId, {
        id: conversationId,
        agent_id: agent.agent_id,
        agent_name: agent.name,
        agent_icon_url: agent.icon_url || null,
        title: doc.title,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        message_count: doc.history.length,
    });
    if (created) await pruneConversations(cid, conversationId).catch(() => {});
    return doc;
}
