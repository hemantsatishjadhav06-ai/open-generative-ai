// Liveness probe for Railway's healthcheck (railway.json -> /api/health).
// Public: reports only booleans and modes, never keys or counts.
import { gateMode, isConfigured, isLlmConfigured, storageKind } from '../../../lib/gateway/config.js';
import { storeMode } from '../../../lib/gateway/store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
    let storage = storageKind();
    try {
        if ((await storeMode()) !== 'disk') storage = 'ephemeral';
    } catch {
        storage = 'ephemeral';
    }
    return Response.json(
        {
            ok: true,
            fal: isConfigured(),
            openrouter: isLlmConfigured(),
            gate: gateMode(),
            storage,
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
