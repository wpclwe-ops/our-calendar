from dataclasses import replace
import pytest
from app.translation import Translations
from app.security import Problem
from app.service import load
from app.config import valid_translation_url

class FakeTranslator:
    def __init__(self):self.calls=[];self.during=None
    def translate(self,texts,target):
        self.calls.append((list(texts),target))
        if self.during:
            action=self.during;self.during=None;action()
        return [target+': '+v for v in texts]

def configured(service):
    service.config=replace(service.config,translation_url='https://translate.example')
    fake=FakeTranslator();return Translations(service,fake),fake

def test_auto_translation_and_recipient_notification(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Планы','description':'Наш вечер','start':'2026-10-24T12:00','end':'2026-10-24T13:00'})
    translator.process()
    result=service.get_event('2',event['id'])
    assert result['translations']['en']['title']=='en: Планы'
    assert result['translations']['en']['manual'] is False
    assert result['translation_status']['state']=='ready'
    with service.db.transaction() as c:
        notice=c.execute('SELECT payload FROM outbox WHERE event_id=?',(event['id'],)).fetchone()
        assert load(notice['payload'])['data']['translations']['en']['title']=='en: Планы'


def test_manual_versions_survive_auto_and_explicit_retranslate(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Original','start':'2026-10-24T12:00','end':'2026-10-24T13:00','translations':{'en':{'title':'Hand-written','description':'Personal','manual':True}}})
    translator.process();result=service.get_event('1',event['id'])
    assert result['translations']['en']['title']=='Hand-written'
    translator.request('2',event['id']);translator.process()
    assert service.get_event('1',event['id'])['translations']['en']['title']=='Hand-written'
    translator.request('2',event['id'],overwrite_manual=True);translator.process()
    assert service.get_event('1',event['id'])['translations']['en']['title']=='en: Original'


def test_translation_does_not_overwrite_concurrent_manual_edit(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Original','start':'2026-10-24T12:00','end':'2026-10-24T13:00'})
    fake.during=lambda:service.save_event('2',{'translations':{'en':{'title':'Concurrent','manual':True}}},event['id'],1)
    translator.process();translator.process()
    assert service.get_event('1',event['id'])['translations']['en']['title']=='Concurrent'


def test_category_auto_translation_preserves_manual_language(service):
    translator,fake=configured(service)
    category=service.save_category('1',{'name':'Категория','color':'#9B77D1','translations':{'en':'Manual category'}})
    translator.process()
    result=service.categories('2')[0]
    assert result['translations']['ru']=='ru: Категория'
    assert result['translations']['en']=='Manual category'


def test_translation_unconfigured_and_left_user_denied(service,event):
    with pytest.raises(Problem):Translations(service).request('1',event['id'])
    translator,fake=configured(service);service.membership('2')
    with pytest.raises(Problem):translator.request('2',event['id'])


def test_translation_paused_during_calendar_deletion(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Private','start':'2026-10-24T12:00','end':'2026-10-24T13:00'})
    service.deletion('1','approve');service.deletion('2','approve');translator.process()
    assert fake.calls==[]

def test_selected_instance_uses_latest_translations(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Original','start':'2026-10-20T12:00','end':'2026-10-20T13:00','rrule':'FREQ=DAILY;COUNT=3'})
    translator.process()
    result=service.get_event('2',event['id'],occurrence='2026-10-21T12:00')
    assert result['selected_instance']['translations']['en']['title']=='en: Original'
    assert result['selected_instance']['start']=='2026-10-21T12:00'

def test_provider_failure_keeps_original_and_records_retry(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Keep me','start':'2026-10-24T12:00','end':'2026-10-24T13:00'})
    def fail(*args):raise Problem(502,'translation_unavailable')
    fake.translate=fail;translator.process()
    result=service.get_event('1',event['id'])
    assert result['title']=='Keep me' and result['translations']=={}
    assert result['translation_status']=={'state':'pending','error':'translation_unavailable'}

def test_existing_events_and_categories_are_backfilled_when_enabled(service):
    event=service.save_event('1',{'title':'Старое событие','start':'2026-10-24T12:00','end':'2026-10-24T13:00',
        'translations':{'ru':{'title':'Ручное название','manual':True}}})
    category=service.save_category('1',{'name':'Дом','color':'#9B77D1'})
    translator,fake=configured(service)
    translator.process(limit=5)
    result=service.get_event('2',event['id'])
    assert result['translations']['en']['title']=='en: Старое событие'
    assert result['translations']['ru']['title']=='Ручное название'
    assert service.categories('2')[0]['translations']['en']=='en: Дом'
    calls=len(fake.calls);translator.process(limit=5)
    assert len(fake.calls)==calls

def test_terminal_failure_requires_explicit_retry(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Recover','start':'2026-10-24T12:00','end':'2026-10-24T13:00'})
    translate=fake.translate
    def fail(*args):raise Problem(502,'translation_unavailable')
    fake.translate=fail
    for _ in range(4):
        with service.db.transaction() as c:c.execute("UPDATE translation_jobs SET next_at='2000-01-01T00:00:00Z'")
        translator.process()
    assert service.get_event('2',event['id'])['translation_status']['state']=='failed'
    fake.translate=translate
    with service.db.transaction() as c:c.execute("UPDATE translation_jobs SET next_at='2000-01-01T00:00:00Z'")
    translator.process()
    assert service.get_event('2',event['id'])['translation_status']['state']=='failed'
    assert not service.get_event('2',event['id'])['translations']
    translator.request('1',event['id']);translator.process()
    assert service.get_event('2',event['id'])['translations']['en']['title']=='en: Recover'

@pytest.mark.parametrize('url,valid',[
    ('https://translator.example',True),('http://calendar-translate.railway.internal:5000',True),
    ('http://public.example',False),('http://railway.internal.evil.example',False),
    ('https://user:secret@example.com',False),('http://localhost',False)])
def test_translation_network_config(url,valid):
    assert valid_translation_url(url) is valid

def test_translation_probe_uses_synthetic_data_and_is_cached(service):
    translator,fake=configured(service)
    translator.probe();translator.probe()
    assert fake.calls==[(['Купить молоко'],'en'),(['Buy milk'],'ru')]
    with service.db.transaction() as c:
        assert load(c.execute("SELECT value FROM runtime WHERE key='translation_probe'").fetchone()['value'])['state']=='ready'


def test_changed_occurrence_gets_its_own_translation_without_reusing_master(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Original','start':'2026-10-20T12:00','end':'2026-10-20T13:00','rrule':'FREQ=DAILY;COUNT=3'})
    translator.process();e=service.get_event('1',event['id']);key='2026-10-21T12:00'
    service.occurrence_change('1',event['id'],key,{'title':'Особая встреча'},e['revision'])
    pending=service.get_event('2',event['id'],occurrence=key)
    assert pending['selected_instance']['translations']=={}
    translator.process()
    result=service.get_event('2',event['id'],occurrence=key)
    assert result['selected_instance']['translations']['en']['title']=='en: Особая встреча'
    assert result['translations']['en']['title']=='en: Original'


def test_empty_category_translation_fields_do_not_block_auto_translation(service):
    translator,fake=configured(service)
    service.save_category('1',{'name':'Дом','color':'#9B77D1','translations':{'ru':'','en':''}})
    translator.process()
    assert service.categories('2')[0]['translations']['en']=='en: Дом'


def test_manual_exception_translation_is_preserved_and_marked_stale(service):
    translator,fake=configured(service)
    event=service.save_event('1',{'title':'Original','description':'Description','start':'2026-10-20T12:00','end':'2026-10-20T13:00','rrule':'FREQ=DAILY;COUNT=3'})
    key='2026-10-21T12:00'
    service.occurrence_change('1',event['id'],key,{'description':'Other','translations':{'en':{'title':'Handmade','manual':True}}},1)
    translator.process();e=service.get_event('1',event['id'])
    service.save_event('1',{'title':'New original'},event['id'],e['revision'])
    translator.process();selected=service.get_event('2',event['id'],occurrence=key)['selected_instance']
    assert selected['translations']['en']['title']=='Handmade' and selected['translations']['en']['stale']

def test_background_translation_does_not_invalidate_open_form(service):
    translator,fake=configured(service)
    e=service.save_event('1',{'title':'Flight · Wrocław → Amsterdam','start':'2026-10-24T12:00','end':'2026-10-24T14:00'})
    translator.process()
    updated=service.save_event('1',{'location':'Airport'},e['id'],e['revision'])
    assert updated['translations']['en']['title']=='en: Flight · Wrocław → Amsterdam'
    with pytest.raises(Problem) as exc:
        service.save_event('2',{'location':'Stale location'},e['id'],e['revision'])
    assert exc.value.code=='revision_conflict'
