// Absolute origin for metadataBase / sitemap / robots / OG URLs.
// Precedence: explicit env > Railway-injected service domain > current
// production service domain > local dev. When a custom domain is added, set
// NEXT_PUBLIC_SITE_URL (RAILWAY_PUBLIC_DOMAIN stays the *.up.railway.app host).
const PRODUCTION_FALLBACK = 'https://open-generative-ai-production-4eaf.up.railway.app';

function resolveRaw() {
    return (
        process.env.NEXT_PUBLIC_SITE_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`) ||
        (process.env.NODE_ENV === 'production'
            ? PRODUCTION_FALLBACK
            : `http://localhost:${process.env.PORT || 3000}`)
    );
}

// Origin without a trailing slash, e.g. "https://example.com".
export const SITE_URL = resolveRaw().replace(/\/+$/, '');

// URL object with a trailing slash, suitable for `metadataBase`.
export function getSiteUrl() {
    return new URL(`${SITE_URL}/`);
}

export function absoluteUrl(path = '/') {
    return new URL(path.replace(/^\/+/, ''), getSiteUrl()).href;
}
