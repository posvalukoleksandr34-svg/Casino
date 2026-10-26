# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# Aurovane — multi-stage image.
#   runner : the web app (Next.js standalone server), non-root, ~small
#   tools  : migrations, seed, reconciliation and simulation CLIs
# Build:   docker build --target runner -t aurovane:latest .
# Behind a TLS-intercepting proxy, pass its CA as a build secret:
#   docker build --secret id=extra_ca,src=/path/to/ca.crt ...
# -----------------------------------------------------------------------------
ARG NODE_IMAGE=node:22-bookworm-slim

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

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
