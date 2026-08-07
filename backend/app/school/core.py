"""Core school settings and student registry endpoints.

This module intentionally contains no factory ERP routes so the school API can
be mounted by either the combined ERP application or the standalone school app.
"""

import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import APP_DATA_DIR
from ..database import SessionLocal
from ..models import (
    SchoolAcademicSession,
    SchoolCampus,
    SchoolStudent,
    SchoolStudentLifecycleEvent,
)
from ..schemas import SchoolStudentCreate, SchoolStudentOut
from .foundation import audit_school_action, require_school_permission


router = APIRouter(tags=["School Core"])
SCHOOL_SETTINGS_FILE = APP_DATA_DIR / "school_settings.json"

DEFAULT_SCHOOL_SETTINGS = {
    "school_name": "Dar-e-Arqam",
    "campus_name": "School ERP",
    "academic_session": "2026-2027",
    "primary_color": "#191797",
    "accent_color": "#fff200",
    "surface_color": "#ffffff",
    "logo_data_url": "",
    "splash_enabled": True,
    "interface_language": "en",
    "secondary_language": "ur",
    "currency": "PKR",
    "timezone": "Asia/Karachi",
}


class SchoolSettingsPayload(BaseModel):
    school_name: str = Field(default=DEFAULT_SCHOOL_SETTINGS["school_name"], max_length=100)
    campus_name: str = Field(default=DEFAULT_SCHOOL_SETTINGS["campus_name"], max_length=100)
    academic_session: str = Field(default=DEFAULT_SCHOOL_SETTINGS["academic_session"], max_length=30)
    primary_color: str = DEFAULT_SCHOOL_SETTINGS["primary_color"]
    accent_color: str = DEFAULT_SCHOOL_SETTINGS["accent_color"]
    surface_color: str = DEFAULT_SCHOOL_SETTINGS["surface_color"]
    logo_data_url: str = ""
    splash_enabled: bool = True
    interface_language: str = "en"
    secondary_language: str = "ur"
    currency: str = "PKR"
    timezone: str = "Asia/Karachi"


def get_school_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalize_school_settings(settings: dict | None = None) -> dict:
    normalized = DEFAULT_SCHOOL_SETTINGS.copy()
    if not isinstance(settings, dict):
        return normalized

    for key in ("school_name", "campus_name", "academic_session"):
        value = str(settings.get(key) or "").strip()
        if value:
            normalized[key] = value[:100]

    for key in ("primary_color", "accent_color", "surface_color"):
        value = str(settings.get(key) or "").strip().lower()
        if re.fullmatch(r"#[0-9a-f]{6}", value):
            normalized[key] = value

    logo_data_url = str(settings.get("logo_data_url") or "").strip()
    if (
        logo_data_url
        and len(logo_data_url) <= 2_000_000
        and re.match(r"^data:image/(?:png|jpeg|webp|svg\+xml);base64,", logo_data_url)
    ):
        normalized["logo_data_url"] = logo_data_url

    normalized["splash_enabled"] = bool(settings.get("splash_enabled", True))
    interface_language = str(settings.get("interface_language") or "en").lower()
    normalized["interface_language"] = interface_language if interface_language in {"en", "ur"} else "en"
    secondary_language = str(settings.get("secondary_language") or "ur").lower()
    normalized["secondary_language"] = secondary_language if secondary_language in {"en", "ur"} else "ur"
    normalized["currency"] = "PKR"
    normalized["timezone"] = "Asia/Karachi"
    return normalized


