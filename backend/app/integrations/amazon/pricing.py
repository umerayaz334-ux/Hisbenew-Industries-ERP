"""Controlled Amazon offer-price changes and approval safeguards."""

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Product, User
from .client import AmazonSpApiClient
from .exceptions import AmazonConfigurationError, AmazonIntegrationError
from .models import AmazonAccount, AmazonPriceChange, AmazonProductMapping
from .security import CredentialCipher, sanitize_external_message


@dataclass(frozen=True)
class PriceSyncResult:
    change_id: int
    mapping_id: int
    seller_sku: str
    requested_price: float
    status: str
    submission_id: str | None
    issue_count: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int


def _rounded_price(value: float | int | None) -> float | None:
    return round(float(value), 2) if value is not None else None


def _change_percent(current_price: float | None, requested_price: float) -> float | None:
    if current_price is None or float(current_price) <= 0:
        return None
    return round(
        abs(float(requested_price) - float(current_price))
        / float(current_price)
        * 100,
        4,
    )


def validate_price_rules(
    *,
    requested_price: float | None = None,
    minimum_price: float | None = None,
    maximum_price: float | None = None,
    sale_price: float | None = None,
    sale_start_date: datetime | None = None,
    sale_end_date: datetime | None = None,
) -> None:
    values = {
        "Requested price": requested_price,
        "Minimum price": minimum_price,
        "Maximum price": maximum_price,
        "Sale price": sale_price,
    }
    for label, value in values.items():
        if value is not None and float(value) <= 0:
            raise ValueError(f"{label} must be greater than zero.")
    if (
        minimum_price is not None
        and maximum_price is not None
        and float(minimum_price) > float(maximum_price)
    ):
        raise ValueError("Minimum price cannot exceed maximum price.")
    if requested_price is not None:
        if minimum_price is not None and requested_price < minimum_price:
            raise ValueError("Requested price is below the configured minimum.")
        if maximum_price is not None and requested_price > maximum_price:
            raise ValueError("Requested price is above the configured maximum.")
    if sale_price is not None:
        if requested_price is not None and sale_price >= requested_price:
            raise ValueError("Sale price must be lower than the regular price.")
        if minimum_price is not None and sale_price < minimum_price:
            raise ValueError("Sale price is below the configured minimum.")
        if maximum_price is not None and sale_price > maximum_price:
            raise ValueError("Sale price is above the configured maximum.")
        if not sale_start_date or not sale_end_date:
            raise ValueError("Sale price requires both start and end dates.")
        if sale_start_date >= sale_end_date:
            raise ValueError("Sale end date must be after the start date.")
    elif sale_start_date or sale_end_date:
        raise ValueError("Sale dates require a sale price.")


def pricing_settings_response(account: AmazonAccount) -> dict:
    return {
        "price_sync_enabled": bool(account.price_sync_enabled),
        "approval_threshold_percent": round(
            float(account.price_change_approval_percent or 10),
            2,
        ),
        "currency": account.currency,
        "marketplace_id": account.marketplace_id,
    }


def update_price_rules(
    mapping: AmazonProductMapping,
    *,
    minimum_price: float | None,
    maximum_price: float | None,
    sale_price: float | None,
    sale_start_date: datetime | None,
    sale_end_date: datetime | None,
    sync_price: bool,
) -> AmazonProductMapping:
    validate_price_rules(
        minimum_price=minimum_price,
        maximum_price=maximum_price,
        sale_price=sale_price,
        sale_start_date=sale_start_date,
        sale_end_date=sale_end_date,
    )
    mapping.minimum_price = _rounded_price(minimum_price)
    mapping.maximum_price = _rounded_price(maximum_price)
    mapping.sale_price = _rounded_price(sale_price)
    mapping.sale_start_date = sale_start_date
    mapping.sale_end_date = sale_end_date
    mapping.sync_price = bool(sync_price)
    mapping.updated_at = datetime.utcnow()
    return mapping


