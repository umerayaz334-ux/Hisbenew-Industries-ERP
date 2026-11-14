"""EasyPost label buying for the Dispatch queue.

Talks to the EasyPost REST API (https://api.easypost.com/v2) directly with
``requests`` so no extra SDK dependency is needed.

Flow used by the Buy Label popup:
  1. ``quote``  -> create an EasyPost shipment, return sorted rates
  2. ``buy``    -> buy one rate, download the label into /static/uploads and
                   attach it to the fulfillment order (clears "Need label")
  3. ``refund`` -> void an unused label

API keys live per tenant (encrypted). For the default tenant the keys may also
come from ``EASYPOST_TEST_API_KEY`` / ``EASYPOST_LIVE_API_KEY`` in backend/.env.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime
from typing import Any

import requests
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from ...config import BACKEND_DIR, UPLOAD_DIR
from ...models import EasyPostLabelRecord, EasyPostSettingsRecord, FulfillmentOrder, Order

API_BASE = "https://api.easypost.com/v2"
TIMEOUT = 45
ENV_FILE = BACKEND_DIR / ".env"
MODES = ("test", "live")
LABEL_FORMATS = ("PDF", "PNG", "ZPL")
LABEL_SIZES = ("4x6", "4x4", "4x8")
ADMIN_ROLES = {"admin", "manager", "super_admin"}

DEFAULTS = {
    "label_format": "PDF",
    "label_size": "4x6",
    "auto_select": "cheapest",
    "mark_shipped_after_buy": False,
    "open_label_after_buy": True,
    "verify_addresses": True,
    "parcel_presets": [
        {"name": "Small box", "length": 8, "width": 6, "height": 4},
        {"name": "Medium box", "length": 12, "width": 10, "height": 6},
        {"name": "Large box", "length": 18, "width": 14, "height": 10},
        {"name": "Poly mailer", "length": 12, "width": 10, "height": 1},
    ],
}

ADDRESS_FIELDS = (
    "name", "company", "street1", "street2", "city", "state", "zip", "country", "phone", "email",
)


# ---------------------------------------------------------------- helpers

def _env_value(key: str) -> str:
    value = os.getenv(key, "").strip()
    if value:
        return value
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                name, raw = stripped.split("=", 1)
                if name.strip() == key:
                    return raw.strip().strip("\"'")
    except OSError:
        pass
    return ""


def _cipher():
    from ...integrations.amazon.security import CredentialCipher

    return CredentialCipher()


def _encrypt(value: str) -> str:
    return _cipher().encrypt(value)


def _decrypt(value: str | None) -> str:
    if not value:
        return ""
    try:
        return _cipher().decrypt(value)
    except Exception:  # noqa: BLE001 - a broken key should read as "not set"
        return ""


def _mask(value: str) -> str | None:
    if not value:
        return None
    return f"{value[:4]}…{value[-4:]}" if len(value) > 10 else "••••"


def _loads(raw: str | None, fallback: Any) -> Any:
    try:
        data = json.loads(raw or "")
    except (TypeError, ValueError):
        return fallback
    return data if isinstance(data, type(fallback)) else fallback


def _clean_address(raw: dict | None) -> dict:
    raw = raw or {}
    address = {}
    for field in ADDRESS_FIELDS:
        value = str(raw.get(field) or "").strip()
        if value:
            address[field] = value[:200]
    if "country" not in address:
        address["country"] = "US"
    return address


def _user(request: Request, db: Session):
    from ...main import get_authenticated_user

    return get_authenticated_user(request, db)


def _require_admin(request: Request, db: Session):
    user = _user(request, db)
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin permissions are required to change EasyPost settings.")
    return user


def _is_default_tenant(db: Session) -> bool:
    tenant_id = db.info.get("tenant_id")
    if tenant_id is None:
        return True
    try:
        from ...main import get_default_tenant

        return int(get_default_tenant(db).id) == int(tenant_id)
    except Exception:  # noqa: BLE001
        return False


def _settings_row(db: Session, create: bool = False) -> EasyPostSettingsRecord | None:
    row = db.query(EasyPostSettingsRecord).order_by(EasyPostSettingsRecord.id).first()
    if row or not create:
        return row
    row = EasyPostSettingsRecord(mode="test", from_address_json="{}", defaults_json="{}")
    db.add(row)
    db.flush()
    return row


def _keys(db: Session, row: EasyPostSettingsRecord | None) -> dict:
    keys = {
        "test": _decrypt(row.test_api_key_encrypted) if row else "",
        "live": _decrypt(row.live_api_key_encrypted) if row else "",
    }
    sources = {mode: "saved" if keys[mode] else None for mode in MODES}
    if _is_default_tenant(db):
        for mode, env_key in (("test", "EASYPOST_TEST_API_KEY"), ("live", "EASYPOST_LIVE_API_KEY")):
            if not keys[mode]:
                keys[mode] = _env_value(env_key)
                sources[mode] = "server" if keys[mode] else None
    return {"keys": keys, "sources": sources}


def _active_key(db: Session) -> tuple[str, str]:
    row = _settings_row(db)
    mode = (row.mode if row else "test") or "test"
    key = _keys(db, row)["keys"].get(mode, "")
    if not key:
        raise HTTPException(
            status_code=400,
            detail=f"EasyPost {mode} API key is not configured. Add it in EasyPost settings.",
        )
    return mode, key


# ------------------------------------------------------------- HTTP layer

def _error_message(payload: Any, status: int) -> str:
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        message = str(error.get("message") or "EasyPost request failed.")
        details = [
            f"{item.get('field')}: {item.get('message')}"
            for item in error.get("errors") or []
            if isinstance(item, dict) and item.get("message")
        ]
        return f"{message} {'; '.join(details)}".strip()
    return f"EasyPost request failed ({status})."


def _call(method: str, path: str, key: str, payload: dict | None = None) -> dict:
    try:
        response = requests.request(
            method,
            f"{API_BASE}{path}",
            auth=(key, ""),
            json=payload,
            timeout=TIMEOUT,
            headers={"User-Agent": "ERP-EasyPost/1.0"},
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach EasyPost. Check the internet connection.") from exc
    try:
        data = response.json()
    except ValueError:
        data = {}
    if response.status_code >= 400:
        status = 400 if response.status_code in (400, 404, 422) else 502
        if response.status_code in (401, 403):
            status = 400
            return_message = "EasyPost rejected the API key. Check it in EasyPost settings."
            raise HTTPException(status_code=status, detail=return_message)
        raise HTTPException(status_code=status, detail=_error_message(data, response.status_code))
    return data if isinstance(data, dict) else {}


# --------------------------------------------------------------- settings

def _company_profile_address(db: Session) -> dict:
    """Name / phone / email from the tenant profile, used to pre-fill ship-from."""
    try:
        from ...models import Tenant

        tenant_id = db.info.get("tenant_id")
        query = db.query(Tenant).execution_options(skip_tenant_scope=True)
        tenant = query.filter(Tenant.id == tenant_id).first() if tenant_id is not None else None
        if tenant is None:
            from ...main import get_default_tenant

            tenant = get_default_tenant(db)
    except Exception:  # noqa: BLE001
        return {}
    return {
        key: value
        for key, value in {
            "company": tenant.company_name,
            "phone": tenant.phone,
            "email": tenant.email,
            "country": "US",
        }.items()
        if value
    }


def public_settings(request: Request, db: Session) -> dict:
    _user(request, db)
    row = _settings_row(db)
    key_info = _keys(db, row)
    defaults = {**DEFAULTS, **_loads(row.defaults_json if row else None, {})}
    return {
        "mode": (row.mode if row else "test") or "test",
        "keys": {
            mode: {
                "configured": bool(key_info["keys"][mode]),
                "masked": _mask(key_info["keys"][mode]),
                "source": key_info["sources"][mode],
            }
            for mode in MODES
        },
        "from_address": _loads(row.from_address_json if row else None, {}),
        "from_address_suggestion": _company_profile_address(db),
        "defaults": defaults,
        "label_formats": list(LABEL_FORMATS),
        "label_sizes": list(LABEL_SIZES),
    }


def save_settings(request: Request, db: Session, payload: dict) -> dict:
    _require_admin(request, db)
    row = _settings_row(db, create=True)
    mode = payload.get("mode")
    if mode is not None:
        if mode not in MODES:
            raise HTTPException(status_code=400, detail="Mode must be test or live.")
        row.mode = mode
    for mode_name, field in (("test", "test_api_key"), ("live", "live_api_key")):
        if field not in payload:
            continue
        value = str(payload.get(field) or "").strip()
        expected = "EZTK" if mode_name == "test" else "EZAK"
        if value and not value.startswith(expected):
            raise HTTPException(
                status_code=400,
                detail=f"That does not look like an EasyPost {mode_name} key (it should start with {expected}).",
            )
        setattr(row, f"{mode_name}_api_key_encrypted", _encrypt(value) if value else None)
    if "from_address" in payload:
        row.from_address_json = json.dumps(_clean_address(payload.get("from_address")))
    if isinstance(payload.get("defaults"), dict):
        current = {**DEFAULTS, **_loads(row.defaults_json, {})}
        incoming = payload["defaults"]
        if incoming.get("label_format") in LABEL_FORMATS:
            current["label_format"] = incoming["label_format"]
        if incoming.get("label_size") in LABEL_SIZES:
            current["label_size"] = incoming["label_size"]
        if incoming.get("auto_select") in ("cheapest", "fastest", "none"):
            current["auto_select"] = incoming["auto_select"]
        for flag in ("mark_shipped_after_buy", "open_label_after_buy", "verify_addresses"):
            if flag in incoming:
                current[flag] = bool(incoming[flag])
        if isinstance(incoming.get("parcel_presets"), list):
            presets = []
            for preset in incoming["parcel_presets"][:20]:
                try:
                    presets.append({
                        "name": str(preset.get("name") or "Box")[:60],
                        "length": float(preset.get("length") or 0),
                        "width": float(preset.get("width") or 0),
                        "height": float(preset.get("height") or 0),
                    })
                except (AttributeError, TypeError, ValueError):
                    continue
            current["parcel_presets"] = presets
        row.defaults_json = json.dumps(current)
    row.updated_at = datetime.utcnow()
    db.commit()
    return public_settings(request, db)


def test_connection(request: Request, db: Session) -> dict:
    _user(request, db)
    mode, key = _active_key(db)
    _call("GET", "/addresses?page_size=1", key)
    return {"ok": True, "mode": mode, "message": f"Connected to EasyPost ({mode} mode)."}


# ---------------------------------------------------------------- address

def verify_address(request: Request, db: Session, address: dict) -> dict:
    _user(request, db)
    _, key = _active_key(db)
    data = _call(
        "POST",
        "/addresses",
        key,
        {"address": _clean_address(address), "verify": ["delivery"]},
    )
    delivery = (data.get("verifications") or {}).get("delivery") or {}
    suggestion = {field: data.get(field) for field in ADDRESS_FIELDS if data.get(field)}
    return {
        "valid": bool(delivery.get("success")),
        "messages": [
            item.get("message") for item in delivery.get("errors") or [] if isinstance(item, dict)
        ],
        "residential": data.get("residential"),
        "suggested": suggestion,
    }


# ------------------------------------------------------------------ rates

ORDER_KINDS = ("fulfillment", "sales")


def _order(request: Request, db: Session, kind: str, order_id: int):
    """Load a Dispatch (fulfillment) order or a Shipping page (sales) order."""
    if kind == "sales":
        from ...main import require_admin_user, tenant_scope_id_for_request

        user = require_admin_user(request, db)
        query = db.query(Order).filter(Order.id == order_id)
        tenant_id = tenant_scope_id_for_request(request, user)
        if tenant_id is not None:
            query = query.filter(Order.tenant_id == tenant_id)
        order = query.first()
    elif kind == "fulfillment":
        order = db.query(FulfillmentOrder).filter(FulfillmentOrder.id == order_id).first()
    else:
        raise HTTPException(status_code=404, detail="Unknown order type.")
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    return order


def _order_reference(order) -> str:
    return str(getattr(order, "fulfillment_order_no", None) or getattr(order, "order_no", "") or "")


def _touch(order) -> None:
    if hasattr(order, "updated_at"):
        order.updated_at = datetime.utcnow()


def _rate_out(rate: dict) -> dict:
    days = rate.get("delivery_days") or rate.get("est_delivery_days")
    return {
        "id": rate.get("id"),
        "carrier": rate.get("carrier"),
        "service": rate.get("service"),
        "rate": float(rate.get("rate") or 0),
        "retail_rate": float(rate.get("retail_rate") or 0) or None,
        "currency": rate.get("currency") or "USD",
        "delivery_days": int(days) if days not in (None, "") else None,
        "delivery_date": rate.get("delivery_date"),
        "delivery_date_guaranteed": bool(rate.get("delivery_date_guaranteed")),
    }


def _tag_rates(rates: list[dict]) -> list[dict]:
    if not rates:
        return rates
    rates.sort(key=lambda item: (item["rate"], item["delivery_days"] or 99))
    rates[0]["tags"] = ["cheapest"]
    timed = [rate for rate in rates if rate["delivery_days"]]
    if timed:
        fastest = min(timed, key=lambda item: (item["delivery_days"], item["rate"]))
        fastest.setdefault("tags", []).append("fastest")
        # Best value: cheapest among rates within 1 day of the fastest.
        window = [rate for rate in timed if rate["delivery_days"] <= fastest["delivery_days"] + 1]
        best = min(window, key=lambda item: item["rate"])
        if "cheapest" not in best.get("tags", []) and "fastest" not in best.get("tags", []):
            best.setdefault("tags", []).append("best_value")
    for rate in rates:
        rate.setdefault("tags", [])
    return rates


def quote(request: Request, db: Session, order_id: int, payload: dict, kind: str = "fulfillment") -> dict:
    _user(request, db)
    order = _order(request, db, kind, order_id)
    mode, key = _active_key(db)
    row = _settings_row(db)
    defaults = {**DEFAULTS, **_loads(row.defaults_json if row else None, {})}

    to_address = _clean_address(payload.get("to_address"))
    from_address = _clean_address(payload.get("from_address") or _loads(row.from_address_json if row else None, {}))
    for label, address in (("Ship-to", to_address), ("Ship-from", from_address)):
        missing = [field for field in ("street1", "city", "zip") if not address.get(field)]
        if missing:
            raise HTTPException(status_code=400, detail=f"{label} address is missing: {', '.join(missing)}.")
    if not from_address.get("phone"):
        raise HTTPException(status_code=400, detail="Add a ship-from phone number. FedEx and UPS require it.")
    if not to_address.get("phone"):
        # Carriers need a contact number; fall back to the sender's phone.
        to_address["phone"] = from_address["phone"]

    parcel_in = payload.get("parcel") or {}
    try:
        weight_oz = float(parcel_in.get("weight_oz") or 0)
    except (TypeError, ValueError):
        weight_oz = 0
    if weight_oz <= 0:
        raise HTTPException(status_code=400, detail="Package weight must be greater than zero.")
    parcel: dict[str, Any] = {"weight": round(weight_oz, 2)}
    predefined = str(parcel_in.get("predefined_package") or "").strip()
    if predefined:
        parcel["predefined_package"] = predefined
    else:
        for dim in ("length", "width", "height"):
            try:
                value = float(parcel_in.get(dim) or 0)
            except (TypeError, ValueError):
                value = 0
            if value > 0:
                parcel[dim] = round(value, 2)

    label_format = payload.get("label_format") if payload.get("label_format") in LABEL_FORMATS else defaults["label_format"]
    label_size = payload.get("label_size") if payload.get("label_size") in LABEL_SIZES else defaults["label_size"]
    options: dict[str, Any] = {"label_format": label_format, "label_size": label_size}
    if payload.get("signature"):
        options["delivery_confirmation"] = "SIGNATURE"

    shipment_payload = {
        "shipment": {
            "to_address": to_address,
            "from_address": from_address,
            "parcel": parcel,
            "options": options,
            "reference": _order_reference(order),
        }
    }
    data = _call("POST", "/shipments", key, shipment_payload)
    rates = _tag_rates([_rate_out(rate) for rate in data.get("rates") or []])
    messages = [
        f"{item.get('carrier')}: {item.get('message')}"
        for item in data.get("messages") or []
        if isinstance(item, dict) and item.get("message")
    ]
    return {
        "shipment_id": data.get("id"),
        "mode": mode,
        "rates": rates,
        "messages": messages,
        "weight_oz": parcel["weight"],
        "label_format": label_format,
        "label_size": label_size,
    }


# -------------------------------------------------------------------- buy

def _download_label(url: str, label_format: str) -> str:
    extension = {"PDF": ".pdf", "PNG": ".png", "ZPL": ".zpl"}.get(label_format, ".pdf")
    try:
        response = requests.get(url, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Label was bought but could not be downloaded. Use Refresh in the label history.") from exc
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"easypost-{uuid.uuid4().hex}{extension}"
    (UPLOAD_DIR / filename).write_bytes(response.content)
    return f"/static/uploads/{filename}"


def _label_out(label: EasyPostLabelRecord) -> dict:
    return {
        "id": label.id,
        "order_kind": label.order_kind,
        "order_id": label.order_id,
        "fulfillment_order_id": label.order_id if label.order_kind == "fulfillment" else None,
        "shipment_id": label.easypost_shipment_id,
        "mode": label.mode,
        "status": label.status,
        "carrier": label.carrier,
        "service": label.service,
        "rate": label.rate,
        "currency": label.currency,
        "delivery_days": label.delivery_days,
        "tracking_code": label.tracking_code,
        "tracking_url": label.tracking_url,
        "label_file_url": label.label_file_url,
        "label_format": label.label_format,
        "to_name": label.to_name,
        "to_summary": label.to_summary,
        "weight_oz": label.weight_oz,
        "refund_status": label.refund_status,
        "created_at": label.created_at,
    }


def buy(request: Request, db: Session, order_id: int, payload: dict, kind: str = "fulfillment") -> dict:
    user = _user(request, db)
    order = _order(request, db, kind, order_id)
    mode, key = _active_key(db)
    shipment_id = str(payload.get("shipment_id") or "").strip()
    rate_id = str(payload.get("rate_id") or "").strip()
    if not re.fullmatch(r"shp_[A-Za-z0-9]+", shipment_id) or not re.fullmatch(r"rate_[A-Za-z0-9]+", rate_id):
        raise HTTPException(status_code=400, detail="Pick a rate before buying the label.")
    if mode == "live" and not payload.get("confirm_live"):
        raise HTTPException(status_code=400, detail="Confirm the live purchase before buying.")

    buy_payload: dict[str, Any] = {"rate": {"id": rate_id}}
    try:
        insurance = float(payload.get("insurance") or 0)
    except (TypeError, ValueError):
        insurance = 0
    if insurance > 0:
        buy_payload["insurance"] = f"{insurance:.2f}"

    data = _call("POST", f"/shipments/{shipment_id}/buy", key, buy_payload)
    selected = _rate_out(data.get("selected_rate") or {})
    postage = data.get("postage_label") or {}
    label_format = str(payload.get("label_format") or postage.get("label_file_type") or "PDF").upper()
    if label_format not in LABEL_FORMATS:
        label_format = "PDF"
    source_url = (
        postage.get("label_pdf_url") if label_format == "PDF" else None
    ) or (postage.get("label_zpl_url") if label_format == "ZPL" else None) or postage.get("label_url")
    if not source_url:
        raise HTTPException(status_code=502, detail="EasyPost did not return a label file.")
    if source_url == postage.get("label_url") and label_format == "PDF" and not postage.get("label_pdf_url"):
        label_format = "PNG"
    local_url = _download_label(source_url, label_format)

    to_address = data.get("to_address") or {}
    tracker = data.get("tracker") or {}
    label = EasyPostLabelRecord(
        order_kind=kind,
        order_id=order.id,
        easypost_shipment_id=shipment_id,
        mode=mode,
        status="purchased",
        carrier=selected["carrier"],
        service=selected["service"],
        rate=selected["rate"],
        currency=selected["currency"],
        delivery_days=selected["delivery_days"],
        tracking_code=data.get("tracking_code"),
        tracking_url=tracker.get("public_url"),
        label_file_url=local_url,
        label_format=label_format,
        to_name=to_address.get("name"),
        to_summary=", ".join(
            str(part) for part in (to_address.get("city"), to_address.get("state"), to_address.get("zip")) if part
        ),
        weight_oz=(data.get("parcel") or {}).get("weight"),
        created_by_user_id=getattr(user, "id", None),
    )
    db.add(label)

    carrier_name = re.sub(r"Default$", "", str(selected["carrier"] or ""), flags=re.IGNORECASE) or "Label"
    carrier_tag = f"{carrier_name}-{data.get('tracking_code') or shipment_id}"
    order.label_file_url = local_url
    order.label_file_name = f"{carrier_tag}.{label_format.lower()}"
    _touch(order)
    db.commit()
    db.refresh(label)
    return {"label": _label_out(label)}


def refund(request: Request, db: Session, label_id: int) -> dict:
    _user(request, db)
    label = db.query(EasyPostLabelRecord).filter(EasyPostLabelRecord.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found.")
    if label.status != "purchased":
        raise HTTPException(status_code=400, detail="This label was already refunded or voided.")
    row = _settings_row(db)
    key = _keys(db, row)["keys"].get(label.mode, "")
    if not key:
        raise HTTPException(status_code=400, detail=f"EasyPost {label.mode} API key is not configured.")
    data = _call("POST", f"/shipments/{label.easypost_shipment_id}/refund", key)
    label.refund_status = data.get("refund_status") or "submitted"
    label.status = "refunded" if label.refund_status == "refunded" else "refund_submitted"
    model = Order if label.order_kind == "sales" else FulfillmentOrder
    order = db.query(model).filter(model.id == label.order_id).first()
    if order and order.label_file_url == label.label_file_url:
        order.label_file_url = None
        order.label_file_name = None
        _touch(order)
    db.commit()
    db.refresh(label)
    return {"label": _label_out(label)}


def order_labels(request: Request, db: Session, order_id: int, kind: str = "fulfillment") -> dict:
    _user(request, db)
    _order(request, db, kind, order_id)
    labels = (
        db.query(EasyPostLabelRecord)
        .filter(EasyPostLabelRecord.order_kind == kind, EasyPostLabelRecord.order_id == order_id)
        .order_by(EasyPostLabelRecord.created_at.desc())
        .all()
    )
    return {"labels": [_label_out(label) for label in labels]}


def summary(request: Request, db: Session, kind: str = "fulfillment") -> dict:
    """Latest active label per order — used for tracking chips in the queues."""
    _user(request, db)
    labels = (
        db.query(EasyPostLabelRecord)
        .filter(EasyPostLabelRecord.status == "purchased", EasyPostLabelRecord.order_kind == kind)
        .order_by(EasyPostLabelRecord.created_at.asc())
        .all()
    )
    return {"orders": {str(label.order_id): _label_out(label) for label in labels}}
