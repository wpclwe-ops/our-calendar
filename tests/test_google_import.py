from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from urllib.parse import parse_qs, urlparse
import json
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from app.google_import import GoogleImports, snapshot
from app.providers.google import SCOPES
from app.providers.http import ProviderFailure
from app.service import dump,load
from app.security import Problem,digest
from app.recurrence import stamp,utcnow
from app.main import create_app


def remote(id='visit',**changes):
    return {'id':id,'etag':'v1','summary':'Dentist','description':'Details','location':'Clinic',
            'status':'confirmed','start':{'dateTime':'2026-10-24T15:00:00+02:00','timeZone':'Europe/Warsaw'},
            'end':{'dateTime':'2026-10-24T16:00:00+02:00','timeZone':'Europe/Warsaw'},**changes}


class FakeGoogle:
    def __init__(self):
        self.items={'visit':remote(),'private':remote('private',summary='Never share this')}
        self.calls=[];self.fail=None;self.token_number=0
    def __call__(self,token):return self
    def identity(self):return {'sub':'account-one','email':'test@example.com','email_verified':True}
    def calendars(self):
        self.calls.append('calendars')
        return [{'id':'personal','summary':'Personal','timeZone':'Europe/Warsaw','accessRole':'owner'},
                {'id':'busy','summary':'Only busy','accessRole':'freeBusyReader'}]
    def event(self,calendar_id,id):
        self.calls.append(('GET',id))
        if self.fail:raise self.fail
        if id not in self.items:raise ProviderFailure(404)
        return deepcopy(self.items[id])
    def events(self,calendar_id,sync_token=None,allowed_ids=None):
        self.calls.append(('GET-delta',sync_token))
        if self.fail:raise self.fail
        self.token_number+=1
        return {'items':[deepcopy(v) for v in self.items.values() if allowed_ids is None or v['id'] in allowed_ids or v.get('recurringEventId') in allowed_ids],
                'sync_token':'cursor-'+str(self.token_number),'reset':sync_token=='expired'}
    def browse(self,calendar_id,page=None,parent=None,start=None,end=None):
        items=[v for v in self.items.values() if not parent or v.get('recurringEventId')==parent]
        return {'items':deepcopy(items)}


class FakeOAuth:
    def start(self):
        import secrets
        return {'state':secrets.token_urlsafe(32),'verifier':'verifier','url':'https://accounts.google.com/o/oauth2/v2/auth'}
    def exchange(self,code,verifier):
        assert verifier=='verifier'
        return {'access_token':'secret-access','refresh_token':'secret-refresh','expires_in':3600,'scope':' '.join(SCOPES)}
    def refresh(self,token):
        return {'access_token':'fresh-secret','expires_in':3600}


@pytest.fixture
def google(provider_clock, service):
    service.config=replace(service.config,google_client_id='test-client',google_client_secret='test-secret',google_credential_key=Fernet.generate_key().decode())
    fake=FakeGoogle();g=GoogleImports(service,FakeOAuth(),fake)
    with service.db.transaction() as c:
        cal=service.calendar(c,'1')
        c.execute('INSERT INTO google_accounts(id,user_id,calendar_id,subject,email,credentials) VALUES(?,?,?,?,?,?)',
                  ('account','1',cal['id'],'account-one','test@example.com',g.vault.encrypt({'access_token':'secret-access','refresh_token':'secret-refresh','expires_at':stamp(utcnow()+timedelta(hours=1))})))
    sources=g.calendars('1','account');g.select('1','account',[sources[0]['id']])
    return g,fake,sources[0]['id']


def imported(google,id='visit',scope='one'):
    g,_,source=google
    p=g.preview('1',source,[{'id':id,'scope':scope}]);g.apply('1',p['preview_id'],True)
    with g.s.db.transaction() as c:return dict(c.execute('SELECT * FROM google_links WHERE source_id=? AND remote_id=?',(source,id)).fetchone())


