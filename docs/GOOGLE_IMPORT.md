# Google Calendar: inbound import (0.8.2)

This release implements the first integration stage only. Google event creation,
updates, deletion, automatic export, and two-way mode are absent. OAuth requests
only CalendarList/event read scopes plus OpenID/email for account identification.
The sole Calendar API POST creates a read-only watch subscription; it does not
modify events. OAuth token exchange/refresh also use POST.

## Production configuration

Set these service variables in the existing Our Calendar service (not the
translation service):

- `GOOGLE_CLIENT_ID`: OAuth client ID for a Web application.
- `GOOGLE_CLIENT_SECRET`: that client's secret.
- `GOOGLE_CREDENTIAL_KEY`: independent Fernet encryption key. Generate with
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
  Keep it outside the database and retain it securely. Do not replace it while
  encrypted connections exist. Never put any of these values in Git or chat logs.

The redirect URI is exactly `PUBLIC_URL` + `/api/google/callback`:
`https://our-calendar-production-ffcb.up.railway.app/api/google/callback`.
Enable Google Calendar API. Configure the Google OAuth consent screen, audience
and test users. Requested scopes:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `openid`
- `https://www.googleapis.com/auth/userinfo.email`

Google OAuth must open in an external browser. Returning through the callback
only creates an encrypted, expiring pending confirmation. The original
Telegram participant must confirm the displayed Google email inside the Mini
App before an account is connected. Start/callback/confirmation are one-use and
expire after ten minutes. Denied consent can be restarted from the app.

Callback failures display a fixed diagnostic code and a relevant next step,
distinguishing token-exchange client credentials, rejected one-time codes,
missing permissions, offline access, identity lookup and expired attempts.
Only allowlisted OAuth error identifiers are retained from Google's token error
response. Logs contain a fixed failure code, never provider descriptions,
authorization codes, state, tokens, client secrets or account identity.
`google_oauth_token_invalid_client` after consent means the server's OAuth
client credentials must be checked; repeated consent alone cannot fix it.

An External OAuth app in Testing has seven-day refresh-token expiry with these
scopes. Establish the appropriate publishing/verification state before treating
the connection as permanent. Real-device OAuth, actual Google API permissions,
Google quotas/watch delivery, and long-running account acceptance still need
validation with the registered client. Automated synthetic tests do not replace
that acceptance.

If all three variables are absent or incomplete, the integration is visibly
unconfigured and cannot initiate OAuth. The rest of the application works.

## User journey and privacy

Settings → Google Calendar → Open → connect and confirm account → choose source
calendars → choose individual events or explicitly choose a whole series →
preview → confirm import. The date range is an owner-private selection window,
not a limit on the lifetime of imported events or background synchronization.
A series selection explicitly includes future occurrences. An individual
occurrence is imported as a single event. Source/instance overlap is rejected
rather than producing duplicates. Technical batch size is 50 selected items;
provider pagination supports additional pages. By default, new external events
are not shared until the owner explicitly imports them. An additional opt-in
checkbox enables *automatic import per source calendar* after a clear one-time
confirmation: all existing upcoming appointments and later new events (including
title, details and full supported recurring series) then become shared with the
partner. Existing one-off past events are not backfilled. Disabling source
selection or reconnecting never silently restores auto import. The owner can
turn auto import off while retaining manually/previously imported linked events.
All writes to Google Calendar remain prohibited. Selection uses escaped text,
including Google HTML Descriptions; no imported HTML is executed.

Only source owners can read their accounts, source lists, unselected events,
previews and conflict controls. Shared event details contain only the link ID,
state and Telegram owner ID, never email, credentials or unselected data. Both
participants can see explicitly imported events. Personal reminder defaults are
applied on import; existing Google reminders remain independent. A batch sends
one partner notification. Important external changes notify both.

Unselected event bodies are read transiently for private selection/delta
processing and are not persisted. Selected preview snapshots and pending OAuth
credentials are encrypted and expire after ten minutes. Permanent credentials
are server-encrypted with the independent key. ZIP/ICS omit accounts, links,
credentials, cursors and previews; encrypted operator snapshots contain the DB
and must remain protected separately from the Google encryption key. Uvicorn
access logging is disabled; callback responses prohibit caching/referrers.

## Durable inbound synchronization

