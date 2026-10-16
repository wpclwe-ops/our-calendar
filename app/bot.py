from datetime import datetime, timedelta
import json
import logging
import threading
import urllib.request
import urllib.error
from .service import dump,load
from .recurrence import UTC,utcnow,stamp,occurrences,instance,zone

log=logging.getLogger('our_calendar.worker')
TEXT={
 'ru':{'created':'Новое событие','updated':'Событие изменено','deleted':'Событие удалено','restored':'Событие восстановлено',
       'joined':'Второй участник присоединился к Our Calendar','backup_restored':'Календарь восстановлен из резервной копии',
       'deletion_requested':'Запрошено полное удаление календаря. Откройте настройки, чтобы согласиться или отказаться.',
       'deletion_started':'Календарь будет удалён через 30 дней. Любой из вас может отменить удаление.',
       'deletion_cancelled':'Удаление календаря отменено', 'restore_requested':'Запрошено восстановление Our Calendar из ZIP. Откройте приложение для подтверждения.',
       'calendar_restored':'Календарь восстановлен. Включите свои напоминания в настройках, когда будете готовы.',
       'event_started':'Событие начинается','reminder':'Напоминание','open':'Открыть календарь','welcome':'Our Calendar — ваш общий календарь для двоих. Откройте приложение, чтобы начать.',
       'all_day':'Весь день','both':'Обоим'},
 'en':{'created':'New event','updated':'Event updated','deleted':'Event deleted','restored':'Event restored',
       'joined':'Your partner joined Our Calendar','backup_restored':'Calendar restored from backup',
       'deletion_requested':'Calendar deletion requested. Open settings to approve or reject.',
       'deletion_started':'Your calendar will be deleted in 30 days. Either participant can cancel.',
       'deletion_cancelled':'Calendar deletion cancelled','restore_requested':'Our Calendar ZIP restoration requested. Open the app to approve.',
       'calendar_restored':'Calendar restored. Enable your own reminders in settings when ready.',
       'event_started':'Event starting now','reminder':'Reminder','open':'Open calendar','welcome':'Our Calendar — a shared calendar for two. Open the app to get started.',
       'all_day':'All day','both':'Both'}
}

class TelegramAPIError(Exception):
    def __init__(self,code,retry_after=0):
        self.code,self.retry_after=code,retry_after

