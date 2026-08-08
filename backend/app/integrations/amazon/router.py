"""Admin-only Amazon settings, listing import, and product-mapping API."""

from datetime import date, datetime, timedelta
from time import monotonic

import requests

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...database import SessionLocal
from ...models import Product, User
from .accounts import (
    add_amazon_audit,
    credentials_complete,
    get_amazon_account,
    public_amazon_settings,
    update_amazon_account,
)
from .auth import clear_cached_access_token
from .client import AmazonSpApiClient
from .constants import (
    CONNECTION_CONNECTED,
    CONNECTION_DISABLED,
    CONNECTION_MISSING_CREDENTIALS,
    CONNECTION_TESTING,
    DEFAULT_MARKETPLACE_ID,
    DEFAULT_REGION,
    LWA_TOKEN_URL,
    REGION_ENDPOINTS,
    SELLERS_MARKETPLACE_PARTICIPATIONS_PATH,
    JOB_TYPE_FBA_INVENTORY_SYNC,
    JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
    JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
    JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
    JOB_TYPE_FBA_ORDER_REFRESH,
    JOB_TYPE_FBA_ORDERS_SYNC,
    JOB_TYPE_FINANCE_BALANCE_SYNC,
    JOB_TYPE_FINANCES_SYNC,
    JOB_TYPE_LISTINGS_IMPORT,
    JOB_TYPE_LISTING_SYNC,
    JOB_TYPE_PRICE_SYNC,
)
from .exceptions import AmazonIntegrationError
from .jobs import (
    amazon_job_response,
    enqueue_full_amazon_sync_jobs,
    enqueue_unique_amazon_job,
    process_amazon_job,
)
from .listings import (
    auto_match_unmapped_listings,
    mapping_response,
    query_listing_mappings,
)
from .fba_inventory import (
    ensure_fba_logical_locations,
    fba_inventory_history_response,
    inventory_response,
    query_fba_inventory,
)
from .orders import (
    database_order_response,
    order_status_history_response,
    query_fba_orders,
    retry_order_mapping,
)
from .inbound import (
    confirm_inbound_plan,
    create_inbound_plan,
    get_safe_placement_options,
    label_documents,
    plan_response,
    query_inbound_plans,
    query_inbound_shipments,
    reconcile_inbound_shipment,
    save_tracking_and_departure,
    shipment_response,
    upsert_local_cartons,
)
from .finances import (
    post_settlements_to_accounting,
    profitability_report,
    query_financial_transactions,
    reconciliation_issues,
    settlement_response,
)
from .pricing import (
    create_price_change,
    price_change_response,
    pricing_offer_response,
    pricing_settings_response,
    query_price_changes,
    query_pricing_offers,
    review_price_change,
    update_price_rules,
)
from .models import (
    AmazonApiLog,
    AmazonFbaInventory,
    AmazonFbaInventoryHistory,
    AmazonFbaInboundPlan,
    AmazonFbaShipment,
    AmazonFinancialTransaction,
    AmazonInventoryLocation,
    AmazonOrder,
    AmazonOrderStatusHistory,
    AmazonPriceChange,
    AmazonProductMapping,
    AmazonSettlement,
    AmazonSyncJob,
)
from .schemas import (
    AmazonAutoSyncSettingsUpdate,
    AmazonConnectionStatusResponse,
    AmazonFbaInboundCartonBatch,
    AmazonFbaInboundLabelListResponse,
    AmazonFbaInboundPlanConfirmRequest,
    AmazonFbaInboundPlanCreate,
    AmazonFbaInboundPlanListResponse,
    AmazonFbaInboundPlanResponse,
    AmazonFbaInboundPlacementOptionListResponse,
    AmazonFbaInboundReconcileRequest,
    AmazonFbaInboundReconcileResponse,
    AmazonFbaInboundShipmentListResponse,
    AmazonFbaInboundTrackingResponse,
    AmazonFbaInboundTrackingUpdate,
    AmazonFbaShipmentResponse,
    AmazonBalanceResponse,
    AmazonFinanceSyncRequest,
    AmazonFbaInventoryHistoryResponse,
    AmazonFbaInventoryListResponse,
    AmazonFbaInventoryResponse,
    AmazonFbaInventoryThresholdUpdate,
    AmazonInventoryLocationResponse,
    AmazonListingAutoMatchResponse,
    AmazonListingConnectRequest,
    AmazonListingListResponse,
    AmazonListingResponse,
    AmazonListingSyncSettingsUpdate,
    AmazonOrderIssueListResponse,
    AmazonOrderListResponse,
    AmazonOrderMappingRetryResponse,
    AmazonOrderResponse,
    AmazonOrderStatusHistoryResponse,
    AmazonOrderSyncRequest,
    AmazonPriceBulkSyncRequest,
    AmazonPriceChangeCreate,
    AmazonPriceChangeReview,
    AmazonPricingRuleUpdate,
    AmazonPricingSettingsUpdate,
    AmazonSettingsResponse,
    AmazonSettingsUpdate,
    AmazonSettlementAccountingPostRequest,
    AmazonSyncAllResponse,
    AmazonSyncJobResponse,
    ConfirmAmazonAction,
)
from .security import CredentialCipher, encryption_is_configured, sanitize_external_message

