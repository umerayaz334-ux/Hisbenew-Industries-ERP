from pathlib import Path
from PIL import Image, ImageChops
import fitz

pdf_path = Path("output/pdf/hisbenew-catalog-design-check.pdf")
render_dir = Path("tmp/pdfs/catalog-check-render")

with fitz.open(pdf_path) as doc:
    print(f"pdf_pages={doc.page_count}")
    for i, page in enumerate(doc, start=1):
        blocks = page.get_text("dict").get("blocks", [])
        image_blocks = [block for block in blocks if block.get("type") == 1]
        text_blocks = [block for block in blocks if block.get("type") == 0]
        print(f"page={i} text_blocks={len(text_blocks)} image_blocks={len(image_blocks)}")

for path in sorted(render_dir.glob("page-*.png")):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    bg = img.getpixel((6, 6))
    mask = Image.new("RGB", img.size, bg)
    diff = ImageChops.difference(img, mask).convert("L")
    binary = diff.point(lambda p: 255 if p > 10 else 0)
    bbox = binary.getbbox()
    nonblank = sum(1 for value in binary.getdata() if value) / (w * h)

    body = binary.crop((0, int(h * 0.07), w, int(h * 0.94)))
    body_bbox = body.getbbox()
    bottom_gap_px = None
    if body_bbox:
        bottom_gap_px = (int(h * 0.94) - int(h * 0.07)) - body_bbox[3]
    print(
        f"render={path.name} size={w}x{h} bg={bg} nonblank={nonblank:.3f} "
        f"bbox={bbox} body_bottom_gap_px={bottom_gap_px}"
    )