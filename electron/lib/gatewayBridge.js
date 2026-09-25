// Desktop bridge to an Aquora deployment's API gateway.
//
// The renderer is served from aquora://app/ (see appProtocol.js) and calls the
// gateway with same-origin relative paths (/api/session, /api/v1/...), exactly
// like the web app. Those requests land here, in the main process, and are
// forwarded to AQUORA_API_BASE (default: the hosted Aquora site).
//
// Why a main-process proxy instead of letting the renderer fetch the site
// directly: the gateway only accepts same-origin requests (CSRF check) and
// authenticates with an HttpOnly, SameSite=Lax session cookie. A page on
// another origin could never send that cookie, and should not be able to.
// Here the main process holds the cookie in Electron's persistent cookie
// store (session.defaultSession.cookies), attaches it to each forwarded
// request, and never hands it to the renderer.
//
// Nothing here ever reads, logs or forwards a provider key: the desktop app
// has none. Request bodies (prompts, uploads) are streamed through untouched
// and never logged.

const DEFAULT_API_BASE = 'https://open-generative-ai-production-4eaf.up.railway.app';
const API_BASE_ENV = 'AQUORA_API_BASE';

// Headers the renderer may pass through to the gateway. Everything else
// (cookies, origin, forwarding headers) is set by the bridge itself.
const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'content-length', 'cache-control', 'last-event-id'];
// Headers the gateway may pass back. Set-Cookie never reaches the renderer.
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'content-disposition', 'retry-after', 'x-request-id'];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalHost(hostname) {
    return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
}

/**
 * Validates AQUORA_API_BASE and returns its origin (no path, no trailing
 * slash). https is required, except plain http to this machine for local
 * development. Anything unusable falls back to the hosted site.
 * @returns {{ origin: string, fromEnv: boolean, warning: string|null }}
 */
function resolveApiBase(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return { origin: DEFAULT_API_BASE, fromEnv: false, warning: null };
    let url;
    try {
        url = new URL(raw);
    } catch {
        return { origin: DEFAULT_API_BASE, fromEnv: false, warning: `${API_BASE_ENV} is not a valid URL; using the hosted Aquora site.` };
    }
    const secure = url.protocol === 'https:';
    const localHttp = url.protocol === 'http:' && isLocalHost(url.hostname);
    if ((!secure && !localHttp) || url.username || url.password) {
        return {
            origin: DEFAULT_API_BASE,
            fromEnv: false,
            warning: `${API_BASE_ENV} must be an https:// URL (or http://localhost for development); using the hosted Aquora site.`,
        };
    }
    return { origin: url.origin, fromEnv: true, warning: null };
}

/** True for the paths the bridge forwards: everything under /api/. */
function isApiPath(pathname) {
    return typeof pathname === 'string' && (pathname === '/api' || pathname.startsWith('/api/'));
}

// ─── Set-Cookie parsing ───────────────────────────────────────────────────────

/**
 * Parses one Set-Cookie header value. Returns null for anything malformed.
 * @returns {{name:string,value:string,path?:string,domain?:string,maxAge?:number,expires?:number,secure:boolean,httpOnly:boolean,sameSite?:string}|null}
 */
function parseSetCookie(header) {
    if (typeof header !== 'string' || !header.trim()) return null;
    const [pair, ...attributes] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) return null;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name || /[\s;,]/.test(name)) return null;
    const cookie = { name, value, secure: false, httpOnly: false };
    for (const attribute of attributes) {
        const index = attribute.indexOf('=');
        const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
        const attrValue = index === -1 ? '' : attribute.slice(index + 1).trim();
        if (key === 'path' && attrValue.startsWith('/')) cookie.path = attrValue;
        else if (key === 'domain' && attrValue) cookie.domain = attrValue.replace(/^\./, '').toLowerCase();
        else if (key === 'max-age' && /^-?\d+$/.test(attrValue)) cookie.maxAge = Number(attrValue);
        else if (key === 'expires') {
            const time = Date.parse(attrValue);
            if (Number.isFinite(time)) cookie.expires = time;
        } else if (key === 'secure') cookie.secure = true;
        else if (key === 'httponly') cookie.httpOnly = true;
        else if (key === 'samesite' && attrValue) cookie.sameSite = attrValue.toLowerCase();
    }
    return cookie;
}

/** Unix seconds when the cookie expires, null for a session cookie, 0 when it is already expired. */
function cookieExpiry(cookie, now = Date.now()) {
    if (typeof cookie.maxAge === 'number') return cookie.maxAge <= 0 ? 0 : Math.floor(now / 1000) + cookie.maxAge;
    if (typeof cookie.expires === 'number') return cookie.expires <= now ? 0 : Math.floor(cookie.expires / 1000);
    return null;
}

function toElectronSameSite(value) {
    if (value === 'strict') return 'strict';
    if (value === 'none') return 'no_restriction';
    return 'lax';
}

/**
 * Cookie jar backed by an Electron `session.cookies` store, which Electron
 * keeps on disk between launches. Only cookies for the gateway's own host are
 * accepted (a Domain attribute naming another host is ignored).
 */
