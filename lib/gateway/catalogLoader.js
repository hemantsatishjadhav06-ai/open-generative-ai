// Single access point to the model catalog (lib/gateway/catalog/index.js,
// generated from the studio→fal model maps). Loaded lazily so gateway modules can be
// unit-tested with an injected catalog. Interface:
//   getEntry(key) → entry|null
//   listAvailable() → {enabled:[keys], disabled:[keys], disabled_models?:[ids]}
//   buildFalInput(entry, payload) → {input, endpoint?}  (throws Error .status=400 .field)
//     endpoint: the fal endpoint to submit to when a variant reroutes; else entry.fal
//   extractOutputs(entry, falOutput, endpoint?) → {urls, images?, video?, audio?}
//   estimateUsd(entry, payload) → number

import { shared } from './state.js';

const holder = () => shared('catalog', () => ({ override: null, loaded: null }));

export function setCatalogForTesting(catalog) {
    holder().override = catalog || null;
}

export async function getCatalog() {
    const h = holder();
    if (h.override) return h.override;
    if (!h.loaded) {
        h.loaded = import('./catalog/index.js').then((mod) => mod.default && typeof mod.getEntry !== 'function' ? mod.default : mod);
        h.loaded.catch(() => { h.loaded = null; });
    }
    return h.loaded;
}
