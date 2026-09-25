// Request handlers behind app/api/workflow/[[...path]]/route.js — the REST
// surface the workflow builder (packages/Vibe-Workflow/packages/workflow-builder)
// and the studio's WorkflowStudio call. Every route needs a session; data is
// scoped to the caller's workspace.
//
//   GET    get-template-workflows            built-in templates
//   GET    get-workflow-defs                 workspace workflows
//   GET    get-published-workflows           [] (no community feed on Aquora)
//   POST   create                            {workflow_id?, source_workflow_id?, name, category, edges, data:{nodes}} → {workflow_id}
//   POST   update-name/<id>                  {name}
//   POST   update-category/<id>              {category}
//   DELETE delete-workflow-def/<id>
//   GET    get-workflow-def/<id>             workflow + run_id + run_history
//   GET    <id>/node-schemas                 models per node category (from the catalog)
//   GET    <id>/api-node-schemas             {api_node_schemas:{}} (no third-party API nodes)
//   GET    <id>/api-inputs                   Playground form (the workflow's input nodes)
//   POST   <id>/api-execute                  {inputs} → {run_id}
//   POST   <id>/run                          → {run_id}   (Run All)
//   POST   <id>/node/<nodeId>/run            {run_id?, model, params} → {run_id}
//   POST   <id>/thumbnail                    {thumbnail}
//   GET    run/<runId>/status                per-step status + results
//   GET    run/<runId>/api-outputs           {status, error?, outputs:[{id,type,value}]}
//   POST   run/<runId>/cancel                stops a run
//   DELETE node-run/<nodeRunId>              removes one result from a step's history
//   POST   architect                         {prompt, workflow_id, history} → {request_id}
//   GET    poll-architect/<token>/result
// Publishing and admin templates don't exist on Aquora (404).

import { isLlmConfigured } from '../config.js';
import { GatewayError, errors } from '../errors.js';
import { json, readJson } from '../http.js';
import { cancelJob, getJob } from '../jobs.js';
import { enforceRate } from '../limits.js';
import { assertPublicMediaUrl } from '../ssrf.js';
import { pollArchitect, startArchitect } from './architect.js';
import { presentRunOutputs, presentRunStatus, reconcileRun, runHistory, startNodeRun, startWorkflowRun } from './executor.js';
import { PASSTHROUGH, nodeSchemas, schemaCopy } from './schemas.js';
import {
    deleteWorkflow,
    getRun,
    getWorkflow,
    listWorkflows,
    newWorkflowId,
    parseNodeRunId,
    parseRunId,
    putWorkflow,
    updateRun,
    updateWorkflow,
} from './store.js';
import { getTemplate, isTemplateId, listTemplates } from './templates.js';
import { cleanCategory, cleanGraph, cleanName, isHttpUrl, isNodeId, requestLocale, requireWorkflowId } from './validate.js';

const MAX_SAVE_BYTES = 2 * 1024 * 1024;
const MAX_SMALL_BYTES = 64 * 1024;

function notFound() {
    return errors.notFound("This workflow doesn't exist.");
}

// Owned workflow → {doc, owner:true}; template → {doc, owner:false}; else 404.
async function findWorkflow(cid, id, locale) {
    requireWorkflowId(id);
    const owned = await getWorkflow(cid, id);
    if (owned) return { doc: owned, owner: true };
    const template = getTemplate(id, { locale });
    if (template) return { doc: template, owner: false };
    throw notFound();
}

async function requireOwned(cid, id) {
    requireWorkflowId(id);
    const doc = await getWorkflow(cid, id);
    if (!doc) throw notFound();
    return doc;
}

function summary(doc) {
    return {
        id: doc.workflow_id,
        workflow_id: doc.workflow_id,
        name: doc.name,
        category: doc.category || 'General',
        thumbnail: doc.thumbnail || null,
        updated_at: doc.updated_at,
        created_at: doc.created_at,
    };
}

// ── CRUD ────────────────────────────────────────────────────────────────────
async function saveWorkflow(cid, body, locale) {
    const { nodes, edges } = cleanGraph(body);
    const now = new Date().toISOString();
    const name = cleanName(body?.name);
    const category = cleanCategory(body?.category);
    const targetId = typeof body?.workflow_id === 'string' && body.workflow_id ? body.workflow_id : null;
    if (targetId) {
        requireWorkflowId(targetId);
        const updated = await updateWorkflow(cid, targetId, (current) => ({ ...current, name, category, edges, data: { nodes } }));
        if (updated) return updated;
        // Not ours (a template or another workspace's id): save a copy instead.
    }
    const source = typeof body?.source_workflow_id === 'string' ? body.source_workflow_id : null;
    const doc = {
        workflow_id: newWorkflowId(),
        name,
        category,
        thumbnail: null,
        edges,
        data: { nodes },
        ...(source && (isTemplateId(source) || (await getWorkflow(cid, source).catch(() => null))) ? { source_workflow_id: source } : {}),
        created_at: now,
        updated_at: now,
    };
    if (!nodes.length && source) {
        // Duplicating with an empty payload copies the source's steps.
        const origin = getTemplate(source, { locale }) || (await getWorkflow(cid, source).catch(() => null));
        if (origin) Object.assign(doc, { edges: origin.edges, data: origin.data });
    }
    return putWorkflow(cid, doc);
}

