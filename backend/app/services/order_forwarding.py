"""Explicit bridges between tenants. Bridge tables always require participant filters.

The task belongs to the receiving worker's tenant. The order, shipping and stock
remain in the sending tenant; no general tenant visibility is granted.
"""
import hashlib
import json
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from ..models import (ForwardedOrderTask, Order, OrderWorkflowTask, Tenant, User,
                      Worker, WorkerForwardingConnection, WorkerForwardingInvite,
                      WorkerForwardingPreference)

OPEN = {"New", "Ready", "In Progress", "Pending Verification"}
ADMINS = {"admin", "super_admin"}


def actor(request, db, admin=False):
    from ..main import get_authenticated_user, require_page_access
    user = get_authenticated_user(request, db)
    tenant = db.info.get("tenant_id")
    if not tenant:
        raise HTTPException(400, "Select a company first.")
    if admin:
        if user.role not in ADMINS:
            raise HTTPException(403, "Only company administrators can manage forwarding.")
        require_page_access(request, db, "Workers")
    return user, tenant


def foreign_worker(db, worker_id, tenant_id):
    # Only call with a tenant/worker pair from an authorized bridge or invite.
    worker = db.query(Worker).execution_options(skip_tenant_scope=True).filter(
        Worker.id == worker_id, Worker.tenant_id == tenant_id, Worker.is_active == True).first()
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.status == "active").first()
    login = db.query(User).execution_options(skip_tenant_scope=True).filter(
        User.worker_id == worker_id, User.tenant_id == tenant_id,
        User.role == "worker", User.is_active == True).first()
    if not worker or not tenant or not login:
        raise HTTPException(400, "The receiving worker needs an active company and linked worker login.")
    return worker, tenant


def issue_invite(request, db, worker_id):
    _, tenant = actor(request, db, admin=True)
    foreign_worker(db, worker_id, tenant)
    invite = db.query(WorkerForwardingInvite).filter_by(tenant_id=tenant, worker_id=worker_id).first()
    if not invite:
        invite = WorkerForwardingInvite(tenant_id=tenant, worker_id=worker_id)
        db.add(invite)
    code = secrets.token_urlsafe(24)
    invite.token_hash = hashlib.sha256(code.encode()).hexdigest()
    invite.expires_at = datetime.utcnow() + timedelta(days=7)
    db.commit()
    return {"code": code, "expires_at": invite.expires_at}


def connect(request, db, code):
    user, source = actor(request, db, admin=True)
    invite = db.query(WorkerForwardingInvite).filter(
        WorkerForwardingInvite.token_hash == hashlib.sha256(code.strip().encode()).hexdigest(),
        WorkerForwardingInvite.expires_at > datetime.utcnow()).first()
    if not invite:
        raise HTTPException(400, "Forwarding code is invalid or expired.")
    if invite.tenant_id == source:
        raise HTTPException(400, "This worker already belongs to your company.")
    foreign_worker(db, invite.worker_id, invite.tenant_id)
    row = db.query(WorkerForwardingConnection).filter_by(
        source_tenant_id=source, worker_id=invite.worker_id).first()
    if not row:
        row = WorkerForwardingConnection(source_tenant_id=source, target_tenant_id=invite.tenant_id,
            worker_id=invite.worker_id, created_by_user_id=user.id)
        db.add(row)
    row.is_active = True
    # Codes are single-use; a destination admin must issue another to reconnect.
    invite.expires_at = datetime.utcnow()
    db.commit()
    return {"id": row.id}


def connections(request, db):
    _, tenant = actor(request, db, admin=True)
    result = []
    for row in db.query(WorkerForwardingConnection).filter(or_(
            WorkerForwardingConnection.source_tenant_id == tenant,
            WorkerForwardingConnection.target_tenant_id == tenant)).all():
        worker = db.query(Worker).execution_options(skip_tenant_scope=True).filter(
            Worker.id == row.worker_id, Worker.tenant_id == row.target_tenant_id).first()
        source = db.query(Tenant).filter_by(id=row.source_tenant_id).first()
        target = db.query(Tenant).filter_by(id=row.target_tenant_id).first()
        result.append({"id": row.id, "worker_id": row.worker_id,
            "target_tenant_id": row.target_tenant_id, "source_tenant_id": row.source_tenant_id,
            "worker_name": worker.name if worker else "Unavailable worker",
            "company_name": target.company_name if target else "Unavailable company",
            "source_company_name": source.company_name if source else "Unavailable company",
            "outgoing": row.source_tenant_id == tenant, "is_active": row.is_active})
    return result


