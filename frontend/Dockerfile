# ── IMS Platform Frontend — Next.js ───────────────────────────────────────────
# Multi-stage build:
#   deps    — install node_modules (cached layer)
#   builder — run `next build`, output standalone bundle
#   runner  — minimal image with only the built output, no source or devDeps
#
# Requires next.config.ts to have: output: 'standalone'

# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined at build time by the Next.js compiler.
# The value here becomes the API base URL baked into the JS bundle.
# Override with --build-arg if you need a different URL.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ── Stage 3: minimal runtime image ────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only what the standalone server needs
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

USER appuser

EXPOSE 3000

# next start (standalone mode) — no next CLI needed in the image
CMD ["node", "server.js"]
