from datetime import date, datetime, timedelta

import pytest

from app.bot import Worker, TelegramAPIError
from app.daily_summary import DailySummaries, due_at, telegram_length
from app.recurrence import UTC
from app.security import Problem
from app.service import dump, load


@pytest.fixture
def clock(monkeypatch):
    now = datetime(2026, 11, 3, 6, tzinfo=UTC)
    monkeypatch.setattr('app.recurrence.utcnow', lambda: now)
    monkeypatch.setattr('app.service.utcnow', lambda: now)
    monkeypatch.setattr('app.backup.utcnow', lambda: now)
    return now


class Telegram:
    def __init__(self):
        self.sent = []

    def send(self, *args):
        self.sent.append(args)


def enable(service, who='1', when='09:00', timezone='Europe/Warsaw'):
    service.settings(who, {'daily_summary_enabled': True, 'daily_summary_time': when, 'timezone': timezone})
    with service.db.transaction() as c:
        prefs = service.user(c, who)
        prefs.pop('id')
        prefs['bot_can_message'] = True
        c.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), who))


def jobs(service):
    with service.db.transaction() as c:
        return [dict(r) for r in c.execute("SELECT * FROM outbox WHERE kind='daily_summary' ORDER BY due,user_id")]


def event(service, title, start='2026-11-03T12:00', end='2026-11-03T13:00', **changes):
    return service.save_event('1', {'title': title, 'start': start, 'end': end, 'timezone': 'Europe/Warsaw', **changes})


def clear_actions(service):
    with service.db.transaction() as c:
        c.execute("DELETE FROM outbox WHERE kind!='daily_summary'")


def test_defaults_validation_and_personal_archive_restore(service, backup, clock):
    assert service.state('1')['me']['daily_summary_enabled'] is False
    assert service.state('1')['me']['daily_summary_time'] == '09:00'
    enable(service, when='08:17')
    archive = backup.export('1')
    saved = backup.verify(archive)
    assert saved['members']['1']['daily_summary_time'] == '08:17'
    assert 'daily_summary_generation' not in saved['members']['1']
    service.settings('1', {'daily_summary_enabled': False, 'daily_summary_time': '23:59'})
    preview = backup.preview('1', archive)
    backup.apply('1', archive, [], [], [], preview_id=preview['preview_id'],
                 profile_fields=['daily_summary_enabled', 'daily_summary_time'])
    assert service.state('1')['me']['daily_summary_time'] == '08:17'
    assert service.state('2')['me']['daily_summary_enabled'] is False
    assert service.state('2')['me']['daily_summary_time'] == '09:00'
    with pytest.raises(Problem):
        service.settings('1', {'user_id': '2', 'daily_summary_enabled': True})


@pytest.mark.parametrize('value', ['', '8:00', '24:00', '09:60', '09:00:00', '09:00\n', None, 900, True, [], {}])
def test_invalid_time_rejected_without_changing_preferences(service, value):
    with pytest.raises(Problem, match='invalid_daily_summary_time'):
        service.settings('1', {'daily_summary_time': value})
    assert service.state('1')['me']['daily_summary_time'] == '09:00'


@pytest.mark.parametrize('value', [0, 1, 'true', None, [], {}])
def test_summary_requires_boolean(service, value):
    with pytest.raises(Problem):
        service.settings('1', {'daily_summary_enabled': value})


def test_schedule_personal_time_restart_dedupe_and_no_immediate_catchup(service, clock):
    enable(service, when='08:17')
    enable(service, '2', '09:37', 'Australia/Melbourne')  # Already past there.
    summary = DailySummaries(service)
    summary.schedule(clock)
    DailySummaries(service).schedule(clock)
    queued = jobs(service)
    assert len(queued) == 3
    own = [j for j in queued if j['user_id'] == '1']
    assert own[0]['due'] == '2026-11-03T07:17:00+00:00'
    partner = [j for j in queued if j['user_id'] == '2']
    assert [load(j['payload'])['day'] for j in partner] == ['2026-11-04']
    assert partner[0]['due'] == '2026-11-03T22:37:00+00:00'


