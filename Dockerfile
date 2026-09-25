FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies exactly as locked
FROM base AS deps
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
COPY packages/Vibe-Workflow/packages/workflow-builder/package*.json ./packages/Vibe-Workflow/packages/workflow-builder/
COPY packages/Open-Poe-AI/packages/agents/package*.json ./packages/Open-Poe-AI/packages/agents/
COPY packages/Open-AI-Design-Agent/packages/design-agent/package*.json ./packages/Open-AI-Design-Agent/packages/design-agent/
COPY packages/studio/package*.json ./packages/studio/
RUN npm ci

# Build (the root "prebuild" script builds the workspace packages first)
FROM deps AS builder
COPY . .
# Build-time only: NEXT_PUBLIC_* values are inlined into the bundle and the
# middleware CSP. An unset ARG is '' and the hosted Reelty URL is used.
# Never declare FAL_KEY, OPENROUTER_API_KEY, AQUORA_ACCESS_CODES or
# AQUORA_SESSION_SECRET as ARG/ENV here: build args persist in image layers.
# They are runtime service variables, read by the server when it starts.
ARG NEXT_PUBLIC_REELTY_URL
ENV NEXT_PUBLIC_REELTY_URL=$NEXT_PUBLIC_REELTY_URL
RUN npm run build

# Production runner: standalone server only, no devDependencies
FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# The gateway's JSON store (agents, workflows, design sessions, jobs, budget
# ledger) lives in AQUORA_DATA_DIR, default /data when writable. On Railway,
# mount a volume at /data so it survives redeploys; without one the app falls
# back to ./.aquora-data inside the container and /api/health reports
# storage: "ephemeral".
EXPOSE 3000
CMD ["node", "server.js"]
