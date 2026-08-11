from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import PrintAgentRecord, PrintJobRecord

router = APIRouter()

connected_agents: dict[str, dict[str, Any]] = {}
pending_print_jobs: dict[str, asyncio.Future] = {}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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


# ----------------------------------------------------------------------
# Pydantic Schemas for Phase 1 REST APIs
# ----------------------------------------------------------------------

class AgentRegisterPayload(BaseModel):
    agent_id: str = Field(..., description="Unique hardware/agent ID")
    machine_name: str = Field(..., description="Hostname of machine")
    company_name: str | None = None
    location: str | None = None
    printer_name: str | None = None
    printers: list[dict[str, Any]] = []


class AgentHeartbeatPayload(BaseModel):
    agent_id: str
    security_token: str
    status: str = "online"
    printer: str | None = None
    printers: list[dict[str, Any]] = []


class CreatePrintJobPayload(BaseModel):
    order_id: str | None = None
    label_type: str = "product_label"
    printer_name: str | None = None
    agent_id: str | None = None
    payload: dict[str, Any] = {}


class JobStatusUpdatePayload(BaseModel):
    agent_id: str
    security_token: str
    status: str  # printing, completed, failed
    error_message: str | None = None


# ----------------------------------------------------------------------
# WebSocket Interface
# ----------------------------------------------------------------------

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


# ----------------------------------------------------------------------
# REST API Endpoints (Phase 1 Specifications)
# ----------------------------------------------------------------------

@router.post("/api/printer-agents/register")
@router.post("/printer-agents/register")
def register_printer_agent(payload: AgentRegisterPayload, db: Session = Depends(get_db)):
    """Register or update a local print agent and issue a security token."""
    existing = db.query(PrintAgentRecord).filter(PrintAgentRecord.agent_id == payload.agent_id).first()
    
    security_token = existing.security_token if existing else f"pat_{uuid4().hex}"
    
    if existing:
        existing.machine_name = payload.machine_name
        existing.company_name = payload.company_name or existing.company_name
        existing.location = payload.location or existing.location
        existing.printer_name = payload.printer_name or existing.printer_name
        existing.printers_json = json.dumps(payload.printers)
        existing.status = "online"
        existing.last_heartbeat = datetime.utcnow()
        agent_rec = existing
    else:
        agent_rec = PrintAgentRecord(
            agent_id=payload.agent_id,
            machine_name=payload.machine_name,
            security_token=security_token,
            company_name=payload.company_name,
            location=payload.location,
            printer_name=payload.printer_name,
            printers_json=json.dumps(payload.printers),
            status="online",
            last_heartbeat=datetime.utcnow(),
        )
        db.add(agent_rec)
    
    db.commit()
    db.refresh(agent_rec)

    # Cache in memory
    connected_agents[payload.agent_id] = {
        "name": payload.agent_id,
        "hostname": payload.machine_name,
        "security_token": security_token,
        "last_seen": _utc_now(),
        "status": {
            "printers": payload.printers,
            "default_printer": payload.printer_name or "",
        },
    }

    return {
        "status": "registered",
        "agent_id": agent_rec.agent_id,
        "security_token": security_token,
        "machine_name": agent_rec.machine_name,
    }


@router.post("/api/printer-agents/heartbeat")
@router.post("/printer-agents/heartbeat")
def printer_agent_heartbeat(payload: AgentHeartbeatPayload, db: Session = Depends(get_db)):
    """30-second heartbeat from active agent to report online status."""
    agent = db.query(PrintAgentRecord).filter(PrintAgentRecord.agent_id == payload.agent_id).first()
    if not agent or agent.security_token != payload.security_token:
        raise HTTPException(status_code=401, detail="Invalid agent credentials or token.")

    agent.status = payload.status
    agent.last_heartbeat = datetime.utcnow()
    if payload.printer:
        agent.printer_name = payload.printer
    if payload.printers:
        agent.printers_json = json.dumps(payload.printers)
    
    db.commit()

    # Update in-memory status
    if payload.agent_id in connected_agents:
        connected_agents[payload.agent_id]["last_seen"] = _utc_now()
        connected_agents[payload.agent_id]["status"] = {
            "printers": payload.printers,
            "default_printer": payload.printer or "",
        }

    return {"status": "ok", "agent_id": payload.agent_id, "last_heartbeat": agent.last_heartbeat.isoformat()}


