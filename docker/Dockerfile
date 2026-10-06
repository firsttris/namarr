# syntax=docker/dockerfile:1.7
# Build stage: install with Bun and bundle the server, client assets and all dependencies.
FROM docker.io/oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run --cwd apps/server build

# ffprobe for container metadata, as a static binary (multi-arch, no apt, no shared libs).
FROM docker.io/mwader/static-ffmpeg:7.1 AS ffmpeg

# Runtime: the slim Bun image plus the bundle. No node_modules: everything is in dist/.
FROM docker.io/oven/bun:1.4-slim AS runtime
WORKDIR /app
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY --from=build /app/apps/server/dist ./dist

# Bound to all interfaces inside the container, so NAMARR_TOKEN is mandatory (checked at start).
# PUID/PGID: the server starts as root, hands /config over and drops to that user.
ENV NODE_ENV=production \
    NAMARR_HOST=0.0.0.0 \
    NAMARR_PORT=8420 \
    NAMARR_CONFIG_DIR=/config \
    PUID=1000 \
    PGID=1000

EXPOSE 8420
VOLUME ["/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.NAMARR_PORT||8420)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

STOPSIGNAL SIGTERM
CMD ["bun", "run", "/app/dist/entry.js"]
