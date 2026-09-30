# Railway readiness audit

Audit date: 2026-09-30. Baseline repository commit: `7e8a10a8a6c478d1d36435a1d292b0873a005eb3`. Source/configuration review and local test evidence are distinct from production configuration. No Railway connector/account logs were available to this audit agent; no deployment, restart or provider generation was triggered.

## Verified in repository

| Area | Evidence | Assessment |
|---|---|---|
| Builder | `railway.json`: `DOCKERFILE`, root `Dockerfile` | Explicit deterministic build selection. Dashboard/root-directory overrides still need account verification. |
| Dependency install | Node 22 Alpine, `npm ci`, all workspace package manifests copied first; Electron binary download disabled | Uses root lockfile. Actual image build was not run because Docker is unavailable in this workspace. |
| Build command | Docker builder `npm run build`; root `prebuild` builds workflow/agent/design/studio CSS and Babel packages | Required package outputs are produced before Next compilation. CI mirrors package build then Next build. |
| Server bundle | `next.config.mjs`: `output: 'standalone'`; final image copies standalone, static assets, public assets | Runtime is `node server.js`; no npm development server. Dynamic gateway imports/catalog need image-level smoke verification. |
| Port/interface | Runner defaults `HOSTNAME=0.0.0.0`, `PORT=3000`; Next standalone server reads runtime env | Railway-injected PORT can override image default. No localhost-only binding found. |
| Startup health | `/api/health`, timeout 60 seconds in `railway.json`; `force-dynamic`, no-store | Public liveness responds 200 with setup flags. It does not prove a model can run or that a provider has credits. |
| Restart policy | `ON_FAILURE` in `railway.json` | Runtime crash restart configured in code; dashboard override and restart maximum not verified. |
| Secrets | fal/OpenRouter/session/access codes read server-side at request/runtime; Docker ignores `.env*` and data dirs | No provider-secret build ARG introduced. Public build variables are intentionally public. |
| Public build values | Audit fix declares `NEXT_PUBLIC_REELTY_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ANALYTICS_ENDPOINT`, `RAILWAY_PUBLIC_DOMAIN` | Previously custom canonical/analytics/CSP values were documented but unavailable in Docker's build stage. Requires a new approved deployment to affect production. |
| Release identity | Audit adds image `AQUORA_BUILD_SHA` from Railway Git build arg; health exposes validated 40-hex commit or null | Supports comparison against reviewed PR/commit after deployment. Baseline source did not expose a release SHA; deployed identity was not verified. |
| Storage | JSON under dataDir, atomic tmp-file rename, workspace collections; default `/data` if writable | Persistent only with mounted volume. Store can fall back to memory when unwritable; health then says ephemeral. |
| Volume truthfulness | Backend audit fixes Railway explicit unmounted `AQUORA_DATA_DIR` being marked persistent | A path variable now cannot falsely certify Railway durability. Regression covers mounted parent, unmounted path and sibling path. |
| Database/migrations | No database client/schema/migration runner or Airtable backend code path found | Current storage is JSON, not SQL/Airtable. No SQL migration command required for current release. |
| Workers | No separate durable worker/queue; active pipelines run inside web process | Running multi-step work cannot survive restart/redeploy. Single-process limitation must be a release constraint. |
| Origin policy | Common gateway wrapper checks write origins; browser uses same-origin API; middleware CSP limits connect/frame sources | Configure trusted proxy hops correctly; optional allowed origins do not create a generic external CORS API. |
| Uploads/memory | Type/size/magic-byte limits; 25/50/200 MB caps; session/workspace upload concurrency | Uploads buffer substantial media; instance memory and production request-size/network limits require account/provider checks. No production load test performed. |
| Logs | Allowlisted structured JSON fields in gateway logger; no prompts/keys/cookies/raw provider bodies | Useful failure events for routes/provider auth/budget/jobs exist. No production logs were fetched. |
| CI | Package builds, lint, catalog freshness, node tests, Next build and local Playwright suite | Audit enables previously omitted lint/catalog gates and adds browser checks with failure artifacts. Hosted CI execution is separate from local results. |

## Restart and persistence behavior

