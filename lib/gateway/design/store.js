// Design-agent sessions, stored per workspace in the gateway's JSON store
// (everyone signed in with the same access code shares a workspace).
//
//   ws/<cid>/design-sessions/<id>   {id, name, created_at, updated_at,
//                                    assets:[…], next_asset, history:[…], jobs:[…]}
//   ws/<cid>/design-messages/<id>   {id, messages:[…]}  (the transcript the canvas replays)
//
// The asset registry gives every file in a session a stable label
// (asset_1, asset_2, …) that the agent's tools and the canvas both use.
// `history` is the server's own compact conversation for the model; the
// transcript is display data saved by the canvas (and by finished runs).

import { GatewayError, errors } from '../errors.js';
import * as store from '../store.js';
import { ASSET_KINDS, LIMITS, cleanSessionName, cleanTranscript, cleanTranscriptEvent, isSessionId } from './validate.js';

const SESSIONS = 'design-sessions';
const MESSAGES = 'design-messages';
const MAX_HISTORY = 40;
const MAX_HISTORY_CHARS = 40_000;
const MAX_JOBS = 20;

export const DEFAULT_SESSION_NAME = 'Untitled canvas';

const nowIso = () => new Date().toISOString();

function ws(cid) {
    return store.forWorkspace(cid);
}

function notFound() {
    return errors.notFound('This canvas could not be found.');
}

// Client shape for the sessions list.
export function presentSession(doc) {
    return {
        id: doc.id,
        name: doc.name || DEFAULT_SESSION_NAME,
        asset_count: Array.isArray(doc.assets) ? doc.assets.length : 0,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
    };
}

export function presentAsset(asset) {
    return {
        asset_label: asset.asset_label,
        url: asset.url,
        kind: asset.kind,
        source_tool: asset.source_tool || null,
        model: asset.model || null,
        prompt: asset.prompt || null,
        ...(asset.source_asset_id ? { source_asset_id: asset.source_asset_id } : {}),
        created_at: asset.created_at || null,
    };
}

export async function listSessions(cid) {
    const docs = await ws(cid).list(SESSIONS, { limit: LIMITS.sessions * 2 });
    return docs
        .filter((doc) => isSessionId(doc?.id))
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .map(presentSession);
}

export async function createSession(cid, { name } = {}) {
    const existing = await ws(cid).list(SESSIONS, { limit: LIMITS.sessions + 1 });
    if (existing.length >= LIMITS.sessions) {
        throw new GatewayError(409, 'too_many_sessions', `This workspace already has ${LIMITS.sessions} canvases. Delete one to start another.`);
    }
    const now = nowIso();
    const doc = {
        id: store.newDocId(),
        name: cleanSessionName(name) || DEFAULT_SESSION_NAME,
        created_at: now,
        updated_at: now,
        assets: [],
        next_asset: 1,
        history: [],
        jobs: [],
    };
    await ws(cid).put(SESSIONS, doc.id, doc);
    await ws(cid).put(MESSAGES, doc.id, { id: doc.id, messages: [] });
    return doc;
}

export async function getSessionDoc(cid, id) {
    if (!isSessionId(id)) throw notFound();
    const doc = await ws(cid).get(SESSIONS, id);
    if (!doc) throw notFound();
    return doc;
}

// Read-modify-write on the session document (serialised per document).
async function updateSession(cid, id, fn) {
    if (!isSessionId(id)) throw notFound();
    let missing = false;
    const next = await ws(cid).update(SESSIONS, id, (doc) => {
        if (!doc) {
            missing = true;
            return undefined;
        }
        const changed = fn(doc);
        if (changed === undefined) return undefined;
        changed.updated_at = nowIso();
        return changed;
    });
    if (missing || !next) throw notFound();
    return next;
}

export async function renameSession(cid, id, name) {
    const clean = cleanSessionName(name, { required: true });
    return updateSession(cid, id, (doc) => ({ ...doc, name: clean }));
}

// Names an untitled canvas after the first request made in it.
export async function autoNameSession(cid, id, text) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ').replace(/[\s,.;:!?、，。；：！？]+$/u, '');
    const name = cleanSessionName(words.length > 48 ? `${words.slice(0, 47).trim()}…` : words);
    if (!name) return null;
    return updateSession(cid, id, (doc) => (doc.name && doc.name !== DEFAULT_SESSION_NAME ? undefined : { ...doc, name }));
}

export async function deleteSession(cid, id) {
    const doc = await getSessionDoc(cid, id);
    await ws(cid).del(SESSIONS, id);
    await ws(cid).del(MESSAGES, id);
    return doc;
}