def create_price_change(
    db: Session,
    *,
    account: AmazonAccount,
    mapping: AmazonProductMapping,
    requested_price: float,
    reason: str | None,
    user: User,
) -> AmazonPriceChange:
    clean_price = _rounded_price(requested_price)
    validate_price_rules(
        requested_price=clean_price,
        minimum_price=mapping.minimum_price,
        maximum_price=mapping.maximum_price,
        sale_price=mapping.sale_price,
        sale_start_date=mapping.sale_start_date,
        sale_end_date=mapping.sale_end_date,
    )
    percent = _change_percent(mapping.amazon_price, clean_price)
    threshold = round(float(account.price_change_approval_percent or 10), 2)
    requires_approval = percent is None or percent > threshold

    existing_changes = (
        db.query(AmazonPriceChange)
        .filter(
            AmazonPriceChange.amazon_account_id == account.id,
            AmazonPriceChange.product_mapping_id == mapping.id,
            AmazonPriceChange.status.in_(("Pending Approval", "Approved")),
        )
        .all()
    )
    now = datetime.utcnow()
    for existing in existing_changes:
        existing.status = "Cancelled"
        existing.review_note = "Superseded by a newer price request."
        existing.completed_at = now
        existing.updated_at = now

    change = AmazonPriceChange(
        amazon_account_id=account.id,
        product_mapping_id=mapping.id,
        seller_sku=mapping.seller_sku,
        marketplace_id=mapping.marketplace_id,
        currency=mapping.currency or account.currency,
        current_price=_rounded_price(mapping.amazon_price),
        requested_price=clean_price,
        minimum_price=_rounded_price(mapping.minimum_price),
        maximum_price=_rounded_price(mapping.maximum_price),
        sale_price=_rounded_price(mapping.sale_price),
        sale_start_date=mapping.sale_start_date,
        sale_end_date=mapping.sale_end_date,
        change_percent=percent,
        approval_threshold_percent=threshold,
        requires_approval=requires_approval,
        status="Pending Approval" if requires_approval else "Approved",
        reason=sanitize_external_message(reason, fallback="")[:1000] or None,
        requested_by_user_id=user.id,
    )
    mapping.pending_price = clean_price
    mapping.last_price_status = change.status
    mapping.last_error = None
    mapping.updated_at = now
    db.add(change)
    db.flush()
    return change


def review_price_change(
    change: AmazonPriceChange,
    *,
    approved: bool,
    review_note: str | None,
    user: User,
) -> AmazonPriceChange:
    if change.status != "Pending Approval":
        raise ValueError("Only pending price changes can be reviewed.")
    now = datetime.utcnow()
    change.status = "Approved" if approved else "Rejected"
    change.reviewed_by_user_id = user.id
    change.reviewed_at = now
    change.review_note = (
        sanitize_external_message(review_note, fallback="")[:1000] or None
    )
    change.completed_at = None if approved else now
    change.updated_at = now
    return change


def _safe_submission_issues(raw_issues: object) -> list[dict]:
    if not isinstance(raw_issues, list):
        return []
    issues: list[dict] = []
    for raw_issue in raw_issues[:100]:
        if not isinstance(raw_issue, dict):
            continue
        attribute_names = raw_issue.get("attributeNames")
        if not isinstance(attribute_names, list):
            attribute_names = []
        issues.append(
            {
                "code": sanitize_external_message(
                    raw_issue.get("code"),
                    fallback="amazon_price_issue",
                )[:100],
                "severity": str(raw_issue.get("severity") or "ERROR")[:30],
                "message": sanitize_external_message(
                    raw_issue.get("message"),
                    fallback="Amazon rejected the price submission.",
                ),
                "attribute_names": [
                    str(value)[:120] for value in attribute_names[:20]
                ],
            }
        )
    return issues


def _utc_iso(value: datetime) -> str:
    aware = value
    if aware.tzinfo is None:
        aware = aware.replace(tzinfo=timezone.utc)
    else:
        aware = aware.astimezone(timezone.utc)
    return aware.isoformat(timespec="seconds").replace("+00:00", "Z")


def price_submission_payload(
    mapping: AmazonProductMapping,
    change: AmazonPriceChange,
) -> dict:
    offer: dict = {
        "marketplace_id": change.marketplace_id,
        "currency": change.currency,
        "audience": "ALL",
        "our_price": [
            {
                "schedule": [
                    {"value_with_tax": _rounded_price(change.requested_price)}
                ]
            }
        ],
    }
    if change.minimum_price is not None:
        offer["minimum_seller_allowed_price"] = [
            {
                "schedule": [
                    {"value_with_tax": _rounded_price(change.minimum_price)}
                ]
            }
        ]
    if change.maximum_price is not None:
        offer["maximum_seller_allowed_price"] = [
            {
                "schedule": [
                    {"value_with_tax": _rounded_price(change.maximum_price)}
                ]
            }
        ]
    if (
        change.sale_price is not None
        and change.sale_start_date
        and change.sale_end_date
    ):
        offer["discounted_price"] = [
            {
                "schedule": [
                    {
                        "value_with_tax": _rounded_price(change.sale_price),
                        "start_at": _utc_iso(change.sale_start_date),
                        "end_at": _utc_iso(change.sale_end_date),
                    }
                ]
            }
        ]
    return {
        "productType": mapping.product_type or "PRODUCT",
        "patches": [
            {
                "op": "replace",
                "path": "/attributes/purchasable_offer",
                "value": [offer],
            }
        ],
    }


