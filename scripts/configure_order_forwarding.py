"""Owner-authorized setup on the private production runner; inspect is the default.

Uses the normal approval/assignment services with each company's administrative
context. Never outputs codes, tokens, customer contacts or order financial data.
"""
import json
import os
import sys
from pathlib import Path


def run():
    sys.path.insert(0, str(Path.cwd()))
    from sqlalchemy import func
    from app.database import SessionLocal
    from app.models import Tenant, User, Order, OrderWorkflowTask, ForwardedOrderTask, Worker

    source_slug = os.environ["FORWARDING_SOURCE"].strip().lower()
    target_slug = os.environ["FORWARDING_TARGET"].strip().lower()
    username = os.environ["FORWARDING_WORKER"].strip().lower()
    numbers = [number.strip().lstrip("#") for number in os.environ["FORWARDING_ORDERS"].split(",") if number.strip()]
    if not numbers or len(numbers) > 20 or source_slug == target_slug:
        raise ValueError("Provide 1-20 order numbers and two different company slugs.")
    with SessionLocal() as db:
        source = db.query(Tenant).filter(func.lower(Tenant.slug) == source_slug, Tenant.status == "active").one()
        target = db.query(Tenant).filter(func.lower(Tenant.slug) == target_slug, Tenant.status == "active").one()
        login = db.query(User).filter(User.tenant_id == target.id, func.lower(User.username) == username,
            User.role == "worker", User.is_active == True).one()
        worker = db.query(Worker).filter_by(id=login.worker_id, tenant_id=target.id, is_active=True).one()
        orders = db.query(Order).filter(Order.tenant_id == source.id, Order.order_no.in_(numbers)).all()
        if len(orders) != len(set(numbers)):
            raise ValueError("Some requested orders were not found in the sending company.")
        rows = []
        for order in orders:
            local = db.query(OrderWorkflowTask).filter_by(tenant_id=source.id, order_id=order.id).all()
            forwarded_ids = [link.task_id for link in db.query(ForwardedOrderTask).filter_by(source_tenant_id=source.id, order_id=order.id)]
            tasks = local + (db.query(OrderWorkflowTask).filter(OrderWorkflowTask.id.in_(forwarded_ids)).all() if forwarded_ids else [])
            preparation_done = any(task.task_type == "Preparation" and task.status == "Completed" for task in tasks)
            step = "Preparation" if any(item.manufacturing_required for item in order.items) and not preparation_done else "Shipping"
            rows.append((order, step, tasks))
        print(json.dumps({"source_company": source.company_name, "target_company": target.company_name,
            "worker_login": login.username, "worker_name": worker.name, "worker_id": worker.id,
            "orders": [{"order_no": order.order_no, "shipping_status": order.shipping_status, "next_task": step,
                "existing_tasks": [{"id": task.id, "task_type": task.task_type, "status": task.status,
                    "worker_id": task.assigned_worker_id} for task in tasks]} for order, step, tasks in rows]}, indent=2))
        if os.getenv("FORWARDING_MODE", "inspect") != "setup":
            print("Inspection only. No database changes made.")
            return
        from starlette.requests import Request
        from app.services import order_forwarding as service
        from app.routers.order_forwarding_router import ForwardOrder
        # Administrative contexts are scoped to each participating company.
        def context(tenant):
            admin = db.query(User).filter(User.tenant_id == tenant.id, User.is_active == True,
                User.role.in_(["admin", "super_admin"])).order_by(User.id).first()
            if admin is None:
                raise ValueError("Each company needs an active administrator for this setup.")
            request = Request({"type": "http", "method": "POST", "path": "/order-forwarding/connections",
                "headers": [(b"x-erp-tenant-id", str(tenant.id).encode())]})
            request.state.user_id = admin.id
            request.state.authenticated_user = admin
            request.state.tenant_id = tenant.id
            return request
        source_request, target_request = context(source), context(target)
        from app.models import WorkerForwardingConnection
        connection = db.query(WorkerForwardingConnection).filter_by(source_tenant_id=source.id,
            target_tenant_id=target.id, worker_id=worker.id, is_active=True).first()
        # Validate every existing step before making setup or assignment changes.
        for order, step, tasks in rows:
            active = [task for task in tasks if task.task_type == step and task.status in service.OPEN]
            if active and not (len(active) == 1 and active[0].tenant_id == target.id and active[0].assigned_worker_id == worker.id):
                raise ValueError(f"Order {order.order_no} already has an assignment for {step}; review it before reassigning.")
            if str(order.shipping_status).lower() in {"shipped", "dispatched", "in transit", "delivered", "canceled", "cancelled"}:
                raise ValueError(f"Order {order.order_no} is already closed or shipped.")
        plan = [(order.id, order.order_no, step, next((task.id for task in tasks if task.task_type == step and task.status in service.OPEN), None)) for order, step, tasks in rows]
        if connection is None:
            db.info["tenant_id"] = target.id
            code = service.issue_invite(target_request, db, worker.id)["code"]
            db.info["tenant_id"] = source.id
            connection_id = service.connect(source_request, db, code)["id"]
        else:
            connection_id = connection.id
        db.info["tenant_id"] = source.id
        service.preferences(source_request, db, connection_id, save=True)
        for order_id, order_no, step, existing_task_id in plan:
            if existing_task_id:
                print(f"Already forwarded: {order_no}, task {existing_task_id}, worker {username}.")
                continue
            result = service.forward(source_request, db, order_id, ForwardOrder(connection_id=connection_id,
                task_type=step, notes="Forwarded via owner-authorized deployment setup for " + username + "."))
            print(f"Forwarded: {order_no}, task {result['id']}, {step}, worker {username}.")
        print("Default receiving worker saved. Setup complete.")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        # Do not print credential-bearing URLs or database connection strings.
        from fastapi import HTTPException
        print("Setup failed:", error.detail if isinstance(error, HTTPException) else type(error).__name__ + ": check the selected company, worker and order records.")
        sys.exit(1)
