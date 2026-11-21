"""Confirmed series categories replace category exceptions atomically."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import Problem


@pytest.fixture
def series(service):
    first = service.save_category('1', {'name': 'First', 'color': '#9B77D1'})['id']
    other = service.save_category('1', {'name': 'Other', 'color': '#D47AAE'})['id']
    ev = service.save_event('1', {
        'title': 'Weekly', 'description': 'Keep description',
        'start': '2026-10-24T10:00', 'end': '2026-10-24T11:00',
        'rrule': 'FREQ=DAILY;COUNT=5', 'category_id': first,
    })
    service.occurrence_change('1', ev['id'], '2026-10-25T10:00', {
        'title': 'Moved', 'start': '2026-10-25T12:00', 'end': '2026-10-25T13:00',
        'category_id': other, 'reminders': [15],
        'translations': {'en': {'title': 'Manual title'}},
    }, 1)
    service.occurrence_change('2', ev['id'], '2026-10-26T10:00', {'status': 'done'}, 2)
    service.occurrence_change('1', ev['id'], '2026-10-27T10:00', {'category_id': other}, 3, delete=True)
    return service.get_event('1', ev['id']), first, other


def without_category(data):
    result = deepcopy(data)
    result.pop('category_id', None)
    result.get('smart', {}).pop('category', None)
    return result


@pytest.mark.parametrize('clear', [False, True])
def test_confirmed_series_category_includes_exceptions_and_preserves_fields(service, series, clear):
    before, first, other = series
    # Also covers a category already equal to the master but different on exceptions.
    category = None if clear else first
    saved = service.save_event('2', {'category_id': category}, before['id'], before['revision'], category_scope='all')
    after = service.get_event('1', before['id'])
    assert saved['category_id'] == after['category_id'] == category
    assert after['revision'] == before['revision'] + 1
    assert after['schedule_version'] == before['schedule_version']
    assert after['smart']['category'] == {'manual': True, 'origin': 'manual'}
    for key, patch in before['overrides'].items():
        assert without_category(after['overrides'][key]) == without_category(patch)
        assert 'category_id' not in after['overrides'][key]
        if 'smart' in after['overrides'][key]:
            assert after['overrides'][key]['smart']['category'] == {'manual': True, 'origin': 'manual'}
    instances = service.events('1', '2026-10-24', '2026-10-30', event_id=before['id'])
    assert len(instances) == 4  # Deleted exception remains deleted.
    assert {e['category_id'] for e in instances} == {category}
    moved = next(e for e in instances if e['occurrence'] == '2026-10-25T10:00')
    assert moved['start'] == '2026-10-25T12:00'
    assert moved['title'] == 'Moved'
    assert moved['reminders'] == {'1': [15], '2': [60]}
    assert moved['translations']['en']['title'] == 'Manual title'


def test_one_category_keeps_other_dates(service, series):
    before, first, other = series
    service.occurrence_change('1', before['id'], '2026-10-24T10:00', {'category_id': other}, before['revision'])
    after = service.get_event('1', before['id'])
    assert after['category_id'] == first
    assert after['overrides']['2026-10-24T10:00']['category_id'] == other
    assert after['overrides']['2026-10-25T10:00'] == before['overrides']['2026-10-25T10:00']


@pytest.mark.parametrize('scope', ['one', 'following', 'all'])
def test_form_category_all_preserves_scope_of_other_edits(service, series, scope):
    before, first, other = series
    changes = {'category_id': None, 'location': 'Only chosen scope'}
    result = service.occurrence_change('1', before['id'], '2026-10-25T10:00', changes,
                                       before['revision'], scope=scope, category_scope='all')
    masters = [service.get_event('1', before['id'])]
    if scope == 'following':
        masters.append(service.get_event('1', result['id']))
    assert all(e['category_id'] is None for e in masters)
    instances = service.events('1', '2026-10-24', '2026-10-30')
    assert all(e['category_id'] is None for e in instances)
    assert len(instances) == 4
    for e in instances:
        expected = (scope == 'all' or e['occurrence'] == '2026-10-25T10:00'
                    or (scope == 'following' and e['occurrence'] > '2026-10-25T10:00'))
        assert e['location'] == ('Only chosen scope' if expected else '')


@pytest.mark.parametrize('scope', ['patch', 'one', 'following'])
def test_series_category_rejects_invalid_category_and_rolls_back(service, series, scope):
    before, _, _ = series
    def save(user, category, revision):
        if scope == 'patch':
            return service.save_event(user, {'category_id': category}, before['id'], revision, category_scope='all')
        return service.occurrence_change(user, before['id'], '2026-10-25T10:00',
                                         {'category_id': category, 'location': 'Must roll back'},
                                         revision, scope=scope, category_scope='all')
    for user, category, revision in [('1', 'unknown', before['revision']),
                                      ('1', None, 1), ('3', None, before['revision'])]:
        with pytest.raises(Problem):
            save(user, category, revision)
        assert service.get_event('1', before['id']) == before
        with service.db.transaction() as c:
            assert c.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 1
    # A real category from a different calendar cannot be used either.
    service.create_calendar('3')
    foreign = service.save_category('3', {'name': 'Foreign', 'color': '#9B77D1'})['id']
    with pytest.raises(Problem):
        save('1', foreign, before['revision'])
    assert service.get_event('1', before['id']) == before


def test_http_series_category_flag_requires_valid_context(service, series, event):
    before, _, other = series
    with TestClient(create_app(service.config, start_worker=False)) as client:
        token = client.post('/api/auth', json={'demo_user': '1'}).json()['token']
        headers = {'Authorization': 'Bearer ' + token}
        url = '/api/events/' + before['id']
        assert client.patch(url, headers=headers, json={
            'revision': before['revision'], 'category_id': other, 'category_scope': 'bad',
        }).status_code == 400
        assert client.patch('/api/events/' + event['id'], headers=headers, json={
            'revision': 1, 'category_id': other, 'category_scope': 'all',
        }).status_code == 400
        assert client.patch(url, headers=headers, json={
            'revision': before['revision'], 'category_id': other, 'category_scope': 'all',
        }).status_code == 200
        after = client.get(url, headers=headers).json()
        assert after['category_id'] == other
        assert all('category_id' not in patch for patch in after['overrides'].values())
        response = client.post(url + '/occurrence', headers=headers, json={
            'revision': after['revision'], 'occurrence': '2026-10-25T10:00', 'scope': 'one',
            'changes': {'category_id': None, 'location': 'One date'}, 'category_scope': 'all',
        })
        assert response.status_code == 200
        after = client.get(url, headers=headers).json()
        assert after['category_id'] is None
        assert after['location'] == ''
        assert after['overrides']['2026-10-25T10:00']['location'] == 'One date'
