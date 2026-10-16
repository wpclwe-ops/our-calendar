import pytest
from app.security import Problem
from app.service import load

def test_crud_revision_and_notifications(service,event):
    with service.db.transaction() as c:
        jobs=c.execute("SELECT * FROM outbox WHERE event_id=?",(event['id'],)).fetchall()
        assert [j['user_id'] for j in jobs]==['2']
    service.save_event('2',{'title':'New title'},event['id'],event['revision'])
    with pytest.raises(Problem) as err:service.save_event('1',{'title':'Stale'},event['id'],event['revision'])
    assert err.value.code=='revision_conflict'
    assert service.get_event('1',event['id'])['title']=='New title'
    with service.db.transaction() as c:
        assert c.execute('SELECT COUNT(*) FROM outbox WHERE event_id=?',(event['id'],)).fetchone()[0]==1

def test_own_reminders_only(service,event):
    before=service.get_event('1',event['id'])
    result=service.save_event('1',{'reminders':[15,30]},event['id'],before['revision'])
    assert result['reminders']=={'1':[30,15],'2':[60]}
    with pytest.raises(Problem):service.save_event('1',{'reminders':{'2':[]}},event['id'],result['revision'])

def test_categories_delete_keeps_events(service,event):
    cat=service.save_category('1',{'name':'Plans','color':'#9B77D1'})
    service.save_event('2',{'category_id':cat['id']},event['id'],1)
    service.save_category('2',{},cat['id'],delete=True)
    assert service.get_event('1',event['id'])['category_id'] is None

def test_trash_and_return(service,event):
    service.delete_event('1',event['id'],1)
    assert service.events('1','2026-10-01','2026-11-01')==[]
    assert len(service.events('2',trash=True))==1
    service.delete_event('2',event['id'],2,restore=True)
    assert service.get_event('1',event['id'])['deleted_at'] is None
    service.delete_event('1',event['id'],3)
    service.delete_event('2',event['id'],4,permanent=True)
    with pytest.raises(Problem):service.get_event('1',event['id'])

def test_all_day_floating_dates(service):
    event=service.save_event('1',{'title':'All day','start':'2026-10-25','end':'2026-10-26','all_day':True,'timezone':'Europe/Amsterdam'})
    service.settings('2',{'timezone':'Australia/Melbourne'})
    for person in ('1','2'):
        rows=service.events(person,'2026-10-25','2026-10-26')
        assert rows[0]['start']=='2026-10-25'
        assert 'start_utc' not in rows[0]

def test_dst_validation(service):
    with pytest.raises(Problem) as error:
        service.save_event('1',{'title':'Missing hour','start':'2027-03-28T02:15','end':'2027-03-28T04:00','timezone':'Europe/Warsaw'})
    assert error.value.code=='nonexistent_local_time'
    with pytest.raises(Problem) as error:
        service.save_event('1',{'title':'Ambiguous hour','start':'2026-10-25T02:15','end':'2026-10-25T04:00','timezone':'Europe/Warsaw'})
    assert error.value.code=='ambiguous_local_time_choose_fold'
    service.save_event('1',{'title':'Chosen hour','start':'2026-10-25T02:15','end':'2026-10-25T04:00','fold':1,'timezone':'Europe/Warsaw'})

def test_recurrence_dst_and_status_instance(service):
    ev=service.save_event('1',{'title':'Weekly','start':'2026-10-20T12:00','end':'2026-10-20T13:00','timezone':'Europe/Warsaw','rrule':'FREQ=WEEKLY;COUNT=3'})
    rows=service.events('2','2026-10-19','2026-11-05')
    assert len(rows)==3
    assert rows[0]['start_utc'].endswith('10:00:00+00:00')
    assert rows[1]['start_utc'].endswith('11:00:00+00:00')
    service.occurrence_change('2',ev['id'],'2026-10-27T12:00',{'status':'done'},1)
    rows=service.events('1','2026-10-19','2026-11-05')
    assert [r['status'] for r in rows]==['planned','done','planned']

