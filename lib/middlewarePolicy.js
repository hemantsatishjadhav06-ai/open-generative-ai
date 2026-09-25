// Edge-safe policy used by middleware.js: the Content-Security-Policy, the
// other security headers, and the landing → studio redirect. Plain data and
// pure functions (no Node APIs, no next/server) so tests can import it.

// Default Reelty deployment embedded in the Reelty tab (components/StandaloneShell.js
// uses the same NEXT_PUBLIC_REELTY_URL, so the iframe src and frame-src agree).
export const DEFAULT_REELTY_URL = 'https://web-production-0e433.up.railway.app';

// Cookie set by POST /api/session (lib/gateway/session.js SESSION_COOKIE).
export const SESSION_COOKIE_NAME = 'aquora_session';

// Media CDN the studios fetch() from (downloads, canvas work). Both forms are
// listed because the wildcard does not match the apex.
export const FAL_MEDIA_ORIGINS = ['https://fal.media', 'https://*.fal.media'];

function originOf(value, fallback = '') {
    try {
        return value ? new URL(value).origin : fallback;
    } catch {
        return fallback;
    }
}

// Only an absolute http(s) endpoint adds an origin; a relative one is 'self'.
export function analyticsOrigin(endpoint) {
    return endpoint && /^https?:/.test(endpoint) ? originOf(endpoint) : '';
}

export function reeltyOrigin(reeltyUrl) {
    return originOf(reeltyUrl || DEFAULT_REELTY_URL, DEFAULT_REELTY_URL);
}

// The browser only talks to this origin (the gateway) and fal's media CDN.
// Provider APIs (queue.fal.run, fal.run, rest.fal.ai, api.fal.ai,
// openrouter.ai) are called server-side only and must never be listed here.
export function connectSrc({ analyticsEndpoint } = {}) {
    const extra = analyticsOrigin(analyticsEndpoint);
    return ["'self'", ...FAL_MEDIA_ORIGINS, ...(extra ? [extra] : [])].join(' ');
}

// 'unsafe-inline' stays for scripts because the app router emits inline
// `self.__next_f.push` scripts (removing it needs nonces). 'unsafe-eval' is
// only needed by `next dev`. img-src/media-src stay at https: until every
// remote thumbnail in the studio catalog is re-hosted.
export function buildCsp({ production = true, reeltyUrl, analyticsEndpoint } = {}) {
    const scriptSrc = production
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    return [
        "default-src 'self'",
        scriptSrc,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        `connect-src ${connectSrc({ analyticsEndpoint })}`,
        "font-src 'self' data: https://fonts.gstatic.com",
        `frame-src 'self' ${reeltyOrigin(reeltyUrl)}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ') + ';';
}

export function securityHeaders(csp) {
    return {
        // Prevent MIME type sniffing (CWE-693)
        'X-Content-Type-Options': 'nosniff',
        // Prevent clickjacking (CWE-1021)
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        // Restricts script/connect/frame sources (CWE-79).
        'Content-Security-Policy': csp,
        // Browsers ignore HSTS over plain http, so local `next start` is unaffected.
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
        // The Reelty iframe relies on clipboard + fullscreen, so those stay allowed.
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    };
}

// Returning visitors with a session cookie skip the landing page. Only the
// cookie's presence is checked: node:crypto isn't available on the edge, and
// the redirect grants nothing (the studio verifies the session via
// /api/session and shows the access-code prompt when it's stale).
export function landingRedirect(pathname, hasSessionCookie) {
    if (!hasSessionCookie) return null;
    if (pathname === '/') return '/studio';
    if (pathname === '/zh') return '/zh/studio';
    return null;
}
