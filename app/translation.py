"""Optional LibreTranslate transport; manual text is never replaced implicitly."""
import json
import urllib.error
import urllib.request
from datetime import timedelta
from .security import require,Problem,digest
from .service import dump,load
from .recurrence import stamp,utcnow

def resource_version(kind,row):
    return str(row['revision']) if kind=='event' else digest(row['data'])

def enqueue_translation(c,config,kind,resource_id,calendar_id,row_data,version,force=False,overwrite_manual=False):
    if not config.translation_url:return False
    c.execute('''INSERT INTO translation_jobs(kind,resource_id,calendar_id,version,payload,state,next_at)
      VALUES(?,?,?,?,?,'pending',?) ON CONFLICT(kind,resource_id) DO UPDATE SET
      version=excluded.version,payload=excluded.payload,state='pending',attempts=0,error=NULL,next_at=excluded.next_at''',
      (kind,resource_id,calendar_id,str(version),dump({'source':row_data,'force':force,'overwrite_manual':overwrite_manual,'overrides':{r['occurrence']:load(r['data']) for r in c.execute('SELECT * FROM overrides WHERE event_id=?',(resource_id,))} if kind=='event' else {}}),stamp()))
    return True

class LibreTranslate:
    def __init__(self,config):self.config=config
    def translate(self,texts,target):
        body={'q':texts,'source':'auto','target':target,'format':'text'}
        if self.config.translation_api_key:body['api_key']=self.config.translation_api_key
        request=urllib.request.Request(self.config.translation_url.rstrip('/')+'/translate',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=10) as response:
                data=json.loads(response.read(256000))
            values=data['translatedText']
            if isinstance(values,str) and len(texts)==1:values=[values]
            require(isinstance(values,list) and len(values)==len(texts) and all(isinstance(v,str) and len(v)<=22000 for v in values),'translation_invalid_response',502)
            return values
        except Problem:raise
        except (OSError,ValueError,KeyError,TypeError):raise Problem(502,'translation_unavailable')

