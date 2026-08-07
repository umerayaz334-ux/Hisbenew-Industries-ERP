import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import User
from app.service_takers.models import (
    ServiceTaker,
    ServiceTakerInventoryTransaction,
    ServiceTakerProduct,
)
from app.service_takers.router import (
    admin_dashboard,
    create_client,
    portal_create_inbound,
    portal_create_order,
    portal_create_product,
    portal_cancel_order,
    portal_dashboard,
    portal_upload_product_image,
    portal_upload_label,
    receive_inbound,
    ship_order,
    update_order,
)
from app.service_takers.schemas import (
    ServiceTakerCreate,
    ServiceTakerInboundCreate,
    ServiceTakerInboundReceive,
    ServiceTakerOrderAdminUpdate,
    ServiceTakerOrderCreate,
    ServiceTakerProductCreate,
)


class ServiceTakerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        admin = User(
            name="Administrator",
            username="admin",
            pin="test",
            role="admin",
            allowed_pages="[]",
            is_active=True,
        )
        self.db.add(admin)
        self.db.commit()
        self.admin_id = admin.id

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    @staticmethod
    def request(user_id):
        return SimpleNamespace(state=SimpleNamespace(user_id=user_id))

    def create_service_taker(self, username="fulfillment-client"):
        return create_client(
            ServiceTakerCreate(
                company_name="Northstar Goods",
                contact_name="Amina Shah",
                username=username,
                pin="2468",
                currency="USD",
                pick_pack_fee=2,
                additional_item_fee=0.5,
                label_fee=1,
            ),
            self.request(self.admin_id),
            self.db,
        )

    def test_client_stock_is_received_reserved_and_shipped_separately(self):
        client_record = self.create_service_taker()
        service_taker_id = client_record["id"]
        user_id = client_record["user_id"]

        product_record = portal_create_product(
            ServiceTakerProductCreate(
                sku="CLIENT-SKU-1",
                name="Client-owned product",
                unit_weight_kg=1.25,
                length_cm=24,
                width_cm=18,
                height_cm=9,
            ),
            self.request(user_id),
            self.db,
        )
        product_id = product_record["id"]
        self.assertEqual(product_record["unit_weight_kg"], 1.25)
        self.assertEqual(product_record["length_cm"], 24)
        self.assertEqual(product_record["width_cm"], 18)
        self.assertEqual(product_record["height_cm"], 9)
        self.assertEqual(product_record["stock_status"], "Out of stock")
        self.assertNotIn("reorder_level", product_record)
        self.assertNotIn("is_low_stock", product_record)

        image = UploadFile(filename="product.webp", file=io.BytesIO(b"image"))
        with patch(
            "app.service_takers.router.save_product_image",
            return_value="/static/uploads/service-product-test.webp",
        ):
            product_with_image = portal_upload_product_image(
                product_id,
                self.request(user_id),
                image,
                self.db,
            )
        self.assertEqual(
            product_with_image["image_url"],
            "/static/uploads/service-product-test.webp",
        )

        inbound_record = portal_create_inbound(
            ServiceTakerInboundCreate(
                client_reference="PO-100",
                carrier="UPS",
                tracking_number="1ZTEST",
                items=[{"product_id": product_id, "quantity": 10}],
            ),
            self.request(user_id),
            self.db,
        )
        received_record = receive_inbound(
            inbound_record["id"],
            ServiceTakerInboundReceive(items=[]),
            self.request(self.admin_id),
            self.db,
        )
        self.assertEqual(received_record["received_quantity"], 10)

        order_record = portal_create_order(
            ServiceTakerOrderCreate(
                client_reference="ORDER-22",
                recipient_name="Customer One",
                address_line_1="10 Main Street",
                city="Austin",
                state="TX",
                postal_code="78701",
                country="USA",
                label_source="Client",
                items=[{"product_id": product_id, "quantity": 3}],
            ),
            self.request(user_id),
            self.db,
        )
        self.assertEqual(order_record["status"], "Awaiting label")
        self.assertEqual(order_record["pick_pack_cost"], 3)

        dashboard = portal_dashboard(self.request(user_id), self.db)
        self.assertEqual(dashboard["stats"]["quantity_on_hand"], 10)
        self.assertEqual(dashboard["stats"]["reserved_quantity"], 3)
        self.assertEqual(dashboard["stats"]["available_quantity"], 7)
        self.assertEqual(dashboard["products"][0]["stock_status"], "In stock")

        label = UploadFile(filename="label.pdf", file=io.BytesIO(b"%PDF-test"))
        with patch(
            "app.service_takers.router.save_label_file",
            return_value=("/static/uploads/test-label.pdf", "label.pdf"),
        ):
            labeled_order = portal_upload_label(
                order_record["id"],
                self.request(user_id),
                label,
                self.db,
            )
        self.assertEqual(labeled_order["status"], "Submitted")

        cost_record = update_order(
            order_record["id"],
            ServiceTakerOrderAdminUpdate(
                status="Ready",
                courier="UPS",
                tracking_number="TRACK-22",
                shipping_cost=5,
                pick_pack_cost=3,
                label_cost=0,
                other_cost=0,
            ),
            self.request(self.admin_id),
            self.db,
        )
        self.assertEqual(cost_record["total_cost"], 8)

        shipped_record = ship_order(
            order_record["id"],
            self.request(self.admin_id),
            self.db,
        )
        self.assertEqual(shipped_record["status"], "Shipped")

        product = self.db.query(ServiceTakerProduct).filter(
            ServiceTakerProduct.id == product_id
        ).one()
        self.assertEqual(product.service_taker_id, service_taker_id)
        self.assertEqual(product.quantity_on_hand, 7)
        self.assertEqual(product.reserved_quantity, 0)
        movements = (
            self.db.query(ServiceTakerInventoryTransaction)
            .filter(
                ServiceTakerInventoryTransaction.service_taker_id
                == service_taker_id
            )
            .order_by(ServiceTakerInventoryTransaction.id)
            .all()
        )
        self.assertEqual([movement.quantity_change for movement in movements], [10, -3])

    def test_portal_cannot_access_admin_dashboard_or_another_client(self):
        first = self.create_service_taker("first-client")
        second = self.create_service_taker("second-client")

        with self.assertRaises(HTTPException) as forbidden:
            admin_dashboard(self.request(first["user_id"]), self.db)
        self.assertEqual(forbidden.exception.status_code, 403)

        first_dashboard = portal_dashboard(
            self.request(first["user_id"]),
            self.db,
        )
        self.assertEqual(first_dashboard["client"]["id"], first["id"])
        self.assertNotEqual(first_dashboard["client"]["id"], second["id"])
        self.assertEqual(len(first_dashboard["clients"]), 1)
        self.assertEqual(self.db.query(ServiceTaker).count(), 2)

    def test_cancelled_orders_release_stock_and_have_no_charges(self):
        client_record = self.create_service_taker()
        user_id = client_record["user_id"]
        product_record = portal_create_product(
            ServiceTakerProductCreate(
                sku="CANCEL-SKU",
                name="Cancellation test product",
            ),
            self.request(user_id),
            self.db,
        )
        product = self.db.query(ServiceTakerProduct).filter(
            ServiceTakerProduct.id == product_record["id"]
        ).one()
        product.quantity_on_hand = 5
        self.db.commit()

        portal_order = portal_create_order(
            ServiceTakerOrderCreate(
                recipient_name="Cancelled Customer",
                address_line_1="12 Test Street",
                city="Austin",
                state="TX",
                postal_code="78701",
                country="USA",
                label_source="Hisbenew",
                items=[{"product_id": product.id, "quantity": 1}],
            ),
            self.request(user_id),
            self.db,
        )
        self.assertGreater(portal_order["total_cost"], 0)
        cancelled = portal_cancel_order(
            portal_order["id"],
            self.request(user_id),
            self.db,
        )
        self.assertEqual(cancelled["status"], "Cancelled")
        for field in (
            "shipping_cost",
            "pick_pack_cost",
            "label_cost",
            "other_cost",
            "total_cost",
        ):
            self.assertEqual(cancelled[field], 0)
        self.db.refresh(product)
        self.assertEqual(product.reserved_quantity, 0)

        admin_order = portal_create_order(
            ServiceTakerOrderCreate(
                recipient_name="Admin Cancelled Customer",
                address_line_1="14 Test Street",
                city="Austin",
                state="TX",
                postal_code="78701",
                country="USA",
                label_source="Hisbenew",
                items=[{"product_id": product.id, "quantity": 1}],
            ),
            self.request(user_id),
            self.db,
        )
        admin_cancelled = update_order(
            admin_order["id"],
            ServiceTakerOrderAdminUpdate(
                status="Cancelled",
                shipping_cost=12,
                pick_pack_cost=4,
                label_cost=2,
                other_cost=3,
            ),
            self.request(self.admin_id),
            self.db,
        )
        self.assertEqual(admin_cancelled["total_cost"], 0)
        self.assertEqual(admin_cancelled["shipping_cost"], 0)
        self.assertEqual(admin_cancelled["pick_pack_cost"], 0)
        self.assertEqual(admin_cancelled["label_cost"], 0)
        self.assertEqual(admin_cancelled["other_cost"], 0)


if __name__ == "__main__":
    unittest.main()
