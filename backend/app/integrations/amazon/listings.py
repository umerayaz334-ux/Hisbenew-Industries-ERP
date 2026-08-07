"""Listing import, normalization, matching, and mapping persistence."""

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Product
from .client import AmazonSpApiClient
from .exceptions import AmazonConfigurationError, AmazonTemporaryError
from .models import AmazonAccount, AmazonFbaInventory, AmazonProductMapping
from .security import CredentialCipher, sanitize_external_message


@dataclass(frozen=True)
class ListingImportResult:
    imported: int
    created: int
    updated: int
    auto_matched: int
    unmatched: int
    pages: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int


def _as_float(value: object) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: object) -> int | None:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def _marketplace_record(records: object, marketplace_id: str) -> dict:
    if not isinstance(records, list):
        return {}
    for record in records:
        if (
            isinstance(record, dict)
            and record.get("marketplaceId") == marketplace_id
        ):
            return record
    return next((record for record in records if isinstance(record, dict)), {})


def _safe_issues(raw_issues: object) -> list[dict]:
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
                    fallback="listing_issue",
                )[:100],
                "severity": str(raw_issue.get("severity") or "WARNING")[:20],
                "message": sanitize_external_message(
                    raw_issue.get("message"),
                    fallback="Amazon reported a listing issue.",
                ),
                "attribute_names": [
                    str(value)[:120] for value in attribute_names[:20]
                ],
            }
        )
    return issues


def _fulfillment_values(raw_values: object) -> tuple[str | None, int | None]:
    if not isinstance(raw_values, list):
        return None, None
    channels: set[str] = set()
    quantity = 0
    has_quantity = False
    for raw_value in raw_values:
        if not isinstance(raw_value, dict):
            continue
        channel = str(
            raw_value.get("fulfillmentChannelCode") or ""
        ).strip().upper()
        if channel:
            channels.add(channel)
        parsed_quantity = _as_int(raw_value.get("quantity"))
        if parsed_quantity is not None:
            quantity += parsed_quantity
            has_quantity = True
    has_fba = any(channel.startswith("AMAZON") for channel in channels)
    has_fbm = "DEFAULT" in channels or any(
        channel.startswith("MERCHANT") for channel in channels
    )
    if has_fba and has_fbm:
        mode = "BOTH"
    elif has_fba:
        mode = "FBA"
    elif has_fbm:
        mode = "FBM"
    else:
        mode = None
    return mode, quantity if has_quantity else None


def _price_value(raw_offers: object, marketplace_id: str) -> tuple[float | None, str | None]:
    offer = _marketplace_record(raw_offers, marketplace_id)
    price = offer.get("price") if isinstance(offer, dict) else None
    if not isinstance(price, dict):
        return None, None
    return _as_float(price.get("amount")), str(price.get("currency") or "") or None


def _listing_image_url(
    raw_attributes: object,
    marketplace_id: str,
) -> str | None:
    if not isinstance(raw_attributes, dict):
        return None
    for attribute_name in (
        "main_product_image_locator",
        "main_offer_image_locator",
    ):
        values = raw_attributes.get(attribute_name)
        if not isinstance(values, list):
            continue
        marketplace_values = [
            value
            for value in values
            if isinstance(value, dict)
            and str(
                value.get("marketplace_id")
                or value.get("marketplaceId")
                or ""
            ).strip()
            == marketplace_id
        ]
        candidates = marketplace_values or [
            value for value in values if isinstance(value, dict)
        ]
        for candidate in candidates:
            image_url = str(
                candidate.get("media_location")
                or candidate.get("mediaLocation")
                or candidate.get("value")
                or ""
            ).strip()
            if image_url.lower().startswith(("https://", "http://")):
                return image_url[:4096]
    return None


