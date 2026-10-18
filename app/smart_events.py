"""Consent-gated derived event text, shared categories and durable bounded jobs.

Event-owned metadata lives under server-owned `smart` in versioned event JSON so
normal recurrence and signed archives retain it atomically with the edited fields.
No provider client is available to this module.
"""
from copy import deepcopy
from datetime import timedelta
import math
import random
from .service import dump, load, uid
from .security import require, Problem, digest
from .recurrence import stamp, utcnow
from .ai_client import OpenAIClient, INSTRUCTIONS, PROMPT_VERSION

DEFAULTS = {'consent': False, 'titles': True, 'categorize': True, 'mode': 'suggest',
            'remember': True, 'include_internal': False, 'display_short': True}
PRICES = {'gpt-6-luna': (0.10, 0.50), 'gpt-5.4-mini': (0.75, 4.50)}


def preferences(data):
    return {**DEFAULTS, **data.get('smart_events', {})}


def validate_preferences(value):
    require(isinstance(value, dict) and set(value) <= set(DEFAULTS), 'invalid_settings')
    for key, v in value.items():
        require(v in ('suggest', 'auto') if key == 'mode' else type(v) is bool, 'invalid_settings')


def metadata(data):
    meta = deepcopy(data.get('smart', {}))
    meta.setdefault('version', 1)
    meta.setdefault('fields', {})
    meta.setdefault('short_titles', {})
    meta.setdefault('category', {'manual': bool(data.get('category_id')), 'origin': 'legacy'})
    for lang in ('ru', 'en'):
        for field in ('title', 'description'):
            meta['fields'].setdefault(lang + '.' + field, {'manual': bool(data.get('translations', {}).get(lang, {}).get('manual')), 'stale': False})
    return meta


def validate_metadata(meta):
    require(isinstance(meta, dict) and len(dump(meta)) <= 90000, 'invalid_smart_data')
    require(set(meta) <= {'version','fields','short_titles','category','source','languages','input_hash','excluded'}, 'invalid_smart_data')
    require(meta.get('version', 1) == 1, 'invalid_smart_data')
    for lang, value in meta.get('short_titles', {}).items():
        require(lang in ('ru', 'en') and isinstance(value, str) and len(value) <= 300, 'invalid_smart_data')
    for key, value in meta.get('fields', {}).items():
        require(key in {l+'.'+f for l in ('ru','en') for f in ('title','description','short_title')} and isinstance(value, dict), 'invalid_smart_data')
        require(set(value) <= {'manual','stale'} and all(type(v) is bool for v in value.values()), 'invalid_smart_data')
    source = meta.get('source', {})
    require(isinstance(source, dict) and set(source) <= {'title','description','provider'}, 'invalid_smart_data')
    require(all(isinstance(v, str) for v in source.values()), 'invalid_smart_data')
    cat = meta.get('category', {})
    require(isinstance(cat, dict) and set(cat) <= {'manual','origin','suggestion','confidence','ambiguous','context_hash'}, 'invalid_smart_data')
    require(type(cat.get('manual', False)) is bool, 'invalid_smart_data')
    require(cat.get('suggestion') is None or isinstance(cat.get('suggestion'), str), 'invalid_smart_data')
    require(isinstance(meta.get('languages', []), list) and len(meta.get('languages', [])) <= 12 and all(isinstance(v,str) and len(v)<=32 for v in meta.get('languages', [])), 'invalid_smart_data')


def manual_edit(data, previous, changes):
    """Called only by authenticated user mutation paths, never trusting client flags."""
    old = previous or {}
    meta = metadata(old)
    text_changed = any(data.get(k, '') != old.get(k, '') for k in ('title', 'description'))
    if text_changed:
        for value in meta['fields'].values():
            value['stale'] = True
        meta['category'].pop('suggestion', None)
        meta.pop('input_hash', None)
    if 'translations' in changes:
        for lang in ('ru', 'en'):
            tr = data.get('translations', {}).get(lang, {})
            before = old.get('translations', {}).get(lang, {})
            for field in ('title', 'description'):
                if tr.get(field, '') != before.get(field, ''):
                    meta['fields'][lang+'.'+field] = {'manual': True, 'stale': False}
            if tr:
                tr['manual'] = any(meta['fields'][lang+'.'+f]['manual'] for f in ('title','description'))
    if 'category_id' in changes and (data.get('category_id') != old.get('category_id') or (not previous and data.get('category_id'))):
        meta['category'] = {'manual': True, 'origin': 'manual'}
    if not previous or (text_changed and meta.get('source',{}).get('provider')=='local'):
        meta['source']={'title':data.get('title',''),'description':data.get('description',''),'provider':'local'}
    data['smart'] = meta


