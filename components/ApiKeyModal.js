'use client';

import { useState } from 'react';
import { getCommonCopy } from '@/lib/locales';

// Chip row under the title. Kept as plain strings in the JSX for this pass so
// the copy agent can move them into messages/** and localize later.
const HIGHLIGHT_CHIPS = ['400+ models', '17 studios', 'Reelty inside'];

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
        <path d={SPARK_PATH} fill="#08060f" />
      </svg>
    </div>
  );
}

export default function ApiKeyModal({ onSave, onClose, overlay = false, title, subtitle, locale = 'en' }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const copy = getCommonCopy(locale).apiKeyModal;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) { setError(copy.missingKeyError); return; }
    onSave(trimmed);
  };

  const wrapperClass = overlay
    ? 'fixed inset-0 z-[200] bg-surface-app/80 backdrop-blur-sm flex items-center justify-center px-4 animate-fade-in-up'
    : 'relative min-h-screen bg-surface-app flex items-center justify-center px-4 overflow-hidden';

  return (
    <div className={wrapperClass}>
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
          <h1 className="font-display mb-2 text-2xl font-bold tracking-tight text-white">
            {title || copy.title}
          </h1>
          <p className="mb-3 text-[12px] font-medium text-secondary">
            {HIGHLIGHT_CHIPS.map((chip, index) => (
              <span key={chip}>
                {index > 0 && <span aria-hidden="true" className="mx-1.5 text-white/30">·</span>}
                {chip}
              </span>
            ))}
          </p>
          <p className="px-2 text-[13px] leading-relaxed text-secondary">
            {subtitle || (
              <>
                {copy.subtitlePrefix}{' '}
                <a href="https://muapi.ai/access-keys" target="_blank" rel="noreferrer" className="font-medium text-brand transition-colors hover:text-brand-hover">Muapi.ai</a>
                {' '}{copy.subtitleSuffix}
              </>
            )}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="creator-agency-api-key" className="ml-1 block text-xs font-semibold text-secondary">
              {copy.label}
            </label>
            <input
              id="creator-agency-api-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(''); }}
              placeholder={copy.placeholder}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'creator-agency-api-key-error' : undefined}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white transition-all placeholder:text-white/25 focus:border-brand/40 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand/40"
              suppressHydrationWarning
            />
            {error && (
              <p id="creator-agency-api-key-error" role="alert" className="ml-1 mt-2 text-[11px] font-medium text-red-400">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-[#08060f] shadow-[0_8px_30px_rgba(198,241,53,0.25)] transition-all hover:bg-brand-hover hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel"
            suppressHydrationWarning
          >
            {copy.submit}
          </button>

          <p className="pt-1 text-center text-[12px] text-secondary">
            {copy.needKey}{' '}
            <a href="https://muapi.ai/access-keys" target="_blank" rel="noreferrer" className="font-medium text-brand transition-colors hover:text-brand-hover">
              {copy.getOneFree}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
