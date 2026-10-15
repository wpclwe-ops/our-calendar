import pytest
from app.sync_policy import Account,authorize_write,authorize_delete_everywhere,merge_fields
from app.security import Problem

def test_import_only_absolute_priority():
    account=Account('1',provider_writable=True)
    with pytest.raises(Problem):authorize_write(account,'1')
    with pytest.raises(Problem):authorize_delete_everywhere([account],{'1':True,'2':True})

def test_only_external_owner_can_write():
    account=Account('1','two_way',True)
    authorize_write(account,'1')
    with pytest.raises(Problem):authorize_write(account,'2')

def test_unlimited_wait_and_rejection():
    accounts=[Account('1','two_way',True),Account('2','two_way',True)]
    assert authorize_delete_everywhere(accounts,{'1':True})=='waiting'
    assert authorize_delete_everywhere(accounts,{'1':True,'2':False})=='local_only'
    assert authorize_delete_everywhere(accounts,{'1':True,'2':True})=='ready'

def test_independent_merge_and_timing_group():
    base={'start':'12:00','end':'13:00','description':'Old','title':'Title'}
    local={**base,'start':'14:00','end':'15:00'}
    remote={**base,'description':'New'}
    result=merge_fields(base,local,remote)
    assert not result['conflicts'] and result['merged']['start']=='14:00' and result['merged']['description']=='New'
    remote={**base,'end':'16:00'}
    assert 'timing' in merge_fields(base,local,remote)['conflicts']
