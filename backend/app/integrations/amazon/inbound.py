"""FBA inbound plans, shipments, append-only movements, and reconciliation."""

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Product, StockMovement
from .client import AmazonSpApiClient
from .exceptions import AmazonIntegrationError, AmazonTemporaryError
from .models import (
    AmazonAccount,
    AmazonFbaInboundPlan,
    AmazonFbaInboundPlanItem,
    AmazonFbaInboundStockMovement,
    AmazonFbaShipment,
    AmazonFbaShipmentCarton,
    AmazonFbaShipmentItem,
    AmazonProductMapping,
)


FACTORY_AVAILABLE = "FACTORY_AVAILABLE"
FBA_IN_TRANSIT = "FBA_IN_TRANSIT"
FBA_FULFILLABLE = "FBA_FULFILLABLE"
AMAZON_MISSING = "AMAZON_MISSING"
AMAZON_DAMAGED = "AMAZON_DAMAGED"


@dataclass(frozen=True)
class FbaInboundSyncResult:
    plans_imported: int
    plans_created: int
    plans_updated: int
    plan_items_imported: int
    shipments_imported: int
    shipment_items_imported: int
    cartons_imported: int
    pages: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int


@dataclass(frozen=True)
class FbaInboundActionResult:
    plans_imported: int = 0
    plans_created: int = 0
    plans_updated: int = 0
    plan_items_imported: int = 0
    shipments_imported: int = 0
    shipment_items_imported: int = 0
    cartons_imported: int = 0
    pages: int = 1
    amazon_request_id: str | None = None
    http_status: int = 200
    duration_ms: int = 0


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


def _mapping_for_sku(
    db: Session,
    *,
    account_id: int,
    marketplace_id: str,
    seller_sku: str,
) -> AmazonProductMapping | None:
    if not seller_sku:
        return None
    return (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account_id,
            AmazonProductMapping.marketplace_id == marketplace_id,
            AmazonProductMapping.seller_sku == seller_sku,
        )
        .one_or_none()
    )


def _pagination_token(body: dict) -> str | None:
    pagination = body.get("pagination")
    if not isinstance(pagination, dict):
        return None
    return str(
        pagination.get("nextToken")
        or pagination.get("NextToken")
        or ""
    ).strip() or None


def _safe_plan_options(raw_plan: dict) -> str:
    safe: dict[str, list[dict[str, str]]] = {}
    for source_key, id_key in (
        ("packingOptions", "packingOptionId"),
        ("placementOptions", "placementOptionId"),
        ("shipments", "shipmentId"),
    ):
        entries: list[dict[str, str]] = []
        raw_entries = raw_plan.get(source_key)
        if isinstance(raw_entries, list):
            for entry in raw_entries:
                if not isinstance(entry, dict):
                    continue
                reference = str(entry.get(id_key) or "").strip()
                if not reference:
                    continue
                entries.append(
                    {
                        "id": reference[:100],
                        "status": str(entry.get("status") or "")[:100],
                    }
                )
        safe[source_key] = entries
    return json.dumps(safe, separators=(",", ":"))


def _upsert_plan(
    db: Session,
    *,
    account: AmazonAccount,
    raw_plan: dict,
    synced_at: datetime,
) -> tuple[AmazonFbaInboundPlan, bool]:
    inbound_plan_id = str(raw_plan.get("inboundPlanId") or "").strip()
    if not inbound_plan_id:
        raise AmazonTemporaryError(
            "Amazon returned an inbound plan without an ID.",
            error_code="amazon_inbound_plan_id_missing",
        )
    plan = (
        db.query(AmazonFbaInboundPlan)
        .filter(
            AmazonFbaInboundPlan.amazon_account_id == account.id,
            AmazonFbaInboundPlan.inbound_plan_id == inbound_plan_id,
        )
        .one_or_none()
    )
    created = plan is None
    if plan is None:
        plan = AmazonFbaInboundPlan(
            amazon_account_id=account.id,
            inbound_plan_id=inbound_plan_id,
            marketplace_id=account.marketplace_id,
            plan_name="Amazon FBA inbound plan",
            source_address_reference="Amazon Seller Central",
        )
        db.add(plan)

    marketplace_ids = raw_plan.get("marketplaceIds")
    marketplace_id = (
        str(marketplace_ids[0]).strip()
        if isinstance(marketplace_ids, list) and marketplace_ids
        else account.marketplace_id
    )
    plan.plan_name = (
        str(raw_plan.get("name") or "").strip()
        or plan.plan_name
        or "Amazon FBA inbound plan"
    )
    plan.marketplace_id = marketplace_id
    plan.status = str(raw_plan.get("status") or plan.status or "ACTIVE").upper()
    plan.options_json = _safe_plan_options(raw_plan)
    plan.last_amazon_update = (
        _amazon_datetime(raw_plan.get("lastUpdatedAt")) or synced_at
    )
    plan.last_successful_sync = synced_at
    plan.last_error = None
    plan.updated_at = synced_at
    db.flush()
    return plan, created


def _upsert_plan_item(
    db: Session,
    *,
    account: AmazonAccount,
    plan: AmazonFbaInboundPlan,
    raw_item: dict,
    synced_at: datetime,
) -> AmazonFbaInboundPlanItem:
    seller_sku = str(
        raw_item.get("msku") or raw_item.get("sellerSku") or ""
    ).strip()
    if not seller_sku:
        raise AmazonTemporaryError(
            "Amazon returned an inbound item without a Seller SKU.",
            error_code="amazon_inbound_item_sku_missing",
        )
    mapping = _mapping_for_sku(
        db,
        account_id=account.id,
        marketplace_id=plan.marketplace_id,
        seller_sku=seller_sku,
    )
    item = (
        db.query(AmazonFbaInboundPlanItem)
        .filter(
            AmazonFbaInboundPlanItem.inbound_plan_database_id == plan.id,
            AmazonFbaInboundPlanItem.seller_sku == seller_sku,
        )
        .one_or_none()
    )
    if item is None:
        item = AmazonFbaInboundPlanItem(
            inbound_plan_database_id=plan.id,
            seller_sku=seller_sku,
        )
        db.add(item)
    item.product_mapping_id = mapping.id if mapping else None
    item.product_id = mapping.product_id if mapping and mapping.product_id else None
    item.asin = str(raw_item.get("asin") or "").strip() or None
    item.fnsku = str(raw_item.get("fnsku") or "").strip() or (
        mapping.fnsku if mapping else None
    )
    item.quantity_planned = _quantity(raw_item.get("quantity"))
    item.prep_owner = str(raw_item.get("prepOwner") or "SELLER").upper()
    item.label_owner = str(raw_item.get("labelOwner") or "SELLER").upper()
    item.expiration_date = str(raw_item.get("expiration") or "").strip() or None
    item.manufacturing_lot_code = (
        str(raw_item.get("manufacturingLotCode") or "").strip() or None
    )
    item.last_error = (
        None
        if item.product_id
        else "Seller SKU is not mapped to an ERP product."
    )
    item.updated_at = synced_at
    db.flush()
    return item


