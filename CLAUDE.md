<!-- synced: do not edit (managed by dev-system) -->
# global agent instructions

- Never use the em dash. Use plain dash "-" instead
- When writing commit messages, NEVER auto-add your agent name as co-author
- Never manually modify CHANGELOG.md files or any files that are marked as auto-generated
- If an issue is research-only, do not close it when its PR merges - leave the issue open
  after the PR is merged so follow-up work can continue.
- Keep a spike's raw notes, probe code and evidence in the repo under `docs/spikes/<topic>/`, never only on a
  branch, in `/persist` or in a session's memory. Carry its conclusions into the lasting docs (specs, decision
  records, READMEs) and link back to the spike folder.
- Every PR MUST link to the issue it addresses using a GitHub keyword in the PR body, so the two stay
  connected for tracking. Use a closing keyword - `Closes #N` (or `Fixes #N` / `Resolves #N`) - when the
  issue should auto-close on merge; use a non-closing keyword instead - `Refs #N` or `Part of #N` - when
  the issue must stay open (research-only, under review, or one part of a multi-part issue). On the
  factory loop the loop writes this link itself, and a loop agent never writes a closing keyword anywhere.
- Before merging, verify the linkage matches intent with `gh pr view <pr> --json closingIssuesReferences`:
  the issue number must appear for a closing PR and be absent for a keep-open PR. Re-check after any
  pipeline rewrite of the PR body - rewrites can silently drop the keyword, and a stray `Closes #N` pasted
  inside description text can wrongly auto-close the wrong issue. On the factory loop, the loop's merge
  queue runs this check.
- When making technical decisions, do not give much weight to development cost.
  Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user would experience it as possible.
  This makes sure you find the real problem so your fix will actually solve it.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection.
  If something clearly looks off, even if it is not directly related to what you are doing, try to get it fixed along the way
  (a factory loop agent names it in its answer instead, since its change holds only what the brief asks).
- For any PR that changes UI, capture a screenshot (and a short video/GIF for animated/interactive changes)
  using this repo's e2e visual verification tooling (`CALENDAR_SCREENSHOT_DIR=<dir> scripts/test-e2e.sh`, see "UI
  screenshots" below), and attach it to the PR description before the PR is considered ready.
- Keep PR descriptions brief and concise. They are reviewed by a head of engineering, not an engineer,
  so they must be high quality and ready to go without low-level technical detail. Always attach pictures
  (screenshots, and a short video/GIF for animated/interactive changes) when the change is visual.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness.
  If you see one, even if it is not caused by what you are working on right now, still get it fixed.
  A factory loop agent fixes it only when it blocks the gates, and otherwise names it in its answer's summary.
- Questions about factory latency, throughput or pipeline cost are answered from factory data via the
  callum-flow `query-factory-data` skill, not from guesses.
- When writing to the owner (chat replies, status updates, orchestrator reports, handoffs), lead with what
  needs to happen next and who has to do it. Name each piece of work by what it does, with the issue number at
  most a parenthetical and never the subject of a sentence. Make each issue or PR reference a markdown link to it,
  never a bare `#N`. Prefer short prose; use a table only when it is
  clearly the clearest form, and never stack several. Say plainly what is blocked, what it waits on, and
  whether the owner is the one who must act.
- When creating an epic issue that will be composed of several issues that make up a completed feature, ensure you use the
  proper sub-issue approach in GitHub so that issues appear linked correctly in the UI and the owner can see progress of the epic.

## Dev container is ephemeral

This repo is worked on inside a development container. You are free to install any
tools, system packages, browsers, language runtimes, etc. that you need to get
things working - go ahead and install them in the running container.

But anything you install by hand is lost when the container is rebuilt. It does not
survive a rebuild. So installing a tool is only ever a temporary fix.

Whenever you settle on the right tools/steps to set up a dependency (i.e. you have
confirmed the exact packages/commands that make something work), raise a GitHub
issue labelled `bug` so the dev container build process (`.devcontainer/`) can be
updated to include it permanently. Record in the issue: what breaks without the
dependency, the exact confirmed install commands, and how to bake it into
`.devcontainer/` (feature, `postCreateCommand`, etc.).

- Do NOT edit `.devcontainer/` in the same change that you are doing your feature
  work. Container build changes are applied out of cycle, deliberately, so they do
  not interrupt the container that is currently in use.
- On the factory loop, a loop agent installs nothing and raises no issue. It names the missing
  tool, what breaks without it and the install commands it would use in its answer, and carries
  on with what it can.

## Two ways work gets done

Work in this repo takes one of two paths. A rule that names a path applies only on it.

- **The factory loop.** You are a loop agent when the factory loop started you (your prompt's
  first line is `factory-slot: <path>`) or a loop agent started you. The loop prepared your slot,
  a worktree on the issue's branch, and does the rest: when a builder or fixer ends its turn it
  runs the repo's gate commands in the slot and hands back any failure; it opens the PR and writes
  its title, body, issue link and evidence from your answer; it runs review, waits on CI and
  merges through its own queue. Follow your agent definition and your prompt. Work only in your
  slot and push only the issue's branch to `origin`. Never lease, return or create a worktree,
  never run no-mistakes, and never follow the `implement-issue` or `issue-orchestrator` skills or
  a section of this file marked as the manual path. Never write to GitHub: where a rule here says
  to link, describe, attach to, label, merge or raise an issue or a PR, put what it needs in your
  answer and the loop does it.
