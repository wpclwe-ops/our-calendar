# Project instructions

- Read docs/IMPLEMENTATION.md before continuing. Source product decisions are in docs/SPECIFICATION.ru.txt.
- Preserve exactly two immutable Telegram identities per logical calendar. Check authorization in the service layer on every mutation.
- Never add provider write operations without absolute import-only checks, owner checks, reconciliation and explicit deletion consents.
- Never commit .env, database files, signing keys, tokens or real personal data.
- Use one process/replica for the SQLite deployment. Preserve the persistent volume and signing-key registry.
- Do not claim Google/iCloud, automatic translation, live Telegram delivery, or a full production release are complete without implementing and verifying them.
- Run `scripts/lint.sh` and `scripts/test.sh` after meaningful changes, and `scripts/test-e2e.sh` after UI changes (CLAUDE.md, "Canonical commands").
- New functionality needs meaningful behavior/security tests. Avoid tests that only mirror implementation.
