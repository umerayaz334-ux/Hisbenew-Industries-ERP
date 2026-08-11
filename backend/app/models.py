from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Text, UniqueConstraint, event
from sqlalchemy.orm import Session, relationship, with_loader_criteria
from datetime import datetime

from .database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    logo = Column(Text, nullable=True)
    status = Column(String, default="active", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users = relationship("User", back_populates="tenant")


class Module(Base):
    __tablename__ = "modules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    page_name = Column(String, nullable=True, index=True)
    description = Column(Text, nullable=True)
    default_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TenantModule(Base):
    __tablename__ = "tenant_modules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_id", name="uq_tenant_module"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    module_id = Column(Integer, ForeignKey("modules.id"), nullable=False, index=True)
    enabled = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    module = relationship("Module")


class CustomPage(Base):
    __tablename__ = "custom_pages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_custom_page_tenant_slug"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    page_name = Column(String, nullable=False)
    slug = Column(String, nullable=False, index=True)
    fields_json = Column(Text, nullable=False, default="[]")
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    article_no = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    share_image_url = Column(String, nullable=True)
    label_url = Column(String, nullable=True)
    options = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    factory_stock = Column(Integer, default=0)
    usa_stock = Column(Integer, default=0)
    front_room_stock = Column(Integer, default=0)
    reserved_stock = Column(Integer, default=0)

    cost_price = Column(Float, default=0)
    selling_price = Column(Float, default=0)
    unit_weight_kg = Column(Float, default=0)
    low_stock_alert = Column(Integer, default=10)

    workflow_required = Column(Boolean, default=True)


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    company_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    country = Column(String, nullable=True)
    address = Column(String, nullable=True)
    shipping_address = Column(Text, nullable=True)
    platform = Column(String, nullable=True)

    orders = relationship("Order", back_populates="customer")


class BusinessWorkspace(Base):
    __tablename__ = "business_workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    workspace_type = Column(String, nullable=False, default="school", index=True)
    default_currency = Column(String, default="PKR")
    timezone = Column(String, default="Asia/Karachi")
    default_language = Column(String, default="en")
    secondary_language = Column(String, default="ur")
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolCampus(Base):
    __tablename__ = "school_campuses"
    __table_args__ = (UniqueConstraint("workspace_id", "code", name="uq_school_campus_code"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False, index=True)
    campus_type = Column(String, default="Main")
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    principal_name = Column(String, nullable=True)
    primary_color = Column(String, default="#191797")
    accent_color = Column(String, default="#fff200")
    logo_data_url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAcademicSession(Base):
    __tablename__ = "school_academic_sessions"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    status = Column(String, default="Upcoming", index=True)
    is_current = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAcademicTerm(Base):
    __tablename__ = "school_academic_terms"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    term_type = Column(String, default="Term")
    sequence = Column(Integer, default=1)
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    status = Column(String, default="Upcoming", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolRoom(Base):
    __tablename__ = "school_rooms"
    __table_args__ = (UniqueConstraint("campus_id", "code", name="uq_school_room_code"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False)
    room_type = Column(String, default="Classroom")
    capacity = Column(Integer, default=30)
    floor = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolClass(Base):
    __tablename__ = "school_classes"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    grade_level = Column(String, nullable=True)
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolSection(Base):
    __tablename__ = "school_sections"
    __table_args__ = (UniqueConstraint("school_class_id", "name", name="uq_school_section_name"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("school_rooms.id"), nullable=True)
    class_teacher_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String, nullable=False)
    capacity = Column(Integer, default=30)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolSubject(Base):
    __tablename__ = "school_subjects"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    code = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    name_ur = Column(String, nullable=True)
    subject_type = Column(String, default="Core")
    total_marks = Column(Float, default=100)
    passing_marks = Column(Float, default=40)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolClassSubject(Base):
    __tablename__ = "school_class_subjects"
    __table_args__ = (UniqueConstraint("school_class_id", "subject_id", name="uq_school_class_subject"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("school_subjects.id"), nullable=False, index=True)
    teacher_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    periods_per_week = Column(Integer, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)


class SchoolStudent(Base):
    __tablename__ = "school_students"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=True, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=True, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=True, index=True)
    school_section_id = Column(Integer, ForeignKey("school_sections.id"), nullable=True, index=True)
    application_id = Column(Integer, ForeignKey("school_admission_applications.id"), nullable=True, index=True)
    admission_no = Column(String, unique=True, index=True, nullable=False)
    student_name = Column(String, nullable=False, index=True)
    father_name = Column(String, nullable=True)
    guardian_name = Column(String, nullable=True)
    guardian_phone = Column(String, nullable=True, index=True)
    date_of_birth = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    class_name = Column(String, nullable=False, index=True)
    section = Column(String, nullable=True, index=True)
    roll_number = Column(String, nullable=True)
    admission_date = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    status = Column(String, default="Active", index=True)
    notes = Column(Text, nullable=True)
    photo_url = Column(Text, nullable=True)
    preferred_language = Column(String, default="en")
    b_form_no = Column(String, nullable=True, index=True)
    birth_certificate_no = Column(String, nullable=True)
    mother_name = Column(String, nullable=True)
    previous_school = Column(String, nullable=True)
    blood_group = Column(String, nullable=True)
    family_discount_percent = Column(Float, default=0)
    graduation_date = Column(String, nullable=True)
    withdrawal_date = Column(String, nullable=True)
    alumni_since = Column(String, nullable=True)
    archived_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAdmissionFormField(Base):
    __tablename__ = "school_admission_form_fields"
    __table_args__ = (
        UniqueConstraint("workspace_id", "field_key", name="uq_school_admission_field_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    field_key = Column(String, nullable=False)
    label = Column(String, nullable=False)
    label_ur = Column(String, nullable=True)
    input_type = Column(String, default="text")
    options_json = Column(Text, nullable=True)
    is_required = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    display_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAdmissionApplication(Base):
    __tablename__ = "school_admission_applications"
    __table_args__ = (
        UniqueConstraint("workspace_id", "application_no", name="uq_school_application_number"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=False, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=True, index=True)
    school_section_id = Column(Integer, ForeignKey("school_sections.id"), nullable=True, index=True)
    admitted_student_id = Column(Integer, ForeignKey("school_students.id"), nullable=True, index=True)
    application_no = Column(String, nullable=False, index=True)
    source = Column(String, default="Office", index=True)
    status = Column(String, default="Submitted", index=True)
    student_name = Column(String, nullable=False, index=True)
    date_of_birth = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    b_form_no = Column(String, nullable=True, index=True)
    birth_certificate_no = Column(String, nullable=True)
    father_name = Column(String, nullable=True)
    mother_name = Column(String, nullable=True)
    guardian_name = Column(String, nullable=True)
    guardian_phone = Column(String, nullable=True, index=True)
    guardian_email = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    previous_school = Column(String, nullable=True)
    medical_conditions = Column(Text, nullable=True)
    allergies = Column(Text, nullable=True)
    special_requirements = Column(Text, nullable=True)
    emergency_contact_name = Column(String, nullable=True)
    emergency_contact_phone = Column(String, nullable=True)
    custom_answers_json = Column(Text, nullable=True)
    test_scheduled_at = Column(String, nullable=True)
    test_venue = Column(String, nullable=True)
    test_score = Column(Float, nullable=True)
    test_result = Column(String, nullable=True)
    interview_scheduled_at = Column(String, nullable=True)
    interviewer = Column(String, nullable=True)
    interview_result = Column(String, nullable=True)
    review_notes = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow, index=True)
    reviewed_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentGuardian(Base):
    __tablename__ = "school_student_guardians"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    full_name = Column(String, nullable=False)
    relationship_type = Column(String, default="Guardian")
    cnic = Column(String, nullable=True, index=True)
    phone = Column(String, nullable=True, index=True)
    alternate_phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    occupation = Column(String, nullable=True)
    employer = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    is_primary = Column(Boolean, default=False)
    is_authorized_pickup = Column(Boolean, default=True)
    receives_notifications = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentEmergencyContact(Base):
    __tablename__ = "school_student_emergency_contacts"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    full_name = Column(String, nullable=False)
    relationship_type = Column(String, nullable=True)
    phone = Column(String, nullable=False)
    alternate_phone = Column(String, nullable=True)
    priority = Column(Integer, default=1)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentSiblingLink(Base):
    __tablename__ = "school_student_sibling_links"
    __table_args__ = (
        UniqueConstraint("student_id", "sibling_student_id", name="uq_school_student_sibling"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    sibling_student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    family_discount_percent = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SchoolStudentEnrollment(Base):
    __tablename__ = "school_student_enrollments"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=False, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=True, index=True)
    school_section_id = Column(Integer, ForeignKey("school_sections.id"), nullable=True, index=True)
    class_name = Column(String, nullable=False)
    section_name = Column(String, nullable=True)
    roll_number = Column(String, nullable=True)
    status = Column(String, default="Active", index=True)
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=True)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentLifecycleEvent(Base):
    __tablename__ = "school_student_lifecycle_events"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    event_date = Column(String, nullable=False, index=True)
    from_campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True)
    to_campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True)
    from_class_name = Column(String, nullable=True)
    to_class_name = Column(String, nullable=True)
    from_section_name = Column(String, nullable=True)
    to_section_name = Column(String, nullable=True)
    reason = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    recorded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolStudentMedicalProfile(Base):
    __tablename__ = "school_student_medical_profiles"
    __table_args__ = (UniqueConstraint("student_id", name="uq_school_student_medical"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    blood_group = Column(String, nullable=True)
    medical_conditions = Column(Text, nullable=True)
    allergies = Column(Text, nullable=True)
    medications = Column(Text, nullable=True)
    disabilities = Column(Text, nullable=True)
    special_requirements = Column(Text, nullable=True)
    doctor_name = Column(String, nullable=True)
    doctor_phone = Column(String, nullable=True)
    health_notes = Column(Text, nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentCertificate(Base):
    __tablename__ = "school_student_certificates"
    __table_args__ = (
        UniqueConstraint("workspace_id", "certificate_no", name="uq_school_certificate_number"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    certificate_no = Column(String, nullable=False, index=True)
    certificate_type = Column(String, nullable=False, index=True)
    issue_date = Column(String, nullable=False)
    purpose = Column(String, nullable=True)
    conduct = Column(String, nullable=True)
    remarks = Column(Text, nullable=True)
    snapshot_json = Column(Text, nullable=True)
    issued_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolAttendancePolicy(Base):
    __tablename__ = "school_attendance_policies"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    low_attendance_threshold = Column(Float, default=75)
    late_grace_minutes = Column(Integer, default=10)
    school_start_time = Column(String, default="08:00")
    school_end_time = Column(String, default="14:00")
    automatic_parent_notifications = Column(Boolean, default=True)
    notification_channels_json = Column(Text, default='["In-app"]')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAttendanceSession(Base):
    __tablename__ = "school_attendance_sessions"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=False, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=False, index=True)
    school_section_id = Column(Integer, ForeignKey("school_sections.id"), nullable=True, index=True)
    subject_id = Column(Integer, ForeignKey("school_subjects.id"), nullable=True, index=True)
    attendance_date = Column(String, nullable=False, index=True)
    attendance_type = Column(String, default="Daily", index=True)
    period_label = Column(String, nullable=True)
    status = Column(String, default="Draft", index=True)
    taken_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentAttendance(Base):
    __tablename__ = "school_student_attendance"
    __table_args__ = (
        UniqueConstraint("attendance_session_id", "student_id", name="uq_school_student_attendance_session"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    attendance_session_id = Column(Integer, ForeignKey("school_attendance_sessions.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    status = Column(String, default="Present", index=True)
    check_in_time = Column(String, nullable=True)
    check_out_time = Column(String, nullable=True)
    late_minutes = Column(Integer, default=0)
    early_departure_minutes = Column(Integer, default=0)
    absence_reason = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    supporting_document_id = Column(Integer, ForeignKey("school_documents.id"), nullable=True)
    capture_method = Column(String, default="Manual", index=True)
    external_reference = Column(String, nullable=True, index=True)
    marked_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    marked_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStaffAttendance(Base):
    __tablename__ = "school_staff_attendance"
    __table_args__ = (
        UniqueConstraint("workspace_id", "campus_id", "staff_user_id", "attendance_date", name="uq_school_staff_attendance_day"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    staff_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    attendance_date = Column(String, nullable=False, index=True)
    status = Column(String, default="Present", index=True)
    check_in_time = Column(String, nullable=True)
    check_out_time = Column(String, nullable=True)
    late_minutes = Column(Integer, default=0)
    early_departure_minutes = Column(Integer, default=0)
    absence_reason = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    supporting_document_id = Column(Integer, ForeignKey("school_documents.id"), nullable=True)
    capture_method = Column(String, default="Manual", index=True)
    external_reference = Column(String, nullable=True, index=True)
    marked_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    marked_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolLeaveApplication(Base):
    __tablename__ = "school_leave_applications"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    applicant_type = Column(String, nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=True, index=True)
    staff_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    leave_type = Column(String, default="Casual", index=True)
    start_date = Column(String, nullable=False, index=True)
    end_date = Column(String, nullable=False, index=True)
    reason = Column(Text, nullable=False)
    supporting_document_id = Column(Integer, ForeignKey("school_documents.id"), nullable=True)
    status = Column(String, default="Pending", index=True)
    applied_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    review_notes = Column(Text, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAttendanceCorrection(Base):
    __tablename__ = "school_attendance_corrections"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    target_type = Column(String, nullable=False, index=True)
    student_attendance_id = Column(Integer, ForeignKey("school_student_attendance.id"), nullable=True, index=True)
    staff_attendance_id = Column(Integer, ForeignKey("school_staff_attendance.id"), nullable=True, index=True)
    current_status = Column(String, nullable=False)
    requested_status = Column(String, nullable=False)
    requested_check_in_time = Column(String, nullable=True)
    requested_check_out_time = Column(String, nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String, default="Pending", index=True)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    review_notes = Column(Text, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolAttendanceAlert(Base):
    __tablename__ = "school_attendance_alerts"
    __table_args__ = (
        UniqueConstraint("student_attendance_id", "recipient_key", name="uq_school_attendance_alert_recipient"),
    )

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    student_attendance_id = Column(Integer, ForeignKey("school_student_attendance.id"), nullable=False, index=True)
    recipient_key = Column(String, nullable=False, index=True)
    recipient_name = Column(String, nullable=True)
    recipient_phone = Column(String, nullable=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    channel = Column(String, default="In-app")
    message = Column(Text, nullable=False)
    status = Column(String, default="Queued", index=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolAttendanceChangeLog(Base):
    __tablename__ = "school_attendance_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    target_type = Column(String, nullable=False, index=True)
    target_id = Column(Integer, nullable=False, index=True)
    action = Column(String, nullable=False, index=True)
    before_json = Column(Text, nullable=True)
    after_json = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    changed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolFinanceSettings(Base):
    __tablename__ = "school_finance_settings"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    invoice_prefix = Column(String, default="FEE")
    receipt_prefix = Column(String, default="RCP")
    default_due_day = Column(Integer, default=10)
    late_fee_type = Column(String, default="Flat")
    late_fee_value = Column(Float, default=0)
    late_fee_grace_days = Column(Integer, default=0)
    automatic_reminders = Column(Boolean, default=True)
    reminder_days_before = Column(Integer, default=3)
    sync_to_erp = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeeHead(Base):
    __tablename__ = "school_fee_heads"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False, index=True)
    category = Column(String, default="Other", index=True)
    description = Column(Text, nullable=True)
    is_refundable = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeeStructure(Base):
    __tablename__ = "school_fee_structures"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    school_class_id = Column(Integer, ForeignKey("school_classes.id"), nullable=True, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    billing_frequency = Column(String, default="Monthly", index=True)
    billing_month = Column(Integer, default=4)
    due_day = Column(Integer, default=10)
    effective_from = Column(String, nullable=True)
    effective_to = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeeStructureItem(Base):
    __tablename__ = "school_fee_structure_items"
    __table_args__ = (UniqueConstraint("fee_structure_id", "fee_head_id", name="uq_school_fee_structure_head"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    fee_structure_id = Column(Integer, ForeignKey("school_fee_structures.id"), nullable=False, index=True)
    fee_head_id = Column(Integer, ForeignKey("school_fee_heads.id"), nullable=False, index=True)
    amount = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolStudentDiscount(Base):
    __tablename__ = "school_student_discounts"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    fee_head_id = Column(Integer, ForeignKey("school_fee_heads.id"), nullable=True, index=True)
    discount_type = Column(String, default="Custom", index=True)
    name = Column(String, nullable=False)
    calculation_type = Column(String, default="Percentage")
    value = Column(Float, default=0)
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeeInvoice(Base):
    __tablename__ = "school_fee_invoices"
    __table_args__ = (UniqueConstraint("workspace_id", "student_id", "billing_period", name="uq_school_student_fee_period"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    academic_session_id = Column(Integer, ForeignKey("school_academic_sessions.id"), nullable=True, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    invoice_no = Column(String, nullable=False, unique=True, index=True)
    billing_period = Column(String, nullable=False, index=True)
    issue_date = Column(String, nullable=False, index=True)
    due_date = Column(String, nullable=False, index=True)
    status = Column(String, default="Issued", index=True)
    subtotal = Column(Float, default=0)
    discount_amount = Column(Float, default=0)
    late_fee_amount = Column(Float, default=0)
    adjustment_amount = Column(Float, default=0)
    total_amount = Column(Float, default=0)
    paid_amount = Column(Float, default=0)
    balance_amount = Column(Float, default=0, index=True)
    notes = Column(Text, nullable=True)
    generated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeeInvoiceItem(Base):
    __tablename__ = "school_fee_invoice_items"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("school_fee_invoices.id"), nullable=False, index=True)
    fee_structure_id = Column(Integer, ForeignKey("school_fee_structures.id"), nullable=True, index=True)
    fee_head_id = Column(Integer, ForeignKey("school_fee_heads.id"), nullable=True, index=True)
    description = Column(String, nullable=False)
    quantity = Column(Float, default=1)
    unit_amount = Column(Float, default=0)
    gross_amount = Column(Float, default=0)
    discount_amount = Column(Float, default=0)
    net_amount = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class SchoolFinanceAccount(Base):
    __tablename__ = "school_finance_accounts"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    name = Column(String, nullable=False, index=True)
    account_type = Column(String, default="Cash", index=True)
    bank_name = Column(String, nullable=True)
    account_number = Column(String, nullable=True)
    opening_balance = Column(Float, default=0)
    erp_accounting_account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeePayment(Base):
    __tablename__ = "school_fee_payments"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    finance_account_id = Column(Integer, ForeignKey("school_finance_accounts.id"), nullable=False, index=True)
    payment_no = Column(String, nullable=False, unique=True, index=True)
    amount = Column(Float, default=0)
    unallocated_amount = Column(Float, default=0)
    payment_method = Column(String, default="Cash", index=True)
    payment_reference = Column(String, nullable=True)
    received_date = Column(String, nullable=False, index=True)
    status = Column(String, default="Posted", index=True)
    notes = Column(Text, nullable=True)
    received_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeePaymentAllocation(Base):
    __tablename__ = "school_fee_payment_allocations"
    __table_args__ = (UniqueConstraint("payment_id", "invoice_id", name="uq_school_payment_invoice"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    payment_id = Column(Integer, ForeignKey("school_fee_payments.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("school_fee_invoices.id"), nullable=False, index=True)
    amount = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolFeeAdjustment(Base):
    __tablename__ = "school_fee_adjustments"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("school_fee_invoices.id"), nullable=False, index=True)
    adjustment_type = Column(String, nullable=False, index=True)
    category = Column(String, default="Custom")
    amount = Column(Float, default=0)
    reason = Column(Text, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolFeeRefund(Base):
    __tablename__ = "school_fee_refunds"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    payment_id = Column(Integer, ForeignKey("school_fee_payments.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("school_fee_invoices.id"), nullable=True, index=True)
    finance_account_id = Column(Integer, ForeignKey("school_finance_accounts.id"), nullable=False, index=True)
    refund_no = Column(String, nullable=False, unique=True, index=True)
    amount = Column(Float, default=0)
    refund_method = Column(String, default="Cash")
    refund_date = Column(String, nullable=False, index=True)
    reason = Column(Text, nullable=False)
    status = Column(String, default="Posted", index=True)
    processed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolFinanceEntry(Base):
    __tablename__ = "school_finance_entries"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    finance_account_id = Column(Integer, ForeignKey("school_finance_accounts.id"), nullable=False, index=True)
    direction = Column(String, nullable=False, index=True)
    entry_type = Column(String, nullable=False, index=True)
    category = Column(String, default="General", index=True)
    amount = Column(Float, default=0)
    entry_date = Column(String, nullable=False, index=True)
    counterparty = Column(String, nullable=True)
    reference = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    source_type = Column(String, nullable=True, index=True)
    source_id = Column(Integer, nullable=True, index=True)
    erp_transaction_id = Column(Integer, ForeignKey("accounting_transactions.id"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolCashClosing(Base):
    __tablename__ = "school_cash_closings"
    __table_args__ = (UniqueConstraint("workspace_id", "campus_id", "finance_account_id", "closing_date", name="uq_school_cash_closing_day"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    finance_account_id = Column(Integer, ForeignKey("school_finance_accounts.id"), nullable=False, index=True)
    closing_date = Column(String, nullable=False, index=True)
    opening_cash = Column(Float, default=0)
    cash_collected = Column(Float, default=0)
    other_income = Column(Float, default=0)
    cash_out = Column(Float, default=0)
    expected_cash = Column(Float, default=0)
    actual_cash = Column(Float, default=0)
    variance = Column(Float, default=0)
    status = Column(String, default="Closed", index=True)
    notes = Column(Text, nullable=True)
    closed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolBankReconciliation(Base):
    __tablename__ = "school_bank_reconciliations"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    finance_account_id = Column(Integer, ForeignKey("school_finance_accounts.id"), nullable=False, index=True)
    statement_date = Column(String, nullable=False, index=True)
    book_balance = Column(Float, default=0)
    statement_balance = Column(Float, default=0)
    difference = Column(Float, default=0)
    status = Column(String, default="Pending", index=True)
    notes = Column(Text, nullable=True)
    reconciled_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SchoolFeeReminder(Base):
    __tablename__ = "school_fee_reminders"
    __table_args__ = (UniqueConstraint("invoice_id", "recipient_key", "reminder_date", name="uq_school_fee_reminder_recipient"),)

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("school_fee_invoices.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=False, index=True)
    recipient_key = Column(String, nullable=False, index=True)
    recipient_name = Column(String, nullable=True)
    recipient_phone = Column(String, nullable=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    channel = Column(String, default="In-app")
    message = Column(Text, nullable=False)
    reminder_date = Column(String, nullable=False, index=True)
    status = Column(String, default="Queued", index=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    username = Column(String, nullable=True, index=True)
    pin = Column(String, nullable=False, default="0000")
    raw_pin = Column(String, nullable=True)
    role = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    allowed_pages = Column(Text, nullable=True)
    customer_privacy_settings = Column(Text, nullable=True)
    session_expiry_minutes = Column(Integer, nullable=True, default=0)
    is_active = Column(Boolean, default=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="users")


class SchoolRoleAssignment(Base):
    __tablename__ = "school_role_assignments"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("school_students.id"), nullable=True, index=True)
    school_role = Column(String, nullable=False, index=True)
    permission_overrides = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolNotification(Base):
    __tablename__ = "school_notifications"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    title_ur = Column(String, nullable=True)
    body = Column(Text, nullable=False)
    body_ur = Column(Text, nullable=True)
    audience_type = Column(String, default="All", index=True)
    audience_value = Column(String, nullable=True)
    priority = Column(String, default="Normal", index=True)
    status = Column(String, default="Published", index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SchoolNotificationReceipt(Base):
    __tablename__ = "school_notification_receipts"
    __table_args__ = (UniqueConstraint("notification_id", "user_id", name="uq_school_notification_read"),)

    id = Column(Integer, primary_key=True, index=True)
    notification_id = Column(Integer, ForeignKey("school_notifications.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    read_at = Column(DateTime, default=datetime.utcnow)


class SchoolDocument(Base):
    __tablename__ = "school_documents"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("business_workspaces.id"), nullable=False, index=True)
    campus_id = Column(Integer, ForeignKey("school_campuses.id"), nullable=True, index=True)
    entity_type = Column(String, default="School", index=True)
    entity_id = Column(Integer, nullable=True, index=True)
    category = Column(String, default="General", index=True)
    title = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    storage_path = Column(Text, nullable=False)
    file_url = Column(Text, nullable=False)
    content_type = Column(String, nullable=True)
    file_size = Column(Integer, default=0)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    actor_user_id = Column(Integer, nullable=True, index=True)
    actor_user_name = Column(String, nullable=True)
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    summary = Column(String, nullable=False)
    detail = Column(Text, nullable=True)
    page = Column(String, nullable=True)
    request_method = Column(String, nullable=True)
    request_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class UserRoleRequest(Base):
    __tablename__ = "user_role_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_name = Column(String, nullable=False)
    username = Column(String, nullable=True)
    requested_role = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String, default="Open", index=True)
    admin_note = Column(Text, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class PublicAccessRequest(Base):
    __tablename__ = "public_access_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    full_name = Column(String, nullable=False, index=True)
    preferred_username = Column(String, nullable=True)
    work_email = Column(String, nullable=True, index=True)
    phone = Column(String, nullable=True, index=True)
    requested_workspace = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String, default="Pending", index=True)
    admin_note = Column(Text, nullable=True)
    approved_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    approved_user = relationship("User", foreign_keys=[approved_user_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_user_id])

class InternalMessage(Base):
    __tablename__ = "internal_messages"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    read_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    sender = relationship("User", foreign_keys=[sender_user_id])
    recipient = relationship("User", foreign_keys=[recipient_user_id])


class InternalCall(Base):
    __tablename__ = "internal_calls"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    caller_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    call_type = Column(String, nullable=False, default="audio")
    status = Column(String, nullable=False, default="ringing", index=True)
    answered_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    ended_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    caller_last_seen_at = Column(DateTime, nullable=True)
    recipient_last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    caller = relationship("User", foreign_keys=[caller_user_id])
    recipient = relationship("User", foreign_keys=[recipient_user_id])
    ended_by = relationship("User", foreign_keys=[ended_by_user_id])


class InternalCallSignal(Base):
    __tablename__ = "internal_call_signals"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    call_id = Column(Integer, ForeignKey("internal_calls.id"), nullable=False, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    signal_type = Column(String, nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    call = relationship("InternalCall")
    sender = relationship("User")


class OrderImportBatch(Base):
    __tablename__ = "order_import_batches"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    batch_key = Column(String, unique=True, index=True, nullable=False)
    filename = Column(String, nullable=True)
    source_format = Column(String, nullable=True)
    imported_count = Column(Integer, default=0)
    item_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    needs_customer_assignment_count = Column(Integer, default=0)
    status = Column(String, default="Imported", index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)
    reversed_at = Column(DateTime, nullable=True)
    reversed_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    created_by = relationship("User")


class InspirationItem(Base):
    __tablename__ = "inspiration_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    image_url = Column(Text, nullable=True)
    status = Column(String, default="saved")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    order_no = Column(String, unique=True, index=True, nullable=False)

    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    import_customer_name = Column(String, nullable=True)
    import_customer_company_name = Column(String, nullable=True)
    import_contact_name = Column(String, nullable=True)
    import_contact_phone = Column(String, nullable=True)
    import_shipping_name = Column(String, nullable=True)
    import_shipping_address = Column(Text, nullable=True)
    import_ship_date = Column(DateTime, nullable=True)
    import_batch_key = Column(String, nullable=True, index=True)
    platform = Column(String, default="Manual")

    order_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="New")
    payment_status = Column(String, default="Pending")
    shipping_status = Column(String, default="Pending")
    shipping_weight_override_kg = Column(Float, nullable=True)

    total_amount = Column(Float, default=0)
    order_total_usd = Column(Float, default=0)
    platform_fee_usd = Column(Float, default=0)
    deduction_usd = Column(Float, default=0)
    expected_payout_usd = Column(Float, default=0)
    expected_payout_date = Column(DateTime, nullable=True)
    payment_source = Column(String, nullable=True)
    payout_status = Column(String, default="Not Received")
    received_payout_usd = Column(Float, default=0)
    remaining_payout_usd = Column(Float, default=0)
    exchange_rate = Column(Float, default=0)
    received_pkr = Column(Float, default=0)
    bank_charges_pkr = Column(Float, default=0)
    final_received_pkr = Column(Float, default=0)
    payout_notes = Column(String, nullable=True)
    payout_received_date = Column(DateTime, nullable=True)

    notes = Column(String, nullable=True)

    customer = relationship("Customer", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    line_total = Column(Float, default=0)

    stock_source = Column(String, default="Factory")
    manufacturing_required = Column(Boolean, default=False)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    movement_type = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    stock_type = Column(String, nullable=True)
    purchase_price = Column(Float, default=0)
    source = Column(String, nullable=True)
    reference = Column(String, nullable=True)
    note = Column(String, nullable=True)
    faulty = Column(Boolean, default=False)
    faulty_quantity = Column(Integer, default=0)
    faulty_note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product")
    supplier = relationship("Supplier", back_populates="stock_movements")


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    name = Column(String, nullable=False)
    contact_person = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("SupplierTransaction", back_populates="supplier", cascade="all, delete")
    payments = relationship("SupplierPayment", back_populates="supplier", cascade="all, delete")
    stock_movements = relationship("StockMovement", back_populates="supplier")
    order_items = relationship("SupplierOrderItem", back_populates="supplier", cascade="all, delete")
    supply_items = relationship("SupplierSupplyItem", back_populates="supplier", cascade="all, delete")


class SupplierOrderItem(Base):
    __tablename__ = "supplier_order_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    ordered_quantity = Column(Integer, default=0)
    received_quantity = Column(Integer, default=0)
    purchase_price = Column(Float, default=0)
    stock_type = Column(String, default="factory_stock")
    reference = Column(String, nullable=True)
    note = Column(String, nullable=True)
    status = Column(String, default="Ordered")
    is_closed = Column(Boolean, default=False)
    closed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="order_items")
    product = relationship("Product")


class SupplierSupplyItem(Base):
    __tablename__ = "supplier_supply_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    sku = Column(String, nullable=True)
    item_name = Column(String, nullable=False)
    category = Column(String, default="Miscellaneous")
    usage_area = Column(String, default="General")
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="supply_items")


class SupplierTransaction(Base):
    __tablename__ = "supplier_transactions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    transaction_type = Column(String, nullable=False)  # Invoice, Credit, Return etc.
    reference = Column(String, nullable=True)
    amount = Column(Float, default=0)
    balance_after = Column(Float, default=0)
    note = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="transactions")


class SupplierPayment(Base):
    __tablename__ = "supplier_payments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    amount = Column(Float, default=0)
    payment_method = Column(String, nullable=True)
    payment_reference = Column(String, nullable=True)
    note = Column(String, nullable=True)

    payment_date = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="payments")


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    step_order = Column(Integer, nullable=False)
    step_name = Column(String, nullable=False)

    worker_role = Column(String, nullable=True)
    rate_per_piece = Column(Float, default=0)
    estimated_minutes_per_piece = Column(Float, default=0)

    is_optional = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    product = relationship("Product")


class Worker(Base):
    __tablename__ = "workers"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    name = Column(String, nullable=False)
    role = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    department = Column(String, nullable=True)

    rate_per_piece = Column(Float, default=0)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    payments = relationship("WorkerPayment", back_populates="worker", cascade="all, delete")


class WorkerPayment(Base):
    __tablename__ = "worker_payments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False, index=True)
    amount = Column(Float, default=0)
    payment_method = Column(String, nullable=True)
    payment_reference = Column(String, nullable=True)
    note = Column(String, nullable=True)
    accounting_transaction_id = Column(Integer, ForeignKey("accounting_transactions.id"), nullable=True)
    paid_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    worker = relationship("Worker", back_populates="payments")
    accounting_transaction = relationship("AccountingTransaction")


class Shipping(Base):
    __tablename__ = "shipping"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    order_id = Column(Integer, ForeignKey("orders.id"), unique=True, nullable=False)

    courier_name = Column(String, nullable=True)
    tracking_number = Column(String, nullable=True)
    package_weight_kg = Column(Float, nullable=True)
    shipping_cost = Column(Float, nullable=True)
    shipping_note = Column(String, nullable=True)
    shipping_service = Column(String, default="duty_paid")
    destination_zip_prefix = Column(String, nullable=True)
    shipping_zone = Column(String, nullable=True)
    calculated_weight_kg = Column(Float, nullable=True)
    estimated_shipping_cost = Column(Float, nullable=True)
    rate_source_version = Column(String, nullable=True)

    shipped_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    order = relationship("Order")


class FulfillmentShipment(Base):
    __tablename__ = "fulfillment_shipments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    shipment_no = Column(String, unique=True, index=True, nullable=False)
    destination_name = Column(String, nullable=True)
    source_stock = Column(String, default="Factory")
    status = Column(String, default="In Transit", index=True)
    carton_count = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow, index=True)
    admin_received_at = Column(DateTime, nullable=True)
    fulfillment_received_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    boxes = relationship(
        "FulfillmentBox",
        back_populates="shipment",
        cascade="all, delete",
    )


class FulfillmentBox(Base):
    __tablename__ = "fulfillment_boxes"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    shipment_id = Column(Integer, ForeignKey("fulfillment_shipments.id"), nullable=False, index=True)
    box_number = Column(String, nullable=False)
    weight_kg = Column(Float, nullable=True)
    length_cm = Column(Float, nullable=True)
    width_cm = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    location = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    shipment = relationship("FulfillmentShipment", back_populates="boxes")
    items = relationship(
        "FulfillmentBoxItem",
        back_populates="box",
        cascade="all, delete",
    )


class FulfillmentBoxItem(Base):
    __tablename__ = "fulfillment_box_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    box_id = Column(Integer, ForeignKey("fulfillment_boxes.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, default=0)
    available_quantity = Column(Integer, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    box = relationship("FulfillmentBox", back_populates="items")
    product = relationship("Product")


class FulfillmentInventoryDiscrepancy(Base):
    __tablename__ = "fulfillment_inventory_discrepancies"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    box_item_id = Column(
        Integer,
        ForeignKey("fulfillment_box_items.id"),
        nullable=False,
        index=True,
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    reason = Column(String, nullable=False, index=True)
    quantity_delta = Column(Integer, nullable=False)
    available_before = Column(Integer, nullable=False)
    available_after = Column(Integer, nullable=False)
    reference = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    box_item = relationship("FulfillmentBoxItem")
    product = relationship("Product")


class FulfillmentOrder(Base):
    __tablename__ = "fulfillment_orders"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    fulfillment_order_no = Column(String, unique=True, index=True, nullable=False)
    customer_name = Column(String, nullable=True)
    platform = Column(String, nullable=True)
    ship_to = Column(Text, nullable=True)
    status = Column(String, default="Unfulfilled", index=True)
    label_file_url = Column(String, nullable=True)
    label_file_name = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    shipped_at = Column(DateTime, nullable=True, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    items = relationship(
        "FulfillmentOrderItem",
        back_populates="order",
        cascade="all, delete",
    )
    picks = relationship(
        "FulfillmentPick",
        back_populates="order",
        cascade="all, delete",
    )


class FulfillmentOrderItem(Base):
    __tablename__ = "fulfillment_order_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    fulfillment_order_id = Column(Integer, ForeignKey("fulfillment_orders.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, default=0)
    picked_quantity = Column(Integer, default=0)

    order = relationship("FulfillmentOrder", back_populates="items")
    product = relationship("Product")


class FulfillmentPick(Base):
    __tablename__ = "fulfillment_picks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    fulfillment_order_id = Column(Integer, ForeignKey("fulfillment_orders.id"), nullable=False, index=True)
    box_item_id = Column(Integer, ForeignKey("fulfillment_box_items.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    order = relationship("FulfillmentOrder", back_populates="picks")
    box_item = relationship("FulfillmentBoxItem")
    product = relationship("Product")


class CourierPayment(Base):
    __tablename__ = "courier_payments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    courier_name = Column(String, nullable=False)
    amount = Column(Float, default=0)

    payment_method = Column(String, nullable=True)
    payment_reference = Column(String, nullable=True)
    note = Column(String, nullable=True)

    payment_date = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)


class RegularBill(Base):
    __tablename__ = "regular_bills"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, default="Utilities")
    vendor = Column(String, nullable=True)
    amount = Column(Float, default=0)
    currency = Column(String, default="PKR")
    frequency = Column(String, default="Monthly")
    next_due_date = Column(DateTime, nullable=True)
    reminder_days = Column(Integer, default=7)
    payment_method = Column(String, nullable=True)
    account_reference = Column(String, nullable=True)
    status = Column(String, default="Active")
    notes = Column(String, nullable=True)
    last_paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    payments = relationship(
        "RegularBillPayment",
        back_populates="bill",
        cascade="all, delete",
    )


class RegularBillPayment(Base):
    __tablename__ = "regular_bill_payments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    bill_id = Column(Integer, ForeignKey("regular_bills.id"), nullable=False)
    amount = Column(Float, default=0)
    payment_method = Column(String, nullable=True)
    payment_reference = Column(String, nullable=True)
    note = Column(String, nullable=True)
    paid_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    bill = relationship("RegularBill", back_populates="payments")


class AccountingAccount(Base):
    __tablename__ = "accounting_accounts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    account_type = Column(String, default="Bank")
    platform = Column(String, nullable=True, index=True)
    currency = Column(String, default="PKR")
    opening_balance = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    transactions = relationship(
        "AccountingTransaction",
        back_populates="account",
        cascade="all, delete",
    )


class AccountingTransaction(Base):
    __tablename__ = "accounting_transactions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=False)
    direction = Column(String, nullable=False)
    category = Column(String, default="Manual")
    amount = Column(Float, default=0)
    currency = Column(String, default="PKR")
    exchange_rate = Column(Float, default=1)
    amount_pkr = Column(Float, default=0)
    counterparty = Column(String, nullable=True)
    platform = Column(String, nullable=True, index=True)
    reference = Column(String, nullable=True)
    source_type = Column(String, nullable=True, index=True)
    source_id = Column(Integer, nullable=True, index=True)
    description = Column(Text, nullable=True)
    transaction_date = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account = relationship("AccountingAccount", back_populates="transactions")


class ProductionBatch(Base):
    __tablename__ = "production_batches"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    batch_no = Column(String, unique=True, index=True, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    custom_product_name = Column(String, nullable=True)
    custom_article_no = Column(String, nullable=True)

    batch_quantity = Column(Integer, default=1)
    priority = Column(String, default="Normal")

    status = Column(String, default="Pending")
    source_type = Column(String, default="Workflow")
    notes = Column(String, nullable=True)

    due_date = Column(DateTime, nullable=True)
    expected_completion = Column(DateTime, nullable=True)
    actual_completion = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product")
    tasks = relationship("ProductionTask", back_populates="batch", cascade="all, delete")


class ProductionTask(Base):
    __tablename__ = "production_tasks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    batch_id = Column(Integer, ForeignKey("production_batches.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    custom_product_name = Column(String, nullable=True)
    custom_article_no = Column(String, nullable=True)
    workflow_step_id = Column(Integer, ForeignKey("workflow_steps.id"), nullable=True)

    step_order = Column(Integer, default=1)
    step_name = Column(String, nullable=False)
    worker_role = Column(String, nullable=True)

    worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True)

    assigned_quantity = Column(Integer, default=1)
    completed_quantity = Column(Integer, default=0)

    rate_per_piece = Column(Float, default=0)
    estimated_minutes_per_piece = Column(Float, default=0)
    estimated_total_minutes = Column(Float, default=0)

    expected_completion_time = Column(DateTime, nullable=True)
    actual_start_time = Column(DateTime, nullable=True)
    actual_completion_time = Column(DateTime, nullable=True)

    status = Column(String, default="Pending")
    timing_status = Column(String, default="Not Started")

    delay_minutes = Column(Integer, default=0)
    delay_reason = Column(String, nullable=True)

    labor_cost = Column(Float, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("ProductionBatch", back_populates="tasks")
    product = relationship("Product")
    worker = relationship("Worker")
    workflow_step = relationship("WorkflowStep")


class SharedData(Base):
    __tablename__ = "shared_data"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    
    shared_platform = Column(String, default="WhatsApp")  # WhatsApp, Email, SMS, etc.
    shared_data = Column(String, nullable=True)  # The actual message shared
    
    shared_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    order = relationship("Order")
    customer = relationship("Customer")


class WorkspaceData(Base):
    __tablename__ = "workspace_data"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    data_key = Column(String, nullable=False, unique=True, index=True)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OrderWorkflowTask(Base):
    __tablename__ = "order_workflow_tasks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    task_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    status = Column(String, default="New", index=True)
    assigned_worker_id = Column(Integer, ForeignKey("workers.id"), nullable=False, index=True)
    assigned_by_user_id = Column(Integer, nullable=True)
    assigned_by_user_name = Column(String, nullable=True)
    assigned_quantity = Column(Integer, default=1)
    rate_per_piece = Column(Float, default=0)
    labor_cost = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    due_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    order = relationship("Order")
    assigned_worker = relationship("Worker")


class OrderFollowUp(Base):
    __tablename__ = "order_follow_ups"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    status = Column(String, default="Pending", index=True)
    channel = Column(String, default="WhatsApp")
    message = Column(Text, nullable=True)
    follow_up_due_at = Column(DateTime, nullable=True, index=True)
    followed_up_at = Column(DateTime, nullable=True)
    review_provided = Column(Boolean, default=False)
    review_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    order = relationship("Order")
    customer = relationship("Customer")

from .integrations.amazon.models import AmazonAccount
from .service_takers.models import (
    ServiceTaker,
    ServiceTakerInbound,
    ServiceTakerInboundItem,
    ServiceTakerInventoryTransaction,
    ServiceTakerOrder,
    ServiceTakerOrderItem,
    ServiceTakerProduct,
)

TENANT_SCOPED_MODELS = (
    TenantModule,
    CustomPage,
    Product,
    Customer,
    User,
    ActivityLog,
    UserRoleRequest,
    PublicAccessRequest,
    InternalMessage,
    InternalCall,
    InternalCallSignal,
    OrderImportBatch,
    InspirationItem,
    Order,
    OrderItem,
    StockMovement,
    Supplier,
    SupplierOrderItem,
    SupplierSupplyItem,
    SupplierTransaction,
    SupplierPayment,
    WorkflowStep,
    Worker,
    WorkerPayment,
    Shipping,
    FulfillmentShipment,
    FulfillmentBox,
    FulfillmentBoxItem,
    FulfillmentInventoryDiscrepancy,
    FulfillmentOrder,
    FulfillmentOrderItem,
    FulfillmentPick,
    CourierPayment,
    RegularBill,
    RegularBillPayment,
    AccountingAccount,
    AccountingTransaction,
    ProductionBatch,
    ProductionTask,
    SharedData,
    WorkspaceData,
    OrderWorkflowTask,
    OrderFollowUp,
    AmazonAccount,
    ServiceTaker,
    ServiceTakerProduct,
    ServiceTakerInbound,
    ServiceTakerInboundItem,
    ServiceTakerOrder,
    ServiceTakerOrderItem,
    ServiceTakerInventoryTransaction,
)


class PrintAgentRecord(Base):
    __tablename__ = "print_agents"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    agent_id = Column(String, unique=True, index=True, nullable=False)
    machine_name = Column(String, nullable=False)
    security_token = Column(String, nullable=False)
    company_name = Column(String, nullable=True)
    location = Column(String, nullable=True)
    printer_name = Column(String, nullable=True)
    printers_json = Column(Text, nullable=True, default="[]")
    status = Column(String, default="online", index=True)
    last_heartbeat = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PrintJobRecord(Base):
    __tablename__ = "print_jobs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    job_id = Column(String, unique=True, index=True, nullable=False)
    agent_id = Column(String, nullable=True, index=True)
    order_id = Column(String, nullable=True, index=True)
    label_type = Column(String, nullable=False, default="product_label")
    printer_name = Column(String, nullable=True)
    payload_json = Column(Text, nullable=False, default="{}")
    status = Column(String, default="pending", index=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    printed_at = Column(DateTime, nullable=True)


TENANT_SCOPED_MODELS = (
    *TENANT_SCOPED_MODELS,
    PrintAgentRecord,
    PrintJobRecord,
)


TENANT_LOADER_CRITERIA_CACHE_KEY = "tenant_loader_criteria_options"


def tenant_scope_is_disabled(execute_state) -> bool:
    return bool(execute_state.execution_options.get("skip_tenant_scope"))


def tenant_loader_criteria_options(session: Session, tenant_id: int):
    cache = session.info.setdefault(TENANT_LOADER_CRITERIA_CACHE_KEY, {})
    cache_key = int(tenant_id)
    if cache_key not in cache:
        def tenant_filter(cls):
            return cls.tenant_id == tenant_id

        cache[cache_key] = tuple(
            with_loader_criteria(
                model,
                tenant_filter,
                include_aliases=True,
            )
            for model in TENANT_SCOPED_MODELS
        )
    return cache[cache_key]


@event.listens_for(Session, "do_orm_execute")
def add_tenant_loader_criteria(execute_state):
    if not execute_state.is_select or tenant_scope_is_disabled(execute_state):
        return

    tenant_id = execute_state.session.info.get("tenant_id")
    if tenant_id is None:
        return

    execute_state.statement = execute_state.statement.options(
        *tenant_loader_criteria_options(execute_state.session, tenant_id)
    )


@event.listens_for(Session, "before_flush")
def assign_tenant_ids_before_flush(session, flush_context, instances):
    tenant_id = session.info.get("tenant_id")
    if tenant_id is None:
        return

    for item in session.new:
        if isinstance(item, TENANT_SCOPED_MODELS) and getattr(item, "tenant_id", None) is None:
            item.tenant_id = tenant_id

