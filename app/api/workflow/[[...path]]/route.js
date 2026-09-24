import { proxyToMuapi, routeLabel, MUAPI_BASE } from '@/lib/muapiProxy';

// Proxies /api/workflow/* -> https://api.muapi.ai/workflow/*
// Request/response bodies are intentionally never logged.
async function forward(request, params, method) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    const { search } = new URL(request.url);
    return proxyToMuapi(request, `${MUAPI_BASE}/workflow/${path}${search}`, {
        method,
        route: routeLabel('workflow', pathSegments),
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
