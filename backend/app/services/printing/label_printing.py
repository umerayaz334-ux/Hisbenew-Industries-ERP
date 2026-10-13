from __future__ import annotations

from collections.abc import Mapping, Sequence
import math
from pathlib import Path


TSPL_PRINTER_MARKERS = ("gainscha", "tsc", "xprinter", "gprinter", "hprt")
DEFAULT_THERMAL_DPI = 203
MM_PER_INCH = 25.4
ARIAL_BOLD_PATH = Path(r"C:\Windows\Fonts\arialbd.ttf")
ARIAL_REGULAR_PATH = Path(r"C:\Windows\Fonts\arial.ttf")
BLOCKING_PRINTER_STATUS_FLAGS = (
    ("PRINTER_STATUS_PAUSED", 0x00000001, "Paused"),
    ("PRINTER_STATUS_OFFLINE", 0x00000080, "Offline"),
    ("PRINTER_STATUS_NOT_AVAILABLE", 0x00001000, "Not available"),
    ("PRINTER_STATUS_ERROR", 0x00000002, "Error"),
    ("PRINTER_STATUS_PAPER_JAM", 0x00000008, "Paper jam"),
    ("PRINTER_STATUS_PAPER_OUT", 0x00000010, "Paper out"),
    ("PRINTER_STATUS_MANUAL_FEED", 0x00000020, "Manual feed"),
    ("PRINTER_STATUS_PAPER_PROBLEM", 0x00000040, "Paper problem"),
    ("PRINTER_STATUS_NO_TONER", 0x00040000, "No toner"),
    ("PRINTER_STATUS_OUTPUT_BIN_FULL", 0x00000800, "Output bin full"),
    ("PRINTER_STATUS_DOOR_OPEN", 0x00400000, "Door open"),
    ("PRINTER_STATUS_USER_INTERVENTION", 0x00100000, "Needs attention"),
    ("PRINTER_STATUS_SERVER_UNKNOWN", 0x00800000, "Unknown"),
)
NON_BLOCKING_PRINTER_STATUS_FLAGS = (
    ("PRINTER_STATUS_BUSY", 0x00000200, "Busy"),
    ("PRINTER_STATUS_PRINTING", 0x00000400, "Printing"),
    ("PRINTER_STATUS_WAITING", 0x00002000, "Waiting"),
    ("PRINTER_STATUS_PROCESSING", 0x00004000, "Processing"),
    ("PRINTER_STATUS_INITIALIZING", 0x00008000, "Initializing"),
    ("PRINTER_STATUS_WARMING_UP", 0x00010000, "Warming up"),
    ("PRINTER_STATUS_TONER_LOW", 0x00020000, "Toner low"),
    ("PRINTER_STATUS_POWER_SAVE", 0x01000000, "Power save"),
)


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


def _append_command(payload: bytearray, command: str) -> None:
    payload.extend(command.encode("ascii", "ignore"))
    payload.extend(b"\r\n")


def _append_bitmap_command(
    payload: bytearray,
    x: int,
    y: int,
    row_bytes: int,
    height_dots: int,
    bitmap: bytes,
) -> None:
    payload.extend(f"BITMAP {x},{y},{row_bytes},{height_dots},0,".encode("ascii", "ignore"))
    payload.extend(bitmap)
    payload.extend(b"\r\n")

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


def _status_matches(win32print: object, status: int, flags: tuple[tuple[str, int, str], ...]) -> list[str]:
    labels = []
    for constant_name, fallback_value, label in flags:
        if status & int(getattr(win32print, constant_name, fallback_value)):
            labels.append(label)
    return labels


