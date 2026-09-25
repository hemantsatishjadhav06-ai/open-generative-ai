// Request handlers behind app/api/v1/creative-agent/[[...path]]/route.js —
// the REST surface the design agent canvas (packages/Open-AI-Design-Agent)
// calls. Every route needs a session; sessions and assets are scoped to the
// caller's workspace, runs (jobs) to the caller's browser session.
//
//   GET    /sessions                       [{id, name, asset_count, created_at, updated_at}]
//   POST   /sessions                       {name?} → session
//   PATCH  /sessions/<id>                  {name} → session
//   DELETE /sessions/<id>                  → {deleted:true}
//   GET    /sessions/<id>/messages         transcript [{role, content, events?, attachments?, …}]
//   PATCH  /sessions/<id>/messages         {messages} → {saved:n}
//   GET    /sessions/<id>/assets           [{asset_label, url, kind, source_tool, model, prompt}]
//   POST   /sessions/<id>/assets           {url, kind} → asset (uploads: /api/v1/upload_file first)
//   GET    /sessions/<id>/jobs             [{id, status, created_at}] (this browser's runs)
//   POST   /sessions/<id>/chat             {message, attachments?, canvas_state?} → {job_id}
//   POST   /sessions/<id>/run-skill        {skill_id|skill_name, inputs, attachments?, canvas_state?} → {job_id}
//   GET    /agent-skills                   [{id, name, description, inputs}]
//   GET    /jobs/<id>/events?since=<n>     {events, cursor, done, approved:null, status}
//   GET    /jobs/<id>/status               {id, status, done, error?}
//   POST   /jobs/<id>/cancel | reject      stop a run
//   POST   /jobs/<id>/approve              409 (runs never wait for approval)
// Fields the old hosted service accepted but Aquora ignores: `model` (the
// server picks OPENROUTER_MODEL_AGENT) and `messages_snapshot` (the server
// keeps its own history).

import { isLlmConfigured } from '../config.js';
import { GatewayError, errors } from '../errors.js';
import { json, readJson } from '../http.js';
import { cancelJob, loadJob } from '../jobs.js';
import { checkRate, enforceRate } from '../limits.js';
import { jobEvents } from '../pipelines/index.js';
import { assertPublicMediaUrl } from '../ssrf.js';
import { getLocaleFromPathname, isSupportedLocale } from '../../locales.js';
import { startDesignRun } from './run.js';
import { findDesignSkill, listDesignSkills, skillForRun } from './skills.js';
import {
    addAsset,
    createSession,
    deleteSession,
    getMessages,
    getSessionDoc,
    listAssets,
    listSessions,
    presentAsset,
    presentSession,
    renameSession,
    saveMessages,
} from './store.js';
import { ASSET_KINDS, LIMITS, cleanCanvasState, cleanLabels, cleanText, cleanUrl, isJobId } from './validate.js';

const MAX_WRITE_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;
const MAX_CHAT_BYTES = 256 * 1024;

// Locale for skill copy: ?locale=<code>, else the studio page the request
// came from (/zh/studio/design-agent → zh), else English.
export function requestLocale(request) {
    const url = new URL(request.url);
    const explicit = url.searchParams.get('locale');
    if (isSupportedLocale(explicit)) return explicit;
    const referer = request.headers.get('referer');
    if (!referer) return 'en';
    try {
        const ref = new URL(referer);
        const host = String(request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host).split(',')[0].trim().toLowerCase();
        if (ref.host.toLowerCase() === host || ref.host.toLowerCase() === url.host.toLowerCase()) return getLocaleFromPathname(ref.pathname);
    } catch {
        // ignore
    }
    return 'en';
}

function requireLlm() {
    if (!isLlmConfigured()) throw errors.notConfigured('The AI text service');
}

async function ownJob(jobId, session) {
    if (!isJobId(jobId)) throw errors.notFound('This run could not be found.');
    const job = await loadJob(jobId, session.cid);
    if (!job || job.sid !== session.sid) throw errors.notFound('This run could not be found.');
    return job;
}

function jobStatus(job) {
    const status = job.status === 'processing' ? 'processing' : job.status;
    return { id: job.id, status, done: status !== 'processing', ...(job.error ? { error: job.error } : {}) };
}

// Asset labels the user attached (bounded; unknown labels are dropped by
// the run). @asset_N mentions stay in the text and are resolved by the run.
function runLabels(body) {
    return cleanLabels(Array.isArray(body?.attachments) ? body.attachments : [], { max: LIMITS.attachments });
}

async function handleJobs(request, segments, { session, ip }) {
    const method = request.method.toUpperCase();
    const [, jobId, action] = segments;
    if (segments.length !== 3) throw errors.notFound();
    if (action === 'events' && method === 'GET') {
        await ownJob(jobId, session);
        const since = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get('since')) || 0));
        // An over-eager poller gets "nothing new" instead of an error.
        if (checkRate('poll', { sid: session.sid, ip })) return json({ events: [], cursor: since, done: false, approved: null, status: 'processing' });
        const page = await jobEvents({ jobId, session, since });
        const job = await loadJob(jobId, session.cid);
        return json({ ...page, approved: null, status: job?.status || 'failed', ...(job?.error ? { error: job.error } : {}) });
    }
    if (action === 'status' && method === 'GET') return json(jobStatus(await ownJob(jobId, session)));
    if ((action === 'cancel' || action === 'reject') && method === 'POST') {
        enforceRate('session', { sid: session.sid, ip });
        const job = await ownJob(jobId, session);
        const cancelled = typeof job.controller?.abort === 'function' ? cancelJob(job) : false;
        return json({ ...jobStatus(job), cancelled });
    }
    if (action === 'approve' && method === 'POST') {
        await ownJob(jobId, session);
        throw new GatewayError(409, 'nothing_to_approve', 'This run is not waiting for approval.');
    }
    throw errors.notFound();
}

