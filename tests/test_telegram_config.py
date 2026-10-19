"""Synthetic identities only; production data and Telegram are never contacted."""
from dataclasses import replace
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.backup import Backups
from app.bot import Worker
from app.config import Config, MAX_TELEGRAM_USER_ID
from app.db import Database
from app.main import create_app
from app.recurrence import UTC
from app.security import Problem
from app.service import Service, dump
from test_access_whitelist import RecordingTelegram, signed_user


@pytest.mark.parametrize('name', ['TELEGRAM_OWNER_ID', 'TELEGRAM_PARTNER_ID'])
@pytest.mark.parametrize('value', [None, '', '0', '-1', '1.2', '1e3', 'true', ' 1',
                                 '1\n', '+1', '١', '9' * 100, str(1 << 52)])
def test_environment_fails_closed_without_echoing_values(monkeypatch, tmp_path, name, value):
    monkeypatch.setenv('DEMO_MODE', 'false')
    monkeypatch.setenv('TELEGRAM_OWNER_ID', '101')
    monkeypatch.setenv('TELEGRAM_PARTNER_ID', '202')
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'never-created' / 'db.sqlite3'))
    if value is None:
        monkeypatch.delenv(name)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(ValueError) as error:
        create_app(start_worker=False)
    assert name in str(error.value)
    assert not (tmp_path / 'never-created').exists()
    if value and len(value) > 5:
        assert value not in str(error.value)


def test_env_loads_ids_centrally_and_never_in_public_config(service, monkeypatch):
    for name, value in {
        'DEMO_MODE': 'false', 'TELEGRAM_OWNER_ID': '1', 'TELEGRAM_PARTNER_ID': '2',
        'DATABASE_PATH': service.config.database, 'BOT_TOKEN': 'test-token',
        'BOT_USERNAME': 'test_bot', 'PUBLIC_URL': 'https://calendar.example',
        'SESSION_SECRET': 's' * 40, 'WEBHOOK_SECRET': 'w' * 40,
    }.items():
        monkeypatch.setenv(name, value)
    config = Config.env()
    assert config.telegram_user_ids == {'1', '2'}
    assert 'telegram_owner_id' not in repr(config)
    app = create_app(replace(config, archive_key_file=service.config.archive_key_file,
                             archive_public_keys=service.config.archive_public_keys), start_worker=False)
    with TestClient(app) as client:
        assert not any('telegram' in name or 'owner' in name or 'partner' in name
                       for name in client.get('/api/config').json())
    monkeypatch.setenv('TELEGRAM_OWNER_ID', '3')
    assert config.telegram_user_ids == {'1', '2'}  # Snapshot until a validated restart.


def test_pair_validation_and_telegram_range(service):
    with pytest.raises(ValueError, match='must differ'):
        replace(service.config, telegram_partner_id=1, demo=False)
    for value in (True, False, 0, -1, 1.5, MAX_TELEGRAM_USER_ID + 1):
        with pytest.raises(ValueError):
            replace(service.config, telegram_owner_id=value, demo=False)
    assert replace(service.config, telegram_partner_id=MAX_TELEGRAM_USER_ID).is_allowed_user(
        str(MAX_TELEGRAM_USER_ID))
    with pytest.raises(ValueError):
        Config(demo=False)


def test_changed_variables_never_replace_pair_or_modify_records(service, event):
    # First production start validates a legacy DB, then pins its whitelist.
    config = replace(service.config, demo=False)
    Service(service.db, config)
    with service.db.transaction() as cursor:
        before = '\n'.join(cursor.iterdump())
    for owner, partner in ((1, 3), (3, 4)):
        with pytest.raises(ValueError, match='saved pair'):
            Service(service.db, replace(config, telegram_owner_id=owner, telegram_partner_id=partner))
    with service.db.transaction() as cursor:
        assert '\n'.join(cursor.iterdump()) == before
    # Labels are not database slots: swapping names does not reverse ownership.
    restarted = Service(service.db, replace(config, telegram_owner_id=2, telegram_partner_id=1))
    assert restarted.state('1')['calendar']['first_id'] == '1'
    assert restarted.state('1')['calendar']['second_id'] == '2'
    assert restarted.get_event('2', event['id'])['title'] == 'Together'


def test_legacy_database_mismatch_fails_before_binding(service):
    config = replace(service.config, demo=False, telegram_partner_id=3)
    with pytest.raises(ValueError, match='saved pair'):
        Service(service.db, config)
    with service.db.transaction() as cursor:
        assert cursor.execute("SELECT 1 FROM runtime WHERE key='telegram_pair'").fetchone() is None


