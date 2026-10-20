import base64
from datetime import datetime
from dataclasses import replace

import pytest

from app.bot import Worker
from app.db import Database
from app.main import create_app
from app.recurrence import UTC
from app.security import Problem
from app.service import dump, load
from app.smart_events import SmartEvents
from fastapi.testclient import TestClient
from tests.test_smart_events import configured, create


def test_own_identity_cannot_mutate_partner(service):
    before=service.state('2')['me']
    state=service.settings('1',{'name':'Test name','gender':'female'})
    assert state['me']['name']=='Test name'
    assert next(v['name'] for v in state['members'] if v['id']=='2')==before['name']
    assert service.state('2')['me']==before
    for changes in ({'user_id':'2','name':'Intruder'},{'partner_name':'Intruder'},{'gender':'other'},{'name':''}):
        with pytest.raises(Problem):service.settings('1',changes)


def test_shared_profile_requires_membership_and_revision_and_survives_restart(service):
    rev=service.state('1')['calendar']['profile_revision']
    value={'name':'Test pair','relationship_started':'2025-02-01'}
    result=service.pair_profile('1',value,rev)
    assert service.state('2')['calendar']['profile']==value
    for actor,version in [('3',rev+1),('1',rev)]:
        with pytest.raises(Problem):service.pair_profile(actor,{'name':'Overwrite'},version)
    with pytest.raises(Problem):service.pair_profile('1',{'name':'x','partner_name':'x'},rev+1)
    with pytest.raises(Problem):service.pair_profile('1',{'relationship_started':'2025-02-30'},rev+1)
    service.db=Database(service.config.database)
    assert service.state('1')['calendar']['profile']==result['calendar']['profile']
    service.membership('2')
    with pytest.raises(Problem):service.pair_profile('2',{'name':'Left'},rev+1)


