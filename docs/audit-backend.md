# Backend pre-launch audit — 30 September 2026

Scope: server-side gateway, access-code sessions, JSON storage, generation/job lifecycle, fal/OpenRouter transport, pricing/budgets, SSRF checks, uploads, agent/design/workflow APIs. All generation tests use a local mock server and test workspaces. No paid provider request or production-data mutation was performed.

## Confirmed defects and implemented fixes

| ID | Priority | Defect and impact | Fix and regression evidence |
| --- | --- | --- | --- |
| BE-01 | P1 | `reserveBudget` awaited a separate check before debiting. Ten concurrent $0.20 reservations passed against a $1 cap and charged $2 in a local reproduction. Both workspace and global caps could be exceeded. | `lib/gateway/limits.js`: cap check and debit now execute in the same synchronous turn after loading the ledger. Tests race ten reservations in one workspace and across ten workspaces; exactly five fit. |
| BE-02 | P1 | Catalog submission reserved money before acquiring its concurrency slot. A racing fifth request could debit the ledger and then fail with `too_many_jobs`, without starting a generation or refunding. | `lib/gateway/generation.js`: acquire the slot before reservation and release it if reservation fails. Concurrent fifth request does not reserve money; refused budget leaves zero slots. |
| BE-03 | P1 | A refused/failed provider cancellation was still cached as terminal `cancelled`, released its slot, and prevented retrieval of a later successful result. | `cancelFalJob` now remains `processing` when cancellation is unconfirmed. A mock cancel HTTP 500 retains budget and slot, then subsequent completed polling retrieves the image. Accepted queued cancellation still refunds exactly once. |
| BE-04 | P1 | Retrying an identical generation POST had no duplicate-request protection. | Optional `Idempotency-Key` in `lib/gateway/router.js`/`idempotency.js` deduplicates concurrent and repeated submissions within one process. Same key/settings returns the same token; changed settings return 409; invalid keys fail before submission. Explicit submission boundaries preserve ambiguous provider failures while evicting certified pre-submission rejections. More than 2,000 invalid model requests cannot poison capacity; budget rejection can retry after funding. |
| BE-05 | P1 | `storageKind` reported any explicit `AQUORA_DATA_DIR` as persistent on Railway, even when it was only container disk. | `lib/gateway/config.js` reports Railway persistence only when `RAILWAY_VOLUME_MOUNT_PATH` covers the data directory. Tested unmounted, covering, and unrelated sibling paths. |
| BE-06 | P2 | Media URL traversal silently stopped beyond depth six, allowing deep media values to avoid URL validation. | `validateMediaInputs` rejects excessive nesting with 400 instead of skipping it. Regression submits a deeply nested private image URL. |
| BE-07 | P1 | Direct OpenRouter vision inputs accepted HTTPS private/metadata/loopback destinations. Unlike agent attachments, those inputs did not receive the public-media guard. The application passed them to the provider; this was not a demonstrated server-side download. | `lib/gateway/openrouter.js` validates HTTPS image parts through the same SSRF guard before provider POST and limits remote image parts to 64. Private/metadata/IPv6-loopback/local-host tests make zero provider calls; a trusted CDN image succeeds against the mock. |
| BE-08 | Test reliability | Restart-persistence tests waited arbitrary 30/50 ms and could clear the registry before the final result write completed under parallel test load. | Jobs expose an internal, non-enumerable `persistence` promise resolving true after the final store write or false on best-effort failure. `core-jobs` and `mock-pipelines` await the real completion signal. This acknowledges a write; it does not certify volume durability. |

New tests: `tests/gateway/prelaunch-regressions.test.mjs` (16 regression cases). Existing health expectations now include the validated release commit. The clipping ownership regression uses an unregistered fal CDN URL, so public DNS availability does not determine whether it tests the intended ownership rule; SSRF has separate coverage.

## Product and backend map

| Surface | Implemented behavior |
| --- | --- |
| `/api/session` | Access-code login, session status/budget, sign-out revocation. Production requires a strong signing secret and strong codes unless public access is deliberately enabled. |
| `/api/v1/<model>` | Catalog allowlist selects fal endpoint/input; validates media; reserves estimated spend; queues or synchronously executes. Catalog entries with before/after steps run as server pipelines. |
| `/api/v1/predictions/<token>/result`, `/cancel` | HMAC token bound to login session; queue status/result normalization; throttled polls; cancellation/refund controls. |
| `/api/llm/chat` | Purpose/model allowlist, bounded messages/output tokens, JSON/JSON-schema or SSE, budget reservation and reported usage settlement. |
| `/api/v1/upload_file` | Bounded upload body/concurrency; type sniffing; fal CDN storage; multipart upload above 90 MB; workspace upload registry and duration metadata. |
| `/api/agents/*` | Built-in templates, workspace agent CRUD, conversations, suggestion/realignment, asynchronous chat with allowed media tools. |
| `/api/creative-agent/*` | Workspace design sessions/assets/history, chat/skill jobs and event polling/cancellation. |
| `/api/workflow/*` | Template/workspace graph CRUD, model schemas, DAG runs, single-node runs, playground inputs/outputs, architect, history/cancellation. |
| `/api/health` | Public liveness/configuration booleans, gate/storage mode, validated build commit. No provider key or access code is returned. |

