"""Login with Amazon token exchange with a short-lived in-memory cache."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock
from time import monotonic

import requests

from .constants import LWA_TOKEN_URL, SP_API_USER_AGENT
from .exceptions import (
    AmazonAuthorizationError,
    AmazonConfigurationError,
    AmazonTemporaryError,
)
from .models import AmazonAccount
from .security import CredentialCipher


@dataclass(frozen=True)
class AccessToken:
    value: str
    expires_at: datetime


_token_cache: dict[int, AccessToken] = {}
_token_cache_lock = Lock()


def clear_cached_access_token(account_id: int | None) -> None:
    if account_id is None:
        return
    with _token_cache_lock:
        _token_cache.pop(account_id, None)


def _cached_token(account_id: int) -> AccessToken | None:
    with _token_cache_lock:
        token = _token_cache.get(account_id)
        if token and token.expires_at > datetime.utcnow() + timedelta(seconds=60):
            return token
        _token_cache.pop(account_id, None)
        return None


def get_lwa_access_token(
    account: AmazonAccount,
    *,
    force_refresh: bool = False,
) -> AccessToken:
    if not account.id:
        raise AmazonConfigurationError(
            "Amazon settings must be saved before testing the connection.",
            error_code="account_not_saved",
        )

    if not force_refresh:
        cached = _cached_token(account.id)
        if cached:
            return cached

    cipher = CredentialCipher()
    client_id = cipher.decrypt(account.encrypted_lwa_client_id)
    client_secret = cipher.decrypt(account.encrypted_lwa_client_secret)
    refresh_token = cipher.decrypt(account.encrypted_refresh_token)
    if not client_id or not client_secret or not refresh_token:
        raise AmazonConfigurationError(
            "Amazon client identifier, client secret, and refresh token are required.",
            error_code="credentials_incomplete",
        )

    started_at = monotonic()
    try:
        response = requests.post(
            LWA_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": SP_API_USER_AGENT,
            },
            timeout=(5, 15),
        )
    except requests.Timeout as exc:
        raise AmazonTemporaryError(
            "Amazon authorization timed out. Please try again.",
            error_code="lwa_timeout",
            duration_ms=int((monotonic() - started_at) * 1000),
        ) from exc
    except requests.RequestException as exc:
        raise AmazonTemporaryError(
            "Amazon authorization is temporarily unreachable.",
            error_code="lwa_unreachable",
            duration_ms=int((monotonic() - started_at) * 1000),
        ) from exc

    duration_ms = int((monotonic() - started_at) * 1000)
    request_id = response.headers.get("x-amzn-requestid")
    if response.status_code >= 400:
        error_code = "lwa_authorization_failed"
        try:
            error_code = str(response.json().get("error") or error_code)[:100]
        except (ValueError, AttributeError):
            pass
        if error_code == "invalid_grant":
            message = "Amazon authorization has expired or was revoked."
        elif error_code in {"invalid_client", "unauthorized_client"}:
            message = "Amazon rejected the client credentials."
        elif response.status_code >= 500:
            raise AmazonTemporaryError(
                "Amazon authorization is temporarily unavailable.",
                error_code=error_code,
                http_status=response.status_code,
                amazon_request_id=request_id,
                duration_ms=duration_ms,
            )
        else:
            message = "Amazon authorization failed. Check the saved credentials."
        raise AmazonAuthorizationError(
            message,
            error_code=error_code,
            http_status=response.status_code,
            amazon_request_id=request_id,
            duration_ms=duration_ms,
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise AmazonTemporaryError(
            "Amazon authorization returned an invalid response.",
            error_code="lwa_invalid_response",
            http_status=response.status_code,
            amazon_request_id=request_id,
            duration_ms=duration_ms,
        ) from exc

    token_value = str(body.get("access_token") or "").strip()
    try:
        expires_in = max(120, int(body.get("expires_in") or 3600))
    except (TypeError, ValueError):
        expires_in = 3600
    if not token_value:
        raise AmazonTemporaryError(
            "Amazon authorization did not return an access token.",
            error_code="lwa_access_token_missing",
            http_status=response.status_code,
            amazon_request_id=request_id,
            duration_ms=duration_ms,
        )

    token = AccessToken(
        value=token_value,
        expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
    )
    with _token_cache_lock:
        _token_cache[account.id] = token
    return token
