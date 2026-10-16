from dataclasses import replace
from datetime import datetime,timedelta
import threading
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.security import Problem
from app.service import dump,load
from app.bot import Worker
from app.recurrence import UTC,stamp,utcnow
from app.health import health_status


def series(service,**fields):
    return service.save_event('1',{'title':'Weekly meeting','start':'2026-10-20T12:00','end':'2026-10-20T13:00',
        'timezone':'Europe/Warsaw','rrule':'FREQ=WEEKLY;COUNT=4',**fields})


def test_search_matches_changed_instance_and_its_status_only_once(service):
    e=series(service)
    service.occurrence_change('2',e['id'],'2026-10-27T12:00',{'title':'Special appointment','status':'done'},1)
    result=service.events('1',query='appointment',status='done')
    assert len(result)==1 and result[0]['occurrence']=='2026-10-27T12:00'
    assert service.events('1',query='appointment',status='planned')==[]
    assert len(service.events('1',query='Weekly'))==1
    assert service.get_event('1',e['id'],occurrence=result[0]['occurrence'])['selected_instance']['title']=='Special appointment'


def test_filters_use_effective_category_owner_and_translation(service):
    e=series(service)
    cat=service.save_category('2',{'name':'Врач','color':'#9B77D1','translations':{'en':'Doctor'}})
    service.occurrence_change('2',e['id'],'2026-10-27T12:00',{'category_id':cat['id'],'owner':'2',
        'translations':{'ru':{'title':'Особый приём','manual':True}}},1)
    for q in ('Doctor','приём'):
        results=service.events('1',query=q,owner='2',category=cat['id'])
        assert len(results)==1 and results[0]['occurrence']=='2026-10-27T12:00'
    assert len(service.events('1','2026-10-01','2026-11-01',owner='2',category=cat['id']))==1


def test_search_excludes_deleted_and_purged_exceptions(service):
    e=series(service)
    service.occurrence_change('1',e['id'],'2026-10-27T12:00',{'title':'Hidden'},1)
    service.occurrence_change('1',e['id'],'2026-10-27T12:00',{},2,delete=True)
    assert service.events('1',query='Hidden')==[]
    service.trash_occurrence('2',e['id'],'2026-10-27T12:00',3,permanent=True)
    assert service.events('1',query='Hidden')==[]


def test_search_moved_exception_and_sort_in_viewer_timezone(service):
    e=series(service)
    service.occurrence_change('1',e['id'],'2026-10-27T12:00',{'title':'Moved','start':'2027-01-01T18:00','end':'2027-01-01T19:00'},1)
    result=service.events('2','2027-01-01','2027-01-02',event_id=e['id'])
    assert len(result)==1 and result[0]['title']=='Moved'
    assert service.events('2',query='Moved')[0]['start']=='2027-01-01T18:00'
    a=service.save_event('1',{'title':'Order A','start':'2026-10-24T10:00','end':'2026-10-24T11:00','timezone':'Australia/Melbourne'})
    b=service.save_event('1',{'title':'Order B','start':'2026-10-24T08:00','end':'2026-10-24T09:00','timezone':'UTC'})
    assert [v['id'] for v in service.events('1',query='Order')]==[a['id'],b['id']]


def test_instance_listing_checks_membership_and_calendar_scope(service):
    e=series(service);app=create_app(service.config,start_worker=False)
    with TestClient(app) as client:
        def headers(person):return {'Authorization':'Bearer '+client.post('/api/auth',json={'demo_user':person}).json()['token']}
        path=f"/api/events/{e['id']}/instances?start=2026-10-01&end=2026-11-01"
        assert client.get(path).status_code==401
        assert client.get(path,headers=headers('3')).status_code==404
        assert len(client.get(path,headers=headers('2')).json())==2
        service.membership('2')
        assert client.get(path,headers=headers('2')).status_code==403


def test_individual_reminders_survive_partner_exception_edit(service):
    e=series(service);key='2026-10-27T12:00'
    service.occurrence_change('1',e['id'],key,{'reminders':[30]},1)
    service.occurrence_change('2',e['id'],key,{'reminders':[15]},2)
    assert service.get_event('1',e['id'],occurrence=key)['selected_instance']['reminders']=={'1':[30],'2':[15]}
    with service.db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM outbox WHERE event_id=? AND json_extract(payload,'$.action')='updated'",(e['id'],)).fetchone()[0]==0


def test_exception_title_edit_does_not_notify_partner(service):
    e=series(service)
    service.occurrence_change('1',e['id'],'2026-10-27T12:00',{'title':'Text only'},1)
    with service.db.transaction() as c:
        assert c.execute('SELECT COUNT(*) FROM outbox WHERE event_id=?',(e['id'],)).fetchone()[0]==1


def test_split_returns_new_series_that_can_be_opened(service):
    e=series(service)
    result=service.occurrence_change('1',e['id'],'2026-10-27T12:00',{'title':'Following'},1,'following')
    assert result['id']!=e['id']
    assert service.get_event('1',result['id'])['first_instance']['start']=='2026-10-27T12:00'


def test_zip_can_restore_trashed_event_with_explicit_state_choice(service,backup,event):
    blob=backup.export('1');service.delete_event('1',event['id'],1)
    preview=backup.preview('2',blob)
    assert preview['changes'][0]['fields']['deleted_at']['archive'] is None
    backup.apply('2',blob,[{'id':event['id'],'revision':2,'fields':['deleted_at']}],[],[],preview_id=preview['preview_id'])
    assert service.get_event('1',event['id'])['deleted_at'] is None


def test_health_detects_stopped_worker_and_stale_backup(service):
    service.config=replace(service.config,backup_bucket='configured')
    assert health_status(service)['ready'] is False
    with service.db.transaction() as c:
        c.execute('INSERT INTO runtime VALUES(?,?)',('worker_heartbeat',stamp()))
        c.execute('INSERT INTO runtime VALUES(?,?)',('operator_backup',dump({'state':'ready','last_success':stamp(utcnow()-timedelta(hours=27))})))
    status=health_status(service)
    assert status['ready'] and status['degraded'] and status['backup']['state']=='stale'
    with service.db.transaction() as c:c.execute("UPDATE runtime SET value=? WHERE key='worker_heartbeat'",(stamp(utcnow()-timedelta(seconds=121)),))
    assert health_status(service)['ready'] is False


def test_translation_cannot_block_reminder_worker(service):
    entered=threading.Event();release=threading.Event();worker=Worker(service)
    worker.translations.process=lambda: (entered.set(),release.wait(3))
    try:
        worker.start();assert entered.wait(1)
        deadline=threading.Event()
        for _ in range(50):
            if health_status(service)['ready']:break
            deadline.wait(.02)
        assert health_status(service)['ready']
    finally:release.set();worker.stop()


def test_split_with_full_form_payload_preserves_remaining_count(service):
    e=series(service)
    result=service.occurrence_change('1',e['id'],'2026-10-27T12:00',{'title':'Following','rrule':e['rrule']},1,'following')
    rows=service.events('1','2026-10-01','2027-02-01')
    assert len(rows)==4
    assert len([r for r in rows if r['id']==result['id']])==3
