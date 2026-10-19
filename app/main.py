import asyncio
import base64
from collections import defaultdict,deque
from contextlib import asynccontextmanager
import hmac
from pathlib import Path
import time
from fastapi import FastAPI,Request
from fastapi.responses import JSONResponse,Response,FileResponse,HTMLResponse
from fastapi.staticfiles import StaticFiles
from .config import Config
from .db import Database
from .security import Problem,require,telegram_user,session_token,session_user,is_allowed_user
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
    app=FastAPI(title='Our Calendar',version='0.10.5',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.service=service;app.state.backups=backups;app.state.worker=worker
    google=worker.google
    icloud=worker.icloud
    app.state.google=google
    app.state.icloud=icloud
    buckets=defaultdict(deque)
    @app.exception_handler(Problem)
    async def problem(request,exc):
        return JSONResponse({'error':exc.code,'detail':exc.detail},status_code=exc.status)
    from .providers.http import ProviderFailure
    @app.exception_handler(ProviderFailure)
    async def provider_problem(request,exc):
        prefix='icloud' if request.url.path.startswith('/api/icloud/') else 'google'
        if prefix=='icloud':
            from .providers.icloud import failure_code
            import logging
            logging.getLogger(__name__).warning('icloud api_failed status=%s',exc.code)
            return JSONResponse({'error':failure_code(exc)},status_code=503)
        code=prefix+('_reconnect' if exc.code in (400,401) else '_unavailable' if exc.code in (403,404) else '_delayed')
        return JSONResponse({'error':code},status_code=503)
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
        user_id=session_user(header[7:],config.session_secret or 'local-demo-secret')
        require(config.demo or is_allowed_user(user_id),'access_denied',403)
        return user_id
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
    def public_config():return {'demo':config.demo,'bot_username':config.bot_username,'version':'0.10.5',
                              'integrations':{'google':'import_only' if google.configured else 'not_configured','icloud':'import_only' if icloud.configured else 'not_configured','translation':'configured' if config.translation_url or config.openai_api_key else 'not_configured','smart_events':bool(config.openai_api_key)}}
    @app.get('/api/smart-events')
    def smart_status(request:Request):return worker.smart.status(actor(request))
    @app.post('/api/smart-events/preview')
    async def smart_preview(request:Request):
        data=await body(request)
        return worker.smart.preview(actor(request),data.get('offset',0))
    @app.post('/api/smart-events/batch')
    async def smart_batch(request:Request):
        data=await body(request)
        return worker.smart.batch(actor(request),data.get('preview_id'),data.get('ids'))
    @app.post('/api/events/{eid}/smart/reprocess')
    async def smart_request(request:Request,eid:str):
        data=await body(request)
        return worker.smart.request(actor(request),eid,data.get('occurrence',''),data.get('replace_fields',[]))
    @app.patch('/api/events/{eid}/smart')
    async def smart_edit(request:Request,eid:str):
        data=await body(request)
        require(set(data)<={'revision','occurrence','short_titles','category_action','remember','excluded','expected_suggestion'},'invalid_request')
        return worker.smart.edit(actor(request),eid,**data)
    @app.patch('/api/smart-events/rules/{rid}')
    async def smart_rule(request:Request,rid:str):
        data=await body(request)
        return worker.smart.rule(actor(request),rid,changes=data)
    @app.delete('/api/smart-events/rules/{rid}')
    def smart_delete_rule(request:Request,rid:str):return worker.smart.rule(actor(request),rid,delete=True)

    @app.get('/api/google')
    def google_status(request:Request):return google.status(actor(request))
    @app.post('/api/google/connect')
    def google_connect(request:Request):return google.start(actor(request))
    @app.post('/api/google/push')
    def google_push(request:Request):return google.pushed(request.headers)
    @app.get('/api/google/callback')
    def google_callback(state:str='',code:str='',error:str=''):
        from html import escape
        try:
            google.callback(state,code,error)
            message='Вернитесь в Our Calendar в Telegram и подтвердите выбранный аккаунт. / Return to Our Calendar in Telegram and confirm the selected account.'
        except (Problem,ProviderFailure) as exc:
            messages={
                'google_oauth_token_invalid_client':'Google отклонил данные приложения при обмене кода на токен. Проверьте Client Secret от того же OAuth-клиента в настройках сервера. / Google rejected the app credentials. Check the server Client Secret for the same OAuth client.',
                'google_oauth_token_invalid_grant':'Google отклонил одноразовый код входа. Начните новое подключение из Telegram. / Google rejected the one-time code. Start a new connection from Telegram.',
                'google_oauth_token_missing_scopes':'Google предоставил не все запрошенные разрешения. При новом входе разрешите чтение списка календарей и событий. / Google did not grant all requested permissions. Allow calendar list and event reading when connecting again.',
                'google_reconnect':'Google не выдал разрешение для фонового доступа. Начните новое подключение из Telegram. / Google did not issue offline access. Start a new connection from Telegram.',
                'google_selection_expired':'Эта попытка входа истекла или уже обработана. Вернитесь в приложение и нажмите «Проверить подключение»; если аккаунт не появился, начните новое подключение. / This attempt expired or was already processed. Return to the app and check the connection before starting again.',
                'google_authorization_cancelled':'Вход отменён или Google не вернул код авторизации. / Sign-in was cancelled or Google did not return an authorization code.',
                'google_identity_invalid':'Google не подтвердил адрес аккаунта. / Google did not verify the account email.',
                'google_oauth_identity_unavailable':'Не удалось получить сведения об аккаунте Google. / Could not retrieve the Google account identity.',
                'google_oauth_token_unavailable':'Не удалось обменять код Google на токен доступа. / Could not exchange the Google code for an access token.',
                'google_oauth_token_invalid_scope':'Google отклонил запрошенные разрешения приложения. / Google rejected the requested app permissions.',
                'google_oauth_token_unauthorized_client':'Google не разрешает этому OAuth-клиенту данный способ входа. / Google does not allow this sign-in method for the OAuth client.',
                'google_oauth_token_invalid_request':'Google отклонил запрос обмена кода на токен. / Google rejected the token exchange request.',
            }
            diagnostic=exc.code if isinstance(exc,Problem) and exc.code in messages else 'google_callback_failed'
            import logging
            logging.getLogger(__name__).warning('Google OAuth callback failed: %s',diagnostic)
            message=messages.get(diagnostic,'Подключение не завершено. / Connection was not completed.')+' Код / Code: '+diagnostic
        link='https://t.me/'+config.bot_username+'?startapp=google'
        return HTMLResponse('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Our Calendar · Google</title><link rel="stylesheet" href="/assets/style.css"><main class="shell"><section class="card"><h1>Our Calendar · Google</h1><p>'+message+'</p><a href="'+escape(link,quote=True)+'">Открыть Telegram / Open Telegram</a></section></main></html>')
    @app.post('/api/google/confirm')
    async def google_confirm(request:Request):
        return google.confirm_account(actor(request),(await body(request)).get('approved') is True)
    @app.delete('/api/google/accounts/{account_id}')
    def google_disconnect(request:Request,account_id:str):return google.disconnect(actor(request),account_id)
    @app.get('/api/google/accounts/{account_id}/calendars')
    def google_calendars(request:Request,account_id:str):return google.calendars(actor(request),account_id)
    @app.post('/api/google/accounts/{account_id}/calendars')
    async def google_select_calendars(request:Request,account_id:str):
        data=await body(request)
        return google.select(actor(request),account_id,data.get('ids'),data.get('auto_ids'))
    @app.get('/api/google/sources/{source_id}/events')
    def google_browse(request:Request,source_id:str,page:str|None=None,parent:str|None=None,start:str|None=None,end:str|None=None):
        return google.browse(actor(request),source_id,page,parent,start,end)
    @app.post('/api/google/sources/{source_id}/preview')
    async def google_preview(request:Request,source_id:str):
        user=actor(request);data=await body(request)
        return await asyncio.to_thread(google.preview,user,source_id,data.get('selections'))
    @app.post('/api/google/import')
    async def google_apply(request:Request):
        user=actor(request);data=await body(request)
        return await asyncio.to_thread(google.apply,user,data.get('preview_id'),data.get('confirmed'))
    @app.post('/api/google/sources/{source_id}/sync')
    async def google_sync(request:Request,source_id:str):
        return await asyncio.to_thread(google.sync_source,actor(request),source_id,True)
    @app.get('/api/google/links/{link_id}')
    def google_conflict(request:Request,link_id:str):return google.conflict(actor(request),link_id)
    @app.post('/api/google/links/{link_id}/resolve')
    async def google_resolve(request:Request,link_id:str):
        user=actor(request);data=await body(request)
        return await asyncio.to_thread(google.resolve,user,link_id,data.get('choice'),data.get('revision'),data.get('remote_version'))
    @app.get('/api/icloud')
    def icloud_status(request:Request):return icloud.status(actor(request))
    @app.post('/api/icloud/connect')
    async def icloud_connect(request:Request):
        data=await body(request)
        return await asyncio.to_thread(icloud.connect,actor(request),data.get('email'),data.get('password'))
    @app.delete('/api/icloud/accounts/{account_id}')
    def icloud_disconnect(request:Request,account_id:str):return icloud.disconnect(actor(request),account_id)
    @app.get('/api/icloud/accounts/{account_id}/calendars')
    async def icloud_calendars(request:Request,account_id:str):
        return await asyncio.to_thread(icloud.calendars,actor(request),account_id)
    @app.post('/api/icloud/accounts/{account_id}/calendars')
    async def icloud_select(request:Request,account_id:str):
        data=await body(request)
        return icloud.select(actor(request),account_id,data.get('ids'),data.get('auto_ids'))
    @app.get('/api/icloud/sources/{source_id}/events')
    async def icloud_browse(request:Request,source_id:str):
        return await asyncio.to_thread(icloud.browse,actor(request),source_id)
    @app.post('/api/icloud/sources/{source_id}/import')
    async def icloud_import(request:Request,source_id:str):
        data=await body(request)
        return await asyncio.to_thread(icloud.import_selected,actor(request),source_id,
                                       data.get('ids'),data.get('confirmed'))
    @app.post('/api/icloud/sources/{source_id}/sync')
    async def icloud_sync(request:Request,source_id:str):
        return await asyncio.to_thread(icloud.sync_source,actor(request),source_id,True)
    @app.get('/api/icloud/links/{link_id}')
    def icloud_conflict(request:Request,link_id:str):
        return icloud.conflict(actor(request),link_id)
    @app.post('/api/icloud/links/{link_id}/resolve')
    async def icloud_resolve(request:Request,link_id:str):
        data=await body(request)
        return await asyncio.to_thread(icloud.resolve,actor(request),link_id,
                                       data.get('choice'),data.get('revision'),
                                       data.get('remote_version'))
    @app.post('/api/auth')
    async def auth(request:Request):
        data=await body(request)
        if config.demo and data.get('demo_user') in ('1','2','3'):
            telegram={'id':int(data['demo_user']),'first_name':{'1':'Alex','2':'Partner','3':'Third user'}[data['demo_user']],'language_code':'ru' if data['demo_user']=='1' else 'en'}
        else:
            try:telegram=telegram_user(data.get('init_data',''),config.bot_token,config.auth_max_age)
            except (ValueError,TypeError):raise Problem(401,'invalid_init_data')
        require(config.demo or is_allowed_user(telegram['id']),'access_denied',403)
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
    @app.patch('/api/calendar/profile')
    async def pair_profile(request:Request):
        data=await body(request)
        require(set(data)=={'changes','revision'},'invalid_pair_profile')
        return service.pair_profile(actor(request),data['changes'],data['revision'])
    @app.delete('/api/smart-events/rules')
    def smart_clear_rules(request:Request):return worker.smart.clear_rules(actor(request))
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
        return backups.apply(actor(request),archive(data),data.get('selections',[]),data.get('missing_ids',[]),data.get('category_ids',[]),preview_id=data.get('preview_id'),override_selections=data.get('override_selections',[]),profile_fields=data.get('profile_fields',[]),smart_rule_ids=data.get('smart_rule_ids',[]),pair_profile_fields=data.get('pair_profile_fields',[]))
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


