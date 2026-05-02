#!/bin/bash
cd /home/runner/workspace
mkdir -p test-results
npx playwright test --reporter=line 2>&1 > test-results/output.txt
echo "EXIT_CODE=$?" >> test-results/output.txt
