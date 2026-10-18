"""Per-owner iCloud CalDAV import-only integration. No remote write methods.
Only explicitly selected sources are scanned. Automatic sharing is separate consent.
"""
from datetime import date, datetime, timedelta
import random
from icalendar import Calendar
from .providers.icloud import ICloudCalDAV
from .providers.http import ProviderFailure
from .providers.vault import CredentialVault
from .google_import import GoogleImports, FIELDS, flattened, unflattened, validate_series
from .sync_policy import merge_fields
from .recurrence import UTC, stamp, utcnow, zone, validate_timing
from .security import require, Problem, digest
from .service import uid, dump, load

POLL = 300
MAX_REMOTE = 2000
AUTO_BATCH = 20


def _local(value, timezone):
    """Convert an iCalendar date/datetime to the internal local wall time."""
    if isinstance(value, datetime):
        # RFC 5545 also permits floating local DATE-TIME values.
        if value.tzinfo is None:
            return value.isoformat(timespec='seconds')
        return value.astimezone(zone(timezone)).replace(tzinfo=None).isoformat(timespec='seconds')
    if isinstance(value, date):
        return value.isoformat()
    raise Problem(422, 'icloud_unsupported_event')


def _fields(component, timezone, recurring=True):
    start = component.decoded('DTSTART')
    all_day = not isinstance(start, datetime)
    has_end = component.get('DTEND') is not None
    has_duration = component.get('DURATION') is not None
    require(not (has_end and has_duration), 'icloud_unsupported_event', 422)
    if has_end:
        end = component.decoded('DTEND')
    elif has_duration:
        duration = component.decoded('DURATION')
        require(isinstance(duration, timedelta) and duration.total_seconds() > 0,
                'icloud_unsupported_event', 422)
        end = start + duration
    else:
        # RFC 5545: an all-day VEVENT without DTEND lasts exactly one day.
        # A zero-duration timed VEVENT cannot be represented by Our Calendar.
        require(all_day, 'icloud_unsupported_event', 422)
        end = start + timedelta(days=1)
    require(all_day == (not isinstance(end, datetime)), 'icloud_unsupported_event', 422)
    tzid = component.get('DTSTART').params.get('TZID') if isinstance(start,datetime) else None
    timezone = str(tzid or getattr(getattr(start,'tzinfo',None),'key',None) or timezone)
    zone(timezone)
    rule = ''
    if recurring and component.get('RRULE'):
        rule = component['RRULE'].to_ical().decode('utf-8').upper()
    # RDATE cannot yet be mapped without losing additional occurrences.
    require(not component.get('RDATE'), 'icloud_unsupported_recurrence', 422)
    result = {
        'title': str(component.get('SUMMARY') or '(iCloud Calendar)'),
        'description': str(component.get('DESCRIPTION') or ''),
        'location': str(component.get('LOCATION') or ''),
        'start': _local(start, timezone), 'end': _local(end, timezone),
        'all_day': all_day, 'timezone': timezone,
        'fold': start.astimezone(zone(timezone)).fold if isinstance(start,datetime) and start.tzinfo else 0,
        'end_fold': end.astimezone(zone(timezone)).fold if isinstance(end,datetime) and end.tzinfo else 0,
        'rrule': rule
    }
    validate_timing(result)
    return result


def _occurrence(value, timezone):
    return _local(value, timezone)[:16] if isinstance(value, datetime) else value.isoformat()


