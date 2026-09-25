// Gateway core: session cookies, access-code gate modes and the CSRF check.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SESSION_COOKIE,
    SESSION_MAX_AGE_SEC,
    assertSameOrigin,
    codeId,
    createSessionCookie,
    matchAccessCode,
    parseCookies,
    requireSession,
    signSession,
    verifySession,
    verifySessionValue,
} from '../../lib/gateway/session.js';
import { gateMode, sessionSecrets } from '../../lib/gateway/config.js';
import { isGatewayError } from '../../lib/gateway/errors.js';

const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);

function withEnv(vars, fn) {
    const saved = {};
    for (const key of Object.keys(vars)) {
        saved[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
    }
    try {
        return fn();
    } finally {
        for (const key of Object.keys(saved)) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
}

const req = (url, headers = {}, method = 'GET') => new Request(url, { method, headers });
const cookieOf = (setCookie) => setCookie.split(';')[0];

test('session cookie round-trips and carries the documented attributes', () => {
    withEnv({ AQUORA_SESSION_SECRET: SECRET_A, NODE_ENV: 'production' }, () => {
        const { header, session, value } = createSessionCookie({ codeId: 'ws1' });
        assert.match(header, new RegExp(`^${SESSION_COOKIE}=`));
        assert.match(header, /; Path=\//);
        assert.match(header, /; HttpOnly/);
        assert.match(header, /; SameSite=Lax/);
        assert.match(header, /; Secure/);
        assert.match(header, new RegExp(`Max-Age=${SESSION_MAX_AGE_SEC}`));
        assert.equal(session.exp - session.iat, 30 * 24 * 3600);
        const verified = verifySession(`other=1; ${SESSION_COOKIE}=${value}`);
        assert.equal(verified.sid, session.sid);
        assert.equal(verified.cid, 'ws1');
        assert.equal(verified.needsRefresh, false);
    });
});

test('tampered, re-signed, truncated or garbage cookies are rejected', () => {
    withEnv({ AQUORA_SESSION_SECRET: SECRET_A }, () => {
        const { value } = createSessionCookie({ codeId: 'ws1' });
        const [body, sig] = value.split('.');
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        const forgedBody = Buffer.from(JSON.stringify({ ...payload, cid: 'someone-else' })).toString('base64url');
        assert.equal(verifySessionValue(`${forgedBody}.${sig}`), null, 'payload swap');
        assert.equal(verifySessionValue(`${body}.${sig.slice(0, -2)}xx`), null, 'bad signature');
        assert.equal(verifySessionValue(signSession(payload, SECRET_B)), null, 'foreign secret');
        assert.equal(verifySessionValue(body), null, 'no signature');
        assert.equal(verifySessionValue(`${value}.x`), null, 'extra segment');
        assert.equal(verifySessionValue(''), null);
        assert.equal(verifySessionValue(undefined), null);
        assert.equal(verifySession('aquora_session=%%%'), null);
        // A valid signature over a payload with the wrong version is refused.
        assert.equal(verifySessionValue(signSession({ ...payload, v: 99 }, SECRET_A)), null, 'version');
    });
});

test('expired sessions fail; old-but-valid ones ask for a refresh', () => {
    withEnv({ AQUORA_SESSION_SECRET: SECRET_A }, () => {
        const now = Math.floor(Date.now() / 1000);
        const { value } = createSessionCookie({ codeId: 'ws1', now: now - SESSION_MAX_AGE_SEC - 5 });
        assert.equal(verifySessionValue(value, { now }), null);
        const old = createSessionCookie({ codeId: 'ws1', now: now - 20 * 24 * 3600 });
        const verified = verifySessionValue(old.value, { now });
        assert.ok(verified);
        assert.equal(verified.needsRefresh, true);
        // Issued in the future (clock skew > 5 min) is refused.
        const future = createSessionCookie({ codeId: 'ws1', now: now + 3600 });
        assert.equal(verifySessionValue(future.value, { now }), null);
    });
});

test('secret rotation: old secret still verifies (and refreshes), removed secret does not', () => {
    let oldCookie;
    withEnv({ AQUORA_SESSION_SECRET: SECRET_A }, () => {
        oldCookie = createSessionCookie({ codeId: 'ws1' }).value;
    });
    withEnv({ AQUORA_SESSION_SECRET: `${SECRET_B},${SECRET_A}`, AQUORA_ACCESS_CODES: undefined, NODE_ENV: undefined }, () => {
        assert.deepEqual(sessionSecrets(), [SECRET_B, SECRET_A]);
        const verified = verifySessionValue(oldCookie);
        assert.ok(verified);
        assert.equal(verified.needsRefresh, true);
        // requireSession re-issues the cookie signed with the new secret.
        const session = requireSession(req('http://localhost/x', { cookie: `${SESSION_COOKIE}=${oldCookie}` }));
        assert.ok(session.setCookie);
        const reissued = cookieOf(session.setCookie).split('=')[1];
        const again = verifySessionValue(reissued);
        assert.equal(again.sid, verified.sid);
        assert.equal(again.needsRefresh, false);
    });
    withEnv({ AQUORA_SESSION_SECRET: SECRET_B }, () => {
        assert.equal(verifySessionValue(oldCookie), null);
    });
});

test('short secrets are ignored; production without a secret has none', () => {
    withEnv({ AQUORA_SESSION_SECRET: 'too-short', NODE_ENV: 'production' }, () => {
        assert.deepEqual(sessionSecrets(), []);
    });
    withEnv({ AQUORA_SESSION_SECRET: undefined, NODE_ENV: 'development' }, () => {
        const secrets = sessionSecrets();
        assert.equal(secrets.length, 1);
        assert.ok(secrets[0].length >= 32, 'dev fallback secret');
        assert.deepEqual(sessionSecrets(), secrets, 'stable within the process');
    });
});

test('gate modes: open in dev, setup_required in prod without codes/secret, codes otherwise', () => {
    withEnv({ NODE_ENV: 'development', AQUORA_ACCESS_CODES: undefined }, () => assert.equal(gateMode(), 'open'));
    withEnv({ NODE_ENV: 'development', AQUORA_ACCESS_CODES: 'alpha-code-123' }, () => assert.equal(gateMode(), 'codes'));
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: undefined, AQUORA_SESSION_SECRET: SECRET_A }, () => assert.equal(gateMode(), 'setup_required'));
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: undefined }, () => assert.equal(gateMode(), 'setup_required'));
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: 'short' }, () => assert.equal(gateMode(), 'setup_required'));
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: SECRET_A }, () => assert.equal(gateMode(), 'codes'));
});

