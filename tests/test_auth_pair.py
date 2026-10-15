from concurrent.futures import ThreadPoolExecutor
import hashlib,hmac,json,time
from urllib.parse import urlencode
import pytest
from app.security import telegram_user,session_token,session_user,Problem
from app.service import Service
from app.db import Database

def signed(data,token):
    secret=hmac.new(b'WebAppData',token.encode(),hashlib.sha256).digest()
    data=dict(data)
    data['hash']=hmac.new(secret,'\n'.join(f'{k}={v}' for k,v in sorted(data.items())).encode(),hashlib.sha256).hexdigest()
    return urlencode(data)

def test_telegram_signature_and_age():
    data={'auth_date':'1000','user':json.dumps({'id':123}),'query_id':'x'}
    assert telegram_user(signed(data,'token'),'token',now=1001)['id']==123
    for raw in [signed(data,'other'),signed(data,'token')+'&auth_date=1000',signed(data,'token').replace('auth_date=1000','auth_date=1001')]:
        with pytest.raises(Problem):telegram_user(raw,'token',now=1001)
    with pytest.raises(Problem):telegram_user(signed(data,'token'),'token',now=9000)

def test_session_tamper():
    token=session_token('123','secret')
    assert session_user(token,'secret')=='123'
    with pytest.raises(Problem):session_user(token+'a','secret')

def test_invite_race_and_preview(service,tmp_path):
    other=Service(Database(str(tmp_path/'race.db')),service.config)
    with other.db.transaction() as c:
        for i in (1,2,3):other.ensure_user(c,{'id':i})
    other.create_calendar('1');token=other.invite('1')['token']
    def accept(person):
        try:other.join(person,token);return True
        except Problem:return False
    with ThreadPoolExecutor(2) as executor:result=list(executor.map(accept,['2','3']))
    assert sum(result)==1
    with other.db.transaction() as c:
        assert c.execute('SELECT COUNT(*) FROM members').fetchone()[0]==2
        assert c.execute('SELECT COUNT(*) FROM invites').fetchone()[0]==0

def test_cannot_replace_departed_member(service,event):
    service.membership('2')
    with pytest.raises(Problem):service.events('2','2026-10-01','2026-11-01')
    with pytest.raises(Problem):service.invite('1')
    with pytest.raises(Problem):service.get_event('3',event['id'])
    service.membership('2',returning=True)
    assert service.get_event('2',event['id'])['title']=='Together'

def test_old_invite_revoked(service,tmp_path):
    with service.db.transaction() as c:
        c.execute('DELETE FROM members WHERE user_id=?',('2',));c.execute('UPDATE calendars SET second_id=NULL')
    a=service.invite('1')['token'];b=service.invite('1')['token']
    with pytest.raises(Problem):service.join('3',a)
    service.join('3',b)
