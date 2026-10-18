from copy import deepcopy
from dataclasses import replace
import json
import pytest
from app.smart_events import SmartEvents, enqueue, metadata
from app.service import load, dump
from app.security import Problem
from app.google_import import GoogleImports
from app.translation import Translations

class FakeAI:
    def __init__(self):self.calls=[];self.during=None;self.fail=None;self.category=None;self.confidence=0.99
    def process(self,payload):
        self.calls.append(deepcopy(payload))
        if self.during:action=self.during;self.during=None;action()
        if self.fail:raise Problem(503,self.fail)
        return {'languages':['pl','en'], 'translations':{l:{'title':l+': '+payload['title'],'description':l+': '+payload['description'] if payload['description'] else ''} for l in ('ru','en')},
                'short_titles':{'ru':'Уход за волосами','en':'Hair treatment'},'short_confidence':{'ru':self.confidence,'en':self.confidence},
                'category_id':self.category,'category_confidence':self.confidence,'ambiguous':False}, {'input_tokens':100,'output_tokens':100}

def configured(service):
    service.config=replace(service.config,openai_api_key='test-not-real',smart_auto_categories=True)
    for actor in ('1','2'):service.settings(actor,{'smart_events':{'consent':True,'include_internal':True}})
    fake=FakeAI();return SmartEvents(service,fake),fake

def create(service,**values):
    return service.save_event('1',{'title':'Corner Salon: Tonowanie','description':'','start':'2026-10-24T12:00','end':'2026-10-24T13:00',**values})

def force_due(service):
    with service.db.transaction() as c:c.execute("UPDATE smart_jobs SET next_at='2000-01-01T00:00:00+00:00'")

def test_no_call_without_key_or_both_internal_consents(service):
    smart,fake=configured(service)
    service.settings('2',{'smart_events':{'consent':False}})
    e=create(service);smart.process()
    assert fake.calls==[]
    with pytest.raises(Problem):smart.request('1',e['id'])

def test_full_pipeline_protects_original_and_schedule(service):
    smart,fake=configured(service);e=create(service);smart.process()
    data=service.get_event('1',e['id'])
    assert data['title']==e['title'] and data['description']==''
    assert data['translations']['en']['title'].startswith('en: Corner')
    assert data['smart']['short_titles']['ru']=='Уход за волосами'
    assert data['schedule_version']==e['schedule_version']
    assert '1' not in fake.calls[0].values() and 'owner_A'==fake.calls[0]['owner']
    before=len(fake.calls)
    service.save_event('1',{'start':'2026-10-24T14:00','end':'2026-10-24T15:00'},e['id'],data['revision'])
    smart.process();assert len(fake.calls)==before

def test_manual_field_survives_other_field_translation(service):
    smart,fake=configured(service)
    e=create(service,description='Polski opis',translations={'en':{'title':'My title','description':'','manual':True}})
    smart.process();data=service.get_event('1',e['id'])
    assert data['translations']['en']['title']=='My title'
    assert data['translations']['en']['description']=='en: Polski opis'

def test_concurrent_manual_edit_or_consent_revoke_wins(service):
    smart,fake=configured(service);e=create(service)
    fake.during=lambda:service.save_event('2',{'translations':{'en':{'title':'Concurrent'}}},e['id'],e['revision'])
    smart.process();smart.process()
    assert service.get_event('1',e['id'])['translations']['en']['title']=='Concurrent'
    smart.request('1',e['id'])
    fake.during=lambda:service.settings('1',{'smart_events':{'consent':False}})
    smart.process()
    assert service.get_event('1',e['id'])['translations']['en']['title']=='Concurrent'

def test_category_suggestion_accept_and_manual_null_lock(service):
    smart,fake=configured(service)
    category=service.save_category('1',{'name':'Other plans','color':'#9B77D1'})
    fake.category=category['id'];e=create(service);smart.process()
    data=service.get_event('1',e['id'])
    assert data['category_id'] is None and data['smart']['category']['suggestion']==category['id']
    smart.edit('2',e['id'],data['revision'],category_action='accept',remember=True)
    data=service.get_event('1',e['id']);assert data['category_id']==category['id']
    data=service.save_event('1',{'category_id':None},e['id'],data['revision']);smart.process()
    assert service.get_event('1',e['id'])['category_id'] is None
    assert service.get_event('1',e['id'])['smart']['category']['manual']

