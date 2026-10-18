import pytest
from app.service import dump
from app.security import Problem


def test_week_layout_is_personal_persistent_and_legacy_safe(service, backup):
    assert service.state('1')['me']['week_layout'] == 'agenda'
    for layout in ('three', 'seven'):
        service.settings('1', {'week_layout': layout})
        assert service.state('1')['me']['week_layout'] == layout
        assert service.state('2')['me']['week_layout'] == 'agenda'
    archive = backup.export('1')
    service.settings('1', {'week_layout': 'three'})
    preview = backup.preview('1', archive)
    backup.apply('1', archive, [], [], [], preview_id=preview['preview_id'], profile_fields=['week_layout'])
    assert service.state('1')['me']['week_layout'] == 'seven'
    assert service.state('2')['me']['week_layout'] == 'agenda'
    with service.db.transaction() as c:
        prefs = service.user(c, '2'); prefs.pop('id'); prefs.pop('week_layout')
        c.execute('UPDATE users SET data=? WHERE id=?', (dump(prefs), '2'))
    assert service.state('2')['me']['week_layout'] == 'agenda'


@pytest.mark.parametrize('value', ['five', '', None, True, 3, [], {}])
def test_week_layout_rejects_unknown_values(service, value):
    with pytest.raises(Problem):
        service.settings('1', {'week_layout': value})
    assert service.state('1')['me']['week_layout'] == 'agenda'


def test_week_layout_checks_membership_and_calendar_lock(service):
    service.membership('1')
    with pytest.raises(Problem): service.settings('1', {'week_layout': 'three'})
    service.membership('1', returning=True)
    service.deletion('1', 'approve'); service.deletion('2', 'approve')
    with pytest.raises(Problem): service.settings('1', {'week_layout': 'seven'})
