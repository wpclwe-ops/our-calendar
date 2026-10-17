#!/usr/bin/env bash
# E2E gate: every browser scenario (tests/browser-*.cjs) in mobile Chromium through
# Playwright, each against its own demo server on ports 8000-8004 with a throwaway database
# (synthetic data only, never production). Prints one summary line on success; on failure
# prints only the failing scenario's output.
#
# Installs what it needs: the npm packages (npm ci) when Playwright is missing, then
# Playwright's Chromium. A fresh container also needs Chromium's system libraries, once:
#   npx playwright install-deps chromium
# Screenshots: set CALENDAR_SCREENSHOT_DIR=<dir> and each scenario saves its key screens there.
# One scenario while debugging: scripts/test-e2e.sh tests/browser-calendar-design.cjs
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

if [ ! -d node_modules/playwright ]; then
  npm ci --silent --no-audit --no-fund || exit 1
fi
npx --no-install playwright install chromium >/dev/null || exit 1

if [ "$#" -eq 0 ]; then set -- tests/browser-*.cjs; fi
status=0
for scenario in "$@"; do
  if ! out=$(uv run --quiet --no-project --python 3.12 --with-requirements requirements.txt \
      node "$scenario" 2>&1); then
    printf 'FAIL %s\n%s\n' "$scenario" "$out"
    status=1
  fi
done
if [ "$status" -eq 0 ]; then
  echo "e2e: $# browser scenarios passed"
fi
exit "$status"
