from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

router = APIRouter()

connected_agents: dict[str, dict[str, Any]] = {}
pending_print_jobs: dict[str, asyncio.Future] = {}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _agent_name(value: object | None) -> str:
    name = str(value or "").strip()
    return name or f"agent-{uuid4().hex[:8]}"


def _agent_status(agent: dict[str, Any]) -> dict[str, Any]:
    status = agent.get("status")
    return status if isinstance(status, dict) else {}


def _public_agent(agent: dict[str, Any]) -> dict[str, Any]:
    status = _agent_status(agent)
    printers = status.get("printers") if isinstance(status.get("printers"), list) else []
    connected_printers = [printer for printer in printers if printer.get("is_connected")]
    return {
        "agent": agent.get("name"),
        "hostname": agent.get("hostname") or status.get("hostname") or "",
        "connected_at": agent.get("connected_at"),
        "last_seen": agent.get("last_seen"),
        "printer_count": len(printers),
        "connected_printer_count": len(connected_printers),
        "default_printer": status.get("default_printer") or "",
    }


def _select_agent(printer_name: object | None = None) -> dict[str, Any] | None:
    requested = str(printer_name or "").strip()
    if requested:
        for agent in connected_agents.values():
            printers = _agent_status(agent).get("printers")
            if isinstance(printers, list) and any(printer.get("name") == requested for printer in printers):
                return agent
    return next(iter(connected_agents.values()), None)


async def _send_agent_json(agent: dict[str, Any], message: dict[str, Any]) -> None:
    lock = agent.get("send_lock")
    websocket = agent.get("websocket")
    if not isinstance(lock, asyncio.Lock) or websocket is None:
        raise HTTPException(status_code=503, detail="The Print Agent connection is no longer available.")
    try:
        async with lock:
            await websocket.send_json(message)
    except Exception as exc:
        name = agent.get("name")
        if name:
            connected_agents.pop(str(name), None)
        raise HTTPException(status_code=503, detail="The Print Agent disconnected before the command was sent.") from exc


@router.websocket("/ws/print-agent")
async def print_agent(websocket: WebSocket):
    await websocket.accept()
    agent_name: str | None = None

    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")

            if message_type == "register":
                agent_name = _agent_name(data.get("agent"))
                connected_agents[agent_name] = {
                    "name": agent_name,
                    "hostname": str(data.get("hostname") or ""),
                    "websocket": websocket,
                    "send_lock": asyncio.Lock(),
                    "connected_at": _utc_now(),
                    "last_seen": _utc_now(),
                    "status": data.get("status") if isinstance(data.get("status"), dict) else {},
                }
                await _send_agent_json(
                    connected_agents[agent_name],
                    {"type": "registered", "status": "registered", "agent": agent_name},
                )
                continue

            if not agent_name or agent_name not in connected_agents:
                await websocket.send_json({"type": "error", "detail": "Register the Print Agent first."})
                continue

            agent = connected_agents[agent_name]
            agent["last_seen"] = _utc_now()

            if message_type == "status":
                status = data.get("status")
                if isinstance(status, dict):
                    agent["status"] = status
                continue

            if message_type == "print_result":
                job_id = str(data.get("job_id") or "")
                future = pending_print_jobs.pop(job_id, None)
                if future and not future.done():
                    future.set_result(data)
                continue

            if message_type == "pong":
                continue

    except WebSocketDisconnect:
        pass
    finally:
        if agent_name:
            current = connected_agents.get(agent_name)
            if current and current.get("websocket") is websocket:
                connected_agents.pop(agent_name, None)
        for job_id, future in list(pending_print_jobs.items()):
            if not future.done():
                future.set_result({"ok": False, "detail": "The Print Agent disconnected before the job finished."})
            pending_print_jobs.pop(job_id, None)


@router.get("/print-agent/status")
async def get_print_agent_status():
    agents = [_public_agent(agent) for agent in connected_agents.values()]
    return {
        "connected": bool(agents),
        "agent_count": len(agents),
        "agents": agents,
    }


@router.get("/print-agent/printers")
async def get_print_agent_printers():
    agent = _select_agent()
    if not agent:
        raise HTTPException(
            status_code=503,
            detail="No local Print Agent is connected. Start printer_agent.py on the laptop with the Gainscha printer.",
        )

    status = _agent_status(agent)
    printers = status.get("printers") if isinstance(status.get("printers"), list) else []
    return {
        "connection_scope": "print_agent",
        "agent": agent.get("name"),
        "agent_count": len(connected_agents),
        "default_printer": status.get("default_printer") or "",
        "default_printer_dpi": status.get("default_printer_dpi"),
        "printers": printers,
    }


@router.post("/print-agent/print")
async def print_labels_via_agent(payload: dict[str, Any]):
    agent = _select_agent(payload.get("printer_name"))
    if not agent:
        raise HTTPException(
            status_code=503,
            detail="No local Print Agent is connected. Start printer_agent.py on the laptop with the Gainscha printer.",
        )

    job_id = f"print-{uuid4().hex}"
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_print_jobs[job_id] = future

    await _send_agent_json(
        agent,
        {
            "type": "print_labels",
            "job_id": job_id,
            "payload": payload,
        },
    )

    try:
        response = await asyncio.wait_for(future, timeout=45)
    except asyncio.TimeoutError as exc:
        pending_print_jobs.pop(job_id, None)
        raise HTTPException(status_code=504, detail="The Print Agent did not finish the label job in time.") from exc

    if not response.get("ok"):
        raise HTTPException(status_code=400, detail=response.get("detail") or "The Print Agent could not print the labels.")

    result = response.get("result") if isinstance(response.get("result"), dict) else {}
    return {
        **result,
        "agent": agent.get("name"),
        "connection_scope": "print_agent",
    }