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

npx playwright test --reporter=json > test-results/results.json 2>test-results/stderr.txt
echo "EXIT:$?" > test-results/exit-code.txt
