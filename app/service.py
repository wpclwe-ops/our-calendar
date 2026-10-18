"""All authorization and calendar mutations live in this transaction boundary."""
from datetime import datetime, date, timedelta
import json
import re
import secrets
import uuid
from .security import require, Problem, digest
from .recurrence import (UTC, utcnow, stamp, zone, validate_timing, occurrences, instance,
                         TIME_FIELDS, local_datetime, recurrence_starts)

PALETTE = ['#9B77D1','#D47AAE','#D77777','#E0A34B','#D0BD55','#55A77B','#4DA5A8','#598DD4','#7778C9','#888888','#333333','#F3B6D4']
MAX_REMINDER_MINUTES = 525600
EVENT_FIELDS = {'title','description','language','translations','start','end','all_day','timezone','fold','end_fold',
                'owner','category_id','status','location','links','rrule','reminders','smart'}
IMPORTANT = {'start','end','all_day','timezone','status','location','rrule'}

def uid():
    return str(uuid.uuid4())

def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def load(value):
    return json.loads(value)

def offsets(values):
    require(isinstance(values, list) and len(values) <= 3 and all(type(v) is int and 1 <= v <= MAX_REMINDER_MINUTES for v in values), 'invalid_reminders')
    require(len(set(values)) == len(values), 'invalid_reminders')
    return sorted(values, reverse=True)

