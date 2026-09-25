// One-time cleanup of the provider key browsers kept before Aquora had its own
// backend. That key was a third-party secret stored in localStorage and in a
// readable cookie that rode along on every request to this origin. Nothing
// reads either any more, so the shell removes both on first load. (Studio
// history saved under the old per-key scope is carried over separately by
// packages/studio/src/persistKey.js, which does not need the key itself.)
//
// LEGACY_KEY_NAME is the storage name those browsers still hold. It is the
// only place the former provider's name appears in runtime code, and it has to
// be spelled exactly as it was stored (grep-gate allowlist: this file only).
const LEGACY_KEY_NAME = 'muapi_key';

function hasLegacyCookie(doc) {
    return typeof doc?.cookie === 'string'
        && doc.cookie.split(';').some((part) => part.trim().startsWith(`${LEGACY_KEY_NAME}=`));
}

// Removes the legacy key from localStorage and expires its cookie. Returns
// true when something was removed. Never throws.
export function clearLegacyKeyStorage(win = typeof window !== 'undefined' ? window : undefined) {
    if (!win) return false;
    let cleared = false;
    try {
        const storage = win.localStorage;
        if (storage && storage.getItem(LEGACY_KEY_NAME) !== null) {
            storage.removeItem(LEGACY_KEY_NAME);
            cleared = true;
        }
    } catch {
        // storage unavailable (private mode): nothing to clean
    }
    try {
        const doc = win.document;
        if (hasLegacyCookie(doc)) {
            const secure = win.location?.protocol === 'https:' ? '; Secure' : '';
            doc.cookie = `${LEGACY_KEY_NAME}=; path=/; max-age=0; SameSite=Lax${secure}`;
            cleared = true;
        }
    } catch {
        // cookies disabled
    }
    return cleared;
}
