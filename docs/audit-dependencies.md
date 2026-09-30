# Dependency audit

Audit date: 2026-09-30. This covers the web application and its build dependencies; it does not certify desktop installers.

The baseline `npm audit --json` returned 21 dependency findings: 1 critical, 15 high and 5 moderate. These are package-level advisories, not 21 confirmed remotely exploitable application defects. The saved audit was retrieved from the npm registry before network access became restricted.

## Changes verified in the review branch

- Raised the minimum Next.js and matching ESLint configuration version to 15.5.26, the installed 15.x patch.
- Overrode Next.js's nested PostCSS 8.4.31 with 8.5.28, which was already used by the workspace builds. This removes the nested vulnerable PostCSS version without migrating the application to Next.js 16.
- Updated the design-agent syntax-highlighter to 16.1.1, already used by the studio. It replaces the older refractor/Prism dependency chain with Prism 1.30.0.
- Added Playwright as a development dependency for local browser regression tests.

`npm ci --offline` succeeded with the revised lockfile. `npm ls postcss prismjs --depth=5` reports the updated versions without invalid dependency errors. Full build and regression results belong in the main launch report.

## Remaining risks and limits

- The original audit also flags Electron 33, electron-builder 25 and transitive archive/build tools, including a critical tar advisory. They are development/desktop packaging dependencies and are not copied into the standalone web runner, but they remain relevant to installer builds. A desktop release requires a separate supported Electron/builder upgrade and installer/local-inference regression on the target operating systems.
- Vite 5.4.21 and its esbuild dependency remain flagged for development-server issues. The hosted Next.js production service does not use Vite. Do not expose the Vite development server publicly; upgrade and verify the separate desktop/Vite build before shipping it.
- An attempted supported Vite 6.4.3 update was blocked by the execution environment's network policy. No unverified Vite upgrade was committed.
- The registry became inaccessible during this task, so a fresh post-change advisory audit was unavailable. Do not interpret the package updates as a clean audit certification. Re-run `npm audit --json` in CI and review production versus development reachability before approval.

No provider credentials, customer data or paid requests were needed for these dependency checks.