def test_import_uses_personal_two_notification_defaults_only_at_creation(google):
    g,f,source=google
    g.s.settings('1',{'default_notifications':[45,0]})
    g.s.settings('2',{'default_notifications':[]})
    link=imported(google)
    event=g.s.get_event('1',link['event_id'])
    assert event['reminders']=={'1':[45],'2':[]}
    assert event['reminder_at_start']=={'1':True,'2':False}
    g.s.settings('1',{'default_notifications':[15]})
    f.items['visit']['summary']='Updated source title'
    f.items['visit']['etag']='v2'
    imported(google)
    updated=g.s.get_event('1',link['event_id'])
    assert updated['reminders']==event['reminders']
    assert updated['reminder_at_start']==event['reminder_at_start']


def test_private_selection_and_owner_boundary(google):
    g,f,source=google
    assert len(g.browse('1',source)['items'])==2
    assert g.s.events('2','2026-10-01','2026-11-01')==[]
    assert g.status('2')['accounts']==[]
    for method,args in [(g.calendars,('2','account')),(g.browse,('2',source)),(g.preview,('2',source,[{'id':'visit','scope':'one'}])),(g.disconnect,('2','account')),(g.browse,('3',source))]:
        with pytest.raises(Problem):method(*args)
    link=imported(google)
    rows=g.s.events('2','2026-10-01','2026-11-01')
    assert len(rows)==1 and rows[0]['title']=='Dentist'
    assert 'Never share this' not in dump(rows)
    assert 'secret' not in dump(g.status('1'))
    assert 'test@example.com' not in dump(g.s.get_event('2',link['event_id']))
    with pytest.raises(Problem):g.conflict('2',link['id'])


def test_preview_confirmation_replay_and_no_duplicates(google):
    g,f,source=google
    p=g.preview('1',source,[{'id':'visit','scope':'one'}])
    with pytest.raises(Problem):g.apply('2',p['preview_id'],True)
    with pytest.raises(Problem):g.apply('1',p['preview_id'],False)
    assert g.apply('1',p['preview_id'],True)['created']==1
    with pytest.raises(Problem):g.apply('1',p['preview_id'],True)
    p=g.preview('1',source,[{'id':'visit','scope':'one'}]);assert p['items'][0]['existing']
    assert g.apply('1',p['preview_id'],True)=={'created':0,'reconnected':0,'existing':1}
    with g.s.db.transaction() as c:assert c.execute('SELECT COUNT(*) FROM events').fetchone()[0]==1


def test_stale_preview_and_invalid_text_are_not_silent(google):
    g,f,source=google
    p=g.preview('1',source,[{'id':'visit','scope':'one'}]);f.items['visit']['summary']='Changed'
    with pytest.raises(Problem) as e:g.apply('1',p['preview_id'],True)
    assert e.value.code=='google_preview_changed'
    f.items['visit']['summary']='x'*301
    with pytest.raises(Problem):g.preview('1',source,[{'id':'visit','scope':'one'}])
    assert g.s.events('1','2026-10-01','2026-11-01')==[]


def test_google_html_descriptions_are_cleaned_before_preview_import_and_sync(google):
    g,f,source=google
    f.items['visit']['description']='<p>Участие подтверждено. <b>Бесплатно</b></p><p>Контакт: biuro@example.com</p>'
    preview=g.preview('1',source,[{'id':'visit','scope':'one'}])
    assert preview['items'][0]['description']=='Участие подтверждено. Бесплатно\n\nКонтакт: biuro@example.com'
    g.apply('1',preview['preview_id'],True)
    with g.s.db.transaction() as c:
        row=c.execute("SELECT event_id FROM google_links WHERE source_id=? AND remote_id='visit'",(source,)).fetchone()
        jobs=c.execute("SELECT payload FROM translation_jobs WHERE kind='event' AND resource_id=?",(row['event_id'],)).fetchall()
    assert g.s.get_event('1',row['event_id'])['description']==preview['items'][0]['description']
    if jobs:
        assert '<p>' not in dump([load(job['payload']) for job in jobs])
    f.items['visit']['description']='<p>Flight &amp; hotel<br>New line</p>'
    f.items['visit']['etag']='v2'
    assert g.sync_source('1',source,True)['state']=='ready'
    assert g.s.get_event('1',row['event_id'])['description']=='Flight & hotel\nNew line'

