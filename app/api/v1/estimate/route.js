// POST /api/v1/estimate {model, payload} → {cost, currency:'USD'} (cost is
// null for unknown or disabled models). Estimates never call a model.
import { json, readJson, route } from '../../../../lib/gateway/http.js';
import { estimateCost } from '../../../../lib/gateway/router.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route('v1-estimate', async (request) => {
    const body = await readJson(request, { maxBytes: 256 * 1024 });
    const cost = await estimateCost(body.model, body.payload);
    return json({ cost, currency: 'USD', model: typeof body.model === 'string' ? body.model : null });
}, { session: true, rate: 'estimate' });
