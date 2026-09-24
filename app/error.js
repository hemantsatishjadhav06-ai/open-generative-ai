'use client';

import { useEffect } from 'react';
import Link from 'next/link';

// Route-level error boundary. Client component, so it can't read the locale
// header; the copy is short English on purpose. error.message is never shown.
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-surface-app text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight">Something broke.</h1>
        <p className="mt-2 text-sm text-secondary">Try again, or head back to the studio.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-2xl bg-brand px-6 py-3 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            Try again
          </button>
          <Link
            href="/studio"
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-surface-card px-6 py-3 text-sm font-semibold text-white/80 transition-colors hover:border-white/20 hover:text-white"
          >
            Back to studio
          </Link>
        </div>
      </div>
    </main>
  );
}
