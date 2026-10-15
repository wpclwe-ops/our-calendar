from dataclasses import replace
from datetime import datetime,timedelta
from fastapi.testclient import TestClient
import pytest
from app.bot import Worker,TelegramAPIError
from app.main import create_app
from app.service import load,dump
from app.recurrence import UTC,stamp

class FakeTelegram:
    def __init__(self):self.sent=[]
    def send(self,*args):self.sent.append(args)

def test_reminders_dedupe_reschedule_and_no_past(service):
    ev=service.save_event('1',{'title':'Soon','start':'2026-10-24T12:00','end':'2026-10-24T13:00','timezone':'Europe/Warsaw'})
    worker=Worker(service,FakeTelegram());now=datetime(2026,10,24,8,0,tzinfo=UTC)
    worker.schedule(now);worker.schedule(now)
    with service.db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM outbox WHERE kind='reminder' AND status='pending'").fetchone()[0]==2
    service.save_event('1',{'start':'2026-10-24T14:00','end':'2026-10-24T15:00'},ev['id'],1)
    worker.schedule(now)
    with service.db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM outbox WHERE kind='reminder' AND status='pending'").fetchone()[0]==2
        assert c.execute("SELECT COUNT(*) FROM outbox WHERE kind='reminder' AND status='cancelled'").fetchone()[0]==2
    worker.schedule(now+timedelta(days=1))
    # Expired jobs are not delivered late.
    worker.deliver(now+timedelta(days=1))
    assert worker.telegram.sent==[]

def test_all_day_reminder_midnight_each_recipient(service):
    service.settings('1',{'timezone':'Europe/Warsaw'});service.settings('2',{'timezone':'Australia/Melbourne'})
    service.save_event('1',{'title':'Day','start':'2026-10-25','end':'2026-10-26','all_day':True})
    worker=Worker(service,FakeTelegram());worker.schedule(datetime(2026,10,23,0,0,tzinfo=UTC))
    with service.db.transaction() as c:jobs=c.execute("SELECT * FROM outbox WHERE kind='reminder' ORDER BY user_id").fetchall()
    assert jobs[0]['due']=='2026-10-24T21:00:00+00:00'
    assert jobs[1]['due']=='2026-10-24T12:00:00+00:00'

def test_notifications_language_and_bot_consent(service,event):
    fake=FakeTelegram();worker=Worker(service,fake)
    worker.deliver()
    assert not fake.sent
    with service.db.transaction() as c:
        prefs=service.user(c,'2');prefs.pop('id');prefs['bot_can_message']=True
        c.execute('UPDATE users SET data=? WHERE id=?',(dump(prefs),'2'))
    e=service.get_event('1',event['id']);service.save_event('1',{'location':'Home'},event['id'],e['revision'])
    worker.deliver()
    assert fake.sent[0][0]=='2'
    assert fake.sent[0][1].startswith('Event updated:')

def test_webhook_idempotence(service):
    fake=FakeTelegram();worker=Worker(service,fake)
    update={'update_id':111,'message':{'chat':{'id':1,'type':'private'},'from':{'id':1,'first_name':'A'},'text':'/start'}}
    worker.webhook(update);worker.webhook(update)
    with service.db.transaction() as c:assert c.execute("SELECT COUNT(*) FROM outbox WHERE id='start:111'").fetchone()[0]==1
    worker.deliver()
    assert sum('ваш общий календарь' in message[1] for message in fake.sent)==1

def test_http_auth_idor_and_security_headers(service):
    app=create_app(service.config,start_worker=False)
    with TestClient(app) as client:
        assert client.get('/api/state').status_code==401
        r=client.post('/api/auth',json={'demo_user':'3'});token=r.json()['token'];headers={'Authorization':'Bearer '+token}
        assert client.get('/api/events?start=2026-10-01&end=2026-11-01',headers=headers).status_code==404
        assert client.post('/api/telegram/webhook',json={'update_id':1}).status_code==403
        r=client.get('/');assert r.status_code==200
        assert 'Content-Security-Policy' in r.headers and r.headers['x-content-type-options']=='nosniff'
        assert client.get('/health').json()['ok']

def test_production_never_accepts_demo_identity(service):
    app=create_app(replace(service.config,demo=False),start_worker=False)
    with TestClient(app) as client:
        assert client.post('/api/auth',json={'demo_user':'1'}).status_code==401
        assert client.post('/api/auth',json={'demo_user':'1'},headers={'Origin':'https://evil.example'}).status_code==403

def test_retry_does_not_extend_original_reminder_deadline(service):
    from app.bot import TelegramAPIError
    class RateLimited:
        def send(self,*args):raise TelegramAPIError(429,120)
    service.save_event('1',{'title':'Soon','start':'2026-10-24T12:00','end':'2026-10-24T13:00','timezone':'Europe/Warsaw'})
    with service.db.transaction() as c:
        c.execute("DELETE FROM outbox WHERE kind!='reminder'")
        for person in ('1','2'):
            prefs=service.user(c,person);prefs.pop('id');prefs['bot_can_message']=True
            c.execute('UPDATE users SET data=? WHERE id=?',(dump(prefs),person))
    worker=Worker(service,RateLimited());due=datetime(2026,10,24,9,0,tzinfo=UTC)
    worker.schedule(due-timedelta(hours=1));worker.deliver(due)
    fake=FakeTelegram();worker.telegram=fake;worker.deliver(due+timedelta(seconds=120))
    assert fake.sent==[]
    with service.db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM outbox WHERE kind='reminder' AND status='expired'").fetchone()[0]==2
