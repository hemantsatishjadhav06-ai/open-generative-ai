import { proxyToMuapi, routeLabel, MUAPI_BASE } from '@/lib/muapiProxy';

// Proxies /api/v1/creative-agent/* -> https://api.muapi.ai/api/v1/creative-agent/*
async function forward(request, params, method) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    const { search } = new URL(request.url);
    return proxyToMuapi(request, `${MUAPI_BASE}/api/v1/creative-agent/${path}${search}`, {
        method,
        route: routeLabel('creative-agent', pathSegments),
    });
}

export async function GET(request, { params }) {
    return forward(request, params, 'GET');
}

export async function POST(request, { params }) {
    return forward(request, params, 'POST');
}

export async function PATCH(request, { params }) {
    return forward(request, params, 'PATCH');
}

export async function DELETE(request, { params }) {
    return forward(request, params, 'DELETE');
}
