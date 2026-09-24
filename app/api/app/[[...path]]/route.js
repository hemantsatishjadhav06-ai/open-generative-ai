import { NextResponse } from 'next/server';
import { proxyToMuapi, routeLabel, MUAPI_BASE, getApiKey } from '@/lib/muapiProxy';
import { rewriteUploadUrl } from '@/lib/muapiUpstream';

async function resolve(request, params) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    const { search } = new URL(request.url);
    return { pathSegments, path, search };
}

export async function GET(request, { params }) {
    const { pathSegments, path, search } = await resolve(request, params);

    // Handle alias: get_upload_file -> get_file_upload_url
    const effectivePath = path === 'get_upload_file' ? 'get_file_upload_url' : path;

    if (effectivePath === 'get_file_upload_url' && !getApiKey(request.headers)) {
        return NextResponse.json({ error: 'Unauthorized: Missing API key' }, { status: 401 });
    }

    return proxyToMuapi(request, `${MUAPI_BASE}/app/${effectivePath}${search}`, {
        method: 'GET',
        route: routeLabel('app', pathSegments),
        transform: effectivePath === 'get_file_upload_url' ? rewriteUploadUrl : undefined,
    });
}

export async function POST(request, { params }) {
    const { pathSegments, path, search } = await resolve(request, params);
    return proxyToMuapi(request, `${MUAPI_BASE}/app/${path}${search}`, { method: 'POST', route: routeLabel('app', pathSegments) });
}

export async function DELETE(request, { params }) {
    const { pathSegments, path, search } = await resolve(request, params);
    return proxyToMuapi(request, `${MUAPI_BASE}/app/${path}${search}`, { method: 'DELETE', route: routeLabel('app', pathSegments) });
}

export async function PUT(request, { params }) {
    const { pathSegments, path, search } = await resolve(request, params);
    return proxyToMuapi(request, `${MUAPI_BASE}/app/${path}${search}`, { method: 'PUT', route: routeLabel('app', pathSegments) });
}
