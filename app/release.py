"""Fail-closed release checkpoint, before application workers can mutate data."""
from contextlib import closing
from dataclasses import replace
from pathlib import Path
import shutil
import sqlite3
import tempfile
import uuid
from .db import Database
from .service import Service,dump
from .recurrence import utcnow,stamp
from .operator_backup import OperatorBackups,S3Storage,SnapshotError,PREFIX,restore_snapshot,verify_database


def release_checkpoint(config,storage=None):
    database=Path(config.database)
    if not database.is_file():raise SnapshotError('release_database_missing')
    source_files={'archive-key.pem':Path(config.archive_key_file),'archive-public-keys.json':Path(config.archive_public_keys)}
    if not all(path.is_file() for path in source_files.values()):raise SnapshotError('release_signing_keys_missing')
    root=database.parent/'release-checkpoints';root.mkdir(mode=0o700,exist_ok=True)
    now=utcnow();directory=root/(now.strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]);directory.mkdir(mode=0o700)
    stage='local_snapshot'
    try:
        target=directory/'calendar.sqlite3'
        with closing(sqlite3.connect(database)) as source,closing(sqlite3.connect(target)) as dest:source.backup(dest)
        target.chmod(0o600);verify_database(target)
        for name,path in source_files.items():
            destination=directory/name;shutil.copyfile(path,destination);destination.chmod(0o600)
        frozen=replace(config,database=str(target),archive_key_file=str(directory/'archive-key.pem'),archive_public_keys=str(directory/'archive-public-keys.json'))
        stage='pair_validation'
        service=Service(Database(frozen.database),frozen);backups=OperatorBackups(service)
        if not backups.configured:raise SnapshotError('release_backup_not_configured')
        stage='deletion_ledger'
        storage=storage or S3Storage(config);ledger=backups.sync_deletions(storage)
        stage='snapshot_upload'
        blob=backups.snapshot();key=PREFIX+directory.name+'-pre-release.ocb'
        storage.put(key,blob);downloaded=storage.get(key)
        if downloaded!=blob:raise SnapshotError('release_checkpoint_readback_failed')
        stage='snapshot_restore'
        with tempfile.TemporaryDirectory() as temp:
            restore_snapshot(downloaded,config.backup_encryption_key,Path(temp)/'restored',deletion_ledger=ledger)
        stage='status_record'
        status={'state':'ready','created_at':stamp(now)}
        with closing(sqlite3.connect(database)) as c:
            c.execute('INSERT INTO runtime VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('release_checkpoint',dump(status)));c.commit()
        # Keep three local points in addition to encrypted remote retention.
        stage='local_retention'
        for old in sorted((p for p in root.iterdir() if p.is_dir() and p!=directory),key=lambda p:p.name,reverse=True)[2:]:shutil.rmtree(old)
        return status
    except Exception:
        # Keep a completed local checkpoint for operator recovery if S3 fails.
        # Only an internal stage name is exposed, never exception text, IDs or URLs.
        raise SnapshotError('release_checkpoint_'+stage+'_failed') from None
