"""Strictly read-only iCloud CalDAV pilot; write support requires a real test."""
import base64
import re
import logging
from urllib.parse import urljoin,urlparse
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
from .http import HTTPS,ProviderFailure

DAV='DAV:';CALDAV='urn:ietf:params:xml:ns:caldav'
logger=logging.getLogger(__name__)
def failure_code(exc):
    return {401:'icloud_reconnect',403:'icloud_access_denied',404:'icloud_source_missing',
            413:'icloud_response_too_large',429:'icloud_rate_limited',
            502:'icloud_invalid_response'}.get(exc.code,'icloud_delayed')
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
        try:
            status,_,raw=self.http.request(method,url,{'Authorization':self.authorization,'Depth':depth,'Content-Type':'application/xml; charset=utf-8'},body.encode())
        except ProviderFailure as exc:
            # Never log URLs, response bodies, credentials or exception messages.
            logger.warning('icloud request_failed method=%s status=%s',method,exc.code)
            raise
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
        try:
            response=self.xml('REPORT',calendar_url,body,depth='1')
        except ProviderFailure as exc:
            # Some CalDAV servers reject broad queries or property projection.
            # Discover exact resource URLs first, then request bounded batches.
            if exc.code not in (400,403,413,500,501,507):raise
            logger.warning('icloud query_fallback status=%s',exc.code)
            return self._indexed_query(calendar_url,calendar_data)
        return self._resources(response,calendar_url)

    def _resources(self,response,calendar_url):
        if response.tag!='{DAV:}multistatus':raise ProviderFailure(502)
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

    def _indexed_query(self,calendar_url,calendar_data):
        response=self.xml('PROPFIND',calendar_url,
            '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>',depth='1')
        if response.tag!='{DAV:}multistatus':raise ProviderFailure(502)
        urls=[]
        for item in response.findall('{DAV:}response'):
            href=item.find('{DAV:}href')
            if href is None or not href.text:raise ProviderFailure(502)
            url=self.safe_url(calendar_url,href.text)
            if url.rstrip('/')==calendar_url.rstrip('/'):continue
            # Only a complete, successful ETag index can authorize deletions.
            status=item.find('{DAV:}status')
            if status is not None and (not status.text or ' 200 ' not in status.text):
                raise ProviderFailure(502)
            props=[p.find('{DAV:}prop') for p in item.findall('{DAV:}propstat')
                   if p.findtext('{DAV:}status','').split()[1:2]==['200']]
            if any(p is not None and p.find('{DAV:}resourcetype/{DAV:}collection') is not None for p in props):
                continue
            if not any(p is not None and p.findtext('{DAV:}getetag') for p in props):
                raise ProviderFailure(502)
            if url in urls:raise ProviderFailure(502)
            urls.append(url)
            if len(urls)>2000:raise ProviderFailure(413)
        result=[]
        for offset in range(0,len(urls),30):
            batch=urls[offset:offset+30]
            hrefs=''.join('<d:href>'+escape(u)+'</d:href>' for u in batch)
            body=('<c:calendar-multiget xmlns:d="DAV:" xmlns:c="'+CALDAV+'">'
                  '<d:prop><d:getetag/>'+calendar_data+'</d:prop>'+hrefs+'</c:calendar-multiget>')
            response=self.xml('REPORT',calendar_url,body)
            items=self._resources(response,calendar_url)
            if len(items)!=len(batch) or {i['url'] for i in items}!=set(batch):
                raise ProviderFailure(502)
            result.extend(items)
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