def submit_price_change(
    db: Session,
    *,
    account: AmazonAccount,
    change: AmazonPriceChange,
    client: AmazonSpApiClient | None = None,
) -> PriceSyncResult:
    mapping = (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.id == change.product_mapping_id,
            AmazonProductMapping.amazon_account_id == account.id,
        )
        .one_or_none()
    )
    if not mapping:
        raise AmazonIntegrationError(
            "The Amazon price mapping was not found.",
            error_code="amazon_price_mapping_not_found",
        )
    if not account.price_sync_enabled:
        raise AmazonConfigurationError(
            "Amazon price publishing is disabled for this account.",
            error_code="amazon_price_sync_disabled",
        )
    if not mapping.sync_price:
        raise AmazonConfigurationError(
            "Price synchronization is disabled for this Seller SKU.",
            error_code="amazon_sku_price_sync_disabled",
        )
    if change.status not in {"Queued", "Processing"}:
        raise AmazonIntegrationError(
            "This Amazon price change is not queued for submission.",
            error_code="amazon_price_change_not_queued",
        )
    validate_price_rules(
        requested_price=change.requested_price,
        minimum_price=change.minimum_price,
        maximum_price=change.maximum_price,
        sale_price=change.sale_price,
        sale_start_date=change.sale_start_date,
        sale_end_date=change.sale_end_date,
    )
    seller_id = CredentialCipher().decrypt(account.encrypted_seller_id)
    if not seller_id:
        raise AmazonConfigurationError(
            "Amazon Seller ID is required before publishing prices.",
            error_code="seller_id_missing",
        )

    change.status = "Processing"
    mapping.last_price_status = "Processing"
    now = datetime.utcnow()
    change.updated_at = now
    mapping.updated_at = now
    result = (client or AmazonSpApiClient(account)).patch_listing_price(
        seller_id,
        mapping.seller_sku,
        payload=price_submission_payload(mapping, change),
    )
    amazon_status = str(result.body.get("status") or "UNKNOWN").strip().upper()
    submission_id = (
        str(result.body.get("submissionId") or "").strip() or None
    )
    issues = _safe_submission_issues(result.body.get("issues"))
    accepted = amazon_status == "ACCEPTED" and not any(
        str(issue.get("severity") or "").upper() == "ERROR"
        for issue in issues
    )
    completed_at = datetime.utcnow()
    change.amazon_submission_id = submission_id
    change.amazon_status = amazon_status
    change.amazon_issues_json = json.dumps(
        issues,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    change.status = "Submitted" if accepted else "Failed"
    change.last_error = (
        None
        if accepted
        else (
            issues[0]["message"]
            if issues
            else "Amazon rejected the price submission."
        )
    )
    change.completed_at = completed_at
    change.updated_at = completed_at
    mapping.pending_price = change.requested_price if accepted else None
    mapping.last_price_submission_id = submission_id
    mapping.last_price_status = change.status
    mapping.last_price_sync = completed_at
    mapping.last_error = change.last_error
    mapping.updated_at = completed_at
    db.flush()
    return PriceSyncResult(
        change_id=change.id,
        mapping_id=mapping.id,
        seller_sku=mapping.seller_sku,
        requested_price=change.requested_price,
        status=change.status,
        submission_id=submission_id,
        issue_count=len(issues),
        amazon_request_id=result.amazon_request_id,
        http_status=result.http_status,
        duration_ms=result.duration_ms,
    )


def price_change_issues(change: AmazonPriceChange) -> list[dict]:
    try:
        values = json.loads(change.amazon_issues_json or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return values if isinstance(values, list) else []


def price_change_response(
    change: AmazonPriceChange,
    *,
    mapping: AmazonProductMapping | None = None,
    product: Product | None = None,
) -> dict:
    return {
        "id": change.id,
        "amazon_account_id": change.amazon_account_id,
        "mapping_id": change.product_mapping_id,
        "sync_job_id": change.sync_job_id,
        "seller_sku": change.seller_sku,
        "asin": mapping.asin if mapping else None,
        "product_title": mapping.product_title if mapping else None,
        "erp_sku": product.article_no if product else None,
        "marketplace_id": change.marketplace_id,
        "currency": change.currency,
        "current_price": change.current_price,
        "requested_price": change.requested_price,
        "minimum_price": change.minimum_price,
        "maximum_price": change.maximum_price,
        "sale_price": change.sale_price,
        "sale_start_date": change.sale_start_date,
        "sale_end_date": change.sale_end_date,
        "change_percent": change.change_percent,
        "approval_threshold_percent": change.approval_threshold_percent,
        "requires_approval": bool(change.requires_approval),
        "status": change.status,
        "reason": change.reason,
        "requested_by_user_id": change.requested_by_user_id,
        "reviewed_by_user_id": change.reviewed_by_user_id,
        "reviewed_at": change.reviewed_at,
        "review_note": change.review_note,
        "amazon_submission_id": change.amazon_submission_id,
        "amazon_status": change.amazon_status,
        "amazon_issues": price_change_issues(change),
        "last_error": change.last_error,
        "completed_at": change.completed_at,
        "created_at": change.created_at,
        "updated_at": change.updated_at,
    }


def pricing_offer_response(
    mapping: AmazonProductMapping,
    *,
    product: Product | None,
    latest_change: AmazonPriceChange | None,
) -> dict:
    return {
        "mapping_id": mapping.id,
        "product_id": mapping.product_id,
        "erp_sku": product.article_no if product else None,
        "erp_product_name": product.name if product else None,
        "seller_sku": mapping.seller_sku,
        "asin": mapping.asin,
        "product_title": mapping.product_title,
        "product_type": mapping.product_type or "PRODUCT",
        "marketplace_id": mapping.marketplace_id,
        "fulfillment_mode": mapping.fulfillment_mode,
        "listing_status": mapping.listing_status,
        "currency": mapping.currency,
        "amazon_price": mapping.amazon_price,
        "minimum_price": mapping.minimum_price,
        "maximum_price": mapping.maximum_price,
        "sale_price": mapping.sale_price,
        "sale_start_date": mapping.sale_start_date,
        "sale_end_date": mapping.sale_end_date,
        "sync_price": bool(mapping.sync_price),
        "pending_price": mapping.pending_price,
        "last_price_submission_id": mapping.last_price_submission_id,
        "last_price_status": mapping.last_price_status,
        "last_price_sync": mapping.last_price_sync,
        "last_error": mapping.last_error,
        "latest_change": (
            price_change_response(
                latest_change,
                mapping=mapping,
                product=product,
            )
            if latest_change
            else None
        ),
    }


def query_pricing_offers(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    errors_only: bool = False,
    offset: int = 0,
    limit: int = 500,
) -> tuple[list[dict], int, dict]:
    query = db.query(AmazonProductMapping).filter(
        AmazonProductMapping.amazon_account_id == account_id
    )
    clean_search = str(search or "").strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        query = query.filter(
            or_(
                AmazonProductMapping.seller_sku.ilike(pattern),
                AmazonProductMapping.asin.ilike(pattern),
                AmazonProductMapping.product_title.ilike(pattern),
            )
        )
    if errors_only:
        query = query.filter(AmazonProductMapping.last_error.is_not(None))
    total = query.count()
    mappings = (
        query.order_by(AmazonProductMapping.seller_sku.asc())
        .offset(max(0, offset))
        .limit(min(1000, max(1, limit)))
        .all()
    )
    items: list[dict] = []
    for mapping in mappings:
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
        items.append(
            pricing_offer_response(
                mapping,
                product=product,
                latest_change=latest_change,
            )
        )
    all_changes = db.query(AmazonPriceChange).filter(
        AmazonPriceChange.amazon_account_id == account_id
    )
    summary = {
        "total_offers": db.query(AmazonProductMapping)
        .filter(AmazonProductMapping.amazon_account_id == account_id)
        .count(),
        "enabled_offers": db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account_id,
            AmazonProductMapping.sync_price.is_(True),
        )
        .count(),
        "pending_approval": all_changes.filter(
            AmazonPriceChange.status == "Pending Approval"
        ).count(),
        "approved": all_changes.filter(
            AmazonPriceChange.status == "Approved"
        ).count(),
        "submitted": all_changes.filter(
            AmazonPriceChange.status == "Submitted"
        ).count(),
        "errors": all_changes.filter(
            AmazonPriceChange.status == "Failed"
        ).count(),
    }
    return items, total, summary


def query_price_changes(
    db: Session,
    *,
    account_id: int,
    status: str | None = None,
    errors_only: bool = False,
    limit: int = 500,
) -> list[dict]:
    query = db.query(AmazonPriceChange).filter(
        AmazonPriceChange.amazon_account_id == account_id
    )
    if status:
        query = query.filter(AmazonPriceChange.status == status)
    if errors_only:
        query = query.filter(AmazonPriceChange.status == "Failed")
    changes = (
        query.order_by(AmazonPriceChange.id.desc())
        .limit(min(1000, max(1, limit)))
        .all()
    )
    rows: list[dict] = []
    for change in changes:
        mapping = (
            db.query(AmazonProductMapping)
            .filter(AmazonProductMapping.id == change.product_mapping_id)
            .first()
        )
        product = (
            db.query(Product).filter(Product.id == mapping.product_id).first()
            if mapping and mapping.product_id
            else None
        )
        rows.append(
            price_change_response(
                change,
                mapping=mapping,
                product=product,
            )
        )
    return rows