def test_auto_category_requires_both_modes(service):
    smart,fake=configured(service)
    category=service.save_category('1',{'name':'Beauty','color':'#9B77D1'});fake.category=category['id']
    service.settings('1',{'smart_events':{'mode':'auto'}})
    e=create(service);smart.process();assert service.get_event('1',e['id'])['category_id'] is None
    service.settings('2',{'smart_events':{'mode':'auto'}})
    smart.request('1',e['id']);smart.process()
    assert service.get_event('1',e['id'])['category_id']==category['id']

def test_failures_bounded_and_budget_never_calls(service):
    smart,fake=configured(service);e=create(service);fake.fail='smart_unavailable'
    for _ in range(5):force_due(service);smart.process()
    assert len(fake.calls)==3
    with service.db.transaction() as c:assert c.execute('SELECT state FROM smart_jobs').fetchone()[0]=='failed'
    service.config=replace(service.config,smart_monthly_budget=0)
    smart=SmartEvents(service,fake);smart.request('1',e['id']);smart.process()
    assert len(fake.calls)==3
    with service.db.transaction() as c:assert c.execute('SELECT state FROM smart_jobs').fetchone()[0]=='budget_paused'

def test_unknown_category_and_manual_metadata_injection_rejected(service):
    smart,fake=configured(service);fake.category='foreign-id';e=create(service);smart.process()
    data=service.get_event('1',e['id']);assert not data['translations']
    with pytest.raises(Problem):service.save_event('1',{'smart':{'category':{'manual':False}}},e['id'],data['revision'])
    with pytest.raises(Problem):smart.edit('3',e['id'],data['revision'],short_titles={'ru':'Injected'})

def test_low_short_confidence_and_explicit_short_replacement(service):
    smart,fake=configured(service);fake.confidence=0.1;e=create(service);smart.process()
    data=service.get_event('1',e['id']);assert data['smart']['short_titles']['ru']==''
    smart.edit('1',e['id'],data['revision'],short_titles={'ru':'Моё название'})
    smart.request('1',e['id']);smart.process()
    assert service.get_event('1',e['id'])['smart']['short_titles']['ru']=='Моё название'
    fake.confidence=1;smart.request('1',e['id'],replace_fields=['ru.short_title']);smart.process()
    assert service.get_event('1',e['id'])['smart']['short_titles']['ru']=='Уход за волосами'

def test_override_provider_text_change_invalidates_translation(service):
    service.config=replace(service.config,translation_url='https://fake.example')
    class Translator:
        def translate(self,texts,lang):return [lang+': '+t for t in texts]
    e=create(service,rrule='FREQ=DAILY;COUNT=3');key='2026-10-25T12:00'
    service.occurrence_change('1',e['id'],key,{'title':'Old'},e['revision'])
    tr=Translations(service,Translator());tr.process()
    helper=GoogleImports(service)
    with service.db.transaction() as c:
        row=c.execute('SELECT * FROM events WHERE id=?',(e['id'],)).fetchone()
        value=helper.local_snapshot(c,row);value['overrides'][key]['title']='New'
        helper.store_snapshot(c,{'user_id':'1','calendar_id':row['calendar_id']},row,value)
    tr.process();data=service.get_event('1',e['id'],occurrence=key)['selected_instance']
    assert data['translations']['en']['title']=='en: New'

def test_source_change_creates_new_job_old_generation_cannot_apply(service):
    smart,fake=configured(service);e=create(service)
    fake.during=lambda:service.save_event('1',{'title':'New source'},e['id'],e['revision'])
    smart.process()
    assert not service.get_event('1',e['id'])['translations']
    smart.process();assert service.get_event('1',e['id'])['translations']['en']['title']=='en: New source'

def test_trash_during_request_discards_result(service):
    smart,fake=configured(service);e=create(service)
    fake.during=lambda:service.delete_event('1',e['id'],e['revision'])
    smart.process()
    assert not service.get_event('1',e['id'],deleted=True)['translations']

