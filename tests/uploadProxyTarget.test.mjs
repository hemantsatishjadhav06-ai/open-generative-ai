import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploadProxyTarget, isBlockedFileType, getApiKeyFromRequest } from '../src/lib/uploadProxyTarget.js';

const validate = (url, env = {}) => validateUploadProxyTarget(url, { env });

test('real S3 hosts are allowed', () => {
    for (const url of [
        'https://bucket.s3.eu-west-1.amazonaws.com/k',
        'https://s3.amazonaws.com/b/k',
        'https://bucket.s3.amazonaws.com/k',
        'https://s3.us-east-1.amazonaws.com/b/k',
    ]) {
        assert.equal(validate(url).ok, true, url);
    }
});

test('bad protocol, empty and malformed targets are rejected', () => {
    assert.equal(validate('http://bucket.s3.amazonaws.com/k').reason, 'unsafe_protocol');
    assert.equal(validate('').reason, 'missing_target');
    assert.equal(validate('not a url').reason, 'invalid_url');
});

test('private, loopback, metadata and look-alike hosts are rejected', () => {
    for (const url of [
        'https://127.0.0.1/',
        'https://169.254.169.254/latest',
        'https://[::1]/',
        'https://localhost/',
        'https://0x7f.1/',
        'https://10.0.0.5/',
        'https://evil.s3.amazonaws.com.attacker.io/',
        'https://x..s3.amazonaws.com/',
        'https://s3.amazonaws.com.evil/',
        'https://bucket.s3.eu-west-1.amazonaws.com.cn/',
        'https://evil.com/',
    ]) {
        assert.equal(validate(url).reason, 'host_not_allowed', url);
    }
});

test('the env allowlist adds hosts but never unblocks private IPs', () => {
    assert.equal(validate('https://cdn.example.com/x', { UPLOAD_PROXY_ALLOWED_HOSTS: 'CDN.example.com. , ' }).ok, true);
    assert.equal(validate('https://127.0.0.1/', { UPLOAD_PROXY_ALLOWED_HOSTS: '127.0.0.1' }).ok, false);
});

test('isBlockedFileType blocks active content by extension or MIME', () => {
    assert.equal(isBlockedFileType('a.svg'), true);
    assert.equal(isBlockedFileType('x', 'text/html; charset=utf-8'), true);
    assert.equal(isBlockedFileType('A.JS'), true);
    assert.equal(isBlockedFileType('a.png', 'image/svg+xml'), true);
    assert.equal(isBlockedFileType('a.png', 'image/png'), false);
    assert.equal(isBlockedFileType('noext'), false);
    assert.equal(isBlockedFileType('', ''), false);
});

test('getApiKeyFromRequest reads Bearer or x-api-key', () => {
    const req = (headers) => new Request('https://x', { headers });
    assert.equal(getApiKeyFromRequest(req({ authorization: 'Bearer abc' })), 'abc');
    assert.equal(getApiKeyFromRequest(req({ 'x-api-key': ' k ' })), 'k');
    assert.equal(getApiKeyFromRequest(req({})), null);
    assert.equal(getApiKeyFromRequest(req({ authorization: 'Bearer   ' })), null);
});
