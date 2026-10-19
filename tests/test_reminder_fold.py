"""Changing which of two repeated wall-clock hours an event uses must move its reminders."""
from datetime import datetime

from app.bot import Worker
from app.recurrence import UTC


class FakeBot:
    def send(self, *args):
        pass


def pending_due(service, user='1'):
    with service.db.transaction() as c:
        return [r['due'] for r in c.execute(
            "SELECT due FROM outbox WHERE kind='reminder' AND status='pending' AND user_id=? "
            "AND json_extract(payload,'$.minutes')=0", (user,))]


def test_changing_only_fold_replaces_the_reminder(service):
    # 2026-10-25 02:30 happens twice in Warsaw (clocks go back at 03:00).
    ev = service.save_event('1', {'title': 'Night', 'start': '2026-10-25T02:30', 'end': '2026-10-25T03:15',
                                  'timezone': 'Europe/Warsaw', 'fold': 0, 'end_fold': 1})
    worker = Worker(service, FakeBot())
    now = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
    worker.schedule(now)
    first = pending_due(service)
    assert len(first) == 1

    service.save_event('1', {'fold': 1}, ev['id'], ev['revision'])
    worker.schedule(now)
    after = pending_due(service)
    assert len(after) == 1
    assert after != first  # the second 02:30 is one hour later in UTC
