# Open-AI-Design-Agent (vendored in Aquora)

`packages/design-agent/` is the React UI for Aquora's Design Agent studio: the creative canvas. The Aquora app
imports its built `dist/` output; rebuild it with `npm run build:design` from the repo root
(`npm run build` does this automatically in `prebuild`).

The package talks only to Aquora's own same-origin API. Its server side lives in
the Aquora app (`lib/gateway/design/`), which runs media generation on fal.ai and text on
OpenRouter with the site owner's keys. The upstream project's standalone demo
client and server are not included.

Upstream: https://github.com/Anil-matcha/Open-AI-Design-Agent (MIT, see [LICENSE](LICENSE) and the repo's `NOTICE.md`).