function createElectronCookieJar(cookies) {
    return {
        async header(origin) {
            const list = await cookies.get({ url: origin });
            return list.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        },
        async store(origin, setCookieHeaders) {
            const host = new URL(origin).hostname.toLowerCase();
            let changed = false;
            for (const header of setCookieHeaders) {
                const cookie = parseSetCookie(header);
                if (!cookie) continue;
                if (cookie.domain && cookie.domain !== host && !host.endsWith(`.${cookie.domain}`)) continue;
                const path = cookie.path || '/';
                const expiry = cookieExpiry(cookie);
                if (expiry === 0) {
                    await cookies.remove(`${origin}${path}`, cookie.name);
                } else {
                    await cookies.set({
                        url: `${origin}${path}`,
                        name: cookie.name,
                        value: cookie.value,
                        path,
                        secure: cookie.secure,
                        httpOnly: cookie.httpOnly,
                        sameSite: toElectronSameSite(cookie.sameSite),
                        ...(expiry ? { expirationDate: expiry } : {}),
                    });
                }
                changed = true;
            }
            if (changed && typeof cookies.flushStore === 'function') {
                await cookies.flushStore().catch(() => {});
            }
        },
    };
}

/** In-memory jar with the same interface (tests, and a fallback). */
function createMemoryCookieJar() {
    const jar = new Map();
    return {
        async header() {
            const now = Date.now();
            const parts = [];
            for (const [name, entry] of jar) {
                if (entry.expiresAt !== null && entry.expiresAt <= now) {
                    jar.delete(name);
                    continue;
                }
                parts.push(`${name}=${entry.value}`);
            }
            return parts.join('; ');
        },
        async store(_origin, setCookieHeaders) {
            for (const header of setCookieHeaders) {
                const cookie = parseSetCookie(header);
                if (!cookie) continue;
                const expiry = cookieExpiry(cookie);
                if (expiry === 0) jar.delete(cookie.name);
                else jar.set(cookie.name, { value: cookie.value, expiresAt: expiry ? expiry * 1000 : null });
            }
        },
        entries() {
            return new Map([...jar].map(([name, entry]) => [name, entry.value]));
        },
    };
}

// ─── proxy ────────────────────────────────────────────────────────────────────

function getSetCookies(headers) {
    if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
    const single = headers.get('set-cookie');
    return single ? [single] : [];
}

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}

/**
 * Returns `handle(request) → Promise<Response>` for renderer requests to
 * aquora://app/api/*. `request` is a WHATWG Request (what protocol.handle
 * passes). The body is streamed to the gateway, and the gateway's body
 * (including server-sent events) is streamed back.
 */
function createGatewayProxy({ apiBase, jar, fetchImpl = fetch, onError } = {}) {
    const { origin } = resolveApiBase(apiBase);

    return async function handle(request) {
        let incoming;
        try {
            incoming = new URL(request.url);
        } catch {
            return jsonResponse(400, { error: 'bad_request', message: 'Malformed request URL.' });
        }
        if (!isApiPath(incoming.pathname)) {
            return jsonResponse(404, { error: 'not_found', message: 'Not found.' });
        }

        const target = `${origin}${incoming.pathname}${incoming.search}`;
        const method = String(request.method || 'GET').toUpperCase();
        const headers = new Headers();
        for (const name of FORWARD_REQUEST_HEADERS) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
        }
        // The desktop app is a first-party client of this gateway: its
        // requests present the gateway's own origin so the CSRF check passes.
        headers.set('origin', origin);
        try {
            const cookie = await jar.header(origin);
            if (cookie) headers.set('cookie', cookie);
        } catch {
            // an unreadable cookie store means "signed out", not a crash
        }

        const hasBody = method !== 'GET' && method !== 'HEAD' && request.body;
        let upstream;
        try {
            upstream = await fetchImpl(target, {
                method,
                headers,
                body: hasBody ? request.body : undefined,
                ...(hasBody ? { duplex: 'half' } : {}),
                redirect: 'manual',
                signal: request.signal,
            });
        } catch (error) {
            if (request.signal?.aborted) return jsonResponse(499, { error: 'aborted', message: 'Request cancelled.' });
            onError?.(error);
            return jsonResponse(502, {
                error: 'upstream_unreachable',
                message: "Couldn't reach Aquora. Check your connection and try again.",
            });
        }

        const setCookies = getSetCookies(upstream.headers);
        if (setCookies.length > 0) {
            try {
                await jar.store(origin, setCookies);
            } catch (error) {
                onError?.(error);
            }
        }

        const responseHeaders = new Headers();
        for (const name of FORWARD_RESPONSE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value) responseHeaders.set(name, value);
        }
        // fetch() has already decoded any content-encoding, so the original
        // length no longer describes the body we pass on.
        if (upstream.headers.get('content-encoding')) responseHeaders.delete('content-length');
        // The gateway never redirects API calls; surface one as an error
        // instead of letting the renderer follow it somewhere unexpected.
        if (upstream.status >= 300 && upstream.status < 400) {
            return jsonResponse(502, { error: 'upstream_redirect', message: 'The Aquora service answered with a redirect.' });
        }
        const nullBody = method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
        return new Response(nullBody ? null : upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
        });
    };
}

module.exports = {
    API_BASE_ENV,
    DEFAULT_API_BASE,
    cookieExpiry,
    createElectronCookieJar,
    createGatewayProxy,
    createMemoryCookieJar,
    isApiPath,
    parseSetCookie,
    resolveApiBase,
};