def test_automatic_updates_merge_local_changes_and_preserve_reminders(google):
    g,f,source=google;link=imported(google);eid=link['event_id']
    ev=g.s.get_event('1',eid)
    g.s.save_event('2',{'location':'New clinic','reminders':[15]},eid,ev['revision'])
    f.items['visit']['description']='New Google notes';f.items['visit']['etag']='v2'
    f.items['visit']['start']['dateTime']='2026-10-24T17:00:00+02:00'
    f.items['visit']['end']['dateTime']='2026-10-24T18:00:00+02:00'
    assert g.sync_source('1',source,True)['state']=='ready'
    ev=g.s.get_event('1',eid)
    assert ev['description']=='New Google notes' and ev['location']=='New clinic'
    assert ev['reminders']['2']==[15]
    assert f.items['visit']['location']=='Clinic'
    assert g.status('1')['accounts'][0]['sources'][0]['links'][0]['state']=='local_changes'
    with g.s.db.transaction() as c:
        jobs=c.execute("SELECT * FROM outbox WHERE json_extract(payload,'$.action')='google_updated'").fetchall()
        assert {v['user_id'] for v in jobs}=={'1','2'}
    revision=ev['revision'];g.sync_source('1',source,True)
    assert g.s.get_event('1',eid)['revision']==revision


def test_real_conflict_requires_owner_and_fresh_versions(google):
    g,f,source=google;link=imported(google);eid=link['event_id']
    g.s.save_event('2',{'location':'Local clinic'},eid,1)
    f.items['visit']['location']='Google clinic';g.sync_source('1',source,True)
    conflict=g.conflict('1',link['id']);assert conflict['state']=='conflict'
    assert g.s.get_event('1',eid)['location']=='Local clinic'
    with pytest.raises(Problem):g.resolve('2',link['id'],'google',conflict['revision'],conflict['remote_version'])
    f.items['visit']['location']='Newer Google clinic'
    with pytest.raises(Problem) as exc:g.resolve('1',link['id'],'google',conflict['revision'],conflict['remote_version'])
    assert exc.value.code=='google_preview_changed'
    latest=g.conflict('1',link['id'])
    g.resolve('1',link['id'],'google',latest['revision'],latest['remote_version'])
    assert g.s.get_event('2',eid)['location']=='Newer Google clinic'
    assert f.items['visit']['location']=='Newer Google clinic'


def test_keep_local_then_new_remote_change_conflicts_again(google):
    g,f,source=google;link=imported(google)
    g.s.save_event('2',{'description':'Local'},link['event_id'],1)
    f.items['visit']['description']='Remote';g.sync_source('1',source,True)
    c=g.conflict('1',link['id']);g.resolve('1',link['id'],'local',c['revision'],c['remote_version'])
    g.sync_source('1',source,True)
    assert g.conflict('1',link['id'])['state']=='local_changes'
    f.items['visit']['description']='Remote again';g.sync_source('1',source,True)
    assert g.conflict('1',link['id'])['state']=='conflict'


@pytest.mark.parametrize('choice',['local','trash'])
def test_external_deletion_keeps_event_until_owner_decision(google,choice):
    g,f,source=google;link=imported(google)
    f.items['visit']={'id':'visit','status':'cancelled','etag':'deleted'}
    g.sync_source('1',source,True)
    assert g.s.get_event('2',link['event_id'])['title']=='Dentist'
    c=g.conflict('1',link['id']);assert c['state']=='remote_deleted'
    g.resolve('1',link['id'],choice,c['revision'],c['remote_version'])
    if choice=='trash':assert g.s.get_event('2',link['event_id'],True)['deleted_at']
    else:assert g.s.get_event('2',link['event_id'])['title']=='Dentist'
    assert f.items['visit']['status']=='cancelled'


