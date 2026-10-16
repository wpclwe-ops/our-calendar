from dataclasses import replace
from pathlib import Path
from cryptography.fernet import Fernet
import pytest
from app.backup import Backups
from app.release import release_checkpoint
from app.operator_backup import SnapshotError,PREFIX,LEDGER_KEY,unpack_snapshot
from app.health import health_status

class Storage:
    def __init__(self):self.objects={};self.fail=False
    def get_optional(self,key):return self.objects.get(key)
    def put(self,key,blob):
        if self.fail:raise OSError('secret-endpoint')
        self.objects[key]=blob
    def get(self,key):return self.objects[key]

def config(service):
    Backups(service)
    return replace(service.config,backup_endpoint='https://private.example',backup_bucket='private',backup_access_key='secret',
        backup_secret_key='secret',backup_encryption_key=Fernet.generate_key().decode())

def test_checkpoint_preserves_original_database_and_keys_before_release(service,event):
    cfg=config(service);store=Storage();status=release_checkpoint(cfg,store)
    assert status['state']=='ready'
    files=list((Path(cfg.database).parent/'release-checkpoints').glob('*/calendar.sqlite3'));assert len(files)==1
    key=next(k for k in store.objects if k.startswith(PREFIX))
    recovered=unpack_snapshot(store.objects[key],cfg.backup_encryption_key)
    assert recovered['archive-key.pem']==Path(cfg.archive_key_file).read_bytes()
    assert service.get_event('1',event['id'])['title']=='Together'
    assert health_status(service)['release_checkpoint']['state']=='ready'
    assert LEDGER_KEY in store.objects

def test_checkpoint_failure_never_claims_ready_or_changes_events(service,event):
    cfg=config(service);store=Storage();store.fail=True
    with pytest.raises(SnapshotError):release_checkpoint(cfg,store)
    assert service.get_event('1',event['id'])['revision']==1
    assert health_status(service)['release_checkpoint']=={'state':'not_requested'}

def test_checkpoint_requires_existing_database_and_keys(service):
    cfg=replace(service.config,database=service.config.database+'.missing')
    with pytest.raises(SnapshotError):release_checkpoint(cfg,Storage())
