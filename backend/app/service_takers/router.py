import json
import os
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import UPLOAD_DIR
from ..database import SessionLocal
from ..models import User
from ..security import hash_pin, sanitize_upload_filename
from .models import (
    ServiceTaker,
    ServiceTakerInbound,
    ServiceTakerInboundItem,
    ServiceTakerInventoryTransaction,
    ServiceTakerOrder,
    ServiceTakerOrderItem,
    ServiceTakerProduct,
)
from .schemas import (
    ServiceTakerCreate,
    ServiceTakerInboundCreate,
    ServiceTakerInboundReceive,
    ServiceTakerOrderAdminUpdate,
    ServiceTakerOrderCreate,
    ServiceTakerProductCreate,
    ServiceTakerProductUpdate,
    ServiceTakerUpdate,
)

router = APIRouter(prefix="/service-takers", tags=["Service takers"])

LABEL_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".zpl", ".zip", ".btw"}
MAX_LABEL_BYTES = 15 * 1024 * 1024
PRODUCT_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024
ACTIVE_ORDER_STATUSES = ("Submitted", "Awaiting label", "Processing", "Ready")


def get_db():
    db = SessionLocal()
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


def next_number(db: Session, model, field_name: str, prefix: str) -> str:
    next_id = int(db.query(func.max(model.id)).scalar() or 0) + 1
    field = getattr(model, field_name)
    while True:
        value = f"{prefix}-{next_id:05d}"
        if not db.query(model.id).filter(field == value).first():
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
    return {
        "id": order.id,
        "service_taker_id": order.service_taker_id,
        "company_name": (
            order.service_taker.company_name if order.service_taker else None
        ),
        "request_no": order.request_no,
        "client_reference": order.client_reference,
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
        "item_quantity": sum(int(item.quantity or 0) for item in order.items),
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
            },
            "clients": [],
            "products": [],
            "inbounds": [],
            "orders": [],
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
        },
        "clients": [client_response(db, client) for client in clients],
        "products": [product_response(product) for product in products],
        "inbounds": [inbound_response(inbound) for inbound in inbounds],
        "orders": [order_response(order) for order in orders],
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


def create_product_for_client(
    db: Session,
    client: ServiceTaker,
    payload: ServiceTakerProductCreate,
) -> ServiceTakerProduct:
    sku = payload.sku.strip()
    if (
        db.query(ServiceTakerProduct.id)
        .filter(
            ServiceTakerProduct.service_taker_id == client.id,
            func.lower(ServiceTakerProduct.sku) == sku.lower(),
        )
        .first()
    ):
        raise HTTPException(
            status_code=400,
            detail="This SKU already exists in the service taker's catalog.",
        )
    product = ServiceTakerProduct(
        service_taker_id=client.id,
        sku=sku,
        name=payload.name.strip(),
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
    product_ids = [item.product_id for item in payload.items]
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(
            status_code=400,
            detail="Each SKU can appear only once in a shipment request.",
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
    product_by_id = {product.id: product for product in products}
    if len(products) != len(product_ids):
        raise HTTPException(
            status_code=400,
            detail="One or more requested SKUs do not belong to this service taker.",
        )
    shortages = []
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
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return f"/static/uploads/{final_name}"


def replace_product_image(product: ServiceTakerProduct, upload: UploadFile) -> None:
    old_url = product.image_url
    product.image_url = save_product_image(upload)
    if old_url and old_url.startswith("/static/uploads/service-product-"):
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
            [
                "Service Dashboard",
                "Service Products",
                "Service Inbound",
                "Service Shipments",
                "Service Charges",
            ]
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
