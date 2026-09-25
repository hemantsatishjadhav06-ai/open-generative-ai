// Pure helpers the app shell uses for the access-code session and the daily
// budget pill: what a failure means, the shell's session state, and the pill
// data. The requests themselves go through the studio's session client
// (packages/studio/src/session.js, `studio/session`), so the shell and the
// studios share one session store. No React, no fetch, no browser globals.
//
// Auth is the HttpOnly `aquora_session` cookie the server sets; nothing here
// reads, stores or forwards a secret.

// What an HTTP failure means for the shell.
//   'session'        401: the session expired or its code was revoked
//   'budget'         402: today's estimated spend cap is used up
//   'rate_limited'   429
//   'setup_required' 503 setup_required: no access codes / session secret yet
//   'not_configured' 503 not_configured: the server's provider keys are missing
//   'unavailable'    network failures and other 5xx
//   'error'          other 4xx (something about the request itself)
export function classifySessionError(err) {
    const status = Number(err?.status);
    const code = typeof err?.code === 'string' ? err.code : '';
    if (!Number.isFinite(status) || status <= 0) return 'unavailable';
    if (status === 401) return 'session';
    if (status === 402 || code === 'budget_exceeded') return 'budget';
    if (status === 429) return 'rate_limited';
    if (code === 'setup_required') return 'setup_required';
    if (code === 'not_configured') return 'not_configured';
    if (status >= 500) return 'unavailable';
    return 'error';
}

// Best-effort kind of a studio generation error (an Error, a response-like
// object or a message string such as "API Request Failed: 402 … {…}") so the
// shell can show localized copy for the session / budget / rate cases.
// Returns 'session' | 'budget' | 'rate_limited' | null.
export function errorKind(errorOrMessage) {
    if (!errorOrMessage) return null;
    const status = Number(errorOrMessage?.status);
    const code = typeof errorOrMessage?.code === 'string' ? errorOrMessage.code : '';
    if (Number.isFinite(status) && status > 0) {
        const kind = classifySessionError({ status, code });
        if (kind === 'session' || kind === 'budget' || kind === 'rate_limited') return kind;
    }
    const text = typeof errorOrMessage === 'string'
        ? errorOrMessage
        : String(errorOrMessage?.message || errorOrMessage?.error || '');
    if (/budget_exceeded|\b402\b/.test(text)) return 'budget';
    if (/session_required|\b401\b/.test(text)) return 'session';
    if (/rate_limited|\b429\b/.test(text)) return 'rate_limited';
    return null;
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// The shell's session state from a /api/session body (raw, or as the studio
// session client normalizes it: same field names).
//   status: 'authenticated' | 'signed_out' | 'setup_required'
export function normalizeSession(body) {
    const gate = typeof body?.gate === 'string' ? body.gate : 'codes';
    const authenticated = body?.authenticated === true && gate !== 'setup_required';
    let status = authenticated ? 'authenticated' : 'signed_out';
    if (gate === 'setup_required') status = 'setup_required';
    const spentUsd = numberOrNull(body?.budget?.spentUsd);
    const capUsd = numberOrNull(body?.budget?.capUsd);
    return {
        status,
        gate,
        workspace: authenticated && typeof body?.workspace === 'string' ? body.workspace : null,
        budget: authenticated && spentUsd !== null && capUsd !== null ? { spentUsd, capUsd } : null,
        features: {
            fal: body?.features?.fal === true,
            openrouter: body?.features?.openrouter === true,
        },
    };
}

// Why a sign-in (POST /api/session) failed, from the error the studio
// session client throws (.status/.code/.retryAfter). Returns
//   { reason: 'invalid_code' | 'rate_limited' | 'setup_required' | 'unavailable' | 'error', retryAfter? }
export function signInFailure(err) {
    const status = Number(err?.status);
    const code = typeof err?.code === 'string' ? err.code : '';
    if (status === 401 || code === 'invalid_code') return { reason: 'invalid_code' };
    const kind = classifySessionError(err);
    if (kind === 'rate_limited') {
        const retryAfter = Number(err?.retryAfter);
        return Number.isFinite(retryAfter) && retryAfter > 0
            ? { reason: 'rate_limited', retryAfter: Math.ceil(retryAfter) }
            : { reason: 'rate_limited' };
    }
    if (kind === 'setup_required') return { reason: 'setup_required' };
    if (kind === 'unavailable' || kind === 'not_configured') return { reason: 'unavailable' };
    return { reason: 'error' };
}

// "$0", "$0.04", "$10", "$12.50".
export function formatUsd(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '$0';
    if (Number.isInteger(n)) return `$${n}`;
    if (n < 0.01) return '<$0.01';
    return `$${n.toFixed(2)}`;
}

// Budget pill data, or null when there is nothing honest to show.
//   level: 'ok' (<80%), 'warn' (80–99%), 'over' (cap reached)
export function budgetView(budget) {
    const spentUsd = numberOrNull(budget?.spentUsd);
    const capUsd = numberOrNull(budget?.capUsd);
    if (spentUsd === null || capUsd === null || capUsd < 0 || spentUsd < 0) return null;
    const ratio = capUsd > 0 ? Math.min(1, spentUsd / capUsd) : 1;
    const level = spentUsd >= capUsd ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
    return {
        spentUsd,
        capUsd,
        ratio,
        percent: Math.round(ratio * 100),
        level,
        spentText: formatUsd(spentUsd),
        capText: formatUsd(capUsd),
    };
}

// Short, non-secret label for a workspace id (a hash of the access code, never
// the code itself). Open-gate workspaces (shared "open", private "v_…") have
// no id worth showing.
export function workspaceLabel(workspace) {
    if (typeof workspace !== 'string' || !workspace || workspace === 'open' || workspace.startsWith('v_')) return null;
    return workspace.slice(0, 8);
}