| State | Source-verified behavior |
|---|---|
| Private sessions | Stable session secret and configured code preserve signed cookie; revoked sessions are loaded from persisted store. Changing/removing code/secret can invalidate access. |
| Public visitor workspace | Stored only through visitor's credential cookie; no email recovery. Cookie loss creates a different workspace. |
| Agents/workflows/design sessions | JSON documents survive process restart only if dataDir is on durable writable storage. |
| Daily spend ledger | In-memory ledger backed by serialized best-effort JSON writes. No drain/shutdown hook explicitly flushes application ledger; abrupt termination between provider submit and disk write remains a durability risk. |
| Direct fal queued jobs | Signed token contains provider coordinates; can continue polling after server restart with same valid session/secret. Concurrency slots/cache reset. Provider-side retention still applies. |
| Running clipping/agents/design/workflows/upscale/extend | Process-local AbortController, pipeline promise and event registry disappear. Workflow reconciliation/polling returns interrupted/failed; there is no resume or provider callback worker. |
| Completed pipeline jobs | Best-effort stored per workspace; token expires after 7 days, old documents prune. Immediate process death before write completion can lose recent completion. |
| Browser studio history | Workspace-scoped localStorage persists in same browser; no cross-device central history service. |
| Generated media | Provider CDN URLs, not copies on Railway volume or owned object storage. Long-term retention and deletion need an explicit provider/owner policy. |

The current design is suitable for a controlled single-instance beta after blockers are fixed and storage is verified. It does not provide job durability or horizontal scalability. Moving to a database plus durable worker/shared rate store is required before promising uninterrupted multi-step work, adding replicas or treating estimates as a customer billing ledger.

Railway documents that mounted volumes cannot be used with replicas and that volume-backed redeployments have some downtime. Its healthcheck is evaluated during deployment, not continuous uptime monitoring. The source's single-replica recommendation matches both the implementation and Railway's documented volume constraint.

## Account-access checks still required

These are unresolved verification items, not claims that current production is misconfigured:

The live application/health browser request was blocked by this environment's network policy (`ERR_BLOCKED_BY_CLIENT`). This establishes an audit-access limitation, not an application outage. No production health response or deployed commit was verified from that attempt.

1. Confirm source repository, branch, commit, root directory and config-file location in Railway. Compare `RAILWAY_GIT_COMMIT_SHA`/deployment source with GitHub commit. After the audit change is deployed, compare `/api/health.commit` with the approved commit as a second signal.
2. Confirm the Dockerfile builder is used in build logs; verify build/package commands finish and standalone image starts. Confirm no dashboard start override replaces `node server.js`.
3. Verify FAL_KEY/OpenRouter keys are present without displaying their values; provider flags alone do not validate keys, enabled account models, balance or connectivity. Run a controlled staging provider smoke test separately with an explicit small budget.
4. Confirm access mode (`AQUORA_PUBLIC_ACCESS` or strong codes), stable 32-byte session secret, daily deployment/workspace budgets, trusted-proxy settings and any extra origins. Secrets should be runtime service variables; no secret should be copied into a Git file or Docker layer.
5. Confirm volume mount path and dataDir point to the same mounted storage. Inspect writable mode and disk space. Verify backups, retention and restore procedure on test data. Health `persistent` is a configuration/runtime path check, not a backup guarantee.
6. Confirm one replica, public network target port, startup health path/timeout, restart policy/max attempts, region, memory and execution/request limits. Keep mock upstream overrides unset in production.
7. Inspect redacted build/runtime logs for 5xx, provider authentication/credit errors, interrupted pipelines, restarts and storage failures. Confirm logging/alerts and continuous uptime monitoring are configured.
8. Verify planned drain/redeploy behavior on staging with test jobs and documents. No production restart, filesystem changes or customer-data modification was performed in this audit.
9. Confirm custom domain canonical/OG/sitemap URLs and optional analytics/Reelty CSP after rebuilding with chosen public variables.

## Confirmed fixes in this audit branch

- Public Docker build arguments now include custom site origin, analytics receiver and Railway public domain, aligning bundle metadata and CSP with documented configuration.
- `/api/health` now exposes only a validated release SHA, preferring the image identity to a runtime claim. Tests verify precedence, normalization, malformed/null fallback, no-store and secret non-disclosure (2 passing tests).
- Backend fix prevents false persistent status for an explicit unmounted path on Railway, with a regression test.
- `.env.example`/README now document optional public access and missing public build variables; unused admin balance key is correctly described as reserved.
- CI adds lint, generated-catalog freshness and local browser regression checks. Catalog freshness passed locally; full QA/build evidence is in the main audit report.

No actual Railway environment change has been made. Source changes require review and explicit approval before merge/deployment.

## Primary documentation checked

- [Railway Dockerfiles: variables must be declared with ARG in the stage that uses them](https://docs.railway.com/builds/dockerfiles)
- [Railway variables reference: public domain, Git commit, volume mount and deployment variables](https://docs.railway.com/variables/reference)
- [Railway volume caveats: single volume, no replicas, redeploy downtime](https://docs.railway.com/volumes/reference)
- [Railway healthchecks: runtime PORT and startup-only checks](https://docs.railway.com/deployments/healthchecks)

Documentation was checked on 2026-09-30. Platform statements are sourced from the official pages above; readiness judgments and recommended checks are audit inferences from those pages and the repository.
