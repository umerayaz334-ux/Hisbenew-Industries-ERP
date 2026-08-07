"""Amazon Finances v2024-06-19 import, settlement, and profitability services."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ...models import AccountingAccount, AccountingTransaction, Product
from .client import AmazonSpApiClient
from .exceptions import AmazonIntegrationError, AmazonTemporaryError
from .models import (
    AmazonAccount,
    AmazonFinancialTransaction,
    AmazonFinancialTransactionItem,
    AmazonOrder,
    AmazonProductMapping,
    AmazonSettlement,
)
from .security import sanitize_external_message


AMAZON_SETTLEMENT_ACCOUNTING_SOURCE = "amazon_settlement"
SETTLEMENT_TRANSACTION_TOKENS = ("disbursement", "settlement", "transfer")
FINANCIAL_AMOUNT_FIELDS = (
    "product_revenue",
    "shipping_revenue",
    "tax_amount",
    "referral_fee",
    "fba_fee",
    "storage_fee",
    "refund_amount",
    "reimbursement_amount",
    "advertising_charge",
    "other_fee",
    "other_revenue",
)
ITEM_AMOUNT_FIELDS = tuple(
    field for field in FINANCIAL_AMOUNT_FIELDS if field != "tax_amount"
)


@dataclass(frozen=True)
class FinanceSyncResult:
    imported: int
    created: int
    updated: int
    items_imported: int
    matched_orders: int
    unmatched_orders: int
    mapped_items: int
    unmapped_items: int
    settlements_updated: int
    pages: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int
    sync_mode: str
    sync_cursor: str
    posted_before: str


@dataclass(frozen=True)
class AmazonBalanceSyncResult:
    current_balance: float
    available_balance: float
    deferred_balance: float
    total_balance: float
    deferred_transaction_count: int
    currency: str
    open_group_count: int
    financial_event_group_id: str | None
    pages: int
    financial_event_group_pages: int
    deferred_transaction_pages: int
    amazon_request_id: str | None
    http_status: int
    duration_ms: int
    updated_at: str


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


def _iso_cursor(value: datetime) -> str:
    aware = value.replace(tzinfo=timezone.utc)
    return aware.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _money(value: object) -> tuple[float, str | None]:
    if not isinstance(value, dict):
        return 0.0, None
    amount = value.get("currencyAmount")
    currency = str(value.get("currencyCode") or "").strip() or None
    try:
        return float(amount or 0), currency
    except (TypeError, ValueError):
        return 0.0, currency


def _financial_event_group_money(value: object) -> tuple[float, str | None]:
    if not isinstance(value, dict):
        return 0.0, None
    amount = value.get("CurrencyAmount", value.get("currencyAmount"))
    currency = str(
        value.get("CurrencyCode", value.get("currencyCode")) or ""
    ).strip().upper() or None
    try:
        return float(amount or 0), currency
    except (TypeError, ValueError):
        return 0.0, currency


def sync_current_balance(
    db: Session,
    *,
    account: AmazonAccount,
    client: AmazonSpApiClient | None = None,
) -> AmazonBalanceSyncResult:
    """Cache Seller Central's Payments balance from open event groups."""
    api_client = client or AmazonSpApiClient(account)
    desired_currency = str(account.currency or "USD").strip().upper() or "USD"
    open_groups: list[tuple[float, str, str | None]] = []
    pages = 0
    next_token: str | None = None
    seen_tokens: set[str] = set()
    amazon_request_id: str | None = None
    http_status = 200
    duration_ms = 0
    started_before_date = datetime.utcnow() - timedelta(minutes=3)
    started_after_date = started_before_date - timedelta(days=179)
    started_after = _iso_cursor(started_after_date)
    started_before = _iso_cursor(started_before_date)

    while True:
        result = api_client.list_financial_event_groups(
            started_after=started_after,
            started_before=started_before,
            next_token=next_token,
        )
        pages += 1
        amazon_request_id = result.amazon_request_id or amazon_request_id
        http_status = result.http_status
        duration_ms += result.duration_ms
        payload = result.body.get("payload")
        response_body = payload if isinstance(payload, dict) else result.body
        raw_groups = response_body.get(
            "FinancialEventGroupList",
            response_body.get("financialEventGroupList"),
        )
        if not isinstance(raw_groups, list):
            raise AmazonTemporaryError(
                "Amazon Finances API returned an invalid balance response.",
                error_code="amazon_balance_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )

        for raw_group in raw_groups:
            if not isinstance(raw_group, dict):
                continue
            status = str(
                raw_group.get(
                    "ProcessingStatus",
                    raw_group.get("processingStatus"),
                )
                or ""
            ).strip().upper()
            if status != "OPEN":
                continue
            amount, currency = _financial_event_group_money(
                raw_group.get(
                    "OriginalTotal",
                    raw_group.get("originalTotal"),
                )
            )
            open_groups.append(
                (
                    amount,
                    currency or desired_currency,
                    str(
                        raw_group.get(
                            "FinancialEventGroupId",
                            raw_group.get("financialEventGroupId"),
                        )
                        or ""
                    ).strip()
                    or None,
                )
            )

        clean_next_token = str(
            response_body.get(
                "NextToken",
                response_body.get("nextToken"),
            )
            or ""
        ).strip()
        if not clean_next_token:
            break
        if clean_next_token in seen_tokens or pages >= 1000:
            raise AmazonTemporaryError(
                "Amazon balance pagination could not be completed safely.",
                error_code="amazon_balance_pagination_invalid",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=duration_ms,
            )
        seen_tokens.add(clean_next_token)
        next_token = clean_next_token

    selected = [
        group for group in open_groups if group[1] == desired_currency
    ]
    selected_currency = desired_currency
    if not selected and open_groups:
        currencies = {group[1] for group in open_groups}
        if len(currencies) != 1:
            raise AmazonIntegrationError(
                "Amazon returned open balances in multiple currencies, but none "
                "matched the configured ERP currency.",
                error_code="amazon_balance_currency_mismatch",
                http_status=http_status,
                amazon_request_id=amazon_request_id,
                duration_ms=duration_ms,
            )
        selected = open_groups
        selected_currency = next(iter(currencies))

    balance = round(sum(group[0] for group in selected), 6)
    group_ids = [group[2] for group in selected if group[2]]
    event_group_id = group_ids[0] if len(group_ids) == 1 else None

    deferred_transactions: list[tuple[float, str]] = []
    deferred_pages = 0
    next_token = None
    seen_tokens = set()
    while True:
        result = api_client.list_financial_transactions(
            posted_after=started_after,
            posted_before=started_before,
            next_token=next_token,
            transaction_status="DEFERRED",
        )
        deferred_pages += 1
        amazon_request_id = result.amazon_request_id or amazon_request_id
        http_status = result.http_status
        duration_ms += result.duration_ms
        payload = result.body.get("payload")
        response_body = payload if isinstance(payload, dict) else result.body
        raw_transactions = response_body.get(
            "transactions",
            response_body.get("Transactions"),
        )
        if not isinstance(raw_transactions, list):
            raise AmazonTemporaryError(
                "Amazon Finances API returned an invalid deferred balance response.",
                error_code="amazon_deferred_balance_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )
        for raw_transaction in raw_transactions:
            if not isinstance(raw_transaction, dict):
                continue
            status = str(
                raw_transaction.get(
                    "transactionStatus",
                    raw_transaction.get("TransactionStatus"),
                )
                or ""
            ).strip().upper()
            if status != "DEFERRED":
                continue
            amount, currency = _money(
                raw_transaction.get(
                    "totalAmount",
                    raw_transaction.get("TotalAmount"),
                )
            )
            deferred_transactions.append(
                (
                    amount,
                    str(currency or selected_currency).strip().upper(),
                )
            )

        clean_next_token = str(
            response_body.get(
                "nextToken",
                response_body.get("NextToken"),
            )
            or ""
        ).strip()
        if not clean_next_token:
            break
        if clean_next_token in seen_tokens or deferred_pages >= 1000:
            raise AmazonTemporaryError(
                "Amazon deferred balance pagination could not be completed safely.",
                error_code="amazon_deferred_balance_pagination_invalid",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=duration_ms,
            )
        seen_tokens.add(clean_next_token)
        next_token = clean_next_token

    selected_deferred = [
        item for item in deferred_transactions if item[1] == selected_currency
    ]
    if not selected_deferred and deferred_transactions:
        currencies = {item[1] for item in deferred_transactions}
        if len(currencies) != 1:
            raise AmazonIntegrationError(
                "Amazon returned deferred balances in multiple currencies, but "
                "none matched the available balance currency.",
                error_code="amazon_deferred_balance_currency_mismatch",
                http_status=http_status,
                amazon_request_id=amazon_request_id,
                duration_ms=duration_ms,
            )
        deferred_currency = next(iter(currencies))
        if selected and deferred_currency != selected_currency:
            raise AmazonIntegrationError(
                "Amazon's available and deferred balances use different currencies.",
                error_code="amazon_balance_currency_mismatch",
                http_status=http_status,
                amazon_request_id=amazon_request_id,
                duration_ms=duration_ms,
            )
        selected_currency = deferred_currency
        selected_deferred = deferred_transactions

    deferred_balance = round(
        sum(item[0] for item in selected_deferred),
        6,
    )
    total_balance = round(balance + deferred_balance, 6)
    updated_at = datetime.utcnow()
    account.current_balance = balance
    account.current_balance_currency = selected_currency
    account.current_balance_event_group_id = event_group_id
    account.current_balance_updated_at = updated_at
    account.current_balance_error = None
    account.deferred_balance = deferred_balance
    account.deferred_balance_currency = selected_currency
    account.deferred_transaction_count = len(selected_deferred)
    account.deferred_balance_updated_at = updated_at
    account.deferred_balance_error = None
    db.flush()

    return AmazonBalanceSyncResult(
        current_balance=balance,
        available_balance=balance,
        deferred_balance=deferred_balance,
        total_balance=total_balance,
        deferred_transaction_count=len(selected_deferred),
        currency=selected_currency,
        open_group_count=len(selected),
        financial_event_group_id=event_group_id,
        pages=pages + deferred_pages,
        financial_event_group_pages=pages,
        deferred_transaction_pages=deferred_pages,
        amazon_request_id=amazon_request_id,
        http_status=http_status,
        duration_ms=duration_ms,
        updated_at=updated_at.isoformat(),
    )


def _normalized_type(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _related_identifiers(raw: object) -> dict[str, str]:
    identifiers: dict[str, str] = {}
    if not isinstance(raw, list):
        return identifiers
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("relatedIdentifierName") or "").strip().upper()
        value = str(item.get("relatedIdentifierValue") or "").strip()
        if name and value:
            identifiers[name] = value
    return identifiers


def _context_value(node: object, names: set[str]) -> object | None:
    normalized_names = {name.lower() for name in names}
    if isinstance(node, dict):
        for key, value in node.items():
            if str(key).lower() in normalized_names and value not in (None, ""):
                return value
        for value in node.values():
            found = _context_value(value, names)
            if found not in (None, ""):
                return found
    elif isinstance(node, list):
        for value in node:
            found = _context_value(value, names)
            if found not in (None, ""):
                return found
    return None


def _leaf_breakdowns(
    raw: object,
    parent_path: str = "",
) -> list[dict]:
    leaves: list[dict] = []
    if not isinstance(raw, list):
        return leaves
    for item in raw:
        if not isinstance(item, dict):
            continue
        breakdown_type = str(item.get("breakdownType") or "Unspecified")[:200]
        path = (
            f"{parent_path} > {breakdown_type}"
            if parent_path
            else breakdown_type
        )
        children = item.get("breakdowns")
        if isinstance(children, list) and children:
            leaves.extend(_leaf_breakdowns(children, path))
            continue
        amount, currency = _money(item.get("breakdownAmount"))
        leaves.append(
            {
                "type": breakdown_type,
                "path": path[:1000],
                "amount": round(amount, 6),
                "currency": currency,
            }
        )
    return leaves


def _blank_buckets() -> dict[str, float]:
    return {field: 0.0 for field in FINANCIAL_AMOUNT_FIELDS}


def _classify_breakdowns(
    breakdowns: Iterable[dict],
    *,
    transaction_type: str,
) -> dict[str, float]:
    buckets = _blank_buckets()
    transaction_label = _normalized_type(transaction_type)
    refund_transaction = any(
        token in transaction_label
        for token in ("refund", "chargeback", "guarantee claim")
    )
    reimbursement_transaction = any(
        token in transaction_label
        for token in ("reimbursement", "reimburse")
    )

    for breakdown in breakdowns:
        label = _normalized_type(
            breakdown.get("path") or breakdown.get("type")
        )
        amount = float(breakdown.get("amount") or 0)
        if not amount:
            continue
        if "tax" in label:
            buckets["tax_amount"] += amount
        elif reimbursement_transaction or "reimburse" in label:
            if amount >= 0:
                buckets["reimbursement_amount"] += amount
            else:
                buckets["other_fee"] += -amount
        elif "referral" in label or "commission" in label:
            buckets["referral_fee"] += -amount
        elif "storage" in label:
            buckets["storage_fee"] += -amount
        elif any(token in label for token in ("advertis", "product ads", "sponsored")):
            buckets["advertising_charge"] += -amount
        elif any(
            token in label
            for token in (
                "fba",
                "fulfillment fee",
                "pick pack",
                "weight handling",
                "closing fee",
            )
        ):
            buckets["fba_fee"] += -amount
        elif refund_transaction and amount < 0 and any(
            token in label
            for token in ("principal", "product", "item price", "shipping")
        ):
            buckets["refund_amount"] += -amount
        elif any(token in label for token in ("principal", "product", "item price")):
            if amount >= 0:
                buckets["product_revenue"] += amount
            else:
                buckets["refund_amount"] += -amount
        elif "shipping" in label and not any(
            token in label for token in ("fee", "chargeback")
        ):
            if amount >= 0:
                buckets["shipping_revenue"] += amount
            else:
                buckets["refund_amount"] += -amount
        elif any(
            token in label
            for token in ("fee", "charge", "discount", "promotion", "reserve")
        ):
            buckets["other_fee"] += -amount
        elif amount >= 0:
            buckets["other_revenue"] += amount
        else:
            buckets["other_fee"] += -amount

    return {key: round(value, 6) for key, value in buckets.items()}


def _classified_net(buckets: dict[str, float]) -> float:
    return round(
        float(buckets.get("product_revenue") or 0)
        + float(buckets.get("shipping_revenue") or 0)
        + float(buckets.get("tax_amount") or 0)
        + float(buckets.get("reimbursement_amount") or 0)
        + float(buckets.get("other_revenue") or 0)
        - float(buckets.get("referral_fee") or 0)
        - float(buckets.get("fba_fee") or 0)
        - float(buckets.get("storage_fee") or 0)
        - float(buckets.get("refund_amount") or 0)
        - float(buckets.get("advertising_charge") or 0)
        - float(buckets.get("other_fee") or 0),
        6,
    )


def _estimated_profit(
    buckets: dict[str, float],
    *,
    product_cost: float = 0,
    inbound_shipping_cost: float = 0,
    packaging_cost: float = 0,
) -> float:
    return round(
        float(buckets.get("product_revenue") or 0)
        + float(buckets.get("shipping_revenue") or 0)
        + float(buckets.get("reimbursement_amount") or 0)
        + float(buckets.get("other_revenue") or 0)
        - float(buckets.get("referral_fee") or 0)
        - float(buckets.get("fba_fee") or 0)
        - float(buckets.get("storage_fee") or 0)
        - float(buckets.get("refund_amount") or 0)
        - float(buckets.get("advertising_charge") or 0)
        - float(buckets.get("other_fee") or 0)
        - float(product_cost or 0)
        - float(inbound_shipping_cost or 0)
        - float(packaging_cost or 0),
        6,
    )


def _is_settlement_transaction(transaction_type: str | None) -> bool:
    label = _normalized_type(transaction_type)
    return any(token in label for token in SETTLEMENT_TRANSACTION_TOKENS)


def _mapping_for_sku(
    db: Session,
    *,
    account_id: int,
    seller_sku: str | None,
) -> AmazonProductMapping | None:
    if not seller_sku:
        return None
    return (
        db.query(AmazonProductMapping)
        .filter(
            AmazonProductMapping.amazon_account_id == account_id,
            func.lower(AmazonProductMapping.seller_sku) == seller_sku.lower(),
        )
        .first()
    )


def _item_payload(
    db: Session,
    *,
    account: AmazonAccount,
    raw_item: dict,
    item_index: int,
    transaction_type: str,
) -> dict:
    contexts = raw_item.get("contexts")
    seller_sku = str(
        _context_value(contexts, {"sku", "sellerSku"}) or ""
    ).strip() or None
    asin = str(_context_value(contexts, {"asin"}) or "").strip() or None
    try:
        quantity = max(
            0,
            int(
                _context_value(
                    contexts,
                    {"quantityShipped", "quantity", "quantityPurchased"},
                )
                or 0
            ),
        )
    except (TypeError, ValueError):
        quantity = 0
    breakdowns = _leaf_breakdowns(raw_item.get("breakdowns"))
    buckets = _classify_breakdowns(
        breakdowns,
        transaction_type=transaction_type,
    )
    net_amount, total_currency = _money(raw_item.get("totalAmount"))
    currency = (
        total_currency
        or next(
            (
                str(item.get("currency"))
                for item in breakdowns
                if item.get("currency")
            ),
            None,
        )
        or account.currency
    )
    mapping = _mapping_for_sku(
        db,
        account_id=account.id,
        seller_sku=seller_sku,
    )
    product = (
        db.query(Product).filter(Product.id == mapping.product_id).first()
        if mapping and mapping.product_id
        else None
    )
    product_cost = round(float(product.cost_price or 0) * quantity, 6) if product else 0
    return {
        "item_index": item_index,
        "product_mapping_id": mapping.id if mapping else None,
        "product_id": product.id if product else None,
        "seller_sku": seller_sku,
        "asin": asin,
        "quantity": quantity,
        "currency": currency,
        "_tax_amount": float(buckets.get("tax_amount") or 0),
        **{field: float(buckets.get(field) or 0) for field in ITEM_AMOUNT_FIELDS},
        "net_amount": round(net_amount or _classified_net(buckets), 6),
        "product_cost": product_cost,
        "inbound_shipping_cost": 0.0,
        "packaging_cost": 0.0,
        "estimated_profit": _estimated_profit(
            buckets,
            product_cost=product_cost,
        ),
        "breakdowns_json": json.dumps(
            breakdowns,
            separators=(",", ":"),
            default=str,
        )[:16000],
    }


def _allocate_transaction_amounts(
    item_payloads: list[dict],
    transaction_buckets: dict[str, float],
    transaction_net_amount: float,
) -> None:
    if not item_payloads:
        return
    weights = [
        max(float(item.get("product_revenue") or 0), 0)
        or max(float(item.get("quantity") or 0), 0)
        for item in item_payloads
    ]
    if not any(weights):
        weights = [1.0 for _ in item_payloads]
    weight_total = sum(weights)

    for field in ITEM_AMOUNT_FIELDS:
        current_total = sum(float(item.get(field) or 0) for item in item_payloads)
        difference = float(transaction_buckets.get(field) or 0) - current_total
        if abs(difference) <= 0.000001:
            continue
        allocated = 0.0
        for index, item in enumerate(item_payloads):
            share = (
                difference - allocated
                if index == len(item_payloads) - 1
                else round(difference * weights[index] / weight_total, 6)
            )
            item[field] = round(float(item.get(field) or 0) + share, 6)
            allocated += share

    current_net = sum(float(item.get("net_amount") or 0) for item in item_payloads)
    net_difference = float(transaction_net_amount or 0) - current_net
    allocated_net = 0.0
    for index, item in enumerate(item_payloads):
        share = (
            net_difference - allocated_net
            if index == len(item_payloads) - 1
            else round(net_difference * weights[index] / weight_total, 6)
        )
        item["net_amount"] = round(float(item.get("net_amount") or 0) + share, 6)
        allocated_net += share
        item["estimated_profit"] = _estimated_profit(
            item,
            product_cost=float(item.get("product_cost") or 0),
            inbound_shipping_cost=float(item.get("inbound_shipping_cost") or 0),
            packaging_cost=float(item.get("packaging_cost") or 0),
        )


def upsert_financial_transaction(
    db: Session,
    *,
    account: AmazonAccount,
    raw_transaction: dict,
    synced_at: datetime,
) -> dict:
    transaction_id = str(raw_transaction.get("transactionId") or "").strip()
    transaction_type = str(raw_transaction.get("transactionType") or "").strip()
    transaction_date = _amazon_datetime(raw_transaction.get("postedDate"))
    if not transaction_id or not transaction_type or not transaction_date:
        raise AmazonTemporaryError(
            "Amazon Finances returned a transaction without a valid ID, type, or date.",
            error_code="amazon_finance_transaction_invalid",
        )

    related = _related_identifiers(raw_transaction.get("relatedIdentifiers"))
    amazon_order_id = related.get("ORDER_ID")
    settlement_reference = (
        related.get("SETTLEMENT_ID")
        or related.get("FINANCIAL_EVENT_GROUP_ID")
        or related.get("DISBURSEMENT_ID")
    )
    financial_event_group_id = related.get("FINANCIAL_EVENT_GROUP_ID")
    amazon_order = (
        db.query(AmazonOrder)
        .filter(
            AmazonOrder.amazon_account_id == account.id,
            AmazonOrder.amazon_order_id == amazon_order_id,
        )
        .first()
        if amazon_order_id
        else None
    )

    breakdowns = _leaf_breakdowns(raw_transaction.get("breakdowns"))
    buckets = _classify_breakdowns(
        breakdowns,
        transaction_type=transaction_type,
    )
    net_amount, total_currency = _money(raw_transaction.get("totalAmount"))
    currency = (
        total_currency
        or next(
            (
                str(item.get("currency"))
                for item in breakdowns
                if item.get("currency")
            ),
            None,
        )
        or account.currency
    )
    raw_items = raw_transaction.get("items")
    item_payloads = [
        _item_payload(
            db,
            account=account,
            raw_item=raw_item,
            item_index=index,
            transaction_type=transaction_type,
        )
        for index, raw_item in enumerate(raw_items or [])
        if isinstance(raw_item, dict)
    ]
    if not breakdowns and item_payloads:
        buckets["tax_amount"] = round(
            sum(float(item.get("_tax_amount") or 0) for item in item_payloads),
            6,
        )
        for field in ITEM_AMOUNT_FIELDS:
            buckets[field] = round(
                sum(float(item.get(field) or 0) for item in item_payloads),
                6,
            )
    classified_net = _classified_net(buckets)
    if not net_amount and classified_net:
        net_amount = classified_net
    _allocate_transaction_amounts(item_payloads, buckets, net_amount)

    seller_skus = {
        str(item.get("seller_sku"))
        for item in item_payloads
        if item.get("seller_sku")
    }
    asins = {
        str(item.get("asin"))
        for item in item_payloads
        if item.get("asin")
    }
    marketplace_details = raw_transaction.get("marketplaceDetails")
    marketplace_id = (
        str(marketplace_details.get("marketplaceId") or "").strip()
        if isinstance(marketplace_details, dict)
        else ""
    ) or account.marketplace_id

    transaction = (
        db.query(AmazonFinancialTransaction)
        .filter(
            AmazonFinancialTransaction.amazon_account_id == account.id,
            AmazonFinancialTransaction.transaction_id == transaction_id,
        )
        .first()
    )
    created = transaction is None
    if transaction is None:
        transaction = AmazonFinancialTransaction(
            amazon_account_id=account.id,
            transaction_id=transaction_id,
            transaction_type=transaction_type,
            transaction_date=transaction_date,
        )
        db.add(transaction)

    product_cost = round(
        sum(float(item.get("product_cost") or 0) for item in item_payloads),
        6,
    )
    description = sanitize_external_message(
        str(raw_transaction.get("description") or "").strip()
    )
    transaction.transaction_type = transaction_type[:200]
    transaction.transaction_status = str(
        raw_transaction.get("transactionStatus") or "RELEASED"
    ).strip()[:100]
    transaction.description = description[:1000] or None
    transaction.amazon_order_id = amazon_order_id
    transaction.amazon_order_database_id = amazon_order.id if amazon_order else None
    transaction.seller_sku = next(iter(seller_skus)) if len(seller_skus) == 1 else None
    transaction.asin = next(iter(asins)) if len(asins) == 1 else None
    transaction.marketplace_id = marketplace_id
    transaction.currency = currency
    for field in FINANCIAL_AMOUNT_FIELDS:
        setattr(transaction, field, float(buckets.get(field) or 0))
    transaction.product_cost = product_cost
    transaction.net_amount = round(float(net_amount or 0), 6)
    transaction.classified_net_amount = classified_net
    transaction.reconciliation_difference = round(
        transaction.net_amount - classified_net,
        6,
    )
    transaction.estimated_profit = _estimated_profit(
        buckets,
        product_cost=product_cost,
        inbound_shipping_cost=transaction.inbound_shipping_cost,
        packaging_cost=transaction.packaging_cost,
    )
    transaction.settlement_reference = settlement_reference
    transaction.financial_event_group_id = financial_event_group_id
    transaction.related_identifiers_json = json.dumps(
        related,
        separators=(",", ":"),
    )[:8000]
    transaction.breakdowns_json = json.dumps(
        breakdowns,
        separators=(",", ":"),
        default=str,
    )[:32000]
    transaction.transaction_date = transaction_date
    transaction.last_successful_sync = synced_at
    transaction.updated_at = synced_at
    db.flush()

    existing_items = {
        item.item_index: item
        for item in db.query(AmazonFinancialTransactionItem)
        .filter(
            AmazonFinancialTransactionItem.financial_transaction_id
            == transaction.id
        )
        .all()
    }
    for payload in item_payloads:
        item = existing_items.pop(payload["item_index"], None)
        if item is None:
            item = AmazonFinancialTransactionItem(
                financial_transaction_id=transaction.id,
                item_index=payload["item_index"],
            )
        for key, value in payload.items():
            if key.startswith("_"):
                continue
            setattr(item, key, value)
        item.updated_at = synced_at
        db.add(item)
    for stale_item in existing_items.values():
        db.delete(stale_item)

    return {
        "created": created,
        "items_imported": len(item_payloads),
        "matched_order": bool(amazon_order),
        "unmatched_order": bool(amazon_order_id and not amazon_order),
        "mapped_items": sum(1 for item in item_payloads if item["product_id"]),
        "unmapped_items": sum(1 for item in item_payloads if not item["product_id"]),
        "settlement_reference": settlement_reference,
    }


def rebuild_settlement(
    db: Session,
    *,
    account_id: int,
    settlement_reference: str,
) -> AmazonSettlement:
    transactions = (
        db.query(AmazonFinancialTransaction)
        .filter(
            AmazonFinancialTransaction.amazon_account_id == account_id,
            AmazonFinancialTransaction.settlement_reference
            == settlement_reference,
        )
        .order_by(AmazonFinancialTransaction.transaction_date.asc())
        .all()
    )
    activity = [
        transaction
        for transaction in transactions
        if not _is_settlement_transaction(transaction.transaction_type)
    ]
    transfers = [
        transaction
        for transaction in transactions
        if _is_settlement_transaction(transaction.transaction_type)
    ]
    settlement = (
        db.query(AmazonSettlement)
        .filter(
            AmazonSettlement.amazon_account_id == account_id,
            AmazonSettlement.settlement_reference == settlement_reference,
        )
        .first()
    )
    if settlement is None:
        settlement = AmazonSettlement(
            amazon_account_id=account_id,
            settlement_reference=settlement_reference,
        )
        db.add(settlement)
    expected = round(sum(float(row.net_amount or 0) for row in activity), 6)
    actual = round(sum(float(row.net_amount or 0) for row in transfers), 6)
    difference = round(actual - expected, 6) if transfers else 0
    status = (
        "Expected"
        if not transfers
        else "Reconciled"
        if abs(difference) <= 0.01
        else "Difference"
    )
    settlement.marketplace_id = next(
        (row.marketplace_id for row in transactions if row.marketplace_id),
        None,
    )
    settlement.currency = next(
        (row.currency for row in transactions if row.currency),
        "USD",
    )
    settlement.settlement_status = status
    settlement.transaction_count = len(transactions)
    settlement.product_revenue = round(
        sum(float(row.product_revenue or 0) for row in activity),
        6,
    )
    settlement.shipping_revenue = round(
        sum(float(row.shipping_revenue or 0) for row in activity),
        6,
    )
    settlement.reimbursement_amount = round(
        sum(float(row.reimbursement_amount or 0) for row in activity),
        6,
    )
    settlement.amazon_fees = round(
        sum(
            float(row.referral_fee or 0)
            + float(row.fba_fee or 0)
            + float(row.storage_fee or 0)
            + float(row.advertising_charge or 0)
            + float(row.other_fee or 0)
            for row in activity
        ),
        6,
    )
    settlement.refund_amount = round(
        sum(float(row.refund_amount or 0) for row in activity),
        6,
    )
    settlement.expected_amount = expected
    settlement.actual_amount = actual
    settlement.difference_amount = difference
    settlement.first_transaction_date = (
        transactions[0].transaction_date if transactions else None
    )
    settlement.latest_transaction_date = (
        transactions[-1].transaction_date if transactions else None
    )
    settlement.updated_at = datetime.utcnow()
    return settlement


def sync_finances(
    db: Session,
    *,
    account: AmazonAccount,
    days: int = 30,
    posted_after: datetime | None = None,
    client: AmazonSpApiClient | None = None,
) -> FinanceSyncResult:
    safe_days = min(180, max(1, int(days)))
    sync_mode = "incremental" if posted_after else "backfill"
    posted_before_date = datetime.utcnow() - timedelta(minutes=3)
    posted_after_date = posted_after or (
        posted_before_date - timedelta(days=safe_days)
    )
    if posted_after_date >= posted_before_date:
        posted_after_date = posted_before_date - timedelta(minutes=5)
    if posted_before_date - posted_after_date > timedelta(days=180):
        posted_after_date = posted_before_date - timedelta(days=180)
    sync_cursor = _iso_cursor(posted_after_date)
    posted_before_cursor = _iso_cursor(posted_before_date)

    api_client = client or AmazonSpApiClient(account)
    imported = created = updated = items_imported = 0
    matched_orders = unmatched_orders = mapped_items = unmapped_items = 0
    pages = 0
    next_token: str | None = None
    seen_tokens: set[str] = set()
    affected_settlements: set[str] = set()
    amazon_request_id: str | None = None
    http_status = 200
    duration_ms = 0
    synced_at = datetime.utcnow()

    while True:
        result = api_client.list_financial_transactions(
            posted_after=sync_cursor,
            posted_before=posted_before_cursor,
            next_token=next_token,
        )
        pages += 1
        amazon_request_id = result.amazon_request_id or amazon_request_id
        http_status = result.http_status
        duration_ms += result.duration_ms
        payload = result.body.get("payload")
        response_body = payload if isinstance(payload, dict) else result.body
        raw_transactions = response_body.get("transactions")
        if not isinstance(raw_transactions, list):
            raise AmazonTemporaryError(
                "Amazon Finances API returned an invalid response.",
                error_code="amazon_finances_invalid_response",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=result.duration_ms,
            )
        for raw_transaction in raw_transactions:
            if not isinstance(raw_transaction, dict):
                continue
            outcome = upsert_financial_transaction(
                db,
                account=account,
                raw_transaction=raw_transaction,
                synced_at=synced_at,
            )
            imported += 1
            created += int(outcome["created"])
            updated += int(not outcome["created"])
            items_imported += int(outcome["items_imported"])
            matched_orders += int(outcome["matched_order"])
            unmatched_orders += int(outcome["unmatched_order"])
            mapped_items += int(outcome["mapped_items"])
            unmapped_items += int(outcome["unmapped_items"])
            if outcome["settlement_reference"]:
                affected_settlements.add(str(outcome["settlement_reference"]))

        clean_next_token = str(response_body.get("nextToken") or "").strip()
        if not clean_next_token:
            break
        if clean_next_token in seen_tokens or pages >= 1000:
            raise AmazonTemporaryError(
                "Amazon finance pagination could not be completed safely.",
                error_code="amazon_finances_pagination_invalid",
                http_status=result.http_status,
                amazon_request_id=result.amazon_request_id,
                duration_ms=duration_ms,
            )
        seen_tokens.add(clean_next_token)
        next_token = clean_next_token

    for reference in affected_settlements:
        rebuild_settlement(
            db,
            account_id=account.id,
            settlement_reference=reference,
        )

    return FinanceSyncResult(
        imported=imported,
        created=created,
        updated=updated,
        items_imported=items_imported,
        matched_orders=matched_orders,
        unmatched_orders=unmatched_orders,
        mapped_items=mapped_items,
        unmapped_items=unmapped_items,
        settlements_updated=len(affected_settlements),
        pages=pages,
        amazon_request_id=amazon_request_id,
        http_status=http_status,
        duration_ms=duration_ms,
        sync_mode=sync_mode,
        sync_cursor=sync_cursor,
        posted_before=posted_before_cursor,
    )


def financial_transaction_response(
    transaction: AmazonFinancialTransaction,
) -> dict:
    fees = (
        float(transaction.referral_fee or 0)
        + float(transaction.fba_fee or 0)
        + float(transaction.storage_fee or 0)
        + float(transaction.advertising_charge or 0)
        + float(transaction.other_fee or 0)
    )
    return {
        "id": transaction.id,
        "transaction_id": transaction.transaction_id,
        "transaction_type": transaction.transaction_type,
        "transaction_status": transaction.transaction_status,
        "description": transaction.description,
        "amazon_order_id": transaction.amazon_order_id,
        "order_matched": bool(transaction.amazon_order_database_id),
        "seller_sku": transaction.seller_sku,
        "asin": transaction.asin,
        "marketplace_id": transaction.marketplace_id,
        "currency": transaction.currency,
        "product_revenue": transaction.product_revenue,
        "shipping_revenue": transaction.shipping_revenue,
        "tax_amount": transaction.tax_amount,
        "referral_fee": transaction.referral_fee,
        "fba_fee": transaction.fba_fee,
        "storage_fee": transaction.storage_fee,
        "refund_amount": transaction.refund_amount,
        "reimbursement_amount": transaction.reimbursement_amount,
        "advertising_charge": transaction.advertising_charge,
        "other_fee": transaction.other_fee,
        "other_revenue": transaction.other_revenue,
        "amazon_fees": round(fees, 6),
        "product_cost": transaction.product_cost,
        "net_amount": transaction.net_amount,
        "estimated_profit": transaction.estimated_profit,
        "reconciliation_difference": transaction.reconciliation_difference,
        "settlement_reference": transaction.settlement_reference,
        "erp_accounting_entry_id": transaction.erp_accounting_entry_id,
        "transaction_date": transaction.transaction_date,
        "last_successful_sync": transaction.last_successful_sync,
    }


def query_financial_transactions(
    db: Session,
    *,
    account_id: int,
    search: str | None = None,
    transaction_type: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
) -> tuple[list[dict], int, dict]:
    query = db.query(AmazonFinancialTransaction).filter(
        AmazonFinancialTransaction.amazon_account_id == account_id
    )
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(AmazonFinancialTransaction.transaction_id).like(pattern),
                func.lower(
                    func.coalesce(AmazonFinancialTransaction.amazon_order_id, "")
                ).like(pattern),
                func.lower(
                    func.coalesce(AmazonFinancialTransaction.seller_sku, "")
                ).like(pattern),
                func.lower(
                    func.coalesce(AmazonFinancialTransaction.asin, "")
                ).like(pattern),
                func.lower(
                    func.coalesce(
                        AmazonFinancialTransaction.settlement_reference,
                        "",
                    )
                ).like(pattern),
            )
        )
    if transaction_type:
        query = query.filter(
            func.lower(AmazonFinancialTransaction.transaction_type)
            == transaction_type.strip().lower()
        )
    if status:
        query = query.filter(
            func.lower(AmazonFinancialTransaction.transaction_status)
            == status.strip().lower()
        )
    if date_from:
        query = query.filter(
            AmazonFinancialTransaction.transaction_date
            >= datetime.combine(date_from, datetime.min.time())
        )
    if date_to:
        query = query.filter(
            AmazonFinancialTransaction.transaction_date
            < datetime.combine(date_to + timedelta(days=1), datetime.min.time())
        )
    total = query.count()
    all_rows = query.all()
    activity = [
        row for row in all_rows if not _is_settlement_transaction(row.transaction_type)
    ]
    summary = {
        "transaction_count": total,
        "product_revenue": round(
            sum(float(row.product_revenue or 0) for row in activity),
            2,
        ),
        "shipping_revenue": round(
            sum(float(row.shipping_revenue or 0) for row in activity),
            2,
        ),
        "amazon_fees": round(
            sum(
                float(row.referral_fee or 0)
                + float(row.fba_fee or 0)
                + float(row.storage_fee or 0)
                + float(row.advertising_charge or 0)
                + float(row.other_fee or 0)
                for row in activity
            ),
            2,
        ),
        "refunds": round(
            sum(float(row.refund_amount or 0) for row in activity),
            2,
        ),
        "reimbursements": round(
            sum(float(row.reimbursement_amount or 0) for row in activity),
            2,
        ),
        "net_proceeds": round(
            sum(float(row.net_amount or 0) for row in activity),
            2,
        ),
        "estimated_profit": round(
            sum(float(row.estimated_profit or 0) for row in activity),
            2,
        ),
        "unmatched_order_count": sum(
            1
            for row in activity
            if row.amazon_order_id and not row.amazon_order_database_id
        ),
        "unreconciled_count": sum(
            1 for row in activity if abs(float(row.reconciliation_difference or 0)) > 0.01
        ),
    }
    rows = (
        query.order_by(
            AmazonFinancialTransaction.transaction_date.desc(),
            AmazonFinancialTransaction.id.desc(),
        )
        .limit(limit)
        .all()
    )
    return [financial_transaction_response(row) for row in rows], total, summary


