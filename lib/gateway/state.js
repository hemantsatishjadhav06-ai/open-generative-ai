// Process-wide state for the gateway (rate buckets, job registry, budget
// ledger, caches). Next.js can load the same lib module into several route
// bundles and `next dev` re-evaluates modules on every edit, so anything that
// must be shared between e.g. the submit route and the poll route lives on
// globalThis under one well-known symbol instead of in module scope.

const KEY = Symbol.for('aquora.gateway.state');

function root() {
    if (!globalThis[KEY]) globalThis[KEY] = new Map();
    return globalThis[KEY];
}

export function shared(name, init) {
    const store = root();
    if (!store.has(name)) store.set(name, init());
    return store.get(name);
}

// Test helper: drops every piece of shared state so each test starts clean.
export function resetSharedState(names) {
    const store = root();
    if (Array.isArray(names)) {
        for (const name of names) store.delete(name);
        return;
    }
    store.clear();
}