def load_school_settings() -> dict:
    if SCHOOL_SETTINGS_FILE.exists():
        try:
            return normalize_school_settings(json.loads(SCHOOL_SETTINGS_FILE.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    return DEFAULT_SCHOOL_SETTINGS.copy()


def save_school_settings(settings: dict) -> dict:
    normalized = normalize_school_settings(settings)
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCHOOL_SETTINGS_FILE.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    return normalized


@router.get("/school/settings")
def get_school_settings(request: Request, db: Session = Depends(get_school_db)):
    require_school_permission(request, db, "view_dashboard")
    return load_school_settings()


@router.put("/school/settings")
def update_school_settings(
    payload: SchoolSettingsPayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    require_school_permission(request, db, "manage_branding")
    settings = save_school_settings(payload.model_dump())
    audit_school_action(
        db,
        request,
        "update",
        "SchoolBranding",
        "global",
        "Updated school branding and regional settings",
    )
    db.commit()
    return settings


def normalize_school_student_payload(payload: SchoolStudentCreate) -> dict:
    values = payload.model_dump()
    for field in ("student_name", "class_name"):
        values[field] = str(values.get(field) or "").strip()
        if not values[field]:
            raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').title()} is required")

    for field in (
        "father_name", "guardian_name", "guardian_phone", "date_of_birth", "gender",
        "section", "roll_number", "admission_date", "address", "notes", "photo_url",
        "b_form_no", "birth_certificate_no", "mother_name", "previous_school", "blood_group",
        "graduation_date", "withdrawal_date", "alumni_since",
    ):
        value = values.get(field)
        values[field] = str(value).strip() if value not in (None, "") else None

    values["admission_no"] = str(values.get("admission_no") or "").strip()
    allowed_statuses = {"Active", "Inactive", "Graduated", "Withdrawn", "Alumni"}
    status = str(values.get("status") or "Active").strip().title()
    values["status"] = status if status in allowed_statuses else "Active"
    values["preferred_language"] = "ur" if str(values.get("preferred_language") or "en").lower() == "ur" else "en"
    return values


@router.get("/school/students", response_model=list[SchoolStudentOut])
def get_school_students(
    request: Request,
    q: str | None = Query(default=None, max_length=150),
    status: str | None = Query(default=None, max_length=30),
    class_name: str | None = Query(default=None, max_length=80),
    campus_id: int | None = Query(default=None),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_students")
    query = db.query(SchoolStudent).filter(SchoolStudent.workspace_id == access["workspace"].id)
    if access["campus_ids"] is not None:
        query = query.filter(SchoolStudent.campus_id.in_(list(access["campus_ids"])))
    if campus_id is not None:
        if access["campus_ids"] is not None and campus_id not in access["campus_ids"]:
            raise HTTPException(status_code=403, detail="You do not have access to this campus.")
        query = query.filter(SchoolStudent.campus_id == campus_id)
    search = str(q or "").strip().lower()
    if search:
        pattern = f"%{search}%"
        query = query.filter(or_(
            func.lower(SchoolStudent.admission_no).like(pattern),
            func.lower(SchoolStudent.student_name).like(pattern),
            func.lower(func.coalesce(SchoolStudent.father_name, "")).like(pattern),
            func.lower(func.coalesce(SchoolStudent.guardian_name, "")).like(pattern),
            func.lower(func.coalesce(SchoolStudent.guardian_phone, "")).like(pattern),
        ))
    if status:
        query = query.filter(func.lower(SchoolStudent.status) == status.strip().lower())
    if class_name:
        query = query.filter(func.lower(SchoolStudent.class_name) == class_name.strip().lower())
    return query.order_by(SchoolStudent.student_name.asc(), SchoolStudent.id.asc()).all()


@router.post("/school/students", response_model=SchoolStudentOut)
def create_school_student(
    payload: SchoolStudentCreate,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_students")
    values = normalize_school_student_payload(payload)
    campus_id = values.get("campus_id")
    if access["campus_ids"] is not None:
        if campus_id is None and len(access["campus_ids"]) == 1:
            campus_id = next(iter(access["campus_ids"]))
            values["campus_id"] = campus_id
        if campus_id not in access["campus_ids"]:
            raise HTTPException(status_code=403, detail="You do not have access to this campus.")
    campus = db.query(SchoolCampus).filter(
        SchoolCampus.id == campus_id,
        SchoolCampus.workspace_id == access["workspace"].id,
    ).first()
    if not campus:
        raise HTTPException(status_code=400, detail="Select a valid campus.")
    if not values["admission_no"]:
        prefix = f"{(campus.code or 'DEA').upper()}-{datetime.now().year}-"
        highest = 0
        for (existing_number,) in db.query(SchoolStudent.admission_no).filter(
            SchoolStudent.workspace_id == access["workspace"].id
        ).all():
            match = re.search(r"(\d+)$", str(existing_number or ""))
            if match:
                highest = max(highest, int(match.group(1)))
        values["admission_no"] = f"{prefix}{str(highest + 1).zfill(4)}"
    academic_session = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.id == values.get("academic_session_id"),
        SchoolAcademicSession.workspace_id == access["workspace"].id,
    ).first()
    if not academic_session:
        raise HTTPException(status_code=400, detail="Select a valid academic session.")
    duplicate = db.query(SchoolStudent).filter(
        SchoolStudent.workspace_id == access["workspace"].id,
        func.lower(SchoolStudent.admission_no) == values["admission_no"].lower(),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Admission number already exists")

    student = SchoolStudent(workspace_id=access["workspace"].id, **values)
    db.add(student)
    db.flush()
    audit_school_action(db, request, "create", "SchoolStudent", student.id, f"Admitted student {student.student_name}")
    db.commit()
    db.refresh(student)
    return student


@router.put("/school/students/{student_id}", response_model=SchoolStudentOut)
def update_school_student(
    student_id: int,
    payload: SchoolStudentCreate,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_students")
    student = db.query(SchoolStudent).filter(
        SchoolStudent.id == student_id,
        SchoolStudent.workspace_id == access["workspace"].id,
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    values = normalize_school_student_payload(payload)
    campus_id = values.get("campus_id")
    if access["campus_ids"] is not None and campus_id not in access["campus_ids"]:
        raise HTTPException(status_code=403, detail="You do not have access to this campus.")
    if not db.query(SchoolCampus).filter(
        SchoolCampus.id == campus_id,
        SchoolCampus.workspace_id == access["workspace"].id,
    ).first():
        raise HTTPException(status_code=400, detail="Select a valid campus.")
    if not db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.id == values.get("academic_session_id"),
        SchoolAcademicSession.workspace_id == access["workspace"].id,
    ).first():
        raise HTTPException(status_code=400, detail="Select a valid academic session.")
    duplicate = db.query(SchoolStudent).filter(
        SchoolStudent.id != student_id,
        SchoolStudent.workspace_id == access["workspace"].id,
        func.lower(SchoolStudent.admission_no) == values["admission_no"].lower(),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Admission number already exists")
    for key, value in values.items():
        setattr(student, key, value)
    student.updated_at = datetime.utcnow()
    audit_school_action(db, request, "update", "SchoolStudent", student.id, f"Updated student {student.student_name}")
    db.commit()
    db.refresh(student)
    return student


@router.delete("/school/students/{student_id}")
def delete_school_student(
    student_id: int,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_students")
    student = db.query(SchoolStudent).filter(
        SchoolStudent.id == student_id,
        SchoolStudent.workspace_id == access["workspace"].id,
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if student.status != "Withdrawn":
        student.status = "Withdrawn"
        student.withdrawal_date = datetime.now().date().isoformat()
    student.archived_at = datetime.utcnow()
    db.add(SchoolStudentLifecycleEvent(
        workspace_id=student.workspace_id,
        student_id=student.id,
        event_type="Archived",
        event_date=datetime.now().date().isoformat(),
        from_campus_id=student.campus_id,
        to_campus_id=student.campus_id,
        from_class_name=student.class_name,
        to_class_name=student.class_name,
        from_section_name=student.section,
        to_section_name=student.section,
        reason="Student record archived from the register",
        recorded_by_user_id=access["user"].id,
    ))
    audit_school_action(db, request, "archive", "SchoolStudent", student.id, f"Archived student {student.student_name}")
    db.commit()
    return {"detail": "Student archived successfully. Its complete history was preserved."}
