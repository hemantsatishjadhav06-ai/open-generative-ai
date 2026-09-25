// Request handlers behind app/api/agents/[[...path]]/route.js — the REST
// surface the agents UI (packages/Open-Poe-AI/packages/agents) and the
// studio's AgentStudio call. Every route needs a session; data is scoped to
// the caller's workspace. Chat turns start a pipeline job that the UI polls
// at /api/v1/predictions/<token>/result.
//
//   GET    /api/agents/templates/agents            built-in templates
//   GET    /api/agents/featured/agents             same as templates (no community feed)
//   GET    /api/agents/user/agents                 workspace agents
//   GET    /api/agents/user/conversations          chat list (newest first)
//   GET    /api/agents/skills                      skill registry
//   POST   /api/agents                             create → {agent_id, …}
//   POST   /api/agents/suggest                     {prompt} → drafted agent
//   GET    /api/agents/by-slug/<slug>              agent
//   PUT    /api/agents/by-slug/<slug>              update (full form or {theme})
//   DELETE /api/agents/by-slug/<slug>              delete (+ its chats)
//   POST   /api/agents/by-slug/<slug>/chat         {message, conversation_id, attachments} → {request_id}
//   POST   /api/agents/by-slug/<slug>/preview-realign {current_prompt, new_skill_ids} → {proposed_prompt}
//   GET    /api/agents/by-slug/<slug>/<conversationId>  {id, created_at, history}
//   DELETE /api/agents/by-slug/<slug>/<conversationId>  delete one chat
//   GET    /api/agents/<slug|id>[/<conversationId>]     same lookups by id
// Likes, public profiles and publishing are not part of Aquora: those paths
// answer 404.

import { isLlmConfigured } from '../config.js';
import { errors } from '../errors.js';
import { json, readJson } from '../http.js';
import { enforceRate } from '../limits.js';
import { realignPrompt, suggestAgent } from './assist.js';
import { startAgentTurn } from './chat.js';
import { listSkills } from './skills.js';
import {
    createAgent,
    deleteAgent,
    deleteConversation,
    findAgent,
    getConversation,
    listConversations,
    listTemplateAgents,
    listWorkspaceAgents,
    presentAgent,
    presentConversation,
    updateAgent,
} from './store.js';
import { isConversationId } from './validate.js';
import { getLocaleFromPathname, isSupportedLocale } from '../../locales.js';

const MAX_WRITE_BYTES = 512 * 1024;
const MAX_CHAT_BYTES = 128 * 1024;

// Locale for template copy: ?locale=<code>, else the page the request came
// from (/zh/studio/agents → zh), else English.
export function requestLocale(request) {
    const url = new URL(request.url);
    const explicit = url.searchParams.get('locale');
    if (isSupportedLocale(explicit)) return explicit;
    const referer = request.headers.get('referer');
    if (referer) {
        try {
            const ref = new URL(referer);
            const hosts = [request.headers.get('x-forwarded-host'), request.headers.get('host'), url.host]
                .filter(Boolean)
                .map((h) => String(h).split(',')[0].trim().toLowerCase());
            if (hosts.includes(ref.host.toLowerCase())) return getLocaleFromPathname(ref.pathname);
        } catch {
            // ignore
        }
    }
    return 'en';
}

function notFound() {
    return errors.notFound("This agent doesn't exist.");
}

async function requireAgent(cid, slugOrId, locale) {
    const found = await findAgent(cid, slugOrId, { locale });
    if (!found) throw notFound();
    return found;
}

function present(found, locale) {
    return presentAgent(found.doc, { owner: !found.template, locale });
}

async function conversationFor(cid, found, conversationId) {
    if (!isConversationId(conversationId)) throw errors.notFound('This chat could not be found.');
    const doc = await getConversation(cid, conversationId);
    if (!doc || doc.agent_id !== found.doc.agent_id) throw errors.notFound('This chat could not be found.');
    return doc;
}

function requireLlm() {
    if (!isLlmConfigured()) throw errors.notConfigured('The AI text service');
}

