# Aquora deployment and launch verification

Date: 2026-09-30 UTC.

**Deployment completed successfully. Hold broad customer launch until representative real-provider tests pass and the operational limits below are addressed or explicitly accepted.** The deployed branding and core application regressions are verified; configured provider flags alone do not prove valid credentials, account balance, model access or generated output quality.

## Released version

- Production: https://open-generative-ai-production-4eaf.up.railway.app/
- Merged PR: https://github.com/hemantsatishjadhav06-ai/open-generative-ai/pull/1
- Production commit: `13457fa6783406e223d94ee23901d7d35d153712`.
- Verified source tree: `34885d5871d64a91ccdee374e0e6de367282e2a6`. The merged commit has exactly the same tree as the tested PR head `914853a25f6b7dd6adc9056c03d26f0a79b31388`.
- Final pre-merge Node 22 CI: https://github.com/hemantsatishjadhav06-ai/open-generative-ai/actions/runs/36751127939 — success.
- Merged-main CI: https://github.com/hemantsatishjadhav06-ai/open-generative-ai/actions/runs/36751908133 — success.
- Railway deployment: `787f408d-195a-46c3-a144-6ee83ef05fb8` — SUCCESS. Container startup observed at 17:33:49 UTC.
- `/api/health` returns the exact merged commit, `ok: true`, `gate: open`, `storage: persistent`, and configured fal/OpenRouter flags.

The user authorized deployment in the follow-up request. The prior [pre-launch audit](prelaunch-audit.md) describes the earlier, unmerged state; this report records subsequent verification and deployment.

## Final recheck fixes

The release includes the original budget, job recovery, request identity, cancellation correctness, authorization, session and agent navigation fixes plus the Aquora UI redesign. Two additional findings were fixed during the launch recheck:

1. Model discovery previously treated missing metadata as permission to show all historical models. Unknown availability now hides unverified choices; media studios show an explicit loading/error state with a retry. Discovery has a ten-second timeout. New browser tests verify a failed request and a slow request cannot expose generation controls before metadata is ready, and retry does not submit a job.
2. Embedded Design Studio rendered a second main landmark. It now preserves the host's single main landmark. The route regression waits for the real canvas heading and message input, avoiding a false pass against the loading placeholder.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| Unit and gateway regression | 411 passed, zero failed/skipped | [Test log](release-evidence/tests.txt), final CI |
| Browser regression on production build | 44 passed, zero failed, 3.0 minutes locally | [Browser log](release-evidence/browser.txt), final CI |
| Build | All four workspace builds and Next production build passed locally and in CI; Railway Docker build passed | [Build log](release-evidence/build.txt) |
| Lint | Zero errors, 56 existing warnings | [Lint log](release-evidence/lint.txt) |
| Touched Design Studio package | Targeted lint: zero errors, ten existing warnings | Local targeted lint; package is otherwise outside the baseline lint scope |
| Catalog freshness | Passed | CI |
| Fresh production dependency advisory audit | Zero reported advisories | [Production dependency audit](release-evidence/production-dependencies.json) |
| Full dependency audit | 16 advisories: 1 critical, 14 high, 1 moderate; Electron/build/Vite tooling | [Full dependency audit](release-evidence/all-dependencies.json) |
| Deployed routes/assets | 27/27 expected HTTP responses, including intentional 404 | [Live route matrix](release-evidence/live-routes.json) |
| Release identity and storage | Health commit matches; persistent storage reported | [Production checks](release-evidence/production-checks.json) |
| Session/document survival | Isolated QA visitor session and workflow survived the real deployment | [Production checks](release-evidence/production-checks.json) |
| QA cleanup | Only the test workflow created for this check was deleted; read-back returned 404 | [Production checks](release-evidence/production-checks.json) |

