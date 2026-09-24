// Server-rendered landing page for / and /zh. No 'use client' and no import
// from 'studio' or StandaloneShell, so it ships almost no JS and every word
// is in the HTML for crawlers and link unfurls.
import Link from 'next/link';
import { getCommonCopy, getLocaleConfig, localizeStudioPath } from '@/lib/locales';
import { TABS } from '@/lib/studios';

const SPARK_PATH = 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z';
const GITHUB_URL = 'https://github.com/hemantsatishjadhav06-ai/open-generative-ai';
const KEY_URL = 'https://muapi.ai/access-keys?utm_source=creator-agency&utm_medium=landing';
const MUAPI_URL = 'https://muapi.ai?utm_source=creator-agency&utm_medium=landing';

const GLOW_STYLE = {
  background:
    'radial-gradient(50% 45% at 20% 0%, rgba(198, 241, 53, 0.16) 0%, rgba(198, 241, 53, 0) 70%),' +
    'radial-gradient(45% 40% at 100% 20%, rgba(255, 60, 172, 0.14) 0%, rgba(255, 60, 172, 0) 70%)',
};

function Spark({ size = 18 }) {
  return (
    <span className="w-8 h-8 bg-brand rounded-xl shadow-glow flex items-center justify-center flex-shrink-0" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" focusable="false">
        <path d={SPARK_PATH} className="fill-surface-app" />
      </svg>
    </span>
  );
}

export default function Landing({ locale = 'en' }) {
  const common = getCommonCopy(locale);
  const copy = common.landing;
  const otherLocale = locale === 'zh' ? 'en' : 'zh';
  const otherConfig = getLocaleConfig(otherLocale);
  const langHref = otherConfig.rootPath || '/';
  const chips = Array.isArray(copy.chips) ? copy.chips : [];

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-surface-app text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[640px]" style={GLOW_STYLE} />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header */}
        <header className="flex h-16 items-center justify-between gap-3">
          <Link href={locale === 'en' ? '/' : '/zh'} className="flex min-w-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            <Spark />
            <span className="font-display text-[15px] font-bold tracking-tight whitespace-nowrap">{common.shell.brand}</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4 text-[13px] font-semibold">
            <a
              href={langHref}
              hrefLang={otherConfig.htmlLang}
              lang={otherConfig.htmlLang}
              aria-label={copy.langSwitchLabel}
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {copy.langSwitch}
            </a>
            <Link href={localizeStudioPath(locale)} className="hidden sm:inline text-white/70 transition-colors hover:text-brand">
              {copy.ctaPrimary}
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <section className="pt-14 pb-16 sm:pt-24 sm:pb-24">
          <p className="mb-4 text-[12px] font-bold uppercase tracking-[0.18em] text-brand">{copy.eyebrow}</p>
          <h1 className="font-display max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            {copy.h1}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-secondary sm:text-lg">
            {copy.sub}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={localizeStudioPath(locale)}
              className="inline-flex items-center justify-center rounded-2xl bg-brand px-6 py-3 font-semibold text-surface-app shadow-glow transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app"
            >
              {copy.ctaPrimary} →
            </Link>
            <a
              href={KEY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-surface-card px-6 py-3 font-semibold text-white/85 transition-colors hover:border-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {copy.ctaSecondary}
            </a>
          </div>
          {chips.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-2" aria-label={copy.eyebrow}>
              {chips.map((chip) => (
                <li key={chip} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[12px] font-medium text-white/70">
                  {chip}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Studios */}
        <section aria-labelledby="studios" className="pb-16">
          <div className="mb-6">
            <h2 id="studios" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{copy.studiosHeading}</h2>
            <p className="mt-2 text-sm text-secondary">{copy.studiosSub}</p>
          </div>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {TABS.map((tab) => (
              <li key={tab.id}>
                <Link
                  href={localizeStudioPath(locale, tab.id)}
                  className={`group flex h-full flex-col gap-3 rounded-2xl border bg-surface-card p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${tab.id === 'reelty' ? 'border-pop/30 hover:border-pop/60' : 'border-surface-border hover:border-brand/40'}`}
                >
                  <span className={tab.id === 'reelty' ? 'text-pop' : 'text-brand'} aria-hidden="true">{tab.icon}</span>
                  <span className="font-display text-[15px] font-semibold leading-tight text-white">
                    {common.tabs?.[tab.id] || tab.label}
                  </span>
                  <span className="text-[12px] leading-snug text-secondary">{copy.blurbs?.[tab.id]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Reelty */}
        <section aria-labelledby="reelty" className="pb-16">
          <div className="relative overflow-hidden rounded-2xl border border-pop/40 bg-surface-panel p-6 shadow-glow-accent sm:p-10">
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-pop">{copy.reeltyKicker}</p>
            <h2 id="reelty" className="font-display mt-3 text-2xl font-bold tracking-tight sm:text-4xl">{copy.reeltyTitle}</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary sm:text-base">{copy.reeltyBody}</p>
            <Link
              href={localizeStudioPath(locale, 'reelty')}
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-pop px-6 py-3 font-semibold text-surface-app transition-colors hover:bg-pop-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-pop/60"
            >
              {copy.reeltyCta} →
            </Link>
          </div>
        </section>

        <p className="pb-10 text-[13px] text-secondary">{copy.trust}</p>

        {/* Footer */}
        <footer className="flex flex-col gap-3 border-t border-white/[0.07] py-8 text-[13px] text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href={MUAPI_URL} target="_blank" rel="noreferrer" className="hover:text-white">{copy.footerRuns}</a>
            <span>{copy.footerOss}</span>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-white">{copy.footerGithub}</a>
          </div>
          <a href={langHref} hrefLang={otherConfig.htmlLang} lang={otherConfig.htmlLang} className="hover:text-white">
            {copy.langSwitch}
          </a>
        </footer>
      </div>
    </main>
  );
}
