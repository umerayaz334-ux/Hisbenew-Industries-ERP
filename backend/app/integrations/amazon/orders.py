"""PII-free Amazon FBA order synchronization and reconciliation."""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ...models import Product
from .client import AmazonSpApiClient
from .exceptions import AmazonTemporaryError
from .models import (
    AmazonAccount,
    AmazonOrder,
    AmazonOrderItem,
    AmazonOrderStatusHistory,
    AmazonProductMapping,
)


AMAZON_TO_ERP_STATUS = {
    "PENDING_AVAILABILITY": "Pending Amazon Confirmation",
    "PENDING": "Pending Amazon Confirmation",
    "UNSHIPPED": "Ready for Processing",
    "PARTIALLY_SHIPPED": "Partially Shipped",
    "SHIPPED": "Completed",
    "CANCELLED": "Cancelled",
    "UNFULFILLABLE": "Unfulfillable",
}

AMAZON_TO_SHIPMENT_STATUS = {
    "PENDING_AVAILABILITY": "Pending",
    "PENDING": "Pending",
    "UNSHIPPED": "Awaiting Amazon Fulfillment",
    "PARTIALLY_SHIPPED": "Partially Shipped",
    "SHIPPED": "Shipped",
    "CANCELLED": "Cancelled",
    "UNFULFILLABLE": "Unfulfillable",
}


@dataclass(frozen=True)
class FbaOrderSyncResult:
    imported: int
    created: int
    updated: int
    status_changed: int
    items_imported: int
    items_created: int
    items_updated: int
    mapped_items: int
    unmapped_items: int
    pages: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int
    sync_mode: str = "single_order"
    sync_cursor: str | None = None
    created_order_total: float = 0
    created_order_currency: str | None = None


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


