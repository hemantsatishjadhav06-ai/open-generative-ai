const { app, BrowserWindow, shell, dialog, protocol, net, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { register: registerLocalInference } = require('./lib/localInference');
const { register: registerWan2gp } = require('./lib/wan2gpProvider');
const {
    API_BASE_ENV,
    createElectronCookieJar,
    createGatewayProxy,
    isApiPath,
    resolveApiBase,
} = require('./lib/gatewayBridge');
const {
    APP_ENTRY_URL,
    APP_SCHEME_PRIVILEGES,
    isAppUrl,
    isExternalWebUrl,
    registerAppProtocol,
} = require('./lib/appProtocol');
const { createStorageMigration } = require('./lib/storageMigration');

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    try {
        dialog.showErrorBox('Aquora — Unexpected error', err && err.stack ? err.stack : String(err));
    } catch (_) {
        // dialog unavailable this early; the console log above is the fallback
    }
});

// Ubuntu 24.04+ sets kernel.apparmor_restrict_unprivileged_userns=1 which
// blocks Chromium's user namespace sandbox. The .deb package ships an AppArmor
// profile that grants the permission cleanly. When running the AppImage on an
// affected system, run once: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
// or pass --no-sandbox on the command line.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-dev-shm-usage');
}

// The renderer runs on aquora://app/ (a real origin, so it can call the
// gateway with same-origin /api/* requests). Must be registered before ready.
protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES]);

// Cloud models run on an Aquora deployment's gateway: AQUORA_API_BASE, or
// the hosted site by default. The session cookie from the access-code
// sign-in lives in Electron's persistent cookie store, in the main process.
const apiBase = resolveApiBase(process.env[API_BASE_ENV]);
if (apiBase.warning) console.warn(`[gateway] ${apiBase.warning}`);

let mainWindow;

// `beforeLoad` delays loading the app (not creating the window) until the
// one-time storage migration has read the old storage. Creating the window
// first matters: the migration's hidden window must never be the last one
// open, or 'window-all-closed' would quit the app.
function createWindow(beforeLoad = Promise.resolve()) {
    const isMac = process.platform === 'darwin';

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        webPreferences: {
            webSecurity: true,
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
        ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
        backgroundColor: '#050b14',
        show: false,
        title: 'Aquora',
    });

    const win = mainWindow;
    beforeLoad.finally(() => {
        if (win.isDestroyed()) return;
        win.loadURL(APP_ENTRY_URL).catch((err) => {
            console.error('Failed to load the app:', err);
            if (!win.isDestroyed()) win.show();
        });
    });

    mainWindow.webContents.on('did-fail-load', (event, code, desc) => {
        console.error('did-fail-load:', code, desc);
    });

    // Links open in the system browser; the window itself never leaves the app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isExternalWebUrl(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isAppUrl(url)) return;
        event.preventDefault();
        if (isExternalWebUrl(url)) shell.openExternal(url);
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function registerGateway() {
    const proxy = createGatewayProxy({
        apiBase: apiBase.origin,
        jar: createElectronCookieJar(session.defaultSession.cookies),
        fetchImpl: fetch,
        // Only the error class and code: never URLs, headers, cookies or bodies.
        onError: (error) => console.warn('[gateway] request failed:', error?.name || 'Error', error?.cause?.code || error?.code || ''),
    });
    registerAppProtocol({
        protocol,
        net,
        distDir: path.join(__dirname, '../dist'),
        proxy,
        isApiPath,
    });
}

app.whenReady().then(() => {
    registerGateway();
    // Settings shows which Aquora server the desktop app talks to.
    ipcMain.on('aquora:gateway-origin', (event) => {
        event.returnValue = isAppUrl(event.senderFrame?.url || '') ? apiBase.origin : null;
    });

    const storageMigration = createStorageMigration({
        app,
        BrowserWindow,
        ipcMain,
        session,
        fs,
        isAppUrl,
        exportPage: path.join(__dirname, 'storage-export', 'index.html'),
        exportPreload: path.join(__dirname, 'storage-export', 'preload.js'),
    });
    const migrationReady = storageMigration.prepare().catch((err) => {
        console.warn('[storage] migration skipped:', err?.message || err);
    });

    createWindow(migrationReady);

    try {
        registerLocalInference();
        registerWan2gp();
    } catch (err) {
        console.error('Failed to register local-ai/wan2gp handlers:', err);
        dialog.showErrorBox(
            'Local AI features unavailable',
            `Aquora started, but local model support failed to initialize:\n\n${err.message}`
        );
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
