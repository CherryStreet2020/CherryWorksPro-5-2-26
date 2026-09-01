#!/usr/bin/env bash
#
# Container entrypoint. Applies the schema, then execs the server.
#
# The marker file at /tmp/db-push-ok is what /api/readyz checks: without it a
# half-applied schema from a mid-push network blip would still answer Healthy
# and green every gate assertion in the deploy pipeline.
set -euo pipefail

MARKER=/tmp/db-push-ok
rm -f "$MARKER"

if [ "${SKIP_DB_PUSH:-0}" = "1" ]; then
  # The rollback path depends on this: booting an OLDER image against a NEWER
  # schema must NOT run `drizzle-kit push --force`, because push converges by
  # DROPPING — it would delete the columns the newer schema added.
  echo "[entrypoint] SKIP_DB_PUSH=1 — skipping schema push entirely."
  : > "$MARKER"
else
  echo "[entrypoint] applying schema (drizzle-kit push --force, advisory-locked)…"
  # Backgrounded and waited on rather than run in the foreground: bash will not
  # run a trap until the current FOREGROUND command returns, so a foreground
  # push would swallow a SIGTERM arriving mid-migration.
  node scripts/db-push-with-lock.mjs &
  push_pid=$!
  push_rc=0
  wait "$push_pid" || push_rc=$?

  if [ "$push_rc" -ne 0 ]; then
    echo "[entrypoint] schema push FAILED (exit $push_rc) — refusing to start." >&2
    exit "$push_rc"
  fi
  : > "$MARKER"
  echo "[entrypoint] schema push OK."
fi

echo "[entrypoint] starting server (commit ${GIT_COMMIT_SHA:-unknown}, port ${PORT:-8080}, TZ ${TZ:-unset})"
exec node dist/index.cjs
