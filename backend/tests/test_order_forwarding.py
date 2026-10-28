"""Cross-tenant HTTP integration tests against an isolated in-memory database."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import main
from app.database import Base
from app.models import (Tenant, User, Worker, Customer, Product, Order, OrderItem,
                        OrderWorkflowTask, ForwardedOrderTask, Shipping, StockMovement,
                        WorkerForwardingInvite)
from app.security import create_access_token


class ForwardingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        @event.listens_for(self.engine, "connect")
        def configure(connection, _):
            connection.isolation_level = None
            connection.execute("PRAGMA foreign_keys=ON")
        @event.listens_for(self.engine, "begin")
        def begin(connection):
            connection.exec_driver_sql("BEGIN")
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Tenant(id=i, company_name=f"Company {i}", slug=f"company-{i}") for i in (1, 2, 3)])
            db.flush()
            db.add_all([Worker(id=1, tenant_id=2, name="Receiving worker", role="Packing"), Worker(id=2, tenant_id=2, name="Other worker", role="Packing")])
            db.flush()
            db.add_all([User(id=i, tenant_id=i, name=f"Admin {i}", role="admin") for i in (1, 2, 3)])
            db.add_all([User(id=4, tenant_id=2, name="Worker", role="worker", worker_id=1),
                        User(id=5, tenant_id=2, name="Other", role="worker", worker_id=2)])
            db.add(Customer(id=1, tenant_id=1, name="Test customer", phone="private-phone", address="Private address"))
            db.add(Product(id=1, tenant_id=1, name="Knife", article_no="SKU", factory_stock=10, reserved_stock=2))
            db.flush()
            db.add_all([Order(id=i, tenant_id=1, customer_id=1, order_no=f"ORDER-{i}", total_amount=999) for i in (1, 2)])
            db.flush()
            db.add(OrderItem(tenant_id=1, order_id=1, product_id=1, quantity=2, unit_price=50, stock_source="factory"))
            db.commit()
        self.patch = patch.object(main, "SessionLocal", lambda: Session(self.engine))
        self.patch.start()
        self.audit_patch = patch.object(main, "should_audit_request", return_value=False)
        self.audit_patch.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.audit_patch.stop()
        self.patch.stop()
        self.engine.dispose()

    def call(self, method, url, user=1, body=None, status=200):
        response = self.client.request(method, url, headers={"Authorization": "Bearer " + create_access_token(user)}, json=body)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def connection(self):
        code = self.call("POST", "/order-forwarding/workers/1/code", user=2)["code"]
        return self.call("POST", "/order-forwarding/connections", body={"code": code})["id"]

    def forward(self, task_type="Preparation", order_id=1):
        connection = self.connection()
        task = self.call("POST", f"/order-forwarding/orders/{order_id}", body={"connection_id": connection,
            "task_type": task_type, "notes": "Pack carefully", "labor_cost": 25})
        return task, connection

    def test_one_login_full_preparation_and_source_verification(self):
        task, _ = self.forward()
        task_id = task["id"]
        worker_tasks = self.call("GET", "/order-workflow/tasks?worker_id=1", user=4)
        self.assertEqual([row["id"] for row in worker_tasks], [task_id])
        self.assertEqual(worker_tasks[0]["customer_name"], "Customer")
        self.assertEqual(worker_tasks[0]["customer_address"], "")
        self.assertEqual(worker_tasks[0]["total_amount"], 0)
        self.assertEqual(len(worker_tasks[0]["items"]), 1)
        self.assertEqual(self.call("GET", "/orders", user=4), [])
        self.assertEqual(self.call("GET", "/order-workflow/tasks", user=3), [])
        self.assertEqual(self.call("GET", "/order-workflow/tasks", user=5), [])
        self.call("GET", "/order-workflow/tasks?worker_id=1", user=5, status=403)
        self.call("PATCH", f"/order-workflow/tasks/{task_id}/start", user=5, status=403)
        self.call("PATCH", f"/order-workflow/tasks/{task_id}/start", user=3, status=404)
        self.call("PATCH", f"/order-workflow/tasks/{task_id}/complete", user=4, body={}, status=400)
        self.call("PATCH", f"/order-workflow/tasks/{task_id}/start", user=4)
        self.assertEqual(self.call("PATCH", f"/order-workflow/tasks/{task_id}/complete", user=4, body={})["status"], "Pending Verification")
        self.call("PATCH", f"/order-workflow/tasks/{task_id}/complete", user=4, body={"verify": True}, status=403)
        self.call("PATCH", f"/order-workflow/tasks/{task_id}/complete", user=2, body={"verify": True}, status=403)
        self.assertEqual(self.call("PATCH", f"/order-workflow/tasks/{task_id}/complete", body={"verify": True})["status"], "Completed")
        with Session(self.engine) as db:
            self.assertEqual(db.get(Order, 1).tenant_id, 1)
            self.assertEqual(db.get(Order, 1).shipping_status, "Packed")
            self.assertEqual(db.get(OrderWorkflowTask, task_id).tenant_id, 2)
            self.assertIsNone(db.query(ForwardedOrderTask).one().active_key)
        self.assertEqual(self.call("GET", "/order-workflow/tasks", user=1)[0]["status"], "Completed")

    def test_shipping_updates_only_source_stock_and_is_idempotent(self):
        task, _ = self.forward("Shipping")
        path = f"/order-workflow/tasks/{task['id']}"
        self.call("PATCH", path + "/start", user=4)
        self.call("PATCH", path + "/complete", user=4, body={}, status=400)
        body = {"courier_name": "DHL", "tracking_number": "ABC", "package_weight_kg": 1}
        self.call("PATCH", path + "/complete", user=4, body=body)
        self.call("PATCH", path + "/complete", body={"verify": True})
        self.call("PATCH", path + "/complete", body={"verify": True})
        with Session(self.engine) as db:
            self.assertEqual(db.get(Order, 1).shipping_status, "Shipped")
            self.assertEqual(db.query(Shipping).one().tenant_id, 1)
            self.assertEqual(db.query(StockMovement).one().tenant_id, 1)
            self.assertEqual(db.get(Product, 1).factory_stock, 8)

    def test_approval_duplicate_cancel_revoke_and_replay(self):
        self.call("POST", "/order-forwarding/workers/1/code", user=1, status=400)
        self.call("POST", "/order-forwarding/workers/1/code", user=4, status=403)
        self.call("POST", "/order-forwarding/connections", body={"code": "invalid-code-12345"}, status=400)
        code = self.call("POST", "/order-forwarding/workers/1/code", user=2)["code"]
        connection = self.call("POST", "/order-forwarding/connections", body={"code": code})["id"]
        self.call("POST", "/order-forwarding/connections", body={"code": code}, user=3, status=400)
        body = {"connection_id": connection}
        self.call("POST", "/order-forwarding/orders/1", body=body, user=3, status=404)
        task = self.call("POST", "/order-forwarding/orders/1", body=body)
        self.call("POST", "/order-forwarding/orders/1", body=body, status=409)
        self.call("POST", "/orders/1/workflow-tasks", body={"worker_id": 1, "task_type": "Preparation"}, status=404)
        path = f"/order-workflow/tasks/{task['id']}"
        self.call("PATCH", path + "/cancel", user=4, status=403)
        self.call("PATCH", path + "/cancel")
        self.call("POST", "/order-forwarding/orders/1", body=body)
        self.call("DELETE", f"/order-forwarding/connections/{connection}", user=3, status=404)
        self.call("DELETE", f"/order-forwarding/connections/{connection}", user=2)
        self.call("POST", "/order-forwarding/orders/2", body=body, status=404)
        self.assertTrue(all(row["status"] == "Canceled" for row in self.call("GET", "/order-workflow/tasks", user=4)))

    def test_source_local_assignment_cannot_bypass_forwarded_step(self):
        task, _ = self.forward()
        with Session(self.engine) as db:
            db.add(Worker(id=3, tenant_id=1, name="Source worker", role="Packing"))
            db.commit()
        self.call("POST", "/orders/1/workflow-tasks", body={"worker_id": 3, "task_type": "Preparation"}, status=409)
        self.call("PATCH", f"/order-workflow/tasks/{task['id']}/cancel")
        with patch.object(main, "send_configured_email_event"):
            local = self.call("POST", "/orders/1/workflow-tasks", body={"worker_id": 3, "task_type": "Preparation"})
        self.assertFalse(local.get("forwarded", False))
        self.assertEqual(local["assigned_worker_name"], "Source worker")
        self.call("POST", "/order-forwarding/orders/1", body={"connection_id": self.connection()}, status=409)

    def test_expired_and_rotated_codes_and_payload_injection(self):
        from datetime import datetime, timedelta
        first = self.call("POST", "/order-forwarding/workers/1/code", user=2)["code"]
        second = self.call("POST", "/order-forwarding/workers/1/code", user=2)["code"]
        self.call("POST", "/order-forwarding/connections", body={"code": first}, status=400)
        with Session(self.engine) as db:
            db.query(WorkerForwardingInvite).one().expires_at = datetime.utcnow() - timedelta(days=1)
            db.commit()
        self.call("POST", "/order-forwarding/connections", body={"code": second}, status=400)
        self.call("POST", "/order-forwarding/orders/1", body={"connection_id": 1, "tenant_id": 2}, status=422)

    def test_failed_shipment_rolls_back_stock_and_task_together(self):
        task, _ = self.forward("Shipping")
        path = f"/order-workflow/tasks/{task['id']}"
        self.call("PATCH", path + "/start", user=4)
        def fail_after_changes(db, order, payload):
            db.query(Product).one().factory_stock = 0
            order.shipping_status = "Shipped"
            db.flush()
            from fastapi import HTTPException
            raise HTTPException(400, "Simulated shipment failure")
        with patch.object(main, "upsert_shipping_for_order", fail_after_changes):
            self.call("PATCH", path + "/complete", user=4, body={"courier_name": "DHL", "tracking_number": "X", "package_weight_kg": 1}, status=400)
        with Session(self.engine) as db:
            self.assertEqual(db.get(Product, 1).factory_stock, 10)
            self.assertEqual(db.get(Order, 1).shipping_status, "Packed")
            self.assertEqual(db.get(OrderWorkflowTask, task["id"]).status, "In Progress")


if __name__ == "__main__":
    unittest.main()
