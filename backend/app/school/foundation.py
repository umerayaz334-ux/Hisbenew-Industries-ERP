import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..database import SessionLocal
from ..models import (
    ActivityLog,
    BusinessWorkspace,
    SchoolAcademicSession,
    SchoolAcademicTerm,
    SchoolCampus,
    SchoolClass,
    SchoolClassSubject,
    SchoolDocument,
    SchoolNotification,
    SchoolNotificationReceipt,
    SchoolRoleAssignment,
    SchoolRoom,
    SchoolSection,
    SchoolStudent,
    SchoolSubject,
    User,
)
from ..security import hash_pin, sanitize_upload_filename


router = APIRouter(prefix="/school/foundation", tags=["School Foundation"])
SCHOOL_WORKSPACE_SLUG = "dar-e-arqam"
SCHOOL_DOCUMENT_DIR = UPLOAD_DIR / "school-documents"

ALL_SCHOOL_PERMISSIONS = [
    "view_dashboard",
    "manage_foundation",
    "manage_branding",
    "view_students",
    "manage_students",
    "view_admissions",
    "manage_admissions",
    "view_attendance",
    "manage_staff_attendance",
    "approve_attendance",
    "manage_attendance_policy",
    "submit_leave",
    "view_finance",
    "manage_finance",
    "view_academics",
    "manage_academics",
    "take_attendance",
    "manage_exams",
    "manage_users",
    "send_notifications",
    "manage_documents",
    "view_audit",
    "view_own_children",
    "view_own_profile",
]

SCHOOL_ROLE_PERMISSIONS = {
    "School owner": ALL_SCHOOL_PERMISSIONS,
    "Principal": [permission for permission in ALL_SCHOOL_PERMISSIONS if permission not in {"manage_finance"}],
    "Campus administrator": [
        "view_dashboard", "manage_foundation", "manage_branding", "view_students",
        "manage_students", "view_admissions", "manage_admissions", "view_finance", "view_academics", "manage_academics",
        "view_attendance", "take_attendance", "manage_staff_attendance", "approve_attendance",
        "manage_attendance_policy", "submit_leave", "manage_exams", "manage_users", "send_notifications",
        "manage_documents", "view_audit",
    ],
    "Admission officer": ["view_dashboard", "view_students", "manage_students", "view_admissions", "manage_admissions", "view_attendance", "submit_leave", "send_notifications", "manage_documents"],
    "Accountant": ["view_dashboard", "view_students", "view_attendance", "submit_leave", "view_finance", "manage_finance", "send_notifications", "manage_documents"],
    "Teacher": ["view_dashboard", "view_students", "view_academics", "view_attendance", "take_attendance", "submit_leave", "manage_exams", "manage_documents"],
    "Class teacher": ["view_dashboard", "view_students", "manage_students", "view_admissions", "view_academics", "view_attendance", "take_attendance", "submit_leave", "manage_exams", "send_notifications", "manage_documents"],
    "Receptionist": ["view_dashboard", "view_students", "manage_students", "view_admissions", "manage_admissions", "view_attendance", "manage_staff_attendance", "submit_leave", "send_notifications", "manage_documents"],
    "Librarian": ["view_dashboard", "view_students", "manage_documents"],
    "Transport manager": ["view_dashboard", "view_students", "view_attendance", "submit_leave", "send_notifications", "manage_documents"],
    "Parent": ["view_dashboard", "view_own_children", "submit_leave"],
    "Student": ["view_dashboard", "view_own_profile", "submit_leave"],
}


def get_school_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def model_dict(instance) -> dict:
    return {
        column.name: getattr(instance, column.name)
        for column in instance.__table__.columns
    }