def test_disconnect_reconnect_requires_manual_selection_without_duplicates(google):
    g,f,source=google;link=imported(google)
    g.disconnect('1','account');assert g.s.get_event('2',link['event_id'])
    with pytest.raises(Problem):g.sync_source('1',source,True)
    with g.s.db.transaction() as c:
        c.execute("UPDATE google_accounts SET state='connected',credentials=?,generation=generation+1 WHERE id='account'",
                  (g.vault.encrypt({'access_token':'new','expires_at':stamp(utcnow()+timedelta(hours=1))}),))
    g.select('1','account',[source]);g.sync_source('1',source,True)
    assert g.conflict('1',link['id'])['state']=='disconnected'
    p=g.preview('1',source,[{'id':'visit','scope':'one'}]);assert g.apply('1',p['preview_id'],True)['reconnected']==1
    with g.s.db.transaction() as c:assert c.execute('SELECT COUNT(*) FROM events').fetchone()[0]==1


def test_local_trash_and_restore_never_reactivate_external_link(google):
    g,f,source=google;link=imported(google)
    g.s.delete_event('2',link['event_id'],1);g.s.delete_event('2',link['event_id'],2,restore=True)
    f.items['visit']['summary']='Changed in Google';g.sync_source('1',source,True)
    assert g.s.get_event('1',link['event_id'])['title']=='Dentist'


def test_leave_invalidates_credentials_pending_selections_and_return(google):
    g,f,source=google;link=imported(google)
    p=g.preview('1',source,[{'id':'visit','scope':'one'}]);g.s.membership('1')
    with g.s.db.transaction() as c:
        a=c.execute('SELECT * FROM google_accounts').fetchone();assert a['credentials'] is None
    assert g.s.get_event('2',link['event_id'])
    g.s.membership('1',True)
    assert g.status('1')['accounts'][0]['state']=='disconnected'
    with pytest.raises(Problem):g.apply('1',p['preview_id'],True)


def test_locked_calendar_cancels_inflight_read_and_resumes_safely(google):
    g,f,source=google;link=imported(google)
    g.s.deletion('1','approve');g.s.deletion('2','approve')
    before=len(f.calls);g.run_due();assert len(f.calls)==before
    with pytest.raises(Problem):g.browse('1',source)
    g.s.deletion('1','cancel');f.items['visit']['summary']='After pause';g.sync_source('1',source,True)
    assert g.s.get_event('1',link['event_id'])['title']=='After pause'


def test_retry_restart_and_invalid_cursor_do_not_lose_events(google):
    g,f,source=google;link=imported(google)
    f.fail=ProviderFailure(429,120)
    with pytest.raises(Problem):g.sync_source('1',source,True)
    assert g.s.get_event('1',link['event_id'])
    with g.s.db.transaction() as c:
        row=c.execute('SELECT * FROM google_sources WHERE id=?',(source,)).fetchone();assert row['attempts']==1 and row['lease_until'] is None
        c.execute("UPDATE google_sources SET sync_token='expired' WHERE id=?",(source,))
    f.fail=None;f.items['visit']['summary']='After restart'
    restarted=GoogleImports(g.s,FakeOAuth(),f);restarted.sync_source('1',source,True)
    assert restarted.s.get_event('1',link['event_id'])['title']=='After restart'


def test_all_day_and_series_exceptions_and_individual_occurrence(google):
    g,f,source=google
    f.items['day']=remote('day',start={'date':'2026-10-25'},end={'date':'2026-10-27'})
    day=imported(google,'day');g.s.settings('2',{'timezone':'Australia/Melbourne'})
    assert g.s.get_event('2',day['event_id'])['start']=='2026-10-25'
    f.items['series']=remote('series',recurrence=['RRULE:FREQ=DAILY;COUNT=3'])
    f.items['moved']=remote('moved',recurringEventId='series',originalStartTime={'dateTime':'2026-10-25T15:00:00+01:00'},
                            start={'dateTime':'2026-10-26T18:00:00+01:00'},end={'dateTime':'2026-10-26T19:00:00+01:00'})
    f.items['removed']={'id':'removed','recurringEventId':'series','status':'cancelled','originalStartTime':{'dateTime':'2026-10-26T15:00:00+01:00'}}
    series=imported(google,'series','series')
    rows=g.s.events('2','2026-10-24','2026-10-28',event_id=series['event_id'])
    assert len(rows)==2
    assert any(v['start']=='2026-10-26T18:00:00' for v in rows)
    assert not any(v['start']=='2026-10-26T15:00' for v in rows)
    f.items['single']=remote('single',recurringEventId='other-series',originalStartTime={'dateTime':'2026-10-24T15:00:00+02:00'})
    single=imported(google,'single','one');assert not g.s.get_event('1',single['event_id'])['rrule']


