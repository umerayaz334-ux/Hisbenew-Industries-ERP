import unittest

from fastapi import HTTPException, Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.main import create_fulfillment_inventory_discrepancy
from app.models import (
    FulfillmentBox,
    FulfillmentBoxItem,
    FulfillmentInventoryDiscrepancy,
    FulfillmentShipment,
    Product,
    StockMovement,
    Supplier,
    User,
)
from app.schemas import FulfillmentInventoryDiscrepancyCreate


class FulfillmentDiscrepancyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(
            self.engine,
            tables=[
                Product.__table__,
                User.__table__,
                Supplier.__table__,
                FulfillmentShipment.__table__,
                FulfillmentBox.__table__,
                FulfillmentBoxItem.__table__,
                FulfillmentInventoryDiscrepancy.__table__,
                StockMovement.__table__,
            ],
        )
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        self.product = Product(
            article_no="FUL-DISC-1",
            name="Fulfillment discrepancy product",
            factory_stock=10,
            usa_stock=2,
            front_room_stock=0,
        )
        self.db.add(self.product)
        self.db.flush()
        self.shipment = FulfillmentShipment(
            shipment_no="FS-DISC-1",
            destination_name="USA warehouse",
            source_stock="Factory",
            status="Received",
            carton_count=1,
        )
        self.db.add(self.shipment)
        self.db.flush()
        self.box = FulfillmentBox(
            shipment_id=self.shipment.id,
            box_number="D-01",
            location="Front room",
        )
        self.db.add(self.box)
        self.db.flush()
        self.box_item = FulfillmentBoxItem(
            box_id=self.box.id,
            product_id=self.product.id,
            quantity=6,
            available_quantity=6,
        )
        self.db.add(self.box_item)
        self.db.commit()
        self.db.refresh(self.box_item)

        self.request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/fulfillment/inventory/discrepancies",
                "headers": [],
            }
        )
        self.request.state.user_name = "Inventory Tester"

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def record(self, reason, direction, quantity, reference=None, notes=None):
        return create_fulfillment_inventory_discrepancy(
            FulfillmentInventoryDiscrepancyCreate(
                box_item_id=self.box_item.id,
                reason=reason,
                direction=direction,
                quantity=quantity,
                reference=reference,
                notes=notes,
            ),
            self.request,
            self.db,
        )

    def test_damaged_stock_reduces_box_balance_and_creates_audit(self):
        response = self.record(
            "Damaged",
            "remove",
            2,
            reference="CLAIM-17",
            notes="Cracked handle on receipt",
        )

        self.assertEqual(response["quantity_delta"], -2)
        self.assertEqual(response["available_before"], 6)
        self.assertEqual(response["available_after"], 4)
        self.assertEqual(response["created_by_name"], "Inventory Tester")
        self.db.refresh(self.box_item)
        self.assertEqual(self.box_item.available_quantity, 4)

        movement = self.db.query(StockMovement).one()
        self.assertEqual(movement.movement_type, "Fulfillment Discrepancy")
        self.assertEqual(movement.stock_type, "fulfillment_stock")
        self.assertEqual(movement.quantity, -2)
        self.assertTrue(movement.faulty)
        self.assertEqual(movement.faulty_quantity, 2)

    def test_customer_return_adds_stock_back_to_the_selected_box(self):
        response = self.record(
            "Customer return",
            "add",
            3,
            reference="FO-RETURN-9",
        )

        self.assertEqual(response["quantity_delta"], 3)
        self.assertEqual(response["available_after"], 9)
        self.db.refresh(self.box_item)
        self.assertEqual(self.box_item.available_quantity, 9)

    def test_cannot_remove_more_than_the_box_has_available(self):
        with self.assertRaises(HTTPException) as context:
            self.record("Missing", "remove", 7)

        self.assertEqual(context.exception.status_code, 400)
        self.db.refresh(self.box_item)
        self.assertEqual(self.box_item.available_quantity, 6)
        self.assertEqual(self.db.query(FulfillmentInventoryDiscrepancy).count(), 0)
        self.assertEqual(self.db.query(StockMovement).count(), 0)

    def test_reason_direction_rules_prevent_wrong_stock_effect(self):
        with self.assertRaises(HTTPException) as context:
            self.record("Damaged", "add", 1)

        self.assertEqual(context.exception.status_code, 400)
        self.db.refresh(self.box_item)
        self.assertEqual(self.box_item.available_quantity, 6)


if __name__ == "__main__":
    unittest.main()
