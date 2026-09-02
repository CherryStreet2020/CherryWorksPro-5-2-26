# syntax=docker/dockerfile:1
#
# CherryWorks Pro — Azure Container Apps image.
#
# Two stages. The builder keeps the full dependency tree (vite and friends);
# the runtime installs production dependencies only, which is why `tsx` and
# `drizzle-kit` had to move into `dependencies` — the entrypoint runs both.
#
# node 20.20 is a floor, not a preference: vite 7 requires ^20.19.0, and
# jsdom / isomorphic-dompurify / pdf-parse are RUNTIME dependencies with the
# same floor. Do not copy cherrysite's node:20.18 here.
# bookworm rather than alpine — `pg` and the native deps build cleanly on
# glibc and we avoid musl surprises.

##############################################################################
# builder
##############################################################################
FROM node:20.20-bookworm-slim AS builder
WORKDIR /app

# script/build.ts calls process.exit(1) unless it can replay migrations against
# a throwaway Postgres or is explicitly opted out. There is no database during
# an image build, so opt out here; the migration-replay gate still runs in CI.
ENV SKIP_MIGRATION_REPLAY_CHECK=1

# NODE_ENV is deliberately left unset in this stage — setting it to production
# makes `npm ci` prune devDependencies and the vite build then fails.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* values are inlined into the client bundle at BUILD time; setting them on
# the Container App later does nothing at all.
#
# CORRECTION (2026-09-02): an earlier version of this file left them unset,
# reasoning that `.replit [userenv.production]` lists neither. That reasoning was
# WRONG — they are Replit SECRETS, and secrets reach the deployment build too.
# Both are "true" in production, verified by reading them out of the Secrets pane.
#
# VITE_EMAIL_OAUTH_ENABLED is the load-bearing one: client/src/pages/settings.tsx
# tests `import.meta.env.VITE_EMAIL_OAUTH_ENABLED === "true"`, which is FALSE when
# unset — so an image built without it HIDES the "connect mailbox" UI while the
# server routes work perfectly. The one org on Microsoft 365 could not reconnect
# its mailbox and nothing would error.
ARG VITE_EMAIL_OAUTH_ENABLED=true
ARG VITE_MARKETING_OS_ENABLED=true
ENV VITE_EMAIL_OAUTH_ENABLED=${VITE_EMAIL_OAUTH_ENABLED}
ENV VITE_MARKETING_OS_ENABLED=${VITE_MARKETING_OS_ENABLED}
RUN npm run build

##############################################################################
# runtime
##############################################################################
FROM node:20.20-bookworm-slim AS runtime
WORKDIR /app

# postgresql-client-16: server/backup-drill.ts shells out to pg_dump, and the
#   client major must match the Azure server (16), so this comes from PGDG —
#   bookworm's own repo only carries 15.
# poppler-utils: server/routes/expense-routes.ts shells out to pdftoppm for
#   receipt OCR; without it PDF receipt scanning returns 500.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-16 poppler-utils; \
    apt-get purge -y --auto-remove curl gnupg; \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
# Every one of CWP's ~120 timestamp columns is `timestamp WITHOUT time zone`.
# A container in any zone but UTC would silently shift created_at / issued_date
# / paid_at from the moment of cutover and quietly break aging buckets and
# period boundaries. Pinning it here closes that permanently.
ENV TZ=UTC

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built server bundle and client assets. server/static.ts resolves
# path.resolve(__dirname, "public") — __dirname is /app/dist at runtime, so
# dist/ carries the client build with it.
COPY --from=builder /app/dist ./dist

# Everything below is read at RUNTIME through process.cwd(), enumerated with
# `grep -rn 'process.cwd()\|__dirname' server/ shared/` rather than by hand:
#   migrations/                     server/migrate-production.ts:43
#   server/marketing/chat-knowledge server/marketing/chat-knowledge/index.ts:28
#                                   server/routes/marketing/chat.ts:32
#   client/src/index.css            server/routes/mobile-responsive-routes.ts:31
#   client/index.html               server/routes/mobile-responsive-routes.ts:32
#   drizzle.config.ts + shared/     read by `drizzle-kit push` in the entrypoint
#   public/embed/                   served as a static embed bundle
COPY migrations ./migrations
COPY server/marketing/chat-knowledge ./server/marketing/chat-knowledge
COPY public/embed ./public/embed
COPY client/src/index.css ./client/src/index.css
COPY client/index.html ./client/index.html
COPY drizzle.config.ts tsconfig.json ./
COPY shared ./shared

# server/routes/expense-routes.ts calls createWorker("eng") with no langPath,
# which otherwise downloads a ~5 MB model into the working directory on first
# use — as an unprivileged user, into a root-owned layer. Ship the model.
COPY eng.traineddata ./eng.traineddata

COPY scripts/start_container.sh scripts/db-push-with-lock.mjs ./scripts/
RUN chmod +x ./scripts/start_container.sh

# Declared after the npm layers so a new commit does not bust the dependency
# cache. The ENV promotion is essential: a build ARG is invisible to the
# running process, and without it /api/readyz reports commit=undefined and
# every commit assertion in the deploy gate can never pass.
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

# tmp/imports is created by fs.mkdirSync at MODULE TOP LEVEL during route
# registration (server/routes/import-routes.ts:22) — i.e. at boot. As USER node
# against a root-owned layer that throws an uncaught EACCES, the process exits,
# the startup probe burns its full budget, and the revision never goes Ready
# with no useful error. Create and chown all of them up front.
RUN mkdir -p /app/uploads/logos /app/uploads/avatars /app/uploads/receipts \
             /app/uploads/quarantine /app/uploads/test-scans \
             /app/backups /app/tmp/imports \
 && chown -R node:node /app

USER node
EXPOSE 8080
ENTRYPOINT ["./scripts/start_container.sh"]
