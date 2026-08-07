import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import HTTPException
from starlette.status import HTTP_401_UNAUTHORIZED

from .config import ACCESS_TOKEN_EXPIRE_MINUTES, SECRET_KEY

HASH_ALGORITHM = "sha256"
HASH_ITERATIONS = 120_000
HASH_PREFIX = "pbkdf2_sha256"
ALLOWED_UPLOAD_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
CONTENT_TYPE_EXTENSION_MAP = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        HASH_ALGORITHM,
        pin.encode("utf-8"),
        salt.encode("utf-8"),
        HASH_ITERATIONS,
    )
    encoded_digest = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"{HASH_PREFIX}${salt}${encoded_digest}"


def verify_pin(pin: str, stored_value: str) -> bool:
    if not stored_value:
        return False

    if stored_value.startswith(f"{HASH_PREFIX}$"):
        parts = stored_value.split("$", 2)
        if len(parts) != 3:
            return False
        _, salt, encoded_digest = parts
        try:
            expected_digest = base64.urlsafe_b64decode(encoded_digest.encode("ascii"))
        except Exception:
            return False
        actual_digest = hashlib.pbkdf2_hmac(
            HASH_ALGORITHM,
            pin.encode("utf-8"),
            salt.encode("utf-8"),
            HASH_ITERATIONS,
        )
        return hmac.compare_digest(actual_digest, expected_digest)

    # Legacy storage: plain PINs are supported for a short migration period.
    return secrets.compare_digest(pin, stored_value)


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_access_token(
    subject: int,
    expires_delta: timedelta | None = None,
    never_expires: bool = False,
) -> str:
    payload = {
        "sub": str(subject),
    }
    if never_expires:
        payload["exp"] = None
        payload["never_expires"] = True
    else:
        if expires_delta is None:
            expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        expires_at = datetime.utcnow() + expires_delta
        payload["exp"] = expires_at.isoformat()

    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_segment = base64url_encode(payload_bytes)
    signature = hmac.new(
        SECRET_KEY.encode("utf-8"),
        payload_segment.encode("ascii"),
        hashlib.sha256,
    ).digest()
    signature_segment = base64url_encode(signature)
    return f"{payload_segment}.{signature_segment}"


def decode_access_token(token: str) -> dict:
    try:
        payload_segment, signature_segment = token.split(".")
    except ValueError:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expected_signature = hmac.new(
        SECRET_KEY.encode("utf-8"),
        payload_segment.encode("ascii"),
        hashlib.sha256,
    ).digest()

    try:
        signature = base64url_decode(signature_segment)
    except Exception:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not hmac.compare_digest(expected_signature, signature):
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload_bytes = base64url_decode(payload_segment)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("never_expires") is True:
        return payload

    token_exp = payload.get("exp")
    if not token_exp:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Authentication token missing expiry.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        expires_at = datetime.fromisoformat(token_exp)
    except ValueError:
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Authentication token expiry is invalid.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


def sanitize_upload_filename(filename: str) -> str:
    safe_name = Path(filename or "upload").name
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", safe_name)
    if not safe_name or safe_name.startswith("."):
        safe_name = f"upload-{secrets.token_hex(8)}"
    return safe_name


def validate_upload_extension(filename: str, content_type: str | None) -> str:
    ext = Path(filename).suffix.lower()
    if ext in ALLOWED_UPLOAD_EXTENSIONS:
        return ext
    if content_type:
        mapped = CONTENT_TYPE_EXTENSION_MAP.get(content_type.lower())
        if mapped:
            return mapped
    raise HTTPException(
        status_code=400,
        detail="Unsupported upload file type. Allowed image types are PNG, JPG, JPEG, GIF, WEBP, and SVG.",
    )
