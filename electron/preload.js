const { contextBridge, ipcRenderer } = require('electron');

// First launch after the renderer moved from file:// to aquora://app: copy
// the old localStorage in before any app script runs, never overwriting a
// key this origin already has (see lib/storageMigration.js). sendSync
// answers null on every later launch.
(() => {
    let entries = null;
    try {
        entries = ipcRenderer.sendSync('aquora-storage:take');
    } catch {
        return;
    }
    if (!Array.isArray(entries)) return;
    try {
        for (const [key, value] of entries) {
            if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
        }
        ipcRenderer.send('aquora-storage:imported');
    } catch {
        // storage full or unavailable: leave the marker unset and retry next launch
    }
})();

// Which Aquora server cloud requests go to (AQUORA_API_BASE). Display only:
// requests always use same-origin /api/* paths.
let gatewayOrigin = null;
try {
    gatewayOrigin = ipcRenderer.sendSync('aquora:gateway-origin');
} catch {
    gatewayOrigin = null;
}
contextBridge.exposeInMainWorld('aquoraDesktop', {
    gatewayOrigin: typeof gatewayOrigin === 'string' ? gatewayOrigin : null,
});

contextBridge.exposeInMainWorld('localAI', {
    isElectron: true,

    // ── sd.cpp engine ──────────────────────────────────────────────────────
    getBinaryStatus: () => ipcRenderer.invoke('local-ai:binary-status'),
    downloadBinary: () => ipcRenderer.invoke('local-ai:download-binary'),

    listModels: () => ipcRenderer.invoke('local-ai:list-models'),
    downloadModel: (modelId) => ipcRenderer.invoke('local-ai:download-model', modelId),
    downloadAuxiliary: (auxKey) => ipcRenderer.invoke('local-ai:download-auxiliary', auxKey),
    deleteModel: (modelId) => ipcRenderer.invoke('local-ai:delete-model', modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke('local-ai:cancel-download', modelId),

    generate: (params) => ipcRenderer.invoke('local-ai:generate', params),
    cancelGeneration: () => ipcRenderer.invoke('local-ai:cancel-generation'),

    // ── Wan2GP engine (remote Gradio server) ───────────────────────────────
    wan2gp: {
        getConfig:  () => ipcRenderer.invoke('wan2gp:get-config'),
        setUrl:     (url) => ipcRenderer.invoke('wan2gp:set-url', url),
        probe:      (url) => ipcRenderer.invoke('wan2gp:probe', url),
        listModels: () => ipcRenderer.invoke('wan2gp:list-models'),
        generate:   (params) => ipcRenderer.invoke('wan2gp:generate', params),
        cancelGeneration: () => ipcRenderer.invoke('wan2gp:cancel-generation'),
        uploadFile: (payload) => ipcRenderer.invoke('wan2gp:upload-file', payload),
    },

    // Progress events — both engines emit on local-ai:progress
    onProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('local-ai:progress', listener);
        return () => ipcRenderer.removeListener('local-ai:progress', listener);
    },
    onDownloadProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('local-ai:download-progress', listener);
        return () => ipcRenderer.removeListener('local-ai:download-progress', listener);
    },
});
