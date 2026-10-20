"""Owner-private Google selection and durable, strictly inbound synchronization.

The provider adapter has no event-write methods. OAuth tokens never enter event
JSON, browser responses, ZIP/ICS, or diagnostic messages. Network calls are made
outside SQLite transactions; every apply rechecks membership and generations.
"""
from copy import deepcopy
from datetime import datetime, timedelta, date
import random
import secrets
import hmac
from .providers.google import GoogleOAuth, GoogleCalendar
from .google_description import google_description_text
from .providers.vault import CredentialVault
from .providers.http import ProviderFailure
from .security import require, Problem, digest
from .service import uid, dump, load, IMPORTANT
from .recurrence import utcnow, stamp, zone, validate_timing, UTC
from .sync_policy import merge_fields

FIELDS = ('title', 'description', 'start', 'end', 'all_day', 'timezone',
          'fold', 'end_fold', 'rrule', 'location')
TEMPORAL = {'start','end','all_day','timezone','fold','end_fold','rrule'}


def personal_override(patch):
    """True when an occurrence patch holds data a person entered, not only importer bookkeeping."""
    for key,value in patch.items():
        if key in FIELDS or key=='deleted':continue
        if key=='smart' and not (any(v.get('manual') for v in value.get('fields',{}).values()) or value.get('category',{}).get('manual')):continue
        return True
    return False


TTL = 600
POLL = 300
MAX_BATCH = 50
AUTO_BATCH = 20


def eligible_auto(item, source_timezone, now):
    """Backfill current/upcoming appointments, not an account's past history."""
    if item.get('status') == 'cancelled' or item.get('recurringEventId'):
        return False
    if item.get('recurrence'):
        return True
    end = item.get('end') or {}
    try:
        if end.get('date'):
            return date.fromisoformat(end['date']) > now.astimezone(zone(source_timezone)).date()
        value = datetime.fromisoformat(end['dateTime'].replace('Z', '+00:00'))
        return value.tzinfo is not None and value.astimezone(UTC) > now
    except (KeyError, TypeError, ValueError):
        return False



def normalize(item, timezone, single=False):
    """Convert only supported Google fields; never silently truncate user data."""
    require(item.get('status') != 'cancelled', 'google_event_deleted', 409)
    require(item.get('eventType', 'default') in ('default','fromGmail','birthday'),
            'google_unsupported_event', 422)
    start, end = item.get('start', {}), item.get('end', {})
    all_day = bool(start.get('date'))
    tz = start.get('timeZone') or timezone or 'UTC'
    target = zone(tz)
    result = {'title': item.get('summary') or '(Google Calendar)',
              'description': google_description_text(item.get('description') or ''),
              'location': item.get('location') or '', 'all_day': all_day,
              'timezone': tz, 'fold': 0, 'end_fold': 0, 'rrule': ''}
    if all_day:
        require(bool(end.get('date')), 'google_unsupported_event', 422)
        result.update(start=start['date'], end=end['date'])
    else:
        for name, value, fold in [('start', start, 'fold'), ('end', end, 'end_fold')]:
            dt = datetime.fromisoformat(value['dateTime'].replace('Z','+00:00'))
            require(dt.tzinfo is not None, 'google_unsupported_event', 422)
            dt = dt.astimezone(target)
            result[name] = dt.replace(tzinfo=None).isoformat(timespec='seconds')
            result[fold] = dt.fold
    rules = [] if single else item.get('recurrence', [])
    # Other RFC recurrence forms need a verified conversion, not a lossy import.
    require(len(rules) <= 1 and all(v.startswith('RRULE:') for v in rules),
            'google_unsupported_recurrence', 422)
    if rules: result['rrule'] = rules[0].removeprefix('RRULE:')
    validate_timing(result)
    return result


def occurrence_key(item, timezone):
    value = item['originalStartTime']
    if value.get('date'): return value['date']
    dt = datetime.fromisoformat(value['dateTime'].replace('Z','+00:00'))
    return dt.astimezone(zone(timezone)).replace(tzinfo=None).isoformat(timespec='minutes')


def snapshot(item, timezone, exceptions=(), single=False):
    if item.get('status') == 'cancelled': return {'deleted': True}
    fields = normalize(item, timezone, single)
    overrides = {}
    if fields['rrule']:
        for child in exceptions:
            key = occurrence_key(child, fields['timezone'])
            overrides[key] = {'deleted': True} if child.get('status') == 'cancelled' else normalize(child, fields['timezone'], True)
    return {'fields': fields, 'overrides': overrides}


def validate_series(value):
    """Reject DST intervals our current recurrence engine cannot represent safely."""
    if not value['fields'].get('rrule'):return
    from .recurrence import occurrences,instance,base_datetime
    fields=value['fields'];base=base_datetime(fields).astimezone(UTC)
    for first in (base,utcnow()):
        for key,a,b in occurrences(fields,first,first+timedelta(days=550)):
            try:instance(fields,key,a,b,value['overrides'].get(key))
            except Problem:raise Problem(422,'google_unsupported_recurrence') from None


def flattened(value):
    return {**value['fields'], **{'occ:'+k: v for k,v in value.get('overrides',{}).items()}}


def unflattened(value):
    return {'fields': {k:v for k,v in value.items() if not k.startswith('occ:')},
            'overrides': {k[4:]:v for k,v in value.items() if k.startswith('occ:') and v is not None}}


