import { proxyToMuapi, routeLabel, MUAPI_BASE } from '@/lib/muapiProxy';

// Build the target URL without a trailing slash when path is empty.
// e.g. GET /api/agents?is_template=true  → https://api.muapi.ai/agents?is_template=true
// e.g. GET /api/agents/by-slug/foo       → https://api.muapi.ai/agents/by-slug/foo
function buildTargetUrl(pathSegments, search) {
    const path = pathSegments.join('/');
    const base = `${MUAPI_BASE}/agents`;
    return path ? `${base}/${path}${search}` : `${base}${search}`;
}

async function forward(request, params, method) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const { search } = new URL(request.url);
    return proxyToMuapi(request, buildTargetUrl(pathSegments, search), {
        method,
        route: routeLabel('agents', pathSegments),
    });
}

export async function GET(request, { params }) {
    return forward(request, params, 'GET');
}

export async function POST(request, { params }) {
    return forward(request, params, 'POST');
}

export async function DELETE(request, { params }) {
    return forward(request, params, 'DELETE');
}

export async function PUT(request, { params }) {
    return forward(request, params, 'PUT');
}
