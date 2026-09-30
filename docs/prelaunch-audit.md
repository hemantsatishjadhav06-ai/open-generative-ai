# Aquora pre-launch audit

> Historical audit. The fixes have since been merged and deployed. See [deployment and launch verification](release-verification.md) for current results and remaining launch conditions.

Date: 2026-09-30. Repository baseline: `7e8a10a8a6c478d1d36435a1d292b0873a005eb3`. Review branch: `audit/prelaunch-2026-09-30`.

## Release decision

**Hold public launch pending deployment verification and an approved staging provider smoke test.** The review branch contains confirmed fixes and a coherent UI redesign. Passing local mock tests demonstrates application behavior, not current provider credentials, real model output quality, Railway storage durability or uninterrupted production operation.

No merge, deployment, purchase, production generation, load test or customer-data change was performed. Browser interactions with the live application inspected public pages, settings and empty-input validation. All generation and failure tests use test data, local mock upstreams and temporary workspaces.

## What was inspected

- Next.js pages, all 15 studio tabs, English/Chinese routes, standalone agent/workflow routes, API dispatchers and gateway modules.
- Sessions, workspace authorization, write-origin checks, upload magic-byte/type/size checks, SSRF protections, provider allowlists, budgets, job tokens, queue polling, cancellation, pipeline execution and JSON storage.
- Workspace package builds, dependency lockfile, Docker/Railway configuration, CI and public/private environment variables.
- Live landing, Image and Video Studio, workspace/budget settings, navigation and empty-prompt validation through Chrome. The live studio created a visitor workspace and displayed its estimated daily budget.
- Further live health navigation was blocked by this execution environment (`ERR_BLOCKED_BY_CLIENT`). This is an access limitation; it is not evidence that the application is down. The baseline live app has no release commit in health, so its exact repository commit could not be confirmed.

## Confirmed defects and fixes

| Priority | Defect | Result in this branch |
|---|---|---|
| Launch blocker | Concurrent budget checks/debits could exceed workspace and deployment spend caps. | Cap check and debit now occur together after ledger loading; concurrency regressions verify the cap. |
| High | Generation reserved money before acquiring an available job slot, leaving a debit on rejected work. | Acquire slot before reservation; release it if reservation fails. |
| High | Provider-rejected cancellation was reported as cancelled and released a still-running job's slot. | Only confirmed cancellation finalizes the job; rejected cancellation remains pollable and keeps its reservation/slot. |
| High | Logout ignored failed HTTP responses and cleared browser session state. | Failed logout preserves session state and surfaces an error; successful logout still revokes and clears it. |
| High | Refreshing a core media studio lost the active generation token while the provider could continue working. | Image, Video and Audio save workspace-scoped pending tokens immediately and resume polling the same job; completed results save before removing the token. Recovery requires the original valid sign-in session. |
| High | Saving an agent scheduled a delayed redirect that could fire after opening Chat, interrupting the first conversation. | Save stays in the editor; explicit Chat/Back controls navigate. First turns submit directly, guard duplicate clicks, keep one conversation ID and record the URL after success. Remove the unscoped deferred-message handoff. |
| High | Deeply nested media settings bypassed URL collection; OpenRouter vision URLs could target private hosts. | Reject over-deep settings and apply the shared destination safety check to vision URLs before provider calls. |
| High | Repeated generation submissions had no replay contract. | Optional session/workspace-scoped `Idempotency-Key`, concurrent replay and conflicting-payload rejection. Per-request client keys added. No automatic paid-submit retry. |
| High | The initial bounded replay cache retained pre-provider rejections, allowing capacity denial. | Independently reproduced and fixed before delivery: only explicitly pre-submission failures are evicted; ambiguous provider outcomes are retained. |
| Medium | Explicit unmounted Railway data paths were incorrectly described as persistent. | Storage health requires evidence of a Railway mounted volume. |
| Medium | Docker omitted documented public build variables used for metadata, analytics and CSP. | Public build arguments now reach the appropriate build stage; no secret build arguments added. |
| Medium | Deployment identity and regression checks were insufficient. | Health reports a validated commit; CI includes lint and catalog freshness; local browser regression suite added. |
| Medium | Existing persistence tests depended on fixed delays; a clipping ownership test depended on external DNS. | Await the finished-job persistence promise and use deterministic local/trusted fixtures. |