def parse_resource(item, timezone):
    """Safely parse a single CalDAV resource, retaining recurrence exceptions."""
    try:
        cal = Calendar.from_ical(item['ics'])
        components = [c for c in cal.walk('VEVENT')]
        require(components and len(components) <= 250, 'icloud_unsupported_event', 422)
        masters = [c for c in components if not c.get('RECURRENCE-ID')]
        require(len(masters) == 1, 'icloud_unsupported_recurrence', 422)
        master = masters[0]
        require(master.get('UID') is not None, 'icloud_unsupported_event', 422)
        uid_value = str(master.get('UID'))
        require(all(str(c.get('UID')) == uid_value for c in components),
                'icloud_unsupported_recurrence', 422)
        if str(master.get('STATUS','')).upper() == 'CANCELLED':
            return {'deleted': True}
        fields = _fields(master,timezone)
        overrides = {}
        for ex in master.get('EXDATE', []) if isinstance(master.get('EXDATE'),list) else ([master.get('EXDATE')] if master.get('EXDATE') else []):
            for dt in ex.dts:
                overrides[_occurrence(dt.dt,fields['timezone'])] = {'deleted': True}
        for child in components:
            if child is master: continue
            key = _occurrence(child.decoded('RECURRENCE-ID'),fields['timezone'])
            require(fields['rrule'], 'icloud_unsupported_recurrence',422)
            if str(child.get('STATUS','')).upper() == 'CANCELLED':
                overrides[key] = {'deleted': True}
            else:
                overrides[key] = _fields(child,fields['timezone'],False)
        result = {'fields':fields,'overrides':overrides}
        validate_series(result)
        return result
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError) as exc:
        raise Problem(422,'icloud_unsupported_event') from None


def eligible(value, now, timezone):
    if value.get('deleted'): return False
    fields = value['fields']
    if fields['rrule']: return True
    if fields['all_day']: return date.fromisoformat(fields['end']) > now.astimezone(zone(timezone)).date()
    end = datetime.fromisoformat(fields['end']).replace(tzinfo=zone(timezone))
    return end.astimezone(UTC) > now