class Telegram:
    def __init__(self,config): self.config=config
    def call(self,method,params):
        req=urllib.request.Request('https://api.telegram.org/bot'+self.config.bot_token+'/'+method,
                                  data=json.dumps(params).encode(),headers={'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=20) as r: data=json.load(r)
        except urllib.error.HTTPError as e:
            try: data=json.load(e)
            except (ValueError,TypeError): raise TelegramAPIError(e.code)
        except (OSError,TimeoutError): raise TelegramAPIError(503)
        if not data.get('ok'):
            raise TelegramAPIError(data.get('error_code',500),data.get('parameters',{}).get('retry_after',0))
        return data.get('result')

    def send(self,user_id,text,lang='en',url=None):
        return self.call('sendMessage',{'chat_id':int(user_id),'text':text[:4096],
                'reply_markup':{'inline_keyboard':[[{'text':TEXT[lang]['open'],'web_app':{'url':url or self.config.public_url}}]]}})

    def setup(self):
        self.call('setWebhook',{'url':self.config.public_url+'/api/telegram/webhook','secret_token':self.config.webhook_secret,
                                'allowed_updates':['message','my_chat_member'],'drop_pending_updates':False})
        self.call('setChatMenuButton',{'menu_button':{'type':'web_app','text':'Our Calendar','web_app':{'url':self.config.public_url}}})
        self.call('setMyCommands',{'commands':[{'command':'start','description':'Open Our Calendar'},{'command':'help','description':'Help'}]})

class Worker:
    def __init__(self,service,telegram=None):
        self.service=service; self.telegram=telegram or Telegram(service.config)
        from .translation import Translations
        self.translations=Translations(service)
        self.stop_event=threading.Event(); self.thread=None
        self.setup_complete=False;self.setup_next=None
    def start(self):
        self.thread=threading.Thread(target=self.run,name='calendar-worker',daemon=True);self.thread.start()
    def stop(self):
        self.stop_event.set()
        if self.thread:self.thread.join(timeout=25)
    def run(self):
        while not self.stop_event.is_set():
            try:
                self.configure_bot();self.service.maintenance(); self.translations.process(); self.schedule(); self.deliver()
                with self.service.db.transaction() as c:
                    c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('worker_heartbeat',stamp()))
            except Exception:
                log.exception('Worker cycle failed')
            self.stop_event.wait(15)

    def configure_bot(self):
        if not self.service.config.auto_setup_bot or self.service.config.demo or self.setup_complete:return
        if self.setup_next and utcnow()<self.setup_next:return
        status='ready'
        try:
            identity=self.telegram.call('getMe',{})
            if (identity or {}).get('username','').casefold()!=self.service.config.bot_username.casefold():
                status='username_mismatch'
            else:
                self.telegram.setup();self.setup_complete=True
        except TelegramAPIError as exc:status='telegram_'+str(exc.code)
        self.setup_next=utcnow()+timedelta(seconds=60)
        with self.service.db.transaction() as c:
            c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('bot_setup',status))

    def schedule(self,now=None):
        now=now or utcnow(); horizon=now+timedelta(days=3)
        with self.service.db.transaction() as c:
            rows=c.execute("SELECT e.* FROM events e JOIN calendars ca ON ca.id=e.calendar_id WHERE ca.state='active' AND e.deleted_at IS NULL").fetchall()
            for row in rows:
                data=load(row['data'])
                overrides={v['occurrence']:load(v['data']) for v in c.execute('SELECT * FROM overrides WHERE event_id=?',(row['id'],))}
                expanded={k:instance(data,k,a,b,overrides.get(k)) for k,a,b in occurrences(data,now-timedelta(days=2),horizon)}
                for k,ov in overrides.items():
                    if k not in expanded and 'start' in ov:
                        from .recurrence import base_datetime
                        # A moved instance has its own complete timing in the override.
                        it=dict(data);it.update(ov); it['rrule']=''
                        for _,a,b in occurrences(it,now-timedelta(days=2),horizon): expanded[k]=instance(it,k,a,b)
                for key,event in expanded.items():
                    if event.get('deleted') or event['status']!='planned':continue
                    for member in c.execute('SELECT * FROM members WHERE calendar_id=? AND active=1',(row['calendar_id'],)).fetchall():
                        person=self.service.user(c,member['user_id'])
                        if not person['reminders_enabled']:continue
                        if event['all_day']:
                            begin=datetime.fromisoformat(event['start']).replace(tzinfo=zone(person['timezone']))
                        else:begin=datetime.fromisoformat(event['start_utc'])
                        intervals=list(event['reminders'].get(person['id'],[]))
                        if person['notify_at_start']:intervals.append(0)
                        for minutes in intervals:
                            due=begin.astimezone(UTC)-timedelta(minutes=minutes)
                            if not (now<due<=horizon):continue
                            unique='reminder:'+':'.join([row['id'],key,str(row['schedule_version']),person['id'],str(minutes),stamp(due)])
                            self.service.enqueue(c,row['calendar_id'],person['id'],'reminder',{'action':'event_started' if minutes==0 else 'reminder','data':event,
                                'schedule_version':row['schedule_version'],'minutes':minutes,'scheduled_due':stamp(due)},due=stamp(due),key=unique,event_id=row['id'])

    def text(self,job,person):
        p=load(job['payload']); data=p.get('data',{}); lang=person['language']; strings=TEXT[lang]
        title=data.get('translations',{}).get(lang,{}).get('title') or data.get('title') or p.get('title','')
        text=strings.get(p['action'],p['action'])+(': '+title if title else '')
        if data.get('start'):
            if data['all_day']:when=data['start']+' · '+strings['all_day']
            else:
                from .recurrence import local_datetime
                start=local_datetime(data['start'],data['timezone'],data.get('fold',0)).astimezone(zone(person['timezone']))
                end=local_datetime(data['end'],data['timezone'],data.get('end_fold',0)).astimezone(zone(person['timezone']))
                when=start.strftime('%d.%m.%Y %H:%M')+'–'+end.strftime('%H:%M')+' · '+person['timezone']
            text+='\n'+when
        if data.get('location'):text+='\n'+data['location']
        return text

    def deliver(self,now=None):
        now=now or utcnow()
        for _ in range(40):
            with self.service.db.transaction() as c:
                c.execute("UPDATE outbox SET status='pending' WHERE status='sending' AND lease_until<?",(stamp(now),))
                job=c.execute("SELECT * FROM outbox WHERE status='pending' AND due<=? ORDER BY due LIMIT 1",(stamp(now),)).fetchone()
                if not job:return
                job=dict(job)
                member=c.execute('SELECT m.active,ca.state FROM members m JOIN calendars ca ON ca.id=m.calendar_id WHERE m.user_id=? AND ca.id=?',(job['user_id'],job['calendar_id'])).fetchone()
                person_row=c.execute('SELECT data FROM users WHERE id=?',(job['user_id'],)).fetchone()
                if not person_row:
                    c.execute("UPDATE outbox SET status='cancelled' WHERE id=?",(job['id'],));continue
                person={'id':job['user_id'],**load(person_row['data'])}
                if job['kind']!='admin' and (not member or not member['active'] or member['state']!='active'):
                    c.execute("UPDATE outbox SET status='cancelled' WHERE id=?",(job['id'],));continue
                if job['kind']=='reminder':
                    ev=c.execute('SELECT * FROM events WHERE id=?',(job['event_id'],)).fetchone()
                    payload=load(job['payload'])
                    if not ev or ev['deleted_at'] or ev['schedule_version']!=payload['schedule_version'] or not person['reminders_enabled'] or (payload.get('minutes')==0 and not person.get('notify_at_start',True)):
                        c.execute("UPDATE outbox SET status='cancelled' WHERE id=?",(job['id'],));continue
                    # Do not catch up historical reminders after downtime, pause, or restore.
                    if (now-datetime.fromisoformat(payload.get('scheduled_due',job['due']))).total_seconds()>90:
                        c.execute("UPDATE outbox SET status='expired' WHERE id=?",(job['id'],));continue
                if not person['bot_can_message']:
                    person['delivery_error']='start_bot_required';person.pop('id')
                    c.execute('UPDATE users SET data=? WHERE id=?',(dump(person),job['user_id']))
                    c.execute("UPDATE outbox SET status='failed',error='start_bot_required' WHERE id=?",(job['id'],));continue
                c.execute("UPDATE outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=?",(stamp(now+timedelta(seconds=60)),job['id']))
            try:
                self.telegram.send(job['user_id'],self.text(job,person),person['language'])
            except TelegramAPIError as exc:
                with self.service.db.transaction() as c:
                    if exc.code in (400,403):
                        row=c.execute('SELECT data FROM users WHERE id=?',(job['user_id'],)).fetchone()
                        prefs=load(row['data']);prefs['bot_can_message']=False;prefs['delivery_error']='telegram_'+str(exc.code)
                        c.execute('UPDATE users SET data=? WHERE id=?',(dump(prefs),job['user_id']))
                    retry=exc.code not in (400,403) and job['attempts']<8
                    due=now+timedelta(seconds=max(exc.retry_after,min(3600,15*2**job['attempts'])))
                    c.execute('UPDATE outbox SET status=?,due=?,error=?,lease_until=NULL WHERE id=?',('pending' if retry else 'failed',stamp(due),'telegram_'+str(exc.code),job['id']))
            except Exception:
                log.exception('Outbox processing failed for job %s',job['id'])
            else:
                with self.service.db.transaction() as c:
                    c.execute("UPDATE outbox SET status='sent',lease_until=NULL,error=NULL WHERE id=? AND status='sending'",(job['id'],))
                    row=c.execute('SELECT data FROM users WHERE id=?',(job['user_id'],)).fetchone()
                    if row:
                        prefs=load(row['data']);prefs['delivery_error']=None
                        c.execute('UPDATE users SET data=? WHERE id=?',(dump(prefs),job['user_id']))

    def webhook(self,update):
        message=update.get('message',{}); actor=message.get('from')
        chat=message.get('chat',{})
        with self.service.db.transaction() as c:
            if c.execute('SELECT 1 FROM bot_updates WHERE id=?',(update['update_id'],)).fetchone():return
            c.execute('INSERT INTO bot_updates VALUES(?)',(update['update_id'],))
            if update.get('my_chat_member'):
                item=update['my_chat_member']
                if item.get('chat',{}).get('type')=='private':
                    row=c.execute('SELECT data FROM users WHERE id=?',(str(item['chat']['id']),)).fetchone()
                    if row:
                        prefs=load(row['data']);prefs['bot_can_message']=item['new_chat_member']['status']!='kicked'
                        c.execute('UPDATE users SET data=? WHERE id=?',(dump(prefs),str(item['chat']['id'])))
                return
            if not actor or chat.get('type')!='private' or actor.get('is_bot'):return
            user_id=self.service.ensure_user(c,actor);person=self.service.user(c,user_id)
            person.pop('id');person['bot_can_message']=True;person['delivery_error']=None
            c.execute('UPDATE users SET data=? WHERE id=?',(dump(person),user_id))
            command=message.get('text','').split(' ',1)[0]
            if command in ('/start','/help'):
                # Persist welcome before returning 200. A retried webhook cannot enqueue it twice.
                payload={'action':'welcome','title':'','data':{}}
                self.service.enqueue(c,None,user_id,'admin',payload,key='start:'+str(update['update_id']))
