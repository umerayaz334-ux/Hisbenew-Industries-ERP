import calendar
import json
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import (
    AccountingAccount,
    AccountingTransaction,
    SchoolAcademicSession,
    SchoolBankReconciliation,
    SchoolCampus,
    SchoolCashClosing,
    SchoolClass,
    SchoolFeeAdjustment,
    SchoolFeeHead,
    SchoolFeeInvoice,
    SchoolFeeInvoiceItem,
    SchoolFeePayment,
    SchoolFeePaymentAllocation,
    SchoolFeeRefund,
    SchoolFeeReminder,
    SchoolFeeStructure,
    SchoolFeeStructureItem,
    SchoolFinanceAccount,
    SchoolFinanceEntry,
    SchoolFinanceSettings,
    SchoolNotification,
    SchoolRoleAssignment,
    SchoolStudent,
    SchoolStudentDiscount,
    User,
)
from .foundation import audit_school_action, ensure_campus_access, require_school_permission


router = APIRouter(prefix="/school/finance", tags=["School Finance"])
FEE_CATEGORIES = {"Tuition", "Admission", "Transport", "Examination", "Other"}
FREQUENCIES = {"Monthly", "Quarterly", "Annual", "One-time"}
DISCOUNT_TYPES = {"Sibling", "Staff child", "Scholarship", "Custom"}
PAYMENT_METHODS = {"Cash", "Bank", "Online"}


def get_school_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def model_dict(instance) -> dict:
    return {column.name: getattr(instance, column.name) for column in instance.__table__.columns}


def clean(value, limit=None):
    if value in (None, ""):
        return None
    result = str(value).strip()
    return result[:limit] if limit else result


def money(value) -> float:
    return round(float(value or 0) + 1e-9, 2)


def today_string() -> str:
    return datetime.now().date().isoformat()


def parse_date(value: str):
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Use dates in YYYY-MM-DD format.")


def validate_period(value: str) -> tuple[int, int]:
    if not re.fullmatch(r"\d{4}-\d{2}", value or ""):
        raise HTTPException(status_code=400, detail="Billing period must use YYYY-MM format.")
    year, month = (int(part) for part in value.split("-"))
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Select a valid billing month.")
    return year, month


def ensure_campus(db: Session, workspace_id: int, campus_id: int) -> SchoolCampus:
    campus = db.query(SchoolCampus).filter(
        SchoolCampus.id == campus_id,
        SchoolCampus.workspace_id == workspace_id,
        SchoolCampus.is_active == True,
    ).first()
    if not campus:
        raise HTTPException(status_code=400, detail="Select a valid school campus.")
    return campus


def finance_settings(db: Session, workspace_id: int, campus_id=None) -> SchoolFinanceSettings:
    query = db.query(SchoolFinanceSettings).filter(SchoolFinanceSettings.workspace_id == workspace_id)
    settings = query.filter(SchoolFinanceSettings.campus_id == campus_id).first() if campus_id else None
    settings = settings or query.filter(SchoolFinanceSettings.campus_id.is_(None)).first()
    if not settings:
        settings = SchoolFinanceSettings(workspace_id=workspace_id, campus_id=None)
        db.add(settings)
        db.flush()
    return settings


def seed_finance(db: Session, workspace_id: int, campus_id: int):
    if not db.query(SchoolFeeHead).filter(SchoolFeeHead.workspace_id == workspace_id).first():
        defaults = [
            ("Tuition fee", "TUITION", "Tuition"),
            ("Admission fee", "ADMISSION", "Admission"),
            ("Transport fee", "TRANSPORT", "Transport"),
            ("Examination fee", "EXAM", "Examination"),
            ("Other fee", "OTHER", "Other"),
        ]
        db.add_all([
            SchoolFeeHead(workspace_id=workspace_id, campus_id=None, name=name, code=code, category=category)
            for name, code, category in defaults
        ])
    if not db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.workspace_id == workspace_id).first():
        db.add_all([
            SchoolFinanceAccount(workspace_id=workspace_id, campus_id=campus_id, name="Cash counter", account_type="Cash"),
            SchoolFinanceAccount(workspace_id=workspace_id, campus_id=campus_id, name="School bank", account_type="Bank"),
            SchoolFinanceAccount(workspace_id=workspace_id, campus_id=campus_id, name="Online payments", account_type="Online"),
        ])
    finance_settings(db, workspace_id, None)
    db.flush()


def sequence_number(db: Session, model, field, prefix: str, date_value: str) -> str:
    period = date_value[:7].replace("-", "")
    base = f"{prefix}-{period}-"
    count = db.query(model).filter(field.like(f"{base}%")).count() + 1
    candidate = f"{base}{count:05d}"
    while db.query(model).filter(field == candidate).first():
        count += 1
        candidate = f"{base}{count:05d}"
    return candidate


def account_balance(db: Session, account: SchoolFinanceAccount, through_date=None) -> float:
    query = db.query(
        func.coalesce(func.sum(SchoolFinanceEntry.amount), 0)
    ).filter(
        SchoolFinanceEntry.finance_account_id == account.id,
        SchoolFinanceEntry.direction == "In",
    )
    out_query = db.query(
        func.coalesce(func.sum(SchoolFinanceEntry.amount), 0)
    ).filter(
        SchoolFinanceEntry.finance_account_id == account.id,
        SchoolFinanceEntry.direction == "Out",
    )
    if through_date:
        query = query.filter(SchoolFinanceEntry.entry_date <= through_date)
        out_query = out_query.filter(SchoolFinanceEntry.entry_date <= through_date)
    return money(account.opening_balance + float(query.scalar() or 0) - float(out_query.scalar() or 0))


def serialize_account(db, account):
    value = model_dict(account)
    value["balance"] = account_balance(db, account)
    linked = db.query(AccountingAccount).filter(AccountingAccount.id == account.erp_accounting_account_id).first() if account.erp_accounting_account_id else None
    value["erp_account_name"] = linked.name if linked else None
    return value


def serialize_head(head):
    return model_dict(head)


def serialize_structure(db, structure):
    value = model_dict(structure)
    school_class = db.query(SchoolClass).filter(SchoolClass.id == structure.school_class_id).first() if structure.school_class_id else None
    student = db.query(SchoolStudent).filter(SchoolStudent.id == structure.student_id).first() if structure.student_id else None
    heads = {item.id: item for item in db.query(SchoolFeeHead).filter(SchoolFeeHead.workspace_id == structure.workspace_id).all()}
    items = db.query(SchoolFeeStructureItem).filter(SchoolFeeStructureItem.fee_structure_id == structure.id).all()
    value["class_name"] = school_class.name if school_class else None
    value["student_name"] = student.student_name if student else None
    value["scope"] = "Student" if student else ("Class" if school_class else "Campus")
    value["items"] = [{**model_dict(item), "fee_head_name": heads[item.fee_head_id].name if item.fee_head_id in heads else "Fee"} for item in items]
    value["total"] = money(sum(item.amount or 0 for item in items))
    return value


def serialize_discount(db, discount):
    value = model_dict(discount)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == discount.student_id).first()
    head = db.query(SchoolFeeHead).filter(SchoolFeeHead.id == discount.fee_head_id).first() if discount.fee_head_id else None
    value["student_name"] = student.student_name if student else "Unknown student"
    value["admission_no"] = student.admission_no if student else ""
    value["fee_head_name"] = head.name if head else "All fee heads"
    return value


def refresh_invoice(db: Session, invoice: SchoolFeeInvoice):
    adjustments = db.query(SchoolFeeAdjustment).filter(SchoolFeeAdjustment.invoice_id == invoice.id).all()
    invoice.adjustment_amount = money(sum(item.amount if item.adjustment_type == "Debit" else -item.amount for item in adjustments))
    invoice.total_amount = money(invoice.subtotal - invoice.discount_amount + invoice.late_fee_amount + invoice.adjustment_amount)
    allocations = db.query(SchoolFeePaymentAllocation).filter(SchoolFeePaymentAllocation.invoice_id == invoice.id).order_by(SchoolFeePaymentAllocation.id.desc()).all()
    paid = money(sum(item.amount or 0 for item in allocations))
    if paid > invoice.total_amount:
        excess = money(paid - invoice.total_amount)
        for allocation in allocations:
            if excess <= 0:
                break
            reduction = min(excess, money(allocation.amount))
            allocation.amount = money(allocation.amount - reduction)
            payment = db.query(SchoolFeePayment).filter(SchoolFeePayment.id == allocation.payment_id).first()
            if payment:
                payment.unallocated_amount = money(payment.unallocated_amount + reduction)
            excess = money(excess - reduction)
            if allocation.amount <= 0:
                db.delete(allocation)
        db.flush()
        paid = money(invoice.total_amount)
    invoice.paid_amount = paid
    invoice.balance_amount = money(max(invoice.total_amount - paid, 0))
    if invoice.status != "Void":
        if invoice.balance_amount <= 0:
            invoice.status = "Paid"
        elif invoice.paid_amount > 0:
            invoice.status = "Partially Paid"
        elif invoice.due_date < today_string():
            invoice.status = "Overdue"
        else:
            invoice.status = "Issued"
    invoice.updated_at = datetime.utcnow()
    db.flush()


