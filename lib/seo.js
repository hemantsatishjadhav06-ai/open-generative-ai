// Per-route SEO metadata for the studio pages. Server-only helpers; do not
// import components/StandaloneShell.js here (it is a client module).
import { LOCALE_CONFIGS, DEFAULT_LOCALE, getLocaleConfig, getCommonCopy, localizeStudioPath } from './locales';
import { STUDIO_TAB_IDS } from './studioTabs';

export { STUDIO_TAB_IDS };

// hreflang map for a studio path (or the studio root when tabId is null).
export function studioAlternates(tabId) {
    const languages = {};
    for (const cfg of Object.values(LOCALE_CONFIGS)) {
        languages[cfg.htmlLang] = localizeStudioPath(cfg.code, tabId);
    }
    languages['x-default'] = localizeStudioPath(DEFAULT_LOCALE, tabId);
    return languages;
}

// hreflang map for the landing page.
export function landingAlternates() {
    const languages = {};
    for (const cfg of Object.values(LOCALE_CONFIGS)) {
        languages[cfg.htmlLang] = cfg.rootPath || '/';
    }
    languages['x-default'] = '/';
    return languages;
}

// Child segments that set `openGraph`/`twitter` replace the parent objects,
// so the root app/opengraph-image.js card must be referenced explicitly.
const OG_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: 'Aquora — AI studio for creators' };

export function buildStudioMetadata(locale, slug = []) {
    const copy = getCommonCopy(locale);
    const cfg = getLocaleConfig(locale);
    const tabId = STUDIO_TAB_IDS.includes(slug?.[0]) ? slug[0] : null;
    const label = tabId ? (copy.tabs?.[tabId] || tabId) : copy.shell.studioFallback;
    const title = `${label} — Aquora`;
    const description = copy.meta.description;
    // Unknown/alias slugs canonicalize to the studio root.
    const canonical = localizeStudioPath(cfg.code, tabId);
    return {
        title,
        description,
        alternates: { canonical, languages: studioAlternates(tabId) },
        openGraph: {
            title,
            description,
            url: canonical,
            siteName: 'Aquora',
            type: 'website',
            locale: copy.meta.ogLocale,
            images: [OG_IMAGE],
        },
        twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
    };
}

export function buildLandingMetadata(locale) {
    const copy = getCommonCopy(locale);
    const cfg = getLocaleConfig(locale);
    const title = copy.meta.siteTitle;
    const description = copy.meta.description;
    const canonical = cfg.rootPath || '/';
    return {
        title,
        description,
        alternates: { canonical, languages: landingAlternates() },
        openGraph: {
            title,
            description,
            url: canonical,
            siteName: 'Aquora',
            type: 'website',
            locale: copy.meta.ogLocale,
        },
        twitter: { card: 'summary_large_image', title, description },
    };
}