def test_summary_contains_all_owners_statuses_and_current_effective_events(service, clock):
    enable(service)
    service.settings('2', {'name': 'Synthetic partner'})
    event(service, 'Mine')
    event(service, 'Partner', start='2026-11-03T14:00', end='2026-11-03T15:00', owner='2')
    event(service, 'Together', start='2026-11-03T16:00', end='2026-11-03T17:00', owner='both')
    event(service, 'Done', status='done')
    event(service, 'Cancelled', status='cancelled')
    event(service, 'All day', start='2026-11-03', end='2026-11-04', all_day=True)
    event(service, 'Already over', start='2026-11-02T23:00', end='2026-11-03T00:00')
    event(service, 'Tomorrow', start='2026-11-04T00:00', end='2026-11-04T01:00')
    removed = event(service, 'Trashed')
    service.delete_event('1', removed['id'], removed['revision'])
    series = event(service, 'Series', start='2026-11-01T10:00', end='2026-11-01T11:00', rrule='FREQ=DAILY;COUNT=5')
    service.occurrence_change('1', series['id'], '2026-11-04T10:00',
                              {'title': 'Moved here', 'start': '2026-11-03T18:00', 'end': '2026-11-03T19:00'},
                              series['revision'])
    clear_actions(service)
    worker = Worker(service, Telegram())
    worker.summaries.schedule(clock)
    worker.deliver(datetime(2026, 11, 3, 8, tzinfo=UTC))
    text = '\n'.join(x[1] for x in worker.telegram.sent)
    assert 'Mine — Ты' in text
    assert 'Partner — Synthetic partner' in text
    assert text.count('Together — Вместе') == 1
    assert 'Выполнено' in text and 'Отменено' in text
    assert 'Весь день · All day' in text
    assert 'Moved here' in text and text.count(' · Series —') == 1
    assert all(name not in text for name in ['Already over', 'Tomorrow', 'Trashed'])
    assert text.index('All day') < text.index('Series') < text.index('Mine')
    # A restart or a later time edit cannot send today's digest twice.
    service.settings('1', {'daily_summary_time': '11:37'})
    worker.summaries.schedule(clock)
    worker.deliver(datetime(2026, 11, 3, 12, tzinfo=UTC))
    assert len(worker.telegram.sent) == 1


def test_delivery_reads_latest_events_and_is_independent_of_reminder_switch(service, clock):
    enable(service)
    service.settings('1', {'reminders_enabled': False})
    worker = Worker(service, Telegram())
    worker.summaries.schedule(clock)
    e = event(service, 'Old title')
    service.save_event('1', {'title': 'Latest title'}, e['id'], e['revision'])
    clear_actions(service)
    worker.deliver(clock + timedelta(hours=2))
    assert 'Latest title' in worker.telegram.sent[0][1]


@pytest.mark.parametrize('change', ['summary_off', 'notifications_off', 'leave', 'lock', 'next_day', 'wrong_generation'])
def test_pending_summary_rechecks_access_settings_and_day(service, clock, change):
    enable(service)
    worker = Worker(service, Telegram())
    worker.summaries.schedule(clock)
    if change == 'summary_off':
        service.settings('1', {'daily_summary_enabled': False})
    elif change == 'notifications_off':
        service.settings('1', {'notifications_enabled': False})
    elif change == 'leave':
        service.membership('1')
    elif change == 'lock':
        service.deletion('1', 'approve')
        service.deletion('2', 'approve')
    elif change == 'wrong_generation':
        with service.db.transaction() as c:
            prefs = service.user(c, '1'); prefs.pop('id'); prefs['daily_summary_generation'] = 'changed'
            c.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), '1'))
    clear_actions(service)
    # Tomorrow's digest is future-due; yesterday's must not leak through on restart.
    now = clock + (timedelta(days=1, hours=1) if change == 'next_day' else timedelta(hours=2))
    worker.deliver(now)
    assert worker.telegram.sent == []
    if change in ('leave', 'lock'):
        with pytest.raises(Problem):
            service.settings('1', {'daily_summary_enabled': True})


def test_time_change_replaces_unsent_job_and_language_is_recipient_specific(service, clock):
    enable(service)
    enable(service, '2')
    e = event(service, 'Оригинал', owner='both')
    service.save_event('1', {'translations': {'en': {'title': 'English title', 'manual': True}}}, e['id'], e['revision'])
    clear_actions(service)
    worker = Worker(service, Telegram())
    worker.summaries.schedule(clock)
    service.settings('1', {'daily_summary_time': '08:17'})
    worker.summaries.schedule(clock)
    assert len(jobs(service)) == 4
    worker.deliver(datetime(2026, 11, 3, 7, 17, tzinfo=UTC))
    assert [m[0] for m in worker.telegram.sent] == ['1']
    worker.deliver(datetime(2026, 11, 3, 8, tzinfo=UTC))
    assert worker.telegram.sent[1][0] == '2'
    assert 'English title — Together' in worker.telegram.sent[1][1]
    assert worker.telegram.sent[1][2] == 'en'


def test_dst_gap_fold_midnight_and_full_recipient_day(service, clock):
    assert due_at(date(2026, 3, 29), '02:30', 'Europe/Warsaw') == datetime(2026, 3, 29, 1, tzinfo=UTC)
    assert due_at(date(2026, 10, 25), '02:30', 'Europe/Warsaw') == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)
    assert due_at(date(2026, 11, 3), '00:00', 'Europe/Warsaw') == datetime(2026, 11, 2, 23, tzinfo=UTC)
    enable(service)
    event(service, 'Local midnight', start='2026-11-03T00:05', end='2026-11-03T00:10')
    event(service, 'Overnight', start='2026-11-02T23:00', end='2026-11-04T01:00')
    event(service, 'End exclusive', start='2026-11-02', end='2026-11-03', all_day=True)
    clear_actions(service)
    worker = Worker(service, Telegram()); worker.summaries.schedule(clock)
    worker.deliver(clock + timedelta(hours=2))
    text = worker.telegram.sent[0][1]
    assert '00:05–00:10 · Local midnight' in text
    assert '00:00–24:00 · Overnight' in text
    assert 'End exclusive' not in text


