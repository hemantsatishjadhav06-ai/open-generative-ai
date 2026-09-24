// Node module-loader hooks for the test runner (registered by
// tests/support/register.mjs via `node --import`).
//
// The repo has no "type": "module", so its ESM sources (lib/*.js,
// src/lib/*.js, packages/studio/src/**/*.js) are "typeless". These hooks:
//   - load them as ES modules explicitly (no MODULE_TYPELESS warning, and it
//     works the same on Node 20 and 22);
//   - add the `type: 'json'` import attribute to bare JSON imports such as
//     `import en from '../messages/en/common.json'`, which Next/webpack
//     accept but plain Node requires an attribute for.
const ESM_SOURCE = /\/(src\/lib|lib|packages\/studio\/src(\/[^/]+)*)\/[^/]+\.js$/;

export async function load(url, context, next) {
  if (!url.startsWith('file:') || url.includes('/node_modules/')) {
    return next(url, context);
  }
  if (url.endsWith('.json')) {
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } });
  }
  if (ESM_SOURCE.test(url)) {
    return next(url, { ...context, format: 'module' });
  }
  return next(url, context);
}
