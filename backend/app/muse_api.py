"""Tenant-scoped Muse order ingestion and final payout reporting."""
import hashlib
import secrets
import json
import asyncio
import logging
import re
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict, HttpUrl
from sqlalchemy.exc import IntegrityError

from .models import MuseApiKey, MuseSubmission, User, Tenant, Order, Customer, Product
from .schemas import OrderCreate, OrderItemCreate


class MuseProduct(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    article_no: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=500)
    unit_price_usd: float = Field(ge=0, allow_inf_nan=False)
    image_url: HttpUrl | None = None


def product_result(product):
    return {"id": product.id, "article_no": product.article_no,
            "name": product.name, "unit_price_usd": product.selling_price or 0,
            "image_url": product.image_url}


def ensure_product(payload, db):
    existing = db.query(Product).filter_by(article_no=payload.article_no).first()
    if existing:
        return product_result(existing)
    product = Product(article_no=payload.article_no, name=payload.name,
                      selling_price=payload.unit_price_usd,
                      image_url=str(payload.image_url) if payload.image_url else None)
    db.add(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Product).filter_by(article_no=payload.article_no).first()
        if existing:
            return product_result(existing)
        raise HTTPException(409, "Article number unavailable; contact your administrator")
    db.refresh(product)
    return product_result(product)


class MuseItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    article_no: str = Field(min_length=1)
    quantity: int = Field(gt=0)
    unit_price_usd: float = Field(ge=0, allow_inf_nan=False)