Per-source sync cursors, due times, retry attempts and crash-recoverable leases
are in SQLite. Network calls never hold a DB transaction. On each apply, owner,
membership, source selection, automatic-import consent, account/source generations
and lifecycle are checked again. Manual and background checks share the same engine. A separate
Google thread isolates provider delays from reminders, translation and backups.

A full read precedes incremental `syncToken` reads. Pagination completes before
the new cursor commits. Auto import reads a bounded batch (20 newly detected
events) per pass; while a backfill remains, the previous cursor is retained and
the next pass runs soon so unprocessed remote events cannot disappear. Bad or
unsupported events are skipped by remote ID and ETag until Google changes them;
they cannot starve other new events. Any local Google-import links, including
disconnected links, suppress automatic duplicate creation. Client previews and
Google changes are never used to write back to Google. `410` triggers a new provider read; shared records are
not erased. Push channels are registered only for selected sources and renewed
before expiry. Callback channel tokens/resource IDs/generations are checked;
push only marks the source due. Initial messages arriving before watch returns
are supported. Failed subscription creation is retried after a provisional
five-minute window. Old channels after disconnect are ignored and expire;
no event data is included in their callbacks. Polling every five minutes covers
missing push messages. Requests may be delayed by network failures and quotas.

Transient errors use bounded exponential backoff and jitter. Authentication
failure requires reconnect. Access loss/404 does not prove deletion and does
not remove shared events. Explicit Google cancellation tombstones create an
owner decision: keep independent or move to shared Trash. Until that decision,
the shared event stays. One unsupported event does not stop other links or
accounts. Unsupported links retry on future checks even after cursor advance.

Reconciliation compares base/local/remote. Independent fields merge; conflicting
fields preserve both versions for the connection owner. Start/end/all-day/zone/
fold/recurrence form one temporal group. Manual translations and personal
reminders are retained. Choosing a conflict version re-reads the remote event
and checks local revision and the displayed remote fingerprint. Import-only
resolutions modify only Our Calendar.

Disconnect/deselect leaves imported events intact and ends only affected links.
Leaving the pair erases that participant's local credentials and pending
requests; return does not reactivate them. Google authorization can also be
revoked from the Google Account settings. Reconnection requires manual source
and event selection and reconciles retained link IDs without duplicate imports.
Local event deletion disconnects its link; Trash/ZIP restoration never silently
reactivates it. Locked calendars are excluded from background jobs and reject
in-flight applies; after cancellation the next check reconciles versions.

## Supported scope and explicit limits

Basic timed/all-day events, supported RRULE series, moved/cancelled exceptions,
and separately chosen instances are supported. EXDATE/RDATE/EXRULE combinations
and unsupported event types are rejected explicitly instead of being flattened
or truncated. Series with DST intervals that the current internal recurrence
engine cannot represent safely are rejected. Changing a remote series anchor
when local occurrence-specific preferences need identity remapping pauses that
link with an unsupported-change state, preserving data.

This stage does not implement cross-account event merging, two-owner conflict
consensus, invitation/RSVP/conference management, Google reminder editing,
exports or any external deletion. These remain later integration stages. Events
on invitation calendars are imported as data, without changing guests/RSVPs.

## Validation

`tests/test_google_import.py` exercises privacy/IDOR, confirmation/replay,
deduplication, stale previews, independent changes, conflict freshness, external
deletions, reconnect, local Trash, leaving, lifecycle lock, retries/restart,
all-day/timezones, series exceptions, unsupported recurrence, encrypted OAuth,
archive exclusions, write-route absence, authenticated push, subscription
failure fallback, broken-event isolation, races and revoked access.

`tests/browser-google-import.cjs` uses a synthetic provider server only. It
exercises source/event selection, preview, failed-import retry, deduplication,
partner visibility/privacy, RU/EN and 320/390/430 CSS-pixel widths. Existing
calendar browser scenarios remain in CI. No real user events are used.

### Local acceptance result, 18 October 2026

- Python suite: 173 passed (including 28 Google behaviour/security cases).
- JavaScript unit suite: 26 passed; Python compilation and JS syntax passed.
- Google mobile browser scenario: passed with synthetic data at 320/390/430 px.
- All six existing calendar browser scripts: passed.
- Screenshots of the new selection screen were inspected locally.
- The full Chrome binary could not initialize under this environment's process
  restrictions; the installed Chromium headless-shell completed the browser runs.
- Live Google OAuth/API and production activation remain unverified until the
  OAuth client is registered and configured. Publication is a separate step.
