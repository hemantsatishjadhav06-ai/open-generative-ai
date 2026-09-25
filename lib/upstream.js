// Provider-neutral helpers for reading upstream HTTP replies (fal.ai,
// OpenRouter). No next/server import, so they unit-test with plain node.

export function stripTags(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Maps an upstream status + raw body text to { status, body }. JSON replies
// pass through untouched. Non-JSON replies become a JSON envelope: 4xx keep
// their status, anything else becomes 502.
export function normalizeUpstream(status, text) {
    const body = typeof text === 'string' ? text : '';
    if (status === 204 || status === 205 || status === 304) {
        return { status, body: null };
    }
    if (body.trim() === '') {
        return { status, body: {} };
    }
    try {
        return { status, body: JSON.parse(body) };
    } catch {
        const envelope = {
            error: 'upstream_unavailable',
            message: 'The AI service returned an unexpected response. Try again in a moment.',
            upstream_status: status,
            detail: stripTags(body),
        };
        if (status >= 400 && status < 500) return { status, body: envelope };
        return { status: 502, body: envelope };
    }
}

// Network failures and timeouts never surface as a bare 500.
export function mapProxyError(error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return {
            status: 504,
            body: { error: 'upstream_timeout', message: 'The AI service took too long to respond. Try again.' },
        };
    }
    return {
        status: 502,
        body: {
            error: 'upstream_unreachable',
            message: "Couldn't reach the AI service. Check your connection and try again.",
        },
    };
}

// Reads a fetch Response as text and parses it with normalizeUpstream.
export async function readUpstream(response) {
    const text = await response.text();
    return normalizeUpstream(response.status, text);
}

export const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, ms);
        function onAbort() {
            clearTimeout(timer);
            reject(signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        }
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });

// Exponential backoff with jitter: 0 → ~500ms, 1 → ~1s, 2 → ~2s …
export function backoffMs(attempt, baseMs = 500, maxMs = 8000) {
    const exp = Math.min(maxMs, baseMs * 2 ** attempt);
    return Math.round(exp / 2 + Math.random() * (exp / 2));
}

// Combines an optional caller signal with a timeout.
export function withTimeout(signal, ms) {
    const timeout = AbortSignal.timeout(ms);
    if (!signal) return timeout;
    return AbortSignal.any([signal, timeout]);
}
