import json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..database import SessionLocal
from ..models import (
    ActivityLog,
    SchoolAcademicSession,
    SchoolAttendanceAlert,
    SchoolAttendanceChangeLog,
    SchoolAttendanceCorrection,
    SchoolAttendancePolicy,
    SchoolAttendanceSession,
    SchoolCampus,
    SchoolClass,
    SchoolDocument,
    SchoolLeaveApplication,
    SchoolNotification,
    SchoolRoleAssignment,
    SchoolSection,
    SchoolStaffAttendance,
    SchoolStudent,
    SchoolStudentAttendance,
    SchoolSubject,
    User,
)
from .foundation import (
    audit_school_action,
    ensure_campus_access,
    require_school_permission,
)
from ..security import sanitize_upload_filename


router = APIRouter(prefix="/school/attendance", tags=["School Attendance"])
ATTENDANCE_UPLOAD_DIR = UPLOAD_DIR / "school-attendance"
ALLOWED_DOCUMENTS = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"}
ATTENDANCE_STATUSES = {"Present", "Absent", "Late", "Leave", "Excused", "Half Day"}
SESSION_STATUSES = {"Draft", "Submitted", "Approved"}
STAFF_ROLES = {
    "School owner", "Principal", "Campus administrator", "Admission officer", "Accountant",
    "Teacher", "Class teacher", "Receptionist", "Librarian", "Transport manager",
}


def get_school_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def model_dict(instance) -> dict:
    return {column.name: getattr(instance, column.name) for column in instance.__table__.columns}


def clean(value, limit: int | None = None):
    if value in (None, ""):
        return None
    normalized = str(value).strip()
    return normalized[:limit] if limit else normalized


def today_string() -> str:
    return datetime.now().date().isoformat()


def json_list(value, fallback=None):
    try:
        parsed = json.loads(value or "")
        return parsed if isinstance(parsed, list) else (fallback or [])
    except (TypeError, json.JSONDecodeError):
        return fallback or []


def attendance_policy(db: Session, workspace_id: int, campus_id: int | None = None) -> SchoolAttendancePolicy:
    query = db.query(SchoolAttendancePolicy).filter(SchoolAttendancePolicy.workspace_id == workspace_id)
    policy = query.filter(SchoolAttendancePolicy.campus_id == campus_id).first() if campus_id else None
    policy = policy or query.filter(SchoolAttendancePolicy.campus_id.is_(None)).first()
    if not policy:
        policy = SchoolAttendancePolicy(
            workspace_id=workspace_id,
            campus_id=None,
            low_attendance_threshold=75,
            late_grace_minutes=10,
            school_start_time="08:00",
            school_end_time="14:00",
            automatic_parent_notifications=True,
            notification_channels_json=json.dumps(["In-app"]),
        )
        db.add(policy)
        db.flush()
    return policy


def serialize_policy(policy: SchoolAttendancePolicy) -> dict:
    value = model_dict(policy)
    value["notification_channels"] = json_list(value.pop("notification_channels_json", None), ["In-app"])
    return value


def ensure_campus(db: Session, workspace_id: int, campus_id: int) -> SchoolCampus:
    campus = db.query(SchoolCampus).filter(
        SchoolCampus.id == campus_id,
        SchoolCampus.workspace_id == workspace_id,
        SchoolCampus.is_active == True,
    ).first()
    if not campus:
        raise HTTPException(status_code=400, detail="Select a valid campus.")
    return campus