def _upsert_shipment_summary(
    db: Session,
    *,
    account: AmazonAccount,
    plan: AmazonFbaInboundPlan,
    raw_shipment: dict,
    synced_at: datetime,
) -> tuple[AmazonFbaShipment, bool]:
    shipment_id = str(raw_shipment.get("shipmentId") or "").strip()
    if not shipment_id:
        raise AmazonTemporaryError(
            "Amazon returned an inbound shipment without an ID.",
            error_code="amazon_inbound_shipment_id_missing",
        )
    shipment = (
        db.query(AmazonFbaShipment)
        .filter(
            AmazonFbaShipment.amazon_account_id == account.id,
            AmazonFbaShipment.amazon_shipment_id == shipment_id,
        )
        .one_or_none()
    )
    created = shipment is None
    if shipment is None:
        shipment = AmazonFbaShipment(
            amazon_account_id=account.id,
            inbound_plan_database_id=plan.id,
            amazon_shipment_id=shipment_id,
        )
        db.add(shipment)
    shipment.inbound_plan_database_id = plan.id
    shipment.shipment_status = str(
        raw_shipment.get("status") or shipment.shipment_status or "WORKING"
    ).upper()
    shipment.last_amazon_update = synced_at
    shipment.last_successful_sync = synced_at
    shipment.last_error = None
    shipment.updated_at = synced_at
    db.flush()
    return shipment, created


def _extract_tracking(raw_shipment: dict) -> str | None:
    tracking = raw_shipment.get("trackingDetails")
    if not isinstance(tracking, dict):
        return None
    spd = tracking.get("spdTrackingDetail")
    if isinstance(spd, dict):
        items = spd.get("spdTrackingItems")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and item.get("trackingId"):
                    return str(item["trackingId"]).strip() or None
    ltl = tracking.get("ltlTrackingDetail")
    if isinstance(ltl, dict):
        bol = str(ltl.get("billOfLadingNumber") or "").strip()
        if bol:
            return bol
        freight = ltl.get("freightBillNumber")
        if isinstance(freight, list) and freight:
            return str(freight[0]).strip() or None
    return None


def _update_shipment_detail(
    shipment: AmazonFbaShipment,
    *,
    raw_shipment: dict,
    synced_at: datetime,
) -> None:
    destination = raw_shipment.get("destination")
    if not isinstance(destination, dict):
        destination = {}
    address = destination.get("address")
    if not isinstance(address, dict):
        address = {}
    shipment.shipment_confirmation_id = (
        str(raw_shipment.get("shipmentConfirmationId") or "").strip() or None
    )
    shipment.shipment_name = (
        str(raw_shipment.get("name") or "").strip() or shipment.shipment_name
    )
    shipment.amazon_reference_id = (
        str(raw_shipment.get("amazonReferenceId") or "").strip() or None
    )
    shipment.placement_option_id = (
        str(raw_shipment.get("placementOptionId") or "").strip() or None
    )
    shipment.transportation_option_id = (
        str(
            raw_shipment.get("selectedTransportationOptionId")
            or raw_shipment.get("transportationOptionId")
            or ""
        ).strip()
        or None
    )
    shipment.destination_code = (
        str(destination.get("warehouseId") or "").strip() or None
    )
    shipment.destination_country = (
        str(address.get("countryCode") or "").strip()
        or str(destination.get("countryCode") or "").strip()
        or None
    )
    shipment.shipment_status = str(
        raw_shipment.get("status") or shipment.shipment_status or "WORKING"
    ).upper()
    shipment.tracking_number = (
        _extract_tracking(raw_shipment) or shipment.tracking_number
    )
    delivery = raw_shipment.get("selectedDeliveryWindow")
    if isinstance(delivery, dict):
        shipment.expected_delivery_date = _amazon_datetime(
            delivery.get("start")
        )
    shipment.last_amazon_update = synced_at
    shipment.last_successful_sync = synced_at
    shipment.last_error = None
    shipment.updated_at = synced_at


def _plan_item_for_sku(
    db: Session,
    *,
    plan_id: int,
    seller_sku: str,
) -> AmazonFbaInboundPlanItem | None:
    return (
        db.query(AmazonFbaInboundPlanItem)
        .filter(
            AmazonFbaInboundPlanItem.inbound_plan_database_id == plan_id,
            AmazonFbaInboundPlanItem.seller_sku == seller_sku,
        )
        .one_or_none()
    )


def _upsert_shipment_item(
    db: Session,
    *,
    account: AmazonAccount,
    plan: AmazonFbaInboundPlan,
    shipment: AmazonFbaShipment,
    raw_item: dict,
    synced_at: datetime,
) -> AmazonFbaShipmentItem:
    seller_sku = str(
        raw_item.get("msku") or raw_item.get("SellerSKU") or ""
    ).strip()
    if not seller_sku:
        raise AmazonTemporaryError(
            "Amazon returned a shipment item without a Seller SKU.",
            error_code="amazon_inbound_shipment_item_sku_missing",
        )
    plan_item = _plan_item_for_sku(
        db,
        plan_id=plan.id,
        seller_sku=seller_sku,
    )
    mapping = _mapping_for_sku(
        db,
        account_id=account.id,
        marketplace_id=plan.marketplace_id,
        seller_sku=seller_sku,
    )
    item = (
        db.query(AmazonFbaShipmentItem)
        .filter(
            AmazonFbaShipmentItem.shipment_database_id == shipment.id,
            AmazonFbaShipmentItem.seller_sku == seller_sku,
        )
        .one_or_none()
    )
    if item is None:
        item = AmazonFbaShipmentItem(
            shipment_database_id=shipment.id,
            seller_sku=seller_sku,
        )
        db.add(item)
    item.inbound_plan_item_id = plan_item.id if plan_item else None
    item.product_mapping_id = mapping.id if mapping else None
    item.product_id = mapping.product_id if mapping and mapping.product_id else None
    item.asin = str(raw_item.get("asin") or "").strip() or (
        plan_item.asin if plan_item else None
    )
    item.fnsku = (
        str(raw_item.get("fnsku") or raw_item.get("FulfillmentNetworkSKU") or "")
        .strip()
        or (plan_item.fnsku if plan_item else None)
    )
    item.quantity_planned = _quantity(
        raw_item.get("quantity")
        if "quantity" in raw_item
        else raw_item.get("QuantityShipped")
    )
    if "QuantityShipped" in raw_item:
        item.quantity_shipped = _quantity(raw_item.get("QuantityShipped"))
    elif item.quantity_shipped is None:
        item.quantity_shipped = 0
    if "QuantityReceived" in raw_item:
        item.quantity_received = _quantity(raw_item.get("QuantityReceived"))
    elif item.quantity_received is None:
        item.quantity_received = 0
    item.quantity_damaged = _quantity(item.quantity_damaged)
    item.quantity_missing = _quantity(item.quantity_missing)
    item.quantity_in_discrepancy = max(
        0,
        _quantity(item.quantity_shipped)
        - _quantity(item.quantity_received)
        - _quantity(item.quantity_damaged)
        - _quantity(item.quantity_missing),
    )
    item.last_amazon_update = synced_at
    item.last_error = (
        None
        if item.product_id
        else "Seller SKU is not mapped to an ERP product."
    )
    item.updated_at = synced_at
    db.flush()
    return item


def _upsert_carton(
    db: Session,
    *,
    shipment: AmazonFbaShipment,
    raw_box: dict,
    synced_at: datetime,
) -> AmazonFbaShipmentCarton:
    package_id = str(raw_box.get("packageId") or "").strip()
    box_id = str(raw_box.get("boxId") or "").strip()
    reference = box_id or package_id
    if not reference:
        raise AmazonTemporaryError(
            "Amazon returned a carton without a reference.",
            error_code="amazon_inbound_carton_reference_missing",
        )
    carton = (
        db.query(AmazonFbaShipmentCarton)
        .filter(
            AmazonFbaShipmentCarton.shipment_database_id == shipment.id,
            AmazonFbaShipmentCarton.carton_reference == reference,
        )
        .one_or_none()
    )
    if carton is None:
        carton = AmazonFbaShipmentCarton(
            shipment_database_id=shipment.id,
            carton_reference=reference,
        )
        db.add(carton)
    dimensions = raw_box.get("dimensions")
    if not isinstance(dimensions, dict):
        dimensions = {}
    weight = raw_box.get("weight")
    if not isinstance(weight, dict):
        weight = {}
    carton.amazon_package_id = package_id or None
    carton.box_id = box_id or None
    carton.quantity = max(1, _quantity(raw_box.get("quantity")) or 1)
    carton.length = dimensions.get("length")
    carton.width = dimensions.get("width")
    carton.height = dimensions.get("height")
    carton.dimension_unit = (
        str(dimensions.get("unitOfMeasurement") or "").strip() or None
    )
    carton.weight = weight.get("value")
    carton.weight_unit = str(weight.get("unit") or "").strip() or None
    carton.updated_at = synced_at
    db.flush()
    return carton


