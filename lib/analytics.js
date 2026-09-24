// Vendor-neutral client event plumbing. No vendor and no endpoint is enabled
// by default: events go to window.__ca_events (ring buffer) and a `ca:track`
// DOM event any vendor snippet can listen to. Set
// NEXT_PUBLIC_ANALYTICS_ENDPOINT to also POST each event there via
// sendBeacon. Must import cleanly in Node (tests), so every browser global is
// guarded, and track() never throws.

const MAX_BUFFER = 200;
const ENDPOINT = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT || '';

// Never let secrets or user content into analytics.
const BLOCKED_KEYS = new Set(['key', 'apiKey', 'api_key', 'prompt', 'url', 'resultUrl', 'email']);

export function sanitize(props) {
    const out = {};
    if (!props || typeof props !== 'object') return out;
    for (const [k, v] of Object.entries(props)) {
        if (BLOCKED_KEYS.has(k)) continue;
        if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
}

export function track(event, props = {}) {
    if (typeof window === 'undefined') return;
    try {
        const detail = { ...sanitize(props), event, ts: Date.now(), path: window.location?.pathname || '' };
        const buffer = Array.isArray(window.__ca_events) ? window.__ca_events : [];
        buffer.push(detail);
        while (buffer.length > MAX_BUFFER) buffer.shift();
        window.__ca_events = buffer;

        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ca:track', { detail }));
        }

        if (ENDPOINT) {
            const body = JSON.stringify(detail);
            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
            } else if (typeof fetch === 'function') {
                fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
            }
        }
    } catch {
        // analytics must never break the app
    }
}

// Exposes track() to the studio package (packages/studio/src/track.js),
// which cannot import app-level modules.
export function installAnalytics() {
    if (typeof window === 'undefined') return;
    if (window.__caTrack !== track) window.__caTrack = track;
}
