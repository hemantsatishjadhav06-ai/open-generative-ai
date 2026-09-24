const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/apiKeyStatus.js');

test('401 and 403 from the balance endpoint mean the key is bad', async () => {
    const { classifyBalanceError, isAuthStatus } = await load();
    assert.equal(classifyBalanceError({ status: 401 }), 'unauthorized');
    assert.equal(classifyBalanceError({ status: 403, message: 'Failed to fetch balance: 403 - Invalid API key' }), 'unauthorized');
    assert.equal(isAuthStatus(401), true);
    assert.equal(isAuthStatus(403), true);
    assert.equal(isAuthStatus(500), false);
});

test('network errors, 5xx and missing status are not treated as a bad key', async () => {
    const { classifyBalanceError } = await load();
    assert.equal(classifyBalanceError({ status: 500 }), 'error');
    assert.equal(classifyBalanceError(undefined), 'error');
    assert.equal(classifyBalanceError(new TypeError('Failed to fetch')), 'error');
});

test('a 403 carrying the proxy non-JSON envelope (egress/WAF page) is not a bad key', async () => {
    const { classifyBalanceError } = await load();
    assert.equal(
        classifyBalanceError({ status: 403, body: '{"error":"upstream_unavailable","upstream_status":403}' }),
        'error',
    );
});
