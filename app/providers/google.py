"""Read-only Google Calendar pilot with OAuth/PKCE and incremental pagination.

No method writes calendar events. Production account/link lifecycle is a separate
milestone; this adapter is deliberately not exposed as a working UI connection.
"""
import base64
import hashlib
import secrets
from urllib.parse import urlencode,quote
from .http import HTTPS,ProviderFailure

SCOPES=('https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.events.readonly',
        'openid','https://www.googleapis.com/auth/userinfo.email')

class GoogleOAuth:
    def __init__(self,client_id,client_secret,redirect_uri,transport=None):
        self.client_id,self.client_secret,self.redirect_uri=client_id,client_secret,redirect_uri
        self.http=transport or HTTPS(lambda h:h in ('oauth2.googleapis.com',))
    def start(self):
        state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(48)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        params={'client_id':self.client_id,'redirect_uri':self.redirect_uri,'response_type':'code',
                'scope':' '.join(SCOPES),'state':state,'access_type':'offline','prompt':'consent',
                'code_challenge':challenge,'code_challenge_method':'S256'}
        return {'state':state,'verifier':verifier,'url':'https://accounts.google.com/o/oauth2/v2/auth?'+urlencode(params)}
    def _token(self,data):
        payload={'client_id':self.client_id,'client_secret':self.client_secret,**data}
        _,_,body=self.http.request('POST','https://oauth2.googleapis.com/token',
                                  {'Content-Type':'application/x-www-form-urlencoded'},urlencode(payload).encode())
        import json
        try:
            result=json.loads(body)
            if not isinstance(result.get('access_token'),str):raise ValueError()
            if 'scope' in result and not set(SCOPES)<=set(result['scope'].split()):
                raise ProviderFailure(403,reason='missing_scopes')
            return result
        except (ValueError,TypeError):raise ProviderFailure(401)
    def exchange(self,code,verifier):
        return self._token({'code':code,'code_verifier':verifier,'redirect_uri':self.redirect_uri,'grant_type':'authorization_code'})
    def refresh(self,refresh_token):return self._token({'refresh_token':refresh_token,'grant_type':'refresh_token'})

class GoogleCalendar:
    def __init__(self,access_token,transport=None):
        self.token=access_token;self.http=transport or HTTPS(lambda h:h=='www.googleapis.com')
    def _get(self,path,params=None):
        url='https://www.googleapis.com/calendar/v3/'+path
        if params:url+='?'+urlencode({k:v for k,v in params.items() if v is not None})
        return self.http.json('GET',url,headers={'Authorization':'Bearer '+self.token})
    def calendars(self):
        items=[];page=None;seen=set()
        for _ in range(100):
            data=self._get('users/me/calendarList',{'maxResults':250,'pageToken':page})
            items.extend(data.get('items',[]));page=data.get('nextPageToken')
            if not page:return items
            if page in seen:raise ProviderFailure(502)
            seen.add(page)
        raise ProviderFailure(413)
    def identity(self):
        return self.http.json('GET','https://www.googleapis.com/oauth2/v3/userinfo',
                              headers={'Authorization':'Bearer '+self.token})
    def watch_events(self,calendar_id,channel_id,token,address,expiration):
        # A read-only subscription, never an event create/update/delete.
        return self.http.json('POST','https://www.googleapis.com/calendar/v3/calendars/'+quote(calendar_id,safe='')+'/events/watch',
                              headers={'Authorization':'Bearer '+self.token},
                              data={'id':channel_id,'type':'web_hook','token':token,'address':address,'expiration':str(expiration)})
    def browse(self,calendar_id,page=None,parent=None,start=None,end=None):
        path='calendars/'+quote(calendar_id,safe='')+'/events'
        if parent:path+='/'+quote(parent,safe='')+'/instances'
        return self._get(path,{'maxResults':100,'pageToken':page,'showDeleted':'false',
                              'timeMin':start,'timeMax':end})
    def event(self,calendar_id,event_id):
        return self._get('calendars/'+quote(calendar_id,safe='')+'/events/'+quote(event_id,safe=''))
    def events(self,calendar_id,sync_token=None,allowed_ids=None):
        """Full/incremental read; only explicitly linked IDs may cross this boundary.

        allowed_ids=None is for the owner's private event-selection screen.
        An expired sync token causes a full refresh, never loss of linked records.
        """
        reset=False
        for attempt in range(2):
            items=[];page=None;seen=set()
            try:
                for _ in range(100):
                    data=self._get('calendars/'+quote(calendar_id,safe='')+'/events',
                                   {'maxResults':250,'singleEvents':'false','showDeleted':'true','syncToken':sync_token,'pageToken':page})
                    for item in data.get('items',[]):
                        if allowed_ids is None or item.get('id') in allowed_ids or item.get('recurringEventId') in allowed_ids:items.append(item)
                    page=data.get('nextPageToken')
                    if not page:return {'items':items,'sync_token':data.get('nextSyncToken'),'reset':reset}
                    if page in seen:raise ProviderFailure(502)
                    seen.add(page)
                raise ProviderFailure(413)
            except ProviderFailure as exc:
                if exc.code==410 and sync_token and attempt==0:sync_token=None;reset=True;continue
                raise
        raise ProviderFailure(502)
