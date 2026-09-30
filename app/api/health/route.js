// Liveness probe for Railway's healthcheck (railway.json -> /api/health).
// Public: configuration booleans/modes and a validated release commit, never
// keys, deployment identifiers, customer data or environment contents.
import { gateMode, isConfigured, isLlmConfigured, storageKind } from '../../../lib/gateway/config.js';
import { storeMode } from '../../../lib/gateway/store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function releaseCommit() {
    // Prefer the SHA baked into the image so a runtime variable cannot make
    // an older Docker image claim to contain a newer release.
    const raw = process.env.AQUORA_BUILD_SHA || process.env.RAILWAY_GIT_COMMIT_SHA;
    return typeof raw === 'string' && /^[a-f0-9]{40}$/i.test(raw) ? raw.toLowerCase() : null;
}

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
            commit: releaseCommit(),
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