def ensure_default_school_foundation(db: Session | None = None) -> BusinessWorkspace:
    owns_session = db is None
    session = db or SessionLocal()
    try:
        workspace = session.query(BusinessWorkspace).filter(
            BusinessWorkspace.slug == SCHOOL_WORKSPACE_SLUG
        ).first()
        if not workspace:
            workspace = BusinessWorkspace(
                name="Dar-e-Arqam",
                slug=SCHOOL_WORKSPACE_SLUG,
                workspace_type="school",
                default_currency="PKR",
                timezone="Asia/Karachi",
                default_language="en",
                secondary_language="ur",
                is_active=True,
            )
            session.add(workspace)
            session.flush()

        campus = session.query(SchoolCampus).filter(
            SchoolCampus.workspace_id == workspace.id
        ).order_by(SchoolCampus.id).first()
        if not campus:
            campus = SchoolCampus(
                workspace_id=workspace.id,
                name="Main Campus",
                code="DEA-MAIN",
                campus_type="Main",
                primary_color="#191797",
                accent_color="#fff200",
                is_active=True,
            )
            session.add(campus)
            session.flush()

        academic_session = session.query(SchoolAcademicSession).filter(
            SchoolAcademicSession.workspace_id == workspace.id,
            SchoolAcademicSession.is_current == True,
        ).first()
        if not academic_session:
            year = datetime.now().year
            academic_session = SchoolAcademicSession(
                workspace_id=workspace.id,
                campus_id=campus.id,
                name=f"{year}-{year + 1}",
                start_date=f"{year}-04-01",
                end_date=f"{year + 1}-03-31",
                status="Current",
                is_current=True,
            )
            session.add(academic_session)
            session.flush()

        session.query(SchoolStudent).filter(
            SchoolStudent.workspace_id.is_(None)
        ).update({SchoolStudent.workspace_id: workspace.id}, synchronize_session=False)
        session.query(SchoolStudent).filter(
            SchoolStudent.campus_id.is_(None)
        ).update({SchoolStudent.campus_id: campus.id}, synchronize_session=False)
        session.query(SchoolStudent).filter(
            SchoolStudent.academic_session_id.is_(None)
        ).update(
            {SchoolStudent.academic_session_id: academic_session.id},
            synchronize_session=False,
        )
        session.commit()
        session.refresh(workspace)
        return workspace
    finally:
        if owns_session:
            session.close()


def current_school_user(request: Request, db: Session) -> User:
    user_id = getattr(request.state, "user_id", None)
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


def get_school_access(request: Request, db: Session) -> dict:
    user = current_school_user(request, db)
    workspace = ensure_default_school_foundation(db)
    if user.role == "admin":
        return {
            "user": user,
            "workspace": workspace,
            "school_role": "School owner",
            "permissions": set(ALL_SCHOOL_PERMISSIONS),
            "campus_ids": None,
        }

    assignments = db.query(SchoolRoleAssignment).filter(
        SchoolRoleAssignment.workspace_id == workspace.id,
        SchoolRoleAssignment.user_id == user.id,
        SchoolRoleAssignment.is_active == True,
    ).all()
    if not assignments:
        raise HTTPException(status_code=403, detail="This account has no access to the school workspace.")

    permissions = set()
    campus_ids = set()
    unrestricted = False
    primary_role = assignments[0].school_role
    for assignment in assignments:
        permissions.update(SCHOOL_ROLE_PERMISSIONS.get(assignment.school_role, []))
        if assignment.campus_id is None:
            unrestricted = True
        else:
            campus_ids.add(assignment.campus_id)
        try:
            overrides = json.loads(assignment.permission_overrides or "[]")
            permissions.update(value for value in overrides if value in ALL_SCHOOL_PERMISSIONS)
        except (TypeError, json.JSONDecodeError):
            pass
    return {
        "user": user,
        "workspace": workspace,
        "school_role": primary_role,
        "permissions": permissions,
        "campus_ids": None if unrestricted else campus_ids,
    }


def require_school_permission(request: Request, db: Session, permission: str) -> dict:
    access = get_school_access(request, db)
    if permission not in access["permissions"]:
        raise HTTPException(status_code=403, detail="Your school role does not allow this action.")
    return access


def ensure_campus_access(access: dict, campus_id: int | None) -> None:
    allowed = access["campus_ids"]
    if campus_id is not None and allowed is not None and campus_id not in allowed:
        raise HTTPException(status_code=403, detail="You do not have access to this campus.")


