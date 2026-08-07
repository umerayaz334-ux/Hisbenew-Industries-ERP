import csv
import io
import json
import re
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..database import SessionLocal
from ..models import (
    SchoolAcademicSession,
    SchoolAdmissionApplication,
    SchoolAdmissionFormField,
    SchoolCampus,
    SchoolClass,
    SchoolDocument,
    SchoolSection,
    SchoolStudent,
    SchoolStudentCertificate,
    SchoolStudentEmergencyContact,
    SchoolStudentEnrollment,
    SchoolStudentGuardian,
    SchoolStudentLifecycleEvent,
    SchoolStudentMedicalProfile,
    SchoolStudentSiblingLink,
)
from .foundation import (
    audit_school_action,
    ensure_campus_access,
    ensure_default_school_foundation,
    require_school_permission,
)
from ..security import sanitize_upload_filename


router = APIRouter(tags=["School Admissions and Students"])
STUDENT_UPLOAD_DIR = UPLOAD_DIR / "school-students"
ALLOWED_UPLOADS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
    ".jpg", ".jpeg", ".png", ".webp",
}
APPLICATION_STATUSES = {
    "Submitted", "Under Review", "Test Scheduled", "Test Completed",
    "Interview Scheduled", "Interview Completed", "Waitlisted", "Approved",
    "Rejected", "Admitted", "Withdrawn",
}
LIFECYCLE_TYPES = {
    "Promotion", "Campus Transfer", "Section Transfer", "Class Transfer",
    "Withdrawal", "Graduation", "Reactivation",
}
DEFAULT_ADMISSION_FIELDS = [
    ("student_name", "Student name", "طالب علم کا نام", "text", True),
    ("date_of_birth", "Date of birth", "تاریخ پیدائش", "date", True),
    ("gender", "Gender", "جنس", "select", True),
    ("b_form_no", "B-form number", "ب فارم نمبر", "text", False),
    ("father_name", "Father name", "والد کا نام", "text", True),
    ("mother_name", "Mother name", "والدہ کا نام", "text", False),
    ("guardian_phone", "Guardian phone", "سرپرست فون", "tel", True),
    ("address", "Home address", "گھر کا پتہ", "textarea", True),
    ("previous_school", "Previous school", "سابقہ اسکول", "text", False),
    ("medical_conditions", "Medical conditions", "طبی کیفیت", "textarea", False),
]


def get_school_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def model_dict(instance) -> dict:
    return {column.name: getattr(instance, column.name) for column in instance.__table__.columns}


def clean_text(value, maximum: int | None = None):
    if value in (None, ""):
        return None
    normalized = str(value).strip()
    return normalized[:maximum] if maximum else normalized


def json_value(value, fallback):
    try:
        parsed = json.loads(value or "")
        return parsed
    except (TypeError, json.JSONDecodeError):
        return fallback


def today_string() -> str:
    return datetime.now().date().isoformat()


def ensure_default_admission_fields(db: Session, workspace_id: int) -> list[SchoolAdmissionFormField]:
    fields = db.query(SchoolAdmissionFormField).filter(
        SchoolAdmissionFormField.workspace_id == workspace_id
    ).order_by(SchoolAdmissionFormField.display_order, SchoolAdmissionFormField.id).all()
    if fields:
        return fields
    for index, (key, label, label_ur, input_type, required) in enumerate(DEFAULT_ADMISSION_FIELDS, 1):
        options = ["Male", "Female", "Other"] if key == "gender" else []
        db.add(SchoolAdmissionFormField(
            workspace_id=workspace_id,
            field_key=key,
            label=label,
            label_ur=label_ur,
            input_type=input_type,
            options_json=json.dumps(options),
            is_required=required,
            is_active=True,
            display_order=index * 10,
        ))
    db.flush()
    return db.query(SchoolAdmissionFormField).filter(
        SchoolAdmissionFormField.workspace_id == workspace_id
    ).order_by(SchoolAdmissionFormField.display_order, SchoolAdmissionFormField.id).all()


def serialize_form_field(field: SchoolAdmissionFormField) -> dict:
    value = model_dict(field)
    value["options"] = json_value(value.pop("options_json", None), [])
    return value


def next_number(db: Session, model, column, workspace_id: int, prefix: str, width: int = 5) -> str:
    existing = db.query(column).filter(model.workspace_id == workspace_id).all()
    highest = 0
    for (value,) in existing:
        match = re.search(r"(\d+)$", str(value or ""))
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}{str(highest + 1).zfill(width)}"


def next_application_number(db: Session, workspace_id: int) -> str:
    return next_number(
        db, SchoolAdmissionApplication, SchoolAdmissionApplication.application_no,
        workspace_id, f"APP-{datetime.now().year}-", 5,
    )


def next_admission_number(db: Session, workspace_id: int, campus: SchoolCampus) -> str:
    prefix = f"{(campus.code or 'DEA').upper()}-{datetime.now().year}-"
    return next_number(db, SchoolStudent, SchoolStudent.admission_no, workspace_id, prefix, 4)


def next_roll_number(
    db: Session,
    workspace_id: int,
    academic_session_id: int,
    class_name: str,
    section_name: str | None,
) -> str:
    query = db.query(SchoolStudent.roll_number).filter(
        SchoolStudent.workspace_id == workspace_id,
        SchoolStudent.academic_session_id == academic_session_id,
        func.lower(SchoolStudent.class_name) == class_name.lower(),
    )
    if section_name:
        query = query.filter(func.lower(func.coalesce(SchoolStudent.section, "")) == section_name.lower())
    highest = 0
    for (value,) in query.all():
        match = re.search(r"(\d+)$", str(value or ""))
        if match:
            highest = max(highest, int(match.group(1)))
    return str(highest + 1).zfill(3)


def campus_for_workspace(db: Session, workspace_id: int, campus_id: int) -> SchoolCampus:
    campus = db.query(SchoolCampus).filter(
        SchoolCampus.id == campus_id,
        SchoolCampus.workspace_id == workspace_id,
        SchoolCampus.is_active == True,
    ).first()
    if not campus:
        raise HTTPException(status_code=400, detail="Select a valid campus.")
    return campus


def session_for_workspace(db: Session, workspace_id: int, session_id: int) -> SchoolAcademicSession:
    session = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.id == session_id,
        SchoolAcademicSession.workspace_id == workspace_id,
    ).first()
    if not session:
        raise HTTPException(status_code=400, detail="Select a valid academic session.")
    return session


def class_and_section(
    db: Session,
    workspace_id: int,
    campus_id: int,
    school_class_id: int | None,
    school_section_id: int | None,
) -> tuple[SchoolClass | None, SchoolSection | None]:
    school_class = None
    section = None
    if school_class_id:
        school_class = db.query(SchoolClass).filter(
            SchoolClass.id == school_class_id,
            SchoolClass.workspace_id == workspace_id,
            SchoolClass.campus_id == campus_id,
        ).first()
        if not school_class:
            raise HTTPException(status_code=400, detail="Select a valid class for this campus.")
    if school_section_id:
        if not school_class:
            raise HTTPException(status_code=400, detail="Select a class before selecting a section.")
        section = db.query(SchoolSection).filter(
            SchoolSection.id == school_section_id,
            SchoolSection.workspace_id == workspace_id,
            SchoolSection.school_class_id == school_class.id,
        ).first()
        if not section:
            raise HTTPException(status_code=400, detail="Select a valid section for this class.")
    return school_class, section


