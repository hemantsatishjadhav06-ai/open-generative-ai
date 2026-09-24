// Lightweight balance helper with no imports, so the app shell can check a
// key (and poll the balance) without statically pulling in muapi.js and the
// ~1 MB model catalog it depends on. muapi.js re-exports getUserBalance from
// here, so `import { getUserBalance } from 'studio'` keeps working.

// Same routing rule as muapi.js: in an http(s) browser go through the host
// app's /api proxy; SSR and Electron's file:// renderer call upstream directly.
const BASE_URL = (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http'))
    ? '/api'
    : 'https://api.muapi.ai';

function notifyAuthRequired(status, detail) {
    if (typeof window === 'undefined') return;
    if (status !== 401 && status !== 403) return;
    window.dispatchEvent(new CustomEvent('muapi:auth-required', { detail: { status, message: detail } }));
}

export async function getUserBalance(apiKey) {
    const response = await fetch(`${BASE_URL}/api/v1/account/balance`, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        notifyAuthRequired(response.status, errText);
        const error = new Error(`Failed to fetch balance: ${response.status} - ${errText.slice(0, 100)}`);
        error.status = response.status;
        error.body = errText.slice(0, 500);
        throw error;
    }
    return await response.json();
}
