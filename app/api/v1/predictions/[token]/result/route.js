// GET /api/v1/predictions/<token>/result — normalized job result.
// 200 {status:'processing'} while queued/running (never 202/404, the studio
// poller gives up on any 4xx), 200 {status:'completed', url, outputs, ...}
// or 200 {status:'failed', error}. Only the session that started the job
// can read it.
import { route } from '../../../../../../lib/gateway/http.js';
import { handleResult } from '../../../../../../lib/gateway/router.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route('v1-result', handleResult, { session: true });