@pytest.mark.parametrize('creator,joiner', [('1', '2'), ('2', '1')])
def test_production_invitation_preserves_initial_pair(service, tmp_path, creator, joiner):
    config = replace(service.config, demo=False, database=str(tmp_path / 'production-test.db'))
    app = create_app(config, start_worker=False)
    with TestClient(app) as client:
        headers = {}
        for person in (creator, joiner):
            auth = client.post('/api/auth', json={'init_data': signed_user(int(person), config.bot_token)})
            assert auth.status_code == 200
            headers[person] = {'Authorization': 'Bearer ' + auth.json()['token']}
        assert client.post('/api/calendar', headers=headers[creator]).status_code == 200
        invite = client.post('/api/invite', headers=headers[creator]).json()['token']
        denied = client.post('/api/auth', json={'init_data': signed_user(3, config.bot_token)})
        assert denied.status_code == 403
        assert client.post('/api/join', json={'token': invite}, headers=headers[joiner]).status_code == 200
        assert client.post('/api/join', json={'token': invite}, headers=headers[joiner]).status_code != 200
    s = app.state.service
    s.membership(joiner)
    with pytest.raises(Problem):
        s.invite(creator)
    with pytest.raises(Problem, match='access_denied'):
        with s.db.transaction() as cursor:
            s.ensure_user(cursor, {'id': 3})
    s.membership(joiner, returning=True)
    assert s.state(joiner)['calendar']['first_id'] == creator
    assert s.state(joiner)['calendar']['second_id'] == joiner


def test_production_notifications_go_to_saved_recipients_and_stop_after_leaving(service, event):
    s = Service(service.db, replace(service.config, demo=False))
    fake = RecordingTelegram()
    worker = Worker(s, fake)
    with s.db.transaction() as cursor:
        cursor.execute('DELETE FROM outbox')
        for person in ('1', '2'):
            prefs = s.user(cursor, person)
            prefs.pop('id')
            prefs['bot_can_message'] = True
            cursor.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), person))
        s.enqueue(cursor, None, '3', 'admin', {'action': 'welcome'}, key='unapproved')
    begin = datetime(2026, 10, 24, 10, tzinfo=UTC)
    worker.schedule(begin - timedelta(minutes=2))
    worker.deliver(begin)
    assert sorted(message[0] for message in fake.sent) == ['1', '2']
    fake.sent.clear()
    s.membership('2')
    s.save_event('1', {'location': 'Home'}, event['id'], 1)
    worker.deliver()
    assert fake.sent == []
    s.membership('2', returning=True)
    s.save_event('1', {'location': 'Office'}, event['id'], 2)
    worker.deliver()
    assert [message[0] for message in fake.sent] == ['2']


def test_binding_survives_full_deletion_and_zip_requires_original_consents(service, event):
    config = replace(service.config, demo=False)
    s = Service(service.db, config)
    backups = Backups(s)
    blob = backups.export('1')
    calendar_id = s.state('1')['calendar']['id']
    s.deletion('1', 'approve')
    s.deletion('2', 'approve')
    with s.db.transaction() as cursor:
        cursor.execute('UPDATE calendars SET delete_at=?', ('2000-01-01T00:00:00+00:00',))
    s.maintenance()
    assert s.state('1')['calendar'] is None
    with pytest.raises(ValueError, match='saved pair'):
        Service(s.db, replace(config, telegram_partner_id=3))
    s = Service(s.db, config)
    backups = Backups(s)
    with pytest.raises(Problem):
        backups.request_deleted('3', blob)
    request = backups.request_deleted('1', blob)
    backups.approve_deleted('1', request['id'], True)
    assert s.state('1')['calendar'] is None
    backups.approve_deleted('2', request['id'], True)
    for person in ('1', '2'):
        state = s.state(person)
        assert state['calendar']['id'] == calendar_id
        assert not state['me']['notifications_enabled']
        assert not state['me']['reminders_enabled']
        assert s.get_event(person, event['id'])['reminders'] == {'1': [60], '2': [60]}


def test_pending_restore_mismatch_and_other_pairs_archive_are_rejected(service, event, tmp_path):
    # A legacy DB may have no calendar but a pending restore. Validate that too.
    blob = Backups(service).export('1')
    with service.db.transaction() as cursor:
        cursor.execute('DELETE FROM calendars')
    Backups(service).request_deleted('1', blob)
    with pytest.raises(ValueError, match='saved pair'):
        Service(service.db, replace(service.config, demo=False, telegram_partner_id=3))
    # Authentic archives of a different pair cannot introduce that pair here.
    config = replace(service.config, database=str(tmp_path / 'other.db'), demo=False, telegram_partner_id=3)
    other = Service(Database(config.database), config)
    with pytest.raises(Problem, match='archive_wrong_pair'):
        Backups(other).request_deleted('1', blob)
