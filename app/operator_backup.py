"""Encrypted, verified operator snapshots, independent of user ZIP exports.

The decryption key is configured outside the volume. No public restore endpoint.
"""
from contextlib import closing
from datetime import datetime,timedelta
from io import BytesIO
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import uuid
from zipfile import ZipFile,ZIP_DEFLATED
from cryptography.fernet import Fernet,InvalidToken
from .recurrence import utcnow,stamp
from .service import dump,load

PREFIX='our-calendar/operator/v1/'
LEDGER_KEY='our-calendar/deletions/v1.ledger'
FILES={'calendar.sqlite3','archive-key.pem','archive-public-keys.json'}
MAX_SNAPSHOT=128*1024*1024

class SnapshotError(Exception):pass

def unpack_snapshot(blob,key,with_manifest=False):
    if len(blob)>MAX_SNAPSHOT*2:raise SnapshotError('snapshot_too_large')
    try:
        clear=Fernet(key.encode()).decrypt(blob)
        with ZipFile(BytesIO(clear)) as z:
            if set(z.namelist())!=FILES|{'manifest.json'} or len(z.infolist())!=4:raise SnapshotError('invalid_snapshot')
            if sum(i.file_size for i in z.infolist())>MAX_SNAPSHOT:raise SnapshotError('snapshot_too_large')
            manifest=json.loads(z.read('manifest.json'))
            if manifest['schema']!=1:raise SnapshotError('unsupported_snapshot')
            files={name:z.read(name) for name in FILES}
        if any(hashlib.sha256(value).hexdigest()!=manifest['sha256'][name] for name,value in files.items()):raise SnapshotError('snapshot_integrity_failed')
        return (files,manifest) if with_manifest else files
    except SnapshotError:raise
    except Exception:raise SnapshotError('invalid_encrypted_snapshot') from None

def verify_database(path):
    with closing(sqlite3.connect(path)) as c:
        if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise SnapshotError('database_integrity_failed')
        if c.execute('PRAGMA foreign_key_check').fetchone():raise SnapshotError('database_foreign_keys_failed')

def read_deletion_ledger(blob,key):
    try:
        value=json.loads(Fernet(key.encode()).decrypt(blob))
        if value['schema']!=1 or not isinstance(value['deleted'],dict):raise ValueError()
        for calendar_id,deleted_at in value['deleted'].items():
            uuid.UUID(calendar_id);datetime.fromisoformat(deleted_at)
        return value['deleted']
    except Exception:raise SnapshotError('invalid_deletion_ledger') from None

def restore_snapshot(blob,key,output,deletion_ledger=None):
    """Offline only. Refuse any existing directory and suppress stale outbox jobs."""
    files,manifest=unpack_snapshot(blob,key,with_manifest=True);target=Path(output)
    if manifest.get('requires_deletion_ledger') and deletion_ledger is None:raise SnapshotError('deletion_ledger_required')
    deleted=read_deletion_ledger(deletion_ledger,key) if deletion_ledger is not None else {}
    if target.exists():raise SnapshotError('restore_destination_exists')
    with tempfile.TemporaryDirectory() as temp:
        staged=Path(temp)/'calendar.sqlite3';staged.write_bytes(files['calendar.sqlite3']);verify_database(staged)
    target.mkdir(mode=0o700,parents=True)
    try:
        for name,value in files.items():
            path=target/name;path.write_bytes(value);path.chmod(0o600)
        with closing(sqlite3.connect(target/'calendar.sqlite3')) as c:
            c.execute('PRAGMA foreign_keys=ON')
            for calendar_id,deleted_at in deleted.items():
                if manifest['created_at']<=deleted_at:c.execute('DELETE FROM calendars WHERE id=?',(calendar_id,))
            c.execute("UPDATE outbox SET status='cancelled',lease_until=NULL WHERE status IN ('pending','sending')")
            c.execute("DELETE FROM runtime WHERE key IN ('worker_heartbeat','translation_heartbeat','operator_backup','bot_setup')")
            c.commit()
        verify_database(target/'calendar.sqlite3')
    except Exception:
        # Never leave a partial restored database looking ready for use.
        for path in target.iterdir():path.unlink()
        target.rmdir();raise
    return target

class S3Storage:
    def __init__(self,config):
        import boto3
        from botocore.config import Config as BotoConfig
        self.bucket=config.backup_bucket
        self.client=boto3.client('s3',endpoint_url=config.backup_endpoint,region_name=config.backup_region,
            aws_access_key_id=config.backup_access_key,aws_secret_access_key=config.backup_secret_key,
            config=BotoConfig(signature_version='s3v4',connect_timeout=10,read_timeout=30,
                              retries={'max_attempts':2,'mode':'standard'},s3={'addressing_style':'virtual'}))
    def put(self,key,blob):self.client.put_object(Bucket=self.bucket,Key=key,Body=blob,ContentType='application/octet-stream')
    def get(self,key):
        response=self.client.get_object(Bucket=self.bucket,Key=key)
        with closing(response['Body']) as stream:
            data=stream.read(MAX_SNAPSHOT*2+1)
        if len(data)>MAX_SNAPSHOT*2:raise SnapshotError('snapshot_too_large')
        return data
    def get_optional(self,key):
        from botocore.exceptions import ClientError
        try:return self.get(key)
        except ClientError as exc:
            if exc.response.get('Error',{}).get('Code') in ('NoSuchKey','404','NotFound'):return None
            raise
    def expire(self,cutoff):
        for page in self.client.get_paginator('list_objects_v2').paginate(Bucket=self.bucket,Prefix=PREFIX):
            for item in page.get('Contents',[]):
                if item['LastModified']<cutoff:self.client.delete_object(Bucket=self.bucket,Key=item['Key'])

