"""Read-only FBA inventory synchronization, history, and reconciliation."""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Product
from .client import AmazonSpApiClient
from .constants import FBA_LOGICAL_LOCATIONS
from .exceptions import AmazonTemporaryError
from .models import (
    AmazonAccount,
    AmazonFbaInventory,
    AmazonFbaInventoryHistory,
    AmazonInventoryLocation,
    AmazonProductMapping,
)


_SNAPSHOT_QUANTITY_FIELDS = (
    "fulfillable_quantity",
    "inbound_working_quantity",
    "inbound_shipped_quantity",
    "inbound_receiving_quantity",
    "reserved_quantity",
    "unfulfillable_quantity",
    "researching_quantity",
    "total_quantity",
)


@dataclass(frozen=True)
class FbaInventorySyncResult:
    imported: int
    created: int
    updated: int
    changed: int
    history_snapshots: int
    mapped: int
    unmapped: int
    low_stock: int
    pages: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int


def _quantity(value: object) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _amazon_datetime(value: object) -> datetime | None:
    clean_value = str(value or "").strip()
    if not clean_value:
        return None
    try:
        parsed = datetime.fromisoformat(clean_value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def ensure_fba_logical_locations(
    db: Session,
    *,
    account_id: int,
) -> list[AmazonInventoryLocation]:
    existing = {
        location.location_code: location
        for location in db.query(AmazonInventoryLocation)
        .filter(AmazonInventoryLocation.amazon_account_id == account_id)
        .all()
    }
    locations: list[AmazonInventoryLocation] = []
    for code, name in FBA_LOGICAL_LOCATIONS:
        location = existing.get(code)
        if not location:
            location = AmazonInventoryLocation(
                amazon_account_id=account_id,
                location_code=code,
                location_name=name,
                category="FBA",
                source_of_truth="Amazon",
                is_read_only=True,
                is_active=True,
            )
            db.add(location)
        else:
            location.location_name = name
            location.category = "FBA"
            location.source_of_truth = "Amazon"
            location.is_read_only = True
            location.is_active = True
        locations.append(location)
    db.flush()
    return locations


def _mapping_for_sku(
    db: Session,
    *,
    account: AmazonAccount,
    seller_sku: str,
) -> AmazonProductMapping | None:
    return (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account.id,
            AmazonProductMapping.marketplace_id == account.marketplace_id,
            AmazonProductMapping.seller_sku == seller_sku,
        )
        .one_or_none()
    )


def _minimum_quantity(
    db: Session,
    mapping: AmazonProductMapping | None,
) -> int:
    if not mapping or not mapping.product_id:
        return 10
    product = db.query(Product).filter(Product.id == mapping.product_id).first()
    return max(0, int(product.low_stock_alert or 0)) if product else 10