def serialize_invoice(db, invoice, include_items=False):
    refresh_invoice(db, invoice)
    value = model_dict(invoice)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == invoice.student_id).first()
    campus = db.query(SchoolCampus).filter(SchoolCampus.id == invoice.campus_id).first()
    school_class = db.query(SchoolClass).filter(SchoolClass.id == student.school_class_id).first() if student and student.school_class_id else None
    value.update({
        "student_name": student.student_name if student else "Unknown student",
        "admission_no": student.admission_no if student else "",
        "guardian_phone": student.guardian_phone if student else None,
        "class_name": school_class.name if school_class else (student.class_name if student else ""),
        "section": student.section if student else "",
        "campus_name": campus.name if campus else "",
    })
    if include_items:
        value["items"] = [model_dict(item) for item in db.query(SchoolFeeInvoiceItem).filter(SchoolFeeInvoiceItem.invoice_id == invoice.id).all()]
        value["adjustments"] = [model_dict(item) for item in db.query(SchoolFeeAdjustment).filter(SchoolFeeAdjustment.invoice_id == invoice.id).all()]
        value["allocations"] = [model_dict(item) for item in db.query(SchoolFeePaymentAllocation).filter(SchoolFeePaymentAllocation.invoice_id == invoice.id).all()]
    return value


def serialize_payment(db, payment):
    value = model_dict(payment)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == payment.student_id).first()
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payment.finance_account_id).first()
    allocations = db.query(SchoolFeePaymentAllocation).filter(SchoolFeePaymentAllocation.payment_id == payment.id).all()
    invoices = {item.id: item for item in db.query(SchoolFeeInvoice).filter(SchoolFeeInvoice.id.in_([row.invoice_id for row in allocations] or [-1])).all()}
    value.update({
        "student_name": student.student_name if student else "Unknown student",
        "admission_no": student.admission_no if student else "",
        "guardian_phone": student.guardian_phone if student else None,
        "account_name": account.name if account else "",
        "allocated_amount": money(sum(item.amount or 0 for item in allocations)),
        "allocations": [{**model_dict(item), "invoice_no": invoices[item.invoice_id].invoice_no if item.invoice_id in invoices else ""} for item in allocations],
    })
    return value


def post_finance_entry(db, access, campus_id, account, direction, entry_type, category, amount, entry_date, counterparty=None, reference=None, description=None, source_type=None, source_id=None):
    entry = SchoolFinanceEntry(
        workspace_id=access["workspace"].id,
        campus_id=campus_id,
        finance_account_id=account.id,
        direction=direction,
        entry_type=entry_type,
        category=category,
        amount=money(amount),
        entry_date=entry_date,
        counterparty=clean(counterparty, 160),
        reference=clean(reference, 160),
        description=clean(description, 2000),
        source_type=source_type,
        source_id=source_id,
        created_by_user_id=access["user"].id,
    )
    db.add(entry)
    db.flush()
    settings = finance_settings(db, access["workspace"].id, campus_id)
    if settings.sync_to_erp and account.erp_accounting_account_id:
        linked = db.query(AccountingAccount).filter(AccountingAccount.id == account.erp_accounting_account_id).first()
        if linked:
            transaction = AccountingTransaction(
                account_id=linked.id,
                direction="Money In" if direction == "In" else "Money Out",
                category=f"School · {category}",
                amount=money(amount),
                currency="PKR",
                exchange_rate=1,
                amount_pkr=money(amount),
                counterparty=clean(counterparty, 160),
                platform="School ERP",
                reference=clean(reference, 160),
                source_type="SchoolFinance",
                source_id=entry.id,
                description=description,
                transaction_date=parse_date(entry_date),
            )
            db.add(transaction)
            db.flush()
            entry.erp_transaction_id = transaction.id
    return entry


def allocate_payment(db, payment: SchoolFeePayment, invoices):
    for invoice in invoices:
        refresh_invoice(db, invoice)
        available = money(payment.unallocated_amount)
        if available <= 0:
            break
        if invoice.balance_amount <= 0 or invoice.status == "Void":
            continue
        amount = min(available, money(invoice.balance_amount))
        allocation = db.query(SchoolFeePaymentAllocation).filter(
            SchoolFeePaymentAllocation.payment_id == payment.id,
            SchoolFeePaymentAllocation.invoice_id == invoice.id,
        ).first()
        if not allocation:
            allocation = SchoolFeePaymentAllocation(
                workspace_id=payment.workspace_id,
                payment_id=payment.id,
                invoice_id=invoice.id,
                amount=0,
            )
            db.add(allocation)
        allocation.amount = money(allocation.amount + amount)
        payment.unallocated_amount = money(payment.unallocated_amount - amount)
        db.flush()
        refresh_invoice(db, invoice)


def apply_student_advances(db, student_id, invoice):
    payments = db.query(SchoolFeePayment).filter(
        SchoolFeePayment.student_id == student_id,
        SchoolFeePayment.status == "Posted",
        SchoolFeePayment.unallocated_amount > 0,
    ).order_by(SchoolFeePayment.received_date, SchoolFeePayment.id).all()
    for payment in payments:
        allocate_payment(db, payment, [invoice])
        if invoice.balance_amount <= 0:
            break


def structure_is_due(db, structure, year, month, student_id):
    frequency = structure.billing_frequency
    cycle_month = min(max(int(structure.billing_month or 4), 1), 12)
    if frequency == "Monthly":
        return True
    if frequency == "Quarterly":
        return (month - cycle_month) % 3 == 0
    if frequency == "Annual":
        return month == cycle_month
    if frequency == "One-time":
        return not db.query(SchoolFeeInvoiceItem).join(
            SchoolFeeInvoice, SchoolFeeInvoice.id == SchoolFeeInvoiceItem.invoice_id
        ).filter(
            SchoolFeeInvoice.student_id == student_id,
            SchoolFeeInvoiceItem.fee_structure_id == structure.id,
            SchoolFeeInvoice.status != "Void",
        ).first()
    return False


def invoice_components(db, workspace_id, campus_id, student, period):
    year, month = validate_period(period)
    first_day = f"{period}-01"
    last_day = f"{period}-{calendar.monthrange(year, month)[1]:02d}"
    structures = db.query(SchoolFeeStructure).filter(
        SchoolFeeStructure.workspace_id == workspace_id,
        SchoolFeeStructure.campus_id == campus_id,
        SchoolFeeStructure.is_active == True,
        or_(SchoolFeeStructure.school_class_id.is_(None), SchoolFeeStructure.school_class_id == student.school_class_id),
        or_(SchoolFeeStructure.student_id.is_(None), SchoolFeeStructure.student_id == student.id),
    ).all()
    eligible = []
    for structure in structures:
        if structure.effective_from and structure.effective_from > last_day:
            continue
        if structure.effective_to and structure.effective_to < first_day:
            continue
        if structure_is_due(db, structure, year, month, student.id):
            eligible.append(structure)
    selected = {}
    for structure in eligible:
        specificity = 3 if structure.student_id else (2 if structure.school_class_id else 1)
        items = db.query(SchoolFeeStructureItem).filter(SchoolFeeStructureItem.fee_structure_id == structure.id).all()
        for item in items:
            if item.fee_head_id not in selected or specificity >= selected[item.fee_head_id][0]:
                selected[item.fee_head_id] = (specificity, structure, item)
    if not selected:
        return []
    heads = {item.id: item for item in db.query(SchoolFeeHead).filter(SchoolFeeHead.id.in_(list(selected))).all()}
    discounts = db.query(SchoolStudentDiscount).filter(
        SchoolStudentDiscount.workspace_id == workspace_id,
        SchoolStudentDiscount.student_id == student.id,
        SchoolStudentDiscount.is_active == True,
        or_(SchoolStudentDiscount.start_date.is_(None), SchoolStudentDiscount.start_date <= last_day),
        or_(SchoolStudentDiscount.end_date.is_(None), SchoolStudentDiscount.end_date >= first_day),
    ).all()
    components = []
    general_fixed = sum(item.value or 0 for item in discounts if item.calculation_type == "Fixed" and item.fee_head_id is None)
    for head_id, (_, structure, item) in selected.items():
        gross = money(item.amount)
        applicable = [discount for discount in discounts if discount.fee_head_id in (None, head_id)]
        percentage = min(100, sum(discount.value or 0 for discount in applicable if discount.calculation_type == "Percentage"))
        fixed = sum(discount.value or 0 for discount in applicable if discount.calculation_type == "Fixed" and discount.fee_head_id == head_id)
        discount_amount = money(min(gross, gross * percentage / 100 + fixed))
        components.append({
            "structure": structure,
            "fee_head_id": head_id,
            "description": heads[head_id].name if head_id in heads else "School fee",
            "gross": gross,
            "discount": discount_amount,
        })
    remaining_fixed = money(general_fixed)
    for component in components:
        if remaining_fixed <= 0:
            break
        available = money(component["gross"] - component["discount"])
        applied = min(available, remaining_fixed)
        component["discount"] = money(component["discount"] + applied)
        remaining_fixed = money(remaining_fixed - applied)
    return components


