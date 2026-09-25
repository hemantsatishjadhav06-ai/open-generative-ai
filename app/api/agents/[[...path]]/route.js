// /api/agents/* — Aquora's own agents API (agents, conversations, chat turns,
// builder helpers). Handlers live in lib/gateway/agents/api.js; every call
// needs a session and works on the caller's workspace.
import { handleAgents } from '../../../../lib/gateway/agents/api.js';
import { route } from '../../../../lib/gateway/http.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The chat submit returns as soon as the turn is queued; the builder helpers
// (suggest / realign) wait for one LLM reply.
export const maxDuration = 120;

const handler = route('agents', handleAgents, { session: true });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