def _wmi_printer_offline(printer_name: str) -> tuple[bool, str]:
    """Return (is_offline, detail) using WMI — catches USB unplug faster than spooler Status alone."""
    try:
        import win32com.client  # type: ignore

        escaped = str(printer_name or "").replace("\\", "\\\\").replace('"', '\\"')
        query = f'SELECT Name, PortName, WorkOffline, PrinterStatus, DetectedErrorState FROM Win32_Printer WHERE Name="{escaped}"'
        wmi = win32com.client.GetObject("winmgmts:")
        matches = wmi.ExecQuery(query)
        for printer in matches:
            work_offline = bool(getattr(printer, "WorkOffline", False))
            printer_status = int(getattr(printer, "PrinterStatus", 0) or 0)
            error_state = int(getattr(printer, "DetectedErrorState", 0) or 0)
            port_name = str(getattr(printer, "PortName", "") or "")
            # PrinterStatus 7 = Offline. DetectedErrorState 5 = No paper, 6 = Not available, etc.
            if work_offline or printer_status == 7:
                return True, "USB/cable disconnected (Windows reports offline)."
            if error_state in {4, 5, 6, 9}:  # Service / offline-ish / not available
                return True, "Printer hardware is not available."
            if port_name.upper().startswith("USB") and _usb_port_missing(port_name):
                return True, f"USB port {port_name} is not present."
            return False, ""
    except Exception:
        pass
    return False, ""


def _usb_port_missing(port_name: str) -> bool:
    """True when a USB* spooler port is gone after unplug."""
    clean = str(port_name or "").strip()
    if not clean.upper().startswith("USB"):
        return False
    try:
        win32print = _win32print()
        names = set()
        for entry in win32print.EnumPorts(None, 1):
            if isinstance(entry, Mapping):
                names.add(str(entry.get("Name") or entry.get("pName") or "").strip().upper())
            elif isinstance(entry, (list, tuple)) and entry:
                names.add(str(entry[0] or "").strip().upper())
            else:
                names.add(str(entry or "").strip().upper())
        if not names:
            return False
        return clean.upper() not in names
    except Exception:
        return False


def _clear_work_offline_attribute(printer_name: str) -> None:
    """Clear sticky WORK_OFFLINE so USB replug shows connected on live immediately."""
    win32print = _win32print()
    work_offline_flag = int(getattr(win32print, "PRINTER_ATTRIBUTE_WORK_OFFLINE", 0x00000400))
    try:
        handle = win32print.OpenPrinter(printer_name, {"DesiredAccess": win32print.PRINTER_ALL_ACCESS})
    except Exception:
        try:
            handle = win32print.OpenPrinter(printer_name)
        except Exception:
            return
    try:
        info = win32print.GetPrinter(handle, 2)
        if not isinstance(info, Mapping):
            return
        attributes = int(info.get("Attributes") or 0)
        if not (attributes & work_offline_flag):
            return
        updated = dict(info)
        updated["Attributes"] = attributes & ~work_offline_flag
        win32print.SetPrinter(handle, 2, updated, 0)
    except Exception:
        pass
    finally:
        try:
            win32print.ClosePrinter(handle)
        except Exception:
            pass


def _printer_connection_status(printer_name: str) -> dict:
    win32print = _win32print()
    try:
        handle = win32print.OpenPrinter(printer_name)
    except Exception as exc:
        return {
            "is_connected": False,
            "status": "Not connected",
            "status_detail": _text(exc) or "Windows could not open this printer.",
            "jobs": 0,
        }

    try:
        info = win32print.GetPrinter(handle, 2)
    except Exception as exc:
        return {
            "is_connected": False,
            "status": "Not connected",
            "status_detail": _text(exc) or "Windows could not read this printer status.",
            "jobs": 0,
        }
    finally:
        try:
            win32print.ClosePrinter(handle)
        except Exception:
            pass

    status_value = int(info.get("Status") or 0) if isinstance(info, Mapping) else 0
    attributes = int(info.get("Attributes") or 0) if isinstance(info, Mapping) else 0
    jobs = int(info.get("cJobs") or 0) if isinstance(info, Mapping) else 0
    port_name = str(info.get("pPortName") or info.get("PortName") or "") if isinstance(info, Mapping) else ""
    blocking_statuses = _status_matches(win32print, status_value, BLOCKING_PRINTER_STATUS_FLAGS)
    active_statuses = _status_matches(win32print, status_value, NON_BLOCKING_PRINTER_STATUS_FLAGS)
    attr_work_offline = bool(
        attributes & int(getattr(win32print, "PRINTER_ATTRIBUTE_WORK_OFFLINE", 0x00000400))
    )
    wmi_offline, wmi_detail = _wmi_printer_offline(printer_name)
    usb_gone = _usb_port_missing(port_name)

    # USB port + WMI are the truth for plug/unplug. Sticky WORK_OFFLINE alone must not
    # keep live stuck on "Not connected" after the cable is plugged back in.
    hardware_offline = wmi_offline or usb_gone
    if hardware_offline:
        if "Offline" not in blocking_statuses:
            blocking_statuses.append("Offline")
    elif attr_work_offline:
        _clear_work_offline_attribute(printer_name)

    status_labels = blocking_statuses + active_statuses
    detail = ""
    if usb_gone:
        detail = f"USB port {port_name} removed — printer is not connected."
    elif wmi_detail:
        detail = wmi_detail

    is_connected = not blocking_statuses and not hardware_offline
    return {
        "is_connected": is_connected,
        "status": "Ready" if is_connected and not status_labels else (
            "Not connected" if not is_connected else ", ".join(status_labels)
        ),
        "status_detail": detail,
        "jobs": jobs,
    }