def test_complex_recurrence_rejected_instead_of_silently_lost(google):
    g,f,source=google
    f.items['bad']=remote('bad',recurrence=['RRULE:FREQ=DAILY','EXDATE:20261025T150000Z'])
    assert next(v for v in g.browse('1',source)['items'] if v['id']=='bad')['supported'] is False
    with pytest.raises(Problem):g.preview('1',source,[{'id':'bad','scope':'series'}])


def test_oauth_callback_needs_original_telegram_confirmation_and_is_one_use(google):
    g,f,source=google
    captured={}
    old=g.oauth.start
    def start():
        value=old();captured.update(value);return value
    g.oauth.start=start;g.start('1')
    g.callback(captured['state'],'code')
    assert g.status('1')['confirmation']=={'email':'test@example.com'}
    assert g.status('2')['confirmation'] is None
    with pytest.raises(Problem):g.confirm_account('2',True)
    with pytest.raises(Problem):g.callback(captured['state'],'code')
    g.confirm_account('1',True)
    assert g.status('1')['accounts'][0]['sources'][0]['selected']==0
    assert g.status('1')['accounts'][0]['mode']=='import_only'
    with g.s.db.transaction() as c:
        db=' '.join(v[0] or '' for v in c.execute('SELECT credentials FROM google_accounts'))
        assert 'secret-access' not in db and 'secret-refresh' not in db


@pytest.mark.parametrize('reason,expected',[
    ('invalid_client','google_oauth_token_invalid_client'),
    ('missing_scopes','google_oauth_token_missing_scopes'),
    ('private-token','google_oauth_token_unavailable'),
])
def test_callback_failure_identifies_stage_and_clears_pending_credentials(google,reason,expected):
    g,f,_=google
    attempt=g.oauth.start()
    g.oauth.start=lambda:attempt
    g.start('1')
    def reject(*args):raise ProviderFailure(401,reason=reason)
    g.oauth.exchange=reject
    with pytest.raises(Problem) as failure:g.callback(attempt['state'],'private-code')
    assert failure.value.code==expected
    assert g.status('1')['confirmation'] is None
    with g.s.db.transaction() as c:
        row=c.execute('SELECT state,secret FROM google_oauth_requests').fetchone()
        assert row['state']=='failed' and row['secret'] is None


def test_callback_page_explains_server_credentials_without_exposing_request_or_secrets(google,caplog):
    g,_,_=google
    app=create_app(g.s.config,start_worker=False)
    def reject(*args):raise Problem(503,'google_oauth_token_invalid_client','private-secret')
    app.state.google.callback=reject
    with TestClient(app) as client:
        response=client.get('/api/google/callback?state=private-state&code=private-code')
    assert 'Client Secret' in response.text and 'google_oauth_token_invalid_client' in response.text
    assert all(secret not in response.text+caplog.text for secret in ('private-code','private-state','private-secret'))
    assert 'google_oauth_token_invalid_client' in caplog.text


def test_archive_has_no_google_credentials_or_links(google):
    from app.backup import Backups
    g,_,_=google;link=imported(google)
    archive=Backups(g.s);data=archive.verify(archive.export('1'))
    assert all(v not in dump(data) for v in ('secret-access','secret-refresh','test@example.com','google_accounts','google_links'))