def application_for_access(db: Session, access: dict, application_id: int) -> SchoolAdmissionApplication:
    application = db.query(SchoolAdmissionApplication).filter(
        SchoolAdmissionApplication.id == application_id,
        SchoolAdmissionApplication.workspace_id == access["workspace"].id,
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Admission application not found.")
    ensure_campus_access(access, application.campus_id)
    return application


def student_for_access(db: Session, access: dict, student_id: int) -> SchoolStudent:
    student = db.query(SchoolStudent).filter(
        SchoolStudent.id == student_id,
        SchoolStudent.workspace_id == access["workspace"].id,
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    ensure_campus_access(access, student.campus_id)
    return student


def create_lifecycle_event(
    db: Session,
    access: dict,
    student: SchoolStudent,
    event_type: str,
    event_date: str,
    **values,
) -> SchoolStudentLifecycleEvent:
    event = SchoolStudentLifecycleEvent(
        workspace_id=access["workspace"].id,
        student_id=student.id,
        event_type=event_type,
        event_date=event_date,
        recorded_by_user_id=access["user"].id,
        **values,
    )
    db.add(event)
    return event


def create_enrollment(
    db: Session,
    workspace_id: int,
    student: SchoolStudent,
    start_date: str,
    reason: str,
) -> SchoolStudentEnrollment:
    enrollment = SchoolStudentEnrollment(
        workspace_id=workspace_id,
        student_id=student.id,
        campus_id=student.campus_id,
        academic_session_id=student.academic_session_id,
        school_class_id=student.school_class_id,
        school_section_id=student.school_section_id,
        class_name=student.class_name,
        section_name=student.section,
        roll_number=student.roll_number,
        status="Active",
        start_date=start_date,
        reason=reason,
    )
    db.add(enrollment)
    return enrollment


def close_current_enrollments(db: Session, student_id: int, event_date: str, reason: str):
    current = db.query(SchoolStudentEnrollment).filter(
        SchoolStudentEnrollment.student_id == student_id,
        SchoolStudentEnrollment.status == "Active",
    ).all()
    for enrollment in current:
        enrollment.status = "Completed"
        enrollment.end_date = event_date
        enrollment.reason = reason
        enrollment.updated_at = datetime.utcnow()


class AdmissionPayload(BaseModel):
    campus_id: int
    academic_session_id: int
    school_class_id: int | None = None
    school_section_id: int | None = None
    source: str = Field(default="Office", max_length=20)
    student_name: str = Field(min_length=1, max_length=150)
    date_of_birth: str | None = Field(default=None, max_length=20)
    gender: str | None = Field(default=None, max_length=30)
    b_form_no: str | None = Field(default=None, max_length=50)
    birth_certificate_no: str | None = Field(default=None, max_length=80)
    father_name: str | None = Field(default=None, max_length=150)
    mother_name: str | None = Field(default=None, max_length=150)
    guardian_name: str | None = Field(default=None, max_length=150)
    guardian_phone: str | None = Field(default=None, max_length=50)
    guardian_email: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=1000)
    previous_school: str | None = Field(default=None, max_length=200)
    medical_conditions: str | None = Field(default=None, max_length=2000)
    allergies: str | None = Field(default=None, max_length=2000)
    special_requirements: str | None = Field(default=None, max_length=2000)
    emergency_contact_name: str | None = Field(default=None, max_length=150)
    emergency_contact_phone: str | None = Field(default=None, max_length=50)
    custom_answers: dict = Field(default_factory=dict)


class AdmissionTransitionPayload(BaseModel):
    status: str = Field(min_length=1, max_length=40)
    test_scheduled_at: str | None = Field(default=None, max_length=40)
    test_venue: str | None = Field(default=None, max_length=150)
    test_score: float | None = Field(default=None, ge=0, le=1000)
    test_result: str | None = Field(default=None, max_length=80)
    interview_scheduled_at: str | None = Field(default=None, max_length=40)
    interviewer: str | None = Field(default=None, max_length=150)
    interview_result: str | None = Field(default=None, max_length=80)
    review_notes: str | None = Field(default=None, max_length=3000)
    rejection_reason: str | None = Field(default=None, max_length=1000)
    school_class_id: int | None = None
    school_section_id: int | None = None


class AdmissionFieldPayload(BaseModel):
    campus_id: int | None = None
    field_key: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=120)
    label_ur: str | None = Field(default=None, max_length=180)
    input_type: str = Field(default="text", max_length=30)
    options: list[str] = Field(default_factory=list)
    is_required: bool = False
    is_active: bool = True
    display_order: int = Field(default=0, ge=0, le=10000)


class StudentProfilePayload(BaseModel):
    student_name: str | None = Field(default=None, max_length=150)
    father_name: str | None = Field(default=None, max_length=150)
    mother_name: str | None = Field(default=None, max_length=150)
    guardian_name: str | None = Field(default=None, max_length=150)
    guardian_phone: str | None = Field(default=None, max_length=50)
    date_of_birth: str | None = Field(default=None, max_length=20)
    gender: str | None = Field(default=None, max_length=30)
    b_form_no: str | None = Field(default=None, max_length=50)
    birth_certificate_no: str | None = Field(default=None, max_length=80)
    previous_school: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=1000)
    preferred_language: str | None = Field(default=None, max_length=10)
    family_discount_percent: float | None = Field(default=None, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=3000)


class GuardianPayload(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    relationship_type: str = Field(default="Guardian", max_length=40)
    cnic: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=50)
    alternate_phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=120)
    occupation: str | None = Field(default=None, max_length=120)
    employer: str | None = Field(default=None, max_length=150)
    address: str | None = Field(default=None, max_length=500)
    is_primary: bool = False
    is_authorized_pickup: bool = True
    receives_notifications: bool = True


class EmergencyContactPayload(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    relationship_type: str | None = Field(default=None, max_length=40)
    phone: str = Field(min_length=1, max_length=50)
    alternate_phone: str | None = Field(default=None, max_length=50)
    priority: int = Field(default=1, ge=1, le=20)
    notes: str | None = Field(default=None, max_length=500)


class SiblingPayload(BaseModel):
    sibling_student_id: int
    family_discount_percent: float = Field(default=0, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=500)


class MedicalPayload(BaseModel):
    blood_group: str | None = Field(default=None, max_length=20)
    medical_conditions: str | None = Field(default=None, max_length=2000)
    allergies: str | None = Field(default=None, max_length=2000)
    medications: str | None = Field(default=None, max_length=2000)
    disabilities: str | None = Field(default=None, max_length=2000)
    special_requirements: str | None = Field(default=None, max_length=2000)
    doctor_name: str | None = Field(default=None, max_length=150)
    doctor_phone: str | None = Field(default=None, max_length=50)
    health_notes: str | None = Field(default=None, max_length=3000)


class LifecyclePayload(BaseModel):
    event_type: str = Field(min_length=1, max_length=40)
    event_date: str = Field(default_factory=today_string, max_length=20)
    campus_id: int | None = None
    academic_session_id: int | None = None
    school_class_id: int | None = None
    school_section_id: int | None = None
    reason: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class CertificatePayload(BaseModel):
    certificate_type: str = Field(min_length=1, max_length=50)
    issue_date: str = Field(default_factory=today_string, max_length=20)
    purpose: str | None = Field(default=None, max_length=300)
    conduct: str | None = Field(default="Good", max_length=100)
    remarks: str | None = Field(default=None, max_length=1000)


def application_values(payload: AdmissionPayload, source: str | None = None) -> dict:
    values = payload.model_dump()
    values["student_name"] = clean_text(values["student_name"], 150)
    values["source"] = (source or values.get("source") or "Office").title()
    values["custom_answers_json"] = json.dumps(values.pop("custom_answers", {}), ensure_ascii=False)
    for key, value in list(values.items()):
        if isinstance(value, str):
            values[key] = clean_text(value)
    return values


def public_form_snapshot(db: Session, campus_id: int | None = None) -> dict:
    workspace = ensure_default_school_foundation(db)
    fields = ensure_default_admission_fields(db, workspace.id)
    campuses_query = db.query(SchoolCampus).filter(
        SchoolCampus.workspace_id == workspace.id,
        SchoolCampus.is_active == True,
    )
    campuses = campuses_query.order_by(SchoolCampus.name).all()
    allowed_campus_ids = {campus.id for campus in campuses}
    if campus_id and campus_id not in allowed_campus_ids:
        raise HTTPException(status_code=404, detail="Campus not found.")
    sessions = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.workspace_id == workspace.id,
    ).order_by(SchoolAcademicSession.is_current.desc(), SchoolAcademicSession.start_date.desc()).all()
    classes_query = db.query(SchoolClass).filter(
        SchoolClass.workspace_id == workspace.id,
        SchoolClass.is_active == True,
    )
    if campus_id:
        classes_query = classes_query.filter(SchoolClass.campus_id == campus_id)
    classes = classes_query.order_by(SchoolClass.display_order, SchoolClass.name).all()
    sections = db.query(SchoolSection).filter(
        SchoolSection.workspace_id == workspace.id,
        SchoolSection.is_active == True,
    ).order_by(SchoolSection.name).all()
    return {
        "workspace": model_dict(workspace),
        "campuses": [model_dict(item) for item in campuses],
        "sessions": [model_dict(item) for item in sessions],
        "classes": [model_dict(item) for item in classes],
        "sections": [model_dict(item) for item in sections],
        "fields": [serialize_form_field(item) for item in fields if item.is_active and (not item.campus_id or item.campus_id == campus_id)],
    }


