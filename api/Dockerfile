# ── IMS Platform API ──────────────────────────────────────────────────────────
# Single-stage — no transpilation needed for plain Node/Express.
# Non-root user so the process can't write outside /app at runtime.

FROM node:20-alpine

# Create a non-root user/group before touching any files
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install production deps only — this layer is cached as long as
# package*.json doesn't change, so rebuilds after code-only edits are fast.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Safety net: strip any local secrets that slipped past .dockerignore
RUN rm -f .env .env.* *.pem

# Create uploads dir and hand full ownership to appuser before switching users.
# Must happen before USER so we can chown.
RUN mkdir -p uploads/products \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

# Healthcheck — polls the /api/health endpoint which itself queries Postgres.
# start-period gives the app time to connect to DB before Docker starts
# counting failures. This is what compose `condition: service_healthy` watches.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "app.js"]
