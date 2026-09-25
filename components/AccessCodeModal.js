'use client';

import { useEffect, useRef, useState } from 'react';
import { fillCopy, getCommonCopy } from '@/lib/locales';
import { STUDIO_TAB_IDS } from '@/lib/studioTabs';

const SPARK_PATH = 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z';

// Soft radial brand -> pop glow that sits behind the card.
const GLOW_STYLE = {
  background:
    'radial-gradient(60% 55% at 50% 0%, rgba(46, 230, 214, 0.18) 0%, rgba(46, 230, 214, 0) 70%),' +
    'radial-gradient(55% 50% at 100% 100%, rgba(59, 130, 246, 0.16) 0%, rgba(59, 130, 246, 0) 70%)',
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function SparkMark() {
  return (
    <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={SPARK_PATH} className="fill-on-brand" />
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

// Shared frame: the full-screen wall, or a modal overlay above the studio.
// The overlay closes on Esc and keeps Tab focus inside the card.
function GateFrame({ overlay, onClose, labelledBy, closeLabel, children }) {
  const cardRef = useRef(null);

  useEffect(() => {
    if (!overlay) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const items = Array.from(cardRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay, onClose]);

  const wrapperClass = overlay
    ? 'fixed inset-0 z-[200] bg-surface-app/80 backdrop-blur-sm flex items-center justify-center px-4 animate-fade-in-up'
    : 'relative min-h-screen bg-surface-app flex items-center justify-center px-4 py-10 overflow-hidden';

  const card = (
    <div ref={cardRef} className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-surface-panel/90 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
      {overlay && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {children}
    </div>
  );

  return overlay ? (
    <div className={wrapperClass} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={GLOW_STYLE} />
      {card}
    </div>
  ) : (
    <main className={wrapperClass}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={GLOW_STYLE} />
      {card}
    </main>
  );
}

function ReeltyLink({ onOpenReelty, label }) {
  if (!onOpenReelty) return null;
  return (
    <p className="text-center text-[12px]">
      <button
        type="button"
        onClick={onOpenReelty}
        className="rounded font-medium text-white/60 underline-offset-2 transition-colors hover:text-pop-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {label}
      </button>
    </p>
  );
}

// Access-code sign-in. `onSubmit(code)` resolves to null on success or to a
// localized error string, which is shown inline and keeps the form open.
// The code goes straight to POST /api/session; nothing is stored in the
// browser (the server answers with an HttpOnly cookie).
export default function AccessCodeModal({ onSubmit, onClose, onOpenReelty, overlay = false, title, subtitle, locale = 'en' }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const copy = getCommonCopy(locale).accessCodeModal;
  const titleId = overlay ? 'aquora-access-code-dialog-title' : 'aquora-access-code-title';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError(copy.missingCodeError);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await onSubmit(trimmed);
      if (typeof result === 'string' && result) setError(result);
    } catch {
      setError(copy.genericError);
    } finally {
      setBusy(false);
    }
  };

  const chips = (Array.isArray(copy.chips) ? copy.chips : [])
    .map((chip) => fillCopy(chip, { studios: STUDIO_TAB_IDS.length }));

  return (
    <GateFrame overlay={overlay} onClose={onClose} labelledBy={titleId} closeLabel={copy.close}>
      <div className="mb-8 flex flex-col items-center text-center">
        <SparkMark />
        <h1 id={titleId} className="font-display mb-2 text-2xl font-bold tracking-tight text-white">
          {title || copy.title}
        </h1>
        {!overlay && chips.length > 0 && (
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

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="aquora-access-code" className="ml-1 block text-xs font-semibold text-secondary">
            {copy.label}
          </label>
          <div className="relative">
            <input
              id="aquora-access-code"
              name="access-code"
              type={showCode ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              // The wall and the overlay exist only to take this code.
              autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(''); }}
              placeholder={copy.placeholder}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'aquora-access-code-error' : 'aquora-access-code-help'}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-11 text-sm text-white transition-all placeholder:text-white/40 focus:border-brand/40 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              aria-pressed={showCode}
              aria-controls="aquora-access-code"
              aria-label={showCode ? copy.hideCode : copy.showCode}
              title={showCode ? copy.hideCode : copy.showCode}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <EyeIcon open={showCode} />
            </button>
          </div>
          {error && (
            <p id="aquora-access-code-error" role="alert" className="ml-1 mt-2 text-[12px] font-medium text-red-400">
              {error}
            </p>
          )}
          <details id="aquora-access-code-help" className="ml-1 pt-1 text-[12px] text-secondary">
            <summary className="cursor-pointer select-none rounded font-medium text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
              {copy.helpSummary}
            </summary>
            <p className="mt-2 leading-relaxed">{copy.helpBody}</p>
            <p className="mt-2 leading-relaxed text-white/60">{copy.helpNote}</p>
          </details>
        </div>

        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-on-brand shadow-[0_8px_30px_rgba(46,230,214,0.25)] transition-all hover:bg-brand-hover hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          {busy ? copy.checking : copy.submit}
        </button>

        <ReeltyLink onOpenReelty={onOpenReelty} label={copy.reeltyOnly} />
      </form>
    </GateFrame>
  );
}

// Full-screen notice when there is no sign-in to offer: the deployment is not
// set up yet ('setup'), or /api/session could not be reached ('offline').
export function GateNotice({ kind = 'offline', onRetry, onOpenReelty, locale = 'en' }) {
  const copy = getCommonCopy(locale).accessCodeModal;
  const [busy, setBusy] = useState(false);
  const title = kind === 'setup' ? copy.setupTitle : copy.offlineTitle;
  const body = kind === 'setup' ? copy.setupBody : copy.offlineBody;

  const retry = async () => {
    if (!onRetry || busy) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateFrame overlay={false} labelledBy="aquora-gate-notice-title" closeLabel={copy.close}>
      <div className="flex flex-col items-center text-center">
        <SparkMark />
        <h1 id="aquora-gate-notice-title" className="font-display mb-2 text-2xl font-bold tracking-tight text-white">
          {title}
        </h1>
        <p className="px-2 text-[13px] leading-relaxed text-secondary">{body}</p>
      </div>
      <div className="mt-8 space-y-5">
        {onRetry && (
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            aria-busy={busy}
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? copy.checking : copy.retry}
          </button>
        )}
        <ReeltyLink onOpenReelty={onOpenReelty} label={copy.reeltyOnly} />
      </div>
    </GateFrame>
  );
}
