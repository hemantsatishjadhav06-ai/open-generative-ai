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
    'vibe-motion',
    'lipsync',
    'body-swap',
    'cinema',
    'marketing',
    'workflows',
    'agents',
    'design-agent',
    'apps',
    'ai-influencer',
    'reelty',
];

// Legacy/alternate first segments the shell still understands
// (/studio/workflow/<id> opens the Workflows tab).
export const STUDIO_SLUG_ALIASES = ['workflow'];

// Only the first segment is validated; deeper segments (workflow ids etc.)
// are handled by the studio itself.
export function isValidStudioSlug(slug) {
    const first = Array.isArray(slug) ? slug[0] : undefined;
    return !first || STUDIO_TAB_IDS.includes(first) || STUDIO_SLUG_ALIASES.includes(first);
}
