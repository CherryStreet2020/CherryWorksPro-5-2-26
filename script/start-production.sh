#!/usr/bin/env bash
set -e

echo "[start-production] Phase 1: Running production migrations..."
npx tsx server/migrate-production.ts

echo "[start-production] Phase 2: Running drizzle-kit push..."
npx drizzle-kit push --force

echo "[start-production] Phase 3: Starting server..."
NODE_ENV=production exec node dist/index.cjs
