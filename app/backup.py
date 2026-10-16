"""Versioned, Ed25519-signed archives. No provider credentials are serialized."""
import base64
from datetime import datetime,timedelta
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, BadZipFile
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat, NoEncryption, load_pem_private_key
from .security import require, Problem
from .service import dump, load, uid, EVENT_FIELDS
from .recurrence import stamp,utcnow

MAX_ARCHIVE = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
PROFILE_FIELDS = {'language','timezone','theme','view','day_layout','month_layout','default_duration','default_reminders','reminders_enabled','notify_at_start','name'}

class Backups:
    def __init__(self, service):
        self.service=service; self.config=service.config
        self.private_path=Path(self.config.archive_key_file)
        self.public_path=Path(self.config.archive_public_keys)
        self.private_path.parent.mkdir(parents=True,exist_ok=True)
        self.public_path.parent.mkdir(parents=True,exist_ok=True)
        if not self.private_path.exists():
            key=Ed25519PrivateKey.generate()
            # Atomic exclusive creation prevents a second worker replacing the signing key.
            try:
                fd=os.open(self.private_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'wb') as f:
                    f.write(key.private_bytes(Encoding.PEM,PrivateFormat.PKCS8,NoEncryption()))
            except FileExistsError: pass
        self.key=load_pem_private_key(self.private_path.read_bytes(),password=None)
        pub=self.key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.key_id=hashlib.sha256(pub).hexdigest()[:24]
        self.public_keys=json.loads(self.public_path.read_text()) if self.public_path.exists() else {}
        self.public_keys[self.key_id]=base64.b64encode(pub).decode()
        temp=self.public_path.with_suffix('.tmp')
        temp.write_text(dump(self.public_keys)); os.replace(temp,self.public_path)

    def snapshot(self,c,user_id):
        cal=self.service.calendar(c,user_id)
        return {'schema':1,'calendar':{'id':cal['id'],'first_id':cal['first_id'],'second_id':cal['second_id']},
                'created_at':stamp(),
                'members':{r['user_id']:{k:v for k,v in self.service.user(c,r['user_id']).items() if k in PROFILE_FIELDS} for r in c.execute('SELECT * FROM members WHERE calendar_id=?',(cal['id'],))},
                'categories':[{'id':r['id'],'data':load(r['data'])} for r in c.execute('SELECT * FROM categories WHERE calendar_id=?',(cal['id'],))],
                'events':[{'id':r['id'],'data':load(r['data']),'deleted_at':r['deleted_at'],
                           'overrides':{v['occurrence']:load(v['data']) for v in c.execute('SELECT * FROM overrides WHERE event_id=?',(r['id'],))}}
                          for r in c.execute('SELECT * FROM events WHERE calendar_id=?',(cal['id'],))]}

    def export(self,user_id):
        with self.service.db.transaction() as c: payload=dump(self.snapshot(c,user_id)).encode()
        manifest={'schema':1,'key_id':self.key_id,'payload_sha256':hashlib.sha256(payload).hexdigest()}
        signature=self.key.sign(dump(manifest).encode())
        buf=BytesIO()
        with ZipFile(buf,'w',ZIP_DEFLATED) as z:
            z.writestr('manifest.json',dump({**manifest,'signature':base64.b64encode(signature).decode()}))
            z.writestr('calendar.json',payload)
        require(len(buf.getvalue())<=MAX_ARCHIVE,'archive_too_large',413)
        return buf.getvalue()

    def verify(self,blob):
        require(len(blob)<=MAX_ARCHIVE,'archive_too_large',413)
        try:
            with ZipFile(BytesIO(blob)) as z:
                require(len(z.infolist())==2 and set(z.namelist())=={'manifest.json','calendar.json'},'invalid_archive')
                require(sum(v.file_size for v in z.infolist())<=MAX_EXPANDED,'archive_too_large',413)
                require(z.getinfo('manifest.json').file_size<4096,'invalid_manifest')
                manifest=load(z.read('manifest.json')); payload=z.read('calendar.json')
            signature=base64.b64decode(manifest.pop('signature'),validate=True)
            require(manifest['schema']==1,'unsupported_archive_version')
            require(hashlib.sha256(payload).hexdigest()==manifest['payload_sha256'],'archive_integrity_failed')
            require(manifest['key_id'] in self.public_keys,'unknown_archive_signing_key')
            public=Ed25519PublicKey.from_public_bytes(base64.b64decode(self.public_keys[manifest['key_id']]))
            public.verify(signature,dump(manifest).encode())
            data=load(payload)
            require(data['schema']==1,'unsupported_archive_version')
            cal=data['calendar']; require(cal['first_id'] in data['members'],'invalid_archive')
            require(cal['second_id'] is None or cal['second_id'] in data['members'],'invalid_archive')
            require(len({v['id'] for v in data['events']})==len(data['events']),'invalid_archive')
            return data
        except Problem: raise
        except Exception:
            raise Problem(400,'invalid_or_unsigned_archive')

    def preview(self,user_id,blob):
        archive=self.verify(blob)
        with self.service.db.transaction() as c:
            cal=self.service.calendar(c,user_id)
            require(archive['calendar']=={'id':cal['id'],'first_id':cal['first_id'],'second_id':cal['second_id']},'archive_wrong_calendar',403)
            changes=[];missing=[];override_changes=[]
            for e in archive['events']:
                current=c.execute('SELECT * FROM events WHERE id=? AND calendar_id=?',(e['id'],cal['id'])).fetchone()
                if not current:
                    missing.append({'id':e['id'],'data':e['data'],'deleted_at':e['deleted_at']});continue
                before=load(current['data']);fields={}
                for k,v in e['data'].items():
                    if k not in EVENT_FIELDS:continue
                    left,right=before.get(k),v
                    if k=='reminders':left,right=before['reminders'].get(user_id,[]),v.get(user_id,[])
                    if left!=right:fields[k]={'current':left,'archive':right}
                if current['deleted_at']!=e['deleted_at']:fields['deleted_at']={'current':current['deleted_at'],'archive':e['deleted_at']}
                if fields:changes.append({'id':e['id'],'revision':current['revision'],'fields':fields})
                actual={r['occurrence']:load(r['data']) for r in c.execute('SELECT * FROM overrides WHERE event_id=?',(e['id'],))}
                for key in sorted(set(actual)|set(e['overrides'])):
                    left,right=actual.get(key,{}),e['overrides'].get(key,{})
                    fields={}
                    for k in sorted(set(left)|set(right)):
                        lv,rv=left.get(k),right.get(k)
                        if k=='reminders':
                            lv=(lv or {}).get(user_id,before['reminders'].get(user_id,[]))
                            rv=(rv or {}).get(user_id,e['data']['reminders'].get(user_id,[]))
                        if lv!=rv:fields[k]={'current':lv,'archive':rv,'archive_present':k in right}
                    if fields:override_changes.append({'id':e['id'],'occurrence':key,'revision':current['revision'],'fields':fields})
            own=self.service.user(c,user_id);old=archive['members'][user_id]
            profile={k:{'current':own.get(k),'archive':old[k]} for k in ('language','timezone','theme','view','day_layout','month_layout','default_duration','default_reminders','reminders_enabled','notify_at_start') if k in old and own.get(k)!=old[k]}
            categories=[]
            for category in archive['categories']:
                current=c.execute('SELECT data FROM categories WHERE id=? AND calendar_id=?',(category['id'],cal['id'])).fetchone()
                categories.append({**category,'current':load(current['data']) if current else None})
            result={'changes':changes,'missing':missing,'override_changes':override_changes,'profile':profile,
                    'archive_sha256':hashlib.sha256(blob).hexdigest(),'categories':categories}
            preview_id=uid()
            c.execute('DELETE FROM backup_previews WHERE expires_at<=?',(stamp(),))
            c.execute('INSERT INTO backup_previews VALUES(?,?,?,?,?,?)',(preview_id,user_id,cal['id'],result['archive_sha256'],dump(result),stamp(utcnow()+timedelta(minutes=15))))
            return {**result,'preview_id':preview_id}

    def apply(self,user_id,blob,selections,missing_ids,category_ids,preview_id=None,override_selections=None,profile_fields=None):
        archive=self.verify(blob);override_selections=override_selections or [];profile_fields=profile_fields or []
        require(all(isinstance(v,list) for v in (selections,missing_ids,category_ids,override_selections,profile_fields)),'invalid_selection')
        with self.service.db.transaction() as c:
            cal=self.service.calendar(c,user_id)
            require(archive['calendar']=={'id':cal['id'],'first_id':cal['first_id'],'second_id':cal['second_id']},'archive_wrong_calendar',403)
            receipt=c.execute('SELECT * FROM backup_previews WHERE id=? AND user_id=? AND calendar_id=? AND expires_at>?',(preview_id,user_id,cal['id'],stamp())).fetchone()
            require(receipt is not None and receipt['archive_sha']==hashlib.sha256(blob).hexdigest(),'preview_required',409)
            preview=load(receipt['data']);archived={e['id']:e for e in archive['events']};cats={e['id']:e for e in archive['categories']}
            expected={e['id']:e for e in preview['changes']}
            expected_ov={(e['id'],e['occurrence']):e for e in preview['override_changes']}
            allowed_missing={e['id'] for e in preview['missing']}
            touched={}
            # Validate every affected revision BEFORE updating any event. Multiple
            # field selections for one series share one revision and commit once.
            for choice in selections+override_selections:
                event_id=choice['id']
                allowed=expected_ov.get((event_id,choice.get('occurrence'))) if 'occurrence' in choice else expected.get(event_id)
                require(allowed is not None and set(choice['fields'])<=set(allowed['fields']),'invalid_selection')
                row=c.execute('SELECT * FROM events WHERE id=? AND calendar_id=?',(event_id,cal['id'])).fetchone()
                require(row is not None and row['revision']==choice['revision']==allowed['revision'],'revision_conflict',409)
                touched[event_id]=dict(row)
            for cid in set(category_ids):
                require(cid in cats,'invalid_selection')
                shown=next(v for v in preview['categories'] if v['id']==cid)
                current=c.execute('SELECT * FROM categories WHERE id=?',(cid,)).fetchone()
                require(not current or current['calendar_id']==cal['id'],'invalid_selection')
                require((load(current['data']) if current else None)==shown['current'],'revision_conflict',409)
                c.execute('INSERT INTO categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',(cid,cal['id'],dump(cats[cid]['data'])))
            def sanitize_category(data):
                if data.get('category_id') and not c.execute('SELECT 1 FROM categories WHERE id=? AND calendar_id=?',(data['category_id'],cal['id'])).fetchone():data['category_id']=None
            for choice in selections:
                row=touched[choice['id']];data=load(row['data']);old=archived[choice['id']]['data']
                for field in choice['fields']:
                    if field=='deleted_at':row['deleted_at']=archived[choice['id']]['deleted_at']
                    elif field=='reminders':data['reminders'][user_id]=old['reminders'].get(user_id,[])
                    else:data[field]=old[field]
                sanitize_category(data);self.service.validate_event(c,cal,data);row['data']=dump(data)
            for choice in override_selections:
                eid,key=choice['id'],choice['occurrence'];row=touched[eid];master=load(row['data'])
                prior=c.execute('SELECT data FROM overrides WHERE event_id=? AND occurrence=?',(eid,key)).fetchone()
                patch=load(prior['data']) if prior else {};old=archived[eid]['overrides'].get(key,{})
                for field in choice['fields']:
                    if field=='reminders':
                        patch['reminders']={**patch.get('reminders',master['reminders']),user_id:old.get('reminders',archived[eid]['data']['reminders']).get(user_id,[])}
                    elif field in old:patch[field]=old[field]
                    else:patch.pop(field,None)
                # Deleted flag, its timestamp and purge marker form one consistent
                # deletion state. Selecting it is an explicit restoration decision.
                if set(choice['fields'])&{'deleted','deleted_at','purged'}:
                    for field in ('deleted','deleted_at','purged'):
                        if field in old:patch[field]=old[field]
                        else:patch.pop(field,None)
                sanitize_category(patch)
                from .recurrence import zone,instance
                from datetime import date
                begin=datetime.fromisoformat(key).replace(tzinfo=zone(master['timezone']))
                duration=(date.fromisoformat(master['end'])-date.fromisoformat(master['start'])) if master['all_day'] else (datetime.fromisoformat(master['end'])-datetime.fromisoformat(master['start']))
                candidate=instance(master,key,begin,begin+duration,patch)
                for field in ('occurrence','start_utc','end_utc','deleted','deleted_at','purged'):candidate.pop(field,None)
                self.service.validate_event(c,cal,candidate)
                if patch:c.execute('INSERT INTO overrides VALUES(?,?,?) ON CONFLICT(event_id,occurrence) DO UPDATE SET data=excluded.data',(eid,key,dump(patch)))
                else:c.execute('DELETE FROM overrides WHERE event_id=? AND occurrence=?',(eid,key))
            for eid,row in touched.items():
                c.execute('UPDATE events SET data=?,deleted_at=?,revision=revision+1,schedule_version=schedule_version+1 WHERE id=?',(row['data'],row['deleted_at'],eid))
                c.execute("UPDATE outbox SET status='cancelled' WHERE event_id=? AND kind='reminder' AND status IN ('pending','sending')",(eid,))
            for eid in set(missing_ids):
                require(eid in archived and eid in allowed_missing,'invalid_selection')
                require(not c.execute('SELECT 1 FROM events WHERE id=?',(eid,)).fetchone(),'revision_conflict',409)
                e=archived[eid];data=e['data'];sanitize_category(data);self.service.validate_event(c,cal,data)
                c.execute('INSERT INTO events(id,calendar_id,data) VALUES(?,?,?)',(eid,cal['id'],dump(data)))
                for k,v in e['overrides'].items():c.execute('INSERT INTO overrides VALUES(?,?,?)',(eid,k,dump(v)))
            require(set(profile_fields)<=set(preview['profile']),'invalid_selection')
            prefs=self.service.user(c,user_id)
            for field in profile_fields:
                require(prefs.get(field)==preview['profile'][field]['current'],'revision_conflict',409)
                prefs[field]=archive['members'][user_id][field]
            if profile_fields:
                if 'timezone' in profile_fields:prefs['timezone_initialized']=True
                prefs.pop('id');c.execute('UPDATE users SET data=? WHERE id=?',(dump(prefs),user_id))
                c.execute("UPDATE outbox SET status='cancelled' WHERE user_id=? AND kind='reminder' AND status IN ('pending','sending')",(user_id,))
            c.execute('DELETE FROM backup_previews WHERE id=?',(preview_id,))
            if selections or missing_ids or category_ids or override_selections or profile_fields:self.service.notify(c,cal['id'],user_id,'backup_restored')
        return {'ok':True}

    def request_deleted(self,user_id,blob):
        a=self.verify(blob); cal=a['calendar']; pair=(cal['first_id'],cal['second_id'])
        require(user_id in pair and all(pair),'archive_wrong_pair',403)
        with self.service.db.transaction() as c:
            require(not c.execute('SELECT 1 FROM calendars WHERE id=?',(cal['id'],)).fetchone(),'calendar_still_exists',409)
            require(not c.execute('SELECT 1 FROM members WHERE user_id IN (?,?)',pair).fetchone(),'pair_has_another_calendar',409)
            existing=c.execute('SELECT * FROM restore_requests WHERE calendar_id=?',(cal['id'],)).fetchone()
            require(not existing,'restore_already_requested',409)
            rid=uid()
            c.execute('INSERT INTO restore_requests VALUES(?,?,?,?,?,?,?)',(rid,cal['id'],*pair,dump(a),dump([user_id]),stamp()))
            other=pair[1] if user_id==pair[0] else pair[0]
            self.service.enqueue(c,None,other,'admin',{'action':'restore_requested','title':'','data':{}})
            return {'id':rid,'waiting_for_partner':True}

    def approve_deleted(self,user_id,request_id,approve):
        with self.service.db.transaction() as c:
            r=c.execute('SELECT * FROM restore_requests WHERE id=?',(request_id,)).fetchone()
            require(r is not None and user_id in (r['first_id'],r['second_id']),'restore_not_found',404)
            if not approve:
                c.execute('DELETE FROM restore_requests WHERE id=?',(request_id,)); return {'ok':True}
            votes=set(load(r['votes'])); votes.add(user_id)
            if len(votes)<2:
                c.execute('UPDATE restore_requests SET votes=? WHERE id=?',(dump(sorted(votes)),request_id)); return {'waiting_for_partner':True}
            a=load(r['archive']); cal=a['calendar']
            require(not c.execute('SELECT 1 FROM members WHERE user_id IN (?,?)',(r['first_id'],r['second_id'])).fetchone(),'pair_has_another_calendar',409)
            require(not c.execute('SELECT 1 FROM calendars WHERE id=?',(cal['id'],)).fetchone(),'calendar_still_exists',409)
            c.execute('INSERT INTO calendars(id,first_id,second_id,created_at) VALUES(?,?,?,?)',(cal['id'],cal['first_id'],cal['second_id'],stamp()))
            for person,prefs in a['members'].items():
                current=c.execute('SELECT data FROM users WHERE id=?',(person,)).fetchone()
                old=load(current['data']) if current else {'bot_can_message':False,'delivery_error':None}
                old.update({k:v for k,v in prefs.items() if k in PROFILE_FIELDS}); old['reminders_enabled']=False
                c.execute('INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',(person,dump(old)))
                c.execute('INSERT INTO members VALUES(?,?,1)',(person,cal['id']))
            for cat in a['categories']:
                c.execute('INSERT INTO categories VALUES(?,?,?)',(cat['id'],cal['id'],dump(cat['data'])))
            for e in a['events']:
                self.service.validate_event(c,cal,e['data'])
                c.execute('INSERT INTO events(id,calendar_id,data,deleted_at) VALUES(?,?,?,?)',(e['id'],cal['id'],dump(e['data']),e['deleted_at']))
                for key,value in e['overrides'].items(): c.execute('INSERT INTO overrides VALUES(?,?,?)',(e['id'],key,dump(value)))
            c.execute('DELETE FROM restore_requests WHERE id=?',(request_id,))
            for person in a['members']:
                self.service.enqueue(c,cal['id'],person,'admin',{'action':'calendar_restored','title':'','data':{}})
            return {'ok':True}

    def ics(self,user_id):
        from datetime import date,timedelta
        from icalendar import Calendar,Event,Timezone,vRecur
        from .recurrence import base_datetime,local_datetime,zone,UTC,instance
        with self.service.db.transaction() as c:
            snap=self.snapshot(c,user_id);lang=self.service.user(c,user_id)['language']
        calendar=Calendar()
        calendar.add('prodid','-//Our Calendar//RU EN//EN')
        calendar.add('version','2.0');calendar.add('calscale','GREGORIAN')
        zones={e['data']['timezone'] for e in snap['events'] if not e['data']['all_day'] and not e['deleted_at']}
        for name in zones:
            # An explicit VTIMEZONE preserves wall-clock recurrences during DST.
            calendar.add_component(Timezone.from_tzinfo(zone(name),tzid=name,first_date=date(1970,1,1),last_date=date(2101,1,1)))
        def fill(component,data):
            tr=data.get('translations',{}).get(lang,{})
            component.add('dtstamp',datetime.now(UTC))
            component.add('summary',tr.get('title') or data['title'])
            component.add('description',tr.get('description') or data['description'])
            component.add('location',data['location'])
            if data['all_day']:
                component.add('dtstart',date.fromisoformat(data['start']))
                component.add('dtend',date.fromisoformat(data['end']))
            else:
                component.add('dtstart',local_datetime(data['start'],data['timezone'],data.get('fold',0)))
                component.add('dtend',local_datetime(data['end'],data['timezone'],data.get('end_fold',0)))
            if data['status']=='cancelled':component.add('status','CANCELLED')
        for e in snap['events']:
            if e['deleted_at']:continue
            data=e['data'];event=Event();event.add('uid',e['id']+'@our-calendar');fill(event,data)
            if data['rrule']:event.add('rrule',vRecur.from_ical(data['rrule'].removeprefix('RRULE:')))
            for key,override in e['overrides'].items():
                original=date.fromisoformat(key) if data['all_day'] else datetime.fromisoformat(key).replace(tzinfo=zone(data['timezone']))
                if override.get('deleted'):event.add('exdate',original)
            calendar.add_component(event)
            for key,override in e['overrides'].items():
                if override.get('deleted'):continue
                begin=datetime.fromisoformat(key).replace(tzinfo=zone(data['timezone']))
                duration=(date.fromisoformat(data['end'])-date.fromisoformat(data['start'])) if data['all_day'] else (datetime.fromisoformat(data['end'])-datetime.fromisoformat(data['start']))
                data_instance=instance(data,key,begin,begin+duration,override)
                exception=Event();exception.add('uid',e['id']+'@our-calendar')
                exception.add('recurrence-id',date.fromisoformat(key) if data['all_day'] else begin)
                fill(exception,data_instance);calendar.add_component(exception)
        return calendar.to_ical()
