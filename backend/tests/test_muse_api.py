"""Run with SKIP_DATABASE_INITIALIZATION=1 and a disposable DATABASE_URL."""
import unittest
import asyncio
from datetime import datetime
from unittest.mock import Mock
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from unittest.mock import patch
from app.database import Base
from app.models import Customer, Product, Tenant, User, Order, MuseSubmission, OrderItem, StockMovement, Shipping
from app.muse_api import MuseOrder, MusePayout, enqueue, process_queue, match_customer, rotate_key, authenticate
from app.main import create_order_record, sync_order_payout_accounting
from pydantic import ValidationError


class MuseTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        # Explicit BEGIN gives SQLite real outer transactions around savepoints.
        @event.listens_for(self.engine, "connect")
        def connect(connection, record):
            connection.isolation_level = None
        @event.listens_for(self.engine, "begin")
        def begin(connection):
            connection.exec_driver_sql("BEGIN")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([Tenant(id=1, company_name="One", slug="one"), Tenant(id=2, company_name="Two", slug="two")])
        self.db.commit()
        self.db.info["tenant_id"] = 1
        self.db.add(Product(article_no="SKU-1", name="Test", factory_stock=20))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def order(self, **changes):
        data = dict(order_no="M-1", order_date="2026-10-10T00:00:00Z", customer_name="Jane", company_name="Shop", phone="+1 (212) 555-0123", shipping_address="NY, USA", estimated_net_usd=82.1, items=[dict(article_no="SKU-1", quantity=2, unit_price_usd=50)])
        data.update(changes)
        return MuseOrder(**data)

    def process(self, creator=create_order_record, sync=sync_order_payout_accounting):
        self.db.commit()
        process_queue(self.engine, creator, sync)
        self.db.expire_all()

    def test_order_repeat_customer_and_payout(self):
        payload = self.order()
        first = enqueue(payload, "order", self.db)
        self.assertEqual(first["id"], enqueue(payload, "order", self.db)["id"])
        self.process()
        self.assertEqual(self.db.query(MuseSubmission).first().status, "Applied")
        self.assertEqual(self.db.query(Customer).count(), 1)
        self.assertEqual(self.db.query(OrderItem).count(), 1)
        self.assertEqual(self.db.query(Product).first().reserved_stock, 2)
        enqueue(self.order(order_no="M-2", phone="0012125550123"), "order", self.db)
        self.process()
        self.assertEqual(self.db.query(Customer).count(), 1)
        paid = MusePayout(order_no="M-1", actual_paid_usd=80, paid_at="2026-10-11T08:00:00+05:00")
        enqueue(paid, "payout", self.db)
        self.process()
        order = self.db.query(Order).filter_by(order_no="M-1").one()
        self.assertEqual((order.expected_payout_usd, order.received_payout_usd, order.remaining_payout_usd, order.payout_status), (82.1, 80, 0, "Received"))
        from app.models import AccountingTransaction
        self.assertEqual(self.db.query(AccountingTransaction).count(), 1)
        enqueue(paid, "payout", self.db)
        self.process()
        self.assertEqual(self.db.query(AccountingTransaction).count(), 1)

    def test_repost_after_order_deleted_allows_new_details(self):
        enqueue(self.order(order_no="M-DEL"), "order", self.db)
        self.process()
        order = self.db.query(Order).filter_by(order_no="M-DEL").one()
        self.db.query(OrderItem).filter_by(order_id=order.id).delete()
        self.db.query(StockMovement).filter_by(reference="M-DEL").delete()
        self.db.delete(order)
        self.db.commit()
        self.assertEqual(self.db.query(Order).filter_by(order_no="M-DEL").count(), 0)
        submission = self.db.query(MuseSubmission).filter_by(submission_key="order:M-DEL").one()
        self.assertEqual(submission.status, "Applied")
        # Same order_no with fulfilled/tracking must re-queue after ERP delete.
        result = enqueue(
            self.order(
                order_no="M-DEL",
                fulfilled=True,
                courier="DHL",
                tracking_number="1234567890",
            ),
            "order",
            self.db,
        )
        self.assertEqual(result["status"], "Pending")
        self.process()
        order = self.db.query(Order).filter_by(order_no="M-DEL").one()
        shipping = self.db.query(Shipping).filter_by(order_id=order.id).one()
        self.assertEqual(order.shipping_status, "Shipped")
        self.assertEqual(shipping.courier_name, "DHL")
        self.assertEqual(shipping.tracking_number, "1234567890")

    def test_fulfilled_order_with_fedex_tracking(self):
        with self.assertRaises(ValidationError):
            self.order(fulfilled=True)
        with self.assertRaises(ValidationError):
            self.order(fulfilled=True, courier="FedEx")
        with self.assertRaises(ValidationError):
            self.order(fulfilled=True, courier="UPS", tracking_number="1Z999")
        payload = self.order(
            order_no="M-SHIP",
            fulfilled=True,
            courier="fedex",
            tracking_number="794612345678",
        )
        self.assertEqual(payload.courier, "FedEx")
        enqueue(payload, "order", self.db)
        self.process()
        order = self.db.query(Order).filter_by(order_no="M-SHIP").one()
        shipping = self.db.query(Shipping).filter_by(order_id=order.id).one()
        self.assertEqual(order.shipping_status, "Shipped")
        self.assertEqual(shipping.courier_name, "FedEx")
        self.assertEqual(shipping.tracking_number, "794612345678")
        # Stock is deducted when Muse marks the order fulfilled/shipped.
        self.assertEqual(self.db.query(Product).first().factory_stock, 18)
        self.assertEqual(self.db.query(Product).first().reserved_stock, 0)

    def test_unknown_product_and_retry(self):
        result = enqueue(self.order(items=[dict(article_no="MISSING", quantity=1, unit_price_usd=10)]), "order", self.db)
        self.process()
        self.assertEqual(self.db.get(MuseSubmission, result["id"]).status, "Failed")
        self.assertEqual(self.db.query(Customer).count(), 0)
        enqueue(self.order(), "order", self.db)
        self.process()
        self.assertEqual(self.db.query(Order).count(), 1)

    def test_rollback_after_inner_commit(self):
        enqueue(self.order(), "order", self.db)
        def broken(payload, db, **kwargs):
            create_order_record(payload, db, **kwargs)
            raise RuntimeError("Simulated failure after commit")
        self.process(creator=broken)
        self.assertEqual(self.db.query(Order).count(), 0)
        self.assertEqual(self.db.query(Customer).count(), 0)
        self.assertEqual(self.db.query(StockMovement).count(), 0)

    def test_ambiguous_customer_and_tenant_isolation(self):
        self.db.add_all([Customer(name="Jane", company_name="Shop", phone="12125550123"), Customer(name="Other", phone="12125550123")])
        self.db.commit()
        with self.assertRaises(HTTPException):
            match_customer(self.order(), self.db)
        self.db.add(Customer(tenant_id=2, name="Elsewhere", phone="999"))
        self.db.commit()
        with self.assertRaises(HTTPException):
            match_customer(self.order(customer_id=3), self.db)

    def test_key_rotation_and_permissions(self):
        admin = User(name="Admin", role="admin", tenant_id=1)
        self.db.add(admin)
        self.db.commit()
        key = rotate_key(self.db, admin, 1)["api_key"]
        self.assertEqual(authenticate(self.db, key)[1], 1)
        rotate_key(self.db, admin, 1)
        with self.assertRaises(HTTPException):
            authenticate(self.db, key)
        admin.role = "worker"
        with self.assertRaises(HTTPException):
            rotate_key(self.db, admin, 1)

    def test_http_auth_scope_and_validation(self):
        from app import main
        admin = User(name="Admin", role="admin", tenant_id=1)
        self.db.add(admin)
        self.db.commit()
        key = rotate_key(self.db, admin, 1)["api_key"]
        def scoped_db(request: main.Request):
            with Session(self.engine) as db:
                db.info["tenant_id"] = request.state.tenant_id
                yield db
        main.app.dependency_overrides[main.get_db] = scoped_db
        try:
            with patch.object(main, "SessionLocal", lambda: Session(self.engine)):
                client = TestClient(main.app)
                self.assertEqual(client.post("/integrations/muse/orders", json=self.order().model_dump(mode="json")).status_code, 401)
                headers = {"Authorization": f"Bearer {key}", "X-ERP-Tenant-Id": "2"}
                products_url = "/integrations/muse/products"
                product_data = {"article_no": " NEW-SKU ", "name": " New product ", "unit_price_usd": 25.5,
                                "image_url": "https://example.com/catalog/new.jpg"}
                self.assertEqual(client.get(products_url).status_code, 401)
                self.assertEqual(client.post(products_url, json=product_data).status_code, 401)
                response = client.post(products_url, headers=headers, json=product_data)
                self.assertEqual(response.status_code, 200, response.text)
                created = response.json()
                self.assertEqual(created["article_no"], "NEW-SKU")
                self.assertEqual(created["name"], "New product")
                self.assertEqual(created["unit_price_usd"], 25.5)
                self.assertEqual(created["image_url"], product_data["image_url"])
                response = client.post(products_url, headers=headers, json={**product_data, "name": "Changed", "unit_price_usd": 99, "image_url": "https://example.com/changed.jpg"})
                self.assertEqual(response.json(), created)
                self.assertIn(created, client.get(products_url, headers=headers).json())
                for invalid in ({"article_no": " "}, {"name": " "}, {"unit_price_usd": -1}, {"factory_stock": 10}):
                    self.assertEqual(client.post(products_url, headers=headers, json={**product_data, **invalid}).status_code, 422)
                for invalid_url in ("not-a-url", "javascript:alert(1)", "file:///image.jpg", "data:image/png;base64,AAAA"):
                    self.assertEqual(client.post(products_url, headers=headers, json={**product_data, "image_url": invalid_url}).status_code, 422)
                for sku, optional in (("NO-IMAGE", {}), ("NULL-IMAGE", {"image_url": None})):
                    response = client.post(products_url, headers=headers, json={"article_no": sku, "name": sku, "unit_price_usd": 0, **optional})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertIsNone(response.json()["image_url"])
                with Session(self.engine) as other:
                    other.info["tenant_id"] = 2
                    other.add(Product(article_no="PRIVATE", name="Other company"))
                    other.commit()
                self.assertNotIn("PRIVATE", [p["article_no"] for p in client.get(products_url, headers=headers).json()])
                # Same SKU is allowed in another company; it must not leak across tenants.
                response = client.post(products_url, headers=headers, json={**product_data, "article_no": "PRIVATE", "name": "Owned here"})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["name"], "Owned here")
                self.assertIn("PRIVATE", [p["article_no"] for p in client.get(products_url, headers=headers).json()])
                response = client.post("/integrations/muse/orders", headers=headers, json=self.order().model_dump(mode="json"))
                self.assertEqual(response.status_code, 202, response.text)
                self.assertEqual(client.get("/orders", headers=headers).status_code, 401)
                response = client.post("/integrations/muse/payouts", headers=headers, json={"order_no":"M-1", "actual_paid_usd":-1, "paid_at":"2026-10-10T00:00:00Z"})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(client.get("/integrations/muse/submissions", headers=headers).json()[0]["status"], "Pending")
            self.db.expire_all()
            self.assertEqual(self.db.query(MuseSubmission).one().tenant_id, 1)
        finally:
            main.app.dependency_overrides.pop(main.get_db, None)

    def test_create_missing_product_then_retry_order(self):
        from app.muse_api import MuseProduct, ensure_product
        payload = self.order(items=[dict(article_no="NEW", quantity=1, unit_price_usd=25)])
        result = enqueue(payload, "order", self.db)
        self.process()
        self.assertEqual(self.db.get(MuseSubmission, result["id"]).status, "Failed")
        ensure_product(MuseProduct(article_no="NEW", name="New", unit_price_usd=25), self.db)
        product = self.db.query(Product).filter_by(article_no="NEW").one()
        self.assertEqual(product.tenant_id, 1)
        self.assertEqual((product.factory_stock, product.usa_stock, product.selling_price), (0, 0, 25))
        enqueue(payload, "order", self.db)
        self.process()
        self.assertEqual(self.db.get(MuseSubmission, result["id"]).status, "Applied")
        self.assertEqual(self.db.query(OrderItem).one().product_id, product.id)


