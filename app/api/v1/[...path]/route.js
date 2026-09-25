// POST /api/v1/<name> — the studios' generation submit. <name> is a
// registered server pipeline (e.g. ai-clipping) or a catalog key (the model
// id the studio posts). Replies {request_id: <job token>, status:'processing'}.
import { errors } from '../../../../lib/gateway/errors.js';
import { errorResponse, route } from '../../../../lib/gateway/http.js';
import { handleSubmit } from '../../../../lib/gateway/router.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Pipelines (clipping, agents) can run for minutes after the submit returns;
// the submit itself only waits for fal's queue acknowledgement.
export const maxDuration = 60;

export const POST = route('v1-submit', handleSubmit, { session: true, rate: 'submit' });

// Everything else under /api/v1 that has no dedicated route does not exist.
export function GET() {
    return errorResponse(errors.notFound("This endpoint doesn't exist."));
}
