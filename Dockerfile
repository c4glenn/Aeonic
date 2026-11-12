# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/client/package.json packages/client/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @aeonic/web build

FROM node:20-bookworm-slim
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/aeonic.db WEB_DIR=/app/apps/web/dist
COPY --from=build /app /app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@aeonic/api", "start"]
