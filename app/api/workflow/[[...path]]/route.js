// /api/workflow/* — Aquora's own workflows API (CRUD, templates, node schemas
// from the gateway catalog, runs executed server-side, the architect).
// Handlers live in lib/gateway/workflows/api.js; every call needs a session
// and works on the caller's workspace.
import { handleWorkflow } from '../../../../lib/gateway/workflows/api.js';
import { route } from '../../../../lib/gateway/http.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Runs return as soon as they're queued; the heaviest request is a save.
export const maxDuration = 60;

const handler = route('workflow', handleWorkflow, { session: true });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
