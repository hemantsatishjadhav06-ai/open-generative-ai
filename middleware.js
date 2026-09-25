import { NextResponse } from 'next/server';
import { getLocaleFromPathname } from './lib/locales';
import { bodyTooLarge } from './lib/proxyGuards';
import { SESSION_COOKIE_NAME, buildCsp, landingRedirect, securityHeaders } from './lib/middlewarePolicy';

// Edge middleware: security headers + CSP, the declared body-size cap, the
// locale header and the landing → studio redirect. It does not authenticate:
// every paid /api route checks the HttpOnly session cookie itself
// (lib/gateway), and the browser never talks to an AI provider directly.

// NEXT_PUBLIC_* values are inlined at build time.
const HEADERS = securityHeaders(buildCsp({
    production: process.env.NODE_ENV === 'production',
    reeltyUrl: process.env.NEXT_PUBLIC_REELTY_URL,
    analyticsEndpoint: process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT,
}));

function addSecurityHeaders(response) {
    for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value);
    return response;
}

export function middleware(request) {
    const url = request.nextUrl;

    // Declared body size cap for every API route (the upload route is not
    // matched and caps its own stream; chunked bodies are capped by handlers).
    if (url.pathname.startsWith('/api/') && bodyTooLarge(request.headers, url.pathname)) {
        return addSecurityHeaders(NextResponse.json(
            { error: 'payload_too_large', message: 'The request is too large.' },
            { status: 413 },
        ));
    }

    const dest = landingRedirect(url.pathname, Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value));
    if (dest) {
        return addSecurityHeaders(NextResponse.redirect(new URL(dest, request.url), 307));
    }

    // The locale derived from the URL path, for the shared root layout and
    // not-found page (read via headers()). Set on the forwarded request so
    // server components see it; mirrored on the response for debugging.
    const locale = getLocaleFromPathname(url.pathname);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-locale', locale);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-locale', locale);
    return addSecurityHeaders(response);
}

// Every path gets the security headers, except Next internals and the upload
// route: it streams up to ~200 MB, and a middleware match makes Next buffer
// (and past experimental.middlewareClientMaxBodySize, silently truncate) the
// body. That route sets its own nosniff / no-store headers (lib/gateway/http.js).
export const config = {
    matcher: [
        '/api/((?!v1/upload_file$).*)',
        '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame|api/v1/upload_file$).*)',
    ],
};
