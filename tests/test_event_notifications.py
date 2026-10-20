from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest

from app.bot import Worker
from app.recurrence import UTC
from tests.test_google_import import google, remote  # noqa: F401
from tests.test_icloud_import import linked, event_ics  # noqa: F401
from tests.test_worker_api import FakeTelegram, allow_messages


@pytest.fixture(params=['google', 'icloud'])
def external(request):
    if request.param=='google':
        importer,fake,source=request.getfixturevalue('google')
        account='account'
        fake.items={'visit':remote()}
        def manual():
            preview=importer.preview('1',source,[{'id':key,'scope':'one'} for key in fake.items])
            return importer.apply('1',preview['preview_id'],True)
        def add():fake.items['second']=remote('second',summary='Second appointment')
    else:
        importer,fake,account,source=request.getfixturevalue('linked')
        items=[dict(fake.remote)]
        fake.events=lambda url:list(items)
        def manual():return importer.import_selected('1',source,[item['url'] for item in items],True)
        def add():items.append({**fake.remote,'url':fake.remote['url'].replace('visit.ics','second.ics'),
                                'ics':event_ics('Second appointment')})
    importer.select('1',account,[source],[source])
    return importer,source,manual,add,request.param


@pytest.mark.parametrize('automatic',[False,True])
@pytest.mark.parametrize('batch',[False,True])
def test_import_confirmation_reaches_owner_and_partner_once(external,automatic,batch):
    importer,source,manual,add,provider=external
    service=importer.s;service.settings('1',{'timezone':'Europe/Warsaw'});allow_messages(service)
    if batch:add()
    operation=lambda:importer.sync_source('1',source,True) if automatic else manual()
    assert operation()['created']==(2 if batch else 1)
    with service.db.transaction() as c:
        jobs=c.execute("SELECT * FROM outbox WHERE kind='action'").fetchall()
        assert {job['user_id'] for job in jobs}=={'1','2'}
        assert len(jobs)==2
        assert all(bool(job['event_id'])!=batch for job in jobs)
    fake=FakeTelegram();worker=Worker(service,fake);worker.deliver()
    assert len(fake.sent)==2
    own=next(message for message in fake.sent if message[0]=='1')
    partner=next(message for message in fake.sent if message[0]=='2')
    brand='Apple Calendar (iCloud)' if provider=='icloud' else 'Google Calendar'
    assert brand in own[1] and brand in partner[1]
    assert 'Dentist' in own[1] and 'Dentist' in partner[1]
    assert 'твоё' in own[1].lower() and 'User 1' in partner[1]
    if batch:
        assert 'Second appointment' in own[1] and 'Second appointment' in partner[1]
        assert ': 2' in own[1] and own[3] is None
    else:
        assert 'добавлено из' in own[1] and 'was added from' in partner[1]
        event_id=parse_qs(urlsplit(own[3]).query)['event'][0]
        assert service.get_event('1',event_id)['title']=='Dentist'
        assert '15:00' in own[1] and 'Europe/Warsaw' in own[1]
    assert operation()['created']==0
    worker.deliver();assert len(fake.sent)==2


@pytest.mark.parametrize('muted',['1','2'])
def test_import_respects_each_master_switch(external,muted):
    importer,source,_,_,_=external;service=importer.s
    allow_messages(service);service.settings(muted,{'notifications_enabled':False})
    assert importer.sync_source('1',source,True)['created']==1
    fake=FakeTelegram();Worker(service,fake).deliver()
    assert [message[0] for message in fake.sent]==[{'1':'2','2':'1'}[muted]]


def test_import_does_not_contact_inactive_or_unstarted_chat(external):
    importer,source,_,_,_=external;service=importer.s
    service.membership('2')
    with service.db.transaction() as c:c.execute('DELETE FROM outbox')
    assert importer.sync_source('1',source,True)['created']==1
    with service.db.transaction() as c:
        assert [row['user_id'] for row in c.execute('SELECT * FROM outbox')]==['1']
    fake=FakeTelegram();Worker(service,fake).deliver();assert fake.sent==[]
    with service.db.transaction() as c:
        assert c.execute('SELECT error FROM outbox').fetchone()['error']=='start_bot_required'


