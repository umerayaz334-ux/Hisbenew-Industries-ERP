import io
from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook
from pypdf import PdfReader
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Product, StockMovement, Supplier
from app.product_catalog import (
    ProductCatalogError,
    build_product_catalog_pdf,
    create_catalog_download_token,
    import_faire_products,
    parse_faire_workbook,
    verify_catalog_download_token,
)


MACHINE_HEADERS = [
    "product_name_english",
    "info_status_v2",
    "info_product_type",
    "product_description_english",
    "sku",
    "option_1_name",
    "option_1_value",
    "price_wholesale",
    "price_retail",
    "option_image",
    "product_images",
    "item_weight",
    "item_weight_unit",
    "on_hand_inventory",
]


def faire_workbook_bytes(rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Products"
    sheet.append(["Faire products"])
    sheet.append(["Do not edit machine headers"])
    sheet.append(MACHINE_HEADERS)
    for row in rows:
        sheet.append([row.get(header) for header in MACHINE_HEADERS])
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


class ProductCatalogTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[Product.__table__, Supplier.__table__, StockMovement.__table__],
        )
        self.db = sessionmaker(bind=self.engine)()
        self.temp_directory = tempfile.TemporaryDirectory()
        self.upload_dir = Path(self.temp_directory.name)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp_directory.cleanup()

    def test_parse_and_import_faire_products(self):
        content = faire_workbook_bytes(
            [
                {
                    "product_name_english": "Handmade Chef Knife",
                    "info_status_v2": "Published",
                    "info_product_type": "Kitchen/Utility Knife",
                    "product_description_english": "Hand-forged display-ready knife.",
                    "sku": "KLC-TEST-1",
                    "option_1_name": "Color",
                    "option_1_value": "Rosewood",
                    "price_wholesale": 42.5,
                    "price_retail": 89.99,
                    "item_weight": 2,
                    "item_weight_unit": "lb",
                    "on_hand_inventory": 17,
                }
            ]
        )

        parsed = parse_faire_workbook(content)
        result = import_faire_products(self.db, parsed, self.upload_dir)

        self.assertEqual(result["created"], 1)
        product = self.db.query(Product).one()
        self.assertEqual(product.article_no, "KLC-TEST-1")
        self.assertEqual(product.category, "Kitchen/Utility Knife")
        self.assertEqual(product.options, "Color: Rosewood")
        self.assertAlmostEqual(product.cost_price, 42.5)
        self.assertAlmostEqual(product.selling_price, 89.99)
        self.assertAlmostEqual(product.unit_weight_kg, 0.907185, places=6)
        self.assertEqual(product.usa_stock, 17)
        movement = self.db.query(StockMovement).one()
        self.assertEqual(movement.stock_type, "usa_stock")
        self.assertEqual(movement.quantity, 17)

    def test_existing_inventory_is_preserved_during_update(self):
        existing = Product(
            article_no="KLC-TEST-2",
            name="Old Name",
            category="Old Category",
            factory_stock=12,
            usa_stock=34,
            front_room_stock=5,
            reserved_stock=3,
            cost_price=1,
            selling_price=2,
            unit_weight_kg=0,
            low_stock_alert=10,
            workflow_required=True,
        )
        self.db.add(existing)
        self.db.commit()

        parsed = parse_faire_workbook(
            faire_workbook_bytes(
                [
                    {
                        "product_name_english": "Updated Name",
                        "info_status_v2": "Published",
                        "info_product_type": "Knife Set",
                        "sku": "klc-test-2",
                        "price_wholesale": "$55.00",
                        "price_retail": "$110.00",
                        "on_hand_inventory": 999,
                    }
                ]
            )
        )
        result = import_faire_products(self.db, parsed, self.upload_dir)

        self.assertEqual(result["updated"], 1)
        self.db.refresh(existing)
        self.assertEqual(existing.name, "Updated Name")
        self.assertEqual(existing.category, "Knife Set")
        self.assertEqual(existing.factory_stock, 12)
        self.assertEqual(existing.usa_stock, 34)
        self.assertEqual(existing.front_room_stock, 5)
        self.assertEqual(existing.reserved_stock, 3)
        self.assertAlmostEqual(existing.cost_price, 55)
        self.assertAlmostEqual(existing.selling_price, 110)

    def test_pdf_contains_category_sku_and_both_prices(self):
        product = Product(
            article_no="PDF-SKU-1",
            name="Artisan Damascus Chef Knife",
            category="Kitchen Knives",
            cost_price=39.99,
            selling_price=79.98,
        )
        pdf_content = build_product_catalog_pdf([product], self.upload_dir)

        reader = PdfReader(io.BytesIO(pdf_content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertGreaterEqual(len(reader.pages), 2)
        self.assertIn("KITCHEN KNIVES", text)
        self.assertIn("SKU PDF-SKU-1", text)
        self.assertIn("WHOLESALE", text)
        self.assertIn("MSRP", text)
        self.assertIn("$39.99", text)
        self.assertIn("$79.98", text)

    def test_invalid_workbook_is_rejected(self):
        with self.assertRaises(ProductCatalogError):
            parse_faire_workbook(b"not an xlsx workbook")

    def test_catalog_download_token_is_scoped_and_signed(self):
        token = create_catalog_download_token(42)
        self.assertEqual(verify_catalog_download_token(token), 42)
        with self.assertRaises(ProductCatalogError):
            verify_catalog_download_token(f"{token[:-1]}x")


if __name__ == "__main__":
    unittest.main()