def source_changed(data):
    meta = metadata(data)
    for value in meta['fields'].values():
        value['stale'] = True
    meta.pop('input_hash', None)
    meta['category'].pop('suggestion', None)
    data['smart'] = meta


def capture_source(data, title=None, description=None, provider=''):
    meta = metadata(data)
    meta['source'] = {'title': data['title'] if title is None else title,
                      'description': data.get('description','') if description is None else description,
                      'provider': provider}
    data['smart'] = meta


def _scope(c, event_id, occurrence=''):
    row = c.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
    if not row or row['deleted_at']:
        return None
    data = load(row['data'])
    patch = None
    if occurrence:
        ov = c.execute('SELECT data FROM overrides WHERE event_id=? AND occurrence=?', (event_id, occurrence)).fetchone()
        if not ov:
            if not data.get('rrule'):return None
            from datetime import datetime
            from .recurrence import occurrences,zone
            try:
                target=datetime.fromisoformat(occurrence).replace(tzinfo=zone(data['timezone']))
                if not any(k==occurrence for k,_,_ in occurrences(data,target-timedelta(days=2),target+timedelta(days=2))):return None
            except (ValueError,TypeError,Problem):return None
        patch = load(ov['data']) if ov else {}
        if patch.get('deleted'):
            return None
        data = {**data, **patch}
        if 'smart' not in patch and any(k in patch for k in ('title','description')):
            data.pop('smart', None)
    return dict(row), data, patch


def _allowed(c, config, row, data):
    if not config.openai_api_key or metadata(data).get('excluded'):
        return None
    cal = c.execute("SELECT * FROM calendars WHERE id=? AND state='active'", (row['calendar_id'],)).fetchone()
    if not cal:
        return None
    owners = []
    for provider in ('google', 'icloud'):
        owners += [r['user_id'] for r in c.execute(f'''SELECT a.user_id FROM {provider}_links l
            JOIN {provider}_sources s ON s.id=l.source_id JOIN {provider}_accounts a ON a.id=s.account_id
            WHERE l.event_id=? AND l.state!='disconnected' ''', (row['id'],))]
    internal = not owners
    if internal:
        owners = [data.get('creator_id')]
    settings = []
    for person in set(owners):
        user = c.execute('''SELECT u.data FROM users u JOIN members m ON m.user_id=u.id
            WHERE u.id=? AND m.calendar_id=? AND m.active=1''', (person,row['calendar_id'])).fetchone()
        if not user:
            return None
        prefs = preferences(load(user['data']))
        if not prefs['consent'] or (internal and not prefs['include_internal']):
            return None
        settings.append(prefs)
    # Shared internal text requires both participants' explicit opt-in.
    if internal:
        for member in c.execute('SELECT u.data,m.active FROM users u JOIN members m ON m.user_id=u.id WHERE m.calendar_id=?', (row['calendar_id'],)):
            prefs = preferences(load(member['data']))
            if not member['active'] or not prefs['consent'] or not prefs['include_internal']:
                return None
            settings.append(prefs)
    if not settings:
        return None
    return {'titles': all(v['titles'] for v in settings), 'categorize': all(v['categorize'] for v in settings),
            'auto': config.smart_auto_categories and bool(cal['second_id']) and not c.execute('SELECT 1 FROM members WHERE calendar_id=? AND active=0',(row['calendar_id'],)).fetchone() and all(preferences(load(m['data']))['consent'] and preferences(load(m['data']))['categorize'] and preferences(load(m['data']))['mode']=='auto'
                for m in c.execute('SELECT u.data FROM users u JOIN members m ON m.user_id=u.id WHERE m.calendar_id=? AND m.active=1', (row['calendar_id'],)))}