def _legacy_items(body: dict) -> tuple[list[dict], str | None]:
    payload = body.get("payload")
    if not isinstance(payload, dict):
        return [], None
    items = payload.get("ItemData")
    if not isinstance(items, list):
        items = []
    token = str(payload.get("NextToken") or "").strip() or None
    return items, token


def _recalculate_totals(db: Session, plan: AmazonFbaInboundPlan) -> None:
    plan_items = (
        db.query(AmazonFbaInboundPlanItem)
        .filter(AmazonFbaInboundPlanItem.inbound_plan_database_id == plan.id)
        .all()
    )
    shipments = (
        db.query(AmazonFbaShipment)
        .filter(AmazonFbaShipment.inbound_plan_database_id == plan.id)
        .all()
    )
    shipment_items = (
        db.query(AmazonFbaShipmentItem)
        .filter(
            AmazonFbaShipmentItem.shipment_database_id.in_(
                [shipment.id for shipment in shipments] or [-1]
            )
        )
        .all()
    )
    for shipment in shipments:
        current_items = [
            item for item in shipment_items if item.shipment_database_id == shipment.id
        ]
        shipment.planned_quantity = sum(
            item.quantity_planned for item in current_items
        )
        shipment.shipped_quantity = sum(
            item.quantity_shipped for item in current_items
        )
        shipment.received_quantity = sum(
            item.quantity_received for item in current_items
        )
        shipment.damaged_quantity = sum(
            item.quantity_damaged for item in current_items
        )
        shipment.missing_quantity = sum(
            item.quantity_missing for item in current_items
        )
        shipment.discrepancy_quantity = sum(
            item.quantity_in_discrepancy for item in current_items
        )
    plan.planned_quantity = (
        sum(item.quantity_planned for item in plan_items)
        if plan_items
        else sum(shipment.planned_quantity for shipment in shipments)
    )
    plan.shipped_quantity = sum(
        shipment.shipped_quantity for shipment in shipments
    )
    plan.received_quantity = sum(
        shipment.received_quantity for shipment in shipments
    )
    plan.damaged_quantity = sum(
        shipment.damaged_quantity for shipment in shipments
    )
    plan.missing_quantity = sum(
        shipment.missing_quantity for shipment in shipments
    )
    plan.discrepancy_quantity = sum(
        shipment.discrepancy_quantity for shipment in shipments
    )
    db.flush()


def create_inbound_plan(
    db: Session,
    *,
    account: AmazonAccount,
    plan_name: str,
    source_warehouse_id: str,
    source_address_reference: str,
    source_address: dict,
    packing_type: str,
    item_requests: list[dict],
    client: AmazonSpApiClient | None = None,
) -> tuple[AmazonFbaInboundPlan, FbaInboundActionResult]:
    if not item_requests:
        raise AmazonIntegrationError(
            "At least one inbound plan item is required.",
            error_code="amazon_inbound_items_required",
        )
    amazon_items: list[dict] = []
    resolved_items: list[tuple[AmazonProductMapping, Product, dict]] = []
    seen_skus: set[str] = set()
    for request_item in item_requests:
        product_id = _quantity(request_item.get("product_id"))
        quantity = _quantity(request_item.get("quantity"))
        mapping = (
            db.query(AmazonProductMapping)
            .filter(
                AmazonProductMapping.amazon_account_id == account.id,
                AmazonProductMapping.marketplace_id == account.marketplace_id,
                AmazonProductMapping.product_id == product_id,
                AmazonProductMapping.fba_enabled.is_(True),
            )
            .order_by(AmazonProductMapping.id.asc())
            .first()
        )
        product = db.query(Product).filter(Product.id == product_id).first()
        if not mapping or not product:
            raise AmazonIntegrationError(
                "An inbound item is not mapped to an FBA-enabled Amazon listing.",
                error_code="amazon_inbound_item_not_mapped",
            )
        if quantity <= 0:
            raise AmazonIntegrationError(
                "Inbound quantities must be greater than zero.",
                error_code="amazon_inbound_quantity_invalid",
            )
        if mapping.seller_sku in seen_skus:
            raise AmazonIntegrationError(
                "A Seller SKU can appear only once in an inbound plan.",
                error_code="amazon_inbound_duplicate_sku",
            )
        seen_skus.add(mapping.seller_sku)
        item_body = {
            "msku": mapping.seller_sku,
            "quantity": quantity,
            "prepOwner": str(request_item.get("prep_owner") or "SELLER").upper(),
            "labelOwner": str(request_item.get("label_owner") or "SELLER").upper(),
        }
        expiration = str(request_item.get("expiration_date") or "").strip()
        lot_code = str(request_item.get("manufacturing_lot_code") or "").strip()
        if expiration:
            item_body["expiration"] = expiration
        if lot_code:
            item_body["manufacturingLotCode"] = lot_code
        amazon_items.append(item_body)
        resolved_items.append((mapping, product, request_item))

    result = (client or AmazonSpApiClient(account)).create_inbound_plan(
        name=plan_name,
        source_address=source_address,
        items=amazon_items,
    )
    inbound_plan_id = str(result.body.get("inboundPlanId") or "").strip()
    if not inbound_plan_id:
        raise AmazonTemporaryError(
            "Amazon did not return an inbound plan ID.",
            error_code="amazon_inbound_plan_create_invalid",
            http_status=result.http_status,
            amazon_request_id=result.amazon_request_id,
            duration_ms=result.duration_ms,
        )
    now = datetime.utcnow()
    plan = AmazonFbaInboundPlan(
        amazon_account_id=account.id,
        inbound_plan_id=inbound_plan_id,
        plan_name=plan_name,
        marketplace_id=account.marketplace_id,
        source_warehouse_id=source_warehouse_id,
        source_address_reference=source_address_reference,
        packing_type=packing_type,
        status="CREATING",
        amazon_operation_id=(
            str(result.body.get("operationId") or "").strip() or None
        ),
        planned_quantity=sum(item["quantity"] for item in amazon_items),
        last_amazon_update=now,
        last_successful_sync=now,
    )
    db.add(plan)
    db.flush()
    for (mapping, product, request_item), amazon_item in zip(
        resolved_items,
        amazon_items,
        strict=True,
    ):
        db.add(
            AmazonFbaInboundPlanItem(
                inbound_plan_database_id=plan.id,
                product_mapping_id=mapping.id,
                product_id=product.id,
                seller_sku=mapping.seller_sku,
                asin=mapping.asin,
                fnsku=mapping.fnsku,
                quantity_planned=amazon_item["quantity"],
                prep_owner=amazon_item["prepOwner"],
                label_owner=amazon_item["labelOwner"],
                expiration_date=amazon_item.get("expiration"),
                manufacturing_lot_code=amazon_item.get(
                    "manufacturingLotCode"
                ),
            )
        )
    db.flush()
    return plan, FbaInboundActionResult(
        plans_imported=1,
        plans_created=1,
        plan_items_imported=len(amazon_items),
        amazon_request_id=result.amazon_request_id,
        http_status=result.http_status,
        duration_ms=result.duration_ms,
    )


