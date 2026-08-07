from pathlib import Path
import fitz

pdf_path = Path("output/pdf/hisbenew-catalog-design-check.pdf")
with fitz.open(pdf_path) as doc:
    print(f"pdf_pages={doc.page_count}")
    product_image_blocks = 0
    for index, page in enumerate(doc, start=1):
        blocks = page.get_text("dict").get("blocks", [])
        image_blocks = [block for block in blocks if block.get("type") == 1]
        text_blocks = [block for block in blocks if block.get("type") == 0]
        if index > 1:
            product_image_blocks += len(image_blocks)
        print(f"page={index} text_blocks={len(text_blocks)} image_blocks={len(image_blocks)}")
    print(f"catalog_product_image_blocks={product_image_blocks}")