import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_REELTY_URL,
    SESSION_COOKIE_NAME,
    buildCsp,
    connectSrc,
    landingRedirect,
    securityHeaders,
} from '../lib/middlewarePolicy.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function directive(csp, name) {
    const part = csp.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name} `));
    return part ? part.slice(name.length + 1).split(/\s+/) : null;
}

test('connect-src is the gateway plus the fal media CDN, nothing else', () => {
    const csp = buildCsp();
    assert.deepEqual(directive(csp, 'connect-src'), ["'self'", 'https://fal.media', 'https://*.fal.media']);
    assert.doesNotMatch(csp, /muapi/i);
    // Provider APIs are server-side only.
    for (const host of ['queue.fal.run', 'fal.run', 'rest.fal.ai', 'api.fal.ai', 'openrouter.ai']) {
        assert.ok(!directive(csp, 'connect-src').some((src) => src.includes(host)), `${host} must not be in connect-src`);
    }
});

test('an absolute analytics endpoint adds only its origin; a relative one adds nothing', () => {
    assert.equal(connectSrc({ analyticsEndpoint: 'https://beacon.example.com/e?x=1' }), "'self' https://fal.media https://*.fal.media https://beacon.example.com");
    assert.equal(connectSrc({ analyticsEndpoint: '/api/events' }), "'self' https://fal.media https://*.fal.media");
    assert.equal(connectSrc({ analyticsEndpoint: 'not a url' }), "'self' https://fal.media https://*.fal.media");
});

test('frame-src allows only the Reelty origin', () => {
    assert.deepEqual(directive(buildCsp(), 'frame-src'), ["'self'", new URL(DEFAULT_REELTY_URL).origin]);
    assert.deepEqual(directive(buildCsp({ reeltyUrl: 'https://reelty.example.com/app?x=1' }), 'frame-src'), ["'self'", 'https://reelty.example.com']);
    assert.deepEqual(directive(buildCsp({ reeltyUrl: '::bad::' }), 'frame-src'), ["'self'", new URL(DEFAULT_REELTY_URL).origin]);
});

test('hardening directives are present; unsafe-eval only outside production', () => {
    const prod = buildCsp({ production: true });
    assert.deepEqual(directive(prod, 'object-src'), ["'none'"]);
    assert.deepEqual(directive(prod, 'base-uri'), ["'self'"]);
    assert.deepEqual(directive(prod, 'form-action'), ["'self'"]);
    assert.deepEqual(directive(prod, 'frame-ancestors'), ["'none'"]);
    assert.ok(!directive(prod, 'script-src').includes("'unsafe-eval'"));
    assert.ok(directive(buildCsp({ production: false }), 'script-src').includes("'unsafe-eval'"));
    assert.ok(prod.endsWith(';'));
});

test('securityHeaders carries the CSP and the fixed headers', () => {
    const headers = securityHeaders('default-src x;');
    assert.equal(headers['Content-Security-Policy'], 'default-src x;');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.match(headers['Strict-Transport-Security'], /max-age=\d+/);
});

test('landing → studio redirect keys on the session cookie only', () => {
    assert.equal(SESSION_COOKIE_NAME, 'aquora_session');
    assert.equal(landingRedirect('/', true), '/studio');
    assert.equal(landingRedirect('/zh', true), '/zh/studio');
    assert.equal(landingRedirect('/', false), null);
    assert.equal(landingRedirect('/studio', true), null);
});

test('the session cookie name matches the gateway', () => {
    const sessionSource = fs.readFileSync(path.join(ROOT, 'lib/gateway/session.js'), 'utf8');
    assert.match(sessionSource, new RegExp(`SESSION_COOKIE = '${SESSION_COOKIE_NAME}'`));
});

test('middleware.js: no provider rewrite, no key check, upload route unmatched', () => {
    const source = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
    assert.doesNotMatch(source, /muapi/i);
    assert.doesNotMatch(source, /hasApiKey|x-api-key|NextResponse\.rewrite/);
    assert.match(source, /bodyTooLarge\(request\.headers, url\.pathname\)/);

    const block = source.slice(source.indexOf('matcher:'));
    const matchers = [...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.equal(matchers.length, 2);
    const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info.js');
    const compiled = getMiddlewareMatchers(matchers, {}).map((m) => new RegExp(m.regexp));
    const matches = (p) => compiled.some((re) => re.test(p));

    // The upload route streams up to ~200 MB: middleware must not buffer it.
    assert.equal(matches('/api/v1/upload_file'), false);
    for (const p of ['/', '/zh', '/studio/image', '/api/session', '/api/v1/flux-2-dev', '/api/v1/predictions/t/result', '/api/v1/upload_filex']) {
        assert.equal(matches(p), true, `${p} should get the security headers`);
    }
    assert.equal(matches('/_next/static/chunks/main.js'), false);
});