async function workflowDef(cid, id, locale) {
    const { doc, owner } = await findWorkflow(cid, id, locale);
    const { history, lastRunId } = await runHistory(cid, doc.workflow_id);
    return {
        workflow_id: doc.workflow_id,
        name: doc.name,
        category: doc.category || 'General',
        thumbnail: doc.thumbnail || null,
        description: doc.description || '',
        edges: doc.edges || [],
        data: { nodes: doc.data?.nodes || [] },
        run_id: lastRunId,
        run_history: history,
        is_owner: owner,
        is_template: !owner,
        is_published: false,
        show_temp_button: false,
    };
}

// Playground form: one field per input ("passthrough") node.
function apiInputs(doc, locale) {
    const t = schemaCopy(locale);
    const labels = { text: t.text, image: t.image, video: t.video, audio: t.audio };
    const help = { text: t.textHelp, image: t.imageHelp, video: t.videoHelp, audio: t.audioHelp };
    const properties = {};
    for (const node of doc.data?.nodes || []) {
        const pass = PASSTHROUGH[node.model];
        if (!pass) continue;
        const kind = pass.category;
        const current = node.input_params?.[pass.field];
        const number = String(node.id).replace(/^\D+/, '');
        properties[node.id] = {
            type: 'string',
            title: `${labels[kind]}${number ? ` ${number}` : ''}`,
            name: node.id,
            description: help[kind],
            ...(kind !== 'text' ? { field: kind } : {}),
            ...(typeof current === 'string' && current && (kind === 'text' || isHttpUrl(current)) ? { default: current } : {}),
        };
    }
    return { input_data: { properties, required: Object.keys(properties) } };
}

// ── Runs ────────────────────────────────────────────────────────────────────
async function loadRun(cid, runId) {
    const parsed = parseRunId(runId);
    if (!parsed) throw errors.notFound('This run could not be found.');
    const run = await getRun(cid, parsed.workflowId, parsed.runKey);
    if (!run) throw errors.notFound('This run could not be found.');
    return reconcileRun(cid, run);
}

async function cancelRun(cid, runId) {
    const run = await loadRun(cid, runId);
    const jobs = new Set([run.job_id, ...Object.values(run.nodes || {}).flat().map((entry) => entry.job_id)].filter(Boolean));
    let cancelled = false;
    for (const jobId of jobs) {
        const job = getJob(jobId);
        if (job && job.cid === cid && cancelJob(job)) cancelled = true;
    }
    return { run_id: run.run_id, cancelled };
}

async function deleteNodeRun(cid, nodeRunId) {
    const parsed = parseNodeRunId(nodeRunId);
    if (!parsed) throw errors.notFound('This result could not be found.');
    let removed = false;
    await updateRun(cid, parsed.workflowId, parsed.runKey, (run) => {
        for (const [nodeId, entries] of Object.entries(run.nodes || {})) {
            const kept = entries.filter((entry) => entry.node_run_id !== nodeRunId || entry.status === 'processing' || entry.status === 'pending');
            if (kept.length !== entries.length) {
                removed = true;
                run.nodes[nodeId] = kept;
            }
        }
        return removed ? run : undefined;
    });
    if (!removed) throw errors.notFound('This result could not be found.');
    return { deleted: true, node_run_id: nodeRunId };
}

