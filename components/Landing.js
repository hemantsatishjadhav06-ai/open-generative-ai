// Server-rendered product overview: no studio model catalog or client bundle.
import Link from 'next/link';
import { fillCopy, getCommonCopy, getLocaleConfig, localizeStudioPath } from '@/lib/locales';
import { TABS } from '@/lib/studios';

const GITHUB_URL = 'https://github.com/hemantsatishjadhav06-ai/open-generative-ai';
const GROUPS = [
  { id: 'images', primary: 'image', tabs: ['image', 'layers', 'cinema', 'design-agent', 'ai-influencer'] },
  { id: 'video', primary: 'video', tabs: ['video', 'clipping', 'motion-control', 'lipsync', 'body-swap', 'marketing'] },
  { id: 'audio', primary: 'audio', tabs: ['audio'] },
  { id: 'agents-automation', primary: 'workflows', tabs: ['agents', 'workflows'] },
];

function BrandMark() {
  return (
    <span className="landing-brand-mark" aria-hidden="true">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 18 12 4l7 14M8 13h8" /><path d="M4 21h16" />
      </svg>
    </span>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

// Labelled illustration: this is not an actual generated or promised result.
function WorkspacePreview({ copy }) {
  return (
    <figure className="landing-preview">
      <div className="landing-preview-top">
        <span className="flex items-center gap-2 font-semibold"><BrandMark />Aquora</span>
        <span className="landing-preview-label">{copy.previewLabel}</span>
      </div>
      <div className="landing-preview-body">
        <div className="landing-preview-art" aria-hidden="true">
          <svg viewBox="0 0 400 280" fill="none" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
            <rect width="400" height="280" fill="#dfebe7" />
            <path d="M0 224C73 170 110 207 188 151c81-58 166-40 212-14v143H0z" fill="#b0ccc4" />
            <circle cx="299" cy="72" r="36" fill="#fafaf0" />
            <path d="M-25 280 118 71l119 209z" fill="#274841" />
            <path d="m118 71 6 209h113z" fill="#44665c" />
            <path d="m80 126 38-55 32 56-33-9z" fill="#eff2e8" />
            <path d="M224 280c-26-24-34-43-23-63 11-20 60-18 55-45-6-27-14-42 4-69" stroke="#ecf1e9" strokeWidth="13" />
          </svg>
          <span className="landing-art-caption">{copy.previewArt}</span>
        </div>
        <div className="landing-preview-form">
          <span className="landing-preview-step">01 / {copy.previewStep}</span>
          <p className="font-display text-lg font-semibold">{copy.previewTitle}</p>
          <div className="landing-preview-prompt">{copy.previewPrompt}</div>
          <div className="flex items-center justify-between text-xs text-[#a8bac5]"><span>{copy.previewModel}</span><span>16:9</span></div>
          <div className="landing-preview-button">{copy.previewAction}<span aria-hidden="true">→</span></div>
        </div>
      </div>
      <figcaption className="landing-preview-caption">{copy.previewCaption}</figcaption>
    </figure>
  );
}

export default function Landing({ locale = 'en' }) {
  const common = getCommonCopy(locale);
  const copy = common.landing;
  const otherConfig = getLocaleConfig(locale === 'zh' ? 'en' : 'zh');
  const langHref = otherConfig.rootPath || '/';
  const counts = { studios: TABS.length, count: TABS.length };

  return (
    <main id="main-content" className="aquora-landing">
      <a href="#studios" className="landing-skip-link">{copy.skipLink}</a>
      <div className="landing-container">
        <header className="landing-header">
          <Link href={locale === 'en' ? '/' : '/zh'} className="landing-wordmark" aria-label={common.shell.brand}><BrandMark /><span className="font-display">{common.shell.brand}</span></Link>
          <nav aria-label={copy.navigationLabel} className="flex items-center gap-4 sm:gap-7">
            <a href="#studios" className="hidden text-sm font-medium sm:inline-flex">{copy.studiosNavLabel}</a>
            <a href={langHref} hrefLang={otherConfig.htmlLang} lang={otherConfig.htmlLang} aria-label={copy.langSwitchLabel} className="landing-language">{copy.langSwitch}</a>
            <Link href={localizeStudioPath(locale)} className="landing-nav-cta">{copy.ctaPrimary}<span aria-hidden="true"> →</span></Link>
          </nav>
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow"><span aria-hidden="true" />{copy.eyebrow}</p>
            <h1 id="landing-title" className="font-display">{copy.h1}</h1>
            <p className="landing-hero-sub">{copy.sub}</p>
            <div className="landing-hero-actions">
              <Link href={localizeStudioPath(locale)} className="landing-primary">{copy.ctaPrimary}<span aria-hidden="true">→</span></Link>
              <a href="#studios" className="landing-secondary">{copy.ctaSecondary}<span aria-hidden="true">↓</span></a>
            </div>
            <p className="landing-access-note">{copy.accessNote}</p>
          </div>
          <WorkspacePreview copy={copy} />
        </section>

        <div className="landing-capabilities" aria-label={copy.eyebrow}>
          {(copy.chips || []).map((chip) => <span key={chip}>{fillCopy(chip, counts)}</span>)}<span>{copy.capabilityNote}</span>
        </div>

        <section aria-labelledby="studios" className="landing-section">
          <div className="landing-section-heading">
            <div><p className="landing-eyebrow">{copy.studiosKicker}</p><h2 id="studios" className="font-display">{copy.goalHeading}</h2></div>
            <p>{copy.studiosSub}</p>
          </div>
          <ul className="landing-goals">
            {GROUPS.map((group) => {
              const tab = TABS.find((item) => item.id === group.primary);
              return (
                <li key={group.id} className="landing-goal-card">
                  <Link href={localizeStudioPath(locale, group.primary)} className="landing-goal-title"><span className="landing-goal-icon" aria-hidden="true">{tab.icon}</span><span className="font-display">{copy.goals[group.id].title}</span><Arrow /></Link>
                  <p>{copy.goals[group.id].body}</p>
                  <div className="landing-tool-links">{group.tabs.map((id) => <Link key={id} href={localizeStudioPath(locale, id)}>{common.tabs[id]}</Link>)}</div>
                </li>
              );
            })}
          </ul>
          <p className="landing-availability-note">{fillCopy(copy.studiosHeading, counts)} · {copy.availabilityNote}</p>
        </section>

        <section className="landing-process landing-section" aria-labelledby="process-title">
          <div><p className="landing-eyebrow">{copy.processKicker}</p><h2 id="process-title" className="font-display">{copy.processHeading}</h2><p className="landing-process-intro">{copy.processSub}</p></div>
          <ol className="landing-steps">{copy.steps.map((step, index) => <li key={step.title}><span className="landing-step-number">0{index + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol>
        </section>

        <section className="landing-reelty" aria-labelledby="reelty-title">
          <div><p className="landing-eyebrow">{copy.reeltyKicker}</p><h2 id="reelty-title" className="font-display">{copy.reeltyTitle}</h2><p>{copy.reeltyBody}</p><p className="landing-reelty-note">{copy.reeltyNote}</p></div>
          <Link href={localizeStudioPath(locale, 'reelty')} className="landing-secondary">{copy.reeltyCta}<Arrow /></Link>
        </section>

        <footer className="landing-footer">
          <div><span className="landing-footer-brand font-display">Aquora</span><p>{copy.trust}</p></div>
          <div className="landing-footer-links"><span>{copy.footerOss}</span><a href={GITHUB_URL} target="_blank" rel="noreferrer">{copy.footerGithub}<span aria-hidden="true"> ↗</span></a><a href={langHref} hrefLang={otherConfig.htmlLang} lang={otherConfig.htmlLang}>{copy.langSwitch}</a></div>
        </footer>
      </div>
    </main>
  );
}
