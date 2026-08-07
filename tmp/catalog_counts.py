import sys
from collections import Counter
sys.path.insert(0, "backend")
from app.database import SessionLocal
from app.models import Product

db = SessionLocal()
try:
    products = db.query(Product).order_by(Product.category, Product.name, Product.article_no).all()
    counts = Counter((product.category or "Uncategorized").strip() or "Uncategorized" for product in products)
finally:
    db.close()
print(f"products={len(products)} categories={len(counts)}")
for category, count in sorted(counts.items(), key=lambda item: (item[0].casefold(), item[1])):
    print(f"{category}: {count}")