def session_for_access(db: Session, access: dict, session_id: int) -> SchoolAttendanceSession:
    session = db.query(SchoolAttendanceSession).filter(
        SchoolAttendanceSession.id == session_id,
        SchoolAttendanceSession.workspace_id == access["workspace"].id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance register not found.")
    ensure_campus_access(access, session.campus_id)
    return session


def student_record_for_access(db: Session, access: dict, record_id: int) -> SchoolStudentAttendance:
    record = db.query(SchoolStudentAttendance).filter(
        SchoolStudentAttendance.id == record_id,
        SchoolStudentAttendance.workspace_id == access["workspace"].id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Student attendance record not found.")
    ensure_campus_access(access, record.campus_id)
    return record


def staff_record_for_access(db: Session, access: dict, record_id: int) -> SchoolStaffAttendance:
    record = db.query(SchoolStaffAttendance).filter(
        SchoolStaffAttendance.id == record_id,
        SchoolStaffAttendance.workspace_id == access["workspace"].id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Staff attendance record not found.")
    ensure_campus_access(access, record.campus_id)
    return record


def time_minutes(value: str | None) -> int | None:
    if not value or ":" not in value:
        return None
    try:
        hour, minute = value.split(":", 1)
        return int(hour) * 60 + int(minute[:2])
    except (TypeError, ValueError):
        return None


def calculated_minutes(check_in: str | None, check_out: str | None, policy: SchoolAttendancePolicy) -> tuple[int, int]:
    check_in_minutes = time_minutes(check_in)
    check_out_minutes = time_minutes(check_out)
    start_minutes = time_minutes(policy.school_start_time)
    end_minutes = time_minutes(policy.school_end_time)
    late = max(0, (check_in_minutes or 0) - (start_minutes or 0) - int(policy.late_grace_minutes or 0)) if check_in_minutes is not None and start_minutes is not None else 0
    early = max(0, (end_minutes or 0) - (check_out_minutes or 0)) if check_out_minutes is not None and end_minutes is not None else 0
    return late, early


def change_log(
    db: Session,
    access: dict,
    campus_id: int,
    target_type: str,
    target_id: int,
    action: str,
    before: dict | None,
    after: dict | None,
    reason: str | None = None,
    approved_by_user_id: int | None = None,
):
    db.add(SchoolAttendanceChangeLog(
        workspace_id=access["workspace"].id,
        campus_id=campus_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
        before_json=json.dumps(before or {}, default=str),
        after_json=json.dumps(after or {}, default=str),
        reason=reason,
        changed_by_user_id=access["user"].id,
        approved_by_user_id=approved_by_user_id,
    ))


def campus_staff(db: Session, workspace_id: int, campus_id: int, allowed_campuses) -> list[dict]:
    assignments = db.query(SchoolRoleAssignment).filter(
        SchoolRoleAssignment.workspace_id == workspace_id,
        SchoolRoleAssignment.is_active == True,
        SchoolRoleAssignment.school_role.in_(list(STAFF_ROLES)),
        or_(SchoolRoleAssignment.campus_id == campus_id, SchoolRoleAssignment.campus_id.is_(None)),
    ).all()
    user_ids = list({item.user_id for item in assignments})
    users = {item.id: item for item in db.query(User).filter(User.id.in_(user_ids or [-1]), User.is_active == True).all()}
    result = []
    seen = set()
    for assignment in assignments:
        user = users.get(assignment.user_id)
        if not user or user.id in seen:
            continue
        seen.add(user.id)
        result.append({"id": user.id, "name": user.name, "username": user.username, "phone": user.phone, "school_role": assignment.school_role})
    return sorted(result, key=lambda item: item["name"].lower())


def class_roster(db: Session, session: SchoolAttendanceSession) -> list[SchoolStudent]:
    school_class = db.query(SchoolClass).filter(SchoolClass.id == session.school_class_id).first()
    query = db.query(SchoolStudent).filter(
        SchoolStudent.workspace_id == session.workspace_id,
        SchoolStudent.campus_id == session.campus_id,
        SchoolStudent.status == "Active",
    )
    if school_class:
        query = query.filter(or_(
            SchoolStudent.school_class_id == school_class.id,
            func.lower(SchoolStudent.class_name) == school_class.name.lower(),
        ))
    if session.school_section_id:
        section = db.query(SchoolSection).filter(SchoolSection.id == session.school_section_id).first()
        if section:
            query = query.filter(or_(
                SchoolStudent.school_section_id == section.id,
                func.lower(func.coalesce(SchoolStudent.section, "")) == section.name.lower(),
            ))
    return query.order_by(SchoolStudent.roll_number, SchoolStudent.student_name).all()


def approved_student_leave(db: Session, workspace_id: int, student_id: int, attendance_date: str) -> SchoolLeaveApplication | None:
    return db.query(SchoolLeaveApplication).filter(
        SchoolLeaveApplication.workspace_id == workspace_id,
        SchoolLeaveApplication.applicant_type == "Student",
        SchoolLeaveApplication.student_id == student_id,
        SchoolLeaveApplication.status == "Approved",
        SchoolLeaveApplication.start_date <= attendance_date,
        SchoolLeaveApplication.end_date >= attendance_date,
    ).first()


def serialize_student_record(db: Session, record: SchoolStudentAttendance) -> dict:
    value = model_dict(record)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == record.student_id).first()
    value.update({
        "student_name": student.student_name if student else "Unknown student",
        "admission_no": student.admission_no if student else "",
        "roll_number": student.roll_number if student else "",
        "guardian_name": student.guardian_name if student else None,
        "guardian_phone": student.guardian_phone if student else None,
        "photo_url": student.photo_url if student else None,
    })
    return value


def serialize_staff_record(db: Session, record: SchoolStaffAttendance, role_by_user=None) -> dict:
    value = model_dict(record)
    user = db.query(User).filter(User.id == record.staff_user_id).first()
    value.update({
        "staff_name": user.name if user else "Unknown staff",
        "username": user.username if user else "",
        "phone": user.phone if user else None,
        "school_role": (role_by_user or {}).get(record.staff_user_id),
    })
    return value


class PolicyPayload(BaseModel):
    campus_id: int | None = None
    low_attendance_threshold: float = Field(default=75, ge=1, le=100)
    late_grace_minutes: int = Field(default=10, ge=0, le=180)
    school_start_time: str = Field(default="08:00", max_length=10)
    school_end_time: str = Field(default="14:00", max_length=10)
    automatic_parent_notifications: bool = True
    notification_channels: list[str] = Field(default_factory=lambda: ["In-app"])


class SessionPayload(BaseModel):
    campus_id: int
    academic_session_id: int
    school_class_id: int
    school_section_id: int | None = None
    subject_id: int | None = None
    attendance_date: str = Field(default_factory=today_string, max_length=20)
    attendance_type: str = Field(default="Daily", max_length=30)
    period_label: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=1000)


class StudentMarkPayload(BaseModel):
    student_id: int
    status: str = Field(default="Present", max_length=30)
    check_in_time: str | None = Field(default=None, max_length=10)
    check_out_time: str | None = Field(default=None, max_length=10)
    late_minutes: int | None = Field(default=None, ge=0, le=1440)
    early_departure_minutes: int | None = Field(default=None, ge=0, le=1440)
    absence_reason: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    capture_method: str = Field(default="Manual", max_length=30)
    external_reference: str | None = Field(default=None, max_length=150)


class StudentRegisterPayload(BaseModel):
    status: str = Field(default="Draft", max_length=30)
    records: list[StudentMarkPayload] = Field(default_factory=list, max_length=5000)


class StaffMarkPayload(BaseModel):
    staff_user_id: int
    status: str = Field(default="Present", max_length=30)
    check_in_time: str | None = Field(default=None, max_length=10)
    check_out_time: str | None = Field(default=None, max_length=10)
    late_minutes: int | None = Field(default=None, ge=0, le=1440)
    early_departure_minutes: int | None = Field(default=None, ge=0, le=1440)
    absence_reason: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    capture_method: str = Field(default="Manual", max_length=30)
    external_reference: str | None = Field(default=None, max_length=150)


class StaffDayPayload(BaseModel):
    campus_id: int
    attendance_date: str = Field(default_factory=today_string, max_length=20)
    records: list[StaffMarkPayload] = Field(default_factory=list, max_length=2000)


class LeavePayload(BaseModel):
    campus_id: int
    applicant_type: str = Field(default="Student", max_length=20)
    student_id: int | None = None
    staff_user_id: int | None = None
    leave_type: str = Field(default="Casual", max_length=40)
    start_date: str = Field(max_length=20)
    end_date: str = Field(max_length=20)
    reason: str = Field(min_length=2, max_length=3000)


class ReviewPayload(BaseModel):
    status: str = Field(max_length=20)
    review_notes: str | None = Field(default=None, max_length=2000)


class CorrectionPayload(BaseModel):
    target_type: str = Field(max_length=20)
    student_attendance_id: int | None = None
    staff_attendance_id: int | None = None
    requested_status: str = Field(max_length=30)
    requested_check_in_time: str | None = Field(default=None, max_length=10)
    requested_check_out_time: str | None = Field(default=None, max_length=10)
    reason: str = Field(min_length=2, max_length=2000)


def serialize_session(db: Session, session: SchoolAttendanceSession, include_records=False) -> dict:
    value = model_dict(session)
    school_class = db.query(SchoolClass).filter(SchoolClass.id == session.school_class_id).first()
    section = db.query(SchoolSection).filter(SchoolSection.id == session.school_section_id).first() if session.school_section_id else None
    subject = db.query(SchoolSubject).filter(SchoolSubject.id == session.subject_id).first() if session.subject_id else None
    value.update({
        "class_name": school_class.name if school_class else "Unknown class",
        "section_name": section.name if section else None,
        "subject_name": subject.name if subject else None,
    })
    records = db.query(SchoolStudentAttendance).filter(SchoolStudentAttendance.attendance_session_id == session.id).all()
    value["counts"] = {status: sum(1 for record in records if record.status == status) for status in ATTENDANCE_STATUSES}
    value["record_count"] = len(records)
    if include_records:
        value["records"] = [serialize_student_record(db, record) for record in records]
    return value


def ensure_register_records(db: Session, access: dict, session: SchoolAttendanceSession):
    existing = {
        item.student_id: item
        for item in db.query(SchoolStudentAttendance).filter(
            SchoolStudentAttendance.attendance_session_id == session.id
        ).all()
    }
    for student in class_roster(db, session):
        if student.id in existing:
            continue
        leave = approved_student_leave(db, session.workspace_id, student.id, session.attendance_date)
        record = SchoolStudentAttendance(
            workspace_id=session.workspace_id,
            campus_id=session.campus_id,
            attendance_session_id=session.id,
            student_id=student.id,
            status="Leave" if leave else "Present",
            absence_reason=leave.reason if leave else None,
            supporting_document_id=leave.supporting_document_id if leave else None,
            capture_method="Manual",
            marked_by_user_id=access["user"].id,
        )
        db.add(record)
    db.flush()


@router.get("")
def attendance_snapshot(
    request: Request,
    attendance_date: str = Query(default_factory=today_string, max_length=20),
    campus_id: int | None = Query(default=None),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_attendance")
    if campus_id:
        ensure_campus_access(access, campus_id)
    workspace_id = access["workspace"].id
    policy = attendance_policy(db, workspace_id, campus_id)
    session_query = db.query(SchoolAttendanceSession).filter(
        SchoolAttendanceSession.workspace_id == workspace_id,
        SchoolAttendanceSession.attendance_date == attendance_date,
    )
    staff_query = db.query(SchoolStaffAttendance).filter(
        SchoolStaffAttendance.workspace_id == workspace_id,
        SchoolStaffAttendance.attendance_date == attendance_date,
    )
    if access["campus_ids"] is not None:
        session_query = session_query.filter(SchoolAttendanceSession.campus_id.in_(list(access["campus_ids"])))
        staff_query = staff_query.filter(SchoolStaffAttendance.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        session_query = session_query.filter(SchoolAttendanceSession.campus_id == campus_id)
        staff_query = staff_query.filter(SchoolStaffAttendance.campus_id == campus_id)
    sessions = session_query.order_by(SchoolAttendanceSession.created_at.desc()).all()
    session_ids = [item.id for item in sessions]
    student_records = db.query(SchoolStudentAttendance).filter(
        SchoolStudentAttendance.attendance_session_id.in_(session_ids or [-1])
    ).all()
    staff_records = staff_query.all()
    leaves_query = db.query(SchoolLeaveApplication).filter(SchoolLeaveApplication.workspace_id == workspace_id)
    corrections_query = db.query(SchoolAttendanceCorrection).filter(SchoolAttendanceCorrection.workspace_id == workspace_id)
    alerts_query = db.query(SchoolAttendanceAlert).filter(SchoolAttendanceAlert.workspace_id == workspace_id)
    if access["campus_ids"] is not None:
        leaves_query = leaves_query.filter(SchoolLeaveApplication.campus_id.in_(list(access["campus_ids"])))
        corrections_query = corrections_query.filter(SchoolAttendanceCorrection.campus_id.in_(list(access["campus_ids"])))
        alerts_query = alerts_query.filter(SchoolAttendanceAlert.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        leaves_query = leaves_query.filter(SchoolLeaveApplication.campus_id == campus_id)
        corrections_query = corrections_query.filter(SchoolAttendanceCorrection.campus_id == campus_id)
        alerts_query = alerts_query.filter(SchoolAttendanceAlert.campus_id == campus_id)
    db.commit()
    return {
        "policy": serialize_policy(policy),
        "stats": {
            "present": sum(1 for item in student_records if item.status == "Present"),
            "absent": sum(1 for item in student_records if item.status == "Absent"),
            "late": sum(1 for item in student_records if item.status == "Late"),
            "leave": sum(1 for item in student_records if item.status in {"Leave", "Excused"}),
            "staff_present": sum(1 for item in staff_records if item.status in {"Present", "Late"}),
            "pending_leave": leaves_query.filter(SchoolLeaveApplication.status == "Pending").count(),
            "pending_corrections": corrections_query.filter(SchoolAttendanceCorrection.status == "Pending").count(),
        },
        "sessions": [serialize_session(db, item) for item in sessions],
        "staff_records": [serialize_staff_record(db, item) for item in staff_records],
        "leaves": [serialize_leave(db, item) for item in leaves_query.order_by(SchoolLeaveApplication.created_at.desc()).limit(200).all()],
        "corrections": [serialize_correction(db, item) for item in corrections_query.order_by(SchoolAttendanceCorrection.created_at.desc()).limit(200).all()],
        "alerts": [model_dict(item) for item in alerts_query.order_by(SchoolAttendanceAlert.created_at.desc()).limit(200).all()],
        "integration_status": {"QR": "Ready for connection", "RFID": "Ready for connection", "Biometric": "Ready for connection"},
    }


@router.post("/sessions")
def create_or_open_session(payload: SessionPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "take_attendance")
    workspace_id = access["workspace"].id
    ensure_campus_access(access, payload.campus_id)
    ensure_campus(db, workspace_id, payload.campus_id)
    academic_session = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.id == payload.academic_session_id,
        SchoolAcademicSession.workspace_id == workspace_id,
    ).first()
    school_class = db.query(SchoolClass).filter(
        SchoolClass.id == payload.school_class_id,
        SchoolClass.workspace_id == workspace_id,
        SchoolClass.campus_id == payload.campus_id,
    ).first()
    if not academic_session or not school_class:
        raise HTTPException(status_code=400, detail="Select a valid academic session and class.")
    if payload.school_section_id and not db.query(SchoolSection).filter(
        SchoolSection.id == payload.school_section_id,
        SchoolSection.school_class_id == school_class.id,
    ).first():
        raise HTTPException(status_code=400, detail="Select a valid section.")
    attendance_type = "Subject" if payload.attendance_type.lower() == "subject" else "Daily"
    if attendance_type == "Subject" and not db.query(SchoolSubject).filter(
        SchoolSubject.id == payload.subject_id,
        SchoolSubject.workspace_id == workspace_id,
    ).first():
        raise HTTPException(status_code=400, detail="Select a subject for subject-wise attendance.")
    query = db.query(SchoolAttendanceSession).filter(
        SchoolAttendanceSession.workspace_id == workspace_id,
        SchoolAttendanceSession.campus_id == payload.campus_id,
        SchoolAttendanceSession.academic_session_id == payload.academic_session_id,
        SchoolAttendanceSession.school_class_id == payload.school_class_id,
        SchoolAttendanceSession.attendance_date == payload.attendance_date,
        SchoolAttendanceSession.attendance_type == attendance_type,
    )
    query = query.filter(SchoolAttendanceSession.school_section_id == payload.school_section_id) if payload.school_section_id else query.filter(SchoolAttendanceSession.school_section_id.is_(None))
    if attendance_type == "Subject":
        query = query.filter(SchoolAttendanceSession.subject_id == payload.subject_id, SchoolAttendanceSession.period_label == payload.period_label)
    session = query.first()
    if not session:
        session = SchoolAttendanceSession(
            workspace_id=workspace_id,
            campus_id=payload.campus_id,
            academic_session_id=payload.academic_session_id,
            school_class_id=payload.school_class_id,
            school_section_id=payload.school_section_id,
            subject_id=payload.subject_id if attendance_type == "Subject" else None,
            attendance_date=payload.attendance_date,
            attendance_type=attendance_type,
            period_label=payload.period_label,
            notes=payload.notes,
            status="Draft",
            taken_by_user_id=access["user"].id,
        )
        db.add(session)
        db.flush()
        audit_school_action(db, request, "create", "SchoolAttendanceSession", session.id, f"Opened {attendance_type.lower()} attendance for {school_class.name}")
    ensure_register_records(db, access, session)
    db.commit()
    db.refresh(session)
    return serialize_session(db, session, include_records=True)


@router.get("/sessions/{session_id}")
def get_session(session_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "view_attendance")
    session = session_for_access(db, access, session_id)
    ensure_register_records(db, access, session)
    db.commit()
    return serialize_session(db, session, include_records=True)


def create_parent_alerts(db: Session, access: dict, session: SchoolAttendanceSession):
    policy = attendance_policy(db, session.workspace_id, session.campus_id)
    if not policy.automatic_parent_notifications:
        return
    absent_records = db.query(SchoolStudentAttendance).filter(
        SchoolStudentAttendance.attendance_session_id == session.id,
        SchoolStudentAttendance.status == "Absent",
    ).all()
    for record in absent_records:
        student = db.query(SchoolStudent).filter(SchoolStudent.id == record.student_id).first()
        if not student:
            continue
        message = f"{student.student_name} was marked absent on {session.attendance_date}. Please contact the school if this is unexpected."
        parents = db.query(SchoolRoleAssignment).filter(
            SchoolRoleAssignment.workspace_id == session.workspace_id,
            SchoolRoleAssignment.student_id == student.id,
            SchoolRoleAssignment.school_role == "Parent",
            SchoolRoleAssignment.is_active == True,
        ).all()
        recipients = []
        for assignment in parents:
            user = db.query(User).filter(User.id == assignment.user_id, User.is_active == True).first()
            if user:
                recipients.append((f"user:{user.id}", user.name, user.phone, user.id, "In-app", "Sent"))
        if not recipients and student.guardian_phone:
            recipients.append((f"phone:{student.guardian_phone}", student.guardian_name, student.guardian_phone, None, "SMS queue", "Queued"))
        for key, name, phone, user_id, channel, status in recipients:
            existing = db.query(SchoolAttendanceAlert).filter(
                SchoolAttendanceAlert.student_attendance_id == record.id,
                SchoolAttendanceAlert.recipient_key == key,
            ).first()
            if existing:
                continue
            alert = SchoolAttendanceAlert(
                workspace_id=session.workspace_id,
                campus_id=session.campus_id,
                student_id=student.id,
                student_attendance_id=record.id,
                recipient_key=key,
                recipient_name=name,
                recipient_phone=phone,
                recipient_user_id=user_id,
                channel=channel,
                message=message,
                status=status,
                sent_at=datetime.utcnow() if status == "Sent" else None,
            )
            db.add(alert)
            if user_id:
                db.add(SchoolNotification(
                    workspace_id=session.workspace_id,
                    campus_id=session.campus_id,
                    title="Student absence alert",
                    body=message,
                    audience_type="User",
                    audience_value=str(user_id),
                    priority="High",
                    status="Published",
                    created_by_user_id=access["user"].id,
                    published_at=datetime.utcnow(),
                ))


@router.put("/sessions/{session_id}/records")
def save_student_register(session_id: int, payload: StudentRegisterPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "take_attendance")
    session = session_for_access(db, access, session_id)
    if session.status in {"Submitted", "Approved"}:
        raise HTTPException(status_code=409, detail="This register is submitted. Request an attendance correction instead of editing it directly.")
    target_status = payload.status.title()
    if target_status not in SESSION_STATUSES:
        raise HTTPException(status_code=400, detail="Register status must be Draft, Submitted or Approved.")
    if target_status == "Approved" and "approve_attendance" not in access["permissions"]:
        raise HTTPException(status_code=403, detail="Your school role cannot approve attendance registers.")
    policy = attendance_policy(db, session.workspace_id, session.campus_id)
    roster_ids = {student.id for student in class_roster(db, session)}
    for mark in payload.records:
        if mark.student_id not in roster_ids:
            raise HTTPException(status_code=400, detail="A submitted student is not in this class register.")
        status = {item.lower(): item for item in ATTENDANCE_STATUSES}.get(mark.status.lower())
        if not status:
            raise HTTPException(status_code=400, detail=f"Unknown attendance status: {mark.status}")
        record = db.query(SchoolStudentAttendance).filter(
            SchoolStudentAttendance.attendance_session_id == session.id,
            SchoolStudentAttendance.student_id == mark.student_id,
        ).first()
        before = model_dict(record) if record else None
        if not record:
            record = SchoolStudentAttendance(
                workspace_id=session.workspace_id,
                campus_id=session.campus_id,
                attendance_session_id=session.id,
                student_id=mark.student_id,
            )
            db.add(record)
            db.flush()
        calculated_late, calculated_early = calculated_minutes(mark.check_in_time, mark.check_out_time, policy)
        record.status = status
        record.check_in_time = clean(mark.check_in_time, 10)
        record.check_out_time = clean(mark.check_out_time, 10)
        record.late_minutes = mark.late_minutes if mark.late_minutes is not None else calculated_late
        record.early_departure_minutes = mark.early_departure_minutes if mark.early_departure_minutes is not None else calculated_early
        record.absence_reason = clean(mark.absence_reason, 500)
        record.notes = clean(mark.notes, 1000)
        record.capture_method = clean(mark.capture_method, 30) or "Manual"
        record.external_reference = clean(mark.external_reference, 150)
        record.marked_by_user_id = access["user"].id
        record.marked_at = datetime.utcnow()
        record.updated_at = datetime.utcnow()
        db.flush()
        after = model_dict(record)
        if before != after:
            change_log(db, access, session.campus_id, "StudentAttendance", record.id, "Marked" if before is None else "Updated", before, after)
    session.status = target_status
    session.updated_at = datetime.utcnow()
    if target_status in {"Submitted", "Approved"}:
        session.submitted_at = datetime.utcnow()
        if target_status == "Approved":
            session.approved_at = datetime.utcnow()
            session.approved_by_user_id = access["user"].id
        create_parent_alerts(db, access, session)
    audit_school_action(db, request, "submit" if target_status != "Draft" else "update", "SchoolAttendanceSession", session.id, f"Saved {session.attendance_type.lower()} attendance as {target_status}")
    db.commit()
    return serialize_session(db, session, include_records=True)


@router.get("/staff-day")
def get_staff_day(
    request: Request,
    campus_id: int,
    attendance_date: str = Query(default_factory=today_string, max_length=20),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_attendance")
    ensure_campus_access(access, campus_id)
    ensure_campus(db, access["workspace"].id, campus_id)
    staff = campus_staff(db, access["workspace"].id, campus_id, access["campus_ids"])
    records = {
        item.staff_user_id: item
        for item in db.query(SchoolStaffAttendance).filter(
            SchoolStaffAttendance.workspace_id == access["workspace"].id,
            SchoolStaffAttendance.campus_id == campus_id,
            SchoolStaffAttendance.attendance_date == attendance_date,
        ).all()
    }
    role_by_user = {item["id"]: item["school_role"] for item in staff}
    rows = []
    for member in staff:
        record = records.get(member["id"])
        rows.append(serialize_staff_record(db, record, role_by_user) if record else {
            "id": None, "workspace_id": access["workspace"].id, "campus_id": campus_id,
            "staff_user_id": member["id"], "attendance_date": attendance_date,
            "status": "Present", "check_in_time": "", "check_out_time": "",
            "late_minutes": 0, "early_departure_minutes": 0, "absence_reason": "",
            "notes": "", "capture_method": "Manual", **{key: member[key] for key in ("name", "username", "phone", "school_role") if key in member},
            "staff_name": member["name"],
        })
    return {"records": rows, "policy": serialize_policy(attendance_policy(db, access["workspace"].id, campus_id))}


@router.put("/staff-day")
def save_staff_day(payload: StaffDayPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_staff_attendance")
    ensure_campus_access(access, payload.campus_id)
    ensure_campus(db, access["workspace"].id, payload.campus_id)
    valid_staff = {item["id"] for item in campus_staff(db, access["workspace"].id, payload.campus_id, access["campus_ids"])}
    policy = attendance_policy(db, access["workspace"].id, payload.campus_id)
    saved = []
    for mark in payload.records:
        if mark.staff_user_id not in valid_staff:
            raise HTTPException(status_code=400, detail="A submitted user is not active staff for this campus.")
        status = {item.lower(): item for item in ATTENDANCE_STATUSES}.get(mark.status.lower())
        if not status:
            raise HTTPException(status_code=400, detail=f"Unknown attendance status: {mark.status}")
        record = db.query(SchoolStaffAttendance).filter(
            SchoolStaffAttendance.workspace_id == access["workspace"].id,
            SchoolStaffAttendance.campus_id == payload.campus_id,
            SchoolStaffAttendance.staff_user_id == mark.staff_user_id,
            SchoolStaffAttendance.attendance_date == payload.attendance_date,
        ).first()
        before = model_dict(record) if record else None
        if not record:
            record = SchoolStaffAttendance(
                workspace_id=access["workspace"].id,
                campus_id=payload.campus_id,
                staff_user_id=mark.staff_user_id,
                attendance_date=payload.attendance_date,
            )
            db.add(record)
            db.flush()
        late, early = calculated_minutes(mark.check_in_time, mark.check_out_time, policy)
        for key, value in mark.model_dump(exclude={"staff_user_id", "late_minutes", "early_departure_minutes"}).items():
            setattr(record, key, clean(value) if isinstance(value, str) else value)
        record.status = status
        record.late_minutes = mark.late_minutes if mark.late_minutes is not None else late
        record.early_departure_minutes = mark.early_departure_minutes if mark.early_departure_minutes is not None else early
        record.marked_by_user_id = access["user"].id
        record.marked_at = datetime.utcnow()
        record.updated_at = datetime.utcnow()
        db.flush()
        change_log(db, access, payload.campus_id, "StaffAttendance", record.id, "Marked" if before is None else "Updated", before, model_dict(record))
        saved.append(record)
    audit_school_action(db, request, "update", "SchoolStaffAttendance", None, f"Saved staff attendance for {payload.attendance_date}", {"records": len(saved)})
    db.commit()
    return {"records": [serialize_staff_record(db, item) for item in saved]}


def serialize_leave(db: Session, leave: SchoolLeaveApplication) -> dict:
    value = model_dict(leave)
    if leave.student_id:
        student = db.query(SchoolStudent).filter(SchoolStudent.id == leave.student_id).first()
        value["applicant_name"] = student.student_name if student else "Unknown student"
        value["applicant_reference"] = student.admission_no if student else ""
    elif leave.staff_user_id:
        user = db.query(User).filter(User.id == leave.staff_user_id).first()
        value["applicant_name"] = user.name if user else "Unknown staff"
        value["applicant_reference"] = user.username if user else ""
    document = db.query(SchoolDocument).filter(SchoolDocument.id == leave.supporting_document_id).first() if leave.supporting_document_id else None
    value["document"] = model_dict(document) if document else None
    return value


@router.post("/leaves")
def create_leave(payload: LeavePayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "submit_leave")
    ensure_campus_access(access, payload.campus_id)
    applicant_type = "Staff" if payload.applicant_type.lower() == "staff" else "Student"
    if access["school_role"] in {"Parent", "Student"}:
        own_student_ids = {
            item.student_id
            for item in db.query(SchoolRoleAssignment).filter(
                SchoolRoleAssignment.workspace_id == access["workspace"].id,
                SchoolRoleAssignment.user_id == access["user"].id,
                SchoolRoleAssignment.is_active == True,
                SchoolRoleAssignment.student_id.is_not(None),
            ).all()
        }
        if applicant_type != "Student" or payload.student_id not in own_student_ids:
            raise HTTPException(status_code=403, detail="You can only submit leave for your linked student profile.")
    if applicant_type == "Student":
        student = db.query(SchoolStudent).filter(
            SchoolStudent.id == payload.student_id,
            SchoolStudent.workspace_id == access["workspace"].id,
            SchoolStudent.campus_id == payload.campus_id,
        ).first()
        if not student:
            raise HTTPException(status_code=400, detail="Select a valid student.")
    else:
        if payload.staff_user_id not in {item["id"] for item in campus_staff(db, access["workspace"].id, payload.campus_id, access["campus_ids"])}:
            raise HTTPException(status_code=400, detail="Select a valid staff member.")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="Leave end date cannot be before the start date.")
    leave = SchoolLeaveApplication(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        applicant_type=applicant_type,
        student_id=payload.student_id if applicant_type == "Student" else None,
        staff_user_id=payload.staff_user_id if applicant_type == "Staff" else None,
        leave_type=payload.leave_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        reason=payload.reason.strip(),
        status="Pending",
        applied_by_user_id=access["user"].id,
    )
    db.add(leave)
    db.flush()
    audit_school_action(db, request, "create", "SchoolLeaveApplication", leave.id, f"Submitted {applicant_type.lower()} leave application")
    db.commit()
    return serialize_leave(db, leave)


@router.post("/leaves/{leave_id}/review")
def review_leave(leave_id: int, payload: ReviewPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "approve_attendance")
    leave = db.query(SchoolLeaveApplication).filter(
        SchoolLeaveApplication.id == leave_id,
        SchoolLeaveApplication.workspace_id == access["workspace"].id,
    ).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave application not found.")
    ensure_campus_access(access, leave.campus_id)
    status = payload.status.title()
    if status not in {"Approved", "Rejected"}:
        raise HTTPException(status_code=400, detail="Leave can only be approved or rejected.")
    leave.status = status
    leave.review_notes = clean(payload.review_notes, 2000)
    leave.reviewed_by_user_id = access["user"].id
    leave.reviewed_at = datetime.utcnow()
    if status == "Approved":
        if leave.student_id:
            records = db.query(SchoolStudentAttendance).join(
                SchoolAttendanceSession,
                SchoolAttendanceSession.id == SchoolStudentAttendance.attendance_session_id,
            ).filter(
                SchoolStudentAttendance.student_id == leave.student_id,
                SchoolAttendanceSession.attendance_date >= leave.start_date,
                SchoolAttendanceSession.attendance_date <= leave.end_date,
                SchoolAttendanceSession.status == "Draft",
            ).all()
            for record in records:
                before = model_dict(record)
                record.status = "Leave"
                record.absence_reason = leave.reason
                record.supporting_document_id = leave.supporting_document_id
                change_log(db, access, leave.campus_id, "StudentAttendance", record.id, "Leave approved", before, model_dict(record), leave.reason, access["user"].id)
        elif leave.staff_user_id:
            records = db.query(SchoolStaffAttendance).filter(
                SchoolStaffAttendance.staff_user_id == leave.staff_user_id,
                SchoolStaffAttendance.attendance_date >= leave.start_date,
                SchoolStaffAttendance.attendance_date <= leave.end_date,
            ).all()
            for record in records:
                before = model_dict(record)
                record.status = "Leave"
                record.absence_reason = leave.reason
                record.supporting_document_id = leave.supporting_document_id
                change_log(db, access, leave.campus_id, "StaffAttendance", record.id, "Leave approved", before, model_dict(record), leave.reason, access["user"].id)
    audit_school_action(db, request, "review", "SchoolLeaveApplication", leave.id, f"{status} leave application")
    db.commit()
    return serialize_leave(db, leave)


async def store_document(file: UploadFile):
    original = sanitize_upload_filename(file.filename or "attendance-document")
    extension = Path(original).suffix.lower()
    if extension not in ALLOWED_DOCUMENTS:
        raise HTTPException(status_code=400, detail="Upload a PDF, Word document or image.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Attendance documents must be 10 MB or smaller.")
    ATTENDANCE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    path = (ATTENDANCE_UPLOAD_DIR / filename).resolve()
    path.write_bytes(content)
    return original, path, len(content), f"/static/uploads/school-attendance/{filename}"


async def attach_document(db, access, request, file, campus_id, entity_type, entity_id, category, title):
    original, path, size, url = await store_document(file)
    document = SchoolDocument(
        workspace_id=access["workspace"].id,
        campus_id=campus_id,
        entity_type=entity_type,
        entity_id=entity_id,
        category=category,
        title=title or original,
        original_filename=original,
        storage_path=str(path),
        file_url=url,
        content_type=file.content_type,
        file_size=size,
        uploaded_by_user_id=access["user"].id,
    )
    db.add(document)
    db.flush()
    audit_school_action(db, request, "upload", "SchoolDocument", document.id, f"Uploaded attendance document {document.title}")
    return document


@router.post("/leaves/{leave_id}/document")
async def upload_leave_document(leave_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "submit_leave")
    leave = db.query(SchoolLeaveApplication).filter(SchoolLeaveApplication.id == leave_id, SchoolLeaveApplication.workspace_id == access["workspace"].id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave application not found.")
    ensure_campus_access(access, leave.campus_id)
    document = await attach_document(db, access, request, file, leave.campus_id, "SchoolLeaveApplication", leave.id, "Leave evidence", f"Leave evidence {leave.id}")
    leave.supporting_document_id = document.id
    db.commit()
    return model_dict(document)


@router.post("/student-records/{record_id}/document")
async def upload_absence_document(record_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "take_attendance")
    record = student_record_for_access(db, access, record_id)
    document = await attach_document(db, access, request, file, record.campus_id, "StudentAttendance", record.id, "Absence evidence", f"Attendance evidence {record.id}")
    record.supporting_document_id = document.id
    change_log(db, access, record.campus_id, "StudentAttendance", record.id, "Document attached", None, {"document_id": document.id})
    db.commit()
    return model_dict(document)


def serialize_correction(db: Session, correction: SchoolAttendanceCorrection) -> dict:
    value = model_dict(correction)
    if correction.student_attendance_id:
        record = db.query(SchoolStudentAttendance).filter(SchoolStudentAttendance.id == correction.student_attendance_id).first()
        student = db.query(SchoolStudent).filter(SchoolStudent.id == record.student_id).first() if record else None
        value["person_name"] = student.student_name if student else "Unknown student"
        session = db.query(SchoolAttendanceSession).filter(SchoolAttendanceSession.id == record.attendance_session_id).first() if record else None
        value["attendance_date"] = session.attendance_date if session else None
    elif correction.staff_attendance_id:
        record = db.query(SchoolStaffAttendance).filter(SchoolStaffAttendance.id == correction.staff_attendance_id).first()
        user = db.query(User).filter(User.id == record.staff_user_id).first() if record else None
        value["person_name"] = user.name if user else "Unknown staff"
        value["attendance_date"] = record.attendance_date if record else None
    return value


@router.post("/corrections")
def request_correction(payload: CorrectionPayload, request: Request, db: Session = Depends(get_school_db)):
    target_type = "Staff" if payload.target_type.lower() == "staff" else "Student"
    access = require_school_permission(
        request,
        db,
        "manage_staff_attendance" if target_type == "Staff" else "take_attendance",
    )
    if target_type == "Student":
        record = student_record_for_access(db, access, payload.student_attendance_id or 0)
    else:
        record = staff_record_for_access(db, access, payload.staff_attendance_id or 0)
    requested_status = {item.lower(): item for item in ATTENDANCE_STATUSES}.get(payload.requested_status.lower())
    if not requested_status:
        raise HTTPException(status_code=400, detail="Select a valid requested status.")
    duplicate = db.query(SchoolAttendanceCorrection).filter(
        SchoolAttendanceCorrection.status == "Pending",
        SchoolAttendanceCorrection.student_attendance_id == (record.id if target_type == "Student" else None),
        SchoolAttendanceCorrection.staff_attendance_id == (record.id if target_type == "Staff" else None),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A correction for this record is already pending.")
    correction = SchoolAttendanceCorrection(
        workspace_id=access["workspace"].id,
        campus_id=record.campus_id,
        target_type=target_type,
        student_attendance_id=record.id if target_type == "Student" else None,
        staff_attendance_id=record.id if target_type == "Staff" else None,
        current_status=record.status,
        requested_status=requested_status,
        requested_check_in_time=payload.requested_check_in_time,
        requested_check_out_time=payload.requested_check_out_time,
        reason=payload.reason.strip(),
        status="Pending",
        requested_by_user_id=access["user"].id,
    )
    db.add(correction)
    db.flush()
    audit_school_action(db, request, "request", "SchoolAttendanceCorrection", correction.id, f"Requested {target_type.lower()} attendance correction")
    db.commit()
    return serialize_correction(db, correction)


@router.post("/corrections/{correction_id}/review")
def review_correction(correction_id: int, payload: ReviewPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "approve_attendance")
    correction = db.query(SchoolAttendanceCorrection).filter(
        SchoolAttendanceCorrection.id == correction_id,
        SchoolAttendanceCorrection.workspace_id == access["workspace"].id,
    ).first()
    if not correction:
        raise HTTPException(status_code=404, detail="Attendance correction not found.")
    ensure_campus_access(access, correction.campus_id)
    status = payload.status.title()
    if status not in {"Approved", "Rejected"}:
        raise HTTPException(status_code=400, detail="Correction can only be approved or rejected.")
    correction.status = status
    correction.review_notes = clean(payload.review_notes, 2000)
    correction.reviewed_by_user_id = access["user"].id
    correction.reviewed_at = datetime.utcnow()
    if status == "Approved":
        record = student_record_for_access(db, access, correction.student_attendance_id) if correction.target_type == "Student" else staff_record_for_access(db, access, correction.staff_attendance_id)
        before = model_dict(record)
        record.status = correction.requested_status
        if correction.requested_check_in_time is not None:
            record.check_in_time = correction.requested_check_in_time
        if correction.requested_check_out_time is not None:
            record.check_out_time = correction.requested_check_out_time
        policy = attendance_policy(db, access["workspace"].id, record.campus_id)
        record.late_minutes, record.early_departure_minutes = calculated_minutes(record.check_in_time, record.check_out_time, policy)
        record.updated_at = datetime.utcnow()
        change_log(db, access, record.campus_id, f"{correction.target_type}Attendance", record.id, "Correction approved", before, model_dict(record), correction.reason, access["user"].id)
    audit_school_action(db, request, "review", "SchoolAttendanceCorrection", correction.id, f"{status} attendance correction")
    db.commit()
    return serialize_correction(db, correction)


@router.get("/monthly-summary")
def monthly_summary(
    request: Request,
    month: str = Query(max_length=7),
    campus_id: int | None = Query(default=None),
    school_class_id: int | None = Query(default=None),
    attendance_type: str = Query(default="Daily", max_length=30),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_attendance")
    if campus_id:
        ensure_campus_access(access, campus_id)
    workspace_id = access["workspace"].id
    policy = attendance_policy(db, workspace_id, campus_id)
    sessions_query = db.query(SchoolAttendanceSession).filter(
        SchoolAttendanceSession.workspace_id == workspace_id,
        SchoolAttendanceSession.attendance_date.like(f"{month}%"),
        SchoolAttendanceSession.attendance_type == ("Subject" if attendance_type.lower() == "subject" else "Daily"),
        SchoolAttendanceSession.status.in_(["Submitted", "Approved"]),
    )
    if access["campus_ids"] is not None:
        sessions_query = sessions_query.filter(SchoolAttendanceSession.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        sessions_query = sessions_query.filter(SchoolAttendanceSession.campus_id == campus_id)
    if school_class_id:
        sessions_query = sessions_query.filter(SchoolAttendanceSession.school_class_id == school_class_id)
    sessions = sessions_query.all()
    session_ids = [item.id for item in sessions]
    records = db.query(SchoolStudentAttendance).filter(SchoolStudentAttendance.attendance_session_id.in_(session_ids or [-1])).all()
    student_ids = list({item.student_id for item in records})
    students = {item.id: item for item in db.query(SchoolStudent).filter(SchoolStudent.id.in_(student_ids or [-1])).all()}
    grouped = {}
    for record in records:
        bucket = grouped.setdefault(record.student_id, {status: 0 for status in ATTENDANCE_STATUSES})
        bucket[record.status] = bucket.get(record.status, 0) + 1
    student_summary = []
    for student_id, counts in grouped.items():
        student = students.get(student_id)
        total = sum(counts.values())
        counted_present = counts.get("Present", 0) + counts.get("Late", 0) + 0.5 * counts.get("Half Day", 0)
        denominator = max(0, total - counts.get("Leave", 0) - counts.get("Excused", 0))
        percentage = round((counted_present / denominator * 100), 1) if denominator else 100.0
        student_summary.append({
            "student_id": student_id,
            "student_name": student.student_name if student else "Unknown student",
            "admission_no": student.admission_no if student else "",
            "class_name": student.class_name if student else "",
            "section": student.section if student else "",
            "total": total,
            "present": counts.get("Present", 0),
            "absent": counts.get("Absent", 0),
            "late": counts.get("Late", 0),
            "leave": counts.get("Leave", 0) + counts.get("Excused", 0),
            "percentage": percentage,
            "low_attendance": percentage < float(policy.low_attendance_threshold or 75),
        })
    staff_query = db.query(SchoolStaffAttendance).filter(
        SchoolStaffAttendance.workspace_id == workspace_id,
        SchoolStaffAttendance.attendance_date.like(f"{month}%"),
    )
    if access["campus_ids"] is not None:
        staff_query = staff_query.filter(SchoolStaffAttendance.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        staff_query = staff_query.filter(SchoolStaffAttendance.campus_id == campus_id)
    staff_grouped = {}
    for record in staff_query.all():
        bucket = staff_grouped.setdefault(record.staff_user_id, {status: 0 for status in ATTENDANCE_STATUSES})
        bucket[record.status] = bucket.get(record.status, 0) + 1
    users = {item.id: item for item in db.query(User).filter(User.id.in_(list(staff_grouped) or [-1])).all()}
    staff_summary = []
    for user_id, counts in staff_grouped.items():
        total = sum(counts.values())
        present = counts.get("Present", 0) + counts.get("Late", 0)
        percentage = round(present / total * 100, 1) if total else 100.0
        staff_summary.append({"staff_user_id": user_id, "staff_name": users[user_id].name if user_id in users else "Unknown staff", "total": total, "present": counts.get("Present", 0), "absent": counts.get("Absent", 0), "late": counts.get("Late", 0), "leave": counts.get("Leave", 0), "percentage": percentage, "low_attendance": percentage < float(policy.low_attendance_threshold or 75)})
    return {
        "month": month,
        "threshold": policy.low_attendance_threshold,
        "student_summary": sorted(student_summary, key=lambda item: (item["percentage"], item["student_name"])),
        "staff_summary": sorted(staff_summary, key=lambda item: (item["percentage"], item["staff_name"])),
        "sessions_count": len(sessions),
    }


@router.put("/policy")
def update_policy(payload: PolicyPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_attendance_policy")
    ensure_campus_access(access, payload.campus_id)
    query = db.query(SchoolAttendancePolicy).filter(SchoolAttendancePolicy.workspace_id == access["workspace"].id)
    policy = query.filter(SchoolAttendancePolicy.campus_id == payload.campus_id).first() if payload.campus_id else query.filter(SchoolAttendancePolicy.campus_id.is_(None)).first()
    if not policy:
        policy = SchoolAttendancePolicy(workspace_id=access["workspace"].id, campus_id=payload.campus_id)
        db.add(policy)
    values = payload.model_dump()
    policy.notification_channels_json = json.dumps(values.pop("notification_channels"))
    for key, value in values.items():
        setattr(policy, key, value)
    policy.updated_at = datetime.utcnow()
    db.flush()
    audit_school_action(db, request, "update", "SchoolAttendancePolicy", policy.id, "Updated attendance policy")
    db.commit()
    return serialize_policy(policy)


@router.get("/audit-history")
def attendance_audit_history(
    request: Request,
    campus_id: int | None = Query(default=None),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_attendance")
    query = db.query(SchoolAttendanceChangeLog).filter(SchoolAttendanceChangeLog.workspace_id == access["workspace"].id)
    if access["campus_ids"] is not None:
        query = query.filter(SchoolAttendanceChangeLog.campus_id.in_(list(access["campus_ids"])))
    if campus_id:
        ensure_campus_access(access, campus_id)
        query = query.filter(SchoolAttendanceChangeLog.campus_id == campus_id)
    return [model_dict(item) for item in query.order_by(SchoolAttendanceChangeLog.created_at.desc()).limit(500).all()]
