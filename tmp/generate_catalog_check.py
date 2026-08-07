import sys
from pathlib import Path
sys.path.insert(0, "backend")
from app.database import SessionLocal
from app.models import Product
from app.config import UPLOAD_DIR
from app.product_catalog import build_product_catalog_pdf

db = SessionLocal()
try:
    products = db.query(Product).order_by(Product.category, Product.name, Product.article_no).all()
    pdf_bytes = build_product_catalog_pdf(products, UPLOAD_DIR)
finally:
    db.close()

out_dir = Path("output/pdf")
out_dir.mkdir(parents=True, exist_ok=True)
out_path = out_dir / "hisbenew-catalog-design-check.pdf"
out_path.write_bytes(pdf_bytes)
print(f"wrote {out_path} ({len(pdf_bytes)} bytes, {len(products)} products)")