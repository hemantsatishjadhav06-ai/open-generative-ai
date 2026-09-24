'use client';

import { useEffect, useState } from 'react';
import { getCommonCopy } from '@/lib/locales';

const SPARK_PATH = 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z';

// Soft radial brand -> pop glow that sits behind the card.
const GLOW_STYLE = {
  background:
    'radial-gradient(60% 55% at 50% 0%, rgba(198, 241, 53, 0.18) 0%, rgba(198, 241, 53, 0) 70%),' +
    'radial-gradient(55% 50% at 100% 100%, rgba(255, 60, 172, 0.16) 0%, rgba(255, 60, 172, 0) 70%)',
};

function SparkMark() {
  return (
    <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand shadow-glow">
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={SPARK_PATH} className="fill-surface-app" />
      </svg>
    </div>
  );
}

function EyeIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// onSave(key) may return nothing, or a string error message (e.g. the key was
// rejected) which is shown inline and keeps the modal open.
export default function ApiKeyModal({ onSave, onClose, onOpenReelty, overlay = false, title, subtitle, locale = 'en' }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const copy = getCommonCopy(locale).apiKeyModal;

  // Esc closes the overlay variant (the full-screen key wall has nothing to close to).
  useEffect(() => {
    if (!overlay || !onClose) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay, onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) { setError(copy.missingKeyError); return; }
    setBusy(true);
    try {
      const result = await onSave(trimmed);
      if (typeof result === 'string' && result) setError(result);
    } finally {
      setBusy(false);
    }
  };

  const wrapperClass = overlay
    ? 'fixed inset-0 z-[200] bg-surface-app/80 backdrop-blur-sm flex items-center justify-center px-4 animate-fade-in-up'
    : 'relative min-h-screen bg-surface-app flex items-center justify-center px-4 overflow-hidden';

  const chips = Array.isArray(copy.chips) ? copy.chips : [];

  return (
    <div
      className={wrapperClass}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? 'true' : undefined}
      aria-labelledby={overlay ? 'creator-agency-api-key-title' : undefined}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={GLOW_STYLE} />

      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-surface-panel/90 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        {overlay && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="mb-8 flex flex-col items-center text-center">
          <SparkMark />
          <h1 id="creator-agency-api-key-title" className="font-display mb-2 text-2xl font-bold tracking-tight text-white">
            {title || copy.title}
          </h1>
          {chips.length > 0 && (
            <p className="mb-3 text-[12px] font-medium text-secondary">
              {chips.map((chip, index) => (
                <span key={chip}>
                  {index > 0 && <span aria-hidden="true" className="mx-1.5 text-white/30">·</span>}
                  {chip}
                </span>
              ))}
            </p>
          )}
          <p className="px-2 text-[13px] leading-relaxed text-secondary">
            {subtitle || copy.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="creator-agency-api-key" className="ml-1 block text-xs font-semibold text-secondary">
              {copy.label}
            </label>
            <div className="relative">
              <input
                id="creator-agency-api-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => { setKey(e.target.value); setError(''); }}
                placeholder={copy.placeholder}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'creator-agency-api-key-error' : undefined}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-11 text-sm text-white transition-all placeholder:text-white/25 focus:border-brand/40 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-pressed={showKey}
                aria-controls="creator-agency-api-key"
                aria-label={showKey ? copy.hideKey : copy.showKey}
                title={showKey ? copy.hideKey : copy.showKey}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <EyeIcon open={showKey} />
              </button>
            </div>
            {error && (
              <p id="creator-agency-api-key-error" role="alert" className="ml-1 mt-2 text-[11px] font-medium text-red-400">
                {error}
              </p>
            )}
            <details className="ml-1 pt-1 text-[12px] text-secondary">
              <summary className="cursor-pointer select-none rounded font-medium text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                {copy.helpSummary}
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4 leading-relaxed">
                {(copy.helpSteps || []).map((step, i) => <li key={i}>{step}</li>)}
              </ol>
              <p className="mt-2 text-white/50">{copy.helpNote}</p>
            </details>
          </div>

          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-surface-app shadow-[0_8px_30px_rgba(198,241,53,0.25)] transition-all hover:bg-brand-hover hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {busy ? copy.checking : copy.submit}
          </button>

          <p className="pt-1 text-center text-[12px] text-secondary">
            {copy.needKey}{' '}
            <a href="https://muapi.ai/access-keys" target="_blank" rel="noreferrer" className="font-medium text-brand transition-colors hover:text-brand-hover">
              {copy.getOneFree}
            </a>
          </p>
          {onOpenReelty && (
            <p className="-mt-3 text-center text-[12px]">
              <button
                type="button"
                onClick={onOpenReelty}
                className="font-medium text-white/60 underline-offset-2 transition-colors hover:text-pop hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
              >
                {copy.reeltyOnly}
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