def preferences(request, db, connection_id=None, save=False):
    user, tenant = actor(request, db, admin=True)
    row = db.query(WorkerForwardingPreference).filter_by(tenant_id=tenant).first()
    if save:
        if connection_id is not None:
            connection = db.query(WorkerForwardingConnection).filter_by(id=connection_id,
                source_tenant_id=tenant, is_active=True).first()
            if not connection:
                raise HTTPException(400, "Choose an active worker connected to this company.")
            foreign_worker(db, connection.worker_id, connection.target_tenant_id)
        if row is None:
            row = WorkerForwardingPreference(tenant_id=tenant, updated_by_user_id=user.id)
            db.add(row)
        row.default_connection_id = connection_id
        row.updated_by_user_id = user.id
        row.updated_at = datetime.utcnow()
        db.commit()
    return {"default_connection_id": row.default_connection_id if row else None}


def revoke(request, db, connection_id):
    _, tenant = actor(request, db, admin=True)
    row = db.query(WorkerForwardingConnection).filter(
        WorkerForwardingConnection.id == connection_id,
        or_(WorkerForwardingConnection.source_tenant_id == tenant,
            WorkerForwardingConnection.target_tenant_id == tenant)).first()
    if not row:
        raise HTTPException(404, "Connection not found.")
    row.is_active = False
    preference = db.query(WorkerForwardingPreference).filter_by(
        tenant_id=row.source_tenant_id, default_connection_id=row.id).first()
    if preference:
        preference.default_connection_id = None
    # Revocation stops future forwarding and cancels unfinished tasks immediately.
    for link in db.query(ForwardedOrderTask).filter_by(connection_id=row.id).all():
        task = db.query(OrderWorkflowTask).execution_options(skip_tenant_scope=True).filter(
            OrderWorkflowTask.id == link.task_id, OrderWorkflowTask.tenant_id == row.target_tenant_id).first()
        if task and task.status in OPEN:
            task.status = "Canceled"
            task.updated_at = datetime.utcnow()
            link.active_key = None
    db.commit()
    return {"status": "revoked"}


def open_forward(db, order_id, task_type):
    tenant = db.info.get("tenant_id")
    return db.query(ForwardedOrderTask).filter_by(
        source_tenant_id=tenant, active_key=f"{tenant}:{order_id}:{task_type}").first()


def forward(request, db, order_id, payload):
    from ..main import (order_items_summary, order_workflow_task_default_quantity,
                        is_stock_deducted_shipping_status, customer_personal_label)
    user, source = actor(request, db, admin=True)
    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Order not found.")
    if is_stock_deducted_shipping_status(order.shipping_status) or str(order.status).lower() in {"canceled", "cancelled"}:
        raise HTTPException(400, "Only unfulfilled orders can be forwarded.")
    row = db.query(WorkerForwardingConnection).filter_by(id=payload.connection_id,
        source_tenant_id=source, is_active=True).first()
    if not row:
        raise HTTPException(404, "Approved worker connection not found.")
    worker, _ = foreign_worker(db, row.worker_id, row.target_tenant_id)
    if open_forward(db, order.id, payload.task_type) or db.query(OrderWorkflowTask).filter(
            OrderWorkflowTask.order_id == order.id, OrderWorkflowTask.task_type == payload.task_type,
            OrderWorkflowTask.status.in_(OPEN)).first():
        raise HTTPException(409, "This step already has an open assignment. Cancel it before forwarding.")
    source_company = db.query(Tenant).filter_by(id=source).one()
    quantity = order_workflow_task_default_quantity(order)
    customer = order.customer
    # An explicit, restricted task snapshot; never copy prices or payment records.
    snapshot = {"order_id": order.id, "order_no": order.order_no,
        "source_company_name": source_company.company_name,
        "customer_name": customer_personal_label(customer, order),
        "customer_phone": order.import_contact_phone or ((customer.phone or "") if customer else ""),
        "customer_address": order.import_shipping_address or ((customer.shipping_address or customer.address or "") if customer else ""),
        "platform": order.platform, "order_date": order.order_date.isoformat() if order.order_date else None,
        "shipping_status": order.shipping_status, "items": order_items_summary(order)}
    task = OrderWorkflowTask(tenant_id=row.target_tenant_id, order_id=order.id,
        task_type=payload.task_type, title=f"{source_company.company_name}: {payload.task_type} for order {order.order_no}",
        status="New", assigned_worker_id=worker.id, assigned_by_user_id=user.id,
        assigned_by_user_name=user.name, assigned_quantity=quantity, rate_per_piece=0,
        labor_cost=payload.labor_cost, notes=payload.notes, due_at=payload.due_at)
    db.add(task)
    try:
        db.flush()
        link = ForwardedOrderTask(source_tenant_id=source, target_tenant_id=row.target_tenant_id,
            connection_id=row.id, order_id=order.id, task_id=task.id,
            active_key=f"{source}:{order.id}:{payload.task_type}",
            snapshot_json=json.dumps(snapshot), created_by_user_id=user.id)
        db.add(link)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This step was already forwarded. Refresh the task list.")
    return forwarded_response(task, None)