class FinanceSettingsPayload(BaseModel):
    campus_id: int | None = None
    invoice_prefix: str = Field(default="FEE", min_length=1, max_length=15)
    receipt_prefix: str = Field(default="RCP", min_length=1, max_length=15)
    default_due_day: int = Field(default=10, ge=1, le=28)
    late_fee_type: str = Field(default="Flat", max_length=20)
    late_fee_value: float = Field(default=0, ge=0)
    late_fee_grace_days: int = Field(default=0, ge=0, le=90)
    automatic_reminders: bool = True
    reminder_days_before: int = Field(default=3, ge=0, le=60)
    sync_to_erp: bool = False


class FeeHeadPayload(BaseModel):
    campus_id: int | None = None
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=30)
    category: str = Field(default="Other", max_length=30)
    description: str | None = Field(default=None, max_length=1000)
    is_refundable: bool = True
    is_active: bool = True


class StructureItemPayload(BaseModel):
    fee_head_id: int
    amount: float = Field(gt=0)


class StructurePayload(BaseModel):
    campus_id: int
    school_class_id: int | None = None
    student_id: int | None = None
    name: str = Field(min_length=1, max_length=150)
    billing_frequency: str = Field(default="Monthly", max_length=30)
    billing_month: int = Field(default=4, ge=1, le=12)
    due_day: int = Field(default=10, ge=1, le=28)
    effective_from: str | None = None
    effective_to: str | None = None
    is_active: bool = True
    items: list[StructureItemPayload] = Field(min_length=1, max_length=100)


class DiscountPayload(BaseModel):
    campus_id: int
    student_id: int
    fee_head_id: int | None = None
    discount_type: str = Field(default="Custom", max_length=30)
    name: str = Field(min_length=1, max_length=150)
    calculation_type: str = Field(default="Percentage", max_length=20)
    value: float = Field(gt=0)
    start_date: str | None = None
    end_date: str | None = None
    notes: str | None = Field(default=None, max_length=1000)
    is_active: bool = True


class GenerateInvoicesPayload(BaseModel):
    campus_id: int
    academic_session_id: int | None = None
    billing_period: str = Field(max_length=7)
    issue_date: str = Field(default_factory=today_string, max_length=10)
    due_date: str | None = Field(default=None, max_length=10)
    school_class_id: int | None = None
    student_id: int | None = None
    notes: str | None = Field(default=None, max_length=1000)


class AccountPayload(BaseModel):
    campus_id: int | None = None
    name: str = Field(min_length=1, max_length=120)
    account_type: str = Field(default="Cash", max_length=30)
    bank_name: str | None = Field(default=None, max_length=120)
    account_number: str | None = Field(default=None, max_length=80)
    opening_balance: float = 0
    erp_accounting_account_id: int | None = None
    is_active: bool = True


class PaymentPayload(BaseModel):
    campus_id: int
    student_id: int
    finance_account_id: int
    invoice_id: int | None = None
    amount: float = Field(gt=0)
    payment_method: str = Field(default="Cash", max_length=30)
    payment_reference: str | None = Field(default=None, max_length=160)
    received_date: str = Field(default_factory=today_string, max_length=10)
    notes: str | None = Field(default=None, max_length=1000)


class AdjustmentPayload(BaseModel):
    invoice_id: int
    adjustment_type: str = Field(max_length=20)
    category: str = Field(default="Custom", max_length=60)
    amount: float = Field(gt=0)
    reason: str = Field(min_length=2, max_length=2000)


class RefundPayload(BaseModel):
    payment_id: int
    invoice_id: int | None = None
    finance_account_id: int
    amount: float = Field(gt=0)
    refund_method: str = Field(default="Cash", max_length=30)
    refund_date: str = Field(default_factory=today_string, max_length=10)
    reason: str = Field(min_length=2, max_length=2000)


class EntryPayload(BaseModel):
    campus_id: int
    finance_account_id: int
    direction: str = Field(max_length=10)
    entry_type: str = Field(default="Expense", max_length=30)
    category: str = Field(default="General", max_length=80)
    amount: float = Field(gt=0)
    entry_date: str = Field(default_factory=today_string, max_length=10)
    counterparty: str | None = Field(default=None, max_length=160)
    reference: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    target_account_id: int | None = None


