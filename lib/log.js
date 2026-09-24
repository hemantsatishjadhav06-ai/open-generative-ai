// Minimal structured logging for the API proxies. Plain ESM, no deps, works
// in the edge runtime too. Only the named fields are ever logged: never
// headers, the API key, request/response bodies, full paths or query strings.

export function newReqId() {
    try {
        return globalThis.crypto.randomUUID();
    } catch {
        return Math.random().toString(36).slice(2);
    }
}

export function logProxy({ route, method, status, ms, reqId, error } = {}) {
    try {
        const level = (error || status >= 500) ? 'error' : (status >= 400 ? 'warn' : 'info');
        const line = {
            ts: new Date().toISOString(),
            level,
            route: typeof route === 'string' ? route.slice(0, 80) : null,
            method: typeof method === 'string' ? method : null,
            upstream_status: typeof status === 'number' ? status : null,
            ms: Number.isFinite(ms) ? Math.round(ms) : null,
            req_id: typeof reqId === 'string' ? reqId : null,
        };
        if (error) line.error = String(error?.message || error).slice(0, 200);
        (level === 'error' ? console.error : console.log)(JSON.stringify(line));
    } catch {
        // logging must never break a request
    }
}
