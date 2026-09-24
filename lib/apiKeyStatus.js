// Pure helpers for reasoning about MuAPI key checks (no React).

export function isAuthStatus(status) {
    return status === 401 || status === 403;
}

// 'unauthorized' only for a real 401/403 from the balance endpoint; network
// errors and 5xx are 'error' (the key may be fine, the service is not).
// A 401/403 whose body is the proxy's non-JSON envelope ('upstream_unavailable',
// e.g. an egress/WAF block page) says nothing about the key itself, so it
// counts as 'error' too.
export function classifyBalanceError(err) {
    const s = Number(err?.status);
    if (!isAuthStatus(s)) return 'error';
    const body = String(err?.body || err?.message || '');
    if (body.includes('upstream_unavailable')) return 'error';
    return 'unauthorized';
}