def _payload(c, row, data, settings):
    cal = c.execute('SELECT first_id,second_id FROM calendars WHERE id=?', (row['calendar_id'],)).fetchone()
    aliases = {cal['first_id']: 'owner_A', cal['second_id']: 'owner_B', 'both': 'both'}
    categories = [{'id': r['id'], 'name': load(r['data'])['name'], 'translations': load(r['data']).get('translations', {})}
                  for r in c.execute('SELECT * FROM categories WHERE calendar_id=? ORDER BY id', (row['calendar_id'],))] if settings['categorize'] else []
    rules = [load(r['data']) for r in c.execute('SELECT data FROM smart_rules WHERE calendar_id=? ORDER BY id', (row['calendar_id'],))]
    rules = [r for r in rules if r['enabled'] and r['owner']==data.get('owner') and r['match'].casefold()==data['title'].strip().casefold()]
    # Never send Telegram IDs or unrelated rules to the external processor.
    hints = [{k:r[k] for k in ('match','category_id','short_titles') if k in r} for r in rules]
    payload = {'title': data['title'], 'description': data.get('description',''),
               'owner': aliases.get(data.get('owner'), 'both'), 'categories': categories, 'confirmed_rules': hints}
    require(len(dump(payload).encode()) <= 150000, 'smart_input_too_large', 422)
    fingerprint = digest(dump({'input':payload,'settings':settings,'protected':metadata(data), 'prompt':PROMPT_VERSION}))
    cache_hash = digest(dump({'input':payload, 'prompt':PROMPT_VERSION}))
    return payload, fingerprint, cache_hash, rules


def enqueue(c, config, event_id, force=False, replace_fields=None, only_occurrence=None):
    row = c.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
    if not row or row['deleted_at']:
        return False
    scopes = [''] + [ov['occurrence'] for ov in c.execute('SELECT * FROM overrides WHERE event_id=?', (event_id,))
                    if any(k in load(ov['data']) for k in ('title','description','smart')) and not load(ov['data']).get('deleted')]
    if only_occurrence is not None:scopes=[only_occurrence]
    handled = False
    for occurrence in scopes:
        scoped = _scope(c,event_id,occurrence)
        if not scoped:
            continue
        current, data, _ = scoped
        settings = _allowed(c,config,current,data)
        if not settings or not (settings['titles'] or settings['categorize']):
            continue
        payload, fingerprint, cache_hash, _ = _payload(c,current,data,settings)
        old = c.execute('SELECT * FROM smart_jobs WHERE event_id=? AND occurrence=?', (event_id,occurrence)).fetchone()
        if not force and old and old['input_hash']==fingerprint and old['state'] in ('pending','running','retry_wait','ready','failed','budget_paused'):
            handled = True
            continue
        token = uid()
        c.execute('''INSERT INTO smart_jobs(event_id,occurrence,calendar_id,generation,input_hash,cache_hash,payload,state,next_at)
            VALUES(?,?,?,?,?,?,?,'pending',?) ON CONFLICT(event_id,occurrence) DO UPDATE SET
            generation=excluded.generation,input_hash=excluded.input_hash,cache_hash=excluded.cache_hash,
            payload=excluded.payload,state='pending',attempts=0,error=NULL,next_at=excluded.next_at,lease_until=NULL''',
            (event_id,occurrence,row['calendar_id'],token,fingerprint,cache_hash,dump({'input':payload,'settings':settings,'replace_fields':replace_fields or [],'force':force}),stamp()))
        handled = True
    if handled:
        c.execute("UPDATE translation_jobs SET state='cancelled' WHERE kind='event' AND resource_id=?", (event_id,))
    return handled


