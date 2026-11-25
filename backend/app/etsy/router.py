import io
import json
import math
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from ..config import APP_DATA_DIR
from ..service_takers.router import authenticated_user, get_db, portal_service_taker, service_taker_service_access
from .models import EtsyAsset, EtsyDraft

router = APIRouter(prefix="/service-takers/portal/etsy", tags=["Etsy listing workspace"])
CATALOG = json.loads(Path(__file__).with_name("fields.json").read_text(encoding="utf-8"))
OPERATIONS = CATALOG["operations"]
SCHEMAS = {name: deepcopy(op["schema"]) for name, op in OPERATIONS.items()}
for name, path_fields in {
    "updateListingProperty": {"property_id": {"type": "integer", "minimum": 1}},
    "updateListingTranslation": {"language": {"type": "string"}},
    "uploadListingImage": {"asset_id": {"type": "integer", "minimum": 1}},
    "uploadListingVideo": {"asset_id": {"type": "integer", "minimum": 1}},
    "uploadListingFile": {"asset_id": {"type": "integer", "minimum": 1}},
}.items():
    item = SCHEMAS[name]
    item["properties"] = {k: v for k, v in item["properties"].items() if v.get("format") != "binary"}
    item["properties"].update(path_fields)
    item["required"] = list(set(item.get("required", [])) | set(path_fields))
    SCHEMAS[name] = {"type": "object", "properties": {"entries": {"type": "array", "items": item}}}
SCHEMAS["manualListing"] = {"type": "object", "properties": {
    key: {"type": "string"} for key in (
        "category", "attributes", "currency", "shipping_instructions", "processing_instructions",
        "return_instructions", "production_partner_details", "variation_instructions", "listing_notes")}}
CATALOG["draft_schemas"] = SCHEMAS
PRIVATE_DIR = APP_DATA_DIR / "etsy_listing_assets"
EDITABLE = {"Draft", "Changes requested"}


def actor(request, db):
    user = authenticated_user(request, db)
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None or user.tenant_id != tenant_id:
        raise HTTPException(403, "Select your company workspace.")
    admin = user.role in {"admin", "super_admin"}
    if not admin:
        portal_service_taker(request, db)
        if not service_taker_service_access(user)["etsy_listing_enabled"]:
            raise HTTPException(403, "Your Etsy listing access is turned off. Contact your administrator.")
    return user, admin, tenant_id


def draft_for(draft_id, request, db):
    user, admin, tenant_id = actor(request, db)
    row = db.query(EtsyDraft).filter_by(id=draft_id, tenant_id=tenant_id).one_or_none()
    if not row or (not admin and row.owner_id != user.id):
        raise HTTPException(404, "Listing draft not found.")
    return row, user, admin


def commit(db):
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, "This draft changed in another session. Reload before saving.")


def record(row, user, action):
    row.updated_at = datetime.utcnow()
    history = json.loads(row.history)
    history.append({"at": row.updated_at.isoformat(), "actor": user.name, "action": action, "revision": row.revision})
    row.history = json.dumps(history)


def check_value(value, schema, path, errors, required=False):
    if value is None or value == "":
        if required:
            errors.append(f"{path}: required")
        return
    kind = schema.get("type")
    valid = {"object": isinstance(value, dict), "array": isinstance(value, list),
             "string": isinstance(value, str), "boolean": isinstance(value, bool),
             "integer": isinstance(value, int) and not isinstance(value, bool),
             "number": isinstance(value, (int, float)) and not isinstance(value, bool)}.get(kind, False)
    if not valid:
        errors.append(f"{path}: invalid {kind}")
        return
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: select a supported option")
    if kind in {"integer", "number"}:
        if not math.isfinite(value) or value < schema.get("minimum", -1e100) or value > schema.get("maximum", 1e100):
            errors.append(f"{path}: number outside allowed range")
    if kind == "string" and len(value) > 102400:
        errors.append(f"{path}: text is too long")
    if kind == "object":
        properties = schema.get("properties", {})
        for key in value.keys() - properties.keys():
            errors.append(f"{path}.{key}: unknown field")
        for key, child in properties.items():
            check_value(value.get(key), child, f"{path}.{key}", errors, required and key in schema.get("required", []))
    if kind == "array":
        if len(value) > 1000:
            errors.append(f"{path}: too many entries")
            return
        for i, child in enumerate(value):
            check_value(child, schema["items"], f"{path}[{i + 1}]", errors, required)