def audit_school_action(
    db: Session,
    request: Request,
    action: str,
    entity_type: str,
    entity_id: int | str | None,
    summary: str,
    detail: dict | None = None,
) -> None:
    user = getattr(request.state, "authenticated_user", None)
    db.add(ActivityLog(
        actor_user_id=getattr(user, "id", None),
        actor_user_name=getattr(user, "username", None) or getattr(user, "name", None),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        summary=summary,
        detail=json.dumps(detail or {}, default=str),
        page="School Foundation",
        request_method=request.method,
        request_path=request.url.path,
        created_at=datetime.utcnow(),
    ))


class CampusPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=30)
    campus_type: str = Field(default="Branch", max_length=30)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=500)
    principal_name: str | None = Field(default=None, max_length=120)
    primary_color: str = "#191797"
    accent_color: str = "#fff200"
    logo_data_url: str | None = None
    is_active: bool = True


class SessionPayload(BaseModel):
    campus_id: int | None = None
    name: str = Field(min_length=1, max_length=60)
    start_date: str = Field(min_length=8, max_length=20)
    end_date: str = Field(min_length=8, max_length=20)
    status: str = Field(default="Upcoming", max_length=30)
    is_current: bool = False


class TermPayload(BaseModel):
    academic_session_id: int
    campus_id: int | None = None
    name: str = Field(min_length=1, max_length=60)
    term_type: str = Field(default="Term", max_length=30)
    sequence: int = Field(default=1, ge=1, le=20)
    start_date: str = Field(min_length=8, max_length=20)
    end_date: str = Field(min_length=8, max_length=20)
    status: str = Field(default="Upcoming", max_length=30)


class RoomPayload(BaseModel):
    campus_id: int
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=30)
    room_type: str = Field(default="Classroom", max_length=40)
    capacity: int = Field(default=30, ge=1, le=5000)
    floor: str | None = Field(default=None, max_length=50)
    is_active: bool = True


class ClassPayload(BaseModel):
    campus_id: int
    academic_session_id: int
    name: str = Field(min_length=1, max_length=80)
    grade_level: str | None = Field(default=None, max_length=30)
    display_order: int = Field(default=0, ge=0, le=1000)
    is_active: bool = True


class SectionPayload(BaseModel):
    school_class_id: int
    name: str = Field(min_length=1, max_length=30)
    room_id: int | None = None
    class_teacher_user_id: int | None = None
    capacity: int = Field(default=30, ge=1, le=5000)
    is_active: bool = True


class SubjectPayload(BaseModel):
    campus_id: int | None = None
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)
    name_ur: str | None = Field(default=None, max_length=150)
    subject_type: str = Field(default="Core", max_length=40)
    total_marks: float = Field(default=100, ge=0)
    passing_marks: float = Field(default=40, ge=0)
    is_active: bool = True


class SchoolUserPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    username: str = Field(min_length=2, max_length=80)
    pin: str = Field(pattern=r"^\d{4}$")
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=120)
    campus_id: int | None = None
    school_role: str
    student_id: int | None = None


class SchoolAssignmentPayload(BaseModel):
    campus_id: int | None = None
    school_role: str
    student_id: int | None = None
    permission_overrides: list[str] = Field(default_factory=list)
    is_active: bool = True


class NotificationPayload(BaseModel):
    campus_id: int | None = None
    title: str = Field(min_length=1, max_length=160)
    title_ur: str | None = Field(default=None, max_length=220)
    body: str = Field(min_length=1, max_length=5000)
    body_ur: str | None = Field(default=None, max_length=5000)
    audience_type: str = Field(default="All", max_length=30)
    audience_value: str | None = Field(default=None, max_length=100)
    priority: str = Field(default="Normal", max_length=30)
    status: str = Field(default="Published", max_length=30)
    expires_at: datetime | None = None


def scoped_campus_query(query, model, access: dict):
    campus_ids = access["campus_ids"]
    if campus_ids is not None:
        query = query.filter(
            or_(model.campus_id.in_(list(campus_ids)), model.campus_id.is_(None))
        )
    return query


