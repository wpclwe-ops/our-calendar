from datetime import datetime

import pytest

from app.bot import Worker
from app.recurrence import UTC
from app.security import Problem
from tests.test_worker_api import FakeTelegram


def test_custom_defaults_and_events_preserve_partner(service, backup):
    service.settings('1', {'default_reminders': [5, 90, 10080]})
    ev = service.save_event('1', {'title': 'Custom', 'start': '2026-10-24T12:00', 'end': '2026-10-24T13:00', 'timezone': 'Europe/Warsaw'})
    assert ev['reminders'] == {'1': [10080, 90, 5], '2': [60]}
    saved = service.save_event('1', {'reminders': [45]}, ev['id'], ev['revision'])
    assert saved['reminders'] == {'1': [45], '2': [60]}
    archive = backup.export('1')
    service.settings('1', {'default_reminders': [60]})
    preview = backup.preview('1', archive)
    backup.apply('1', archive, [], [], [], preview_id=preview['preview_id'], profile_fields=['default_reminders'])
    assert service.state('1')['me']['default_reminders'] == [10080, 90, 5]
    assert service.state('2')['me']['default_reminders'] == [60]


@pytest.mark.parametrize('values', [[0], [-1], [525601], [True], [1.5], ['45'], [45, 45], [1, 2, 3, 4], None])
def test_invalid_custom_intervals_are_rejected_atomically(service, event, values):
    with pytest.raises(Problem):service.settings('1', {'default_reminders': values})
    with pytest.raises(Problem):service.save_event('1', {'reminders': values}, event['id'], event['revision'])
    assert service.state('1')['me']['default_reminders'] == [60]
    assert service.get_event('1', event['id'])['reminders'] == {'1': [60], '2': [60]}


def test_week_ahead_reminders_for_events_outside_scheduler_horizon(service):
    service.settings('1', {'default_reminders': [10080]})
    ev = service.save_event('1', {'title': 'Week ahead', 'start': '2026-10-24T12:00', 'end': '2026-10-24T13:00', 'timezone': 'Europe/Warsaw', 'rrule': 'FREQ=DAILY;COUNT=3'})
    worker = Worker(service, FakeTelegram())
    now = datetime(2026, 10, 17, 9, tzinfo=UTC)
    worker.schedule(now);worker.schedule(now)
    with service.db.transaction() as c:
        jobs = c.execute("SELECT user_id,due FROM outbox WHERE kind='reminder' AND status='pending' AND event_id=? ORDER BY due", (ev['id'],)).fetchall()
    # The latter two events follow the Warsaw clock change: elapsed week offsets
    # retain their correct UTC hour rather than silently becoming 167 hours.
    assert [(row['user_id'], row['due']) for row in jobs] == [('1', '2026-10-17T10:00:00+00:00'), ('1', '2026-10-18T11:00:00+00:00'), ('1', '2026-10-19T11:00:00+00:00')]


def test_custom_all_day_reminders_use_each_recipient_midnight(service):
    for user, timezone in [('1', 'Europe/Warsaw'), ('2', 'Australia/Melbourne')]:
        service.settings(user, {'default_reminders': [10080], 'timezone': timezone})
    service.save_event('1', {'title': 'All day', 'start': '2026-10-25', 'end': '2026-10-26', 'all_day': True})
    Worker(service, FakeTelegram()).schedule(datetime(2026, 10, 17, 9, tzinfo=UTC))
    with service.db.transaction() as c:
        jobs = c.execute("SELECT user_id,due FROM outbox WHERE kind='reminder' AND status='pending' ORDER BY user_id").fetchall()
    assert [(row['user_id'], row['due']) for row in jobs] == [('1', '2026-10-17T22:00:00+00:00'), ('2', '2026-10-17T13:00:00+00:00')]


def test_custom_interval_on_one_occurrence_is_not_lost(service):
    ev = service.save_event('1', {'title': 'Series', 'start': '2026-10-24T12:00', 'end': '2026-10-24T13:00', 'timezone': 'Europe/Warsaw', 'rrule': 'FREQ=DAILY;COUNT=3'})
    service.occurrence_change('2', ev['id'], '2026-10-25T12:00', {'reminders': [10080]}, ev['revision'], scope='one')
    Worker(service, FakeTelegram()).schedule(datetime(2026, 10, 18, 9, tzinfo=UTC))
    with service.db.transaction() as c:
        jobs = c.execute("SELECT user_id,due FROM outbox WHERE kind='reminder' AND json_extract(payload,'$.minutes')=10080").fetchall()
    assert [(row['user_id'], row['due']) for row in jobs] == [('2', '2026-10-18T11:00:00+00:00')]