def bridge_for_task(db, task_id):
    tenant = db.info.get("tenant_id")
    if not tenant:
        return None
    return db.query(ForwardedOrderTask).filter(ForwardedOrderTask.task_id == task_id,
        or_(ForwardedOrderTask.source_tenant_id == tenant,
            ForwardedOrderTask.target_tenant_id == tenant)).first()


def forwarded_response(task, privacy):
    db = object_session(task)
    link = bridge_for_task(db, task.id) if db else None
    if not link:
        return None
    from ..main import access_privacy_hides_worker_customer_name, access_privacy_hides_customer_phone
    snapshot = json.loads(link.snapshot_json)
    source_view = db.info.get("tenant_id") == link.source_tenant_id
    shipping = task.task_type == "Shipping"
    if not source_view:
        if not shipping or access_privacy_hides_worker_customer_name(privacy, task.task_type):
            snapshot["customer_name"] = "Customer"
        if not shipping or access_privacy_hides_customer_phone(privacy):
            snapshot["customer_phone"] = ""
        if not shipping:
            snapshot["customer_address"] = ""
    worker = db.query(Worker).execution_options(skip_tenant_scope=True).filter(
        Worker.id == task.assigned_worker_id, Worker.tenant_id == link.target_tenant_id).first()
    return {**snapshot, "id": task.id, "forwarded": True, "customer_id": None,
        "total_amount": 0, "payment_status": "", "task_type": task.task_type,
        "title": task.title, "status": task.status, "assigned_quantity": task.assigned_quantity,
        "completed_quantity": task.assigned_quantity if task.status == "Completed" else 0,
        "rate_per_piece": task.rate_per_piece or 0, "labor_cost": task.labor_cost or 0,
        "assigned_worker_id": task.assigned_worker_id,
        "assigned_worker_name": worker.name if worker else "Worker",
        "assigned_by_user_id": None, "assigned_by_user_name": snapshot["source_company_name"],
        "notes": task.notes, "due_at": task.due_at, "started_at": task.started_at,
        "completed_at": task.completed_at, "created_at": task.created_at, "updated_at": task.updated_at}


def outgoing_tasks(db, privacy, order_id=None, worker_id=None, status=None):
    tenant = db.info.get("tenant_id")
    query = db.query(ForwardedOrderTask).filter_by(source_tenant_id=tenant)
    if order_id is not None:
        query = query.filter_by(order_id=order_id)
    ids = [row.task_id for row in query.all()]
    if not ids:
        return []
    tasks = db.query(OrderWorkflowTask).execution_options(skip_tenant_scope=True).filter(OrderWorkflowTask.id.in_(ids))
    if worker_id is not None:
        tasks = tasks.filter_by(assigned_worker_id=worker_id)
    if status:
        tasks = tasks.filter(OrderWorkflowTask.status.in_(OPEN) if status.lower() == "open"
            else OrderWorkflowTask.status.ilike(status))
    return [forwarded_response(task, privacy) for task in tasks.all()]


