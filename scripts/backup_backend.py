"""Create a local rollback snapshot without copying a live SQLite file unsafely."""
import os
from pathlib import Path
import shutil
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone


def backup(root: Path) -> Path:
    root = root.resolve(strict=True)
    url = os.getenv('DATABASE_URL', '')
    if url and not url.startswith('sqlite:///'):
        raise RuntimeError('Non-SQLite database requires its own verified backup before deployment')
    destination = root.parent / 'deployment-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copytree(root / 'app', destination / 'app', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ('requirements.txt', '.env', '.secret_key'):
        source = root / name
        if source.is_file():
            shutil.copy2(source, destination / name)
    data_root = Path(os.getenv('APP_DATA_DIR', str(root))).resolve()
    databases = set(data_root.glob('*.db')) | set(data_root.glob('*.sqlite')) | set(data_root.glob('*.sqlite3'))
    if url:
        databases.add(Path(url.removeprefix('sqlite:///')).resolve())
    if not databases:
        raise RuntimeError('No database found; refusing to deploy without a verified backup')
    for index, source in enumerate(sorted(databases)):
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
            with closing(sqlite3.connect(destination / f'{index}-{source.name}')) as saved:
                original.backup(saved)
                if saved.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Backup integrity check failed')
    print(f'Rollback snapshot: {destination}; verified databases: {len(databases)}')
    return destination


if __name__ == '__main__':
    backup(Path(sys.argv[1]))
