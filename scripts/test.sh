#!/usr/bin/env bash
# Test gate: the Python suite (pytest, tests/test_*.py) and the JavaScript unit suite
# (node:test, tests/*.test.cjs). Python runs in a throwaway environment built from
# requirements-dev.txt with the production Python, 3.12 (Dockerfile), so nothing needs
# installing first. Prints one summary line on success; on failure prints only the failing
# suite's output.
#
# While debugging, run one suite with its own arguments, unbuffered:
#   scripts/test.sh python [pytest args]   e.g. scripts/test.sh python tests/test_calendar.py -k recurrence
#   scripts/test.sh js [test files]        e.g. scripts/test.sh js tests/recurrence.test.cjs
# The browser scenarios are a separate gate: scripts/test-e2e.sh.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

python_suite() {
  uv run --quiet --no-project --python 3.12 --with-requirements requirements-dev.txt \
    python -m pytest "$@"
}
js_suite() {
  if [ "$#" -eq 0 ]; then set -- 'tests/*.test.cjs'; fi
  node --test --test-reporter=dot "$@"
}

case "${1:-}" in
  python) shift; python_suite "$@"; exit ;;
  js) shift; js_suite "$@"; exit ;;
  '') ;;
  *) echo "usage: scripts/test.sh [python [pytest args] | js [test files]]" >&2; exit 2 ;;
esac

status=0
if python_out=$(python_suite 2>&1); then
  python_summary=$(printf '%s\n' "$python_out" | tail -n 1)
else
  printf 'FAIL python suite (pytest)\n%s\n' "$python_out"
  status=1
fi
if ! js_out=$(js_suite 2>&1); then
  printf 'FAIL js suite (node:test)\n%s\n' "$js_out"
  status=1
fi
if [ "$status" -eq 0 ]; then
  echo "python: $python_summary; js: passed"
fi
exit "$status"