def sync_inbound_plans(
    db: Session,
    *,
    account: AmazonAccount,
    client: AmazonSpApiClient | None = None,
    maximum_pages: int = 4,
) -> FbaInboundSyncResult:
    api_client = client or AmazonSpApiClient(account)
    token: str | None = None
    seen: set[str] = set()
    pages = plans_imported = plans_created = plans_updated = 0
    request_id: str | None = None
    status_code = 200
    duration_ms = 0
    synced_at = datetime.utcnow()
    while True:
        result = api_client.list_inbound_plans(pagination_token=token)
        pages += 1
        status_code = result.http_status
        duration_ms += result.duration_ms
        request_id = result.amazon_request_id or request_id
        raw_plans = result.body.get("inboundPlans")
        if not isinstance(raw_plans, list):
            raise AmazonTemporaryError(
                "Amazon FBA Inbound API returned an invalid plan list.",
                error_code="amazon_inbound_plans_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )
        for raw_plan in raw_plans:
            if not isinstance(raw_plan, dict):
                continue
            _, created = _upsert_plan(
                db,
                account=account,
                raw_plan=raw_plan,
                synced_at=synced_at,
            )
            plans_imported += 1
            plans_created += int(created)
            plans_updated += int(not created)
        token = _pagination_token(result.body)
        if not token:
            break
        if token in seen or pages >= max(1, maximum_pages):
            break
        seen.add(token)
    return FbaInboundSyncResult(
        plans_imported=plans_imported,
        plans_created=plans_created,
        plans_updated=plans_updated,
        plan_items_imported=0,
        shipments_imported=0,
        shipment_items_imported=0,
        cartons_imported=0,
        pages=pages,
        amazon_request_id=request_id,
        http_status=status_code,
        duration_ms=duration_ms,
    )


def sync_inbound_plan(
    db: Session,
    *,
    account: AmazonAccount,
    inbound_plan_id: str,
    client: AmazonSpApiClient | None = None,
) -> FbaInboundSyncResult:
    api_client = client or AmazonSpApiClient(account)
    plan_result = api_client.get_inbound_plan(inbound_plan_id)
    synced_at = datetime.utcnow()
    plan, created = _upsert_plan(
        db,
        account=account,
        raw_plan=plan_result.body,
        synced_at=synced_at,
    )
    duration_ms = plan_result.duration_ms
    request_id = plan_result.amazon_request_id
    plan_items_imported = shipments_imported = shipment_items_imported = 0
    cartons_imported = 0

    token: str | None = None
    seen: set[str] = set()
    while True:
        item_result = api_client.list_inbound_plan_items(
            inbound_plan_id,
            pagination_token=token,
        )
        duration_ms += item_result.duration_ms
        request_id = item_result.amazon_request_id or request_id
        raw_items = item_result.body.get("items")
        if not isinstance(raw_items, list):
            raise AmazonTemporaryError(
                "Amazon returned an invalid inbound plan item list.",
                error_code="amazon_inbound_plan_items_invalid_response",
            )
        for raw_item in raw_items:
            if isinstance(raw_item, dict):
                _upsert_plan_item(
                    db,
                    account=account,
                    plan=plan,
                    raw_item=raw_item,
                    synced_at=synced_at,
                )
                plan_items_imported += 1
        token = _pagination_token(item_result.body)
        if not token:
            break
        if token in seen:
            raise AmazonTemporaryError(
                "Amazon inbound item pagination could not be completed safely.",
                error_code="amazon_inbound_pagination_invalid",
            )
        seen.add(token)

    raw_shipments = plan_result.body.get("shipments")
    if not isinstance(raw_shipments, list):
        raw_shipments = []
    for raw_shipment in raw_shipments:
        if not isinstance(raw_shipment, dict):
            continue
        shipment, _ = _upsert_shipment_summary(
            db,
            account=account,
            plan=plan,
            raw_shipment=raw_shipment,
            synced_at=synced_at,
        )
        shipments_imported += 1
        refresh_result = refresh_inbound_shipment(
            db,
            account=account,
            shipment=shipment,
            client=api_client,
        )
        shipment_items_imported += refresh_result.shipment_items_imported
        cartons_imported += refresh_result.cartons_imported
        duration_ms += refresh_result.duration_ms
        request_id = refresh_result.amazon_request_id or request_id
    _recalculate_totals(db, plan)
    return FbaInboundSyncResult(
        plans_imported=1,
        plans_created=int(created),
        plans_updated=int(not created),
        plan_items_imported=plan_items_imported,
        shipments_imported=shipments_imported,
        shipment_items_imported=shipment_items_imported,
        cartons_imported=cartons_imported,
        pages=1,
        amazon_request_id=request_id,
        http_status=plan_result.http_status,
        duration_ms=duration_ms,
    )


def refresh_inbound_shipment(
    db: Session,
    *,
    account: AmazonAccount,
    shipment: AmazonFbaShipment,
    client: AmazonSpApiClient | None = None,
) -> FbaInboundActionResult:
    plan = (
        db.query(AmazonFbaInboundPlan)
        .filter(AmazonFbaInboundPlan.id == shipment.inbound_plan_database_id)
        .one()
    )
    api_client = client or AmazonSpApiClient(account)
    detail_result = api_client.get_inbound_shipment(
        plan.inbound_plan_id,
        shipment.amazon_shipment_id,
    )
    synced_at = datetime.utcnow()
    _update_shipment_detail(
        shipment,
        raw_shipment=detail_result.body,
        synced_at=synced_at,
    )
    duration_ms = detail_result.duration_ms
    request_id = detail_result.amazon_request_id
    item_count = carton_count = 0

    token: str | None = None
    seen: set[str] = set()
    while True:
        result = api_client.list_inbound_shipment_items(
            plan.inbound_plan_id,
            shipment.amazon_shipment_id,
            pagination_token=token,
        )
        duration_ms += result.duration_ms
        request_id = result.amazon_request_id or request_id
        raw_items = result.body.get("items")
        if not isinstance(raw_items, list):
            raise AmazonTemporaryError(
                "Amazon returned an invalid shipment item list.",
                error_code="amazon_inbound_shipment_items_invalid_response",
            )
        for raw_item in raw_items:
            if isinstance(raw_item, dict):
                _upsert_shipment_item(
                    db,
                    account=account,
                    plan=plan,
                    shipment=shipment,
                    raw_item=raw_item,
                    synced_at=synced_at,
                )
                item_count += 1
        token = _pagination_token(result.body)
        if not token:
            break
        if token in seen:
            raise AmazonTemporaryError(
                "Amazon shipment item pagination could not be completed safely.",
                error_code="amazon_inbound_pagination_invalid",
            )
        seen.add(token)

    token = None
    seen.clear()
    while True:
        result = api_client.list_inbound_shipment_boxes(
            plan.inbound_plan_id,
            shipment.amazon_shipment_id,
            pagination_token=token,
        )
        duration_ms += result.duration_ms
        request_id = result.amazon_request_id or request_id
        raw_boxes = result.body.get("boxes")
        if not isinstance(raw_boxes, list):
            raw_boxes = []
        for raw_box in raw_boxes:
            if isinstance(raw_box, dict):
                _upsert_carton(
                    db,
                    shipment=shipment,
                    raw_box=raw_box,
                    synced_at=synced_at,
                )
                carton_count += 1
        token = _pagination_token(result.body)
        if not token:
            break
        if token in seen:
            raise AmazonTemporaryError(
                "Amazon carton pagination could not be completed safely.",
                error_code="amazon_inbound_pagination_invalid",
            )
        seen.add(token)

    if shipment.shipment_confirmation_id:
        token = None
        seen.clear()
        while True:
            legacy_result = api_client.get_legacy_inbound_shipment_items(
                shipment.shipment_confirmation_id,
                next_token=token,
            )
            duration_ms += legacy_result.duration_ms
            request_id = legacy_result.amazon_request_id or request_id
            legacy_items, token = _legacy_items(legacy_result.body)
            for raw_item in legacy_items:
                if isinstance(raw_item, dict):
                    _upsert_shipment_item(
                        db,
                        account=account,
                        plan=plan,
                        shipment=shipment,
                        raw_item=raw_item,
                        synced_at=synced_at,
                    )
            if not token:
                break
            if token in seen:
                raise AmazonTemporaryError(
                    "Amazon legacy shipment pagination could not be completed safely.",
                    error_code="amazon_inbound_pagination_invalid",
                )
            seen.add(token)
    _recalculate_totals(db, plan)
    return FbaInboundActionResult(
        plans_imported=1,
        plans_updated=1,
        shipments_imported=1,
        shipment_items_imported=item_count,
        cartons_imported=carton_count,
        amazon_request_id=request_id,
        http_status=detail_result.http_status,
        duration_ms=duration_ms,
    )


def confirm_inbound_plan(
    db: Session,
    *,
    account: AmazonAccount,
    plan: AmazonFbaInboundPlan,
    placement_option_id: str,
    client: AmazonSpApiClient | None = None,
) -> FbaInboundActionResult:
    result = (client or AmazonSpApiClient(account)).confirm_placement_option(
        plan.inbound_plan_id,
        placement_option_id,
    )
    plan.placement_option_id = placement_option_id
    plan.amazon_operation_id = (
        str(result.body.get("operationId") or "").strip() or None
    )
    plan.status = "CONFIRMING"
    plan.confirmed_at = datetime.utcnow()
    plan.last_error = None
    plan.updated_at = datetime.utcnow()
    return FbaInboundActionResult(
        plans_imported=1,
        plans_updated=1,
        amazon_request_id=result.amazon_request_id,
        http_status=result.http_status,
        duration_ms=result.duration_ms,
    )


def get_safe_placement_options(
    *,
    account: AmazonAccount,
    plan: AmazonFbaInboundPlan,
    client: AmazonSpApiClient | None = None,
) -> tuple[list[dict], str | None, int, int]:
    result = (client or AmazonSpApiClient(account)).list_placement_options(
        plan.inbound_plan_id,
    )
    raw_options = result.body.get("placementOptions")
    safe_options: list[dict] = []
    if isinstance(raw_options, list):
        for option in raw_options:
            if not isinstance(option, dict):
                continue
            option_id = str(option.get("placementOptionId") or "").strip()
            if not option_id:
                continue
            fees: list[dict] = []
            for fee in option.get("fees") or []:
                if not isinstance(fee, dict):
                    continue
                amount = fee.get("amount")
                if isinstance(amount, dict):
                    fees.append(
                        {
                            "type": str(fee.get("type") or "")[:100],
                            "amount": float(amount.get("amount") or 0),
                            "currency": str(amount.get("code") or "")[:10],
                        }
                    )
            safe_options.append(
                {
                    "placement_option_id": option_id,
                    "status": str(option.get("status") or ""),
                    "fees": fees,
                    "shipment_count": len(option.get("shipmentIds") or []),
                }
            )
    return (
        safe_options,
        result.amazon_request_id,
        result.http_status,
        result.duration_ms,
    )


def upsert_local_cartons(
    db: Session,
    *,
    shipment: AmazonFbaShipment,
    cartons: list[dict],
) -> list[AmazonFbaShipmentCarton]:
    now = datetime.utcnow()
    saved: list[AmazonFbaShipmentCarton] = []
    for carton_data in cartons:
        reference = str(carton_data.get("carton_reference") or "").strip()
        if not reference:
            reference = f"LOCAL-{uuid4().hex[:12].upper()}"
        carton = (
            db.query(AmazonFbaShipmentCarton)
            .filter(
                AmazonFbaShipmentCarton.shipment_database_id == shipment.id,
                AmazonFbaShipmentCarton.carton_reference == reference,
            )
            .one_or_none()
        )
        if carton is None:
            carton = AmazonFbaShipmentCarton(
                shipment_database_id=shipment.id,
                carton_reference=reference,
            )
            db.add(carton)
        carton.box_id = str(carton_data.get("box_id") or "").strip() or None
        carton.tracking_number = (
            str(carton_data.get("tracking_number") or "").strip() or None
        )
        carton.quantity = max(1, _quantity(carton_data.get("quantity")) or 1)
        carton.length = carton_data.get("length")
        carton.width = carton_data.get("width")
        carton.height = carton_data.get("height")
        carton.dimension_unit = (
            str(carton_data.get("dimension_unit") or "CM").upper()
        )
        carton.weight = carton_data.get("weight")
        carton.weight_unit = str(
            carton_data.get("weight_unit") or "KG"
        ).upper()
        carton.updated_at = now
        saved.append(carton)
    db.flush()
    return saved


def _movement_balance(
    db: Session,
    *,
    item_id: int,
    origin: str,
    destination: str,
) -> int:
    rows = (
        db.query(AmazonFbaInboundStockMovement)
        .filter(AmazonFbaInboundStockMovement.shipment_item_id == item_id)
        .all()
    )
    return sum(
        movement.quantity
        if (
            movement.from_location == origin
            and movement.to_location == destination
        )
        else -movement.quantity
        if (
            movement.from_location == destination
            and movement.to_location == origin
        )
        else 0
        for movement in rows
    )


def _append_movement(
    db: Session,
    *,
    account_id: int,
    plan_id: int,
    shipment: AmazonFbaShipment,
    item: AmazonFbaShipmentItem,
    movement_type: str,
    origin: str,
    destination: str,
    quantity: int,
    reconciliation_reference: str,
    created_by_user_id: int | None,
) -> AmazonFbaInboundStockMovement:
    event_key = f"FBA-INBOUND-{uuid4()}"
    movement = AmazonFbaInboundStockMovement(
        event_key=event_key,
        amazon_account_id=account_id,
        inbound_plan_database_id=plan_id,
        shipment_database_id=shipment.id,
        shipment_item_id=item.id,
        product_id=item.product_id,
        movement_type=movement_type,
        from_location=origin,
        to_location=destination,
        quantity=quantity,
        reconciliation_reference=reconciliation_reference,
        note=f"{origin} to {destination}",
        created_by_user_id=created_by_user_id,
    )
    db.add(movement)
    generic_quantity = (
        -quantity
        if origin == FACTORY_AVAILABLE
        else quantity
        if destination == FACTORY_AVAILABLE
        else quantity
    )
    db.add(
        StockMovement(
            product_id=item.product_id,
            movement_type=movement_type,
            quantity=generic_quantity,
            stock_type=(
                "factory_stock"
                if FACTORY_AVAILABLE in {origin, destination}
                else destination.lower()
            ),
            source="Amazon FBA Inbound",
            reference=event_key,
            note=f"{origin} -> {destination}",
        )
    )
    return movement


def _align_factory_departure(
    db: Session,
    *,
    account_id: int,
    plan_id: int,
    shipment: AmazonFbaShipment,
    item: AmazonFbaShipmentItem,
    target_quantity: int,
    reconciliation_reference: str,
    created_by_user_id: int | None,
) -> int:
    if not item.product_id:
        raise AmazonIntegrationError(
            "Every shipment item must be mapped before stock can move.",
            error_code="amazon_inbound_item_unmapped",
        )
    current = _movement_balance(
        db,
        item_id=item.id,
        origin=FACTORY_AVAILABLE,
        destination=FBA_IN_TRANSIT,
    )
    delta = target_quantity - current
    if not delta:
        return 0
    product = db.query(Product).filter(Product.id == item.product_id).one()
    if delta > 0:
        if int(product.factory_stock or 0) < delta:
            raise AmazonIntegrationError(
                "Factory stock is insufficient for this FBA shipment.",
                error_code="amazon_inbound_factory_stock_insufficient",
            )
        product.factory_stock = int(product.factory_stock or 0) - delta
        _append_movement(
            db,
            account_id=account_id,
            plan_id=plan_id,
            shipment=shipment,
            item=item,
            movement_type="FBA Shipment Departed",
            origin=FACTORY_AVAILABLE,
            destination=FBA_IN_TRANSIT,
            quantity=delta,
            reconciliation_reference=reconciliation_reference,
            created_by_user_id=created_by_user_id,
        )
    else:
        correction = abs(delta)
        product.factory_stock = int(product.factory_stock or 0) + correction
        _append_movement(
            db,
            account_id=account_id,
            plan_id=plan_id,
            shipment=shipment,
            item=item,
            movement_type="FBA Shipment Departure Correction",
            origin=FBA_IN_TRANSIT,
            destination=FACTORY_AVAILABLE,
            quantity=correction,
            reconciliation_reference=reconciliation_reference,
            created_by_user_id=created_by_user_id,
        )
    return abs(delta)


def _align_inbound_destination(
    db: Session,
    *,
    account_id: int,
    plan_id: int,
    shipment: AmazonFbaShipment,
    item: AmazonFbaShipmentItem,
    destination: str,
    target_quantity: int,
    movement_label: str,
    reconciliation_reference: str,
    created_by_user_id: int | None,
) -> int:
    current = _movement_balance(
        db,
        item_id=item.id,
        origin=FBA_IN_TRANSIT,
        destination=destination,
    )
    delta = target_quantity - current
    if not delta:
        return 0
    if delta > 0:
        origin, target, quantity = FBA_IN_TRANSIT, destination, delta
        movement_type = movement_label
    else:
        origin, target, quantity = destination, FBA_IN_TRANSIT, abs(delta)
        movement_type = f"{movement_label} Correction"
    _append_movement(
        db,
        account_id=account_id,
        plan_id=plan_id,
        shipment=shipment,
        item=item,
        movement_type=movement_type,
        origin=origin,
        destination=target,
        quantity=quantity,
        reconciliation_reference=reconciliation_reference,
        created_by_user_id=created_by_user_id,
    )
    return quantity


def save_tracking_and_departure(
    db: Session,
    *,
    account: AmazonAccount,
    shipment: AmazonFbaShipment,
    carrier_name: str,
    tracking_number: str,
    mark_shipped: bool,
    submit_to_amazon: bool,
    created_by_user_id: int | None,
    client: AmazonSpApiClient | None = None,
) -> tuple[int, str | None, int, int]:
    plan = (
        db.query(AmazonFbaInboundPlan)
        .filter(AmazonFbaInboundPlan.id == shipment.inbound_plan_database_id)
        .one()
    )
    shipment.carrier_name = carrier_name
    shipment.tracking_number = tracking_number
    cartons = (
        db.query(AmazonFbaShipmentCarton)
        .filter(AmazonFbaShipmentCarton.shipment_database_id == shipment.id)
        .all()
    )
    request_id = None
    status_code = 200
    duration_ms = 0
    if submit_to_amazon:
        tracking_items = [
            {
                "boxId": carton.box_id,
                "trackingId": carton.tracking_number or tracking_number,
            }
            for carton in cartons
            if carton.box_id
        ]
        if not tracking_items:
            raise AmazonIntegrationError(
                "Amazon tracking submission requires at least one carton with an Amazon box ID.",
                error_code="amazon_inbound_tracking_box_required",
            )
        result = (client or AmazonSpApiClient(account)).update_inbound_shipment_tracking(
            plan.inbound_plan_id,
            shipment.amazon_shipment_id,
            tracking_details={
                "spdTrackingDetail": {"spdTrackingItems": tracking_items}
            },
        )
        request_id = result.amazon_request_id
        status_code = result.http_status
        duration_ms = result.duration_ms

    movement_count = 0
    if mark_shipped:
        reference = f"SHIP-{shipment.id}-{uuid4().hex}"
        items = (
            db.query(AmazonFbaShipmentItem)
            .filter(AmazonFbaShipmentItem.shipment_database_id == shipment.id)
            .all()
        )
        for item in items:
            target = item.quantity_shipped or item.quantity_planned
            item.quantity_shipped = target
            movement_count += _align_factory_departure(
                db,
                account_id=account.id,
                plan_id=plan.id,
                shipment=shipment,
                item=item,
                target_quantity=target,
                reconciliation_reference=reference,
                created_by_user_id=created_by_user_id,
            )
            item.quantity_in_discrepancy = max(
                0,
                item.quantity_shipped
                - item.quantity_received
                - item.quantity_damaged
                - item.quantity_missing,
            )
        shipment.confirmed_at = shipment.confirmed_at or datetime.utcnow()
        shipment.shipment_status = (
            "SHIPPED"
            if shipment.shipment_status in {"WORKING", "READY_TO_SHIP"}
            else shipment.shipment_status
        )
        _recalculate_totals(db, plan)
    shipment.updated_at = datetime.utcnow()
    return movement_count, request_id, status_code, duration_ms


def reconcile_inbound_shipment(
    db: Session,
    *,
    account: AmazonAccount,
    shipment: AmazonFbaShipment,
    item_updates: list[dict],
    created_by_user_id: int | None,
    note: str | None = None,
) -> tuple[int, int]:
    if not shipment.confirmed_at:
        raise AmazonIntegrationError(
            "Mark the shipment as shipped before reconciling Amazon receipts.",
            error_code="amazon_inbound_not_departed",
        )
    plan = (
        db.query(AmazonFbaInboundPlan)
        .filter(AmazonFbaInboundPlan.id == shipment.inbound_plan_database_id)
        .one()
    )
    reference = f"RECON-{shipment.id}-{uuid4().hex}"
    movements_created = 0
    discrepancy_total = 0
    for update in item_updates:
        item_id = _quantity(update.get("shipment_item_id"))
        item = (
            db.query(AmazonFbaShipmentItem)
            .filter(
                AmazonFbaShipmentItem.id == item_id,
                AmazonFbaShipmentItem.shipment_database_id == shipment.id,
            )
            .one_or_none()
        )
        if not item:
            raise AmazonIntegrationError(
                "A shipment item could not be found.",
                error_code="amazon_inbound_shipment_item_not_found",
            )
        received = _quantity(update.get("quantity_received"))
        missing = _quantity(update.get("quantity_missing"))
        damaged = _quantity(update.get("quantity_damaged"))
        if received + missing + damaged > item.quantity_shipped:
            raise AmazonIntegrationError(
                "Received, missing, and damaged quantities cannot exceed shipped quantity.",
                error_code="amazon_inbound_reconciliation_exceeds_shipped",
            )
        movements_created += int(
            bool(
                _align_inbound_destination(
                    db,
                    account_id=account.id,
                    plan_id=plan.id,
                    shipment=shipment,
                    item=item,
                    destination=FBA_FULFILLABLE,
                    target_quantity=received,
                    movement_label="FBA Units Received",
                    reconciliation_reference=reference,
                    created_by_user_id=created_by_user_id,
                )
            )
        )
        movements_created += int(
            bool(
                _align_inbound_destination(
                    db,
                    account_id=account.id,
                    plan_id=plan.id,
                    shipment=shipment,
                    item=item,
                    destination=AMAZON_MISSING,
                    target_quantity=missing,
                    movement_label="FBA Units Missing",
                    reconciliation_reference=reference,
                    created_by_user_id=created_by_user_id,
                )
            )
        )
        movements_created += int(
            bool(
                _align_inbound_destination(
                    db,
                    account_id=account.id,
                    plan_id=plan.id,
                    shipment=shipment,
                    item=item,
                    destination=AMAZON_DAMAGED,
                    target_quantity=damaged,
                    movement_label="FBA Units Damaged",
                    reconciliation_reference=reference,
                    created_by_user_id=created_by_user_id,
                )
            )
        )
        item.quantity_received = received
        item.quantity_missing = missing
        item.quantity_damaged = damaged
        item.quantity_in_discrepancy = max(
            0,
            item.quantity_shipped - received - missing - damaged,
        )
        item.last_error = (
            f"Inbound discrepancy remains. {note}".strip()
            if item.quantity_in_discrepancy
            else None
        )
        item.updated_at = datetime.utcnow()
        discrepancy_total += item.quantity_in_discrepancy
    shipment.reconciled_at = datetime.utcnow()
    if not discrepancy_total and shipment.shipped_quantity:
        shipment.received_date = shipment.received_date or datetime.utcnow()
    _recalculate_totals(db, plan)
    return movements_created, discrepancy_total


def _product_lookup(db: Session, product_ids: set[int]) -> dict[int, Product]:
    if not product_ids:
        return {}
    return {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
    }


def movement_response(movement: AmazonFbaInboundStockMovement) -> dict:
    return {
        "id": movement.id,
        "event_key": movement.event_key,
        "movement_type": movement.movement_type,
        "from_location": movement.from_location,
        "to_location": movement.to_location,
        "quantity": movement.quantity,
        "reconciliation_reference": movement.reconciliation_reference,
        "note": movement.note,
        "created_at": movement.created_at,
    }


def carton_response(carton: AmazonFbaShipmentCarton) -> dict:
    return {
        "id": carton.id,
        "carton_reference": carton.carton_reference,
        "amazon_package_id": carton.amazon_package_id,
        "box_id": carton.box_id,
        "tracking_number": carton.tracking_number,
        "quantity": carton.quantity,
        "length": carton.length,
        "width": carton.width,
        "height": carton.height,
        "dimension_unit": carton.dimension_unit,
        "weight": carton.weight,
        "weight_unit": carton.weight_unit,
        "created_at": carton.created_at,
        "updated_at": carton.updated_at,
    }


def shipment_item_response(
    item: AmazonFbaShipmentItem,
    product: Product | None,
) -> dict:
    issues: list[str] = []
    if not item.product_id:
        issues.append("Seller SKU is not mapped to an ERP product.")
    if item.quantity_in_discrepancy:
        issues.append(
            f"{item.quantity_in_discrepancy} shipped unit(s) are not reconciled."
        )
    return {
        "id": item.id,
        "product_mapping_id": item.product_mapping_id,
        "product_id": item.product_id,
        "erp_sku": product.article_no if product else None,
        "erp_product_name": product.name if product else None,
        "seller_sku": item.seller_sku,
        "asin": item.asin,
        "fnsku": item.fnsku,
        "quantity_planned": item.quantity_planned,
        "quantity_shipped": item.quantity_shipped,
        "quantity_received": item.quantity_received,
        "quantity_damaged": item.quantity_damaged,
        "quantity_missing": item.quantity_missing,
        "quantity_in_discrepancy": item.quantity_in_discrepancy,
        "is_mapped": bool(item.product_id),
        "issues": issues,
        "last_amazon_update": item.last_amazon_update,
        "last_error": item.last_error,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def shipment_response(
    db: Session,
    shipment: AmazonFbaShipment,
    *,
    include_movements: bool = True,
) -> dict:
    items = (
        db.query(AmazonFbaShipmentItem)
        .filter(AmazonFbaShipmentItem.shipment_database_id == shipment.id)
        .order_by(AmazonFbaShipmentItem.id.asc())
        .all()
    )
    products = _product_lookup(
        db,
        {item.product_id for item in items if item.product_id},
    )
    cartons = (
        db.query(AmazonFbaShipmentCarton)
        .filter(AmazonFbaShipmentCarton.shipment_database_id == shipment.id)
        .order_by(AmazonFbaShipmentCarton.id.asc())
        .all()
    )
    movements = (
        db.query(AmazonFbaInboundStockMovement)
        .filter(
            AmazonFbaInboundStockMovement.shipment_database_id == shipment.id
        )
        .order_by(AmazonFbaInboundStockMovement.created_at.asc())
        .all()
        if include_movements
        else []
    )
    issue_count = sum(
        int(not item.product_id) + int(bool(item.quantity_in_discrepancy))
        for item in items
    )
    return {
        "id": shipment.id,
        "inbound_plan_database_id": shipment.inbound_plan_database_id,
        "amazon_shipment_id": shipment.amazon_shipment_id,
        "shipment_confirmation_id": shipment.shipment_confirmation_id,
        "shipment_name": shipment.shipment_name,
        "amazon_reference_id": shipment.amazon_reference_id,
        "destination_code": shipment.destination_code,
        "destination_country": shipment.destination_country,
        "shipping_mode": shipment.shipping_mode,
        "carrier_name": shipment.carrier_name,
        "tracking_number": shipment.tracking_number,
        "shipment_status": shipment.shipment_status,
        "planned_quantity": shipment.planned_quantity,
        "shipped_quantity": shipment.shipped_quantity,
        "received_quantity": shipment.received_quantity,
        "damaged_quantity": shipment.damaged_quantity,
        "missing_quantity": shipment.missing_quantity,
        "discrepancy_quantity": shipment.discrepancy_quantity,
        "expected_delivery_date": shipment.expected_delivery_date,
        "received_date": shipment.received_date,
        "confirmed_at": shipment.confirmed_at,
        "reconciled_at": shipment.reconciled_at,
        "last_amazon_update": shipment.last_amazon_update,
        "last_successful_sync": shipment.last_successful_sync,
        "last_error": shipment.last_error,
        "issue_count": issue_count,
        "items": [
            shipment_item_response(item, products.get(item.product_id))
            for item in items
        ],
        "cartons": [carton_response(carton) for carton in cartons],
        "movements": [movement_response(movement) for movement in movements],
        "created_at": shipment.created_at,
        "updated_at": shipment.updated_at,
    }


def plan_item_response(
    item: AmazonFbaInboundPlanItem,
    product: Product | None,
) -> dict:
    return {
        "id": item.id,
        "product_mapping_id": item.product_mapping_id,
        "product_id": item.product_id,
        "erp_sku": product.article_no if product else None,
        "erp_product_name": product.name if product else None,
        "factory_stock": int(product.factory_stock or 0) if product else None,
        "seller_sku": item.seller_sku,
        "asin": item.asin,
        "fnsku": item.fnsku,
        "quantity_planned": item.quantity_planned,
        "prep_owner": item.prep_owner,
        "label_owner": item.label_owner,
        "expiration_date": item.expiration_date,
        "manufacturing_lot_code": item.manufacturing_lot_code,
        "is_mapped": bool(item.product_id),
        "last_error": item.last_error,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def plan_response(db: Session, plan: AmazonFbaInboundPlan) -> dict:
    items = (
        db.query(AmazonFbaInboundPlanItem)
        .filter(
            AmazonFbaInboundPlanItem.inbound_plan_database_id == plan.id
        )
        .order_by(AmazonFbaInboundPlanItem.id.asc())
        .all()
    )
    products = _product_lookup(
        db,
        {item.product_id for item in items if item.product_id},
    )
    shipments = (
        db.query(AmazonFbaShipment)
        .filter(AmazonFbaShipment.inbound_plan_database_id == plan.id)
        .order_by(AmazonFbaShipment.created_at.desc())
        .all()
    )
    try:
        options = json.loads(plan.options_json or "{}")
    except (TypeError, json.JSONDecodeError):
        options = {}
    issue_count = (
        sum(int(not item.product_id) for item in items)
        + sum(
            shipment.discrepancy_quantity + int(bool(shipment.last_error))
            for shipment in shipments
        )
        + int(bool(plan.last_error))
    )
    return {
        "id": plan.id,
        "inbound_plan_id": plan.inbound_plan_id,
        "amazon_account_id": plan.amazon_account_id,
        "plan_name": plan.plan_name,
        "marketplace_id": plan.marketplace_id,
        "source_warehouse_id": plan.source_warehouse_id,
        "source_address_reference": plan.source_address_reference,
        "packing_type": plan.packing_type,
        "status": plan.status,
        "amazon_operation_id": plan.amazon_operation_id,
        "packing_option_id": plan.packing_option_id,
        "placement_option_id": plan.placement_option_id,
        "transportation_option_id": plan.transportation_option_id,
        "options": options,
        "planned_quantity": plan.planned_quantity,
        "shipped_quantity": plan.shipped_quantity,
        "received_quantity": plan.received_quantity,
        "missing_quantity": plan.missing_quantity,
        "damaged_quantity": plan.damaged_quantity,
        "discrepancy_quantity": plan.discrepancy_quantity,
        "confirmed_at": plan.confirmed_at,
        "last_amazon_update": plan.last_amazon_update,
        "last_successful_sync": plan.last_successful_sync,
        "last_error": plan.last_error,
        "issue_count": issue_count,
        "items": [
            plan_item_response(item, products.get(item.product_id))
            for item in items
        ],
        "shipments": [
            shipment_response(db, shipment, include_movements=False)
            for shipment in shipments
        ],
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
    }


def query_inbound_plans(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    status: str | None = None,
    issues_only: bool = False,
) -> tuple[list[dict], dict]:
    query = db.query(AmazonFbaInboundPlan).filter(
        AmazonFbaInboundPlan.amazon_account_id == account_id
    )
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                AmazonFbaInboundPlan.plan_name.ilike(term),
                AmazonFbaInboundPlan.inbound_plan_id.ilike(term),
            )
        )
    if status:
        query = query.filter(
            AmazonFbaInboundPlan.status == status.strip().upper()
        )
    plans = query.order_by(
        AmazonFbaInboundPlan.last_amazon_update.desc(),
        AmazonFbaInboundPlan.id.desc(),
    ).all()
    rows = [plan_response(db, plan) for plan in plans]
    if issues_only:
        rows = [row for row in rows if row["issue_count"]]
    all_plans = (
        db.query(AmazonFbaInboundPlan)
        .filter(AmazonFbaInboundPlan.amazon_account_id == account_id)
        .all()
    )
    summary = {
        "plan_count": len(all_plans),
        "active_plan_count": sum(
            plan.status not in {"VOIDED", "CLOSED", "SHIPPED"}
            for plan in all_plans
        ),
        "shipment_count": db.query(AmazonFbaShipment)
        .filter(AmazonFbaShipment.amazon_account_id == account_id)
        .count(),
        "planned_quantity": sum(plan.planned_quantity for plan in all_plans),
        "shipped_quantity": sum(plan.shipped_quantity for plan in all_plans),
        "received_quantity": sum(plan.received_quantity for plan in all_plans),
        "missing_quantity": sum(plan.missing_quantity for plan in all_plans),
        "damaged_quantity": sum(plan.damaged_quantity for plan in all_plans),
        "discrepancy_quantity": sum(
            plan.discrepancy_quantity for plan in all_plans
        ),
        "plans_with_issues": sum(
            bool(plan_response(db, plan)["issue_count"]) for plan in all_plans
        ),
    }
    return rows, summary


def query_inbound_shipments(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    status: str | None = None,
    discrepancies_only: bool = False,
) -> list[dict]:
    query = db.query(AmazonFbaShipment).filter(
        AmazonFbaShipment.amazon_account_id == account_id
    )
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                AmazonFbaShipment.amazon_shipment_id.ilike(term),
                AmazonFbaShipment.shipment_confirmation_id.ilike(term),
                AmazonFbaShipment.shipment_name.ilike(term),
                AmazonFbaShipment.destination_code.ilike(term),
            )
        )
    if status:
        query = query.filter(
            AmazonFbaShipment.shipment_status == status.strip().upper()
        )
    if discrepancies_only:
        query = query.filter(AmazonFbaShipment.discrepancy_quantity > 0)
    shipments = query.order_by(
        AmazonFbaShipment.last_amazon_update.desc(),
        AmazonFbaShipment.id.desc(),
    ).all()
    return [shipment_response(db, shipment) for shipment in shipments]


