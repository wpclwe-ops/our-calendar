"""Request bodies are size-limited per route, and private routes reject strangers before reading a body."""

from fastapi.testclient import TestClient

from app.main import JSON_LIMIT, AUTH_LIMIT, create_app
from app.security import session_token


def client_for(service):
    return TestClient(create_app(service.config, start_worker=False))


def auth(service, user='1'):
    return {'Authorization': 'Bearer ' + session_token(user, service.config.session_secret)}


def test_private_route_rejects_stranger_before_reading_body(service):
    with client_for(service) as client:
        # Without the gate this returned 400 preview_required: the body was parsed before auth.
        res = client.post('/api/backup/apply', json={'previewed': False, 'archive': 'x' * (1024 * 1024)})
        assert res.status_code == 401
        res = client.post('/api/events/x/occurrence', content=b'{"x":[' + b'{},' * 100000 + b'{}]}')
        assert res.status_code == 401


def test_ordinary_route_rejects_body_over_json_limit(service):
    with client_for(service) as client:
        res = client.post('/api/events', headers=auth(service), content=b'{"title":"' + b'a' * JSON_LIMIT + b'"}')
        assert res.status_code == 413
        assert res.json()['error'] == 'request_too_large'


def test_chunked_body_without_length_is_still_limited(service):
    def chunks():
        yield b'{"title":"'
        for _ in range(JSON_LIMIT // 1024 + 1):
            yield b'a' * 1024
        yield b'"}'
    with client_for(service) as client:
        res = client.post('/api/events', headers=auth(service), content=chunks())
        assert res.status_code == 413


def test_auth_body_has_small_limit(service):
    with client_for(service) as client:
        res = client.post('/api/auth', json={'init_data': 'a' * (AUTH_LIMIT + 1)})
        assert res.status_code == 413


def test_archive_routes_still_accept_large_bodies(service):
    with client_for(service) as client:
        res = client.post('/api/backup/preview', headers=auth(service), json={'archive': '!' * (2 * JSON_LIMIT)})
        assert res.status_code == 400
        assert res.json()['error'] == 'invalid_archive'


def test_longest_valid_event_still_saves(service):
    long_ru = 'я' * 20000
    data = {'title': 'Т' * 300, 'description': long_ru, 'start': '2026-10-24T12:00', 'end': '2026-10-24T13:00',
            'timezone': 'Europe/Warsaw',
            'translations': {'en': {'title': 'T' * 300, 'description': 'ü' * 20000}}}
    with client_for(service) as client:
        res = client.post('/api/events', headers=auth(service), json=data)
        assert res.status_code == 200, res.text


def test_public_routes_still_work_without_session(service):
    with client_for(service) as client:
        assert client.get('/api/config').status_code == 200
        assert client.post('/api/telegram/webhook', json={}).status_code == 403
        assert client.get('/api/state').status_code == 401