## UI and brand

Aquora is the product name already established in the code, deployed website and packaging. The repository's historical name remains Open Generative AI. Upstream MIT attribution remains intact.

The public landing now uses a soft light background, ink typography and restrained turquoise. The studio uses calm dark surfaces suited to media previews, with the same brand and readable Inter/Space Grotesk typography. Goal-based entry points explain Image, Video, Audio and Automation; onboarding, session/help copy, navigation, keyboard focus and error states are clearer. The shared theme applies across the tool shell; model-specific controls and advanced editors retain their established functions.

Figma proposals are editable conceptual screens, not screenshots of completed provider results. See [design changes](audit-design.md) and [Figma evidence](audit-figma.md).

## Validation evidence

The baseline build passed. Baseline lint had 0 errors and 56 warnings. Baseline node tests passed 382/383; the sole failure required public DNS despite the offline-test intent.

Final verification is recorded in [QA evidence](audit-qa.md). The repository is plain JavaScript: Next build performs its supported source/type validation, but there is no independent TypeScript project or `typecheck` command to claim. Browser tests are local only and block external browser traffic. Mock output fixtures are explicitly test media.

The final local unit/gateway suite passed **411/411** tests, with zero failures or skips. Lint reports **0 errors and 56 existing warnings**. Catalog freshness and `git diff --check` pass. Local validation uses Node 24.19.0; Docker and CI target Node 22, whose actual image/CI result must be checked separately.

The final production build passed, including all four workspace package builds and Next.js 15.5.26. The corrected production-mode browser suite passed **42/42 in 2.8 minutes**, with zero failures. It covers all 15 studio mounts and full Image, Video, Audio, Agent and Workflow journeys, plus authentication, failures, persistence, mobile navigation and pending-job recovery. Advanced canvas/model combinations are not exhaustively exercised. Full logs and five reviewed screenshots are linked from the [QA evidence](audit-qa.md).

## Remaining launch conditions

1. Review and approve this PR before merging. Do not rely on the current live site to demonstrate these unmerged fixes.
2. Connect Railway and verify the actual branch/commit, build/start logs, runtime variables, one-instance setting, port/health configuration and a writable persistent volume. Compare the approved release SHA with the new health commit after deployment.
3. Verify real providers on a separate staging workspace with an explicitly agreed small budget: representative image/video/audio output, uploads, agent/chat and workflow execution. No blanket guarantee is made for every catalog endpoint or provider output quality.
4. Accept or address the current restart limit: active multi-step pipelines do not survive process restart. Idempotency and rate/job-limit state are process-local. A durable queue/journal and shared coordination are required for resilient multi-instance SaaS operation.
5. Review remaining desktop/build dependency advisories and the 56 existing lint warnings. Web verification does not certify Electron installers, local inference or Reelty's independent backend. A fresh registry advisory audit is required because network access became restricted after the baseline audit.
6. Confirm backups/restore, provider-media retention and user-session recovery expectations. Browser history is device-local; provider CDN URLs are not an application-owned permanent media archive.
7. Address or accept two UI limits: the core studios have no Cancel control despite backend cancellation support, and model pickers temporarily show historical entries when availability metadata is loading or fails. The gateway rejects disabled models; the UI should gain an explicit loading/error state rather than implying those entries are verified.

## Supporting reports

- [Product architecture, routes, APIs and feature limits](audit-architecture.md)
- [Backend and security review](audit-backend.md)
- [Design changes](audit-design.md)
- [Figma design evidence](audit-figma.md)
- [Browser and regression evidence](audit-qa.md)
- [Railway readiness: verified versus account access required](audit-railway.md)
- [Dependency changes and remaining risks](audit-dependencies.md)