def label_documents(
    db: Session,
    *,
    account: AmazonAccount,
    shipment: AmazonFbaShipment,
    label_type: str,
    client: AmazonSpApiClient | None = None,
) -> tuple[list[dict], str | None, int, int]:
    api_client = client or AmazonSpApiClient(account)
    normalized = label_type.strip().upper()
    if normalized == "ITEM":
        items = (
            db.query(AmazonFbaShipmentItem)
            .filter(AmazonFbaShipmentItem.shipment_database_id == shipment.id)
            .all()
        )
        quantities = [
            {"msku": item.seller_sku, "quantity": item.quantity_planned}
            for item in items
            if item.seller_sku and item.quantity_planned > 0
        ]
        if not quantities:
            raise AmazonIntegrationError(
                "No shipment items are available for item labels.",
                error_code="amazon_inbound_label_items_missing",
            )
        result = api_client.create_marketplace_item_labels(
            msku_quantities=quantities,
        )
        raw_documents = result.body.get("documentDownloads")
    elif normalized == "BOX":
        if not shipment.shipment_confirmation_id:
            raise AmazonIntegrationError(
                "Amazon has not assigned a shipment confirmation ID for box labels.",
                error_code="amazon_inbound_confirmation_id_missing",
            )
        result = api_client.get_inbound_box_labels(
            shipment.shipment_confirmation_id,
        )
        payload = result.body.get("payload")
        raw_documents = (
            [
                {
                    "downloadType": "BOX_LABEL",
                    "uri": payload.get("DownloadURL"),
                }
            ]
            if isinstance(payload, dict) and payload.get("DownloadURL")
            else []
        )
    else:
        raise AmazonIntegrationError(
            "Label type must be ITEM or BOX.",
            error_code="amazon_inbound_label_type_invalid",
        )
    documents: list[dict] = []
    if isinstance(raw_documents, list):
        for document in raw_documents:
            if not isinstance(document, dict):
                continue
            uri = str(document.get("uri") or "").strip()
            if not uri:
                continue
            documents.append(
                {
                    "document_type": str(
                        document.get("downloadType") or normalized
                    ),
                    "download_url": uri,
                    "expires_at": _amazon_datetime(document.get("expiration")),
                }
            )
    return (
        documents,
        result.amazon_request_id,
        result.http_status,
        result.duration_ms,
    )
