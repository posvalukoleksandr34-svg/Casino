# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# Aurovane — multi-stage image.
#   runner : the web app (Next.js standalone server), non-root, ~small
#   tools  : migrations, seed, reconciliation and simulation CLIs
#   backup : scheduled encrypted pg_dump (PostgreSQL 16 client, gpg), non-root
# Build:   docker build --target runner -t aurovane:latest .
# Behind a TLS-intercepting proxy, pass its CA as a build secret:
#   docker build --secret id=extra_ca,src=/path/to/ca.crt ...
# -----------------------------------------------------------------------------
ARG NODE_IMAGE=node:22-bookworm-slim
# Same major version as the database server (scripts/ops/pg-tools.sh refuses a mismatch).
ARG POSTGRES_IMAGE=postgres:16-alpine
# Debian variant for the backup job: it already ships bash and gpg.
ARG BACKUP_BASE_IMAGE=postgres:16-bookworm

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=extra_ca,target=/run/secrets/extra_ca \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM deps AS tools
COPY . .
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "db:migrate"]

FROM ${BACKUP_BASE_IMAGE} AS backup
# curl for the monitoring heartbeat (BACKUP_HEARTBEAT_URL). Pass
# --build-arg BACKUP_APT_PACKAGES= to skip it where no package mirror is
# reachable; the backup still runs and warns that pings are disabled.
ARG BACKUP_APT_PACKAGES="curl ca-certificates"
RUN if [ -n "$BACKUP_APT_PACKAGES" ]; then apt-get update && apt-get install -y --no-install-recommends $BACKUP_APT_PACKAGES && rm -rf /var/lib/apt/lists/*; fi
COPY --chown=postgres:postgres scripts/ops/ /opt/aurovane/ops/
RUN mkdir -p /var/lib/aurovane/backups && chown -R postgres:postgres /var/lib/aurovane
USER postgres
WORKDIR /var/lib/aurovane
ENTRYPOINT []
CMD ["bash", "/opt/aurovane/ops/backup-loop.sh"]

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Application files belong to root and are read-only for the runtime user; the
# Compose service additionally mounts the root filesystem read-only.
COPY --from=build /app/.next/standalone ./
RUN mkdir -p /app/.next/cache /var/lib/aurovane/uploads && chown node:node /app/.next/cache /var/lib/aurovane/uploads && chmod 700 /var/lib/aurovane/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
