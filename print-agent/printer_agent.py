from __future__ import annotations

import json
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import websocket

from config import AGENT_NAME, ERP_API, PRINTER_NAME

BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.label_printing import LabelPrintError, list_label_printers, print_tspl_labels  # noqa: E402


STATUS_INTERVAL_SECONDS = 15
RECONNECT_SECONDS = 5


def build_websocket_url(api_base: str) -> str:
    base = str(api_base or "").strip().rstrip("/")
    if not base:
        base = "https://api.hisbenew.com"
    parsed = urlparse(base)
    if parsed.scheme in {"ws", "wss"}:
        return f"{base}/ws/print-agent"
    if parsed.scheme == "http":
        return f"ws://{parsed.netloc}{parsed.path.rstrip('/')}/ws/print-agent"
    return f"wss://{parsed.netloc}{parsed.path.rstrip('/')}/ws/print-agent"


def read_printer_status() -> dict:
    try:
        data = list_label_printers()
    except LabelPrintError as exc:
        return {
            "connected": False,
            "printer": None,
            "default_printer": "",
            "printers": [],
            "error": str(exc),
            "hostname": socket.gethostname(),
        }

    printers = data.get("printers") if isinstance(data.get("printers"), list) else []
    selected = next((printer for printer in printers if printer.get("name") == PRINTER_NAME), None)
    if not selected:
        selected = next((printer for printer in printers if printer.get("is_default")), None)
    if not selected and printers:
        selected = printers[0]

    return {
        **data,
        "connected": bool(selected and selected.get("is_connected")),
        "printer": selected.get("name") if selected else None,
        "hostname": socket.gethostname(),
    }


def printer_status() -> dict:
    status = read_printer_status()
    return {
        "connected": status.get("connected", False),
        "printer": status.get("printer"),
    }


def send_json(ws, payload: dict) -> None:
    ws.send(json.dumps(payload))


def send_status(ws) -> None:
    send_json(ws, {"type": "status", "agent": AGENT_NAME, "status": read_printer_status()})


def status_loop(ws) -> None:
    while getattr(ws, "keep_running", False):
        time.sleep(STATUS_INTERVAL_SECONDS)
        try:
            send_status(ws)
        except Exception:
            return


def on_open(ws) -> None:
    status = read_printer_status()
    send_json(
        ws,
        {
            "type": "register",
            "agent": AGENT_NAME,
            "hostname": socket.gethostname(),
            "status": status,
        },
    )
    thread = threading.Thread(target=status_loop, args=(ws,), daemon=True)
    thread.start()


def on_message(ws, message: str) -> None:
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        return

    message_type = data.get("type") or data.get("status")
    if message_type in {"registered", "register"}:
        print(f"Registered with ERP as {data.get('agent') or AGENT_NAME}")
        return

    if message_type == "status_request":
        send_status(ws)
        return

    if message_type != "print_labels":
        return

    job_id = data.get("job_id")
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    try:
        result = print_tspl_labels(
            labels=payload.get("labels") or [],
            size=payload.get("size") or {},
            printer_name=payload.get("printer_name") or PRINTER_NAME,
        )
        send_json(ws, {"type": "print_result", "job_id": job_id, "ok": True, "result": result})
        send_status(ws)
    except Exception as exc:
        send_json(ws, {"type": "print_result", "job_id": job_id, "ok": False, "detail": str(exc)})


def on_error(_ws, error) -> None:
    print(f"Print Agent error: {error}")


def on_close(_ws, _status_code, _message) -> None:
    print("Disconnected from Hisbenew ERP")


def run_agent() -> None:
    websocket_url = build_websocket_url(ERP_API)
    print("Hisbenew Print Agent Started")
    print("---------------------------")
    print(f"Agent: {AGENT_NAME}")
    print(f"Printer: {PRINTER_NAME}")
    print(f"ERP WebSocket: {websocket_url}")

    while True:
        ws = websocket.WebSocketApp(
            websocket_url,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        ws.run_forever(ping_interval=30, ping_timeout=10)
        time.sleep(RECONNECT_SECONDS)


if __name__ == "__main__":
    run_agent()