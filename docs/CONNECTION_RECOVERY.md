# Calendar connection recovery — 0.10.9

## Verified cause and scope

Production logs on 17 November 2026 show successful iCloud scans followed by
one REPORT 401 and a stopped account. Previously any collection 401 stopped
all account polling. Google similarly treated any token endpoint 400/401 as
revocation and did not retry an API 401 with a refreshed access token. Vault
failure was also represented as a provider authentication rejection.

This release is strictly inbound. No calendar write operations, additional
sharing permissions or notification settings are introduced.

## Recovery behavior

- Google refreshes near expiry and retries one Calendar API 401 after refreshing.
  Shared bounded locks serialize refreshes per database/account in the required
  single-process deployment. Each refresh reloads credentials and checks account
  generation before storing, so concurrent disconnect/reconnect cannot be undone.
  An omitted/empty refresh token in a refresh response retains the stored grant.
- Only explicit refresh `invalid_grant`, or a missing refresh grant when needed,
  requests Google sign-in. Client configuration, storage, malformed responses,
  throttling and temporary network/API failures retain credentials and retry with
  existing bounded backoff and Retry-After handling.
- iCloud collection 401/403/404 triggers root rediscovery and one collection retry.
  Only three root authentication rejections, each at least 60 seconds after the
  previous counted rejection and within a 30-minute window, require reconnect.
  Successful sync/discovery resets the persisted rejection counter. A collection
  denial with a valid account affects that source, not the whole account.
- A rediscovered iCloud host can be adopted only for an identical collection path
  on Apple's HTTPS allowlist. Links move atomically with it. Display names never
  establish identity. Ambiguous/preexisting target sources require manual review.
- A one-time worker repair retries legacy needs_reconnect accounts only when they
  retain credentials and previously selected sources, their original owner is an
  active member and their calendar is active. It preserves selected sources,
  auto-import consent and event/link identities. Explicit disconnect, deselection,
  leaving, deletion lock and restoration boundaries remain authoritative.
- Owner-private connection screens show last successful sync, next retry and
  fixed diagnostic messages; they refresh their status every 15 seconds while
  visible. Diagnostics never contain credentials, remote descriptions or URLs.
- Schema version 5 adds diagnostics/timestamps/counters only. Existing credentials
  and encryption keys are retained. RELEASE_CHECKPOINT_REQUIRED still verifies a
  restorable encrypted checkpoint before startup.

## Google configuration still needs account-side verification

An External OAuth client in Testing with calendar scopes has seven-day refresh
expiry: https://developers.google.com/identity/protocols/oauth2#expiration

The project's current publishing state cannot be inferred from its client ID or
repository. Check Google Cloud → Google Auth Platform → Audience for the client
used by this Railway service. If it is Testing, publish to In production under
Google's applicable requirements and reconnect once to obtain a new grant.
Do not rotate the existing client secret or credential encryption key to fix this.
The agent's connected browser timed out and the cloud browser could not access
Google Cloud on 17 November; this release does not claim to change that setting.

## Validation

Automated synthetic acceptance covers transient/repeated API 401, token endpoint
errors, revoked grants, parallel refresh, disconnect during refresh, wrong vault
keys, nine simulated days across importer restart, persistent iCloud root checks,
host rediscovery without duplicates, URL trust boundaries, legacy recovery,
explicit disconnect, deselection and calendar lock. Existing provider privacy,
consent and import-only tests continue to apply. Browser acceptance also checks
RU/EN recovery messages, retained controls and successful-sync/retry timestamps.
These scenarios do not establish real multi-day Google/iCloud acceptance.
