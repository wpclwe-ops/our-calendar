from dataclasses import replace
from fastapi.testclient import TestClient
from app.setup import create_setup_app,missing_configuration
from app.bot import Worker,TelegramAPIError

def test_setup_has_no_demo_auth_or_calendar_api(monkeypatch):
    monkeypatch.delenv('BOT_TOKEN',raising=False);monkeypatch.delenv('BOT_USERNAME',raising=False)
    with TestClient(create_setup_app()) as client:
        assert client.get('/health').json()['ready'] is False
        assert 'BOT_TOKEN' in missing_configuration()
        assert client.get('/api/config').json()['demo'] is False
        for payload in [{'demo_user':'1'},{'init_data':'signed-with-empty-token'}]:
            assert client.post('/api/auth',json=payload).status_code==503
        assert client.post('/api/telegram/webhook',json={'update_id':1}).status_code==503
        assert client.post('/api/calendar',json={}).status_code==404
        assert client.get('/api/backup.zip').status_code==404
        assert client.get('/').status_code==200

def test_bot_setup_verifies_username_and_is_idempotent(service):
    class Fake:
        def __init__(self):self.calls=[]
        def call(self,method,params):self.calls.append(method);return {'username':'our_calendar_test_bot'}
        def setup(self):self.calls.append('setup')
    service.config=replace(service.config,demo=False,auto_setup_bot=True)
    fake=Fake();worker=Worker(service,fake);worker.configure_bot();worker.configure_bot()
    assert fake.calls==['getMe','setup']
    with service.db.transaction() as c:assert c.execute("SELECT value FROM runtime WHERE key='bot_setup'").fetchone()[0]=='ready'

def test_wrong_bot_never_replaces_webhook(service):
    class Fake:
        def call(self,*args):return {'username':'different_bot'}
        def setup(self):raise AssertionError('Must not alter another bot')
    service.config=replace(service.config,demo=False,auto_setup_bot=True)
    worker=Worker(service,Fake());worker.configure_bot()
    with service.db.transaction() as c:assert c.execute("SELECT value FROM runtime WHERE key='bot_setup'").fetchone()[0]=='username_mismatch'

def test_bot_setup_failure_is_visible_without_crashing(service):
    class Fake:
        def call(self,*args):raise TelegramAPIError(401)
    service.config=replace(service.config,demo=False,auto_setup_bot=True)
    worker=Worker(service,Fake());worker.configure_bot()
    with service.db.transaction() as c:assert c.execute("SELECT value FROM runtime WHERE key='bot_setup'").fetchone()[0]=='telegram_401'
