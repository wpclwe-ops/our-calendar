"""Offline recovery into a NEW directory; never overwrites a running database."""
import argparse
import os
from pathlib import Path
from app.operator_backup import restore_snapshot,SnapshotError

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive');parser.add_argument('output');parser.add_argument('--deletion-ledger',required=True)
    args=parser.parse_args();key=os.getenv('OPERATOR_BACKUP_KEY','')
    if not key:raise SystemExit('Set OPERATOR_BACKUP_KEY from protected Railway variables.')
    try:restore_snapshot(Path(args.archive).read_bytes(),key,args.output,deletion_ledger=Path(args.deletion_ledger).read_bytes())
    except (SnapshotError,OSError):raise SystemExit('Recovery failed. Check the key, archive and NEW output directory.')
    print('Offline recovery verified. Keep all production instances stopped until paths, bot and volume are ready.')
if __name__=='__main__':main()
