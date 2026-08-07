"""Database-backed job primitives. No scheduler is started in Phase 1."""

import json
import os
import socket
from dataclasses import asdict
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ...database import SessionLocal
from .constants import (
    CONNECTION_CONNECTED,
    JOB_STATUSES,
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
from .exceptions import (
    AmazonAuthorizationError,
    AmazonIntegrationError,
    AmazonPermissionError,
    AmazonRateLimitError,
    AmazonTemporaryError,
)
from .models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonPriceChange,
    AmazonProductMapping,
    AmazonSyncJob,
)
from .security import sanitize_external_message

_FORBIDDEN_PAYLOAD_KEYS = {
    "authorization",
    "client_secret",
    "refresh_token",
    "access_token",
    "restricted_data_token",
    "buyer_name",
    "buyer_address",
    "phone",
}


def _sanitized_payload(payload: dict | None) -> str | None:
    if not payload:
        return None
    clean_payload = {
        str(key): "[REDACTED]"
        if str(key).strip().lower() in _FORBIDDEN_PAYLOAD_KEYS
        else value
        for key, value in payload.items()
    }
    serialized = json.dumps(clean_payload, separators=(",", ":"), default=str)
    return sanitize_external_message(serialized)[:4000]


def enqueue_amazon_job(
    db: Session,
    *,
    amazon_account_id: int,
    job_type: str,
    reference_type: str | None = None,
    reference_id: str | int | None = None,
    priority: int = 100,
    maximum_attempts: int = 5,
    request_payload: dict | None = None,
    scheduled_at: datetime | None = None,
) -> AmazonSyncJob:
    job = AmazonSyncJob(
        amazon_account_id=amazon_account_id,
        job_type=job_type.strip(),
        reference_type=(reference_type or "").strip() or None,
        reference_id=str(reference_id) if reference_id is not None else None,
        status="Pending",
        priority=max(0, int(priority)),
        maximum_attempts=max(1, int(maximum_attempts)),
        request_payload_sanitized=_sanitized_payload(request_payload),
        scheduled_at=scheduled_at or datetime.utcnow(),
    )
    if job.status not in JOB_STATUSES:
        raise ValueError("Invalid Amazon job status.")
    db.add(job)
    return job


def enqueue_unique_amazon_job(
    db: Session,
    *,
    amazon_account_id: int,
    job_type: str,
    reference_type: str | None = None,
    reference_id: str | int | None = None,
    priority: int = 100,
    maximum_attempts: int = 5,
    request_payload: dict | None = None,
) -> tuple[AmazonSyncJob, bool]:
    clean_reference_id = (
        str(reference_id) if reference_id is not None else None
    )
    existing = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == amazon_account_id,
            AmazonSyncJob.job_type == job_type,
            AmazonSyncJob.reference_id == clean_reference_id,
            AmazonSyncJob.status.in_(("Pending", "Processing", "Retrying")),
        )
        .order_by(AmazonSyncJob.id.desc())
        .first()
    )
    if existing:
        return existing, False
    return (
        enqueue_amazon_job(
            db,
            amazon_account_id=amazon_account_id,
            job_type=job_type,
            reference_type=reference_type,
            reference_id=reference_id,
            priority=priority,
            maximum_attempts=maximum_attempts,
            request_payload=request_payload,
        ),
        True,
    )


def enqueue_full_amazon_sync_jobs(
    db: Session,
    *,
    account: AmazonAccount,
) -> tuple[list[AmazonSyncJob], set[int]]:
    """Queue one non-overlapping job for each full Amazon synchronization area."""
    sync_specs = (
        (
            JOB_TYPE_LISTINGS_IMPORT,
            10,
            {"marketplace_id": account.marketplace_id},
        ),
        (
            JOB_TYPE_FBA_INVENTORY_SYNC,
            15,
            {
                "marketplace_id": account.marketplace_id,
                "details": True,
            },
        ),
        (
            JOB_TYPE_FBA_ORDERS_SYNC,
            20,
            {
                "days": 14,
                "mode": "incremental",
                "marketplace_id": account.marketplace_id,
                "fulfilled_by": "AMAZON",
                "pii_requested": False,
            },
        ),
        (
            JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
            25,
            {
                "marketplace_id": account.marketplace_id,
                "maximum_pages": 4,
                "source_addresses_stored": False,
            },
        ),
        (
            JOB_TYPE_FINANCES_SYNC,
            30,
            {
                "days": 30,
                "mode": "incremental",
                "marketplace_id": account.marketplace_id,
                "api_version": "2024-06-19",
                "pii_requested": False,
            },
        ),
        (
            JOB_TYPE_FINANCE_BALANCE_SYNC,
            35,
            {
                "marketplace_id": account.marketplace_id,
                "api_version": "v0",
                "pii_requested": False,
            },
        ),
    )
    jobs: list[AmazonSyncJob] = []
    created_job_ids: set[int] = set()
    for job_type, priority, request_payload in sync_specs:
        job, created = enqueue_unique_amazon_job(
            db,
            amazon_account_id=account.id,
            job_type=job_type,
            reference_type="amazon account",
            priority=priority,
            request_payload=request_payload,
        )
        db.flush()
        jobs.append(job)
        if created:
            created_job_ids.add(job.id)
    return jobs, created_job_ids


