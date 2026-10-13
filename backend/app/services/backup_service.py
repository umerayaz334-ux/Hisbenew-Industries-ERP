"""
Automated Database Backup Service.
Provides live, zero-lock online database snapshots, GZip compression,
automated hourly background scheduling, and retention management.
"""

import gzip
import logging
import os
import shutil
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from ..config import APP_DATA_DIR

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(APP_DATA_DIR) / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_DB_PATH = Path(APP_DATA_DIR) / "hisbenew_industries.db"

# Retention limits
MAX_HOURLY_BACKUPS = 24
MAX_DAILY_BACKUPS = 7

_scheduler_running = False
_scheduler_thread = None


def format_bytes(size: int) -> str:
    """Format bytes to human readable string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"


def create_database_backup(label: str = "manual") -> Dict[str, Any]:
    """
    Creates a live, zero-lock online snapshot of the database using SQLite's
    online backup API, then compresses it with GZip.
    """
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    temp_db_path = BACKUP_DIR / f"snapshot_{timestamp}_{label}.db"
    final_gz_path = BACKUP_DIR / f"backup_{timestamp}_{label}.db.gz"

    db_path = SQLITE_DB_PATH
    if not db_path.exists():
        raise FileNotFoundError(f"Database file not found at {db_path}")

    # Step 1: Safe online backup (zero locking, safe during active writes)
    src_conn = sqlite3.connect(str(db_path))
    dst_conn = sqlite3.connect(str(temp_db_path))
    try:
        with dst_conn:
            src_conn.backup(dst_conn, pages=100, sleep=0.01)
    finally:
        dst_conn.close()
        src_conn.close()

    # Step 2: Compress to .db.gz
    raw_size = temp_db_path.stat().st_size
    with open(temp_db_path, "rb") as f_in:
        with gzip.open(final_gz_path, "wb", compresslevel=6) as f_out:
            shutil.copyfileobj(f_in, f_out)

    # Remove temporary uncompressed snapshot
    temp_db_path.unlink(missing_ok=True)

    compressed_size = final_gz_path.stat().st_size
    ratio = (1 - (compressed_size / raw_size)) * 100 if raw_size > 0 else 0

    # Prune old backups to respect storage limits
    prune_old_backups()

    logger.info(
        f"Database backup created: {final_gz_path.name} "
        f"({format_bytes(compressed_size)}, {ratio:.1f}% reduction)"
    )

    return {
        "filename": final_gz_path.name,
        "path": str(final_gz_path),
        "raw_size_bytes": raw_size,
        "compressed_size_bytes": compressed_size,
        "compressed_size_human": format_bytes(compressed_size),
        "compression_ratio": f"{ratio:.1f}%",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "label": label,
    }


def list_database_backups() -> List[Dict[str, Any]]:
    """Lists all available database backup files sorted by creation time descending."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backups = []
    for file in BACKUP_DIR.glob("backup_*.db.gz"):
        try:
            stat = file.stat()
            backups.append({
                "filename": file.name,
                "size_bytes": stat.st_size,
                "size_human": format_bytes(stat.st_size),
                "created_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
                "timestamp": stat.st_mtime,
            })
        except Exception as e:
            logger.warning(f"Error reading backup file {file}: {e}")

    backups.sort(key=lambda x: x["timestamp"], reverse=True)
    return backups


def prune_old_backups():
    """Prunes old backups keeping the most recent hourly/daily snapshots."""
    backups = list_database_backups()
    total_allowed = MAX_HOURLY_BACKUPS + MAX_DAILY_BACKUPS
    if len(backups) > total_allowed:
        for backup in backups[total_allowed:]:
            file_path = BACKUP_DIR / backup["filename"]
            try:
                file_path.unlink(missing_ok=True)
                logger.info(f"Pruned old backup: {backup['filename']}")
            except Exception as e:
                logger.warning(f"Could not remove old backup {file_path}: {e}")


def _backup_worker():
    """Background worker that triggers automated hourly backups."""
    global _scheduler_running
    logger.info("Automated database backup scheduler started.")
    time.sleep(120)
    while _scheduler_running:
        try:
            create_database_backup(label="auto_hourly")
        except Exception as e:
            logger.error(f"Automated backup failed: {e}")

        for _ in range(720):
            if not _scheduler_running:
                break
            time.sleep(5)


def start_backup_scheduler():
    """Starts the background automated backup daemon."""
    global _scheduler_running, _scheduler_thread
    if _scheduler_running:
        return
    _scheduler_running = True
    _scheduler_thread = threading.Thread(target=_backup_worker, daemon=True, name="BackupScheduler")
    _scheduler_thread.start()


def stop_backup_scheduler():
    """Stops the background automated backup daemon."""
    global _scheduler_running
    _scheduler_running = False