def test_second_tuesday_and_split(service):
    ev=service.save_event('1',{'title':'Second Tuesday','start':'2026-10-13T12:00','end':'2026-10-13T13:00','rrule':'FREQ=MONTHLY;BYDAY=2TU;COUNT=4'})
    rows=service.events('1','2026-10-01','2027-02-01')
    assert [r['start'][:10] for r in rows]==['2026-10-13','2026-11-10','2026-12-08','2027-01-12']
    service.occurrence_change('1',ev['id'],'2026-11-10T12:00',{'title':'Changed'},1,'following')
    rows=service.events('1','2026-10-01','2027-02-01')
    assert len(rows)==4
    assert [r['title'] for r in rows]==['Second Tuesday','Changed','Changed','Changed']

def test_single_instance_trash(service):
    ev=service.save_event('1',{'title':'Daily','start':'2026-10-20T12:00','end':'2026-10-20T13:00','rrule':'FREQ=DAILY;COUNT=3'})
    service.occurrence_change('1',ev['id'],'2026-10-21T12:00',{},1,'one',delete=True)
    assert len(service.events('1','2026-10-19','2026-10-25'))==2
    trash=service.events('2',trash=True);assert len(trash)==1
    service.trash_occurrence('2',ev['id'],trash[0]['occurrence'],2)
    assert len(service.events('1','2026-10-19','2026-10-25'))==3

def test_following_delete_recoverable(service):
    ev=service.save_event('1',{'title':'Daily','start':'2026-10-20T12:00','end':'2026-10-20T13:00','rrule':'FREQ=DAILY;COUNT=3'})
    service.occurrence_change('1',ev['id'],'2026-10-21T12:00',{},1,'following',delete=True)
    assert len(service.events('1','2026-10-19','2026-10-25'))==1
    trash=service.events('2',trash=True);assert len(trash)==1
    service.delete_event('2',trash[0]['id'],1,restore=True)
    assert len(service.events('1','2026-10-19','2026-10-25'))==3

def test_manual_translation_not_overwritten(service,event):
    e=service.save_event('1',{'translations':{'en':{'title':'Manual','manual':True}}},event['id'],1)
    e=service.save_event('2',{'title':'Новый оригинал'},event['id'],e['revision'])
    assert e['translations']['en']=={'title':'Manual','manual':True,'stale':True}


def test_day_layout_is_personal_persistent_and_validated(service):
    assert service.state('1')['me']['day_layout']=='timeline'
    service.settings('1',{'day_layout':'list'})
    assert service.state('1')['me']['day_layout']=='list'
    assert service.state('1')['me']['view']=='month'
    assert service.state('2')['me']['day_layout']=='timeline'
    for invalid in ('agenda','',None,True,[],{}):
        with pytest.raises(Problem):service.settings('1',{'day_layout':invalid})
    assert service.state('1')['me']['day_layout']=='list'


def test_day_layout_archived_and_restored_for_only_own_profile(service,backup):
    service.settings('1',{'day_layout':'list'})
    blob=backup.export('1')
    service.settings('1',{'day_layout':'timeline'})
    service.settings('2',{'day_layout':'list'})
    preview=backup.preview('1',blob)
    assert preview['profile']['day_layout']=={'current':'timeline','archive':'list'}
    backup.apply('1',blob,[],[],[],preview_id=preview['preview_id'],profile_fields=['day_layout'])
    assert service.state('1')['me']['day_layout']=='list'
    assert service.state('2')['me']['day_layout']=='list'


def test_count_skips_nonexistent_dst_hour_without_losing_occurrence(service):
    service.save_event('1',{'title':'DST count','start':'2027-03-27T02:30','end':'2027-03-27T03:30',
        'timezone':'Europe/Warsaw','rrule':'FREQ=DAILY;COUNT=3'})
    rows=service.events('1','2027-03-26','2027-04-01')
    assert [r['start'][:10] for r in rows]==['2027-03-27','2027-03-29','2027-03-30']
