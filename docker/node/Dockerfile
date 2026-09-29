# ═══════════════════════════════════════════════════════════════════════════
# PRODUCTION image for any BUKU service.
#
#   docker build -f docker/node/Dockerfile --build-arg SERVICE=auth -t buku/auth:<git-tag> .
#
# Stage 1 (build): install the whole workspace, generate the Prisma client,
#   bundle the service + @buku/* packages into dist/, then `pnpm deploy`
#   copies ONLY that service's production dependencies into /out.
# Stage 2 (runtime): Google distroless Node 24 — no shell, no package
#   manager, no OS utilities for an attacker to use; runs as uid 65532.
#   Application files are owned by root and read-only to the process.
#   Run with a read-only root filesystem (K8s securityContext, Phase 5).
# ═══════════════════════════════════════════════════════════════════════════
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-trixie-slim AS build
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Build arg SERVICE is required, e.g. --build-arg SERVICE=auth" && exit 1)
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
RUN npm install -g pnpm@12.8.1 --no-fund --no-audit
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsup.config.ts ./
COPY packages ./packages
COPY services ./services
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
RUN pnpm --filter @buku/database generate \
 && pnpm --filter "@buku/${SERVICE}-service" build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "@buku/${SERVICE}-service" deploy --prod --legacy --config.node-linker=hoisted \
      --store-dir /pnpm/store /out \
 && cp -r "services/${SERVICE}/dist" /out/dist \
 # @buku/* packages are already bundled into dist/; their sources are not needed.
 && rm -rf /out/node_modules/@buku \
 # Prisma ships a WASM query compiler per database; BUKU only uses PostgreSQL.
 && find /out/node_modules/@prisma/client/runtime -name 'query_compiler*_bg.*' ! -name '*postgresql*' -delete

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
ARG SERVICE
LABEL org.opencontainers.image.title="buku-${SERVICE}-service" \
      org.opencontainers.image.source="https://github.com/Hamza-khan10/BUKU"
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
# Root-owned, world-readable: the service process (uid 65532) cannot modify its own code.
COPY --from=build /out /app
USER nonroot
CMD ["dist/index.js"]
