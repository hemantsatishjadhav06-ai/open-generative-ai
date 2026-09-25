// POST /api/app/calculate_dynamic_cost {task_name, payload} → {cost} for the
// workflow builder's cost badge (USD; null when the model is unknown).
import { json, readJson, route } from '../../../../lib/gateway/http.js';
import { estimateCost } from '../../../../lib/gateway/router.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = route('app-cost', async (request) => {
    const body = await readJson(request, { maxBytes: 256 * 1024 });
    const cost = await estimateCost(body.task_name, body.payload);
    return json({ cost, currency: 'USD' });
}, { session: true, rate: 'estimate' });