def transition(request, db, task_id, action, payload=None):
    """Return None for a local task. Cross-tenant writes require a verified bridge.

    A source-scoped session shares the outer transaction, so shipment, stock and
    task updates commit together. It never grants source order access to a caller.
    """
    link = bridge_for_task(db, task_id)
    if not link:
        return None
    from ..main import (access_privacy_context, is_stock_deducted_shipping_status,
                        mark_order_unfulfilled, upsert_shipping_for_order)
    from ..schemas import ShippingCreate
    user, tenant = actor(request, db)
    task = db.query(OrderWorkflowTask).execution_options(skip_tenant_scope=True).filter(
        OrderWorkflowTask.id == task_id, OrderWorkflowTask.tenant_id == link.target_tenant_id).with_for_update().one()
    source_view = tenant == link.source_tenant_id
    if user.role not in ADMINS and (source_view or user.role != "worker" or user.worker_id != task.assigned_worker_id):
        raise HTTPException(403, "This task is not assigned to your worker login.")
    if user.role in ADMINS:
        actor(request, db, admin=True)
    if action == "cancel" or (payload and payload.verify):
        if not source_view or user.role not in ADMINS:
            raise HTTPException(403, "Only the sending company administrator can cancel or verify this task.")
    privacy = access_privacy_context(request, db)
    if action == "cancel":
        if task.status == "Completed":
            raise HTTPException(400, "Completed task cannot be canceled.")
        task.status = "Canceled"
        link.active_key = None
    else:
        connection = db.query(WorkerForwardingConnection).filter_by(id=link.connection_id, is_active=True).first()
        if not connection:
            raise HTTPException(403, "This forwarding connection has been revoked.")
        foreign_worker(db, task.assigned_worker_id, link.target_tenant_id)
        source_tenant = db.query(Tenant).filter_by(id=link.source_tenant_id, status="active").first()
        if not source_tenant:
            raise HTTPException(403, "The sending company is inactive.")
        if task.status in {"Canceled", "Completed"}:
            if action == "complete" and task.status == "Completed":
                return forwarded_response(task, privacy)
            raise HTTPException(400, "This task is already closed.")
        if action == "start" and task.status == "Pending Verification":
            raise HTTPException(400, "Task is waiting for sending company verification.")
        if action == "complete" and (task.status == "New" or (task.status == "Pending Verification" and not payload.verify)):
            raise HTTPException(400, "Accept the task first, or wait for verification.")
        # Suppress autoflush until the source session is finished on this connection.
        with Session(bind=db.connection(), join_transaction_mode="rollback_only") as source_db:
            source_db.info["tenant_id"] = link.source_tenant_id
            order = source_db.query(Order).filter_by(id=link.order_id).first()
            if not order:
                raise HTTPException(404, "Original order not found.")
            if action == "start":
                task.status = "In Progress"
                task.started_at = task.started_at or datetime.utcnow()
                if not is_stock_deducted_shipping_status(order.shipping_status):
                    mark_order_unfulfilled(order)
                    order.shipping_status = "Preparing" if task.task_type == "Preparation" else "Packed"
            else:
                if task.task_type == "Shipping" and (not payload.verify or any(
                    value is not None and str(value).strip() for value in
                    (payload.courier_name, payload.tracking_number, payload.package_weight_kg))):
                    if not (payload.courier_name or "").strip() or not (payload.tracking_number or "").strip() or payload.package_weight_kg is None:
                        raise HTTPException(400, "Courier, tracking number and package weight are required.")
                    upsert_shipping_for_order(source_db, order, ShippingCreate(order_id=order.id,
                        courier_name=payload.courier_name.strip(), tracking_number=payload.tracking_number.strip(),
                        package_weight_kg=payload.package_weight_kg, shipping_cost=payload.shipping_cost,
                        shipping_note=payload.shipping_note or payload.note))
                elif task.task_type == "Preparation" and not is_stock_deducted_shipping_status(order.shipping_status):
                    order.shipping_status = "Packed"
                task.status = "Completed" if payload.verify else "Pending Verification"
                task.completed_at = datetime.utcnow() if payload.verify else None
                if payload.note:
                    task.notes = f"{task.notes or ''}\n{payload.note.strip()}".strip()
                if payload.verify:
                    link.active_key = None
            source_db.flush()
            snapshot = json.loads(link.snapshot_json)
            snapshot["shipping_status"] = order.shipping_status
            link.snapshot_json = json.dumps(snapshot)
    task.updated_at = datetime.utcnow()
    db.commit()
    return forwarded_response(task, privacy)
