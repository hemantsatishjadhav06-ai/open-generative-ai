// Node module-loader hooks for the test runner (registered by
// tests/support/register.mjs via `node --import`).
//
// The repo has no "type": "module", so its ESM sources (lib/**, src/lib/**,
// src/components/**, app/api/**, packages/studio/src/**) are "typeless".
// These hooks:
//   - load them as ES modules explicitly (no MODULE_TYPELESS warning, and it
//     works the same on Node 20 and 22);
//   - add the `type: 'json'` import attribute to bare JSON imports such as
//     `import en from '../messages/en/common.json'`, which Next/webpack
//     accept but plain Node requires an attribute for.
// Matched against the path relative to the repo root, so CommonJS folders
// elsewhere (electron/lib) are never forced to ESM.
const REPO_ROOT = new URL('../../', import.meta.url).href;
const ESM_SOURCE = /^(src\/lib|src\/components|lib|app\/api|packages\/studio\/src)(\/[^/]+)*\/[^/]+\.js$/;

export async function load(url, context, next) {
  if (!url.startsWith('file:') || url.includes('/node_modules/')) {
    return next(url, context);
  }
  if (url.endsWith('.json')) {
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } });
  }
  if (url.startsWith(REPO_ROOT) && ESM_SOURCE.test(url.slice(REPO_ROOT.length))) {
    return next(url, { ...context, format: 'module' });
  }
  return next(url, context);
}
