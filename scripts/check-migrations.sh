#!/usr/bin/env bash
# Replays every migrations/*.sql file (excluding rollback-*) against a
# fresh disposable database to catch syntax errors, duplicate-object
# regressions, and other shippable bugs before they reach production
# boot. Each file is executed with psql -v ON_ERROR_STOP=1, so the
# first failure aborts the script with a non-zero exit code.
#
# Required env:
#   MIGRATION_CHECK_DATABASE_URL  Postgres URL pointing at a throwaway
#                                 database that this script may freely
#                                 wipe and recreate. Must NOT point at
#                                 prod or any shared dev database.
#
# Local usage:
#   createdb migrations_check
#   npm install   # drizzle-kit must be available on PATH via npx
#   MIGRATION_CHECK_DATABASE_URL=postgres://localhost/migrations_check \
#     bash scripts/check-migrations.sh
#
# In CI a postgres service container provides the URL — see
# .github/workflows/ci.yml (job: migrations).
set -euo pipefail

if [[ -z "${MIGRATION_CHECK_DATABASE_URL:-}" ]]; then
  echo "[check-migrations] MIGRATION_CHECK_DATABASE_URL is required" >&2
  echo "[check-migrations] Point it at a THROWAWAY database — this script wipes the public schema." >&2
  exit 2
fi

# Guardrail: this script drops the public schema on the target DB. Refuse
# to run against anything that looks like a real environment unless the
# operator explicitly opts in via MIGRATION_CHECK_ALLOW_DESTRUCTIVE=1.
# Heuristics: matches common managed-postgres hostnames and the literal
# strings "prod", "production", "staging", or the active DATABASE_URL.
url="$MIGRATION_CHECK_DATABASE_URL"
url_lower="$(printf '%s' "$url" | tr '[:upper:]' '[:lower:]')"
looks_risky=0
case "$url_lower" in
  *prod*|*production*|*staging*|*neon.tech*|*supabase.co*|*amazonaws.com*|*azure.com*|*render.com*|*railway.app*|*planetscale*|*googleusercontent.com*|*cloudsql*)
    looks_risky=1
    ;;
esac
if [[ -n "${DATABASE_URL:-}" && "$url" == "$DATABASE_URL" ]]; then
  looks_risky=1
fi
if [[ "$looks_risky" -eq 1 && "${MIGRATION_CHECK_ALLOW_DESTRUCTIVE:-}" != "1" ]]; then
  echo "[check-migrations] REFUSING to run: MIGRATION_CHECK_DATABASE_URL looks like a real database." >&2
  echo "[check-migrations] This script DROPS the public schema. If you really mean it, re-run with MIGRATION_CHECK_ALLOW_DESTRUCTIVE=1." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "[check-migrations] psql is not installed or not on PATH" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/migrations"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "[check-migrations] migrations dir not found: $MIGRATIONS_DIR" >&2
  exit 2
fi

echo "[check-migrations] Resetting public schema on disposable database…"
psql "$MIGRATION_CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

# Mirror production boot: the SQL replay phase runs against a database
# that already has the Drizzle-managed base schema (production keeps
# running `drizzle-kit push --force` on every boot — see package.json
# `db:migrate:prod`). Push the schema here so migrations that reference
# tables like `users` / `orgs` can resolve them, just like in prod.
echo "[check-migrations] Pushing Drizzle base schema…"
DATABASE_URL="$MIGRATION_CHECK_DATABASE_URL" \
  npx --no-install drizzle-kit push --force >/dev/null

shopt -s nullglob
mapfile -t SQL_FILES < <(printf '%s\n' "$MIGRATIONS_DIR"/*.sql | LC_ALL=C sort)

# Task #233 — guard against two non-rollback migrations sharing the same
# leading prefix token (the part before the first dash; e.g. `0008` and
# `0008b` are treated as distinct). Lexicographic ordering
# inside server/migrate-production.ts means two files with the same
# prefix produce a deterministic-but-fragile order: any future migration
# that depends on a specific 0008 running first would silently break
# depending on filename. Fail loudly instead.
declare -A SEEN_PREFIXES=()
DUP_PREFIX=""
for full in "${SQL_FILES[@]}"; do
  name="$(basename "$full")"
  if [[ "$name" == rollback-* ]]; then
    continue
  fi
  prefix="${name%%-*}"
  if [[ -n "${SEEN_PREFIXES[$prefix]:-}" ]]; then
    DUP_PREFIX="$prefix"
    echo "[check-migrations] FAILED: migrations/${SEEN_PREFIXES[$prefix]} and migrations/${name} share prefix '${prefix}'." >&2
    echo "[check-migrations] Renumber one of them (e.g. ${prefix}b-...) so the boot replay order is unambiguous." >&2
  fi
  SEEN_PREFIXES[$prefix]="$name"
done
if [[ -n "$DUP_PREFIX" ]]; then
  exit 1
fi

REPLAYED=0
SKIPPED=0
FAILED=""

for full in "${SQL_FILES[@]}"; do
  name="$(basename "$full")"
  if [[ "$name" == rollback-* ]]; then
    echo "[check-migrations] skip (rollback, manual-only): $name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  echo "[check-migrations] replay: $name"
  if ! psql "$MIGRATION_CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$full"; then
    FAILED="$name"
    break
  fi
  REPLAYED=$((REPLAYED + 1))
done

if [[ -n "$FAILED" ]]; then
  echo "[check-migrations] FAILED on migrations/$FAILED" >&2
  echo "[check-migrations] Replayed $REPLAYED file(s) successfully before the failure (skipped $SKIPPED rollback file(s))." >&2
  exit 1
fi

echo "[check-migrations] OK — replayed $REPLAYED migration(s), skipped $SKIPPED rollback file(s)."