def foundation_snapshot(request: Request, db: Session, access: dict | None = None) -> dict:
    access = access or get_school_access(request, db)
    workspace = access["workspace"]
    campus_query = db.query(SchoolCampus).filter(SchoolCampus.workspace_id == workspace.id)
    if access["campus_ids"] is not None:
        campus_query = campus_query.filter(SchoolCampus.id.in_(list(access["campus_ids"])))
    campuses = campus_query.order_by(SchoolCampus.name).all()
    campus_ids = [campus.id for campus in campuses]

    sessions_query = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.workspace_id == workspace.id
    )
    sessions = scoped_campus_query(
        sessions_query, SchoolAcademicSession, access
    ).order_by(SchoolAcademicSession.start_date.desc()).all()
    session_ids = [item.id for item in sessions]

    terms = db.query(SchoolAcademicTerm).filter(
        SchoolAcademicTerm.workspace_id == workspace.id,
        SchoolAcademicTerm.academic_session_id.in_(session_ids or [-1]),
    ).order_by(SchoolAcademicTerm.sequence, SchoolAcademicTerm.start_date).all()
    rooms = db.query(SchoolRoom).filter(
        SchoolRoom.workspace_id == workspace.id,
        SchoolRoom.campus_id.in_(campus_ids or [-1]),
    ).order_by(SchoolRoom.name).all()
    classes = db.query(SchoolClass).filter(
        SchoolClass.workspace_id == workspace.id,
        SchoolClass.campus_id.in_(campus_ids or [-1]),
    ).order_by(SchoolClass.display_order, SchoolClass.name).all()
    class_ids = [item.id for item in classes]
    sections = db.query(SchoolSection).filter(
        SchoolSection.workspace_id == workspace.id,
        SchoolSection.school_class_id.in_(class_ids or [-1]),
    ).order_by(SchoolSection.name).all()
    subjects_query = db.query(SchoolSubject).filter(
        SchoolSubject.workspace_id == workspace.id
    )
    subjects = scoped_campus_query(
        subjects_query, SchoolSubject, access
    ).order_by(SchoolSubject.name).all()

    assignments_query = db.query(SchoolRoleAssignment).filter(
        SchoolRoleAssignment.workspace_id == workspace.id
    )
    if access["campus_ids"] is not None:
        assignments_query = assignments_query.filter(
            or_(
                SchoolRoleAssignment.campus_id.in_(list(access["campus_ids"])),
                SchoolRoleAssignment.user_id == access["user"].id,
            )
        )
    assignments = assignments_query.order_by(SchoolRoleAssignment.id.desc()).all()
    assignment_users = {
        user.id: user
        for user in db.query(User).filter(
            User.id.in_([assignment.user_id for assignment in assignments] or [-1])
        ).all()
    }
    school_users = []
    for assignment in assignments:
        user = assignment_users.get(assignment.user_id)
        item = model_dict(assignment)
        item.update({
            "name": user.name if user else "Unknown user",
            "username": user.username if user else "",
            "phone": user.phone if user else None,
            "email": user.email if user else None,
            "account_active": bool(user.is_active) if user else False,
        })
        try:
            item["permission_overrides"] = json.loads(assignment.permission_overrides or "[]")
        except json.JSONDecodeError:
            item["permission_overrides"] = []
        school_users.append(item)

    notification_query = db.query(SchoolNotification).filter(
        SchoolNotification.workspace_id == workspace.id
    )
    notifications = scoped_campus_query(
        notification_query, SchoolNotification, access
    ).order_by(SchoolNotification.created_at.desc()).limit(100).all()
    if "send_notifications" not in access["permissions"]:
        notifications = [
            item
            for item in notifications
            if item.status == "Published"
            and (
                item.audience_type == "All"
                or (item.audience_type == "Role" and item.audience_value == access["school_role"])
                or (item.audience_type == "User" and item.audience_value == str(access["user"].id))
                or (
                    item.audience_type == "Campus"
                    and item.campus_id is not None
                    and (
                        access["campus_ids"] is None
                        or item.campus_id in access["campus_ids"]
                    )
                )
            )
        ]
    read_ids = {
        row.notification_id
        for row in db.query(SchoolNotificationReceipt).filter(
            SchoolNotificationReceipt.user_id == access["user"].id,
            SchoolNotificationReceipt.notification_id.in_(
                [item.id for item in notifications] or [-1]
            ),
        ).all()
    }
    notification_items = []
    for item in notifications:
        serialized = model_dict(item)
        serialized["is_read"] = item.id in read_ids
        notification_items.append(serialized)

    document_query = db.query(SchoolDocument).filter(
        SchoolDocument.workspace_id == workspace.id
    )
    documents = scoped_campus_query(
        document_query, SchoolDocument, access
    ).order_by(SchoolDocument.created_at.desc()).limit(100).all()

    activity = db.query(ActivityLog).filter(
        or_(
            ActivityLog.page.like("School%"),
            ActivityLog.entity_type.like("School%"),
        )
    ).order_by(ActivityLog.created_at.desc()).limit(100).all()

    return {
        "workspace": model_dict(workspace),
        "access": {
            "user_id": access["user"].id,
            "school_role": access["school_role"],
            "permissions": sorted(access["permissions"]),
            "campus_ids": sorted(access["campus_ids"]) if access["campus_ids"] is not None else None,
        },
        "roles": [
            {"name": name, "permissions": permissions}
            for name, permissions in SCHOOL_ROLE_PERMISSIONS.items()
        ],
        "campuses": [model_dict(item) for item in campuses],
        "sessions": [model_dict(item) for item in sessions],
        "terms": [model_dict(item) for item in terms],
        "rooms": [model_dict(item) for item in rooms],
        "classes": [model_dict(item) for item in classes],
        "sections": [model_dict(item) for item in sections],
        "subjects": [model_dict(item) for item in subjects],
        "users": school_users,
        "notifications": notification_items,
        "documents": [model_dict(item) for item in documents],
        "activity": [model_dict(item) for item in activity],
    }


