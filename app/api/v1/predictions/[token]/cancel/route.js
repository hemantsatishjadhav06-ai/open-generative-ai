// POST /api/v1/predictions/<token>/cancel — cancels a queued/running job.
// A job cancelled while still queued is refunded; one already running may
// still be billed by fal and keeps its estimate.
import { route } from '../../../../../../lib/gateway/http.js';
import { handleCancel } from '../../../../../../lib/gateway/router.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route('v1-cancel', handleCancel, { session: true, rate: 'poll' });
