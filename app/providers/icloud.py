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
    def events(self,calendar_url):
        response=self.xml('REPORT',calendar_url,'<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>',depth='1')
        result=[]
        for item in response.findall('{DAV:}response'):
            href=item.find('{DAV:}href');data=item.find('.//{'+CALDAV+'}calendar-data');etag=item.find('.//{DAV:}getetag')
            if href is not None and href.text and data is not None:
                result.append({'url':self.safe_url(calendar_url,href.text),'etag':etag.text if etag is not None else '', 'ics':data.text or ''})
        return result
