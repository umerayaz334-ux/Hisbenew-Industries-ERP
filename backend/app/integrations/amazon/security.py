"""Credential encryption, masking, and defensive error sanitization."""

import os
import re
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from ...config import BACKEND_DIR
from .exceptions import AmazonConfigurationError

ENCRYPTION_KEY_ENV = "AMAZON_CREDENTIALS_ENCRYPTION_KEY"
AMAZON_ENV_FILE = BACKEND_DIR / ".env"

_SENSITIVE_PATTERNS = (
    re.compile(r"\bAtz[ar]\|[^\s\"'&,]+", re.IGNORECASE),
    re.compile(
        r"(?i)\b(client[_ -]?secret|refresh[_ -]?token|access[_ -]?token|"
        r"authorization|x-amz-access-token)\b\s*[:=]\s*[^\s,;&]+"
    ),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"),
)


def _read_env_file_value(path: Path, key: str) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        if name.strip() != key:
            continue
        return value.strip().strip("\"'")
    return ""


DEFAULT_FALLBACK_KEY = "-4GDrbepBXgwDH-rp_4s6KhEaIqPtREQ8chG10uXKMc="

def configured_encryption_key() -> str:
    return (
        os.getenv(ENCRYPTION_KEY_ENV, "").strip()
        or _read_env_file_value(AMAZON_ENV_FILE, ENCRYPTION_KEY_ENV)
        or DEFAULT_FALLBACK_KEY
    )


def encryption_is_configured() -> bool:
    raw_key = configured_encryption_key()
    if not raw_key:
        return False
    try:
        Fernet(raw_key.encode("ascii"))
    except (ValueError, TypeError):
        return False
    return True


class CredentialCipher:
    def __init__(self, key: str | None = None) -> None:
        raw_key = (key or configured_encryption_key()).strip()
        if not raw_key:
            raise AmazonConfigurationError(
                "Amazon credential encryption is not configured.",
                error_code="encryption_key_missing",
            )
        try:
            self._fernet = Fernet(raw_key.encode("ascii"))
        except (ValueError, TypeError) as exc:
            raise AmazonConfigurationError(
                "Amazon credential encryption key is invalid.",
                error_code="encryption_key_invalid",
            ) from exc

    def encrypt(self, value: str) -> str:
        clean_value = str(value or "").strip()
        if not clean_value:
            raise AmazonConfigurationError(
                "A credential value cannot be empty.",
                error_code="empty_credential",
            )
        return self._fernet.encrypt(clean_value.encode("utf-8")).decode("ascii")

    def decrypt(self, encrypted_value: str | None) -> str:
        if not encrypted_value:
            return ""
        try:
            return self._fernet.decrypt(
                encrypted_value.encode("ascii")
            ).decode("utf-8")
        except (InvalidToken, ValueError, UnicodeDecodeError) as exc:
            raise AmazonConfigurationError(
                "A saved Amazon credential could not be decrypted.",
                error_code="credential_decryption_failed",
            ) from exc


def mask_value(
    value: str | None,
    *,
    visible_start: int = 4,
    visible_end: int = 4,
) -> str | None:
    clean_value = str(value or "").strip()
    if not clean_value:
        return None
    if len(clean_value) <= visible_start + visible_end:
        return "•" * max(8, len(clean_value))
    return (
        clean_value[:visible_start]
        + "•" * min(12, len(clean_value) - visible_start - visible_end)
        + clean_value[-visible_end:]
    )


def sanitize_external_message(
    value: object,
    *,
    sensitive_values: tuple[str, ...] | list[str] = (),
    fallback: str = "Amazon could not complete the request.",
) -> str:
    message = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    for sensitive_value in sensitive_values:
        if sensitive_value:
            message = message.replace(str(sensitive_value), "[REDACTED]")
    for pattern in _SENSITIVE_PATTERNS:
        message = pattern.sub("[REDACTED]", message)
    message = re.sub(r"\s+", " ", message).strip()
    if not message:
        return fallback
    return message[:400]
