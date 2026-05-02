#!/usr/bin/env bash
set -euo pipefail
export MARKETING_OS_ENABLED=true
export VITE_MARKETING_OS_ENABLED=true
echo "===== STARTING DEV SERVER (background) ====="
npm run dev &
DEV_PID=$!
echo "DEV_PID=$DEV_PID"
trap "kill $DEV_PID 2>/dev/null || true" EXIT
echo "===== WAITING FOR :5000 ====="
for i in $(seq 1 60); do
  if curl -sf http://localhost:5000/ >/dev/null 2>&1 || curl -sf http://localhost:5000/api/health >/dev/null 2>&1; then
    echo "Server up after ${i}s"
    break
  fi
  sleep 1
done
echo "===== PLAYWRIGHT SMOKE ====="
npx playwright test e2e/marketing-contacts-smoke.spec.ts --reporter=line
PW_EXIT=$?
echo "PLAYWRIGHT_EXIT=$PW_EXIT"
exit $PW_EXIT