def test_google_api_has_no_write_routes_and_owner_only(google):
    g,f,source=google
    app=create_app(g.s.config,start_worker=False)
    # Replace the live instance's dependencies, preserving endpoint references.
    app.state.google.provider=f;app.state.google.oauth=FakeOAuth()
    with TestClient(app) as client:
        auth=lambda user:{'Authorization':'Bearer '+client.post('/api/auth',json={'demo_user':user}).json()['token']}
        h1,h2=auth('1'),auth('2')
        assert client.get('/api/google',headers=h2).json()['accounts']==[]
        assert client.get('/api/google/sources/'+source+'/events',headers=h2).status_code==404
        p=client.post('/api/google/sources/'+source+'/preview',headers=h1,json={'selections':[{'id':'visit','scope':'one'}]}).json()
        assert client.post('/api/google/import',headers=h1,json={'preview_id':p['preview_id'],'confirmed':True}).json()['created']==1
        assert client.post('/api/google/accounts/account/export',headers=h1,json={}).status_code==404
        assert client.patch('/api/google/accounts/account',headers=h1,json={'mode':'two_way'}).status_code in (404,405)


def test_push_is_authenticated_generation_bound_and_only_schedules_a_read(google):
    g,f,source=google
    captured={}
    def watch(calendar_id,channel,token,address,expiration):
        captured.update(channel=channel,token=token,address=address)
        # Google can send the initial message before watch() returns.
        assert g.pushed({'x-goog-channel-id':channel,'x-goog-channel-token':token,'x-goog-resource-id':'resource'})['ok']
        return {'resourceId':'resource','expiration':expiration}
    f.watch_events=watch
    g.ensure_watch('1',source)
    with g.s.db.transaction() as c:c.execute('UPDATE google_sources SET next_at=? WHERE id=?',(stamp(utcnow()+timedelta(hours=1)),source))
    headers={'x-goog-channel-id':captured['channel'],'x-goog-channel-token':captured['token'],'x-goog-resource-id':'resource'}
    with pytest.raises(Problem):g.pushed({**headers,'x-goog-channel-token':'forged'})
    with pytest.raises(Problem):g.pushed({**headers,'x-goog-resource-id':'wrong'})
    assert g.pushed(headers)['ok']
    with g.s.db.transaction() as c:assert c.execute('SELECT next_at FROM google_sources WHERE id=?',(source,)).fetchone()[0]==''
    before=dict(captured);g.ensure_watch('1',source);assert captured==before
    g.select('1','account',[])
    assert g.pushed(headers)['ok']  # Old channel ignored after deselection.
    assert not any(v[0] not in ('GET','GET-delta') for v in f.calls if isinstance(v,tuple))


def test_push_failure_keeps_polling_and_does_not_create_retry_storm(google):
    g,f,source=google;imported(google)
    calls=[]
    def failed(*args):calls.append(args);raise ProviderFailure(503)
    f.watch_events=failed
    g.run_due();g.run_due()
    assert len(calls)==1
    assert g.s.events('2','2026-10-01','2026-11-01')


def test_bad_event_does_not_block_other_links_or_advance_away_from_retry(google):
    g,f,source=google;bad=imported(google)
    f.items['good']=remote('good');good=imported(google,'good')
    f.items['visit']['recurrence']=['RRULE:FREQ=DAILY','EXDATE:20261025T150000Z']
    f.items['good']['location']='New room'
    assert g.sync_source('1',source,True)['state']=='ready'
    assert g.s.get_event('1',good['event_id'])['location']=='New room'
    assert g.s.get_event('1',bad['event_id'])['title']=='Dentist'
    with g.s.db.transaction() as c:assert c.execute('SELECT state FROM google_links WHERE id=?',(bad['id'],)).fetchone()[0]=='unsupported'
    del f.items['visit']['recurrence'];f.items['visit']['summary']='Now supported'
    g.sync_source('1',source,True)
    assert g.s.get_event('1',bad['event_id'])['title']=='Now supported'


