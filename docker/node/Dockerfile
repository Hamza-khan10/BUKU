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
# Base images are pinned by digest (reproducible; a cached old base can't slip in) and
# updated by Dependabot's weekly PRs, which CI's vulnerability scan checks (D-082).
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS build
ARG SERVICE
RUN test -n "$SERVICE" || (echo "Build arg SERVICE is required, e.g. --build-arg SERVICE=auth" && exit 1)
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
RUN npm install -g pnpm@12.8.1 --no-fund --no-audit
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsup.config.ts ./
COPY packages ./packages
COPY services ./services
# The web app's manifest only, so the lockfile matches the workspace; its
# dependencies (Next.js, React…) are not installed into service images.
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '!@buku/web' --store-dir /pnpm/store
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

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a AS runtime
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
