from pathlib import Path
import fitz

pdf_path = Path("output/pdf/hisbenew-catalog-design-check.pdf")
out_dir = Path("tmp/pdfs/catalog-check-render")
out_dir.mkdir(parents=True, exist_ok=True)
with fitz.open(pdf_path) as document:
    print(f"pages {document.page_count}")
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        out_path = out_dir / f"page-{page_index + 1:02d}.png"
        pixmap.save(out_path)
        print(out_path)