from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from ..services import order_forwarding as service

router = APIRouter(prefix="/order-forwarding", tags=["order-forwarding"])


def forwarding_db(request: Request):
    from ..main import get_db
    yield from get_db(request)


class ConnectWorker(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=16, max_length=100)


class ForwardOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: int = Field(gt=0)
    task_type: Literal["Preparation", "Shipping"] = "Preparation"
    notes: str | None = Field(default=None, max_length=4000)
    due_at: datetime | None = None
    labor_cost: float = Field(default=0, ge=0, allow_inf_nan=False)


class ForwardingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_connection_id: int | None = Field(default=None, gt=0)


@router.get("/settings")
def get_settings(request: Request, db: Session = Depends(forwarding_db)):
    return service.preferences(request, db)


@router.put("/settings")
def save_settings(payload: ForwardingSettings, request: Request, db: Session = Depends(forwarding_db)):
    return service.preferences(request, db, payload.default_connection_id, save=True)


@router.post("/workers/{worker_id}/code")
def issue_code(worker_id: int, request: Request, db: Session = Depends(forwarding_db)):
    return service.issue_invite(request, db, worker_id)


@router.post("/connections")
def connect_worker(payload: ConnectWorker, request: Request, db: Session = Depends(forwarding_db)):
    return service.connect(request, db, payload.code)


@router.get("/connections")
def list_connections(request: Request, db: Session = Depends(forwarding_db)):
    return service.connections(request, db)


@router.delete("/connections/{connection_id}")
def revoke_connection(connection_id: int, request: Request, db: Session = Depends(forwarding_db)):
    return service.revoke(request, db, connection_id)


@router.post("/orders/{order_id}")
def forward_order(order_id: int, payload: ForwardOrder, request: Request, db: Session = Depends(forwarding_db)):
    return service.forward(request, db, order_id, payload)
