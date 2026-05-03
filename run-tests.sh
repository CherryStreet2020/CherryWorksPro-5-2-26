#!/bin/bash
cd /home/runner/workspace
mkdir -p test-results playwright-report

echo "[run-tests] Running lint gate..."
npx eslint . --max-warnings 0 > test-results/lint.txt 2>&1
LINT_EXIT=$?
echo "LINT_EXIT:$LINT_EXIT" > test-results/lint-exit-code.txt
if [ "$LINT_EXIT" -ne 0 ]; then
  echo "[run-tests] Lint failed (exit $LINT_EXIT). See test-results/lint.txt"
  cat test-results/lint.txt
  exit "$LINT_EXIT"
fi
echo "[run-tests] Lint OK."

# Task #432: pass through parallelism / sharding env vars so CI nodes
# can split the suite (PW_SHARD=1 PW_TOTAL=2) and tune worker count
# (PW_WORKERS=8) without editing the config. Defaults preserve the
# pre-#432 single-worker serial behaviour for the `serial` project.
export PW_WORKERS="${PW_WORKERS:-4}"
echo "[run-tests] Playwright workers (anonymous project): $PW_WORKERS"
if [ -n "$PW_SHARD" ] && [ -n "$PW_TOTAL" ]; then
  echo "[run-tests] Shard: $PW_SHARD/$PW_TOTAL"
fi

npx playwright test --reporter=json > test-results/results.json 2>test-results/stderr.txt
echo "EXIT:$?" > test-results/exit-code.txt