def test_disconnect_during_network_read_discards_import(google):
    g,f,source=google
    original=f.event
    def disconnect_during_read(*args):
        result=original(*args);g.disconnect('1','account');return result
    f.event=disconnect_during_read
    with pytest.raises(Problem):g.preview('1',source,[{'id':'visit','scope':'one'}])
    assert not g.s.events('2','2026-10-01','2026-11-01')


def test_expired_oauth_and_preview_are_rejected(google):
    g,f,source=google
    p=g.preview('1',source,[{'id':'visit','scope':'one'}])
    with g.s.db.transaction() as c:c.execute('UPDATE google_previews SET expires_at=?',(stamp(utcnow()-timedelta(seconds=1)),))
    with pytest.raises(Problem):g.apply('1',p['preview_id'],True)
    data=g.oauth.start()
    g.oauth.start=lambda:data;g.start('1')
    with g.s.db.transaction() as c:c.execute('UPDATE google_oauth_requests SET expires_at=?',(stamp(utcnow()-timedelta(seconds=1)),))
    with pytest.raises(Problem):g.callback(data['state'],'code')


def test_revoked_refresh_token_reports_reconnect(google):
    g,f,source=google;link=imported(google)
    with g.s.db.transaction() as c:
        c.execute('UPDATE google_accounts SET credentials=?',(g.vault.encrypt({'access_token':'old','refresh_token':'revoked','expires_at':'2000-01-01'}),))
    def revoked(token):raise ProviderFailure(400)
    g.oauth.refresh=revoked
    with pytest.raises(Problem) as exc:g.sync_source('1',source,True)
    assert exc.value.code=='google_reconnect'
    assert g.status('1')['accounts'][0]['state']=='needs_reconnect'
    assert g.s.get_event('2',link['event_id'])


def test_series_and_single_instance_cannot_be_imported_twice(google):
    g,f,source=google
    f.items['series']=remote('series',recurrence=['RRULE:FREQ=DAILY;COUNT=3'])
    f.items['child']=remote('child',recurringEventId='series',originalStartTime={'dateTime':'2026-10-24T15:00:00+02:00'})
    imported(google,'series','series')
    with pytest.raises(Problem) as exc:g.preview('1',source,[{'id':'child','scope':'one'}])
    assert exc.value.code=='google_series_overlap'


def test_new_unselected_events_stay_private_and_local_fields_never_write_google(google):
    g,f,source=google;link=imported(google)
    f.items['new-private']=remote('new-private',summary='New private event')
    g.s.settings('1',{'language':'en'})
    g.s.save_event('2',{'status':'done','title':'Our private label','reminders':[30]},link['event_id'],1)
    before=deepcopy(f.items)
    g.sync_source('1',source,True)
    assert f.items==before
    shared=g.s.events('2','2026-10-01','2026-11-01')
    assert len(shared)==1 and shared[0]['title']=='Our private label'
    assert shared[0]['status']=='done'
    assert 'New private event' not in dump(shared)


def test_google_deletion_tombstone_disappearing_does_not_trap_owner(google):
    g,f,source=google;link=imported(google)
    f.items['visit']={'id':'visit','status':'cancelled'};g.sync_source('1',source,True)
    conflict=g.conflict('1',link['id']);del f.items['visit']
    g.resolve('1',link['id'],'local',conflict['revision'],conflict['remote_version'])
    assert g.s.get_event('2',link['event_id'])['title']=='Dentist'


def test_unsafe_dst_series_is_explicitly_rejected(google):
    g,f,source=google
    f.items['dst']=remote('dst',recurrence=['RRULE:FREQ=WEEKLY;COUNT=3'],
                         start={'dateTime':'2026-03-22T01:30:00+01:00','timeZone':'Europe/Warsaw'},
                         end={'dateTime':'2026-03-22T02:30:00+01:00','timeZone':'Europe/Warsaw'})
    with pytest.raises(Problem) as exc:g.preview('1',source,[{'id':'dst','scope':'series'}])
    assert exc.value.code=='google_unsupported_recurrence'
    assert not g.s.events('2','2026-03-01','2026-04-01')


