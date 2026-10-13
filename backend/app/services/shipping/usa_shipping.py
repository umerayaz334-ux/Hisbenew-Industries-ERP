"""USA OnTrac Direct ZIP-zone and weight-rate calculations."""

from __future__ import annotations

import json
import io
import math
import re
import zipfile
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET

from ...config import APP_DATA_DIR


RATE_CARD_PATH = Path(__file__).resolve().parents[2] / "data" / "usa_ontrac_rates_2026_05_18.json"
ACTIVE_RATE_CARD_PATH = APP_DATA_DIR / "shipping_rates" / "usa_ontrac_active.json"
RATE_UPLOAD_DIR = APP_DATA_DIR / "shipping_rates" / "uploads"
MAX_RATE_WORKBOOK_BYTES = 16 * 1024 * 1024
MAX_RATE_WORKBOOK_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
XLSX_MAIN_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
XLSX_REL_NS = {"p": "http://schemas.openxmlformats.org/package/2006/relationships"}
XLSX_OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
USA_ZIP_PATTERN = re.compile(r"(?<!\d)(\d{5})(?:-?\d{4})?(?!\d)")
SERVICE_ALIASES = {
    "duty": "duty_paid",
    "duty_paid": "duty_paid",
    "duty paid": "duty_paid",
    "duty paid premium": "duty_paid",
    "duty_paid_premium": "duty_paid",
    "premium": "duty_paid",
    "premium duty paid": "duty_paid",
    "non_duty": "non_duty_paid",
    "non_duty_paid": "non_duty_paid",
    "non-duty paid": "non_duty_paid",
    "non duty paid": "non_duty_paid",
    "non-duty paid premium": "non_duty_paid",
    "non duty paid premium": "non_duty_paid",
}


@lru_cache(maxsize=1)
def load_usa_rate_card() -> dict:
    path = ACTIVE_RATE_CARD_PATH if ACTIVE_RATE_CARD_PATH.is_file() else RATE_CARD_PATH
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        validate_rate_card(data)
        return data
    except (OSError, ValueError, json.JSONDecodeError, KeyError, TypeError):
        data = json.loads(RATE_CARD_PATH.read_text(encoding="utf-8"))
        validate_rate_card(data)
        return data


class RateWorkbookError(ValueError):
    pass


def validate_rate_card(rate_card: dict) -> None:
    required = {
        "source_filename",
        "source_date",
        "carrier_product",
        "currency",
        "weight_unit",
        "zip_prefix_zones",
        "zone_counts",
        "special_zip_prefixes",
        "services",
    }
    if not required.issubset(rate_card):
        raise ValueError("Rate card is missing required data.")
    if len(rate_card["zip_prefix_zones"]) < 100:
        raise ValueError("Rate card does not contain enough ZIP prefixes.")
    services = rate_card["services"]
    if "duty_paid" not in services:
        raise ValueError("Rate card does not contain Duty Paid service rates.")
    zone_numbers = {int(value) for value in rate_card["zip_prefix_zones"].values()}
    if not zone_numbers or min(zone_numbers) < 1:
        raise ValueError("Rate card does not contain valid zone mappings.")
    for service_key, service in services.items():
        for row in service.get("parcel_rates", []):
            for zone in zone_numbers:
                if f"zone_{zone}" not in row:
                    raise ValueError(f"{service_key} is missing Zone {zone} parcel rates.")
        for row in service.get("conus_per_kg", []):
            for zone in zone_numbers:
                if f"zone_{zone}" not in row:
                    raise ValueError(f"{service_key} is missing Zone {zone} kilogram rates.")


def _xlsx_column_number(cell_ref: str) -> int:
    match = re.match(r"[A-Z]+", str(cell_ref or "").upper())
    if not match:
        return 0
    value = 0
    for letter in match.group(0):
        value = value * 26 + ord(letter) - 64
    return value


def _xlsx_rows(workbook_bytes: bytes) -> dict[int, dict[int, object]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(workbook_bytes))
    except zipfile.BadZipFile as exc:
        raise RateWorkbookError("The selected file is not a valid XLSX workbook.") from exc

    with archive:
        total_size = sum(item.file_size for item in archive.infolist())
        if total_size > MAX_RATE_WORKBOOK_UNCOMPRESSED_BYTES:
            raise RateWorkbookError("The workbook expands beyond the allowed size.")
        required_files = {"xl/workbook.xml", "xl/_rels/workbook.xml.rels"}
        if not required_files.issubset(archive.namelist()):
            raise RateWorkbookError("The workbook structure is incomplete.")

        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall("m:si", XLSX_MAIN_NS):
                shared.append(
                    "".join(node.text or "" for node in item.iterfind(".//m:t", XLSX_MAIN_NS))
                )

        workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels_root.findall("p:Relationship", XLSX_REL_NS)
        }
        sheet_paths = []
        for sheet in workbook_root.findall("m:sheets/m:sheet", XLSX_MAIN_NS):
            rel_id = sheet.attrib.get(f"{{{XLSX_OFFICE_REL_NS}}}id")
            target = targets.get(rel_id)
            if not target:
                continue
            normalized = target.replace("\\", "/").lstrip("/")
            sheet_paths.append(normalized if normalized.startswith("xl/") else f"xl/{normalized}")

        for sheet_path in sheet_paths:
            if sheet_path not in archive.namelist():
                continue
            root = ET.fromstring(archive.read(sheet_path))
            rows = {}
            for row in root.findall("m:sheetData/m:row", XLSX_MAIN_NS):
                values = {}
                for cell in row.findall("m:c", XLSX_MAIN_NS):
                    column = _xlsx_column_number(cell.attrib.get("r", ""))
                    value_node = cell.find("m:v", XLSX_MAIN_NS)
                    inline_node = cell.find("m:is", XLSX_MAIN_NS)
                    if inline_node is not None:
                        value = "".join(
                            node.text or "" for node in inline_node.iterfind(".//m:t", XLSX_MAIN_NS)
                        )
                    elif value_node is not None:
                        raw = value_node.text or ""
                        if cell.attrib.get("t") == "s":
                            try:
                                value = shared[int(raw)]
                            except (ValueError, IndexError):
                                value = ""
                        else:
                            try:
                                number = float(raw)
                                value = int(number) if number.is_integer() else number
                            except ValueError:
                                value = raw
                    else:
                        continue
                    values[column] = value
                rows[int(row.attrib.get("r", 0))] = values

            header = " ".join(str(value).upper() for value in rows.get(7, {}).values())
            if "WEIGHT" in header and "ZONE" in header:
                return rows

    raise RateWorkbookError("No USA weight-and-zone rate table was found in the workbook.")


def _zip_prefix(value) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and int(value) == value and 0 <= value <= 999:
        return f"{int(value):03d}"
    text = str(value).strip()
    return text.zfill(3) if re.fullmatch(r"\d{1,3}", text) else None


def _clean_cell_text(value) -> str:
    return str(value or "").strip()


def _row_text(row: dict[int, object]) -> str:
    return " ".join(_clean_cell_text(value) for value in row.values()).upper()


def _number(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = _clean_cell_text(value).replace(",", "")
    text = re.sub(r"[^0-9.+-]", "", text)
    if text in {"", "+", "-", "."}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _zone_columns(row: dict[int, object]) -> dict[int, int]:
    zones: dict[int, int] = {}
    for column, value in row.items():
        match = re.fullmatch(r"ZONE\s*(\d+)", _clean_cell_text(value).upper())
        if match:
            zones[int(match.group(1))] = column
    return dict(sorted(zones.items()))


def _weight_header_columns(row: dict[int, object]) -> list[int]:
    return [
        column
        for column, value in row.items()
        if _clean_cell_text(value).upper().startswith("WEIGHT")
    ]


def _find_rate_header(rows: dict[int, dict[int, object]], start_row: int = 1) -> tuple[int, int, dict[int, int], int | None]:
    for row_number in sorted(rows):
        if row_number < start_row:
            continue
        row = rows[row_number]
        zone_columns = _zone_columns(row)
        weight_columns = _weight_header_columns(row)
        if not zone_columns or not weight_columns:
            continue
        first_zone_column = min(zone_columns.values())
        main_weight_column = next((column for column in weight_columns if column < first_zone_column), weight_columns[0])
        special_rate_column = None
        for column, value in row.items():
            text = _clean_cell_text(value).upper()
            if column > max(zone_columns.values()) and (text == "USA" or "HAWAI" in text or "ALASK" in text):
                special_rate_column = column
                break
        return row_number, main_weight_column, zone_columns, special_rate_column
    raise RateWorkbookError("No USA weight-and-zone rate table was found in the workbook.")


def _find_zip_zone_header(rows: dict[int, dict[int, object]], minimum_zones: int) -> tuple[int, dict[int, int]]:
    candidates: list[tuple[int, int, dict[int, int]]] = []
    for row_number, row in rows.items():
        zone_columns = _zone_columns(row)
        if len(zone_columns) >= minimum_zones and not _weight_header_columns(row):
            candidates.append((len(zone_columns), row_number, zone_columns))
    if not candidates:
        raise RateWorkbookError("No ZIP prefix zone table was found in the workbook.")
    _, row_number, zone_columns = sorted(candidates, key=lambda item: (-item[0], item[1]))[0]
    return row_number, zone_columns


def _collect_zip_zones(rows: dict[int, dict[int, object]], zone_columns: dict[int, int], first_row: int) -> dict[str, int]:
    zones = {}
    for row_number in sorted(number for number in rows if number >= first_row):
        row = rows[row_number]
        if row_number > first_row and any("CHARGE TYPE" in _clean_cell_text(value).upper() for value in row.values()):
            break
        for zone, column in zone_columns.items():
            prefix = _zip_prefix(row.get(column))
            if not prefix:
                continue
            if prefix in zones and zones[prefix] != zone:
                raise RateWorkbookError(f"ZIP prefix {prefix} appears in more than one zone.")
            zones[prefix] = zone
    return zones


def _weight_range(value) -> tuple[int, int | None] | None:
    text = _clean_cell_text(value).upper().replace("’", "'")
    if not text:
        return None
    numbers = [int(item) for item in re.findall(r"\d+", text)]
    if not numbers:
        return None
    if "+" in text:
        return numbers[0], None
    if len(numbers) >= 2:
        return numbers[0], numbers[1]
    return numbers[0], numbers[0]


def _build_zone_rate_row(rows: dict, row_number: int, zone_columns: dict[int, int], label: str) -> dict:
    return {
        f"zone_{zone}": _positive_rate(rows, row_number, column, f"{label} Zone {zone}")
        for zone, column in zone_columns.items()
    }


def _build_parcel_rates(
    rows: dict[int, dict[int, object]],
    *,
    header_row: int,
    weight_column: int,
    zone_columns: dict[int, int],
    special_rate_column: int | None,
) -> tuple[list[dict], int]:
    parcel_rates = []
    row_number = header_row + 1
    while row_number in rows:
        weight = _number(rows[row_number].get(weight_column))
        if weight is None or weight > 10:
            break
        row = {
            "up_to_kg": round(weight, 3),
            **_build_zone_rate_row(rows, row_number, zone_columns, f"{weight:g} kg"),
        }
        if special_rate_column is not None and _number(rows[row_number].get(special_rate_column)) is not None:
            row["hawaii_alaska"] = _positive_rate(rows, row_number, special_rate_column, f"{weight:g} kg Hawaii/Alaska")
        parcel_rates.append(row)
        row_number += 1
    return parcel_rates, row_number


def _build_conus_per_kg(
    rows: dict[int, dict[int, object]],
    *,
    start_row: int,
    weight_column: int,
    zone_columns: dict[int, int],
) -> list[dict]:
    rate_rows = []
    for row_number in sorted(number for number in rows if number >= start_row):
        row = rows[row_number]
        text = _row_text(row)
        if row_number > start_row and ("NON-DUTY" in text or "SEARCH" in text or _zone_columns(row)):
            break
        bounds = _weight_range(row.get(weight_column))
        if not bounds:
            continue
        if not any(_number(row.get(column)) is not None for column in zone_columns.values()):
            continue
        from_kg, to_kg = bounds
        rate_rows.append({
            "from_kg": from_kg,
            "to_kg": to_kg,
            **_build_zone_rate_row(rows, row_number, zone_columns, f"{from_kg}+ kg"),
        })
    if not rate_rows:
        raise RateWorkbookError("No per-kilogram USA zone rates were found in the workbook.")
    return rate_rows


def _build_special_per_kg(
    rows: dict[int, dict[int, object]],
    *,
    start_row: int,
    special_rate_column: int | None,
) -> list[dict]:
    if special_rate_column is None:
        return []
    label_column = special_rate_column - 1
    entries = []
    for row_number in sorted(number for number in rows if number >= start_row):
        row = rows[row_number]
        text = _row_text(row)
        if row_number > start_row and ("NON-DUTY" in text or "SEARCH" in text or _zone_columns(row)):
            break
        bounds = _weight_range(row.get(label_column))
        rate = _number(row.get(special_rate_column))
        if not bounds or rate is None or rate <= 0:
            continue
        entries.append({"from_kg": bounds[0], "to_kg": bounds[1], "rate": round(rate, 2)})
    entries.sort(key=lambda item: item["from_kg"])
    for index, item in enumerate(entries[:-1]):
        if item["to_kg"] is None:
            item["to_kg"] = max(item["from_kg"], int(entries[index + 1]["from_kg"]) - 1)
    return entries

def _positive_rate(rows: dict, row_number: int, column: int, label: str) -> float:
    try:
        value = round(float(rows[row_number][column]), 2)
    except (KeyError, TypeError, ValueError) as exc:
        raise RateWorkbookError(f"Missing or invalid {label} rate.") from exc
    if value <= 0:
        raise RateWorkbookError(f"{label} rate must be greater than zero.")
    return value


def _source_date_from_filename(filename: str) -> str:
    match = re.search(
        r"(?<!\d)(\d{1,2})[-_ ](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-_ ](\d{4})(?!\d)",
        filename.upper(),
    )
    if not match:
        return datetime.utcnow().date().isoformat()
    months = {
        name: index
        for index, name in enumerate(
            ("", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
        )
        if name
    }
    return datetime(int(match.group(3)), months[match.group(2)], int(match.group(1))).date().isoformat()


def parse_usa_rate_workbook(workbook_bytes: bytes, filename: str) -> dict:
    if not workbook_bytes:
        raise RateWorkbookError("The selected workbook is empty.")
    if len(workbook_bytes) > MAX_RATE_WORKBOOK_BYTES:
        raise RateWorkbookError("The rate workbook must be 16 MB or smaller.")

    rows = _xlsx_rows(workbook_bytes)
    duty_header_row, weight_column, zone_columns, special_rate_column = _find_rate_header(rows)
    if len(zone_columns) < 3:
        raise RateWorkbookError("The workbook must contain at least three USA zones.")

    zip_header_row, zip_zone_columns = _find_zip_zone_header(rows, len(zone_columns))
    if set(zip_zone_columns) != set(zone_columns):
        raise RateWorkbookError("ZIP prefix zones do not match the rate table zones.")
    duty_zones = _collect_zip_zones(rows, zip_zone_columns, zip_header_row + 1)
    if len(duty_zones) < 100:
        raise RateWorkbookError("The workbook does not contain enough USA ZIP prefixes.")

    parcel_rates, first_bulk_row = _build_parcel_rates(
        rows,
        header_row=duty_header_row,
        weight_column=weight_column,
        zone_columns=zone_columns,
        special_rate_column=special_rate_column,
    )
    if not parcel_rates:
        raise RateWorkbookError("No Duty Paid parcel rates were found in the workbook.")

    duty_service = {
        "label": "Duty Paid Premium" if "PREMIUM" in _row_text(rows.get(2, {})) else "Duty Paid",
        "parcel_rates": parcel_rates,
        "conus_per_kg": _build_conus_per_kg(
            rows,
            start_row=first_bulk_row,
            weight_column=weight_column,
            zone_columns=zone_columns,
        ),
        "hawaii_alaska_per_kg": _build_special_per_kg(
            rows,
            start_row=first_bulk_row,
            special_rate_column=special_rate_column,
        ),
    }

    services = {"duty_paid": duty_service}
    try:
        non_duty_header_row, non_duty_weight_column, non_duty_zone_columns, non_duty_special_column = _find_rate_header(
            rows,
            start_row=first_bulk_row + 1,
        )
    except RateWorkbookError:
        non_duty_header_row = 0
        non_duty_weight_column = 0
        non_duty_zone_columns = {}
        non_duty_special_column = None
    if non_duty_header_row and set(non_duty_zone_columns) == set(zone_columns):
        services["non_duty_paid"] = {
            "label": "Non-Duty Paid Premium" if "PREMIUM" in _row_text(rows.get(non_duty_header_row - 3, {})) else "Non-Duty Paid",
            "parcel_rates": [],
            "conus_per_kg": _build_conus_per_kg(
                rows,
                start_row=non_duty_header_row + 1,
                weight_column=non_duty_weight_column,
                zone_columns=non_duty_zone_columns,
            ),
            "hawaii_alaska_per_kg": _build_special_per_kg(
                rows,
                start_row=non_duty_header_row + 1,
                special_rate_column=non_duty_special_column,
            ),
        }

    safe_filename = Path(str(filename or "usa-rates.xlsx")).name
    source_date = _source_date_from_filename(safe_filename)
    zone_numbers = sorted(set(duty_zones.values()))
    rate_card = {
        "source_filename": safe_filename,
        "source_date": source_date,
        "uploaded_at": datetime.utcnow().isoformat() + "Z",
        "carrier_product": "OnTrac Direct USA Premium" if "PREMIUM" in _row_text(rows.get(2, {})) else "OnTrac Direct USA",
        "currency": "PKR",
        "weight_unit": "kg",
        "default_service": "duty_paid",
        "zip_prefix_zones": duty_zones,
        "zone_counts": {
            str(zone): sum(1 for value in duty_zones.values() if value == zone)
            for zone in zone_numbers
        },
        "special_zip_prefixes": {
            "hawaii": ["967", "968"],
            "alaska": ["995", "996", "997", "998", "999"],
        },
        "services": services,
    }
    validate_rate_card(rate_card)
    return rate_card

def activate_usa_rate_card(rate_card: dict, workbook_bytes: bytes | None = None) -> dict:
    validate_rate_card(rate_card)
    ACTIVE_RATE_CARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = ACTIVE_RATE_CARD_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(rate_card, indent=2, sort_keys=True), encoding="utf-8")
    temporary_path.replace(ACTIVE_RATE_CARD_PATH)
    if workbook_bytes:
        RATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        archive_name = re.sub(r"[^A-Za-z0-9._-]+", "-", rate_card["source_filename"]).strip(".-")
        (RATE_UPLOAD_DIR / f"{timestamp}-{archive_name or 'usa-rates.xlsx'}").write_bytes(workbook_bytes)
    load_usa_rate_card.cache_clear()
    return load_usa_rate_card()


def normalize_service(value: str | None) -> str:
    normalized = str(value or "duty_paid").strip().lower()
    return SERVICE_ALIASES.get(normalized, "duty_paid")


def extract_usa_zip(address: str | None) -> tuple[str | None, str | None]:
    matches = USA_ZIP_PATTERN.findall(str(address or ""))
    if not matches:
        return None, None
    postal_code = matches[-1]
    return postal_code, postal_code[:3]


def order_destination(order) -> tuple[str, str | None, str | None]:
    customer = getattr(order, "customer", None)
    address = (
        getattr(order, "import_shipping_address", None)
        or (getattr(customer, "shipping_address", None) if customer else None)
        or (getattr(customer, "address", None) if customer else None)
        or ""
    )
    postal_code, prefix = extract_usa_zip(address)
    return str(address), postal_code, prefix


def _region_and_zone(rate_card: dict, prefix: str | None) -> tuple[str | None, int | None, str | None]:
    if not prefix:
        return None, None, None
    special = rate_card["special_zip_prefixes"]
    if prefix in set(special["hawaii"]) | set(special["alaska"]):
        return "hawaii_alaska", None, "Hawaii / Alaska"
    zone = rate_card["zip_prefix_zones"].get(prefix)
    if zone is None:
        return None, None, None
    zone_number = int(zone)
    return "conus", zone_number, f"Zone {zone_number}"


def _product_weight(order) -> tuple[float, bool, list[dict]]:
    total = 0.0
    missing = []
    items = list(getattr(order, "items", None) or [])
    for item in items:
        quantity = max(int(getattr(item, "quantity", 0) or 0), 0)
        if quantity == 0:
            continue
        product = getattr(item, "product", None)
        unit_weight = float(getattr(product, "unit_weight_kg", 0) or 0)
        if unit_weight <= 0:
            missing.append({
                "product_id": getattr(item, "product_id", None),
                "article_no": getattr(product, "article_no", "") if product else "",
                "product_name": getattr(product, "name", "") if product else "",
                "quantity": quantity,
            })
            continue
        total += unit_weight * quantity
    return round(total, 3), bool(items) and not missing and total > 0, missing


def _rate_for_weight(
    rate_card: dict,
    service_key: str,
    region: str,
    zone: int | None,
    product_weight_kg: float,
) -> dict:
    service = rate_card["services"][service_key]
    if product_weight_kg <= 10:
        if not service["parcel_rates"]:
            return {
                "status": "rate_unavailable",
                "message": "This service starts at 11 kg in the supplied rate sheet.",
            }
        billing_weight = max(0.5, math.ceil(product_weight_kg * 2 - 1e-9) / 2)
        bracket = next(
            (row for row in service["parcel_rates"] if float(row["up_to_kg"]) >= billing_weight),
            None,
        )
        if not bracket:
            return {"status": "rate_unavailable", "message": "No parcel rate matches this weight."}
        rate_key = "hawaii_alaska" if region == "hawaii_alaska" else f"zone_{zone}"
        estimated = float(bracket[rate_key])
        return {
            "status": "ready",
            "billing_weight_kg": billing_weight,
            "estimated_shipping_cost": round(estimated, 2),
            "rate_per_kg": None,
            "rate_basis": f"Flat rate up to {billing_weight:g} kg",
        }

    billing_weight = float(math.ceil(product_weight_kg - 1e-9))
    rate_rows = (
        service["hawaii_alaska_per_kg"]
        if region == "hawaii_alaska"
        else service["conus_per_kg"]
    )
    bracket = next(
        (
            row
            for row in rate_rows
            if billing_weight >= float(row["from_kg"])
            and (row["to_kg"] is None or billing_weight <= float(row["to_kg"]))
        ),
        None,
    )
    if not bracket:
        return {"status": "rate_unavailable", "message": "No per-kilogram rate matches this weight."}
    rate_key = "rate" if region == "hawaii_alaska" else f"zone_{zone}"
    rate_per_kg = float(bracket[rate_key])
    return {
        "status": "ready",
        "billing_weight_kg": billing_weight,
        "estimated_shipping_cost": round(rate_per_kg * billing_weight, 2),
        "rate_per_kg": round(rate_per_kg, 2),
        "rate_basis": f"PKR {rate_per_kg:,.2f} per kg x {billing_weight:g} kg",
    }


def calculate_order_usa_shipping(order, service: str | None = None) -> dict:
    rate_card = load_usa_rate_card()
    service_key = normalize_service(service)
    address, postal_code, prefix = order_destination(order)
    region, zone, zone_label = _region_and_zone(rate_card, prefix)
    product_weight, product_weight_complete, missing = _product_weight(order)
    manual_weight = float(getattr(order, "shipping_weight_override_kg", 0) or 0)
    calculation_weight = round(manual_weight if manual_weight > 0 else product_weight, 3)
    weight_complete = manual_weight > 0 or product_weight_complete
    result = {
        "country": "USA",
        "carrier_product": rate_card["carrier_product"],
        "currency": rate_card["currency"],
        "service": service_key,
        "service_label": rate_card["services"][service_key]["label"],
        "source_filename": rate_card["source_filename"],
        "source_date": rate_card["source_date"],
        "destination_address": address,
        "destination_postal_code": postal_code,
        "destination_zip_prefix": prefix,
        "region": region,
        "zone": zone,
        "zone_label": zone_label,
        "product_weight_kg": product_weight,
        "product_weight_complete": product_weight_complete,
        "weight_override_kg": round(manual_weight, 3) if manual_weight > 0 else None,
        "calculation_weight_kg": calculation_weight,
        "weight_source": "manual" if manual_weight > 0 else "products",
        "weight_complete": weight_complete,
        "missing_weight_items": missing,
        "weight_warning": (
            "Manual rate weight is being used because some products have no stored unit weight."
            if manual_weight > 0 and missing
            else None
        ),
        "billing_weight_kg": None,
        "estimated_shipping_cost": None,
        "rate_per_kg": None,
        "rate_basis": None,
    }
    if not prefix:
        result.update(status="missing_postal_code", message="Add a 5-digit USA ZIP code to the shipping address.")
        return result
    if not region:
        result.update(status="unsupported_postal_prefix", message=f"ZIP prefix {prefix} is not listed in the supplied rate sheet.")
        return result
    if not weight_complete:
        result.update(status="missing_product_weight", message="Add a unit weight to every product in this order.")
        return result
    result.update(_rate_for_weight(rate_card, service_key, region, zone, calculation_weight))
    return result


def usa_rate_card_summary() -> dict:
    rate_card = load_usa_rate_card()
    return {
        "carrier_product": rate_card["carrier_product"],
        "currency": rate_card["currency"],
        "weight_unit": rate_card["weight_unit"],
        "source_filename": rate_card["source_filename"],
        "source_date": rate_card["source_date"],
        "uploaded_at": rate_card.get("uploaded_at"),
        "is_uploaded": ACTIVE_RATE_CARD_PATH.is_file(),
        "default_service": rate_card["default_service"],
        "services": [
            {"value": key, "label": service["label"]}
            for key, service in rate_card["services"].items()
        ],
        "zone_counts": rate_card["zone_counts"],
    }