def _is_variation_parent(
    raw_attributes: object,
    marketplace_id: str,
) -> bool:
    """Return whether Amazon identifies this SKU as a variation parent."""
    if not isinstance(raw_attributes, dict):
        return False
    raw_values = raw_attributes.get("parentage_level")
    if not isinstance(raw_values, list):
        return False
    marketplace_values = [
        value
        for value in raw_values
        if isinstance(value, dict)
        and str(
            value.get("marketplace_id")
            or value.get("marketplaceId")
            or ""
        ).strip()
        == marketplace_id
    ]
    candidates = marketplace_values or [
        value for value in raw_values if isinstance(value, dict)
    ]
    return any(
        str(candidate.get("value") or "").strip().lower() == "parent"
        for candidate in candidates
    )


def _exact_product_match(db: Session, seller_sku: str) -> Product | None:
    return (
        db.query(Product)
        .filter(Product.article_no == seller_sku)
        .one_or_none()
    )


def upsert_listing_item(
    db: Session,
    *,
    account: AmazonAccount,
    item: dict,
    synced_at: datetime | None = None,
) -> tuple[AmazonProductMapping, bool, bool]:
    seller_sku = str(item.get("sku") or "").strip()
    if not seller_sku:
        raise AmazonTemporaryError(
            "Amazon returned a listing without a Seller SKU.",
            error_code="listing_sku_missing",
        )

    mapping = (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account.id,
            AmazonProductMapping.marketplace_id == account.marketplace_id,
            AmazonProductMapping.seller_sku == seller_sku,
        )
        .one_or_none()
    )
    created = mapping is None
    if mapping is None:
        mapping = AmazonProductMapping(
            amazon_account_id=account.id,
            marketplace_id=account.marketplace_id,
            seller_sku=seller_sku,
            merchant_seller_sku=seller_sku,
            currency=account.currency,
        )
        db.add(mapping)

    summary = _marketplace_record(
        item.get("summaries"),
        account.marketplace_id,
    )
    issues = _safe_issues(item.get("issues"))
    fulfillment_mode, quantity = _fulfillment_values(
        item.get("fulfillmentAvailability")
    )
    price, currency = _price_value(
        item.get("offers"),
        account.marketplace_id,
    )
    statuses = summary.get("status") if isinstance(summary, dict) else None
    if not isinstance(statuses, list):
        statuses = []

    mapping.asin = str(summary.get("asin") or item.get("asin") or "").strip() or None
    discovered_fnsku = str(
        item.get("fnsku") or summary.get("fnsku") or ""
    ).strip()
    if discovered_fnsku:
        mapping.fnsku = discovered_fnsku
    mapping.product_title = str(summary.get("itemName") or "").strip() or None
    raw_attributes = item.get("attributes")
    mapping.is_variation_parent = _is_variation_parent(
        raw_attributes,
        account.marketplace_id,
    )
    if isinstance(raw_attributes, dict):
        mapping.amazon_image_url = _listing_image_url(
            raw_attributes,
            account.marketplace_id,
        )
    mapping.product_type = (
        str(item.get("productType") or mapping.product_type or "PRODUCT")
        .strip()
        .upper()
    )
    mapping.condition_type = (
        str(summary.get("conditionType") or "").strip() or None
    )
    mapping.listing_status = (
        ", ".join(str(value) for value in statuses if value)
        or "INACTIVE"
    )
    mapping.listing_issues_json = json.dumps(
        issues,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    mapping.fulfillment_mode = (
        fulfillment_mode or mapping.fulfillment_mode or "FBA"
    )
    mapping.fba_enabled = mapping.fulfillment_mode in {"FBA", "BOTH"}
    mapping.fbm_enabled = mapping.fulfillment_mode in {"FBM", "BOTH"}
    mapping.amazon_price = price
    mapping.currency = currency or account.currency
    if mapping.fulfillment_mode in {"FBA", "BOTH"}:
        mapping.fba_price = price
    if mapping.fulfillment_mode in {"FBM", "BOTH"}:
        mapping.fbm_price = price
    mapping.last_amazon_quantity = quantity
    mapping.last_listing_sync = synced_at or datetime.utcnow()
    mapping.last_error = None
    mapping.updated_at = synced_at or datetime.utcnow()

    auto_matched = False
    if mapping.product_id is None and not mapping.is_variation_parent:
        product = _exact_product_match(db, seller_sku)
        if product:
            mapping.product_id = product.id
            auto_matched = True
    db.flush()
    return mapping, created, auto_matched


def import_all_listings(
    db: Session,
    *,
    account: AmazonAccount,
    client: AmazonSpApiClient | None = None,
) -> ListingImportResult:
    if not account.id:
        raise AmazonConfigurationError(
            "Amazon settings must be saved before importing listings.",
            error_code="account_not_saved",
        )
    seller_id = CredentialCipher().decrypt(account.encrypted_seller_id)
    if not seller_id:
        raise AmazonConfigurationError(
            "Amazon Seller ID is required before importing listings.",
            error_code="seller_id_missing",
        )

    api_client = client or AmazonSpApiClient(account)
    imported = created = updated = auto_matched = pages = duration_ms = 0
    page_token: str | None = None
    request_id: str | None = None
    http_status = 200
    seen_tokens: set[str] = set()
    synced_at = datetime.utcnow()

    while True:
        result = api_client.search_listing_items(
            seller_id,
            page_token=page_token,
        )
        pages += 1
        duration_ms += result.duration_ms
        request_id = result.amazon_request_id or request_id
        http_status = result.http_status
        raw_items = result.body.get("items")
        if not isinstance(raw_items, list):
            raise AmazonTemporaryError(
                "Amazon Listings API returned an invalid response.",
                error_code="listings_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            _, was_created, was_auto_matched = upsert_listing_item(
                db,
                account=account,
                item=item,
                synced_at=synced_at,
            )
            imported += 1
            created += int(was_created)
            updated += int(not was_created)
            auto_matched += int(was_auto_matched)

        pagination = result.body.get("pagination")
        next_token = (
            str(pagination.get("nextToken") or "").strip()
            if isinstance(pagination, dict)
            else ""
        )
        if not next_token:
            break
        if next_token in seen_tokens or pages >= 1000:
            raise AmazonTemporaryError(
                "Amazon Listings pagination could not be completed safely.",
                error_code="listings_pagination_invalid",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=duration_ms,
            )
        seen_tokens.add(next_token)
        page_token = next_token

    unmatched = (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account.id,
            AmazonProductMapping.product_id.is_(None),
            AmazonProductMapping.is_variation_parent.is_(False),
        )
        .count()
    )
    return ListingImportResult(
        imported=imported,
        created=created,
        updated=updated,
        auto_matched=auto_matched,
        unmatched=unmatched,
        pages=pages,
        amazon_request_id=request_id,
        http_status=http_status,
        duration_ms=duration_ms,
    )