def validate_result(result, payload):
    from .ai_client import SCHEMA
    require(isinstance(result,dict) and set(result)==set(SCHEMA['properties']), 'smart_invalid_response', 502)
    require(type(result['ambiguous']) is bool, 'smart_invalid_response', 502)
    require(isinstance(result['languages'],list) and len(result['languages'])<=12 and all(isinstance(v,str) and len(v)<=32 for v in result['languages']), 'smart_invalid_response',502)
    for key in ('translations','short_titles','short_confidence'):
        require(isinstance(result[key],dict) and set(result[key])=={'ru','en'}, 'smart_invalid_response',502)
    def score(v):
        require(type(v) in (float,int) and math.isfinite(v) and 0<=v<=1, 'smart_invalid_response',502)
    for lang in ('ru','en'):
        tr = result['translations'][lang]
        require(isinstance(tr,dict) and set(tr)=={'title','description'}, 'smart_invalid_response',502)
        require(isinstance(tr['title'],str) and 0<len(tr['title'].strip())<=300 and isinstance(tr['description'],str) and len(tr['description'])<=20000, 'smart_invalid_response',502)
        require(bool(payload['description'].strip()) or not tr['description'].strip(), 'smart_invalid_response',502)
        short = result['short_titles'][lang]
        require(short is None or (isinstance(short,str) and 0<len(short.strip())<=300), 'smart_invalid_response',502)
        score(result['short_confidence'][lang])
    require(result['category_id'] is None or result['category_id'] in {c['id'] for c in payload['categories']}, 'smart_invalid_category',502)
    score(result['category_confidence'])
    return result