def test_empty_day_and_start_bot_required(service, clock):
    enable(service)
    clear_actions(service)
    worker = Worker(service, Telegram()); worker.summaries.schedule(clock)
    worker.deliver(clock + timedelta(hours=2))
    assert 'На сегодня событий нет' in worker.telegram.sent[0][1]
    enable(service, '2')
    with service.db.transaction() as c:
        prefs = service.user(c, '2'); prefs.pop('id'); prefs['bot_can_message'] = False
        c.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), '2'))
    worker.summaries.schedule(clock); worker.deliver(clock + timedelta(hours=2))
    assert len(worker.telegram.sent) == 1
    assert any(j['error'] == 'start_bot_required' for j in jobs(service) if j['user_id'] == '2')


def test_long_digest_preserves_every_event_and_resumes_after_rate_limit(service, clock):
    enable(service)
    for i in range(40):
        event(service, f'Specimen {i:02d} ' + '😀' * 275)
    clear_actions(service)
    class Limited(Telegram):
        limited = False

        def send(self, *args):
            if len(self.sent) == 1 and not self.limited:
                self.limited = True
                raise TelegramAPIError(429, 120)
            super().send(*args)

    worker = Worker(service, Limited()); worker.summaries.schedule(clock)
    now = clock + timedelta(hours=2)
    worker.deliver(now)
    assert len(worker.telegram.sent) == 1
    Worker(service, worker.telegram).deliver(now + timedelta(minutes=3))
    messages = [m[1] for m in worker.telegram.sent]
    assert len(messages) > 1
    assert all(telegram_length(text) <= 4096 for text in messages)
    for i in range(40):
        assert '\n'.join(messages).count(f'Specimen {i:02d} ') == 1
    assert [j for j in jobs(service) if load(j['payload'])['day'] == '2026-11-03'][0]['status'] == 'sent'


def test_unrelated_calendar_and_bad_series_do_not_hide_good_events(service, clock):
    enable(service)
    good = event(service, 'Good event')
    bad = event(service, 'Broken series')
    with service.db.transaction() as c:
        data = load(c.execute('SELECT data FROM events WHERE id=?', (bad['id'],)).fetchone()[0])
        data['rrule'] = 'NOT_A_RULE'
        c.execute('UPDATE events SET data=? WHERE id=?', (dump(data), bad['id']))
    service.create_calendar('3')
    service.save_event('3', {'title': 'Private other calendar', 'start': '2026-11-03T12:00', 'end': '2026-11-03T13:00'})
    clear_actions(service)
    worker = Worker(service, Telegram()); worker.summaries.schedule(clock)
    worker.deliver(clock + timedelta(hours=2))
    text = worker.telegram.sent[0][1]
    assert 'Good event' in text and 'не удалось прочитать' in text
    assert 'Private other calendar' not in text


def test_worker_still_delivers_summary_if_reminder_scheduling_fails(service, clock, monkeypatch):
    enable(service)
    clear_actions(service)
    worker = Worker(service, Telegram())
    now = clock + timedelta(hours=2)
    monkeypatch.setattr('app.bot.utcnow', lambda: now)
    monkeypatch.setattr(worker, 'configure_bot', lambda: None)
    def broken():
        raise ValueError('bad legacy series')
    monkeypatch.setattr(worker, 'schedule', broken)
    monkeypatch.setattr(worker.stop_event, 'wait', lambda seconds: worker.stop_event.set())
    worker.run()
    assert len(worker.telegram.sent) == 1
    assert 'Сводка дня' in worker.telegram.sent[0][1]


def test_repeated_dst_hour_sends_once_for_the_local_date(service, monkeypatch):
    monkeypatch.setattr('app.recurrence.utcnow', lambda: datetime(2026, 10, 24, 12, tzinfo=UTC))
    enable(service, when='02:30')
    clear_actions(service)
    worker = Worker(service, Telegram())
    first = datetime(2026, 10, 25, 0, 30, tzinfo=UTC)
    worker.summaries.schedule(first); worker.deliver(first)
    second = first + timedelta(hours=1)
    Worker(service, worker.telegram).summaries.schedule(second)
    worker.deliver(second)
    assert len(worker.telegram.sent) == 1


def test_full_restore_keeps_summary_paused_until_personal_notifications_resume(service, backup, clock):
    enable(service)
    enable(service, '2')
    archive = backup.export('1')
    with service.db.transaction() as c:
        c.execute('DELETE FROM calendars')
    request = backup.request_deleted('1', archive)
    backup.approve_deleted('1', request['id'], True)
    backup.approve_deleted('2', request['id'], True)
    worker = Worker(service, Telegram()); worker.summaries.schedule(clock)
    assert jobs(service) == []
    for who in ('1', '2'):
        prefs = service.state(who)['me']
        assert prefs['daily_summary_enabled'] is True and prefs['notifications_enabled'] is False
    service.settings('1', {'notifications_enabled': True})
    worker.summaries.schedule(clock)
    assert {j['user_id'] for j in jobs(service)} == {'1'}