router = APIRouter(prefix="/amazon", tags=["Amazon Seller Central"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_amazon_admin(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = getattr(request.state, "user_id", None)
    user = (
        db.query(User)
        .filter(User.id == user_id, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only administrators can manage Amazon Seller Central settings.",
        )
    return user


def _diagnostic_result(key: str, label: str, status: str, detail: str, **extra) -> dict:
    result = {
        "key": key,
        "label": label,
        "status": status,
        "detail": detail,
    }
    result.update(extra)
    return result


def _probe_amazon_endpoint(key: str, label: str, url: str, *, method: str = "GET") -> dict:
    started_at = monotonic()
    try:
        response = requests.request(
            method,
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "HisbenewIndustriesERP/diagnostics",
            },
            timeout=(4, 8),
        )
    except requests.Timeout as exc:
        return _diagnostic_result(
            key,
            label,
            "failed",
            "The VPS timed out while reaching this Amazon endpoint.",
            duration_ms=int((monotonic() - started_at) * 1000),
            error=sanitize_external_message(exc, fallback="Amazon endpoint timed out."),
        )
    except requests.RequestException as exc:
        return _diagnostic_result(
            key,
            label,
            "failed",
            "The VPS could not reach this Amazon endpoint.",
            duration_ms=int((monotonic() - started_at) * 1000),
            error=sanitize_external_message(exc, fallback="Amazon endpoint unreachable."),
        )

    duration_ms = int((monotonic() - started_at) * 1000)
    status = "ok" if response.status_code < 500 else "warning"
    detail = (
        "The VPS can reach this Amazon endpoint."
        if status == "ok"
        else "Amazon responded, but the endpoint returned a server-side error."
    )
    return _diagnostic_result(
        key,
        label,
        status,
        detail,
        http_status=response.status_code,
        duration_ms=duration_ms,
        amazon_request_id=response.headers.get("x-amzn-requestid"),
    )


def _credential_decryption_check(account) -> dict:
    if not account:
        return _diagnostic_result(
            "credential_decryption",
            "Credential decryption",
            "skipped",
            "Save Amazon settings on this backend first.",
        )
    if not credentials_complete(account):
        return _diagnostic_result(
            "credential_decryption",
            "Credential decryption",
            "skipped",
            "All required Amazon credentials are not saved yet.",
        )
    try:
        cipher = CredentialCipher()
        for value in (
            account.encrypted_lwa_client_id,
            account.encrypted_lwa_client_secret,
            account.encrypted_refresh_token,
            account.encrypted_seller_id,
        ):
            cipher.decrypt(value)
    except AmazonIntegrationError as exc:
        return _diagnostic_result(
            "credential_decryption",
            "Credential decryption",
            "failed",
            "The VPS cannot decrypt the saved Amazon credentials with its current encryption key.",
            error_code=exc.error_code,
        )

    return _diagnostic_result(
        "credential_decryption",
        "Credential decryption",
        "ok",
        "Saved Amazon credentials decrypt successfully on this backend.",
    )


@router.get("/settings/diagnostics")
def amazon_settings_diagnostics(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    checks: list[dict] = []

    try:
        CredentialCipher()
        checks.append(
            _diagnostic_result(
                "encryption_key",
                "Encryption key",
                "ok",
                "Amazon credential encryption key is configured on this backend.",
            )
        )
    except AmazonIntegrationError as exc:
        checks.append(
            _diagnostic_result(
                "encryption_key",
                "Encryption key",
                "failed",
                exc.safe_message,
                error_code=exc.error_code,
            )
        )

    checks.append(
        _diagnostic_result(
            "account_record",
            "Account record",
            "ok" if account else "failed",
            "Amazon settings exist in this backend database."
            if account
            else "No Amazon settings are saved in this backend database.",
        )
    )
    checks.append(
        _diagnostic_result(
            "credentials_complete",
            "Saved credentials",
            "ok" if credentials_complete(account) else "failed",
            "All required encrypted Amazon credentials are saved."
            if credentials_complete(account)
            else "Client identifier, client secret, app ID, refresh token, and seller ID must be saved on this backend.",
        )
    )
    checks.append(_credential_decryption_check(account))

    endpoint = (account.endpoint if account else None) or REGION_ENDPOINTS[DEFAULT_REGION]
    checks.append(
        _probe_amazon_endpoint(
            "lwa_endpoint",
            "LWA token endpoint",
            LWA_TOKEN_URL,
            method="POST",
        )
    )
    checks.append(
        _probe_amazon_endpoint(
            "sp_api_endpoint",
            "SP-API endpoint",
            f"{endpoint.rstrip('/')}{SELLERS_MARKETPLACE_PARTICIPATIONS_PATH}",
        )
    )

    return {
        "server_time": datetime.utcnow().isoformat(),
        "account_saved": bool(account),
        "credentials_complete": credentials_complete(account),
        "encryption_key_configured": encryption_is_configured(),
        "connection_status": account.connection_status if account else CONNECTION_MISSING_CREDENTIALS,
        "last_error": account.sanitized_last_error if account else None,
        "marketplace_id": account.marketplace_id if account else DEFAULT_MARKETPLACE_ID,
        "region": account.region if account else DEFAULT_REGION,
        "endpoint": endpoint,
        "checks": checks,
    }


@router.get("/settings", response_model=AmazonSettingsResponse)
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    return public_amazon_settings(get_amazon_account(db))


@router.put("/settings", response_model=AmazonSettingsResponse)
def save_settings(
    payload: AmazonSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    try:
        account, credential_fields_updated, _ = update_amazon_account(
            db,
            payload=payload,
            user=user,
        )
        db.commit()
        db.refresh(account)
    except AmazonIntegrationError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=exc.safe_message) from exc
    if credential_fields_updated:
        clear_cached_access_token(account.id)
    return public_amazon_settings(account)


@router.patch(
    "/settings/auto-sync",
    response_model=AmazonSettingsResponse,
)
def save_auto_sync_settings(
    payload: AmazonAutoSyncSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Save Amazon settings first.")

    was_enabled = bool(account.auto_sync_enabled)
    account.auto_sync_enabled = payload.enabled
    account.auto_sync_interval_minutes = payload.interval_minutes
    if payload.enabled and not was_enabled:
        account.auto_sync_last_started_at = None
        account.auto_sync_last_error = None
    account.updated_by_user_id = user.id
    account.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon auto sync settings updated",
        summary=(
            f"Enabled Amazon auto sync every {payload.interval_minutes} minutes"
            if payload.enabled
            else "Disabled Amazon auto sync"
        ),
        account_id=account.id,
        detail={
            "enabled": payload.enabled,
            "interval_minutes": payload.interval_minutes,
        },
        request_method="PATCH",
        request_path="/amazon/settings/auto-sync",
    )
    db.commit()
    db.refresh(account)
    return public_amazon_settings(account)


@router.post(
    "/settings/test-connection",
    response_model=AmazonSettingsResponse,
)
def test_connection(
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=400, detail="Save Amazon settings first.")
    if not account.is_active:
        raise HTTPException(
            status_code=400,
            detail="Enable the Amazon connection before testing it.",
        )
    if not credentials_complete(account):
        account.connection_status = CONNECTION_MISSING_CREDENTIALS
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="Save all required Amazon credentials before testing.",
        )

    now = datetime.utcnow()
    account.connection_status = CONNECTION_TESTING
    account.last_connection_test = now
    account.updated_by_user_id = user.id
    db.commit()

    clear_cached_access_token(account.id)
    try:
        result = AmazonSpApiClient(account).test_connection()
    except AmazonIntegrationError as exc:
        safe_message = sanitize_external_message(exc.safe_message)
        failed_at = datetime.utcnow()
        account.connection_status = exc.connection_status
        account.sanitized_last_error = safe_message
        account.last_connection_test = failed_at
        account.last_failed_connection = failed_at
        account.updated_at = failed_at
        db.add(
            AmazonApiLog(
                amazon_account_id=account.id,
                api_name="Sellers API",
                operation="getMarketplaceParticipations",
                http_status=exc.http_status,
                amazon_request_id=exc.amazon_request_id,
                duration_ms=exc.duration_ms,
                success=False,
                error_code=exc.error_code,
                error_message=safe_message,
            )
        )
        add_amazon_audit(
            db,
            user=user,
            action="amazon connection tested",
            summary="Amazon Seller Central connection test failed",
            account_id=account.id,
            detail={
                "success": False,
                "connection_status": account.connection_status,
                "error_code": exc.error_code,
                "http_status": exc.http_status,
                "amazon_request_id": exc.amazon_request_id,
            },
            request_method="POST",
            request_path="/amazon/settings/test-connection",
        )
        db.commit()
        api_status = (
            403
            if exc.connection_status == "Permission Missing"
            else 401
            if exc.connection_status == "Authorization Expired"
            else 502
        )
        raise HTTPException(status_code=api_status, detail=safe_message) from exc

    connected_at = datetime.utcnow()
    account.connection_status = CONNECTION_CONNECTED
    account.sanitized_last_error = None
    account.last_connection_test = connected_at
    account.last_successful_connection = connected_at
    account.updated_at = connected_at
    db.add(
        AmazonApiLog(
            amazon_account_id=account.id,
            api_name="Sellers API",
            operation="getMarketplaceParticipations",
            http_status=result.http_status,
            amazon_request_id=result.amazon_request_id,
            duration_ms=result.duration_ms,
            success=True,
        )
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon connection tested",
        summary="Amazon Seller Central connection test succeeded",
        account_id=account.id,
        detail={
            "success": True,
            "connection_status": CONNECTION_CONNECTED,
            "marketplace_ids": list(result.marketplace_ids),
            "http_status": result.http_status,
            "amazon_request_id": result.amazon_request_id,
        },
        request_method="POST",
        request_path="/amazon/settings/test-connection",
    )
    db.commit()
    db.refresh(account)
    return public_amazon_settings(account)


@router.post("/settings/disconnect", response_model=AmazonSettingsResponse)
def disconnect(
    payload: ConfirmAmazonAction,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required.")
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    account.is_active = False
    account.connection_status = CONNECTION_DISABLED
    account.updated_by_user_id = user.id
    account.updated_at = datetime.utcnow()
    clear_cached_access_token(account.id)
    add_amazon_audit(
        db,
        user=user,
        action="amazon connection disabled",
        summary="Disabled Amazon Seller Central connection",
        account_id=account.id,
        detail={"historical_data_preserved": True},
        request_method="POST",
        request_path="/amazon/settings/disconnect",
    )
    db.commit()
    db.refresh(account)
    return public_amazon_settings(account)


@router.post(
    "/settings/clear-credentials",
    response_model=AmazonSettingsResponse,
)
def clear_credentials(
    payload: ConfirmAmazonAction,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required.")
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    account.encrypted_lwa_client_id = None
    account.encrypted_lwa_client_secret = None
    account.encrypted_refresh_token = None
    account.encrypted_seller_id = None
    account.app_id = None
    account.is_active = False
    account.connection_status = CONNECTION_MISSING_CREDENTIALS
    account.sanitized_last_error = None
    account.authorization_date = None
    account.lwa_secret_rotation_due_date = None
    account.updated_by_user_id = user.id
    account.updated_at = datetime.utcnow()
    clear_cached_access_token(account.id)
    add_amazon_audit(
        db,
        user=user,
        action="amazon credentials cleared",
        summary="Cleared encrypted Amazon Seller Central credentials",
        account_id=account.id,
        detail={"historical_data_preserved": True},
        request_method="POST",
        request_path="/amazon/settings/clear-credentials",
    )
    db.commit()
    db.refresh(account)
    return public_amazon_settings(account)


@router.get(
    "/connection/status",
    response_model=AmazonConnectionStatusResponse,
)
def connection_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonConnectionStatusResponse()
    return AmazonConnectionStatusResponse(
        account_id=account.id,
        connection_status=account.connection_status,
        is_active=bool(account.is_active),
        marketplace_id=account.marketplace_id or DEFAULT_MARKETPLACE_ID,
        region=account.region or DEFAULT_REGION,
        last_connection_test=account.last_connection_test,
        last_successful_connection=account.last_successful_connection,
        last_failed_connection=account.last_failed_connection,
        sanitized_last_error=account.sanitized_last_error,
    )


def _connected_account(db: Session):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=400, detail="Save Amazon settings first.")
    if not account.is_active:
        raise HTTPException(status_code=400, detail="The Amazon connection is disabled.")
    if account.connection_status != CONNECTION_CONNECTED:
        raise HTTPException(
            status_code=409,
            detail="Test and connect the Amazon account before synchronizing listings.",
        )
    return account


def _listing_mapping(
    db: Session,
    *,
    account_id: int,
    mapping_id: int,
) -> AmazonProductMapping:
    mapping = (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.id == mapping_id,
            AmazonProductMapping.amazon_account_id == account_id,
        )
        .first()
    )
    if not mapping:
        raise HTTPException(status_code=404, detail="Amazon listing was not found.")
    return mapping


@router.post(
    "/sync/all",
    response_model=AmazonSyncAllResponse,
    status_code=202,
)
def sync_all_amazon_data(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    """Queue one safe synchronization pass across every Amazon workspace."""
    account = _connected_account(db)
    jobs, created_job_ids = enqueue_full_amazon_sync_jobs(db, account=account)

    add_amazon_audit(
        db,
        user=user,
        action="amazon full synchronization queued",
        summary="Queued synchronization for all Amazon workspaces",
        account_id=account.id,
        detail={
            "job_ids": [job.id for job in jobs],
            "job_types": [job.job_type for job in jobs],
            "queued_count": len(created_job_ids),
            "already_running_count": len(jobs) - len(created_job_ids),
        },
        request_method="POST",
        request_path="/amazon/sync/all",
    )
    db.commit()
    for job in jobs:
        db.refresh(job)
        if job.id in created_job_ids:
            background_tasks.add_task(process_amazon_job, job.id)
    return AmazonSyncAllResponse(
        jobs=[amazon_job_response(job) for job in jobs],
        queued_count=len(created_job_ids),
        already_running_count=len(jobs) - len(created_job_ids),
    )


@router.get(
    "/sync/jobs",
    response_model=list[AmazonSyncJobResponse],
)
def amazon_sync_jobs(
    job_ids: str = Query(min_length=1, max_length=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    try:
        requested_ids = list(
            dict.fromkeys(
                int(value.strip())
                for value in job_ids.split(",")
                if value.strip()
            )
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="Amazon synchronization job IDs must be numbers.",
        ) from exc
    if not requested_ids or len(requested_ids) > 20 or any(
        job_id <= 0 for job_id in requested_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="Provide between 1 and 20 valid Amazon synchronization job IDs.",
        )
    jobs = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == getattr(account, "id", None),
            AmazonSyncJob.id.in_(requested_ids),
        )
        .all()
    )
    jobs_by_id = {job.id: job for job in jobs}
    if len(jobs_by_id) != len(requested_ids):
        raise HTTPException(
            status_code=404,
            detail="One or more Amazon synchronization jobs were not found.",
        )
    return [
        amazon_job_response(jobs_by_id[job_id])
        for job_id in requested_ids
    ]


@router.post(
    "/listings/import",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def import_listings(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_LISTINGS_IMPORT,
        reference_type="amazon account",
        priority=20,
        request_payload={"marketplace_id": account.marketplace_id},
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon listings import queued",
        summary="Queued Amazon listing import",
        account_id=account.id,
        detail={"job_id": job.id, "created": created},
        request_method="POST",
        request_path="/amazon/listings/import",
    )
    db.commit()
    db.refresh(job)
    if created:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.post(
    "/listings/auto-match",
    response_model=AmazonListingAutoMatchResponse,
)
def auto_match_listings(
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    matched, unmatched = auto_match_unmapped_listings(
        db,
        account_id=account.id,
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon listings auto-matched",
        summary="Auto-matched Amazon Seller SKUs to ERP product SKUs",
        account_id=account.id,
        detail={"matched": matched, "unmatched": unmatched},
        request_method="POST",
        request_path="/amazon/listings/auto-match",
    )
    db.commit()
    return AmazonListingAutoMatchResponse(
        matched=matched,
        unmatched=unmatched,
    )


@router.get(
    "/listings/jobs",
    response_model=list[AmazonSyncJobResponse],
)
def listing_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return []
    jobs = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_LISTINGS_IMPORT, JOB_TYPE_LISTING_SYNC)
            ),
        )
        .order_by(AmazonSyncJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [amazon_job_response(job) for job in jobs]


@router.get(
    "/listings/jobs/{job_id}",
    response_model=AmazonSyncJobResponse,
)
def listing_job(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == getattr(account, "id", None),
        )
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Amazon sync job was not found.")
    return amazon_job_response(job)


@router.post(
    "/listings/jobs/{job_id}/retry",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def retry_listing_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == account.id,
        )
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Amazon sync job was not found.")
    if job.status not in {"Failed", "Retrying"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or retrying Amazon jobs can be retried.",
        )
    job.status = "Pending"
    job.next_retry_at = None
    job.completed_at = None
    job.error_code = None
    job.error_message = None
    job.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon listing job retried",
        summary="Retried an Amazon listing synchronization job",
        account_id=account.id,
        detail={"job_id": job.id},
        request_method="POST",
        request_path=f"/amazon/listings/jobs/{job.id}/retry",
    )
    db.commit()
    db.refresh(job)
    background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/listings",
    response_model=AmazonListingListResponse,
)
def get_listings(
    search: str | None = Query(default=None, max_length=200),
    mapping_status: str | None = Query(default=None, pattern="^(mapped|unmapped)$"),
    fulfillment_mode: str | None = Query(default=None, pattern="^(FBA|FBM|BOTH)$"),
    issues_only: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonListingListResponse(offset=offset, limit=limit)
    items, total, summary = query_listing_mappings(
        db,
        account_id=account.id,
        search=search,
        mapping_status=mapping_status,
        fulfillment_mode=fulfillment_mode,
        issues_only=issues_only,
        offset=offset,
        limit=limit,
    )
    return AmazonListingListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        summary=summary,
    )


@router.get(
    "/listings/issues",
    response_model=AmazonListingListResponse,
)
def get_listing_issues(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonListingListResponse(offset=offset, limit=limit)
    items, total, summary = query_listing_mappings(
        db,
        account_id=account.id,
        issues_only=True,
        offset=offset,
        limit=limit,
    )
    return AmazonListingListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        summary=summary,
    )


@router.get(
    "/listings/{mapping_id}",
    response_model=AmazonListingResponse,
)
def get_listing(
    mapping_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=mapping_id,
    )
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping.product_id
        else None
    )
    return mapping_response(mapping, product)


@router.post(
    "/listings/{mapping_id}/connect",
    response_model=AmazonListingResponse,
)
def connect_listing(
    mapping_id: int,
    payload: AmazonListingConnectRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=mapping_id,
    )
    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="ERP product was not found.")
    mapping.product_id = product.id
    mapping.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon listing mapped",
        summary="Connected Amazon Seller SKU to ERP product",
        account_id=account.id,
        detail={
            "mapping_id": mapping.id,
            "seller_sku": mapping.seller_sku,
            "product_id": product.id,
            "erp_sku": product.article_no,
        },
        request_method="POST",
        request_path=f"/amazon/listings/{mapping.id}/connect",
    )
    db.commit()
    db.refresh(mapping)
    return mapping_response(mapping, product)


