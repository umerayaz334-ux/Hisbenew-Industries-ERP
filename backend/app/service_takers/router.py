import json
import os
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..database import SessionLocal
from ..models import (
    ActivityLog,
    InternalCall,
    InternalCallSignal,
    InternalMessage,
    InternalMessageContactRequest,
    PublicAccessRequest,
    User,
    UserRoleRequest,
    WebsiteVisitorMessage,
)
from ..security import hash_pin, verify_pin, sanitize_upload_filename
from .models import (
    ServiceTaker,
    ServiceTakerInbound,
    ServiceTakerInboundItem,
    ServiceTakerInventoryTransaction,
    ServiceTakerManufacturingOrder,
    ServiceTakerManufacturingPayment,
    ServiceTakerManufacturingUpdate,
    ServiceTakerOrder,
    ServiceTakerOrderItem,
    ServiceTakerProduct,
    ServiceTakerShippingRequest,
)
from .schemas import (
    ServiceTakerProfileUpdate,
    ServiceTakerPinChange,
    ServiceTakerCreate,
    ServiceTakerInboundCreate,
    ServiceTakerInboundReceive,
    ServiceTakerManufacturingAdminUpdate,
    ServiceTakerManufacturingPaymentCreate,
    ServiceTakerManufacturingRequestCreate,
    ServiceTakerManufacturingShippingAdminUpdate,
    ServiceTakerManufacturingShippingRequest,
    ServiceTakerOrderAdminUpdate,
    ServiceTakerOrderCreate,
    ServiceTakerProductCreate,
    ServiceTakerProductUpdate,
    ServiceTakerShippingRequestAdminUpdate,
    ServiceTakerShippingRequestCreate,
    ServiceTakerUpdate,
)

router = APIRouter(prefix="/service-takers", tags=["Service takers"])

LABEL_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".zpl", ".zip", ".btw"}
MAX_LABEL_BYTES = 15 * 1024 * 1024
PRODUCT_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}
MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024
PAYMENT_PROOF_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.pdf'}
MAX_PAYMENT_PROOF_BYTES = 8 * 1024 * 1024
ACTIVE_ORDER_STATUSES = ("Submitted", "Awaiting label", "Processing", "Ready")
ACTIVE_MANUFACTURING_STATUSES = (
    "Quote requested",
    "Quoted",
    "Deposit pending",
    "Confirmed",
    "In production",
    "Quality check",
    "Ready",
)
SERVICE_TAKER_PRODUCTS_PAGE = 'Service Products'
SERVICE_TAKER_FULFILLMENT_PAGES = (
    'Service Inbound',
    'Service Shipments',
)
SERVICE_TAKER_MANUFACTURING_PAGE = "Service Manufacturing"
SERVICE_TAKER_CHARGES_PAGE = "Service Charges"


def service_taker_allowed_pages(
    fulfillment_enabled: bool,
    manufacturing_enabled: bool,
) -> list[str]:
    pages = ['Service Dashboard']
    if fulfillment_enabled or manufacturing_enabled:
        pages.append(SERVICE_TAKER_PRODUCTS_PAGE)
    if fulfillment_enabled:
        pages.extend(SERVICE_TAKER_FULFILLMENT_PAGES)
    if manufacturing_enabled:
        pages.append(SERVICE_TAKER_MANUFACTURING_PAGE)
    if fulfillment_enabled or manufacturing_enabled:
        pages.append(SERVICE_TAKER_CHARGES_PAGE)
    return pages


def service_taker_service_access(user: User | None) -> dict:
    try:
        allowed_pages = set(json.loads(user.allowed_pages or "[]")) if user else set()
    except (TypeError, json.JSONDecodeError):
        allowed_pages = set()
    fulfillment_enabled = any(
        page in allowed_pages for page in SERVICE_TAKER_FULFILLMENT_PAGES
    )
    manufacturing_enabled = SERVICE_TAKER_MANUFACTURING_PAGE in allowed_pages
    if SERVICE_TAKER_CHARGES_PAGE in allowed_pages and not fulfillment_enabled:
        manufacturing_enabled = True
    return {
        "fulfillment_enabled": fulfillment_enabled,
        "manufacturing_enabled": manufacturing_enabled,
    }


def get_db(request: Request):
    db = SessionLocal()
    tenant_id = getattr(getattr(request, "state", None), "tenant_id", None) if request else None
    if tenant_id is not None:
        db.info["tenant_id"] = tenant_id
    try:
        yield db
    finally:
        db.close()


def clean_text(value: object) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def authenticated_user(request: Request, db: Session) -> User:
    user_id = getattr(request.state, "user_id", None)
    user = (
        db.query(User)
        .filter(User.id == user_id, User.is_active == True)
        .one_or_none()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


def require_admin(request: Request, db: Session) -> User:
    user = authenticated_user(request, db)
    if user.role not in {"admin", "super_admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only administrators can manage service takers.",
        )
    return user


def portal_service_taker(request: Request, db: Session) -> ServiceTaker:
    user = authenticated_user(request, db)
    if user.role != "service_taker":
        raise HTTPException(
            status_code=403,
            detail="This endpoint is restricted to service-taker accounts.",
        )
    service_taker = (
        db.query(ServiceTaker)
        .filter(
            ServiceTaker.user_id == user.id,
            ServiceTaker.is_active == True,
        )
        .one_or_none()
    )
    if not service_taker:
        raise HTTPException(
            status_code=403,
            detail="Your service portal is not active.",
        )
    return service_taker


@router.patch("/portal/profile")
def portal_update_profile(payload: ServiceTakerProfileUpdate, request: Request, db: Session = Depends(get_db)):
    client = portal_service_taker(request, db)
    user = db.query(User).filter(User.id == client.user_id).one()
    client.contact_name = payload.contact_name
    client.email = payload.email
    client.phone = payload.phone or None
    client.billing_address = payload.billing_address or None
    user.name = client.contact_name
    user.email = client.email
    user.phone = client.phone
    client.updated_at = datetime.utcnow()
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(client)
    return client_response(db, client)


@router.post("/portal/change-pin")
def portal_change_pin(payload: ServiceTakerPinChange, request: Request, db: Session = Depends(get_db)):
    client = portal_service_taker(request, db)
    user = db.query(User).filter(User.id == client.user_id).one()
    if not verify_pin(payload.current_pin, user.pin):
        raise HTTPException(status_code=400, detail="Current PIN is incorrect.")
    if payload.new_pin != payload.confirm_pin:
        raise HTTPException(status_code=400, detail="New PIN and confirmation do not match.")
    if payload.new_pin == payload.current_pin:
        raise HTTPException(status_code=400, detail="Choose a different PIN from your current PIN.")
    user.pin = hash_pin(payload.new_pin)
    user.raw_pin = None
    user.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "PIN updated. Use your new PIN the next time you sign in."}


def next_number(db: Session, model, field_name: str, prefix: str) -> str:
    # These fields still have global unique constraints in existing local databases.
    next_id = int(
        db.query(func.max(model.id))
        .execution_options(skip_tenant_scope=True)
        .scalar()
        or 0
    ) + 1
    field = getattr(model, field_name)
    while True:
        value = f"{prefix}-{next_id:05d}"
        exists = (
            db.query(model.id)
            .execution_options(skip_tenant_scope=True)
            .filter(field == value)
            .first()
        )
        if not exists:
            return value
        next_id += 1


def product_response(product: ServiceTakerProduct) -> dict:
    on_hand = int(product.quantity_on_hand or 0)
    reserved = int(product.reserved_quantity or 0)
    available = max(0, on_hand - reserved)
    stock_status = (
        "Out of stock"
        if on_hand <= 0
        else "Fully reserved"
        if available <= 0
        else "In stock"
    )
    return {
        "id": product.id,
        "service_taker_id": product.service_taker_id,
        "sku": product.sku,
        "name": product.name,
        "barcode": product.barcode,
        "description": product.description,
        "image_url": product.image_url,
        "unit_weight_kg": (
            float(product.unit_weight_kg)
            if product.unit_weight_kg
            else None
        ),
        "length_cm": (
            float(product.length_cm)
            if product.length_cm is not None
            else None
        ),
        "width_cm": (
            float(product.width_cm)
            if product.width_cm is not None
            else None
        ),
        "height_cm": (
            float(product.height_cm)
            if product.height_cm is not None
            else None
        ),
        "storage_location": product.storage_location,
        "quantity_on_hand": on_hand,
        "reserved_quantity": reserved,
        "available_quantity": available,
        "stock_status": stock_status,
        "is_out_of_stock": on_hand <= 0,
        "is_active": bool(product.is_active),
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


def client_response(db: Session, client: ServiceTaker) -> dict:
    user = db.query(User).filter(User.id == client.user_id).one_or_none()
    service_access = service_taker_service_access(user)
    products = db.query(ServiceTakerProduct).filter(
        ServiceTakerProduct.service_taker_id == client.id
    )
    on_hand = (
        db.query(func.coalesce(func.sum(ServiceTakerProduct.quantity_on_hand), 0))
        .filter(ServiceTakerProduct.service_taker_id == client.id)
        .scalar()
        or 0
    )
    reserved = (
        db.query(func.coalesce(func.sum(ServiceTakerProduct.reserved_quantity), 0))
        .filter(ServiceTakerProduct.service_taker_id == client.id)
        .scalar()
        or 0
    )
    return {
        "id": client.id,
        "user_id": client.user_id,
        "company_name": client.company_name,
        "contact_name": client.contact_name,
        "username": user.username if user else None,
        "email": client.email,
        "phone": client.phone,
        "billing_address": client.billing_address,
        "currency": client.currency,
        "pick_pack_fee": float(client.pick_pack_fee or 0),
        "additional_item_fee": float(client.additional_item_fee or 0),
        "label_fee": float(client.label_fee or 0),
        "fulfillment_enabled": service_access["fulfillment_enabled"],
        "manufacturing_enabled": service_access["manufacturing_enabled"],
        "notes": client.notes,
        "is_active": bool(client.is_active and user and user.is_active),
        "product_count": products.count(),
        "quantity_on_hand": int(on_hand),
        "reserved_quantity": int(reserved),
        "available_quantity": max(0, int(on_hand) - int(reserved)),
        "open_order_count": (
            db.query(ServiceTakerOrder)
            .filter(
                ServiceTakerOrder.service_taker_id == client.id,
                ServiceTakerOrder.status.in_(ACTIVE_ORDER_STATUSES),
            )
            .count()
        ),
        "open_inbound_count": (
            db.query(ServiceTakerInbound)
            .filter(
                ServiceTakerInbound.service_taker_id == client.id,
                ServiceTakerInbound.status.in_(
                    ("Submitted", "Partially received")
                ),
            )
            .count()
        ),
        "open_manufacturing_count": (
            db.query(ServiceTakerManufacturingOrder)
            .filter(
                ServiceTakerManufacturingOrder.service_taker_id == client.id,
                ServiceTakerManufacturingOrder.status.in_(ACTIVE_MANUFACTURING_STATUSES),
            )
            .count()
        ),
        "created_at": client.created_at,
        "updated_at": client.updated_at,
    }


def inbound_response(inbound: ServiceTakerInbound) -> dict:
    return {
        "id": inbound.id,
        "service_taker_id": inbound.service_taker_id,
        "company_name": (
            inbound.service_taker.company_name if inbound.service_taker else None
        ),
        "inbound_no": inbound.inbound_no,
        "client_reference": inbound.client_reference,
        "status": inbound.status,
        "carrier": inbound.carrier,
        "tracking_number": inbound.tracking_number,
        "expected_at": inbound.expected_at,
        "received_at": inbound.received_at,
        "notes": inbound.notes,
        "expected_quantity": sum(
            int(item.expected_quantity or 0) for item in inbound.items
        ),
        "received_quantity": sum(
            int(item.received_quantity or 0) for item in inbound.items
        ),
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "sku": item.product.sku if item.product else None,
                "product_name": item.product.name if item.product else None,
                "expected_quantity": int(item.expected_quantity or 0),
                "received_quantity": int(item.received_quantity or 0),
                "remaining_quantity": max(
                    0,
                    int(item.expected_quantity or 0)
                    - int(item.received_quantity or 0),
                ),
            }
            for item in inbound.items
        ],
        "created_at": inbound.created_at,
        "updated_at": inbound.updated_at,
    }


