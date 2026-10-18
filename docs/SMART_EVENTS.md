# Smart Events — implementation and activation

Version 0.9.1. Smart Events is optional. Without an API key or without consent,
calendar CRUD, existing private LibreTranslate, imports and reminders continue to work.
No outbound Google/CalDAV event writes are introduced.

## Server setup

Use the existing Railway application service and persistent volume. Do not create
another database, service or Redis queue. Keep one process/replica.

Set these **server environment variables**, never client-side configuration:

| Variable | Default | Meaning |
| --- | --- | --- |
| OPENAI_API_KEY | empty | Separate OpenAI API project key; do not commit or send it in chat |
| OPENAI_MODEL | gpt-6-luna | Supported: gpt-6-luna or gpt-5.4-mini |
| SMART_MONTHLY_BUDGET_USD | 5 | Hard conservative application reservation budget across this deployment |
| OPENAI_MAX_OUTPUT_TOKENS | 16384 | Upper output bound; 1024–32768 allowed |
| SMART_AUTO_CATEGORIES_ENABLED | true | Operator kill switch; false pauses automatic shared-category assignment |

ChatGPT subscription billing does not configure this API project. The operator must
separately enable API billing and verify access to the selected model. Adding a key
alone does not grant consent or automatically process old calendar data.

In Settings → Smart Events, each participant controls consent and their imported
source scope. Internal events require both participants to opt in to internal
processing. Automatic common-category assignment additionally needs the server
switch and both participants' automatic mode; the default personal mode is suggestions.

For old records, use **Process existing events**: a one-use, actor-bound, revision-
checked preview. Select records explicitly. Unselected records are not queued by
that batch. A source update or a newly imported allowed record is queued normally.
Manual corrections remain protected.

## Data and compatibility

- Existing full title/description and translations remain in event JSON.
- Server-owned `smart` metadata stores provider-original text, detected languages,
  short titles, per-field manual/stale provenance, category suggestion and manual
  category protection. Ordinary event PATCH cannot inject it.
- This event-owned representation is an intentional implementation simplification
  of the proposed companion tables: it keeps text/provenance atomic through
  recurrence, edits, ZIP and the current JSON-based event model. It is not a new
  user-facing change history. Current source original is retained; unlimited
  historical snapshots are not accumulated.
- Additive SQLite schema version 2 adds smart_jobs/cache/rules/previews/usage and
  a generation fence for legacy translation jobs. Existing event metadata migrates
  conservatively on access/edit; legacy manual languages protect both old fields.
- No automatic mass backfill of old events is performed by Smart Events.
- Original HTML descriptions from Google are retained separately from readable
  plain text. Neither HTML nor model text is rendered with innerHTML.
- A different occurrence text invalidates its translations and short titles.
  Ordinal exception remapping preserves manual corrections when splitting/moving
  series. Unmappable edits return recurrence_exceptions_need_review and roll back.
- Category/rule changes invalidate in-flight model context. A changed category
  catalog makes an older suggestion require reprocessing before acceptance.
- Remembered rules are exact source-title + owner matches. They can be edited,
  disabled or deleted. Conflicting rules stop automatic category selection;
  short-title conflicts fall back to the original. A short-title rule does not
  implicitly memorize a category.

## Queue and billing boundaries

The existing isolated translation thread processes the durable Smart Events queue.
Reminder delivery remains on its own thread. A job uses a lease and a unique
generation. The current source, field protections, catalog, rules and consent are
checked again after the network call. A late result cannot overwrite a later job.
Terminal failures do not enter the automatic retry selection. Retryable network,
rate and incomplete errors have at most **three total attempts**. Auth/model access
failures stop further calls for that configuration until the key/model changes.
The HTTP client has no hidden retries, redirects, tools or provider calendar access.

Only title/description, owner aliases, applicable confirmed hints and allowed
category IDs/names are sent. No Telegram IDs, provider credentials, reminder
settings, private event-browser selections or whole-calendar history are sent.
Requests use strict Structured Outputs and store=false. Schema validation is
followed by semantic field/length/category checks. Confidence is an uncalibrated
heuristic; it is not a probability guarantee.

