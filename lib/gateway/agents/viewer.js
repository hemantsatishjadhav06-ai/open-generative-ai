// Server-component helpers for the /agents pages: resolve the visitor's
// workspace from the session cookie (read-only — server components cannot
// set cookies, so an open-gate visitor without a cookie reads the shared
// open workspace and gets their cookie on the first API call) and load the
// agent / conversation directly from the store (no HTTP round trip).

import { getSession, OPEN_WORKSPACE } from '../session.js';
import { findAgent, getConversation, presentAgent, presentConversation } from './store.js';
import { isConversationId } from './validate.js';

// → {state:'ok', cid} | {state:'signed_out'} | {state:'setup_required'}
export function workspaceFromCookies(cookieHeader) {
    const request = { headers: new Headers(cookieHeader ? { cookie: String(cookieHeader) } : {}) };
    const { mode, session } = getSession(request);
    if (mode === 'setup_required') return { state: 'setup_required' };
    if (session) return { state: 'ok', cid: session.cid };
    if (mode === 'open') return { state: 'ok', cid: OPEN_WORKSPACE };
    return { state: 'signed_out' };
}

// → {status:'ok', agent} | {status:'missing'} | {status:'error'}
export async function loadAgentForPage(cid, slugOrId, { locale = 'en' } = {}) {
    try {
        const found = await findAgent(cid, String(slugOrId || ''), { locale });
        if (!found) return { status: 'missing' };
        return { status: 'ok', agent: presentAgent(found.doc, { owner: !found.template, locale }) };
    } catch {
        return { status: 'error' };
    }
}

// The conversation when it exists and belongs to the agent, else null (a
// brand-new chat id is normal: the first message creates it).
export async function loadConversationForPage(cid, agentSlug, conversationId) {
    if (!isConversationId(conversationId)) return null;
    try {
        const doc = await getConversation(cid, conversationId);
        if (!doc || doc.agent_id !== agentSlug) return null;
        return presentConversation(doc);
    } catch {
        return null;
    }
}
