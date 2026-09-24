const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/proxyGuards.js');
const h = (obj) => new Headers(obj);

test('hasApiKey accepts Bearer or x-api-key and rejects blanks', async () => {
    const { hasApiKey } = await load();
    assert.equal(hasApiKey(h({ authorization: 'Bearer abc' })), true);
    assert.equal(hasApiKey(h({ 'x-api-key': 'k' })), true);
    assert.equal(hasApiKey(h({ authorization: 'Bearer   ' })), false);
    assert.equal(hasApiKey(h({ 'x-api-key': '   ' })), false);
    assert.equal(hasApiKey(h({})), false);
});

test('bodyTooLarge caps bodies above 110 MB and lets unknown lengths through', async () => {
    const { bodyTooLarge } = await load();
    assert.equal(bodyTooLarge(h({})), false);
    assert.equal(bodyTooLarge(h({ 'content-length': String(100 * 1024 * 1024) })), false);
    assert.equal(bodyTooLarge(h({ 'content-length': String(111 * 1024 * 1024) })), true);
});