@router.post(
    "/listings/{mapping_id}/disconnect",
    response_model=AmazonListingResponse,
)
def disconnect_listing(
    mapping_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=mapping_id,
    )
    previous_product_id = mapping.product_id
    mapping.product_id = None
    mapping.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon listing unmapped",
        summary="Disconnected Amazon Seller SKU from ERP product",
        account_id=account.id,
        detail={
            "mapping_id": mapping.id,
            "seller_sku": mapping.seller_sku,
            "previous_product_id": previous_product_id,
        },
        request_method="POST",
        request_path=f"/amazon/listings/{mapping.id}/disconnect",
    )
    db.commit()
    db.refresh(mapping)
    return mapping_response(mapping)


@router.post(
    "/listings/{mapping_id}/sync",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def sync_listing(
    mapping_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=mapping_id,
    )
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_LISTING_SYNC,
        reference_type="amazon product mapping",
        reference_id=mapping.id,
        priority=10,
        request_payload={"mapping_id": mapping.id},
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon listing sync queued",
        summary="Queued Amazon listing refresh",
        account_id=account.id,
        detail={"job_id": job.id, "mapping_id": mapping.id, "created": created},
        request_method="POST",
        request_path=f"/amazon/listings/{mapping.id}/sync",
    )
    db.commit()
    db.refresh(job)
    if created:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.patch(
    "/listings/{mapping_id}/sync-settings",
    response_model=AmazonListingResponse,
)
def update_listing_sync_settings(
    mapping_id: int,
    payload: AmazonListingSyncSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon settings were not found.")
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=mapping_id,
    )
    changed: dict[str, bool] = {}
    for field_name in ("sync_price", "sync_inventory"):
        value = getattr(payload, field_name)
        if value is not None and getattr(mapping, field_name) != value:
            setattr(mapping, field_name, value)
            changed[field_name] = value
    mapping.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon listing sync settings updated",
        summary="Updated Amazon listing synchronization controls",
        account_id=account.id,
        detail={"mapping_id": mapping.id, "changes": changed},
        request_method="PATCH",
        request_path=f"/amazon/listings/{mapping.id}/sync-settings",
    )
    db.commit()
    db.refresh(mapping)
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping.product_id
        else None
    )
    return mapping_response(mapping, product)


def _fba_inventory_row(
    db: Session,
    inventory: AmazonFbaInventory,
) -> dict:
    mapping = (
        db.query(AmazonProductMapping)
        .filter(AmazonProductMapping.id == inventory.product_mapping_id)
        .first()
        if inventory.product_mapping_id
        else None
    )
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping and mapping.product_id
        else None
    )
    return inventory_response(
        inventory,
        mapping=mapping,
        product=product,
    )