class OperatorBackups:
    def __init__(self,service,storage=None):
        self.service=service;self.config=service.config;self.storage=storage
    @property
    def configured(self):
        return all((self.config.backup_bucket,self.config.backup_endpoint,self.config.backup_access_key,
                    self.config.backup_secret_key,self.config.backup_encryption_key))
    def status(self):
        with self.service.db.transaction() as c:
            row=c.execute("SELECT value FROM runtime WHERE key='operator_backup'").fetchone()
        return load(row['value']) if row else {'state':'pending' if self.configured else 'not_configured'}
    def record(self,value):
        with self.service.db.transaction() as c:
            c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('operator_backup',dump(value)))
    def snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'calendar.sqlite3'
            with closing(self.service.db.connect()) as source,closing(sqlite3.connect(target)) as dest:source.backup(dest)
            verify_database(target)
            files={'calendar.sqlite3':target.read_bytes(),'archive-key.pem':Path(self.config.archive_key_file).read_bytes(),
                   'archive-public-keys.json':Path(self.config.archive_public_keys).read_bytes()}
            if sum(map(len,files.values()))>MAX_SNAPSHOT:raise SnapshotError('snapshot_too_large')
            manifest={'schema':1,'created_at':stamp(),'requires_deletion_ledger':True,'sha256':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
            buffer=BytesIO()
            with ZipFile(buffer,'w',ZIP_DEFLATED,compresslevel=3) as z:
                for name,data in files.items():z.writestr(name,data)
                z.writestr('manifest.json',dump(manifest))
        return Fernet(self.config.backup_encryption_key.encode()).encrypt(buffer.getvalue())
    def sync_deletions(self,storage):
        with self.service.db.transaction() as c:
            row=c.execute("SELECT value FROM runtime WHERE key='deletion_tombstones'").fetchone()
            local=load(row['value']) if row else {}
        remote_blob=storage.get_optional(LEDGER_KEY)
        remote=read_deletion_ledger(remote_blob,self.config.backup_encryption_key) if remote_blob else {}
        merged=dict(remote)
        for key,value in local.items():merged[key]=max(value,merged.get(key,value))
        if remote_blob is None or merged!=remote:
            remote_blob=Fernet(self.config.backup_encryption_key.encode()).encrypt(dump({'schema':1,'deleted':merged}).encode())
            storage.put(LEDGER_KEY,remote_blob)
            if storage.get(LEDGER_KEY)!=remote_blob:raise SnapshotError('deletion_ledger_readback_failed')
        with self.service.db.transaction() as c:
            for key in ('deletion_tombstones','deletion_tombstones_synced'):
                # Maintenance can add a new tombstone during the network request.
                # Preserve it locally, but only acknowledge the confirmed map.
                value=merged
                if key=='deletion_tombstones':
                    row=c.execute('SELECT value FROM runtime WHERE key=?',(key,)).fetchone()
                    value={**merged,**(load(row['value']) if row else {})}
                c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,dump(value)))
        return remote_blob

    def run_due(self,now=None):
        if not self.configured:return
        now=now or utcnow();status=self.status()
        try:
            storage=self.storage or S3Storage(self.config)
            ledger=self.sync_deletions(storage)
            if status.get('next_at') and datetime.fromisoformat(status['next_at'])>now:return
            blob=self.snapshot();key=PREFIX+now.strftime('%Y-%m-%dT%H%M%SZ')+'-'+uuid.uuid4().hex+'.ocb'
            storage.put(key,blob)
            downloaded=storage.get(key)
            if downloaded!=blob:raise SnapshotError('snapshot_readback_failed')
            # Perform an actual offline restore (SQLite integrity + FK check) on
            # the downloaded encrypted copy before recording success.
            with tempfile.TemporaryDirectory() as temp:restore_snapshot(downloaded,self.config.backup_encryption_key,Path(temp)/'restored',deletion_ledger=ledger)
            storage.expire(now-timedelta(days=7))
            self.record({'state':'ready','last_success':stamp(now),'verified_at':stamp(now),
                         'next_at':stamp(now+timedelta(days=1)),'retention_days':7})
        except Exception as exc:
            # Exception text/URLs may contain credentials; expose safe codes only.
            self.record({**status,'state':'failed','error':str(exc) if isinstance(exc,SnapshotError) else 'backup_unavailable',
                         'checked_at':stamp(now),'next_at':stamp(now+timedelta(minutes=15))})
