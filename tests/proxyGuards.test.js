const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/proxyGuards.js');
const h = (obj) => new Headers(obj);
const MB = 1024 * 1024;

test('bodyTooLarge lets unknown lengths through (routes cap while reading)', async () => {
    const { bodyTooLarge } = await load();
    assert.equal(bodyTooLarge(h({})), false);
    assert.equal(bodyTooLarge(h({ 'content-length': '' })), false);
});

test('bodyTooLarge: the upload route takes 200 MB videos, JSON routes are capped at 20 MB', async () => {
    const { bodyTooLarge, MAX_JSON_BODY_BYTES, MAX_UPLOAD_BODY_BYTES } = await load();
    assert.equal(MAX_JSON_BODY_BYTES, 20 * MB);
    assert.ok(MAX_UPLOAD_BODY_BYTES > 200 * MB);
    assert.equal(bodyTooLarge(h({ 'content-length': String(199 * MB) }), '/api/v1/upload_file'), false);
    assert.equal(bodyTooLarge(h({ 'content-length': String(205 * MB) }), '/api/v1/upload_file'), true);
    assert.equal(bodyTooLarge(h({ 'content-length': String(19 * MB) }), '/api/v1/flux-dev-image'), false);
    assert.equal(bodyTooLarge(h({ 'content-length': String(21 * MB) }), '/api/v1/flux-dev-image'), true);
});

test('bodyTooLarge without a pathname uses the largest legitimate cap', async () => {
    const { bodyTooLarge } = await load();
    assert.equal(bodyTooLarge(h({ 'content-length': String(150 * MB) })), false);
    assert.equal(bodyTooLarge(h({ 'content-length': String(250 * MB) })), true);
});
