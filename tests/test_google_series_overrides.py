"""A Google series keeps following remote changes unless a person stored their own per-occurrence data."""
from tests.test_google_import import google, imported  # noqa: F401  (fixture and helper)


def at(value):
    return {'dateTime': value, 'timeZone': 'Europe/Warsaw'}


def daily_series():
    return {'id': 's', 'etag': 'a', 'summary': 'Run', 'status': 'confirmed',
            'start': at('2026-10-22T08:00:00+02:00'), 'end': at('2026-10-22T09:00:00+02:00'),
            'recurrence': ['RRULE:FREQ=DAILY;COUNT=8']}


def moved_instance():
    return {'id': 's_x', 'etag': 'b', 'recurringEventId': 's', 'summary': 'Run moved', 'status': 'confirmed',
            'originalStartTime': at('2026-10-25T08:00:00+01:00'),
            'start': at('2026-10-25T12:00:00+01:00'), 'end': at('2026-10-25T13:00:00+01:00')}


def link_state(g):
    with g.s.db.transaction() as c:
        return c.execute("SELECT state FROM google_links WHERE remote_id='s'").fetchone()['state']


def shorten_series(f):
    f.items['s']['recurrence'] = ['RRULE:FREQ=DAILY;COUNT=5']
    f.items['s']['etag'] = 'z'


def test_series_with_moved_instance_follows_remote_shortening(google):
    g, f, source = google
    f.items['s'] = daily_series()
    f.items['s_x'] = moved_instance()
    imported(google, 's', 'series')
    assert len(g.s.events('1', '2026-10-22', '2026-11-10')) == 8

    shorten_series(f)
    g.sync_source('1', source, force=True)

    assert link_state(g) != 'unsupported'
    assert len(g.s.events('1', '2026-10-22', '2026-11-10')) == 5


def test_series_with_personal_occurrence_data_is_still_held_back(google):
    g, f, source = google
    f.items['s'] = daily_series()
    link = imported(google, 's', 'series')
    first = g.s.events('1', '2026-10-24', '2026-10-25')[0]
    event = g.s.get_event('1', link['event_id'])
    g.s.occurrence_change('1', link['event_id'], first['occurrence'], {'status': 'done'}, event['revision'], 'one')

    shorten_series(f)
    g.sync_source('1', source, force=True)

    assert link_state(g) == 'unsupported'
    assert len(g.s.events('1', '2026-10-22', '2026-11-10')) == 8


def test_series_with_manual_smart_edit_on_one_occurrence_is_still_held_back(google):
    from app.smart_events import SmartEvents
    g, f, source = google
    f.items['s'] = daily_series()
    f.items['s_x'] = moved_instance()
    link = imported(google, 's', 'series')
    event = g.s.get_event('1', link['event_id'])
    SmartEvents(g.s, object()).edit('1', link['event_id'], event['revision'],
                                    occurrence='2026-10-25T08:00', short_titles={'en': 'My run'})

    shorten_series(f)
    g.sync_source('1', source, force=True)

    assert link_state(g) == 'unsupported'
    occurrences = g.s.events('1', '2026-10-22', '2026-11-10')
    assert len(occurrences) == 8
    moved = [e for e in occurrences if e['occurrence'] == '2026-10-25T08:00'][0]
    assert moved['smart']['short_titles']['en'] == 'My run'


def test_only_manual_smart_metadata_counts_as_personal():
    # The smart-edit API always stores translations/category_id beside smart, so the
    # manual-flag branch cannot be isolated end to end; check it on real metadata shapes.
    from app.google_import import personal_override
    from app.smart_events import capture_source
    imported_data = {'title': 'Run moved', 'description': '', 'translations': {}}
    capture_source(imported_data, provider='google')
    bookkeeping = {'title': 'Run moved', 'smart': imported_data['smart']}
    assert not personal_override(bookkeeping)

    short_title = {**imported_data['smart'], 'fields': {**imported_data['smart']['fields'],
                   'en.short_title': {'manual': True, 'stale': False}}}
    assert personal_override({'smart': short_title})
    assert personal_override({'smart': {**imported_data['smart'], 'category': {'manual': True, 'origin': 'manual'}}})
    assert personal_override({'smart': imported_data['smart'], 'status': 'done'})


def test_exception_dropped_by_google_leaves_no_row_that_blocks_later_series_changes(google):
    g, f, source = google
    f.items['s'] = daily_series()
    f.items['s_x'] = moved_instance()
    link = imported(google, 's', 'series')

    # Shortening past the moved instance makes Google drop that exception.
    f.items['s']['recurrence'] = ['RRULE:FREQ=DAILY;COUNT=3']
    f.items['s']['etag'] = 'short'
    del f.items['s_x']
    g.sync_source('1', source, force=True)
    assert len(g.s.events('1', '2026-10-22', '2026-11-10')) == 3

    f.items['s']['recurrence'] = ['RRULE:FREQ=DAILY;COUNT=8']
    f.items['s']['etag'] = 'long'
    g.sync_source('1', source, force=True)

    assert link_state(g) == 'ready'
    occurrences = g.s.events('1', '2026-10-22', '2026-11-10')
    assert len(occurrences) == 8
    restored = [e for e in occurrences if e['occurrence'] == '2026-10-25T08:00'][0]
    assert restored['title'] == 'Run' and restored['start'] == '2026-10-25T08:00'
    assert g.s.get_event('1', link['event_id'])['overrides'] == {}


def test_personal_data_on_an_exception_google_drops_is_kept(google):
    g, f, source = google
    f.items['s'] = daily_series()
    f.items['s_x'] = moved_instance()
    link = imported(google, 's', 'series')
    event = g.s.get_event('1', link['event_id'])
    g.s.occurrence_change('1', link['event_id'], '2026-10-25T08:00', {'status': 'done'}, event['revision'], 'one')

    # The instance is moved back to its series slot in Google; the series itself is unchanged.
    del f.items['s_x']
    f.items['s']['etag'] = 'unmoved'
    g.sync_source('1', source, force=True)

    occurrences = g.s.events('1', '2026-10-22', '2026-11-10')
    restored = [e for e in occurrences if e['occurrence'] == '2026-10-25T08:00'][0]
    assert restored['start'] == '2026-10-25T08:00' and restored['title'] == 'Run'
    assert restored['status'] == 'done'