class Translations:
    def __init__(self,service,transport=None):
        self.service=service;self.config=service.config;self.transport=transport or LibreTranslate(self.config)
        self.verified=False;self.probe_after=0

    def probe(self):
        """Verify both language directions with synthetic text, never calendar data."""
        import time
        if not self.config.translation_url or time.monotonic()<self.probe_after:return
        self.probe_after=time.monotonic()+300
        state='ready'
        try:
            for text,target in (('Купить молоко','en'),('Buy milk','ru')):
                values=self.transport.translate([text],target)
                require(bool(values[0].strip()) and values[0]!=text,'translation_invalid_response',502)
            self.verified=True
        except Problem as exc:state=exc.code
        with self.service.db.transaction() as c:
            c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('translation_probe',dump({'state':state,'checked_at':stamp()})))

    def backfill(self):
        """Queue pre-configuration records once per endpoint, without manual changes."""
        if not self.config.translation_url:return
        marker='translation_backfill_v2:'+digest(self.config.translation_url)
        with self.service.db.transaction() as c:
            if c.execute('SELECT 1 FROM runtime WHERE key=?',(marker,)).fetchone():return
            for kind,table in (('event','events'),('category','categories')):
                rows=c.execute('SELECT r.* FROM '+table+" r JOIN calendars ca ON ca.id=r.calendar_id WHERE ca.state='active'"+(' AND r.deleted_at IS NULL' if kind=='event' else '')).fetchall()
                for row in rows:
                    data=load(row['data']);translations=data.get('translations',{})
                    overrides=[load(r['data']) for r in c.execute('SELECT data FROM overrides WHERE event_id=?',(row['id'],))] if kind=='event' else []
                    missing_override=any(not ov.get('deleted') and any(k in ov for k in ('title','description')) and any(not ov.get('translations',{}).get(lang) for lang in ('ru','en')) for ov in overrides)
                    missing=missing_override or any(not translations.get(lang) or (isinstance(translations.get(lang),dict) and translations[lang].get('stale') and not translations[lang].get('manual')) for lang in ('ru','en'))
                    if not missing:continue
                    job=c.execute('SELECT state FROM translation_jobs WHERE kind=? AND resource_id=?',(kind,row['id'])).fetchone()
                    if job and job['state']=='pending':continue
                    enqueue_translation(c,self.config,kind,row['id'],row['calendar_id'],data,resource_version(kind,row))
            c.execute('INSERT INTO runtime VALUES(?,?)',(marker,stamp()))
    def request(self,user_id,resource_id,kind='event',overwrite_manual=False):
        require(bool(self.config.translation_url),'translation_not_configured',503)
        require(kind in ('event','category'),'invalid_resource')
        with self.service.db.transaction() as c:
            cal=self.service.calendar(c,user_id)
            if kind=='event':row=self.service.event_row(c,user_id,resource_id)
            else:row=c.execute('SELECT * FROM categories WHERE id=? AND calendar_id=?',(resource_id,cal['id'])).fetchone()
            require(row is not None,'resource_not_found',404)
            enqueue_translation(c,self.config,kind,resource_id,cal['id'],load(row['data']),resource_version(kind,row),force=True,overwrite_manual=overwrite_manual)
        return {'queued':True}

    def translate_fields(self,kind,source,settings):
        translations=dict(source.get('translations',{}))
        for lang in ('ru','en'):
            existing=translations.get(lang)
            manual=existing.get('manual',False) if isinstance(existing,dict) else source.get('translation_manual',{}).get(lang,bool(existing))
            if manual and not settings['overwrite_manual']:continue
            if existing and not settings['force'] and not (isinstance(existing,dict) and existing.get('stale')):continue
            fields=['name'] if kind=='category' else ['title','description']
            nonempty=[k for k in fields if source.get(k)]
            values=self.transport.translate([source[k] for k in nonempty],lang) if nonempty else []
            translated=dict(zip(nonempty,values))
            if kind=='category':translations[lang]=translated.get('name','')
            else:translations[lang]={'title':translated.get('title',''),'description':translated.get('description',''),'manual':False,'stale':False}
        return translations

    def process(self,limit=1):
        if not self.config.translation_url:return
        self.backfill()
        for _ in range(limit):
            with self.service.db.transaction() as c:
                job=c.execute("SELECT j.* FROM translation_jobs j JOIN calendars ca ON ca.id=j.calendar_id WHERE ca.state='active' AND j.state IN ('pending','failed') AND j.next_at<=? ORDER BY j.next_at LIMIT 1",(stamp(),)).fetchone()
                if not job:return
                job=dict(job);source=load(job['payload'])['source'];settings=load(job['payload'])
            try:
                translations=self.translate_fields(job['kind'],source,settings)
                translated_overrides={}
                for key,patch in settings.get('overrides',{}).items():
                    if patch.get('deleted') or not any(k in patch for k in ('title','description')):continue
                    effective={**source,**patch,'translations':patch.get('translations',{})}
                    translated_overrides[key]=self.translate_fields('event',effective,settings)
                with self.service.db.transaction() as c:
                    table='events' if job['kind']=='event' else 'categories'
                    fresh=c.execute('SELECT * FROM '+table+' WHERE id=? AND calendar_id=?',(job['resource_id'],job['calendar_id'])).fetchone()
                    current_job=c.execute('SELECT * FROM translation_jobs WHERE kind=? AND resource_id=?',(job['kind'],job['resource_id'])).fetchone()
                    cal=c.execute('SELECT state FROM calendars WHERE id=?',(job['calendar_id'],)).fetchone()
                    if not fresh or not current_job or current_job['version']!=job['version']:continue
                    if not cal or cal['state']!='active':continue
                    if resource_version(job['kind'],fresh)!=job['version']:
                        # A later manual edit wins. Requeue the latest source without
                        # permission to overwrite manual versions.
                        enqueue_translation(c,self.config,job['kind'],job['resource_id'],job['calendar_id'],load(fresh['data']),resource_version(job['kind'],fresh))
                        continue
                    data=load(fresh['data']);data['translations']=translations
                    if job['kind']=='event':
                        self.service.validate_event(c,dict(c.execute('SELECT * FROM calendars WHERE id=?',(job['calendar_id'],)).fetchone()),data)
                        c.execute('UPDATE events SET data=?,revision=revision+1 WHERE id=?',(dump(data),job['resource_id']))
                        for notice in c.execute("SELECT * FROM outbox WHERE event_id=? AND status='pending'",(job['resource_id'],)).fetchall():
                            payload=load(notice['payload']);payload.setdefault('data',{})['translations']=translated_overrides.get(payload.get('data',{}).get('occurrence'),translations)
                            c.execute('UPDATE outbox SET payload=? WHERE id=?',(dump(payload),notice['id']))
                        for key,tr in translated_overrides.items():
                            patch=settings['overrides'][key];patch['translations']=tr
                            c.execute('UPDATE overrides SET data=? WHERE event_id=? AND occurrence=?',(dump(patch),job['resource_id'],key))
                    else:
                        # Automatic category translations are distinguished from
                        # user-authored strings by server-owned metadata.
                        manual=dict(data.get('translation_manual',{}))
                        for lang in ('ru','en'):
                            if translations.get(lang)!=source.get('translations',{}).get(lang):manual[lang]=False
                        data['translation_manual']=manual
                        c.execute('UPDATE categories SET data=? WHERE id=?',(dump(data),job['resource_id']))
                    c.execute("UPDATE translation_jobs SET state='ready',error=NULL WHERE kind=? AND resource_id=? AND version=?",(job['kind'],job['resource_id'],job['version']))
            except Problem as exc:
                with self.service.db.transaction() as c:
                    attempts=job['attempts']+1
                    c.execute('UPDATE translation_jobs SET state=?,attempts=?,error=?,next_at=? WHERE kind=? AND resource_id=? AND version=?',
                              ('failed' if attempts>=4 else 'pending',attempts,exc.code,stamp(utcnow()+timedelta(seconds=30*2**min(attempts,7))),job['kind'],job['resource_id'],job['version']))
