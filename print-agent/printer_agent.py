from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
import websocket

from config import AGENT_NAME, ERP_API, PRINTER_NAME

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "agent_config.json"
BACKEND_DIR = (BASE_DIR.parent / "backend").resolve()

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

try:
    from app.label_printing import LabelPrintError, list_label_printers, print_tspl_labels
except Exception as err:
    print(f"Warning: app.label_printing import fallback: {err}")
    # Standalone print agent fallback if backend module is not in path
    def list_label_printers():
        import win32print
        printers = []
        try:
            default_p = win32print.GetDefaultPrinter()
        except Exception:
            default_p = ""
        for p in win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS):
            p_name = p[2]
            printers.append({
                "name": p_name,
                "is_default": (p_name == default_p),
                "supports_direct_labels": True,
                "is_connected": True,
                "status": "Ready",
                "status_detail": "",
                "jobs": 0,
            })
        return {"printers": printers, "default_printer": default_p, "default_printer_dpi": 300}

    def print_tspl_labels(labels, size=None, printer_name=None):
        import win32print
        printer = printer_name or win32print.GetDefaultPrinter()
        h = win32print.OpenPrinter(printer)
        try:
            job_id = win32print.StartDocPrinter(h, 1, ("Hisbenew ERP Label Job", None, "RAW"))
            win32print.StartPagePrinter(h)
            
            # Simple TSPL generator fallback
            width = size.get("width_mm", 100) if isinstance(size, dict) else 100
            height = size.get("height_mm", 75) if isinstance(size, dict) else 75
            tspl_cmds = [f"SIZE {width} mm, {height} mm\r\nGAP 2 mm, 0 mm\r\nCLS\r\n"]
            for label in labels:
                title = label.get("title") or label.get("name") or "Product"
                sku = label.get("sku") or ""
                price = label.get("price") or ""
                tspl_cmds.append(f'TEXT 50,30,"3",0,1,1,"{title}"\r\n')
                if sku:
                    tspl_cmds.append(f'BARCODE 50,80,"128",60,1,0,2,2,"{sku}"\r\n')
                if price:
                    tspl_cmds.append(f'TEXT 50,160,"3",0,1,1,"Price: {price}"\r\n')
                tspl_cmds.append("PRINT 1,1\r\n")
            
            raw_bytes = "".join(tspl_cmds).encode("utf-8")
            written = win32print.WritePrinter(h, raw_bytes)
            win32print.EndPagePrinter(h)
            win32print.EndDocPrinter(h)
            return {"job_id": job_id, "bytes_sent": written, "printer": printer}
        finally:
            win32print.ClosePrinter(h)

STATUS_INTERVAL_SECONDS = 30
POLL_INTERVAL_SECONDS = 5
RECONNECT_SECONDS = 5


def load_local_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    
    agent_id = f"agent-{socket.gethostname().lower()}-{os.getlogin().lower() if hasattr(os, 'getlogin') else 'user'}"
    data = {
        "agent_id": agent_id,
        "machine_name": socket.gethostname(),
        "security_token": "",
    }
    save_local_config(data)
    return data


def save_local_config(data: dict) -> None:
    try:
        CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"Warning: could not save local config: {exc}")


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
    except Exception as exc:
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


def register_rest(local_cfg: dict) -> str:
    """Register agent via REST API and obtain/persist security token."""
    url = f"{ERP_API.rstrip('/')}/api/printer-agents/register"
    status_info = read_printer_status()
    payload = {
        "agent_id": local_cfg["agent_id"],
        "machine_name": local_cfg["machine_name"],
        "company_name": "Hisbenew",
        "location": "Warehouse",
        "printer_name": status_info.get("printer") or PRINTER_NAME,
        "printers": status_info.get("printers") or [],
    }
    
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            res = resp.json()
            token = res.get("security_token") or ""
            if token and token != local_cfg.get("security_token"):
                local_cfg["security_token"] = token
                save_local_config(local_cfg)
            print(f"Registered agent with REST API: agent_id={local_cfg['agent_id']}")
            return token
    except Exception as exc:
        print(f"REST Registration attempt warning: {exc}")
    
    return local_cfg.get("security_token") or ""