def test_occurrence_short_titles_and_following_move_keep_identity(service):
    smart,fake=configured(service);e=create(service,rrule='FREQ=DAILY;COUNT=4');smart.process()
    data=service.get_event('1',e['id']);key='2026-10-26T12:00'
    smart.edit('1',e['id'],data['revision'],occurrence=key,short_titles={'ru':'Ручное повторение'})
    data=service.get_event('1',e['id'])
    moved=service.occurrence_change('1',e['id'],'2026-10-25T12:00',{'start':'2026-10-25T14:00','end':'2026-10-25T15:00'},data['revision'],scope='following')
    after=service.get_event('1',moved['id'],occurrence='2026-10-26T14:00')['selected_instance']
    assert after['smart']['short_titles']['ru']=='Ручное повторение'
    assert '2026-10-26T12:00' not in service.get_event('1',moved['id'])['overrides']

def test_same_revision_reprocess_is_fenced(service):
    smart,fake=configured(service);e=create(service)
    fake.during=lambda:smart.request('1',e['id'])
    smart.process()
    assert service.get_event('1',e['id'])['translations']=={}
    smart.process();assert service.get_event('1',e['id'])['translations']['en']['title'].startswith('en:')

def test_short_only_remember_rule_does_not_capture_category(service):
    smart,fake=configured(service);e=create(service)
    smart.edit('1',e['id'],e['revision'],short_titles={'ru':'Моя услуга'},remember=True)
    rule=smart.status('1')['rules'][0]
    assert 'category_id' not in rule
    other=create(service);smart.process();smart.process()
    assert service.get_event('1',other['id'])['smart']['short_titles']['ru']=='Моя услуга'

def test_archive_roundtrip_rules_and_no_api_consent(service,backup):
    smart,fake=configured(service);e=create(service);smart.process()
    data=service.get_event('1',e['id'])
    smart.edit('1',e['id'],data['revision'],short_titles={'ru':'Мой заголовок'},remember=True)
    blob=backup.export('1');archive=backup.verify(blob)
    assert archive['schema']==2 and archive['smart_rules']
    assert archive['members']['1']['smart_events']['consent'] is False
    data=service.get_event('1',e['id']);smart.edit('1',e['id'],data['revision'],short_titles={'ru':'Новое'})
    rule=smart.status('1')['rules'][0];smart.rule('1',rule['id'],enabled=False)
    preview=backup.preview('1',blob)
    data=service.get_event('1',e['id'])
    backup.apply('1',blob,[{'id':e['id'],'revision':data['revision'],'fields':['smart']}],[],[],preview_id=preview['preview_id'],smart_rule_ids=[rule['id']])
    assert service.get_event('1',e['id'])['smart']['short_titles']['ru']=='Мой заголовок'
    assert smart.status('1')['rules'][0]['enabled'] is True

def test_archive_refuses_unrestorable_expanded_payload(service,backup,monkeypatch):
    import app.backup as module
    e=create(service,description='a'*1000)
    monkeypatch.setattr(module,'MAX_EXPANDED',5000)
    with pytest.raises(Problem) as exc:backup.export('1')
    assert exc.value.code=='archive_too_large'

def test_google_original_html_stays_separate_from_plain_text(service):
    helper=GoogleImports(service)
    with service.db.transaction() as c:
        cal=service.calendar(c,'1')
        data=helper.new_data(c,'1',cal['id'],{'title':'Salon','description':'Plain'},original={'title':'Salon','description':'<p>Plain</p>'})
        assert data['description']=='Plain'
        assert data['smart']['source']['description']=='<p>Plain</p>'
        assert data['smart']['source']['provider']=='google'