def amazon_job_response(job: AmazonSyncJob) -> dict:
    try:
        response_summary = json.loads(job.response_payload_sanitized or "{}")
    except (TypeError, json.JSONDecodeError):
        response_summary = {}
    return {
        "id": job.id,
        "amazon_account_id": job.amazon_account_id,
        "job_type": job.job_type,
        "reference_type": job.reference_type,
        "reference_id": job.reference_id,
        "status": job.status,
        "attempt_count": job.attempt_count,
        "maximum_attempts": job.maximum_attempts,
        "error_code": job.error_code,
        "error_message": job.error_message,
        "amazon_request_id": job.amazon_request_id,
        "response_summary": response_summary,
        "scheduled_at": job.scheduled_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "next_retry_at": job.next_retry_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _job_request_payload(job: AmazonSyncJob) -> dict:
    try:
        payload = json.loads(job.request_payload_sanitized or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _log_amazon_job(
    db: Session,
    *,
    job: AmazonSyncJob,
    success: bool,
    operation: str,
    http_status: int | None,
    amazon_request_id: str | None,
    duration_ms: int | None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    api_name = "Listings Items API"
    if operation == "getInventorySummaries":
        api_name = "FBA Inventory API"
    elif operation in {"searchOrders", "getOrder"}:
        api_name = "Orders API"
    elif operation in {"listTransactions", "listFinancialEventGroups"}:
        api_name = "Finances API"
    elif operation in {"listInboundPlans", "getInboundPlan", "getShipment"}:
        api_name = "Fulfillment Inbound API"
    db.add(
        AmazonApiLog(
            amazon_account_id=job.amazon_account_id,
            api_name=api_name,
            operation=operation,
            http_status=http_status,
            amazon_request_id=amazon_request_id,
            duration_ms=duration_ms,
            success=success,
            error_code=error_code,
            error_message=error_message,
        )
    )


def _job_operation(job_type: str) -> str:
    if job_type == JOB_TYPE_PRICE_SYNC:
        return "patchListingsItem"
    if job_type == JOB_TYPE_LISTING_SYNC:
        return "getListingsItem"
    if job_type == JOB_TYPE_FBA_INVENTORY_SYNC:
        return "getInventorySummaries"
    if job_type == JOB_TYPE_FBA_ORDERS_SYNC:
        return "searchOrders"
    if job_type == JOB_TYPE_FBA_ORDER_REFRESH:
        return "getOrder"
    if job_type == JOB_TYPE_FINANCES_SYNC:
        return "listTransactions"
    if job_type == JOB_TYPE_FINANCE_BALANCE_SYNC:
        return "listFinancialEventGroups"
    if job_type == JOB_TYPE_FBA_INBOUND_PLANS_SYNC:
        return "listInboundPlans"
    if job_type == JOB_TYPE_FBA_INBOUND_PLAN_SYNC:
        return "getInboundPlan"
    if job_type == JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH:
        return "getShipment"
    return "searchListingsItems"


def process_amazon_job(job_id: int) -> None:
    """Claim and execute one database-backed job outside the request handler."""
    db = SessionLocal()
    try:
        job = db.query(AmazonSyncJob).filter(AmazonSyncJob.id == job_id).first()
        if not job or job.status not in {"Pending", "Retrying"}:
            return

        account = (
            db.query(AmazonAccount)
            .filter(AmazonAccount.id == job.amazon_account_id)
            .first()
        )
        now = datetime.utcnow()
        job.status = "Processing"
        job.attempt_count = int(job.attempt_count or 0) + 1
        job.started_at = now
        job.completed_at = None
        job.next_retry_at = None
        job.locked_at = now
        job.locked_by = f"{socket.gethostname()}:{os.getpid()}"
        job.error_code = None
        job.error_message = None
        job.updated_at = now
        db.commit()

        if not account or not account.is_active:
            raise AmazonIntegrationError(
                "The Amazon connection is disabled.",
                error_code="amazon_connection_disabled",
            )

        from .listings import import_all_listings, sync_one_listing

        operation = _job_operation(job.job_type)
        if job.job_type == JOB_TYPE_LISTINGS_IMPORT:
            result = import_all_listings(db, account=account)
        elif job.job_type == JOB_TYPE_LISTING_SYNC:
            mapping = (
                db.query(AmazonProductMapping)
                .filter(
                    AmazonProductMapping.id == int(job.reference_id or 0),
                    AmazonProductMapping.amazon_account_id == account.id,
                )
                .first()
            )
            if not mapping:
                raise AmazonIntegrationError(
                    "The Amazon listing mapping was not found.",
                    error_code="listing_mapping_not_found",
                )
            result = sync_one_listing(
                db,
                account=account,
                mapping=mapping,
            )
        elif job.job_type == JOB_TYPE_FBA_INVENTORY_SYNC:
            from .fba_inventory import sync_fba_inventory

            result = sync_fba_inventory(
                db,
                account=account,
                sync_job_id=job.id,
            )
        elif job.job_type in {
            JOB_TYPE_FBA_ORDERS_SYNC,
            JOB_TYPE_FBA_ORDER_REFRESH,
        }:
            from .orders import refresh_fba_order, sync_fba_orders

            if job.job_type == JOB_TYPE_FBA_ORDER_REFRESH:
                result = refresh_fba_order(
                    db,
                    account=account,
                    amazon_order_id=str(job.reference_id or ""),
                    sync_job_id=job.id,
                )
            else:
                payload = _job_request_payload(job)
                requested_mode = str(
                    payload.get("mode") or "incremental"
                ).strip().lower()
                last_updated_after = None
                if requested_mode != "backfill":
                    previous_sync = (
                        db.query(AmazonSyncJob)
                        .filter(
                            AmazonSyncJob.amazon_account_id == account.id,
                            AmazonSyncJob.job_type == JOB_TYPE_FBA_ORDERS_SYNC,
                            AmazonSyncJob.status == "Completed",
                            AmazonSyncJob.id != job.id,
                            AmazonSyncJob.started_at.is_not(None),
                        )
                        .order_by(
                            AmazonSyncJob.completed_at.desc(),
                            AmazonSyncJob.id.desc(),
                        )
                        .first()
                    )
                    if previous_sync and previous_sync.started_at:
                        # Keep a small overlap so an Amazon update that becomes
                        # visible near a job boundary cannot be missed.
                        last_updated_after = (
                            previous_sync.started_at - timedelta(minutes=5)
                        )
                result = sync_fba_orders(
                    db,
                    account=account,
                    days=int(payload.get("days") or 14),
                    last_updated_after=last_updated_after,
                    sync_job_id=job.id,
                )
        elif job.job_type == JOB_TYPE_FINANCES_SYNC:
            from .finances import sync_finances

            payload = _job_request_payload(job)
            requested_mode = str(
                payload.get("mode") or "incremental"
            ).strip().lower()
            posted_after = None
            if requested_mode != "backfill":
                previous_sync = (
                    db.query(AmazonSyncJob)
                    .filter(
                        AmazonSyncJob.amazon_account_id == account.id,
                        AmazonSyncJob.job_type == JOB_TYPE_FINANCES_SYNC,
                        AmazonSyncJob.status == "Completed",
                        AmazonSyncJob.id != job.id,
                        AmazonSyncJob.started_at.is_not(None),
                    )
                    .order_by(
                        AmazonSyncJob.completed_at.desc(),
                        AmazonSyncJob.id.desc(),
                    )
                    .first()
                )
                if previous_sync and previous_sync.started_at:
                    # Amazon notes that recent financial events can appear late.
                    # Re-reading a three-day overlap is safe because transaction
                    # IDs are unique and imports are idempotent.
                    posted_after = previous_sync.started_at - timedelta(days=3)
            result = sync_finances(
                db,
                account=account,
                days=int(payload.get("days") or 30),
                posted_after=posted_after,
            )
        elif job.job_type == JOB_TYPE_FINANCE_BALANCE_SYNC:
            from .finances import sync_current_balance

            result = sync_current_balance(
                db,
                account=account,
            )
        elif job.job_type == JOB_TYPE_PRICE_SYNC:
            from .pricing import submit_price_change

            change = (
                db.query(AmazonPriceChange)
                .filter(
                    AmazonPriceChange.id == int(job.reference_id or 0),
                    AmazonPriceChange.amazon_account_id == account.id,
                )
                .one_or_none()
            )
            if not change:
                raise AmazonIntegrationError(
                    "The Amazon price change was not found.",
                    error_code="amazon_price_change_not_found",
                )
            result = submit_price_change(
                db,
                account=account,
                change=change,
            )
        elif job.job_type in {
            JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
            JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
            JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
        }:
            from .inbound import (
                refresh_inbound_shipment,
                sync_inbound_plan,
                sync_inbound_plans,
            )
            from .models import AmazonFbaShipment

            if job.job_type == JOB_TYPE_FBA_INBOUND_PLANS_SYNC:
                result = sync_inbound_plans(db, account=account)
            elif job.job_type == JOB_TYPE_FBA_INBOUND_PLAN_SYNC:
                result = sync_inbound_plan(
                    db,
                    account=account,
                    inbound_plan_id=str(job.reference_id or ""),
                )
            else:
                shipment = (
                    db.query(AmazonFbaShipment)
                    .filter(
                        AmazonFbaShipment.amazon_account_id == account.id,
                        AmazonFbaShipment.amazon_shipment_id
                        == str(job.reference_id or ""),
                    )
                    .one_or_none()
                )
                if not shipment:
                    raise AmazonIntegrationError(
                        "The FBA inbound shipment was not found.",
                        error_code="amazon_inbound_shipment_not_found",
                    )
                result = refresh_inbound_shipment(
                    db,
                    account=account,
                    shipment=shipment,
                )
        else:
            raise AmazonIntegrationError(
                "This Amazon job type is not supported.",
                error_code="unsupported_job_type",
            )

        completed_at = datetime.utcnow()
        price_submission_failed = (
            job.job_type == JOB_TYPE_PRICE_SYNC
            and getattr(result, "status", None) == "Failed"
        )
        job.status = "Failed" if price_submission_failed else "Completed"
        job.response_payload_sanitized = _sanitized_payload(asdict(result))
        job.amazon_request_id = result.amazon_request_id
        job.completed_at = completed_at
        job.error_code = (
            "amazon_price_submission_rejected"
            if price_submission_failed
            else None
        )
        job.error_message = (
            "Amazon rejected the price submission."
            if price_submission_failed
            else None
        )
        job.locked_at = None
        job.locked_by = None
        job.updated_at = completed_at
        if not price_submission_failed:
            account.last_successful_sync = completed_at
        account.connection_status = CONNECTION_CONNECTED
        account.sanitized_last_error = None
        _log_amazon_job(
            db,
            job=job,
            success=not price_submission_failed,
            operation=operation,
            http_status=result.http_status,
            amazon_request_id=result.amazon_request_id,
            duration_ms=result.duration_ms,
        )
        db.commit()
    except AmazonIntegrationError as exc:
        db.rollback()
        job = db.query(AmazonSyncJob).filter(AmazonSyncJob.id == job_id).first()
        if not job:
            return
        account = (
            db.query(AmazonAccount)
            .filter(AmazonAccount.id == job.amazon_account_id)
            .first()
        )
        safe_message = sanitize_external_message(exc.safe_message)
        retryable = isinstance(exc, (AmazonTemporaryError, AmazonRateLimitError))
        can_retry = int(job.attempt_count or 0) < int(job.maximum_attempts or 1)
        failed_at = datetime.utcnow()
        job.status = "Retrying" if retryable and can_retry else "Failed"
        job.error_code = exc.error_code
        job.error_message = safe_message
        job.amazon_request_id = exc.amazon_request_id
        job.next_retry_at = (
            failed_at
            + timedelta(seconds=min(900, 30 * (2 ** max(0, job.attempt_count - 1))))
            if job.status == "Retrying"
            else None
        )
        job.completed_at = failed_at if job.status == "Failed" else None
        job.locked_at = None
        job.locked_by = None
        job.updated_at = failed_at
        if account and isinstance(
            exc,
            (AmazonAuthorizationError, AmazonPermissionError),
        ):
            account.connection_status = exc.connection_status
            account.sanitized_last_error = safe_message
        if account and job.job_type == JOB_TYPE_FINANCE_BALANCE_SYNC:
            account.current_balance_error = safe_message
            account.deferred_balance_error = safe_message
        if job.reference_id and job.job_type == JOB_TYPE_LISTING_SYNC:
            mapping = (
                db.query(AmazonProductMapping)
                .filter(AmazonProductMapping.id == int(job.reference_id))
                .first()
            )
            if mapping:
                mapping.last_error = safe_message
        if job.reference_id and job.job_type == JOB_TYPE_PRICE_SYNC:
            price_change = (
                db.query(AmazonPriceChange)
                .filter(AmazonPriceChange.id == int(job.reference_id))
                .one_or_none()
            )
            if price_change:
                price_change.status = (
                    "Queued" if job.status == "Retrying" else "Failed"
                )
                price_change.last_error = safe_message
                price_change.completed_at = (
                    failed_at if job.status == "Failed" else None
                )
                price_change.updated_at = failed_at
                mapping = (
                    db.query(AmazonProductMapping)
                    .filter(
                        AmazonProductMapping.id
                        == price_change.product_mapping_id
                    )
                    .one_or_none()
                )
                if mapping:
                    mapping.last_price_status = price_change.status
                    mapping.last_error = safe_message
                    if job.status == "Failed":
                        mapping.pending_price = None
                    mapping.updated_at = failed_at
        if job.reference_id and job.job_type == JOB_TYPE_FBA_ORDER_REFRESH:
            from .models import AmazonOrder

            order = (
                db.query(AmazonOrder)
                .filter(
                    AmazonOrder.amazon_account_id == job.amazon_account_id,
                    AmazonOrder.amazon_order_id == job.reference_id,
                )
                .first()
            )
            if order:
                order.last_error = safe_message
        if job.reference_id and job.job_type in {
            JOB_TYPE_FBA_INBOUND_PLAN_SYNC,
            JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH,
        }:
            from .models import AmazonFbaInboundPlan, AmazonFbaShipment

            if job.job_type == JOB_TYPE_FBA_INBOUND_PLAN_SYNC:
                inbound_record = (
                    db.query(AmazonFbaInboundPlan)
                    .filter(
                        AmazonFbaInboundPlan.amazon_account_id
                        == job.amazon_account_id,
                        AmazonFbaInboundPlan.inbound_plan_id
                        == job.reference_id,
                    )
                    .one_or_none()
                )
            else:
                inbound_record = (
                    db.query(AmazonFbaShipment)
                    .filter(
                        AmazonFbaShipment.amazon_account_id
                        == job.amazon_account_id,
                        AmazonFbaShipment.amazon_shipment_id
                        == job.reference_id,
                    )
                    .one_or_none()
                )
            if inbound_record:
                inbound_record.last_error = safe_message
        _log_amazon_job(
            db,
            job=job,
            success=False,
            operation=_job_operation(job.job_type),
            http_status=exc.http_status,
            amazon_request_id=exc.amazon_request_id,
            duration_ms=exc.duration_ms,
            error_code=exc.error_code,
            error_message=safe_message,
        )
        db.commit()
    except Exception:
        db.rollback()
        job = db.query(AmazonSyncJob).filter(AmazonSyncJob.id == job_id).first()
        if not job:
            return
        account = (
            db.query(AmazonAccount)
            .filter(AmazonAccount.id == job.amazon_account_id)
            .first()
        )
        failed_at = datetime.utcnow()
        job.status = "Failed"
        job.error_code = "amazon_job_failed"
        job.error_message = "The Amazon synchronization job could not be completed."
        job.completed_at = failed_at
        job.locked_at = None
        job.locked_by = None
        job.updated_at = failed_at
        if account and job.job_type == JOB_TYPE_FINANCE_BALANCE_SYNC:
            account.current_balance_error = job.error_message
            account.deferred_balance_error = job.error_message
        if job.reference_id and job.job_type == JOB_TYPE_PRICE_SYNC:
            price_change = (
                db.query(AmazonPriceChange)
                .filter(AmazonPriceChange.id == int(job.reference_id))
                .one_or_none()
            )
            if price_change:
                price_change.status = "Failed"
                price_change.last_error = job.error_message
                price_change.completed_at = failed_at
                price_change.updated_at = failed_at
                mapping = (
                    db.query(AmazonProductMapping)
                    .filter(
                        AmazonProductMapping.id
                        == price_change.product_mapping_id
                    )
                    .one_or_none()
                )
                if mapping:
                    mapping.pending_price = None
                    mapping.last_price_status = "Failed"
                    mapping.last_error = job.error_message
                    mapping.updated_at = failed_at
        _log_amazon_job(
            db,
            job=job,
            success=False,
            operation=_job_operation(job.job_type),
            http_status=None,
            amazon_request_id=None,
            duration_ms=None,
            error_code=job.error_code,
            error_message=job.error_message,
        )
        db.commit()
    finally:
        db.close()
