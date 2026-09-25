// /api/v1/creative-agent/* — Aquora's own design agent API (canvas sessions,
// asset registry, agent runs and their event log). Handlers live in
// lib/gateway/design/api.js; every call needs a session and works on the
// caller's workspace.
import { handleCreativeAgent } from '../../../../../lib/gateway/design/api.js';
import { route } from '../../../../../lib/gateway/http.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Runs are background jobs: a chat submit returns as soon as it is queued.
export const maxDuration = 60;

const handler = route('creative-agent', handleCreativeAgent, { session: true });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
