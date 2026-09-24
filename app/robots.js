import { SITE_URL } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

// '/agents/' and '/workflow/' are per-user detail pages; '/studio/agents' is
// unaffected because Disallow is a path-prefix match.
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/workflow/', '/agents/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
