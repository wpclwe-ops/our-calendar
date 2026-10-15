import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = '''
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calendars(
 id TEXT PRIMARY KEY, first_id TEXT NOT NULL, second_id TEXT,
 state TEXT NOT NULL DEFAULT 'active', votes TEXT NOT NULL DEFAULT '[]', delete_at TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members(
 user_id TEXT PRIMARY KEY REFERENCES users(id), calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS members_calendar ON members(calendar_id);
CREATE TABLE IF NOT EXISTS invites(
 token_hash TEXT PRIMARY KEY, calendar_id TEXT UNIQUE NOT NULL REFERENCES calendars(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories(
 id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events(
 id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1, schedule_version INTEGER NOT NULL DEFAULT 1,
 data TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS events_calendar ON events(calendar_id, deleted_at);
CREATE TABLE IF NOT EXISTS overrides(
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(event_id,occurrence)
);
CREATE TABLE IF NOT EXISTS outbox(
 id TEXT PRIMARY KEY, calendar_id TEXT REFERENCES calendars(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, event_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL,
 due TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, due);
CREATE TABLE IF NOT EXISTS backup_previews(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 archive_sha TEXT NOT NULL, data TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS translation_jobs(
 kind TEXT NOT NULL,resource_id TEXT NOT NULL,calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 version TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT,next_at TEXT NOT NULL,PRIMARY KEY(kind,resource_id)
);
CREATE TABLE IF NOT EXISTS bot_updates(id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS runtime(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS restore_requests(
 id TEXT PRIMARY KEY, calendar_id TEXT UNIQUE NOT NULL, first_id TEXT NOT NULL, second_id TEXT NOT NULL,
 archive TEXT NOT NULL, votes TEXT NOT NULL, created_at TEXT NOT NULL
);
'''

class Database:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.executescript(SCHEMA)

    def connect(self):
        c = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA busy_timeout=30000')
        return c

    @contextmanager
    def transaction(self):
        c = self.connect()
        try:
            c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()