def validate_data(data, complete=False):
    errors = []
    if len(json.dumps(data)) > 2 * 1024 * 1024:
        return ["Listing content exceeds 2 MB."]
    if set(data) - set(SCHEMAS):
        errors.append("Unknown listing section")
    for name, values in data.items():
        if name in SCHEMAS:
            check_value(values, SCHEMAS[name], name, errors, False)
    if errors:
        return list(dict.fromkeys(errors))
    listing = data.get("createDraftListing", {})
    if listing is None:
        listing = {}
    if complete:
        for key in ("title", "description"):
            if not str(listing.get(key) or "").strip():
                errors.append(f"{key}: required for review")
        for key in ("quantity", "price"):
            if not isinstance(listing.get(key), (int, float)) or listing[key] <= 0:
                errors.append(f"{key}: must be greater than zero")
    if len(listing.get("title") or "") > 140:
        errors.append("Title: maximum 140 characters")
    tags = listing.get("tags") or []
    if len(tags) > 13 or any(len(tag) > 20 for tag in tags):
        errors.append("Tags: up to 13 tags, 20 characters each")
    if "state" in (data.get("updateListing") or {}):
        errors.append("Publishing state is controlled by the administrator workflow")
    return list(dict.fromkeys(errors))


def response(row, db):
    return {"id": row.id, "title": row.title, "owner_id": row.owner_id, "status": row.status,
            "revision": row.revision, "data": json.loads(row.data), "review_note": row.review_note,
            "history": json.loads(row.history), "updated_at": row.updated_at,
            "issues": validate_data(json.loads(row.data), True),
            "assets": [{"id": a.id, "kind": a.kind, "filename": a.filename, "size": a.size}
                       for a in db.query(EtsyAsset).filter_by(tenant_id=row.tenant_id, draft_id=row.id).order_by(EtsyAsset.id)]}


