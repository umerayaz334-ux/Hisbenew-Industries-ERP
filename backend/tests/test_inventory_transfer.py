import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.main import move_product_stock
from app.models import Product, StockMovement, Supplier


class InventoryTransferTests(unittest.TestCase):
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
                Supplier.__table__,
                StockMovement.__table__,
            ],
        )
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        self.product = Product(
            article_no="MOVE-TEST-1",
            name="Transfer test product",
            factory_stock=10,
            usa_stock=3,
            front_room_stock=2,
            reserved_stock=4,
            low_stock_alert=1,
        )
        self.db.add(self.product)
        self.db.commit()
        self.db.refresh(self.product)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_move_transfers_stock_and_creates_paired_audit_rows(self):
        response = move_product_stock(
            self.product.id,
            "factory_stock",
            "front_room_stock",
            4,
            "USA fulfillment replenishment",
            self.db,
        )

        self.assertEqual(response["factory_stock"], 6)
        self.assertEqual(response["usa_stock"], 3)
        self.assertEqual(response["front_room_stock"], 6)
        self.assertEqual(response["reserved_stock"], 4)
        self.assertEqual(response["available_stock"], 11)

        movements = (
            self.db.query(StockMovement)
            .order_by(StockMovement.id)
            .all()
        )
        self.assertEqual(len(movements), 2)
        self.assertEqual(
            [(movement.stock_type, movement.quantity) for movement in movements],
            [("factory_stock", -4), ("front_room_stock", 4)],
        )
        self.assertEqual(movements[0].source, "PK -> Front Room")
        self.assertEqual(movements[0].reference, movements[1].reference)
        self.assertIn("USA fulfillment replenishment", movements[1].note)

    def test_move_rejects_insufficient_stock_without_changing_balances(self):
        with self.assertRaises(HTTPException) as context:
            move_product_stock(
                self.product.id,
                "factory_stock",
                "usa_stock",
                11,
                None,
                self.db,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.db.refresh(self.product)
        self.assertEqual(self.product.factory_stock, 10)
        self.assertEqual(self.product.usa_stock, 3)
        self.assertEqual(self.db.query(StockMovement).count(), 0)

    def test_move_only_accepts_physical_locations(self):
        with self.assertRaises(HTTPException) as context:
            move_product_stock(
                self.product.id,
                "reserved_stock",
                "usa_stock",
                1,
                None,
                self.db,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(self.db.query(StockMovement).count(), 0)


if __name__ == "__main__":
    unittest.main()