class MuseQueueWakeTests(unittest.IsolatedAsyncioTestCase):
    async def test_submission_wakes_sleeping_processor(self):
        from app.muse_api import MuseQueueService
        service = MuseQueueService(None, None, None)
        service.poll_interval_seconds = 3600
        processed = asyncio.Event()
        loop = asyncio.get_running_loop()
        def process(*args):
            loop.call_soon_threadsafe(processed.set)
        with patch("app.muse_api.process_queue", side_effect=process) as worker:
            await service.start()
            try:
                await asyncio.wait_for(processed.wait(), 2)
                processed.clear()
                await asyncio.to_thread(service.notify)
                await asyncio.wait_for(processed.wait(), 2)
                self.assertGreaterEqual(worker.call_count, 2)
            finally:
                await service.stop()

    async def test_fallback_processes_without_notification(self):
        from app.muse_api import MuseQueueService
        service = MuseQueueService(None, None, None)
        service.poll_interval_seconds = 0.01
        processed = asyncio.Event()
        loop = asyncio.get_running_loop()
        calls = 0
        def process(*args):
            nonlocal calls
            calls += 1
            if calls >= 2:
                loop.call_soon_threadsafe(processed.set)
        with patch("app.muse_api.process_queue", side_effect=process):
            await service.start()
            try:
                await asyncio.wait_for(processed.wait(), 2)
            finally:
                await service.stop()


if __name__ == "__main__":
    unittest.main()