class SaveDraft(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int | None = None
    data: dict = Field(default_factory=dict)


class Transition(BaseModel):
    model_config = {"extra": "forbid"}
    revision: int
    action: str = Field(pattern="^(submit|return|approve|reopen|publish)$")
    note: str = Field(default="", max_length=4000)


@router.get("/workspace")
def workspace(request: Request, db: Session = Depends(get_db)):
    user, admin, tenant_id = actor(request, db)
    query = db.query(EtsyDraft).filter_by(tenant_id=tenant_id)
    if not admin:
        query = query.filter_by(owner_id=user.id)
    return {"is_admin": admin, "catalog": CATALOG, "connection": {"connected": False,
            "message": "Manual listing is ready. An Etsy API connection is optional."},
            "drafts": [response(row, db) for row in query.order_by(EtsyDraft.updated_at.desc()).limit(200)]}


@router.post("/drafts", status_code=201)
def create_draft(payload: SaveDraft, request: Request, db: Session = Depends(get_db)):
    user, _, tenant_id = actor(request, db)
    errors = validate_data(payload.data)
    if errors:
        raise HTTPException(422, errors)
    row = EtsyDraft(tenant_id=tenant_id, owner_id=user.id, data=json.dumps(payload.data), history="[]")
    row.title = (payload.data.get("createDraftListing") or {}).get("title") or "Untitled listing"
    record(row, user, "Created draft")
    db.add(row)
    commit(db)
    return response(row, db)


@router.put("/drafts/{draft_id}")
def save_draft(draft_id: int, payload: SaveDraft, request: Request, db: Session = Depends(get_db)):
    row, user, _ = draft_for(draft_id, request, db)
    if row.status not in EDITABLE or payload.revision != row.revision:
        raise HTTPException(409, "Reload this draft, or reopen it before editing.")
    errors = validate_data(payload.data)
    if errors:
        raise HTTPException(422, errors)
    row.data = json.dumps(payload.data)
    row.title = (payload.data.get("createDraftListing") or {}).get("title") or "Untitled listing"
    record(row, user, "Saved draft")
    commit(db)
    return response(row, db)


@router.post("/drafts/{draft_id}/transition")
def transition(draft_id: int, payload: Transition, request: Request, db: Session = Depends(get_db)):
    row, user, admin = draft_for(draft_id, request, db)
    if payload.revision != row.revision:
        raise HTTPException(409, "This draft changed. Reload before continuing.")
    if payload.action != "submit" and not admin:
        raise HTTPException(403, "Only administrators can review or publish listings.")
    allowed = {"submit": (EDITABLE, "In review"), "return": ({"In review", "Approved"}, "Changes requested"),
               "approve": ({"In review"}, "Approved"), "reopen": ({"Approved", "In review"}, "Draft")}
    if payload.action == "publish":
        raise HTTPException(503, "Etsy is not connected. Configure and verify the UK publishing service first. Nothing was posted.")
    previous, following = allowed[payload.action]
    if row.status not in previous:
        raise HTTPException(409, "This action is not available in the current status.")
    if payload.action == "return" and not payload.note.strip():
        raise HTTPException(422, "Add a note explaining the requested changes.")
    if payload.action == "approve":
        errors = validate_data(json.loads(row.data), True)
        if errors:
            raise HTTPException(422, errors)
    row.status = following
    row.review_note = payload.note.strip()
    record(row, user, following + (f": {row.review_note}" if row.review_note else ""))
    commit(db)
    return response(row, db)


@router.post("/drafts/{draft_id}/assets", status_code=201)
def upload_asset(draft_id: int, request: Request, kind: str = Form(...), revision: int = Form(...),
                 file: UploadFile = File(...), db: Session = Depends(get_db)):
    row, user, _ = draft_for(draft_id, request, db)
    if row.status not in EDITABLE or row.revision != revision:
        raise HTTPException(409, "Reload or reopen the draft before adding files.")
    limits = {"image": (20, 20 * 1024 * 1024, {".jpg", ".jpeg", ".png", ".webp"}),
              "video": (1, 100 * 1024 * 1024, {".mp4", ".mov"}),
              "digital": (5, 20 * 1024 * 1024, {".pdf", ".zip", ".png", ".jpg", ".jpeg", ".txt", ".svg", ".stl", ".epub", ".mp3"})}
    if kind not in limits:
        raise HTTPException(422, "Choose an image, video or digital file.")
    count, max_bytes, extensions = limits[kind]
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in extensions:
        raise HTTPException(422, "This file format is not supported in the workspace.")
    if db.query(EtsyAsset).filter_by(tenant_id=row.tenant_id, draft_id=row.id, kind=kind).count() >= count:
        raise HTTPException(422, f"Maximum {count} {kind} files.")
    content = file.file.read(max_bytes + 1)
    if not content or len(content) > max_bytes:
        raise HTTPException(422, "File is empty or exceeds the upload size limit.")
    if kind == "image":
        try:
            with Image.open(io.BytesIO(content)) as image:
                image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise HTTPException(422, "Upload a valid product image.")
    key = uuid.uuid4().hex + suffix
    PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    target = PRIVATE_DIR / key
    target.write_bytes(content)
    asset = EtsyAsset(tenant_id=row.tenant_id, draft_id=row.id, kind=kind, filename=Path(file.filename.replace('\\', '/')).name[:240], storage_key=key, size=len(content))
    db.add(asset)
    db.flush()
    operation = {"image": "uploadListingImage", "video": "uploadListingVideo", "digital": "uploadListingFile"}[kind]
    data = json.loads(row.data)
    entries = data.setdefault(operation, {}).setdefault("entries", [])
    metadata = {"asset_id": asset.id}
    if kind == "image":
        metadata.update(rank=len(entries) + 1, alt_text="")
    else:
        metadata["name"] = asset.filename
    entries.append(metadata)
    row.data = json.dumps(data)
    record(row, user, f"Uploaded {kind}")
    try:
        commit(db)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return response(row, db)


@router.get("/drafts/{draft_id}/assets/{asset_id}")
def download_asset(draft_id: int, asset_id: int, request: Request, db: Session = Depends(get_db)):
    row, _, _ = draft_for(draft_id, request, db)
    asset = db.query(EtsyAsset).filter_by(id=asset_id, tenant_id=row.tenant_id, draft_id=row.id).one_or_none()
    if not asset or not (PRIVATE_DIR / asset.storage_key).is_file():
        raise HTTPException(404, "File not found.")
    return FileResponse(PRIVATE_DIR / asset.storage_key, filename=asset.filename, media_type="application/octet-stream", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/drafts/{draft_id}/assets/{asset_id}")
def delete_asset(draft_id: int, asset_id: int, revision: int, request: Request, db: Session = Depends(get_db)):
    row, user, _ = draft_for(draft_id, request, db)
    if row.status not in EDITABLE or row.revision != revision:
        raise HTTPException(409, "Reload or reopen the draft before removing files.")
    asset = db.query(EtsyAsset).filter_by(id=asset_id, tenant_id=row.tenant_id, draft_id=row.id).one_or_none()
    if not asset:
        raise HTTPException(404, "File not found.")
    target = PRIVATE_DIR / asset.storage_key
    data = json.loads(row.data)
    for name in ("uploadListingImage", "uploadListingVideo", "uploadListingFile"):
        if name in data:
            data[name]["entries"] = [entry for entry in data[name].get("entries", []) if entry.get("asset_id") != asset.id]
    row.data = json.dumps(data)
    db.delete(asset)
    record(row, user, "Removed attachment")
    commit(db)
    target.unlink(missing_ok=True)
    return response(row, db)
