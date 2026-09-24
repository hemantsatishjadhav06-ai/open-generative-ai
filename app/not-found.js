import Link from 'next/link';
import { headers } from 'next/headers';
import { getCommonCopy, getLocaleConfig, localizeStudioPath } from '@/lib/locales';

export const metadata = {
  title: 'Not found — Creator Agency',
  robots: { index: false },
};

const SPARK_PATH = 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z';
const POPULAR_TABS = ['image', 'video', 'audio', 'clipping', 'reelty'];

export default async function NotFound() {
  // middleware.js derives the locale from the path and passes it as x-locale.
  const locale = getLocaleConfig((await headers()).get('x-locale')).code;
  const common = getCommonCopy(locale);
  const copy = common.notFound;

  return (
    <main className="min-h-screen bg-surface-app text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand shadow-glow" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" focusable="false">
            <path d={SPARK_PATH} className="fill-surface-app" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-sm text-secondary">{copy.body}</p>
        <Link
          href={localizeStudioPath(locale)}
          className="mt-8 inline-flex items-center justify-center rounded-2xl bg-brand px-6 py-3 text-sm font-semibold text-surface-app shadow-glow transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          {copy.cta}
        </Link>
        <nav aria-label={copy.popular} className="mt-8">
          <p className="mb-3 text-[12px] font-medium text-white/40">{copy.popular}</p>
          <ul className="flex flex-wrap justify-center gap-2">
            {POPULAR_TABS.map((id) => (
              <li key={id}>
                <Link
                  href={localizeStudioPath(locale, id)}
                  className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:border-brand/40 hover:text-white"
                >
                  {common.tabs?.[id] || id}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
