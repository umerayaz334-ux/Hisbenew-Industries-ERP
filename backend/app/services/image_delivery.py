"""Safe, atomic image delivery shared by every uploaded-image URL."""
import hashlib
import os
from pathlib import Path
import tempfile
import threading

_CACHE_LOCKS = [threading.Lock() for _ in range(64)]
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps


def serve_upload(upload_root, cache_root, file_path, request, width=None):
    root = Path(upload_root).resolve()
    source = (root / file_path).resolve()
    if not source.is_relative_to(root) or not source.is_file():
        raise HTTPException(404, "File not found")
    headers = {"Cache-Control": "public, max-age=86400"}
    if source.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        return FileResponse(source, headers=headers)
    target = max(1, min(width or 1000, 1200))
    stat = source.stat()
    identity = f"{file_path}:{stat.st_mtime_ns}:{stat.st_size}:{target}"
    digest = hashlib.sha256(identity.encode()).hexdigest()
    optimized = Path(cache_root) / f"{digest}.webp"
    temporary = None
    try:
        with _CACHE_LOCKS[int(digest[:8], 16) % len(_CACHE_LOCKS)]:
            if not optimized.is_file():
                optimized.parent.mkdir(parents=True, exist_ok=True)
                with Image.open(source) as original:
                    im = ImageOps.exif_transpose(original)
                    im = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB")
                    im.thumbnail((target, target), Image.Resampling.LANCZOS)
                    with tempfile.NamedTemporaryFile(dir=optimized.parent, suffix=".webp", delete=False) as output:
                        temporary = output.name
                    im.save(temporary, "WEBP", quality=78, method=4)
                    os.replace(temporary, optimized)
                    temporary = None
        etag = f'"{digest}"'
        headers.update({"ETag": etag, "X-Image-Optimized": "true"})
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        return FileResponse(optimized, media_type="image/webp", headers=headers)
    except Exception:
        return FileResponse(source, headers={"Cache-Control": "public, max-age=3600"})
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)