@router.get("")
def get_foundation(request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "view_dashboard")
    return foundation_snapshot(request, db, access)


@router.get("/me")
def get_my_school_access(request: Request, db: Session = Depends(get_school_db)):
    access = get_school_access(request, db)
    return {
        "workspace": model_dict(access["workspace"]),
        "user_id": access["user"].id,
        "school_role": access["school_role"],
        "permissions": sorted(access["permissions"]),
        "campus_ids": sorted(access["campus_ids"]) if access["campus_ids"] is not None else None,
    }


def clean_color(value: str, fallback: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if re.fullmatch(r"#[0-9a-f]{6}", normalized) else fallback


@router.post("/campuses")
def create_campus(payload: CampusPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_foundation")
    code = payload.code.strip().upper()
    duplicate = db.query(SchoolCampus).filter(
        SchoolCampus.workspace_id == access["workspace"].id,
        func.lower(SchoolCampus.code) == code.lower(),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Campus code already exists.")
    values = payload.model_dump()
    values.update({
        "name": payload.name.strip(),
        "code": code,
        "primary_color": clean_color(payload.primary_color, "#191797"),
        "accent_color": clean_color(payload.accent_color, "#fff200"),
    })
    campus = SchoolCampus(workspace_id=access["workspace"].id, **values)
    db.add(campus)
    db.flush()
    audit_school_action(db, request, "create", "SchoolCampus", campus.id, f"Created campus {campus.name}")
    db.commit()
    db.refresh(campus)
    return model_dict(campus)


@router.put("/campuses/{campus_id}")
def update_campus(campus_id: int, payload: CampusPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_foundation")
    ensure_campus_access(access, campus_id)
    campus = db.query(SchoolCampus).filter(
        SchoolCampus.id == campus_id,
        SchoolCampus.workspace_id == access["workspace"].id,
    ).first()
    if not campus:
        raise HTTPException(status_code=404, detail="Campus not found.")
    values = payload.model_dump()
    values["code"] = payload.code.strip().upper()
    values["primary_color"] = clean_color(payload.primary_color, campus.primary_color)
    values["accent_color"] = clean_color(payload.accent_color, campus.accent_color)
    for key, value in values.items():
        setattr(campus, key, value)
    audit_school_action(db, request, "update", "SchoolCampus", campus.id, f"Updated campus {campus.name}")
    db.commit()
    db.refresh(campus)
    return model_dict(campus)


@router.post("/sessions")
def create_session(payload: SessionPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    if payload.is_current:
        db.query(SchoolAcademicSession).filter(
            SchoolAcademicSession.workspace_id == access["workspace"].id,
            SchoolAcademicSession.campus_id == payload.campus_id,
        ).update({SchoolAcademicSession.is_current: False}, synchronize_session=False)
    item = SchoolAcademicSession(workspace_id=access["workspace"].id, **payload.model_dump())
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolAcademicSession", item.id, f"Created academic session {item.name}")
    db.commit()
    return model_dict(item)


@router.put("/sessions/{item_id}")
def update_session(item_id: int, payload: SessionPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    item = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.id == item_id,
        SchoolAcademicSession.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Academic session not found.")
    if payload.is_current:
        db.query(SchoolAcademicSession).filter(
            SchoolAcademicSession.workspace_id == access["workspace"].id,
            SchoolAcademicSession.campus_id == payload.campus_id,
            SchoolAcademicSession.id != item_id,
        ).update({SchoolAcademicSession.is_current: False}, synchronize_session=False)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    audit_school_action(db, request, "update", "SchoolAcademicSession", item.id, f"Updated academic session {item.name}")
    db.commit()
    return model_dict(item)


@router.post("/terms")
def create_term(payload: TermPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    academic_session = db.query(SchoolAcademicSession).filter(
        SchoolAcademicSession.id == payload.academic_session_id,
        SchoolAcademicSession.workspace_id == access["workspace"].id,
    ).first()
    if not academic_session:
        raise HTTPException(status_code=404, detail="Academic session not found.")
    item = SchoolAcademicTerm(workspace_id=access["workspace"].id, **payload.model_dump())
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolAcademicTerm", item.id, f"Created term {item.name}")
    db.commit()
    return model_dict(item)


@router.put("/terms/{item_id}")
def update_term(item_id: int, payload: TermPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    item = db.query(SchoolAcademicTerm).filter(
        SchoolAcademicTerm.id == item_id,
        SchoolAcademicTerm.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Academic term not found.")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    audit_school_action(db, request, "update", "SchoolAcademicTerm", item.id, f"Updated term {item.name}")
    db.commit()
    return model_dict(item)


@router.post("/rooms")
def create_room(payload: RoomPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_foundation")
    ensure_campus_access(access, payload.campus_id)
    item = SchoolRoom(
        workspace_id=access["workspace"].id,
        **{**payload.model_dump(), "code": payload.code.strip().upper()},
    )
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolRoom", item.id, f"Created room {item.name}")
    db.commit()
    return model_dict(item)


@router.put("/rooms/{item_id}")
def update_room(item_id: int, payload: RoomPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_foundation")
    ensure_campus_access(access, payload.campus_id)
    item = db.query(SchoolRoom).filter(
        SchoolRoom.id == item_id,
        SchoolRoom.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Room not found.")
    values = payload.model_dump()
    values["code"] = payload.code.strip().upper()
    for key, value in values.items():
        setattr(item, key, value)
    audit_school_action(db, request, "update", "SchoolRoom", item.id, f"Updated room {item.name}")
    db.commit()
    return model_dict(item)


@router.post("/classes")
def create_class(payload: ClassPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    item = SchoolClass(workspace_id=access["workspace"].id, **payload.model_dump())
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolClass", item.id, f"Created class {item.name}")
    db.commit()
    return model_dict(item)


@router.put("/classes/{item_id}")
def update_class(item_id: int, payload: ClassPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    item = db.query(SchoolClass).filter(
        SchoolClass.id == item_id,
        SchoolClass.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Class not found.")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    audit_school_action(db, request, "update", "SchoolClass", item.id, f"Updated class {item.name}")
    db.commit()
    return model_dict(item)


@router.post("/sections")
def create_section(payload: SectionPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    school_class = db.query(SchoolClass).filter(
        SchoolClass.id == payload.school_class_id,
        SchoolClass.workspace_id == access["workspace"].id,
    ).first()
    if not school_class:
        raise HTTPException(status_code=404, detail="Class not found.")
    ensure_campus_access(access, school_class.campus_id)
    item = SchoolSection(workspace_id=access["workspace"].id, **payload.model_dump())
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolSection", item.id, f"Created section {school_class.name} {item.name}")
    db.commit()
    return model_dict(item)


@router.put("/sections/{item_id}")
def update_section(item_id: int, payload: SectionPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    school_class = db.query(SchoolClass).filter(
        SchoolClass.id == payload.school_class_id,
        SchoolClass.workspace_id == access["workspace"].id,
    ).first()
    if not school_class:
        raise HTTPException(status_code=404, detail="Class not found.")
    ensure_campus_access(access, school_class.campus_id)
    item = db.query(SchoolSection).filter(
        SchoolSection.id == item_id,
        SchoolSection.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Section not found.")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    audit_school_action(db, request, "update", "SchoolSection", item.id, f"Updated section {item.name}")
    db.commit()
    return model_dict(item)


@router.post("/subjects")
def create_subject(payload: SubjectPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    values = payload.model_dump()
    values["code"] = payload.code.strip().upper()
    item = SchoolSubject(workspace_id=access["workspace"].id, **values)
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolSubject", item.id, f"Created subject {item.name}")
    db.commit()
    return model_dict(item)


@router.put("/subjects/{item_id}")
def update_subject(item_id: int, payload: SubjectPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_academics")
    ensure_campus_access(access, payload.campus_id)
    item = db.query(SchoolSubject).filter(
        SchoolSubject.id == item_id,
        SchoolSubject.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Subject not found.")
    values = payload.model_dump()
    values["code"] = payload.code.strip().upper()
    for key, value in values.items():
        setattr(item, key, value)
    audit_school_action(db, request, "update", "SchoolSubject", item.id, f"Updated subject {item.name}")
    db.commit()
    return model_dict(item)


def normalized_school_username(value: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "", str(value or "").strip().lower())


@router.post("/users")
def create_school_user(payload: SchoolUserPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_users")
    ensure_campus_access(access, payload.campus_id)
    if payload.school_role not in SCHOOL_ROLE_PERMISSIONS:
        raise HTTPException(status_code=400, detail="Unknown school role.")
    username = normalized_school_username(payload.username)
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Enter a valid username.")
    if db.query(User).filter(func.lower(User.username) == username).first():
        raise HTTPException(status_code=409, detail="Username already exists.")
    user = User(
        name=payload.name.strip(),
        username=username,
        pin=hash_pin(payload.pin),
        role="school",
        phone=payload.phone,
        email=payload.email,
        allowed_pages="[]",
        customer_privacy_settings="{}",
        session_expiry_minutes=0,
        is_active=True,
    )
    db.add(user)
    db.flush()
    assignment = SchoolRoleAssignment(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        user_id=user.id,
        student_id=payload.student_id,
        school_role=payload.school_role,
        permission_overrides="[]",
        is_active=True,
    )
    db.add(assignment)
    db.flush()
    audit_school_action(db, request, "create", "SchoolUser", user.id, f"Created {payload.school_role} account for {user.name}")
    db.commit()
    return {**model_dict(assignment), "name": user.name, "username": user.username, "phone": user.phone, "email": user.email}


@router.put("/users/{assignment_id}")
def update_school_user_assignment(assignment_id: int, payload: SchoolAssignmentPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_users")
    ensure_campus_access(access, payload.campus_id)
    if payload.school_role not in SCHOOL_ROLE_PERMISSIONS:
        raise HTTPException(status_code=400, detail="Unknown school role.")
    assignment = db.query(SchoolRoleAssignment).filter(
        SchoolRoleAssignment.id == assignment_id,
        SchoolRoleAssignment.workspace_id == access["workspace"].id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="School account assignment not found.")
    assignment.campus_id = payload.campus_id
    assignment.school_role = payload.school_role
    assignment.student_id = payload.student_id
    assignment.permission_overrides = json.dumps([
        value for value in payload.permission_overrides if value in ALL_SCHOOL_PERMISSIONS
    ])
    assignment.is_active = payload.is_active
    audit_school_action(db, request, "update", "SchoolUser", assignment.user_id, f"Updated school role to {assignment.school_role}")
    db.commit()
    return model_dict(assignment)


@router.post("/notifications")
def create_notification(payload: NotificationPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "send_notifications")
    ensure_campus_access(access, payload.campus_id)
    if payload.audience_type not in {"All", "Campus", "Role", "User"}:
        raise HTTPException(status_code=400, detail="Unknown notification audience.")
    item = SchoolNotification(
        workspace_id=access["workspace"].id,
        created_by_user_id=access["user"].id,
        published_at=datetime.utcnow(),
        **payload.model_dump(),
    )
    db.add(item)
    db.flush()
    audit_school_action(db, request, "create", "SchoolNotification", item.id, f"Published notification: {item.title}")
    db.commit()
    return model_dict(item)


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "view_dashboard")
    notification = db.query(SchoolNotification).filter(
        SchoolNotification.id == notification_id,
        SchoolNotification.workspace_id == access["workspace"].id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found.")
    existing = db.query(SchoolNotificationReceipt).filter(
        SchoolNotificationReceipt.notification_id == notification_id,
        SchoolNotificationReceipt.user_id == access["user"].id,
    ).first()
    if not existing:
        db.add(SchoolNotificationReceipt(notification_id=notification_id, user_id=access["user"].id))
        db.commit()
    return {"status": "read"}


@router.delete("/notifications/{notification_id}")
def archive_notification(notification_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "send_notifications")
    item = db.query(SchoolNotification).filter(
        SchoolNotification.id == notification_id,
        SchoolNotification.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Notification not found.")
    item.status = "Archived"
    audit_school_action(db, request, "archive", "SchoolNotification", item.id, f"Archived notification: {item.title}")
    db.commit()
    return {"status": "archived"}


ALLOWED_SCHOOL_DOCUMENT_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
    ".png", ".jpg", ".jpeg", ".webp", ".svg",
}


@router.post("/documents")
async def upload_school_document(
    request: Request,
    title: str = Form(...),
    category: str = Form("General"),
    campus_id: int | None = Form(None),
    entity_type: str = Form("School"),
    entity_id: int | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "manage_documents")
    ensure_campus_access(access, campus_id)
    safe_name = sanitize_upload_filename(file.filename or "document")
    extension = Path(safe_name).suffix.lower()
    if extension not in ALLOWED_SCHOOL_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported document type.")
    content = await file.read(15_000_001)
    if len(content) > 15_000_000:
        raise HTTPException(status_code=400, detail="Document must be 15 MB or smaller.")
    SCHOOL_DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{extension}"
    stored_path = (SCHOOL_DOCUMENT_DIR / stored_name).resolve()
    stored_path.write_bytes(content)
    item = SchoolDocument(
        workspace_id=access["workspace"].id,
        campus_id=campus_id,
        entity_type=str(entity_type or "School")[:50],
        entity_id=entity_id,
        category=str(category or "General")[:80],
        title=str(title or safe_name).strip()[:160],
        original_filename=safe_name,
        storage_path=str(stored_path),
        file_url=f"/static/uploads/school-documents/{stored_name}",
        content_type=file.content_type,
        file_size=len(content),
        uploaded_by_user_id=access["user"].id,
    )
    db.add(item)
    db.flush()
    audit_school_action(db, request, "upload", "SchoolDocument", item.id, f"Uploaded school document {item.title}")
    db.commit()
    return model_dict(item)


@router.delete("/documents/{document_id}")
def delete_school_document(document_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_documents")
    item = db.query(SchoolDocument).filter(
        SchoolDocument.id == document_id,
        SchoolDocument.workspace_id == access["workspace"].id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Document not found.")
    ensure_campus_access(access, item.campus_id)
    safe_root = SCHOOL_DOCUMENT_DIR.resolve()
    stored_path = Path(item.storage_path).resolve()
    audit_school_action(db, request, "delete", "SchoolDocument", item.id, f"Deleted school document {item.title}")
    db.delete(item)
    db.commit()
    try:
        if stored_path.is_file() and safe_root in stored_path.parents:
            stored_path.unlink()
    except OSError:
        pass
    return {"status": "deleted"}
