"""One-time local setup for the Amazon credential encryption key."""

import os
from pathlib import Path

from cryptography.fernet import Fernet

from .security import AMAZON_ENV_FILE, ENCRYPTION_KEY_ENV, configured_encryption_key


def ensure_local_encryption_key(env_file: Path = AMAZON_ENV_FILE) -> str:
    configured = configured_encryption_key()
    if configured:
        try:
            Fernet(configured.encode("ascii"))
        except (TypeError, ValueError) as exc:
            raise RuntimeError(
                f"{ENCRYPTION_KEY_ENV} is configured but invalid."
            ) from exc
        return "already_configured"

    env_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        existing_lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        existing_lines = []

    retained_lines = [
        line
        for line in existing_lines
        if not line.strip().startswith(f"{ENCRYPTION_KEY_ENV}=")
    ]
    generated_key = Fernet.generate_key().decode("ascii")
    retained_lines.append(f"{ENCRYPTION_KEY_ENV}={generated_key}")
    temporary_file = env_file.with_suffix(f"{env_file.suffix}.tmp")
    temporary_file.write_text(
        "\n".join(retained_lines).strip() + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_file, env_file)
    return "created"


if __name__ == "__main__":
    result = ensure_local_encryption_key()
    print(
        "Amazon credential encryption key is ready."
        if result == "created"
        else "Amazon credential encryption key is already configured."
    )