// ── dispatch ────────────────────────────────────────────────────────────────
export async function handleAgents(request, { params, session, ip }) {
    const segments = (Array.isArray(params?.path) ? params.path : []).map((s) => String(s));
    const method = request.method.toUpperCase();
    const cid = session.cid;
    const identity = { sid: session.sid, cid: session.cid, ip };
    const locale = requestLocale(request);
    const [first, second, , fourth] = segments;
    const count = segments.length;

    if (count === 0) {
        if (method === 'GET') return json((await listWorkspaceAgents(cid)).map((doc) => presentAgent(doc, { owner: true })));
        if (method === 'POST') {
            enforceRate('session', identity);
            const body = await readJson(request, { maxBytes: MAX_WRITE_BYTES });
            const doc = await createAgent(cid, body);
            return json(presentAgent(doc, { owner: true }), { status: 201 });
        }
        throw errors.notFound();
    }

    if (count === 2 && (first === 'templates' || first === 'featured') && second === 'agents' && method === 'GET') {
        return json(listTemplateAgents(locale));
    }
    if (count === 2 && first === 'user' && second === 'agents' && method === 'GET') {
        return json((await listWorkspaceAgents(cid)).map((doc) => presentAgent(doc, { owner: true })));
    }
    if (count === 2 && first === 'user' && second === 'conversations' && method === 'GET') {
        return json(await listConversations(cid, { locale }));
    }
    if (count === 1 && first === 'skills' && method === 'GET') return json(listSkills());
    if (count === 1 && first === 'suggest' && method === 'POST') {
        requireLlm();
        enforceRate('llm', identity);
        const body = await readJson(request, { maxBytes: MAX_CHAT_BYTES });
        return json(await suggestAgent({ cid, prompt: body.prompt, signal: request.signal }));
    }

    // /by-slug/<slug>[/<action|conversationId>] and /<slug|id>[/<conversationId>]
    const bySlug = first === 'by-slug';
    const ref = bySlug ? second : first;
    const rest = bySlug ? segments.slice(2) : segments.slice(1);
    if (!ref || rest.length > 1 || (bySlug && fourth !== undefined)) throw errors.notFound();
    const action = rest[0];

    if (!action) {
        const found = await requireAgent(cid, ref, locale);
        if (method === 'GET') return json(present(found, locale));
        if (method === 'PUT' || method === 'PATCH') {
            enforceRate('session', identity);
            const body = await readJson(request, { maxBytes: MAX_WRITE_BYTES });
            const doc = await updateAgent(cid, found.doc.agent_id, body);
            return json(presentAgent(doc, { owner: true }));
        }
        if (method === 'DELETE') {
            enforceRate('session', identity);
            return json(await deleteAgent(cid, found.doc.agent_id));
        }
        throw errors.notFound();
    }

    if (action === 'chat' && method === 'POST') {
        requireLlm();
        enforceRate('llm', identity);
        const found = await requireAgent(cid, ref);
        const body = await readJson(request, { maxBytes: MAX_CHAT_BYTES });
        const { body: reply } = await startAgentTurn({ session, agent: found.doc, body });
        return json(reply);
    }
    if (action === 'preview-realign' && method === 'POST') {
        requireLlm();
        enforceRate('llm', identity);
        const found = await requireAgent(cid, ref);
        const body = await readJson(request, { maxBytes: MAX_WRITE_BYTES });
        return json(await realignPrompt({
            cid,
            agent: found.doc,
            currentPrompt: body.current_prompt,
            skillIds: body.new_skill_ids ?? body.skill_ids ?? found.doc.skill_ids,
            signal: request.signal,
        }));
    }
    // Community features (likes, public profiles) do not exist on Aquora.
    if (action === 'like' || action === 'profile') throw errors.notFound();

    if (method !== 'GET' && method !== 'DELETE') throw errors.notFound();
    const found = await requireAgent(cid, ref);
    const doc = await conversationFor(cid, found, action);
    if (method === 'GET') return json(presentConversation(doc));
    enforceRate('session', identity);
    await deleteConversation(cid, doc.id);
    return json({ deleted: true, id: doc.id });
}