- **The manual path**, for a person or an interactive session. Code changes go in a worktree
  (the mechanism is in "Implementation sub-agents" below). A sub-agent delegated an issue follows
  the `implement-issue` skill (worktree, build, verify, evidence, /no-mistakes pipeline, handoff),
  and an interactive orchestrator follows the `issue-orchestrator` skill.
<!-- end synced -->

<!-- repo-owned: edit freely - fill in the sections below for this repo -->
## Project rules

The product and security rules for this repo live in `AGENTS.md`, shared with Codex. They
apply to every change:

@AGENTS.md

The product docs (`README.md`, `docs/`) are written in Russian; keep them in Russian.
`.no-mistakes.yaml` (`document:`) says which doc owns what.

## Canonical commands

Run these from the repo root. Do not re-derive per-directory commands or run
test suites file-by-file - use a single entrypoint per gate so nothing is ever skipped,
and adding a new test file should require no extra wiring. Each command is quiet on
success and on failure prints only the failing tests or `file:line` errors: run it once
and act on that output. Do not re-run a gate to grep or filter its output, or after it
has passed. The single-entrypoint rule is for the gate: below, also name how to run one
suite while debugging (ideally the gate entrypoint with a filter), then run the gate once at the end.

- `scripts/lint.sh` - lint. ruff with the bug-class rules in `pyproject.toml` (syntax
  errors, undefined names), a byte-compile of `app/`, `scripts/` and `tests/` with Python
  3.12, `node --check` on every `web/*.js` and `tests/*.cjs`, and whitespace or
  conflict-marker errors in tracked files. Prints nothing when clean.
- `scripts/test.sh` - tests. The Python suite (pytest, `tests/test_*.py`) and the
  JavaScript unit suite (node:test, `tests/*.test.cjs`); one summary line when green,
  about 25 seconds. Any Python warning fails it: silence a known one only in
  `pyproject.toml` `filterwarnings`, with the reason.
- `scripts/test-e2e.sh` - e2e. Every browser scenario (`tests/browser-*.cjs`) in mobile
  Chromium, each against its own demo server on a throwaway database (ports 8000-8004).
  It is not a pipeline gate, and takes about a minute. Run it before handoff for any
  change under `web/` or to an API the Mini App calls. It runs `npm ci` and downloads
  Playwright's Chromium itself when they are missing. The dev image does not ship
  Chromium's system libraries yet, so a fresh container needs
  `npx playwright install-deps chromium` (sudo) once before the first run.

None of them needs an install step first: the scripts get ruff, Python 3.12 (the
production version, `Dockerfile`) and `requirements-dev.txt` through uv on first use.

While debugging, run one suite with its own arguments, then run the gate once at the end:
`scripts/test.sh python tests/test_calendar.py -k trash` (any pytest arguments),
`scripts/test.sh js tests/recurrence.test.cjs`, or
`scripts/test-e2e.sh tests/browser-calendar-design.cjs`.

CI (`.github/workflows/ci.yml`) runs the same commands: its `lint-test` job runs
`scripts/lint.sh` and `scripts/test.sh`, exactly as `.no-mistakes.yaml` does, and its `e2e`
job runs `scripts/test-e2e.sh`. A new test file is picked up by its suite's glob. A new
category of tests extends one of these scripts, never a bespoke CI step.

## UI screenshots

Set `CALENDAR_SCREENSHOT_DIR=<dir>` when running `scripts/test-e2e.sh` and each scenario
saves its key screens there (day, week and month views, settings, reminders; light and dark
themes) at a 375-390 px mobile viewport. For a screen no scenario reaches yet, extend the
closest scenario with the steps and a `screenshot()` call, so the new behaviour is also
tested. Synthetic data only: never screenshot production or real accounts.

## Running the app

Run it by hand in demo mode only, on throwaway paths and a port outside the e2e range.
Never use a real `.env`, real Telegram credentials or the production URL, and never run
`scripts/setup_bot.py`, `scripts/provider_pilot.py` or the backup scripts against production.

```bash
d=$(mktemp -d)
export DEMO_MODE=true HOST=127.0.0.1 PORT=8010 DATABASE_PATH=$d/calendar.sqlite3 \
  ARCHIVE_KEY_FILE=$d/archive-key.pem ARCHIVE_PUBLIC_KEYS=$d/archive-public-keys.json
uv run --no-project --python 3.12 --with-requirements requirements.txt python -m scripts.demo_seed
uv run --no-project --python 3.12 --with-requirements requirements.txt python -m app
```

Then open `http://127.0.0.1:8010`. Users 1 and 2 are the demo pair.

## Implementation sub-agents (manual path)

Any agent making code changes - solo or delegated - works inside a treehouse worktree.
Sub-agents delegated an issue follow the `implement-issue` skill for the full working
procedure (worktree, build, verify, evidence, /no-mistakes pipeline, handoff).
Orchestration is driven by the `issue-orchestrator` skill.
<!-- end repo-owned -->
