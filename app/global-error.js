'use client';

import { useEffect } from 'react';

// Last-resort boundary: replaces the root layout, so it renders its own
// <html>/<body> with inline styles (no Tailwind, no next/font).
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#08060f', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Something broke.</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#a8a3bd' }}>Try again, or head back to the studio.</p>
            <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{ background: '#c6f135', color: '#08060f', border: 0, borderRadius: 16, padding: '12px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Try again
              </button>
              {/* Full page load on purpose: the app shell itself may be what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/studio"
                style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', borderRadius: 16, padding: '12px 24px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
              >
                Back to studio
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