def upsert_fba_inventory_summary(
    db: Session,
    *,
    account: AmazonAccount,
    summary: dict,
    synced_at: datetime,
    sync_job_id: int | None = None,
) -> tuple[AmazonFbaInventory, bool, bool, bool]:
    seller_sku = str(summary.get("sellerSku") or "").strip()
    if not seller_sku:
        raise AmazonTemporaryError(
            "Amazon returned FBA inventory without a Seller SKU.",
            error_code="fba_inventory_sku_missing",
        )
    fnsku = str(summary.get("fnSku") or "").strip()
    mapping = _mapping_for_sku(
        db,
        account=account,
        seller_sku=seller_sku,
    )
    inventory = (
        db.query(AmazonFbaInventory)
        .filter(
            AmazonFbaInventory.amazon_account_id == account.id,
            AmazonFbaInventory.marketplace_id == account.marketplace_id,
            AmazonFbaInventory.seller_sku == seller_sku,
            AmazonFbaInventory.fnsku == fnsku,
        )
        .one_or_none()
    )
    created = inventory is None
    if inventory is None:
        inventory = AmazonFbaInventory(
            amazon_account_id=account.id,
            marketplace_id=account.marketplace_id,
            seller_sku=seller_sku,
            fnsku=fnsku,
            minimum_fba_quantity=_minimum_quantity(db, mapping),
        )
        db.add(inventory)

    previous_values = {
        field_name: int(getattr(inventory, field_name) or 0)
        for field_name in _SNAPSHOT_QUANTITY_FIELDS
    }
    details = summary.get("inventoryDetails")
    if not isinstance(details, dict):
        details = {}
    reserved = details.get("reservedQuantity")
    if not isinstance(reserved, dict):
        reserved = {}
    unfulfillable = details.get("unfulfillableQuantity")
    if not isinstance(unfulfillable, dict):
        unfulfillable = {}
    researching = details.get("researchingQuantity")
    if not isinstance(researching, dict):
        researching = {}

    inventory.product_mapping_id = mapping.id if mapping else None
    inventory.asin = str(summary.get("asin") or "").strip() or None
    inventory.product_name = str(summary.get("productName") or "").strip() or None
    inventory.condition = str(summary.get("condition") or "").strip() or None
    inventory.fulfillable_quantity = _quantity(details.get("fulfillableQuantity"))
    inventory.inbound_working_quantity = _quantity(
        details.get("inboundWorkingQuantity")
    )
    inventory.inbound_shipped_quantity = _quantity(
        details.get("inboundShippedQuantity")
    )
    inventory.inbound_receiving_quantity = _quantity(
        details.get("inboundReceivingQuantity")
    )
    inventory.reserved_quantity = _quantity(
        reserved.get("totalReservedQuantity")
    )
    inventory.pending_customer_order_quantity = _quantity(
        reserved.get("pendingCustomerOrderQuantity")
    )
    inventory.pending_transshipment_quantity = _quantity(
        reserved.get("pendingTransshipmentQuantity")
    )
    inventory.fc_processing_quantity = _quantity(
        reserved.get("fcProcessingQuantity")
    )
    inventory.unfulfillable_quantity = _quantity(
        unfulfillable.get("totalUnfulfillableQuantity")
    )
    inventory.customer_damaged_quantity = _quantity(
        unfulfillable.get("customerDamagedQuantity")
    )
    inventory.warehouse_damaged_quantity = _quantity(
        unfulfillable.get("warehouseDamagedQuantity")
    )
    inventory.distributor_damaged_quantity = _quantity(
        unfulfillable.get("distributorDamagedQuantity")
    )
    inventory.carrier_damaged_quantity = _quantity(
        unfulfillable.get("carrierDamagedQuantity")
    )
    inventory.defective_quantity = _quantity(
        unfulfillable.get("defectiveQuantity")
    )
    inventory.expired_quantity = _quantity(
        unfulfillable.get("expiredQuantity")
    )
    inventory.researching_quantity = _quantity(
        researching.get("totalResearchingQuantity")
    )
    inventory.total_quantity = _quantity(summary.get("totalQuantity"))
    inventory.last_amazon_update = _amazon_datetime(
        summary.get("lastUpdatedTime")
    )
    inventory.last_successful_sync = synced_at
    inventory.last_error = None
    inventory.updated_at = synced_at

    if mapping:
        if fnsku:
            mapping.fnsku = fnsku
        if inventory.asin:
            mapping.asin = inventory.asin
        mapping.fba_enabled = True
        mapping.fulfillment_mode = (
            "BOTH" if mapping.fbm_enabled else "FBA"
        )
        mapping.last_amazon_quantity = inventory.total_quantity
        mapping.last_inventory_sync = synced_at
        mapping.last_error = None

    db.flush()
    current_values = {
        field_name: int(getattr(inventory, field_name) or 0)
        for field_name in _SNAPSHOT_QUANTITY_FIELDS
    }
    changed = created or current_values != previous_values
    if changed:
        db.add(
            AmazonFbaInventoryHistory(
                fba_inventory_id=inventory.id,
                amazon_account_id=account.id,
                product_mapping_id=mapping.id if mapping else None,
                sync_job_id=sync_job_id,
                seller_sku=seller_sku,
                fnsku=fnsku,
                asin=inventory.asin,
                fulfillable_quantity=inventory.fulfillable_quantity,
                inbound_working_quantity=inventory.inbound_working_quantity,
                inbound_shipped_quantity=inventory.inbound_shipped_quantity,
                inbound_receiving_quantity=inventory.inbound_receiving_quantity,
                reserved_quantity=inventory.reserved_quantity,
                unfulfillable_quantity=inventory.unfulfillable_quantity,
                researching_quantity=inventory.researching_quantity,
                total_quantity=inventory.total_quantity,
                last_amazon_update=inventory.last_amazon_update,
                snapshot_at=synced_at,
            )
        )
    return (
        inventory,
        created,
        changed,
        mapping is not None and mapping.product_id is not None,
    )


