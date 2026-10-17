#!/usr/bin/env bash
# Lint gate. Prints nothing on success; on failure prints only file:line and the error.
#   Python: ruff (bug-class rules only, see [tool.ruff.lint] in pyproject.toml) and a
#           byte-compile with the production Python, 3.12 (Dockerfile).
#   JavaScript: a syntax check of every browser module and test script.
#   All tracked files: whitespace errors and leftover conflict markers.
# Needs only uv, node and git: uv fetches ruff and Python 3.12 on first use.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

status=0
uvx --quiet ruff@0.17.1 check --quiet . || status=1
uv run --quiet --no-project --python 3.12 python -m compileall -q app scripts tests || status=1
for file in web/*.js tests/*.cjs; do
  node --check "$file" || status=1
done
git diff --check "$(git hash-object -t tree /dev/null)" || status=1
exit "$status"
