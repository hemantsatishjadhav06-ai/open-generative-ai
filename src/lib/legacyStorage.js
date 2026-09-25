// One-time cleanup of browser storage written by builds that ran on a
// third-party generation API, before Aquora had its own gateway.
//
// - The old provider key is removed by lib/legacyKeyCleanup.js (shared with
//   the web shell).
// - Image history moves to an Aquora-named key; the other studios' history
//   keys never carried the provider's name and stay as they are.
// - Pending jobs and upload history are dropped: those job ids and hosted
//   upload URLs belong to the old provider and can't be resumed or reused on
//   the Aquora gateway.
//
// The storage names below must be spelled exactly as they were stored, so
// this file (like lib/legacyKeyCleanup.js) names the former provider. It is
// the only file under src/ that does (grep-gate allowlist).
import { clearLegacyKeyStorage } from '../../lib/legacyKeyCleanup.js';

export const IMAGE_HISTORY_KEY = 'aquora_image_history';

const RENAMED_KEYS = [['muapi_history', IMAGE_HISTORY_KEY]];
const DROPPED_KEYS = ['muapi_pending_jobs', 'muapi_uploads'];

/** Runs once per launch before any studio mounts. Never throws. */
export function migrateLegacyStorage(win = typeof window !== 'undefined' ? window : undefined) {
    if (!win) return;
    clearLegacyKeyStorage(win);
    try {
        const storage = win.localStorage;
        for (const [from, to] of RENAMED_KEYS) {
            const value = storage.getItem(from);
            if (value === null) continue;
            if (storage.getItem(to) === null) storage.setItem(to, value);
            storage.removeItem(from);
        }
        for (const key of DROPPED_KEYS) storage.removeItem(key);
    } catch {
        // storage unavailable (private mode, quota): nothing to migrate
    }
}