// ── dispatch ────────────────────────────────────────────────────────────────
export async function handleWorkflow(request, { params, session, ip }) {
    const segments = (Array.isArray(params?.path) ? params.path : []).map((s) => String(s));
    const method = request.method.toUpperCase();
    const cid = session.cid;
    const identity = { sid: session.sid, cid: session.cid, ip };
    const locale = requestLocale(request);
    const [first, second, third, fourth] = segments;
    const count = segments.length;

    // Collections and top-level actions.
    if (count === 1) {
        if (first === 'get-template-workflows' && method === 'GET') return json(listTemplates({ locale, llm: isLlmConfigured() }));
        if (first === 'get-workflow-defs' && method === 'GET') return json((await listWorkflows(cid)).map(summary));
        if (first === 'get-published-workflows' && method === 'GET') return json([]);
        if (first === 'create' && method === 'POST') {
            enforceRate('session', identity);
            const body = await readJson(request, { maxBytes: MAX_SAVE_BYTES });
            const doc = await saveWorkflow(cid, body, locale);
            return json({ workflow_id: doc.workflow_id, name: doc.name, updated_at: doc.updated_at });
        }
        if (first === 'architect' && method === 'POST') {
            if (!isLlmConfigured()) throw errors.notConfigured('The AI text service');
            enforceRate('llm', identity);
            const body = await readJson(request, { maxBytes: MAX_SMALL_BYTES });
            const workflowId = typeof body.workflow_id === 'string' && body.workflow_id ? body.workflow_id : null;
            const workflow = workflowId ? (await findWorkflow(cid, workflowId, locale).catch(() => null))?.doc : null;
            return json(await startArchitect({ session, body, workflow, locale }));
        }
        throw errors.notFound();
    }

    if (count === 2) {
        if (first === 'update-name' && method === 'POST') {
            enforceRate('session', identity);
            await requireOwned(cid, second);
            const body = await readJson(request, { maxBytes: MAX_SMALL_BYTES });
            const doc = await updateWorkflow(cid, second, (current) => ({ ...current, name: cleanName(body.name, current.name) }));
            return json({ workflow_id: doc.workflow_id, name: doc.name });
        }
        if (first === 'update-category' && method === 'POST') {
            enforceRate('session', identity);
            await requireOwned(cid, second);
            const body = await readJson(request, { maxBytes: MAX_SMALL_BYTES });
            const doc = await updateWorkflow(cid, second, (current) => ({ ...current, category: cleanCategory(body.category) }));
            return json({ workflow_id: doc.workflow_id, category: doc.category });
        }
        if (first === 'delete-workflow-def' && method === 'DELETE') {
            enforceRate('session', identity);
            await requireOwned(cid, second);
            await deleteWorkflow(cid, second);
            return json({ deleted: true, workflow_id: second });
        }
        if (first === 'get-workflow-def' && method === 'GET') return json(await workflowDef(cid, second, locale));
        if (first === 'node-run' && method === 'DELETE') {
            enforceRate('session', identity);
            return json(await deleteNodeRun(cid, second));
        }
        // <id>/<action>
        const id = first;
        if (second === 'node-schemas' && method === 'GET') {
            requireWorkflowId(id);
            return json(await nodeSchemas({ locale }));
        }
        if (second === 'api-node-schemas' && method === 'GET') {
            requireWorkflowId(id);
            return json({ api_node_schemas: {} });
        }
        if (second === 'api-inputs' && method === 'GET') {
            const { doc } = await findWorkflow(cid, id, locale);
            return json(apiInputs(doc, locale));
        }
        if ((second === 'run' || second === 'api-execute') && method === 'POST') {
            enforceRate('submit', identity);
            const body = await readJson(request, { maxBytes: MAX_SAVE_BYTES });
            const { doc } = await findWorkflow(cid, id, locale);
            const mode = second === 'run' ? 'full' : 'api';
            return json(await startWorkflowRun({ session, workflow: doc, mode, overrides: body.inputs, locale }));
        }
        if (second === 'thumbnail' && method === 'POST') {
            enforceRate('session', identity);
            await requireOwned(cid, id);
            const body = await readJson(request, { maxBytes: MAX_SMALL_BYTES });
            if (!isHttpUrl(body.thumbnail)) throw errors.badRequest('Pick an image result to use as the cover.', 'thumbnail');
            await assertPublicMediaUrl(body.thumbnail.trim(), { field: 'thumbnail' });
            await updateWorkflow(cid, id, (current) => ({ ...current, thumbnail: body.thumbnail.trim().slice(0, 2048) }));
            return json({ success: true });
        }
        throw errors.notFound();
    }

    if (count === 3) {
        if (first === 'run') {
            if (third === 'status' && method === 'GET') return json(presentRunStatus(await loadRun(cid, second)));
            if (third === 'api-outputs' && method === 'GET') return json(presentRunOutputs(await loadRun(cid, second)));
            if (third === 'cancel' && method === 'POST') return json(await cancelRun(cid, second));
            throw errors.notFound();
        }
        if (first === 'poll-architect' && third === 'result' && method === 'GET') {
            return json(await pollArchitect({ token: second, session }));
        }
        throw errors.notFound();
    }

    if (count === 4 && second === 'node' && fourth === 'run' && method === 'POST') {
        enforceRate('submit', identity);
        if (!isNodeId(third)) throw errors.notFound('This step could not be found.');
        const body = await readJson(request, { maxBytes: MAX_SAVE_BYTES });
        const { doc } = await findWorkflow(cid, first, locale);
        return json(await startNodeRun({
            session,
            workflow: doc,
            nodeId: third,
            model: typeof body.model === 'string' ? body.model : undefined,
            params: body.params,
            runId: typeof body.run_id === 'string' ? body.run_id : null,
            locale,
        }));
    }

    // workflow/<id>/publish and workflow/<id>/template: no community or admin templates.
    if (first === 'workflow') throw new GatewayError(404, 'not_supported', "Publishing workflows isn't available on Aquora.");
    throw errors.notFound();
}

