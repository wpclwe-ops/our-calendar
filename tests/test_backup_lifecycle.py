from datetime import timedelta
from io import BytesIO
from zipfile import ZipFile,ZIP_DEFLATED
import pytest
from app.security import Problem
from app.recurrence import stamp,utcnow
from app.service import load

def test_signed_archive_tamper_and_wrong_pair(service,backup,event):
    blob=backup.export('1');assert backup.verify(blob)['events'][0]['id']==event['id']
    buf=BytesIO()
    with ZipFile(BytesIO(blob)) as source,ZipFile(buf,'w',ZIP_DEFLATED) as z:
        z.writestr('manifest.json',source.read('manifest.json'))
        z.writestr('calendar.json',source.read('calendar.json').replace(b'Together',b'Changed!'))
    with pytest.raises(Problem):backup.verify(buf.getvalue())
    service.create_calendar('3')
    with pytest.raises(Problem):backup.preview('3',blob)

def test_active_backup_selects_fields_and_missing(service,backup,event):
    blob=backup.export('1')
    service.save_event('1',{'title':'New','location':'Home'},event['id'],1)
    p=backup.preview('2',blob);assert set(p['changes'][0]['fields'])=={'title','location'}
    backup.apply('2',blob,[{'id':event['id'],'revision':2,'fields':['title']}],[],[])
    restored=service.get_event('1',event['id']);assert restored['title']=='Together' and restored['location']=='Home'
    service.delete_event('1',event['id'],3);service.delete_event('1',event['id'],4,permanent=True)
    assert len(backup.preview('2',blob)['missing'])==1
    backup.apply('2',blob,[],[],[])
    assert service.events('1','2026-10-01','2026-11-01')==[]
    backup.apply('2',blob,[],[event['id']],[])
    assert service.get_event('1',event['id'])['title']=='Together'

def test_full_delete_lock_cancel_and_expiration(service,backup,event):
    service.deletion('1','approve')
    assert service.get_event('2',event['id'])['id']==event['id']
    service.deletion('2','approve')
    for fn in [lambda:service.get_event('1',event['id']),lambda:backup.export('1'),lambda:service.settings('1',{'theme':'dark'}),lambda:service.categories('2')]:
        with pytest.raises(Problem) as error:fn()
        assert error.value.status==423
    service.deletion('1','cancel')
    assert service.get_event('1',event['id'])['id']==event['id']
    service.deletion('1','approve');service.deletion('2','approve')
    with service.db.transaction() as c:c.execute('UPDATE calendars SET delete_at=?',(stamp(utcnow()-timedelta(seconds=1)),))
    service.maintenance()
    assert service.state('1')['calendar'] is None
    with service.db.transaction() as c:assert c.execute('SELECT COUNT(*) FROM events').fetchone()[0]==0

def test_deleted_archive_two_consents_reminders_off(service,backup,event):
    blob=backup.export('1')
    with service.db.transaction() as c:c.execute('DELETE FROM calendars')
    with pytest.raises(Problem):backup.request_deleted('3',blob)
    r=backup.request_deleted('1',blob)
    assert service.state('2')['calendar'] is None
    assert service.state('2')['restores'][0]['id']==r['id']
    backup.approve_deleted('1',r['id'],True)
    assert service.state('1')['calendar'] is None
    backup.approve_deleted('2',r['id'],True)
    for person in ('1','2'):
        assert service.get_event(person,event['id'])['title']=='Together'
        assert service.state(person)['me']['reminders_enabled'] is False
    assert service.get_event('1',event['id'])['reminders']=={'1':[60],'2':[60]}

def test_key_survives_restart(service,backup,event):
    from app.backup import Backups
    blob=backup.export('1');new=Backups(service)
    assert new.verify(blob)['calendar']['id']==service.state('1')['calendar']['id']

def test_ics_roundtrip_with_timezone_exceptions_and_utf8(service,backup):
    from icalendar import Calendar
    event=service.save_event('1',{'title':'Событие, с запятой; и 🌸','start':'2026-10-20T12:00','end':'2026-10-20T13:00','rrule':'FREQ=WEEKLY;COUNT=3'})
    service.occurrence_change('1',event['id'],'2026-10-27T12:00',{'title':'Исключение'},1)
    blob=backup.ics('1')
    calendar=Calendar.from_ical(blob)
    assert calendar.walk('VTIMEZONE')
    instances=calendar.walk('VEVENT');assert len(instances)==2
    assert str(instances[0]['SUMMARY'])=='Событие, с запятой; и 🌸'
    assert instances[0]['DTSTART'].dt.hour==12
    assert instances[1].get('RECURRENCE-ID')
    assert b'BEGIN:VTIMEZONE' in blob