class MuseOrder(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    order_no: str = Field(min_length=1, max_length=100)
    order_date: datetime
    customer_name: str = Field(min_length=1)
    company_name: str = Field(min_length=1)
    shipping_address: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    customer_id: int | None = Field(default=None, gt=0)
    platform: str = Field(default="Faire", min_length=1)
    estimated_net_usd: float = Field(ge=0, allow_inf_nan=False)
    items: list[MuseItem] = Field(min_length=1, max_length=500)


class MusePayout(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    order_no: str = Field(min_length=1)
    actual_paid_usd: float = Field(ge=0.01, multiple_of=0.01, allow_inf_nan=False)
    paid_at: datetime


def authenticate(db, token):
    key = db.query(MuseApiKey).filter_by(key_hash=hashlib.sha256(token.encode()).hexdigest()).first()
    if not key:
        raise HTTPException(401, "Invalid Muse API key")
    user = db.query(User).execution_options(skip_tenant_scope=True).filter_by(id=key.user_id, is_active=True).first()
    tenant = db.query(Tenant).filter_by(id=key.tenant_id).first()
    if not user or user.role not in {"admin", "super_admin"} or not tenant or tenant.status != "active":
        raise HTTPException(403, "Muse integration is disabled")
    if user.role != "super_admin" and user.tenant_id != key.tenant_id:
        raise HTTPException(403, "Muse integration tenant mismatch")
    return user, key.tenant_id


def rotate_key(db, user, tenant_id):
    if user.role not in {"admin", "super_admin"} or tenant_id is None:
        raise HTTPException(403, "A company administrator must configure Muse")
    key = db.query(MuseApiKey).filter_by(tenant_id=tenant_id).first()
    if not key:
        key = MuseApiKey(tenant_id=tenant_id)
    token = "muse_" + secrets.token_urlsafe(36)
    key.user_id = user.id
    key.key_hash = hashlib.sha256(token.encode()).hexdigest()
    db.add(key)
    db.commit()
    return {"api_key": token}


def order_result(order):
    return {"order_no": order.order_no, "order_id": order.id,
            "estimated_net_usd": order.expected_payout_usd,
            "actual_paid_usd": order.received_payout_usd,
            "payout_status": order.payout_status,
            "stop_tracking": order.payout_status == "Received"}


def ingest_order(payload, db, create_order_record):
    existing = db.query(Order).filter_by(order_no=payload.order_no).first()
    if existing:
        if existing.import_batch_key != "muse-api":
            raise HTTPException(
                409,
                "Order number already exists in this company from a non-Muse import; "
                "use a new order number or manage that order in Orders.",
            )
        return order_result(existing)
    items = []
    for item in payload.items:
        product = db.query(Product).filter_by(article_no=item.article_no).first()
        if not product:
            raise HTTPException(422, f"Unknown article_no: {item.article_no}. Add the product first.")
        items.append(OrderItemCreate(product_id=product.id, quantity=item.quantity, unit_price=item.unit_price_usd))
    customer = match_customer(payload, db)
    if not customer:
        customer = Customer(name=payload.customer_name, company_name=payload.company_name,
                            phone=payload.phone, shipping_address=payload.shipping_address, platform=payload.platform)
        db.add(customer)
        db.flush()
    data = OrderCreate(order_no=payload.order_no, order_date=payload.order_date, customer_id=customer.id,
                       platform=payload.platform, import_customer_name=payload.customer_name,
                       import_customer_company_name=payload.company_name, import_contact_phone=payload.phone,
                       import_shipping_address=payload.shipping_address,
                       order_total_usd=sum(i.quantity * i.unit_price for i in items),
                       expected_payout_usd=payload.estimated_net_usd,
                       remaining_payout_usd=payload.estimated_net_usd, items=items)
    # The existing creator commits internally. Use a savepoint-bound session so
    # customer, order, inventory reservations and items publish atomically.
    order = create_order_record(data, db, import_batch_key="muse-api")
    return order_result(order)


def match_customer(payload, db):
    if payload.customer_id:
        customer = db.query(Customer).filter_by(id=payload.customer_id).first()
        if not customer:
            raise HTTPException(422, "customer_id not found in this company")
        return customer
    normalize = lambda value: " ".join((value or "").casefold().split())
    phone = lambda value: re.sub(r"\D", "", value or "").removeprefix("00")
    candidates = db.query(Customer).all()
    matches = [c for c in candidates if phone(c.phone) == phone(payload.phone) and phone(c.phone)]
    if not matches:
        matches = [c for c in candidates if normalize(c.name) == normalize(payload.customer_name)
                   and normalize(c.company_name) == normalize(payload.company_name)]
    if len(matches) > 1:
        raise HTTPException(409, "Multiple matching customers; resend with the correct customer_id")
    return matches[0] if matches else None


def enqueue(payload, kind, db):
    key = f"{kind}:{payload.order_no}"
    data = payload.model_dump_json()
    tenant_id = db.info["tenant_id"]
    row = db.query(MuseSubmission).filter_by(tenant_id=tenant_id, submission_key=key).first()
    if row:
        if row.payload != data and row.status != "Failed":
            raise HTTPException(409, "This order submission already exists with different details")
        if row.status == "Failed":
            row.payload, row.status, row.error = data, "Pending", None
            db.commit()
        return submission_result(row)
    row = MuseSubmission(tenant_id=tenant_id, submission_key=key, kind=kind, payload=data)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Submission already queued; retrieve its status before retrying")
    return submission_result(row)


def submission_result(row):
    return {"id": row.id, "kind": row.kind, "order_no": json.loads(row.payload)["order_no"],
            "status": row.status, "error": row.error, "created_at": row.created_at,
            "processed_at": row.processed_at}


def processing_error_message(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    if isinstance(exc, IntegrityError):
        detail = str(getattr(exc, "orig", exc)).lower()
        if "orders" in detail and "order_no" in detail:
            return "Order number already exists in this company"
        if "products" in detail and "article_no" in detail:
            return "Article number already exists in this company"
        return "This record conflicts with existing company data; fix the order number or SKU and retry."
    return "Processing failed; contact your administrator and retry."


def process_queue(engine, create_order, sync_accounting):
    from sqlalchemy.orm import Session
    from sqlalchemy import select, update
    # A conditional claim inside the same transaction prevents multiple workers
    # from applying a submission twice. Crashes roll the claim back.
    with Session(engine) as lookup:
        ids = lookup.scalars(select(MuseSubmission.id).where(MuseSubmission.status == "Pending")
                             .order_by(MuseSubmission.id).limit(500)).all()
    for submission_id in ids:
        try:
            with engine.begin() as connection:
                claimed = connection.execute(update(MuseSubmission).where(
                    MuseSubmission.id == submission_id, MuseSubmission.status == "Pending"
                ).values(status="Processing"))
                if claimed.rowcount != 1:
                    continue
                with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                    row = db.get(MuseSubmission, submission_id)
                    db.info["tenant_id"] = row.tenant_id
                    tenant = db.get(Tenant, row.tenant_id)
                    if not tenant or tenant.status != "active":
                        raise HTTPException(403, "Company is inactive")
                    if row.kind == "order":
                        ingest_order(MuseOrder.model_validate_json(row.payload), db, create_order)
                    else:
                        record_payout(MusePayout.model_validate_json(row.payload), db, sync_accounting)
                    row.status, row.error, row.processed_at = "Applied", None, datetime.utcnow()
                    db.commit()
        except Exception as exc:
            logging.getLogger(__name__).exception("Muse submission %s failed", submission_id)
            with Session(engine) as db:
                row = db.get(MuseSubmission, submission_id)
                # Claim rolls back to Pending on failure; also recover stuck Processing rows.
                if row and row.status in {"Pending", "Processing"}:
                    row.status = "Failed"
                    row.error = processing_error_message(exc)
                    db.commit()


class MuseQueueService:
    def __init__(self, engine, create_order, sync_accounting):
        self.args = engine, create_order, sync_accounting
        self.task = None
        self.loop = None
        self.wake = None
        self.poll_interval_seconds = 5

    async def start(self):
        self.loop = asyncio.get_running_loop()
        self.wake = asyncio.Event()
        self.task = asyncio.create_task(self.run())

    def notify(self):
        # API handlers run in worker threads; wake the service on its own loop.
        if self.loop and self.wake and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(self.wake.set)

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def run(self):
        while True:
            self.wake.clear()
            try:
                await asyncio.to_thread(process_queue, *self.args)
            except Exception:
                logging.getLogger(__name__).exception("Muse queue check failed")
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=self.poll_interval_seconds)
            except asyncio.TimeoutError:
                pass


def record_payout(payload, db, sync_accounting):
    order = db.query(Order).filter_by(order_no=payload.order_no, import_batch_key="muse-api").with_for_update().first()
    if not order:
        raise HTTPException(404, "Muse order not found")
    if order.payout_status == "Received":
        if round(order.received_payout_usd, 2) != round(payload.actual_paid_usd, 2):
            raise HTTPException(409, "Final payout already recorded with a different amount")
        return order_result(order)
    order.received_payout_usd = round(payload.actual_paid_usd, 2)
    order.payout_received_date = payload.paid_at
    order.payout_status = "Received"
    order.payment_status = "Paid"
    order.payment_source = "Muse AI"
    order.remaining_payout_usd = 0
    if order.exchange_rate:
        order.received_pkr = order.received_payout_usd * order.exchange_rate
        order.final_received_pkr = order.received_pkr - (order.bank_charges_pkr or 0)
    sync_accounting(db, order)
    db.commit()
    return order_result(order)
