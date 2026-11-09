# syntax=docker/dockerfile:1.6

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# pnpm@9.15.0 matches lockfileVersion 9.0 and the version pinned in
# .github/workflows/e2e.yml — keep these in sync.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Workspace manifests first for dependency resolution caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile --filter @bimoto/server... --filter @bimoto/shared

# Source.
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

WORKDIR /app/packages/server
RUN pnpm exec prisma generate
RUN pnpm build

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json

WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

EXPOSE 3000

# Apply pending migrations on container start, then launch server.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
