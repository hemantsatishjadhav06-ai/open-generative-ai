<p align="center">
  <img src="public/banner.svg" alt="Aquora — AI studio for creators" width="100%">
</p>

<p align="center"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2ee6d6?style=flat-square&labelColor=050b14"> <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-2ee6d6?style=flat-square&labelColor=050b14"> <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-3b82f6?style=flat-square&labelColor=050b14"> <img alt="Runs on fal.ai + OpenRouter" src="https://img.shields.io/badge/runs%20on-fal.ai%20%2B%20OpenRouter-3b82f6?style=flat-square&labelColor=050b14"></p>

# Aquora

**Make anything. Ship everything.**

Make images, video, audio, lip-sync and AI personas in one place. Aquora runs on its own AI backend: media generation goes to [fal.ai](https://fal.ai), text and agents go to [OpenRouter](https://openrouter.ai). The provider keys live on the server; people sign in with an access code and their browser never holds a key.

Who it's for:

- **Creators and editors** who want every model in one tab instead of ten subscriptions.
- **Teams** who want to self-host it, hand out access codes and cap the daily spend.
- **Real-estate marketers**: the **Reelty** tab turns listing photos into tour videos, captions and ads.

## What's inside

| Studio | What it does |
|---|---|
| **Image** | Text-to-image and image-to-image across 100+ image models (Flux, Nano Banana, Seedream, GPT Image, Kling, Wan…), with multi-image reference input. |
| **Layers** | Layer-based editing: AI enhance, relight, 3D angle, text edits. |
| **Video** | Text-to-video and image-to-video (Kling, Sora 2, Veo, Wan, Seedance, MiniMax Hailuo…). |
| **Audio** | Music and audio generation from a prompt. |
| **AI Clipping** | Pull highlights out of long video automatically. |
| **Motion Control** | Drive a character image with reference-video motion. |
| **Lip Sync** | Portrait + audio → talking video, or video + audio → lip-synced video. |
| **Body Swap** | Recast the subject in any video with a target character image. |
| **Cinema** | Camera, lens, focal length and aperture controls turned into prompt modifiers. |
| **Marketing** | Product shots in, AI video ads out. |
| **Workflows** | Node-based builder for multi-step pipelines, with templates and a playground. |
| **Agents** | Conversational agents that plan and run generation tasks. |
| **Design Agent** | Canvas-based design agent. |
| **AI Influencer** | Consistent AI persona content. |
| **Reelty** | AI real-estate marketing studio, embedded as a tab (a separate app with its own backend). |

300+ fal.ai model endpoints across image, video, audio and lip-sync. The server-side catalog (`lib/gateway/catalog`) decides which models are available; the studio pickers hide the rest and show each model's fal thumbnail (a branded tile when fal has none). When a studio model is served by a newer model of the same family (for example Seedream 3 → Seedream 4.0), the picker says so ("Runs on …").

- **Extend** (Veo 3.1, Grok Imagine, Seedance 2.0 and its VIP tiers): the studio sends the earlier clip's job token as `request_id`; the gateway only accepts tokens from the same session, looks up that job's output video and passes it on. Seedance 2.0 extend is a server pipeline: fal's ffmpeg frame grab takes the clip's last frame, Seedance continues from it, and the two clips are merged.
- **4K** Seedance 2.5 entries render at 1080p (fal's maximum) and are upscaled to 2160p with SeedVR; "Veo 3.1 4K" upscales an earlier Veo clip the same way.
- **Layer decomposition** (Layers studio) runs on Seedream 5.0 Pro Layerize (base image plus up to 16 transparent layers).

Still disabled, with the reason recorded in the catalog: models fal does not host (Midjourney, Leonardo, Runway, Suno, Sora 1, Veo 4, Chroma, Neta Lumina, …), Imagen 4 (fal lists only deprecated preview endpoints), the "spicy" relaxed-moderation tiers (fal applies its standard moderation) and local utilities with no fal equivalent (watermark tools, pass-through nodes).

Not in this build: **Vibe Motion** (motion graphics) is hidden. It needs an LLM to write motion-graphics code and a headless renderer to turn it into MP4, and the Docker image has no renderer; old `/studio/vibe-motion` links open the studio. The **Explore Apps** and **MCP & CLI** tabs were removed.

The UI ships in English (`/`) and Simplified Chinese (`/zh`), including the full-screen agent pages (`/zh/agents/…`) and the workflow builder (`/zh/workflow/…`).

## How it works

```
browser ──(same origin, HttpOnly session cookie)──▶ Next.js /api routes (lib/gateway)
                                                      ├─▶ fal.ai   queue, storage, pricing   (FAL_KEY)
                                                      └─▶ OpenRouter chat completions         (OPENROUTER_API_KEY)
```

- **Sign-in**: `POST /api/session {code}` checks the code against `AQUORA_ACCESS_CODES` and sets an HttpOnly, SameSite=Lax cookie for 30 days. Everyone using the same code shares one workspace (agents, workflows, design sessions, history scope and the daily budget). Signing out revokes that session on the server (a copied cookie stops working too); removing a code signs all of its sessions out.
- **Generation**: the studios post to `/api/v1/<model>`; the gateway maps the request onto the matching fal endpoint, submits it to the fal queue and hands back a signed job token that only the same session can poll (`/api/v1/predictions/<token>/result`).
- **Uploads**: `POST /api/v1/upload_file` checks type and size (images 25 MB, audio 50 MB, video 200 MB), sniffs the file's magic bytes and stores it on fal's CDN.
- **Guard rails**: no generic pass-through (only catalog models, server-built fal URLs, an OpenRouter model allowlist and a `max_tokens` cap), same-origin checks on every write, rate limits per session and per IP, at most 4 jobs in flight per session, and daily spend caps (estimated per job at submit, refunded when a job fails). Over-budget requests get `402`, over-rate ones `429` with `Retry-After`.
- The header shows **Today: $x of $y**, the workspace's estimated spend against its daily cap (resets at 00:00 UTC). Settings shows the workspace and signs out.

## Quick start

Needs Node.js 22 (see `.nvmrc`).

```bash
git clone --recurse-submodules https://github.com/hemantsatishjadhav06-ai/open-generative-ai.git
cd open-generative-ai

npm run setup            # installs deps + builds the workspace packages (required once)
cp .env.example .env.local
# put your FAL_KEY and OPENROUTER_API_KEY in .env.local
npm run dev              # → http://localhost:3000
```

In development (`NODE_ENV` is not `production`) the access gate is open, so no code is needed. Already cloned without submodules? Run `git submodule update --init --recursive` once, then `npm run setup`.

**No provider keys?** `npm run mock:upstream` starts a local stand-in for fal.ai and OpenRouter (sample media, fake queue, fake chat) and prints the variables that point the gateway at it. The test suite uses the same mock, so nothing leaves your machine.

Production build: `npm run build && npm run start`.

## Configuration

Every variable except the `NEXT_PUBLIC_*` ones is **server-only**: set it as a runtime service variable, never as `NEXT_PUBLIC_*` and never as a Docker build arg. `.env.example` has the full annotated list.

| Variable | Required | What it does |
|---|---|---|
| `FAL_KEY` | yes | fal.ai API-scope key ([fal.ai/dashboard/keys](https://fal.ai/dashboard/keys)). Images, video, audio, lip-sync and uploads. |
| `OPENROUTER_API_KEY` | for text features | OpenRouter key ([openrouter.ai/keys](https://openrouter.ai/keys)). Prompt tools, agents, the design agent, workflow text nodes, clipping highlights. Give it a credit limit on OpenRouter as a backstop. |
| `AQUORA_ACCESS_CODES` | yes in production | Comma-separated access codes, one per person. Production ignores weak codes (under 12 characters or fewer than 6 different characters); generate each with `openssl rand -base64 18`. Without a usable code, a production server answers `503 setup_required` on every paid endpoint and the studio shows a setup notice. |
| `AQUORA_SESSION_SECRET` | yes in production | At least 32 random bytes; signs session cookies and job tokens. Rotate with `new,old` (comma list). Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `AQUORA_DAILY_BUDGET_USD` | no (25) | Estimated spend cap per UTC day for the whole deployment. |
| `AQUORA_SESSION_DAILY_BUDGET_USD` | no (10) | Estimated spend cap per UTC day per workspace (access code). |
| `AQUORA_LLM_PROMPT_USD_PER_MTOK` / `AQUORA_LLM_COMPLETION_USD_PER_MTOK` | no (5 / 25) | Fallback prices for OpenRouter models that aren't listed in its `/models` pricing. Every LLM call reserves its worst case up front and settles to the real cost, so aborted requests are still charged. |
| `AQUORA_TRANSCRIBE_USD_PER_MINUTE` / `AQUORA_CLIPPING_MAX_MINUTES` | no (0.006 / 120) | AI Clipping transcription price per minute of video, and the longest video it accepts. Clipping only accepts videos uploaded to Aquora. |
| `AQUORA_DATA_DIR` | no | JSON document store (agents, workflows, design sessions, jobs, budget ledger). Defaults to `/data` when writable, else `./.aquora-data`. |
| `OPENROUTER_MODEL_FAST` / `_AGENT` / `_VISION` | no | Model ids for quick text tasks, agents and image understanding. |
| `OPENROUTER_ALLOWED_MODELS` | no | Extra OpenRouter models the UI may ask for by name. |
| `AQUORA_ALLOWED_ORIGINS` | no | Extra origins allowed to POST to the API (the site's own host always is). |
| `AQUORA_TRUSTED_PROXY_HOPS` | no (1) | Reverse proxies in front of the app; the client IP is the `X-Forwarded-For` entry the nearest one appended (Railway: 1). Use `0` when the app is reached directly (the Docker Compose file does). |
| `AQUORA_CLIENT_IP_HEADER` | no | A header your proxy overwrites with the client IP (e.g. `x-real-ip`). Only set it when the proxy really overwrites it. |
| `FAL_ADMIN_KEY` | no | Reserved for an owner-only fal balance view; not used by any endpoint yet. |
| `NEXT_PUBLIC_REELTY_URL` | no | Reelty deployment shown in the Reelty tab (build-time; also the CSP `frame-src`). Falls back to the hosted Reelty. |
| `NEXT_PUBLIC_SITE_URL` | no | Public origin for canonical/OG URLs, `robots.txt`, `sitemap.xml` and the OpenRouter `HTTP-Referer`. On Railway `RAILWAY_PUBLIC_DOMAIN` is used automatically; set this once a custom domain is attached. |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT` | no | When set, client events are POSTed there via `sendBeacon` and its origin is added to the CSP `connect-src`. Events never carry prompts, URLs, codes or session ids. Nothing is sent anywhere by default. |

`FAL_QUEUE_BASE`, `FAL_RUN_BASE`, `FAL_REST_BASE`, `FAL_API_BASE` and `OPENROUTER_BASE_URL` exist only to point the gateway at the local mock in tests; leave them unset in production.

`GET /api/health` (public) reports `{ ok, fal, openrouter, gate, storage }`, booleans and modes only, so you can check a deployment's setup without signing in.

## Deploy

The app runs on **Railway** and builds from `main` with the included `Dockerfile` (`railway.json` pins the Dockerfile builder and the `/api/health` healthcheck). Push to `main` and Railway redeploys. The image runs Next's standalone server on Node 22.

1. Set `FAL_KEY`, `OPENROUTER_API_KEY`, `AQUORA_ACCESS_CODES` and `AQUORA_SESSION_SECRET` as service variables (plus any optional ones above).
2. Mount a **volume at `/data`** so workspaces' agents, workflows, design sessions and today's budget ledger survive redeploys. Without it `/api/health` reports `storage: "ephemeral"`.
3. Keep the service at **one replica**: rate limits, in-flight job slots and the job registry are in memory.

Run it with Docker locally (reads an untracked `.env`, keeps data in a named volume):

```bash
docker compose up --build   # → http://localhost:3001
```

## Desktop app

There's an Electron build with optional local inference (sd.cpp bundled, Wan2GP as a remote server):

```bash
npm run electron:dev            # run locally
npm run electron:build          # macOS
npm run electron:build:win      # Windows
npm run electron:build:linux    # Linux (AppImage + .deb)
```

Installers land in `release/`. Cloud models in the desktop app go through an Aquora deployment's gateway (`AQUORA_API_BASE`, defaulting to the hosted site) and its access code, the same as the web app; the desktop app never holds a provider key. The desktop app stays signed in through Electron's own cookie store (the session cookie lives in the main process and is never readable by the page). For the browser build, `npm run vite:dev` sends `/api` to `http://localhost:3000`, or to `AQUORA_API_BASE` when set. Local models live in Electron's app-data folder, or wherever `AQUORA_LOCAL_AI_DIR` points (the legacy `CREATOR_AGENCY_LOCAL_AI_DIR` and `OPEN_GENERATIVE_AI_LOCAL_AI_DIR` are still honored). On Apple Silicon the Metal `sd-cli` binary is downloaded at runtime from the upstream Open Generative AI GitHub release (github.com/Anil-matcha/Open-Generative-AI, tag `v1.0.3-binaries`); other platforms use the stock leejet/stable-diffusion.cpp release.

## Tests

```bash
npm test        # unit + gateway tests (session, limits, catalog transforms, routes against the local fal/OpenRouter mock); no network
npm run lint    # eslint (flat config in eslint.config.mjs)
node scripts/build-gateway-catalog.mjs --check   # fails if lib/gateway/catalog/catalog.json is stale
```

## Project layout

```
app/                            Next.js App Router (en at /, zh at /zh)
app/api/                        Gateway routes: session, /v1 generation + polling, uploads, LLM, agents, workflows
lib/gateway/                    Gateway core: config, sessions, limits + budget, fal + OpenRouter clients, jobs, store
lib/gateway/catalog/            Model catalog (generated) and the studio → fal input transforms
components/                     StandaloneShell (nav, access-code sign-in, budget pill, Reelty tab), landing page
messages/                       Shell copy (en, zh)
packages/studio/                Studio components, model lists, gateway client
packages/Vibe-Workflow/         Workflow builder (vendored)
packages/Open-Poe-AI/           Agents UI (vendored)
packages/Open-AI-Design-Agent/  Design agent UI (vendored)
scripts/                        build-gateway-catalog.mjs, mock-upstream.mjs
electron/                       Desktop shell + local inference
```

## Credits

Aquora (formerly Creator Agency) is built on [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT) by Anil Chandra Naidu Matcha and contributors. Media generation runs on [fal.ai](https://fal.ai); text and agents run on [OpenRouter](https://openrouter.ai). Full third-party notices: [NOTICE.md](NOTICE.md).

## License

MIT — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
