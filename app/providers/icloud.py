"""Strictly read-only iCloud CalDAV pilot; write support requires a real test."""
import base64
import re
from urllib.parse import urljoin,urlparse
from xml.etree import ElementTree as ET
from .http import HTTPS,ProviderFailure

DAV='DAV:';CALDAV='urn:ietf:params:xml:ns:caldav'
def allowed(host):return re.fullmatch(r'(?:p[0-9]+-)?caldav\.icloud\.com',host) is not None

class ICloudCalDAV:
    def __init__(self,apple_id,app_password,transport=None):
        self.http=transport or HTTPS(allowed)
        self.authorization='Basic '+base64.b64encode((apple_id+':'+app_password).encode()).decode()
    def safe_url(self,base,href):
        url=urljoin(base,href);parts=urlparse(url)
        if parts.scheme!='https' or not allowed(parts.hostname or '') or parts.port not in (None,443) or parts.username or parts.password:
            raise ProviderFailure(400)
        return url
    def xml(self,method,url,body,depth='0'):
        url=self.safe_url(url,'')
        status,_,raw=self.http.request(method,url,{'Authorization':self.authorization,'Depth':depth,'Content-Type':'application/xml; charset=utf-8'},body.encode())
        if status not in (200,207):raise ProviderFailure(status)
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ProviderFailure(502)
        try:return ET.fromstring(raw)
        except ET.ParseError:raise ProviderFailure(502)
    def discover(self):
        root='https://caldav.icloud.com/'
        response=self.xml('PROPFIND',root,'<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>')
        href=response.find('.//{DAV:}current-user-principal/{DAV:}href')
        if href is None or not href.text:raise ProviderFailure(502)
        principal=self.safe_url(root,href.text)
        response=self.xml('PROPFIND',principal,'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>')
        home=response.find('.//{'+CALDAV+'}calendar-home-set/{DAV:}href')
        if home is None or not home.text:raise ProviderFailure(502)
        home=self.safe_url(principal,home.text)
        response=self.xml('PROPFIND',home,'<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>',depth='1')
        calendars=[]
        for item in response.findall('{DAV:}response'):
            if item.find('.//{'+CALDAV+'}calendar') is None:continue
            href=item.find('{DAV:}href');name=item.find('.//{DAV:}displayname')
            if href is not None and href.text:calendars.append({'url':self.safe_url(home,href.text),'name':name.text if name is not None else ''})
        return calendars
    def _calendar_query(self,calendar_url,calendar_data):
        body=('<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
              '<d:prop><d:getetag/>'+calendar_data+'</d:prop>'
              '<c:filter><c:comp-filter name="VCALENDAR">'
              '<c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>')
        response=self.xml('REPORT',calendar_url,body,depth='1')
        result=[]
        for item in response.findall('{DAV:}response'):
            # An incomplete multi-status response must not be interpreted as a remote deletion.
            for propstat in item.findall('{DAV:}propstat'):
                status=propstat.find('{DAV:}status')
                if status is not None and status.text and ' 200 ' not in status.text:
                    raise ProviderFailure(502)
            status=item.find('{DAV:}status')
            if status is not None and status.text and ' 200 ' not in status.text:
                raise ProviderFailure(502)
            href=item.find('{DAV:}href')
            data=item.find('.//{'+CALDAV+'}calendar-data')
            etag=item.find('.//{DAV:}getetag')
            if href is None or not href.text or data is None:
                raise ProviderFailure(502)
            result.append({'url':self.safe_url(calendar_url,href.text),
                           'etag':etag.text if etag is not None else '', 'ics':data.text or ''})
        return result

    def events(self,calendar_url):
        """Read complete resources (legacy/testing API)."""
        return self._calendar_query(calendar_url,'<c:calendar-data/>')

    def previews(self,calendar_url):
        """Request only fields needed by the private event picker and ETag index.

        CalDAV property projection avoids downloading large descriptions, alarms,
        attachments and attendee lists on every scan. Full ICS is read only for
        an explicitly selected event or an actually changed link.
        """
        props=('UID','DTSTART','DTEND','DURATION','SUMMARY','RRULE','RDATE',
               'EXDATE','RECURRENCE-ID','STATUS')
        selected=''.join('<c:prop name="'+name+'"/>' for name in props)
        projection=('<c:calendar-data><c:comp name="VCALENDAR">'
                    '<c:prop name="VERSION"/><c:comp name="VEVENT">'+selected+
                    '</c:comp></c:comp></c:calendar-data>')
        return self._calendar_query(calendar_url,projection)

    def resource(self,url):
        """Retrieve a full event only after its URL has appeared in a selected calendar."""
        url=self.safe_url(url,'')
        code,_,raw=self.http.request('GET',url,{'Authorization':self.authorization})
        if code!=200:raise ProviderFailure(code)
        try:ics=raw.decode('utf-8')
        except UnicodeDecodeError:raise ProviderFailure(502) from None
        return {'url':url,'ics':ics}
