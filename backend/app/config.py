import json
import os
import secrets
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent


def env_path(name: str, default: Path) -> Path:
    return Path(os.getenv(name, str(default))).expanduser().resolve()


APP_DATA_DIR = env_path("APP_DATA_DIR", BACKEND_DIR)
STATIC_DIR = env_path("STATIC_DIR", APP_DATA_DIR / "static")
UPLOAD_DIR = STATIC_DIR / "uploads"
FRONTEND_DIST_DIR = env_path(
    "FRONTEND_DIST_DIR",
    PROJECT_DIR / "frontend" / "dist",
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(APP_DATA_DIR / 'hisbenew_industries.db').as_posix()}",
)


def env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


DATABASE_POOL_SIZE = env_int("DATABASE_POOL_SIZE", 10, 1)
DATABASE_MAX_OVERFLOW = env_int("DATABASE_MAX_OVERFLOW", 5, 0)
DATABASE_POOL_TIMEOUT = env_int("DATABASE_POOL_TIMEOUT", 30, 1)
DATABASE_POOL_RECYCLE = env_int("DATABASE_POOL_RECYCLE", 1800, 60)
REDIS_URL = os.getenv("REDIS_URL", "").strip()
REALTIME_REDIS_CHANNEL = os.getenv(
    "REALTIME_REDIS_CHANNEL",
    "hisbenew-erp:realtime",
).strip()

SECRET_KEY_FILE = APP_DATA_DIR / ".secret_key"


def load_secret_key() -> str:
    configured_secret = os.getenv("SECRET_KEY")
    if configured_secret:
        return configured_secret

    try:
        APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
        if SECRET_KEY_FILE.exists():
            stored_secret = SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
            if stored_secret:
                return stored_secret

        generated_secret = secrets.token_urlsafe(32)
        SECRET_KEY_FILE.write_text(generated_secret, encoding="utf-8")
        return generated_secret
    except OSError:
        return secrets.token_urlsafe(32)


SECRET_KEY = load_secret_key()
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

cors_origins = os.getenv("CORS_ALLOW_ORIGINS")
default_origins = [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5173",
    "http://localhost:5174",
]
CORS_ALLOW_ORIGINS = (
    [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
    if cors_origins
    else default_origins
)
CORS_ALLOW_ORIGIN_REGEX = os.getenv(
    "CORS_ALLOW_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|[a-zA-Z0-9-]+(?:\.(?:local|lan))?|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?::\d+)?$",
)


def load_internal_call_ice_servers() -> list[dict]:
    fallback = [
        {"urls": "stun:stun.cloudflare.com:3478"},
        {"urls": "stun:stun.l.google.com:19302"},
    ]
    configured = os.getenv("INTERNAL_CALL_ICE_SERVERS", "").strip()
    if not configured:
        return fallback
    try:
        servers = json.loads(configured)
    except json.JSONDecodeError:
        return fallback
    if not isinstance(servers, list):
        return fallback
    normalized = []
    for server in servers:
        if not isinstance(server, dict) or not server.get("urls"):
            continue
        normalized.append(
            {
                key: server[key]
                for key in ("urls", "username", "credential")
                if server.get(key) is not None
            }
        )
    return normalized or fallback


INTERNAL_CALL_ICE_SERVERS = load_internal_call_ice_servers()