@router.get("/school/admissions/public/form")
def get_public_admission_form(
    campus_id: int | None = Query(default=None),
    db: Session = Depends(get_school_db),
):
    snapshot = public_form_snapshot(db, campus_id)
    db.commit()
    return snapshot


@router.post("/school/admissions/public/apply")
def submit_public_admission(payload: AdmissionPayload, db: Session = Depends(get_school_db)):
    workspace = ensure_default_school_foundation(db)
    campus_for_workspace(db, workspace.id, payload.campus_id)
    session_for_workspace(db, workspace.id, payload.academic_session_id)
    class_and_section(db, workspace.id, payload.campus_id, payload.school_class_id, payload.school_section_id)
    values = application_values(payload, "Online")
    application = SchoolAdmissionApplication(
        workspace_id=workspace.id,
        application_no=next_application_number(db, workspace.id),
        status="Submitted",
        created_by_user_id=None,
        updated_by_user_id=None,
        **values,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return {
        "id": application.id,
        "application_no": application.application_no,
        "status": application.status,
        "message": "Your admission application has been submitted.",
    }


def serialize_application(db: Session, application: SchoolAdmissionApplication) -> dict:
    value = model_dict(application)
    value["custom_answers"] = json_value(value.pop("custom_answers_json", None), {})
    campus = db.query(SchoolCampus).filter(SchoolCampus.id == application.campus_id).first()
    session = db.query(SchoolAcademicSession).filter(SchoolAcademicSession.id == application.academic_session_id).first()
    school_class = db.query(SchoolClass).filter(SchoolClass.id == application.school_class_id).first() if application.school_class_id else None
    section = db.query(SchoolSection).filter(SchoolSection.id == application.school_section_id).first() if application.school_section_id else None
    value.update({
        "campus_name": campus.name if campus else None,
        "session_name": session.name if session else None,
        "class_name": school_class.name if school_class else None,
        "section_name": section.name if section else None,
        "documents": [
            model_dict(document) for document in db.query(SchoolDocument).filter(
                SchoolDocument.workspace_id == application.workspace_id,
                SchoolDocument.entity_type == "AdmissionApplication",
                SchoolDocument.entity_id == application.id,
            ).order_by(SchoolDocument.created_at.desc()).all()
        ],
    })
    return value


@router.get("/school/admissions")
def admissions_snapshot(
    request: Request,
    q: str | None = Query(default=None, max_length=150),
    status: str | None = Query(default=None, max_length=40),
    campus_id: int | None = Query(default=None),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_admissions")
    workspace_id = access["workspace"].id
    ensure_default_admission_fields(db, workspace_id)
    query = db.query(SchoolAdmissionApplication).filter(
        SchoolAdmissionApplication.workspace_id == workspace_id
    )
    if access["campus_ids"] is not None:
        query = query.filter(SchoolAdmissionApplication.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        ensure_campus_access(access, campus_id)
        query = query.filter(SchoolAdmissionApplication.campus_id == campus_id)
    if status and status != "All":
        query = query.filter(SchoolAdmissionApplication.status == status)
    search = clean_text(q)
    if search:
        pattern = f"%{search.lower()}%"
        query = query.filter(or_(
            func.lower(SchoolAdmissionApplication.application_no).like(pattern),
            func.lower(SchoolAdmissionApplication.student_name).like(pattern),
            func.lower(func.coalesce(SchoolAdmissionApplication.guardian_phone, "")).like(pattern),
            func.lower(func.coalesce(SchoolAdmissionApplication.b_form_no, "")).like(pattern),
        ))
    applications = query.order_by(SchoolAdmissionApplication.created_at.desc()).all()
    all_statuses = db.query(
        SchoolAdmissionApplication.status,
        func.count(SchoolAdmissionApplication.id),
    ).filter(SchoolAdmissionApplication.workspace_id == workspace_id)
    if access["campus_ids"] is not None:
        all_statuses = all_statuses.filter(SchoolAdmissionApplication.campus_id.in_(list(access["campus_ids"])))
    counts = {row[0]: row[1] for row in all_statuses.group_by(SchoolAdmissionApplication.status).all()}
    db.commit()
    return {
        "applications": [serialize_application(db, item) for item in applications],
        "counts": counts,
        "form_fields": [serialize_form_field(item) for item in db.query(SchoolAdmissionFormField).filter(
            SchoolAdmissionFormField.workspace_id == workspace_id
        ).order_by(SchoolAdmissionFormField.display_order, SchoolAdmissionFormField.id).all()],
        "statuses": sorted(APPLICATION_STATUSES),
    }


@router.post("/school/admissions")
def create_office_admission(
    payload: AdmissionPayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_admissions")
    workspace_id = access["workspace"].id
    ensure_campus_access(access, payload.campus_id)
    campus_for_workspace(db, workspace_id, payload.campus_id)
    session_for_workspace(db, workspace_id, payload.academic_session_id)
    class_and_section(db, workspace_id, payload.campus_id, payload.school_class_id, payload.school_section_id)
    application = SchoolAdmissionApplication(
        workspace_id=workspace_id,
        application_no=next_application_number(db, workspace_id),
        status="Submitted",
        created_by_user_id=access["user"].id,
        updated_by_user_id=access["user"].id,
        **application_values(payload, "Office"),
    )
    db.add(application)
    db.flush()
    audit_school_action(db, request, "create", "SchoolAdmissionApplication", application.id, f"Created admission application {application.application_no}")
    db.commit()
    return serialize_application(db, application)


@router.put("/school/admissions/{application_id}")
def update_admission_application(
    application_id: int,
    payload: AdmissionPayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_admissions")
    application = application_for_access(db, access, application_id)
    if application.status == "Admitted":
        raise HTTPException(status_code=409, detail="An admitted application must be edited from the student profile.")
    ensure_campus_access(access, payload.campus_id)
    campus_for_workspace(db, access["workspace"].id, payload.campus_id)
    session_for_workspace(db, access["workspace"].id, payload.academic_session_id)
    class_and_section(db, access["workspace"].id, payload.campus_id, payload.school_class_id, payload.school_section_id)
    values = application_values(payload)
    for key, value in values.items():
        setattr(application, key, value)
    application.updated_by_user_id = access["user"].id
    application.updated_at = datetime.utcnow()
    audit_school_action(db, request, "update", "SchoolAdmissionApplication", application.id, f"Updated admission application {application.application_no}")
    db.commit()
    return serialize_application(db, application)


def admit_application(db: Session, access: dict, application: SchoolAdmissionApplication, transition: AdmissionTransitionPayload) -> SchoolStudent:
    if application.admitted_student_id:
        student = db.query(SchoolStudent).filter(SchoolStudent.id == application.admitted_student_id).first()
        if student:
            return student
    class_id = transition.school_class_id or application.school_class_id
    section_id = transition.school_section_id if transition.school_section_id is not None else application.school_section_id
    school_class, section = class_and_section(db, application.workspace_id, application.campus_id, class_id, section_id)
    if not school_class:
        raise HTTPException(status_code=400, detail="Assign a class before admitting this applicant.")
    campus = campus_for_workspace(db, application.workspace_id, application.campus_id)
    admission_no = next_admission_number(db, application.workspace_id, campus)
    roll_number = next_roll_number(
        db, application.workspace_id, application.academic_session_id,
        school_class.name, section.name if section else None,
    )
    student = SchoolStudent(
        workspace_id=application.workspace_id,
        campus_id=application.campus_id,
        academic_session_id=application.academic_session_id,
        school_class_id=school_class.id,
        school_section_id=section.id if section else None,
        application_id=application.id,
        admission_no=admission_no,
        student_name=application.student_name,
        father_name=application.father_name,
        mother_name=application.mother_name,
        guardian_name=application.guardian_name,
        guardian_phone=application.guardian_phone,
        date_of_birth=application.date_of_birth,
        gender=application.gender,
        b_form_no=application.b_form_no,
        birth_certificate_no=application.birth_certificate_no,
        previous_school=application.previous_school,
        class_name=school_class.name,
        section=section.name if section else None,
        roll_number=roll_number,
        admission_date=today_string(),
        address=application.address,
        status="Active",
        preferred_language="en",
    )
    db.add(student)
    db.flush()
    application.admitted_student_id = student.id
    application.school_class_id = school_class.id
    application.school_section_id = section.id if section else None
    application.status = "Admitted"
    application.approved_at = application.approved_at or datetime.utcnow()

    if application.guardian_name or application.father_name:
        db.add(SchoolStudentGuardian(
            workspace_id=application.workspace_id,
            student_id=student.id,
            full_name=application.guardian_name or application.father_name,
            relationship_type="Guardian" if application.guardian_name else "Father",
            phone=application.guardian_phone,
            email=application.guardian_email,
            address=application.address,
            is_primary=True,
        ))
    if application.emergency_contact_name and application.emergency_contact_phone:
        db.add(SchoolStudentEmergencyContact(
            workspace_id=application.workspace_id,
            student_id=student.id,
            full_name=application.emergency_contact_name,
            phone=application.emergency_contact_phone,
            priority=1,
        ))
    if application.medical_conditions or application.allergies or application.special_requirements:
        db.add(SchoolStudentMedicalProfile(
            workspace_id=application.workspace_id,
            student_id=student.id,
            medical_conditions=application.medical_conditions,
            allergies=application.allergies,
            special_requirements=application.special_requirements,
            updated_by_user_id=access["user"].id,
        ))
    create_enrollment(db, application.workspace_id, student, student.admission_date, "Admission")
    create_lifecycle_event(
        db, access, student, "Admission", student.admission_date,
        to_campus_id=student.campus_id,
        to_class_name=student.class_name,
        to_section_name=student.section,
        reason=f"Admitted from application {application.application_no}",
    )
    documents = db.query(SchoolDocument).filter(
        SchoolDocument.workspace_id == application.workspace_id,
        SchoolDocument.entity_type == "AdmissionApplication",
        SchoolDocument.entity_id == application.id,
    ).all()
    for document in documents:
        document.entity_type = "Student"
        document.entity_id = student.id
        if document.category.lower() in {"photograph", "photo", "student photo"} and not student.photo_url:
            student.photo_url = document.file_url
    return student


@router.post("/school/admissions/{application_id}/transition")
def transition_admission_application(
    application_id: int,
    payload: AdmissionTransitionPayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_admissions")
    application = application_for_access(db, access, application_id)
    target = payload.status.strip().title()
    normalized = {value.lower(): value for value in APPLICATION_STATUSES}.get(target.lower())
    if not normalized:
        raise HTTPException(status_code=400, detail="Select a valid application status.")
    values = payload.model_dump(exclude={"status", "school_class_id", "school_section_id"}, exclude_unset=True)
    for key, value in values.items():
        setattr(application, key, clean_text(value) if isinstance(value, str) else value)
    application.status = normalized
    application.reviewed_at = datetime.utcnow()
    application.updated_by_user_id = access["user"].id
    if normalized in {"Approved", "Admitted"}:
        application.approved_at = datetime.utcnow()
    student = admit_application(db, access, application, payload) if normalized == "Admitted" else None
    audit_school_action(
        db, request, "transition", "SchoolAdmissionApplication", application.id,
        f"Moved {application.application_no} to {normalized}",
        {"student_id": student.id if student else None},
    )
    db.commit()
    db.refresh(application)
    return {"application": serialize_application(db, application), "student": model_dict(student) if student else None}


@router.post("/school/admissions/form-fields")
def create_admission_field(
    payload: AdmissionFieldPayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_admissions")
    ensure_campus_access(access, payload.campus_id)
    duplicate = db.query(SchoolAdmissionFormField).filter(
        SchoolAdmissionFormField.workspace_id == access["workspace"].id,
        func.lower(SchoolAdmissionFormField.field_key) == payload.field_key.strip().lower(),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This admission field key already exists.")
    values = payload.model_dump()
    values["field_key"] = re.sub(r"[^a-z0-9_]+", "_", values["field_key"].strip().lower()).strip("_")
    values["options_json"] = json.dumps(values.pop("options"), ensure_ascii=False)
    field = SchoolAdmissionFormField(workspace_id=access["workspace"].id, **values)
    db.add(field)
    db.flush()
    audit_school_action(db, request, "create", "SchoolAdmissionFormField", field.id, f"Added admission form field {field.label}")
    db.commit()
    return serialize_form_field(field)


@router.put("/school/admissions/form-fields/{field_id}")
def update_admission_field(
    field_id: int,
    payload: AdmissionFieldPayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_admissions")
    field = db.query(SchoolAdmissionFormField).filter(
        SchoolAdmissionFormField.id == field_id,
        SchoolAdmissionFormField.workspace_id == access["workspace"].id,
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Admission field not found.")
    ensure_campus_access(access, payload.campus_id)
    values = payload.model_dump()
    values["field_key"] = re.sub(r"[^a-z0-9_]+", "_", values["field_key"].strip().lower()).strip("_")
    values["options_json"] = json.dumps(values.pop("options"), ensure_ascii=False)
    for key, value in values.items():
        setattr(field, key, value)
    field.updated_at = datetime.utcnow()
    audit_school_action(db, request, "update", "SchoolAdmissionFormField", field.id, f"Updated admission form field {field.label}")
    db.commit()
    return serialize_form_field(field)


@router.delete("/school/admissions/form-fields/{field_id}")
def deactivate_admission_field(
    field_id: int,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_admissions")
    field = db.query(SchoolAdmissionFormField).filter(
        SchoolAdmissionFormField.id == field_id,
        SchoolAdmissionFormField.workspace_id == access["workspace"].id,
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Admission field not found.")
    field.is_active = False
    audit_school_action(db, request, "archive", "SchoolAdmissionFormField", field.id, f"Disabled admission form field {field.label}")
    db.commit()
    return {"detail": "Admission field disabled."}


def serialize_student_summary(db: Session, student: SchoolStudent) -> dict:
    value = model_dict(student)
    campus = db.query(SchoolCampus).filter(SchoolCampus.id == student.campus_id).first()
    session = db.query(SchoolAcademicSession).filter(SchoolAcademicSession.id == student.academic_session_id).first()
    value["campus_name"] = campus.name if campus else None
    value["session_name"] = session.name if session else None
    value["guardian_count"] = db.query(SchoolStudentGuardian).filter(SchoolStudentGuardian.student_id == student.id).count()
    value["document_count"] = db.query(SchoolDocument).filter(
        SchoolDocument.workspace_id == student.workspace_id,
        SchoolDocument.entity_type == "Student",
        SchoolDocument.entity_id == student.id,
    ).count()
    return value


@router.get("/school/student-information")
def student_information_list(
    request: Request,
    q: str | None = Query(default=None, max_length=150),
    status: str | None = Query(default=None, max_length=30),
    campus_id: int | None = Query(default=None),
    include_archived: bool = Query(default=True),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_students")
    query = db.query(SchoolStudent).filter(SchoolStudent.workspace_id == access["workspace"].id)
    if access["campus_ids"] is not None:
        query = query.filter(SchoolStudent.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        ensure_campus_access(access, campus_id)
        query = query.filter(SchoolStudent.campus_id == campus_id)
    if status and status != "All":
        query = query.filter(SchoolStudent.status == status)
    if not include_archived:
        query = query.filter(SchoolStudent.archived_at.is_(None))
    if q:
        pattern = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            func.lower(SchoolStudent.student_name).like(pattern),
            func.lower(SchoolStudent.admission_no).like(pattern),
            func.lower(func.coalesce(SchoolStudent.b_form_no, "")).like(pattern),
            func.lower(func.coalesce(SchoolStudent.guardian_phone, "")).like(pattern),
        ))
    students = query.order_by(SchoolStudent.student_name, SchoolStudent.id).all()
    return [serialize_student_summary(db, student) for student in students]


@router.get("/school/student-information/{student_id}")
def get_student_information(
    student_id: int,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_students")
    student = student_for_access(db, access, student_id)
    sibling_links = db.query(SchoolStudentSiblingLink).filter(or_(
        SchoolStudentSiblingLink.student_id == student.id,
        SchoolStudentSiblingLink.sibling_student_id == student.id,
    )).all()
    siblings = []
    for link in sibling_links:
        sibling_id = link.sibling_student_id if link.student_id == student.id else link.student_id
        sibling = db.query(SchoolStudent).filter(SchoolStudent.id == sibling_id).first()
        if sibling:
            siblings.append({**serialize_student_summary(db, sibling), "link_id": link.id, "family_discount_percent": link.family_discount_percent, "link_notes": link.notes})
    return {
        "student": serialize_student_summary(db, student),
        "guardians": [model_dict(item) for item in db.query(SchoolStudentGuardian).filter(SchoolStudentGuardian.student_id == student.id).order_by(SchoolStudentGuardian.is_primary.desc(), SchoolStudentGuardian.id).all()],
        "emergency_contacts": [model_dict(item) for item in db.query(SchoolStudentEmergencyContact).filter(SchoolStudentEmergencyContact.student_id == student.id).order_by(SchoolStudentEmergencyContact.priority, SchoolStudentEmergencyContact.id).all()],
        "siblings": siblings,
        "medical": model_dict(db.query(SchoolStudentMedicalProfile).filter(SchoolStudentMedicalProfile.student_id == student.id).first()) if db.query(SchoolStudentMedicalProfile).filter(SchoolStudentMedicalProfile.student_id == student.id).first() else None,
        "enrollments": [model_dict(item) for item in db.query(SchoolStudentEnrollment).filter(SchoolStudentEnrollment.student_id == student.id).order_by(SchoolStudentEnrollment.start_date.desc(), SchoolStudentEnrollment.id.desc()).all()],
        "history": [model_dict(item) for item in db.query(SchoolStudentLifecycleEvent).filter(SchoolStudentLifecycleEvent.student_id == student.id).order_by(SchoolStudentLifecycleEvent.event_date.desc(), SchoolStudentLifecycleEvent.id.desc()).all()],
        "documents": [model_dict(item) for item in db.query(SchoolDocument).filter(SchoolDocument.workspace_id == student.workspace_id, SchoolDocument.entity_type == "Student", SchoolDocument.entity_id == student.id).order_by(SchoolDocument.created_at.desc()).all()],
        "certificates": [model_dict(item) for item in db.query(SchoolStudentCertificate).filter(SchoolStudentCertificate.student_id == student.id).order_by(SchoolStudentCertificate.created_at.desc()).all()],
    }


@router.put("/school/student-information/{student_id}")
def update_student_information(
    student_id: int,
    payload: StudentProfilePayload,
    request: Request,
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    before = {key: getattr(student, key) for key in payload.model_dump(exclude_unset=True)}
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "preferred_language":
            value = "ur" if value == "ur" else "en"
        setattr(student, key, clean_text(value) if isinstance(value, str) else value)
    if not clean_text(student.student_name):
        raise HTTPException(status_code=400, detail="Student name is required.")
    student.updated_at = datetime.utcnow()
    create_lifecycle_event(db, access, student, "Profile Updated", today_string(), metadata_json=json.dumps({"before": before}, default=str))
    audit_school_action(db, request, "update", "SchoolStudent", student.id, f"Updated profile for {student.student_name}")
    db.commit()
    return serialize_student_summary(db, student)


def set_primary_guardian(db: Session, student_id: int, guardian_id: int):
    db.query(SchoolStudentGuardian).filter(SchoolStudentGuardian.student_id == student_id).update({SchoolStudentGuardian.is_primary: False}, synchronize_session=False)
    db.query(SchoolStudentGuardian).filter(SchoolStudentGuardian.id == guardian_id).update({SchoolStudentGuardian.is_primary: True}, synchronize_session=False)


@router.post("/school/student-information/{student_id}/guardians")
def create_guardian(student_id: int, payload: GuardianPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    guardian = SchoolStudentGuardian(workspace_id=student.workspace_id, student_id=student.id, **payload.model_dump())
    db.add(guardian)
    db.flush()
    if guardian.is_primary:
        set_primary_guardian(db, student.id, guardian.id)
        student.guardian_name = guardian.full_name
        student.guardian_phone = guardian.phone
    create_lifecycle_event(db, access, student, "Guardian Added", today_string(), notes=f"Added {guardian.full_name} as {guardian.relationship_type}")
    db.commit()
    return model_dict(guardian)


@router.put("/school/student-information/{student_id}/guardians/{guardian_id}")
def update_guardian(student_id: int, guardian_id: int, payload: GuardianPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    guardian = db.query(SchoolStudentGuardian).filter(SchoolStudentGuardian.id == guardian_id, SchoolStudentGuardian.student_id == student.id).first()
    if not guardian:
        raise HTTPException(status_code=404, detail="Guardian not found.")
    for key, value in payload.model_dump().items():
        setattr(guardian, key, value)
    if guardian.is_primary:
        set_primary_guardian(db, student.id, guardian.id)
        student.guardian_name = guardian.full_name
        student.guardian_phone = guardian.phone
    guardian.updated_at = datetime.utcnow()
    create_lifecycle_event(db, access, student, "Guardian Updated", today_string(), notes=f"Updated {guardian.full_name}")
    db.commit()
    return model_dict(guardian)


@router.delete("/school/student-information/{student_id}/guardians/{guardian_id}")
def delete_guardian(student_id: int, guardian_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    guardian = db.query(SchoolStudentGuardian).filter(SchoolStudentGuardian.id == guardian_id, SchoolStudentGuardian.student_id == student.id).first()
    if not guardian:
        raise HTTPException(status_code=404, detail="Guardian not found.")
    create_lifecycle_event(db, access, student, "Guardian Removed", today_string(), notes=f"Removed {guardian.full_name}")
    db.delete(guardian)
    db.commit()
    return {"detail": "Guardian removed."}


@router.post("/school/student-information/{student_id}/emergency-contacts")
def create_emergency_contact(student_id: int, payload: EmergencyContactPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    contact = SchoolStudentEmergencyContact(workspace_id=student.workspace_id, student_id=student.id, **payload.model_dump())
    db.add(contact)
    create_lifecycle_event(db, access, student, "Emergency Contact Added", today_string(), notes=f"Added {contact.full_name}")
    db.commit()
    db.refresh(contact)
    return model_dict(contact)


@router.delete("/school/student-information/{student_id}/emergency-contacts/{contact_id}")
def delete_emergency_contact(student_id: int, contact_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    contact = db.query(SchoolStudentEmergencyContact).filter(SchoolStudentEmergencyContact.id == contact_id, SchoolStudentEmergencyContact.student_id == student.id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Emergency contact not found.")
    create_lifecycle_event(db, access, student, "Emergency Contact Removed", today_string(), notes=f"Removed {contact.full_name}")
    db.delete(contact)
    db.commit()
    return {"detail": "Emergency contact removed."}


@router.post("/school/student-information/{student_id}/siblings")
def link_sibling(student_id: int, payload: SiblingPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    sibling = student_for_access(db, access, payload.sibling_student_id)
    if student.id == sibling.id:
        raise HTTPException(status_code=400, detail="A student cannot be linked to themselves.")
    low_id, high_id = sorted([student.id, sibling.id])
    duplicate = db.query(SchoolStudentSiblingLink).filter(SchoolStudentSiblingLink.student_id == low_id, SchoolStudentSiblingLink.sibling_student_id == high_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="These students are already linked as siblings.")
    link = SchoolStudentSiblingLink(
        workspace_id=student.workspace_id,
        student_id=low_id,
        sibling_student_id=high_id,
        family_discount_percent=payload.family_discount_percent,
        notes=payload.notes,
    )
    db.add(link)
    if payload.family_discount_percent:
        student.family_discount_percent = max(student.family_discount_percent or 0, payload.family_discount_percent)
        sibling.family_discount_percent = max(sibling.family_discount_percent or 0, payload.family_discount_percent)
    create_lifecycle_event(db, access, student, "Sibling Linked", today_string(), notes=f"Linked with {sibling.student_name}")
    create_lifecycle_event(db, access, sibling, "Sibling Linked", today_string(), notes=f"Linked with {student.student_name}")
    db.commit()
    db.refresh(link)
    return model_dict(link)


@router.delete("/school/student-information/{student_id}/siblings/{link_id}")
def unlink_sibling(student_id: int, link_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    link = db.query(SchoolStudentSiblingLink).filter(
        SchoolStudentSiblingLink.id == link_id,
        or_(SchoolStudentSiblingLink.student_id == student.id, SchoolStudentSiblingLink.sibling_student_id == student.id),
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Sibling link not found.")
    db.delete(link)
    create_lifecycle_event(db, access, student, "Sibling Unlinked", today_string())
    db.commit()
    return {"detail": "Sibling link removed."}


@router.put("/school/student-information/{student_id}/medical")
def update_medical_profile(student_id: int, payload: MedicalPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    medical = db.query(SchoolStudentMedicalProfile).filter(SchoolStudentMedicalProfile.student_id == student.id).first()
    if not medical:
        medical = SchoolStudentMedicalProfile(workspace_id=student.workspace_id, student_id=student.id)
        db.add(medical)
    for key, value in payload.model_dump().items():
        setattr(medical, key, value)
    medical.updated_by_user_id = access["user"].id
    medical.updated_at = datetime.utcnow()
    student.blood_group = payload.blood_group
    create_lifecycle_event(db, access, student, "Medical Profile Updated", today_string())
    audit_school_action(db, request, "update", "SchoolStudentMedicalProfile", student.id, f"Updated medical profile for {student.student_name}")
    db.commit()
    db.refresh(medical)
    return model_dict(medical)


@router.post("/school/student-information/{student_id}/lifecycle")
def record_student_lifecycle(student_id: int, payload: LifecyclePayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    event_type = {item.lower(): item for item in LIFECYCLE_TYPES}.get(payload.event_type.strip().lower())
    if not event_type:
        raise HTTPException(status_code=400, detail="Select a valid student lifecycle action.")
    old = {
        "campus_id": student.campus_id,
        "class_name": student.class_name,
        "section": student.section,
    }
    new_campus_id = payload.campus_id or student.campus_id
    new_session_id = payload.academic_session_id or student.academic_session_id
    school_class = None
    section = None
    if event_type in {"Promotion", "Campus Transfer", "Class Transfer", "Section Transfer", "Reactivation"}:
        ensure_campus_access(access, new_campus_id)
        campus_for_workspace(db, student.workspace_id, new_campus_id)
        session_for_workspace(db, student.workspace_id, new_session_id)
        new_class_id = payload.school_class_id or student.school_class_id
        new_section_id = payload.school_section_id if payload.school_section_id is not None else student.school_section_id
        school_class, section = class_and_section(db, student.workspace_id, new_campus_id, new_class_id, new_section_id)
        if not school_class:
            raise HTTPException(status_code=400, detail="Select the destination class.")
        close_current_enrollments(db, student.id, payload.event_date, event_type)
        student.campus_id = new_campus_id
        student.academic_session_id = new_session_id
        student.school_class_id = school_class.id
        student.school_section_id = section.id if section else None
        student.class_name = school_class.name
        student.section = section.name if section else None
        student.roll_number = next_roll_number(db, student.workspace_id, new_session_id, school_class.name, student.section)
        student.status = "Active"
        student.archived_at = None
        student.withdrawal_date = None
        create_enrollment(db, student.workspace_id, student, payload.event_date, event_type)
    elif event_type == "Withdrawal":
        close_current_enrollments(db, student.id, payload.event_date, event_type)
        student.status = "Withdrawn"
        student.withdrawal_date = payload.event_date
        student.archived_at = datetime.utcnow()
    elif event_type == "Graduation":
        close_current_enrollments(db, student.id, payload.event_date, event_type)
        student.status = "Graduated"
        student.graduation_date = payload.event_date
        student.alumni_since = payload.event_date
        student.archived_at = datetime.utcnow()
    event = create_lifecycle_event(
        db, access, student, event_type, payload.event_date,
        from_campus_id=old["campus_id"], to_campus_id=student.campus_id,
        from_class_name=old["class_name"], to_class_name=student.class_name,
        from_section_name=old["section"], to_section_name=student.section,
        reason=payload.reason, notes=payload.notes,
    )
    student.updated_at = datetime.utcnow()
    audit_school_action(db, request, "lifecycle", "SchoolStudent", student.id, f"Recorded {event_type} for {student.student_name}")
    db.commit()
    return {"student": serialize_student_summary(db, student), "event": model_dict(event)}


async def save_school_file(file: UploadFile) -> tuple[str, str, int, str]:
    original = sanitize_upload_filename(file.filename or "document")
    extension = Path(original).suffix.lower()
    if extension not in ALLOWED_UPLOADS:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Files must be 15 MB or smaller.")
    STUDENT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{extension}"
    stored_path = (STUDENT_UPLOAD_DIR / stored_name).resolve()
    stored_path.write_bytes(content)
    return original, str(stored_path), len(content), f"/static/uploads/school-students/{stored_name}"


@router.post("/school/student-information/{student_id}/documents")
async def upload_student_document(
    student_id: int,
    request: Request,
    category: str = Form(default="General"),
    title: str = Form(default=""),
    file: UploadFile = File(...),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_documents")
    student = student_for_access(db, access, student_id)
    original, storage_path, size, file_url = await save_school_file(file)
    document = SchoolDocument(
        workspace_id=student.workspace_id,
        campus_id=student.campus_id,
        entity_type="Student",
        entity_id=student.id,
        category=clean_text(category, 60) or "General",
        title=clean_text(title, 150) or original,
        original_filename=original,
        storage_path=storage_path,
        file_url=file_url,
        content_type=file.content_type,
        file_size=size,
        uploaded_by_user_id=access["user"].id,
    )
    db.add(document)
    db.flush()
    if document.category.lower() in {"photograph", "photo", "student photo"}:
        student.photo_url = file_url
    create_lifecycle_event(db, access, student, "Document Uploaded", today_string(), notes=f"{document.category}: {document.title}")
    audit_school_action(db, request, "upload", "SchoolDocument", document.id, f"Uploaded {document.title} for {student.student_name}")
    db.commit()
    return model_dict(document)


@router.delete("/school/student-information/{student_id}/documents/{document_id}")
def delete_student_document(student_id: int, document_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_documents")
    student = student_for_access(db, access, student_id)
    document = db.query(SchoolDocument).filter(
        SchoolDocument.id == document_id,
        SchoolDocument.workspace_id == student.workspace_id,
        SchoolDocument.entity_type == "Student",
        SchoolDocument.entity_id == student.id,
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Student document not found.")
    path = Path(document.storage_path).resolve()
    root = STUDENT_UPLOAD_DIR.resolve()
    if root in path.parents and path.exists():
        path.unlink()
    if student.photo_url == document.file_url:
        student.photo_url = None
    create_lifecycle_event(db, access, student, "Document Removed", today_string(), notes=document.title)
    db.delete(document)
    db.commit()
    return {"detail": "Document removed."}


@router.post("/school/student-information/{student_id}/certificates")
def issue_student_certificate(student_id: int, payload: CertificatePayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_students")
    student = student_for_access(db, access, student_id)
    certificate_type = payload.certificate_type.strip().title()
    if certificate_type not in {"Transfer Certificate", "Character Certificate"}:
        raise HTTPException(status_code=400, detail="Select Transfer Certificate or Character Certificate.")
    prefix = "TC" if certificate_type.startswith("Transfer") else "CC"
    certificate = SchoolStudentCertificate(
        workspace_id=student.workspace_id,
        student_id=student.id,
        certificate_no=next_number(db, SchoolStudentCertificate, SchoolStudentCertificate.certificate_no, student.workspace_id, f"{prefix}-{datetime.now().year}-", 5),
        certificate_type=certificate_type,
        issue_date=payload.issue_date,
        purpose=payload.purpose,
        conduct=payload.conduct,
        remarks=payload.remarks,
        snapshot_json=json.dumps(serialize_student_summary(db, student), default=str),
        issued_by_user_id=access["user"].id,
    )
    db.add(certificate)
    db.flush()
    create_lifecycle_event(db, access, student, "Certificate Issued", payload.issue_date, notes=f"{certificate_type} {certificate.certificate_no}")
    audit_school_action(db, request, "issue", "SchoolStudentCertificate", certificate.id, f"Issued {certificate_type} for {student.student_name}")
    db.commit()
    db.refresh(certificate)
    return model_dict(certificate)


STUDENT_EXPORT_HEADERS = [
    "Admission No", "Student Name", "Campus", "Academic Session", "Class", "Section",
    "Roll Number", "Father Name", "Mother Name", "Guardian Name", "Guardian Phone",
    "Date of Birth", "Gender", "B-Form No", "Birth Certificate No", "Previous School",
    "Blood Group", "Family Discount %", "Admission Date", "Status", "Address", "Notes",
]


def export_rows(db: Session, students: list[SchoolStudent]) -> list[list]:
    rows = []
    for student in students:
        campus = db.query(SchoolCampus).filter(SchoolCampus.id == student.campus_id).first()
        session = db.query(SchoolAcademicSession).filter(SchoolAcademicSession.id == student.academic_session_id).first()
        rows.append([
            student.admission_no, student.student_name, campus.name if campus else "",
            session.name if session else "", student.class_name, student.section or "",
            student.roll_number or "", student.father_name or "", student.mother_name or "",
            student.guardian_name or "", student.guardian_phone or "", student.date_of_birth or "",
            student.gender or "", student.b_form_no or "", student.birth_certificate_no or "",
            student.previous_school or "", student.blood_group or "", student.family_discount_percent or 0,
            student.admission_date or "", student.status, student.address or "", student.notes or "",
        ])
    return rows


def column_name(index: int) -> str:
    value = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        value = chr(65 + remainder) + value
    return value


def make_xlsx(headers: list[str], rows: list[list]) -> bytes:
    all_rows = [headers, *rows]
    sheet_rows = []
    for row_index, row in enumerate(all_rows, 1):
        cells = []
        for column_index, value in enumerate(row):
            reference = f"{column_name(column_index)}{row_index}"
            style = ' s="1"' if row_index == 1 else ""
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                cells.append(f'<c r="{reference}"{style}><v>{value}</v></c>')
            else:
                text = xml_escape(str(value or ""))
                cells.append(f'<c r="{reference}" t="inlineStr"{style}><is><t>{text}</t></is></c>')
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>{"".join(sheet_rows)}</sheetData><autoFilter ref="A1:{column_name(len(headers)-1)}{len(all_rows)}"/></worksheet>'''
    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets></workbook>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''',
        "xl/styles.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF191797"/><bgColor indexed="64"/></patternFill></fill><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>''',
        "xl/worksheets/sheet1.xml": sheet_xml,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def make_csv(headers: list[str], rows: list[list]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(headers)
    writer.writerows(rows)
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def parse_csv_rows(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig")
    return [dict(row) for row in csv.DictReader(io.StringIO(text))]


def cell_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    result = 0
    for letter in letters.group(0) if letters else "A":
        result = result * 26 + ord(letter) - 64
    return result - 1


def parse_xlsx_rows(content: bytes) -> list[dict]:
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", namespace):
                shared.append("".join(node.text or "" for node in item.findall(".//m:t", namespace)))
        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in archive.namelist():
            raise HTTPException(status_code=400, detail="The workbook does not contain a readable first worksheet.")
        root = ElementTree.fromstring(archive.read(sheet_name))
        matrix = []
        for row in root.findall(".//m:sheetData/m:row", namespace):
            values = []
            for cell in row.findall("m:c", namespace):
                index = cell_index(cell.attrib.get("r", "A1"))
                while len(values) <= index:
                    values.append("")
                cell_type = cell.attrib.get("t")
                if cell_type == "inlineStr":
                    value = "".join(node.text or "" for node in cell.findall(".//m:t", namespace))
                else:
                    node = cell.find("m:v", namespace)
                    raw = node.text if node is not None else ""
                    value = shared[int(raw)] if cell_type == "s" and raw else raw
                values[index] = value
            matrix.append(values)
    if not matrix:
        return []
    headers = [str(value or "").strip() for value in matrix[0]]
    return [
        {headers[index]: row[index] if index < len(row) else "" for index in range(len(headers)) if headers[index]}
        for row in matrix[1:]
        if any(str(value or "").strip() for value in row)
    ]


@router.get("/school/student-files/export")
def export_student_file(
    request: Request,
    format: str = Query(default="xlsx", pattern="^(xlsx|csv)$"),
    campus_id: int | None = Query(default=None),
    status: str | None = Query(default=None, max_length=30),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_students")
    query = db.query(SchoolStudent).filter(SchoolStudent.workspace_id == access["workspace"].id)
    if access["campus_ids"] is not None:
        query = query.filter(SchoolStudent.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        ensure_campus_access(access, campus_id)
        query = query.filter(SchoolStudent.campus_id == campus_id)
    if status and status != "All":
        query = query.filter(SchoolStudent.status == status)
    rows = export_rows(db, query.order_by(SchoolStudent.student_name).all())
    content = make_xlsx(STUDENT_EXPORT_HEADERS, rows) if format == "xlsx" else make_csv(STUDENT_EXPORT_HEADERS, rows)
    media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if format == "xlsx" else "text/csv; charset=utf-8"
    filename = f"dar-e-arqam-students-{today_string()}.{format}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/school/student-files/import-template")
def download_student_import_template(
    request: Request,
    format: str = Query(default="xlsx", pattern="^(xlsx|csv)$"),
    db: Session = Depends(get_school_db),
):
    require_school_permission(request, db, "manage_students")
    sample = [["", "Example Student", "Main Campus", "", "Grade 1", "A", "", "Parent Name", "", "Parent Name", "03001234567", "2018-01-01", "Male", "", "", "", "", 0, today_string(), "Active", "", ""]]
    content = make_xlsx(STUDENT_EXPORT_HEADERS, sample) if format == "xlsx" else make_csv(STUDENT_EXPORT_HEADERS, sample)
    media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if format == "xlsx" else "text/csv; charset=utf-8"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="student-import-template.{format}"'})


def lookup_structure(db: Session, workspace_id: int, row: dict):
    campus_name = clean_text(row.get("Campus"))
    campus = db.query(SchoolCampus).filter(
        SchoolCampus.workspace_id == workspace_id,
        or_(func.lower(SchoolCampus.name) == str(campus_name or "").lower(), func.lower(SchoolCampus.code) == str(campus_name or "").lower()),
    ).first()
    if not campus:
        campus = db.query(SchoolCampus).filter(SchoolCampus.workspace_id == workspace_id, SchoolCampus.is_active == True).order_by(SchoolCampus.id).first()
    session_name = clean_text(row.get("Academic Session"))
    session_query = db.query(SchoolAcademicSession).filter(SchoolAcademicSession.workspace_id == workspace_id)
    session = session_query.filter(func.lower(SchoolAcademicSession.name) == str(session_name).lower()).first() if session_name else session_query.filter(SchoolAcademicSession.is_current == True).first()
    session = session or session_query.order_by(SchoolAcademicSession.id.desc()).first()
    class_name = clean_text(row.get("Class"))
    school_class = db.query(SchoolClass).filter(
        SchoolClass.workspace_id == workspace_id,
        SchoolClass.campus_id == campus.id,
        func.lower(SchoolClass.name) == str(class_name or "").lower(),
    ).first() if campus and class_name else None
    section_name = clean_text(row.get("Section"))
    section = db.query(SchoolSection).filter(
        SchoolSection.workspace_id == workspace_id,
        SchoolSection.school_class_id == school_class.id,
        func.lower(SchoolSection.name) == str(section_name or "").lower(),
    ).first() if school_class and section_name else None
    return campus, session, school_class, section


@router.post("/school/student-files/import")
async def import_student_file(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_students")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".csv", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Upload a CSV or XLSX file.")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Import files must be 10 MB or smaller.")
    try:
        rows = parse_xlsx_rows(content) if extension == ".xlsx" else parse_csv_rows(content)
    except (ValueError, KeyError, zipfile.BadZipFile, ElementTree.ParseError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"The import file could not be read: {exc}") from exc
    if len(rows) > 5000:
        raise HTTPException(status_code=400, detail="A single import can contain up to 5,000 students.")
    created = 0
    skipped = 0
    errors = []
    for row_number, row in enumerate(rows, 2):
        name = clean_text(row.get("Student Name"), 150)
        class_name = clean_text(row.get("Class"), 80)
        if not name or not class_name:
            errors.append({"row": row_number, "error": "Student Name and Class are required."})
            skipped += 1
            continue
        campus, session, school_class, section = lookup_structure(db, access["workspace"].id, row)
        if not campus or not session:
            errors.append({"row": row_number, "error": "Campus or academic session could not be resolved."})
            skipped += 1
            continue
        try:
            ensure_campus_access(access, campus.id)
        except HTTPException as exc:
            errors.append({"row": row_number, "error": str(exc.detail)})
            skipped += 1
            continue
        admission_no = clean_text(row.get("Admission No"), 50) or next_admission_number(db, access["workspace"].id, campus)
        if db.query(SchoolStudent).filter(func.lower(SchoolStudent.admission_no) == admission_no.lower()).first():
            errors.append({"row": row_number, "error": f"Admission number {admission_no} already exists."})
            skipped += 1
            continue
        discount = 0
        try:
            discount = min(100, max(0, float(row.get("Family Discount %") or 0)))
        except (TypeError, ValueError):
            pass
        resolved_class_name = school_class.name if school_class else class_name
        resolved_section_name = section.name if section else clean_text(row.get("Section"), 30)
        student = SchoolStudent(
            workspace_id=access["workspace"].id,
            campus_id=campus.id,
            academic_session_id=session.id,
            school_class_id=school_class.id if school_class else None,
            school_section_id=section.id if section else None,
            admission_no=admission_no,
            student_name=name,
            class_name=resolved_class_name,
            section=resolved_section_name,
            roll_number=clean_text(row.get("Roll Number"), 30) or next_roll_number(db, access["workspace"].id, session.id, resolved_class_name, resolved_section_name),
            father_name=clean_text(row.get("Father Name"), 150),
            mother_name=clean_text(row.get("Mother Name"), 150),
            guardian_name=clean_text(row.get("Guardian Name"), 150),
            guardian_phone=clean_text(row.get("Guardian Phone"), 50),
            date_of_birth=clean_text(row.get("Date of Birth"), 20),
            gender=clean_text(row.get("Gender"), 30),
            b_form_no=clean_text(row.get("B-Form No"), 50),
            birth_certificate_no=clean_text(row.get("Birth Certificate No"), 80),
            previous_school=clean_text(row.get("Previous School"), 200),
            blood_group=clean_text(row.get("Blood Group"), 20),
            family_discount_percent=discount,
            admission_date=clean_text(row.get("Admission Date"), 20) or today_string(),
            status=clean_text(row.get("Status"), 30) or "Active",
            address=clean_text(row.get("Address"), 1000),
            notes=clean_text(row.get("Notes"), 3000),
            preferred_language="en",
        )
        db.add(student)
        db.flush()
        create_enrollment(db, student.workspace_id, student, student.admission_date, "Bulk import")
        create_lifecycle_event(db, access, student, "Imported", student.admission_date, to_campus_id=student.campus_id, to_class_name=student.class_name, to_section_name=student.section)
        created += 1
    audit_school_action(db, request, "import", "SchoolStudent", None, f"Imported {created} students", {"skipped": skipped, "filename": file.filename})
    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors[:100], "total_rows": len(rows)}