class ICloudImports:
    def __init__(self, service, provider=ICloudCalDAV):
        self.s = service
        self.provider = provider
        key = service.config.icloud_credential_key or service.config.google_credential_key
        self.configured = bool(key)
        self.vault = CredentialVault(key) if key else None
        self.helpers = GoogleImports(service)

    def ready(self):
        require(self.configured, 'icloud_not_configured',503)

    def account(self,c,actor,account_id,connected=True):
        cal=self.s.calendar(c,actor)
        row=c.execute('SELECT * FROM icloud_accounts WHERE id=? AND user_id=? AND calendar_id=?',
                      (account_id,actor,cal['id'])).fetchone()
        require(row is not None, 'icloud_account_not_found',404)
        if connected:require(row['state']=='connected' and row['credentials'], 'icloud_reconnect',409)
        return dict(row)

    def source(self,c,actor,source_id):
        row=c.execute('SELECT * FROM icloud_sources WHERE id=?',(source_id,)).fetchone()
        require(row is not None,'icloud_source_not_found',404)
        account=self.account(c,actor,row['account_id'])
        require(row['selected'],'icloud_source_not_selected',409)
        return dict(row),account

    def client(self,account):
        secret=self.vault.decrypt(account['credentials'])
        return self.provider(secret['email'],secret['password'])

    def previews(self,account,source):
        client=self.client(account)
        # Keep compatible with older injected providers and test adapters.
        if callable(getattr(client,'previews',None)):
            items=client.previews(source['remote_id'])
        else:
            items=client.events(source['remote_id'])
        require(len(items)<=MAX_REMOTE,'icloud_calendar_too_large',413)
        return client,items

    @staticmethod
    def full_item(client,item):
        if callable(getattr(client,'resource',None)):
            result=client.resource(item['url'])
            return {**item,'ics':result['ics']}
        return item

    def status(self,actor):
        with self.s.db.transaction() as c:
            cal=self.s.calendar(c,actor)
            accounts=[]
            for a in c.execute('SELECT id,email,state FROM icloud_accounts WHERE user_id=? AND calendar_id=?',(actor,cal['id'])):
                sources=[]
                for src in c.execute('SELECT id,name,selected,auto_import,state,checked_at FROM icloud_sources WHERE account_id=?',(a['id'],)):
                    count=c.execute('SELECT COUNT(*) AS n FROM icloud_links WHERE source_id=? AND event_id IS NOT NULL',(src['id'],)).fetchone()['n']
                    issues=[dict(v) for v in c.execute("SELECT l.id,l.state,json_extract(e.data,'$.title') AS title FROM icloud_links l JOIN events e ON e.id=l.event_id WHERE l.source_id=? AND l.state IN ('conflict','remote_deleted')",(src['id'],))]
                    sources.append({**dict(src),'linked_count':count,'issues':issues})
                accounts.append({**dict(a),'mode':'import_only','sources':sources})
            return {'configured':self.configured,'accounts':accounts}

    def connect(self,actor,email,password):
        self.ready()
        require(isinstance(email,str) and 3<=len(email)<=255 and '@' in email,'invalid_request')
        require(isinstance(password,str) and 8<=len(password)<=128,'invalid_request')
        # Reject inactive/nonmember users before attempting a remote login.
        with self.s.db.transaction() as c:self.s.calendar(c,actor)
        # Network validation happens before saving any credentials.
        calendars=self.provider(email.strip(),password.strip()).discover()
        require(isinstance(calendars,list),'icloud_unavailable',503)
        with self.s.db.transaction() as c:
            cal=self.s.calendar(c,actor)
            account_id=uid()
            previous=c.execute('SELECT id FROM icloud_accounts WHERE user_id=? AND calendar_id=? AND email=?',
                               (actor,cal['id'],email.strip().lower())).fetchone()
            if previous:account_id=previous['id']
            c.execute("""INSERT INTO icloud_accounts(id,user_id,calendar_id,email,credentials)
                         VALUES(?,?,?,?,?) ON CONFLICT(user_id,calendar_id,email)
                         DO UPDATE SET credentials=excluded.credentials,state='connected',generation=icloud_accounts.generation+1""",
                      (account_id,actor,cal['id'],email.strip().lower(),
                       self.vault.encrypt({'email':email.strip(),'password':password.strip()})))
            # Reconnecting must not silently re-enable auto sharing.
            c.execute("UPDATE icloud_sources SET selected=0,auto_import=0,generation=generation+1,lease_until=NULL WHERE account_id=?",(account_id,))
            c.execute("UPDATE icloud_links SET state='disconnected' WHERE source_id IN (SELECT id FROM icloud_sources WHERE account_id=?)",(account_id,))
        return self.status(actor)

    def disconnect(self,actor,account_id):
        with self.s.db.transaction() as c:
            self.account(c,actor,account_id,False)
            c.execute("UPDATE icloud_accounts SET credentials=NULL,state='disconnected',generation=generation+1 WHERE id=?",(account_id,))
            c.execute("UPDATE icloud_sources SET selected=0,auto_import=0,generation=generation+1,lease_until=NULL WHERE account_id=?",(account_id,))
            c.execute("UPDATE icloud_links SET state='disconnected' WHERE source_id IN (SELECT id FROM icloud_sources WHERE account_id=?)",(account_id,))
        return self.status(actor)

    def calendars(self,actor,account_id):
        with self.s.db.transaction() as c:account=self.account(c,actor,account_id)
        calendars=self.client(account).discover()
        with self.s.db.transaction() as c:
            current=self.account(c,actor,account_id)
            require(current['generation']==account['generation'],'icloud_selection_expired',409)
            result=[]
            for item in calendars[:100]:
                remote=item['url'];name=item['name'] or 'iCloud Calendar'
                c.execute("""INSERT INTO icloud_sources(id,account_id,remote_id,name,timezone)
                             VALUES(?,?,?,?,?) ON CONFLICT(account_id,remote_id)
                             DO UPDATE SET name=excluded.name""",(uid(),account_id,remote,name,self.s.user(c,actor)['timezone']))
                src=c.execute('SELECT id,name,selected,auto_import FROM icloud_sources WHERE account_id=? AND remote_id=?',(account_id,remote)).fetchone()
                result.append(dict(src))
            return result

    def select(self,actor,account_id,ids,auto_ids):
        require(isinstance(ids,list) and isinstance(auto_ids,list) and len(ids)<=100 and len(auto_ids)<=100 and
                all(isinstance(v,str) for v in ids+auto_ids) and len(set(ids))==len(ids) and len(set(auto_ids))==len(auto_ids) and
                set(auto_ids)<=set(ids),'invalid_request')
        with self.s.db.transaction() as c:
            self.account(c,actor,account_id)
            rows=c.execute('SELECT * FROM icloud_sources WHERE account_id=?',(account_id,)).fetchall()
            require(set(ids)<={row['id'] for row in rows},'icloud_source_not_found',404)
            for row in rows:
                selected=int(row['id'] in ids);auto=int(row['id'] in auto_ids)
                if selected!=row['selected'] or auto!=row['auto_import']:
                    c.execute("UPDATE icloud_sources SET selected=?,auto_import=?,generation=generation+1,next_at='',lease_until=NULL WHERE id=?",
                              (selected,auto,row['id']))
                    if not selected:c.execute("UPDATE icloud_links SET state='disconnected' WHERE source_id=?",(row['id'],))
        return self.status(actor)



    def conflict(self,actor,link_id):
        with self.s.db.transaction() as c:
            link=c.execute('SELECT * FROM icloud_links WHERE id=?',(link_id,)).fetchone()
            require(link is not None,'icloud_link_not_found',404)
            source,account=self.source(c,actor,link['source_id'])
            row=self.s.event_row(c,actor,link['event_id'])
            return {'id':link_id,'state':link['state'],'revision':row['revision'],
                    'remote_version':digest(link['remote']),
                    'local':self.helpers.local_snapshot(c,row),
                    'remote':load(link['remote'])}

    def resolve(self,actor,link_id,choice,revision,remote_version):
        require(choice in ('local','icloud','trash'),'invalid_request')
        with self.s.db.transaction() as c:
            link=c.execute('SELECT * FROM icloud_links WHERE id=?',(link_id,)).fetchone()
            require(link is not None,'icloud_link_not_found',404)
            source,account=self.source(c,actor,link['source_id'])
            require(link['state'] in ('conflict','remote_deleted'),'icloud_selection_expired',409)
        items=self.client(account).events(source['remote_id'])
        require(len(items)<=MAX_REMOTE,'icloud_calendar_too_large',413)
        found=next((item for item in items if item['url']==link['remote_id']),None)
        remote=parse_resource(found,source['timezone']) if found else {'deleted':True}
        with self.s.db.transaction() as c:
            current,active=self.source(c,actor,source['id'])
            require(current['generation']==source['generation'] and active['generation']==account['generation'],
                    'icloud_selection_expired',409)
            linked=c.execute('SELECT * FROM icloud_links WHERE id=?',(link_id,)).fetchone()
            row=self.s.event_row(c,actor,link['event_id'])
            require(row['revision']==revision and digest(linked['remote'])==remote_version and
                    load(linked['remote'])==remote,'icloud_selection_expired',409)
            if remote.get('deleted'):
                require(choice in ('local','trash'),'invalid_request')
                if choice=='trash':
                    c.execute('UPDATE events SET deleted_at=?,revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(stamp(),row['id']))
                    c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(row['id'],))
                    self.s.notify(c,account['calendar_id'],actor,'deleted',load(row['data']),row['id'])
                c.execute("UPDATE icloud_links SET state='disconnected' WHERE id=?",(link_id,))
            else:
                require(choice in ('local','icloud'),'invalid_request')
                if choice=='icloud':
                    self.helpers.store_snapshot(c,account,row,remote,provider='icloud')
                c.execute("UPDATE icloud_links SET state=?,base=?,remote=?,etag=?,checked_at=? WHERE id=?",
                          ('ready' if choice=='icloud' else 'local_changes',
                           dump(remote),dump(remote),found['etag'],stamp(),link_id))
        return {'ok':True}

    def browse(self,actor,source_id):
        with self.s.db.transaction() as c:source,account=self.source(c,actor,source_id)
        _,items=self.previews(account,source)
        result=[]
        for item in items:
            try:
                value=parse_resource(item,source['timezone'])
                if value.get('deleted'):continue
                fields=value['fields']
                result.append({'id':item['url'],'title':fields['title'],'start':fields['start'],
                               'end':fields['end'],'supported':True,'series':bool(fields['rrule'])})
            except Problem:
                # One malformed VEVENT must not hide the rest of the private picker.
                result.append({'id':item['url'],'title':'(Unsupported iCloud event)',
                               'start':'','end':'','supported':False,'series':False})
        with self.s.db.transaction() as c:
            current,active=self.source(c,actor,source_id)
            require(current['generation']==source['generation'] and active['generation']==account['generation'],
                    'icloud_selection_expired',409)
        return {'items':result}

    def import_selected(self,actor,source_id,ids,confirmed=False):
        require(confirmed is True,'confirmation_required')
        require(isinstance(ids,list) and 0<len(ids)<=50 and len(ids)==len(set(ids))
                and all(isinstance(i,str) and len(i)<2000 for i in ids),'invalid_request')
        with self.s.db.transaction() as c:source,account=self.source(c,actor,source_id)
        client,items=self.previews(account,source)
        by_id={i['url']:i for i in items}
        require(set(ids)<=set(by_id),'icloud_selection_expired',409)
        values=[]
        for rid in ids:
            # The selected URL is checked against this source before any GET.
            item=self.full_item(client,by_id[rid])
            value=parse_resource(item,source['timezone'])
            require(not value.get('deleted'),'icloud_unsupported_event',422)
            values.append((item,value))
        with self.s.db.transaction() as c:
            current,active=self.source(c,actor,source_id)
            require(current['generation']==source['generation'] and active['generation']==account['generation'],
                    'icloud_selection_expired',409)
            created=existing=0
            for item,value in values:
                old=c.execute('SELECT id FROM icloud_links WHERE source_id=? AND remote_id=?',
                              (source_id,item['url'])).fetchone()
                if old and c.execute('SELECT event_id FROM icloud_links WHERE id=?',(old['id'],)).fetchone()['event_id']:
                    existing+=1
                    continue
                if old:c.execute('DELETE FROM icloud_links WHERE id=?',(old['id'],))
                data=self.helpers.new_data(c,actor,account['calendar_id'],value['fields'],provider='icloud')
                self.s.validate_event(c,self.s.calendar(c,actor),data)
                for patch in value['overrides'].values():
                    if not patch.get('deleted'):self.s.validate_event(c,self.s.calendar(c,actor),{**data,**patch})
                event_id=uid()
                c.execute('INSERT INTO events(id,calendar_id,data) VALUES(?,?,?)',
                          (event_id,account['calendar_id'],dump(data)))
                for key,patch in self.helpers.import_overrides(value,provider='icloud'):
                    c.execute('INSERT INTO overrides VALUES(?,?,?)',(event_id,key,dump(patch)))
                c.execute("""INSERT INTO icloud_links(id,source_id,remote_id,event_id,base,remote,state,etag,checked_at)
                             VALUES(?,?,?,?,?,?,?,?,?)""",
                          (uid(),source_id,item['url'],event_id,dump(value),dump(value),'ready',item['etag'],stamp()))
                from .translation import enqueue_translation
                enqueue_translation(c,self.s.config,'event',event_id,account['calendar_id'],data,1)
                created+=1
            if created:self.s.notify(c,account['calendar_id'],actor,'icloud_imported',{'title':str(created)})
            c.execute("UPDATE icloud_sources SET next_at='' WHERE id=?",(source_id,))
        return {'created':created,'existing':existing}

    def sync_source(self,actor,source_id,force=False):
        now=utcnow()
        with self.s.db.transaction() as c:
            source,account=self.source(c,actor,source_id)
            if source['lease_until'] and source['lease_until']>stamp(now):return {'state':'running'}
            if not force and source['next_at']>stamp(now):return {'state':'waiting'}
            lease=stamp(now+timedelta(minutes=10))
            c.execute('UPDATE icloud_sources SET lease_until=? WHERE id=?',(lease,source_id))
            links=[dict(v) for v in c.execute('SELECT * FROM icloud_links WHERE source_id=?',(source_id,))]
        try:
            items=self.client(account).events(source['remote_id'])
            require(len(items)<=MAX_REMOTE,'icloud_calendar_too_large',413)
            present=set()
            parsed=[]
            failed=set()
            for item in items:
                remote_id=item['url'];present.add(remote_id)
                old=next((l for l in links if l['remote_id']==remote_id),None)
                if old and old['state']=='disconnected':continue
                if not old and not source['auto_import']:continue
                if old and old['etag']==item['etag'] and old['state'] in ('ready','local_changes','conflict'):continue
                try:remote=parse_resource(item,source['timezone'] or 'UTC')
                except Problem:
                    failed.add(remote_id);continue
                parsed.append((item,remote,old))
            with self.s.db.transaction() as c:
                current,active=self.source(c,actor,source_id)
                require(current['generation']==source['generation'] and active['generation']==account['generation']
                        and current['lease_until']==lease,'icloud_selection_expired',409)
                created=0
                for item,remote,old in parsed:
                    rid=item['url'];etag=item['etag']
                    if old and old['event_id']:
                        if remote.get('deleted'):
                            if old['state']!='remote_deleted':self.s.notify(c,account['calendar_id'],None,'icloud_deleted',load(row['data']) if (row:=c.execute('SELECT * FROM events WHERE id=?',(old['event_id'],)).fetchone()) else {},old['event_id'])
                            c.execute("UPDATE icloud_links SET state='remote_deleted',remote=?,etag=?,checked_at=? WHERE id=?",
                                      (dump(remote),etag,stamp(),old['id']))
                            continue
                        row=c.execute('SELECT * FROM events WHERE id=?',(old['event_id'],)).fetchone()
                        if not row or row['deleted_at']:
                            c.execute("UPDATE icloud_links SET state='disconnected' WHERE id=?",(old['id'],));continue
                        base=load(old['base']);local=self.helpers.local_snapshot(c,row)
                        merge=merge_fields(flattened(base),flattened(local),flattened(remote))
                        if merge['conflicts']:
                            if old['state']!='conflict':self.s.notify(c,account['calendar_id'],None,'icloud_conflict',load(row['data']),row['id'])
                            c.execute("UPDATE icloud_links SET state='conflict',remote=?,etag=?,checked_at=? WHERE id=?",
                                      (dump(remote),etag,stamp(),old['id']))
                        else:
                            merged=unflattened(merge['merged'])
                            self.helpers.store_snapshot(c,account,row,merged,provider='icloud')
                            c.execute("UPDATE icloud_links SET state=?,base=?,remote=?,etag=?,checked_at=? WHERE id=?",
                                      ('ready' if merged==remote else 'local_changes',dump(remote),dump(remote),etag,stamp(),old['id']))
                        continue
                    if old or not source['auto_import'] or not eligible(remote,now,source['timezone'] or 'UTC') or created>=AUTO_BATCH:
                        continue
                    data=self.helpers.new_data(c,actor,account['calendar_id'],remote['fields'],provider='icloud')
                    try:
                        self.s.validate_event(c,self.s.calendar(c,actor),data)
                        for patch in remote['overrides'].values():
                            if not patch.get('deleted'):self.s.validate_event(c,self.s.calendar(c,actor),{**data,**patch})
                    except Problem:
                        failed.add(rid);continue
                    event_id=uid()
                    c.execute('INSERT INTO events(id,calendar_id,data) VALUES(?,?,?)',(event_id,account['calendar_id'],dump(data)))
                    for key,patch in self.helpers.import_overrides(remote,provider='icloud'):
                        c.execute('INSERT INTO overrides VALUES(?,?,?)',(event_id,key,dump(patch)))
                    c.execute("""INSERT INTO icloud_links(id,source_id,remote_id,event_id,base,remote,state,etag,checked_at)
                                 VALUES(?,?,?,?,?,?,?,?,?)""",
                              (uid(),source_id,rid,event_id,dump(remote),dump(remote),'ready',etag,stamp()))
                    from .translation import enqueue_translation
                    enqueue_translation(c,self.s.config,'event',event_id,account['calendar_id'],data,1)
                    created+=1
                for old in links:
                    if old['remote_id'] not in present and old['state'] not in ('remote_deleted','disconnected'):
                        row=c.execute('SELECT * FROM events WHERE id=?',(old['event_id'],)).fetchone()
                        if row:self.s.notify(c,account['calendar_id'],None,'icloud_deleted',load(row['data']),row['id'])
                        c.execute("UPDATE icloud_links SET state='remote_deleted',remote=?,checked_at=? WHERE id=?",
                                  (dump({'deleted':True}),stamp(),old['id']))
                # A source with > AUTO_BATCH pending events is drained over later passes.
                more=sum(1 for item,remote,old in parsed if not old and not remote.get('deleted'))>AUTO_BATCH
                c.execute("UPDATE icloud_sources SET next_at=?,state=?,attempts=0,lease_until=NULL,checked_at=? WHERE id=?",
                          (stamp(now+timedelta(seconds=15 if more else POLL)), 'unsupported' if failed else 'ready',stamp(),source_id))
                if created:self.s.notify(c,account['calendar_id'],actor,'icloud_imported',{'title':str(created)})
            return {'state':'unsupported' if failed else 'ready','created':created}
        except (ProviderFailure,Problem,ValueError,TypeError,KeyError) as exc:
            state='needs_reconnect' if isinstance(exc,ProviderFailure) and exc.code in (400,401) else 'delayed'
            delay=max(getattr(exc,'retry_after',0),min(3600,30*2**min(source['attempts'],7)))+random.randint(0,15)
            with self.s.db.transaction() as c:
                c.execute('UPDATE icloud_sources SET state=?,attempts=attempts+1,next_at=?,lease_until=NULL WHERE id=? AND generation=? AND lease_until=?',
                          (state,stamp(now+timedelta(seconds=delay)),source_id,source['generation'],lease))
                if state=='needs_reconnect':
                    c.execute("UPDATE icloud_accounts SET state='needs_reconnect' WHERE id=?",(account['id'],))
            if force:
                if isinstance(exc,Problem):raise
                raise Problem(503,'icloud_'+state) from None
            return {'state':state}

    def run_due(self):
        if not self.configured:return
        with self.s.db.transaction() as c:
            rows=c.execute("""SELECT s.id,a.user_id FROM icloud_sources s
                              JOIN icloud_accounts a ON a.id=s.account_id
                              JOIN calendars ca ON ca.id=a.calendar_id
                              JOIN members m ON m.user_id=a.user_id AND m.calendar_id=ca.id
                              WHERE s.selected=1 AND a.state='connected' AND ca.state='active'
                              AND m.active=1 AND s.next_at<=? AND (s.lease_until IS NULL OR s.lease_until<=?)
                              ORDER BY s.next_at LIMIT 5""",(stamp(),stamp())).fetchall()
        for row in rows:
            try:self.sync_source(row['user_id'],row['id'])
            except Exception:continue