def _iso_cursor(value: datetime | str) -> str:
    if isinstance(value, str):
        parsed = _amazon_datetime(value)
        if not parsed:
            raise ValueError("Amazon order synchronization cursor is invalid.")
    else:
        parsed = value
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return (
        parsed.replace(microsecond=0, tzinfo=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _money(value: object) -> tuple[float, str | None]:
    if not isinstance(value, dict):
        return 0.0, None
    try:
        amount = float(value.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    currency = str(value.get("currencyCode") or "").strip().upper() or None
    return amount, currency


def _breakdown_amount(
    breakdowns: object,
    category: str,
) -> tuple[float, str | None]:
    if not isinstance(breakdowns, list):
        return 0.0, None
    amount = 0.0
    currency: str | None = None
    for breakdown in breakdowns:
        if not isinstance(breakdown, dict):
            continue
        if str(breakdown.get("type") or "").strip().upper() != category:
            continue
        current_amount, current_currency = _money(breakdown.get("subtotal"))
        amount += current_amount
        currency = currency or current_currency
    return amount, currency


def _mapping_for_sku(
    db: Session,
    *,
    account_id: int,
    marketplace_id: str,
    seller_sku: str,
) -> AmazonProductMapping | None:
    return (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account_id,
            AmazonProductMapping.marketplace_id == marketplace_id,
            AmazonProductMapping.seller_sku == seller_sku,
        )
        .one_or_none()
    )


def _item_status(
    *,
    order_status: str,
    quantity_ordered: int,
    quantity_shipped: int,
) -> str:
    if order_status == "CANCELLED":
        return "Cancelled"
    if order_status == "UNFULFILLABLE":
        return "Unfulfillable"
    if quantity_shipped <= 0:
        return "Pending"
    if quantity_shipped < quantity_ordered:
        return "Partially Shipped"
    return "Shipped"


def upsert_fba_order(
    db: Session,
    *,
    account: AmazonAccount,
    raw_order: dict,
    synced_at: datetime,
    sync_job_id: int | None = None,
) -> dict:
    amazon_order_id = str(raw_order.get("orderId") or "").strip()
    if not amazon_order_id:
        raise AmazonTemporaryError(
            "Amazon returned an order without an order ID.",
            error_code="amazon_order_id_missing",
        )
    fulfillment = raw_order.get("fulfillment")
    if not isinstance(fulfillment, dict):
        raise AmazonTemporaryError(
            "Amazon returned an order without fulfillment details.",
            error_code="amazon_order_fulfillment_missing",
        )
    fulfilled_by = str(fulfillment.get("fulfilledBy") or "").strip().upper()
    if fulfilled_by != "AMAZON":
        raise AmazonTemporaryError(
            "Amazon returned a non-FBA order to the FBA synchronization.",
            error_code="amazon_non_fba_order_returned",
        )
    sales_channel = raw_order.get("salesChannel")
    if not isinstance(sales_channel, dict):
        sales_channel = {}
    marketplace_id = (
        str(sales_channel.get("marketplaceId") or "").strip()
        or account.marketplace_id
    )
    purchase_date = _amazon_datetime(raw_order.get("createdTime"))
    last_update_date = _amazon_datetime(raw_order.get("lastUpdatedTime"))
    if not purchase_date or not last_update_date:
        raise AmazonTemporaryError(
            "Amazon returned an order with an invalid timestamp.",
            error_code="amazon_order_timestamp_invalid",
        )
    order_status = (
        str(fulfillment.get("fulfillmentStatus") or "PENDING")
        .strip()
        .upper()
    )
    erp_status = AMAZON_TO_ERP_STATUS.get(order_status, "Amazon Review")
    shipment_status = AMAZON_TO_SHIPMENT_STATUS.get(order_status, "Amazon Review")

    order = (
        db.query(AmazonOrder)
        .filter(
            AmazonOrder.amazon_account_id == account.id,
            AmazonOrder.amazon_order_id == amazon_order_id,
        )
        .one_or_none()
    )
    created = order is None
    if order is None:
        order = AmazonOrder(
            amazon_account_id=account.id,
            amazon_order_id=amazon_order_id,
            marketplace_id=marketplace_id,
            purchase_date=purchase_date,
            last_update_date=last_update_date,
            order_status=order_status,
            erp_status=erp_status,
            shipment_status=shipment_status,
            fulfillment_channel="AMAZON",
            sales_channel="AMAZON",
        )
        db.add(order)

    previous_order_status = order.order_status
    previous_erp_status = order.erp_status
    previous_shipment_status = order.shipment_status
    status_changed = (
        not created
        and (
            previous_order_status != order_status
            or previous_erp_status != erp_status
            or previous_shipment_status != shipment_status
        )
    )

    proceeds = raw_order.get("proceeds")
    if not isinstance(proceeds, dict):
        proceeds = {}
    order_total, order_currency = _money(proceeds.get("grandTotal"))
    breakdowns = proceeds.get("breakdowns")
    item_total, item_currency = _breakdown_amount(breakdowns, "ITEM")
    shipping_total, shipping_currency = _breakdown_amount(
        breakdowns,
        "SHIPPING",
    )
    tax_total, tax_currency = _breakdown_amount(breakdowns, "TAX")
    discount_total, discount_currency = _breakdown_amount(
        breakdowns,
        "DISCOUNT",
    )
    ship_window = fulfillment.get("shipByWindow")
    if not isinstance(ship_window, dict):
        ship_window = {}
    delivery_window = fulfillment.get("deliverByWindow")
    if not isinstance(delivery_window, dict):
        delivery_window = {}

    order.marketplace_id = marketplace_id
    order.marketplace_name = (
        str(sales_channel.get("marketplaceName") or "").strip() or None
    )
    order.fulfillment_channel = "AMAZON"
    order.sales_channel = (
        str(sales_channel.get("channelName") or "AMAZON").strip().upper()
    )
    order.purchase_date = purchase_date
    order.last_update_date = last_update_date
    order.order_status = order_status
    order.erp_status = erp_status
    order.currency = (
        order_currency
        or item_currency
        or shipping_currency
        or tax_currency
        or discount_currency
        or account.currency
    )
    order.order_total = order_total
    order.item_total = item_total
    order.shipping_total = shipping_total
    order.tax_total = tax_total
    order.promotion_total = abs(discount_total)
    order.payment_status = "Amazon Managed"
    order.shipment_status = shipment_status
    order.earliest_ship_date = _amazon_datetime(
        ship_window.get("earliestDateTime")
    )
    order.latest_ship_date = _amazon_datetime(
        ship_window.get("latestDateTime")
    )
    order.earliest_delivery_date = _amazon_datetime(
        delivery_window.get("earliestDateTime")
    )
    order.latest_delivery_date = _amazon_datetime(
        delivery_window.get("latestDateTime")
    )
    programs = raw_order.get("programs")
    safe_programs = (
        [str(program)[:100] for program in programs]
        if isinstance(programs, list)
        else []
    )
    order.programs_json = json.dumps(safe_programs, separators=(",", ":"))
    order.last_amazon_update = last_update_date
    order.last_successful_sync = synced_at
    order.last_error = None
    order.updated_at = synced_at
    db.flush()

    raw_items = raw_order.get("orderItems")
    if not isinstance(raw_items, list):
        raise AmazonTemporaryError(
            "Amazon returned an order without an item list.",
            error_code="amazon_order_items_missing",
        )
    items_created = items_updated = mapped_items = unmapped_items = unit_count = 0
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        amazon_order_item_id = str(raw_item.get("orderItemId") or "").strip()
        if not amazon_order_item_id:
            raise AmazonTemporaryError(
                "Amazon returned an order item without an item ID.",
                error_code="amazon_order_item_id_missing",
            )
        product_data = raw_item.get("product")
        if not isinstance(product_data, dict):
            product_data = {}
        seller_sku = str(product_data.get("sellerSku") or "").strip()
        mapping = (
            _mapping_for_sku(
                db,
                account_id=account.id,
                marketplace_id=marketplace_id,
                seller_sku=seller_sku,
            )
            if seller_sku
            else None
        )
        product_id = mapping.product_id if mapping and mapping.product_id else None
        item = (
            db.query(AmazonOrderItem)
            .filter(
                AmazonOrderItem.amazon_order_database_id == order.id,
                AmazonOrderItem.amazon_order_item_id == amazon_order_item_id,
            )
            .one_or_none()
        )
        if item is None:
            item = AmazonOrderItem(
                amazon_order_database_id=order.id,
                amazon_order_item_id=amazon_order_item_id,
                seller_sku=seller_sku,
            )
            db.add(item)
            items_created += 1
        else:
            items_updated += 1

        quantity_ordered = max(0, int(raw_item.get("quantityOrdered") or 0))
        item_fulfillment = raw_item.get("fulfillment")
        if not isinstance(item_fulfillment, dict):
            item_fulfillment = {}
        quantity_shipped = max(
            0,
            int(item_fulfillment.get("quantityFulfilled") or 0),
        )
        item_proceeds = raw_item.get("proceeds")
        if not isinstance(item_proceeds, dict):
            item_proceeds = {}
        item_price, item_currency = _money(item_proceeds.get("proceedsTotal"))
        item_breakdowns = item_proceeds.get("breakdowns")
        item_tax, item_tax_currency = _breakdown_amount(
            item_breakdowns,
            "TAX",
        )
        item_shipping, shipping_currency = _breakdown_amount(
            item_breakdowns,
            "SHIPPING",
        )
        item_discount, discount_currency = _breakdown_amount(
            item_breakdowns,
            "DISCOUNT",
        )
        product_price = product_data.get("price")
        if not isinstance(product_price, dict):
            product_price = {}
        unit_price, unit_currency = _money(product_price.get("unitPrice"))
        condition = product_data.get("condition")
        if not isinstance(condition, dict):
            condition = {}

        item.product_mapping_id = mapping.id if mapping else None
        item.product_id = product_id
        item.seller_sku = seller_sku
        item.asin = str(product_data.get("asin") or "").strip() or None
        item.title = str(product_data.get("title") or "").strip() or None
        item.condition_type = (
            str(condition.get("conditionType") or "").strip() or None
        )
        item.quantity_ordered = quantity_ordered
        item.quantity_shipped = min(quantity_shipped, quantity_ordered)
        item.currency = (
            item_currency
            or item_tax_currency
            or shipping_currency
            or discount_currency
            or unit_currency
            or order.currency
        )
        item.unit_price = unit_price
        item.item_price = item_price
        item.item_tax = item_tax
        item.shipping_price = item_shipping
        item.shipping_tax = 0
        item.discount = abs(item_discount)
        item.promotion_discount = abs(item_discount)
        item.item_status = _item_status(
            order_status=order_status,
            quantity_ordered=quantity_ordered,
            quantity_shipped=item.quantity_shipped,
        )
        item.last_error = (
            None
            if product_id
            else "Seller SKU is not mapped to an ERP product."
        )
        item.updated_at = synced_at
        unit_count += quantity_ordered
        mapped_items += int(product_id is not None)
        unmapped_items += int(product_id is None)

    order.item_count = len(raw_items)
    order.unit_count = unit_count
    order.mapped_item_count = mapped_items
    order.unmapped_item_count = unmapped_items
    if created or status_changed:
        db.add(
            AmazonOrderStatusHistory(
                amazon_order_database_id=order.id,
                sync_job_id=sync_job_id,
                previous_order_status=None if created else previous_order_status,
                order_status=order_status,
                previous_erp_status=None if created else previous_erp_status,
                erp_status=erp_status,
                previous_shipment_status=(
                    None if created else previous_shipment_status
                ),
                shipment_status=shipment_status,
                changed_at=synced_at,
            )
        )
    db.flush()
    return {
        "created": created,
        "status_changed": created or status_changed,
        "order_total": float(order.order_total or 0),
        "currency": order.currency,
        "items_imported": len(raw_items),
        "items_created": items_created,
        "items_updated": items_updated,
        "mapped_items": mapped_items,
        "unmapped_items": unmapped_items,
    }


def sync_fba_orders(
    db: Session,
    *,
    account: AmazonAccount,
    days: int = 14,
    last_updated_after: datetime | str | None = None,
    sync_job_id: int | None = None,
    client: AmazonSpApiClient | None = None,
) -> FbaOrderSyncResult:
    safe_days = min(14, max(1, int(days)))
    sync_mode = "incremental" if last_updated_after else "backfill"
    sync_cursor = (
        _iso_cursor(last_updated_after)
        if last_updated_after
        else (
            datetime.now(timezone.utc) - timedelta(days=safe_days)
        ).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    api_client = client or AmazonSpApiClient(account)
    imported = created = updated = status_changed = 0
    created_order_total = 0.0
    created_order_currency: str | None = None
    items_imported = items_created = items_updated = 0
    mapped_items = unmapped_items = pages = 0
    pagination_token: str | None = None
    seen_tokens: set[str] = set()
    amazon_request_id: str | None = None
    http_status = 200
    duration_ms = 0
    synced_at = datetime.utcnow()

    while True:
        cursor_arguments = (
            {"last_updated_after": sync_cursor}
            if sync_mode == "incremental"
            else {"created_after": sync_cursor}
        )
        result = api_client.search_fba_orders(
            **cursor_arguments,
            pagination_token=pagination_token,
        )
        pages += 1
        duration_ms += result.duration_ms
        amazon_request_id = result.amazon_request_id or amazon_request_id
        http_status = result.http_status
        raw_orders = result.body.get("orders")
        if not isinstance(raw_orders, list):
            raise AmazonTemporaryError(
                "Amazon Orders API returned an invalid response.",
                error_code="amazon_orders_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )
        for raw_order in raw_orders:
            if not isinstance(raw_order, dict):
                continue
            outcome = upsert_fba_order(
                db,
                account=account,
                raw_order=raw_order,
                synced_at=synced_at,
                sync_job_id=sync_job_id,
            )
            imported += 1
            created += int(outcome["created"])
            if outcome["created"]:
                created_order_total += float(outcome["order_total"] or 0)
                created_order_currency = (
                    str(outcome["currency"] or "").strip().upper()
                    or created_order_currency
                    or account.currency
                )
            updated += int(not outcome["created"])
            status_changed += int(outcome["status_changed"])
            items_imported += outcome["items_imported"]
            items_created += outcome["items_created"]
            items_updated += outcome["items_updated"]
            mapped_items += outcome["mapped_items"]
            unmapped_items += outcome["unmapped_items"]

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
                "Amazon order pagination could not be completed safely.",
                error_code="amazon_orders_pagination_invalid",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=duration_ms,
            )
        seen_tokens.add(next_token)
        pagination_token = next_token

    return FbaOrderSyncResult(
        imported=imported,
        created=created,
        updated=updated,
        status_changed=status_changed,
        items_imported=items_imported,
        items_created=items_created,
        items_updated=items_updated,
        mapped_items=mapped_items,
        unmapped_items=unmapped_items,
        pages=pages,
        amazon_request_id=amazon_request_id,
        http_status=http_status,
        duration_ms=duration_ms,
        sync_mode=sync_mode,
        sync_cursor=sync_cursor,
        created_order_total=round(created_order_total, 2),
        created_order_currency=created_order_currency,
    )


def refresh_fba_order(
    db: Session,
    *,
    account: AmazonAccount,
    amazon_order_id: str,
    sync_job_id: int | None = None,
    client: AmazonSpApiClient | None = None,
) -> FbaOrderSyncResult:
    result = (client or AmazonSpApiClient(account)).get_fba_order(
        amazon_order_id
    )
    raw_order = result.body.get("order")
    if not isinstance(raw_order, dict):
        raise AmazonTemporaryError(
            "Amazon Orders API returned an invalid order response.",
            error_code="amazon_order_invalid_response",
            http_status=result.http_status,
            amazon_request_id=result.amazon_request_id,
            duration_ms=result.duration_ms,
        )
    outcome = upsert_fba_order(
        db,
        account=account,
        raw_order=raw_order,
        synced_at=datetime.utcnow(),
        sync_job_id=sync_job_id,
    )
    return FbaOrderSyncResult(
        imported=1,
        created=int(outcome["created"]),
        updated=int(not outcome["created"]),
        status_changed=int(outcome["status_changed"]),
        items_imported=outcome["items_imported"],
        items_created=outcome["items_created"],
        items_updated=outcome["items_updated"],
        mapped_items=outcome["mapped_items"],
        unmapped_items=outcome["unmapped_items"],
        pages=1,
        amazon_request_id=result.amazon_request_id,
        http_status=result.http_status,
        duration_ms=result.duration_ms,
        created_order_total=(
            round(float(outcome["order_total"] or 0), 2)
            if outcome["created"]
            else 0
        ),
        created_order_currency=(
            str(outcome["currency"] or "").strip().upper() or None
            if outcome["created"]
            else None
        ),
    )


def retry_order_mapping(
    db: Session,
    *,
    account_id: int,
    order: AmazonOrder,
) -> dict:
    items = (
        db.query(AmazonOrderItem)
        .filter(AmazonOrderItem.amazon_order_database_id == order.id)
        .all()
    )
    mapped = unmapped = 0
    for item in items:
        mapping = (
            _mapping_for_sku(
                db,
                account_id=account_id,
                marketplace_id=order.marketplace_id,
                seller_sku=item.seller_sku,
            )
            if item.seller_sku
            else None
        )
        item.product_mapping_id = mapping.id if mapping else None
        item.product_id = (
            mapping.product_id if mapping and mapping.product_id else None
        )
        item.last_error = (
            None
            if item.product_id
            else "Seller SKU is not mapped to an ERP product."
        )
        mapped += int(item.product_id is not None)
        unmapped += int(item.product_id is None)
    order.mapped_item_count = mapped
    order.unmapped_item_count = unmapped
    order.updated_at = datetime.utcnow()
    db.flush()
    return {"mapped_items": mapped, "unmapped_items": unmapped}


def _order_items(
    db: Session,
    order_ids: list[int],
) -> dict[int, list[AmazonOrderItem]]:
    grouped: dict[int, list[AmazonOrderItem]] = {order_id: [] for order_id in order_ids}
    if not order_ids:
        return grouped
    for item in (
        db.query(AmazonOrderItem)
        .filter(AmazonOrderItem.amazon_order_database_id.in_(order_ids))
        .order_by(AmazonOrderItem.id.asc())
        .all()
    ):
        grouped.setdefault(item.amazon_order_database_id, []).append(item)
    return grouped


def _products(
    db: Session,
    grouped_items: dict[int, list[AmazonOrderItem]],
) -> dict[int, Product]:
    product_ids = {
        item.product_id
        for items in grouped_items.values()
        for item in items
        if item.product_id is not None
    }
    if not product_ids:
        return {}
    return {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
    }


def order_response(
    order: AmazonOrder,
    *,
    items: list[AmazonOrderItem],
    products: dict[int, Product],
) -> dict:
    item_rows = []
    issues = []
    for item in items:
        product = products.get(item.product_id)
        mapped = product is not None
        if not mapped:
            issues.append(
                {
                    "code": "unmapped_seller_sku",
                    "message": "Seller SKU is not mapped to an ERP product.",
                    "seller_sku": item.seller_sku,
                    "amazon_order_item_id": item.amazon_order_item_id,
                }
            )
        item_rows.append(
            {
                "id": item.id,
                "amazon_order_item_id": item.amazon_order_item_id,
                "product_mapping_id": item.product_mapping_id,
                "product_id": item.product_id,
                "erp_sku": product.article_no if product else None,
                "erp_product_name": product.name if product else None,
                "seller_sku": item.seller_sku,
                "asin": item.asin,
                "title": item.title,
                "condition_type": item.condition_type,
                "quantity_ordered": item.quantity_ordered,
                "quantity_shipped": item.quantity_shipped,
                "currency": item.currency,
                "unit_price": item.unit_price,
                "item_price": item.item_price,
                "item_tax": item.item_tax,
                "shipping_price": item.shipping_price,
                "shipping_tax": item.shipping_tax,
                "discount": item.discount,
                "promotion_discount": item.promotion_discount,
                "item_status": item.item_status,
                "is_mapped": mapped,
                "last_error": item.last_error,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
        )
    if order.last_error:
        issues.append(
            {
                "code": "order_sync_error",
                "message": order.last_error,
                "seller_sku": None,
                "amazon_order_item_id": None,
            }
        )
    mapping_status = (
        "Mapped"
        if order.unmapped_item_count == 0
        else ("Unmapped" if order.mapped_item_count == 0 else "Partially Mapped")
    )
    try:
        programs = json.loads(order.programs_json or "[]")
    except (TypeError, json.JSONDecodeError):
        programs = []
    return {
        "id": order.id,
        "amazon_order_id": order.amazon_order_id,
        "amazon_account_id": order.amazon_account_id,
        "marketplace_id": order.marketplace_id,
        "marketplace_name": order.marketplace_name,
        "fulfillment_channel": order.fulfillment_channel,
        "sales_channel": order.sales_channel,
        "purchase_date": order.purchase_date,
        "last_update_date": order.last_update_date,
        "order_status": order.order_status,
        "erp_status": order.erp_status,
        "currency": order.currency,
        "order_total": order.order_total,
        "item_total": order.item_total,
        "shipping_total": order.shipping_total,
        "tax_total": order.tax_total,
        "promotion_total": order.promotion_total,
        "payment_status": order.payment_status,
        "shipment_status": order.shipment_status,
        "erp_sales_order_id": order.erp_sales_order_id,
        "carrier_name": order.carrier_name,
        "tracking_number": order.tracking_number,
        "earliest_ship_date": order.earliest_ship_date,
        "latest_ship_date": order.latest_ship_date,
        "earliest_delivery_date": order.earliest_delivery_date,
        "latest_delivery_date": order.latest_delivery_date,
        "item_count": order.item_count,
        "unit_count": order.unit_count,
        "mapped_item_count": order.mapped_item_count,
        "unmapped_item_count": order.unmapped_item_count,
        "mapping_status": mapping_status,
        "programs": programs if isinstance(programs, list) else [],
        "issues": issues,
        "issue_count": len(issues),
        "items": item_rows,
        "last_amazon_update": order.last_amazon_update,
        "last_successful_sync": order.last_successful_sync,
        "last_error": order.last_error,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


def database_order_response(
    db: Session,
    order: AmazonOrder,
) -> dict:
    grouped = _order_items(db, [order.id])
    products = _products(db, grouped)
    return order_response(
        order,
        items=grouped.get(order.id, []),
        products=products,
    )


def query_fba_orders(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    status: str | None = None,
    mapping_status: str | None = None,
    issues_only: bool = False,
    offset: int = 0,
    limit: int = 200,
) -> tuple[list[dict], int, dict]:
    orders = (
        db.query(AmazonOrder)
        .filter(
            AmazonOrder.amazon_account_id == account_id,
            AmazonOrder.fulfillment_channel == "AMAZON",
        )
        .order_by(AmazonOrder.purchase_date.desc())
        .all()
    )
    grouped = _order_items(db, [order.id for order in orders])
    products = _products(db, grouped)
    rows = [
        order_response(
            order,
            items=grouped.get(order.id, []),
            products=products,
        )
        for order in orders
    ]
    now = datetime.utcnow()
    summary = {
        "order_count": len(rows),
        "orders_today": sum(
            int(row["purchase_date"].date() == now.date())
            for row in rows
            if row["purchase_date"]
        ),
        "unit_count": sum(row["unit_count"] for row in rows),
        "revenue": sum(row["order_total"] for row in rows),
        "pending_count": sum(
            int(row["order_status"] in {"PENDING_AVAILABILITY", "PENDING"})
            for row in rows
        ),
        "unshipped_count": sum(
            int(row["order_status"] == "UNSHIPPED") for row in rows
        ),
        "partially_shipped_count": sum(
            int(row["order_status"] == "PARTIALLY_SHIPPED") for row in rows
        ),
        "shipped_count": sum(
            int(row["order_status"] == "SHIPPED") for row in rows
        ),
        "cancelled_count": sum(
            int(row["order_status"] == "CANCELLED") for row in rows
        ),
        "mapped_item_count": sum(row["mapped_item_count"] for row in rows),
        "unmapped_item_count": sum(row["unmapped_item_count"] for row in rows),
        "orders_with_issues": sum(int(row["issue_count"] > 0) for row in rows),
    }

    clean_search = str(search or "").strip().lower()
    if clean_search:
        rows = [
            row
            for row in rows
            if clean_search in row["amazon_order_id"].lower()
            or any(
                clean_search
                in " ".join(
                    [
                        str(item["seller_sku"] or ""),
                        str(item["asin"] or ""),
                        str(item["title"] or ""),
                        str(item["erp_sku"] or ""),
                    ]
                ).lower()
                for item in row["items"]
            )
        ]
    clean_status = str(status or "").strip().upper()
    if clean_status:
        rows = [row for row in rows if row["order_status"] == clean_status]
    clean_mapping = str(mapping_status or "").strip().lower()
    if clean_mapping:
        rows = [
            row
            for row in rows
            if row["mapping_status"].lower() == clean_mapping
        ]
    if issues_only:
        rows = [row for row in rows if row["issue_count"] > 0]
    total = len(rows)
    safe_offset = max(0, int(offset))
    safe_limit = min(500, max(1, int(limit)))
    return rows[safe_offset : safe_offset + safe_limit], total, summary


def order_status_history_response(history: AmazonOrderStatusHistory) -> dict:
    return {
        "id": history.id,
        "amazon_order_database_id": history.amazon_order_database_id,
        "sync_job_id": history.sync_job_id,
        "previous_order_status": history.previous_order_status,
        "order_status": history.order_status,
        "previous_erp_status": history.previous_erp_status,
        "erp_status": history.erp_status,
        "previous_shipment_status": history.previous_shipment_status,
        "shipment_status": history.shipment_status,
        "changed_at": history.changed_at,
    }