def sync_one_listing(
    db: Session,
    *,
    account: AmazonAccount,
    mapping: AmazonProductMapping,
    client: AmazonSpApiClient | None = None,
) -> ListingImportResult:
    seller_id = CredentialCipher().decrypt(account.encrypted_seller_id)
    if not seller_id:
        raise AmazonConfigurationError(
            "Amazon Seller ID is required before refreshing a listing.",
            error_code="seller_id_missing",
        )
    result = (client or AmazonSpApiClient(account)).get_listing_item(
        seller_id,
        mapping.seller_sku,
    )
    item = dict(result.body)
    item.setdefault("sku", mapping.seller_sku)
    _, created, auto_matched = upsert_listing_item(
        db,
        account=account,
        item=item,
    )
    return ListingImportResult(
        imported=1,
        created=int(created),
        updated=int(not created),
        auto_matched=int(auto_matched),
        unmatched=int(mapping.product_id is None),
        pages=1,
        amazon_request_id=result.amazon_request_id,
        http_status=result.http_status,
        duration_ms=result.duration_ms,
    )


def auto_match_unmapped_listings(
    db: Session,
    *,
    account_id: int,
) -> tuple[int, int]:
    mappings = (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account_id,
            AmazonProductMapping.product_id.is_(None),
            AmazonProductMapping.is_variation_parent.is_(False),
        )
        .all()
    )
    matched = 0
    for mapping in mappings:
        product = _exact_product_match(db, mapping.seller_sku)
        if product:
            mapping.product_id = product.id
            mapping.updated_at = datetime.utcnow()
            matched += 1
    db.flush()
    return matched, len(mappings) - matched


