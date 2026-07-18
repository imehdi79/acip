# Build from the repo root: docker build -f apps/editor-server/Dockerfile .
# (the monorepo is the build context — bun needs every workspace package.json)

# ── build: bun installs the workspace, prisma generates, nx bundles ──
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/editor-server && bun x prisma generate
RUN bun x nx build editor-server --skip-nx-cache

# ── runtime: node + the workspace node_modules (the server bundle keeps
# dependencies external — Prisma's native engine breaks when bundled) ──
FROM node:22-slim
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/editor-server ./apps/editor-server
EXPOSE 3000
# migrations apply on every start — idempotent, so restarts are safe
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema apps/editor-server/prisma/schema.prisma && node apps/editor-server/dist/main.js"]
