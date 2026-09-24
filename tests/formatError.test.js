const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../packages/studio/src/utils/formatError.js');
const UNREACHABLE = "Couldn't reach the AI service. Try again in a sec.";

test('a JSON.parse error payload from the proxy becomes the friendly unreachable copy', async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 500 Internal Server Error - {"error":"Unexpected token \'H\', \\"Host not i\\"... is not valid JSON"}';
    assert.equal(formatErrorMessage(new Error(raw)), UNREACHABLE);
});

test('a string `error` with a 401 maps to the auth copy (overridable per locale)', async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 401 Unauthorized - {"error":"Unauthorized: Missing API key"}';
    assert.match(formatErrorMessage(new Error(raw)), /Authentication failed/);
    assert.equal(formatErrorMessage(new Error(raw), 'x', { auth: 'bad key' }), 'bad key');
});

test('a detail message is surfaced as-is', async () => {
    const { formatErrorMessage } = await load();
    assert.equal(formatErrorMessage(new Error('API Request Failed: 503 Service Unavailable - {"detail":"Model busy"}')), 'Model busy');
});

test('browser network failures become the unreachable copy', async () => {
    const { formatErrorMessage } = await load();
    assert.equal(formatErrorMessage(new TypeError('Failed to fetch')), UNREACHABLE);
    assert.equal(formatErrorMessage(null, 'fallback'), 'fallback');
});

test('a proxy envelope for a non-JSON 403 (block page) is "unreachable", not a bad key', async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 403 Forbidden - The AI service returned an unexpected response. Try again in a moment.';
    assert.equal(formatErrorMessage(new Error(raw)), UNREACHABLE);
});