class CashClosingPayload(BaseModel):
    campus_id: int
    finance_account_id: int
    closing_date: str = Field(default_factory=today_string, max_length=10)
    actual_cash: float = Field(ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class ReconciliationPayload(BaseModel):
    campus_id: int
    finance_account_id: int
    statement_date: str = Field(default_factory=today_string, max_length=10)
    statement_balance: float
    notes: str | None = Field(default=None, max_length=1000)


@router.get("")
def finance_snapshot(
    request: Request,
    campus_id: int | None = Query(default=None),
    as_of: str = Query(default_factory=today_string, max_length=10),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_finance")
    workspace_id = access["workspace"].id
    if campus_id:
        ensure_campus_access(access, campus_id)
        ensure_campus(db, workspace_id, campus_id)
    else:
        campus_query = db.query(SchoolCampus).filter(SchoolCampus.workspace_id == workspace_id, SchoolCampus.is_active == True)
        if access["campus_ids"] is not None:
            campus_query = campus_query.filter(SchoolCampus.id.in_(list(access["campus_ids"])))
        first_campus = campus_query.order_by(SchoolCampus.id).first()
        campus_id = first_campus.id if first_campus else None
    if campus_id:
        seed_finance(db, workspace_id, campus_id)
    invoice_query = db.query(SchoolFeeInvoice).filter(SchoolFeeInvoice.workspace_id == workspace_id)
    payment_query = db.query(SchoolFeePayment).filter(SchoolFeePayment.workspace_id == workspace_id)
    account_query = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.workspace_id == workspace_id)
    structure_query = db.query(SchoolFeeStructure).filter(SchoolFeeStructure.workspace_id == workspace_id)
    discount_query = db.query(SchoolStudentDiscount).filter(SchoolStudentDiscount.workspace_id == workspace_id)
    reminder_query = db.query(SchoolFeeReminder).filter(SchoolFeeReminder.workspace_id == workspace_id)
    if access["campus_ids"] is not None:
        ids = list(access["campus_ids"])
        invoice_query = invoice_query.filter(SchoolFeeInvoice.campus_id.in_(ids))
        payment_query = payment_query.filter(SchoolFeePayment.campus_id.in_(ids))
        account_query = account_query.filter(or_(SchoolFinanceAccount.campus_id.in_(ids), SchoolFinanceAccount.campus_id.is_(None)))
        structure_query = structure_query.filter(SchoolFeeStructure.campus_id.in_(ids))
        discount_query = discount_query.filter(SchoolStudentDiscount.campus_id.in_(ids))
        reminder_query = reminder_query.filter(SchoolFeeReminder.campus_id.in_(ids))
    if campus_id:
        invoice_query = invoice_query.filter(SchoolFeeInvoice.campus_id == campus_id)
        payment_query = payment_query.filter(SchoolFeePayment.campus_id == campus_id)
        account_query = account_query.filter(or_(SchoolFinanceAccount.campus_id == campus_id, SchoolFinanceAccount.campus_id.is_(None)))
        structure_query = structure_query.filter(SchoolFeeStructure.campus_id == campus_id)
        discount_query = discount_query.filter(SchoolStudentDiscount.campus_id == campus_id)
        reminder_query = reminder_query.filter(SchoolFeeReminder.campus_id == campus_id)
    invoices = invoice_query.order_by(SchoolFeeInvoice.created_at.desc()).limit(300).all()
    for invoice in invoices:
        refresh_invoice(db, invoice)
    payments = payment_query.order_by(SchoolFeePayment.created_at.desc()).limit(300).all()
    accounts = account_query.order_by(SchoolFinanceAccount.name).all()
    closings = db.query(SchoolCashClosing).filter(SchoolCashClosing.workspace_id == workspace_id).order_by(SchoolCashClosing.closing_date.desc()).limit(100).all()
    reconciliations = db.query(SchoolBankReconciliation).filter(SchoolBankReconciliation.workspace_id == workspace_id).order_by(SchoolBankReconciliation.statement_date.desc()).limit(100).all()
    if campus_id:
        closings = [item for item in closings if item.campus_id == campus_id]
        reconciliations = [item for item in reconciliations if item.campus_id == campus_id]
    db.commit()
    total_billed = money(sum(item.total_amount for item in invoices if item.status != "Void"))
    total_collected = money(sum(item.amount for item in payments if item.status == "Posted"))
    total_advance = money(sum(item.unallocated_amount for item in payments if item.status == "Posted"))
    total_outstanding = money(sum(item.balance_amount for item in invoices if item.status != "Void"))
    return {
        "settings": model_dict(finance_settings(db, workspace_id, campus_id)),
        "summary": {
            "billed": total_billed,
            "collected": total_collected,
            "outstanding": total_outstanding,
            "advance": total_advance,
            "overdue_invoices": sum(1 for item in invoices if item.balance_amount > 0 and item.due_date < as_of),
            "today_collection": money(sum(item.amount for item in payments if item.status == "Posted" and item.received_date == as_of)),
        },
        "fee_heads": [serialize_head(item) for item in db.query(SchoolFeeHead).filter(SchoolFeeHead.workspace_id == workspace_id).order_by(SchoolFeeHead.category, SchoolFeeHead.name).all()],
        "structures": [serialize_structure(db, item) for item in structure_query.order_by(SchoolFeeStructure.created_at.desc()).all()],
        "discounts": [serialize_discount(db, item) for item in discount_query.order_by(SchoolStudentDiscount.created_at.desc()).all()],
        "invoices": [serialize_invoice(db, item) for item in invoices],
        "payments": [serialize_payment(db, item) for item in payments],
        "accounts": [serialize_account(db, item) for item in accounts],
        "closings": [model_dict(item) for item in closings],
        "reconciliations": [model_dict(item) for item in reconciliations],
        "reminders": [model_dict(item) for item in reminder_query.order_by(SchoolFeeReminder.created_at.desc()).limit(100).all()],
        "erp_accounts": [model_dict(item) for item in db.query(AccountingAccount).filter(AccountingAccount.is_active == True).order_by(AccountingAccount.name).all()],
    }


@router.put("/settings")
def update_settings(payload: FinanceSettingsPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    if payload.campus_id:
        ensure_campus_access(access, payload.campus_id)
    settings = db.query(SchoolFinanceSettings).filter(
        SchoolFinanceSettings.workspace_id == access["workspace"].id,
        SchoolFinanceSettings.campus_id == payload.campus_id,
    ).first()
    if not settings:
        settings = SchoolFinanceSettings(workspace_id=access["workspace"].id, campus_id=payload.campus_id)
        db.add(settings)
    for key, value in payload.model_dump().items():
        setattr(settings, key, value)
    settings.invoice_prefix = settings.invoice_prefix.upper().strip()
    settings.receipt_prefix = settings.receipt_prefix.upper().strip()
    settings.late_fee_type = "Percentage" if settings.late_fee_type.lower() == "percentage" else "Flat"
    audit_school_action(db, request, "update", "SchoolFinanceSettings", settings.id, "Updated school fee policy")
    db.commit()
    return model_dict(settings)


@router.post("/fee-heads")
def create_fee_head(payload: FeeHeadPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    if payload.campus_id:
        ensure_campus_access(access, payload.campus_id)
    code = payload.code.upper().strip()
    if db.query(SchoolFeeHead).filter(SchoolFeeHead.workspace_id == access["workspace"].id, func.lower(SchoolFeeHead.code) == code.lower()).first():
        raise HTTPException(status_code=409, detail="This fee head code already exists.")
    head = SchoolFeeHead(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        name=payload.name.strip(),
        code=code,
        category=payload.category if payload.category in FEE_CATEGORIES else "Other",
        description=clean(payload.description, 1000),
        is_refundable=payload.is_refundable,
        is_active=payload.is_active,
    )
    db.add(head)
    db.flush()
    audit_school_action(db, request, "create", "SchoolFeeHead", head.id, f"Created fee head {head.name}")
    db.commit()
    return serialize_head(head)


@router.put("/fee-heads/{head_id}")
def update_fee_head(head_id: int, payload: FeeHeadPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    head = db.query(SchoolFeeHead).filter(SchoolFeeHead.id == head_id, SchoolFeeHead.workspace_id == access["workspace"].id).first()
    if not head:
        raise HTTPException(status_code=404, detail="Fee head not found.")
    if payload.campus_id:
        ensure_campus_access(access, payload.campus_id)
    duplicate = db.query(SchoolFeeHead).filter(SchoolFeeHead.workspace_id == access["workspace"].id, func.lower(SchoolFeeHead.code) == payload.code.lower(), SchoolFeeHead.id != head.id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This fee head code already exists.")
    for key, value in payload.model_dump().items():
        setattr(head, key, value)
    head.name = head.name.strip()
    head.code = head.code.upper().strip()
    head.category = head.category if head.category in FEE_CATEGORIES else "Other"
    audit_school_action(db, request, "update", "SchoolFeeHead", head.id, f"Updated fee head {head.name}")
    db.commit()
    return serialize_head(head)


@router.post("/structures")
def create_structure(payload: StructurePayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, payload.campus_id)
    ensure_campus(db, access["workspace"].id, payload.campus_id)
    if payload.billing_frequency not in FREQUENCIES:
        raise HTTPException(status_code=400, detail="Select monthly, quarterly, annual or one-time billing.")
    if payload.school_class_id and not db.query(SchoolClass).filter(SchoolClass.id == payload.school_class_id, SchoolClass.workspace_id == access["workspace"].id, SchoolClass.campus_id == payload.campus_id).first():
        raise HTTPException(status_code=400, detail="Select a valid class.")
    if payload.student_id and not db.query(SchoolStudent).filter(SchoolStudent.id == payload.student_id, SchoolStudent.workspace_id == access["workspace"].id, SchoolStudent.campus_id == payload.campus_id).first():
        raise HTTPException(status_code=400, detail="Select a valid student.")
    head_ids = {item.id for item in db.query(SchoolFeeHead).filter(SchoolFeeHead.workspace_id == access["workspace"].id, SchoolFeeHead.is_active == True).all()}
    if any(item.fee_head_id not in head_ids for item in payload.items):
        raise HTTPException(status_code=400, detail="A fee structure item uses an invalid fee head.")
    if len({item.fee_head_id for item in payload.items}) != len(payload.items):
        raise HTTPException(status_code=400, detail="A fee head can appear only once in a structure.")
    structure = SchoolFeeStructure(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        school_class_id=payload.school_class_id,
        student_id=payload.student_id,
        name=payload.name.strip(),
        billing_frequency=payload.billing_frequency,
        billing_month=payload.billing_month,
        due_day=payload.due_day,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        is_active=payload.is_active,
    )
    db.add(structure)
    db.flush()
    db.add_all([SchoolFeeStructureItem(workspace_id=access["workspace"].id, fee_structure_id=structure.id, fee_head_id=item.fee_head_id, amount=money(item.amount)) for item in payload.items])
    audit_school_action(db, request, "create", "SchoolFeeStructure", structure.id, f"Created fee structure {structure.name}")
    db.commit()
    return serialize_structure(db, structure)


@router.put("/structures/{structure_id}")
def update_structure(structure_id: int, payload: StructurePayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    structure = db.query(SchoolFeeStructure).filter(SchoolFeeStructure.id == structure_id, SchoolFeeStructure.workspace_id == access["workspace"].id).first()
    if not structure:
        raise HTTPException(status_code=404, detail="Fee structure not found.")
    ensure_campus_access(access, payload.campus_id)
    if payload.billing_frequency not in FREQUENCIES:
        raise HTTPException(status_code=400, detail="Select a valid billing frequency.")
    values = payload.model_dump(exclude={"items"})
    for key, value in values.items():
        setattr(structure, key, value)
    structure.name = structure.name.strip()
    db.query(SchoolFeeStructureItem).filter(SchoolFeeStructureItem.fee_structure_id == structure.id).delete(synchronize_session=False)
    db.add_all([SchoolFeeStructureItem(workspace_id=access["workspace"].id, fee_structure_id=structure.id, fee_head_id=item.fee_head_id, amount=money(item.amount)) for item in payload.items])
    audit_school_action(db, request, "update", "SchoolFeeStructure", structure.id, f"Updated fee structure {structure.name}")
    db.commit()
    return serialize_structure(db, structure)


@router.post("/discounts")
def create_discount(payload: DiscountPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, payload.campus_id)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == payload.student_id, SchoolStudent.workspace_id == access["workspace"].id, SchoolStudent.campus_id == payload.campus_id).first()
    if not student:
        raise HTTPException(status_code=400, detail="Select a valid student.")
    if payload.fee_head_id and not db.query(SchoolFeeHead).filter(SchoolFeeHead.id == payload.fee_head_id, SchoolFeeHead.workspace_id == access["workspace"].id).first():
        raise HTTPException(status_code=400, detail="Select a valid fee head.")
    calculation_type = "Fixed" if payload.calculation_type.lower() == "fixed" else "Percentage"
    if calculation_type == "Percentage" and payload.value > 100:
        raise HTTPException(status_code=400, detail="Percentage discount cannot exceed 100%.")
    discount = SchoolStudentDiscount(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        student_id=payload.student_id,
        fee_head_id=payload.fee_head_id,
        discount_type=payload.discount_type if payload.discount_type in DISCOUNT_TYPES else "Custom",
        name=payload.name.strip(),
        calculation_type=calculation_type,
        value=money(payload.value),
        start_date=payload.start_date,
        end_date=payload.end_date,
        notes=clean(payload.notes, 1000),
        is_active=payload.is_active,
    )
    db.add(discount)
    db.flush()
    audit_school_action(db, request, "create", "SchoolStudentDiscount", discount.id, f"Created {discount.discount_type.lower()} discount for {student.student_name}")
    db.commit()
    return serialize_discount(db, discount)


@router.put("/discounts/{discount_id}/status")
def update_discount_status(discount_id: int, is_active: bool, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    discount = db.query(SchoolStudentDiscount).filter(SchoolStudentDiscount.id == discount_id, SchoolStudentDiscount.workspace_id == access["workspace"].id).first()
    if not discount:
        raise HTTPException(status_code=404, detail="Discount not found.")
    ensure_campus_access(access, discount.campus_id)
    discount.is_active = is_active
    audit_school_action(db, request, "update", "SchoolStudentDiscount", discount.id, f"{'Activated' if is_active else 'Paused'} student discount")
    db.commit()
    return serialize_discount(db, discount)


@router.post("/invoices/generate")
def generate_invoices(payload: GenerateInvoicesPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    workspace_id = access["workspace"].id
    ensure_campus_access(access, payload.campus_id)
    ensure_campus(db, workspace_id, payload.campus_id)
    year, month = validate_period(payload.billing_period)
    parse_date(payload.issue_date)
    settings = finance_settings(db, workspace_id, payload.campus_id)
    student_query = db.query(SchoolStudent).filter(
        SchoolStudent.workspace_id == workspace_id,
        SchoolStudent.campus_id == payload.campus_id,
        SchoolStudent.status == "Active",
        SchoolStudent.archived_at.is_(None),
    )
    if payload.school_class_id:
        student_query = student_query.filter(SchoolStudent.school_class_id == payload.school_class_id)
    if payload.student_id:
        student_query = student_query.filter(SchoolStudent.id == payload.student_id)
    students = student_query.order_by(SchoolStudent.student_name).all()
    generated, skipped = [], []
    for student in students:
        existing = db.query(SchoolFeeInvoice).filter(
            SchoolFeeInvoice.workspace_id == workspace_id,
            SchoolFeeInvoice.student_id == student.id,
            SchoolFeeInvoice.billing_period == payload.billing_period,
        ).first()
        if existing:
            skipped.append({"student_id": student.id, "student_name": student.student_name, "reason": "Invoice already exists"})
            continue
        components = invoice_components(db, workspace_id, payload.campus_id, student, payload.billing_period)
        if not components:
            skipped.append({"student_id": student.id, "student_name": student.student_name, "reason": "No applicable fee structure"})
            continue
        due_day = max([component["structure"].due_day or settings.default_due_day for component in components] or [settings.default_due_day])
        due_date = payload.due_date or f"{year:04d}-{month:02d}-{min(due_day, calendar.monthrange(year, month)[1]):02d}"
        parse_date(due_date)
        invoice = SchoolFeeInvoice(
            workspace_id=workspace_id,
            campus_id=payload.campus_id,
            academic_session_id=payload.academic_session_id or student.academic_session_id,
            student_id=student.id,
            invoice_no=sequence_number(db, SchoolFeeInvoice, SchoolFeeInvoice.invoice_no, settings.invoice_prefix, payload.issue_date),
            billing_period=payload.billing_period,
            issue_date=payload.issue_date,
            due_date=due_date,
            status="Issued",
            subtotal=money(sum(item["gross"] for item in components)),
            discount_amount=money(sum(item["discount"] for item in components)),
            total_amount=money(sum(item["gross"] - item["discount"] for item in components)),
            balance_amount=money(sum(item["gross"] - item["discount"] for item in components)),
            notes=clean(payload.notes, 1000),
            generated_by_user_id=access["user"].id,
        )
        db.add(invoice)
        db.flush()
        for component in components:
            db.add(SchoolFeeInvoiceItem(
                workspace_id=workspace_id,
                invoice_id=invoice.id,
                fee_structure_id=component["structure"].id,
                fee_head_id=component["fee_head_id"],
                description=component["description"],
                quantity=1,
                unit_amount=component["gross"],
                gross_amount=component["gross"],
                discount_amount=component["discount"],
                net_amount=money(component["gross"] - component["discount"]),
            ))
        db.flush()
        apply_student_advances(db, student.id, invoice)
        refresh_invoice(db, invoice)
        generated.append(invoice)
    audit_school_action(db, request, "generate", "SchoolFeeInvoice", None, f"Generated {len(generated)} fee invoices for {payload.billing_period}", {"skipped": len(skipped)})
    db.commit()
    return {"generated": [serialize_invoice(db, item, True) for item in generated], "skipped": skipped, "count": len(generated)}


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "view_finance")
    invoice = db.query(SchoolFeeInvoice).filter(SchoolFeeInvoice.id == invoice_id, SchoolFeeInvoice.workspace_id == access["workspace"].id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Fee invoice not found.")
    ensure_campus_access(access, invoice.campus_id)
    return serialize_invoice(db, invoice, True)


@router.post("/accounts")
def create_account(payload: AccountPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    if payload.campus_id:
        ensure_campus_access(access, payload.campus_id)
    if payload.erp_accounting_account_id and not db.query(AccountingAccount).filter(AccountingAccount.id == payload.erp_accounting_account_id).first():
        raise HTTPException(status_code=400, detail="Select a valid ERP accounting account.")
    duplicate = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.workspace_id == access["workspace"].id, func.lower(SchoolFinanceAccount.name) == payload.name.lower()).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This school account already exists.")
    account = SchoolFinanceAccount(workspace_id=access["workspace"].id, **payload.model_dump())
    account.name = account.name.strip()
    db.add(account)
    db.flush()
    audit_school_action(db, request, "create", "SchoolFinanceAccount", account.id, f"Created school finance account {account.name}")
    db.commit()
    return serialize_account(db, account)


@router.put("/accounts/{account_id}")
def update_account(account_id: int, payload: AccountPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == account_id, SchoolFinanceAccount.workspace_id == access["workspace"].id).first()
    if not account:
        raise HTTPException(status_code=404, detail="School finance account not found.")
    if payload.campus_id:
        ensure_campus_access(access, payload.campus_id)
    for key, value in payload.model_dump().items():
        setattr(account, key, value)
    account.name = account.name.strip()
    audit_school_action(db, request, "update", "SchoolFinanceAccount", account.id, f"Updated school finance account {account.name}")
    db.commit()
    return serialize_account(db, account)


@router.post("/payments")
def record_payment(payload: PaymentPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    workspace_id = access["workspace"].id
    ensure_campus_access(access, payload.campus_id)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == payload.student_id, SchoolStudent.workspace_id == workspace_id, SchoolStudent.campus_id == payload.campus_id).first()
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payload.finance_account_id, SchoolFinanceAccount.workspace_id == workspace_id, SchoolFinanceAccount.is_active == True).first()
    if not student or not account:
        raise HTTPException(status_code=400, detail="Select a valid student and receiving account.")
    if payload.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Payment method must be Cash, Bank or Online.")
    parse_date(payload.received_date)
    settings = finance_settings(db, workspace_id, payload.campus_id)
    payment = SchoolFeePayment(
        workspace_id=workspace_id,
        campus_id=payload.campus_id,
        student_id=student.id,
        finance_account_id=account.id,
        payment_no=sequence_number(db, SchoolFeePayment, SchoolFeePayment.payment_no, settings.receipt_prefix, payload.received_date),
        amount=money(payload.amount),
        unallocated_amount=money(payload.amount),
        payment_method=payload.payment_method,
        payment_reference=clean(payload.payment_reference, 160),
        received_date=payload.received_date,
        status="Posted",
        notes=clean(payload.notes, 1000),
        received_by_user_id=access["user"].id,
    )
    db.add(payment)
    db.flush()
    invoice_query = db.query(SchoolFeeInvoice).filter(
        SchoolFeeInvoice.workspace_id == workspace_id,
        SchoolFeeInvoice.student_id == student.id,
        SchoolFeeInvoice.status != "Void",
    )
    if payload.invoice_id:
        invoices = invoice_query.filter(SchoolFeeInvoice.id == payload.invoice_id).all()
        if not invoices:
            raise HTTPException(status_code=400, detail="Selected invoice does not belong to this student.")
    else:
        invoices = invoice_query.order_by(SchoolFeeInvoice.due_date, SchoolFeeInvoice.id).all()
    allocate_payment(db, payment, invoices)
    entry = post_finance_entry(
        db, access, payload.campus_id, account, "In", "Fee Payment", "Student fees", payment.amount,
        payload.received_date, student.student_name, payment.payment_no, payload.notes or f"Fee received from {student.student_name}", "SchoolFeePayment", payment.id,
    )
    audit_school_action(db, request, "create", "SchoolFeePayment", payment.id, f"Recorded PKR {payment.amount:,.2f} from {student.student_name}", {"finance_entry_id": entry.id})
    db.commit()
    return serialize_payment(db, payment)


@router.get("/payments/{payment_id}/receipt")
def payment_receipt(payment_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "view_finance")
    payment = db.query(SchoolFeePayment).filter(SchoolFeePayment.id == payment_id, SchoolFeePayment.workspace_id == access["workspace"].id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Fee receipt not found.")
    ensure_campus_access(access, payment.campus_id)
    data = serialize_payment(db, payment)
    campus = db.query(SchoolCampus).filter(SchoolCampus.id == payment.campus_id).first()
    data["school_name"] = access["workspace"].name
    data["campus_name"] = campus.name if campus else ""
    allocation_text = ", ".join(item["invoice_no"] for item in data["allocations"]) or "Advance fee"
    data["whatsapp_text"] = (
        f"{access['workspace'].name} fee receipt\n"
        f"Receipt: {payment.payment_no}\nStudent: {data['student_name']} ({data['admission_no']})\n"
        f"Amount: PKR {payment.amount:,.2f}\nDate: {payment.received_date}\n"
        f"Method: {payment.payment_method}\nAgainst: {allocation_text}\n"
        f"Thank you."
    )
    return data


@router.post("/adjustments")
def create_adjustment(payload: AdjustmentPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    invoice = db.query(SchoolFeeInvoice).filter(SchoolFeeInvoice.id == payload.invoice_id, SchoolFeeInvoice.workspace_id == access["workspace"].id).first()
    if not invoice or invoice.status == "Void":
        raise HTTPException(status_code=404, detail="Active fee invoice not found.")
    ensure_campus_access(access, invoice.campus_id)
    adjustment_type = "Credit" if payload.adjustment_type.lower() == "credit" else "Debit"
    adjustment = SchoolFeeAdjustment(
        workspace_id=invoice.workspace_id,
        campus_id=invoice.campus_id,
        student_id=invoice.student_id,
        invoice_id=invoice.id,
        adjustment_type=adjustment_type,
        category=payload.category,
        amount=money(payload.amount),
        reason=payload.reason.strip(),
        created_by_user_id=access["user"].id,
    )
    db.add(adjustment)
    db.flush()
    refresh_invoice(db, invoice)
    audit_school_action(db, request, "create", "SchoolFeeAdjustment", adjustment.id, f"Added {adjustment_type.lower()} adjustment to {invoice.invoice_no}")
    db.commit()
    return {"adjustment": model_dict(adjustment), "invoice": serialize_invoice(db, invoice, True)}


@router.post("/refunds")
def create_refund(payload: RefundPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    workspace_id = access["workspace"].id
    payment = db.query(SchoolFeePayment).filter(SchoolFeePayment.id == payload.payment_id, SchoolFeePayment.workspace_id == workspace_id, SchoolFeePayment.status == "Posted").first()
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payload.finance_account_id, SchoolFinanceAccount.workspace_id == workspace_id).first()
    if not payment or not account:
        raise HTTPException(status_code=400, detail="Select a valid payment and refund account.")
    ensure_campus_access(access, payment.campus_id)
    previous_refunds = money(db.query(func.coalesce(func.sum(SchoolFeeRefund.amount), 0)).filter(SchoolFeeRefund.payment_id == payment.id, SchoolFeeRefund.status == "Posted").scalar())
    if previous_refunds + payload.amount > payment.amount:
        raise HTTPException(status_code=400, detail="Refund exceeds the remaining refundable payment amount.")
    invoice = None
    if payload.invoice_id:
        invoice = db.query(SchoolFeeInvoice).filter(SchoolFeeInvoice.id == payload.invoice_id, SchoolFeeInvoice.student_id == payment.student_id).first()
        allocation = db.query(SchoolFeePaymentAllocation).filter(SchoolFeePaymentAllocation.payment_id == payment.id, SchoolFeePaymentAllocation.invoice_id == payload.invoice_id).first()
        if not invoice or not allocation or payload.amount > allocation.amount:
            raise HTTPException(status_code=400, detail="Refund exceeds this payment's invoice allocation.")
        allocation.amount = money(allocation.amount - payload.amount)
        if allocation.amount <= 0:
            db.delete(allocation)
        db.flush()
        refresh_invoice(db, invoice)
    else:
        if payload.amount > payment.unallocated_amount:
            raise HTTPException(status_code=400, detail="Advance refund exceeds the available advance balance.")
        payment.unallocated_amount = money(payment.unallocated_amount - payload.amount)
    parse_date(payload.refund_date)
    settings = finance_settings(db, workspace_id, payment.campus_id)
    student = db.query(SchoolStudent).filter(SchoolStudent.id == payment.student_id).first()
    refund = SchoolFeeRefund(
        workspace_id=workspace_id,
        campus_id=payment.campus_id,
        student_id=payment.student_id,
        payment_id=payment.id,
        invoice_id=invoice.id if invoice else None,
        finance_account_id=account.id,
        refund_no=sequence_number(db, SchoolFeeRefund, SchoolFeeRefund.refund_no, f"{settings.receipt_prefix}R", payload.refund_date),
        amount=money(payload.amount),
        refund_method=payload.refund_method,
        refund_date=payload.refund_date,
        reason=payload.reason.strip(),
        status="Posted",
        processed_by_user_id=access["user"].id,
    )
    db.add(refund)
    db.flush()
    post_finance_entry(db, access, payment.campus_id, account, "Out", "Refund", "Fee refund", refund.amount, refund.refund_date, student.student_name if student else None, refund.refund_no, refund.reason, "SchoolFeeRefund", refund.id)
    audit_school_action(db, request, "create", "SchoolFeeRefund", refund.id, f"Refunded PKR {refund.amount:,.2f} against {payment.payment_no}")
    db.commit()
    return {**model_dict(refund), "invoice": serialize_invoice(db, invoice) if invoice else None}


@router.post("/late-fees/apply")
def apply_late_fees(request: Request, campus_id: int, as_of: str = Query(default_factory=today_string), db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, campus_id)
    as_of_date = parse_date(as_of)
    settings = finance_settings(db, access["workspace"].id, campus_id)
    invoices = db.query(SchoolFeeInvoice).filter(
        SchoolFeeInvoice.workspace_id == access["workspace"].id,
        SchoolFeeInvoice.campus_id == campus_id,
        SchoolFeeInvoice.balance_amount > 0,
        SchoolFeeInvoice.status != "Void",
    ).all()
    updated = []
    for invoice in invoices:
        if as_of_date.date() <= (parse_date(invoice.due_date) + timedelta(days=settings.late_fee_grace_days or 0)).date():
            continue
        base = money(invoice.subtotal - invoice.discount_amount + invoice.adjustment_amount)
        calculated = money(base * settings.late_fee_value / 100) if settings.late_fee_type == "Percentage" else money(settings.late_fee_value)
        if calculated > invoice.late_fee_amount:
            invoice.late_fee_amount = calculated
            refresh_invoice(db, invoice)
            updated.append(invoice)
    audit_school_action(db, request, "update", "SchoolFeeInvoice", None, f"Applied late fees to {len(updated)} invoices")
    db.commit()
    return {"count": len(updated), "invoices": [serialize_invoice(db, item) for item in updated]}


@router.post("/reminders/send")
def send_outstanding_reminders(request: Request, campus_id: int, as_of: str = Query(default_factory=today_string), db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, campus_id)
    settings = finance_settings(db, access["workspace"].id, campus_id)
    if not settings.automatic_reminders:
        raise HTTPException(status_code=400, detail="Automatic fee reminders are disabled in fee policy.")
    reminder_limit = (parse_date(as_of) + timedelta(days=settings.reminder_days_before or 0)).date().isoformat()
    invoices = db.query(SchoolFeeInvoice).filter(
        SchoolFeeInvoice.workspace_id == access["workspace"].id,
        SchoolFeeInvoice.campus_id == campus_id,
        SchoolFeeInvoice.balance_amount > 0,
        SchoolFeeInvoice.due_date <= reminder_limit,
        SchoolFeeInvoice.status != "Void",
    ).all()
    created = []
    for invoice in invoices:
        refresh_invoice(db, invoice)
        student = db.query(SchoolStudent).filter(SchoolStudent.id == invoice.student_id).first()
        if not student:
            continue
        message = f"Fee reminder: PKR {invoice.balance_amount:,.2f} for {student.student_name} is due by {invoice.due_date}. Invoice {invoice.invoice_no}."
        parents = db.query(SchoolRoleAssignment).filter(
            SchoolRoleAssignment.workspace_id == invoice.workspace_id,
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
            if db.query(SchoolFeeReminder).filter(SchoolFeeReminder.invoice_id == invoice.id, SchoolFeeReminder.recipient_key == key, SchoolFeeReminder.reminder_date == as_of).first():
                continue
            reminder = SchoolFeeReminder(
                workspace_id=invoice.workspace_id,
                campus_id=invoice.campus_id,
                invoice_id=invoice.id,
                student_id=student.id,
                recipient_key=key,
                recipient_name=name,
                recipient_phone=phone,
                recipient_user_id=user_id,
                channel=channel,
                message=message,
                reminder_date=as_of,
                status=status,
                sent_at=datetime.utcnow() if status == "Sent" else None,
            )
            db.add(reminder)
            db.flush()
            created.append(reminder)
            if user_id:
                db.add(SchoolNotification(
                    workspace_id=invoice.workspace_id,
                    campus_id=invoice.campus_id,
                    title="School fee reminder",
                    body=message,
                    audience_type="User",
                    audience_value=str(user_id),
                    priority="High" if invoice.due_date < as_of else "Normal",
                    status="Published",
                    created_by_user_id=access["user"].id,
                    published_at=datetime.utcnow(),
                ))
    audit_school_action(db, request, "send", "SchoolFeeReminder", None, f"Created {len(created)} fee reminders")
    db.commit()
    return {"count": len(created), "reminders": [model_dict(item) for item in created]}


@router.get("/ledger/{student_id}")
def student_ledger(student_id: int, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "view_finance")
    student = db.query(SchoolStudent).filter(SchoolStudent.id == student_id, SchoolStudent.workspace_id == access["workspace"].id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    ensure_campus_access(access, student.campus_id)
    events = []
    invoices = db.query(SchoolFeeInvoice).filter(SchoolFeeInvoice.student_id == student.id, SchoolFeeInvoice.status != "Void").all()
    for invoice in invoices:
        refresh_invoice(db, invoice)
        base = money(invoice.subtotal - invoice.discount_amount + invoice.late_fee_amount)
        events.append({"date": invoice.issue_date, "sort": 1, "type": "Invoice", "reference": invoice.invoice_no, "description": f"Fees for {invoice.billing_period}", "debit": base, "credit": 0})
        for adjustment in db.query(SchoolFeeAdjustment).filter(SchoolFeeAdjustment.invoice_id == invoice.id).all():
            events.append({"date": adjustment.created_at.date().isoformat(), "sort": 2, "type": f"{adjustment.adjustment_type} adjustment", "reference": invoice.invoice_no, "description": adjustment.reason, "debit": adjustment.amount if adjustment.adjustment_type == "Debit" else 0, "credit": adjustment.amount if adjustment.adjustment_type == "Credit" else 0})
    payments = db.query(SchoolFeePayment).filter(SchoolFeePayment.student_id == student.id, SchoolFeePayment.status == "Posted").all()
    for payment in payments:
        events.append({"date": payment.received_date, "sort": 3, "type": "Payment", "reference": payment.payment_no, "description": f"{payment.payment_method} payment", "debit": 0, "credit": payment.amount})
    refunds = db.query(SchoolFeeRefund).filter(SchoolFeeRefund.student_id == student.id, SchoolFeeRefund.status == "Posted").all()
    for refund in refunds:
        events.append({"date": refund.refund_date, "sort": 4, "type": "Refund", "reference": refund.refund_no, "description": refund.reason, "debit": refund.amount, "credit": 0})
    events.sort(key=lambda item: (item["date"], item["sort"], item["reference"]))
    running = 0
    for event in events:
        running = money(running + event["debit"] - event["credit"])
        event["balance"] = running
        event.pop("sort")
    return {
        "student": {"id": student.id, "student_name": student.student_name, "admission_no": student.admission_no, "class_name": student.class_name, "section": student.section},
        "entries": events,
        "balance": running,
        "advance": money(sum(payment.unallocated_amount for payment in payments)),
    }


@router.post("/entries")
def create_finance_entry(payload: EntryPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, payload.campus_id)
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payload.finance_account_id, SchoolFinanceAccount.workspace_id == access["workspace"].id, SchoolFinanceAccount.is_active == True).first()
    if not account:
        raise HTTPException(status_code=400, detail="Select a valid school account.")
    parse_date(payload.entry_date)
    direction = "In" if payload.direction.lower() == "in" else "Out"
    if payload.entry_type == "Transfer":
        target = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payload.target_account_id, SchoolFinanceAccount.workspace_id == access["workspace"].id, SchoolFinanceAccount.is_active == True).first()
        if not target or target.id == account.id:
            raise HTTPException(status_code=400, detail="Select a different destination account for the transfer.")
        transfer_ref = payload.reference or f"TRF-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        first = post_finance_entry(db, access, payload.campus_id, account, "Out", "Transfer", payload.category, payload.amount, payload.entry_date, target.name, transfer_ref, payload.description, "SchoolTransfer", None)
        second = post_finance_entry(db, access, payload.campus_id, target, "In", "Transfer", payload.category, payload.amount, payload.entry_date, account.name, transfer_ref, payload.description, "SchoolTransfer", first.id)
        first.source_id = second.id
        entries = [first, second]
    else:
        entries = [post_finance_entry(db, access, payload.campus_id, account, direction, payload.entry_type, payload.category, payload.amount, payload.entry_date, payload.counterparty, payload.reference, payload.description, "ManualSchoolFinance", None)]
    audit_school_action(db, request, "create", "SchoolFinanceEntry", entries[0].id, f"Recorded school {payload.entry_type.lower()} of PKR {payload.amount:,.2f}")
    db.commit()
    return [model_dict(item) for item in entries]


@router.post("/cash-closings")
def close_cash_day(payload: CashClosingPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, payload.campus_id)
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payload.finance_account_id, SchoolFinanceAccount.workspace_id == access["workspace"].id, SchoolFinanceAccount.account_type == "Cash").first()
    if not account:
        raise HTTPException(status_code=400, detail="Select an active cash account.")
    parse_date(payload.closing_date)
    existing = db.query(SchoolCashClosing).filter(
        SchoolCashClosing.workspace_id == access["workspace"].id,
        SchoolCashClosing.campus_id == payload.campus_id,
        SchoolCashClosing.finance_account_id == account.id,
        SchoolCashClosing.closing_date == payload.closing_date,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="This cash account is already closed for the selected date.")
    opening_date = (parse_date(payload.closing_date) - timedelta(days=1)).date().isoformat()
    opening = account_balance(db, account, opening_date)
    entries = db.query(SchoolFinanceEntry).filter(SchoolFinanceEntry.finance_account_id == account.id, SchoolFinanceEntry.entry_date == payload.closing_date).all()
    cash_collected = money(sum(item.amount for item in entries if item.direction == "In" and item.entry_type == "Fee Payment"))
    other_income = money(sum(item.amount for item in entries if item.direction == "In" and item.entry_type != "Fee Payment"))
    cash_out = money(sum(item.amount for item in entries if item.direction == "Out"))
    expected = money(opening + cash_collected + other_income - cash_out)
    closing = SchoolCashClosing(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        finance_account_id=account.id,
        closing_date=payload.closing_date,
        opening_cash=opening,
        cash_collected=cash_collected,
        other_income=other_income,
        cash_out=cash_out,
        expected_cash=expected,
        actual_cash=money(payload.actual_cash),
        variance=money(payload.actual_cash - expected),
        status="Closed",
        notes=clean(payload.notes, 1000),
        closed_by_user_id=access["user"].id,
    )
    db.add(closing)
    db.flush()
    audit_school_action(db, request, "close", "SchoolCashClosing", closing.id, f"Closed cash collection for {payload.closing_date}")
    db.commit()
    return model_dict(closing)


@router.post("/reconciliations")
def reconcile_account(payload: ReconciliationPayload, request: Request, db: Session = Depends(get_school_db)):
    access = require_school_permission(request, db, "manage_finance")
    ensure_campus_access(access, payload.campus_id)
    account = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.id == payload.finance_account_id, SchoolFinanceAccount.workspace_id == access["workspace"].id).first()
    if not account:
        raise HTTPException(status_code=400, detail="Select a valid school account.")
    parse_date(payload.statement_date)
    book = account_balance(db, account, payload.statement_date)
    difference = money(payload.statement_balance - book)
    reconciliation = SchoolBankReconciliation(
        workspace_id=access["workspace"].id,
        campus_id=payload.campus_id,
        finance_account_id=account.id,
        statement_date=payload.statement_date,
        book_balance=book,
        statement_balance=money(payload.statement_balance),
        difference=difference,
        status="Reconciled" if abs(difference) < 0.01 else "Difference",
        notes=clean(payload.notes, 1000),
        reconciled_by_user_id=access["user"].id,
    )
    db.add(reconciliation)
    db.flush()
    audit_school_action(db, request, "reconcile", "SchoolBankReconciliation", reconciliation.id, f"Reconciled {account.name} with difference PKR {difference:,.2f}")
    db.commit()
    return model_dict(reconciliation)


@router.get("/reports")
def finance_reports(
    request: Request,
    campus_id: int | None = Query(default=None),
    date_from: str = Query(default_factory=lambda: f"{datetime.now().year}-01-01"),
    date_to: str = Query(default_factory=today_string),
    school_class_id: int | None = Query(default=None),
    db: Session = Depends(get_school_db),
):
    access = require_school_permission(request, db, "view_finance")
    parse_date(date_from)
    parse_date(date_to)
    if campus_id:
        ensure_campus_access(access, campus_id)
    workspace_id = access["workspace"].id
    invoice_query = db.query(SchoolFeeInvoice).join(SchoolStudent, SchoolStudent.id == SchoolFeeInvoice.student_id).filter(
        SchoolFeeInvoice.workspace_id == workspace_id,
        SchoolFeeInvoice.issue_date >= date_from,
        SchoolFeeInvoice.issue_date <= date_to,
        SchoolFeeInvoice.status != "Void",
    )
    entry_query = db.query(SchoolFinanceEntry).filter(
        SchoolFinanceEntry.workspace_id == workspace_id,
        SchoolFinanceEntry.entry_date >= date_from,
        SchoolFinanceEntry.entry_date <= date_to,
    )
    account_query = db.query(SchoolFinanceAccount).filter(SchoolFinanceAccount.workspace_id == workspace_id, SchoolFinanceAccount.is_active == True)
    if access["campus_ids"] is not None:
        ids = list(access["campus_ids"])
        invoice_query = invoice_query.filter(SchoolFeeInvoice.campus_id.in_(ids))
        entry_query = entry_query.filter(SchoolFinanceEntry.campus_id.in_(ids))
        account_query = account_query.filter(or_(SchoolFinanceAccount.campus_id.in_(ids), SchoolFinanceAccount.campus_id.is_(None)))
    if campus_id:
        invoice_query = invoice_query.filter(SchoolFeeInvoice.campus_id == campus_id)
        entry_query = entry_query.filter(SchoolFinanceEntry.campus_id == campus_id)
        account_query = account_query.filter(or_(SchoolFinanceAccount.campus_id == campus_id, SchoolFinanceAccount.campus_id.is_(None)))
    if school_class_id:
        invoice_query = invoice_query.filter(SchoolStudent.school_class_id == school_class_id)
    invoices = invoice_query.all()
    for invoice in invoices:
        refresh_invoice(db, invoice)
    entries = entry_query.all()
    students = {item.id: item for item in db.query(SchoolStudent).filter(SchoolStudent.id.in_([invoice.student_id for invoice in invoices] or [-1])).all()}
    defaulters = []
    for invoice in invoices:
        if invoice.balance_amount <= 0:
            continue
        student = students.get(invoice.student_id)
        defaulters.append({
            "invoice_id": invoice.id,
            "invoice_no": invoice.invoice_no,
            "student_id": invoice.student_id,
            "student_name": student.student_name if student else "Unknown student",
            "admission_no": student.admission_no if student else "",
            "class_name": student.class_name if student else "",
            "section": student.section if student else "",
            "campus_id": invoice.campus_id,
            "due_date": invoice.due_date,
            "balance": invoice.balance_amount,
            "days_overdue": max(0, (parse_date(date_to) - parse_date(invoice.due_date)).days),
        })
    collections_by_date = {}
    for entry in entries:
        if entry.direction == "In" and entry.entry_type == "Fee Payment":
            collections_by_date[entry.entry_date] = money(collections_by_date.get(entry.entry_date, 0) + entry.amount)
    fee_income = money(sum(item.amount for item in entries if item.direction == "In" and item.entry_type == "Fee Payment"))
    other_income = money(sum(item.amount for item in entries if item.direction == "In" and item.entry_type not in {"Fee Payment", "Transfer"}))
    refunds = money(sum(item.amount for item in entries if item.direction == "Out" and item.entry_type == "Refund"))
    expenses = money(sum(item.amount for item in entries if item.direction == "Out" and item.entry_type not in {"Refund", "Transfer"}))
    accounts = account_query.order_by(SchoolFinanceAccount.name).all()
    return {
        "date_from": date_from,
        "date_to": date_to,
        "statement": {
            "fees_billed": money(sum(item.total_amount for item in invoices)),
            "discounts": money(sum(item.discount_amount for item in invoices)),
            "late_fees": money(sum(item.late_fee_amount for item in invoices)),
            "fee_income_collected": fee_income,
            "other_income": other_income,
            "refunds": refunds,
            "expenses": expenses,
            "net_cash_flow": money(fee_income + other_income - refunds - expenses),
            "outstanding": money(sum(item.balance_amount for item in invoices)),
        },
        "accounts": [serialize_account(db, item) for item in accounts],
        "defaulters": sorted(defaulters, key=lambda item: (-item["days_overdue"], item["student_name"])),
        "collections_by_date": [{"date": key, "amount": value} for key, value in sorted(collections_by_date.items())],
        "entries": [model_dict(item) for item in sorted(entries, key=lambda row: (row.entry_date, row.id), reverse=True)[:500]],
    }
