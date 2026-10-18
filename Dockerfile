# Candidate container for a future hosted deployment. Production mode requires
# an operator-configured PostgreSQL database and HTTPS public origin.
FROM node:22.23.2-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.23.2-bookworm-slim AS runtime

ENV NODE_ENV=production \
    TABLETOP_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    TABLETOP_DATA_DIR=/var/lib/tabletop

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node \
  /app/server/app.ts \
  /app/server/artifacts.ts \
  /app/server/authority.ts \
  /app/server/bootstrap.ts \
  /app/server/codec.ts \
  /app/server/database.ts \
  /app/server/errors.ts \
  /app/server/exports.ts \
  /app/server/features.ts \
  /app/server/http.ts \
  /app/server/limits.ts \
  /app/server/migrate.ts \
  /app/server/migrations.ts \
  /app/server/pdf-worker.mjs \
  /app/server/repository.ts \
  /app/server/schema.sql \
  /app/server/start.ts \
  /app/server/storage.ts \
  /app/server/
COPY --from=build --chown=node:node \
  /app/src/tabletop/domain/encounter.ts \
  /app/src/tabletop/domain/evolution.ts \
  /app/src/tabletop/domain/helpers.ts \
  /app/src/tabletop/domain/index.ts \
  /app/src/tabletop/domain/invoice.ts \
  /app/src/tabletop/domain/physics.ts \
  /app/src/tabletop/domain/projections.ts \
  /app/src/tabletop/domain/teaching.ts \
  /app/src/tabletop/domain/
COPY --from=build --chown=node:node /app/src/tabletop/shared/contracts.ts ./src/tabletop/shared/
RUN mkdir -p /var/lib/tabletop && chown node:node /var/lib/tabletop

USER node
EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "server/bootstrap.ts"]
