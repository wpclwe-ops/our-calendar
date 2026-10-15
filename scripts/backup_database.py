"""Consistent SQLite backup; write to separate durable storage. Contains private data."""
from pathlib import Path
import argparse
import sqlite3
from app.config import Config
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('output');args=parser.parse_args()
    config=Config.env();target=Path(args.output)
    if target.resolve()==Path(config.database).resolve():raise SystemExit('Choose a different destination')
    target.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(config.database) as source,sqlite3.connect(target) as dest:source.backup(dest)
    target.chmod(0o600)
    print('Database backup complete. Separately retain the archive signing key and public-key registry.')