class Service:
    def __init__(self, db, config):
        self.db, self.config = db, config

    def ensure_user(self, c, telegram):
        user_id = str(telegram['id'])
        row = c.execute('SELECT data FROM users WHERE id=?', (user_id,)).fetchone()
        if not row:
            lang = telegram.get('language_code', 'en').split('-')[0]
            data = {'name': telegram.get('first_name',''), 'language': lang if lang in ('ru','en') else 'en',
                    'choose_language': lang not in ('ru','en'), 'timezone': 'UTC', 'timezone_initialized': False, 'theme': 'system',
                    'view': 'day', 'day_layout': 'timeline', 'month_layout': 'paged', 'week_layout': 'agenda', 'touch_bar': ['day','month','settings'], 'default_duration': 60, 'default_reminders': [60], 'reminders_enabled': True, 'notify_at_start': True,
                    'bot_can_message': False, 'delivery_error': None}
            c.execute('INSERT INTO users VALUES(?,?)', (user_id, dump(data)))
        return user_id

    def user(self, c, user_id):
        row = c.execute('SELECT data FROM users WHERE id=?', (user_id,)).fetchone()
        require(row is not None, 'unauthorized', 401)
        prefs={'id': user_id, 'notify_at_start': True, 'day_layout': 'timeline', 'month_layout': 'paged', 'week_layout': 'agenda', 'touch_bar': ['day','month','settings'], 'default_duration': 60, **load(row['data'])}
        # Older profiles could contain three defaults. Existing event reminders
        # remain untouched; only the template for newly created events is singular.
        prefs['default_reminders']=offsets(prefs.get('default_reminders',[60]))[:1]
        return prefs

    def calendar(self, c, user_id, active=True):
        row = c.execute('SELECT ca.*,m.active FROM calendars ca JOIN members m ON ca.id=m.calendar_id WHERE m.user_id=?', (user_id,)).fetchone()
        require(row is not None, 'no_calendar', 404)
        require(row['active'] or not active, 'member_left', 403)
        require(row['state'] == 'active' or not active, 'calendar_locked', 423)
        return dict(row)

    def state(self, user_id):
        with self.db.transaction() as c:
            me = self.user(c, user_id)
            r = c.execute('SELECT ca.*,m.active FROM calendars ca JOIN members m ON ca.id=m.calendar_id WHERE m.user_id=?', (user_id,)).fetchone()
            restores = [dict(id=r['id'], calendar_id=r['calendar_id'], votes=load(r['votes'])) for r in c.execute(
                'SELECT * FROM restore_requests WHERE first_id=? OR second_id=?', (user_id,user_id))]
            if not r:
                return {'me':me, 'calendar':None,'restores':restores}
            cal = dict(r)
            cal['votes'] = load(cal['votes'])
            members = [{'id':m['user_id'],'active':bool(m['active']),'name':self.user(c,m['user_id'])['name']} for m in c.execute('SELECT * FROM members WHERE calendar_id=?',(cal['id'],))]
            return {'me':me,'calendar':cal,'members':members,'restores':restores}

    def create_calendar(self, user_id):
        with self.db.transaction() as c:
            self.user(c,user_id)
            require(not c.execute('SELECT 1 FROM members WHERE user_id=?',(user_id,)).fetchone(), 'already_has_calendar',409)
            id_ = uid()
            c.execute('INSERT INTO calendars(id,first_id,created_at) VALUES(?,?,?)',(id_,user_id,stamp()))
            c.execute('INSERT INTO members(user_id,calendar_id) VALUES(?,?)',(user_id,id_))
        return self.state(user_id)

    def invite(self, user_id):
        with self.db.transaction() as c:
            cal = self.calendar(c,user_id)
            require(cal['second_id'] is None,'pair_already_fixed',409)
            token = secrets.token_urlsafe(32)
            c.execute('DELETE FROM invites WHERE calendar_id=?',(cal['id'],))
            c.execute('INSERT INTO invites VALUES(?,?)',(digest(token),cal['id']))
            return {'token':token,'url':f'https://t.me/{self.config.bot_username}?startapp=join_{token}'}

    def join(self, user_id, token):
        with self.db.transaction() as c:
            self.user(c,user_id)
            row = c.execute('SELECT ca.* FROM calendars ca JOIN invites i ON i.calendar_id=ca.id WHERE i.token_hash=?',(digest(token),)).fetchone()
            require(row is not None, 'invalid_invite',404)
            require(row['first_id'] != user_id, 'cannot_join_self')
            require(not c.execute('SELECT 1 FROM members WHERE user_id=?',(user_id,)).fetchone(),'already_has_calendar',409)
            require(row['state']=='active' and row['second_id'] is None,'invalid_invite',409)
            c.execute('UPDATE calendars SET second_id=? WHERE id=?',(user_id,row['id']))
            c.execute('INSERT INTO members(user_id,calendar_id) VALUES(?,?)',(user_id,row['id']))
            c.execute('DELETE FROM invites WHERE calendar_id=?',(row['id'],))
            # Existing events receive this participant's defaults only once on joining.
            for ev in c.execute('SELECT * FROM events WHERE calendar_id=?',(row['id'],)).fetchall():
                data = load(ev['data']); data['reminders'][user_id] = self.user(c,user_id)['default_reminders']
                c.execute('UPDATE events SET data=?,schedule_version=schedule_version+1 WHERE id=?',(dump(data),ev['id']))
            self.notify(c,row['id'],user_id,'joined')
        return self.state(user_id)

    def membership(self,user_id,returning=False):
        with self.db.transaction() as c:
            cal = self.calendar(c,user_id,active=not returning)
            if returning:
                require(cal['state']=='active','calendar_locked',423)
            c.execute('UPDATE members SET active=? WHERE user_id=?',(int(returning),user_id))
            c.execute("UPDATE outbox SET status='cancelled' WHERE user_id=? AND calendar_id=? AND kind!='admin' AND status IN ('pending','sending')",(user_id,cal['id']))
            if not returning:
                c.execute("UPDATE google_accounts SET state='disconnected',credentials=NULL,generation=generation+1 WHERE user_id=? AND calendar_id=?",(user_id,cal['id']))
                c.execute("UPDATE google_sources SET selected=0,sync_token=NULL,generation=generation+1,lease_until=NULL WHERE account_id IN (SELECT id FROM google_accounts WHERE user_id=? AND calendar_id=?)",(user_id,cal['id']))
                c.execute("UPDATE google_links SET state='disconnected' WHERE source_id IN (SELECT s.id FROM google_sources s JOIN google_accounts a ON a.id=s.account_id WHERE a.user_id=? AND a.calendar_id=?)",(user_id,cal['id']))
                c.execute('DELETE FROM google_oauth_requests WHERE user_id=?',(user_id,))
                c.execute('DELETE FROM google_previews WHERE user_id=?',(user_id,))
                c.execute("UPDATE icloud_accounts SET state='disconnected',credentials=NULL,generation=generation+1 WHERE user_id=? AND calendar_id=?",(user_id,cal['id']))
                c.execute("UPDATE icloud_sources SET selected=0,auto_import=0,generation=generation+1,lease_until=NULL WHERE account_id IN (SELECT id FROM icloud_accounts WHERE user_id=? AND calendar_id=?)",(user_id,cal['id']))
                c.execute("UPDATE icloud_links SET state='disconnected' WHERE source_id IN (SELECT s.id FROM icloud_sources s JOIN icloud_accounts a ON a.id=s.account_id WHERE a.user_id=? AND a.calendar_id=?)",(user_id,cal['id']))
        return self.state(user_id)

    def settings(self,user_id,changes):
        with self.db.transaction() as c:
            # Left members may only read state / return; locked calendar settings are closed.
            member = c.execute('SELECT 1 FROM members WHERE user_id=?',(user_id,)).fetchone()
            if member:
                self.calendar(c,user_id)
            me = self.user(c,user_id)
            require(set(changes) <= {'language','timezone','theme','view','day_layout','month_layout','week_layout','touch_bar','default_duration','default_reminders','reminders_enabled','notify_at_start','smart_events'},'invalid_settings')
            if 'language' in changes: require(changes['language'] in ('ru','en'),'invalid_language')
            if 'timezone' in changes: zone(changes['timezone'])
            if 'theme' in changes: require(changes['theme'] in ('light','dark','system'),'invalid_theme')
            if 'view' in changes: require(changes['view'] in ('month','week','day'),'invalid_view')
            if 'day_layout' in changes: require(changes['day_layout'] in ('timeline','list'),'invalid_settings')
            if 'week_layout' in changes: require(changes['week_layout'] in ('agenda','three','seven'),'invalid_settings')
            if 'month_layout' in changes: require(changes['month_layout'] in ('paged','scroll'),'invalid_settings')
            if 'touch_bar' in changes:
                items = changes['touch_bar']
                require(isinstance(items, list) and 1 <= len(items) <= 5 and all(isinstance(v,str) and v in ('day','week','month','categories','settings') for v in items), 'invalid_settings')
                require(len(set(items)) == len(items) and items[-1] == 'settings', 'invalid_settings')
            if 'default_duration' in changes: require(type(changes['default_duration']) is int and 1 <= changes['default_duration'] <= 525600,'invalid_settings')
            if 'default_reminders' in changes:
                changes['default_reminders'] = offsets(changes['default_reminders'])
                require(len(changes['default_reminders'])<=1,'invalid_default_reminder')
            for key in ('reminders_enabled','notify_at_start'):
                if key in changes: require(type(changes[key]) is bool,'invalid_settings')
            if 'smart_events' in changes:
                from .smart_events import preferences,validate_preferences
                validate_preferences(changes['smart_events'])
                changes['smart_events']={**preferences(me),**changes['smart_events']}
                # Revocation/settings changes also fence an already in-flight API response.
                if member and any(changes['smart_events'].get(k)!=preferences(me).get(k) for k in ('consent','titles','categorize','mode','include_internal')):
                    c.execute("UPDATE smart_jobs SET state='cancelled',generation=? WHERE calendar_id=?",(uid(),self.calendar(c,user_id)['id']))
            me.update(changes); me.pop('id')
            if 'language' in changes:me['choose_language']=False
            if 'timezone' in changes:me['timezone_initialized']=True
            c.execute('UPDATE users SET data=? WHERE id=?',(dump(me),user_id))
            if set(changes) & {'timezone','reminders_enabled','notify_at_start'}:
                c.execute("UPDATE outbox SET status='cancelled' WHERE user_id=? AND kind='reminder' AND status IN ('pending','sending')",(user_id,))
        return self.state(user_id)

    def categories(self,user_id):
        with self.db.transaction() as c:
            cal = self.calendar(c,user_id)
            return [{'id':r['id'],**load(r['data'])} for r in c.execute('SELECT * FROM categories WHERE calendar_id=?',(cal['id'],))]

    def save_category(self,user_id,data,category_id=None,delete=False):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id)
            if category_id:
                require(c.execute('SELECT 1 FROM categories WHERE id=? AND calendar_id=?',(category_id,cal['id'])).fetchone(),'category_not_found',404)
            if delete:
                c.execute('DELETE FROM categories WHERE id=?',(category_id,))
                for r in c.execute('SELECT * FROM events WHERE calendar_id=?',(cal['id'],)).fetchall():
                    ev=load(r['data'])
                    removed=ev['category_id']==category_id
                    suggestion=ev.get('smart',{}).get('category',{}).get('suggestion')==category_id
                    if removed or suggestion:
                        if removed:ev['category_id']=None
                        if 'smart' in ev:
                            ev['smart']['category'].pop('suggestion',None)
                            if removed:ev['smart']['category']={'manual':True,'origin':'manual'}
                        c.execute('UPDATE events SET data=?,revision=revision+1 WHERE id=?',(dump(ev),r['id']))
                for ov in c.execute('SELECT o.* FROM overrides o JOIN events e ON e.id=o.event_id WHERE e.calendar_id=?',(cal['id'],)).fetchall():
                    patch=load(ov['data'])
                    removed=patch.get('category_id')==category_id
                    suggestion=patch.get('smart',{}).get('category',{}).get('suggestion')==category_id
                    if removed or suggestion:
                        if removed:patch['category_id']=None
                        if 'smart' in patch:
                            patch['smart']['category'].pop('suggestion',None)
                            if removed:patch['smart']['category']={'manual':True,'origin':'manual'}
                        c.execute('UPDATE events SET revision=revision+1 WHERE id=?',(ov['event_id'],))
                        c.execute('UPDATE overrides SET data=? WHERE event_id=? AND occurrence=?',(dump(patch),ov['event_id'],ov['occurrence']))
                for rule in c.execute('SELECT * FROM smart_rules WHERE calendar_id=?',(cal['id'],)).fetchall():
                    if load(rule['data']).get('category_id')==category_id:c.execute('DELETE FROM smart_rules WHERE id=?',(rule['id'],))
                return {'ok':True}
            require(set(data)<={'name','color','translations'},'invalid_category')
            require(isinstance(data.get('name'),str) and 0<len(data['name'].strip())<=100,'invalid_name')
            require(re.fullmatch('#[0-9a-fA-F]{6}',data.get('color','')) is not None,'invalid_color')
            translations=data.get('translations',{})
            require(isinstance(translations,dict) and set(translations)<={'ru','en'} and all(isinstance(v,str) and len(v)<=100 for v in translations.values()),'invalid_translation')
            translations={k:v for k,v in translations.items() if v.strip()}
            data['translations']=translations
            category_id=category_id or uid()
            previous=c.execute('SELECT data FROM categories WHERE id=?',(category_id,)).fetchone()
            old=load(previous['data']) if previous else {}
            data['translation_manual']={k:old.get('translation_manual',{}).get(k,True) if v==old.get('translations',{}).get(k) else True for k,v in translations.items()}
            c.execute('INSERT INTO categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',(category_id,cal['id'],dump(data)))
            from .translation import enqueue_translation
            enqueue_translation(c,self.config,'category',category_id,cal['id'],data,digest(dump(data)),force=old.get('name')!=data['name'])
            return {'id':category_id,**data}

    def event_row(self,c,user_id,event_id,deleted=False):
        cal=self.calendar(c,user_id)
        row=c.execute('SELECT * FROM events WHERE id=? AND calendar_id=?',(event_id,cal['id'])).fetchone()
        require(row is not None and bool(row['deleted_at'])==deleted,'event_not_found',404)
        return row

    def event_data(self,row):
        return {'id':row['id'],'revision':row['revision'],'schedule_version':row['schedule_version'],
                'deleted_at':row['deleted_at'],**load(row['data'])}

    def get_event(self,user_id,event_id,deleted=False,occurrence=None):
        with self.db.transaction() as c:
            r=self.event_row(c,user_id,event_id,deleted)
            result=self.event_data(r)
            ov={v['occurrence']:load(v['data']) for v in c.execute('SELECT * FROM overrides WHERE event_id=?',(event_id,))}
            result['overrides']=ov
            result['google_links']=[dict(v) for v in c.execute('SELECT l.id,l.state,a.user_id AS owner_id FROM google_links l JOIN google_sources s ON s.id=l.source_id JOIN google_accounts a ON a.id=s.account_id WHERE l.event_id=? AND l.state!=\'disconnected\'',(event_id,))]
            result['icloud_links']=[dict(v) for v in c.execute("SELECT l.id,l.state,a.user_id AS owner_id FROM icloud_links l JOIN icloud_sources s ON s.id=l.source_id JOIN icloud_accounts a ON a.id=s.account_id WHERE l.event_id=? AND l.state!='disconnected'",(event_id,))]
            translation=c.execute("SELECT state,error FROM translation_jobs WHERE kind='event' AND resource_id=?",(event_id,)).fetchone()
            result['translation_status']=dict(translation) if translation else None
            smart_job=c.execute('SELECT state,error FROM smart_jobs WHERE event_id=? AND occurrence=?',(event_id,occurrence or '')).fetchone()
            if not smart_job:smart_job=c.execute("SELECT state,error FROM smart_jobs WHERE event_id=? AND occurrence=''",(event_id,)).fetchone()
            result['smart_status']=dict(smart_job) if smart_job else None
            from .recurrence import base_datetime
            from dateutil.rrule import rrulestr
            base=base_datetime(result)
            duration=(date.fromisoformat(result['end'])-date.fromisoformat(result['start'])) if result['all_day'] else (datetime.fromisoformat(result['end'])-datetime.fromisoformat(result['start']))
            values=recurrence_starts(result,base,len(ov)+2)
            for start in values:
                key=start.date().isoformat() if result['all_day'] else start.replace(tzinfo=None).isoformat(timespec='minutes')
                if ov.get(key,{}).get('deleted'):continue
                result['first_instance']=instance(load(r['data']),key,start,start+duration,ov.get(key))
                break
            if occurrence:
                try:target=datetime.fromisoformat(occurrence).replace(tzinfo=zone(result['timezone']))
                except (TypeError,ValueError):raise Problem(400,'invalid_occurrence')
                for key,a,b in occurrences(result,target-timedelta(days=2),target+timedelta(days=2)):
                    if key==occurrence and not ov.get(key,{}).get('deleted'):
                        result['selected_instance']=instance(load(r['data']),key,a,b,ov.get(key));break
                require('selected_instance' in result,'event_not_found',404)
            return result

    def validate_event(self,c,cal,data):
        require(set(data)<=EVENT_FIELDS|{'creator_id'},'invalid_event_fields')
        for key,limit in [('title',300),('description',20000),('location',1000)]:
            require(isinstance(data.get(key,''),str) and len(data.get(key,''))<=limit,'invalid_text')
        require(bool(data.get('title','').strip()),'title_required')
        require(type(data.get('all_day')) is bool,'invalid_all_day')
        require(data.get('status') in ('planned','done','cancelled'),'invalid_status')
        require(data.get('owner') in (cal['first_id'],cal['second_id'],'both') and data.get('owner') is not None,'invalid_owner')
        require(data.get('language') in ('ru','en'),'invalid_language')
        if data.get('category_id'):
            require(c.execute('SELECT 1 FROM categories WHERE id=? AND calendar_id=?',(data['category_id'],cal['id'])).fetchone(),'invalid_category')
        require(isinstance(data.get('links',[]),list) and len(data.get('links',[]))<=20,'invalid_links')
        require(all(isinstance(v,str) and len(v)<=2000 and v.startswith(('https://','http://')) for v in data.get('links',[])),'invalid_links')
        require(isinstance(data['reminders'],dict),'invalid_reminders')
        for person,values in data['reminders'].items():
            require(person in (cal['first_id'],cal['second_id']),'invalid_reminders')
            offsets(values)
        tr=data.get('translations',{})
        require(isinstance(tr,dict) and set(tr)<={'ru','en'},'invalid_translation')
        for v in tr.values():
            require(isinstance(v,dict) and set(v)<={'title','description','manual','stale'},'invalid_translation')
            require(all(isinstance(v.get(k,''),str) and len(v.get(k,''))<=n for k,n in [('title',300),('description',20000)]),'invalid_translation')
        if 'smart' in data:
            from .smart_events import validate_metadata
            validate_metadata(data['smart'])
        validate_timing(data)

    def save_event(self,user_id,changes,event_id=None,revision=None):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id)
            require(set(changes)<=EVENT_FIELDS-{'smart'},'invalid_event_fields')
            if event_id:
                row=self.event_row(c,user_id,event_id)
                require(revision==row['revision'],'revision_conflict',409, self.event_data(row))
                previous=load(row['data']); data=dict(previous)
            else:
                previous=None
                me=self.user(c,user_id)
                data={'title':'','description':'','language':me['language'],'translations':{},'start':'','end':'',
                      'all_day':False,'timezone':me['timezone'],'owner':user_id,'creator_id':user_id,
                      'category_id':None,'status':'planned','location':'','links':[],'rrule':'','reminders':{}}
                for person in (cal['first_id'],cal['second_id']):
                    if person: data['reminders'][person]=self.user(c,person)['default_reminders']
            changes=dict(changes)
            if 'reminders' in changes:
                require(isinstance(changes['reminders'],list),'own_reminders_only')
                data['reminders']=dict(data['reminders']); data['reminders'][user_id]=offsets(changes.pop('reminders'))
            data.update(changes)
            if previous and any(k in changes and changes[k]!=previous[k] for k in ('title','description')):
                data['translations']={k:{**v,'stale':True} for k,v in data['translations'].items()}
            from .smart_events import manual_edit
            manual_edit(data,previous,changes)
            self.validate_event(c,cal,data)
            if event_id and previous.get('rrule') and any(previous.get(k)!=data.get(k) for k in ('start','timezone','all_day','rrule')):
                from .recurrence import remap_override_keys
                overrides={r['occurrence']:r['data'] for r in c.execute('SELECT * FROM overrides WHERE event_id=?',(event_id,))}
                mapped=remap_override_keys(previous,data,overrides)
                c.execute('DELETE FROM overrides WHERE event_id=?',(event_id,))
                for key,patch in mapped.items():c.execute('INSERT INTO overrides VALUES(?,?,?)',(event_id,key,patch))
            if event_id:
                schedule_change=any(data.get(k)!=previous.get(k) for k in TIME_FIELDS|{'status','reminders'})
                c.execute('UPDATE events SET data=?,revision=revision+1,schedule_version=schedule_version+? WHERE id=?',(dump(data),int(schedule_change),event_id))
                if schedule_change:
                    c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(event_id,))
                if any(data.get(k)!=previous.get(k) for k in IMPORTANT):
                    self.notify(c,cal['id'],user_id,'updated',data,event_id)
            else:
                event_id=uid()
                c.execute('INSERT INTO events(id,calendar_id,data) VALUES(?,?,?)',(event_id,cal['id'],dump(data)))
                self.notify(c,cal['id'],user_id,'created',data,event_id)
            row=c.execute('SELECT * FROM events WHERE id=?',(event_id,)).fetchone()
            if not previous or any(data.get(k)!=previous.get(k) for k in ('title','description','owner','category_id')):
                if previous:
                    changed={k for k in ('title','description') if data.get(k)!=previous.get(k)}
                    for ov in c.execute('SELECT * FROM overrides WHERE event_id=?',(event_id,)).fetchall():
                        patch=load(ov['data'])
                        if changed-set(patch) and patch.get('smart'):
                            from .smart_events import source_changed
                            source_changed(patch)
                            original=data.get('smart',{}).get('source',{})
                            if 'source' in patch['smart']:
                                for field in changed-set(patch):
                                    if field in original:patch['smart']['source'][field]=original[field]
                            c.execute('UPDATE overrides SET data=? WHERE event_id=? AND occurrence=?',(dump(patch),event_id,ov['occurrence']))
                        if changed-set(patch) and patch.get('translations'):
                            patch['translations']={k:{**v,'stale':True} for k,v in patch['translations'].items()}
                            c.execute('UPDATE overrides SET data=? WHERE event_id=? AND occurrence=?',(dump(patch),event_id,ov['occurrence']))
                from .translation import enqueue_translation
                enqueue_translation(c,self.config,'event',event_id,cal['id'],data,row['revision'])
            overlaps=self.overlaps(c,cal['id'],event_id,data)
            return {**self.event_data(row),'overlap_warning':overlaps}

    def overlaps(self,c,calendar_id,event_id,data):
        if data['all_day']: return []
        begin=local_datetime(data['start'],data['timezone'],data.get('fold')).astimezone(UTC)
        end=local_datetime(data['end'],data['timezone'],data.get('end_fold')).astimezone(UTC)
        found=[]
        for row in c.execute('SELECT * FROM events WHERE calendar_id=? AND id!=? AND deleted_at IS NULL',(calendar_id,event_id)):
            other=load(row['data'])
            if other['all_day'] or other['status']!='planned': continue
            for key, a,b in occurrences(other,begin,end):
                ov=c.execute('SELECT data FROM overrides WHERE event_id=? AND occurrence=?',(row['id'],key)).fetchone()
                it=instance(other,key,a,b,load(ov['data']) if ov else {})
                if it.get('deleted') or it['status']!='planned' or it['all_day']: continue
                if datetime.fromisoformat(it['start_utc'])<end and datetime.fromisoformat(it['end_utc'])>begin:
                    found.append({'id':row['id'],'title':it['title']}); break
        return found

    @staticmethod
    def expanded(data, overrides, start_dt, end_dt):
        """Include moved exceptions even outside their original recurrence window."""
        expanded={k:instance(data,k,a,b,overrides.get(k)) for k,a,b in occurrences(data,start_dt,end_dt)}
        duration=(date.fromisoformat(data['end'])-date.fromisoformat(data['start'])) if data['all_day'] else (datetime.fromisoformat(data['end'])-datetime.fromisoformat(data['start']))
        for key,ov in overrides.items():
            if key not in expanded and 'start' in ov:
                begin=datetime.fromisoformat(key).replace(tzinfo=zone(data['timezone']))
                expanded[key]=instance(data,key,begin,begin+duration,ov)
        return expanded.values()

    @staticmethod
    def matches(data, categories, query='', owner='', category='', status=''):
        if owner and data['owner']!=owner:return False
        if category and (data['category_id'] or 'none')!=category:return False
        if status and data['status']!=status:return False
        cat=categories.get(data['category_id'],{})
        texts=[data['title'],data['description'],data['location'],cat.get('name',''),*data.get('smart',{}).get('short_titles',{}).values()]
        texts.extend(cat.get('translations',{}).values())
        for tr in data.get('translations',{}).values():texts.extend([tr.get('title',''),tr.get('description','')])
        return not query or query.casefold() in ' '.join(texts).casefold()

    def search_series(self,data,overrides,categories,query,owner,category,status):
        from .recurrence import base_datetime
        from dateutil.rrule import rrulestr
        base=base_datetime(data)
        duration=(date.fromisoformat(data['end'])-date.fromisoformat(data['start'])) if data['all_day'] else (datetime.fromisoformat(data['end'])-datetime.fromisoformat(data['start']))
        candidates=[]
        # A series is one search result. Find its first matching unmodified
        # instance, then compare every exception against its effective fields.
        values=recurrence_starts(data,base,len(overrides)+3)
        if self.matches(data,categories,query,owner,category,status):
            for begin in values:
                key=begin.date().isoformat() if data['all_day'] else begin.replace(tzinfo=None).isoformat(timespec='minutes')
                if key in overrides:continue
                if begin.astimezone(UTC).astimezone(begin.tzinfo).replace(tzinfo=None)!=begin.replace(tzinfo=None):continue
                candidates.append(instance(data,key,begin,begin+duration));break
        for key,patch in overrides.items():
            if patch.get('deleted'):continue
            begin=datetime.fromisoformat(key).replace(tzinfo=zone(data['timezone']))
            effective=instance(data,key,begin,begin+duration,patch)
            if self.matches(effective,categories,query,owner,category,status):candidates.append(effective)
        return min(candidates,key=lambda it:it.get('start_utc',it['start'])) if candidates else None

    def events(self,user_id,start=None,end=None,query='',owner='',category='',status='',trash=False,event_id=''):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id)
            if event_id:self.event_row(c,user_id,event_id)
            categories={v['id']:load(v['data']) for v in c.execute('SELECT * FROM categories WHERE calendar_id=?',(cal['id'],))}
            rows=c.execute('SELECT * FROM events WHERE calendar_id=? AND '+('deleted_at IS NOT NULL' if trash else 'deleted_at IS NULL'),(cal['id'],)).fetchall()
            result=[]
            if trash:
                for ov in c.execute('SELECT o.*,e.data AS master,e.revision,e.schedule_version FROM overrides o JOIN events e ON e.id=o.event_id WHERE e.calendar_id=? AND e.deleted_at IS NULL',(cal['id'],)):
                    patch=load(ov['data'])
                    if not patch.get('deleted_at') or patch.get('purged'):continue
                    master=load(ov['master']);key=ov['occurrence']
                    original=datetime.fromisoformat(key).replace(tzinfo=zone(master['timezone']))
                    duration=(date.fromisoformat(master['end'])-date.fromisoformat(master['start'])) if master['all_day'] else (datetime.fromisoformat(master['end'])-datetime.fromisoformat(master['start']))
                    result.append({'id':ov['event_id'],'revision':ov['revision'],'schedule_version':ov['schedule_version'],**instance(master,key,original,original+duration,patch)})
            if not query and not trash:
                require(start and end,'range_required')
                try:
                    start_dt=datetime.fromisoformat(start).replace(tzinfo=UTC)
                    end_dt=datetime.fromisoformat(end).replace(tzinfo=UTC)
                except (ValueError,TypeError):raise Problem(400,'invalid_range')
                require(0<(end_dt-start_dt).total_seconds()<=370*86400,'invalid_range')
            for row in rows:
                if event_id and row['id']!=event_id:continue
                data=self.event_data(row)
                overrides={v['occurrence']:load(v['data']) for v in c.execute('SELECT * FROM overrides WHERE event_id=?',(row['id'],))}
                if trash:
                    result.append(data);continue
                if query:
                    match=self.search_series(data,overrides,categories,query,owner,category,status)
                    if match:result.append(match)
                    continue
                for it in self.expanded(data,overrides,start_dt,end_dt):
                    if it.get('deleted') or not self.matches(it,categories,owner=owner,category=category,status=status):continue
                    if it['all_day']:show=it['start']<end[:10] and it['end']>start[:10]
                    else:show=datetime.fromisoformat(it['start_utc'])<end_dt and datetime.fromisoformat(it['end_utc'])>start_dt
                    if show:result.append(it)
            viewer=zone(self.user(c,user_id)['timezone'])
            def order(it):
                return datetime.fromisoformat(it['start_utc']).astimezone(viewer).isoformat()[:19] if it.get('start_utc') else it['start']
            return sorted(result,key=order)

    def occurrence_change(self,user_id,event_id,key,changes,revision,scope='one',delete=False):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id); row=self.event_row(c,user_id,event_id)
            require(row['revision']==revision,'revision_conflict',409)
            data=load(row['data']); require(bool(data['rrule']),'not_recurring')
            require(scope in ('one','following','all'),'invalid_scope')
            if 'status' in changes: require(scope=='one','status_only_one_instance')
            try:
                target=datetime.fromisoformat(key).replace(tzinfo=zone(data['timezone']))
            except (ValueError,TypeError): raise Problem(400,'invalid_occurrence')
            found=[(k,a,b) for k,a,b in occurrences(data,target-timedelta(days=2),target+timedelta(days=2)) if k==key]
            require(bool(found),'invalid_occurrence')
            k,a,b=found[0]
            require(set(changes)<=EVENT_FIELDS-{'smart'},'invalid_occurrence_fields')
            prior=c.execute('SELECT data FROM overrides WHERE event_id=? AND occurrence=?',(event_id,key)).fetchone()
            prior=load(prior['data']) if prior else {}
            if 'reminders' in changes:
                require(isinstance(changes['reminders'],list),'own_reminders_only')
                changes={**changes,'reminders':{**prior.get('reminders',data['reminders']),user_id:offsets(changes['reminders'])}}
            if any(k in changes and changes[k]!=prior.get(k,data.get(k)) for k in ('title','description')) and changes.get('translations',prior.get('translations',{})):
                changes={**changes,'translations':{k:{**v,'stale':True} for k,v in changes.get('translations',prior.get('translations',{})).items()}}
            single=instance(data,key,a,b,prior)
            for remove in ('occurrence','start_utc','end_utc'): single.pop(remove,None)
            before_single=load(dump(single))
            single.update(changes)
            from .smart_events import manual_edit
            manual_edit(single,before_single,changes)
            changes={**changes,'smart':single['smart']}
            self.validate_event(c,cal,single)
            if scope=='one':
                patch={**prior,**changes}
                if delete: patch['deleted']=True; patch['deleted_at']=stamp()
                c.execute('INSERT INTO overrides VALUES(?,?,?) ON CONFLICT(event_id,occurrence) DO UPDATE SET data=excluded.data',(event_id,key,dump(patch)))
            elif scope=='all':
                if delete:
                    c.execute('UPDATE events SET deleted_at=? WHERE id=?',(stamp(),event_id))
                else:
                    original=load(dump(data))
                    data.update(changes); self.validate_event(c,cal,data)
                    if any(original.get(k)!=data.get(k) for k in ('start','timezone','all_day','rrule')):
                        from .recurrence import remap_override_keys
                        overrides={r['occurrence']:r['data'] for r in c.execute('SELECT * FROM overrides WHERE event_id=?',(event_id,))}
                        mapped=remap_override_keys(original,data,overrides)
                        c.execute('DELETE FROM overrides WHERE event_id=?',(event_id,))
                        for k,patch in mapped.items():c.execute('INSERT INTO overrides VALUES(?,?,?)',(event_id,k,patch))
                    c.execute('UPDATE events SET data=? WHERE id=?',(dump(data),event_id))
            else:
                # Split with UNTIL in UTC; never silently duplicate the remaining COUNT.
                require(a>local_datetime(data['start']+'T00:00' if data['all_day'] else data['start'],data['timezone'],data.get('fold')),'use_all_for_first_occurrence')
                original_data=load(dump(data))
                row_data_rule=data['rrule']
                parts=dict(p.split('=',1) for p in row_data_rule.removeprefix('RRULE:').split(';'))
                original_parts=dict(parts)
                if 'COUNT' in parts:
                    from dateutil.rrule import rrulestr
                    from .recurrence import base_datetime
                    elapsed=0
                    for begin in recurrence_starts(data):
                        if begin>=a:break
                        elapsed+=1
                    original_parts['COUNT']=str(int(parts['COUNT'])-elapsed)
                parts.pop('COUNT',None)
                parts['UNTIL']=(a.astimezone(UTC)-timedelta(seconds=1)).strftime('%Y%m%dT%H%M%SZ')
                data['rrule']=';'.join(f'{p}={v}' for p,v in parts.items())
                c.execute('UPDATE events SET data=? WHERE id=?',(dump(data),event_id))
                single['rrule']=changes['rrule'] if 'rrule' in changes and changes['rrule']!=row_data_rule else ';'.join(f'{p}={v}' for p,v in original_parts.items())
                new_id=uid()
                c.execute('INSERT INTO events(id,calendar_id,data,deleted_at) VALUES(?,?,?,?)',(new_id,cal['id'],dump(single),stamp() if delete else None))
                from .recurrence import remap_override_keys
                remaining={ov['occurrence']:ov['data'] for ov in c.execute('SELECT * FROM overrides WHERE event_id=? AND occurrence>=?',(event_id,key))}
                mapped=remap_override_keys(original_data,single,remaining,anchor=a)
                for new_key,patch in mapped.items():
                    c.execute('INSERT INTO overrides VALUES(?,?,?)',(new_id,new_key,patch))
                c.execute('DELETE FROM overrides WHERE event_id=? AND occurrence>=?',(event_id,key))
            c.execute('UPDATE events SET revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(event_id,))
            c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(event_id,))
            if delete or any(k in changes and changes[k]!=prior.get(k,data.get(k)) for k in IMPORTANT):
                self.notify(c,cal['id'],user_id,'deleted' if delete else 'updated',{**single,'occurrence':key if scope=='one' else single['start']},new_id if scope=='following' else event_id)
            from .translation import enqueue_translation
            for eid in ({event_id,new_id} if scope=='following' else {event_id}):
                fresh=c.execute('SELECT * FROM events WHERE id=?',(eid,)).fetchone()
                if not fresh['deleted_at']:
                    enqueue_translation(c,self.config,'event',eid,cal['id'],load(fresh['data']),fresh['revision'])
            return {'ok':True,'id':new_id if scope=='following' else event_id,'occurrence':key if scope=='one' else None}

    def delete_event(self,user_id,event_id,revision,permanent=False,restore=False):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id)
            row=self.event_row(c,user_id,event_id,deleted=permanent or restore)
            require(row['revision']==revision,'revision_conflict',409)
            if permanent:
                c.execute('DELETE FROM events WHERE id=?',(event_id,))
            else:
                c.execute('UPDATE events SET deleted_at=?,revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(None if restore else stamp(),event_id))
                if not restore:
                    c.execute("UPDATE google_links SET state='disconnected' WHERE event_id=?",(event_id,))
                    c.execute("UPDATE icloud_links SET state='disconnected' WHERE event_id=?",(event_id,))
            c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(event_id,))
            if not permanent: self.notify(c,cal['id'],user_id,'restored' if restore else 'deleted',load(row['data']),event_id)
            return {'ok':True}

    def trash_occurrence(self,user_id,event_id,key,revision,permanent=False):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id);row=self.event_row(c,user_id,event_id)
            require(row['revision']==revision,'revision_conflict',409)
            ov=c.execute('SELECT data FROM overrides WHERE event_id=? AND occurrence=?',(event_id,key)).fetchone()
            require(ov is not None,'event_not_found',404)
            patch=load(ov['data']);require(patch.get('deleted_at') and not patch.get('purged'),'event_not_found',404)
            if permanent:patch={'deleted':True,'purged':True}
            else:
                patch.pop('deleted',None);patch.pop('deleted_at',None)
                self.notify(c,cal['id'],user_id,'restored',load(row['data']),event_id)
            c.execute('UPDATE overrides SET data=? WHERE event_id=? AND occurrence=?',(dump(patch),event_id,key))
            c.execute('UPDATE events SET revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(event_id,))
            c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(event_id,))
            return {'ok':True}

    def deletion(self,user_id,action):
        with self.db.transaction() as c:
            cal=self.calendar(c,user_id,active=False)
            require(cal['active'],'member_left',403)
            require(cal['second_id'] is not None,'pair_required')
            votes=set(load(cal['votes']))
            if action in ('cancel','reject'):
                require(cal['state']!='pending_delete' or cal['delete_at']>stamp(),'calendar_deletion_expired',410)
                c.execute("UPDATE calendars SET state='active',votes='[]',delete_at=NULL WHERE id=?",(cal['id'],))
                self.notify(c,cal['id'],user_id,'deletion_cancelled',admin=True)
            elif action=='approve':
                require(cal['state']=='active','calendar_locked',423)
                require(c.execute('SELECT COUNT(*) FROM members WHERE calendar_id=? AND active=1',(cal['id'],)).fetchone()[0]==2,'both_must_return')
                votes.add(user_id)
                due=stamp(utcnow()+timedelta(days=30)) if len(votes)==2 else None
                c.execute('UPDATE calendars SET votes=?,state=?,delete_at=? WHERE id=?',(dump(sorted(votes)),'pending_delete' if due else 'active',due,cal['id']))
                if due:
                    c.execute("UPDATE outbox SET status='cancelled' WHERE calendar_id=? AND kind!='admin' AND status IN ('pending','sending')",(cal['id'],))
                self.notify(c,cal['id'],user_id,'deletion_started' if due else 'deletion_requested',admin=True)
            else: raise Problem(400,'invalid_action')
        return self.state(user_id)

    def notify(self,c,calendar_id,actor,action,data=None,event_id=None,admin=False):
        for member in c.execute('SELECT user_id,active FROM members WHERE calendar_id=?',(calendar_id,)).fetchall():
            if member['user_id']==actor or not member['active']: continue
            self.enqueue(c,calendar_id,member['user_id'],'admin' if admin else 'action',
                         {'action':action,'title':(data or {}).get('title',''),'data':data or {},'event_id':event_id},event_id=event_id)

    def enqueue(self,c,calendar_id,user_id,kind,payload,due=None,key=None,event_id=None):
        c.execute("INSERT INTO outbox(id,calendar_id,user_id,event_id,kind,payload,due,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=CASE WHEN outbox.status='cancelled' THEN 'pending' ELSE outbox.status END WHERE outbox.kind='reminder' AND outbox.status IN ('pending','cancelled')",
                  (key or uid(),calendar_id,user_id,event_id,kind,dump(payload),due or stamp(),stamp()))

    def maintenance(self):
        with self.db.transaction() as c:
            cutoff=stamp(utcnow()-timedelta(days=30))
            c.execute('DELETE FROM backup_previews WHERE expires_at<=?',(stamp(),))
            c.execute('DELETE FROM smart_previews WHERE expires_at<=?',(stamp(),))
            c.execute('DELETE FROM google_oauth_requests WHERE expires_at<=?',(stamp(),))
            c.execute('DELETE FROM google_previews WHERE expires_at<=?',(stamp(),))
            c.execute('DELETE FROM events WHERE deleted_at IS NOT NULL AND deleted_at<=?',(cutoff,))
            for ov in c.execute('SELECT * FROM overrides').fetchall():
                patch=load(ov['data'])
                if patch.get('deleted_at') and patch['deleted_at']<=cutoff and not patch.get('purged'):
                    c.execute('UPDATE overrides SET data=? WHERE event_id=? AND occurrence=?',(dump({'deleted':True,'purged':True}),ov['event_id'],ov['occurrence']))
            expired=c.execute("SELECT id,delete_at FROM calendars WHERE state='pending_delete' AND delete_at<=?",(stamp(),)).fetchall()
            if expired:
                row=c.execute("SELECT value FROM runtime WHERE key='deletion_tombstones'").fetchone()
                tombstones=load(row['value']) if row else {}
                row=c.execute("SELECT value FROM runtime WHERE key='deletion_tombstones_synced'").fetchone()
                synced=load(row['value']) if row else {}
                for expired_cal in expired:
                    cid=expired_cal['id']
                    if tombstones.get(cid,'')<expired_cal['delete_at']:tombstones[cid]=stamp()
                    # With operator backups, persist the deletion outside the DB
                    # before purging it. A stale snapshot cannot revive it later.
                    if not self.config.backup_bucket or synced.get(cid)==tombstones[cid]:
                        c.execute('DELETE FROM calendars WHERE id=?',(cid,))
                c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('deletion_tombstones',dump(tombstones)))
            c.execute("DELETE FROM translation_jobs WHERE (kind='event' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id=translation_jobs.resource_id)) OR (kind='category' AND NOT EXISTS (SELECT 1 FROM categories ca WHERE ca.id=translation_jobs.resource_id))")
            c.execute("DELETE FROM outbox WHERE status IN ('sent','cancelled','expired','failed') AND created_at<?",(cutoff,))
            c.execute('DELETE FROM restore_requests WHERE created_at<?',(cutoff,))
