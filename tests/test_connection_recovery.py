"""Failure/recovery acceptance with synthetic providers; no live credentials."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from dataclasses import replace
from cryptography.fernet import Fernet
import pytest
from test_google_import import google, imported, FakeOAuth
from test_icloud_import import linked, event_ics
from app.google_import import GoogleImports
from app.icloud_import import ICloudImports
from app.providers.http import ProviderFailure
from app.providers.vault import CredentialVault
from app.connection_recovery import recover_legacy
from app.security import Problem
from app.recurrence import stamp, utcnow


def account_row(g,provider,account):
    with g.s.db.transaction() as c:
        return dict(c.execute(f'SELECT * FROM {provider}_accounts WHERE id=?',(account,)).fetchone())


def expire(g):
    with g.s.db.transaction() as c:
        secret=g.vault.decrypt(c.execute("SELECT credentials FROM google_accounts WHERE id='account'").fetchone()['credentials'])
        secret['expires_at']='2000-01-01'
        c.execute("UPDATE google_accounts SET credentials=? WHERE id='account'",(g.vault.encrypt(secret),))


def test_google_api_401_refreshes_once_and_keeps_links_and_consent(google):
    g,f,source=google
    link=imported(google)
    g.select('1','account',[source],[source])
    calls=[]
    def refresh(token):
        calls.append(token);f.fail=None
        return {'access_token':'renewed','expires_in':3600}
    g.oauth.refresh=refresh;f.fail=ProviderFailure(401)
    assert g.sync_source('1',source,True)['state']=='ready'
    assert calls==['secret-refresh']
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected' and a['sources'][0]['auto_import']==1
    assert g.s.get_event('1',link['event_id'])
    assert g.vault.decrypt(account_row(g,'google','account')['credentials'])['refresh_token']=='secret-refresh'


def test_google_second_api_401_does_not_revoke_valid_refresh_grant(google):
    g,f,source=google;link=imported(google);calls=[]
    g.oauth.refresh=lambda token:(calls.append(token) or {'access_token':'renewed','expires_in':3600})
    f.fail=ProviderFailure(401)
    with pytest.raises(Problem) as failure:g.sync_source('1',source,True)
    assert failure.value.code=='google_delayed'
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected' and a['sources'][0]['state']=='delayed'
    assert calls==['secret-refresh'] and g.s.get_event('1',link['event_id'])
    f.fail=None
    assert g.sync_source('1',source,True)['state']=='ready'


@pytest.mark.parametrize('failure,code',[
    (ProviderFailure(400),'provider_unavailable'),
    (ProviderFailure(401),'api_auth'),
    (ProviderFailure(401,reason='invalid_client'),'oauth_configuration'),
    (ProviderFailure(400,reason='invalid_request'),'oauth_configuration'),
    (ProviderFailure(503),'provider_unavailable'),
    (ProviderFailure(429,retry_after=600),'provider_unavailable'),
])
def test_google_refresh_errors_are_not_mistaken_for_revocation(google,failure,code):
    g,f,source=google;expire(g)
    def reject(token):raise failure
    g.oauth.refresh=reject
    with pytest.raises(Problem):g.sync_source('1',source,True)
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected' and a['sources'][0]['last_error']==code
    assert a['sources'][0]['next_at']>stamp(utcnow())
    assert account_row(g,'google','account')['credentials']


def test_google_parallel_refresh_uses_latest_saved_credentials(google):
    g,f,source=google;expire(g);calls=[]
    def refresh(token):
        calls.append(token)
        return {'access_token':'rotated-access','refresh_token':'rotated-refresh','expires_in':3600}
    g.oauth.refresh=refresh
    snapshot=account_row(g,'google','account')
    second=GoogleImports(g.s,g.oauth,f)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(lambda n:(g if n%2 else second).credentials(snapshot),range(8)))
    assert len(calls)==1
    assert all(v['access_token']=='rotated-access' and v['refresh_token']=='rotated-refresh' for v in results)


def test_google_disconnect_during_refresh_cannot_resurrect_account(google):
    g,f,source=google;expire(g)
    def refresh(token):
        g.disconnect('1','account')
        return {'access_token':'new','expires_in':3600}
    g.oauth.refresh=refresh
    with pytest.raises(Problem):g.sync_source('1',source,True)
    a=account_row(g,'google','account')
    assert a['state']=='disconnected' and a['credentials'] is None
    assert g.status('1')['accounts'][0]['sources'][0]['selected']==0


@pytest.mark.parametrize('provider', ['google','icloud'])
def test_wrong_encryption_key_stays_server_error(google,linked,provider):
    g,f,source=google if provider=='google' else (linked[0],linked[1],linked[3])
    account='account' if provider=='google' else linked[2]
    if provider=='icloud':g.select('1',account,[source],[source])
    g.vault=CredentialVault(Fernet.generate_key())
    with pytest.raises(Problem):g.sync_source('1',source,True)
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected'
    assert a['sources'][0]['last_error']=='credential_storage'
    assert account_row(g,provider,account)['credentials']


def test_google_refresh_over_nine_days_and_restart_keeps_single_event(google,monkeypatch):
    import app.google_import as module
    g,f,source=google;link=imported(google)
    recover_legacy(g.s,'google');start=utcnow();calls=[]
    def refresh(token):
        calls.append(token);return {'access_token':'fresh-'+str(len(calls)),'expires_in':3600}
    g.oauth.refresh=refresh
    for day in range(1,10):
        monkeypatch.setattr(module,'utcnow',lambda day=day:start+timedelta(days=day))
        restarted=GoogleImports(g.s,g.oauth,f)
        assert restarted.sync_source('1',source,True)['state']=='ready'
        assert restarted.status('1')['accounts'][0]['state']=='connected'
    assert len(calls)==9 and set(calls)=={'secret-refresh'}
    with g.s.db.transaction() as c:
        assert c.execute('SELECT count(*) FROM google_links').fetchone()[0]==1
        assert c.execute('SELECT count(*) FROM events').fetchone()[0]==1
    assert g.s.get_event('2',link['event_id'])


def test_icloud_single_collection_401_recovers_without_password_entry(linked):
    g,f,account,source=linked;g.select('1',account,[source],[source])
    original=f.events;calls=[]
    def once(url):
        calls.append(url)
        if len(calls)==1:raise ProviderFailure(401)
        return original(url)
    f.events=once
    assert g.sync_source('1',source,True)['state']=='ready'
    assert len(calls)==2
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected' and a['sources'][0]['auto_import']==1


def test_icloud_collection_denied_but_account_valid_keeps_other_sources_running(linked):
    g,f,account,source=linked;g.select('1',account,[source],[source])
    def denied(url):raise ProviderFailure(401)
    f.events=denied
    with pytest.raises(Problem) as error:g.sync_source('1',source,True)
    assert error.value.code=='icloud_delayed'
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected' and a['sources'][0]['state']=='unavailable'
    assert account_row(g,'icloud',account)['auth_failures']==0


def test_icloud_requires_spaced_root_auth_failures_and_survives_restart(linked,monkeypatch):
    import app.icloud_import as module
    g,f,account,source=linked;g.select('1',account,[source],[source])
    recover_legacy(g.s,'icloud');start=utcnow();f.fail=ProviderFailure(401)
    for seconds,expected in [(0,'connected'),(0,'connected'),(61,'connected'),(122,'needs_reconnect')]:
        monkeypatch.setattr(module,'utcnow',lambda seconds=seconds:start+timedelta(seconds=seconds))
        g=ICloudImports(g.s,f)
        with pytest.raises(Problem) as error:g.sync_source('1',source,True)
        assert account_row(g,'icloud',account)['state']==expected
        assert error.value.code==('icloud_reconnect' if expected=='needs_reconnect' else 'icloud_delayed')
    assert account_row(g,'icloud',account)['auth_failures']==3
    with g.s.db.transaction() as c:
        c.execute("UPDATE icloud_sources SET next_at='' WHERE id=?",(source,))
    calls=len(f.calls);g.run_due()
    assert len(f.calls)==calls


def test_icloud_temporary_root_failure_recovers_and_resets_auth_counter(linked,monkeypatch):
    g,f,account,source=linked;g.select('1',account,[source],[source])
    f.fail=ProviderFailure(401)
    with pytest.raises(Problem):g.sync_source('1',source,True)
    assert account_row(g,'icloud',account)['auth_failures']==1
    f.fail=None
    restarted=ICloudImports(g.s,f)
    assert restarted.sync_source('1',source,True)['state']=='ready'
    assert account_row(g,'icloud',account)['auth_failures']==0
    assert len(g.s.events('2','2026-10-01','2026-11-01'))==1


def test_icloud_host_rediscovery_preserves_links_without_duplicates(linked):
    g,f,account,source=linked;g.select('1',account,[source],[source]);g.sync_source('1',source,True)
    old='https://p42-caldav.icloud.com/123/events/'
    new='https://p43-caldav.icloud.com/123/events/'
    f.discover=lambda:[{'url':new,'name':'Personal'}]
    def moved(url):
        if url==old:raise ProviderFailure(401)
        assert url==new
        return [{**f.remote,'url':new+'visit.ics'}]
    f.events=moved
    assert g.sync_source('1',source,True)['created']==0
    a=g.status('1')['accounts'][0]
    assert a['state']=='connected' and a['sources'][0]['auto_import']==1
    with g.s.db.transaction() as c:
        assert c.execute('SELECT remote_id FROM icloud_sources WHERE id=?',(source,)).fetchone()[0]==new
        assert c.execute('SELECT remote_id FROM icloud_links').fetchone()[0]==new+'visit.ics'
        assert c.execute('SELECT count(*) FROM events').fetchone()[0]==1


@pytest.mark.parametrize('destination',[
    'https://evil.example/123/events/',
    'https://p43-caldav.icloud.com/456/different/',
])
def test_icloud_discovery_never_rebinds_by_name_or_untrusted_host(linked,destination):
    g,f,account,source=linked;g.select('1',account,[source],[source]);g.sync_source('1',source,True)
    f.discover=lambda:[{'url':destination,'name':'Personal'}]
    def denied(url):raise ProviderFailure(401)
    f.events=denied
    with pytest.raises(Problem):g.sync_source('1',source,True)
    with g.s.db.transaction() as c:
        assert c.execute('SELECT remote_id FROM icloud_sources').fetchone()[0].startswith('https://p42-')
        assert c.execute('SELECT count(*) FROM events').fetchone()[0]==1


@pytest.mark.parametrize('provider',['google','icloud'])
def test_legacy_recovery_once_preserves_selection_but_never_restores_explicit_disconnect(google,linked,provider):
    g,f,source=google if provider=='google' else (linked[0],linked[1],linked[3])
    account='account' if provider=='google' else linked[2]
    g.select('1',account,[source],[source])
    with g.s.db.transaction() as c:
        c.execute(f"UPDATE {provider}_accounts SET state='needs_reconnect' WHERE id=?",(account,))
    recover_legacy(g.s,provider)
    assert account_row(g,provider,account)['state']=='connected'
    assert g.sync_source('1',source,True)['state']=='ready'
    assert g.status('1')['accounts'][0]['sources'][0]['auto_import']==1
    g.disconnect('1',account)
    recover_legacy(g.s,provider)
    assert account_row(g,provider,account)['state']=='disconnected'
    assert account_row(g,provider,account)['credentials'] is None
    assert g.status('1')['accounts'][0]['sources'][0]['selected']==0


def test_legacy_recovery_does_not_resume_deselected_or_locked_accounts(linked):
    g,f,account,source=linked
    with g.s.db.transaction() as c:
        c.execute("UPDATE icloud_accounts SET state='needs_reconnect' WHERE id=?",(account,))
    recover_legacy(g.s,'icloud')
    assert account_row(g,'icloud',account)['state']=='needs_reconnect'


def test_icloud_multiple_sources_cannot_count_one_time_window_twice(linked,monkeypatch):
    import app.icloud_import as module
    g,f,account,source=linked;g.select('1',account,[source],[source])
    start=utcnow();f.fail=ProviderFailure(401)
    for seconds,count in [(0,1),(600,2),(600,2),(661,3)]:
        monkeypatch.setattr(module,'utcnow',lambda seconds=seconds:start+timedelta(seconds=seconds))
        with pytest.raises(Problem):g.sync_source('1',source,True)
        assert account_row(g,'icloud',account)['auth_failures']==count


@pytest.mark.parametrize('reason,expected',[
    ('credential_storage','provider_credential_storage'),
    ('oauth_configuration','google_oauth_configuration'),
    ('private-password private@example.com','google_delayed'),
])
def test_api_diagnostics_do_not_request_reconnect_for_server_errors(google,reason,expected,caplog):
    from fastapi.testclient import TestClient
    from app.main import create_app
    g,f,source=google
    app=create_app(g.s.config,start_worker=False)
    def reject(*args):raise ProviderFailure(401,reason=reason)
    app.state.google.calendars=reject
    with TestClient(app) as client:
        token=client.post('/api/auth',json={'demo_user':'1'}).json()['token']
        response=client.get('/api/google/accounts/account/calendars',headers={'Authorization':'Bearer '+token})
        assert response.status_code==503 and response.json()=={'error':expected}
    assert 'private-password' not in caplog.text


def test_icloud_failed_rediscovery_does_not_leak_provider_reason(linked,caplog):
    g,f,account,source=linked;g.select('1',account,[source],[source])
    # Collection succeeds but a selected resource fails, then root probe fails.
    f.resource=lambda item:None
    def full(item):raise ProviderFailure(401)
    g.full_item=lambda client,item:full(item)
    def discover():raise ProviderFailure(503,reason='private-password private@example.com')
    f.discover=discover
    with pytest.raises(Problem):g.sync_source('1',source,True)
    assert 'private-password' not in caplog.text
    assert g.status('1')['accounts'][0]['sources'][0]['last_error']=='provider_unavailable'


def test_legacy_recovery_does_not_resume_locked_account(linked):
    g,f,account,source=linked;g.select('1',account,[source],[source])
    with g.s.db.transaction() as c:
        c.execute("UPDATE icloud_accounts SET state='needs_reconnect' WHERE id=?",(account,))
        c.execute("UPDATE calendars SET state='pending_delete'")
    recover_legacy(g.s,'icloud')
    assert account_row(g,'icloud',account)['state']=='needs_reconnect'


def test_icloud_auth_confirmation_has_own_retry_cadence_after_network_failures(linked):
    from datetime import datetime
    g,f,account,source=linked;g.select('1',account,[source],[source])
    with g.s.db.transaction() as c:
        c.execute('UPDATE icloud_sources SET attempts=20 WHERE id=?',(source,))
    f.fail=ProviderFailure(401)
    with pytest.raises(Problem):g.sync_source('1',source,True)
    s=g.status('1')['accounts'][0]['sources'][0]
    assert s['state']=='recovering'
    assert 60<=(datetime.fromisoformat(s['next_at'])-utcnow()).total_seconds()<=75
