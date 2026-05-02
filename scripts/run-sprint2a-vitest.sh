#!/usr/bin/env bash
set -euo pipefail
npx vitest run server/marketing-contacts.test.ts --reporter=dot