@router.post(
    "/fba/inventory/sync",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def sync_fba_inventory_endpoint(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FBA_INVENTORY_SYNC,
        reference_type="amazon account",
        priority=15,
        request_payload={
            "marketplace_id": account.marketplace_id,
            "details": True,
        },
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inventory sync queued",
        summary="Queued Amazon FBA inventory synchronization",
        account_id=account.id,
        detail={"job_id": job.id, "created": created},
        request_method="POST",
        request_path="/amazon/fba/inventory/sync",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/fba/inventory/locations",
    response_model=list[AmazonInventoryLocationResponse],
)
def fba_inventory_locations(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return []
    locations = ensure_fba_logical_locations(db, account_id=account.id)
    db.commit()
    return [
        AmazonInventoryLocationResponse(
            id=location.id,
            location_code=location.location_code,
            location_name=location.location_name,
            category=location.category,
            source_of_truth=location.source_of_truth,
            is_read_only=bool(location.is_read_only),
            is_active=bool(location.is_active),
        )
        for location in locations
    ]


@router.get(
    "/fba/inventory/jobs",
    response_model=list[AmazonSyncJobResponse],
)
def fba_inventory_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return []
    jobs = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type == JOB_TYPE_FBA_INVENTORY_SYNC,
        )
        .order_by(AmazonSyncJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [amazon_job_response(job) for job in jobs]


@router.get(
    "/fba/inventory/jobs/{job_id}",
    response_model=AmazonSyncJobResponse,
)
def fba_inventory_job(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == getattr(account, "id", None),
            AmazonSyncJob.job_type == JOB_TYPE_FBA_INVENTORY_SYNC,
        )
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inventory job was not found.",
        )
    return amazon_job_response(job)


@router.post(
    "/fba/inventory/jobs/{job_id}/retry",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def retry_fba_inventory_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type == JOB_TYPE_FBA_INVENTORY_SYNC,
        )
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inventory job was not found.",
        )
    if job.status not in {"Failed", "Retrying"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or retrying FBA inventory jobs can be retried.",
        )
    job.status = "Pending"
    job.next_retry_at = None
    job.completed_at = None
    job.error_code = None
    job.error_message = None
    job.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inventory job retried",
        summary="Retried an Amazon FBA inventory synchronization job",
        account_id=account.id,
        detail={"job_id": job.id},
        request_method="POST",
        request_path=f"/amazon/fba/inventory/jobs/{job.id}/retry",
    )
    db.commit()
    db.refresh(job)
    background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/fba/inventory",
    response_model=AmazonFbaInventoryListResponse,
)
def get_fba_inventory(
    search: str | None = Query(default=None, max_length=200),
    low_stock_only: bool = False,
    mapped_only: bool = False,
    discrepancies_only: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonFbaInventoryListResponse(offset=offset, limit=limit)
    items, total, summary = query_fba_inventory(
        db,
        account_id=account.id,
        search=search,
        low_stock_only=low_stock_only,
        mapped_only=mapped_only,
        discrepancies_only=discrepancies_only,
        offset=offset,
        limit=limit,
    )
    return AmazonFbaInventoryListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        summary=summary,
    )


@router.get(
    "/fba/inventory/low-stock",
    response_model=AmazonFbaInventoryListResponse,
)
def get_low_fba_inventory(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonFbaInventoryListResponse(offset=offset, limit=limit)
    items, total, summary = query_fba_inventory(
        db,
        account_id=account.id,
        low_stock_only=True,
        offset=offset,
        limit=limit,
    )
    return AmazonFbaInventoryListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        summary=summary,
    )


@router.get(
    "/fba/inventory/discrepancies",
    response_model=AmazonFbaInventoryListResponse,
)
def get_fba_inventory_discrepancies(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonFbaInventoryListResponse(offset=offset, limit=limit)
    items, total, summary = query_fba_inventory(
        db,
        account_id=account.id,
        discrepancies_only=True,
        offset=offset,
        limit=limit,
    )
    return AmazonFbaInventoryListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        summary=summary,
    )


@router.get(
    "/fba/inventory/{inventory_id}/history",
    response_model=list[AmazonFbaInventoryHistoryResponse],
)
def get_fba_inventory_history(
    inventory_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    inventory = (
        db.query(AmazonFbaInventory)
        .filter(
            AmazonFbaInventory.id == inventory_id,
            AmazonFbaInventory.amazon_account_id == getattr(account, "id", None),
        )
        .first()
    )
    if not inventory:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inventory item was not found.",
        )
    history = (
        db.query(AmazonFbaInventoryHistory)
        .filter(AmazonFbaInventoryHistory.fba_inventory_id == inventory.id)
        .order_by(AmazonFbaInventoryHistory.snapshot_at.desc())
        .limit(limit)
        .all()
    )
    return [fba_inventory_history_response(item) for item in history]


@router.patch(
    "/fba/inventory/{inventory_id}/threshold",
    response_model=AmazonFbaInventoryResponse,
)
def update_fba_inventory_threshold(
    inventory_id: int,
    payload: AmazonFbaInventoryThresholdUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    inventory = (
        db.query(AmazonFbaInventory)
        .filter(
            AmazonFbaInventory.id == inventory_id,
            AmazonFbaInventory.amazon_account_id == getattr(account, "id", None),
        )
        .first()
    )
    if not inventory:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inventory item was not found.",
        )
    previous_value = inventory.minimum_fba_quantity
    inventory.minimum_fba_quantity = payload.minimum_fba_quantity
    inventory.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba low stock threshold updated",
        summary="Updated Amazon FBA low-stock threshold",
        account_id=account.id,
        detail={
            "inventory_id": inventory.id,
            "seller_sku": inventory.seller_sku,
            "previous_threshold": previous_value,
            "minimum_fba_quantity": payload.minimum_fba_quantity,
        },
        request_method="PATCH",
        request_path=f"/amazon/fba/inventory/{inventory.id}/threshold",
    )
    db.commit()
    db.refresh(inventory)
    return _fba_inventory_row(db, inventory)


@router.get(
    "/fba/inventory/{seller_sku:path}",
    response_model=list[AmazonFbaInventoryResponse],
)
def get_fba_inventory_by_seller_sku(
    seller_sku: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    inventories = (
        db.query(AmazonFbaInventory)
        .filter(
            AmazonFbaInventory.amazon_account_id == getattr(account, "id", None),
            AmazonFbaInventory.seller_sku == seller_sku,
        )
        .order_by(AmazonFbaInventory.fnsku.asc())
        .all()
    )
    if not inventories:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inventory was not found for this Seller SKU.",
        )
    return [_fba_inventory_row(db, inventory) for inventory in inventories]


def _amazon_order(
    db: Session,
    *,
    account_id: int | None,
    amazon_order_id: str,
) -> AmazonOrder:
    order = (
        db.query(AmazonOrder)
        .filter(
            AmazonOrder.amazon_account_id == account_id,
            AmazonOrder.amazon_order_id == amazon_order_id,
            AmazonOrder.fulfillment_channel == "AMAZON",
        )
        .first()
    )
    if not order:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA order was not found.",
        )
    return order


@router.post(
    "/orders/sync",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def sync_fba_orders_endpoint(
    payload: AmazonOrderSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FBA_ORDERS_SYNC,
        reference_type="amazon account",
        priority=10,
        request_payload={
            "days": payload.days,
            "mode": payload.mode,
            "marketplace_id": account.marketplace_id,
            "fulfilled_by": "AMAZON",
            "pii_requested": False,
        },
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba orders sync queued",
        summary=(
            "Queued incremental Amazon FBA order synchronization"
            if payload.mode == "incremental"
            else "Queued Amazon FBA order historical backfill"
        ),
        account_id=account.id,
        detail={
            "job_id": job.id,
            "created": created,
            "days": payload.days,
            "mode": payload.mode,
            "fulfilled_by": "AMAZON",
        },
        request_method="POST",
        request_path="/amazon/orders/sync",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/orders/jobs",
    response_model=list[AmazonSyncJobResponse],
)
def fba_order_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return []
    jobs = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_FBA_ORDERS_SYNC, JOB_TYPE_FBA_ORDER_REFRESH)
            ),
        )
        .order_by(AmazonSyncJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [amazon_job_response(job) for job in jobs]


@router.get(
    "/orders/jobs/{job_id}",
    response_model=AmazonSyncJobResponse,
)
def fba_order_job(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == getattr(account, "id", None),
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_FBA_ORDERS_SYNC, JOB_TYPE_FBA_ORDER_REFRESH)
            ),
        )
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA order job was not found.",
        )
    return amazon_job_response(job)


@router.post(
    "/orders/jobs/{job_id}/retry",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def retry_fba_order_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_FBA_ORDERS_SYNC, JOB_TYPE_FBA_ORDER_REFRESH)
            ),
        )
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA order job was not found.",
        )
    if job.status not in {"Failed", "Retrying"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or retrying FBA order jobs can be retried.",
        )
    job.status = "Pending"
    job.next_retry_at = None
    job.completed_at = None
    job.error_code = None
    job.error_message = None
    job.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba order job retried",
        summary="Retried an Amazon FBA order synchronization job",
        account_id=account.id,
        detail={"job_id": job.id, "job_type": job.job_type},
        request_method="POST",
        request_path=f"/amazon/orders/jobs/{job.id}/retry",
    )
    db.commit()
    db.refresh(job)
    background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/orders",
    response_model=AmazonOrderListResponse,
)
def get_fba_orders(
    search: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=60),
    mapping_status: str | None = Query(default=None, max_length=40),
    issues_only: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonOrderListResponse(offset=offset, limit=limit)
    items, total, summary = query_fba_orders(
        db,
        account_id=account.id,
        search=search,
        status=status,
        mapping_status=mapping_status,
        issues_only=issues_only,
        offset=offset,
        limit=limit,
    )
    return AmazonOrderListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        summary=summary,
    )


