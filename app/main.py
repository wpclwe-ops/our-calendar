import asyncio
import base64
from collections import defaultdict,deque
from contextlib import asynccontextmanager
import hmac
from pathlib import Path
import time
from fastapi import FastAPI,Request
from fastapi.responses import JSONResponse,Response,FileResponse
from fastapi.staticfiles import StaticFiles
from .config import Config
from .db import Database
from .security import Problem,require,telegram_user,session_token,session_user
from .service import Service,load
from .backup import Backups,MAX_ARCHIVE
from .bot import Worker

ROOT=Path(__file__).resolve().parent.parent

def create_app(config=None,start_worker=True):
    config=config or Config.env()
    service=Service(Database(config.database),config)
    backups=Backups(service);worker=Worker(service)
    @asynccontextmanager
    async def lifespan(app):
        if start_worker:worker.start()
        yield
        worker.stop()
    app=FastAPI(title='Our Calendar',version='0.5.0',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.service=service;app.state.backups=backups;app.state.worker=worker
    buckets=defaultdict(deque)
    @app.exception_handler(Problem)
    async def problem(request,exc):
        return JSONResponse({'error':exc.code,'detail':exc.detail},status_code=exc.status)
    @app.exception_handler(KeyError)
    @app.exception_handler(TypeError)
    @app.exception_handler(ValueError)
    async def invalid(request,exc):return JSONResponse({'error':'invalid_request'},status_code=400)
    @app.middleware('http')
    async def controls(request,call_next):
        # Origin is checked in addition to bearer authentication; no permissive CORS.
        origin=request.headers.get('origin')
        if origin and not config.demo and origin!=config.public_url:
            return JSONResponse({'error':'invalid_origin'},status_code=403)
        length=request.headers.get('content-length','0')
        if not length.isdigit() or int(length)>MAX_ARCHIVE*2:
            return JSONResponse({'error':'request_too_large'},status_code=413)
        if request.url.path.startswith('/api/'):
            key=(request.client.host if request.client else '',request.url.path)
            now=time.monotonic();bucket=buckets[key]
            while bucket and bucket[0]<now-60:bucket.popleft()
            if len(bucket)>=120:return JSONResponse({'error':'rate_limited'},status_code=429)
            bucket.append(now)
            if len(buckets)>10000:
                for old in list(buckets):
                    if not buckets[old] or buckets[old][-1]<now-60:buckets.pop(old,None)
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['Cache-Control']='no-store'
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'self'"
        if not config.demo:response.headers['Strict-Transport-Security']='max-age=31536000'
        return response
    def actor(request):
        header=request.headers.get('authorization','')
        require(header.startswith('Bearer '),'unauthorized',401)
        return session_user(header[7:],config.session_secret or 'local-demo-secret')
    async def body(request):
        chunks=[];size=0
        async for chunk in request.stream():
            size+=len(chunk);require(size<=MAX_ARCHIVE*2,'request_too_large',413);chunks.append(chunk)
        data=b''.join(chunks)
        import json
        result=json.loads(data);require(isinstance(result,dict),'invalid_request')
        return result
    def archive(data):
        try:return base64.b64decode(data['archive'],validate=True)
        except Exception:raise Problem(400,'invalid_archive')

    @app.get('/health')
    def health():
        from .health import health_status
        result=health_status(service)
        return JSONResponse(result,status_code=200 if result['ready'] else 503)
    @app.get('/api/system-status')
    def system_status(request:Request):
        from .health import health_status
        with service.db.transaction() as c:service.calendar(c,actor(request))
        result=health_status(service)
        return {k:result[k] for k in ('ready','degraded','translation','backup')}
    @app.get('/api/config')
    def public_config():return {'demo':config.demo,'bot_username':config.bot_username,'version':'0.5.0',
                              'integrations':{'google':'not_configured','icloud':'pilot_required','translation':'configured' if config.translation_url else 'not_configured'}}
    @app.post('/api/auth')
    async def auth(request:Request):
        data=await body(request)
        if config.demo and data.get('demo_user') in ('1','2','3'):
            telegram={'id':int(data['demo_user']),'first_name':{'1':'Alex','2':'Partner','3':'Third user'}[data['demo_user']],'language_code':'ru' if data['demo_user']=='1' else 'en'}
        else:
            try:telegram=telegram_user(data.get('init_data',''),config.bot_token,config.auth_max_age)
            except (ValueError,TypeError):raise Problem(401,'invalid_init_data')
        with service.db.transaction() as c:user_id=service.ensure_user(c,telegram)
        return {'token':session_token(user_id,config.session_secret or 'local-demo-secret',config.session_ttl),'state':service.state(user_id)}
    @app.get('/api/state')
    def state(request:Request):return service.state(actor(request))
    @app.post('/api/calendar')
    def create(request:Request):return service.create_calendar(actor(request))
    @app.post('/api/invite')
    def invite(request:Request):return service.invite(actor(request))
    @app.post('/api/join')
    async def join(request:Request):return service.join(actor(request),(await body(request))['token'])
    @app.post('/api/membership')
    async def membership(request:Request):return service.membership(actor(request),returning=(await body(request)).get('returning') is True)
    @app.patch('/api/settings')
    async def settings(request:Request):return service.settings(actor(request),await body(request))
    @app.post('/api/calendar/deletion')
    async def deletion(request:Request):return service.deletion(actor(request),(await body(request))['action'])
    @app.get('/api/categories')
    def categories(request:Request):return service.categories(actor(request))
    @app.post('/api/categories')
    async def new_category(request:Request):return service.save_category(actor(request),await body(request))
    @app.patch('/api/categories/{cid}')
    async def category(request:Request,cid:str):return service.save_category(actor(request),await body(request),cid)
    @app.delete('/api/categories/{cid}')
    def delete_category(request:Request,cid:str):return service.save_category(actor(request),{},cid,delete=True)
    @app.get('/api/events')
    def events(request:Request,start:str='',end:str='',q:str='',owner:str='',category:str='',status:str='',trash:bool=False):
        return service.events(actor(request),start,end,q,owner,category,status,trash)
    @app.get('/api/events/{eid}/instances')
    def event_instances(request:Request,eid:str,start:str,end:str):
        return service.events(actor(request),start,end,event_id=eid)
    @app.get('/api/events/{eid}')
    def event(request:Request,eid:str,trash:bool=False,occurrence:str=''):return service.get_event(actor(request),eid,trash,occurrence or None)
    @app.post('/api/events')
    async def new_event(request:Request):return service.save_event(actor(request),await body(request))
    @app.patch('/api/events/{eid}')
    async def edit_event(request:Request,eid:str):
        data=await body(request);revision=data.pop('revision',None)
        return service.save_event(actor(request),data,eid,revision)
    @app.post('/api/events/{eid}/translate')
    async def translate_event(request:Request,eid:str):
        data=await body(request)
        return worker.translations.request(actor(request),eid,overwrite_manual=data.get('overwrite_manual') is True)
    @app.post('/api/categories/{cid}/translate')
    async def translate_category(request:Request,cid:str):
        data=await body(request)
        return worker.translations.request(actor(request),cid,kind='category',overwrite_manual=data.get('overwrite_manual') is True)
    @app.post('/api/events/{eid}/occurrence')
    async def occurrence(request:Request,eid:str):
        data=await body(request)
        return service.occurrence_change(actor(request),eid,data['occurrence'],data.get('changes',{}),data['revision'],data.get('scope','one'),data.get('delete',False))
    @app.delete('/api/events/{eid}')
    async def remove(request:Request,eid:str):
        data=await body(request);require(data.get('confirmed') is True,'confirmation_required')
        return service.delete_event(actor(request),eid,data.get('revision'),permanent=data.get('permanent') is True)
    @app.post('/api/events/{eid}/restore')
    async def restore_event(request:Request,eid:str):return service.delete_event(actor(request),eid,(await body(request)).get('revision'),restore=True)
    @app.post('/api/events/{eid}/trash-occurrence')
    async def trash_occurrence(request:Request,eid:str):
        data=await body(request)
        if data.get('permanent'):require(data.get('confirmed') is True,'confirmation_required')
        return service.trash_occurrence(actor(request),eid,data['occurrence'],data['revision'],data.get('permanent') is True)
    @app.get('/api/backup.zip')
    def backup(request:Request):return Response(backups.export(actor(request)),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="our-calendar.zip"'})
    @app.get('/api/calendar.ics')
    def ics(request:Request):return Response(backups.ics(actor(request)),media_type='text/calendar; charset=utf-8',headers={'Content-Disposition':'attachment; filename="our-calendar.ics"'})
    @app.post('/api/backup/preview')
    async def preview(request:Request):return backups.preview(actor(request),archive(await body(request)))
    @app.post('/api/backup/apply')
    async def apply(request:Request):
        data=await body(request);require(data.get('previewed') is True,'preview_required')
        return backups.apply(actor(request),archive(data),data.get('selections',[]),data.get('missing_ids',[]),data.get('category_ids',[]),preview_id=data.get('preview_id'),override_selections=data.get('override_selections',[]),profile_fields=data.get('profile_fields',[]))
    @app.post('/api/backup/restore-deleted')
    async def restore_deleted(request:Request):return backups.request_deleted(actor(request),archive(await body(request)))
    @app.post('/api/backup/restore-deleted/{rid}')
    async def approve_restore(request:Request,rid:str):return backups.approve_deleted(actor(request),rid,(await body(request)).get('approve') is True)
    @app.post('/api/telegram/webhook')
    async def webhook(request:Request):
        require(bool(config.webhook_secret) and hmac.compare_digest(request.headers.get('X-Telegram-Bot-Api-Secret-Token',''),config.webhook_secret),'invalid_webhook_secret',403)
        worker.webhook(await body(request));return {'ok':True}
    app.mount('/assets',StaticFiles(directory=ROOT/'web'),name='assets')
    @app.get('/')
    def home():return FileResponse(ROOT/'web'/'index.html')
    return app
