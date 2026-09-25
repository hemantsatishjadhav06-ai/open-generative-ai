// Single source of truth lives in the studio workspace package.
// See packages/studio/src/models.js. This file exists only so the
// standalone (Electron/Vite) build's existing imports of "../lib/models"
// keep resolving without touching every consumer. (A relative path: the
// studio package's "exports" map doesn't publish src/models.js.)
export * from "../../packages/studio/src/models.js";
