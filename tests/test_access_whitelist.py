"""The production bot and Mini App are restricted to the two original Telegram IDs."""
from dataclasses import replace
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import ALLOWED_USERS, session_token


def signed_user(user_id, bot_token):
    payload = {'auth_date': str(int(time.time())), 'user': json.dumps({'id': user_id})}
    key = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
    payload['hash'] = hmac.new(
        key, '\n'.join(f'{key}={value}' for key, value in sorted(payload.items())).encode(),
        hashlib.sha256,
    ).hexdigest()
    return urlencode(payload)


def test_only_original_pair_can_authenticate_and_use_api(service):
    assert ALLOWED_USERS == {100000001, 100000002}
    app = create_app(replace(service.config, demo=False), start_worker=False)
    with TestClient(app) as client:
        for user_id in sorted(ALLOWED_USERS):
            res = client.post('/api/auth', json={'init_data': signed_user(user_id, service.config.bot_token)})
            assert res.status_code == 200
            token = res.json()['token']
            assert client.get('/api/state', headers={'Authorization': 'Bearer ' + token}).status_code == 200

        denied = client.post('/api/auth', json={'init_data': signed_user(987654321, service.config.bot_token)})
        assert denied.status_code == 403
        assert denied.json()['error'] == 'access_denied'
        # Reject existing signed sessions even if issued before the whitelist was enabled.
        old_session = session_token('3', service.config.session_secret)
        denied = client.get('/api/state', headers={'Authorization': 'Bearer ' + old_session})
        assert denied.status_code == 403
        assert denied.json()['error'] == 'access_denied'
        with app.state.service.db.transaction() as cursor:
            assert cursor.execute("SELECT 1 FROM users WHERE id='987654321'").fetchone() is None


class RecordingTelegram:
    def __init__(self):
        self.calls = []
        self.sent = []

    def call(self, method, params):
        self.calls.append((method, params))

    def send(self, *args):
        self.sent.append(args)


def test_webhook_replies_plain_denial_without_creating_profile(service):
    app = create_app(replace(service.config, demo=False), start_worker=False)
    telegram = RecordingTelegram()
    app.state.worker.telegram = telegram
    update = {'update_id': 13001, 'message': {
        'chat': {'id': 987654321, 'type': 'private'},
        'from': {'id': 987654321, 'first_name': 'Outsider'},
        'text': '/start',
    }}
    headers = {'X-Telegram-Bot-Api-Secret-Token': service.config.webhook_secret}
    with TestClient(app) as client:
        assert client.post('/api/telegram/webhook', json=update, headers=headers).status_code == 200
        assert client.post('/api/telegram/webhook', json=update, headers=headers).status_code == 200
        with app.state.service.db.transaction() as cursor:
            assert cursor.execute("SELECT 1 FROM users WHERE id='987654321'").fetchone() is None
            assert cursor.execute("SELECT COUNT(*) FROM outbox WHERE kind='access_denied'").fetchone()[0] == 1
        app.state.worker.deliver()
        assert telegram.calls == [('sendMessage', {'chat_id': 987654321, 'text': 'Доступ запрещён'})]
        assert telegram.sent == []


def test_allowed_start_still_opens_calendar(service):
    app = create_app(replace(service.config, demo=False), start_worker=False)
    telegram = RecordingTelegram()
    app.state.worker.telegram = telegram
    update = {'update_id': 13002, 'message': {
        'chat': {'id': 100000001, 'type': 'private'},
        'from': {'id': 100000001, 'first_name': 'Owner', 'language_code': 'ru'},
        'text': '/start',
    }}
    with TestClient(app) as client:
        res = client.post('/api/telegram/webhook', json=update,
                          headers={'X-Telegram-Bot-Api-Secret-Token': service.config.webhook_secret})
        assert res.status_code == 200
        app.state.worker.deliver()
        assert len(telegram.sent) == 1
        assert telegram.sent[0][0] == '100000001'
        assert 'ваш общий календарь' in telegram.sent[0][1]
        assert telegram.calls == []


def test_old_unapproved_recipient_cannot_receive_queued_messages(service):
    app = create_app(replace(service.config, demo=False), start_worker=False)
    telegram = RecordingTelegram()
    app.state.worker.telegram = telegram
    with app.state.service.db.transaction() as cursor:
        app.state.service.enqueue(cursor, None, '3', 'admin',
                                  {'action': 'welcome'}, key='legacy-outsider-test')
    app.state.worker.deliver()
    assert telegram.sent == []
    assert telegram.calls == []
    with app.state.service.db.transaction() as cursor:
        row = cursor.execute("SELECT status FROM outbox WHERE id='legacy-outsider-test'").fetchone()
        assert row['status'] == 'cancelled'