def test_avatar_is_a_bounded_png_not_a_remote_resource(service):
    rev=service.state('1')['calendar']['profile_revision']
    png='data:image/png;base64,'+base64.b64encode(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBTEAAAAASUVORK5CYII=')).decode()
    assert service.pair_profile('1',{'avatar':png},rev)['calendar']['profile']['avatar']==png
    for avatar in ['https://example.com/photo.png','data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,aGk=', 'x'*350001]:
        with pytest.raises(Problem):service.pair_profile('2',{'avatar':avatar},rev+1)


@pytest.mark.parametrize('values', [[1,2,3],[0,0],[-1],[True],[1.5],['45'],[525601]])
def test_two_defaults_validate_atomically(service,values):
    before=service.state('1')['me']
    with pytest.raises(Problem):service.settings('1',{'default_notifications':values,'name':'Changed'})
    assert service.state('1')['me']==before


def test_defaults_do_not_retroactively_change_events_or_partner(service,event):
    old=service.get_event('1',event['id'])
    partner=service.state('2')['me']
    service.settings('1',{'default_notifications':[45,0]})
    assert service.get_event('1',event['id'])==old
    assert service.state('2')['me']==partner
    new=create(service)
    assert new['reminders']['1']==[45] and new['reminders']['2']==[60]
    assert new['reminder_at_start']=={'1':True}
    service.settings('1',{'default_notifications':[]})
    empty=create(service)
    assert empty['reminders']['1']==[] and empty['reminder_at_start']['1'] is False
    assert service.get_event('1',new['id'])['reminder_at_start']['1'] is True


def test_start_choice_and_legacy_start_are_scheduled_independently(service,event):
    service.settings('1',{'default_notifications':[45]})
    new=create(service)
    worker=Worker(service)
    worker.schedule(datetime(2026,10,24,9,0,tzinfo=UTC))
    with service.db.transaction() as c:
        rows=c.execute("SELECT event_id,user_id,payload FROM outbox WHERE kind='reminder'").fetchall()
    zero={(r['event_id'],r['user_id']) for r in rows if load(r['payload'])['minutes']==0}
    assert (event['id'],'1') in zero  # Existing event retained its legacy start.
    assert (new['id'],'1') not in zero
    assert (new['id'],'2') in zero


def test_occurrence_reminders_do_not_change_partner_start_policy(service):
    service.settings('1',{'default_notifications':[0,30]})
    service.settings('2',{'default_notifications':[0,60]})
    event=create(service,rrule='FREQ=DAILY;COUNT=3')
    key='2026-10-25T12:00'
    service.occurrence_change('1',event['id'],key,{'reminders':[45],'reminders_v2':True},event['revision'],scope='one')
    occurrence=service.get_event('1',event['id'],occurrence=key)['selected_instance']
    assert occurrence['reminder_at_start']=={'1':False,'2':True}
    assert occurrence['reminders']=={'1':[45],'2':[60]}
    assert service.get_event('1',event['id'])['reminder_at_start']=={'1':True,'2':True}


def test_master_notification_switch_cancels_actions_not_admin(service,event):
    service.settings('2',{'notifications_enabled':False})
    with service.db.transaction() as c:
        assert not c.execute("SELECT 1 FROM outbox WHERE user_id='2' AND kind IN ('action','reminder') AND status='pending'").fetchone()
        service.notify(c,service.calendar(c,'1')['id'],'1','created')
        service.notify(c,service.calendar(c,'1')['id'],'1','deletion_requested',admin=True)
        assert c.execute("SELECT 1 FROM outbox WHERE user_id='2' AND kind='admin' AND status='pending'").fetchone()
    assert service.state('1')['me']['notifications_enabled'] is True


@pytest.mark.parametrize('gender,verb',[('female','создала'),('male','создал'),('unspecified','новое событие')])
def test_gender_uses_actor_profile_in_recipient_language(service,event,gender,verb):
    service.settings('1',{'name':'Test','gender':gender})
    worker=Worker(service)
    text=worker.text({'payload':dump({'actor':'1','action':'created','data':event})},{'id':'2','language':'ru','timezone':'UTC'})
    assert 'Test' in text and verb in text


def test_restore_own_preferences_and_shared_profile_without_overwriting_partner(service,backup):
    service.settings('1',{'name':'Archived name','gender':'female','default_notifications':[45,0],'timezone_mode':'auto','reduce_transparency':True})
    revision=service.state('1')['calendar']['profile_revision']
    service.pair_profile('1',{'name':'Archived pair'},revision)
    blob=backup.export('1')
    service.settings('1',{'name':'Current name','default_notifications':[120]})
    service.settings('2',{'name':'Partner current name'})
    service.pair_profile('2',{'name':'Current pair'},revision+1)
    preview=backup.preview('1',blob)
    backup.apply('1',blob,[],[],[],preview_id=preview['preview_id'],profile_fields=['name','default_notifications'],pair_profile_fields=['name'])
    assert service.state('1')['me']['name']=='Archived name'
    assert service.state('1')['me']['default_notifications']==[45,0]
    assert service.state('2')['me']['name']=='Partner current name'
    assert service.state('2')['calendar']['profile']['name']=='Archived pair'
    service.pair_profile('2',{'name':'Before preview'},revision+3)
    preview=backup.preview('1',blob)
    service.pair_profile('2',{'name':'Concurrent pair'},revision+4)
    with pytest.raises(Problem):backup.apply('1',blob,[],[],[],preview_id=preview['preview_id'],pair_profile_fields=['name'])


def test_clear_only_own_rules_without_reprocessing_events(service):
    smart,_=configured(service);event=create(service)
    smart.edit('1',event['id'],event['revision'],short_titles={'ru':'One'},remember=True)
    event=service.get_event('1',event['id'])
    smart.edit('2',event['id'],event['revision'],short_titles={'en':'Two'},remember=True)
    before=service.get_event('1',event['id'])
    assert len(smart.status('1')['rules'])==len(smart.status('2')['rules'])==1
    partner_rule=smart.status('2')['rules'][0]
    with pytest.raises(Problem):smart.rule('1',partner_rule['id'],delete=True)
    assert smart.clear_rules('1')['deleted']==1
    assert smart.status('1')['rules']==[] and len(smart.status('2')['rules'])==1
    assert service.get_event('1',event['id'])==before


def test_settings_endpoints_reject_foreign_identity_and_outsider(service):
    app=create_app(service.config,start_worker=False)
    with TestClient(app) as client:
        def login(user):return {'Authorization':'Bearer '+client.post('/api/auth',json={'demo_user':user}).json()['token']}
        one,three=login('1'),login('3')
        revision=service.state('1')['calendar']['profile_revision']
        assert client.patch('/api/settings',headers=one,json={'user_id':'2','name':'bad'}).status_code==400
        assert client.patch('/api/calendar/profile',headers=three,json={'revision':revision,'changes':{'name':'bad'}}).status_code==404
        assert client.patch('/api/calendar/profile',headers=one,json={'revision':revision,'changes':{'name':'Good'}}).status_code==200
        assert client.delete('/api/smart-events/rules',headers=three).status_code==404


def test_spending_is_scoped_to_the_calendar_and_never_a_limit(service):
    smart,fake=configured(service)
    service.config=replace(service.config,smart_monthly_budget=0)
    smart=SmartEvents(service,fake)
    event=create(service);smart.process()
    assert fake.calls and smart.status('1')['month_reserved_usd']>0
    service.create_calendar('3')
    assert smart.status('3')['month_reserved_usd']==0
    assert smart.status('1')['monthly_limit_usd'] is None


def test_profile_restore_after_full_deletion_preserves_pair_and_pauses_notifications(service,backup):
    from datetime import timedelta
    from app.recurrence import utcnow,stamp
    service.settings('1',{'name':'Original one','gender':'female','default_notifications':[45,0]})
    service.settings('2',{'name':'Original two','gender':'male'})
    service.pair_profile('1',{'name':'Original pair'},1)
    blob=backup.export('1');calendar_id=service.state('1')['calendar']['id']
    service.deletion('1','approve');service.deletion('2','approve')
    with service.db.transaction() as c:c.execute('UPDATE calendars SET delete_at=? WHERE id=?',(stamp(utcnow()-timedelta(seconds=1)),calendar_id))
    service.maintenance()
    request=backup.request_deleted('1',blob);backup.approve_deleted('2',request['id'],True)
    for person,name in [('1','Original one'),('2','Original two')]:
        state=service.state(person)
        assert state['me']['name']==name and state['me']['notifications_enabled'] is False
        assert state['calendar']['profile']['name']=='Original pair'
    assert service.state('1')['me']['default_notifications']==[45,0]
