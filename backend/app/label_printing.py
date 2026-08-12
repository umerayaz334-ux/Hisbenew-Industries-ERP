from __future__ import annotations

from collections.abc import Mapping, Sequence
import math
from pathlib import Path


TSPL_PRINTER_MARKERS = ("gainscha", "tsc", "xprinter", "gprinter", "hprt")
DEFAULT_THERMAL_DPI = 203
MM_PER_INCH = 25.4
ARIAL_BOLD_PATH = Path(r"C:\Windows\Fonts\arialbd.ttf")
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


def _printer_connection_status(printer_name: str) -> dict:
    win32print = _win32print()
    try:
        handle = win32print.OpenPrinter(printer_name)
    except Exception as exc:
        return {
            "is_connected": False,
            "status": "Unavailable",
            "status_detail": _text(exc) or "Windows could not open this printer.",
            "jobs": 0,
        }

    try:
        info = win32print.GetPrinter(handle, 2)
    except Exception as exc:
        return {
            "is_connected": False,
            "status": "Unavailable",
            "status_detail": _text(exc) or "Windows could not read this printer status.",
            "jobs": 0,
        }
    finally:
        try:
            win32print.ClosePrinter(handle)
        except Exception:
            pass

    status_value = int(info.get("Status") or 0) if isinstance(info, Mapping) else 0
    jobs = int(info.get("cJobs") or 0) if isinstance(info, Mapping) else 0
    blocking_statuses = _status_matches(win32print, status_value, BLOCKING_PRINTER_STATUS_FLAGS)
    active_statuses = _status_matches(win32print, status_value, NON_BLOCKING_PRINTER_STATUS_FLAGS)
    status_labels = blocking_statuses + active_statuses
    return {
        "is_connected": not blocking_statuses,
        "status": ", ".join(status_labels) if status_labels else "Ready",
        "status_detail": "",
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


def _preview_scale(width_mm: float, height_mm: float) -> float:
    return min(5.4, 360 / width_mm, 300 / height_mm)


def _font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.truetype(str(ARIAL_BOLD_PATH), max(7, size))
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


def _draw_tracked_text(draw: object, x: int, y: int, value: str, font: object, tracking: int = 0) -> None:
    if tracking <= 0 or len(value) <= 1:
        draw.text((x, y), value, font=font, fill=0)
        return
    cursor = x
    for char in value:
        draw.text((cursor, y), char, font=font, fill=0)
        cursor += float(draw.textlength(char, font=font)) + tracking


def _text_position(width_dots: int, inset: int, text_width: int, alignment: object) -> int:
    direction = _text(alignment).casefold()
    if direction == "center":
        return max(inset, (width_dots - text_width) // 2)
    if direction == "right":
        return max(inset, width_dots - inset - text_width)
    return inset
def _text_position(width_dots: int, inset: int, text_width: int, alignment: object) -> int:
    direction = _text(alignment).casefold()
    if direction == "center":
        return max(inset, (width_dots - text_width) // 2)
    if direction == "right":
        return max(inset, width_dots - inset - text_width)
    return inset


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
    from PIL import Image, ImageDraw, ImageFont

    width_dots = round(width_mm * dots_per_mm)
    height_dots = round(height_mm * dots_per_mm)
    row_bytes = (width_dots + 7) // 8

    # Canvas: 1 = white paper background, 0 = black text/barcode
    img = Image.new("1", (width_dots, height_dots), 1)
    draw = ImageDraw.Draw(img)

    title = _text(item.get("product_name") or item.get("title") or "PRODUCT LABEL")
    sku = _text(item.get("sku") or item.get("articleNo") or item.get("barcode") or "LABEL-001")
    barcode_val = _text(item.get("barcode") or sku)

    design = item.get("design") if isinstance(item.get("design"), Mapping) else {}
    title_font_pt = _number(design.get("titleFontSize"), 15)
    sku_font_pt = _number(design.get("skuFontSize"), 24)

    try:
        font_title = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", round(title_font_pt * dots_per_mm * 0.45))
        font_sku = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", round(sku_font_pt * dots_per_mm * 0.45))
    except Exception:
        font_title = ImageFont.load_default()
        font_sku = ImageFont.load_default()

    # 1. Title (Centered Top)
    title_bbox = draw.textbbox((0, 0), title, font=font_title)
    title_w = title_bbox[2] - title_bbox[0]
    title_x = max(10, (width_dots - title_w) // 2)
    title_y = round(3.5 * dots_per_mm)
    draw.text((title_x, title_y), title, font=font_title, fill=0)

    # 2. Code 128 Barcode (Centered Middle)
    bits = _encode_code128(barcode_val)
    module_w = max(2, round(width_dots * 0.72 / len(bits)))
    barcode_w = len(bits) * module_w
    bc_x = (width_dots - barcode_w) // 2
    bc_y = round(10.5 * dots_per_mm)
    bc_h = round(8.5 * dots_per_mm)

    for i, bit in enumerate(bits):
        if bit == '1':
            x0 = bc_x + (i * module_w)
            draw.rectangle([x0, bc_y, x0 + module_w - 1, bc_y + bc_h], fill=0)

    # 3. SKU (Centered Bottom, Bold & Large matching Studio Preview)
    sku_bbox = draw.textbbox((0, 0), sku, font=font_sku)
    sku_w = sku_bbox[2] - sku_bbox[0]
    sku_x = max(10, (width_dots - sku_w) // 2)
    sku_y = round(19.5 * dots_per_mm)
    draw.text((sku_x, sku_y), sku, font=font_sku, fill=0)

    # Convert PIL 1=white, 0=black to TSPL Mode 0 (1=black dot, 0=white paper)
    tspl_bytes = bytes(~b & 0xFF for b in img.tobytes())
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

    width_mm = max(10.0, _number(size.get("width_mm"), 50.0))
    height_mm = max(10.0, _number(size.get("height_mm"), 25.0))
    gap_mm = max(0.0, _number(size.get("gap_mm"), 2.0))
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
        text_bitmap, row_bytes = _label_text_bitmap(item, width_mm, height_mm, dots_per_mm)

        _append_command(payload, "CLS")
        payload.extend(f"BITMAP 0,0,{row_bytes},{height_dots},1,".encode("ascii"))
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
