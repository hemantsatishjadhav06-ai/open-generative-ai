import { NextResponse } from 'next/server';
import { proxyToMuapi, MUAPI_BASE, getApiKey } from '@/lib/muapiProxy';

export async function GET(request) {
    if (!getApiKey(request.headers)) {
        return NextResponse.json({ error: 'Unauthorized: Missing API key' }, { status: 401 });
    }

    const { search } = new URL(request.url);
    return proxyToMuapi(request, `${MUAPI_BASE}/app/get_file_upload_url${search}`, {
        method: 'GET',
        route: 'get_upload_url',
    });
}