def sync_fba_inventory(
    db: Session,
    *,
    account: AmazonAccount,
    sync_job_id: int | None = None,
    client: AmazonSpApiClient | None = None,
) -> FbaInventorySyncResult:
    ensure_fba_logical_locations(db, account_id=account.id)
    api_client = client or AmazonSpApiClient(account)
    imported = created = updated = changed = snapshots = mapped = pages = 0
    request_id: str | None = None
    duration_ms = 0
    http_status = 200
    next_token: str | None = None
    seen_tokens: set[str] = set()
    synced_at = datetime.utcnow()

    while True:
        result = api_client.get_fba_inventory_summaries(
            next_token=next_token,
        )
        pages += 1
        duration_ms += result.duration_ms
        request_id = result.amazon_request_id or request_id
        http_status = result.http_status
        payload = result.body.get("payload")
        summaries = (
            payload.get("inventorySummaries")
            if isinstance(payload, dict)
            else None
        )
        if not isinstance(summaries, list):
            raise AmazonTemporaryError(
                "Amazon FBA Inventory API returned an invalid response.",
                error_code="fba_inventory_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )
        for raw_summary in summaries:
            if not isinstance(raw_summary, dict):
                continue
            _, was_created, was_changed, was_mapped = (
                upsert_fba_inventory_summary(
                    db,
                    account=account,
                    summary=raw_summary,
                    synced_at=synced_at,
                    sync_job_id=sync_job_id,
                )
            )
            imported += 1
            created += int(was_created)
            updated += int(not was_created)
            changed += int(was_changed)
            snapshots += int(was_changed)
            mapped += int(was_mapped)

        pagination = result.body.get("pagination")
        following_token = (
            str(pagination.get("nextToken") or "").strip()
            if isinstance(pagination, dict)
            else ""
        )
        if not following_token:
            break
        if following_token in seen_tokens or pages >= 1000:
            raise AmazonTemporaryError(
                "Amazon FBA inventory pagination could not be completed safely.",
                error_code="fba_inventory_pagination_invalid",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=duration_ms,
            )
        seen_tokens.add(following_token)
        next_token = following_token

    base_query = db.query(AmazonFbaInventory).filter(
        AmazonFbaInventory.amazon_account_id == account.id
    )
    low_stock = base_query.filter(
        AmazonFbaInventory.fulfillable_quantity
        <= AmazonFbaInventory.minimum_fba_quantity
    ).count()
    return FbaInventorySyncResult(
        imported=imported,
        created=created,
        updated=updated,
        changed=changed,
        history_snapshots=snapshots,
        mapped=mapped,
        unmapped=max(0, imported - mapped),
        low_stock=low_stock,
        pages=pages,
        amazon_request_id=request_id,
        http_status=http_status,
        duration_ms=duration_ms,
    )


def damaged_quantity(inventory: AmazonFbaInventory) -> int:
    return sum(
        int(value or 0)
        for value in (
            inventory.customer_damaged_quantity,
            inventory.warehouse_damaged_quantity,
            inventory.distributor_damaged_quantity,
            inventory.carrier_damaged_quantity,
        )
    )


def inventory_discrepancy_reasons(
    inventory: AmazonFbaInventory,
    mapping: AmazonProductMapping | None,
) -> list[str]:
    reasons: list[str] = []
    if not mapping or mapping.product_id is None:
        reasons.append("Seller SKU is not mapped to an ERP product.")
    elif mapping.fnsku and inventory.fnsku and mapping.fnsku != inventory.fnsku:
        reasons.append("The listing FNSKU differs from the FBA inventory FNSKU.")
    if (
        mapping
        and mapping.asin
        and inventory.asin
        and mapping.asin != inventory.asin
    ):
        reasons.append("The listing ASIN differs from the FBA inventory ASIN.")
    return reasons


def inventory_response(
    inventory: AmazonFbaInventory,
    *,
    mapping: AmazonProductMapping | None = None,
    product: Product | None = None,
) -> dict:
    factory_stock = int(product.factory_stock or 0) if product else 0
    usa_stock = int(product.usa_stock or 0) if product else 0
    front_room_stock = int(product.front_room_stock or 0) if product else 0
    factory_reserved = int(product.reserved_stock or 0) if product else 0
    factory_available = factory_stock + usa_stock + front_room_stock - factory_reserved
    inbound_quantity = sum(
        int(value or 0)
        for value in (
            inventory.inbound_working_quantity,
            inventory.inbound_shipped_quantity,
            inventory.inbound_receiving_quantity,
        )
    )
    reasons = inventory_discrepancy_reasons(inventory, mapping)
    return {
        "id": inventory.id,
        "amazon_account_id": inventory.amazon_account_id,
        "product_mapping_id": inventory.product_mapping_id,
        "product_id": mapping.product_id if mapping else None,
        "erp_sku": product.article_no if product else None,
        "erp_product_name": product.name if product else None,
        "seller_sku": inventory.seller_sku,
        "fnsku": inventory.fnsku or None,
        "asin": inventory.asin,
        "product_name": inventory.product_name,
        "condition": inventory.condition,
        "marketplace_id": inventory.marketplace_id,
        "fulfillable_quantity": inventory.fulfillable_quantity,
        "inbound_working_quantity": inventory.inbound_working_quantity,
        "inbound_shipped_quantity": inventory.inbound_shipped_quantity,
        "inbound_receiving_quantity": inventory.inbound_receiving_quantity,
        "inbound_quantity": inbound_quantity,
        "reserved_quantity": inventory.reserved_quantity,
        "pending_customer_order_quantity": (
            inventory.pending_customer_order_quantity
        ),
        "pending_transshipment_quantity": (
            inventory.pending_transshipment_quantity
        ),
        "fc_processing_quantity": inventory.fc_processing_quantity,
        "unfulfillable_quantity": inventory.unfulfillable_quantity,
        "damaged_quantity": damaged_quantity(inventory),
        "researching_quantity": inventory.researching_quantity,
        "total_quantity": inventory.total_quantity,
        "minimum_fba_quantity": inventory.minimum_fba_quantity,
        "is_low_stock": (
            inventory.fulfillable_quantity <= inventory.minimum_fba_quantity
        ),
        "factory_stock": factory_stock,
        "usa_stock": usa_stock,
        "front_room_stock": front_room_stock,
        "factory_reserved_quantity": factory_reserved,
        "factory_available_quantity": factory_available,
        "total_owned_quantity": factory_stock + usa_stock + front_room_stock + inventory.total_quantity,
        "is_mapped": mapping is not None and mapping.product_id is not None,
        "discrepancy_reasons": reasons,
        "has_discrepancy": bool(reasons),
        "last_amazon_update": inventory.last_amazon_update,
        "last_successful_sync": inventory.last_successful_sync,
        "last_error": inventory.last_error,
        "created_at": inventory.created_at,
        "updated_at": inventory.updated_at,
    }


def _inventory_context(
    db: Session,
    inventories: list[AmazonFbaInventory],
) -> tuple[dict[int, AmazonProductMapping], dict[int, Product]]:
    mapping_ids = {
        inventory.product_mapping_id
        for inventory in inventories
        if inventory.product_mapping_id is not None
    }
    mappings = (
        {
            mapping.id: mapping
            for mapping in db.query(AmazonProductMapping)
            .filter(AmazonProductMapping.id.in_(mapping_ids))
            .all()
        }
        if mapping_ids
        else {}
    )
    product_ids = {
        mapping.product_id
        for mapping in mappings.values()
        if mapping.product_id is not None
    }
    products = (
        {
            product.id: product
            for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
        }
        if product_ids
        else {}
    )
    return mappings, products


def query_fba_inventory(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    low_stock_only: bool = False,
    mapped_only: bool = False,
    discrepancies_only: bool = False,
    offset: int = 0,
    limit: int = 200,
) -> tuple[list[dict], int, dict]:
    base_query = db.query(AmazonFbaInventory).filter(
        AmazonFbaInventory.amazon_account_id == account_id
    )
    all_inventories = base_query.all()
    all_mappings, all_products = _inventory_context(db, all_inventories)
    all_rows = [
        inventory_response(
            inventory,
            mapping=all_mappings.get(inventory.product_mapping_id),
            product=all_products.get(
                getattr(
                    all_mappings.get(inventory.product_mapping_id),
                    "product_id",
                    None,
                )
            ),
        )
        for inventory in all_inventories
    ]
    summary = {
        "sku_count": len(all_rows),
        "fulfillable_quantity": sum(
            row["fulfillable_quantity"] for row in all_rows
        ),
        "inbound_quantity": sum(row["inbound_quantity"] for row in all_rows),
        "reserved_quantity": sum(row["reserved_quantity"] for row in all_rows),
        "unfulfillable_quantity": sum(
            row["unfulfillable_quantity"] for row in all_rows
        ),
        "researching_quantity": sum(
            row["researching_quantity"] for row in all_rows
        ),
        "total_quantity": sum(row["total_quantity"] for row in all_rows),
        "low_stock_count": sum(int(row["is_low_stock"]) for row in all_rows),
        "discrepancy_count": sum(
            int(row["has_discrepancy"]) for row in all_rows
        ),
        "mapped_count": sum(int(row["is_mapped"]) for row in all_rows),
        "unmapped_count": sum(int(not row["is_mapped"]) for row in all_rows),
    }

    query = base_query
    clean_search = str(search or "").strip()
    if clean_search:
        pattern = f"%{clean_search}%"
        query = query.filter(
            or_(
                AmazonFbaInventory.seller_sku.ilike(pattern),
                AmazonFbaInventory.fnsku.ilike(pattern),
                AmazonFbaInventory.asin.ilike(pattern),
                AmazonFbaInventory.product_name.ilike(pattern),
            )
        )
    if low_stock_only:
        query = query.filter(
            AmazonFbaInventory.fulfillable_quantity
            <= AmazonFbaInventory.minimum_fba_quantity
        )
    candidates = query.order_by(AmazonFbaInventory.seller_sku.asc()).all()
    mappings, products = _inventory_context(db, candidates)
    rows = [
        inventory_response(
            inventory,
            mapping=mappings.get(inventory.product_mapping_id),
            product=products.get(
                getattr(
                    mappings.get(inventory.product_mapping_id),
                    "product_id",
                    None,
                )
            ),
        )
        for inventory in candidates
    ]
    if mapped_only:
        rows = [row for row in rows if row["is_mapped"]]
    if discrepancies_only:
        rows = [row for row in rows if row["has_discrepancy"]]
    total = len(rows)
    safe_offset = max(0, offset)
    safe_limit = min(500, max(1, limit))
    return rows[safe_offset : safe_offset + safe_limit], total, summary


def fba_inventory_history_response(
    history: AmazonFbaInventoryHistory,
) -> dict:
    return {
        "id": history.id,
        "fba_inventory_id": history.fba_inventory_id,
        "sync_job_id": history.sync_job_id,
        "seller_sku": history.seller_sku,
        "fnsku": history.fnsku or None,
        "asin": history.asin,
        "fulfillable_quantity": history.fulfillable_quantity,
        "inbound_working_quantity": history.inbound_working_quantity,
        "inbound_shipped_quantity": history.inbound_shipped_quantity,
        "inbound_receiving_quantity": history.inbound_receiving_quantity,
        "reserved_quantity": history.reserved_quantity,
        "unfulfillable_quantity": history.unfulfillable_quantity,
        "researching_quantity": history.researching_quantity,
        "total_quantity": history.total_quantity,
        "last_amazon_update": history.last_amazon_update,
        "snapshot_at": history.snapshot_at,
    }