ORDER_COST_FIELDS = (
    "shipping_cost",
    "pick_pack_cost",
    "label_cost",
    "other_cost",
    "total_cost",
)


def clear_order_costs(order: ServiceTakerOrder) -> None:
    for field in ORDER_COST_FIELDS:
        setattr(order, field, 0.0)


def order_total(order: ServiceTakerOrder) -> float:
    if order.status == "Cancelled":
        return 0.0
    return round(
        float(order.shipping_cost or 0)
        + float(order.pick_pack_cost or 0)
        + float(order.label_cost or 0)
        + float(order.other_cost or 0),
        2,
    )


def order_response(order: ServiceTakerOrder) -> dict:
    is_cancelled = order.status == "Cancelled"
    item_quantity = sum(int(item.quantity or 0) for item in order.items)
    package_quantity = int(getattr(order, "package_quantity", 1) or 1)
    request_type = getattr(order, "shipping_request_type", None) or "stock"
    manufacturing_order = getattr(order, "manufacturing_order", None)
    return {
        "id": order.id,
        "service_taker_id": order.service_taker_id,
        "company_name": (
            order.service_taker.company_name if order.service_taker else None
        ),
        "request_no": order.request_no,
        "client_reference": order.client_reference,
        "shipping_request_type": request_type,
        "manufacturing_order_id": getattr(order, "manufacturing_order_id", None),
        "manufacturing_request_no": manufacturing_order.request_no if manufacturing_order else None,
        "manufacturing_product_name": manufacturing_order.product_name if manufacturing_order else None,
        "product_description": getattr(order, "product_description", None),
        "package_quantity": package_quantity,
        "package_weight_kg": float(order.package_weight_kg) if getattr(order, "package_weight_kg", None) is not None else None,
        "package_length_cm": float(order.package_length_cm) if getattr(order, "package_length_cm", None) is not None else None,
        "package_width_cm": float(order.package_width_cm) if getattr(order, "package_width_cm", None) is not None else None,
        "package_height_cm": float(order.package_height_cm) if getattr(order, "package_height_cm", None) is not None else None,
        "preferred_courier": getattr(order, "preferred_courier", None),
        "status": order.status,
        "recipient_name": order.recipient_name,
        "recipient_company": order.recipient_company,
        "recipient_phone": order.recipient_phone,
        "recipient_email": order.recipient_email,
        "address_line_1": order.address_line_1,
        "address_line_2": order.address_line_2,
        "city": order.city,
        "state": order.state,
        "postal_code": order.postal_code,
        "country": order.country,
        "label_source": order.label_source,
        "label_url": order.label_url,
        "label_name": order.label_name,
        "courier": order.courier,
        "shipping_service": order.shipping_service,
        "tracking_number": order.tracking_number,
        "shipping_cost": 0.0 if is_cancelled else float(order.shipping_cost or 0),
        "pick_pack_cost": 0.0 if is_cancelled else float(order.pick_pack_cost or 0),
        "label_cost": 0.0 if is_cancelled else float(order.label_cost or 0),
        "other_cost": 0.0 if is_cancelled else float(order.other_cost or 0),
        "total_cost": order_total(order),
        "currency": order.service_taker.currency if order.service_taker else "USD",
        "notes": order.notes,
        "item_quantity": item_quantity or package_quantity,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "sku": item.product.sku if item.product else None,
                "product_name": item.product.name if item.product else None,
                "quantity": int(item.quantity or 0),
            }
            for item in order.items
        ],
        "submitted_at": order.submitted_at,
        "shipped_at": order.shipped_at,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }

def ledger_response(transaction: ServiceTakerInventoryTransaction) -> dict:
    return {
        "id": transaction.id,
        "service_taker_id": transaction.service_taker_id,
        "product_id": transaction.product_id,
        "sku": transaction.product.sku if transaction.product else None,
        "product_name": transaction.product.name if transaction.product else None,
        "movement_type": transaction.movement_type,
        "quantity_change": int(transaction.quantity_change or 0),
        "balance_after": int(transaction.balance_after or 0),
        "reference_type": transaction.reference_type,
        "reference_id": transaction.reference_id,
        "reference_no": transaction.reference_no,
        "note": transaction.note,
        "created_at": transaction.created_at,
    }


def manufacturing_payment_status(payment: ServiceTakerManufacturingPayment) -> str:
    return payment.status or "Confirmed"


def manufacturing_paid_total(order: ServiceTakerManufacturingOrder) -> float:
    return round(
        sum(
            float(payment.amount or 0)
            for payment in order.payments
            if manufacturing_payment_status(payment) == "Confirmed"
        ),
        2,
    )


def manufacturing_pending_payment_total(order: ServiceTakerManufacturingOrder) -> float:
    return round(
        sum(
            float(payment.amount or 0)
            for payment in order.payments
            if manufacturing_payment_status(payment) == "Pending confirmation"
        ),
        2,
    )


def manufacturing_quote_total(order: ServiceTakerManufacturingOrder) -> float:
    if order.quoted_total:
        return round(float(order.quoted_total or 0), 2)
    return round(
        (float(order.quoted_unit_price or 0) * int(order.quantity or 0))
        + float(order.other_cost or 0),
        2,
    )


def manufacturing_balance_due(order: ServiceTakerManufacturingOrder) -> float:
    if order.status in {"Cancelled", "Rejected"}:
        return 0.0
    return max(0.0, round(manufacturing_quote_total(order) + float(order.shipping_cost or 0) - manufacturing_paid_total(order), 2))


def manufacturing_deposit_balance(order: ServiceTakerManufacturingOrder) -> float:
    if order.status in {"Cancelled", "Rejected"}:
        return 0.0
    return max(0.0, round(float(order.deposit_required or 0) - manufacturing_paid_total(order), 2))


def manufacturing_payment_response(payment: ServiceTakerManufacturingPayment) -> dict:
    return {
        "id": payment.id,
        "service_taker_id": payment.service_taker_id,
        "manufacturing_order_id": payment.manufacturing_order_id,
        "amount": float(payment.amount or 0),
        "payment_type": payment.payment_type,
        "status": manufacturing_payment_status(payment),
        "method": payment.method,
        "reference": payment.reference,
        'note': payment.note,
        'proof_url': payment.proof_url,
        'proof_name': payment.proof_name,
        'proof_uploaded_at': payment.proof_uploaded_at,
        'paid_at': payment.paid_at,
        "confirmed_at": payment.confirmed_at,
        "confirmed_by_user_id": payment.confirmed_by_user_id,
        "created_at": payment.created_at,
    }


def manufacturing_update_response(update: ServiceTakerManufacturingUpdate) -> dict:
    actor_name = None
    actor_role = None
    actor_type = "system"
    message_text = (update.message or "").lower()
    if update.created_by_user:
        actor_name = update.created_by_user.name or update.created_by_user.email
        actor_role = update.created_by_user.role
        actor_type = "service_taker" if update.created_by_user.role == "service_taker" else "company"
    elif (
        update.status == "Quote requested"
        or "by client" in message_text
        or "service taker" in message_text
        or "quote request submitted" in message_text
    ):
        actor_type = "service_taker"
        actor_name = "Service Taker"
    else:
        actor_type = "company"
        actor_name = "Company"

    return {        "id": update.id,
        "service_taker_id": update.service_taker_id,
        "manufacturing_order_id": update.manufacturing_order_id,
        "status": update.status,
        "message": update.message,
        "created_by_user_id": update.created_by_user_id,
        "actor_name": actor_name,
        "actor_role": actor_role,
        "actor_type": actor_type,
        "created_at": update.created_at,
    }


