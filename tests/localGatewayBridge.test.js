const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const {
    DEFAULT_API_BASE,
    cookieExpiry,
    createElectronCookieJar,
    createGatewayProxy,
    createMemoryCookieJar,
    isApiPath,
    parseSetCookie,
    resolveApiBase,
} = require('../electron/lib/gatewayBridge');
const { isAppUrl, isExternalWebUrl, resolveAppFile } = require('../electron/lib/appProtocol');
const { sanitizeEntries } = require('../electron/lib/storageMigration');

// ─── helpers ──────────────────────────────────────────────────────────────────

// A tiny stand-in for the Aquora gateway: records what it received.
function startGateway(handler) {
    return new Promise((resolve) => {
        const received = [];
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => {
                const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
                received.push(entry);
                handler(entry, res);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ origin: `http://127.0.0.1:${port}`, received, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

function appRequest(pathname, init = {}) {
    return new Request(`aquora://app${pathname}`, init);
}

// ─── resolveApiBase ───────────────────────────────────────────────────────────

test('resolveApiBase defaults to the hosted site', () => {
    assert.deepEqual(resolveApiBase(undefined), { origin: DEFAULT_API_BASE, fromEnv: false, warning: null });
    assert.deepEqual(resolveApiBase('  '), { origin: DEFAULT_API_BASE, fromEnv: false, warning: null });
    assert.match(DEFAULT_API_BASE, /^https:\/\//);
});

test('resolveApiBase keeps only the origin of an https URL', () => {
    assert.deepEqual(resolveApiBase('https://studio.example.com/some/path/?q=1'), {
        origin: 'https://studio.example.com',
        fromEnv: true,
        warning: null,
    });
});

test('resolveApiBase allows plain http only to this machine', () => {
    assert.equal(resolveApiBase('http://localhost:3000').origin, 'http://localhost:3000');
    assert.equal(resolveApiBase('http://127.0.0.1:3000/').origin, 'http://127.0.0.1:3000');
    const remote = resolveApiBase('http://studio.example.com');
    assert.equal(remote.origin, DEFAULT_API_BASE);
    assert.match(remote.warning, /https/);
});

test('resolveApiBase rejects credentials, other schemes and junk', () => {
    for (const value of ['https://user:pass@studio.example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
        const result = resolveApiBase(value);
        assert.equal(result.origin, DEFAULT_API_BASE, value);
        assert.equal(result.fromEnv, false);
        assert.ok(result.warning);
    }
});

test('isApiPath matches /api and below only', () => {
    assert.equal(isApiPath('/api/session'), true);
    assert.equal(isApiPath('/api/v1/predictions/abc/result'), true);
    assert.equal(isApiPath('/api'), true);
    assert.equal(isApiPath('/apis'), false);
    assert.equal(isApiPath('/index.html'), false);
    assert.equal(isApiPath('/assets/api/x.js'), false);
});

// ─── cookies ──────────────────────────────────────────────────────────────────

test('parseSetCookie reads the gateway session cookie attributes', () => {
    const cookie = parseSetCookie('aquora_session=abc.def; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
    assert.deepEqual(cookie, {
        name: 'aquora_session',
        value: 'abc.def',
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 2592000,
        secure: true,
    });
    assert.equal(parseSetCookie(''), null);
    assert.equal(parseSetCookie('novalue'), null);
    assert.equal(parseSetCookie('=x'), null);
});

test('cookieExpiry handles Max-Age, Expires and session cookies', () => {
    const now = Date.UTC(2026, 0, 1);
    assert.equal(cookieExpiry({ maxAge: 60 }, now), now / 1000 + 60);
    assert.equal(cookieExpiry({ maxAge: 0 }, now), 0);
    assert.equal(cookieExpiry({ expires: now - 1 }, now), 0);
    assert.equal(cookieExpiry({ expires: now + 5000 }, now), Math.floor((now + 5000) / 1000));
    assert.equal(cookieExpiry({}, now), null);
});

test('memory jar stores, sends and expires cookies', async () => {
    const jar = createMemoryCookieJar();
    await jar.store('https://a.example', ['aquora_session=one; Path=/; HttpOnly; Max-Age=60']);
    assert.equal(await jar.header('https://a.example'), 'aquora_session=one');
    await jar.store('https://a.example', ['aquora_session=; Path=/; Max-Age=0']);
    assert.equal(await jar.header('https://a.example'), '');
});

test('electron jar writes persistent cookies for the gateway host only', async () => {
    const calls = [];
    const fakeCookies = {
        store: [],
        async get({ url }) {
            calls.push(['get', url]);
            return this.store;
        },
        async set(details) {
            calls.push(['set', details]);
            this.store = [{ name: details.name, value: details.value }];
        },
        async remove(url, name) {
            calls.push(['remove', url, name]);
            this.store = [];
        },
        async flushStore() {
            calls.push(['flush']);
        },
    };
    const jar = createElectronCookieJar(fakeCookies);
    const origin = 'https://studio.example.com';
    await jar.store(origin, [
        'aquora_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=100; Secure',
        'tracker=1; Domain=evil.example; Path=/',
    ]);
    const set = calls.find((call) => call[0] === 'set')[1];
    assert.equal(set.url, 'https://studio.example.com/');
    assert.equal(set.name, 'aquora_session');
    assert.equal(set.httpOnly, true);
    assert.equal(set.secure, true);
    assert.equal(set.sameSite, 'lax');
    assert.ok(set.expirationDate > Date.now() / 1000);
    assert.equal(calls.filter((call) => call[0] === 'set').length, 1, 'foreign Domain cookie ignored');
    assert.ok(calls.some((call) => call[0] === 'flush'));
    assert.equal(await jar.header(origin), 'aquora_session=tok');

    await jar.store(origin, ['aquora_session=; Path=/; Max-Age=0']);
    assert.deepEqual(calls.find((call) => call[0] === 'remove'), ['remove', 'https://studio.example.com/', 'aquora_session']);
    assert.equal(await jar.header(origin), '');
});

// ─── proxy ────────────────────────────────────────────────────────────────────

test('proxy signs in, keeps the session cookie in the main process and sends it back', async () => {
    const gateway = await startGateway((req, res) => {
        if (req.method === 'POST' && req.url === '/api/session') {
            res.writeHead(200, {
                'content-type': 'application/json',
                'set-cookie': 'aquora_session=signed; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000',
            });
            res.end(JSON.stringify({ authenticated: true, workspace: 'team' }));
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ authenticated: Boolean(req.headers.cookie) }));
    });
    try {
        const jar = createMemoryCookieJar();
        const proxy = createGatewayProxy({ apiBase: gateway.origin, jar });

        const login = await proxy(appRequest('/api/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: 'renderer=forged', origin: 'aquora://app' },
            body: JSON.stringify({ code: 'secret-code' }),
        }));
        assert.equal(login.status, 200);
        assert.equal(login.headers.get('set-cookie'), null, 'the renderer never sees Set-Cookie');
        assert.deepEqual(await login.json(), { authenticated: true, workspace: 'team' });

        const [first] = gateway.received;
        assert.equal(first.headers.origin, gateway.origin, 'presents the gateway origin for the CSRF check');
        assert.equal(first.headers.cookie, undefined, 'renderer-supplied cookies are dropped');
        assert.equal(first.headers['content-type'], 'application/json');
        assert.deepEqual(JSON.parse(first.body.toString()), { code: 'secret-code' });

        const status = await proxy(appRequest('/api/session?x=1'));
        assert.deepEqual(await status.json(), { authenticated: true });
        assert.equal(gateway.received[1].url, '/api/session?x=1');
        assert.equal(gateway.received[1].headers.cookie, 'aquora_session=signed');
    } finally {
        await gateway.close();
    }
});

test('proxy streams an upload body through with its length', async () => {
    const gateway = await startGateway((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: 'https://v3.fal.media/files/x.png', bytes: req.body.length }));
    });
    try {
        const proxy = createGatewayProxy({ apiBase: gateway.origin, jar: createMemoryCookieJar() });
        const form = new FormData();
        const bytes = new Uint8Array(3 * 1024 * 1024).fill(7);
        form.append('file', new Blob([bytes], { type: 'image/png' }), 'big.png');
        const outgoing = new Request('http://placeholder/', { method: 'POST', body: form });
        const body = await outgoing.arrayBuffer();
        const response = await proxy(appRequest('/api/v1/upload_file', {
            method: 'POST',
            headers: { 'content-type': outgoing.headers.get('content-type'), 'content-length': String(body.byteLength) },
            body: new Blob([body]).stream(),
            duplex: 'half',
        }));
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.bytes, body.byteLength);
        const received = gateway.received[0];
        assert.equal(received.headers['content-length'], String(body.byteLength));
        assert.match(received.headers['content-type'], /^multipart\/form-data; boundary=/);
    } finally {
        await gateway.close();
    }
});

