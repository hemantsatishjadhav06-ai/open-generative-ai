// Scopes a studio's localStorage key to the signed-in Aquora workspace (the
// access code the person used; everyone sharing a code shares a workspace).
// Without this, different people signing in on one browser would read and
// write the same history and drafts.
//
// Key format: `${baseKey}:ws-${scope}`, where scope is a short hash of the
// workspace id (session.js workspaceScope); the id itself is never stored.
// Earlier versions scoped by a hash of the old API key (`${baseKey}:<hash>`)
// or not at all (`${baseKey}`). The first workspace to sign in on a browser
// inherits that history once (migrateLegacyPersistKey); the legacy copies are
// then removed so a later workspace can't pick them up.
import { useEffect, useSyncExternalStore } from "react";
import {
  getSessionSnapshot,
  getSessionStatus,
  getWorkspaceScope,
  subscribeSession,
} from "./session.js";

const WORKSPACE_MARKER = ":ws-";
const migratedKeys = new Set();

export function workspacePersistKey(baseKey, scope) {
  return scope ? `${baseKey}${WORKSPACE_MARKER}${scope}` : null;
}

function isLegacyKeyFor(baseKey, key) {
  if (key === baseKey) return true;
  if (!key.startsWith(`${baseKey}:`)) return false;
  // Old identity hashes were 1-7 base36 characters; anything else (e.g. a
  // workspace key, or another key sharing this prefix) is not a legacy copy.
  return /^[0-9a-z]{1,7}$/.test(key.slice(baseKey.length + 1));
}

// One-time carryover into the workspace key: when the workspace has nothing
// stored yet, the largest legacy entry (the one with the most history) moves
// over; every legacy entry for this base key is then deleted.
export function migrateLegacyPersistKey(baseKey, scopedKey) {
  if (!scopedKey || scopedKey === baseKey || migratedKeys.has(scopedKey)) return;
  migratedKeys.add(scopedKey);
  try {
    const legacyKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isLegacyKeyFor(baseKey, key)) legacyKeys.push(key);
    }
    if (legacyKeys.length === 0) return;
    if (!localStorage.getItem(scopedKey)) {
      let best = null;
      for (const key of legacyKeys) {
        const value = localStorage.getItem(key);
        if (value && (!best || value.length > best.length)) best = value;
      }
      if (best) localStorage.setItem(scopedKey, best);
    }
    for (const key of legacyKeys) localStorage.removeItem(key);
  } catch {
    // localStorage unavailable (private mode, quota) — nothing to migrate
  }
}

/**
 * Non-React callers: the workspace-scoped key, or `baseKey` while no one is
 * signed in. The second argument (the old API key) is ignored. Components
 * should use usePersistKey instead.
 */
export function scopedPersistKey(baseKey) {
  const key = workspacePersistKey(baseKey, getWorkspaceScope());
  if (!key) return baseKey;
  migrateLegacyPersistKey(baseKey, key);
  return key;
}

const getServerScope = () => null;

/**
 * React hook: the workspace-scoped key for `baseKey`, or null until the
 * session is known (and while signed out). Components skip their
 * localStorage load/save while it is null and load again when it changes, so
 * nothing is written under the wrong workspace. Legacy keys have already been
 * migrated when a key is returned.
 */
export function usePersistKey(baseKey) {
  const scope = useSyncExternalStore(subscribeSession, getWorkspaceScope, getServerScope);
  useEffect(() => {
    if (getSessionSnapshot().status === "unknown") getSessionStatus().catch(() => {});
  }, []);
  const key = workspacePersistKey(baseKey, scope);
  if (key && typeof window !== "undefined") migrateLegacyPersistKey(baseKey, key);
  return key;
}