The local cache is isolated per logical calendar, prompt version and model and
expires after 30 days. It is independent of OpenAI prompt caching. Explicit
reprocessing bypasses the local result cache. Ordinary calendar openings do not
call the model. No periodic paid synthetic health probes are used.

Before each paid attempt the worker atomically reserves a conservative input-byte
and maximum-output estimate. Reservations, including uncertain outcomes, remain
in the monthly hard-budget ledger; the UI labels this as a reserve, not a precise
invoice. Actual token usage is recorded for completed calls. There is no promise
of exactly-once external billing after a lost network response. Reconcile this
ledger against the OpenAI project's billing. Prices are explicit in
app/smart_events.py and must be reviewed when changing supported model tariffs.
Budget-paused work resumes in the next UTC billing month or by explicit retry
following an operator budget change. Missing AI leaves the source calendar usable.

## Privacy, lifecycle and archives

Consent explains the data transfer. API training is off by default; store=false
is not Zero Data Retention and does not eliminate abuse-monitoring or applicable
prompt-cache retention. Refer to official OpenAI data controls before activation.
An event can be excluded separately. Revocation fences pending/in-flight apply;
a request already sent cannot be unsent.

ZIP schema 2 preserves event metadata and remembered rules, with explicit rule
selection in active restore. Schema 1 archives remain readable. API keys, jobs,
caches and usage ledgers do not enter ZIP/ICS. API consent is never restored as an
authorization. Full-calendar restoration retains the immutable-pair/two-consent
rules and leaves each person's reminders disabled as before. Expanded archive
limits are checked before issuing an export.

ICS and Telegram use full localized titles; short titles are a calendar display
preference. AI changes do not alter dates, status, ownership or schedule_version,
do not generate action-notification spam and cannot write to external originals.

Before deployment, take the established encrypted operator recovery checkpoint.
Do not run 0.8.4 against a database containing new `smart` event fields: its old
validator does not accept them. For an emergency rollback use the pre-upgrade
checkpoint through the documented offline recovery process, accounting for all
subsequent user changes. Prefer disabling OPENAI_API_KEY to rolling back data.

## Acceptance and remaining real verification

Automated tests use synthetic events and fake AI transports. They cover original
preservation, field-level manual edits, in-flight changes/revocation, generations,
finite retries, budget, manual null categories, shared auto policy, scoped rules,
provider exception changes, recurrence moves, archives, API ownership and the
Responses request shape/refusal path. Mobile Chromium checks cover empty
Description, title-only RU/EN switching, manual short titles, remembered rules,
settings and event exclusion at 320/390/430 px.

Real OpenAI quality, latency, account/model availability, bills and real
Telegram/iPhone WebKit acceptance are separate. Review a representative PL/UK/DE/FR/RU/EN/mixed-language set,
including both salon examples and ambiguous categories, before relying on unattended categorization.
Suggested first quality set: 80–150 separately labelled synthetic examples, with
an independent checking portion; expand if auto-assignment evidence is weak.
No production AI-quality completion is claimed from fake transport tests.

Official references:
https://developers.openai.com/api/docs/models/gpt-6-luna
https://developers.openai.com/api/docs/models/gpt-5.4-mini
https://developers.openai.com/api/docs/guides/structured-outputs
https://developers.openai.com/api/docs/guides/your-data

## 0.9.1 — unified titles and concurrent editing

One title switch controls semantic title display in every calendar view and event
details; categorization has its own switch. The legacy display_short preference
is retained for archive compatibility but is no longer a separate display gate.
Full localized titles and provider originals remain in the expandable detail block.
Services precede organisation names; flight titles retain Flight/Рейс and the route.
Prompt version 2 invalidates result cache on the next authorized processing request;
existing records are not silently reprocessed or charged. Manual title rules win.

Background Smart Events and LibreTranslate results do not advance the user edit
revision. Manual changes and actual provider source changes still advance it.
The full editor submits only changed fields; partial translation PATCH merges
language fields into fresh data. This prevents an open form from erasing AI text
or categories it never edited. Accepting a suggestion also checks the displayed
category ID and current catalog, since background suggestions may change without
a user revision.

Provider status on Settings is fetched for the signed-in participant only. Ready
connections display Working; missing configuration, missing account, reconnect
requirements, selected-source failures and unavailable status are distinguished.
No live provider probe or paid AI call runs merely to draw these labels.
