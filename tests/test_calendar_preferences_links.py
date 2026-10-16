from urllib.parse import urlsplit, parse_qs
import pytest
from app.bot import Worker, Telegram
from app.service import dump
from app.security import Problem
from tests.test_worker_api import FakeTelegram, allow_messages
from datetime import datetime, timedelta
from app.recurrence import UTC


def test_personal_preferences_and_legacy_defaults(service):
    assert service.state('1')['me']['default_duration'] == 60
    assert service.state('1')['me']['view'] == 'day'
    service.settings('1', {'default_duration': 95, 'month_layout': 'scroll', 'day_layout': 'list'})
    own, other = service.state('1')['me'], service.state('2')['me']
    assert (own['default_duration'], own['month_layout'], own['day_layout']) == (95, 'scroll', 'list')
    assert (other['default_duration'], other['month_layout'], other['day_layout']) == (60, 'paged', 'timeline')
    with service.db.transaction() as c:
        prefs = service.user(c, '2'); prefs.pop('id'); prefs.pop('default_duration'); prefs.pop('month_layout')
        c.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), '2'))
    assert service.state('2')['me']['default_duration'] == 60


@pytest.mark.parametrize('patch', [{'default_duration': True}, {'default_duration': 0}, {'default_duration': -1}, {'default_duration': 1.5}, {'default_duration': 525601}, {'month_layout': 'unknown'}, {'day_layout': 'unknown'}])
def test_invalid_calendar_preferences(service, patch):
    with pytest.raises(Problem): service.settings('1', patch)


def test_new_preferences_roundtrip_backup_for_own_account(service, backup):
    service.settings('1', {'default_duration': 95, 'month_layout': 'scroll', 'day_layout': 'list'})
    archive = backup.export('1')
    service.settings('1', {'default_duration': 30, 'month_layout': 'paged', 'day_layout': 'timeline'})
    preview = backup.preview('1', archive)
    backup.apply('1', archive, [], [], [], preview_id=preview['preview_id'], profile_fields=['default_duration', 'month_layout', 'day_layout'])
    assert service.state('1')['me']['default_duration'] == 95
    assert service.state('1')['me']['month_layout'] == 'scroll'
    assert service.state('2')['me']['default_duration'] == 60


def test_action_and_reminder_buttons_target_exact_event(service):
    allow_messages(service)
    ev = service.save_event('1', {'title': 'Series', 'start': '2026-10-24T12:00', 'end': '2026-10-24T13:00', 'timezone': 'Europe/Warsaw', 'rrule': 'FREQ=DAILY;COUNT=3'})
    fake = FakeTelegram(); worker = Worker(service, fake); worker.deliver()
    assert parse_qs(urlsplit(fake.sent[-1][3]).query)['event'] == [ev['id']]
    fake.sent.clear()
    begin = datetime(2026, 10, 25, 11, tzinfo=UTC)
    worker.schedule(begin - timedelta(minutes=2)); worker.deliver(begin)
    assert len(fake.sent) == 2
    for msg in fake.sent:
        params = parse_qs(urlsplit(msg[3]).query)
        assert params == {'event': [ev['id']], 'occurrence': ['2026-10-25T12:00']}
        with pytest.raises(Problem): service.get_event('3', params['event'][0], occurrence=params['occurrence'][0])


def test_telegram_button_label_and_url(service):
    class Capture(Telegram):
        def call(self, method, payload): return payload
    bot = Capture(service.config)
    button = bot.send('1', 'Notice', 'ru', 'https://calendar.example/?event=example')['reply_markup']['inline_keyboard'][0][0]
    assert button == {'text': 'Открыть событие', 'web_app': {'url': 'https://calendar.example/?event=example'}}
    assert bot.send('1', 'Welcome', 'en')['reply_markup']['inline_keyboard'][0][0]['text'] == 'Open calendar'


def test_touchbar_personal_defaults_order_and_restore(service, backup):
    default = ['day', 'month', 'settings']
    assert service.state('1')['me']['touch_bar'] == default
    custom = ['categories', 'week', 'day', 'month', 'settings']
    service.settings('1', {'touch_bar': custom})
    assert service.state('1')['me']['touch_bar'] == custom
    assert service.state('2')['me']['touch_bar'] == default
    archive = backup.export('1')
    service.settings('1', {'touch_bar': ['settings']})
    preview = backup.preview('1', archive)
    assert 'touch_bar' in preview['profile']
    backup.apply('1', archive, [], [], [], preview_id=preview['preview_id'], profile_fields=['touch_bar'])
    assert service.state('1')['me']['touch_bar'] == custom
    assert service.state('2')['me']['touch_bar'] == default
    with service.db.transaction() as c:
        prefs = service.user(c, '2'); prefs.pop('id'); prefs.pop('touch_bar')
        c.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), '2'))
    assert service.state('2')['me']['touch_bar'] == default


@pytest.mark.parametrize('items', [None, '', {}, [], ['day'], ['settings', 'day'], ['day', 'day', 'settings'], ['unknown', 'settings'], [True, 'settings'], [['day'], 'settings']])
def test_invalid_touchbar_cannot_hide_settings(service, items):
    before = service.state('1')['me']['touch_bar']
    with pytest.raises(Problem):
        service.settings('1', {'touch_bar': items})
    assert service.state('1')['me']['touch_bar'] == before
