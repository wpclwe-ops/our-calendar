from dataclasses import replace
from datetime import timedelta
import pytest
from cryptography.fernet import Fernet
from app.icloud_import import ICloudImports, parse_resource
from app.security import Problem
from app.service import load
from app.recurrence import stamp, utcnow


def event_ics(title='Dentist', start='20261024T150000', recurring=False):
    rr = 'RRULE:FREQ=WEEKLY;COUNT=3\r\n' if recurring else ''
    return ('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:visit@example.com\r\n'
            'DTSTART;TZID=Europe/Warsaw:'+start+'\r\n'
            'DTEND;TZID=Europe/Warsaw:20261024T160000\r\n'
            'SUMMARY:'+title+'\r\n'+rr+'END:VEVENT\r\nEND:VCALENDAR\r\n')


class FakeICloud:
    def __init__(self):
        self.remote={'url':'https://p42-caldav.icloud.com/123/events/visit.ics',
                     'ics':event_ics(),'etag':'v1'}
        self.calls=[]
        self.fail=None
    def __call__(self,email,password):
        assert email=='me@example.com' and password=='abcd-efgh-ijkl-mnop'
        return self
    def discover(self):
        self.calls.append('discover')
        if self.fail:raise self.fail
        return [{'url':'https://p42-caldav.icloud.com/123/events/','name':'Personal'}]
    def events(self,url):
        self.calls.append('events')
        if self.fail:raise self.fail
        return [dict(self.remote)] if self.remote else []


@pytest.fixture
def linked(service):
    service.config=replace(service.config,icloud_credential_key=Fernet.generate_key().decode())
    fake=FakeICloud()
    importer=ICloudImports(service,provider=fake)
    importer.connect('1','me@example.com','abcd-efgh-ijkl-mnop')
    a=importer.status('1')['accounts'][0]
    sources=importer.calendars('1',a['id'])
    return importer,fake,a['id'],sources[0]['id']


def test_ical_timezone_and_rrule():
    item={'ics':event_ics(recurring=True),'etag':'v1','url':'https://p42-caldav.icloud.com/a.ics'}
    out=parse_resource(item,'UTC')
    assert out['fields']['timezone']=='Europe/Warsaw'
    assert out['fields']['start']=='2026-10-24T15:00:00'
    assert out['fields']['rrule']=='FREQ=WEEKLY;COUNT=3'


def test_selection_is_private_and_auto_import_is_opt_in(linked):
    g,_,account,source=linked
    assert g.status('2')['accounts']==[]
    assert g.status('1')['accounts'][0]['sources'][0]['auto_import']==0
    with pytest.raises(Problem):g.calendars('2',account)
    with pytest.raises(Problem):g.sync_source('2',source,True)
    with pytest.raises(Problem):g.sync_source('1',source,True)
    g.select('1',account,[source],[])
    assert g.sync_source('1',source,True)['created']==0
    assert not g.s.events('2','2026-10-01','2026-11-01')
    g.select('1',account,[source],[source])
    assert g.sync_source('1',source,True)['created']==1
    events=g.s.events('2','2026-10-01','2026-11-01')
    assert len(events)==1 and events[0]['title']=='Dentist'
    assert 'abcd-efgh' not in str(g.status('1'))
    with g.s.db.transaction() as c:
        saved=c.execute('SELECT credentials FROM icloud_accounts WHERE id=?',(account,)).fetchone()['credentials']
        assert 'abcd-efgh' not in saved
    assert g.sync_source('1',source,True)['created']==0
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1


def test_remote_update_and_deletion_preserve_shared_event(linked):
    g,f,account,source=linked
    g.select('1',account,[source],[source])
    g.sync_source('1',source,True)
    f.remote['ics']=event_ics('Changed title')
    f.remote['etag']='v2'
    assert g.sync_source('1',source,True)['created']==0
    events=g.s.events('2','2026-10-01','2026-11-01')
    assert events[0]['title']=='Changed title'
    f.remote=None
    g.sync_source('1',source,True)
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1
    with g.s.db.transaction() as c:
        link=c.execute('SELECT state FROM icloud_links WHERE source_id=?',(source,)).fetchone()
        assert link['state']=='remote_deleted'


def test_disconnect_does_not_delete_events_or_reimport(linked):
    g,f,account,source=linked
    g.select('1',account,[source],[source])
    g.sync_source('1',source,True)
    g.disconnect('1',account)
    assert g.status('1')['accounts'][0]['sources'][0]['auto_import']==0
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1
    g.connect('1','me@example.com','abcd-efgh-ijkl-mnop')
    sources=g.calendars('1',account)
    g.select('1',account,[source],[source])
    assert g.sync_source('1',source,True)['created']==0
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1


def test_unsupported_event_does_not_import(linked):
    g,f,account,source=linked
    g.select('1',account,[source],[source])
    f.remote['ics']=event_ics().replace('DTEND;TZID=Europe/Warsaw:20261024T160000\r\n','')
    assert g.sync_source('1',source,True)['state']=='unsupported'
    assert not g.s.events('2','2026-10-01','2026-11-01')


def test_manual_import_requires_explicit_confirmation(linked):
    g,f,account,source=linked
    g.select('1',account,[source],[])
    event_id=f.remote['url']
    assert g.browse('1',source)['items'][0]['title']=='Dentist'
    with pytest.raises(Problem):g.browse('2',source)
    with pytest.raises(Problem):g.import_selected('2',source,[event_id],True)
    with pytest.raises(Problem):g.import_selected('1',source,[event_id],False)
    assert g.import_selected('1',source,[event_id],True)['created']==1
    assert g.import_selected('1',source,[event_id],True)['existing']==1
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1


def test_icloud_conflict_is_owner_resolved_without_remote_writes(linked):
    g,f,account,source=linked
    g.select('1',account,[source],[source])
    g.sync_source('1',source,True)
    with g.s.db.transaction() as c:
        link=dict(c.execute('SELECT * FROM icloud_links WHERE source_id=?',(source,)).fetchone())
    g.s.save_event('2',{'title':'Shared edit'},link['event_id'],1)
    f.remote['ics']=event_ics('Apple edit');f.remote['etag']='v2'
    g.sync_source('1',source,True)
    review=g.conflict('1',link['id'])
    assert review['state']=='conflict'
    assert g.s.get_event('1',link['event_id'])['title']=='Shared edit'
    with pytest.raises(Problem):g.resolve('2',link['id'],'icloud',review['revision'],review['remote_version'])
    assert g.resolve('1',link['id'],'icloud',review['revision'],review['remote_version'])['ok']
    assert g.s.get_event('1',link['event_id'])['title']=='Apple edit'
    assert 'Apple edit' in f.remote['ics']


def test_leave_revokes_icloud_credentials_and_auto_consent(linked):
    g,f,account,source=linked
    g.select('1',account,[source],[source])
    g.sync_source('1',source,True)
    g.s.membership('1')
    with g.s.db.transaction() as c:
        row=c.execute('SELECT * FROM icloud_accounts WHERE id=?',(account,)).fetchone()
        assert row['credentials'] is None and row['state']=='disconnected'
        selected=c.execute('SELECT auto_import,selected FROM icloud_sources WHERE id=?',(source,)).fetchone()
        assert selected['auto_import']==0 and selected['selected']==0
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1
    g.s.membership('1',True)
    assert g.status('1')['accounts'][0]['state']=='disconnected'
