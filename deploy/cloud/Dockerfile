# Cloud business backend only. Build context is the monorepo root.
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY . .
# Root postinstall owns desktop tooling; the cloud closure builds explicitly.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @open-design/cloud...
RUN pnpm --filter @open-design/cloud... -r rebuild && \
    pnpm --filter @open-design/cloud... --workspace-concurrency=1 -r --if-present run build
# deploy also invokes installation hooks unless disabled; desktop postinstall is outside this closure.
RUN pnpm --config.ignore-scripts=true --filter @open-design/cloud deploy --legacy --prod /cloud

FROM node:24-bookworm-slim AS renderer
WORKDIR /app
ENV NODE_ENV=production OD_CLOUD_RENDERER_HOST=0.0.0.0 OD_CLOUD_RENDERER_PORT=19001 OD_CLOUD_CHROMIUM_PATH=/usr/bin/chromium OD_CLOUD_FFMPEG_PATH=/usr/bin/ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /cloud/ ./
USER node
CMD ["node", "dist/renderer-server.js"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production OD_CLOUD_HOST=0.0.0.0
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY --from=build --chown=node:node /cloud/ ./
USER node
CMD ["node", "dist/server.js"]