@router.get(
    "/orders/issues",
    response_model=AmazonOrderIssueListResponse,
)
def get_fba_order_issues(
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonOrderIssueListResponse()
    orders, total, summary = query_fba_orders(
        db,
        account_id=account.id,
        issues_only=True,
        limit=limit,
    )
    return AmazonOrderIssueListResponse(
        orders=orders,
        total=total,
        unmapped_item_count=summary["unmapped_item_count"],
    )


@router.get(
    "/orders/{amazon_order_id}/history",
    response_model=list[AmazonOrderStatusHistoryResponse],
)
def get_fba_order_history(
    amazon_order_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    order = _amazon_order(
        db,
        account_id=getattr(account, "id", None),
        amazon_order_id=amazon_order_id,
    )
    history = (
        db.query(AmazonOrderStatusHistory)
        .filter(AmazonOrderStatusHistory.amazon_order_database_id == order.id)
        .order_by(AmazonOrderStatusHistory.changed_at.desc())
        .limit(limit)
        .all()
    )
    return [order_status_history_response(item) for item in history]


@router.post(
    "/orders/{amazon_order_id}/refresh",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def refresh_fba_order_endpoint(
    amazon_order_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    _amazon_order(
        db,
        account_id=account.id,
        amazon_order_id=amazon_order_id,
    )
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FBA_ORDER_REFRESH,
        reference_type="amazon order",
        reference_id=amazon_order_id,
        priority=5,
        request_payload={
            "amazon_order_id": amazon_order_id,
            "pii_requested": False,
        },
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba order refresh queued",
        summary="Queued an Amazon FBA order refresh",
        account_id=account.id,
        detail={
            "job_id": job.id,
            "amazon_order_id": amazon_order_id,
            "created": created,
        },
        request_method="POST",
        request_path=f"/amazon/orders/{amazon_order_id}/refresh",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.post(
    "/orders/{amazon_order_id}/retry-mapping",
    response_model=AmazonOrderMappingRetryResponse,
)
def retry_fba_order_mapping(
    amazon_order_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    order = _amazon_order(
        db,
        account_id=account.id,
        amazon_order_id=amazon_order_id,
    )
    outcome = retry_order_mapping(
        db,
        account_id=account.id,
        order=order,
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba order mapping retried",
        summary="Retried ERP product mapping for an Amazon FBA order",
        account_id=account.id,
        detail={
            "amazon_order_id": amazon_order_id,
            **outcome,
        },
        request_method="POST",
        request_path=f"/amazon/orders/{amazon_order_id}/retry-mapping",
    )
    db.commit()
    return AmazonOrderMappingRetryResponse(
        amazon_order_id=amazon_order_id,
        **outcome,
    )


@router.get(
    "/orders/{amazon_order_id}",
    response_model=AmazonOrderResponse,
)
def get_fba_order(
    amazon_order_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    order = _amazon_order(
        db,
        account_id=getattr(account, "id", None),
        amazon_order_id=amazon_order_id,
    )
    return database_order_response(db, order)


def _inbound_plan(
    db: Session,
    *,
    account_id: int | None,
    plan_database_id: int,
) -> AmazonFbaInboundPlan:
    plan = (
        db.query(AmazonFbaInboundPlan)
        .filter(
            AmazonFbaInboundPlan.id == plan_database_id,
            AmazonFbaInboundPlan.amazon_account_id == account_id,
        )
        .one_or_none()
    )
    if not plan:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inbound plan was not found.",
        )
    return plan


def _inbound_shipment(
    db: Session,
    *,
    account_id: int | None,
    shipment_database_id: int,
) -> AmazonFbaShipment:
    shipment = (
        db.query(AmazonFbaShipment)
        .filter(
            AmazonFbaShipment.id == shipment_database_id,
            AmazonFbaShipment.amazon_account_id == account_id,
        )
        .one_or_none()
    )
    if not shipment:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inbound shipment was not found.",
        )
    return shipment


def _record_inbound_api_call(
    db: Session,
    *,
    account_id: int,
    operation: str,
    success: bool,
    http_status: int | None,
    amazon_request_id: str | None,
    duration_ms: int | None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    db.add(
        AmazonApiLog(
            amazon_account_id=account_id,
            api_name="Fulfillment Inbound API",
            operation=operation,
            http_status=http_status,
            amazon_request_id=amazon_request_id,
            duration_ms=duration_ms,
            success=success,
            error_code=error_code,
            error_message=error_message,
        )
    )


@router.post(
    "/fba/inbound/plans/import",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def import_fba_inbound_plans(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
        reference_type="amazon account",
        priority=10,
        request_payload={
            "marketplace_id": account.marketplace_id,
            "maximum_pages": 4,
            "source_addresses_stored": False,
        },
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound plans import queued",
        summary="Queued Amazon FBA inbound plan import",
        account_id=account.id,
        detail={"job_id": job.id, "created": created},
        request_method="POST",
        request_path="/amazon/fba/inbound/plans/import",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/fba/inbound/jobs",
    response_model=list[AmazonSyncJobResponse],
)
def fba_inbound_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return []
    jobs = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (
                    JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
                    JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
                    JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
                )
            ),
        )
        .order_by(AmazonSyncJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [amazon_job_response(job) for job in jobs]


@router.get(
    "/fba/inbound/jobs/{job_id}",
    response_model=AmazonSyncJobResponse,
)
def fba_inbound_job(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == getattr(account, "id", None),
            AmazonSyncJob.job_type.in_(
                (
                    JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
                    JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
                    JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
                )
            ),
        )
        .one_or_none()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inbound job was not found.",
        )
    return amazon_job_response(job)


@router.post(
    "/fba/inbound/jobs/{job_id}/retry",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def retry_fba_inbound_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (
                    JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
                    JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
                    JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
                )
            ),
        )
        .one_or_none()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon FBA inbound job was not found.",
        )
    if job.status not in {"Failed", "Retrying"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or retrying FBA inbound jobs can be retried.",
        )
    job.status = "Pending"
    job.next_retry_at = None
    job.completed_at = None
    job.error_code = None
    job.error_message = None
    job.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound job retried",
        summary="Retried an Amazon FBA inbound synchronization job",
        account_id=account.id,
        detail={"job_id": job.id, "job_type": job.job_type},
        request_method="POST",
        request_path=f"/amazon/fba/inbound/jobs/{job.id}/retry",
    )
    db.commit()
    db.refresh(job)
    background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.post(
    "/fba/inbound/plans",
    response_model=AmazonFbaInboundPlanResponse,
    status_code=201,
)
def create_fba_inbound_plan(
    payload: AmazonFbaInboundPlanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    try:
        plan, result = create_inbound_plan(
            db,
            account=account,
            plan_name=payload.plan_name,
            source_warehouse_id=payload.source_warehouse_id,
            source_address_reference=payload.source_address_reference,
            source_address=payload.source_address.amazon_payload(),
            packing_type=payload.packing_type,
            item_requests=[
                item.model_dump() for item in payload.items
            ],
        )
    except AmazonIntegrationError as exc:
        db.rollback()
        safe_message = sanitize_external_message(exc.safe_message)
        _record_inbound_api_call(
            db,
            account_id=account.id,
            operation="createInboundPlan",
            success=False,
            http_status=exc.http_status,
            amazon_request_id=exc.amazon_request_id,
            duration_ms=exc.duration_ms,
            error_code=exc.error_code,
            error_message=safe_message,
        )
        db.commit()
        raise HTTPException(status_code=502, detail=safe_message) from exc
    _record_inbound_api_call(
        db,
        account_id=account.id,
        operation="createInboundPlan",
        success=True,
        http_status=result.http_status,
        amazon_request_id=result.amazon_request_id,
        duration_ms=result.duration_ms,
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound plan created",
        summary="Created an FBA inbound plan in Amazon Seller Central",
        account_id=account.id,
        detail={
            "plan_database_id": plan.id,
            "item_count": len(payload.items),
            "planned_quantity": sum(item.quantity for item in payload.items),
            "source_address_stored": False,
        },
        request_method="POST",
        request_path="/amazon/fba/inbound/plans",
    )
    db.commit()
    db.refresh(plan)
    return plan_response(db, plan)


@router.get(
    "/fba/inbound/plans",
    response_model=AmazonFbaInboundPlanListResponse,
)
def get_fba_inbound_plans(
    search: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=60),
    issues_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonFbaInboundPlanListResponse()
    rows, summary = query_inbound_plans(
        db,
        account_id=account.id,
        search=search,
        status=status,
        issues_only=issues_only,
    )
    return AmazonFbaInboundPlanListResponse(
        items=rows,
        total=len(rows),
        summary=summary,
    )


@router.get(
    "/fba/inbound/reconciliation",
    response_model=AmazonFbaInboundShipmentListResponse,
)
def get_fba_inbound_reconciliation(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonFbaInboundShipmentListResponse()
    rows = query_inbound_shipments(db, account_id=account.id)
    issues = [row for row in rows if row["issue_count"]]
    return AmazonFbaInboundShipmentListResponse(
        items=issues,
        total=len(issues),
    )


@router.get(
    "/fba/inbound/plans/{plan_database_id}/options",
    response_model=AmazonFbaInboundPlacementOptionListResponse,
)
def get_fba_inbound_plan_options(
    plan_database_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    plan = _inbound_plan(
        db,
        account_id=account.id,
        plan_database_id=plan_database_id,
    )
    try:
        options, request_id, status_code, duration_ms = (
            get_safe_placement_options(account=account, plan=plan)
        )
    except AmazonIntegrationError as exc:
        safe_message = sanitize_external_message(exc.safe_message)
        _record_inbound_api_call(
            db,
            account_id=account.id,
            operation="listPlacementOptions",
            success=False,
            http_status=exc.http_status,
            amazon_request_id=exc.amazon_request_id,
            duration_ms=exc.duration_ms,
            error_code=exc.error_code,
            error_message=safe_message,
        )
        db.commit()
        raise HTTPException(status_code=502, detail=safe_message) from exc
    _record_inbound_api_call(
        db,
        account_id=account.id,
        operation="listPlacementOptions",
        success=True,
        http_status=status_code,
        amazon_request_id=request_id,
        duration_ms=duration_ms,
    )
    db.commit()
    return AmazonFbaInboundPlacementOptionListResponse(items=options)


@router.post(
    "/fba/inbound/plans/{plan_database_id}/confirm",
    response_model=AmazonFbaInboundPlanResponse,
)
def confirm_fba_inbound_plan(
    plan_database_id: int,
    payload: AmazonFbaInboundPlanConfirmRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    plan = _inbound_plan(
        db,
        account_id=account.id,
        plan_database_id=plan_database_id,
    )
    try:
        result = confirm_inbound_plan(
            db,
            account=account,
            plan=plan,
            placement_option_id=payload.placement_option_id,
        )
    except AmazonIntegrationError as exc:
        db.rollback()
        safe_message = sanitize_external_message(exc.safe_message)
        _record_inbound_api_call(
            db,
            account_id=account.id,
            operation="confirmPlacementOption",
            success=False,
            http_status=exc.http_status,
            amazon_request_id=exc.amazon_request_id,
            duration_ms=exc.duration_ms,
            error_code=exc.error_code,
            error_message=safe_message,
        )
        db.commit()
        raise HTTPException(status_code=502, detail=safe_message) from exc
    _record_inbound_api_call(
        db,
        account_id=account.id,
        operation="confirmPlacementOption",
        success=True,
        http_status=result.http_status,
        amazon_request_id=result.amazon_request_id,
        duration_ms=result.duration_ms,
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound placement confirmed",
        summary="Confirmed an Amazon FBA inbound placement option",
        account_id=account.id,
        detail={"plan_database_id": plan.id},
        request_method="POST",
        request_path=(
            f"/amazon/fba/inbound/plans/{plan.id}/confirm"
        ),
    )
    db.commit()
    db.refresh(plan)
    return plan_response(db, plan)


@router.post(
    "/fba/inbound/plans/{plan_database_id}/sync",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def sync_fba_inbound_plan_endpoint(
    plan_database_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    plan = _inbound_plan(
        db,
        account_id=account.id,
        plan_database_id=plan_database_id,
    )
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
        reference_type="inbound plan",
        reference_id=plan.inbound_plan_id,
        priority=10,
        request_payload={"plan_database_id": plan.id},
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound plan sync queued",
        summary="Queued Amazon FBA inbound plan synchronization",
        account_id=account.id,
        detail={"job_id": job.id, "plan_database_id": plan.id},
        request_method="POST",
        request_path=f"/amazon/fba/inbound/plans/{plan.id}/sync",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/fba/inbound/plans/{plan_database_id}",
    response_model=AmazonFbaInboundPlanResponse,
)
def get_fba_inbound_plan(
    plan_database_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    plan = _inbound_plan(
        db,
        account_id=getattr(account, "id", None),
        plan_database_id=plan_database_id,
    )
    return plan_response(db, plan)


@router.get(
    "/fba/inbound/shipments",
    response_model=AmazonFbaInboundShipmentListResponse,
)
def get_fba_inbound_shipments(
    search: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=60),
    discrepancies_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return AmazonFbaInboundShipmentListResponse()
    rows = query_inbound_shipments(
        db,
        account_id=account.id,
        search=search,
        status=status,
        discrepancies_only=discrepancies_only,
    )
    return AmazonFbaInboundShipmentListResponse(
        items=rows,
        total=len(rows),
    )


@router.post(
    "/fba/inbound/shipments/{shipment_database_id}/refresh",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def refresh_fba_inbound_shipment_endpoint(
    shipment_database_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    shipment = _inbound_shipment(
        db,
        account_id=account.id,
        shipment_database_id=shipment_database_id,
    )
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
        reference_type="inbound shipment",
        reference_id=shipment.amazon_shipment_id,
        priority=10,
        request_payload={"shipment_database_id": shipment.id},
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound shipment refresh queued",
        summary="Queued Amazon FBA inbound shipment refresh",
        account_id=account.id,
        detail={"job_id": job.id, "shipment_database_id": shipment.id},
        request_method="POST",
        request_path=(
            f"/amazon/fba/inbound/shipments/{shipment.id}/refresh"
        ),
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.put(
    "/fba/inbound/shipments/{shipment_database_id}/cartons",
    response_model=AmazonFbaShipmentResponse,
)
def save_fba_inbound_cartons(
    shipment_database_id: int,
    payload: AmazonFbaInboundCartonBatch,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    shipment = _inbound_shipment(
        db,
        account_id=account.id,
        shipment_database_id=shipment_database_id,
    )
    saved = upsert_local_cartons(
        db,
        shipment=shipment,
        cartons=[carton.model_dump() for carton in payload.cartons],
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound cartons saved",
        summary="Saved FBA inbound carton details",
        account_id=account.id,
        detail={
            "shipment_database_id": shipment.id,
            "carton_count": len(saved),
        },
        request_method="PUT",
        request_path=(
            f"/amazon/fba/inbound/shipments/{shipment.id}/cartons"
        ),
    )
    db.commit()
    db.refresh(shipment)
    return shipment_response(db, shipment)


@router.put(
    "/fba/inbound/shipments/{shipment_database_id}/tracking",
    response_model=AmazonFbaInboundTrackingResponse,
)
def save_fba_inbound_tracking(
    shipment_database_id: int,
    payload: AmazonFbaInboundTrackingUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    shipment = _inbound_shipment(
        db,
        account_id=account.id,
        shipment_database_id=shipment_database_id,
    )
    try:
        units_moved, request_id, status_code, duration_ms = (
            save_tracking_and_departure(
                db,
                account=account,
                shipment=shipment,
                carrier_name=payload.carrier_name,
                tracking_number=payload.tracking_number,
                mark_shipped=payload.mark_shipped,
                submit_to_amazon=payload.submit_to_amazon,
                created_by_user_id=user.id,
            )
        )
    except AmazonIntegrationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=sanitize_external_message(exc.safe_message),
        ) from exc
    if payload.submit_to_amazon:
        _record_inbound_api_call(
            db,
            account_id=account.id,
            operation="updateShipmentTrackingDetails",
            success=True,
            http_status=status_code,
            amazon_request_id=request_id,
            duration_ms=duration_ms,
        )
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound tracking saved",
        summary="Saved FBA inbound shipment tracking",
        account_id=account.id,
        detail={
            "shipment_database_id": shipment.id,
            "marked_shipped": payload.mark_shipped,
            "submitted_to_amazon": payload.submit_to_amazon,
            "units_moved": units_moved,
        },
        request_method="PUT",
        request_path=(
            f"/amazon/fba/inbound/shipments/{shipment.id}/tracking"
        ),
    )
    db.commit()
    db.refresh(shipment)
    return AmazonFbaInboundTrackingResponse(
        shipment=shipment_response(db, shipment),
        units_moved_to_transit=units_moved,
        submitted_to_amazon=payload.submit_to_amazon,
    )


@router.post(
    "/fba/inbound/shipments/{shipment_database_id}/reconcile",
    response_model=AmazonFbaInboundReconcileResponse,
)
def reconcile_fba_inbound_shipment_endpoint(
    shipment_database_id: int,
    payload: AmazonFbaInboundReconcileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    shipment = _inbound_shipment(
        db,
        account_id=account.id,
        shipment_database_id=shipment_database_id,
    )
    try:
        movements_created, discrepancy_quantity = (
            reconcile_inbound_shipment(
                db,
                account=account,
                shipment=shipment,
                item_updates=[item.model_dump() for item in payload.items],
                created_by_user_id=user.id,
                note=payload.note,
            )
        )
    except AmazonIntegrationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=sanitize_external_message(exc.safe_message),
        ) from exc
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound shipment reconciled",
        summary="Recorded append-only FBA inbound reconciliation movements",
        account_id=account.id,
        detail={
            "shipment_database_id": shipment.id,
            "movements_created": movements_created,
            "discrepancy_quantity": discrepancy_quantity,
        },
        request_method="POST",
        request_path=(
            f"/amazon/fba/inbound/shipments/{shipment.id}/reconcile"
        ),
    )
    db.commit()
    db.refresh(shipment)
    return AmazonFbaInboundReconcileResponse(
        shipment=shipment_response(db, shipment),
        movements_created=movements_created,
        discrepancy_quantity=discrepancy_quantity,
    )


@router.get(
    "/fba/inbound/shipments/{shipment_database_id}/labels",
    response_model=AmazonFbaInboundLabelListResponse,
)
def get_fba_inbound_labels(
    shipment_database_id: int,
    label_type: str = Query(default="ITEM", pattern="^(ITEM|BOX)$"),
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    shipment = _inbound_shipment(
        db,
        account_id=account.id,
        shipment_database_id=shipment_database_id,
    )
    try:
        documents, request_id, status_code, duration_ms = label_documents(
            db,
            account=account,
            shipment=shipment,
            label_type=label_type,
        )
    except AmazonIntegrationError as exc:
        safe_message = sanitize_external_message(exc.safe_message)
        _record_inbound_api_call(
            db,
            account_id=account.id,
            operation=(
                "createMarketplaceItemLabels"
                if label_type == "ITEM"
                else "getLabels"
            ),
            success=False,
            http_status=exc.http_status,
            amazon_request_id=exc.amazon_request_id,
            duration_ms=exc.duration_ms,
            error_code=exc.error_code,
            error_message=safe_message,
        )
        db.commit()
        raise HTTPException(status_code=502, detail=safe_message) from exc
    _record_inbound_api_call(
        db,
        account_id=account.id,
        operation=(
            "createMarketplaceItemLabels"
            if label_type == "ITEM"
            else "getLabels"
        ),
        success=True,
        http_status=status_code,
        amazon_request_id=request_id,
        duration_ms=duration_ms,
    )
    add_amazon_audit(
        db,
        user=user,
        action="amazon fba inbound labels retrieved",
        summary="Retrieved temporary Amazon FBA inbound label documents",
        account_id=account.id,
        detail={
            "shipment_database_id": shipment.id,
            "label_type": label_type,
            "document_count": len(documents),
            "download_urls_stored": False,
        },
        request_method="GET",
        request_path=(
            f"/amazon/fba/inbound/shipments/{shipment.id}/labels"
        ),
    )
    db.commit()
    return AmazonFbaInboundLabelListResponse(items=documents)


@router.get(
    "/fba/inbound/shipments/{shipment_database_id}",
    response_model=AmazonFbaShipmentResponse,
)
def get_fba_inbound_shipment(
    shipment_database_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    shipment = _inbound_shipment(
        db,
        account_id=getattr(account, "id", None),
        shipment_database_id=shipment_database_id,
    )
    return shipment_response(db, shipment)


@router.post(
    "/finances/sync",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def sync_finances_endpoint(
    payload: AmazonFinanceSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FINANCES_SYNC,
        reference_type="amazon account",
        priority=20,
        request_payload={
            "days": payload.days,
            "mode": payload.mode,
            "marketplace_id": account.marketplace_id,
            "api_version": "2024-06-19",
            "pii_requested": False,
        },
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon finances sync queued",
        summary=(
            "Queued incremental Amazon financial synchronization"
            if payload.mode == "incremental"
            else "Queued Amazon financial historical backfill"
        ),
        account_id=account.id,
        detail={
            "job_id": job.id,
            "created": created,
            "days": payload.days,
            "mode": payload.mode,
            "api_version": "2024-06-19",
        },
        request_method="POST",
        request_path="/amazon/finances/sync",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/finances/balance",
    response_model=AmazonBalanceResponse,
)
def get_finance_balance(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    available_amount = getattr(account, "current_balance", None)
    deferred_amount = getattr(account, "deferred_balance", None)
    current_updated_at = getattr(account, "current_balance_updated_at", None)
    deferred_updated_at = getattr(account, "deferred_balance_updated_at", None)
    updated_at = (
        min(current_updated_at, deferred_updated_at)
        if current_updated_at and deferred_updated_at
        else current_updated_at or deferred_updated_at
    )
    total_amount = (
        round(float(available_amount) + float(deferred_amount), 6)
        if available_amount is not None and deferred_amount is not None
        else available_amount
    )
    return {
        "amount": total_amount,
        "total_amount": total_amount,
        "available_amount": available_amount,
        "deferred_amount": deferred_amount,
        "deferred_transaction_count": int(
            getattr(account, "deferred_transaction_count", 0) or 0
        ),
        "currency": (
            getattr(account, "current_balance_currency", None)
            or getattr(account, "deferred_balance_currency", None)
            or getattr(account, "currency", None)
            or "USD"
        ),
        "financial_event_group_id": getattr(
            account,
            "current_balance_event_group_id",
            None,
        ),
        "updated_at": updated_at,
        "error": (
            getattr(account, "current_balance_error", None)
            or getattr(account, "deferred_balance_error", None)
        ),
        "stale": (
            current_updated_at is None
            or deferred_updated_at is None
            or updated_at is None
            or updated_at < datetime.utcnow() - timedelta(minutes=30)
        ),
        "source": "Amazon Payments",
    }


@router.post(
    "/finances/balance/sync",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def sync_finance_balance_endpoint(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_FINANCE_BALANCE_SYNC,
        reference_type="amazon account",
        priority=15,
        request_payload={
            "marketplace_id": account.marketplace_id,
            "api_version": "v0",
            "pii_requested": False,
        },
    )
    db.flush()
    add_amazon_audit(
        db,
        user=user,
        action="amazon current balance sync queued",
        summary="Queued Amazon Payments current balance refresh",
        account_id=account.id,
        detail={
            "job_id": job.id,
            "created": created,
            "api_version": "v0",
        },
        request_method="POST",
        request_path="/amazon/finances/balance/sync",
    )
    db.commit()
    db.refresh(job)
    if created or job.status in {"Pending", "Retrying"}:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get(
    "/finances/jobs",
    response_model=list[AmazonSyncJobResponse],
)
def finance_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return []
    jobs = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_FINANCES_SYNC, JOB_TYPE_FINANCE_BALANCE_SYNC)
            ),
        )
        .order_by(AmazonSyncJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [amazon_job_response(job) for job in jobs]


@router.get(
    "/finances/jobs/{job_id}",
    response_model=AmazonSyncJobResponse,
)
def finance_job(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == getattr(account, "id", None),
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_FINANCES_SYNC, JOB_TYPE_FINANCE_BALANCE_SYNC)
            ),
        )
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon finance job was not found.",
        )
    return amazon_job_response(job)


@router.post(
    "/finances/jobs/{job_id}/retry",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def retry_finance_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    job = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.id == job_id,
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type.in_(
                (JOB_TYPE_FINANCES_SYNC, JOB_TYPE_FINANCE_BALANCE_SYNC)
            ),
        )
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail="Amazon finance job was not found.",
        )
    if job.status not in {"Failed", "Retrying"}:
        raise HTTPException(
            status_code=409,
            detail="Only failed or retrying finance jobs can be retried.",
        )
    job.status = "Pending"
    job.next_retry_at = None
    job.completed_at = None
    job.error_code = None
    job.error_message = None
    job.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon finance job retried",
        summary="Retried an Amazon financial synchronization job",
        account_id=account.id,
        detail={"job_id": job.id},
        request_method="POST",
        request_path=f"/amazon/finances/jobs/{job.id}/retry",
    )
    db.commit()
    db.refresh(job)
    background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.get("/finances/transactions")
def get_financial_transactions(
    search: str | None = Query(default=None, max_length=200),
    transaction_type: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return {
            "items": [],
            "total": 0,
            "currency": "USD",
            "summary": {},
            "transaction_types": [],
        }
    items, total, summary = query_financial_transactions(
        db,
        account_id=account.id,
        search=search,
        transaction_type=transaction_type,
        status=status,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    transaction_types = [
        str(row[0])
        for row in (
            db.query(AmazonFinancialTransaction.transaction_type)
            .filter(AmazonFinancialTransaction.amazon_account_id == account.id)
            .distinct()
            .order_by(AmazonFinancialTransaction.transaction_type.asc())
            .all()
        )
        if row[0]
    ]
    return {
        "items": items,
        "total": total,
        "currency": account.currency,
        "summary": summary,
        "transaction_types": transaction_types,
    }


@router.get("/finances/profitability")
def get_profitability(
    group_by: str = Query(default="sku", pattern="^(sku|asin|order|marketplace|date)$"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return {"items": [], "group_by": group_by, "currency": "USD"}
    try:
        items = profitability_report(
            db,
            account_id=account.id,
            group_by=group_by,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "items": items,
        "group_by": group_by,
        "currency": account.currency,
    }


@router.get("/finances/settlements")
def get_settlements(
    status: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=250, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return {"items": [], "total": 0, "summary": {}, "currency": "USD"}
    query = db.query(AmazonSettlement).filter(
        AmazonSettlement.amazon_account_id == account.id
    )
    if status:
        query = query.filter(
            func.lower(AmazonSettlement.settlement_status)
            == status.strip().lower()
        )
    total = query.count()
    settlements = (
        query.order_by(
            AmazonSettlement.latest_transaction_date.desc(),
            AmazonSettlement.id.desc(),
        )
        .limit(limit)
        .all()
    )
    all_settlements = db.query(AmazonSettlement).filter(
        AmazonSettlement.amazon_account_id == account.id
    ).all()
    return {
        "items": [settlement_response(row) for row in settlements],
        "total": total,
        "currency": account.currency,
        "summary": {
            "expected_amount": round(
                sum(float(row.expected_amount or 0) for row in all_settlements),
                2,
            ),
            "actual_amount": round(
                sum(float(row.actual_amount or 0) for row in all_settlements),
                2,
            ),
            "difference_amount": round(
                sum(float(row.difference_amount or 0) for row in all_settlements),
                2,
            ),
            "pending_count": sum(
                1
                for row in all_settlements
                if row.settlement_status == "Expected"
            ),
            "difference_count": sum(
                1
                for row in all_settlements
                if row.settlement_status == "Difference"
            ),
            "unposted_actual_count": sum(
                1
                for row in all_settlements
                if row.actual_amount and not row.erp_accounting_entry_id
            ),
        },
    }


@router.get("/finances/reconciliation-issues")
def get_finance_reconciliation_issues(
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return {"items": [], "total": 0}
    items = reconciliation_issues(db, account_id=account.id)
    return {"items": items, "total": len(items)}


@router.post("/finances/settlements/post-accounting")
def post_finance_settlements_to_accounting(
    payload: AmazonSettlementAccountingPostRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    if not payload.confirm_posting:
        raise HTTPException(
            status_code=400,
            detail="Confirm posting actual Amazon settlements to ERP accounting.",
        )
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon account was not found.")
    try:
        result = post_settlements_to_accounting(
            db,
            account_id=account.id,
            settlement_ids=payload.settlement_ids,
        )
    except AmazonIntegrationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=sanitize_external_message(exc.safe_message),
        ) from exc
    add_amazon_audit(
        db,
        user=user,
        action="amazon settlements posted to accounting",
        summary="Posted confirmed Amazon settlement payouts to ERP accounting",
        account_id=account.id,
        detail={
            "settlement_ids": payload.settlement_ids,
            "created": result["created"],
            "updated": result["updated"],
        },
        request_method="POST",
        request_path="/amazon/finances/settlements/post-accounting",
    )
    db.commit()
    return result


def _price_change_record(
    db: Session,
    *,
    account_id: int,
    change_id: int,
) -> AmazonPriceChange:
    change = (
        db.query(AmazonPriceChange)
        .filter(
            AmazonPriceChange.id == change_id,
            AmazonPriceChange.amazon_account_id == account_id,
        )
        .one_or_none()
    )
    if not change:
        raise HTTPException(status_code=404, detail="Amazon price change was not found.")
    return change


def _queue_price_change(
    db: Session,
    *,
    account,
    change: AmazonPriceChange,
) -> tuple[AmazonSyncJob, bool]:
    if not account.price_sync_enabled:
        raise HTTPException(
            status_code=409,
            detail="Enable account-level Amazon price publishing first.",
        )
    if change.status != "Approved":
        raise HTTPException(
            status_code=409,
            detail="Only approved price changes can be synchronized.",
        )
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=change.product_mapping_id,
    )
    if not mapping.sync_price:
        raise HTTPException(
            status_code=409,
            detail="Enable price synchronization for this Seller SKU first.",
        )
    job, created = enqueue_unique_amazon_job(
        db,
        amazon_account_id=account.id,
        job_type=JOB_TYPE_PRICE_SYNC,
        reference_type="amazon price change",
        reference_id=change.id,
        priority=5,
        request_payload={
            "change_id": change.id,
            "mapping_id": mapping.id,
            "seller_sku": mapping.seller_sku,
            "requested_price": change.requested_price,
        },
    )
    db.flush()
    change.sync_job_id = job.id
    change.status = "Queued"
    change.last_error = None
    change.updated_at = datetime.utcnow()
    mapping.last_price_status = "Queued"
    mapping.pending_price = change.requested_price
    mapping.last_error = None
    mapping.updated_at = datetime.utcnow()
    return job, created


@router.get("/pricing")
def get_pricing_workspace(
    search: str | None = Query(default=None, max_length=200),
    errors_only: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return {
            "items": [],
            "total": 0,
            "summary": {},
            "settings": {
                "price_sync_enabled": False,
                "approval_threshold_percent": 10,
                "currency": "USD",
                "marketplace_id": DEFAULT_MARKETPLACE_ID,
            },
        }
    items, total, summary = query_pricing_offers(
        db,
        account_id=account.id,
        search=search,
        errors_only=errors_only,
        offset=offset,
        limit=limit,
    )
    return {
        "items": items,
        "total": total,
        "summary": summary,
        "settings": pricing_settings_response(account),
    }


@router.get("/pricing/changes")
def get_price_changes(
    status: str | None = Query(default=None, max_length=100),
    errors_only: bool = False,
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        return {"items": [], "total": 0}
    items = query_price_changes(
        db,
        account_id=account.id,
        status=status,
        errors_only=errors_only,
        limit=limit,
    )
    return {"items": items, "total": len(items)}


@router.patch("/pricing/settings")
def update_pricing_settings(
    payload: AmazonPricingSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon account was not found.")
    account.price_sync_enabled = payload.price_sync_enabled
    account.price_change_approval_percent = round(
        payload.approval_threshold_percent,
        2,
    )
    account.updated_by_user_id = user.id
    account.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action="amazon pricing settings updated",
        summary="Updated Amazon price publishing safeguards",
        account_id=account.id,
        detail={
            "price_sync_enabled": payload.price_sync_enabled,
            "approval_threshold_percent": payload.approval_threshold_percent,
        },
        request_method="PATCH",
        request_path="/amazon/pricing/settings",
    )
    db.commit()
    db.refresh(account)
    return pricing_settings_response(account)


@router.patch("/pricing/{mapping_id}/rules")
def save_pricing_rules(
    mapping_id: int,
    payload: AmazonPricingRuleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon account was not found.")
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=mapping_id,
    )
    try:
        update_price_rules(
            mapping,
            minimum_price=payload.minimum_price,
            maximum_price=payload.maximum_price,
            sale_price=payload.sale_price,
            sale_start_date=payload.sale_start_date,
            sale_end_date=payload.sale_end_date,
            sync_price=payload.sync_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    add_amazon_audit(
        db,
        user=user,
        action="amazon pricing rules updated",
        summary="Updated Amazon SKU price boundaries and sale schedule",
        account_id=account.id,
        detail={
            "mapping_id": mapping.id,
            "seller_sku": mapping.seller_sku,
            "minimum_price": mapping.minimum_price,
            "maximum_price": mapping.maximum_price,
            "sale_price": mapping.sale_price,
            "sale_start_date": mapping.sale_start_date,
            "sale_end_date": mapping.sale_end_date,
            "sync_price": bool(mapping.sync_price),
        },
        request_method="PATCH",
        request_path=f"/amazon/pricing/{mapping.id}/rules",
    )
    db.commit()
    db.refresh(mapping)
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping.product_id
        else None
    )
    latest_change = (
        db.query(AmazonPriceChange)
        .filter(AmazonPriceChange.product_mapping_id == mapping.id)
        .order_by(AmazonPriceChange.id.desc())
        .first()
    )
    return pricing_offer_response(
        mapping,
        product=product,
        latest_change=latest_change,
    )


@router.post("/pricing/changes", status_code=201)
def request_price_change(
    payload: AmazonPriceChangeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon account was not found.")
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=payload.mapping_id,
    )
    try:
        change = create_price_change(
            db,
            account=account,
            mapping=mapping,
            requested_price=payload.requested_price,
            reason=payload.reason,
            user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    add_amazon_audit(
        db,
        user=user,
        action="amazon price change requested",
        summary="Recorded a controlled Amazon price change request",
        account_id=account.id,
        detail={
            "change_id": change.id,
            "mapping_id": mapping.id,
            "seller_sku": mapping.seller_sku,
            "current_price": change.current_price,
            "requested_price": change.requested_price,
            "change_percent": change.change_percent,
            "requires_approval": bool(change.requires_approval),
            "status": change.status,
        },
        request_method="POST",
        request_path="/amazon/pricing/changes",
    )
    db.commit()
    db.refresh(change)
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping.product_id
        else None
    )
    return price_change_response(change, mapping=mapping, product=product)


@router.post("/pricing/changes/{change_id}/review")
def review_requested_price_change(
    change_id: int,
    payload: AmazonPriceChangeReview,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = get_amazon_account(db)
    if not account:
        raise HTTPException(status_code=404, detail="Amazon account was not found.")
    change = _price_change_record(
        db,
        account_id=account.id,
        change_id=change_id,
    )
    try:
        review_price_change(
            change,
            approved=payload.approved,
            review_note=payload.review_note,
            user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    mapping = _listing_mapping(
        db,
        account_id=account.id,
        mapping_id=change.product_mapping_id,
    )
    mapping.last_price_status = change.status
    if not payload.approved:
        mapping.pending_price = None
    mapping.updated_at = datetime.utcnow()
    add_amazon_audit(
        db,
        user=user,
        action=(
            "amazon price change approved"
            if payload.approved
            else "amazon price change rejected"
        ),
        summary="Reviewed an Amazon price change requiring approval",
        account_id=account.id,
        detail={
            "change_id": change.id,
            "mapping_id": mapping.id,
            "approved": payload.approved,
        },
        request_method="POST",
        request_path=f"/amazon/pricing/changes/{change.id}/review",
    )
    db.commit()
    db.refresh(change)
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping.product_id
        else None
    )
    return price_change_response(change, mapping=mapping, product=product)


@router.post(
    "/pricing/changes/{change_id}/queue",
    response_model=AmazonSyncJobResponse,
    status_code=202,
)
def queue_requested_price_change(
    change_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    change = _price_change_record(
        db,
        account_id=account.id,
        change_id=change_id,
    )
    job, created = _queue_price_change(db, account=account, change=change)
    add_amazon_audit(
        db,
        user=user,
        action="amazon price sync queued",
        summary="Queued an approved Amazon price change",
        account_id=account.id,
        detail={
            "change_id": change.id,
            "job_id": job.id,
            "created": created,
        },
        request_method="POST",
        request_path=f"/amazon/pricing/changes/{change.id}/queue",
    )
    db.commit()
    db.refresh(job)
    if created:
        background_tasks.add_task(process_amazon_job, job.id)
    return amazon_job_response(job)


@router.post("/pricing/bulk-sync", status_code=202)
def bulk_queue_price_changes(
    payload: AmazonPriceBulkSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_amazon_admin),
):
    account = _connected_account(db)
    jobs: list[tuple[AmazonSyncJob, bool]] = []
    for change_id in payload.change_ids:
        change = _price_change_record(
            db,
            account_id=account.id,
            change_id=change_id,
        )
        jobs.append(_queue_price_change(db, account=account, change=change))
    add_amazon_audit(
        db,
        user=user,
        action="amazon bulk price sync queued",
        summary="Queued approved Amazon price changes in bulk",
        account_id=account.id,
        detail={
            "change_ids": payload.change_ids,
            "job_ids": [job.id for job, _ in jobs],
        },
        request_method="POST",
        request_path="/amazon/pricing/bulk-sync",
    )
    db.commit()
    for job, created in jobs:
        db.refresh(job)
        if created:
            background_tasks.add_task(process_amazon_job, job.id)
    return {
        "items": [amazon_job_response(job) for job, _ in jobs],
        "queued": sum(1 for _, created in jobs if created),
        "existing": sum(1 for _, created in jobs if not created),
    }
