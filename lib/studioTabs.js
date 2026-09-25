// Studio tab ids, in nav order. Plain data (no JSX) so server components,
// route handlers, middleware and tests can import it without pulling in the
// client shell. The icons/labels live in lib/studios.js.
export const STUDIO_TAB_IDS = [
    'image',
    'layers',
    'video',
    'audio',
    'clipping',
    'motion-control',
    'lipsync',
    'body-swap',
    'cinema',
    'marketing',
    'workflows',
    'agents',
    'design-agent',
    'ai-influencer',
    'reelty',
];

// Tabs that are no longer in the nav. Explore Apps was removed; Vibe Motion is
// hidden until its server-side render pipeline is rebuilt. Old links and
// bookmarks land on the studio root instead of a 404.
export const RETIRED_STUDIO_TAB_IDS = ['apps', 'vibe-motion'];

// Legacy/alternate first segments the shell still understands
// (/studio/workflow/<id> opens the Workflows tab).
export const STUDIO_SLUG_ALIASES = ['workflow'];

// Only the first segment is validated; deeper segments (workflow ids etc.)
// are handled by the studio itself.
export function isValidStudioSlug(slug) {
    const first = Array.isArray(slug) ? slug[0] : undefined;
    return !first || STUDIO_TAB_IDS.includes(first) || STUDIO_SLUG_ALIASES.includes(first);
}

export function isRetiredStudioSlug(slug) {
    const first = Array.isArray(slug) ? slug[0] : undefined;
    return Boolean(first) && RETIRED_STUDIO_TAB_IDS.includes(first);
}
