// aquora://app/ — the desktop renderer's origin.
//
// The Vite build (dist/) is served from this privileged, standard, secure
// scheme instead of file://, so the renderer has a real origin and can call
// /api/* with same-origin relative URLs. Static paths map to files inside
// dist/; /api/* goes to the gateway bridge (gatewayBridge.js).

const path = require('path');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'aquora';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

// Must be registered before app 'ready'.
const APP_SCHEME_PRIVILEGES = {
    scheme: APP_SCHEME,
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
    },
};

/**
 * Maps a request pathname to a file inside `distDir`, or null when it would
 * escape it (../, encoded separators, NUL bytes).
 */
function resolveAppFile(distDir, pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname || '/');
    } catch {
        return null;
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const root = path.resolve(distDir);
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
}

function notFound() {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/**
 * Registers the aquora:// handler. `proxy(request)` answers /api/*; `net` is
 * Electron's net module (net.fetch reads files through Chromium, so MIME
 * types and range requests behave as they did under file://).
 */
function registerAppProtocol({ protocol, net, distDir, proxy, isApiPath }) {
    protocol.handle(APP_SCHEME, async (request) => {
        let url;
        try {
            url = new URL(request.url);
        } catch {
            return notFound();
        }
        if (url.host !== APP_HOST) return notFound();
        if (isApiPath(url.pathname)) return proxy(request);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405 });
        }
        const file = resolveAppFile(distDir, url.pathname);
        if (!file) return notFound();
        try {
            return await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
        } catch {
            return notFound();
        }
    });
}

/** True for URLs the main window may navigate to (its own pages only). */
function isAppUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST;
    } catch {
        return false;
    }
}

/** True for links that may be opened in the system browser. */
function isExternalWebUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

module.exports = {
    APP_ENTRY_URL,
    APP_HOST,
    APP_ORIGIN,
    APP_SCHEME,
    APP_SCHEME_PRIVILEGES,
    isAppUrl,
    isExternalWebUrl,
    registerAppProtocol,
    resolveAppFile,
};