// ── Transcript ──────────────────────────────────────────────────────────────
export async function getMessages(cid, id) {
    await getSessionDoc(cid, id);
    const doc = await ws(cid).get(MESSAGES, id);
    return Array.isArray(doc?.messages) ? doc.messages : [];
}

export async function saveMessages(cid, id, messages) {
    await getSessionDoc(cid, id);
    const clean = cleanTranscript(messages);
    await ws(cid).put(MESSAGES, id, { id, messages: clean, updated_at: nowIso() });
    await updateSession(cid, id, (doc) => ({ ...doc }));
    return clean;
}

// Server-side transcript edits made by a run: appends the user message and
// an assistant placeholder tagged with the job id, then fills it in when the
// run ends (so a closed tab still finds the reply).
export async function appendTurn(cid, id, { user, jobId }) {
    await ws(cid).update(MESSAGES, id, (doc) => {
        const messages = Array.isArray(doc?.messages) ? doc.messages : [];
        const next = [...messages, user, { role: 'assistant', content: '', events: [], job_id: jobId, timestamp: nowIso() }];
        return { id, messages: cleanTranscript(next), updated_at: nowIso() };
    });
}

export async function completeTurn(cid, id, { jobId, content, events }) {
    await ws(cid).update(MESSAGES, id, (doc) => {
        if (!doc) return undefined;
        const messages = Array.isArray(doc.messages) ? [...doc.messages] : [];
        let index = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]?.role === 'assistant' && messages[i].job_id === jobId) {
                index = i;
                break;
            }
        }
        const filled = {
            role: 'assistant',
            content: String(content || ''),
            events: (events || []).map(cleanTranscriptEvent).filter(Boolean),
            job_id: jobId,
            timestamp: index === -1 ? nowIso() : messages[index].timestamp || nowIso(),
        };
        if (index === -1) messages.push(filled);
        // The canvas may already have saved its own copy of this reply.
        else if (!messages[index].content && !(messages[index].events || []).length) messages[index] = filled;
        else return undefined;
        return { id, messages: cleanTranscript(messages), updated_at: nowIso() };
    });
}

// ── Assets ──────────────────────────────────────────────────────────────────
export async function listAssets(cid, id) {
    const doc = await getSessionDoc(cid, id);
    return (doc.assets || []).map(presentAsset);
}

// Registers a file → the stored asset (with its new label).
export async function addAsset(cid, id, { url, kind, source_tool, model, prompt, source_asset_id }) {
    if (!ASSET_KINDS.includes(kind)) throw errors.badRequest('kind must be image, video or audio.', 'kind');
    let added = null;
    await updateSession(cid, id, (doc) => {
        const assets = Array.isArray(doc.assets) ? doc.assets : [];
        // Registering the same upload twice returns its first label;
        // generated files always get a new one.
        const existing = source_tool === 'upload' ? assets.find((asset) => asset.url === url && asset.source_tool === 'upload') : null;
        if (existing) {
            added = existing;
            return undefined;
        }
        if (assets.length >= LIMITS.assets) {
            throw new GatewayError(409, 'too_many_assets', `This canvas already holds ${LIMITS.assets} files. Start a new canvas.`);
        }
        const number = Math.max(Number(doc.next_asset) || 1, assets.length + 1);
        added = {
            asset_label: `asset_${number}`,
            url,
            kind,
            source_tool: typeof source_tool === 'string' ? source_tool.slice(0, 40) : 'upload',
            model: typeof model === 'string' ? model.slice(0, 120) : null,
            prompt: typeof prompt === 'string' ? prompt.slice(0, LIMITS.prompt) : null,
            ...(source_asset_id ? { source_asset_id } : {}),
            created_at: nowIso(),
        };
        return { ...doc, assets: [...assets, added], next_asset: number + 1 };
    });
    return added;
}

// ── Model history & jobs ────────────────────────────────────────────────────
export async function appendHistory(cid, id, entries) {
    await updateSession(cid, id, (doc) => {
        const history = [...(Array.isArray(doc.history) ? doc.history : []), ...entries]
            .filter((entry) => (entry?.role === 'user' || entry?.role === 'assistant') && typeof entry.content === 'string' && entry.content);
        let kept = history.slice(-MAX_HISTORY);
        while (kept.length > 2 && kept.reduce((n, entry) => n + entry.content.length, 0) > MAX_HISTORY_CHARS) kept = kept.slice(1);
        return { ...doc, history: kept };
    });
}

export async function recordJob(cid, id, { jobId, sid, kind }) {
    await updateSession(cid, id, (doc) => ({
        ...doc,
        jobs: [...(Array.isArray(doc.jobs) ? doc.jobs : []), { id: jobId, sid, kind, created_at: nowIso() }].slice(-MAX_JOBS),
    }));
}
