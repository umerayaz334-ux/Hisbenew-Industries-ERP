"""EasyPost label buying endpoints for the Dispatch queue."""

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from ..services.shipping import easypost as service

router = APIRouter(prefix="/shipping/easypost", tags=["easypost"])


def easypost_db(request: Request):
    from ..main import get_db

    yield from get_db(request)


@router.get("/settings")
def get_settings(request: Request, db: Session = Depends(easypost_db)):
    return service.public_settings(request, db)


@router.put("/settings")
def put_settings(request: Request, payload: dict = Body(...), db: Session = Depends(easypost_db)):
    return service.save_settings(request, db, payload)


@router.post("/test-connection")
def test_connection(request: Request, db: Session = Depends(easypost_db)):
    return service.test_connection(request, db)


@router.post("/verify-address")
def verify_address(request: Request, payload: dict = Body(...), db: Session = Depends(easypost_db)):
    return service.verify_address(request, db, payload.get("address") or payload)


@router.get("/summary")
def label_summary(request: Request, db: Session = Depends(easypost_db)):
    return service.summary(request, db)


@router.get("/orders/{order_id}/labels")
def order_labels(order_id: int, request: Request, db: Session = Depends(easypost_db)):
    return service.order_labels(request, db, order_id)


@router.post("/orders/{order_id}/rates")
def order_rates(order_id: int, request: Request, payload: dict = Body(...), db: Session = Depends(easypost_db)):
    return service.quote(request, db, order_id, payload)


@router.post("/orders/{order_id}/buy")
def order_buy(order_id: int, request: Request, payload: dict = Body(...), db: Session = Depends(easypost_db)):
    return service.buy(request, db, order_id, payload)


@router.post("/labels/{label_id}/refund")
def label_refund(label_id: int, request: Request, db: Session = Depends(easypost_db)):
    return service.refund(request, db, label_id)
