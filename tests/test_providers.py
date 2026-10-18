from urllib.parse import urlparse,parse_qs
import json
import pytest
from cryptography.fernet import Fernet
from app.providers.vault import CredentialVault
from app.providers.google import GoogleCalendar,GoogleOAuth,SCOPES
from app.providers.icloud import ICloudCalDAV
from app.providers.http import ProviderFailure,HTTPS

class GoogleFake:
    def __init__(self):self.calls=[];self.fail_once=False
    def json(self,method,url,headers=None,data=None):
        self.calls.append((method,url,headers));params=parse_qs(urlparse(url).query)
        if self.fail_once:self.fail_once=False;raise ProviderFailure(410)
        if not params.get('pageToken'):return {'items':[{'id':'chosen'},{'id':'private-unselected'}],'nextPageToken':'page2'}
        return {'items':[{'id':'chosen2'}],'nextSyncToken':'new-token'}
    def request(self,method,url,headers=None,body=None):
        self.calls.append((method,url,parse_qs(body.decode())))
        return 200,{},json.dumps({'access_token':'access','scope':' '.join(SCOPES)}).encode()

def test_google_incremental_pagination_filters_unselected_and_resets_410():
    fake=GoogleFake();fake.fail_once=True
    result=GoogleCalendar('secret',fake).events('a@example.com','expired',allowed_ids={'chosen'})
    assert result=={'items':[{'id':'chosen'}],'sync_token':'new-token','reset':True}
    assert all(call[0]=='GET' for call in fake.calls)
    assert all('secret' not in call[1] for call in fake.calls)
    assert 'syncToken=' not in fake.calls[1][1]
    assert 'a%40example.com' in fake.calls[0][1]


def test_google_oauth_uses_pkce_and_only_read_scopes():
    fake=GoogleFake();oauth=GoogleOAuth('client','client-secret','https://app.example/callback',fake)
    a,b=oauth.start(),oauth.start()
    assert a['state']!=b['state'] and len(a['state'])>=40
    params=parse_qs(urlparse(a['url']).query)
    assert params['code_challenge_method']==['S256']
    assert set(params['scope'][0].split())==set(SCOPES)
    oauth.exchange('code',a['verifier'])
    assert fake.calls[-1][2]['code_verifier']==[a['verifier']]


def test_vault_has_no_plaintext_and_rejects_wrong_key():
    vault=CredentialVault(Fernet.generate_key());encrypted=vault.encrypt({'access_token':'super-secret'})
    assert 'super-secret' not in encrypted and vault.decrypt(encrypted)['access_token']=='super-secret'
    with pytest.raises(ProviderFailure):CredentialVault(Fernet.generate_key()).decrypt(encrypted)


def test_icloud_rejects_credential_redirect_and_entity_xml():
    adapter=ICloudCalDAV('user','password')
    for url in ['https://evil.example/a','http://caldav.icloud.com/','https://caldav.icloud.com.evil.example/','https://u:p@caldav.icloud.com/']:
        with pytest.raises(ProviderFailure):adapter.safe_url('https://caldav.icloud.com/',url)
    assert adapter.safe_url('https://caldav.icloud.com/','https://p42-caldav.icloud.com/a')=='https://p42-caldav.icloud.com/a'
    class XMLFake:
        def request(self,*args):return 207,{},b'<!DOCTYPE x [<!ENTITY x "bad">]><x/>'
    with pytest.raises(ProviderFailure):ICloudCalDAV('a','b',XMLFake()).xml('REPORT','https://caldav.icloud.com/','<x/>')


def test_transport_rejects_non_https_and_untrusted_hosts_before_network():
    http=HTTPS(lambda h:h=='www.googleapis.com')
    for url in ['http://www.googleapis.com/','https://evil.example/','https://www.googleapis.com:444/']:
        with pytest.raises(ProviderFailure):http.request('GET',url)


@pytest.mark.parametrize('error,expected',[
    ('invalid_client','invalid_client'),('invalid_grant','invalid_grant'),
    ('secret-access-token',''),
])
def test_oauth_transport_only_retains_allowlisted_error_codes(error,expected):
    from io import BytesIO
    from urllib.error import HTTPError
    http=HTTPS(lambda h:h=='oauth2.googleapis.com')
    class Reject:
        def open(self,*args,**kwargs):
            raise HTTPError('https://oauth2.googleapis.com/token',401,'Unauthorized',{},
                            BytesIO(json.dumps({'error':error,'error_description':'secret-access-token'}).encode()))
    http.opener=Reject()
    with pytest.raises(ProviderFailure) as failure:
        http.request('POST','https://oauth2.googleapis.com/token',body=b'code=private-code')
    assert failure.value.reason==expected
    assert 'secret-access-token' not in str(failure.value)


def test_google_token_missing_permissions_are_distinct_from_client_credentials():
    class Partial(GoogleFake):
        def request(self,*args,**kwargs):
            return 200,{},json.dumps({'access_token':'private-token','scope':'openid'}).encode()
    with pytest.raises(ProviderFailure) as failure:
        GoogleOAuth('client','secret','https://app.example/callback',Partial()).exchange('code','verifier')
    assert failure.value.reason=='missing_scopes'
