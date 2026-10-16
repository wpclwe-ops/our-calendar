"""Closed deployment screen. No calendar/authentication API exists in this mode."""
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import HTMLResponse,JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT=Path(__file__).resolve().parent.parent

def missing_configuration():
    missing=[]
    for name in ('BOT_TOKEN','BOT_USERNAME'):
        if not os.getenv(name,'').strip():missing.append(name)
    for name in ('SESSION_SECRET','WEBHOOK_SECRET'):
        if len(os.getenv(name,''))<32:missing.append(name)
    if not os.getenv('PUBLIC_URL','').startswith('https://'):missing.append('PUBLIC_URL')
    return missing

def create_setup_app():
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    @app.middleware('http')
    async def security(request,call_next):
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['Strict-Transport-Security']='max-age=31536000'
        response.headers['Content-Security-Policy']="default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'none'"
        return response
    @app.get('/health')
    def health():return {'ok':True,'ready':False,'mode':'setup','missing':missing_configuration()}
    @app.get('/api/config')
    def config():return {'demo':False,'setup_required':True,'version':'0.3.2'}
    @app.post('/api/auth')
    @app.post('/api/telegram/webhook')
    def closed():return JSONResponse({'error':'telegram_not_configured'},status_code=503)
    @app.get('/')
    def home():return HTMLResponse('''<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>Our Calendar</title>
      <link rel="stylesheet" href="/assets/style.css"><link rel="icon" href="/assets/icon.svg"></head>
      <body><main class="shell"><div class="splash"><div class="brand-mark">oc</div><h1>Our Calendar</h1>
      <div class="card"><h2>Сервер готов к настройке</h2><p>Telegram-бот ещё не подключён. Вход в календарь закрыт.</p>
      <p class="muted">Владелец настраивает бота в переменных Railway. На этой странице не нужно вводить пароли или токены.</p>
      <p class="privacy">The server is ready for setup. Telegram login is not available yet.</p></div></div></main></body></html>''')
    app.mount('/assets',StaticFiles(directory=ROOT/'web'),name='assets')
    return app
