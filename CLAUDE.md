# Our Calendar

@AGENTS.md

## Canonical commands

Run these from the repo root. Each is quiet on success and on failure prints only what
failed, so run a gate once and act on its output.

- `scripts/lint.sh` - ruff (bug-class rules only, `[tool.ruff.lint]` in `pyproject.toml`), a
  Python 3.12 byte-compile, a syntax check of every `web/*.js` and `tests/*.cjs`, and
  whitespace errors in tracked files.
- `scripts/test.sh` - the Python suite (pytest) and the JavaScript suite (node:test). While
  debugging, run one suite: `scripts/test.sh python <pytest args>` or
  `scripts/test.sh js <test files>`, then the full command once.
- `scripts/test-e2e.sh` - the mobile browser scenarios (Playwright Chromium, synthetic data
  only). It needs Chromium's system libraries, which the factory workspace does not have, so
  there CI runs it on the PR.

The scripts install what they need through uv (Python 3.12 and `requirements-dev.txt`), so a
fresh checkout needs no setup. CI (`.github/workflows/test.yml`) runs all three on every PR,
and the factory loop runs lint and test when a builder finishes (`.claude/factory-loop.json`).
