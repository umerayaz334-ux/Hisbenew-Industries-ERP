"""Restore an authenticated encrypted image archive without replacing existing files."""
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import sys
import urllib.request
import zipfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image


def restore_images(archive_bytes, destination):
    root = Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True)
    restored = skipped = 0
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        for member in archive.infolist():
            relative = PurePosixPath(member.filename)
            target = (root / member.filename).resolve()
            if member.is_dir():
                continue
            if relative.is_absolute() or ".." in relative.parts or not target.is_relative_to(root):
                raise ValueError("Unsafe image path")
            if target.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}:
                raise ValueError("Non-image file in recovery package")
            if target.exists():
                skipped += 1
                continue
            content = archive.read(member)
            with Image.open(io.BytesIO(content)) as image:
                image.verify()
            target.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation never overwrites a file uploaded concurrently.
            try:
                with target.open("xb") as output:
                    output.write(content)
                restored += 1
            except FileExistsError:
                skipped += 1
    return {"restored": restored, "existing_preserved": skipped}


if __name__ == "__main__":
    backend = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(backend))
    from app.config import UPLOAD_DIR
    url = os.environ["IMAGE_RECOVERY_URL"]
    if not url.startswith("https://github.com/umerayaz334-ux/Hisbenew-Industries-ERP/releases/download/"):
        raise ValueError("Unexpected recovery source")
    encrypted = urllib.request.urlopen(url, timeout=120).read()
    if hashlib.sha256(encrypted).hexdigest() != os.environ["IMAGE_RECOVERY_SHA256"]:
        raise ValueError("Recovery package checksum mismatch")
    key = bytes.fromhex(os.environ["IMAGE_RECOVERY_KEY"])
    archive = AESGCM(key).decrypt(encrypted[:12], encrypted[12:], b"hisbenew-image-recovery-v1")
    print("Upload directory:", UPLOAD_DIR)
    print(restore_images(archive, UPLOAD_DIR))