def test_auto_import_requires_owner_opt_in_and_imports_new_events_without_duplication(google):
    g,f,source=google
    assert g.status('1')['accounts'][0]['sources'][0]['auto_import']==0
    f.items['test']=remote('test',summary='Automatic test',
        start={'dateTime':'2099-11-01T19:00:00Z','timeZone':'UTC'},
        end={'dateTime':'2099-11-01T20:00:00Z','timeZone':'UTC'})
    f.items['old']=remote('old',summary='Past private meeting',
        start={'dateTime':'2001-01-01T10:00:00Z','timeZone':'UTC'},
        end={'dateTime':'2001-01-01T11:00:00Z','timeZone':'UTC'})
    assert g.sync_source('1',source,True)['created']==0
    assert g.s.events('2','2099-11-01','2099-11-03')==[]
    with pytest.raises(Problem):
        g.select('2','account',[source],[source])
    with pytest.raises(Problem):
        g.select('1','account',[source],['not-owned'])
    g.select('1','account',[source],[source])
    assert g.status('1')['accounts'][0]['sources'][0]['auto_import']==1
    assert g.sync_source('1',source,True)['created']==3  # visit, private, test
    shared=g.s.events('2','2099-11-01','2099-11-03')
    assert len(shared)==1 and shared[0]['title']=='Automatic test'
    with g.s.db.transaction() as c:
        assert c.execute("SELECT COUNT(*) FROM google_links WHERE source_id=?",(source,)).fetchone()[0]==3
        assert c.execute("SELECT COUNT(*) FROM google_links WHERE remote_id='old'").fetchone()[0]==0
    assert g.sync_source('1',source,True)['created']==0
    assert len(g.s.events('2','2099-11-01','2099-11-03'))==1
    g.select('1','account',[source],[])
    f.items['another']=remote('another',summary='Should stay private',
        start={'dateTime':'2099-11-02T09:00:00Z','timeZone':'UTC'},
        end={'dateTime':'2099-11-02T10:00:00Z','timeZone':'UTC'})
    assert g.sync_source('1',source,True)['created']==0
    assert len(g.s.events('2','2099-11-01','2099-11-03'))==1


def test_auto_import_drains_large_batches_and_isolates_unsupported_events(google):
    g,f,source=google
    f.items.clear()
    for number in range(23):
        event_id=f'future-{number:02}'
        f.items[event_id]=remote(event_id,summary=event_id,
            start={'dateTime':f'2099-11-{number+1:02}T10:00:00Z','timeZone':'UTC'},
            end={'dateTime':f'2099-11-{number+1:02}T11:00:00Z','timeZone':'UTC'})
    f.items['future-00']['eventType']='unsupported'
    g.select('1','account',[source],[source])
    assert g.sync_source('1',source,True)['created']==19
    with g.s.db.transaction() as c:
        assert c.execute('SELECT sync_token FROM google_sources WHERE id=?',(source,)).fetchone()[0] is None
        assert c.execute('SELECT etag FROM google_auto_skips WHERE source_id=? AND remote_id=?',(source,'future-00')).fetchone()[0]=='v1'
    assert g.sync_source('1',source,True)['created']==3
    assert g.sync_source('1',source,True)['created']==0
    with g.s.db.transaction() as c:
        assert c.execute('SELECT COUNT(*) FROM google_links WHERE source_id=?',(source,)).fetchone()[0]==22
    f.items['future-00']['eventType']='default'
    f.items['future-00']['etag']='v2'
    assert g.sync_source('1',source,True)['created']==1
    assert len(g.s.events('2','2099-11-01','2099-12-01'))==23


def test_auto_import_cannot_restore_disconnected_records_or_reenable_on_reconnect(google):
    g,f,source=google
    link=imported(google)
    g.select('1','account',[source],[source])
    g.disconnect('1','account')
    assert g.status('1')['accounts'][0]['sources'][0]['auto_import']==0
    assert g.s.get_event('2',link['event_id'])
    assert g.status('1')['accounts'][0]['sources'][0]['links'][0]['state']=='disconnected'

