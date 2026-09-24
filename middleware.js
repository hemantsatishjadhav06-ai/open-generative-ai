import { NextResponse } from 'next/server';
import { getLocaleFromPathname } from './lib/locales';
import { hasApiKey, bodyTooLarge } from './lib/proxyGuards';

// Only the Reelty origin may be framed (not every *.up.railway.app app).
// NEXT_PUBLIC_REELTY_URL is inlined at build time here and in
// components/StandaloneShell.js, so the iframe src and this CSP agree.
const DEFAULT_REELTY_URL = 'https://web-production-0e433.up.railway.app';
let reeltyOrigin = DEFAULT_REELTY_URL;
try {
    reeltyOrigin = new URL(process.env.NEXT_PUBLIC_REELTY_URL || DEFAULT_REELTY_URL).origin;
} catch {
    // keep default
}

// Optional analytics beacon target (see lib/analytics.js). A relative
// endpoint is already covered by 'self'.
const ANALYTICS_ORIGIN = (() => {
    try {
        const u = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
        return u && /^https?:/.test(u) ? new URL(u).origin : '';
    } catch {
        return '';
    }
})();

// 'unsafe-inline' stays for scripts because the app router emits inline
// `self.__next_f.push` scripts (removing it needs nonces). 'unsafe-eval' is
// only needed by `next dev`.
const scriptSrc = process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

// connect-src covers *.muapi.ai (not just api.muapi.ai) because generated
// media, model thumbnails, and other assets are served from cdn.muapi.ai
// and other muapi subdomains that the renderer fetches directly.
const connectSrc = "connect-src 'self' https://muapi.ai https://*.muapi.ai" + (ANALYTICS_ORIGIN ? ` ${ANALYTICS_ORIGIN}` : '');

const CSP = `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; ${connectSrc}; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' ${reeltyOrigin};`;

function addSecurityHeaders(response) {
    // Prevent MIME type sniffing (CWE-693)
    response.headers.set('X-Content-Type-Options', 'nosniff');
    // Prevent clickjacking (CWE-1021)
    response.headers.set('X-Frame-Options', 'DENY');
    // Referrer policy
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy - restricts script sources to prevent XSS (CWE-79).
    response.headers.set('Content-Security-Policy', CSP);
    // Browsers ignore HSTS over plain http, so local `next start` is unaffected.
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    // The Reelty iframe relies on clipboard + fullscreen, so those stay allowed.
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    return response;
}

// TODO: add rate limiting for /api/* (edge middleware or Upstash) before
// this deployment sees real traffic; today only a key and a body cap gate it.
export function middleware(request) {
    const url = request.nextUrl;

    // Body size cap for every proxy route.
    if (url.pathname.startsWith('/api/') && bodyTooLarge(request.headers)) {
        return addSecurityHeaders(NextResponse.json({ error: 'Payload too large' }, { status: 413 }));
    }

    // Catch requests to /api/workflow, /api/app, and /api/v1
    const isMuApi = url.pathname.startsWith('/api/workflow') ||
                    url.pathname.startsWith('/api/app') ||
                    url.pathname.startsWith('/api/v1');

    if (isMuApi) {
        // Exclude paths that have their own dedicated route handlers with custom logic
        const isHandledByRoute = url.pathname.startsWith('/api/v1/creative-agent') ||
                                url.pathname.startsWith('/api/v1/get_upload_url') ||
                                url.pathname.startsWith('/api/v1/upload-binary');

        if (url.pathname.startsWith('/api/v1') && !isHandledByRoute) {
            if (request.method !== 'OPTIONS' && !hasApiKey(request.headers)) {
                return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized: Missing API key' }, { status: 401 }));
            }
            const targetUrl = new URL(url.pathname + url.search, 'https://api.muapi.ai');
            // Never forward browser cookies (they carry muapi_key) upstream.
            const forwardHeaders = new Headers(request.headers);
            forwardHeaders.delete('cookie');
            const rewriteResponse = NextResponse.rewrite(targetUrl, { request: { headers: forwardHeaders } });
            return addSecurityHeaders(rewriteResponse);
        }
    }

    // Returning visitors with a saved key skip the landing page.
    if ((url.pathname === '/' || url.pathname === '/zh') && request.cookies.get('muapi_key')?.value) {
        const dest = url.pathname === '/zh' ? '/zh/studio' : '/studio';
        return addSecurityHeaders(NextResponse.redirect(new URL(dest, request.url), 307));
    }

    // Plain response header carrying the locale derived from the URL path
    // (same "set in middleware, read via headers() in the root layout"
    // trick the main muapi client uses — see the header comment in lib/locales.js).
    const response = NextResponse.next();
    response.headers.set('x-locale', getLocaleFromPathname(url.pathname));
    return addSecurityHeaders(response);
}

// Match all paths for security headers. Exclude Next.js internal paths.
export const config = {
    matcher: [
        '/api/:path*',
        '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame).*)',
    ],
};
