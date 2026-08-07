"""Amazon account persistence and public response helpers."""

import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ...models import ActivityLog, User
from .constants import (
    CONNECTION_CONNECTED,
    CONNECTION_DISABLED,
    CONNECTION_MISSING_CREDENTIALS,
    CONNECTION_NOT_CONNECTED,
    DEFAULT_ACCOUNT_NAME,
    DEFAULT_CURRENCY,
    DEFAULT_MARKETPLACE_ID,
    DEFAULT_REGION,
    REGION_ENDPOINTS,
)
from .models import AmazonAccount
from .schemas import AmazonSettingsResponse, AmazonSettingsUpdate
from .security import (
    CredentialCipher,
    encryption_is_configured,
    mask_value,
)

_CREDENTIAL_INPUTS = {
    "client_identifier": "encrypted_lwa_client_id",
    "client_secret": "encrypted_lwa_client_secret",
    "refresh_token": "encrypted_refresh_token",
    "seller_id": "encrypted_seller_id",
}


def get_amazon_account(db: Session) -> AmazonAccount | None:
    return db.query(AmazonAccount).order_by(AmazonAccount.id.asc()).first()


def credentials_complete(account: AmazonAccount | None) -> bool:
    return bool(
        account
        and account.encrypted_lwa_client_id
        and account.encrypted_lwa_client_secret
        and account.encrypted_refresh_token
        and account.encrypted_seller_id
        and account.app_id
    )


def _masked_encrypted_value(
    encrypted_value: str | None,
    *,
    visible_start: int = 4,
    visible_end: int = 4,
) -> str | None:
    if not encrypted_value:
        return None
    try:
        value = CredentialCipher().decrypt(encrypted_value)
    except Exception:
        return "Saved (encrypted)"
    return mask_value(
        value,
        visible_start=visible_start,
        visible_end=visible_end,
    )


