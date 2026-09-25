// GET /api/v1/models/available → {enabled:[keys], disabled:[keys],
// disabled_models:[studio model ids]} — the public-safe list the studio
// pickers filter by (hide disabled keys and disabled_models). No session needed.
import { getCatalog } from '../../../../../lib/gateway/catalogLoader.js';
import { isConfigured } from '../../../../../lib/gateway/config.js';
import { json, route } from '../../../../../lib/gateway/http.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route('v1-models', async () => {
    const catalog = await getCatalog();
    const { enabled = [], disabled = [], disabled_models: disabledModels = [] } = catalog.listAvailable() || {};
    return json(
        { enabled: [...enabled], disabled: [...disabled], disabled_models: [...disabledModels], configured: isConfigured() },
        { headers: { 'Cache-Control': 'public, max-age=60' } },
    );
});