def list_label_printers() -> dict:
    win32print = _win32print()
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    try:
        default_printer = win32print.GetDefaultPrinter()
    except Exception:
        default_printer = ""
    printers = []
    for entry in win32print.EnumPrinters(flags):
        name = entry[2]
        status = _printer_connection_status(name)
        printers.append(
            {
                "name": name,
                "is_default": name == default_printer,
                "supports_direct_labels": _is_tspl_printer(name),
                **status,
            }
        )
    return {
        "default_printer": default_printer,
        "default_printer_dpi": _printer_dpi(default_printer) if default_printer else DEFAULT_THERMAL_DPI,
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
        selected = next((printer for printer in available if printer["name"] == requested), None)
        if not selected:
            raise LabelPrintError("The selected label printer is not available on this computer.")
        name = requested
    else:
        name = win32print.GetDefaultPrinter()
        selected = next((printer for printer in available if printer["name"] == name), None)
    if selected and selected.get("is_connected") is False:
        detail = selected.get("status") or "not connected"
        raise LabelPrintError(f"The selected label printer is {str(detail).lower()}. Check the cable, power, and Windows printer queue.")
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



def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _position_percent(item: Mapping[str, object], layer_id: str, default: Mapping[str, float]) -> dict[str, float]:
    positions = item.get("positions")
    raw_position = positions.get(layer_id) if isinstance(positions, Mapping) else None
    data = raw_position if isinstance(raw_position, Mapping) else {}
    width = _clamp(_number(data.get("w"), float(default["w"])), 8.0, 100.0)
    height = _clamp(_number(data.get("h"), float(default["h"])), 6.0, 100.0)
    return {
        "x": _clamp(_number(data.get("x"), float(default["x"])), 0.0, 100.0 - width),
        "y": _clamp(_number(data.get("y"), float(default["y"])), 0.0, 100.0 - height),
        "w": width,
        "h": height,
    }


def _position_box(item: Mapping[str, object], layer_id: str, width_dots: int, height_dots: int) -> tuple[int, int, int, int]:
    defaults = {
        "brand": {"x": 7.0, "y": 8.0, "w": 42.0, "h": 12.0},
        "title": {"x": 9.0, "y": 20.0, "w": 82.0, "h": 20.0},
        "price": {"x": 7.0, "y": 64.0, "w": 34.0, "h": 12.0},
        "image": {"x": 68.0, "y": 7.0, "w": 24.0, "h": 24.0},
        "barcode": {"x": 20.0, "y": 48.0, "w": 60.0, "h": 18.0},
        "sku": {"x": 20.0, "y": 70.0, "w": 60.0, "h": 16.0},
    }
    position = _position_percent(item, layer_id, defaults.get(layer_id, defaults["title"]))
    x = round(width_dots * position["x"] / 100.0)
    y = round(height_dots * position["y"] / 100.0)
    box_width = max(1, round(width_dots * position["w"] / 100.0))
    box_height = max(1, round(height_dots * position["h"] / 100.0))
    return x, y, min(box_width, width_dots - x), min(box_height, height_dots - y)


def _has_positioned_layout(item: Mapping[str, object]) -> bool:
    return isinstance(item.get("positions"), Mapping)


def _layer_stretch(item: Mapping[str, object], layer_id: str) -> tuple[float, float]:
    fields = {
        "brand": ("brandStretchX", "brandStretchY"),
        "title": ("titleStretchX", "titleStretchY"),
        "price": ("priceStretchX", "priceStretchY"),
        "sku": ("skuStretchX", "skuStretchY"),
    }.get(layer_id)
    if not fields:
        return 1.0, 1.0
    return _clamp(_number(item.get(fields[0]), 1.0), 0.25, 4.0), _clamp(_number(item.get(fields[1]), 1.0), 0.25, 4.0)
def _preview_scale(width_mm: float, height_mm: float) -> float:
    return min(5.4, 360 / width_mm, 300 / height_mm)


def _font(size: int, bold: bool = True):
    from PIL import ImageFont

    font_path = ARIAL_BOLD_PATH if bold else ARIAL_REGULAR_PATH
    fallback_path = ARIAL_REGULAR_PATH if bold else ARIAL_BOLD_PATH
    try:
        return ImageFont.truetype(str(font_path), max(7, size))
    except OSError:
        try:
            return ImageFont.truetype(str(fallback_path), max(7, size))
        except OSError:
            return ImageFont.load_default()


def _text_width(draw: object, value: str, font: object, tracking: int = 0) -> float:
    if not value:
        return 0
    width = float(draw.textlength(value, font=font))
    if tracking > 0 and len(value) > 1:
        width += tracking * (len(value) - 1)
    return width


def _text_lines(draw: object, value: str, font: object, max_width: int, tracking: int = 0) -> list[str]:
    if not value:
        return []
    words = value.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if _text_width(draw, candidate, font, tracking) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _draw_tracked_text(draw: object, x: int, y: int, value: str, font: object, tracking: int = 0, stroke_width: int = 0) -> None:
    stroke_width = max(0, int(stroke_width or 0))
    if tracking <= 0 or len(value) <= 1:
        draw.text((x, y), value, font=font, fill=0, stroke_width=stroke_width, stroke_fill=0)
        return
    cursor = x
    for char in value:
        draw.text((cursor, y), char, font=font, fill=0, stroke_width=stroke_width, stroke_fill=0)
        cursor += float(draw.textlength(char, font=font)) + tracking


def _font_size(font: object, fallback: int = 10) -> int:
    try:
        return max(1, int(getattr(font, "size", fallback) or fallback))
    except Exception:
        return fallback


def _layer_line_height(layer_id: str) -> float:
    return 1.18 if layer_id in {"brand", "title", "sku"} else 1.0


def _layer_bold(item: Mapping[str, object], layer_id: str) -> bool:
    fields = {
        "brand": "brandBold",
        "title": "titleBold",
        "sku": "skuBold",
        "price": "priceBold",
    }
    field = fields.get(layer_id)
    return bool(field and item.get(field) is not False)


def _layer_stroke_width(item: Mapping[str, object], layer_id: str, font: object) -> int:
    if not _layer_bold(item, layer_id) or layer_id not in {"title", "sku"}:
        return 0
    return max(1, min(2, round(_font_size(font) * 0.026)))


def _text_position(width_dots: int, inset: int, text_width: int, alignment: object) -> int:
    direction = _text(alignment).casefold()
    if direction == "center":
        return max(inset, (width_dots - text_width) // 2)
    if direction == "right":
        return max(inset, width_dots - inset - text_width)
    return inset


def _size_value(size: Mapping[str, object], *keys: str, default: float) -> float:
    for key in keys:
        if key in size and size.get(key) not in (None, ""):
            return _number(size.get(key), default)
    return default


def _layer_alignment(item: Mapping[str, object], layer_id: str) -> str:
    field_by_layer = {
        "brand": "brandAlign",
        "title": "titleAlign",
        "sku": "skuAlign",
        "price": "priceAlign",
    }
    value = _text(item.get(field_by_layer.get(layer_id, "")) or item.get("textAlign") or "center").casefold()
    return value if value in {"left", "center", "right"} else "center"


def _scale_px_to_dots(value_px: float, preview_scale: float, dots_per_mm: float, minimum: int = 7) -> int:
    if preview_scale <= 0:
        preview_scale = 1
    return max(minimum, round((value_px / preview_scale) * dots_per_mm))

CODE128_PATTERNS = {
    ' ': '11011001100', '!': '11001101100', '"': '11001100110', '#': '10010011000', '$': '10010001100',
    '%': '10001001100', '&': '10011001000', "'": '10011000100', '(': '10001100100', ')': '11001001000',
    '*': '11001000100', '+': '11000100100', ',': '10110011100', '-': '10011011100', '.': '10011001110',
    '/': '10111001100', '0': '10011101100', '1': '10011100110', '2': '11001110100', '3': '11001110010',
    '4': '11011100100', '5': '11011001110', '6': '11011000110', '7': '11011101100', '8': '11011100110',
    '9': '11011011100', ':': '11011001110', ';': '11011000110', '<': '11000111010', '=': '11010111000',
    '>': '11000101110', '?': '11011101000', '@': '11011100100', 'A': '10100011000', 'B': '10001011000',
    'C': '10001000110', 'D': '10110001000', 'E': '10001101000', 'F': '10001100100', 'G': '10110000100',
    'H': '10001100010', 'I': '10000110010', 'J': '10100001100', 'K': '10001000110', 'L': '10000100110',
    'M': '10110001000', 'N': '10110000100', 'O': '10001101000', 'P': '10001100100', 'Q': '10110111000',
    'R': '10110001110', 'S': '10001101110', 'T': '10111011000', 'U': '10111001110', 'V': '10001110110',
    'W': '11101101000', 'X': '11101001100', 'Y': '11101000110', 'Z': '11100101100', '[': '11100100110',
    '\\': '11101100100', ']': '11100110100', '^': '11100110010', '_': '11011011000',
}

def _encode_code128(text: str) -> str:
    text = str(text or "").upper().strip()
    if not text:
        text = "LABEL"
    checksum = 104
    pattern_str = '11010010000'
    for idx, char in enumerate(text, 1):
        val = ord(char) - 32
        if 0 <= val <= 94:
            checksum += val * idx
            pattern_str += CODE128_PATTERNS.get(char, CODE128_PATTERNS[' '])
    check_val = checksum % 103
    char_keys = list(CODE128_PATTERNS.keys())
    if check_val < len(char_keys):
        pattern_str += CODE128_PATTERNS[char_keys[check_val]]
    else:
        pattern_str += CODE128_PATTERNS[' ']
    pattern_str += '1100011101011'
    return pattern_str


def _label_text_bitmap(item: Mapping[str, object], width_mm: float, height_mm: float, dots_per_mm: float) -> tuple[bytes, int]:
    from PIL import Image, ImageDraw

    width_dots = round(width_mm * dots_per_mm)
    height_dots = round(height_mm * dots_per_mm)
    row_bytes = (width_dots + 7) // 8
    img = Image.new("1", (width_dots, height_dots), 1)
    draw = ImageDraw.Draw(img)

    compact = height_mm <= 30
    preview_scale = _preview_scale(width_mm, height_mm)
    preview_height = max(90.0, height_mm * preview_scale)
    inset = max(4, round((1.15 if compact else 1.45) * dots_per_mm))
    gap = max(1, round((0.30 if compact else 0.45) * dots_per_mm))
    inner_width = max(1, width_dots - (inset * 2))

    title = _text(item.get("title") or item.get("product_name") or "PRODUCT LABEL")
    sku = _text(item.get("sku") or item.get("articleNo") or item.get("barcode") or "LABEL-001")
    barcode_val = _text(item.get("barcode") or sku)
    brand = _text(item.get("brand") or item.get("brand_name") or "")
    price = _text(item.get("price") or "")

    show_title = item.get("showTitle") is not False
    show_brand = _bool(item.get("showBrand")) and bool(brand)
    show_price = _bool(item.get("showPrice")) and bool(price)
    show_barcode = item.get("showBarcode") is not False
    show_sku = (item.get("showSku") is not False) and (show_barcode or "showSku" in item)

    text_base_px = max(9.0, min(18.0, height_mm * 0.42))
    independent_px = max(9.0, min(18.0, text_base_px * 1.3))
    title_bold = _layer_bold(item, "title")
    brand_bold = _layer_bold(item, "brand")
    sku_bold = _layer_bold(item, "sku")
    price_bold = _layer_bold(item, "price")
    title_font = _font(_scale_px_to_dots(max(7.0, text_base_px * _scale(item, "titleScale", 0.35, 3.5)), preview_scale, dots_per_mm, 8), title_bold)
    brand_font = _font(_scale_px_to_dots(max(6.0, independent_px * 0.48 * _scale(item, "brandScale", 0.35, 3.5)), preview_scale, dots_per_mm, 7), brand_bold)
    sku_font = _font(_scale_px_to_dots(max(7.0, independent_px * 0.78 * _scale(item, "skuScale", 0.35, 3.5)), preview_scale, dots_per_mm, 8), sku_bold)
    price_font = _font(_scale_px_to_dots(max(6.0, independent_px * 0.62 * _scale(item, "priceScale", 0.35, 3.5)), preview_scale, dots_per_mm, 7), price_bold)

    def text_height(font: object, value: str = "Hg") -> int:
        bbox = draw.textbbox((0, 0), value or "Hg", font=font)
        return max(1, bbox[3] - bbox[1])

    def fit_text(value: str, font: object, max_width: int, tracking: int = 0, max_lines: int = 1, bold: bool = True) -> tuple[object, list[str]]:
        lines = [value] if max_lines <= 1 else _text_lines(draw, value, font, max_width, tracking)
        size = getattr(font, "size", 10)
        while size > 7 and (len(lines) > max_lines or any(_text_width(draw, line, font, tracking) > max_width for line in lines)):
            size -= 1
            font = _font(size, bold)
            lines = [value] if max_lines <= 1 else _text_lines(draw, value, font, max_width, tracking)
        if len(lines) > max_lines:
            lines = lines[:max_lines]
        return font, lines

    text_resample = getattr(getattr(Image, "Resampling", Image), "NEAREST", Image.NEAREST)

    def text_object_metrics(
        value: str,
        font: object,
        tracking: int = 0,
        stretch_x: float = 1.0,
        stretch_y: float = 1.0,
        line_height: float = 1.0,
        stroke_width: int = 0,
    ) -> tuple[int, int, tuple[int, int, int, int], int, int, int]:
        stroke_width = max(0, int(stroke_width or 0))
        bbox = draw.textbbox((0, 0), value or " ", font=font, stroke_width=stroke_width)
        glyph_height = max(1, bbox[3] - bbox[1])
        raw_width = max(1, math.ceil(_text_width(draw, value, font, tracking) + stroke_width * 2))
        raw_line_height = max(glyph_height, math.ceil(_font_size(font, glyph_height) * max(1.0, line_height)))
        return (
            max(1, math.ceil(raw_width * stretch_x)),
            max(1, math.ceil(raw_line_height * stretch_y)),
            bbox,
            raw_width,
            raw_line_height,
            glyph_height,
        )

    def draw_text_object(
        x: int,
        y: int,
        value: str,
        font: object,
        tracking: int = 0,
        stretch_x: float = 1.0,
        stretch_y: float = 1.0,
        line_height: float = 1.0,
        stroke_width: int = 0,
    ) -> tuple[int, int]:
        final_width, final_height, bbox, raw_width, raw_line_height, glyph_height = text_object_metrics(
            value,
            font,
            tracking,
            stretch_x,
            stretch_y,
            line_height,
            stroke_width,
        )
        draw_x = max(0, stroke_width - bbox[0])
        draw_y = round((raw_line_height - glyph_height) / 2) - bbox[1]
        if abs(stretch_x - 1.0) < 0.01 and abs(stretch_y - 1.0) < 0.01:
            _draw_tracked_text(draw, x + draw_x, y + draw_y, value, font, tracking, stroke_width)
            return final_width, final_height
        mask = Image.new("L", (raw_width, raw_line_height), 255)
        mask_draw = ImageDraw.Draw(mask)
        _draw_tracked_text(mask_draw, draw_x, draw_y, value, font, tracking, stroke_width)
        mask = mask.resize((final_width, final_height), text_resample)
        alpha = mask.point(lambda pixel: 255 - pixel)
        img.paste(0, (x, y), alpha)
        return final_width, final_height

    layers: list[dict[str, object]] = []

    positioned_layout = _has_positioned_layout(item)

    def add_text_layer(layer_id: str, value: str, font: object, tracking: int = 0, max_lines: int = 1, bold: bool = True) -> None:
        if not value:
            return
        if positioned_layout:
            fitted_font, lines = font, [value]
        else:
            fitted_font, lines = fit_text(value, font, inner_width, tracking, max_lines, bold)
        line_gap = max(1, round(0.18 * dots_per_mm)) if len(lines) > 1 else 0
        height = sum(text_height(fitted_font, line) for line in lines) + line_gap * max(0, len(lines) - 1)
        layers.append({
            "kind": "text",
            "layer_id": layer_id,
            "font": fitted_font,
            "bold": bold,
            "value": value,
            "lines": lines,
            "max_lines": max_lines,
            "tracking": tracking,
            "height": height,
            "align": _layer_alignment(item, layer_id),
            "line_gap": line_gap,
        })

    def add_barcode_layer() -> None:
        if not barcode_val:
            return
        barcode_scale = _scale(item, "barcodeScale", 0.55, 1.8)
        height_scale = max(0.55, min(2.0, _number(item.get("barcodeHeightScale"), 1)))
        base_height_px = max(20.0, min(54.0, preview_height * (0.21 if compact else 0.19)))
        barcode_height = max(10, round((base_height_px * barcode_scale * height_scale / preview_scale) * dots_per_mm))
        barcode_width = min(inner_width, max(20, round(inner_width * min(1.0, 0.78 * barcode_scale))))
        layers.append({
            "kind": "barcode",
            "layer_id": "barcode",
            "value": barcode_val,
            "height": barcode_height,
            "width": barcode_width,
            "align": "center",
        })

    sku_tracking = max(0, round(_font_size(sku_font) * 0.04))
    brand_tracking = max(0, round(_font_size(brand_font) * 0.05))

    for layer_id in _layer_order(item):
        if layer_id == "brand" and show_brand:
            add_text_layer("brand", brand, brand_font, brand_tracking, 1, brand_bold)
        elif layer_id == "title" and show_title:
            add_text_layer("title", title, title_font, 0, 1, title_bold)
        elif layer_id == "price" and show_price:
            add_text_layer("price", price, price_font, 0, 1, price_bold)
        elif layer_id == "barcode" and show_barcode:
            add_barcode_layer()
        elif layer_id == "sku" and show_sku:
            add_text_layer("sku", sku, sku_font, sku_tracking, 1, sku_bold)

    if not layers:
        add_text_layer("title", sku or title or "LABEL", title_font, 0, 1, title_bold)

    if _has_positioned_layout(item):
        for layer in layers:
            layer_id = str(layer.get("layer_id", ""))
            box_x, box_y, box_width, box_height = _position_box(item, layer_id, width_dots, height_dots)
            if box_width <= 0 or box_height <= 0:
                continue

            if layer.get("kind") == "barcode":
                barcode_width = max(1, box_width)
                barcode_height = max(1, box_height)
                _draw_code128_bitmap(draw, str(layer["value"]), box_x, box_y, barcode_width, barcode_height)
                continue

            font = layer["font"]
            tracking = int(layer.get("tracking") or 0)
            lines = [str(line) for line in (layer.get("lines") or [str(layer.get("value") or "")]) if str(line)]
            if not lines:
                continue
            stretch_x, stretch_y = _layer_stretch(item, layer_id)
            line_height_ratio = _layer_line_height(layer_id)
            stroke_width = _layer_stroke_width(item, layer_id, font)
            line_sizes = [
                text_object_metrics(line, font, tracking, stretch_x, stretch_y, line_height_ratio, stroke_width)
                for line in lines
            ]
            line_gap = int(layer.get("line_gap") or 0)
            total_line_height = sum(size[1] for size in line_sizes) + line_gap * max(0, len(line_sizes) - 1)
            y = box_y + max(0, (box_height - total_line_height) // 2)
            alignment = str(layer.get("align") or "left").casefold()
            for line, (line_width, line_height, _bbox, _raw_width, _raw_line_height, _glyph_height) in zip(lines, line_sizes):
                if alignment == "center":
                    x = box_x + round((box_width - line_width) / 2)
                elif alignment == "right":
                    x = box_x + box_width - line_width
                else:
                    x = box_x
                draw_text_object(int(x), int(y), line, font, tracking, stretch_x, stretch_y, line_height_ratio, stroke_width)
                y += line_height + line_gap

        tspl_bytes = img.tobytes()
        return tspl_bytes, row_bytes
    total_height = sum(int(layer["height"]) for layer in layers) + gap * max(0, len(layers) - 1)
    total_height += sum(_offset(item, str(layer.get("layer_id", "")), dots_per_mm) for layer in layers)
    cursor_y = max(inset, round((height_dots - total_height) / 2))

    for index, layer in enumerate(layers):
        layer_id = str(layer.get("layer_id", ""))
        cursor_y += _offset(item, layer_id, dots_per_mm)
        if layer.get("kind") == "barcode":
            barcode_width = int(layer["width"])
            barcode_height = int(layer["height"])
            x = max(inset, (width_dots - barcode_width) // 2)
            _draw_code128_bitmap(draw, str(layer["value"]), x, cursor_y, barcode_width, barcode_height)
            cursor_y += barcode_height
        else:
            font = layer["font"]
            tracking = int(layer.get("tracking") or 0)
            stroke_width = _layer_stroke_width(item, layer_id, font)
            for line_index, line in enumerate(layer["lines"]):
                bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
                line_width = math.ceil(_text_width(draw, line, font, tracking) + stroke_width * 2)
                x = _text_position(width_dots, inset, line_width, layer.get("align"))
                _draw_tracked_text(draw, x + stroke_width, cursor_y - bbox[1], line, font, tracking, stroke_width)
                cursor_y += max(1, bbox[3] - bbox[1])
                if line_index < len(layer["lines"]) - 1:
                    cursor_y += int(layer.get("line_gap") or 0)
        if index < len(layers) - 1:
            cursor_y += gap

    tspl_bytes = img.tobytes()
    return tspl_bytes, row_bytes

def build_tspl_job(
    labels: Sequence[Mapping[str, object]],
    size: Mapping[str, object],
    printer_dpi: int = 203,
) -> bytes:
    if not isinstance(labels, Sequence) or isinstance(labels, (str, bytes)):
        raise LabelPrintError("The direct print job did not include any labels.")
    if not isinstance(size, Mapping):
        raise LabelPrintError("Choose a label size before printing.")

    width_mm = max(10.0, _size_value(size, "width_mm", "width", default=50.0))
    height_mm = max(10.0, _size_value(size, "height_mm", "height", default=25.0))
    gap_mm = max(0.0, _size_value(size, "gap_mm", "gap", default=2.0))
    dots_per_mm = _normalize_printer_dpi(printer_dpi) / 25.4
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
        bitmap, row_bytes = _label_text_bitmap(item, width_mm, height_mm, dots_per_mm)

        _append_command(payload, "CLS")
        _append_bitmap_command(payload, 0, 0, row_bytes, height_dots, bitmap)
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
