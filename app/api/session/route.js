// Access-code session.
//   GET    → {authenticated, gate, workspace?, budget?, features}
//   POST   {code} → sets the HttpOnly session cookie
//   DELETE → signs out
import { gateMode, isConfigured, isLlmConfigured } from '../../../lib/gateway/config.js';
import { GatewayError, errors } from '../../../lib/gateway/errors.js';
import { json, readJson, route } from '../../../lib/gateway/http.js';
import { assertLoginAllowed, budgetStatus, clientIp, enforceRate, recordLoginFailure } from '../../../lib/gateway/limits.js';
import {
    OPEN_WORKSPACE,
    clearSessionCookie,
    cookieSecure,
    createSessionCookie,
    getSession,
    loadRevocations,
    matchAccessCode,
    revokeSession,
} from '../../../lib/gateway/session.js';
import { logGateway } from '../../../lib/gateway/log.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const features = () => ({ fal: isConfigured(), openrouter: isLlmConfigured() });

async function budgetFor(cid) {
    const status = await budgetStatus(cid);
    return { spentUsd: status.spentUsd, capUsd: status.capUsd };
}

export const GET = route('session', async (request, { ip, setCookie }) => {
    enforceRate('session', { ip });
    await loadRevocations();
    const gate = gateMode();
    const { session } = getSession(request);
    if (gate === 'setup_required') {
        return json({ authenticated: false, gate, features: features() });
    }
    if (session) {
        if (session.needsRefresh) {
            setCookie(createSessionCookie({ codeId: session.cid, sid: session.sid, secure: cookieSecure(request) }).header);
        }
        return json({ authenticated: true, gate, workspace: session.cid, budget: await budgetFor(session.cid), features: features() });
    }
    if (gate === 'open') {
        const fresh = createSessionCookie({ codeId: OPEN_WORKSPACE, secure: cookieSecure(request) });
        setCookie(fresh.header);
        return json({ authenticated: true, gate, workspace: fresh.session.cid, budget: await budgetFor(fresh.session.cid), features: features() });
    }
    return json({ authenticated: false, gate, features: features() });
});

export const POST = route('session-login', async (request, { setCookie }) => {
    const gate = gateMode();
    if (gate === 'setup_required') throw errors.setupRequired();
    const ip = clientIp(request);
    const tooMany = 'Too many sign-in attempts. Wait a minute and try again.';
    // Per-IP attempts (every attempt) and per-network failures. There is no
    // global bucket, so nobody can lock other people out of signing in.
    assertLoginAllowed(ip, tooMany);
    enforceRate('login', { ip }, tooMany);
    const body = await readJson(request, { maxBytes: 4096 });
    let cid;
    if (gate === 'open') {
        cid = OPEN_WORKSPACE;
    } else {
        cid = matchAccessCode(body.code);
        if (!cid) {
            recordLoginFailure(ip);
            logGateway({ event: 'login_failed', route: 'session', status: 401 });
            throw new GatewayError(401, 'invalid_code', "That access code isn't valid.", { field: 'code' });
        }
    }
    // A fresh sid on every sign-in (no session fixation).
    const fresh = createSessionCookie({ codeId: cid, secure: cookieSecure(request) });
    setCookie(fresh.header);
    logGateway({ event: 'login', route: 'session', status: 200 });
    return json({ authenticated: true, gate, workspace: cid, budget: await budgetFor(cid), features: features() });
});

export const DELETE = route('session-logout', async (request, { setCookie }) => {
    // Revoke this sid server-side: a copy of the cookie stops working too.
    const { session } = getSession(request);
    if (session) await revokeSession({ sid: session.sid, exp: session.exp });
    setCookie(clearSessionCookie({ secure: cookieSecure(request) }));
    return json({ authenticated: false, gate: gateMode() });
});