def manufacturing_order_response(order: ServiceTakerManufacturingOrder) -> dict:
    paid_total = manufacturing_paid_total(order)
    pending_payment_total = manufacturing_pending_payment_total(order)
    quote_total = manufacturing_quote_total(order)
    return {
        "id": order.id,
        "service_taker_id": order.service_taker_id,
        "company_name": order.service_taker.company_name if order.service_taker else None,
        "request_no": order.request_no,
        "client_reference": order.client_reference,
        "status": order.status,
        "product_id": order.product_id,
        "product_sku": order.product.sku if order.product else None,
        "product_name": order.product_name,
        "image_url": order.image_url,
        "product_image_url": order.product.image_url if order.product else None,
        "quantity": int(order.quantity or 0),
        "steel_type": order.steel_type,
        "tang_type": order.tang_type,
        "blade_thickness_mm": order.blade_thickness_mm,
        "blade_length_in": order.blade_length_in,
        "overall_length_in": order.overall_length_in,
        "handle_material": order.handle_material,
        "sheath_type": order.sheath_type,
        "finish": order.finish,
        "hardness": order.hardness,
        "edge_type": order.edge_type,
        "packaging": order.packaging,
        "target_unit_price": order.target_unit_price,
        "quoted_unit_price": float(order.quoted_unit_price or 0),
        "other_cost": float(order.other_cost or 0),
        "other_cost_label": order.other_cost_label,
        "quoted_total": quote_total,
        "courier": order.courier,
        "tracking_number": order.tracking_number,
        "shipping_requested": bool(order.shipping_requested),
        "shipping_status": order.shipping_status or "Submitted",
        "shipping_recipient_name": order.shipping_recipient_name,
        "shipping_address": order.shipping_address,
        "shipping_weight_kg": float(order.shipping_weight_kg) if order.shipping_weight_kg is not None else None,
        "shipping_cost": float(order.shipping_cost or 0),
        "deposit_required": float(order.deposit_required or 0),
        "paid_total": paid_total,
        "pending_payment_total": pending_payment_total,
        "balance_due": manufacturing_balance_due(order),
        "deposit_balance_due": manufacturing_deposit_balance(order),
        "currency": order.service_taker.currency if order.service_taker else "USD",
        "requested_ready_at": order.requested_ready_at,
        "estimated_ready_at": order.estimated_ready_at,
        "confirmed_at": order.confirmed_at,
        "production_started_at": order.production_started_at,
        "ready_at": order.ready_at,
        "completed_at": order.completed_at,
        "notes": order.notes,
        "admin_notes": order.admin_notes,
        "last_update": order.last_update,
        "payments": [manufacturing_payment_response(payment) for payment in order.payments],
        "updates": [manufacturing_update_response(update) for update in order.updates],
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


def shipping_request_response(shipment: ServiceTakerShippingRequest) -> dict:
    return {
        "id": shipment.id,
        "service_taker_id": shipment.service_taker_id,
        "company_name": shipment.service_taker.company_name if shipment.service_taker else None,
        "request_no": shipment.request_no,
        "recipient_name": shipment.recipient_name,
        "shipping_address": shipment.shipping_address,
        "item_description": shipment.item_description,
        "quantity": int(shipment.quantity or 1),
        "notes": shipment.notes,
        "status": shipment.status,
        "shipping_weight_kg": float(shipment.shipping_weight_kg) if shipment.shipping_weight_kg is not None else None,
        "shipping_cost": float(shipment.shipping_cost or 0),
        "courier": shipment.courier,
        "tracking_number": shipment.tracking_number,
        "currency": shipment.service_taker.currency if shipment.service_taker else "USD",
        "created_at": shipment.created_at,
        "updated_at": shipment.updated_at,
    }


def manufacturing_shipping_request_response(order: ServiceTakerManufacturingOrder) -> dict:
    return {
        "id": order.id,
        "request_type": "manufacturing",
        "service_taker_id": order.service_taker_id,
        "company_name": order.service_taker.company_name if order.service_taker else None,
        "request_no": order.request_no,
        "recipient_name": order.shipping_recipient_name,
        "shipping_address": order.shipping_address,
        "item_description": order.product_name,
        "quantity": int(order.quantity or 1),
        "notes": order.notes,
        "status": order.shipping_status or "Submitted",
        "manufacturing_status": order.status,
        "shipping_weight_kg": float(order.shipping_weight_kg) if order.shipping_weight_kg is not None else None,
        "shipping_cost": float(order.shipping_cost or 0),
        "courier": order.courier,
        "tracking_number": order.tracking_number,
        "currency": order.service_taker.currency if order.service_taker else "USD",
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


def refresh_manufacturing_totals(order: ServiceTakerManufacturingOrder) -> None:
    order.quoted_total = round(
        (float(order.quoted_unit_price or 0) * int(order.quantity or 0))
        + float(order.other_cost or 0),
        2,
    )


def set_manufacturing_status_dates(order: ServiceTakerManufacturingOrder, status: str | None) -> None:
    if not status:
        return
    now = datetime.utcnow()
    if status in {"Confirmed", "In production", "Quality check", "Ready", "Completed"} and not order.confirmed_at:
        order.confirmed_at = now
    if status in {"In production", "Quality check", "Ready", "Completed"} and not order.production_started_at:
        order.production_started_at = now
    if status in {"Ready", "Completed"} and not order.ready_at:
        order.ready_at = now
    if status == "Completed" and not order.completed_at:
        order.completed_at = now


def add_manufacturing_update(
    db: Session,
    order: ServiceTakerManufacturingOrder,
    status: str,
    message: str,
    user_id: int | None = None,
) -> None:
    cleaned_message = clean_text(message)
    if not cleaned_message:
        return
    order.last_update = cleaned_message
    db.add(
        ServiceTakerManufacturingUpdate(
            tenant_id=order.tenant_id,
            service_taker_id=order.service_taker_id,
            manufacturing_order_id=order.id,
            status=status,
            message=cleaned_message,
            created_by_user_id=user_id,
        )
    )

def dashboard_response(
    db: Session,
    clients: list[ServiceTaker],
) -> dict:
    client_ids = [client.id for client in clients]
    if not client_ids:
        return {
            "stats": {
                "service_takers": 0,
                "active_service_takers": 0,
                "product_count": 0,
                "quantity_on_hand": 0,
                "reserved_quantity": 0,
                "available_quantity": 0,
                "open_inbounds": 0,
                "open_orders": 0,
                "shipped_order_cost": 0,
                "fulfillment_balance_due": 0,
                "open_manufacturing": 0,
                "manufacturing_balance_due": 0,
                "manufacturing_payments_received": 0,
                "account_balance_due": 0,
                "advance_credit": 0,
            },
            "clients": [],
            "products": [],
            "inbounds": [],
            "orders": [],
            "manufacturing_orders": [],
            "shipping_requests": [],
            "ledger": [],
        }

    products = (
        db.query(ServiceTakerProduct)
        .filter(ServiceTakerProduct.service_taker_id.in_(client_ids))
        .order_by(ServiceTakerProduct.updated_at.desc(), ServiceTakerProduct.id.desc())
        .all()
    )
    inbounds = (
        db.query(ServiceTakerInbound)
        .filter(ServiceTakerInbound.service_taker_id.in_(client_ids))
        .order_by(ServiceTakerInbound.created_at.desc(), ServiceTakerInbound.id.desc())
        .all()
    )
    orders = (
        db.query(ServiceTakerOrder)
        .filter(ServiceTakerOrder.service_taker_id.in_(client_ids))
        .order_by(ServiceTakerOrder.created_at.desc(), ServiceTakerOrder.id.desc())
        .all()
    )
    manufacturing_orders = (
        db.query(ServiceTakerManufacturingOrder)
        .filter(ServiceTakerManufacturingOrder.service_taker_id.in_(client_ids))
        .order_by(
            ServiceTakerManufacturingOrder.created_at.desc(),
            ServiceTakerManufacturingOrder.id.desc(),
        )
        .all()
    )
    shipping_requests = (
        db.query(ServiceTakerShippingRequest)
        .filter(ServiceTakerShippingRequest.service_taker_id.in_(client_ids))
        .order_by(ServiceTakerShippingRequest.created_at.desc(), ServiceTakerShippingRequest.id.desc())
        .all()
    )
    ledger = (
        db.query(ServiceTakerInventoryTransaction)
        .filter(ServiceTakerInventoryTransaction.service_taker_id.in_(client_ids))
        .order_by(
            ServiceTakerInventoryTransaction.created_at.desc(),
            ServiceTakerInventoryTransaction.id.desc(),
        )
        .limit(250)
        .all()
    )
    on_hand = sum(int(product.quantity_on_hand or 0) for product in products)
    reserved = sum(int(product.reserved_quantity or 0) for product in products)
    shipped_cost = sum(
        order_total(order) for order in orders if order.status == "Shipped"
    )
    fulfillment_balance_due = sum(
        order_total(order) for order in orders if order.status != "Cancelled"
    )
    manufacturing_charges = sum(
        manufacturing_quote_total(order) + float(order.shipping_cost or 0)
        for order in manufacturing_orders
        if order.status not in {"Cancelled", "Rejected"}
    )
    confirmed_manufacturing_payments = sum(
        manufacturing_paid_total(order) for order in manufacturing_orders
    )
    account_net_balance = round(
        manufacturing_charges
        + sum(float(shipment.shipping_cost or 0) for shipment in shipping_requests if shipment.status != "Cancelled")
        + fulfillment_balance_due
        - confirmed_manufacturing_payments,
        2,
    )
    combined_shipping_requests = [
        shipping_request_response(shipment) for shipment in shipping_requests
    ] + [
        manufacturing_shipping_request_response(order)
        for order in manufacturing_orders
        if order.shipping_requested
    ]
    combined_shipping_requests.sort(
        key=lambda shipment: (shipment.get("created_at") or datetime.min, shipment["id"]),
        reverse=True,
    )
    return {
        "stats": {
            "service_takers": len(clients),
            "active_service_takers": sum(1 for client in clients if client.is_active),
            "product_count": len(products),
            "quantity_on_hand": on_hand,
            "reserved_quantity": reserved,
            "available_quantity": max(0, on_hand - reserved),
            "open_inbounds": sum(
                1
                for inbound in inbounds
                if inbound.status in {"Submitted", "Partially received"}
            ),
            "open_orders": sum(
                1 for order in orders if order.status in ACTIVE_ORDER_STATUSES
            ),
            "shipped_order_cost": round(shipped_cost, 2),
            "fulfillment_balance_due": round(fulfillment_balance_due, 2),
            "open_manufacturing": sum(
                1
                for order in manufacturing_orders
                if order.status in ACTIVE_MANUFACTURING_STATUSES
            ),
            "manufacturing_balance_due": round(
                sum(
                    manufacturing_balance_due(order)
                    for order in manufacturing_orders
                    if order.status != "Cancelled"
                ),
                2,
            ),
            "manufacturing_payments_received": round(
                sum(manufacturing_paid_total(order) for order in manufacturing_orders),
                2,
            ),
            "account_balance_due": max(0.0, account_net_balance),
            "advance_credit": max(0.0, round(-account_net_balance, 2)),
        },
        "clients": [client_response(db, client) for client in clients],
        "products": [product_response(product) for product in products],
        "inbounds": [inbound_response(inbound) for inbound in inbounds],
        "orders": [order_response(order) for order in orders],
        "manufacturing_orders": [
            manufacturing_order_response(order) for order in manufacturing_orders
        ],
        "shipping_requests": combined_shipping_requests,
        "ledger": [ledger_response(transaction) for transaction in ledger],
    }

def service_taker_by_id(db: Session, service_taker_id: int) -> ServiceTaker:
    client = (
        db.query(ServiceTaker)
        .filter(ServiceTaker.id == service_taker_id)
        .one_or_none()
    )
    if not client:
        raise HTTPException(status_code=404, detail="Service taker not found.")
    return client


def ensure_username_available(
    db: Session,
    username: str,
    excluded_user_id: int | None = None,
) -> None:
    query = db.query(User).filter(
        func.lower(func.coalesce(User.username, User.name))
        == username.strip().lower()
    )
    if excluded_user_id is not None:
        query = query.filter(User.id != excluded_user_id)
    if query.first():
        raise HTTPException(status_code=400, detail="Username is already in use.")


def auto_service_product_sku(db: Session, client_id: int, seed: str) -> str:
    base = "".join(
        character if character.isalnum() else "-"
        for character in str(seed or "PRODUCT").upper()
    )
    base = "-".join(part for part in base.split("-") if part)[:80] or "PRODUCT"
    candidate = base
    counter = 2
    while (
        db.query(ServiceTakerProduct.id)
        .filter(
            ServiceTakerProduct.service_taker_id == client_id,
            func.lower(ServiceTakerProduct.sku) == candidate.lower(),
        )
        .first()
    ):
        suffix = f"-{counter}"
        candidate = f"{base[:120 - len(suffix)]}{suffix}"
        counter += 1
    return candidate


def create_product_for_client(
    db: Session,
    client: ServiceTaker,
    payload: ServiceTakerProductCreate,
) -> ServiceTakerProduct:
    product_name = payload.name.strip()
    raw_sku = clean_text(payload.sku)
    sku = raw_sku or auto_service_product_sku(db, client.id, product_name)
    if raw_sku and (
        db.query(ServiceTakerProduct.id)
        .filter(
            ServiceTakerProduct.service_taker_id == client.id,
            func.lower(ServiceTakerProduct.sku) == sku.lower(),
        )
        .first()
    ):
        raise HTTPException(
            status_code=400,
            detail="This SKU already exists in this product catalog. Use a different SKU or leave SKU blank for auto numbering.",
        )
    product = ServiceTakerProduct(
        tenant_id=client.tenant_id,
        service_taker_id=client.id,
        sku=sku,
        name=product_name,
        barcode=clean_text(payload.barcode),
        description=clean_text(payload.description),
        unit_weight_kg=float(payload.unit_weight_kg or 0),
        length_cm=payload.length_cm,
        width_cm=payload.width_cm,
        height_cm=payload.height_cm,
        storage_location=clean_text(payload.storage_location),
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product

def create_inbound_for_client(
    db: Session,
    client: ServiceTaker,
    payload: ServiceTakerInboundCreate,
) -> ServiceTakerInbound:
    product_ids = [item.product_id for item in payload.items]
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(
            status_code=400,
            detail="Each SKU can appear only once in an inbound notice.",
        )
    products = (
        db.query(ServiceTakerProduct)
        .filter(
            ServiceTakerProduct.service_taker_id == client.id,
            ServiceTakerProduct.id.in_(product_ids),
            ServiceTakerProduct.is_active == True,
        )
        .all()
    )
    if len(products) != len(product_ids):
        raise HTTPException(
            status_code=400,
            detail="One or more inbound SKUs do not belong to this service taker.",
        )
    inbound = ServiceTakerInbound(
        service_taker_id=client.id,
        inbound_no=next_number(
            db,
            ServiceTakerInbound,
            "inbound_no",
            "ST-IN",
        ),
        client_reference=clean_text(payload.client_reference),
        status="Submitted",
        carrier=clean_text(payload.carrier),
        tracking_number=clean_text(payload.tracking_number),
        expected_at=payload.expected_at,
        notes=clean_text(payload.notes),
    )
    db.add(inbound)
    db.flush()
    for item in payload.items:
        db.add(
            ServiceTakerInboundItem(
                inbound_id=inbound.id,
                product_id=item.product_id,
                expected_quantity=item.quantity,
                received_quantity=0,
            )
        )
    db.commit()
    db.refresh(inbound)
    return inbound


def create_order_for_client(
    db: Session,
    client: ServiceTaker,
    payload: ServiceTakerOrderCreate,
) -> ServiceTakerOrder:
    request_type = (clean_text(payload.shipping_request_type) or "stock").lower()
    if request_type not in {"stock", "manufactured", "external"}:
        raise HTTPException(status_code=400, detail="Choose a valid shipping request type.")

    product_ids = [item.product_id for item in payload.items] if request_type == "stock" else []
    if request_type == "stock" and not product_ids:
        raise HTTPException(status_code=400, detail="Select at least one warehouse SKU to ship.")
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(
            status_code=400,
            detail="Each SKU can appear only once in a shipment request.",
        )

    products = []
    product_by_id = {}
    shortages = []
    total_units = max(1, int(payload.package_quantity or 1))
    product_description = clean_text(payload.product_description)
    manufacturing_order = None

    if request_type == "stock":
        products = (
            db.query(ServiceTakerProduct)
            .filter(
                ServiceTakerProduct.service_taker_id == client.id,
                ServiceTakerProduct.id.in_(product_ids),
                ServiceTakerProduct.is_active == True,
            )
            .all()
        )
        product_by_id = {product.id: product for product in products}
        if len(products) != len(product_ids):
            raise HTTPException(
                status_code=400,
                detail="One or more requested SKUs do not belong to this service taker.",
            )
        for item in payload.items:
            product = product_by_id[item.product_id]
            available = max(
                0,
                int(product.quantity_on_hand or 0)
                - int(product.reserved_quantity or 0),
            )
            if item.quantity > available:
                shortages.append(f"{product.sku}: {available} available")
        if shortages:
            raise HTTPException(
                status_code=409,
                detail="Insufficient service-taker stock. " + "; ".join(shortages),
            )
        total_units = sum(item.quantity for item in payload.items)
    elif request_type == "manufactured":
        if not payload.manufacturing_order_id:
            raise HTTPException(status_code=400, detail="Select a local order ready for shipping.")
        manufacturing_order = (
            db.query(ServiceTakerManufacturingOrder)
            .filter(
                ServiceTakerManufacturingOrder.id == payload.manufacturing_order_id,
                ServiceTakerManufacturingOrder.service_taker_id == client.id,
                ServiceTakerManufacturingOrder.status.in_(("Ready", "Completed")),
            )
            .one_or_none()
        )
        if not manufacturing_order:
            raise HTTPException(
                status_code=400,
                detail="Selected local order is not ready for shipping.",
            )
        total_units = max(1, int(payload.package_quantity or manufacturing_order.quantity or 1))
        product_description = product_description or (
            f"{manufacturing_order.request_no} / {manufacturing_order.product_name}"
        )
    else:
        if not product_description:
            raise HTTPException(
                status_code=400,
                detail="Enter the outside product or parcel details.",
            )

    pick_pack_cost = 0.0
    if request_type == "stock":
        pick_pack_cost = float(client.pick_pack_fee or 0) + max(
            0,
            total_units - 1,
        ) * float(client.additional_item_fee or 0)
    label_cost = (
        float(client.label_fee or 0)
        if payload.label_source == "Hisbenew"
        else 0
    )
    order = ServiceTakerOrder(
        tenant_id=client.tenant_id,
        service_taker_id=client.id,
        request_no=next_number(
            db,
            ServiceTakerOrder,
            "request_no",
            "ST-OUT",
        ),
        client_reference=clean_text(payload.client_reference),
        status=(
            "Awaiting label"
            if payload.label_source == "Client"
            else "Submitted"
        ),
        shipping_request_type=request_type,
        manufacturing_order_id=manufacturing_order.id if manufacturing_order else None,
        product_description=product_description,
        package_quantity=total_units,
        package_weight_kg=payload.package_weight_kg,
        package_length_cm=payload.package_length_cm,
        package_width_cm=payload.package_width_cm,
        package_height_cm=payload.package_height_cm,
        preferred_courier=clean_text(payload.preferred_courier),
        shipping_service=clean_text(payload.shipping_service),
        recipient_name=payload.recipient_name.strip(),
        recipient_company=clean_text(payload.recipient_company),
        recipient_phone=clean_text(payload.recipient_phone),
        recipient_email=clean_text(payload.recipient_email),
        address_line_1=payload.address_line_1.strip(),
        address_line_2=clean_text(payload.address_line_2),
        city=payload.city.strip(),
        state=payload.state.strip(),
        postal_code=payload.postal_code.strip(),
        country=payload.country.strip(),
        label_source=payload.label_source,
        pick_pack_cost=round(pick_pack_cost, 2),
        label_cost=round(label_cost, 2),
        total_cost=round(pick_pack_cost + label_cost, 2),
        notes=clean_text(payload.notes),
    )
    db.add(order)
    db.flush()
    if request_type == "stock":
        for item in payload.items:
            product = product_by_id[item.product_id]
            product.reserved_quantity = int(product.reserved_quantity or 0) + item.quantity
            db.add(
                ServiceTakerOrderItem(
                    order_id=order.id,
                    product_id=item.product_id,
                    quantity=item.quantity,
                )
            )
    db.commit()
    db.refresh(order)
    return order

def create_manufacturing_for_client(
    db: Session,
    client: ServiceTaker,
    payload: ServiceTakerManufacturingRequestCreate,
    user_id: int | None = None,
) -> ServiceTakerManufacturingOrder:
    product = None
    if payload.product_id:
        product = (
            db.query(ServiceTakerProduct)
            .filter(
                ServiceTakerProduct.id == payload.product_id,
                ServiceTakerProduct.service_taker_id == client.id,
                ServiceTakerProduct.is_active == True,
            )
            .one_or_none()
        )
        if not product:
            raise HTTPException(
                status_code=400,
                detail="Choose an active product from this service taker catalog.",
            )
    product_name = product.name if product else clean_text(payload.product_name)
    if not product_name:
        raise HTTPException(
            status_code=400,
            detail="Choose an existing product or add a new product/design name.",
        )
    shipping_address = clean_text(payload.shipping_address) if payload.shipping_requested else None
    shipping_recipient_name = clean_text(payload.shipping_recipient_name) if payload.shipping_requested else None
    if payload.shipping_requested and (not shipping_address or not shipping_recipient_name):
        raise HTTPException(status_code=400, detail="Enter the recipient name and shipping address, or turn off shipping.")
    client_reference = clean_text(payload.client_reference) or (product.sku if product else None)
    order = ServiceTakerManufacturingOrder(
        tenant_id=client.tenant_id,
        service_taker_id=client.id,
        request_no=next_number(
            db,
            ServiceTakerManufacturingOrder,
            "request_no",
            "ST-MFG",
        ),
        client_reference=client_reference,
        status="Quote requested",
        product_id=product.id if product else None,
        product_name=product_name,
        image_url=product.image_url if product else None,
        quantity=payload.quantity,
        shipping_requested=bool(payload.shipping_requested),
        shipping_recipient_name=shipping_recipient_name,
        shipping_address=shipping_address,
        steel_type=clean_text(payload.steel_type),
        tang_type=clean_text(payload.tang_type),
        blade_thickness_mm=payload.blade_thickness_mm,
        blade_length_in=payload.blade_length_in,
        overall_length_in=payload.overall_length_in,
        handle_material=clean_text(payload.handle_material),
        sheath_type=clean_text(payload.sheath_type),
        finish=clean_text(payload.finish),
        hardness=clean_text(payload.hardness),
        edge_type=clean_text(payload.edge_type),
        packaging=clean_text(payload.packaging),
        target_unit_price=payload.target_unit_price,
        requested_ready_at=payload.requested_ready_at,
        notes=clean_text(payload.notes),
    )
    db.add(order)
    db.flush()
    add_manufacturing_update(
        db,
        order,
        order.status,
        "Quote request submitted by service taker.",
        user_id or client.user_id,
    )
    db.commit()
    db.refresh(order)
    return order

def get_admin_manufacturing_order(
    db: Session,
    request_id: int,
) -> ServiceTakerManufacturingOrder:
    order = (
        db.query(ServiceTakerManufacturingOrder)
        .filter(ServiceTakerManufacturingOrder.id == request_id)
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Manufacturing quote not found.")
    return order


def portal_manufacturing_order(
    db: Session,
    client: ServiceTaker,
    request_id: int,
) -> ServiceTakerManufacturingOrder:
    order = (
        db.query(ServiceTakerManufacturingOrder)
        .filter(
            ServiceTakerManufacturingOrder.id == request_id,
            ServiceTakerManufacturingOrder.service_taker_id == client.id,
        )
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Manufacturing quote not found.")
    return order


@router.post("/admin/manufacturing-requests", status_code=201)
def admin_create_manufacturing_request(
    payload: ServiceTakerManufacturingRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    if not payload.service_taker_id:
        raise HTTPException(status_code=400, detail="Select a service taker.")
    client = service_taker_by_id(db, payload.service_taker_id)
    return manufacturing_order_response(
        create_manufacturing_for_client(db, client, payload)
    )


@router.patch("/admin/manufacturing-requests/{request_id}")
def admin_update_manufacturing_request(
    request_id: int,
    payload: ServiceTakerManufacturingAdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    user = require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    if order.status in {"Completed", "Cancelled"} and payload.status not in {"Completed", "Cancelled", None}:
        raise HTTPException(
            status_code=409,
            detail="Completed or cancelled manufacturing orders cannot be reopened here.",
        )

    fields = payload.model_fields_set
    original_status = order.status
    price_changed = False
    if "quoted_unit_price" in fields:
        order.quoted_unit_price = float(payload.quoted_unit_price or 0)
        price_changed = True
    if "other_cost" in fields:
        order.other_cost = float(payload.other_cost or 0)
        price_changed = True
    if "other_cost_label" in fields:
        order.other_cost_label = clean_text(payload.other_cost_label) or None
    if "deposit_required" in fields:
        order.deposit_required = float(payload.deposit_required or 0)
        price_changed = True
    if price_changed:
        refresh_manufacturing_totals(order)
    if "estimated_ready_at" in fields:
        order.estimated_ready_at = payload.estimated_ready_at
    details_changed = False
    for field in (
        "client_reference",
        "steel_type",
        "tang_type",
        "handle_material",
        "sheath_type",
        "finish",
        "hardness",
        "edge_type",
        "packaging",
    ):
        if field in fields:
            setattr(order, field, clean_text(getattr(payload, field)))
            details_changed = True
    for field in (
        "blade_thickness_mm",
        "blade_length_in",
        "overall_length_in",
    ):
        if field in fields:
            setattr(order, field, getattr(payload, field))
            details_changed = True
    if "admin_notes" in fields:
        order.admin_notes = clean_text(payload.admin_notes)
    if "courier" in fields:
        order.courier = clean_text(payload.courier)
        details_changed = True
    if "tracking_number" in fields:
        order.tracking_number = clean_text(payload.tracking_number)
        details_changed = True
    if "shipping_weight_kg" in fields:
        order.shipping_weight_kg = payload.shipping_weight_kg
        details_changed = True
    if "shipping_cost" in fields:
        order.shipping_cost = round(float(payload.shipping_cost or 0), 2)
        details_changed = True
    if payload.status:
        order.status = payload.status
    elif price_changed and manufacturing_quote_total(order) > 0 and order.status == "Quote requested":
        order.status = "Quoted"

    set_manufacturing_status_dates(order, order.status)
    status_changed = order.status != original_status
    message = clean_text(payload.update_message)
    if not message and status_changed:
        message = f"Status changed to {order.status}."
    elif not message and price_changed:
        message = "Quote pricing updated."
    elif not message and details_changed:
        message = "Manufacturing details updated."
    if message:
        add_manufacturing_update(db, order, order.status, message, user.id)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post("/admin/manufacturing-requests/{request_id}/payments", status_code=201)
def admin_record_manufacturing_payment(
    request_id: int,
    payload: ServiceTakerManufacturingPaymentCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    user = require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    if order.status == "Cancelled":
        raise HTTPException(status_code=409, detail="Cannot record payment on a cancelled order.")
    payment = ServiceTakerManufacturingPayment(
        tenant_id=order.tenant_id,
        service_taker_id=order.service_taker_id,
        manufacturing_order_id=order.id,
        amount=round(float(payload.amount or 0), 2),
        payment_type="Payment",
        status="Confirmed",
        method=clean_text(payload.method),
        reference=clean_text(payload.reference),
        note=clean_text(payload.note),
        paid_at=payload.paid_at or datetime.utcnow(),
        confirmed_at=datetime.utcnow(),
        confirmed_by_user_id=user.id,
    )
    db.add(payment)
    db.flush()
    add_manufacturing_update(
        db,
        order,
        order.status,
        f"Payment recorded: {payment.amount:.2f}.",
        user.id,
    )
    paid_total = manufacturing_paid_total(order)
    if order.status in {"Quoted", "Deposit pending"} and paid_total >= float(order.deposit_required or 0):
        order.status = "Confirmed"
        set_manufacturing_status_dates(order, order.status)
        add_manufacturing_update(
            db,
            order,
            order.status,
            "Deposit received. Manufacturing confirmed.",
            user.id,
        )
    elif order.status == "Quoted" and float(order.deposit_required or 0) > paid_total:
        order.status = "Deposit pending"
        set_manufacturing_status_dates(order, order.status)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post("/admin/manufacturing-requests/{request_id}/payments/{payment_id}/confirm")
def admin_confirm_manufacturing_payment(
    request_id: int,
    payment_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    user = require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    payment = (
        db.query(ServiceTakerManufacturingPayment)
        .filter(
            ServiceTakerManufacturingPayment.id == payment_id,
            ServiceTakerManufacturingPayment.manufacturing_order_id == order.id,
        )
        .one_or_none()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Manufacturing payment not found.")
    if manufacturing_payment_status(payment) == "Confirmed":
        return manufacturing_order_response(order)
    if manufacturing_payment_status(payment) == "Rejected":
        raise HTTPException(status_code=409, detail="Rejected payments cannot be confirmed.")
    payment.status = "Confirmed"
    payment.confirmed_at = datetime.utcnow()
    payment.confirmed_by_user_id = user.id
    add_manufacturing_update(
        db,
        order,
        order.status,
        f"Account payment confirmed: {payment.amount:.2f}.",
        user.id,
    )
    if order.status in {"Quoted", "Deposit pending"} and manufacturing_paid_total(order) >= float(order.deposit_required or 0):
        order.status = "Confirmed"
        set_manufacturing_status_dates(order, order.status)
        add_manufacturing_update(
            db,
            order,
            order.status,
            "Deposit confirmed by company. Manufacturing order is live.",
            user.id,
        )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


def release_order_reservations(order: ServiceTakerOrder) -> None:
    for item in order.items:
        product = item.product
        if product:
            product.reserved_quantity = max(
                0,
                int(product.reserved_quantity or 0) - int(item.quantity or 0),
            )


def save_label_file(upload: UploadFile) -> tuple[str, str]:
    safe_name = sanitize_upload_filename(upload.filename or "shipping-label")
    extension = os.path.splitext(safe_name)[1].lower()
    if extension not in LABEL_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Upload a PDF, image, ZPL, ZIP, or BTW shipping-label file.",
        )
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    final_name = f"service-label-{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / final_name
    total_bytes = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_LABEL_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Shipping label files cannot exceed 15 MB.",
                    )
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return f"/static/uploads/{final_name}", safe_name


def save_product_image(upload: UploadFile) -> str:
    safe_name = sanitize_upload_filename(upload.filename or "product-image")
    extension = os.path.splitext(safe_name)[1].lower()
    if extension not in PRODUCT_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Upload a PNG, JPG, JPEG, or WebP product image.",
        )
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    final_name = f"service-product-{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / final_name
    total_bytes = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_PRODUCT_IMAGE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Product images cannot exceed 8 MB.",
                    )
                output.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="The product image is empty.")
        from PIL import Image
        try:
            with Image.open(destination) as image:
                image.verify()
        except Exception as exc:
            raise HTTPException(400, "Invalid or damaged product image.") from exc
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return f"/static/uploads/{final_name}"


def replace_product_image(product: ServiceTakerProduct, upload: UploadFile) -> None:
    old_url = product.image_url
    product.image_url = save_product_image(upload)
    if old_url and old_url.startswith("/static/uploads/service-product-"):
        (UPLOAD_DIR / os.path.basename(old_url)).unlink(missing_ok=True)


def replace_manufacturing_image(order: ServiceTakerManufacturingOrder, upload: UploadFile) -> None:
    old_url = order.image_url
    order.image_url = save_product_image(upload)
    if old_url and old_url.startswith("/static/uploads/service-product-"):
        (UPLOAD_DIR / os.path.basename(old_url)).unlink(missing_ok=True)


def save_payment_proof(upload: UploadFile) -> tuple[str, str]:
    safe_name = sanitize_upload_filename(upload.filename or 'payment-proof')
    extension = os.path.splitext(safe_name)[1].lower()
    if extension not in PAYMENT_PROOF_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail='Upload a PNG, JPG, JPEG, WebP, or PDF payment proof file.',
        )
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    final_name = f'service-payment-proof-{uuid.uuid4().hex}{extension}'
    destination = UPLOAD_DIR / final_name
    total_bytes = 0
    try:
        with destination.open('wb') as output:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_PAYMENT_PROOF_BYTES:
                    raise HTTPException(status_code=400, detail='Payment proof must be 8 MB or smaller.')
                output.write(chunk)
        if extension != '.pdf':
            from PIL import Image
            try:
                with Image.open(destination) as image:
                    image.verify()
            except Exception as exc:
                raise HTTPException(400, "Invalid or damaged payment proof image.") from exc
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return f'/static/uploads/{final_name}', safe_name


def attach_payment_proof(payment: ServiceTakerManufacturingPayment, upload: UploadFile) -> None:
    old_url = payment.proof_url
    proof_url, proof_name = save_payment_proof(upload)
    payment.proof_url = proof_url
    payment.proof_name = proof_name
    payment.proof_uploaded_at = datetime.utcnow()
    if old_url and old_url.startswith('/static/uploads/service-payment-proof-'):
        (UPLOAD_DIR / os.path.basename(old_url)).unlink(missing_ok=True)

@router.get("/admin/dashboard")
def admin_dashboard(request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    clients = db.query(ServiceTaker).order_by(
        ServiceTaker.created_at.desc(),
        ServiceTaker.id.desc(),
    ).all()
    return dashboard_response(db, clients)


@router.post("/admin/clients", status_code=201)
def create_client(
    payload: ServiceTakerCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    if not payload.fulfillment_enabled and not payload.manufacturing_enabled:
        raise HTTPException(status_code=400, detail="Select at least one portal service.")
    username = payload.username.strip()
    ensure_username_available(db, username)
    user = User(
        name=payload.contact_name.strip(),
        username=username,
        pin=hash_pin(payload.pin),
        role="service_taker",
        phone=clean_text(payload.phone),
        email=clean_text(payload.email),
        allowed_pages=json.dumps(
            service_taker_allowed_pages(
                payload.fulfillment_enabled,
                payload.manufacturing_enabled,
            )
        ),
        customer_privacy_settings=json.dumps({}),
        session_expiry_minutes=0,
        is_active=True,
    )
    db.add(user)
    db.flush()
    client = ServiceTaker(
        user_id=user.id,
        company_name=payload.company_name.strip(),
        contact_name=payload.contact_name.strip(),
        email=clean_text(payload.email),
        phone=clean_text(payload.phone),
        billing_address=clean_text(payload.billing_address),
        currency=payload.currency.upper(),
        pick_pack_fee=payload.pick_pack_fee,
        additional_item_fee=payload.additional_item_fee,
        label_fee=payload.label_fee,
        notes=clean_text(payload.notes),
        is_active=True,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return client_response(db, client)


@router.patch("/admin/clients/{client_id}")
def update_client(
    client_id: int,
    payload: ServiceTakerUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    client = service_taker_by_id(db, client_id)
    user = db.query(User).filter(User.id == client.user_id).one()
    fields = payload.model_fields_set
    if "username" in fields and payload.username:
        username = payload.username.strip()
        ensure_username_available(db, username, user.id)
        user.username = username
    if "pin" in fields and payload.pin:
        user.pin = hash_pin(payload.pin)
    if "fulfillment_enabled" in fields or "manufacturing_enabled" in fields:
        current_access = service_taker_service_access(user)
        fulfillment_enabled = (
            payload.fulfillment_enabled
            if "fulfillment_enabled" in fields
            else current_access["fulfillment_enabled"]
        )
        manufacturing_enabled = (
            payload.manufacturing_enabled
            if "manufacturing_enabled" in fields
            else current_access["manufacturing_enabled"]
        )
        if not fulfillment_enabled and not manufacturing_enabled:
            raise HTTPException(status_code=400, detail="Select at least one portal service.")
        user.allowed_pages = json.dumps(
            service_taker_allowed_pages(fulfillment_enabled, manufacturing_enabled)
        )
    for field in (
        "company_name",
        "contact_name",
        "email",
        "phone",
        "billing_address",
        "currency",
        "pick_pack_fee",
        "additional_item_fee",
        "label_fee",
        "notes",
        "is_active",
    ):
        if field not in fields:
            continue
        value = getattr(payload, field)
        if field in {"company_name", "contact_name"} and value:
            value = value.strip()
        elif field == "currency" and value:
            value = value.upper()
        elif field in {"email", "phone", "billing_address", "notes"}:
            value = clean_text(value)
        setattr(client, field, value)
    user.name = client.contact_name
    user.email = client.email
    user.phone = client.phone
    user.is_active = client.is_active
    client.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(client)
    return client_response(db, client)


@router.post("/admin/clients/{client_id}/delete")
@router.delete("/admin/clients/{client_id}")
def delete_client(
    client_id: int,
    request: Request,
    confirmation: str = "",
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    client = service_taker_by_id(db, client_id)
    if confirmation.strip() != client.company_name:
        raise HTTPException(
            status_code=400,
            detail="Type the exact service taker company name to delete this account.",
        )

    linked_user = db.query(User).filter(User.id == client.user_id).one_or_none()
    if linked_user and linked_user.role != "service_taker":
        raise HTTPException(
            status_code=409,
            detail="Linked user is not a service taker account. Delete was stopped for safety.",
        )

    product_ids = [
        row[0]
        for row in db.query(ServiceTakerProduct.id)
        .filter(ServiceTakerProduct.service_taker_id == client.id)
        .all()
    ]
    inbound_ids = [
        row[0]
        for row in db.query(ServiceTakerInbound.id)
        .filter(ServiceTakerInbound.service_taker_id == client.id)
        .all()
    ]
    order_ids = [
        row[0]
        for row in db.query(ServiceTakerOrder.id)
        .filter(ServiceTakerOrder.service_taker_id == client.id)
        .all()
    ]
    manufacturing_ids = [
        row[0]
        for row in db.query(ServiceTakerManufacturingOrder.id)
        .filter(ServiceTakerManufacturingOrder.service_taker_id == client.id)
        .all()
    ]

    if manufacturing_ids:
        db.query(ServiceTakerManufacturingUpdate).filter(
            ServiceTakerManufacturingUpdate.manufacturing_order_id.in_(manufacturing_ids)
        ).delete(synchronize_session=False)
        db.query(ServiceTakerManufacturingPayment).filter(
            ServiceTakerManufacturingPayment.manufacturing_order_id.in_(manufacturing_ids)
        ).delete(synchronize_session=False)
        db.query(ServiceTakerManufacturingOrder).filter(
            ServiceTakerManufacturingOrder.id.in_(manufacturing_ids)
        ).delete(synchronize_session=False)
    if order_ids:
        db.query(ServiceTakerOrderItem).filter(
            ServiceTakerOrderItem.order_id.in_(order_ids)
        ).delete(synchronize_session=False)
        db.query(ServiceTakerOrder).filter(ServiceTakerOrder.id.in_(order_ids)).delete(
            synchronize_session=False
        )
    if inbound_ids:
        db.query(ServiceTakerInboundItem).filter(
            ServiceTakerInboundItem.inbound_id.in_(inbound_ids)
        ).delete(synchronize_session=False)
        db.query(ServiceTakerInbound).filter(ServiceTakerInbound.id.in_(inbound_ids)).delete(
            synchronize_session=False
        )
    db.query(ServiceTakerInventoryTransaction).filter(
        ServiceTakerInventoryTransaction.service_taker_id == client.id
    ).delete(synchronize_session=False)
    if product_ids:
        db.query(ServiceTakerProduct).filter(ServiceTakerProduct.id.in_(product_ids)).delete(
            synchronize_session=False
        )

    if linked_user:
        user_id = linked_user.id
        db.query(ServiceTakerManufacturingUpdate).filter(
            ServiceTakerManufacturingUpdate.created_by_user_id == user_id
        ).update({ServiceTakerManufacturingUpdate.created_by_user_id: None}, synchronize_session=False)
        db.query(ServiceTakerManufacturingPayment).filter(
            ServiceTakerManufacturingPayment.confirmed_by_user_id == user_id
        ).update({ServiceTakerManufacturingPayment.confirmed_by_user_id: None}, synchronize_session=False)
        db.query(WebsiteVisitorMessage).filter(
            WebsiteVisitorMessage.sender_user_id == user_id
        ).update({WebsiteVisitorMessage.sender_user_id: None}, synchronize_session=False)
        db.query(PublicAccessRequest).filter(
            PublicAccessRequest.approved_user_id == user_id
        ).update({PublicAccessRequest.approved_user_id: None}, synchronize_session=False)
        db.query(PublicAccessRequest).filter(
            PublicAccessRequest.reviewed_by_user_id == user_id
        ).update({PublicAccessRequest.reviewed_by_user_id: None}, synchronize_session=False)
        db.query(ActivityLog).filter(ActivityLog.actor_user_id == user_id).delete(
            synchronize_session=False
        )
        db.query(UserRoleRequest).filter(UserRoleRequest.user_id == user_id).delete(
            synchronize_session=False
        )
        db.query(InternalMessage).filter(
            or_(
                InternalMessage.sender_user_id == user_id,
                InternalMessage.recipient_user_id == user_id,
            )
        ).delete(synchronize_session=False)
        db.query(InternalMessageContactRequest).filter(
            or_(
                InternalMessageContactRequest.requester_user_id == user_id,
                InternalMessageContactRequest.recipient_user_id == user_id,
            )
        ).delete(synchronize_session=False)
        call_ids = [
            row[0]
            for row in db.query(InternalCall.id)
            .filter(
                or_(
                    InternalCall.caller_user_id == user_id,
                    InternalCall.recipient_user_id == user_id,
                )
            )
            .all()
        ]
        db.query(InternalCall).filter(InternalCall.ended_by_user_id == user_id).update(
            {InternalCall.ended_by_user_id: None},
            synchronize_session=False,
        )
        if call_ids:
            db.query(InternalCallSignal).filter(
                or_(
                    InternalCallSignal.call_id.in_(call_ids),
                    InternalCallSignal.sender_user_id == user_id,
                )
            ).delete(synchronize_session=False)
            db.query(InternalCall).filter(InternalCall.id.in_(call_ids)).delete(
                synchronize_session=False
            )
        else:
            db.query(InternalCallSignal).filter(
                InternalCallSignal.sender_user_id == user_id
            ).delete(synchronize_session=False)

    db.delete(client)
    if linked_user:
        db.delete(linked_user)
    db.commit()
    return {"status": "deleted", "service_taker_id": client_id}

@router.post("/admin/products", status_code=201)
def admin_create_product(
    payload: ServiceTakerProductCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    if not payload.service_taker_id:
        raise HTTPException(status_code=400, detail="Select a service taker.")
    client = service_taker_by_id(db, payload.service_taker_id)
    return product_response(create_product_for_client(db, client, payload))


@router.patch("/admin/products/{product_id}")
def admin_update_product(
    product_id: int,
    payload: ServiceTakerProductUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    product = db.query(ServiceTakerProduct).filter(
        ServiceTakerProduct.id == product_id
    ).one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Service-taker SKU not found.")
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if field in {"barcode", "description", "storage_location"}:
            value = clean_text(value)
        elif field == "name" and value:
            value = value.strip()
        elif field == "unit_weight_kg" and value is None:
            value = 0
        setattr(product, field, value)
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)
    return product_response(product)


@router.post("/admin/products/{product_id}/image")
def admin_upload_product_image(
    product_id: int,
    request: Request,
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    product = db.query(ServiceTakerProduct).filter(
        ServiceTakerProduct.id == product_id
    ).one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Service-taker SKU not found.")
    replace_product_image(product, image_file)
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)
    return product_response(product)


@router.post("/admin/inbounds", status_code=201)
def admin_create_inbound(
    payload: ServiceTakerInboundCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    if not payload.service_taker_id:
        raise HTTPException(status_code=400, detail="Select a service taker.")
    client = service_taker_by_id(db, payload.service_taker_id)
    return inbound_response(create_inbound_for_client(db, client, payload))


@router.post("/admin/inbounds/{inbound_id}/receive")
def receive_inbound(
    inbound_id: int,
    payload: ServiceTakerInboundReceive,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    inbound = db.query(ServiceTakerInbound).filter(
        ServiceTakerInbound.id == inbound_id
    ).one_or_none()
    if not inbound:
        raise HTTPException(status_code=404, detail="Inbound notice not found.")
    if inbound.status in {"Received", "Cancelled"}:
        raise HTTPException(
            status_code=409,
            detail="This inbound notice can no longer be received.",
        )
    receive_by_product = {item.product_id: item.quantity for item in payload.items}
    if len(receive_by_product) != len(payload.items):
        raise HTTPException(status_code=400, detail="Duplicate receiving SKU.")
    if any(
        product_id not in {item.product_id for item in inbound.items}
        for product_id in receive_by_product
    ):
        raise HTTPException(
            status_code=400,
            detail="A receiving SKU is not part of this inbound notice.",
        )

    received_any = False
    for item in inbound.items:
        remaining = max(
            0,
            int(item.expected_quantity or 0) - int(item.received_quantity or 0),
        )
        quantity = (
            receive_by_product.get(item.product_id, 0)
            if payload.items
            else remaining
        )
        if quantity < 0 or quantity > remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Received quantity for {item.product.sku} exceeds the remaining {remaining}.",
            )
        if quantity == 0:
            continue
        item.received_quantity = int(item.received_quantity or 0) + quantity
        item.product.quantity_on_hand = int(item.product.quantity_on_hand or 0) + quantity
        item.product.updated_at = datetime.utcnow()
        db.add(
            ServiceTakerInventoryTransaction(
                service_taker_id=inbound.service_taker_id,
                product_id=item.product_id,
                movement_type="Inbound receipt",
                quantity_change=quantity,
                balance_after=item.product.quantity_on_hand,
                reference_type="inbound",
                reference_id=inbound.id,
                reference_no=inbound.inbound_no,
                note=clean_text(payload.notes) or f"Received {inbound.inbound_no}",
            )
        )
        received_any = True
    if not received_any:
        raise HTTPException(status_code=400, detail="Enter a quantity to receive.")
    fully_received = all(
        int(item.received_quantity or 0) >= int(item.expected_quantity or 0)
        for item in inbound.items
    )
    inbound.status = "Received" if fully_received else "Partially received"
    inbound.received_at = datetime.utcnow() if fully_received else None
    if payload.notes:
        inbound.notes = clean_text(payload.notes)
    inbound.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inbound)
    return inbound_response(inbound)


@router.post("/admin/orders", status_code=201)
def admin_create_order(
    payload: ServiceTakerOrderCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    if not payload.service_taker_id:
        raise HTTPException(status_code=400, detail="Select a service taker.")
    client = service_taker_by_id(db, payload.service_taker_id)
    return order_response(create_order_for_client(db, client, payload))


def get_admin_order(db: Session, order_id: int) -> ServiceTakerOrder:
    order = db.query(ServiceTakerOrder).filter(
        ServiceTakerOrder.id == order_id
    ).one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Shipment request not found.")
    return order


@router.patch("/admin/orders/{order_id}")
def update_order(
    order_id: int,
    payload: ServiceTakerOrderAdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    order = get_admin_order(db, order_id)
    if order.status in {"Shipped", "Cancelled"}:
        raise HTTPException(
            status_code=409,
            detail="A shipped or cancelled request cannot be changed.",
        )
    if payload.status == "Shipped":
        raise HTTPException(
            status_code=400,
            detail="Use the Ship action to deduct inventory.",
        )
    if payload.status == "Cancelled":
        release_order_reservations(order)
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if field in {
            "courier",
            "shipping_service",
            "tracking_number",
            "notes",
        }:
            value = clean_text(value)
        setattr(order, field, value)
    if order.status == "Cancelled":
        clear_order_costs(order)
    else:
        order.total_cost = order_total(order)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order_response(order)


@router.post("/admin/orders/{order_id}/label")
def admin_upload_label(
    order_id: int,
    request: Request,
    label_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    order = get_admin_order(db, order_id)
    if order.status in {"Shipped", "Cancelled"}:
        raise HTTPException(status_code=409, detail="This request is closed.")
    order.label_url, order.label_name = save_label_file(label_file)
    if order.status == "Awaiting label":
        order.status = "Submitted"
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order_response(order)


@router.post("/admin/orders/{order_id}/cancel")
def admin_cancel_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    order = get_admin_order(db, order_id)
    if order.status == "Shipped":
        raise HTTPException(status_code=409, detail="A shipped request cannot be cancelled.")
    if order.status == "Cancelled":
        return order_response(order)
    release_order_reservations(order)
    order.status = "Cancelled"
    clear_order_costs(order)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order_response(order)

@router.post("/admin/orders/{order_id}/ship")
def ship_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    order = get_admin_order(db, order_id)
    if order.status == "Shipped":
        return order_response(order)
    if order.status == "Cancelled":
        raise HTTPException(status_code=409, detail="This request was cancelled.")
    if not order.label_url:
        raise HTTPException(
            status_code=409,
            detail="Upload or generate the shipping label before shipping.",
        )
    for item in order.items:
        product = item.product
        quantity = int(item.quantity or 0)
        if int(product.quantity_on_hand or 0) < quantity:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock for {product.sku}.",
            )
    for item in order.items:
        product = item.product
        quantity = int(item.quantity or 0)
        product.quantity_on_hand = int(product.quantity_on_hand or 0) - quantity
        product.reserved_quantity = max(
            0,
            int(product.reserved_quantity or 0) - quantity,
        )
        product.updated_at = datetime.utcnow()
        db.add(
            ServiceTakerInventoryTransaction(
                service_taker_id=order.service_taker_id,
                product_id=product.id,
                movement_type="Outbound shipment",
                quantity_change=-quantity,
                balance_after=product.quantity_on_hand,
                reference_type="order",
                reference_id=order.id,
                reference_no=order.request_no,
                note=f"Shipped to {order.recipient_name}",
            )
        )
    order.status = "Shipped"
    order.shipped_at = datetime.utcnow()
    order.total_cost = order_total(order)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order_response(order)


@router.get("/portal/dashboard")
def portal_dashboard(request: Request, db: Session = Depends(get_db)):
    client = portal_service_taker(request, db)
    response = dashboard_response(db, [client])
    response["client"] = client_response(db, client)
    return response


@router.post("/portal/products", status_code=201)
def portal_create_product(
    payload: ServiceTakerProductCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    return product_response(create_product_for_client(db, client, payload))


@router.patch("/portal/products/{product_id}")
def portal_update_product(
    product_id: int,
    payload: ServiceTakerProductUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    product = (
        db.query(ServiceTakerProduct)
        .filter(
            ServiceTakerProduct.id == product_id,
            ServiceTakerProduct.service_taker_id == client.id,
        )
        .one_or_none()
    )
    if not product:
        raise HTTPException(status_code=404, detail="SKU not found.")
    allowed_fields = {
        "name",
        "barcode",
        "description",
        "unit_weight_kg",
        "length_cm",
        "width_cm",
        "height_cm",
        "is_active",
    }
    for field in payload.model_fields_set & allowed_fields:
        value = getattr(payload, field)
        if field in {"barcode", "description"}:
            value = clean_text(value)
        elif field == "name" and value:
            value = value.strip()
        elif field == "unit_weight_kg" and value is None:
            value = 0
        setattr(product, field, value)
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)
    return product_response(product)


@router.post("/portal/products/{product_id}/image")
def portal_upload_product_image(
    product_id: int,
    request: Request,
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    product = (
        db.query(ServiceTakerProduct)
        .filter(
            ServiceTakerProduct.id == product_id,
            ServiceTakerProduct.service_taker_id == client.id,
        )
        .one_or_none()
    )
    if not product:
        raise HTTPException(status_code=404, detail="SKU not found.")
    replace_product_image(product, image_file)
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)
    return product_response(product)


@router.post("/portal/inbounds", status_code=201)
def portal_create_inbound(
    payload: ServiceTakerInboundCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    return inbound_response(create_inbound_for_client(db, client, payload))


@router.post("/portal/inbounds/{inbound_id}/cancel")
def portal_cancel_inbound(
    inbound_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    inbound = (
        db.query(ServiceTakerInbound)
        .filter(
            ServiceTakerInbound.id == inbound_id,
            ServiceTakerInbound.service_taker_id == client.id,
        )
        .one_or_none()
    )
    if not inbound:
        raise HTTPException(status_code=404, detail="Inbound notice not found.")
    if inbound.status != "Submitted":
        raise HTTPException(
            status_code=409,
            detail="Only an unreceived inbound notice can be cancelled.",
        )
    inbound.status = "Cancelled"
    inbound.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inbound)
    return inbound_response(inbound)




@router.post("/portal/manufacturing-requests", status_code=201)
def portal_create_manufacturing_request(
    payload: ServiceTakerManufacturingRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    return manufacturing_order_response(
        create_manufacturing_for_client(db, client, payload, getattr(request.state, "user_id", None))
    )


@router.post("/portal/manufacturing-requests/{request_id}/confirm")
def portal_confirm_manufacturing_request(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status in {"Cancelled", "Rejected"}:
        raise HTTPException(status_code=409, detail="This quote request is no longer active.")
    if order.status in {"Confirmed", "In production", "Quality check", "Ready", "Completed"}:
        return manufacturing_order_response(order)
    if manufacturing_quote_total(order) <= 0:
        raise HTTPException(
            status_code=409,
            detail="Hisbenew must send a quote before you can confirm manufacturing.",
        )
    paid_total = manufacturing_paid_total(order)
    order.status = (
        "Confirmed"
        if paid_total >= float(order.deposit_required or 0)
        else "Deposit pending"
    )
    set_manufacturing_status_dates(order, order.status)
    add_manufacturing_update(
        db,
        order,
        order.status,
        "Quote confirmed by service taker.",
        getattr(request.state, "user_id", None),
    )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post("/portal/manufacturing-requests/{request_id}/reject")
def portal_reject_manufacturing_request(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status in {"Confirmed", "In production", "Quality check", "Ready", "Completed"}:
        raise HTTPException(status_code=409, detail="Live manufacturing orders cannot be rejected.")
    if order.status in {"Cancelled", "Rejected"}:
        return manufacturing_order_response(order)
    order.status = "Rejected"
    order.last_update = "Quote rejected by service taker."
    add_manufacturing_update(
        db,
        order,
        order.status,
        "Quote rejected by service taker.",
        getattr(request.state, "user_id", None),
    )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)

@router.post("/admin/manufacturing-requests/{request_id}/image")
def admin_upload_manufacturing_image(
    request_id: int,
    request: Request,
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    replace_manufacturing_image(order, image_file)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post("/portal/manufacturing-requests/{request_id}/image")
def portal_upload_manufacturing_image(
    request_id: int,
    request: Request,
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status not in {"Quote requested", "Quoted"}:
        raise HTTPException(status_code=409, detail="Images can only be changed before deposit confirmation.")
    replace_manufacturing_image(order, image_file)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post('/portal/manufacturing-requests/{request_id}/deposit')
def portal_request_manufacturing_deposit(
    request_id: int,
    request: Request,
    amount: float | None = Form(None),
    proof_file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status in {'Cancelled', 'Rejected'}:
        raise HTTPException(status_code=409, detail='This quote request is no longer active.')
    if order.status in {'Confirmed', 'In production', 'Quality check', 'Ready', 'Completed'}:
        return manufacturing_order_response(order)
    if manufacturing_quote_total(order) <= 0:
        raise HTTPException(
            status_code=409,
            detail='Hisbenew must send a quote before deposit can be marked.',
        )
    existing_pending = next(
        (
            payment
            for payment in order.payments
            if manufacturing_payment_status(payment) == 'Pending confirmation'
            and (payment.payment_type or 'Deposit') == 'Deposit'
        ),
        None,
    )
    if not existing_pending:
        deposit_due = manufacturing_deposit_balance(order)
        deposit_amount = round(float(amount if amount is not None else deposit_due), 2)
        if deposit_amount <= 0:
            if deposit_due <= 0:
                order.status = 'Confirmed'
                set_manufacturing_status_dates(order, order.status)
                add_manufacturing_update(
                    db,
                    order,
                    order.status,
                    'Client proceeded to order. No deposit balance was required.',
                    getattr(request.state, 'user_id', None),
                )
            else:
                raise HTTPException(status_code=400, detail='Deposit amount must be greater than zero.')
        else:
            payment = ServiceTakerManufacturingPayment(
                tenant_id=order.tenant_id,
                service_taker_id=order.service_taker_id,
                manufacturing_order_id=order.id,
                amount=deposit_amount,
                payment_type='Deposit',
                status='Pending confirmation',
                method='Client portal',
                note=f'Client clicked Proceed to order and marked deposit {deposit_amount:.2f} for company confirmation.',
                paid_at=datetime.utcnow(),
            )
            if proof_file:
                attach_payment_proof(payment, proof_file)
            db.add(payment)
            db.flush()
            order.status = 'Deposit pending'
            update_message = 'Deposit proof uploaded by client and waiting for company confirmation.' if proof_file else 'Deposit marked by client and waiting for company confirmation.'
            add_manufacturing_update(
                db,
                order,
                order.status,
                update_message,
                getattr(request.state, 'user_id', None),
            )
    else:
        if proof_file:
            attach_payment_proof(existing_pending, proof_file)
            add_manufacturing_update(
                db,
                order,
                order.status,
                'Deposit proof updated by client.',
                getattr(request.state, 'user_id', None),
            )
        order.status = 'Deposit pending'
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)

@router.post("/portal/manufacturing-requests/{request_id}/balance")
def portal_request_manufacturing_balance_payment(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status in {"Cancelled", "Rejected"}:
        raise HTTPException(status_code=409, detail="This quote request is no longer active.")
    if order.status not in {"Ready", "Completed"}:
        raise HTTPException(status_code=409, detail="Final payment becomes available when the order is ready.")
    balance_due = manufacturing_balance_due(order)
    if balance_due <= 0:
        return manufacturing_order_response(order)
    existing_pending = next(
        (
            payment
            for payment in order.payments
            if manufacturing_payment_status(payment) == "Pending confirmation"
            and (payment.payment_type or "Balance") == "Balance"
        ),
        None,
    )
    if not existing_pending:
        payment = ServiceTakerManufacturingPayment(
            tenant_id=order.tenant_id,
            service_taker_id=order.service_taker_id,
            manufacturing_order_id=order.id,
            amount=balance_due,
            payment_type="Balance",
            status="Pending confirmation",
            method="Client portal",
            note="Client marked final balance for company confirmation.",
            paid_at=datetime.utcnow(),
        )
        db.add(payment)
        add_manufacturing_update(
            db,
            order,
            order.status,
            "Client marked final balance payment for company confirmation.",
            getattr(request.state, "user_id", None),
        )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post('/portal/payments', status_code=201)
@router.post('/portal/local-orders/payments', status_code=201)
def portal_create_general_payment(
    request: Request,
    amount: float = Form(...),
    payment_type: str = Form("Payment"),
    note: str | None = Form(None),
    manufacturing_order_id: int | None = Form(None),
    proof_file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    payment_amount = round(float(amount or 0), 2)
    if payment_amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
    
    order = None
    if manufacturing_order_id:
        order = db.query(ServiceTakerManufacturingOrder).filter(
            ServiceTakerManufacturingOrder.id == manufacturing_order_id,
            ServiceTakerManufacturingOrder.service_taker_id == client.id,
        ).one_or_none()
    
    if not order:
        # Find oldest active order with balance due
        orders_with_due = [
            o for o in db.query(ServiceTakerManufacturingOrder)
            .filter(
                ServiceTakerManufacturingOrder.service_taker_id == client.id,
                ServiceTakerManufacturingOrder.status.notin_(["Cancelled", "Rejected"]),
            )
            .order_by(ServiceTakerManufacturingOrder.created_at.asc())
            .all()
            if manufacturing_balance_due(o) > 0
        ]
        if orders_with_due:
            order = orders_with_due[0]
        else:
            order = (
                db.query(ServiceTakerManufacturingOrder)
                .filter(
                    ServiceTakerManufacturingOrder.service_taker_id == client.id,
                    ServiceTakerManufacturingOrder.status.notin_(["Cancelled", "Rejected"]),
                )
                .order_by(ServiceTakerManufacturingOrder.created_at.desc())
                .first()
            )
    
    if not order:
        order = (
            db.query(ServiceTakerManufacturingOrder)
            .filter(ServiceTakerManufacturingOrder.service_taker_id == client.id)
            .order_by(ServiceTakerManufacturingOrder.created_at.desc())
            .first()
        )

    if not order:
        raise HTTPException(status_code=400, detail="Please submit a quote request first before recording payment.")

    # Portal receipts are account payments. Apply them against the customer's
    # aggregate balance and keep any approved excess as account credit.
    cleaned_payment_type = "Payment"
    payment = ServiceTakerManufacturingPayment(
        tenant_id=order.tenant_id,
        service_taker_id=client.id,
        manufacturing_order_id=order.id,
        amount=payment_amount,
        payment_type=cleaned_payment_type,
        status="Pending confirmation",
        method="Client portal",
        note=clean_text(note) or "Client uploaded an account payment receipt from the portal.",
        paid_at=datetime.utcnow(),
    )
    if proof_file:
        attach_payment_proof(payment, proof_file)
    db.add(payment)
    db.flush()
    if order.status in {"Quoted", "Deposit pending"}:
        order.status = "Deposit pending"
        set_manufacturing_status_dates(order, order.status)
    add_manufacturing_update(
        db,
        order,
        order.status,
        f"Account payment {payment_amount:.2f} submitted by client for company confirmation.",
        getattr(request.state, 'user_id', None),
    )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(payment)
    return manufacturing_payment_response(payment)

@router.post('/portal/manufacturing-requests/{request_id}/payments', status_code=201)
def portal_create_manufacturing_payment_request(
    request_id: int,
    request: Request,
    amount: float = Form(...),
    payment_type: str = Form("Deposit"),
    note: str | None = Form(None),
    proof_file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status in {"Cancelled", "Rejected"}:
        raise HTTPException(status_code=409, detail="This local order is closed.")
    if manufacturing_quote_total(order) <= 0:
        raise HTTPException(status_code=409, detail="Hisbenew must send a quote before payment can be submitted.")
    payment_amount = round(float(amount or 0), 2)
    if payment_amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
    cleaned_payment_type = clean_text(payment_type) or "Deposit"
    payment = ServiceTakerManufacturingPayment(
        tenant_id=order.tenant_id,
        service_taker_id=order.service_taker_id,
        manufacturing_order_id=order.id,
        amount=payment_amount,
        payment_type=cleaned_payment_type,
        status="Pending confirmation",
        method="Client portal",
        note=clean_text(note) or f"Client uploaded {cleaned_payment_type.lower()} payment screenshot from portal.",
        paid_at=datetime.utcnow(),
    )
    if proof_file:
        attach_payment_proof(payment, proof_file)
    db.add(payment)
    db.flush()
    if cleaned_payment_type.lower() == "deposit" and order.status in {"Quoted", "Deposit pending"}:
        order.status = "Deposit pending"
        set_manufacturing_status_dates(order, order.status)
    add_manufacturing_update(
        db,
        order,
        order.status,
        f"{cleaned_payment_type} payment {payment_amount:.2f} submitted by client for company confirmation.",
        getattr(request.state, 'user_id', None),
    )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)

@router.post('/portal/manufacturing-requests/{request_id}/payments/{payment_id}/proof')
def portal_upload_manufacturing_payment_proof(
    request_id: int,
    payment_id: int,
    request: Request,
    proof_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    payment = (
        db.query(ServiceTakerManufacturingPayment)
        .filter(
            ServiceTakerManufacturingPayment.id == payment_id,
            ServiceTakerManufacturingPayment.manufacturing_order_id == order.id,
            ServiceTakerManufacturingPayment.service_taker_id == client.id,
        )
        .one_or_none()
    )
    if not payment:
        raise HTTPException(status_code=404, detail='Manufacturing payment not found.')
    if manufacturing_payment_status(payment) != 'Pending confirmation':
        raise HTTPException(status_code=409, detail='Proof can only be updated before company confirmation.')
    attach_payment_proof(payment, proof_file)
    add_manufacturing_update(
        db,
        order,
        order.status,
        f'{payment.payment_type} proof updated by client.',
        getattr(request.state, 'user_id', None),
    )
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)

@router.post("/admin/local-orders", status_code=201)
def admin_create_local_order_request(
    payload: ServiceTakerManufacturingRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    return admin_create_manufacturing_request(payload, request, db)


@router.patch("/admin/local-orders/{request_id}")
def admin_update_local_order_request(
    request_id: int,
    payload: ServiceTakerManufacturingAdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    return admin_update_manufacturing_request(request_id, payload, request, db)


@router.delete("/admin/local-orders/{request_id}")
def admin_delete_local_order(request_id: int, request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    # Fulfillment has its own inventory and accounting lifecycle. Detach its
    # optional source reference before removing the manufacturing record.
    db.query(ServiceTakerOrder).filter(
        ServiceTakerOrder.manufacturing_order_id == order.id
    ).update({ServiceTakerOrder.manufacturing_order_id: None}, synchronize_session="fetch")
    # Payments and updates cascade with the order. Dashboard balances are
    # calculated from surviving orders/payments, reversing both charge and credit.
    db.delete(order)
    db.commit()
    return {"deleted": True, "id": request_id}


@router.delete("/admin/local-orders/{request_id}/shipping")
def admin_delete_manufacturing_shipping(request_id: int, request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    if not order.shipping_requested:
        raise HTTPException(status_code=404, detail="Shipping request not found.")
    order.shipping_requested = False
    order.shipping_status = "Submitted"
    order.shipping_recipient_name = None
    order.shipping_address = None
    order.shipping_weight_kg = None
    order.shipping_cost = 0
    order.courier = None
    order.tracking_number = None
    order.updated_at = datetime.utcnow()
    db.commit()
    return {"deleted": True, "id": request_id}


@router.delete("/admin/shipping-requests/{request_id}")
def admin_delete_shipping_request(request_id: int, request: Request, db: Session = Depends(get_db)):
    require_admin(request, db)
    shipment = db.query(ServiceTakerShippingRequest).filter(ServiceTakerShippingRequest.id == request_id).one_or_none()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipping request not found.")
    db.delete(shipment)
    db.commit()
    return {"deleted": True, "id": request_id}


@router.post("/admin/local-orders/{request_id}/payments", status_code=201)
def admin_record_local_order_payment(
    request_id: int,
    payload: ServiceTakerManufacturingPaymentCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    return admin_record_manufacturing_payment(request_id, payload, request, db)


@router.post("/admin/local-orders/{request_id}/payments/{payment_id}/confirm")
def admin_confirm_local_order_payment(
    request_id: int,
    payment_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    return admin_confirm_manufacturing_payment(request_id, payment_id, request, db)


@router.post("/admin/local-orders/{request_id}/image")
def admin_upload_local_order_image(
    request_id: int,
    request: Request,
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    return admin_upload_manufacturing_image(request_id, request, image_file, db)


@router.post("/portal/local-orders", status_code=201)
def portal_create_local_order_request(
    payload: ServiceTakerManufacturingRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    return portal_create_manufacturing_request(payload, request, db)


@router.post("/portal/shipping-requests", status_code=201)
def portal_create_shipping_request(
    payload: ServiceTakerShippingRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    client_user = db.query(User).filter(User.id == client.user_id).one_or_none()
    if not service_taker_service_access(client_user)["manufacturing_enabled"]:
        raise HTTPException(status_code=403, detail="Shipping requests are not enabled for this account.")
    shipment = ServiceTakerShippingRequest(
        tenant_id=client.tenant_id,
        service_taker_id=client.id,
        request_no=f"ST-SHP-{uuid.uuid4().hex[:8].upper()}",
        recipient_name=clean_text(payload.recipient_name),
        shipping_address=clean_text(payload.shipping_address),
        item_description=clean_text(payload.item_description),
        quantity=payload.quantity,
        notes=clean_text(payload.notes) or None,
    )
    db.add(shipment)
    db.commit()
    db.refresh(shipment)
    return shipping_request_response(shipment)


@router.patch("/admin/shipping-requests/{request_id}")
def admin_update_shipping_request(
    request_id: int,
    payload: ServiceTakerShippingRequestAdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    shipment = db.query(ServiceTakerShippingRequest).filter(ServiceTakerShippingRequest.id == request_id).one_or_none()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipping request not found.")
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if field in {"courier", "tracking_number"}:
            value = clean_text(value) or None
        elif field == "shipping_cost":
            value = round(float(value or 0), 2)
        setattr(shipment, field, value)
    shipment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(shipment)
    return shipping_request_response(shipment)


@router.patch("/admin/local-orders/{request_id}/shipping")
def admin_update_manufacturing_shipping(
    request_id: int,
    payload: ServiceTakerManufacturingShippingAdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_admin(request, db)
    order = get_admin_manufacturing_order(db, request_id)
    if not order.shipping_requested:
        raise HTTPException(status_code=404, detail="This manufacturing request has no shipping request.")
    if order.status in {"Cancelled", "Rejected"} and payload.status not in {None, "Cancelled"}:
        raise HTTPException(status_code=409, detail="Shipping cannot be dispatched for a cancelled manufacturing request.")
    if "status" in payload.model_fields_set:
        order.shipping_status = payload.status or "Submitted"
    if "shipping_weight_kg" in payload.model_fields_set:
        order.shipping_weight_kg = payload.shipping_weight_kg
    if "shipping_cost" in payload.model_fields_set:
        order.shipping_cost = round(float(payload.shipping_cost or 0), 2)
    if "courier" in payload.model_fields_set:
        order.courier = clean_text(payload.courier)
    if "tracking_number" in payload.model_fields_set:
        order.tracking_number = clean_text(payload.tracking_number)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return manufacturing_shipping_request_response(order)


@router.patch("/portal/local-orders/{request_id}/shipping")
def portal_request_local_order_shipping(
    request_id: int,
    payload: ServiceTakerManufacturingShippingRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_manufacturing_order(db, client, request_id)
    if order.status in {"Cancelled", "Rejected", "Shipped"}:
        raise HTTPException(status_code=409, detail="Shipping details cannot be changed for this order.")
    order.shipping_requested = True
    order.shipping_recipient_name = clean_text(payload.recipient_name)
    order.shipping_address = clean_text(payload.shipping_address)
    order.updated_at = datetime.utcnow()
    add_manufacturing_update(
        db,
        order,
        order.status,
        "Manufacturing shipping requested with delivery recipient and address.",
        getattr(request.state, "user_id", None),
    )
    db.commit()
    db.refresh(order)
    return manufacturing_order_response(order)


@router.post("/portal/local-orders/{request_id}/image")
def portal_upload_local_order_image(
    request_id: int,
    request: Request,
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    return portal_upload_manufacturing_image(request_id, request, image_file, db)


@router.post("/portal/local-orders/{request_id}/reject")
def portal_reject_local_order_request(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    return portal_reject_manufacturing_request(request_id, request, db)

@router.post("/portal/local-orders/{request_id}/balance")
def portal_request_local_order_balance_payment(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    return portal_request_manufacturing_balance_payment(request_id, request, db)

@router.post('/portal/local-orders/{request_id}/payments', status_code=201)
def portal_create_local_order_payment_request(
    request_id: int,
    request: Request,
    amount: float = Form(...),
    payment_type: str = Form("Deposit"),
    note: str | None = Form(None),
    proof_file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    return portal_create_manufacturing_payment_request(request_id, request, amount, payment_type, note, proof_file, db)

@router.post('/portal/local-orders/{request_id}/payments/{payment_id}/proof')
def portal_upload_local_order_payment_proof(
    request_id: int,
    payment_id: int,
    request: Request,
    proof_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    return portal_upload_manufacturing_payment_proof(request_id, payment_id, request, proof_file, db)


@router.post('/portal/local-orders/{request_id}/deposit')
def portal_request_local_order_deposit(
    request_id: int,
    request: Request,
    amount: float | None = Form(None),
    proof_file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    return portal_request_manufacturing_deposit(request_id, request, amount, proof_file, db)


@router.post("/portal/orders", status_code=201)
def portal_create_order(
    payload: ServiceTakerOrderCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    return order_response(create_order_for_client(db, client, payload))


def portal_order(
    db: Session,
    client: ServiceTaker,
    order_id: int,
) -> ServiceTakerOrder:
    order = (
        db.query(ServiceTakerOrder)
        .filter(
            ServiceTakerOrder.id == order_id,
            ServiceTakerOrder.service_taker_id == client.id,
        )
        .one_or_none()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Shipment request not found.")
    return order


@router.post("/portal/orders/{order_id}/label")
def portal_upload_label(
    order_id: int,
    request: Request,
    label_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_order(db, client, order_id)
    if order.label_source != "Client":
        raise HTTPException(
            status_code=409,
            detail="Hisbenew is responsible for this request's label.",
        )
    if order.status in {"Shipped", "Cancelled"}:
        raise HTTPException(status_code=409, detail="This request is closed.")
    order.label_url, order.label_name = save_label_file(label_file)
    if order.status == "Awaiting label":
        order.status = "Submitted"
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order_response(order)


@router.post("/portal/orders/{order_id}/cancel")
def portal_cancel_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    client = portal_service_taker(request, db)
    order = portal_order(db, client, order_id)
    if order.status not in {"Submitted", "Awaiting label"}:
        raise HTTPException(
            status_code=409,
            detail="This request is already being processed and cannot be cancelled.",
        )
    release_order_reservations(order)
    order.status = "Cancelled"
    clear_order_costs(order)
    order.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order_response(order)



