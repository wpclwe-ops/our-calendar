"""Provider-independent policies for the next integration milestone.

These are domain functions, not a claim that Google/iCloud are connected.
No external write adapter is enabled in this release.
"""
from dataclasses import dataclass
from copy import deepcopy
from .security import require
from .recurrence import TIME_FIELDS

TEMPORAL_FIELDS = TIME_FIELDS | {'fold','end_fold'}

@dataclass(frozen=True)
class Account:
    owner_id:str
    mode:str='import_only'
    provider_writable:bool=False
    connected:bool=True

def authorize_write(account,actor_id):
    require(account.connected,'account_disconnected',409)
    require(account.owner_id==actor_id,'external_owner_only',403)
    require(account.mode=='two_way','external_account_readonly',403)
    require(account.provider_writable,'provider_calendar_readonly',403)

def authorize_delete_everywhere(accounts,approvals):
    for account in accounts:
        require(account.connected,'account_disconnected',409)
        require(account.mode=='two_way' and account.provider_writable,'external_account_readonly',403)
    owners={a.owner_id for a in accounts}
    require(not (set(approvals)-owners),'invalid_approval')
    if any(approvals.get(owner) is False for owner in owners):return 'local_only'
    if not all(approvals.get(owner) is True for owner in owners):return 'waiting'
    return 'ready'

def merge_fields(base,local,remote):
    """Three-way merge: temporal fields are treated as an indivisible group."""
    merged=deepcopy(local);conflicts={}
    keys=set(base)|set(local)|set(remote)
    local_time=any(base.get(k)!=local.get(k) for k in TEMPORAL_FIELDS)
    remote_time=any(base.get(k)!=remote.get(k) for k in TEMPORAL_FIELDS)
    time_different=any(local.get(k)!=remote.get(k) for k in TEMPORAL_FIELDS)
    if local_time and remote_time and time_different:
        conflicts['timing']={source:{k:value.get(k) for k in TEMPORAL_FIELDS} for source,value in [('base',base),('local',local),('remote',remote)]}
    for key in keys:
        b,l,r=base.get(key),local.get(key),remote.get(key)
        if key in TEMPORAL_FIELDS and 'timing' in conflicts:continue
        if l==r or r==b:continue
        if l==b:merged[key]=deepcopy(r)
        else:conflicts[key]={'base':b,'local':l,'remote':r}
    return {'merged':merged,'conflicts':conflicts,'state':'conflict' if conflicts else 'merged'}