class SmartEvents:
    def __init__(self, service, transport=None):
        self.s = service
        self.config = service.config
        self.transport = transport or OpenAIClient(self.config)

    def status(self, actor):
        with self.s.db.transaction() as c:
            cal = self.s.calendar(c,actor)
            jobs = {r['state']:r['n'] for r in c.execute('SELECT state,count(*) n FROM smart_jobs WHERE calendar_id=? GROUP BY state', (cal['id'],))}
            spent = c.execute("SELECT coalesce(sum(reserved),0) FROM smart_usage WHERE month=?", (stamp()[:7],)).fetchone()[0]
            last=c.execute("SELECT value FROM runtime WHERE key='smart_last_result'").fetchone()
            return {'last_result':load(last['value']) if last else None,'configured':bool(self.config.openai_api_key), 'automatic_available':self.config.smart_auto_categories, 'preferences':preferences(self.s.user(c,actor)),
                    'jobs':jobs, 'month_reserved_usd':round(spent,5), 'monthly_limit_usd':self.config.smart_monthly_budget,
                    'rules':[{'id':r['id'],**load(r['data'])} for r in c.execute('SELECT * FROM smart_rules WHERE calendar_id=?', (cal['id'],))]}

    def preview(self,actor,offset=0):
        require(type(offset) is int and 0<=offset<=100000,'invalid_request')
        require(bool(self.config.openai_api_key),'smart_not_configured',503)
        with self.s.db.transaction() as c:
            cal=self.s.calendar(c,actor)
            rows=c.execute("SELECT * FROM events WHERE calendar_id=? AND deleted_at IS NULL ORDER BY json_extract(data,'$.start') DESC,id LIMIT 51 OFFSET ?",(cal['id'],offset)).fetchall()
            items=[]
            for row in rows[:50]:
                data=load(row['data'])
                if _allowed(c,self.config,row,data):items.append({'id':row['id'],'revision':row['revision'],'title':data['title'],'start':data['start']})
            token=uid()
            c.execute('DELETE FROM smart_previews WHERE expires_at<=?',(stamp(),))
            c.execute('INSERT INTO smart_previews VALUES(?,?,?,?,?)',(token,actor,cal['id'],dump(items),stamp(utcnow()+timedelta(minutes=10))))
            return {'preview_id':token,'items':items,'offset':offset,'has_more':len(rows)>50}

    def batch(self,actor,preview_id,ids):
        require(isinstance(ids,list) and 0<len(ids)<=50 and all(isinstance(v,str) for v in ids) and len(set(ids))==len(ids),'invalid_selection')
        with self.s.db.transaction() as c:
            cal=self.s.calendar(c,actor)
            preview=c.execute('SELECT * FROM smart_previews WHERE id=? AND user_id=? AND calendar_id=? AND expires_at>?',(preview_id,actor,cal['id'],stamp())).fetchone()
            require(preview is not None,'preview_required',409)
            known={v['id']:v for v in load(preview['data'])}
            for event_id in ids:
                require(event_id in known,'invalid_selection')
                row=self.s.event_row(c,actor,event_id)
                require(row['revision']==known[event_id]['revision'],'revision_conflict',409)
                require(_allowed(c,self.config,row,load(row['data'])),'smart_consent_required',403)
            for event_id in ids:enqueue(c,self.config,event_id)
            c.execute('DELETE FROM smart_previews WHERE id=?',(preview_id,))
        return {'queued':len(ids)}

    def request(self, actor, event_id, occurrence='', replace_fields=None):
        allowed = {l+'.'+f for l in ('ru','en') for f in ('title','description','short_title')}
        replace_fields = replace_fields or []
        require(isinstance(replace_fields,list) and set(replace_fields)<=allowed, 'invalid_smart_fields')
        with self.s.db.transaction() as c:
            self.s.event_row(c,actor,event_id)
            scoped = _scope(c,event_id,occurrence)
            require(scoped is not None, 'event_not_found',404)
            require(bool(self.config.openai_api_key), 'smart_not_configured',503)
            require(_allowed(c,self.config,scoped[0],scoped[1]), 'smart_consent_required',403)
            enqueue(c,self.config,event_id,force=True,replace_fields=replace_fields,only_occurrence=occurrence)
        return {'queued':True}

    def edit(self, actor, event_id, revision, occurrence='', short_titles=None, category_action=None, remember=False, excluded=None):
        require(type(remember) is bool, 'invalid_request')
        with self.s.db.transaction() as c:
            row = self.s.event_row(c,actor,event_id)
            require(row['revision']==revision,'revision_conflict',409)
            scoped = _scope(c,event_id,occurrence)
            require(scoped is not None, 'event_not_found',404)
            row,data,patch = scoped
            meta = metadata(data)
            if excluded is not None:
                require(type(excluded) is bool,'invalid_request')
                meta['excluded'] = excluded
            if short_titles is not None:
                require(isinstance(short_titles,dict) and set(short_titles)<={'ru','en'},'invalid_smart_fields')
                for lang,value in short_titles.items():
                    require(isinstance(value,str) and len(value)<=300,'invalid_text')
                    meta['short_titles'][lang]=value.strip()
                    meta['fields'][lang+'.short_title']={'manual':True,'stale':False}
            if category_action is not None:
                require(category_action in ('accept','reject','unlock'),'invalid_request')
                suggestion = meta['category'].get('suggestion')
                if category_action=='accept':
                    require(suggestion and c.execute('SELECT 1 FROM categories WHERE id=? AND calendar_id=?',(suggestion,row['calendar_id'])).fetchone(),'invalid_category')
                    catalog=[{'id':r['id'],'name':load(r['data'])['name'],'translations':load(r['data']).get('translations',{})} for r in c.execute('SELECT * FROM categories WHERE calendar_id=? ORDER BY id',(row['calendar_id'],))]
                    require(meta['category'].get('context_hash')==digest(dump(catalog)),'smart_suggestion_stale',409)
                    data['category_id']=suggestion
                    meta['category']={'manual':True,'origin':'confirmed'}
                elif category_action=='reject':
                    meta['category']={'manual':True,'origin':'manual'}
                else:
                    meta['category']={'manual':False,'origin':'unset'}
            data['smart']=meta
            self.s.validate_event(c,self.s.calendar(c,actor),data)
            self._store(c,row,occurrence,data,patch)
            if remember:
                require(preferences(self.s.user(c,actor))['remember'],'smart_remember_disabled')
                require(short_titles is not None or category_action=='accept','invalid_request')
                rule={'match':data['title'].strip(),'owner':data['owner'],'enabled':True,'author':actor}
                if short_titles is not None:rule['short_titles']=meta['short_titles']
                if category_action=='accept':rule['category_id']=data.get('category_id')
                existing=c.execute('SELECT * FROM smart_rules WHERE calendar_id=?',(row['calendar_id'],)).fetchall()
                # Conflicting confirmed rules remain explicit; never silently replace a partner's rule.
                if not any(load(r['data'])==rule for r in existing):
                    c.execute('INSERT INTO smart_rules VALUES(?,?,?)',(uid(),row['calendar_id'],dump(rule)))
            c.execute("UPDATE smart_jobs SET state='cancelled',generation=? WHERE event_id=? AND occurrence=?",(uid(),event_id,occurrence))
        return {'ok':True}

    def rule(self,actor,rule_id,enabled=None,delete=False,changes=None):
        with self.s.db.transaction() as c:
            cal=self.s.calendar(c,actor)
            row=c.execute('SELECT * FROM smart_rules WHERE id=? AND calendar_id=?',(rule_id,cal['id'])).fetchone()
            require(row is not None,'resource_not_found',404)
            if delete:c.execute('DELETE FROM smart_rules WHERE id=?',(rule_id,))
            else:
                changes=changes or {}
                require(isinstance(changes,dict) and set(changes)<={'enabled','match','short_titles','category_id'},'invalid_request')
                if enabled is not None:changes={**changes,'enabled':enabled}
                data=load(row['data'])
                if 'enabled' in changes:require(type(changes['enabled']) is bool,'invalid_request')
                if 'match' in changes:require(isinstance(changes['match'],str) and 0<len(changes['match'].strip())<=300,'invalid_text')
                if 'category_id' in changes:
                    require(changes['category_id'] is None or isinstance(changes['category_id'],str),'invalid_category')
                    require(changes['category_id'] is None or c.execute('SELECT 1 FROM categories WHERE id=? AND calendar_id=?',(changes['category_id'],cal['id'])).fetchone(),'invalid_category')
                if 'short_titles' in changes:
                    require(isinstance(changes['short_titles'],dict) and set(changes['short_titles'])<={'ru','en'} and all(isinstance(v,str) and len(v)<=300 for v in changes['short_titles'].values()),'invalid_text')
                data.update(changes)
                c.execute('UPDATE smart_rules SET data=? WHERE id=?',(dump(data),rule_id))
        return {'ok':True}

    def _store(self,c,row,occurrence,data,patch):
        if occurrence:
            patch={**patch,'smart':data['smart'],'translations':data.get('translations',{}),'category_id':data.get('category_id')}
            c.execute('INSERT INTO overrides VALUES(?,?,?) ON CONFLICT(event_id,occurrence) DO UPDATE SET data=excluded.data',(row['id'],occurrence,dump(patch)))
            c.execute('UPDATE events SET revision=revision+1 WHERE id=?',(row['id'],))
        else:
            c.execute('UPDATE events SET data=?,revision=revision+1 WHERE id=?',(dump(data),row['id']))
        for notice in c.execute("SELECT * FROM outbox WHERE event_id=? AND status='pending'",(row['id'],)).fetchall():
            payload=load(notice['payload']);notice_data=payload.get('data',{})
            if (notice_data.get('occurrence') or '')==occurrence:
                notice_data['translations']=data.get('translations',{})
                payload['data']=notice_data
                c.execute('UPDATE outbox SET payload=? WHERE id=?',(dump(payload),notice['id']))

    def process(self):
        if not self.config.openai_api_key:
            return
        with self.s.db.transaction() as c:
            blocked=c.execute("SELECT value FROM runtime WHERE key='smart_blocked_config'").fetchone()
            if blocked and blocked['value']==digest(self.config.openai_api_key+self.config.openai_model):return
            c.execute("UPDATE smart_jobs SET state='pending' WHERE state='budget_paused' AND next_at<=?",(stamp(),))
            c.execute("DELETE FROM smart_cache WHERE expires_at<?",(stamp(),))
            c.execute("UPDATE smart_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'retry_wait' END,lease_until=NULL WHERE state='running' AND lease_until<=?",(stamp(),))
            job=c.execute("""SELECT j.* FROM smart_jobs j JOIN calendars ca ON ca.id=j.calendar_id
                WHERE ca.state='active' AND j.state IN ('pending','retry_wait') AND j.next_at<=? ORDER BY j.next_at LIMIT 1""",(stamp(),)).fetchone()
            if not job:return
            job=dict(job);scoped=_scope(c,job['event_id'],job['occurrence'])
            if not scoped or not (settings:=_allowed(c,self.config,scoped[0],scoped[1])):
                c.execute("UPDATE smart_jobs SET state='cancelled' WHERE event_id=? AND occurrence=?",(job['event_id'],job['occurrence']));return
            row,data,patch=scoped
            try:payload,fingerprint,cache_hash,rules=_payload(c,row,data,settings)
            except Problem as exc:
                c.execute("UPDATE smart_jobs SET state='failed',error=? WHERE event_id=? AND occurrence=?",(exc.code,row['id'],job['occurrence']));return
            if fingerprint!=job['input_hash']:
                enqueue(c,self.config,row['id']);return
            cached=None if load(job['payload']).get('force') else c.execute('SELECT result FROM smart_cache WHERE calendar_id=? AND hash=? AND model=? AND expires_at>?',(row['calendar_id'],cache_hash,self.config.openai_model,stamp())).fetchone()
            reservation=None
            if not cached:
                # UTF-8 bytes conservatively bound input tokens; all retries reserve again.
                rate_in,rate_out=PRICES[self.config.openai_model]
                reserved=((len(dump(payload).encode())+len(INSTRUCTIONS.encode())+6000)*rate_in*1.25+self.config.openai_max_output_tokens*rate_out)/1000000
                month=stamp()[:7]
                spent=c.execute('SELECT coalesce(sum(reserved),0) FROM smart_usage WHERE month=?',(month,)).fetchone()[0]
                if spent+reserved>self.config.smart_monthly_budget:
                    c.execute("UPDATE smart_jobs SET state='budget_paused',error='smart_budget_limit',next_at=? WHERE event_id=? AND occurrence=?",(stamp((utcnow().replace(day=28)+timedelta(days=4)).replace(day=1,hour=0,minute=0,second=0,microsecond=0)),row['id'],job['occurrence']));return
                reservation=uid()
                c.execute('INSERT INTO smart_usage(id,month,reserved,model,state) VALUES(?,?,?,?,?)',(reservation,month,reserved,self.config.openai_model,'reserved'))
            c.execute("UPDATE smart_jobs SET state='running',attempts=attempts+1,lease_until=? WHERE event_id=? AND occurrence=?",(stamp(utcnow()+timedelta(minutes=2)),row['id'],job['occurrence']))
        try:
            if cached:result=load(cached['result']);usage={}
            else:result,usage=self.transport.process(payload)
            result=validate_result(result,payload)
            with self.s.db.transaction() as c:
                if reservation:
                    # Keep the conservative reservation as the hard spend accounting bound.
                    c.execute("UPDATE smart_usage SET state='completed',usage=? WHERE id=?",(dump({k:v for k,v in usage.items() if k in ('input_tokens','output_tokens','total_tokens') and type(v) is int}),reservation))
                fresh=c.execute('SELECT * FROM smart_jobs WHERE event_id=? AND occurrence=?',(job['event_id'],job['occurrence'])).fetchone()
                scoped=_scope(c,job['event_id'],job['occurrence'])
                if not fresh or fresh['generation']!=job['generation'] or fresh['state']!='running' or not scoped:return
                row,data,patch=scoped
                settings=_allowed(c,self.config,row,data)
                if not settings:
                    c.execute("UPDATE smart_jobs SET state='cancelled' WHERE event_id=? AND occurrence=?",(row['id'],job['occurrence']));return
                new_payload,new_hash,_,rules=_payload(c,row,data,settings)
                if new_hash!=job['input_hash']:
                    enqueue(c,self.config,row['id']);return
                c.execute('INSERT INTO smart_cache VALUES(?,?,?,?,?) ON CONFLICT(calendar_id,hash,model) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at',
                          (row['calendar_id'],cache_hash,self.config.openai_model,dump(result),stamp(utcnow()+timedelta(days=30))))
                meta=metadata(data);replace=load(job['payload']).get('replace_fields',[])
                if settings['titles']:
                    translations=deepcopy(data.get('translations',{}))
                    for lang in ('ru','en'):
                        tr=translations.setdefault(lang,{'title':'','description':''})
                        for field in ('title','description'):
                            key=lang+'.'+field
                            if not meta['fields'][key]['manual'] or key in replace:
                                tr[field]=result['translations'][lang][field]
                                meta['fields'][key]={'manual':False,'stale':False}
                        key=lang+'.short_title'
                        if not meta['fields'].get(key,{}).get('manual') or key in replace:
                            short=result['short_titles'][lang] if result['short_confidence'][lang]>=0.9 else None
                            rule_shorts={r.get('short_titles',{}).get(lang) for r in rules if r.get('short_titles',{}).get(lang)}
                            meta['short_titles'][lang]=next(iter(rule_shorts)) if len(rule_shorts)==1 else '' if len(rule_shorts)>1 else short or ''
                            meta['fields'][key]={'manual':False,'stale':False}
                        tr['manual']=any(meta['fields'][lang+'.'+f]['manual'] for f in ('title','description'))
                        tr['stale']=any(meta['fields'][lang+'.'+f].get('stale',False) for f in ('title','description'))
                    data['translations']=translations
                if settings['categorize'] and not meta['category'].get('manual'):
                    cat=result['category_id'];conf=result['category_confidence'];ambiguous=result['ambiguous']
                    rule_choices={r['category_id'] for r in rules if 'category_id' in r}
                    if len(rule_choices)>1:cat=None;ambiguous=True
                    elif len(rule_choices)==1:
                        choice=next(iter(rule_choices))
                        if choice is None or choice in {v['id'] for v in payload['categories']}:cat=choice;conf=1;ambiguous=False
                    meta['category']={'manual':False,'origin':'ai','suggestion':cat,'confidence':conf,'ambiguous':ambiguous,'context_hash':digest(dump(payload['categories']))}
                    if cat and settings['auto'] and conf>=0.95 and not ambiguous:
                        data['category_id']=cat;meta['category']['origin']='ai_auto'
                meta['languages']=result['languages'];meta['input_hash']=cache_hash
                data['smart']=meta
                self.s.validate_event(c,dict(c.execute('SELECT * FROM calendars WHERE id=?',(row['calendar_id'],)).fetchone()),data)
                self._store(c,row,job['occurrence'],data,patch)
                c.execute("INSERT INTO runtime VALUES('smart_last_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(dump({'state':'ready','checked_at':stamp()}),))
                # Fingerprint includes manual metadata. Save final state to avoid requeueing on time-only edits.
                _,final_hash,_,_=_payload(c,row,data,settings)
                c.execute("UPDATE smart_jobs SET state='ready',error=NULL,lease_until=NULL,input_hash=? WHERE event_id=? AND occurrence=? AND generation=?",(final_hash,row['id'],job['occurrence'],job['generation']))
        except (Problem,ValueError,KeyError,TypeError) as exc:
            code=exc.code if isinstance(exc,Problem) else 'smart_invalid_response'
            retry=code in ('smart_unavailable','smart_rate_limited','smart_incomplete') and job['attempts']+1<3
            with self.s.db.transaction() as c:
                c.execute("INSERT INTO runtime VALUES('smart_last_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(dump({'state':code,'checked_at':stamp()}),))
                if reservation:c.execute("UPDATE smart_usage SET state='uncertain' WHERE id=?",(reservation,))
                if code in ('smart_auth_error','smart_request_error'):
                    c.execute("INSERT INTO runtime VALUES('smart_blocked_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(digest(self.config.openai_api_key+self.config.openai_model),))
                c.execute('UPDATE smart_jobs SET state=?,error=?,lease_until=NULL,next_at=? WHERE event_id=? AND occurrence=? AND generation=?',
                    ('retry_wait' if retry else 'failed',code,stamp(utcnow()+timedelta(seconds=30*2**job['attempts']+random.randint(0,10))),job['event_id'],job['occurrence'],job['generation']))
