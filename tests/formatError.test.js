const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../packages/studio/src/utils/formatError.js');
const UNREACHABLE = "Couldn't reach the AI service. Try again in a sec.";

test('a JSON.parse error payload from the proxy becomes the friendly unreachable copy', async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 500 Internal Server Error - {"error":"Unexpected token \'H\', \\"Host not i\\"... is not valid JSON"}';
    assert.equal(formatErrorMessage(new Error(raw)), UNREACHABLE);
});

test('a 401 without a message maps to the session copy (overridable per locale)', async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 401 Unauthorized - {"error":"session_required"}';
    assert.match(formatErrorMessage(new Error(raw)), /access code/);
    assert.equal(formatErrorMessage(new Error(raw), 'x', { auth: 'sign in again' }), 'sign in again');
});

test('a 402 budget_exceeded without a message maps to the budget copy (overridable)', async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 402 Payment Required - {"error":"budget_exceeded"}';
    assert.match(formatErrorMessage(new Error(raw)), /budget/i);
    assert.equal(formatErrorMessage(new Error(raw), 'x', { credits: 'cap reached' }), 'cap reached');
});

test("the gateway's friendly message is surfaced as-is", async () => {
    const { formatErrorMessage } = await load();
    const raw = 'API Request Failed: 422 Unprocessable Entity - {"error":"content_policy","message":"That prompt was blocked by the model\'s safety filter"}';
    assert.equal(formatErrorMessage(new Error(raw)), "That prompt was blocked by the model's safety filter");
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

test('logStudioError skips the 401/402 cases the shell already handles, logs the rest', async () => {
    const { isHandledGatewayError, logStudioError } = await load();
    const session = Object.assign(new Error('API Request Failed: 401'), { status: 401 });
    const budget = Object.assign(new Error('Budget used up'), { status: 402, code: 'budget_exceeded' });
    const broken = Object.assign(new Error('API Request Failed: 500'), { status: 500 });
    assert.equal(isHandledGatewayError(session), true);
    assert.equal(isHandledGatewayError(budget), true);
    assert.equal(isHandledGatewayError(broken), false);
    assert.equal(isHandledGatewayError(new Error('plain')), false);
    assert.equal(isHandledGatewayError(null), false);

    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    try {
        logStudioError('[ImageStudio] Generation failed:', session);
        logStudioError('[ImageStudio] Generation failed:', budget);
        logStudioError('[ImageStudio] Generation failed:', broken);
    } finally {
        console.error = original;
    }
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1], broken);
});
