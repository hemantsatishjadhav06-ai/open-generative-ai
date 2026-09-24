// Pure helpers shared by the /api/* MuAPI proxies (no next/server import, so
// they can be unit-tested with plain node --test).

export const MUAPI_BASE = 'https://api.muapi.ai';
export const PROXY_TIMEOUT_MS = Number(process.env.MUAPI_PROXY_TIMEOUT_MS) || 120_000;

// Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`; trims both.
export function getApiKey(headers) {
    const auth = headers?.get?.('authorization') || '';
    if (auth.startsWith('Bearer ')) {
        const token = auth.slice(7).trim();
        if (token) return token;
    }
    return (headers?.get?.('x-api-key') || '').trim() || null;
}

// Copies the browser request headers minus anything that must never reach
// MuAPI (cookies carry the muapi_key cookie; host/connection are hop-by-hop).
export function buildUpstreamHeaders(requestHeaders, apiKey) {
    const headers = new Headers(requestHeaders);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie');
    headers.delete('authorization');
    headers.delete('x-api-key');
    if (apiKey) headers.set('x-api-key', apiKey);
    return headers;
}

function stripTags(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Maps an upstream status + raw body text to what the proxy returns.
// JSON replies pass through untouched. Non-JSON replies become a JSON
// envelope: 4xx keep their status (so 401/403/429 still mean what they
// mean to the client), anything else becomes 502.
export function normalizeUpstream(status, text) {
    const body = typeof text === 'string' ? text : '';
    if (status === 204 || status === 205 || status === 304) {
        return { status, body: null };
    }
    if (body.trim() === '') {
        return { status, body: {} };
    }
    try {
        return { status, body: JSON.parse(body) };
    } catch {
        const envelope = {
            error: 'upstream_unavailable',
            message: 'The AI service returned an unexpected response. Try again in a moment.',
            upstream_status: status,
            detail: stripTags(body),
        };
        if (status >= 400 && status < 500) return { status, body: envelope };
        return { status: 502, body: envelope };
    }
}

// Network failures and timeouts never surface as a bare 500.
export function mapProxyError(error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return {
            status: 504,
            body: { error: 'upstream_timeout', message: 'The AI service took too long to respond. Try again.' },
        };
    }
    return {
        status: 502,
        body: {
            error: 'upstream_unreachable',
            message: "Couldn't reach the AI service. Check your connection and try again.",
            detail: String(error?.message || '').slice(0, 200),
        },
    };
}

// Rewrites a presigned upload URL so the browser posts the file to our
// binary proxy, which forwards it to the real (allowlisted) S3 target.
export function rewriteUploadUrl(data) {
    if (data?.url) {
        const original = data.url;
        data.url = '/api/upload-binary';
        data.fields = { ...data.fields, 'x-proxy-target-url': original };
    }
    return data;
}