def listing_issues(mapping: AmazonProductMapping) -> list[dict]:
    try:
        values = json.loads(mapping.listing_issues_json or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return values if isinstance(values, list) else []


def listing_inventory_response(
    inventories: list[AmazonFbaInventory] | None,
) -> dict | None:
    """Aggregate the FBA inventory buckets belonging to one Seller SKU."""
    rows = inventories or []
    if not rows:
        return None

    def total(field_name: str) -> int:
        return sum(max(0, int(getattr(row, field_name, 0) or 0)) for row in rows)

    fulfillable_quantity = total("fulfillable_quantity")
    minimum_fba_quantity = max(
        max(0, int(row.minimum_fba_quantity or 0)) for row in rows
    )
    if fulfillable_quantity <= 0:
        health = "Out of stock"
    elif fulfillable_quantity <= minimum_fba_quantity:
        health = "Low stock"
    else:
        health = "Healthy"

    inbound_working_quantity = total("inbound_working_quantity")
    inbound_shipped_quantity = total("inbound_shipped_quantity")
    inbound_receiving_quantity = total("inbound_receiving_quantity")
    damaged_quantity = sum(
        total(field_name)
        for field_name in (
            "customer_damaged_quantity",
            "warehouse_damaged_quantity",
            "distributor_damaged_quantity",
            "carrier_damaged_quantity",
        )
    )
    successful_syncs = [
        row.last_successful_sync
        for row in rows
        if row.last_successful_sync is not None
    ]
    amazon_updates = [
        row.last_amazon_update
        for row in rows
        if row.last_amazon_update is not None
    ]
    return {
        "fulfillable_quantity": fulfillable_quantity,
        "inbound_working_quantity": inbound_working_quantity,
        "inbound_shipped_quantity": inbound_shipped_quantity,
        "inbound_receiving_quantity": inbound_receiving_quantity,
        "inbound_quantity": (
            inbound_working_quantity
            + inbound_shipped_quantity
            + inbound_receiving_quantity
        ),
        "reserved_quantity": total("reserved_quantity"),
        "pending_customer_order_quantity": total(
            "pending_customer_order_quantity"
        ),
        "pending_transshipment_quantity": total(
            "pending_transshipment_quantity"
        ),
        "fc_processing_quantity": total("fc_processing_quantity"),
        "unfulfillable_quantity": total("unfulfillable_quantity"),
        "damaged_quantity": damaged_quantity,
        "researching_quantity": total("researching_quantity"),
        "total_quantity": total("total_quantity"),
        "minimum_fba_quantity": minimum_fba_quantity,
        "health": health,
        "last_amazon_update": max(amazon_updates) if amazon_updates else None,
        "last_successful_sync": (
            max(successful_syncs) if successful_syncs else None
        ),
    }


def mapping_response(
    mapping: AmazonProductMapping,
    product: Product | None = None,
    inventories: list[AmazonFbaInventory] | None = None,
) -> dict:
    issues = listing_issues(mapping)
    fba_inventory = listing_inventory_response(inventories)
    amazon_statuses = {
        status.strip().upper()
        for status in str(mapping.listing_status or "").split(",")
        if status.strip()
    }
    return {
        "id": mapping.id,
        "amazon_account_id": mapping.amazon_account_id,
        "product_id": mapping.product_id,
        "erp_sku": product.article_no if product else None,
        "erp_product_name": product.name if product else None,
        "seller_sku": mapping.seller_sku,
        "merchant_seller_sku": mapping.merchant_seller_sku,
        "asin": mapping.asin,
        "fnsku": mapping.fnsku,
        "upc_ean": mapping.upc_ean,
        "product_title": mapping.product_title,
        "image_url": mapping.amazon_image_url or (
            product.image_url if product else None
        ),
        "amazon_image_url": mapping.amazon_image_url,
        "is_variation_parent": bool(mapping.is_variation_parent),
        "marketplace_id": mapping.marketplace_id,
        "fulfillment_mode": mapping.fulfillment_mode,
        "fba_enabled": bool(mapping.fba_enabled),
        "fbm_enabled": bool(mapping.fbm_enabled),
        "condition_type": mapping.condition_type,
        "listing_status": mapping.listing_status,
        "product_status": (
            "Active" if "BUYABLE" in amazon_statuses else "Inactive"
        ),
        "listing_issues": issues,
        "issue_count": len(issues),
        "amazon_price": mapping.amazon_price,
        "currency": mapping.currency,
        "sync_price": bool(mapping.sync_price),
        "sync_inventory": bool(mapping.sync_inventory),
        "last_amazon_quantity": mapping.last_amazon_quantity,
        "fba_inventory": fba_inventory,
        "last_listing_sync": mapping.last_listing_sync,
        "last_error": mapping.last_error,
        "created_at": mapping.created_at,
        "updated_at": mapping.updated_at,
    }


def query_listing_mappings(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    mapping_status: str | None = None,
    fulfillment_mode: str | None = None,
    issues_only: bool = False,
    offset: int = 0,
    limit: int = 100,
) -> tuple[list[dict], int, dict]:
    account_query = db.query(AmazonProductMapping).filter(
        AmazonProductMapping.amazon_account_id == account_id
    )
    variation_parents_hidden = account_query.filter(
        AmazonProductMapping.is_variation_parent.is_(True)
    ).count()
    base_query = account_query.filter(
        AmazonProductMapping.is_variation_parent.is_(False)
    )
    summary = {
        "total": base_query.count(),
        "mapped": base_query.filter(
            AmazonProductMapping.product_id.is_not(None)
        ).count(),
        "unmapped": base_query.filter(
            AmazonProductMapping.product_id.is_(None)
        ).count(),
        "with_issues": base_query.filter(
            AmazonProductMapping.listing_issues_json.is_not(None),
            AmazonProductMapping.listing_issues_json != "[]",
        ).count(),
        "variation_parents_hidden": variation_parents_hidden,
    }

    query = base_query
    clean_search = str(search or "").strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        query = query.filter(
            or_(
                AmazonProductMapping.seller_sku.ilike(pattern),
                AmazonProductMapping.asin.ilike(pattern),
                AmazonProductMapping.fnsku.ilike(pattern),
                AmazonProductMapping.product_title.ilike(pattern),
            )
        )
    if mapping_status == "mapped":
        query = query.filter(AmazonProductMapping.product_id.is_not(None))
    elif mapping_status == "unmapped":
        query = query.filter(AmazonProductMapping.product_id.is_(None))
    if fulfillment_mode:
        query = query.filter(
            AmazonProductMapping.fulfillment_mode == fulfillment_mode
        )
    if issues_only:
        query = query.filter(
            AmazonProductMapping.listing_issues_json.is_not(None),
            AmazonProductMapping.listing_issues_json != "[]",
        )

    total = query.count()
    mappings = (
        query.order_by(AmazonProductMapping.seller_sku.asc())
        .offset(max(0, offset))
        .limit(min(200, max(1, limit)))
        .all()
    )
    product_ids = {
        mapping.product_id for mapping in mappings if mapping.product_id is not None
    }
    products = (
        {
            product.id: product
            for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
        }
        if product_ids
        else {}
    )
    seller_skus = {mapping.seller_sku for mapping in mappings}
    inventory_by_sku: dict[str, list[AmazonFbaInventory]] = {}
    if seller_skus:
        inventory_rows = (
            db.query(AmazonFbaInventory)
            .filter(
                AmazonFbaInventory.amazon_account_id == account_id,
                AmazonFbaInventory.seller_sku.in_(seller_skus),
            )
            .all()
        )
        for inventory in inventory_rows:
            inventory_by_sku.setdefault(inventory.seller_sku, []).append(
                inventory
            )
    return [
        mapping_response(
            mapping,
            products.get(mapping.product_id),
            inventory_by_sku.get(mapping.seller_sku),
        )
        for mapping in mappings
    ], total, summary