test('proxy passes gateway errors and server-sent events through unchanged', async () => {
    const gateway = await startGateway((req, res) => {
        if (req.url === '/api/llm/chat') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
            res.write('data: {"delta":"he"}\n\n');
            setTimeout(() => res.end('data: {"delta":"llo"}\n\ndata: [DONE]\n\n'), 20);
            return;
        }
        res.writeHead(402, { 'content-type': 'application/json', 'retry-after': '30', 'x-powered-by': 'next' });
        res.end(JSON.stringify({ error: 'budget_exceeded', message: "Today's AI budget is used up." }));
    });
    try {
        const proxy = createGatewayProxy({ apiBase: gateway.origin, jar: createMemoryCookieJar() });
        const denied = await proxy(appRequest('/api/v1/flux-schnell-image', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
        assert.equal(denied.status, 402);
        assert.equal(denied.headers.get('retry-after'), '30');
        assert.equal(denied.headers.get('x-powered-by'), null);
        assert.equal((await denied.json()).error, 'budget_exceeded');

        const stream = await proxy(appRequest('/api/llm/chat', { method: 'POST', body: '{"stream":true}' }));
        assert.equal(stream.headers.get('content-type'), 'text/event-stream');
        const text = await stream.text();
        assert.match(text, /"he"[\s\S]*"llo"[\s\S]*\[DONE\]/);
    } finally {
        await gateway.close();
    }
});

test('proxy answers 502 when the gateway is unreachable, and refuses redirects and non-API paths', async () => {
    const errors = [];
    const offline = createGatewayProxy({
        apiBase: 'http://127.0.0.1:9',
        jar: createMemoryCookieJar(),
        onError: (error) => errors.push(error),
    });
    const down = await offline(appRequest('/api/session'));
    assert.equal(down.status, 502);
    assert.equal((await down.json()).error, 'upstream_unreachable');
    assert.equal(errors.length, 1);

    const gateway = await startGateway((req, res) => {
        res.writeHead(302, { location: 'https://elsewhere.example/' });
        res.end();
    });
    try {
        const proxy = createGatewayProxy({ apiBase: gateway.origin, jar: createMemoryCookieJar() });
        const redirected = await proxy(appRequest('/api/session'));
        assert.equal(redirected.status, 502);
        assert.equal((await redirected.json()).error, 'upstream_redirect');

        const page = await proxy(appRequest('/index.html'));
        assert.equal(page.status, 404);
        assert.equal(gateway.received.length, 1, 'non-API paths never reach the gateway');
    } finally {
        await gateway.close();
    }
});

// ─── app protocol ─────────────────────────────────────────────────────────────

test('resolveAppFile serves files inside dist only', () => {
    const dist = path.join(process.cwd(), 'dist');
    assert.equal(resolveAppFile(dist, '/'), path.join(dist, 'index.html'));
    assert.equal(resolveAppFile(dist, '/index.html'), path.join(dist, 'index.html'));
    assert.equal(resolveAppFile(dist, '/assets/index-abc.js'), path.join(dist, 'assets', 'index-abc.js'));
    assert.equal(resolveAppFile(dist, '/assets/My%20File.png'), path.join(dist, 'assets', 'My File.png'));
    for (const escape of ['/../package.json', '/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json', '/a%5c..%5c..%5cx', '/x%00.js', '/%E0%A4%A']) {
        assert.equal(resolveAppFile(dist, escape), null, escape);
    }
});

test('isAppUrl and isExternalWebUrl keep the window on the app and links in the browser', () => {
    assert.equal(isAppUrl('aquora://app/index.html'), true);
    assert.equal(isAppUrl('aquora://other/index.html'), false);
    assert.equal(isAppUrl('https://studio.example.com'), false);
    assert.equal(isExternalWebUrl('https://studio.example.com/help'), true);
    assert.equal(isExternalWebUrl('http://example.com'), true);
    assert.equal(isExternalWebUrl('file:///etc/passwd'), false);
    assert.equal(isExternalWebUrl('javascript:alert(1)'), false);
    assert.equal(isExternalWebUrl('smb://share/x'), false);
});

// ─── storage migration ────────────────────────────────────────────────────────

test('sanitizeEntries keeps string pairs only', () => {
    assert.deepEqual(sanitizeEntries(null), []);
    assert.deepEqual(sanitizeEntries([
        ['video_history', '[]'],
        ['aquora_lang', 'zh-CN'],
        ['', 'x'],
        ['n', 5],
        ['only-key'],
        'junk',
    ]), [['video_history', '[]'], ['aquora_lang', 'zh-CN']]);
});
