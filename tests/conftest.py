import pytest
from app.config import Config
from app.db import Database
from app.service import Service
from app.backup import Backups

@pytest.fixture
def service(tmp_path):
    cfg=Config(telegram_owner_id=1,telegram_partner_id=2,
               database=str(tmp_path/'test.db'),bot_username='our_calendar_test_bot',bot_token='test-token',
               session_secret='s'*40,webhook_secret='w'*40,archive_key_file=str(tmp_path/'key.pem'),
               archive_public_keys=str(tmp_path/'keys.json'),public_url='https://calendar.example',demo=True)
    s=Service(Database(cfg.database),cfg)
    with s.db.transaction() as c:
        for i in (1,2,3,4):s.ensure_user(c,{'id':i,'first_name':f'User {i}','language_code':'ru' if i==1 else 'en'})
    s.create_calendar('1');s.join('2',s.invite('1')['token'])
    return s

@pytest.fixture
def event(service):
    return service.save_event('1',{'title':'Together','start':'2026-10-24T12:00','end':'2026-10-24T13:00','timezone':'Europe/Warsaw'})

@pytest.fixture
def backup(service):return Backups(service)
