"""Synthetic provider for browser acceptance; never used by the application."""
from dataclasses import replace
from cryptography.fernet import Fernet
import uvicorn
from app.config import Config
from app.main import create_app
from app.recurrence import stamp,utcnow
from datetime import timedelta
from test_google_import import FakeGoogle,FakeOAuth,remote

cfg=replace(Config.env(),google_client_id='synthetic-client',google_client_secret='synthetic-secret',google_credential_key=Fernet.generate_key().decode())
app=create_app(cfg,start_worker=False)
g=app.state.google;fake=FakeGoogle();g.provider=fake;g.oauth=FakeOAuth()
fake.items['series']=remote('series',summary='Weekly shared plan',recurrence=['RRULE:FREQ=WEEKLY;COUNT=5'])
fake.items['special']=remote('special',summary='Special recurrence',recurrence=['RRULE:FREQ=DAILY','EXDATE:20261025T150000Z'])
s=app.state.service
with s.db.transaction() as c:
    cal=s.calendar(c,'1')
    c.execute('INSERT INTO google_accounts(id,user_id,calendar_id,subject,email,credentials) VALUES(?,?,?,?,?,?)',
              ('account','1',cal['id'],'synthetic','test@example.com',g.vault.encrypt({'access_token':'synthetic','expires_at':stamp(utcnow()+timedelta(hours=1))})))
uvicorn.run(app,host='127.0.0.1',port=8001,access_log=False)
