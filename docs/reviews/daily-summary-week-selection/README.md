# Daily summary, week date selection and owner initials — 0.10.8

Prepared from main `294f8be` in a separate feature branch. Production release requires observed Railway
SUCCESS and a ready /health at version 0.10.8. Open month-refactor PR #54 and all-day/font PR #55 remain
separate. The approved initial-avatar mockup is implemented in event lists and the
day timeline. Category colours remain independent; shared events show both initials.

## Behavior

- Each participant independently enables the Telegram daily summary and chooses
  any minute from 00:00 to 23:59. Default: disabled, 09:00.
- Uses the recipient's saved IANA zone and RU/EN language. The global notification
  switch pauses it; turning off event reminders alone does not hide the summary.
- Includes every shared event intersecting the recipient's local date: both owners,
  shared events once, all-day, overnight, recurring and moved occurrences. Completed
  and cancelled items carry labels. Trashed occurrences/events are excluded.
- Builds a fresh snapshot at delivery, rather than at scheduling. No UI filters or
  unselected provider events are used. A bad legacy series gets an explicit warning
  and does not hide successfully expanded events.
- Empty days explicitly say there are no events. Long days use numbered messages
  under Telegram's UTF-16 length limit. Checkpointed parts survive ordinary retries.
- One durable outbox identity per calendar/recipient/local date. Sent summaries
  remain sent after restart, time edits and the repeated autumn DST hour. Spring
  gaps use the first valid minute at or after the requested wall time.
- Changes after today's chosen time start tomorrow. Yesterday's queued summaries
  are cancelled. Uncertain Telegram acceptance retains the existing retry tradeoff;
  physical exactly-once delivery is not guaranteed.
- Rechecks active membership, calendar state, notification preferences, timezone,
  generation and date before delivery. Bot-start failures use existing diagnostics.
- Signed ZIP retains only the public summary preferences. Selective restoration
  affects only the acting participant; full restoration keeps notifications paused.
- Week date taps keep the chosen weekly layout. Agenda displays that day's events;
  three-day windows follow the selected date; timeline scroll is preserved. Month
  date taps still open the separate Day view.

## Validation

- `python -m pytest -q`: 422 passed, one existing Starlette deprecation warning.
- `node --test tests/*.test.cjs`: 51 passed.
- `python -m compileall -q app scripts`, JS syntax, `git diff --check`: passed.
- Chromium 141 / Playwright 1.56.0 scenarios: settings, calendar-date-navigation,
  calendar-week, calendar-design, calendar-interactions, list-swipe-actions and
  event-owners. The owner scenario checks RU/EN × light/dark × 320/390/430 px,
  neutral colours, accessible labels, profile updates, escaped names, event taps
  and completion controls.
- Date regression covers all three week layouts and both personal Day layouts,
  repeat taps, filters, hidden Day tab, keyboard, reduced motion, year/month edges,
  failed loading/retry, a moving three-day window and retained timeline scroll.
- Summary settings geometry: RU/EN × light/dark × 320/390/430 CSS px. Arbitrary
  08:17 persists; partner settings stay independent; a global pause is visible.
- Daily-summary behavior/security tests cover validation, owner labels, language,
  local midnight, exclusive all-day ends, status, moved recurrence, trash, empty
  days, long emoji-rich messages, rate-limit recovery, independent settings,
  membership/lock revocation, another calendar, ZIP restoration, DST, restart and
  worker isolation.

All accounts, events, databases and Telegram calls in acceptance are synthetic.
Real Telegram delivery and Telegram iOS/WebKit still require device acceptance.
