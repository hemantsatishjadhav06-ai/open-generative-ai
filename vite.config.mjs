import { defineConfig } from 'vite';

// Legacy standalone app (the desktop renderer). Cloud calls use same-origin
// /api/* paths; under `vite` they are proxied to an Aquora gateway — by
// default the Next.js app on this machine (`npm run dev`), or
// AQUORA_API_BASE. In the desktop build the Electron main process does the
// forwarding instead (electron/lib/gatewayBridge.js).
const gatewayTarget = (() => {
    try {
        return new URL(process.env.AQUORA_API_BASE || 'http://localhost:3000').origin;
    } catch {
        return 'http://localhost:3000';
    }
})();

export default defineConfig({
    base: './',
    server: {
        proxy: {
            '/api': {
                target: gatewayTarget,
                changeOrigin: true,
                // The gateway only accepts same-origin writes: present its own
                // origin, as the browser would when the app is served by it.
                configure: (proxy) => {
                    proxy.on('proxyReq', (proxyReq) => {
                        if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', gatewayTarget);
                    });
                },
            },
        },
    },
});
