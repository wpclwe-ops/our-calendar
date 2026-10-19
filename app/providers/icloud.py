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

def dav_status(text):
    match=re.match(r'^HTTP/\d(?:\.\d)?\s+([1-5]\d{2})(?:\s|$)',(text or '').strip())
    return int(match[1]) if match else 0

def invalid_response(reason):
    # Fixed diagnostic labels only: no remote values, paths, event data or secrets.
    logger.warning('icloud invalid_response stage=%s',reason)
    raise ProviderFailure(502,reason=reason)

def successful_properties(item):
    values={}
    for propstat in item.findall('{DAV:}propstat'):
        code=dav_status(propstat.findtext('{DAV:}status'))
        if not code:invalid_response('property_status')
        prop=propstat.find('{DAV:}prop')
        if prop is None:invalid_response('missing_properties')
        if code==200:
            for value in prop:
                if value.tag in values:invalid_response('duplicate_property')
                values[value.tag]=value
    return values

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
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():invalid_response('xml_entities')
        try:return ET.fromstring(raw)
        except ET.ParseError:invalid_response('xml_syntax')
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
        if response.tag!='{DAV:}multistatus':invalid_response('multistatus_root')
        result=[]
        collection_rows=0
        for item in response.findall('{DAV:}response'):
            href=item.find('{DAV:}href')
            if href is None or not href.text:invalid_response('resource_href')
            url=self.safe_url(calendar_url,href.text)
            status=item.find('{DAV:}status')
            if status is not None and dav_status(status.text)!=200:
                invalid_response('resource_status')
            codes=[dav_status(p.findtext('{DAV:}status')) for p in item.findall('{DAV:}propstat')]
            # Apple includes the requested collection in Depth:1 REPORTs. It is
            # not a VEVENT resource and has no calendar-data (404 is normal).
            # Only that exact collection's 200/404 metadata is ignorable; real
            # failed event resources and 507 query-limit responses stay fatal.
            if url.rstrip('/')==calendar_url.rstrip('/'):
                if not codes or any(code not in (200,404) for code in codes) or item.find('.//{DAV:}error') is not None:
                    invalid_response('collection_status')
                collection_rows+=1
                continue
            props=successful_properties(item)
            data=props.get('{'+CALDAV+'}calendar-data')
            etag=props.get('{DAV:}getetag')
            if data is None or not data.text:invalid_response('event_calendar_data')
            if etag is None or not etag.text:invalid_response('event_etag')
            if any(v['url']==url for v in result):invalid_response('duplicate_resource')
            result.append({'url':url,'etag':etag.text,'ics':data.text})
        logger.warning('icloud report_read resources=%s collection_rows=%s',len(result),collection_rows)
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
            if url.rstrip('/')==calendar_url.rstrip('/'):
                codes=[dav_status(p.findtext('{DAV:}status')) for p in item.findall('{DAV:}propstat')]
                status=item.find('{DAV:}status')
                if (status is not None and dav_status(status.text)!=200) or not codes or any(code not in (200,404) for code in codes) or item.find('.//{DAV:}error') is not None:
                    invalid_response('index_collection_status')
                continue
            # Only a complete, successful ETag index can authorize deletions.
            status=item.find('{DAV:}status')
            if status is not None and dav_status(status.text)!=200:
                raise ProviderFailure(502)
            props=successful_properties(item)
            resource_type=props.get('{DAV:}resourcetype')
            if resource_type is not None and resource_type.find('{DAV:}collection') is not None:
                continue
            etag=props.get('{DAV:}getetag')
            if etag is None or not etag.text:
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