def heartbeat_loop(local_cfg: dict) -> None:
    """Background 30-second heartbeat thread."""
    url = f"{ERP_API.rstrip('/')}/api/printer-agents/heartbeat"
    while True:
        try:
            status_info = read_printer_status()
            token = local_cfg.get("security_token")
            if token:
                payload = {
                    "agent_id": local_cfg["agent_id"],
                    "security_token": token,
                    "status": "online" if status_info.get("connected") else "idle",
                    "printer": status_info.get("printer") or PRINTER_NAME,
                    "printers": status_info.get("printers") or [],
                }
                requests.post(url, json=payload, timeout=8)
        except Exception as exc:
            pass
        time.sleep(STATUS_INTERVAL_SECONDS)


def rest_queue_polling_loop(local_cfg: dict) -> None:
    """Background REST polling fallback for print jobs."""
    url_pending = f"{ERP_API.rstrip('/')}/api/print-jobs/pending"
    while True:
        token = local_cfg.get("security_token")
        if token:
            try:
                params = {
                    "agent_id": local_cfg["agent_id"],
                    "security_token": token,
                }
                resp = requests.get(url_pending, params=params, timeout=10)
                if resp.status_code == 200:
                    jobs = resp.json().get("jobs") or []
                    for job in jobs:
                        _execute_print_job_rest(job, local_cfg)
            except Exception as exc:
                pass
        time.sleep(POLL_INTERVAL_SECONDS)


def _execute_print_job_rest(job: dict, local_cfg: dict) -> None:
    job_id = job.get("job_id")
    payload = job.get("payload") or {}
    url_status = f"{ERP_API.rstrip('/')}/api/print-jobs/{job_id}/status"
    token = local_cfg.get("security_token")

    # Update status to printing
    try:
        requests.post(url_status, json={
            "agent_id": local_cfg["agent_id"],
            "security_token": token,
            "status": "printing",
        }, timeout=5)
    except Exception:
        pass

    try:
        result = print_tspl_labels(
            labels=payload.get("labels") or [],
            size=payload.get("size") or {},
            printer_name=payload.get("printer_name") or job.get("printer_name") or PRINTER_NAME,
        )
        print(f"REST Print Job #{job_id} Success: {result}")
        requests.post(url_status, json={
            "agent_id": local_cfg["agent_id"],
            "security_token": token,
            "status": "completed",
        }, timeout=5)
    except Exception as exc:
        print(f"REST Print Job #{job_id} Failed: {exc}")
        requests.post(url_status, json={
            "agent_id": local_cfg["agent_id"],
            "security_token": token,
            "status": "failed",
            "error_message": str(exc),
        }, timeout=5)


# ----------------------------------------------------------------------
# WebSocket Handlers
# ----------------------------------------------------------------------

def send_json(ws, payload: dict) -> None:
    ws.send(json.dumps(payload))


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


def on_message(ws, message: str) -> None:
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        return

    message_type = data.get("type") or data.get("status")
    if message_type in {"registered", "register"}:
        print(f"WebSocket Registered with ERP as {data.get('agent') or AGENT_NAME}")
        return

    if message_type == "status_request":
        send_json(ws, {"type": "status", "agent": AGENT_NAME, "status": read_printer_status()})
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
    except Exception as exc:
        send_json(ws, {"type": "print_result", "job_id": job_id, "ok": False, "detail": str(exc)})


def on_error(_ws, error) -> None:
    pass


def on_close(_ws, _status_code, _message) -> None:
    pass


def run_agent() -> None:
    local_cfg = load_local_config()
    print("=========================================")
    print(" Hisbenew ERP Thermal Label Print Agent  ")
    print("=========================================")
    print(f" Machine Name : {local_cfg['machine_name']}")
    print(f" Agent ID     : {local_cfg['agent_id']}")
    print(f" Default Printer: {PRINTER_NAME}")
    print(f" ERP Endpoint : {ERP_API}")
    print("-----------------------------------------")

    # Initial REST registration
    register_rest(local_cfg)

    # Start background heartbeat daemon
    t_heartbeat = threading.Thread(target=heartbeat_loop, args=(local_cfg,), daemon=True)
    t_heartbeat.start()

    # Start background REST queue polling daemon
    t_poll = threading.Thread(target=rest_queue_polling_loop, args=(local_cfg,), daemon=True)
    t_poll.start()

    # WebSocket connection loop
    websocket_url = build_websocket_url(ERP_API)
    while True:
        try:
            ws = websocket.WebSocketApp(
                websocket_url,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
            )
            ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception:
            pass
        time.sleep(RECONNECT_SECONDS)


if __name__ == "__main__":
    run_agent()