def test_openai_transport_shape_store_false_and_refusal(service,monkeypatch):
    from app.ai_client import OpenAIClient
    import urllib.request
    captured={}
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self,*args):return json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'refusal','refusal':'No'}]}]}).encode()
    class Opener:
        def open(self,request,timeout):captured.update(body=json.loads(request.data),url=request.full_url,timeout=timeout);return Response()
    monkeypatch.setattr(urllib.request,'build_opener',lambda *a:Opener())
    with pytest.raises(Problem) as exc:OpenAIClient(replace(service.config,openai_api_key='synthetic')).process({'title':'Test'})
    assert exc.value.code=='smart_refused'
    assert captured['body']['store'] is False and 'tools' not in captured['body']
    assert captured['body']['text']['format']['strict'] is True
    assert captured['url']=='https://api.openai.com/v1/responses'

def test_api_smart_idor_and_server_owned_provenance(service):
    from app.main import create_app
    from fastapi.testclient import TestClient
    smart,fake=configured(service);e=create(service)
    with TestClient(create_app(service.config,start_worker=False)) as client:
        token=client.post('/api/auth',json={'demo_user':'1'}).json()['token'];headers={'Authorization':'Bearer '+token}
        assert client.get('/api/smart-events',headers=headers).json()['configured']
        assert client.patch('/api/events/'+e['id']+'/smart',headers=headers,json={'revision':e['revision'],'short_titles':{'en':'Manual'}}).status_code==200
        token=client.post('/api/auth',json={'demo_user':'3'}).json()['token'];headers={'Authorization':'Bearer '+token}
        assert client.post('/api/events/'+e['id']+'/smart/reprocess',headers=headers,json={}).status_code in (403,404)

def test_batch_requires_current_preview_and_does_not_process_unselected(service):
    smart,fake=configured(service);one=create(service);two=create(service,title='Other source')
    with service.db.transaction() as c:c.execute('DELETE FROM smart_jobs')
    preview=smart.preview('1')
    assert {e['id'] for e in preview['items']}=={one['id'],two['id']}
    assert fake.calls==[]
    smart.batch('1',preview['preview_id'],[one['id']]);smart.process()
    assert len(fake.calls)==1 and service.get_event('1',two['id'])['translations']=={}
    with pytest.raises(Problem):smart.batch('1',preview['preview_id'],[two['id']])

def test_batch_stale_revision_and_no_auto_gate(service):
    smart,fake=configured(service);e=create(service);preview=smart.preview('1')
    service.save_event('1',{'title':'Changed'},e['id'],e['revision'])
    with pytest.raises(Problem) as exc:smart.batch('1',preview['preview_id'],[e['id']])
    assert exc.value.code=='revision_conflict'
    service.config=replace(service.config,smart_auto_categories=False)
    category=service.save_category('1',{'name':'Beauty','color':'#9B77D1'});fake.category=category['id']
    for actor in ('1','2'):service.settings(actor,{'smart_events':{'mode':'auto'}})
    current=service.get_event('1',e['id']);smart=SmartEvents(service,fake);smart.request('1',e['id']);smart.process()
    assert service.get_event('1',e['id'])['category_id'] is None

def test_renamed_category_cannot_accept_old_suggestion(service):
    smart,fake=configured(service)
    cat=service.save_category('1',{'name':'Beauty','color':'#9B77D1'});fake.category=cat['id']
    e=create(service);smart.process();data=service.get_event('1',e['id'])
    service.save_category('1',{'name':'Different purpose','color':'#9B77D1'},cat['id'])
    with pytest.raises(Problem) as exc:smart.edit('1',e['id'],data['revision'],category_action='accept')
    assert exc.value.code=='smart_suggestion_stale'

def test_auth_failure_stops_other_paid_attempts_for_same_configuration(service):
    smart,fake=configured(service);create(service);create(service,title='Other')
    fake.fail='smart_auth_error'
    smart.process();smart.process();assert len(fake.calls)==1

def test_rule_edit_does_not_change_existing_events(service):
    smart,fake=configured(service);e=create(service)
    smart.edit('1',e['id'],e['revision'],short_titles={'ru':'Saved'},remember=True)
    rule=smart.status('1')['rules'][0]
    smart.rule('2',rule['id'],changes={'match':'Another title','short_titles':{'ru':'Next'}})
    assert service.get_event('1',e['id'])['smart']['short_titles']['ru']=='Saved'
    assert smart.status('1')['rules'][0]['match']=='Another title'
