// One-time move of the renderer's localStorage from file:// to aquora://app.
//
// Earlier desktop builds loaded dist/index.html from file://, so generation
// history, upload history, the language choice and similar preferences live
// in the file:// origin's localStorage. The renderer now runs on aquora://app
// (appProtocol.js), a different origin with empty storage. On the first
// launch after the upgrade:
//   1. a hidden window on a file:// page reads the old storage (export);
//   2. the main window's preload copies those entries into aquora://app
//      before any app script runs, never overwriting a key that exists;
//   3. once the preload confirms, a marker file records that it is done and
//      the file:// copy is cleared, so an old provider key the renderer used
//      to keep there does not linger on disk.
// The renderer then renames its own legacy keys (src/lib/legacyStorage.js).
// Every step fails soft: at worst the app starts with empty history.

const path = require('path');

const MARKER_FILE = 'storage-origin-migrated-v1';
const EXPORT_CHANNEL = 'aquora-storage:export';
const TAKE_CHANNEL = 'aquora-storage:take';
const IMPORTED_CHANNEL = 'aquora-storage:imported';
const EXPORT_TIMEOUT_MS = 5000;
// localStorage caps an origin at ~5 MB; refuse anything absurd.
const MAX_ENTRIES = 5000;
const MAX_TOTAL_CHARS = 10 * 1024 * 1024;

/** Keeps well-formed [key, value] string pairs, within the size caps. */
function sanitizeEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const out = [];
    let total = 0;
    for (const entry of entries) {
        if (out.length >= MAX_ENTRIES) break;
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, value] = entry;
        if (typeof key !== 'string' || !key || typeof value !== 'string') continue;
        total += key.length + value.length;
        if (total > MAX_TOTAL_CHARS) break;
        out.push([key, value]);
    }
    return out;
}

/**
 * Main-process side. `prepare()` runs before the main window loads and
 * resolves once the old storage has been read (or there is nothing to do).
 */
function createStorageMigration({ app, BrowserWindow, ipcMain, session, fs, isAppUrl, exportPage, exportPreload }) {
    const markerPath = path.join(app.getPath('userData'), MARKER_FILE);
    let pending = null;

    const done = () => {
        try {
            return fs.existsSync(markerPath);
        } catch {
            return false;
        }
    };

    const markDone = () => {
        try {
            fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`);
        } catch {
            // next launch tries again; importEntries never overwrites
        }
    };

    function readFileOriginStorage() {
        return new Promise((resolve) => {
            let settled = false;
            let win = null;
            const finish = (entries) => {
                if (settled) return;
                settled = true;
                ipcMain.removeListener(EXPORT_CHANNEL, onExport);
                clearTimeout(timer);
                if (win && !win.isDestroyed()) win.destroy();
                resolve(entries);
            };
            const onExport = (event, entries) => {
                if (!win || event.sender !== win.webContents) return;
                finish(Array.isArray(entries) ? sanitizeEntries(entries) : null);
            };
            const timer = setTimeout(() => finish(null), EXPORT_TIMEOUT_MS);
            ipcMain.on(EXPORT_CHANNEL, onExport);
            try {
                win = new BrowserWindow({
                    show: false,
                    width: 200,
                    height: 200,
                    webPreferences: { preload: exportPreload, contextIsolation: true, nodeIntegration: false, sandbox: true },
                });
                win.loadFile(exportPage).catch(() => finish(null));
            } catch {
                finish(null);
            }
        });
    }

    ipcMain.on(TAKE_CHANNEL, (event) => {
        const fromApp = isAppUrl(event.senderFrame?.url || '');
        event.returnValue = fromApp ? pending : null;
        if (fromApp) pending = null;
    });

    ipcMain.on(IMPORTED_CHANNEL, async (event) => {
        if (!isAppUrl(event.senderFrame?.url || '') || done()) return;
        markDone();
        try {
            await session.defaultSession.clearStorageData({ origin: 'file://', storages: ['localstorage'] });
        } catch {
            // best effort
        }
    });

    return {
        async prepare() {
            if (done()) return;
            const entries = await readFileOriginStorage();
            // null: the export failed; try again next launch. []: nothing to move.
            if (entries === null) return;
            pending = entries;
        },
    };
}

module.exports = {
    EXPORT_CHANNEL,
    IMPORTED_CHANNEL,
    MARKER_FILE,
    TAKE_CHANNEL,
    createStorageMigration,
    sanitizeEntries,
};
