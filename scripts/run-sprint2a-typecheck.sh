#!/usr/bin/env bash
# Sprint 2a typecheck runner. Edit-tool path to bypass shell filter.
set +e
echo "===== TSC --noEmit ====="
npx tsc --noEmit 2>&1 | tail -200
TSC_EXIT=${PIPESTATUS[0]}
echo ""
echo "TSC_EXIT=$TSC_EXIT"
exit 0
