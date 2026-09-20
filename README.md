<p align="center">
  <img src="public/banner.svg" alt="Creator Agency — AI studio for creators" width="100%">
</p>

# Creator Agency

An AI studio for creators: images, video, audio, lip-sync, avatars, agents, workflows — plus **Reelty**, the AI real-estate marketing studio, built in as a tab.

Bring your own [MuAPI](https://muapi.ai) key, open the app, start making. Self-host it, hack on it, ship it.

## What's inside

| Studio | What it does |
|---|---|
| **Image** | Text-to-image and image-to-image across 100+ models (Flux, Nano Banana, Seedream, Midjourney, GPT Image…), with multi-image reference input. |
| **Layers** | Layer-based editing: AI enhance, relight, 3D angle, text edits. |
| **Video** | Text-to-video and image-to-video (Kling, Sora, Veo, Wan, Seedance, Hailuo, Runway…). |
| **Audio** | Music and audio generation from a prompt. |
| **AI Clipping** | Pull highlights out of long video automatically. |
| **Motion Control** | Drive a character image with reference-video motion. |
| **Vibe Motion** | Motion graphics from text: kinetic type, charts, logo reveals. |
| **Lip Sync** | Portrait + audio → talking video, or video + audio → lip-synced video. |
| **Body Swap** | Recast the subject in any video with a target character image. |
| **Cinema** | Camera, lens, focal length and aperture controls turned into prompt modifiers. |
| **Marketing** | Product shots in, AI video ads out. |
| **Workflows** | Node-based builder for multi-step pipelines, with templates and a playground. |
| **Agents** | A conversational agent that plans and runs generation tasks. |
| **Design Agent** | Canvas-based autonomous design agent. |
| **Apps** | Ready-to-deploy app templates on the same model catalog. |
| **AI Influencer** | Consistent AI persona content. |
| **MCP & CLI** | Use everything from your terminal, IDE or any MCP-compatible assistant. |
| **Reelty** | AI real-estate marketing studio, embedded as a tab. |

The UI ships in English (`/`) and Simplified Chinese (`/zh`).

## Quick start

Needs Node.js 18+.

```bash
git clone --recurse-submodules https://github.com/hemantsatishjadhav06-ai/open-generative-ai.git
cd open-generative-ai

npm run setup   # installs deps + builds the workspace packages (required once)
npm run dev     # → http://localhost:3000
```

Already cloned without submodules? Run `git submodule update --init --recursive` once, then `npm run setup`.

Production build: `npm run build && npm run start`.

## Configuration

- **MuAPI key (required)** — the app asks for it on first launch. Grab one at [muapi.ai/access-keys](https://muapi.ai/access-keys) and paste the key value (not its name). It's stored in your browser's `localStorage` and only ever sent to MuAPI.
- **`NEXT_PUBLIC_REELTY_URL` (optional)** — URL of the Reelty deployment shown in the Reelty tab. Falls back to the hosted Reelty instance when unset.

## Deploy

The app runs on **Railway** and builds from `main` with the included `Dockerfile` — push to `main` and Railway redeploys. Set `NEXT_PUBLIC_REELTY_URL` in the service variables if you run your own Reelty.

Run it with Docker locally:

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

Installers land in `release/`. Local models live in Electron's app-data folder, or wherever `OPEN_GENERATIVE_AI_LOCAL_AI_DIR` points.

## Tests

```bash
node --test tests/*.test.js   # unit tests (local inference helpers)
npm run lint                  # eslint via next lint
```

## Project layout

```
app/                            Next.js App Router (en at /, zh at /zh)
components/                     StandaloneShell (nav, BYOK key modal, Reelty tab)
messages/                       Shell copy (en, zh)
packages/studio/                Studio components, model catalog, MuAPI client
packages/Vibe-Workflow/         Workflow engine (submodule)
packages/Open-Poe-AI/           Agents (submodule)
packages/Open-AI-Design-Agent/  Design agent (submodule)
electron/                       Desktop shell + local inference
```

## Credits

Creator Agency is built on [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT) by Anil Chandra Naidu Matcha and contributors; media generation runs on [MuAPI](https://muapi.ai).

## License

MIT