@router.get("/api/printer-agents")
@router.get("/printer-agents")
def list_printer_agents(db: Session = Depends(get_db)):
    """List all registered printer agents and their online/offline status."""
    agents = db.query(PrintAgentRecord).order_by(desc(PrintAgentRecord.last_heartbeat)).all()
    now = datetime.utcnow()
    
    result = []
    for agent in agents:
        is_online = agent.last_heartbeat and (now - agent.last_heartbeat).total_seconds() < 90
        result.append({
            "agent_id": agent.agent_id,
            "machine_name": agent.machine_name,
            "company_name": agent.company_name,
            "location": agent.location,
            "printer_name": agent.printer_name,
            "printers": json.loads(agent.printers_json or "[]"),
            "status": "online" if is_online else "offline",
            "last_heartbeat": agent.last_heartbeat.isoformat() if agent.last_heartbeat else None,
        })
    return {"agents": result, "count": len(result)}


@router.post("/api/print-jobs")
@router.post("/print-jobs")
def create_print_job(payload: CreatePrintJobPayload, db: Session = Depends(get_db)):
    """Backend/Frontend enqueues a new print job."""
    job_id = f"job-{uuid4().hex[:12]}"
    job = PrintJobRecord(
        job_id=job_id,
        order_id=payload.order_id,
        label_type=payload.label_type,
        printer_name=payload.printer_name,
        agent_id=payload.agent_id,
        payload_json=json.dumps(payload.payload),
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    return {
        "status": "pending",
        "job_id": job.job_id,
        "order_id": job.order_id,
        "created_at": job.created_at.isoformat(),
    }


@router.get("/api/print-jobs/pending")
@router.get("/print-jobs/pending")
def get_pending_print_jobs(
    agent_id: str = Query(...),
    security_token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Agent fetches pending print jobs assigned to it."""
    agent = db.query(PrintAgentRecord).filter(PrintAgentRecord.agent_id == agent_id).first()
    if not agent or agent.security_token != security_token:
        raise HTTPException(status_code=401, detail="Unauthorized printer agent.")

    jobs = db.query(PrintJobRecord).filter(
        PrintJobRecord.status == "pending",
        (PrintJobRecord.agent_id == agent_id) | (PrintJobRecord.agent_id.is_(None)),
    ).order_by(PrintJobRecord.created_at).limit(10).all()

    items = []
    for job in jobs:
        items.append({
            "job_id": job.job_id,
            "order_id": job.order_id,
            "label_type": job.label_type,
            "printer_name": job.printer_name,
            "payload": json.loads(job.payload_json or "{}"),
            "created_at": job.created_at.isoformat(),
        })

    return {"jobs": items, "count": len(items)}


@router.post("/api/print-jobs/{job_id}/status")
@router.post("/print-jobs/{job_id}/status")
def update_print_job_status(
    job_id: str,
    payload: JobStatusUpdatePayload,
    db: Session = Depends(get_db),
):
    """Agent reports state transition (printing, completed, failed)."""
    agent = db.query(PrintAgentRecord).filter(PrintAgentRecord.agent_id == payload.agent_id).first()
    if not agent or agent.security_token != payload.security_token:
        raise HTTPException(status_code=401, detail="Unauthorized printer agent.")

    job = db.query(PrintJobRecord).filter(PrintJobRecord.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Print job not found.")

    job.status = payload.status
    job.error_message = payload.error_message
    if payload.status == "completed":
        job.printed_at = datetime.utcnow()

    db.commit()
    return {"status": "updated", "job_id": job_id, "current_status": job.status}


@router.get("/api/print-jobs")
@router.get("/print-jobs")
def list_print_jobs(
    limit: int = Query(50, le=200),
    status: str | None = None,
    db: Session = Depends(get_db),
):
    """List print job history for ERP dashboard."""
    query = db.query(PrintJobRecord)
    if status:
        query = query.filter(PrintJobRecord.status == status)
    
    jobs = query.order_by(desc(PrintJobRecord.created_at)).limit(limit).all()
    
    items = []
    for j in jobs:
        items.append({
            "job_id": j.job_id,
            "agent_id": j.agent_id,
            "order_id": j.order_id,
            "label_type": j.label_type,
            "printer_name": j.printer_name,
            "status": j.status,
            "error_message": j.error_message,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "printed_at": j.printed_at.isoformat() if j.printed_at else None,
        })
    return {"jobs": items, "count": len(items)}


# Legacy compatibility endpoints
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
            detail="No local Print Agent is connected.",
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
            detail="No local Print Agent is connected.",
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