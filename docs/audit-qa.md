# Pre-launch QA and regression coverage

Audit date: 30 September 2026. Application identity: **Aquora**. The repository name is `open-generative-ai`.

## What the checks prove

The browser suite runs a production-mode Next application on `127.0.0.1`, with the real access gate, gateway routes, validation, workspace storage, job polling and UI. fal.ai and OpenRouter are replaced by the existing local upstream mock. Storage is an isolated temporary directory, provider keys are test strings, and the test configuration cannot point at a remote deployment. Requests to external browser origins are blocked, including Reelty.

The test server models one trusted reverse proxy. Each browser test supplies a distinct synthetic client IP from the benchmark range `198.18.0.0/15`; all requests within that test retain the same IP. The normal login and generation limits remain enabled. This prevents unrelated tests from exhausting one localhost login bucket while preserving invalid-input and rate-limit behavior within a journey.

The local mock emits HTTP media URLs. For browser fixtures only, final media URLs are rehosted to intercepted HTTPS `fal.media` URLs so the normal production Content Security Policy remains active. The bytes still come from local media fixtures. No paid provider job, purchase, customer data change or production load test is part of this suite.

The tests demonstrate application behavior under controlled provider responses; they do not certify live model quality, live provider account setup, pricing accuracy, Railway account settings, or the independent Reelty application.

## Browser coverage

| Area | Journeys exercised |
|---|---|
| Access and sessions | Empty and invalid codes, code visibility, successful sign-in, HttpOnly cookie, no credential in browser storage, refresh persistence, expired cookie, logout, failed logout, deployment setup state and session outage with retry. |
| Navigation | Direct links to all 15 studios, real 404 for unknown studio, retired links and legacy aliases, back/forward, refresh, Chinese deep link, mobile navigation. |
| Landing and layout | Honest access/availability/budget/history copy, real studio entry point, desktop and mobile viewport fit, primary generation action, named workspace landmark. |
| Image generation | Required prompt validation without a submission, local job completion, disabled generation while busy, output/history/draft persistence, workspace isolation, provider rejection and retry, budget failure recovery. |
| Video generation | Required-input validation, local clip submission/polling/preview, draft and history after refresh. |
| Audio generation | Change model, required-field validation, local audio submission/polling, playback/pause and persisted settings/history. |
| Agents | UI create, edit and save, actual local LLM first and follow-up turns sharing one conversation, conversation URL/history after reload, delete. |
| Workflows | UI create and rename, real API save of a deterministic graph, local image step execution in Playground, persisted run history, reload and delete. Visual canvas mounting is checked separately. |
| API failures | Workflow and agent list failure and retry, media provider failure, budget rejection, temporary result-poll failure. |
| Unfinished jobs | Image, video and audio refresh while processing: resume the same token and produce a result without another provider submission; unfinished work stays private to its workspace; a token owned by a signed-out session is cleared after reauthentication without resubmitting. |

Advanced studios (layers, clipping, motion control, lip-sync, body swap, cinema, marketing, design and influencer) receive route/render checks in the browser. Their pipeline algorithms, validation and API behavior are covered by the repository's existing gateway tests with local providers. The browser suite does not drive every advanced canvas action or every catalog model permutation.

## Confirmed defect and regression

An HTTP error from `DELETE /api/session` previously cleared the browser's signed-in state while the server cookie could remain valid. The shell therefore claimed logout had succeeded. The client now checks the response and preserves authenticated state on failure; the browser regression injects a 503, verifies the retry error, then verifies a successful logout and a refresh.

Ongoing media jobs previously existed only in component memory. A refresh lost the request token, while a new generation could create another paid job. The core media studios now store workspace-scoped pending tokens and resume polling after reload. The browser regressions hold result polling in processing, refresh, then release the actual local job result and assert exactly one provider submission. Replacing the session cookie by signing out is a separate case: job tokens are bound to the session and cannot be assumed recoverable under a new session.