async function handleSession(request, segments, { session, ip }) {
    const method = request.method.toUpperCase();
    const cid = session.cid;
    const identity = { sid: session.sid, cid: session.cid, ip };
    const [, sessionId, action, extra] = segments;
    if (extra !== undefined) throw errors.notFound();

    if (!action) {
        if (method === 'GET') return json(presentSession(await getSessionDoc(cid, sessionId)));
        if (method === 'PATCH' || method === 'PUT') {
            enforceRate('session', identity);
            const body = await readJson(request, { maxBytes: MAX_WRITE_BYTES });
            return json(presentSession(await renameSession(cid, sessionId, body.name)));
        }
        if (method === 'DELETE') {
            enforceRate('session', identity);
            const doc = await deleteSession(cid, sessionId);
            // Stop this browser's runs in the deleted canvas.
            for (const entry of doc.jobs || []) {
                if (entry?.sid !== session.sid) continue;
                const job = await loadJob(entry.id, cid);
                if (job?.status === 'processing' && job.controller) cancelJob(job);
            }
            return json({ deleted: true, id: doc.id });
        }
        throw errors.notFound();
    }

    if (action === 'messages') {
        if (method === 'GET') return json(await getMessages(cid, sessionId));
        if (method === 'PATCH' || method === 'PUT') {
            enforceRate('session', identity);
            const body = await readJson(request, { maxBytes: MAX_TRANSCRIPT_BYTES });
            const saved = await saveMessages(cid, sessionId, body.messages);
            return json({ saved: saved.length });
        }
        throw errors.notFound();
    }

    if (action === 'assets') {
        if (method === 'GET') return json(await listAssets(cid, sessionId));
        if (method === 'POST') {
            enforceRate('session', identity);
            const body = await readJson(request, { maxBytes: MAX_WRITE_BYTES });
            const url = cleanUrl(body.url, { field: 'url', required: true });
            await assertPublicMediaUrl(url, { field: 'url' });
            const kind = ASSET_KINDS.includes(body.kind) ? body.kind : null;
            if (!kind) throw errors.badRequest('kind must be image, video or audio.', 'kind');
            const asset = await addAsset(cid, sessionId, { url, kind, source_tool: 'upload' });
            return json(presentAsset(asset), { status: 201 });
        }
        throw errors.notFound();
    }

    if (action === 'jobs' && method === 'GET') {
        const doc = await getSessionDoc(cid, sessionId);
        const out = [];
        for (const entry of [...(doc.jobs || [])].reverse()) {
            if (entry?.sid !== session.sid || !isJobId(entry.id)) continue;
            const job = await loadJob(entry.id, cid);
            out.push({ id: entry.id, status: job ? job.status : 'expired', created_at: entry.created_at });
        }
        return json(out);
    }

    if (action === 'chat' && method === 'POST') {
        requireLlm();
        enforceRate('llm', identity);
        const body = await readJson(request, { maxBytes: MAX_CHAT_BYTES });
        const text = cleanText(body.message, { field: 'message', max: LIMITS.message });
        const { jobId } = await startDesignRun({
            session,
            sessionId,
            text,
            attachments: runLabels(body),
            canvas: cleanCanvasState(body.canvas_state),
        });
        return json({ job_id: jobId, status: 'processing' });
    }

    if (action === 'run-skill' && method === 'POST') {
        requireLlm();
        enforceRate('llm', identity);
        const body = await readJson(request, { maxBytes: MAX_CHAT_BYTES });
        const skill = findDesignSkill(body.skill_id) || findDesignSkill(body.skill_name);
        if (!skill) throw errors.badRequest("That skill doesn't exist.", 'skill_id');
        const inputs = body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs) ? body.inputs : {};
        const raw = typeof inputs[skill.input] === 'string' ? inputs[skill.input] : Object.values(inputs).find((value) => typeof value === 'string') ?? body.message;
        const text = cleanText(raw, { field: 'inputs', max: LIMITS.skillInput });
        const { jobId } = await startDesignRun({
            session,
            sessionId,
            text,
            attachments: runLabels(body),
            skill: skillForRun(skill, requestLocale(request)),
            canvas: cleanCanvasState(body.canvas_state),
        });
        return json({ job_id: jobId, status: 'processing' });
    }

    throw errors.notFound();
}

// ── dispatch ────────────────────────────────────────────────────────────────
export async function handleCreativeAgent(request, context) {
    const { params, session, ip } = context;
    const segments = (Array.isArray(params?.path) ? params.path : []).map((s) => String(s));
    const method = request.method.toUpperCase();
    const [first] = segments;

    if (first === 'agent-skills' && segments.length === 1 && method === 'GET') {
        return json(listDesignSkills(requestLocale(request)));
    }
    if (first === 'sessions' && segments.length === 1) {
        if (method === 'GET') return json(await listSessions(session.cid));
        if (method === 'POST') {
            enforceRate('session', { sid: session.sid, ip });
            const body = await readJson(request, { maxBytes: MAX_WRITE_BYTES });
            return json(presentSession(await createSession(session.cid, { name: body.name })), { status: 201 });
        }
        throw errors.notFound();
    }
    if (first === 'sessions') return handleSession(request, segments, context);
    if (first === 'jobs') return handleJobs(request, segments, context);
    throw errors.notFound();
}
