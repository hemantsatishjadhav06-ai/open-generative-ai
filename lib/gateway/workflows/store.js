// Workflow documents and run records, per workspace (lib/gateway/store.js):
//   workflows/<workflowId>          {workflow_id, name, category, thumbnail,
//                                    edges, data:{nodes}, source_workflow_id,
//                                    created_at, updated_at}
//   wfruns/<workflowId>/<runKey>    a run: {run_id, workflow_id, kind, status,
//                                    nodes:{<nodeId>:[entry]}, outputs, error,
//                                    job_id, created_at, updated_at}
// Public ids: run_id = "<workflowId>.<runKey>", node_run_id =
// "<workflowId>.<runKey>.<seq>", so a status poll or a history delete finds
// its run without an index. Templates (tpl-*) can be run too; their runs are
// kept in the caller's workspace like any other.

import crypto from 'node:crypto';
import * as store from '../store.js';
import { LIMITS, isWorkflowId } from './validate.js';

const WORKFLOWS = 'workflows';
const runsCol = (workflowId) => `wfruns/${workflowId}`;
const RUN_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{7,39}$/;

function ws(cid) {
    return store.forWorkspace(cid);
}

export function newWorkflowId() {
    return store.newDocId();
}

export function newRunKey() {
    return crypto.randomBytes(12).toString('base64url').replace(/^[_-]/, 'r');
}

export function runIdOf(workflowId, runKey) {
    return `${workflowId}.${runKey}`;
}

// "<workflowId>.<runKey>" → {workflowId, runKey} | null
export function parseRunId(runId) {
    if (typeof runId !== 'string' || runId.length > 120) return null;
    const parts = runId.split('.');
    if (parts.length !== 2 || !isWorkflowId(parts[0]) || !RUN_KEY.test(parts[1])) return null;
    return { workflowId: parts[0], runKey: parts[1] };
}

// "<workflowId>.<runKey>.<seq>" → {workflowId, runKey, seq} | null
export function parseNodeRunId(nodeRunId) {
    if (typeof nodeRunId !== 'string' || nodeRunId.length > 130) return null;
    const parts = nodeRunId.split('.');
    if (parts.length !== 3 || !/^\d{1,6}$/.test(parts[2])) return null;
    const run = parseRunId(`${parts[0]}.${parts[1]}`);
    return run ? { ...run, seq: Number(parts[2]) } : null;
}

// ── Workflows ───────────────────────────────────────────────────────────────
export async function getWorkflow(cid, workflowId) {
    if (!isWorkflowId(workflowId)) return null;
    return ws(cid).get(WORKFLOWS, workflowId);
}

export async function listWorkflows(cid) {
    const docs = await ws(cid).list(WORKFLOWS, { limit: 500 });
    return docs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export async function putWorkflow(cid, doc) {
    await ws(cid).put(WORKFLOWS, doc.workflow_id, doc);
    return doc;
}

export async function updateWorkflow(cid, workflowId, fn) {
    return ws(cid).update(WORKFLOWS, workflowId, (current) => {
        if (!current) return undefined;
        const next = fn(current);
        return next ? { ...next, updated_at: new Date().toISOString() } : undefined;
    });
}

export async function deleteWorkflow(cid, workflowId) {
    await ws(cid).del(WORKFLOWS, workflowId);
    const runs = await ws(cid).list(runsCol(workflowId), { limit: 5000 }).catch(() => []);
    for (const run of runs) if (run?.id) await ws(cid).del(runsCol(workflowId), run.id).catch(() => {});
}

// ── Runs ────────────────────────────────────────────────────────────────────
export async function getRun(cid, workflowId, runKey) {
    return ws(cid).get(runsCol(workflowId), runKey);
}

export async function putRun(cid, run) {
    await ws(cid).put(runsCol(run.workflow_id), run.id, run);
    return run;
}

export async function updateRun(cid, workflowId, runKey, fn) {
    return ws(cid).update(runsCol(workflowId), runKey, (current) => {
        if (!current) return undefined;
        const next = fn(current);
        if (!next) return undefined;
        next.updated_at = new Date().toISOString();
        return next;
    });
}

export async function deleteRun(cid, workflowId, runKey) {
    await ws(cid).del(runsCol(workflowId), runKey);
}

// Newest first.
export async function listRuns(cid, workflowId) {
    const runs = await ws(cid).list(runsCol(workflowId), { limit: 5000 }).catch(() => []);
    return runs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

// Keeps the newest LIMITS.runsKept finished runs of a workflow.
export async function pruneRuns(cid, workflowId) {
    const runs = await listRuns(cid, workflowId);
    const extra = runs.slice(LIMITS.runsKept).filter((run) => run.status !== 'processing');
    for (const run of extra) await deleteRun(cid, workflowId, run.id).catch(() => {});
}