Saving an agent scheduled an unconditional redirect 1.5 seconds later. Opening the visible Chat link during that delay left the timer alive after the editor unmounted, so it redirected the active conversation to the agents list even when the turn completed successfully. Saving now stays in the editor with its success message; Chat and Back provide explicit navigation. The regression saves and immediately opens Chat, then verifies first and follow-up replies, exactly two chat submissions, a shared conversation ID, and both messages after a server-rendered refresh. Chat submission also starts directly from the mounted chat and receives a canonical conversation URL after completion.

## Running the suite

```bash
npm ci
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

The default ports are 3100 (application) and 4017 (mock upstream). The harness always starts a fresh app and removes its temporary data on shutdown. It does not reuse a separately running server. Use `E2E_PORT` to change the application port.

If a managed environment already has a compatible Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. This audit used Chromium 153.0.8010.0 with Playwright 1.63.0 after the Playwright browser CDN download failed in the audit environment. That recovery did not add a Chromium package to this repository.

Failure screenshots and traces are saved under ignored `test-results/`; the HTML report is under ignored `playwright-report/`. Video capture is opt-in with `E2E_VIDEO=true` and requires the Playwright ffmpeg binary. To refresh the review images in this document, use `E2E_CAPTURE_PREVIEWS=true npm run test:e2e -- --grep 'landing|desktop studio'`.

## Remaining launch checks

1. Verify a controlled, approved generation for each provider/model family with production credentials, including schema compatibility, CDN access and actual billing. This audit deliberately uses mocks.
2. Inspect Railway logs, volume attachment, environment variables and the deployed commit in the account. Public-page checks cannot prove those settings.
3. Running in-process workflows, agents and clipping jobs cannot continue across a service restart; there is no external worker queue. Media job refresh recovery does not change that architecture.
4. Cancellation exists in backend API routes; the core media studios still need a client-facing Cancel control. Do not advertise that UI behavior before it exists.
5. Standalone media history remains on the current browser/device, and generated media remains at provider URLs. Download results that must be retained. There is no account-wide managed asset library.
6. Electron installers, local GPU inference, independent Reelty journeys, exhaustive model combinations and a full automated accessibility audit are outside the web suite's verified coverage.

## Review screenshots

The optional capture run produces desktop/mobile landing and image workspace screenshots, plus a mobile audio result, in `docs/audit-preview/`. They use test state and illustrative art, never customer content. The reviewed viewports are 1440×1000 and 390×844. Landing and image views fit their viewport width; the mobile audio journey scrolls to a usable player and successfully plays and pauses the local track.

The portable audit browser environment has no CJK font installed. The `中文` language-switch text therefore appears as boxes in these English-page captures; the source text and Chinese locale route are valid. This is a screenshot-environment limitation, not verified production text corruption.

| Preview | File |
|---|---|
| Landing desktop | [landing-desktop.png](audit-preview/landing-desktop.png) |
| Landing mobile | [landing-mobile.png](audit-preview/landing-mobile.png) |
| Image workspace desktop | [image-desktop.png](audit-preview/image-desktop.png) |
| Image workspace mobile | [image-mobile.png](audit-preview/image-mobile.png) |
| Audio result mobile | [audio-mobile.png](audit-preview/audio-mobile.png) |

## Verification status

The final source build was validated as local Next build `erAMmvu4K8350NOkgL2Qs`. The browser server exited cleanly and removed its temporary data. The run below used the real production CSP and access controls with local providers only.

| Check | Result | Evidence |
|---|---|---|
| Production build | Passed, all four workspace packages and Next 15.5.26 | [build.txt](audit-evidence/build.txt) |
| Unit and gateway tests | 411 passed; zero failures or skips | [unit-gateway.txt](audit-evidence/unit-gateway.txt) |
| Browser regression | **42 passed in 2.8 minutes**, zero failures | [browser.txt](audit-evidence/browser.txt) |
| Lint | Zero errors; 56 existing warnings | [lint.txt](audit-evidence/lint.txt) |

The focused fast-Save→Chat regression also passed independently before the complete suite. Catalog freshness and `git diff --check` passed. This is local verification; the Railway image, provider credentials and deployed commit still require the operator checks above.