class GoogleImports:
    def __init__(self, service, oauth=None, provider=None):
        self.s = service
        cfg = service.config
        self.configured = bool(cfg.google_client_id and cfg.google_client_secret and cfg.google_credential_key)
        self.vault = CredentialVault(cfg.google_credential_key) if self.configured else None
        self.oauth = oauth or GoogleOAuth(cfg.google_client_id, cfg.google_client_secret,
                                          cfg.public_url+'/api/google/callback')
        self.provider = provider or GoogleCalendar

    def ready(self):
        require(self.configured, 'google_not_configured', 503)

    def account(self, c, actor, account_id, connected=True):
        cal = self.s.calendar(c, actor)
        row = c.execute('SELECT * FROM google_accounts WHERE id=? AND user_id=? AND calendar_id=?',
                        (account_id, actor, cal['id'])).fetchone()
        require(row is not None, 'google_account_not_found', 404)
        if connected: require(row['state']=='connected' and row['credentials'], 'google_reconnect', 409)
        return dict(row)

    def source(self, c, actor, source_id):
        row = c.execute('SELECT * FROM google_sources WHERE id=?', (source_id,)).fetchone()
        require(row is not None, 'google_source_not_found', 404)
        row = dict(row)
        account = self.account(c, actor, row['account_id'])
        require(row['selected'], 'google_source_not_selected', 409)
        return row, account

    def client(self, account):
        self.ready()
        credentials = self.vault.decrypt(account['credentials'])
        if credentials.get('expires_at','') <= stamp(utcnow()+timedelta(seconds=60)):
            require(bool(credentials.get('refresh_token')), 'google_reconnect', 409)
            try:
                fresh = self.oauth.refresh(credentials['refresh_token'])
            except ProviderFailure as exc:
                if exc.code in (400,401):
                    with self.s.db.transaction() as c:
                        c.execute("UPDATE google_accounts SET state='needs_reconnect',generation=generation+1 WHERE id=? AND generation=?",
                                  (account['id'], account['generation']))
                    raise Problem(409, 'google_reconnect')
                raise
            credentials.update(fresh)
            credentials['expires_at'] = stamp(utcnow()+timedelta(seconds=int(fresh.get('expires_in',3600))))
            with self.s.db.transaction() as c:
                current = self.account(c, account['user_id'], account['id'])
                require(current['generation']==account['generation'], 'google_selection_expired', 409)
                c.execute('UPDATE google_accounts SET credentials=? WHERE id=?',
                          (self.vault.encrypt(credentials), account['id']))
        return self.provider(credentials['access_token'])

    def start(self, actor):
        self.ready()
        request = self.oauth.start()
        with self.s.db.transaction() as c:
            cal = self.s.calendar(c, actor)
            c.execute('DELETE FROM google_oauth_requests WHERE user_id=?', (actor,))
            c.execute('INSERT INTO google_oauth_requests VALUES(?,?,?,?,?,?)',
                      (digest(request['state']),actor,cal['id'],'pending',
                       self.vault.encrypt({'verifier':request['verifier']}),stamp(utcnow()+timedelta(seconds=TTL))))
        return {'url':request['url']}

    def callback(self, state, code='', error=''):
        self.ready()
        with self.s.db.transaction() as c:
            request = c.execute('SELECT * FROM google_oauth_requests WHERE state_hash=?',(digest(state),)).fetchone()
            require(request is not None and request['state']=='pending' and request['expires_at']>stamp(),
                    'google_selection_expired',409)
            self.s.calendar(c,request['user_id'])
            c.execute("UPDATE google_oauth_requests SET state='exchanging' WHERE state_hash=?",(digest(state),))
            verifier = self.vault.decrypt(request['secret'])['verifier']
        try:
            require(not error and bool(code), 'google_authorization_cancelled')
            try:
                credentials = self.oauth.exchange(code, verifier)
            except ProviderFailure as exc:
                reason=exc.reason if exc.reason in ('invalid_client','invalid_grant','invalid_scope','unauthorized_client','invalid_request','missing_scopes') else 'unavailable'
                raise Problem(503,'google_oauth_token_'+reason) from None
            require(bool(credentials.get('refresh_token')), 'google_reconnect',409)
            try:
                identity = self.provider(credentials['access_token']).identity()
            except ProviderFailure:
                raise Problem(503,'google_oauth_identity_unavailable') from None
            require(bool(identity.get('sub')) and bool(identity.get('email')) and identity.get('email_verified') is True,
                    'google_identity_invalid',401)
            credentials['expires_at']=stamp(utcnow()+timedelta(seconds=int(credentials.get('expires_in',3600))))
            secret = self.vault.encrypt({'credentials':credentials,'subject':identity['sub'],'email':identity['email']})
            with self.s.db.transaction() as c:
                self.s.calendar(c,request['user_id'])
                row=c.execute('SELECT * FROM google_oauth_requests WHERE state_hash=?',(digest(state),)).fetchone()
                require(row is not None and row['state']=='exchanging' and row['expires_at']>stamp(), 'google_selection_expired',409)
                c.execute("UPDATE google_oauth_requests SET state='confirm',secret=? WHERE state_hash=?",(secret,digest(state)))
        except Exception:
            with self.s.db.transaction() as c:
                c.execute("UPDATE google_oauth_requests SET state='failed',secret=NULL WHERE state_hash=?",(digest(state),))
            raise
        return {'ok':True}

    def status(self, actor):
        with self.s.db.transaction() as c:
            cal = self.s.calendar(c,actor)
            pending=c.execute("SELECT state,secret FROM google_oauth_requests WHERE user_id=? AND calendar_id=? AND expires_at>?",
                              (actor,cal['id'],stamp())).fetchone()
            confirmation = None
            if pending and pending['state']=='confirm' and self.vault:
                confirmation = {'email': self.vault.decrypt(pending['secret'])['email']}
            accounts=[]
            for a in c.execute('SELECT id,email,state FROM google_accounts WHERE user_id=? AND calendar_id=?',(actor,cal['id'])):
                sources=[]
                for source in c.execute('SELECT id,name,selected,auto_import,state FROM google_sources WHERE account_id=?',(a['id'],)):
                    links=[dict(v) for v in c.execute('SELECT l.id,l.event_id,l.state,l.checked_at,json_extract(e.data,\'$.title\') AS title FROM google_links l LEFT JOIN events e ON e.id=l.event_id WHERE l.source_id=? AND l.event_id IS NOT NULL',(source['id'],))]
                    sources.append({**dict(source),'links':links})
                accounts.append({**dict(a),'mode':'import_only','sources':sources})
            return {'configured':self.configured,'confirmation':confirmation,
                    'pending':pending['state'] if pending else None,'accounts':accounts}

    def confirm_account(self,actor,approved):
        self.ready()
        with self.s.db.transaction() as c:
            cal=self.s.calendar(c,actor)
            r=c.execute("SELECT * FROM google_oauth_requests WHERE user_id=? AND calendar_id=? AND state='confirm' AND expires_at>?",
                        (actor,cal['id'],stamp())).fetchone()
            require(r is not None,'google_selection_expired',409)
            if approved:
                data=self.vault.decrypt(r['secret']);account_id=uid()
                existing=c.execute('SELECT id FROM google_accounts WHERE user_id=? AND calendar_id=? AND subject=?',
                                   (actor,cal['id'],data['subject'])).fetchone()
                if existing:account_id=existing['id']
                c.execute("INSERT INTO google_accounts(id,user_id,calendar_id,subject,email,credentials) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,calendar_id,subject) DO UPDATE SET email=excluded.email,credentials=excluded.credentials,state='connected',generation=google_accounts.generation+1",
                          (account_id,actor,cal['id'],data['subject'],data['email'],self.vault.encrypt(data['credentials'])))
                # Reconnection never silently re-enables old sources or links.
                c.execute("UPDATE google_sources SET selected=0,auto_import=0,sync_token=NULL,generation=generation+1,lease_until=NULL,state='ready' WHERE account_id=?",(account_id,))
                c.execute("UPDATE google_links SET state='disconnected' WHERE source_id IN (SELECT id FROM google_sources WHERE account_id=?)",(account_id,))
            c.execute('DELETE FROM google_oauth_requests WHERE state_hash=?',(r['state_hash'],))
        return self.status(actor)

    def disconnect(self,actor,account_id):
        with self.s.db.transaction() as c:
            self.account(c,actor,account_id,False)
            c.execute("UPDATE google_accounts SET credentials=NULL,state='disconnected',generation=generation+1 WHERE id=?",(account_id,))
            c.execute("UPDATE google_sources SET selected=0,auto_import=0,sync_token=NULL,generation=generation+1,lease_until=NULL WHERE account_id=?",(account_id,))
            c.execute("UPDATE google_links SET state='disconnected' WHERE source_id IN (SELECT id FROM google_sources WHERE account_id=?)",(account_id,))
            c.execute('DELETE FROM google_previews WHERE source_id IN (SELECT id FROM google_sources WHERE account_id=?)',(account_id,))
        return self.status(actor)

    def calendars(self,actor,account_id):
        with self.s.db.transaction() as c:account=self.account(c,actor,account_id)
        items=self.client(account).calendars()
        with self.s.db.transaction() as c:
            current=self.account(c,actor,account_id)
            require(current['generation']==account['generation'],'google_selection_expired',409)
            result=[]
            for item in items:
                if item.get('accessRole') not in ('reader','writer','owner'):continue
                sid=uid()
                c.execute('INSERT INTO google_sources(id,account_id,remote_id,name,timezone) VALUES(?,?,?,?,?) ON CONFLICT(account_id,remote_id) DO UPDATE SET name=excluded.name,timezone=excluded.timezone',
                          (sid,account_id,item['id'],item.get('summary') or item['id'],item.get('timeZone') or 'UTC'))
                row=c.execute('SELECT id,name,timezone,selected,auto_import FROM google_sources WHERE account_id=? AND remote_id=?',(account_id,item['id'])).fetchone()
                result.append(dict(row))
        return result

    def select(self,actor,account_id,ids,auto_ids=None):
        require(isinstance(ids,list) and len(ids)<=100 and all(isinstance(v,str) for v in ids),'invalid_request')
        require(len(set(ids))==len(ids),'invalid_request')
        if auto_ids is not None:
            require(isinstance(auto_ids,list) and len(auto_ids)<=100 and
                    all(isinstance(v,str) for v in auto_ids) and
                    len(set(auto_ids))==len(auto_ids) and set(auto_ids)<=set(ids),
                    'invalid_request')
        with self.s.db.transaction() as c:
            self.account(c,actor,account_id)
            rows=c.execute('SELECT * FROM google_sources WHERE account_id=?',(account_id,)).fetchall()
            require(set(ids)<={r['id'] for r in rows},'google_source_not_found',404)
            for row in rows:
                chosen=int(row['id'] in ids)
                auto=int(chosen and (row['id'] in auto_ids if auto_ids is not None else row['auto_import']))
                if chosen!=row['selected'] or auto!=row['auto_import']:
                    c.execute("UPDATE google_sources SET selected=?,auto_import=?,generation=generation+1,sync_token=NULL,next_at='',lease_until=NULL WHERE id=?",
                              (chosen,auto,row['id']))
                    c.execute('DELETE FROM google_previews WHERE source_id=?',(row['id'],))
                    if not chosen:
                        c.execute("UPDATE google_links SET state='disconnected' WHERE source_id=?",(row['id'],))
                        c.execute('DELETE FROM google_auto_skips WHERE source_id=?',(row['id'],))
        return self.status(actor)

    def browse(self,actor,source_id,page=None,parent=None,start=None,end=None):
        self.ready()
        with self.s.db.transaction() as c:source,account=self.source(c,actor,source_id)
        for value in (page,parent):require(value is None or isinstance(value,str) and len(value)<=3000,'invalid_request')
        now=utcnow()
        start=start or stamp(now-timedelta(days=30));end=end or stamp(now+timedelta(days=365))
        for value in (start,end):require(datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is not None,'invalid_request')
        result=self.client(account).browse(source['remote_id'],page,parent,start,end)
        items=[]
        for item in result.get('items',[]):
            if item.get('status')=='cancelled':continue
            # Exceptions are reached through their series, never imported twice by default.
            if not parent and item.get('recurringEventId'):continue
            supported=True
            try:fields=normalize(item,source['timezone'],bool(parent))
            except (Problem,KeyError,ValueError,TypeError):supported=False;fields={}
            items.append({'id':item['id'],'title':item.get('summary') or '(Google Calendar)',
                          'start':fields.get('start',''),'end':fields.get('end',''),
                          'all_day':fields.get('all_day',False),'series':bool(item.get('recurrence')),
                          'supported':supported,'scope':'one' if parent or not item.get('recurrence') else 'series'})
        # An in-flight private read is discarded if its authorization changed.
        with self.s.db.transaction() as c:self.check_source(c,actor,source,account)
        return {'items':items,'next_page':result.get('nextPageToken'),'source':source['name']}

    def check_source(self,c,actor,source,account):
        current,acc=self.source(c,actor,source['id'])
        require(current['generation']==source['generation'] and acc['generation']==account['generation'],
                'google_selection_expired',409)
        return current

    def read_selected(self,client,source,selections):
        raw=[client.event(source['remote_id'],s['id']) for s in selections]
        series={r['id'] for r,s in zip(raw,selections) if s['scope']=='series' and r.get('status')!='cancelled'}
        children=client.events(source['remote_id'],allowed_ids=series)['items'] if series else []
        result=[]
        for item,choice in zip(raw,selections):
            require(not item.get('recurrence') or choice['scope']=='series','google_choose_series',422)
            require(choice['scope']!='series' or bool(item.get('recurrence')) or item.get('status')=='cancelled', 'google_selection_expired',409)
            value=snapshot(item,source['timezone'],[v for v in children if v.get('recurringEventId')==item['id']],choice['scope']=='one')
            if not value.get('deleted'):validate_series(value)
            result.append({'id':item['id'],'parent_id':item.get('recurringEventId',''),'scope':choice['scope'],'etag':item.get('etag'), 'snapshot':value,'original_overrides':{occurrence_key(child,source['timezone']):{'title':child.get('summary') or value.get('fields',{}).get('title',''),'description':child.get('description') or ''} for child in children if child.get('recurringEventId')==item['id'] and child.get('status')!='cancelled'},'original':{'title':item.get('summary') or '(Google Calendar)','description':item.get('description') or ''}})
        return result

    def preview(self,actor,source_id,selections):
        self.ready()
        require(isinstance(selections,list) and 0<len(selections)<=MAX_BATCH,'google_select_events')
        require(all(isinstance(v,dict) and set(v)=={'id','scope'} and isinstance(v['id'],str) and 0<len(v['id'])<=1500 and v['scope'] in ('one','series') for v in selections),'invalid_request')
        require(len({v['id'] for v in selections})==len(selections),'invalid_request')
        with self.s.db.transaction() as c:source,account=self.source(c,actor,source_id)
        values=self.read_selected(self.client(account),source,selections)
        require(all(not v['snapshot'].get('deleted') for v in values),'google_event_deleted',409)
        with self.s.db.transaction() as c:
            self.check_source(c,actor,source,account)
            for value in values:
                self.check_overlap(c,source_id,value,values)
            for value in values:
                # Validate lengths, timing and overrides before offering a successful preview.
                data=self.new_data(c,actor,account['calendar_id'],value['snapshot']['fields'],original=value.get('original'))
                cal=self.s.calendar(c,actor);self.s.validate_event(c,cal,data)
                for patch in value['snapshot']['overrides'].values():
                    if not patch.get('deleted'):self.s.validate_event(c,cal,{**data,**patch})
            preview_id=uid()
            c.execute('INSERT INTO google_previews VALUES(?,?,?,?,?,?)',
                      (preview_id,actor,source_id,source['generation'],self.vault.encrypt({'values':values,'account_generation':account['generation']}),stamp(utcnow()+timedelta(seconds=TTL))))
            items=[]
            for value in values:
                link=c.execute('SELECT event_id,state FROM google_links WHERE source_id=? AND remote_id=?',(source_id,value['id'])).fetchone()
                items.append({**value['snapshot']['fields'],'id':value['id'],'scope':value['scope'],
                              'exceptions':len(value['snapshot']['overrides']),'existing':bool(link and link['event_id']),
                              'linked':bool(link and link['state']!='disconnected')})
        return {'preview_id':preview_id,'items':items}

    def check_overlap(self,c,source_id,value,values):
        for other in values:
            if other['id']==value['id']:continue
            require(not (value['parent_id']==other['id'] or other['parent_id']==value['id']), 'google_series_overlap',409)
        existing=c.execute('SELECT l.remote_id,l.parent_id,l.event_id,e.deleted_at FROM google_links l JOIN events e ON e.id=l.event_id WHERE l.source_id=? AND e.deleted_at IS NULL',(source_id,)).fetchall()
        for link in existing:
            if value['id']==link['remote_id']:continue
            require(not (value['parent_id']==link['remote_id'] or link['parent_id']==value['id']), 'google_series_overlap',409)

    def new_data(self,c,actor,calendar_id,fields,original=None,provider='google'):
        me=self.s.user(c,actor)
        data={**fields,'language':me['language'],'translations':{},'owner':actor,'creator_id':actor,
              'category_id':None,'status':'planned','links':[],'reminders':{}}
        for m in c.execute('SELECT user_id FROM members WHERE calendar_id=?',(calendar_id,)):
            person=m['user_id'];prefs=self.s.user(c,person)
            data['reminders'][person]=prefs['default_reminders']
            if prefs.get('notifications_template_version')==2:
                data['reminders'][person]=[v for v in prefs['default_notifications'] if v>0]
                data.setdefault('reminder_at_start',{})[person]=0 in prefs['default_notifications']
        from .smart_events import capture_source
        capture_source(data,provider=provider,**(original or {}))
        return data

    def import_overrides(self,value,provider='google',originals=None):
        from .smart_events import capture_source
        for key,fields in value['overrides'].items():
            patch=deepcopy(fields)
            if not patch.get('deleted'):
                effective={**value['fields'],**patch}
                capture_source(effective,provider=provider,**((originals or {}).get(key,{})))
                patch['smart']=effective['smart']
            yield key,patch

    def apply(self,actor,preview_id,confirmed):
        self.ready();require(confirmed is True,'confirmation_required')
        with self.s.db.transaction() as c:
            row=c.execute('SELECT * FROM google_previews WHERE id=? AND user_id=? AND expires_at>?',(preview_id,actor,stamp())).fetchone()
            require(row is not None,'google_selection_expired',409)
            source,account=self.source(c,actor,row['source_id'])
            payload=self.vault.decrypt(row['data']);values=payload['values']
            require(source['generation']==row['generation'] and account['generation']==payload['account_generation'],'google_selection_expired',409)
        # Re-read before committing: confirmation never imports a stale preview.
        fresh=self.read_selected(self.client(account),source,[{'id':v['id'],'scope':v['scope']} for v in values])
        require(values==fresh,'google_preview_changed',409)
        with self.s.db.transaction() as c:
            self.check_source(c,actor,source,account)
            valid=c.execute('DELETE FROM google_previews WHERE id=? AND user_id=? AND expires_at>?',(preview_id,actor,stamp()))
            require(valid.rowcount==1,'google_selection_expired',409)
            created=reconnected=existing=0;created_events=[]
            for value in values:
                self.check_overlap(c,source['id'],value,values)
                old=c.execute('SELECT * FROM google_links WHERE source_id=? AND remote_id=?',(source['id'],value['id'])).fetchone()
                if old and old['event_id']:
                    event=c.execute('SELECT * FROM events WHERE id=?',(old['event_id'],)).fetchone()
                    require(not event['deleted_at'],'google_restore_local_first',409)
                    if old['state']=='disconnected':
                        c.execute("UPDATE google_links SET state='ready' WHERE id=?",(old['id'],))
                        self.reconcile(c,account,dict(old),value['snapshot'],value['etag'],original=value.get('original'),original_overrides=value.get('original_overrides'))
                        reconnected+=1
                    else:existing+=1
                    continue
                event_id=uid();link_id=old['id'] if old else uid()
                data=self.new_data(c,actor,account['calendar_id'],value['snapshot']['fields'],original=value.get('original'))
                self.s.validate_event(c,self.s.calendar(c,actor),data)
                c.execute('INSERT INTO events(id,calendar_id,data) VALUES(?,?,?)',(event_id,account['calendar_id'],dump(data)))
                for key,patch in self.import_overrides(value['snapshot'],originals=value.get('original_overrides')):
                    c.execute('INSERT INTO overrides VALUES(?,?,?)',(event_id,key,dump(patch)))
                c.execute("INSERT INTO google_links(id,source_id,remote_id,event_id,scope,base,remote,state,etag,checked_at,parent_id) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,remote_id) DO UPDATE SET event_id=excluded.event_id,scope=excluded.scope,base=excluded.base,remote=excluded.remote,state=excluded.state,etag=excluded.etag,checked_at=excluded.checked_at,parent_id=excluded.parent_id",
                          (link_id,source['id'],value['id'],event_id,value['scope'],dump(value['snapshot']),dump(value['snapshot']),'ready',value['etag'],stamp(),value['parent_id']))
                from .translation import enqueue_translation
                enqueue_translation(c,self.s.config,'event',event_id,account['calendar_id'],data,1)
                created+=1;created_events.append((event_id,data))
            if created:
                self.s.notify_import(c,account['calendar_id'],'google',created_events)
            c.execute("UPDATE google_sources SET next_at='' WHERE id=?",(source['id'],))
        return {'created':created,'reconnected':reconnected,'existing':existing}

    def local_snapshot(self,c,row):
        data=load(row['data'])
        fields={k:data.get(k,0 if k in ('fold','end_fold') else '') for k in FIELDS}
        if not fields['all_day']:
            for k in ('start','end'):fields[k]=datetime.fromisoformat(fields[k]).isoformat(timespec='seconds')
        overrides={}
        for ov in c.execute('SELECT * FROM overrides WHERE event_id=?',(row['id'],)):
            patch=load(ov['data'])
            external={k:v for k,v in patch.items() if k in FIELDS or k=='deleted'}
            if external:overrides[ov['occurrence']]=external
        return {'fields':fields,'overrides':overrides}

    def store_snapshot(self,c,account,row,value,provider='google',original=None,original_overrides=None):
        data=load(row['data']);previous=deepcopy(data)
        data.update(value['fields'])
        text_change=any(data[k]!=previous[k] for k in ('title','description'))
        if text_change:
            data['translations']={k:{**v,'stale':True} for k,v in data['translations'].items()}
            from .smart_events import source_changed,capture_source
            source_changed(data);capture_source(data,provider=provider,**(original or {}))
        self.s.validate_event(c,self.s.calendar(c,account['user_id']),data)
        for key,patch in value['overrides'].items():
            if not patch.get('deleted'):self.s.validate_event(c,self.s.calendar(c,account['user_id']),{**data,**patch})
        if original:
            from .smart_events import capture_source
            capture_source(data,provider=provider,**original)
        self.s.validate_event(c,self.s.calendar(c,account['user_id']),data)
        old=self.local_snapshot(c,row)
        if old==value:
            if data!=previous:c.execute('UPDATE events SET data=?,revision=revision+1 WHERE id=?',(dump(data),row['id']))
            return
        old_patches={r['occurrence']:load(r['data']) for r in c.execute('SELECT * FROM overrides WHERE event_id=?',(row['id'],))}
        override_text_change=False
        for key in set(old_patches)|set(value['overrides']):
            personal={k:v for k,v in old_patches.get(key,{}).items() if k not in FIELDS and k!='deleted'}
            if key not in value['overrides'] and not personal_override(personal):
                # Google dropped this exception and only importer bookkeeping remains.
                # A stale row would mask series data and hold back later series changes.
                c.execute('DELETE FROM overrides WHERE event_id=? AND occurrence=?',(row['id'],key));continue
            patch={**personal,**value['overrides'].get(key,{})}
            before={**previous,**old_patches.get(key,{})};after={**data,**patch}
            changed=any(before.get(k)!=after.get(k) for k in ('title','description'))
            if changed:
                override_text_change=True
                patch['translations']={l:{**tr,'stale':True} for l,tr in patch.get('translations',{}).items()}
                from .smart_events import source_changed,capture_source
                source_changed(after);capture_source(after,provider=provider,**((original_overrides or {}).get(key,{})));patch['smart']=after['smart']
            if patch:c.execute('INSERT INTO overrides VALUES(?,?,?) ON CONFLICT(event_id,occurrence) DO UPDATE SET data=excluded.data',(row['id'],key,dump(patch)))
            else:c.execute('DELETE FROM overrides WHERE event_id=? AND occurrence=?',(row['id'],key))
        c.execute('UPDATE events SET data=?,revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(dump(data),row['id']))
        c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(row['id'],))
        if text_change or override_text_change:
            from .translation import enqueue_translation
            enqueue_translation(c,self.s.config,'event',row['id'],account['calendar_id'],data,row['revision']+1)
        if any(previous.get(k)!=data.get(k) for k in IMPORTANT) or old['overrides']!=value['overrides']:
            self.s.notify(c,account['calendar_id'],None,provider+'_updated',data,row['id'])

    def reconcile(self,c,account,link,remote,etag,original=None,original_overrides=None):
        row=c.execute('SELECT * FROM events WHERE id=?',(link['event_id'],)).fetchone()
        if not row or row['deleted_at']:
            c.execute("UPDATE google_links SET state='disconnected' WHERE id=?",(link['id'],));return
        if remote.get('deleted'):
            if link['state']!='remote_deleted':self.s.notify(c,account['calendar_id'],None,'google_deleted',load(row['data']),row['id'])
            c.execute("UPDATE google_links SET state='remote_deleted',remote=?,etag=?,checked_at=? WHERE id=?",(dump(remote),etag,stamp(),link['id']));return
        base=load(link['base']);local=self.local_snapshot(c,row)
        # Moving an external series anchor with local occurrence-only preferences
        # needs an explicit identity remap. Retain everything until supported.
        if base['fields'].get('rrule') and any(base['fields'].get(k)!=remote['fields'].get(k) for k in TEMPORAL):
            patches=c.execute('SELECT occurrence,data FROM overrides WHERE event_id=?',(row['id'],)).fetchall()
            if any(personal_override(load(p['data'])) for p in patches):
                c.execute("UPDATE google_links SET state='unsupported',remote=?,etag=?,checked_at=? WHERE id=?",(dump(remote),etag,stamp(),link['id']));return
        merge=merge_fields(flattened(base),flattened(local),flattened(remote))
        if merge['conflicts']:
            if dump(remote)!=link['remote'] or link['state']!='conflict':self.s.notify(c,account['calendar_id'],None,'google_conflict',load(row['data']),row['id'])
            c.execute("UPDATE google_links SET state='conflict',remote=?,etag=?,checked_at=? WHERE id=?",(dump(remote),etag,stamp(),link['id']));return
        merged=unflattened(merge['merged'])
        self.store_snapshot(c,account,row,merged,original=original,original_overrides=original_overrides)
        c.execute('UPDATE google_links SET state=?,base=?,remote=?,etag=?,checked_at=? WHERE id=?',
                  ('ready' if merged==remote else 'local_changes',dump(remote),dump(remote),etag,stamp(),link['id']))

    def link(self,c,actor,link_id):
        link=c.execute('SELECT * FROM google_links WHERE id=?',(link_id,)).fetchone()
        require(link is not None,'google_link_not_found',404)
        source,account=self.source(c,actor,link['source_id'])
        self.s.event_row(c,actor,link['event_id'])
        return dict(link),source,account

    def conflict(self,actor,link_id):
        with self.s.db.transaction() as c:
            link,source,account=self.link(c,actor,link_id)
            row=self.s.event_row(c,actor,link['event_id'])
            return {'id':link_id,'state':link['state'],'revision':row['revision'],
                    'remote_version':digest(link['remote']),'local':self.local_snapshot(c,row),
                    'remote':load(link['remote']),'base':load(link['base'])}

    def resolve(self,actor,link_id,choice,revision,remote_version):
        require(choice in ('local','google','trash'),'invalid_request')
        with self.s.db.transaction() as c:link,source,account=self.link(c,actor,link_id)
        try:fresh=self.read_selected(self.client(account),source,[{'id':link['remote_id'],'scope':link['scope']}])[0]
        except ProviderFailure as exc:
            # Confirmed deletion tombstones can disappear from Google later.
            if exc.code not in (404,410) or link['state']!='remote_deleted':raise
            fresh={'snapshot':{'deleted':True},'etag':link['etag']}
        with self.s.db.transaction() as c:
            self.check_source(c,actor,source,account)
            current,_,_=self.link(c,actor,link_id)
            row=self.s.event_row(c,actor,link['event_id'])
            require(row['revision']==revision and digest(current['remote'])==remote_version,'google_preview_changed',409)
            if fresh['snapshot']!=load(current['remote']):
                self.reconcile(c,account,current,fresh['snapshot'],fresh['etag'])
                changed=True
            else:
                changed=False;remote=fresh['snapshot']
                require(current['state'] in ('remote_deleted','conflict'),'google_preview_changed',409)
                if remote.get('deleted'):
                    require(choice in ('local','trash'),'invalid_request')
                    if choice=='trash':
                        c.execute('UPDATE events SET deleted_at=?,revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(stamp(),row['id']))
                        c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(row['id'],))
                        self.s.notify(c,account['calendar_id'],actor,'deleted',load(row['data']),row['id'])
                    c.execute("UPDATE google_links SET state='disconnected' WHERE id=?",(link_id,))
                else:
                    require(choice in ('local','google'),'invalid_request')
                    base=load(current['base']);local=self.local_snapshot(c,row)
                    merge=merge_fields(flattened(base),flattened(local),flattened(remote))
                    merged=merge['merged']
                    for key in merge['conflicts']:
                        keys=TEMPORAL if key=='timing' else {key}
                        chosen=flattened(remote if choice=='google' else local)
                        for field in keys:merged[field]=chosen.get(field)
                    result=unflattened(merged)
                    self.store_snapshot(c,account,row,result,original=fresh.get('original'),original_overrides=fresh.get('original_overrides'))
                    c.execute('UPDATE google_links SET state=?,base=?,remote=?,etag=?,checked_at=? WHERE id=?',
                              ('ready' if result==remote else 'local_changes',dump(remote),dump(remote),fresh['etag'],stamp(),link_id))
                    self.s.notify(c,account['calendar_id'],actor,'google_resolved',load(row['data']),row['id'])
        require(not changed,'google_preview_changed',409)
        return {'ok':True}

    def sync_source(self,actor,source_id,force=False):
        self.ready()
        now=utcnow()
        with self.s.db.transaction() as c:
            source,account=self.source(c,actor,source_id)
            if source['lease_until'] and source['lease_until']>stamp(now):return {'state':'running'}
            if not force and source['next_at']>stamp(now):return {'state':'waiting'}
            # Lease prevents overlapping manual/background fetches and is crash-recoverable.
            lease=stamp(now+timedelta(minutes=10))
            c.execute('UPDATE google_sources SET lease_until=? WHERE id=?',(lease,source_id))
            links=[dict(v) for v in c.execute("SELECT * FROM google_links WHERE source_id=? AND state!='disconnected' AND event_id IS NOT NULL",(source_id,))]
            known={v['remote_id'] for v in c.execute('SELECT remote_id FROM google_links WHERE source_id=?',(source_id,))}
            skips={v['remote_id']:v['etag'] for v in c.execute('SELECT remote_id,etag FROM google_auto_skips WHERE source_id=?',(source_id,))}
        try:
            client=self.client(account)
            delta=client.events(source['remote_id'],source['sync_token'],
                                allowed_ids=None if source['auto_import'] else {l['remote_id'] for l in links})
            changed={v['id'] for v in delta['items']}|{v.get('recurringEventId') for v in delta['items']}
            selected=[{'id':l['remote_id'],'scope':l['scope']} for l in links if delta['reset'] or not source['sync_token'] or l['remote_id'] in changed or l['state']=='unsupported']
            deleted={v['id']:v for v in delta['items'] if v.get('status')=='cancelled' and not v.get('recurringEventId')}
            values=[];failed=[]
            for choice in selected:
                if choice['id'] in deleted:
                    values.append({'id':choice['id'],'snapshot':{'deleted':True},'etag':deleted[choice['id']].get('etag')});continue
                try:values.extend(self.read_selected(client,source,[choice]))
                except (Problem,KeyError,ValueError,TypeError):failed.append(choice['id'])

            # Opt-in is explicit and per source. The initial pass also finds
            # existing upcoming events (including events created before consent).
            # Replaying the previous cursor drains large batches without loss.
            candidates=[]
            if source['auto_import']:
                candidates=[item for item in delta['items']
                            if item.get('id') and item['id'] not in known
                            and skips.get(item['id']) != (item.get('etag') or '')
                            and eligible_auto(item,source['timezone'],now)]
                candidates.sort(key=lambda item: (
                    (item.get('start') or {}).get('dateTime') or
                    (item.get('start') or {}).get('date') or ''))
            more_auto=len(candidates)>AUTO_BATCH
            auto_values=[];new_skips=[]
            for item in candidates[:AUTO_BATCH]:
                try:
                    auto_values.extend(self.read_selected(client,source,[{
                        'id':item['id'],'scope':'series' if item.get('recurrence') else 'one'
                    }]))
                except (Problem,KeyError,ValueError,TypeError):
                    # Keep only the remote ID and ETag; retry if Google changes it.
                    new_skips.append((item['id'],item.get('etag') or ''))
            with self.s.db.transaction() as c:
                current=self.check_source(c,actor,source,account)
                require(current['lease_until']==lease,'google_selection_expired',409)
                by_id={v['id']:v for v in values}
                for old in links:
                    if old['remote_id'] in failed:
                        c.execute("UPDATE google_links SET state='unsupported',checked_at=? WHERE id=? AND state!='disconnected'",(stamp(),old['id']));continue
                    if old['remote_id'] not in by_id:continue
                    link=c.execute('SELECT * FROM google_links WHERE id=?',(old['id'],)).fetchone()
                    if link and link['state']!='disconnected':
                        value=by_id[old['remote_id']]
                        c.execute('SAVEPOINT google_event')
                        try:self.reconcile(c,account,dict(link),value['snapshot'],value['etag'],original=value.get('original'),original_overrides=value.get('original_overrides'))
                        except (Problem,KeyError,ValueError,TypeError):
                            c.execute('ROLLBACK TO google_event')
                            c.execute("UPDATE google_links SET state='unsupported',checked_at=? WHERE id=?",(stamp(),old['id']))
                        finally:c.execute('RELEASE google_event')

                created=0;created_events=[]
                if source['auto_import']:
                    for value in auto_values:
                        # A manual import or an earlier batch always wins.
                        if c.execute('SELECT 1 FROM google_links WHERE source_id=? AND remote_id=?',
                                     (source_id,value['id'])).fetchone():continue
                        c.execute('SAVEPOINT google_auto_event')
                        try:
                            self.check_overlap(c,source_id,value,[value])
                            fields=value['snapshot']['fields']
                            data=self.new_data(c,actor,account['calendar_id'],fields,original=value.get('original'))
                            cal=self.s.calendar(c,actor)
                            self.s.validate_event(c,cal,data)
                            for patch in value['snapshot']['overrides'].values():
                                if not patch.get('deleted'):
                                    self.s.validate_event(c,cal,{**data,**patch})
                            event_id=uid()
                            c.execute('INSERT INTO events(id,calendar_id,data) VALUES(?,?,?)',
                                      (event_id,account['calendar_id'],dump(data)))
                            for key,patch in self.import_overrides(value['snapshot'],originals=value.get('original_overrides')):
                                c.execute('INSERT INTO overrides VALUES(?,?,?)',(event_id,key,dump(patch)))
                            c.execute("INSERT INTO google_links(id,source_id,remote_id,event_id,scope,base,remote,state,etag,checked_at,parent_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                      (uid(),source_id,value['id'],event_id,value['scope'],dump(value['snapshot']),dump(value['snapshot']),
                                       'ready',value['etag'],stamp(),value['parent_id']))
                            from .translation import enqueue_translation
                            enqueue_translation(c,self.s.config,'event',event_id,account['calendar_id'],data,1)
                            created+=1;created_events.append((event_id,data))
                        except (Problem,KeyError,ValueError,TypeError):
                            c.execute('ROLLBACK TO google_auto_event')
                            new_skips.append((value['id'],value.get('etag') or ''))
                        finally:c.execute('RELEASE google_auto_event')
                    for remote_id,etag in new_skips:
                        c.execute("INSERT INTO google_auto_skips(source_id,remote_id,etag) VALUES(?,?,?) ON CONFLICT(source_id,remote_id) DO UPDATE SET etag=excluded.etag",
                                  (source_id,remote_id,etag))
                    if created:
                        self.s.notify_import(c,account['calendar_id'],'google',created_events)

                cursor=(None if delta['reset'] else source['sync_token']) if more_auto else delta['sync_token']
                delay=15 if more_auto else POLL
                c.execute("UPDATE google_sources SET sync_token=?,next_at=?,state='ready',attempts=0,lease_until=NULL WHERE id=?",
                          (cursor,stamp(now+timedelta(seconds=delay)),source_id))
            return {'state':'ready','created':created}
        except (ProviderFailure,Problem,KeyError,ValueError,TypeError) as exc:
            state='delayed'
            if isinstance(exc,ProviderFailure) and exc.code in (401,):state='needs_reconnect'
            if isinstance(exc,ProviderFailure) and exc.code in (403,404):state='unavailable'
            if isinstance(exc,Problem) and exc.code=='google_reconnect':state='needs_reconnect'
            delay=max(getattr(exc,'retry_after',0),min(3600,30*2**min(source['attempts'],7)))+random.randint(0,15)
            with self.s.db.transaction() as c:
                c.execute('UPDATE google_sources SET state=?,next_at=?,attempts=attempts+1,lease_until=NULL WHERE id=? AND generation=? AND lease_until=?',
                          (state,stamp(now+timedelta(seconds=delay)),source_id,source['generation'],lease))
                if state=='needs_reconnect':c.execute("UPDATE google_accounts SET state='needs_reconnect' WHERE id=? AND generation=?",(account['id'],account['generation']))
            if force:
                if isinstance(exc,Problem):raise
                raise Problem(503,'google_'+state)
            return {'state':state}

    def ensure_watch(self,actor,source_id):
        with self.s.db.transaction() as c:
            source,account=self.source(c,actor,source_id)
            active=c.execute('SELECT 1 FROM google_watches WHERE source_id=? AND source_generation=? AND account_generation=? AND ((resource_id IS NULL AND expires_at>?) OR expires_at>?)',
                             (source_id,source['generation'],account['generation'],stamp(),stamp(utcnow()+timedelta(minutes=30)))).fetchone()
            if active:return
            channel=uid();token=secrets.token_urlsafe(32)
            # A short provisional row covers the initial push arriving before watch returns.
            c.execute('INSERT INTO google_watches VALUES(?,?,?,?,?,?,?)',
                      (channel,source_id,digest(token),None,stamp(utcnow()+timedelta(minutes=5)),source['generation'],account['generation']))
        client=self.client(account)
        if not hasattr(client,'watch_events'):return
        result=client.watch_events(source['remote_id'],channel,token,self.s.config.public_url+'/api/google/push',int((utcnow()+timedelta(hours=6)).timestamp()*1000))
        expires=datetime.fromtimestamp(int(result['expiration'])/1000,UTC)
        with self.s.db.transaction() as c:
            self.check_source(c,actor,source,account)
            c.execute('UPDATE google_watches SET resource_id=?,expires_at=? WHERE channel_id=?',(result['resourceId'],stamp(expires),channel))

    def pushed(self,headers):
        channel=headers.get('x-goog-channel-id','');token=headers.get('x-goog-channel-token','')
        with self.s.db.transaction() as c:
            watch=c.execute('SELECT w.*,s.generation AS current_source,a.generation AS current_account,s.selected,a.state,ca.state AS lifecycle,m.active FROM google_watches w JOIN google_sources s ON s.id=w.source_id JOIN google_accounts a ON a.id=s.account_id JOIN calendars ca ON ca.id=a.calendar_id JOIN members m ON m.user_id=a.user_id AND m.calendar_id=ca.id WHERE w.channel_id=?',(channel,)).fetchone()
            require(watch is not None and hmac.compare_digest(watch['token_hash'],digest(token)), 'invalid_google_push',403)
            require(watch['expires_at']>stamp() and (not watch['resource_id'] or watch['resource_id']==headers.get('x-goog-resource-id')), 'invalid_google_push',403)
            if watch['selected'] and watch['active'] and watch['state']=='connected' and watch['lifecycle']=='active' and watch['source_generation']==watch['current_source'] and watch['account_generation']==watch['current_account']:
                c.execute("UPDATE google_sources SET next_at='' WHERE id=?",(watch['source_id'],))
        return {'ok':True}

    def run_due(self):
        if not self.configured:return
        with self.s.db.transaction() as c:
            c.execute('DELETE FROM google_oauth_requests WHERE expires_at<=?',(stamp(),))
            c.execute('DELETE FROM google_previews WHERE expires_at<=?',(stamp(),))
            c.execute('DELETE FROM google_watches WHERE expires_at<=?',(stamp(),))
            rows=c.execute("SELECT s.id,a.user_id FROM google_sources s JOIN google_accounts a ON a.id=s.account_id JOIN calendars ca ON ca.id=a.calendar_id JOIN members m ON m.user_id=a.user_id AND m.calendar_id=ca.id WHERE s.selected=1 AND a.state='connected' AND ca.state='active' AND m.active=1 AND s.next_at<=? AND (s.lease_until IS NULL OR s.lease_until<=?) ORDER BY s.next_at LIMIT 5",(stamp(),stamp())).fetchall()
        for row in rows:
            try:self.sync_source(row['user_id'],row['id'])
            except Exception:
                # One broken source must never stop other accounts or reminders.
                continue
        # Watch failures never disable the polling fallback.
        with self.s.db.transaction() as c:
            watches=c.execute("SELECT s.id,a.user_id FROM google_sources s JOIN google_accounts a ON a.id=s.account_id JOIN calendars ca ON ca.id=a.calendar_id JOIN members m ON m.user_id=a.user_id AND m.calendar_id=ca.id WHERE s.selected=1 AND a.state='connected' AND ca.state='active' AND m.active=1 AND NOT EXISTS (SELECT 1 FROM google_watches w WHERE w.source_id=s.id AND w.source_generation=s.generation AND w.account_generation=a.generation AND ((w.resource_id IS NULL AND w.expires_at>?) OR w.expires_at>?)) LIMIT 5",(stamp(),stamp(utcnow()+timedelta(minutes=30)))).fetchall()
        for row in watches:
            try:self.ensure_watch(row['user_id'],row['id'])
            except Exception:continue

