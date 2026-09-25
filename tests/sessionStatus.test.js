const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/sessionStatus.js');

test('classifySessionError: 401 is the session, 402 the budget, 429 the rate limit', async () => {
    const { classifySessionError } = await load();
    assert.equal(classifySessionError({ status: 401, code: 'session_required' }), 'session');
    assert.equal(classifySessionError({ status: 402, code: 'budget_exceeded' }), 'budget');
    assert.equal(classifySessionError({ status: 429, code: 'rate_limited' }), 'rate_limited');
});

test('classifySessionError: 503 setup_required / not_configured are not session prompts', async () => {
    const { classifySessionError } = await load();
    assert.equal(classifySessionError({ status: 503, code: 'setup_required' }), 'setup_required');
    assert.equal(classifySessionError({ status: 503, code: 'not_configured' }), 'not_configured');
    assert.equal(classifySessionError({ status: 502 }), 'unavailable');
    assert.equal(classifySessionError({ status: 403, code: 'cross_origin' }), 'error');
});

test('classifySessionError: network failures and missing status are "unavailable"', async () => {
    const { classifySessionError } = await load();
    assert.equal(classifySessionError(new TypeError('Failed to fetch')), 'unavailable');
    assert.equal(classifySessionError(undefined), 'unavailable');
    assert.equal(classifySessionError({ status: 0 }), 'unavailable');
});

test('errorKind reads status/code first, then the message text', async () => {
    const { errorKind } = await load();
    assert.equal(errorKind(Object.assign(new Error("Today's AI budget is used up."), { status: 402, code: 'budget_exceeded' })), 'budget');
    assert.equal(errorKind('API Request Failed: 402 Payment Required - {"error":"budget_exceeded"}'), 'budget');
    assert.equal(errorKind(new Error('API Request Failed: 401 Unauthorized - {"error":"session_required"}')), 'session');
    assert.equal(errorKind({ status: 429 }), 'rate_limited');
    assert.equal(errorKind(new Error('That prompt was blocked by the safety filter')), null);
    assert.equal(errorKind({ status: 503, code: 'not_configured' }), null);
    assert.equal(errorKind(null), null);
});

test('normalizeSession maps /api/session bodies to shell states', async () => {
    const { normalizeSession } = await load();
    const signedIn = normalizeSession({
        authenticated: true,
        gate: 'codes',
        workspace: 'a1b2c3d4e5f6a7b8',
        budget: { spentUsd: 1.2, capUsd: 10 },
        features: { fal: true, openrouter: false },
    });
    assert.deepEqual(signedIn, {
        status: 'authenticated',
        gate: 'codes',
        workspace: 'a1b2c3d4e5f6a7b8',
        budget: { spentUsd: 1.2, capUsd: 10 },
        features: { fal: true, openrouter: false },
    });

    const signedOut = normalizeSession({ authenticated: false, gate: 'codes', features: { fal: true } });
    assert.equal(signedOut.status, 'signed_out');
    assert.equal(signedOut.workspace, null);
    assert.equal(signedOut.budget, null);

    // setup_required wins even if a stale body claimed authenticated.
    assert.equal(normalizeSession({ authenticated: true, gate: 'setup_required' }).status, 'setup_required');
    // The studio client's normalized shape (capUsd null = no cap) has no pill.
    assert.equal(normalizeSession({ authenticated: true, gate: 'open', workspace: 'open', budget: { spentUsd: 0, capUsd: null } }).budget, null);
    assert.equal(normalizeSession(null).status, 'signed_out');
});

test('signInFailure maps sign-in errors to inline reasons', async () => {
    const { signInFailure } = await load();
    assert.deepEqual(signInFailure({ status: 401, code: 'invalid_code' }), { reason: 'invalid_code' });
    assert.deepEqual(signInFailure({ status: 429, code: 'rate_limited', retryAfter: 42.2 }), { reason: 'rate_limited', retryAfter: 43 });
    assert.deepEqual(signInFailure({ status: 429 }), { reason: 'rate_limited' });
    assert.deepEqual(signInFailure({ status: 503, code: 'setup_required' }), { reason: 'setup_required' });
    assert.deepEqual(signInFailure(new TypeError('Failed to fetch')), { reason: 'unavailable' });
    assert.deepEqual(signInFailure({ status: 400, code: 'invalid_json' }), { reason: 'error' });
});

test('budgetView: text, percent and warning levels', async () => {
    const { budgetView, formatUsd } = await load();
    assert.equal(formatUsd(0), '$0');
    assert.equal(formatUsd(10), '$10');
    assert.equal(formatUsd(0.04), '$0.04');
    assert.equal(formatUsd(0.004), '<$0.01');
    assert.equal(formatUsd(12.5), '$12.50');
    assert.equal(formatUsd('nope'), '$0');

    const view = budgetView({ spentUsd: 0.5, capUsd: 10 });
    assert.deepEqual(view, {
        spentUsd: 0.5, capUsd: 10, ratio: 0.05, percent: 5, level: 'ok', spentText: '$0.50', capText: '$10',
    });
    assert.equal(budgetView({ spentUsd: 8, capUsd: 10 }).level, 'warn');
    assert.equal(budgetView({ spentUsd: 10, capUsd: 10 }).level, 'over');
    assert.equal(budgetView({ spentUsd: 12, capUsd: 10 }).percent, 100);
    assert.equal(budgetView({ spentUsd: 0, capUsd: 0 }).level, 'over');
    assert.equal(budgetView(null), null);
    assert.equal(budgetView({ spentUsd: 1 }), null);
    assert.equal(budgetView({ spentUsd: 1, capUsd: null }), null);
});

test('workspaceLabel shows a short id and hides the open dev workspace', async () => {
    const { workspaceLabel } = await load();
    assert.equal(workspaceLabel('a1b2c3d4e5f6a7b8'), 'a1b2c3d4');
    assert.equal(workspaceLabel('open'), null);
    assert.equal(workspaceLabel(''), null);
    assert.equal(workspaceLabel(undefined), null);
});
