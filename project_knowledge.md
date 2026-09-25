# Aquora: technical notes

Internal notes for people working on the codebase. Aquora (formerly Creator
Agency) is built on the open-source project Open Generative AI (MIT) by Anil
Chandra Naidu Matcha and contributors. See README.md for setup and deployment.

## 1. What it is

An AI studio for creators: image, video, audio, lip-sync, avatars, agents,
workflows and a design agent, with Reelty (AI real-estate marketing) embedded as
a tab. It runs on its own backend: media generation on fal.ai, text and agents
on OpenRouter. Provider keys are server-only; people sign in with an access
code.

- **Stack:** Next.js 15 (App Router, standalone output), React, Tailwind CSS,
  plain JavaScript ESM (no TypeScript). Node 22.
- **Deploy:** Railway, Dockerfile builder, `/api/health` healthcheck, one
  replica, a volume at `/data`.

## 2. Layout

```
app/                   pages (en at /, zh at /zh) and API routes
  api/session          access-code sign-in: GET status, POST {code}, DELETE
  api/v1/[...path]     POST /api/v1/<model key or pipeline> → job token
  api/v1/predictions   GET <token>/result, POST <token>/cancel
  api/v1/upload_file   multipart upload → fal CDN URL
  api/v1/models        which catalog models are enabled (studio pickers)
  api/llm/chat         OpenRouter chat for the UI (fast / agent / vision)
  api/agents, api/workflow, api/v1/creative-agent   agents, workflows, design agent
lib/gateway/           gateway core (server-only)
  config.js            env vars, gate mode (open | codes | setup_required)
  session.js           HMAC cookie `aquora_session`, same-origin check
  limits.js            token buckets, job slots, daily budget ledger
  catalog/             generated catalog.json + studio → fal input transforms
  generation.js, router.js, fal.js, falStorage.js, openrouter.js, jobs.js,
  normalize.js, pricing.js, store.js, ssrf.js, pipelines/
lib/*.js               shell helpers: locales, SEO, tab registry, session/budget
                       helpers, middleware policy (CSP), analytics
components/            StandaloneShell (nav, sign-in, budget pill, settings),
                       AccessCodeModal, Landing
messages/{en,zh}/      shell copy
packages/studio/       studio components, model lists, gateway client
                       (src/gateway.js) and session client (src/session.js)
packages/*             vendored workflow builder, agents UI, design agent UI
scripts/               build-gateway-catalog.mjs, mock-upstream.mjs
tests/                 node:test suites; tests/gateway/* run against the mock
```

## 3. Request flow

1. The shell calls `GET /api/session`. Signed out (codes mode) → the
   access-code wall. `setup_required` → a setup notice. Open mode (local dev)
   → a session is minted automatically.
2. A studio posts its payload to `/api/v1/<model key>` (the key is the model id
   the studio has always used). The router looks the key up in the catalog,
   builds the fal input (rename → transforms → fixed → allowlist → validate),
   reserves the estimated cost against the budget, submits to the fal queue
   and returns `{request_id: <signed job token>, status: 'processing'}`.
3. The studio polls `/api/v1/predictions/<token>/result`. The token is
   HMAC-signed and bound to the caller's session; results are normalized to
   `{status, url, outputs, images?, video?, audio?}`. A failed job refunds its
   estimate.
4. A 401 anywhere makes the studio client dispatch `aquora:session-required`;
   the shell re-checks `/api/session` and shows the sign-in overlay if the
   session really ended. A 402 dispatches `aquora:budget-exceeded`; the shell
   refreshes the "Today: $x of $y" pill.

## 4. Rules that matter

- Never add a generic pass-through: the browser never sends a provider URL,
  endpoint id or status URL. Only catalog models, server-built fal URLs and an
  OpenRouter model allowlist.
- Never log prompts, keys, cookies, access codes or media URLs.
- Never put a provider key in `NEXT_PUBLIC_*` or a Docker build arg.
- The CSP (`lib/middlewarePolicy.js`) allows the browser to connect only to
  this origin and `fal.media`; provider APIs must never be added there.
- User-facing strings go in both `messages/en` and `messages/zh` (and the
  studio's own `packages/studio/src/messages`).
- Model counts in copy are checked against the catalog by
  `tests/landingCopy.test.js`; studio counts come from `lib/studioTabs.js`.

## 5. UI and styling

- **Theme:** dark by default (`surface-app` `#050b14`). Turquoise brand
  (`#2ee6d6`, `brand`) for primary actions and glows, electric blue (`pop`,
  `#3b82f6`; `pop-400` `#60a5fa` for blue text on dark) as the accent. Brand
  gradient: `linear-gradient(135deg, #2ee6d6 0%, #3b82f6 100%)`.
- **Type:** Inter for body copy, Space Grotesk (`font-display`) for the
  wordmark and headings.
- Tokens live in `tailwind.config.js` and `app/globals.css`; keep them in sync.

## 6. Testing

- `npm test`: unit tests plus the gateway suites against
  `scripts/mock-upstream.mjs` (a local fal + OpenRouter stand-in). No network.
- `npm run mock:upstream` prints the env vars that point a dev server at the
  mock, for manual or Playwright runs.
- `node scripts/build-gateway-catalog.mjs --check` fails when the catalog is
  stale.
