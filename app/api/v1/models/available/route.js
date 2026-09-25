// GET /api/v1/models/available → {enabled:[keys], disabled:[keys],
// disabled_models:[studio model ids], thumbnails:{key: fal thumbnail URL},
// served_by:{key: model that actually runs}} — the public-safe list the
// studio pickers filter by (hide disabled keys and disabled_models) and draw
// thumbnails / "Runs on …" hints from. No session needed.
import { getCatalog } from '../../../../../lib/gateway/catalogLoader.js';
import { isConfigured } from '../../../../../lib/gateway/config.js';
import { json, route } from '../../../../../lib/gateway/http.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route('v1-models', async () => {
    const catalog = await getCatalog();
    const { enabled = [], disabled = [], disabled_models: disabledModels = [] } = catalog.listAvailable() || {};
    const meta = typeof catalog.listModelMeta === 'function' ? catalog.listModelMeta() : {};
    return json(
        {
            enabled: [...enabled],
            disabled: [...disabled],
            disabled_models: [...disabledModels],
            thumbnails: { ...(meta.thumbnails || {}) },
            served_by: { ...(meta.served_by || {}) },
            configured: isConfigured(),
        },
        { headers: { 'Cache-Control': 'public, max-age=60' } },
    );
});