test('requireSession: 503 setup_required, 401 without cookie in codes mode, minted session when open', () => {
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: undefined, AQUORA_SESSION_SECRET: SECRET_A }, () => {
        assert.throws(() => requireSession(req('https://app.example/api')), (e) => isGatewayError(e) && e.status === 503 && e.code === 'setup_required');
    });
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: SECRET_A }, () => {
        assert.throws(() => requireSession(req('https://app.example/api')), (e) => e.status === 401 && e.code === 'session_required');
        const cid = codeId('alpha-code-123');
        const { value } = createSessionCookie({ codeId: cid });
        const s = requireSession(req('https://app.example/api', { cookie: `${SESSION_COOKIE}=${value}` }));
        assert.equal(s.cid, cid);
        assert.equal(s.setCookie, undefined);
    });
    withEnv({ NODE_ENV: 'development', AQUORA_ACCESS_CODES: undefined, AQUORA_SESSION_SECRET: SECRET_A }, () => {
        const s = requireSession(req('http://localhost:3000/api'));
        assert.match(s.cid, /^v_[A-Za-z0-9_-]{16}$/, 'each visitor gets a private workspace');
        assert.equal(s.minted, true);
        assert.match(s.setCookie, /^aquora_session=/);
        assert.doesNotMatch(s.setCookie, /Secure/, 'no Secure flag in dev');
    });
});

test('AQUORA_PUBLIC_ACCESS: open in production (codes ignored), still needs a session secret', () => {
    withEnv({ NODE_ENV: 'production', AQUORA_PUBLIC_ACCESS: 'true', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: SECRET_A }, () => assert.equal(gateMode(), 'open'));
    withEnv({ NODE_ENV: 'production', AQUORA_PUBLIC_ACCESS: '1', AQUORA_ACCESS_CODES: undefined, AQUORA_SESSION_SECRET: SECRET_A }, () => assert.equal(gateMode(), 'open'));
    withEnv({ NODE_ENV: 'production', AQUORA_PUBLIC_ACCESS: 'true', AQUORA_SESSION_SECRET: undefined }, () => assert.equal(gateMode(), 'setup_required'));
    withEnv({ NODE_ENV: 'production', AQUORA_PUBLIC_ACCESS: 'false', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: SECRET_A }, () => assert.equal(gateMode(), 'codes'));
    withEnv({ NODE_ENV: 'production', AQUORA_PUBLIC_ACCESS: 'true', AQUORA_ACCESS_CODES: undefined, AQUORA_SESSION_SECRET: SECRET_A }, () => {
        const a = requireSession(req('https://app.example/api'));
        const b = requireSession(req('https://app.example/api'));
        assert.equal(a.minted, true);
        assert.match(a.setCookie, /; Secure/);
        assert.match(a.cid, /^v_/);
        assert.notEqual(a.cid, b.cid, 'two visitors never share a workspace');
        const again = requireSession(req('https://app.example/api', { cookie: cookieOf(a.setCookie) }));
        assert.equal(again.cid, a.cid, 'the cookie keeps the visitor in their workspace');
        assert.equal(again.setCookie, undefined);
    });
});

