"""
Database Backup and Disaster Recovery Router.
Provides admin endpoints to list, trigger, download, and manage encrypted database snapshots.
"""

from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..services.backup_service import (
    BACKUP_DIR,
    create_database_backup,
    list_database_backups,
)
from ..database import get_db
from ..models import User

router = APIRouter(prefix="/system/backups", tags=["Backups & Data Safety"])


def require_admin(request: Request, db: Session = Depends(get_db)):
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("")
def get_backups(user: User = Depends(require_admin)):
    """Lists all available database backup snapshots."""
    return {"backups": list_database_backups()}


@router.post("/create")
def trigger_backup(user: User = Depends(require_admin)):
    """Triggers an immediate live, zero-lock online backup snapshot."""
    try:
        backup_info = create_database_backup(label=f"admin_{user.username or user.id}")
        return {
            "success": True,
            "message": f"Backup {backup_info['filename']} created successfully.",
            "backup": backup_info,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup creation failed: {str(e)}")


@router.get("/download/{filename}")
def download_backup(filename: str, user: User = Depends(require_admin)):
    """Securely downloads a specific compressed database backup snapshot."""
    safe_filename = Path(filename).name
    if not safe_filename.endswith(".db.gz") or ".." in safe_filename:
        raise HTTPException(status_code=400, detail="Invalid backup file requested.")

    file_path = BACKUP_DIR / safe_filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found.")

    return FileResponse(
        path=str(file_path),
        filename=safe_filename,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )
