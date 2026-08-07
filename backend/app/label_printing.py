from __future__ import annotations

from collections.abc import Mapping, Sequence
import math
from pathlib import Path


TSPL_PRINTER_MARKERS = ("gainscha", "tsc", "xprinter", "gprinter", "hprt")
DEFAULT_THERMAL_DPI = 203
MM_PER_INCH = 25.4
ARIAL_BOLD_PATH = Path(r"C:\Windows\Fonts\arialbd.ttf")


class LabelPrintError(RuntimeError):
    """Raised when a direct thermal-label job cannot be created or sent."""


def _win32print():
    try:
        import win32print
    except ImportError as exc:
        raise LabelPrintError("Windows direct printing is not installed on this ERP server.") from exc
    return win32print


def _number(value: object, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _text(value: object) -> str:
    return str(value or "").replace("\r", " ").replace("\n", " ").replace('"', "'").encode("ascii", "replace").decode("ascii").strip()


def _bool(value: object) -> bool:
    return value is True or str(value).strip().lower() in {"1", "true", "yes"}


def _is_tspl_printer(name: str) -> bool:
    return any(marker in name.casefold() for marker in TSPL_PRINTER_MARKERS)


def _snap_printer_dpi(value: float) -> int:
    dpi = round(value)
    for known_dpi in (203, 300, 600):
        if abs(dpi - known_dpi) <= 12:
            return known_dpi
    return dpi


def _normalize_printer_dpi(value: object | None) -> int:
    dpi = _number(value, DEFAULT_THERMAL_DPI)
    if 150 <= dpi <= 1200:
        return _snap_printer_dpi(dpi)
    return DEFAULT_THERMAL_DPI


def _printer_dpi(printer_name: str) -> int:
    name = _text(printer_name).casefold()
    hinted_dpi = 300 if "300" in name else DEFAULT_THERMAL_DPI
    try:
        import win32con
        import win32ui

        dc = win32ui.CreateDC()
        try:
            dc.CreatePrinterDC(printer_name)
            candidates = [
                dc.GetDeviceCaps(getattr(win32con, "LOGPIXELSX", 88)),
                dc.GetDeviceCaps(getattr(win32con, "LOGPIXELSY", 90)),
            ]
        finally:
            try:
                dc.DeleteDC()
            except Exception:
                pass
        usable = [value for value in candidates if 150 <= int(value) <= 1200]
        if usable:
            return _snap_printer_dpi(sum(usable) / len(usable))
    except Exception:
        pass
    return hinted_dpi


def _dots_per_mm(printer_dpi: object | None = None) -> float:
    return _normalize_printer_dpi(printer_dpi) / MM_PER_INCH


def list_label_printers() -> dict:
    win32print = _win32print()
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    default_printer = win32print.GetDefaultPrinter()
    printers = []
    for entry in win32print.EnumPrinters(flags):
        name = entry[2]
        printers.append(
            {
                "name": name,
                "is_default": name == default_printer,
                "supports_direct_labels": _is_tspl_printer(name),
            }
        )
    return {
        "default_printer": default_printer,
        "default_printer_dpi": _printer_dpi(default_printer),
        "printers": printers,
    }


def _code128_unit(character: str) -> int:
    if "a" <= character <= "z":
        return ord(character) - ord("a") + 1
    if "A" <= character <= "Z":
        return ord(character) - ord("A") + 1
    return 0


def _draw_code128_bitmap(draw: object, value: str, x: int, y: int, width: int, height: int) -> None:
    from reportlab.graphics.barcode.code128 import Code128

    if width <= 0 or height <= 0:
        return
    code = Code128(value or "LABEL", quiet=False, humanReadable=False)
    code._calculate()
    pattern = code.decomposed
    total_units = sum(_code128_unit(character) for character in pattern)
    if total_units <= 0:
        return

    left = x
    consumed_units = 0
    bottom = max(y, y + height - 1)
    for character in pattern:
        units = _code128_unit(character)
        consumed_units += units
        right = x + round((consumed_units * width) / total_units)
        if right > left and "A" <= character <= "Z":
            draw.rectangle((left, y, right - 1, bottom), fill=0)
        left = right


def _resolve_printer(printer_name: object | None) -> str:
    win32print = _win32print()
    requested = _text(printer_name)
    available = list_label_printers()["printers"]
    if requested:
        if not any(printer["name"] == requested for printer in available):
            raise LabelPrintError("The selected label printer is not available on this computer.")
        name = requested
    else:
        name = win32print.GetDefaultPrinter()
    if not _is_tspl_printer(name):
        raise LabelPrintError("Direct label printing needs a TSPL-compatible thermal printer such as Gainscha.")
    return name


def _offset(item: Mapping[str, object], layer_id: str, dots_per_mm: float) -> int:
    offsets = item.get("layerOffsets")
    value = offsets.get(layer_id) if isinstance(offsets, Mapping) else 0
    return round(max(-8, min(8, _number(value))) * dots_per_mm)


def _scale(item: Mapping[str, object], field: str, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, _number(item.get(field), 1)))


def _layer_order(item: Mapping[str, object]) -> list[str]:
    default = ["brand", "title", "price", "image", "barcode", "sku"]
    saved = item.get("layerOrder")
    if not isinstance(saved, Sequence) or isinstance(saved, (str, bytes)):
        return default
    ordered = [str(layer) for layer in saved if str(layer) in default]
    return list(dict.fromkeys([*ordered, *default]))


def _preview_scale(width_mm: float, height_mm: float) -> float:
    return min(5.4, 360 / width_mm, 300 / height_mm)


def _font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.truetype(str(ARIAL_BOLD_PATH), max(7, size))
    except OSError:
        return ImageFont.load_default()


def _text_lines(draw: object, value: str, font: object, max_width: int) -> list[str]:
    if not value:
        return []
    words = value.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _text_position(width_dots: int, inset: int, text_width: int, alignment: object) -> int:
    direction = _text(alignment).casefold()
    if direction == "center":
        return max(inset, (width_dots - text_width) // 2)
    if direction == "right":
        return max(inset, width_dots - inset - text_width)
    return inset


def _label_text_bitmap(item: Mapping[str, object], width_mm: float, height_mm: float, dots_per_mm: float) -> tuple[bytes, int]:
    from PIL import Image, ImageDraw

    width_dots = round(width_mm * dots_per_mm)
    height_dots = round(height_mm * dots_per_mm)
    display_scale = _preview_scale(width_mm, height_mm)
    compact = height_mm <= 30
    inset = round((9 if compact else 12) * dots_per_mm / display_scale)
    gap = max(2, round(3 * dots_per_mm / display_scale))
    content_width = max(1, width_dots - (inset * 2))
    text_base_css = max(9, min(18, height_mm * 0.42))
    independent_text_base_css = max(9, min(18, text_base_css * 1.3))
    title_css = max(9, min(18, text_base_css * _scale(item, "titleScale", 0.7, 1.7)))
    sku_value = _text(item.get("sku") or item.get("articleNo") or item.get("barcode") or "LABEL")
    text_layers = {
        "brand": (max(7, independent_text_base_css * 0.48 * _scale(item, "brandScale", 0.7, 1.7)), 1.0, _text(item.get("brand")), item.get("brandAlign")),
        "title": (title_css, 1.08, _text(item.get("title") or "UNTITLED LABEL"), item.get("titleAlign")),
        "price": (max(7, independent_text_base_css * 0.62 * _scale(item, "priceScale", 0.7, 1.7)), 1.0, _text(item.get("price")), item.get("priceAlign")),
        "sku": (max(9, independent_text_base_css * 0.78 * _scale(item, "skuScale", 0.7, 1.8)), 1.0, sku_value, item.get("skuAlign")),
    }
    barcode_css_height = max(20, min(54, height_mm * display_scale * (0.21 if compact else 0.19)))
    barcode_height_scale = _scale(item, "barcodeHeightScale", 0.55, 2.0)
    barcode_height = max(24, round(barcode_css_height * _scale(item, "barcodeScale", 0.55, 1.6) * barcode_height_scale * dots_per_mm / display_scale))
    bitmap = Image.new("1", (width_dots, height_dots), 1)
    draw = ImageDraw.Draw(bitmap)
    elements: list[dict[str, object]] = []

    for layer_id in _layer_order(item):
        if layer_id == "brand" and _bool(item.get("showBrand")) and text_layers["brand"][2]:
            css_size, line_height, value, alignment = text_layers["brand"]
        elif layer_id == "title":
            css_size, line_height, value, alignment = text_layers["title"]
        elif layer_id == "price" and _bool(item.get("showPrice")) and text_layers["price"][2]:
            css_size, line_height, value, alignment = text_layers["price"]
        elif layer_id == "barcode" and _bool(item.get("showBarcode", True)):
            elements.append({"id": layer_id, "height": barcode_height, "offset": _offset(item, layer_id, dots_per_mm)})
            continue
        elif layer_id == "sku" and _bool(item.get("showBarcode", True)):
            css_size, line_height, value, alignment = text_layers["sku"]
        else:
            continue

        font = _font(round(css_size * dots_per_mm / display_scale))
        lines = _text_lines(draw, value, font, content_width)
        line_height_dots = max(1, round(css_size * line_height * dots_per_mm / display_scale))
        elements.append(
            {
                "id": layer_id,
                "font": font,
                "lines": lines,
                "line_height": line_height_dots,
                "alignment": alignment,
                "height": line_height_dots * max(1, len(lines)),
                "offset": _offset(item, layer_id, dots_per_mm),
            }
        )

    total_height = sum(int(element["height"]) + int(element["offset"]) for element in elements)
    total_height += gap * max(0, len(elements) - 1)
    y = max(inset, (height_dots - total_height) // 2)
    for index, element in enumerate(elements):
        if index:
            y += gap
        y += int(element["offset"])
        if element["id"] == "barcode":
            barcode_scale = _scale(item, "barcodeScale", 0.55, 1.6)
            barcode_width = min(content_width, round(content_width * 0.78 * barcode_scale))
            barcode_width = max(1, barcode_width)
            barcode_x = max(inset, (width_dots - barcode_width) // 2)
            barcode_y = min(max(0, y), max(0, height_dots - int(element["height"])))
            barcode_value = _text(item.get("barcode") or sku_value or "LABEL") or "LABEL"
            _draw_code128_bitmap(draw, barcode_value, barcode_x, barcode_y, barcode_width, int(element["height"]))
        else:
            font = element["font"]
            for line_index, line in enumerate(element["lines"]):
                box = draw.textbbox((0, 0), line, font=font)
                x = _text_position(width_dots, inset, box[2] - box[0], element["alignment"])
                draw.text((x - box[0], y + (line_index * int(element["line_height"])) - box[1]), line, font=font, fill=0)
        y += int(element["height"])

    return bitmap.tobytes(), math.ceil(width_dots / 8)


def _append_command(payload: bytearray, command: str) -> None:
    payload.extend(command.encode("ascii", "replace"))
    payload.extend(b"\r\n")


def build_tspl_job(labels: Sequence[Mapping[str, object]], size: Mapping[str, object], printer_dpi: object | None = None) -> bytes:
    width_mm = max(15, min(200, _number(size.get("width"), 50)))
    height_mm = max(10, min(300, _number(size.get("height"), 25)))
    gap_mm = max(0, min(20, _number(size.get("gap"), 2)))
    dots_per_mm = _dots_per_mm(printer_dpi)
    height_dots = round(height_mm * dots_per_mm)
    payload = bytearray()
    _append_command(payload, f"SIZE {width_mm:g} mm,{height_mm:g} mm")
    _append_command(payload, f"GAP {gap_mm:g} mm,0 mm")
    _append_command(payload, "DIRECTION 1,0")
    _append_command(payload, "REFERENCE 0,0")
    _append_command(payload, "CODEPAGE 1252")
    label_count = 0

    for item in labels:
        if not isinstance(item, Mapping):
            continue
        quantity = max(1, min(1000, round(_number(item.get("quantity"), 1))))
        text_bitmap, row_bytes = _label_text_bitmap(item, width_mm, height_mm, dots_per_mm)
        _append_command(payload, "CLS")
        payload.extend(f"BITMAP 0,0,{row_bytes},{height_dots},0,".encode("ascii"))
        payload.extend(text_bitmap)
        payload.extend(b"\r\n")

        _append_command(payload, f"PRINT 1,{quantity}")
        label_count += 1

    if not label_count:
        raise LabelPrintError("Add at least one label before printing.")
    return bytes(payload)


def print_tspl_labels(
    labels: Sequence[Mapping[str, object]],
    size: Mapping[str, object],
    printer_name: object | None = None,
    printer_dpi: object | None = None,
) -> dict:
    if not isinstance(labels, Sequence) or isinstance(labels, (str, bytes)):
        raise LabelPrintError("The direct print job did not include any labels.")
    if not isinstance(size, Mapping):
        raise LabelPrintError("Choose a label size before printing.")
    printer = _resolve_printer(printer_name)
    resolved_dpi = _normalize_printer_dpi(printer_dpi) if printer_dpi is not None else _printer_dpi(printer)
    payload = build_tspl_job(labels, size, resolved_dpi)
    win32print = _win32print()
    handle = win32print.OpenPrinter(printer)
    job_id = None
    try:
        job_id = win32print.StartDocPrinter(handle, 1, ("Hisbenew ERP labels", None, "RAW"))
        win32print.StartPagePrinter(handle)
        written = win32print.WritePrinter(handle, payload)
        win32print.EndPagePrinter(handle)
        win32print.EndDocPrinter(handle)
    except Exception as exc:
        if job_id is not None:
            try:
                win32print.AbortPrinter(handle)
            except Exception:
                pass
        raise LabelPrintError(f"The label printer did not accept the direct job: {exc}") from exc
    finally:
        win32print.ClosePrinter(handle)
    total_labels = sum(max(1, min(1000, round(_number(item.get("quantity"), 1)))) for item in labels if isinstance(item, Mapping))
    return {"printer": printer, "printer_dpi": resolved_dpi, "job_id": job_id, "bytes_sent": written, "label_count": total_labels}
