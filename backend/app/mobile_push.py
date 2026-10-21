"""FCM wake-ups. Message contents are fetched using the phone's own session."""
import logging
import os
import queue
import threading
import time
from datetime import datetime, timedelta

from fastapi import Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, get_db

log = logging.getLogger(__name__)


class MobilePushDevice(Base):
    __tablename__ = 'mobile_push_devices'
    token = Column(String(512), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    binding = Column(String(128), nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class DevicePayload(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    binding: str = Field(min_length=24, max_length=128)


def install_routes(app, authenticate):
    @app.post('/mobile-push/device')
    def register(payload: DevicePayload, request: Request, db: Session = Depends(get_db)):
        user = authenticate(request, db)
        device = db.get(MobilePushDevice, payload.token)
        if device is None:
            device = MobilePushDevice(token=payload.token)
            db.add(device)
        # A device can belong to one signed-in account at a time.
        device.user_id = user.id
        device.binding = payload.binding
        device.updated_at = datetime.utcnow()
        db.commit()
        return {'enabled': bool(os.getenv('GOOGLE_APPLICATION_CREDENTIALS'))}

    @app.delete('/mobile-push/device')
    def unregister(payload: DevicePayload, request: Request, db: Session = Depends(get_db)):
        user = authenticate(request, db)
        db.query(MobilePushDevice).filter_by(token=payload.token, user_id=user.id, binding=payload.binding).delete()
        db.commit()
        return {'ok': True}


_pending = queue.Queue(maxsize=1000)
_lock = threading.Lock()
_started = False


def wake_phone(user_id: int, kind: str, event_id: int | None = None) -> None:
    """Never delay sending a message or answering a call for Google's network."""
    global _started
    if not os.getenv('GOOGLE_APPLICATION_CREDENTIALS'):
        return
    with _lock:
        if not _started:
            threading.Thread(target=_worker, name='mobile-push', daemon=True).start()
            _started = True
    try:
        _pending.put_nowait((user_id, kind, event_id, datetime.utcnow()))
    except queue.Full:
        log.warning('Mobile push queue full; phone polling remains available')


def _worker():
    while True:
        user_id, kind, event_id, created = _pending.get()
        try:
            for attempt in range(3):
                if datetime.utcnow() - created > timedelta(seconds=40):
                    break
                try:
                    _send(user_id, kind, event_id)
                    break
                except Exception:
                    # Never log tokens, message content or service credentials.
                    log.warning('Mobile push delivery failed (attempt %s)', attempt + 1)
                    time.sleep(2 ** attempt)
        finally:
            _pending.task_done()


def _send(user_id, kind, event_id=None):
    import firebase_admin
    from firebase_admin import messaging
    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = firebase_admin.initialize_app(options={'httpTimeout': 10})
    with SessionLocal() as db:
        devices = db.query(MobilePushDevice).filter_by(user_id=user_id).all()
        for device in devices:
            try:
                messaging.send(messaging.Message(
                    token=device.token,
                    data={
                        'kind': kind,
                        'binding': device.binding,
                        **({'event_id': str(event_id)} if event_id is not None else {}),
                    },
                    android=messaging.AndroidConfig(priority='high', ttl=timedelta(seconds=45 if kind == 'call' else 3600)),
                ), app=app)
            except messaging.UnregisteredError:
                db.delete(device)
        db.commit()
