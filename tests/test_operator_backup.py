from dataclasses import replace
from datetime import timedelta
from pathlib import Path
import sqlite3
import pytest
from cryptography.fernet import Fernet
from app.operator_backup import OperatorBackups,SnapshotError,restore_snapshot,unpack_snapshot,PREFIX,LEDGER_KEY
from app.backup import Backups
from app.config import Config
from app.db import Database
from app.service import Service
from app.recurrence import utcnow

class Storage:
    def __init__(self):self.objects={};self.cutoffs=[];self.fail=False
    def put(self,key,data):
        if self.fail:raise OSError('sensitive-storage-url')
        self.objects[key]=data
    def get(self,key):return self.objects[key]
    def get_optional(self,key):return self.objects.get(key)
    def expire(self,cutoff):self.cutoffs.append(cutoff)

def configured(service):
    service.config=replace(service.config,backup_endpoint='https://storage.example',backup_bucket='private',backup_access_key='secret-id',
        backup_secret_key='private-secret',backup_encryption_key=Fernet.generate_key().decode())
    Backups(service);storage=Storage();return OperatorBackups(service,storage),storage


def test_encrypted_snapshot_roundtrip_recovers_data_keys_and_original_zip(service,backup,event,tmp_path):
    user_zip=backup.export('1');operator,storage=configured(service);now=utcnow()
    operator.run_due(now)
    assert operator.status()['state']=='ready' and len([k for k in storage.objects if k.startswith(PREFIX)])==1
    key,blob=next((k,v) for k,v in storage.objects.items() if k.startswith(PREFIX))
    assert key.startswith(PREFIX) and b'Together' not in blob and b'PRIVATE KEY' not in blob
    output=restore_snapshot(blob,service.config.backup_encryption_key,tmp_path/'recovered',deletion_ledger=storage.get(LEDGER_KEY))
    cfg=replace(service.config,database=str(output/'calendar.sqlite3'),archive_key_file=str(output/'archive-key.pem'),archive_public_keys=str(output/'archive-public-keys.json'))
    recovered=Service(Database(cfg.database),cfg)
    assert recovered.get_event('1',event['id'])['title']=='Together'
    assert Backups(recovered).verify(user_zip)['calendar']['id']==service.state('1')['calendar']['id']
    with recovered.db.transaction() as c:assert c.execute("SELECT COUNT(*) FROM outbox WHERE status IN ('pending','sending')").fetchone()[0]==0
    operator.run_due(now+timedelta(hours=23));assert len([k for k in storage.objects if k.startswith(PREFIX)])==1
    operator.run_due(now+timedelta(days=1));assert len([k for k in storage.objects if k.startswith(PREFIX)])==2
    assert storage.cutoffs[-1]==now-timedelta(days=6)


def test_backup_failure_is_visible_and_retries_without_exposing_secrets(service,event):
    operator,storage=configured(service);storage.fail=True;now=utcnow();operator.run_due(now)
    status=operator.status();assert status['state']=='failed' and status['error']=='backup_unavailable'
    assert 'private-secret' not in str(status) and 'sensitive-storage-url' not in str(status)
    storage.fail=False;operator.run_due(now+timedelta(minutes=14));assert not any(k.startswith(PREFIX) for k in storage.objects)
    operator.run_due(now+timedelta(minutes=15));assert operator.status()['state']=='ready'


def test_wrong_key_corruption_and_overwrite_are_rejected(service,event,tmp_path):
    operator,storage=configured(service);blob=operator.snapshot();key=service.config.backup_encryption_key
    for data,password in ((blob,Fernet.generate_key().decode()),(blob[:-10]+b'corrupt',key)):
        with pytest.raises(SnapshotError):unpack_snapshot(data,password)
    target=tmp_path/'existing';target.mkdir();(target/'keep').write_text('safe')
    operator.run_due();ledger=storage.get(LEDGER_KEY)
    with pytest.raises(SnapshotError):restore_snapshot(blob,key,target,deletion_ledger=ledger)
    assert (target/'keep').read_text()=='safe'


def test_unconfigured_backup_does_nothing(service):
    operator=OperatorBackups(service);operator.run_due();assert operator.status()=={'state':'not_configured'}


def test_old_snapshot_cannot_resurrect_fully_deleted_calendar(service,event,tmp_path):
    from app.recurrence import stamp
    operator,storage=configured(service);operator.run_due()
    blob=next(v for k,v in storage.objects.items() if k.startswith(PREFIX))
    calendar_id=service.state('1')['calendar']['id']
    service.deletion('1','approve');service.deletion('2','approve')
    with service.db.transaction() as c:c.execute('UPDATE calendars SET delete_at=?',(stamp(utcnow()-timedelta(seconds=1)),))
    service.maintenance()
    # Purge waits until the independent ledger is confirmed in object storage.
    assert service.state('1')['calendar'] is not None
    operator.run_due();service.maintenance()
    assert service.state('1')['calendar'] is None
    with pytest.raises(SnapshotError):restore_snapshot(blob,service.config.backup_encryption_key,tmp_path/'unsafe')
    target=restore_snapshot(blob,service.config.backup_encryption_key,tmp_path/'safe',deletion_ledger=storage.get(LEDGER_KEY))
    with sqlite3.connect(target/'calendar.sqlite3') as c:
        assert c.execute('SELECT COUNT(*) FROM calendars WHERE id=?',(calendar_id,)).fetchone()[0]==0
        assert c.execute('SELECT COUNT(*) FROM events').fetchone()[0]==0