@pytest.mark.parametrize('owner',['1','2','both'])
@pytest.mark.parametrize('minutes',[0,60])
def test_reminders_describe_ownership_for_each_recipient(service,owner,minutes):
    service.settings('1',{'name':'Alex','timezone':'Europe/Warsaw'})
    service.settings('2',{'name':'Sam','language':'ru','timezone':'Australia/Melbourne'})
    service.save_event('1',{'title':'Appointment','start':'2026-10-24T12:00','end':'2026-10-24T13:00',
                           'timezone':'Europe/Warsaw','owner':owner})
    allow_messages(service);fake=FakeTelegram();worker=Worker(service,fake)
    due=datetime(2026,10,24,10,tzinfo=UTC)-timedelta(minutes=minutes)
    worker.schedule(due-timedelta(minutes=2));worker.deliver(due)
    assert len(fake.sent)==2
    for user_id,text,lang,url in fake.sent:
        subject='Ваше общее событие' if owner=='both' else 'Твоё событие' if owner==user_id else 'Событие партнёра ('+{'1':'Alex','2':'Sam'}[owner]+')'
        assert (subject if not minutes else 'Напоминание: '+subject[0].lower()+subject[1:])+' «Appointment»' in text
        assert (' начинается' in text)==(minutes==0)
        assert ('21:00' if user_id=='2' else '12:00') in text
        assert url


def test_action_ownership_is_independent_of_author_and_uses_current_profile(service):
    service.settings('1',{'name':'Alex','gender':'female'})
    event=service.save_event('1',{'title':'Partner appointment','owner':'2',
                                'start':'2026-10-24T12:00','end':'2026-10-24T13:00'})
    allow_messages(service)
    service.save_event('1',{'location':'Clinic'},event['id'],event['revision'])
    service.settings('1',{'name':'Alex renamed'})
    fake=FakeTelegram();Worker(service,fake).deliver()
    assert len(fake.sent)==1
    assert 'Alex renamed updated an event' in fake.sent[0][1]
    assert 'Event for: yours' in fake.sent[0][1]


def test_changed_occurrence_uses_latest_ownership_and_translation(service):
    event=service.save_event('1',{'title':'Series','rrule':'FREQ=DAILY;COUNT=2',
                                'start':'2026-10-24T12:00','end':'2026-10-24T13:00',
                                'timezone':'Europe/Warsaw'})
    allow_messages(service);fake=FakeTelegram();worker=Worker(service,fake)
    due=datetime(2026,10,24,10,tzinfo=UTC);worker.schedule(due-timedelta(minutes=2))
    # Ownership/text changes need not invalidate the scheduled timing.
    service.occurrence_change('2',event['id'],'2026-10-24T12:00',
                              {'owner':'2','title':'Moved ownership','translations':{'ru':{'title':'Личный приём'}}},event['revision'])
    worker.schedule(due-timedelta(minutes=1));worker.deliver(due)
    starts=[m for m in fake.sent if 'начинается' in m[1] or 'is starting now' in m[1]]
    assert len(starts)==2
    assert 'Событие партнёра (User 2) «Личный приём»' in next(m[1] for m in starts if m[0]=='1')
    assert 'Your event «Moved ownership»' in next(m[1] for m in starts if m[0]=='2')


def test_batch_summary_is_bounded_and_language_specific(service):
    data={'title':'A'*1000,'translations':{'ru':{'title':'Б'*1000}},'owner':'both'}
    allow_messages(service)
    with service.db.transaction() as c:
        service.notify_import(c,service.calendar(c,'1')['id'],'icloud',[(str(i),data) for i in range(50)])
    fake=FakeTelegram();Worker(service,fake).deliver()
    assert len(fake.sent)==2
    for user_id,text,_,url in fake.sent:
        assert len(text)<4096 and ': 50' in text and url is None
        assert ('И ещё: 42' if user_id=='1' else 'And 42 more') in text
        assert ('Б'*200 if user_id=='1' else 'A'*200) in text
