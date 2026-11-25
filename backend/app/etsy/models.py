from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from ..database import Base


class EtsyDraft(Base):
    __tablename__ = "etsy_listing_drafts"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(240), nullable=False, default="Untitled listing")
    status = Column(String(40), nullable=False, default="Draft")
    revision = Column(Integer, nullable=False, default=1)
    data = Column(Text, nullable=False, default="{}")
    review_note = Column(Text, nullable=False, default="")
    history = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    __mapper_args__ = {"version_id_col": revision}


class EtsyAsset(Base):
    __tablename__ = "etsy_listing_assets"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    draft_id = Column(Integer, ForeignKey("etsy_listing_drafts.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)
    filename = Column(String(240), nullable=False)
    storage_key = Column(String(80), nullable=False, unique=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
