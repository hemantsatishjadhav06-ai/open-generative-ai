import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeUpstream,
    mapProxyError,
    getApiKey,
    buildUpstreamHeaders,
    rewriteUploadUrl,
} from '../lib/muapiUpstream.js';

test('JSON replies pass through with their status', () => {
    assert.deepEqual(normalizeUpstream(200, '{"ok":true}'), { status: 200, body: { ok: true } });
    assert.deepEqual(normalizeUpstream(401, '{"detail":"Invalid API key"}'), { status: 401, body: { detail: 'Invalid API key' } });
});

test('non-JSON 4xx keeps its status with an envelope and tag-free detail', () => {
    const { status, body } = normalizeUpstream(403, 'Host not in allowlist');
    assert.equal(status, 403);
    assert.equal(body.error, 'upstream_unavailable');
    assert.equal(body.upstream_status, 403);
    assert.equal(body.detail, 'Host not in allowlist');
});

test('non-JSON 5xx (HTML) becomes a 502 envelope without markup', () => {
    const { status, body } = normalizeUpstream(502, '<html><body><h1>502 Bad Gateway</h1></body></html>');
    assert.equal(status, 502);
    assert.equal(body.error, 'upstream_unavailable');
    assert.ok(!body.detail.includes('<'));
    assert.equal(normalizeUpstream(200, '<html>maintenance</html>').status, 502);
});

test('empty bodies', () => {
    assert.deepEqual(normalizeUpstream(204, ''), { status: 204, body: null });
    assert.deepEqual(normalizeUpstream(200, ''), { status: 200, body: {} });
});

test('timeouts are 504, other network failures 502', () => {
    assert.equal(mapProxyError({ name: 'TimeoutError' }).status, 504);
    assert.equal(mapProxyError({ name: 'AbortError' }).status, 504);
    const net = mapProxyError(new TypeError('fetch failed'));
    assert.equal(net.status, 502);
    assert.equal(net.body.error, 'upstream_unreachable');
});

test('getApiKey reads Bearer or x-api-key and trims', () => {
    assert.equal(getApiKey(new Headers({ authorization: 'Bearer  abc ' })), 'abc');
    assert.equal(getApiKey(new Headers({ 'x-api-key': ' k ' })), 'k');
    assert.equal(getApiKey(new Headers({})), null);
});

test('buildUpstreamHeaders never forwards cookies or the raw auth headers', () => {
    const out = buildUpstreamHeaders(new Headers({ cookie: 'muapi_key=secret', authorization: 'Bearer x', host: 'a', 'content-type': 'application/json' }), 'k');
    assert.equal(out.get('cookie'), null);
    assert.equal(out.get('authorization'), null);
    assert.equal(out.get('host'), null);
    assert.equal(out.get('x-api-key'), 'k');
    assert.equal(out.get('content-type'), 'application/json');
});

test('rewriteUploadUrl routes presigned uploads through the binary proxy', () => {
    const data = rewriteUploadUrl({ url: 'https://bucket.s3.amazonaws.com/', fields: { key: 'k' } });
    assert.equal(data.url, '/api/upload-binary');
    assert.equal(data.fields['x-proxy-target-url'], 'https://bucket.s3.amazonaws.com/');
    assert.equal(data.fields.key, 'k');
    assert.deepEqual(rewriteUploadUrl({ error: 'x' }), { error: 'x' });
});
