# Architecture and product audit

Audit date: 2026-09-30. Baseline repository commit: `7e8a10a8a6c478d1d36435a1d292b0873a005eb3`. This document maps the inspected source; test results and production observations are recorded separately. Source implementation does not prove a paid provider works in production.

## Product and identity

The implemented product is **Aquora**, an AI studio for creators. `package.json`, app metadata, wordmark, English/Chinese shell copy and desktop packaging agree on that name. The GitHub repository retains the historical name `open-generative-ai`. MIT upstream attribution belongs in README/NOTICE and is retained. Reelty is an independent real-estate application embedded in a studio tab; its authentication, data and backend are separate.

The application offers 15 studio tabs, with an English and Simplified Chinese route tree. The checked-in gateway catalog contains 522 keys, 443 enabled and 79 disabled. Enabled keys map to 318 distinct fal endpoints (109 image, 181 video, 13 lip-sync, 9 audio, 6 tools). The baseline advertised 300+ total and 100+ image claims fit the static catalog; the redesigned landing avoids unconditional model-count claims. These counts include aliases and tasks; individual live endpoint capability, schema compatibility and pricing still require controlled provider verification.

## Runtime components

| Layer | Implementation | Consequence |
|---|---|---|
| Web host | Next.js 15 App Router, React 19, Node 22, standalone server output | One Node service serves pages and API gateway; plain JavaScript, no TypeScript check is defined. |
| Shell and landing | `components/Landing.js`, `StandaloneShell.js`, locale messages, shared tab registry | Session gate, navigation, daily budget, notifications and embedded Reelty. |
| Studio workspaces | `packages/studio/src/components` | Prompt/model controls, uploads, generation/polling, previews, downloads and browser history. |
| Advanced editors | Vendored workflow-builder, ai-agent and design-agent workspaces | Babel/Tailwind package builds precede Next build; several advanced pages use standalone clients. |
| Gateway | `lib/gateway` and `app/api` | Server-only credentials, schema validation, workspace access checks, jobs, budgets, upload validation and provider calls. |
| Media provider | fal queue/run/storage/pricing APIs | Remote model execution and CDN URLs; output files are not owned in app object storage. |
| Text provider | OpenRouter model allowlist and metered chat | Prompt helper, agent, design and workflow text features depend on OpenRouter. |
| Data | Workspace-scoped JSON document files, atomic rename, in-process document locks | No SQL database, Airtable integration, migrations, cross-process locks or shared queue. Railway volume required. |
| Desktop | Electron + Vite legacy shell, local sd.cpp/Wan2GP helpers | Separate build path; web regression does not certify installers or local inference. |

## Pages and navigation

