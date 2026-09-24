import { SITE_URL } from '@/lib/siteUrl';
import { STUDIO_TAB_IDS } from '@/lib/studioTabs';
import { LOCALE_CONFIGS } from '@/lib/locales';

export const dynamic = 'force-dynamic';

// '' is the landing page (/ and /zh); then the studio root and every tab.
const PATHS = ['', '/studio', ...STUDIO_TAB_IDS.map((id) => `/studio/${id}`)];
const LOCALES = Object.values(LOCALE_CONFIGS);

// Landing for the default locale is "/", everything else is prefix + path.
function localized(rootPath, path) {
  const suffix = `${rootPath}${path}`;
  return `${SITE_URL}${suffix || '/'}`;
}

export default function sitemap() {
  const entries = [];
  for (const path of PATHS) {
    const languages = Object.fromEntries(
      LOCALES.map((l) => [l.htmlLang, localized(l.rootPath, path)]),
    );
    languages['x-default'] = localized('', path);
    for (const locale of LOCALES) {
      entries.push({
        url: localized(locale.rootPath, path),
        changeFrequency: 'weekly',
        priority: path === '' ? 1 : path === '/studio' ? 0.9 : 0.8,
        alternates: { languages },
      });
    }
  }
  return entries;
}