Browser regression covers all 15 studio mounts, complete Image/Video/Audio/Agent/Workflow journeys with local provider fixtures, pending-job refresh recovery, duplicate prevention, session expiry, workspace privacy, failed logout, transient polling errors, validation, mobile navigation and localized routes. It is not exhaustive across every model or specialist canvas combination, and is not a complete accessibility certification.

## Live experience and branding

Aquora is the established product brand; Open Generative AI remains the repository name. The deployed public landing, studio, icon assets, manifest, titles and social-sharing image use the reviewed identity. The fresh manifest reports theme color `#0b141c` and the revised product description without the old unconditional model-count claim. The landing's new headline and correct production canonical origin were verified directly.

The intended design uses Inter/Space Grotesk, a light public landing, dark media workspaces, turquoise primary controls, clearer task entry points and explicit guidance about device-local history and estimated usage. The editable [Figma proposal](https://www.figma.com/design/5GVn4DlY1vo3ngNHgpPm05) remains available for design review.

Live Chrome checks confirmed:

- Image Studio and the updated navigation/brand loaded after deployment.
- Model search/selection worked and retained the selected model through Image → Video → Audio → back navigation.
- Empty image input displayed the expected validation message without generating anything.
- Settings clearly explained visitor workspace ownership, device-local history and the daily budget.
- Escape dismissed Settings and returned keyboard focus to its trigger.
- Video and Audio controls loaded successfully.
- Captured browser warning/error entries were extension metadata messages; none were application errors in the inspected sample.

![Verified deployed Image Studio](release-evidence/production-studio.jpg)

## Railway facts verified with account access

The existing production service remains connected to this repository's `main` branch. It has one instance in `us-west2` and a 5 GB volume at `/data`; there were no unrelated staged configuration changes. No provider secrets were displayed or changed. OAuth exposes variable names rather than secret values.

Actual build logs confirm the repository Dockerfile, Node 22 Alpine, locked dependency installation, package builds and Next standalone output. Startup logs show the volume mounted, the server listening on `0.0.0.0:8080`, and readiness in 96 ms. The configuration file sets `/api/health`, a 60-second deployment healthcheck timeout and an ON_FAILURE restart policy. Railway marked this deployment SUCCESS.

The post-deployment sampled HTTP logs contained successful requests plus the intentional invalid-route 404; no 5xx was present in that sample. This is a point-in-time verification, not continuous uptime monitoring. The mounted-volume test proves survival of the QA document across this deployment, not backup/restore readiness or permanent media retention.

## Remaining launch conditions

1. **Real-provider smoke tests are pending.** Automatic approval review rejected the proposed test because it would upload a public test image to fal and invoke paid fal/OpenRouter operations, conflicting with the user's earlier “do not make purchases” instruction. The script was blocked before execution; no paid smoke job was dispatched, and the QA workspace spend remained zero. A separate explicit test budget is required before attempting these operations. Proposed scope: one small image, short video, short audio, brief text/agent/vision-purpose calls and one test image upload, capped at $1 total after checking current prices. No purchase of credits or subscription is proposed.
2. **Backup and restore have not been verified.** Confirm a backup schedule and restore test before relying on the JSON volume for customer content.
3. **Active multi-step jobs are process-local.** A deploy/restart can interrupt agent/workflow/design pipelines; the implementation has no durable worker queue or shared coordination. Keep one instance and avoid promising uninterrupted multi-step jobs. Browser recovery of direct media jobs does not remove this architectural limit.
4. **Content retention is limited.** Core media history is stored on the current device. Generated files are provider CDN URLs, not an application-owned permanent archive. Visitor workspace recovery depends on the browser session.
5. **Desktop and separate services remain outside web launch certification.** Do not release Electron installers on the strength of this web verification; the full dependency audit still lists desktop/build advisories. Reelty's independent backend was not regression-certified here. Core media has no Cancel control in its UI despite backend cancellation support.

No customer content was modified, no load test ran, no credits/subscriptions were purchased, and no real-provider generation or upload was completed. Only isolated QA data was created and cleaned up for the deployment persistence test.