test('removing an access code revokes its sessions', () => {
    let cookie;
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: 'alpha-code-123,beta-code-456', AQUORA_SESSION_SECRET: SECRET_A }, () => {
        cookie = `${SESSION_COOKIE}=${createSessionCookie({ codeId: codeId('beta-code-456') }).value}`;
        assert.ok(requireSession(req('https://app.example/', { cookie })));
    });
    withEnv({ NODE_ENV: 'production', AQUORA_ACCESS_CODES: 'alpha-code-123', AQUORA_SESSION_SECRET: SECRET_A }, () => {
        assert.throws(() => requireSession(req('https://app.example/', { cookie })), (e) => e.status === 401);
    });
});

test('access codes: exact (trimmed) match only, workspace id never contains the code', () => {
    withEnv({ AQUORA_ACCESS_CODES: ' alpha-code-123 , beta-code-456,' }, () => {
        assert.equal(matchAccessCode('alpha-code-123'), codeId('alpha-code-123'));
        assert.equal(matchAccessCode('  beta-code-456 '), codeId('beta-code-456'));
        assert.equal(matchAccessCode('alpha-code-12'), null);
        assert.equal(matchAccessCode('ALPHA-CODE-123'), null);
        assert.equal(matchAccessCode(''), null);
        assert.equal(matchAccessCode(null), null);
        assert.equal(matchAccessCode({ code: 'alpha-code-123' }), null);
        assert.equal(matchAccessCode('x'.repeat(1000)), null);
        assert.ok(!codeId('alpha-code-123').includes('alpha'));
        assert.match(codeId('alpha-code-123'), /^[0-9a-f]{16}$/);
        assert.notEqual(codeId('alpha-code-123'), codeId('beta-code-456'));
    });
});

test('parseCookies handles spacing, quotes and duplicates (first wins)', () => {
    assert.deepEqual(parseCookies('a=1; b="two"; a=3;c=%20x'), { a: '1', b: 'two', c: ' x' });
    assert.deepEqual(parseCookies(''), {});
    assert.deepEqual(parseCookies(undefined), {});
});

test('CSRF: same-origin writes pass, cross-site writes are refused, reads are never checked', () => {
    const post = (headers) => req('https://app.example/api/v1/flux', { host: 'app.example', ...headers }, 'POST');
    assert.doesNotThrow(() => assertSameOrigin(post({ origin: 'https://app.example', 'sec-fetch-site': 'same-origin' })));
    assert.doesNotThrow(() => assertSameOrigin(post({ origin: 'https://app.example' })));
    assert.doesNotThrow(() => assertSameOrigin(post({ 'sec-fetch-site': 'same-origin' })));
    assert.doesNotThrow(() => assertSameOrigin(post({})), 'non-browser client');
    const refused = (e) => isGatewayError(e) && e.status === 403 && e.code === 'cross_origin';
    assert.throws(() => assertSameOrigin(post({ origin: 'https://evil.example' })), refused);
    assert.throws(() => assertSameOrigin(post({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), refused);
    assert.throws(() => assertSameOrigin(post({ 'sec-fetch-site': 'cross-site' })), refused);
    assert.throws(() => assertSameOrigin(post({ 'sec-fetch-site': 'same-site', origin: 'https://sub.app.example' })), refused);
    assert.throws(() => assertSameOrigin(post({ origin: 'null' })), refused);
    assert.throws(() => assertSameOrigin(post({ origin: 'not a url' })), refused);
    // Behind a proxy the public host arrives as X-Forwarded-Host.
    assert.doesNotThrow(() => assertSameOrigin(req('http://10.0.0.3:3000/api/session', { host: '10.0.0.3:3000', 'x-forwarded-host': 'aquora.app', origin: 'https://aquora.app' }, 'POST')));
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
        assert.throws(() => assertSameOrigin(req('https://app.example/x', { host: 'app.example', origin: 'https://evil.example' }, method)), refused);
    }
    assert.doesNotThrow(() => assertSameOrigin(req('https://app.example/x', { host: 'app.example', origin: 'https://evil.example' }, 'GET')));
});

test('AQUORA_ALLOWED_ORIGINS adds trusted origins', () => {
    withEnv({ AQUORA_ALLOWED_ORIGINS: 'https://studio.aquora.app' }, () => {
        assert.doesNotThrow(() => assertSameOrigin(req('https://app.example/x', { host: 'app.example', origin: 'https://studio.aquora.app' }, 'POST')));
    });
});