def _profit_row(key: str, label: str, currency: str) -> dict:
    return {
        "key": key,
        "label": label,
        "currency": currency,
        "transaction_count": 0,
        "unit_count": 0,
        "product_revenue": 0.0,
        "shipping_revenue": 0.0,
        "reimbursements": 0.0,
        "refunds": 0.0,
        "amazon_fees": 0.0,
        "product_cost": 0.0,
        "net_proceeds": 0.0,
        "estimated_profit": 0.0,
        "unmapped_line_count": 0,
        "profit_complete": True,
    }


def profitability_report(
    db: Session,
    *,
    account_id: int,
    group_by: str,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    clean_group = group_by.strip().lower()
    if clean_group not in {"sku", "asin", "order", "marketplace", "date"}:
        raise ValueError("Profitability can be grouped by sku, asin, order, marketplace, or date.")
    groups: dict[str, dict] = {}
    if clean_group in {"sku", "asin"}:
        query = (
            db.query(AmazonFinancialTransactionItem, AmazonFinancialTransaction)
            .join(
                AmazonFinancialTransaction,
                AmazonFinancialTransaction.id
                == AmazonFinancialTransactionItem.financial_transaction_id,
            )
            .filter(AmazonFinancialTransaction.amazon_account_id == account_id)
        )
        if date_from:
            query = query.filter(
                AmazonFinancialTransaction.transaction_date
                >= datetime.combine(date_from, datetime.min.time())
            )
        if date_to:
            query = query.filter(
                AmazonFinancialTransaction.transaction_date
                < datetime.combine(date_to + timedelta(days=1), datetime.min.time())
            )
        for item, transaction in query.all():
            value = item.seller_sku if clean_group == "sku" else item.asin
            key = str(value or "UNMAPPED")
            row = groups.setdefault(
                key,
                _profit_row(key, key, item.currency or transaction.currency),
            )
            row["transaction_count"] += 1
            row["unit_count"] += int(item.quantity or 0)
            if not item.product_id:
                row["unmapped_line_count"] += 1
            row["product_revenue"] += float(item.product_revenue or 0)
            row["shipping_revenue"] += float(item.shipping_revenue or 0)
            row["reimbursements"] += float(item.reimbursement_amount or 0)
            row["refunds"] += float(item.refund_amount or 0)
            row["amazon_fees"] += sum(
                float(getattr(item, field) or 0)
                for field in (
                    "referral_fee",
                    "fba_fee",
                    "storage_fee",
                    "advertising_charge",
                    "other_fee",
                )
            )
            row["product_cost"] += float(item.product_cost or 0)
            row["net_proceeds"] += float(item.net_amount or 0)
            row["estimated_profit"] += float(item.estimated_profit or 0)
    else:
        uncosted_transaction_ids = {
            int(row[0])
            for row in (
                db.query(AmazonFinancialTransactionItem.financial_transaction_id)
                .join(
                    AmazonFinancialTransaction,
                    AmazonFinancialTransaction.id
                    == AmazonFinancialTransactionItem.financial_transaction_id,
                )
                .filter(
                    AmazonFinancialTransaction.amazon_account_id == account_id,
                    AmazonFinancialTransactionItem.product_id.is_(None),
                )
                .distinct()
                .all()
            )
        }
        query = db.query(AmazonFinancialTransaction).filter(
            AmazonFinancialTransaction.amazon_account_id == account_id
        )
        if date_from:
            query = query.filter(
                AmazonFinancialTransaction.transaction_date
                >= datetime.combine(date_from, datetime.min.time())
            )
        if date_to:
            query = query.filter(
                AmazonFinancialTransaction.transaction_date
                < datetime.combine(date_to + timedelta(days=1), datetime.min.time())
            )
        for transaction in query.all():
            if _is_settlement_transaction(transaction.transaction_type):
                continue
            if clean_group == "order":
                value = transaction.amazon_order_id or "UNMATCHED"
            elif clean_group == "marketplace":
                value = transaction.marketplace_id or "UNKNOWN"
            else:
                value = transaction.transaction_date.date().isoformat()
            key = str(value)
            row = groups.setdefault(
                key,
                _profit_row(key, key, transaction.currency),
            )
            row["transaction_count"] += 1
            if transaction.id in uncosted_transaction_ids:
                row["unmapped_line_count"] += 1
            row["product_revenue"] += float(transaction.product_revenue or 0)
            row["shipping_revenue"] += float(transaction.shipping_revenue or 0)
            row["reimbursements"] += float(transaction.reimbursement_amount or 0)
            row["refunds"] += float(transaction.refund_amount or 0)
            row["amazon_fees"] += sum(
                float(getattr(transaction, field) or 0)
                for field in (
                    "referral_fee",
                    "fba_fee",
                    "storage_fee",
                    "advertising_charge",
                    "other_fee",
                )
            )
            row["product_cost"] += float(transaction.product_cost or 0)
            row["net_proceeds"] += float(transaction.net_amount or 0)
            row["estimated_profit"] += float(transaction.estimated_profit or 0)

    rows = []
    for row in groups.values():
        for field in (
            "product_revenue",
            "shipping_revenue",
            "reimbursements",
            "refunds",
            "amazon_fees",
            "product_cost",
            "net_proceeds",
            "estimated_profit",
        ):
            row[field] = round(float(row[field]), 2)
        revenue = float(row["product_revenue"] or 0) + float(
            row["shipping_revenue"] or 0
        )
        row["margin_percent"] = (
            round(float(row["estimated_profit"]) / revenue * 100, 2)
            if revenue
            else 0
        )
        row["profit_complete"] = int(row["unmapped_line_count"]) == 0
        rows.append(row)
    return sorted(
        rows,
        key=lambda row: float(row["estimated_profit"]),
        reverse=True,
    )


def settlement_response(settlement: AmazonSettlement) -> dict:
    return {
        "id": settlement.id,
        "settlement_reference": settlement.settlement_reference,
        "marketplace_id": settlement.marketplace_id,
        "currency": settlement.currency,
        "settlement_status": settlement.settlement_status,
        "transaction_count": settlement.transaction_count,
        "product_revenue": settlement.product_revenue,
        "shipping_revenue": settlement.shipping_revenue,
        "reimbursement_amount": settlement.reimbursement_amount,
        "amazon_fees": settlement.amazon_fees,
        "refund_amount": settlement.refund_amount,
        "expected_amount": settlement.expected_amount,
        "actual_amount": settlement.actual_amount,
        "difference_amount": settlement.difference_amount,
        "first_transaction_date": settlement.first_transaction_date,
        "latest_transaction_date": settlement.latest_transaction_date,
        "erp_accounting_entry_id": settlement.erp_accounting_entry_id,
        "updated_at": settlement.updated_at,
    }


def reconciliation_issues(
    db: Session,
    *,
    account_id: int,
) -> list[dict]:
    issues: list[dict] = []
    transactions = db.query(AmazonFinancialTransaction).filter(
        AmazonFinancialTransaction.amazon_account_id == account_id
    ).all()
    unmatched_orders: dict[str, list[str]] = {}
    for transaction in transactions:
        if transaction.amazon_order_id and not transaction.amazon_order_database_id:
            unmatched_orders.setdefault(transaction.amazon_order_id, []).append(
                transaction.transaction_id
            )
        if abs(float(transaction.reconciliation_difference or 0)) > 0.01:
            issues.append(
                {
                    "key": f"amount:{transaction.id}",
                    "issue_type": "Unclassified amount",
                    "severity": "warning",
                    "reference": transaction.transaction_id,
                    "transaction_id": transaction.transaction_id,
                    "detail": (
                        "The classified financial components differ from the "
                        f"Amazon net amount by {transaction.currency} "
                        f"{transaction.reconciliation_difference:.2f}."
                    ),
                }
            )
        if (
            str(transaction.transaction_status or "").upper() == "RELEASED"
            and not transaction.settlement_reference
        ):
            issues.append(
                {
                    "key": f"settlement:{transaction.id}",
                    "issue_type": "Settlement reference pending",
                    "severity": "info",
                    "reference": transaction.transaction_id,
                    "transaction_id": transaction.transaction_id,
                    "detail": "Amazon has not supplied a settlement reference for this released transaction.",
                }
            )
    for amazon_order_id, transaction_ids in unmatched_orders.items():
        issues.append(
            {
                "key": f"order:{amazon_order_id}",
                "issue_type": "Unmatched order",
                "severity": "warning",
                "reference": amazon_order_id,
                "transaction_id": transaction_ids[0],
                "detail": (
                    f"{len(transaction_ids)} financial transaction(s) cannot "
                    "match because this Amazon order is not in the ERP order history."
                ),
            }
        )
    item_rows = (
        db.query(AmazonFinancialTransactionItem, AmazonFinancialTransaction)
        .join(
            AmazonFinancialTransaction,
            AmazonFinancialTransaction.id
            == AmazonFinancialTransactionItem.financial_transaction_id,
        )
        .filter(
            AmazonFinancialTransaction.amazon_account_id == account_id,
            AmazonFinancialTransactionItem.product_id.is_(None),
        )
        .all()
    )
    unmapped_skus: dict[str, list[str]] = {}
    for item, transaction in item_rows:
        reference = item.seller_sku or item.asin or "No SKU or ASIN"
        unmapped_skus.setdefault(reference, []).append(transaction.transaction_id)
    for reference, transaction_ids in unmapped_skus.items():
        issues.append(
            {
                "key": f"sku:{reference}",
                "issue_type": "Unmapped SKU",
                "severity": "warning",
                "reference": reference,
                "transaction_id": transaction_ids[0],
                "detail": (
                    f"{len(transaction_ids)} financial line(s) cannot include "
                    "ERP product cost until this Seller SKU is mapped."
                ),
            }
        )
    for settlement in db.query(AmazonSettlement).filter(
        AmazonSettlement.amazon_account_id == account_id,
        AmazonSettlement.settlement_status == "Difference",
    ):
        issues.append(
            {
                "key": f"settlement-difference:{settlement.id}",
                "issue_type": "Settlement difference",
                "severity": "error",
                "reference": settlement.settlement_reference,
                "transaction_id": None,
                "detail": (
                    f"Actual settlement differs from expected by "
                    f"{settlement.currency} {settlement.difference_amount:.2f}."
                ),
            }
        )
    return issues


def post_settlements_to_accounting(
    db: Session,
    *,
    account_id: int,
    settlement_ids: list[int],
) -> dict:
    settlements = (
        db.query(AmazonSettlement)
        .filter(
            AmazonSettlement.amazon_account_id == account_id,
            AmazonSettlement.id.in_(settlement_ids),
        )
        .all()
    )
    if len(settlements) != len(set(settlement_ids)):
        raise AmazonIntegrationError(
            "One or more Amazon settlements were not found.",
            error_code="amazon_settlement_not_found",
        )
    currencies = {settlement.currency for settlement in settlements}
    if len(currencies) > 1:
        raise AmazonIntegrationError(
            "Post settlements with the same currency together.",
            error_code="amazon_settlement_currency_mismatch",
        )
    currency = next(iter(currencies), "USD")
    account = (
        db.query(AccountingAccount)
        .filter(
            func.lower(AccountingAccount.platform) == "amazon",
            AccountingAccount.account_type == "Platform",
        )
        .first()
    )
    if account is None:
        account = AccountingAccount(
            name="Amazon Payouts",
            account_type="Platform",
            platform="Amazon",
            currency=currency,
            opening_balance=0,
            notes="Amazon settlement payouts posted explicitly from Amazon Finances.",
            is_active=True,
        )
        db.add(account)
        db.flush()

    created = updated = 0
    for settlement in settlements:
        if not settlement.actual_amount:
            raise AmazonIntegrationError(
                "Only settlements with an actual Amazon payout can be posted.",
                error_code="amazon_settlement_not_released",
            )
        transaction = (
            db.query(AccountingTransaction)
            .filter(
                AccountingTransaction.source_type
                == AMAZON_SETTLEMENT_ACCOUNTING_SOURCE,
                AccountingTransaction.source_id == settlement.id,
            )
            .first()
        )
        if transaction is None:
            transaction = AccountingTransaction(
                account_id=account.id,
                source_type=AMAZON_SETTLEMENT_ACCOUNTING_SOURCE,
                source_id=settlement.id,
            )
            db.add(transaction)
            created += 1
        else:
            updated += 1
        actual = float(settlement.actual_amount or 0)
        transaction.account_id = account.id
        transaction.direction = "Money In" if actual >= 0 else "Money Out"
        transaction.category = "Amazon Settlement"
        transaction.amount = abs(actual)
        transaction.currency = settlement.currency
        transaction.exchange_rate = 1 if settlement.currency == "PKR" else 0
        transaction.amount_pkr = abs(actual) if settlement.currency == "PKR" else 0
        transaction.counterparty = "Amazon"
        transaction.platform = "Amazon"
        transaction.reference = settlement.settlement_reference
        transaction.description = (
            "Amazon settlement payout. Expected "
            f"{settlement.currency} {settlement.expected_amount:.2f}; "
            f"difference {settlement.currency} {settlement.difference_amount:.2f}."
        )
        transaction.transaction_date = (
            settlement.latest_transaction_date or datetime.utcnow()
        )
        db.flush()
        settlement.erp_accounting_entry_id = transaction.id
        db.query(AmazonFinancialTransaction).filter(
            AmazonFinancialTransaction.amazon_account_id == account_id,
            AmazonFinancialTransaction.settlement_reference
            == settlement.settlement_reference,
        ).update(
            {
                AmazonFinancialTransaction.erp_accounting_entry_id:
                transaction.id
            },
            synchronize_session=False,
        )
    return {
        "posted": len(settlements),
        "created": created,
        "updated": updated,
        "account_id": account.id,
        "account_name": account.name,
    }