There is no SQL database in this gateway: workspace JSON documents are written via temporary-file rename, with per-document locks inside one process. Shared process state supplies rate buckets, slots, jobs, ledger caches and idempotency. Open access gives each browser a private visitor workspace. An access code identifies a shared workspace: members can edit its agents/workflows/design sessions. Jobs remain bound to the particular login session that created them. There are no separate customer/admin roles, individual user accounts, customer invoices, Stripe checkout, or a purchased-credit balance in these gateway APIs. The USD budget is a limit on owner-funded provider use, not a customer billing system.

Community publication, likes, profiles, public workflow feeds and arbitrary third-party workflow API nodes are intentionally unavailable. Their APIs return 404/empty feeds rather than implementing the upstream packages' advertised community behavior.

## Verified controls

- Provider credentials are read only in server configuration/transport modules. Browser model keys map through a server catalog rather than choosing arbitrary provider endpoints. Unknown and prototype-changing parameters are dropped by catalog building.
- Session cookies use HMAC verification, HttpOnly, SameSite=Lax, production Secure, expiry and signing-secret rotation. Removed access codes invalidate their workspace sessions. Sign-out revocations are mirrored to storage and tested across in-memory reset.
- Workspace-scoped CRUD, job session ownership, template immutability, input-size validation, rate buckets, upload concurrency, generation concurrency, budgets and idempotent refunds have automated coverage.
- Public-media checks reject private IPv4/IPv6, metadata, credentials and unsupported schemes. Server-side downloads validate every redirect and use validating DNS lookup when connecting. Explicit provider host overrides and `AQUORA_TRUSTED_MEDIA_HOSTS` are operator-controlled trust exceptions.
- Upstream errors map to bounded user-facing errors. Provider authentication failures become owner-configuration errors rather than exposing credentials. Queue submit, status, result, cancellation and synchronous run have timeouts. Pipelines carry an abort signal and a maximum duration.
- Running/cancelled/failed/completed response envelopes, result shapes, SSE usage, reported cost settlement, upload ownership and workflow dependency failure behavior are exercised with mocks.

## Release limitations and operator checks

1. **One instance only.** Rate buckets, slots, running pipelines and idempotency are process-local. JSON file locks are also process-local. Multiple Railway replicas/workers would require shared transactional storage, queues and distributed locks before these controls could be relied upon.
2. **Real mounted volume required.** Verify the Railway volume path covers `AQUORA_DATA_DIR`; a configured directory alone is insufficient. Budget/session persistence and completed-job writes are best effort. Some persistence failures are swallowed, so a health response is not an audited write-durability guarantee. Validate a real restart/redeploy with disposable test data once Railway account access is available.
3. **Running pipelines stop on restart.** Completed pipeline metadata can reload from storage; in-progress pipelines/agent/workflow jobs are not recoverable workers. Interrupted workflow runs are reported as failed. Provider-native fal queue jobs can be polled using their signed token after restart when signing configuration remains stable; active-slot accounting is not reconstructed.
4. **Idempotency has a precise limit.** Keys are scoped to `(workspace, session, key)`, last 24 hours, and the process stores at most 2,000 accepted/ambiguous entries. Equivalent object-key order is accepted. It covers `/api/v1` submissions, not every specialized agent/design/workflow mutation. It does not survive restart or span replicas. An uncertain network outcome must not be blindly resubmitted or retried against a replacement instance. Durable/provider idempotency remains future work.
5. **Budgets are estimates, not provider-side hard caps.** fal pricing may use static fallbacks and text token estimation approximates characters/4 with an image allowance. Actual usage can exceed its estimate, and OpenRouter network/HTTP retries may represent more than one provider attempt. Set provider account limits, keep initial owner-funded budgets low, and review actual provider charges. A running cancellation/timeout keeps reservations where work may already be billed.
6. **Media durability is separate.** Stored results primarily contain provider CDN URLs. Archiving output bytes, provider URL retention, deletion policy and restoring those bytes from independent object storage have not been demonstrated. The store is not a durable media bucket.
7. **Production services not exercised.** Real keys, provider availability/model identifiers, provider credit balances, live generation quality/latency, real account permissions, Railway logs, volume mounts and runtime restart behavior need operator access or a separately approved disposable smoke test. This audit did not spend provider credits.

The existing code explicitly accepts public access when configured. Launch with public access only after verifying the global budget, provider account limit, logging and persistence; public visitors can create fresh workspaces by clearing cookies, although the global spend cap and per-IP rate rules remain.

Read-only provider discovery on the audit date confirmed official OpenRouter pages for the three configured defaults: [openai/gpt-6-luna](https://openrouter.ai/openai/gpt-6-luna), [anthropic/claude-sonnet-5](https://openrouter.ai/anthropic/claude-sonnet-5) and [google/gemini-3.8-flash](https://openrouter.ai/google/gemini-3.8-flash). This establishes published model identifiers, not availability to this deployment's account, real schema execution, charges or latency. No inference request was made for this check.

## Validation

- New prelaunch regression suite: 16/16 passed with a loopback-only provider mock.
- Affected final suite (`prelaunch-regressions`, `core-jobs`, `mock-pipelines`): 30/30 passed.
- Full gateway suite: **270/270 passed**, zero failures/skips, using the repository's JSON-import registration (`node --import ./tests/support/register.mjs --test tests/gateway/*.test.mjs`).
- `git diff --check` passed for the shared working tree.
- No commits, merge, deployment, paid generation, purchases, load test, or real customer-data change was performed by this backend audit worker.
