// Aquora session client: the access-code sign-in and today's AI budget.
//
// No imports and no React, so the app shell can load it through
// `studio/session` without pulling in the studio bundle and its ~1 MB model
// catalog. gateway.js re-exports everything here, so
// `import { getSessionStatus } from 'studio'` works too.
//
// Auth is the HttpOnly `aquora_session` cookie set by POST /api/session; this
// module never sees it. It keeps the last known session in memory so studio
// components (history persistence, pickers) can react to sign-in / sign-out.

export const SESSION_REQUIRED_EVENT = "aquora:session-required";
export const BUDGET_EXCEEDED_EVENT = "aquora:budget-exceeded";
export const SESSION_CHANGED_EVENT = "aquora:session-changed";

const SESSION_URL = "/api/session";

// ─── events ─────────────────────────────────────────────────────────────────

// 401 from any gateway route: the shell listens and shows the access-code
// dialog. Other statuses (403 cross-site, 503 not set up) are plain errors.
export function notifySessionRequired(status, detail) {
    if (typeof window === "undefined" || status !== 401) return;
    window.dispatchEvent(new CustomEvent(SESSION_REQUIRED_EVENT, { detail: { status, message: detail } }));
}

// 402 budget_exceeded: lets the shell refresh its "Today: $x of $y" pill.
export function notifyBudgetExceeded(detail = {}) {
    if (typeof window === "undefined") return;
    const { scope, spentUsd, capUsd } = detail || {};
    window.dispatchEvent(new CustomEvent(BUDGET_EXCEEDED_EVENT, { detail: { scope, spentUsd, capUsd } }));
}

// ─── in-memory session store ────────────────────────────────────────────────

// status: 'unknown' (never asked) | 'loading' | 'ready' | 'error'
let state = { status: "unknown", session: null };
let inflight = null;
const listeners = new Set();

function setState(next) {
    const previousWorkspace = state.session?.authenticated ? state.session.workspace : null;
    state = next;
    for (const listener of [...listeners]) {
        try { listener(state); } catch { /* a broken listener must not block the others */ }
    }
    const workspace = state.session?.authenticated ? state.session.workspace : null;
    if (workspace !== previousWorkspace && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT, {
            detail: { authenticated: Boolean(workspace), workspace },
        }));
    }
}

export function getSessionSnapshot() {
    return state;
}

export function subscribeSession(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function normalizeSession(data) {
    if (!data || typeof data !== "object") return { authenticated: false };
    const budget = data.budget && typeof data.budget === "object"
        ? {
            spentUsd: Number.isFinite(Number(data.budget.spentUsd)) ? Number(data.budget.spentUsd) : 0,
            capUsd: Number.isFinite(Number(data.budget.capUsd)) ? Number(data.budget.capUsd) : null,
        }
        : null;
    return {
        authenticated: data.authenticated === true,
        gate: typeof data.gate === "string" ? data.gate : null,
        workspace: data.authenticated === true && typeof data.workspace === "string" ? data.workspace : null,
        budget,
        features: {
            fal: Boolean(data.features?.fal),
            openrouter: Boolean(data.features?.openrouter),
        },
    };
}

async function readBody(response) {
    const text = await response.text().catch(() => "");
    try {
        return { text, json: text ? JSON.parse(text) : null };
    } catch {
        return { text, json: null };
    }
}

function sessionError(prefix, response, body) {
    const message = typeof body.json?.message === "string" && body.json.message
        ? body.json.message
        : `${prefix}: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    if (typeof body.json?.error === "string") error.code = body.json.error;
    if (typeof body.json?.retry_after === "number") error.retryAfter = body.json.retry_after;
    return error;
}

/**
 * GET /api/session → {authenticated, gate, workspace, budget:{spentUsd, capUsd}, features}.
 * Concurrent callers share one request; `force` asks again (e.g. to refresh
 * the budget pill after a generation).
 */
export function getSessionStatus({ force = false } = {}) {
    if (inflight && !force) return inflight;
    if (!force && state.status === "ready") return Promise.resolve(state.session);
    const request = (async () => {
        if (state.status !== "ready") setState({ ...state, status: "loading" });
        try {
            const response = await fetch(SESSION_URL, {
                headers: { Accept: "application/json" },
                credentials: "same-origin",
                cache: "no-store",
            });
            const body = await readBody(response);
            if (!response.ok) throw sessionError("Session check failed", response, body);
            const session = normalizeSession(body.json);
            setState({ status: "ready", session });
            return session;
        } catch (error) {
            // Keep the last good session: a blip must not sign the studios out.
            setState({ status: state.session ? "ready" : "error", session: state.session });
            throw error;
        } finally {
            if (inflight === request) inflight = null;
        }
    })();
    inflight = request;
    return request;
}

/** POST /api/session {code}. Throws with the server's message (e.g. invalid code, 429). */
export async function signIn(code) {
    const response = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code: typeof code === "string" ? code.trim() : "" }),
    });
    const body = await readBody(response);
    if (!response.ok) throw sessionError("Sign-in failed", response, body);
    const session = normalizeSession(body.json);
    setState({ status: "ready", session });
    return session;
}

/** DELETE /api/session. Local state is cleared even if the request fails. */
export async function signOut() {
    try {
        await fetch(SESSION_URL, { method: "DELETE", credentials: "same-origin" });
    } finally {
        setState({
            status: "ready",
            session: { ...(state.session || {}), authenticated: false, workspace: null, budget: null },
        });
    }
}

// Short, stable, non-reversible tag for the signed-in workspace, used to
// scope browser storage. The workspace id itself is never written to
// localStorage.
export function workspaceScope(workspace) {
    if (typeof workspace !== "string" || !workspace) return null;
    let hash = 0;
    for (let i = 0; i < workspace.length; i++) {
        hash = (hash * 31 + workspace.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

export function getWorkspaceScope() {
    const session = state.session;
    return session?.authenticated ? workspaceScope(session.workspace) : null;
}

// ─── budget formatting ──────────────────────────────────────────────────────

export function formatUsd(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number > 0 && number < 0.01) return "<$0.01";
    return `$${number.toFixed(2)}`;
}

/** {spent:'$1.20', cap:'$10.00', remaining, fraction} or null when there is no cap. */
export function describeBudget(budget) {
    if (!budget || !Number.isFinite(budget.capUsd) || budget.capUsd <= 0) return null;
    const spent = Math.max(0, Number(budget.spentUsd) || 0);
    return {
        spent: formatUsd(spent),
        cap: formatUsd(budget.capUsd),
        remaining: formatUsd(Math.max(0, budget.capUsd - spent)),
        fraction: Math.min(1, spent / budget.capUsd),
    };
}
