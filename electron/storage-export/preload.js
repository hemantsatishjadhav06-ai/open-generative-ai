// Runs in a hidden file:// window once, on the first launch after the
// renderer moved to aquora://app (see ../lib/storageMigration.js). Reads the
// old file:// localStorage and hands it to the main process. Values are
// passed through as-is and never logged.
const { ipcRenderer } = require('electron');

function exportStorage() {
    let entries = null;
    try {
        entries = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== null) entries.push([key, localStorage.getItem(key)]);
        }
    } catch {
        entries = null;
    }
    ipcRenderer.send('aquora-storage:export', entries);
}

// The preload can also run in the window's initial about:blank document (an
// opaque origin, where localStorage throws). Only the file:// page answers;
// otherwise that null would end the export before the page has loaded.
if (location.protocol === 'file:') exportStorage();
