from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
import pytest
from app.providers.icloud import ICloudCalDAV
from app.providers.http import ProviderFailure

CALENDAR='https://p42-caldav.icloud.com/123/calendar/'


def multistatus(rows):
    return ('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'+
            ''.join(rows)+'</d:multistatus>').encode()


def resource(url, data=True):
    content=('<c:calendar-data>'+escape('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n'
             'UID:'+url+'\r\nDTSTART;VALUE=DATE:20261024\r\nSUMMARY:Test\r\n'
             'END:VEVENT\r\nEND:VCALENDAR\r\n')+'</c:calendar-data>') if data else '<d:resourcetype/>'
    return ('<d:response><d:href>'+escape(url)+'</d:href><d:propstat><d:prop>'
            '<d:getetag>version</d:getetag>'+content+'</d:prop>'
            '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')


class LimitedServer:
    def __init__(self, status=403, missing=False):
        self.status=status
        self.missing=missing
        self.calls=[]
        self.urls=[CALENDAR+str(i)+'.ics' for i in range(65)]

    def request(self,method,url,headers=None,body=None):
        self.calls.append((method,url,body))
        root=ET.fromstring(body)
        if root.tag.endswith('calendar-query'):
            raise ProviderFailure(self.status)
        if method=='PROPFIND':
            # The collection itself has no ETag, which is normal.
            collection=('<d:response><d:href>'+CALENDAR+'</d:href><d:propstat>'
                        '<d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>'
                        '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')
            return 207,{},multistatus([collection]+[resource(u,False) for u in self.urls])
        assert root.tag.endswith('calendar-multiget')
        urls=[h.text for h in root.findall('{DAV:}href')]
        assert len(urls)<=30
        if self.missing:urls=urls[:-1]
        return 207,{},multistatus([resource(u) for u in urls])


@pytest.mark.parametrize('status',[400,403,413,500,501,507])
def test_query_refusal_uses_complete_bounded_multiget(status,caplog):
    server=LimitedServer(status)
    result=ICloudCalDAV('private@example.com','private-password',server).previews(CALENDAR)
    assert {v['url'] for v in result}==set(server.urls)
    assert len(result)==65
    assert [c[0] for c in server.calls]==['REPORT','PROPFIND','REPORT','REPORT','REPORT']
    assert 'query_fallback status='+str(status) in caplog.text
    assert 'private-password' not in caplog.text and 'private@example.com' not in caplog.text
    assert CALENDAR not in caplog.text


def test_incomplete_multiget_is_never_accepted_as_complete_scan():
    with pytest.raises(ProviderFailure) as error:
        ICloudCalDAV('u','p',LimitedServer(missing=True)).previews(CALENDAR)
    assert error.value.code==502


def test_revoked_credentials_are_not_retried_as_calendar_queries():
    server=LimitedServer(401)
    with pytest.raises(ProviderFailure):ICloudCalDAV('u','p',server).previews(CALENDAR)
    assert len(server.calls)==1


def test_unsafe_index_href_never_reaches_multiget():
    server=LimitedServer()
    server.urls=['https://evil.example/private.ics']
    with pytest.raises(ProviderFailure):ICloudCalDAV('u','p',server).previews(CALENDAR)
    assert [c[0] for c in server.calls]==['REPORT','PROPFIND']


@pytest.mark.parametrize('status,error',[
    (401,'icloud_reconnect'),(403,'icloud_access_denied'),(404,'icloud_source_missing'),
    (413,'icloud_response_too_large'),(429,'icloud_rate_limited'),
    (502,'icloud_invalid_response'),(503,'icloud_delayed'),
])
def test_api_errors_are_specific_and_do_not_expose_private_data(service,status,error,caplog):
    from fastapi.testclient import TestClient
    from app.main import create_app
    app=create_app(service.config,start_worker=False)
    def fail(*args):raise ProviderFailure(status,reason='private-password private@example.com')
    app.state.icloud.calendars=fail
    with TestClient(app) as client:
        token=client.post('/api/auth',json={'demo_user':'1'}).json()['token']
        response=client.get('/api/icloud/accounts/private-id/calendars',
                            headers={'Authorization':'Bearer '+token})
    assert response.status_code==503 and response.json()=={'error':error}
    assert 'private-password' not in response.text+caplog.text
    assert 'private@example.com' not in response.text+caplog.text
    assert 'private-id' not in caplog.text
