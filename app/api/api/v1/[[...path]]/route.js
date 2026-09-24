import { proxyToMuapi, routeLabel, MUAPI_BASE } from '@/lib/muapiProxy';

// Proxies /api/api/v1/* -> https://api.muapi.ai/api/v1/*
// This is required because the AiAgent library hardcodes a double /api/api
async function forward(request, params, method) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    const { search } = new URL(request.url);
    return proxyToMuapi(request, `${MUAPI_BASE}/api/v1/${path}${search}`, {
        method,
        route: routeLabel('api-v1', pathSegments),
    });
}

export async function GET(request, { params }) {
    return forward(request, params, 'GET');
}

export async function POST(request, { params }) {
    return forward(request, params, 'POST');
}