| Route family | Behavior |
|---|---|
| `/`, `/zh` | Landing page; cookie presence may redirect a returning browser to studio. Actual authorization is checked by gateway. |
| `/studio`, `/zh/studio` | Shell, initial Image Studio, session/setup/offline gating. |
| `/studio/<tab>`, `/zh/studio/<tab>` | One of the 15 registered tabs; unknown first segment gives 404. |
| `/studio/workflow/<id>` | Legacy workflow alias supported by shell. |
| `/studio/apps`, `/studio/vibe-motion` | Retired links redirect to studio; those capabilities are removed/hidden. |
| `/assistant`, `/zh/assistant` | Redirect to studio. |
| `/agents`, `/zh/agents` | Redirect to studio agent gallery. |
| `/agents/create`, `/agents/edit/<id>`, `/agents/<agent_id>[/<conversation_id>]` and Chinese equivalents | Server-side session guard, workspace lookup, agent create/edit/chat clients. |
| `/workflow`, `/zh/workflow` | Redirect to studio workflow gallery. |
| `/workflow/<id>[/<tab>]` and Chinese equivalents | Shell with workflow editor/playground routing. |
| `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, app icons and OG image | SEO/PWA metadata. Manifest exists; no offline/service-worker implementation was identified. |

## Implemented studio journeys

| Studio tab | User supplies | Implemented output / dependency |
|---|---|---|
| Image | Prompt and optional reference image(s), model/size settings | Text-to-image or image edits through enabled catalog; preview/history/download. |
| Layers | Base image, regions/layers and edit instruction | Canvas editing, enhancement/relight/angles/text tools, Seedream layer decomposition; only available tools should be selectable. |
| Video | Prompt, image/video/audio references as model requires | Model-specific media generation; some continuation/upscale entries are server pipelines. |
| Audio | Model-specific music, speech or sound parameters | fal audio output, playback and download. |
| AI Clipping | Video uploaded through Aquora plus highlight brief | Workspace-owned upload verification, transcription, OpenRouter highlight scoring and timed clips via fal tools. |
| Motion Control | Character image plus reference motion video | Supported motion endpoints on fal. |
| Lip Sync | Portrait/video and audio; optional speech details | Talking/lip-synced video via catalog. |
| Body Swap | Target character image and source video | Enabled recast endpoints; not all historical picker models are available. |
| Cinema | Scene prompt and camera/lens/focal/aperture choices | Prompt modifiers sent to image generation; this is not a physically accurate camera simulator. |
| Marketing | Product/optional avatar or video references plus ad prompt | Reference-video ad generation; not ad buying, publishing or performance tracking. |
| Workflows | Template or node graph, connections, inputs | Save/copy/rename/delete, per-node or full run, playground; server DAG execution (up to 3 nodes concurrently, 24 media steps). |
| Agents | Template or custom name/instructions/skills, conversational input | Workspace CRUD, conversations, metered text and allowed media function tools. |
| Design Agent | Canvas/session, uploaded assets, prompt or skill recipe | Persisted sessions/assets/messages, OpenRouter planning and media/arrange tools. |
| AI Influencer | Reference persona and scene/style parameters | Reference-guided image creation; no trained identity model or identity guarantee. |
| Reelty | Independent embedded app | Cross-origin iframe plus open-full-app link; app workflow and availability depend on external service. |

## API map

All paid and workspace APIs run in Node, and the common route wrapper enforces session/CSRF/error handling. Metadata/health are public. Rate categories vary by action. This table groups the complete dispatched surface rather than pretending every action is a separate Next route file.

| API | Methods and actions |
|---|---|
| `/api/health` | GET: liveness, configured-provider booleans, gate/storage modes and sanitized release SHA. |
| `/api/session` | GET status/visitor session/budget/features; POST code sign-in; DELETE session revocation and cookie removal. |
| `/api/v1/models/available` | GET public enabled/disabled keys, disabled studio models, thumbnails and model aliases. |
| `/api/v1/<catalog-key-or-pipeline>` | POST validated media request; returns signed job token. Catalog keys containing `/` are encoded as one segment. Unregistered paths reject. |
| `/api/v1/predictions/<token>/result` | GET signed, session-bound polling; normalized queued/processing/completed/failed/cancelled results. |
| `/api/v1/predictions/<token>/cancel` | POST best-effort cancellation; running providers may still bill. |
| `/api/v1/upload_file` | POST multipart media; type/size/magic-byte checks then fal CDN upload. Image 25 MB, audio 50 MB, video 200 MB caps. |
| `/api/v1/estimate`, `/api/app/calculate_dynamic_cost` | POST model/payload or task_name/payload; estimated USD/null; does not generate media. Pricing lookup may query provider metadata. |
| `/api/llm/chat` | POST metered allowlisted OpenRouter chat with bounded tokens/content. |
| `/api/agents/*` | Template/featured gallery, workspace agents/conversations, skills; create/suggest; lookup/update/delete by slug/id; chat, preview-realign and conversation lookup/delete. Public profiles/likes/publishing return 404. |
| `/api/workflow/*` | Templates/list/create/save/name/category/delete/detail; schemas, API inputs, per-node/full/playground execution, thumbnail; run status/outputs/cancel, node-result deletion; architect/poll. Third-party API schemas empty, published feed empty, publish/admin templates unsupported. |
| `/api/v1/creative-agent/*` | Skill list; session CRUD/messages/assets/browser-owned jobs; chat/skill runs; events/status/cancel/reject. Approve returns 409 because runs do not wait for approval. |

## Authentication, roles and data scope

- Private mode uses strong access codes and HMAC-signed HttpOnly/SameSite=Lax cookies, secure in production, 30-day lifetime. Same code means same workspace. New login means new session ID; job tokens bind to that browser session, while documents scope to workspace. Removing a code invalidates its sessions.
- Optional public mode mints a random private visitor workspace. Clearing cookies/signing out loses the visitor credential; there is no email account recovery or independent ownership transfer flow.
- There are no administrator/member/customer roles, SSO, password reset, invitation management or billing account model. `FAL_ADMIN_KEY` is reserved and unused.
- Agents, workflows, design sessions/assets/messages, upload ownership records, finished pipeline jobs, daily ledger and revoked-session records live in JSON files. Media URLs point to providers. Ordinary studio history/drafts live in workspace-scoped localStorage on that browser, so a shared code does not synchronize the full history across devices.
- Provider keys are server-only; browser sends same-origin gateway requests. Catalog transforms allowlist fields/models; server-built provider URLs and public-media validation prevent generic proxy behavior. Middleware adds CSP and security headers; upload bypasses middleware buffering and has its own size/security controls.

## Generation lifecycle and limitations

Direct fal requests reserve an estimated budget, use a queue, return an HMAC job token, and are polled by the browser. Transient poll errors retry. Completed results are normalized. Known failures refund estimates; ambiguous network/timeout/running cancellation may retain estimates because the provider may bill. Submit is not blindly retried after an ambiguous acknowledgement. Text calls reserve worst-case cost and settle to usage where available. There is no customer payment, credit purchase, subscription or invoicing flow; the visible daily figure is an estimated provider spend allowance.

The server limits in-flight jobs per session and rate-limits session/network requests. Rate buckets, concurrency slots, settled-result cache and active multi-step execution are process-local. A Railway restart loses active agent/design/workflow/clipping/extend/upscale pipelines; reconciliation reports interruption instead of resuming work. Completed pipelines persist best effort. Direct fal job tokens carry enough signed provider coordinates to continue polling after restart with a valid session/secret.

The audit adds an optional generation Idempotency-Key scoped to session/workspace, with canonical payload conflicts and a bounded process cache. It prevents a same-key duplicate inside that live process; it does not survive restart or replace a durable submission journal/provider callback worker. Different keys or sessions can still create new requests. UI duplicate-click prevention does not establish exactly-once execution under network retries or multi-tab submits. Budget serialization and concurrency regression fixes are described in the backend audit. Durable workers, shared state and an owned output-storage/retention policy are the next architecture milestone before scaling to multiple instances.

## Advertised versus implemented

| Claim / expectation | Finding |
|---|---|
| Baseline 300+ AI models and 100+ image models | Supported by catalog counts, not certification of every live endpoint; final landing removes these unconditional counts. Some historical model names intentionally map to newer family versions and need visible "Runs on" disclosure. |
| All model pickers are usable | Availability hides disabled keys after metadata loads. Before load or on metadata failure, availability initially assumes true; unsupported legacy choices may appear until refreshed. |
| All-in-one app | Most studios share gateway; Reelty is external. Browser history is local and advanced documents server-persisted. |
| Agents and design automation | Implemented bounded tool loops; no external MCP/plugin catalog, approval workflow or unrestricted web automation. |
| Social/marketing automation | Creative assets implemented; social publishing, ad buying and optimization integrations are absent. |
| Team workspace | Code-scoped shared documents and daily budget; no fine-grained roles, per-member audit or invitations. |
| Local models | Electron-only optional integration; unavailable in the hosted browser without separate local inference infrastructure. |
| Motion graphics, Explore Apps, MCP/CLI, community publishing | Deliberately hidden/removed or return unsupported responses. `VibeMotionStudio` source remains but is not navigable as a launched feature. |
| Airtable/SQL/Supabase | No connected code path found; current backend is JSON files plus provider storage. |
| Persistent deployment | Requires an attached volume and writable store. Setting a path alone does not prove persistence. |

## Engineering checks and dependencies

Root npm workspaces manage studio, workflow, agent and design packages; pinned lockfile and Node 22 are present. React 19/Next 15, Tailwind 3, Babel, axios, ReactFlow/XYFlow, Konva, Markdown renderers and Electron are major dependencies. Both ReactFlow generations and Markdown major versions exist through vendored workspaces; this is maintenance/bundle complexity, not proof of a vulnerability. Supply-chain advisory findings require the root dependency audit's results.

Existing node:test coverage exercises gateway/session/security/billing/catalog/agents/workflows/design pipelines and desktop helper units against local mocks. ESLint initially passed with warnings; its config excludes vendored advanced-editor workspaces and legacy Electron/Vite UI. The audit CI change adds lint, catalog freshness and mock-backed Playwright browser checks. Final browser coverage and results are in the QA report. No TypeScript or separate typecheck script exists. Web production build must be verified alongside package builds; Docker engine was unavailable here, so an actual image build and image restart were not claimed.

See [Railway readiness](audit-railway.md) for deployment evidence and account-access requirements.