def public_amazon_settings(
    account: AmazonAccount | None,
) -> AmazonSettingsResponse:
    if not account:
        return AmazonSettingsResponse(
            encryption_key_configured=encryption_is_configured()
        )
    auto_sync_next_run_at = None
    if (
        account.auto_sync_enabled
        and account.is_active
        and account.connection_status == CONNECTION_CONNECTED
    ):
        auto_sync_next_run_at = (
            account.auto_sync_last_started_at
            + timedelta(minutes=max(5, int(account.auto_sync_interval_minutes or 15)))
            if account.auto_sync_last_started_at
            else datetime.utcnow()
        )
    return AmazonSettingsResponse(
        id=account.id,
        account_name=account.account_name,
        marketplace_id=account.marketplace_id,
        region=account.region,
        endpoint=account.endpoint,
        currency=account.currency,
        is_active=bool(account.is_active),
        connection_status=account.connection_status,
        sanitized_last_error=account.sanitized_last_error,
        authorization_date=account.authorization_date,
        last_connection_test=account.last_connection_test,
        last_successful_connection=account.last_successful_connection,
        last_failed_connection=account.last_failed_connection,
        last_successful_sync=account.last_successful_sync,
        auto_sync_enabled=bool(account.auto_sync_enabled),
        auto_sync_interval_minutes=max(
            5, int(account.auto_sync_interval_minutes or 15)
        ),
        auto_sync_last_started_at=account.auto_sync_last_started_at,
        auto_sync_last_finished_at=account.auto_sync_last_finished_at,
        auto_sync_next_run_at=auto_sync_next_run_at,
        auto_sync_last_error=account.auto_sync_last_error,
        lwa_secret_rotation_due_date=account.lwa_secret_rotation_due_date,
        client_identifier_saved=bool(account.encrypted_lwa_client_id),
        client_identifier_masked=_masked_encrypted_value(
            account.encrypted_lwa_client_id
        ),
        client_secret_saved=bool(account.encrypted_lwa_client_secret),
        app_id_saved=bool(account.app_id),
        app_id_masked=mask_value(account.app_id),
        refresh_token_saved=bool(account.encrypted_refresh_token),
        seller_id_saved=bool(account.encrypted_seller_id),
        seller_id_masked=_masked_encrypted_value(account.encrypted_seller_id),
        credentials_complete=credentials_complete(account),
        encryption_key_configured=encryption_is_configured(),
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def add_amazon_audit(
    db: Session,
    *,
    user: User,
    action: str,
    summary: str,
    account_id: int | None,
    detail: dict | None = None,
    request_method: str,
    request_path: str,
) -> None:
    safe_detail = json.dumps(detail, separators=(",", ":"), sort_keys=True) if detail else None
    db.add(
        ActivityLog(
            actor_user_id=user.id,
            actor_user_name=user.username or user.name,
            action=action,
            entity_type="amazon account",
            entity_id=str(account_id) if account_id is not None else None,
            summary=summary,
            detail=safe_detail,
            page="Amazon Settings",
            request_method=request_method,
            request_path=request_path,
            created_at=datetime.utcnow(),
        )
    )


def update_amazon_account(
    db: Session,
    *,
    payload: AmazonSettingsUpdate,
    user: User,
) -> tuple[AmazonAccount, list[str], bool]:
    account = get_amazon_account(db)
    created = account is None
    if account is None:
        account = AmazonAccount(
            account_name=DEFAULT_ACCOUNT_NAME,
            marketplace_id=DEFAULT_MARKETPLACE_ID,
            region=DEFAULT_REGION,
            endpoint=REGION_ENDPOINTS[DEFAULT_REGION],
            currency=DEFAULT_CURRENCY,
            created_by_user_id=user.id,
            connection_status=CONNECTION_MISSING_CREDENTIALS,
        )
        db.add(account)

    changed_fields: list[str] = []
    credential_fields_updated: list[str] = []
    cipher = None
    for input_name, model_name in _CREDENTIAL_INPUTS.items():
        value = getattr(payload, input_name)
        if value is None or not value.strip():
            continue
        if cipher is None:
            cipher = CredentialCipher()
        setattr(account, model_name, cipher.encrypt(value))
        credential_fields_updated.append(input_name)

    for field_name in (
        "account_name",
        "marketplace_id",
        "region",
        "endpoint",
        "currency",
        "is_active",
        "lwa_secret_rotation_due_date",
    ):
        next_value = getattr(payload, field_name)
        if getattr(account, field_name) != next_value:
            setattr(account, field_name, next_value)
            changed_fields.append(field_name)

    if payload.app_id:
        clean_app_id = payload.app_id.strip()
        if account.app_id != clean_app_id:
            account.app_id = clean_app_id
            credential_fields_updated.append("app_id")

    now = datetime.utcnow()
    if "refresh_token" in credential_fields_updated:
        account.authorization_date = now
    account.updated_by_user_id = user.id
    account.updated_at = now

    if not account.is_active:
        account.connection_status = CONNECTION_DISABLED
    elif not credentials_complete(account):
        account.connection_status = CONNECTION_MISSING_CREDENTIALS
    elif created or changed_fields or credential_fields_updated:
        account.connection_status = CONNECTION_NOT_CONNECTED
        account.sanitized_last_error = None

    db.flush()
    audit_action = (
        "amazon reauthorized"
        if payload.reauthorize and "refresh_token" in credential_fields_updated
        else "amazon credentials saved"
        if created
        else "amazon settings updated"
    )
    add_amazon_audit(
        db,
        user=user,
        action=audit_action,
        summary=(
            "Reauthorized Amazon Seller Central account"
            if audit_action == "amazon reauthorized"
            else "Saved Amazon Seller Central settings"
            if created
            else "Updated Amazon Seller Central settings"
        ),
        account_id=account.id,
        detail={
            "settings_fields_updated": changed_fields,
            "credential_fields_updated": credential_fields_updated,
        },
        request_method="PUT",
        request_path="/amazon/settings",
    )
    return account, credential_fields_updated, created
