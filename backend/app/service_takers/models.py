from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from ..database import Base


class ServiceTaker(Base):
    __tablename__ = "service_takers"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    company_name = Column(String, nullable=False, index=True)
    contact_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    billing_address = Column(Text, nullable=True)
    currency = Column(String, nullable=False, default="USD")
    pick_pack_fee = Column(Float, nullable=False, default=0)
    additional_item_fee = Column(Float, nullable=False, default=0)
    label_fee = Column(Float, nullable=False, default=0)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    products = relationship(
        "ServiceTakerProduct",
        back_populates="service_taker",
        cascade="all, delete-orphan",
    )
    inbounds = relationship(
        "ServiceTakerInbound",
        back_populates="service_taker",
        cascade="all, delete-orphan",
    )
    orders = relationship(
        "ServiceTakerOrder",
        back_populates="service_taker",
        cascade="all, delete-orphan",
    )


class ServiceTakerProduct(Base):
    __tablename__ = "service_taker_products"
    __table_args__ = (
        UniqueConstraint(
            "service_taker_id",
            "sku",
            name="uq_service_taker_product_sku",
        ),
        Index(
            "ix_service_taker_product_stock",
            "service_taker_id",
            "quantity_on_hand",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    service_taker_id = Column(
        Integer,
        ForeignKey("service_takers.id"),
        nullable=False,
        index=True,
    )
    sku = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    barcode = Column(String, nullable=True, index=True)
    description = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    unit_weight_kg = Column(Float, nullable=False, default=0)
    length_cm = Column(Float, nullable=True)
    width_cm = Column(Float, nullable=True)
    height_cm = Column(Float, nullable=True)
    storage_location = Column(String, nullable=True, index=True)
    quantity_on_hand = Column(Integer, nullable=False, default=0)
    reserved_quantity = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    service_taker = relationship("ServiceTaker", back_populates="products")
    inventory_transactions = relationship(
        "ServiceTakerInventoryTransaction",
        back_populates="product",
        cascade="all, delete-orphan",
    )


class ServiceTakerInbound(Base):
    __tablename__ = "service_taker_inbounds"
    __table_args__ = (
        Index(
            "ix_service_taker_inbound_status",
            "service_taker_id",
            "status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    service_taker_id = Column(
        Integer,
        ForeignKey("service_takers.id"),
        nullable=False,
        index=True,
    )
    inbound_no = Column(String, nullable=False, unique=True, index=True)
    client_reference = Column(String, nullable=True, index=True)
    status = Column(String, nullable=False, default="Submitted", index=True)
    carrier = Column(String, nullable=True)
    tracking_number = Column(String, nullable=True, index=True)
    expected_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    service_taker = relationship("ServiceTaker", back_populates="inbounds")
    items = relationship(
        "ServiceTakerInboundItem",
        back_populates="inbound",
        cascade="all, delete-orphan",
        order_by="ServiceTakerInboundItem.id",
    )


class ServiceTakerInboundItem(Base):
    __tablename__ = "service_taker_inbound_items"
    __table_args__ = (
        UniqueConstraint(
            "inbound_id",
            "product_id",
            name="uq_service_taker_inbound_product",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    inbound_id = Column(
        Integer,
        ForeignKey("service_taker_inbounds.id"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        Integer,
        ForeignKey("service_taker_products.id"),
        nullable=False,
        index=True,
    )
    expected_quantity = Column(Integer, nullable=False)
    received_quantity = Column(Integer, nullable=False, default=0)

    inbound = relationship("ServiceTakerInbound", back_populates="items")
    product = relationship("ServiceTakerProduct")


class ServiceTakerOrder(Base):
    __tablename__ = "service_taker_orders"
    __table_args__ = (
        Index(
            "ix_service_taker_order_status",
            "service_taker_id",
            "status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    service_taker_id = Column(
        Integer,
        ForeignKey("service_takers.id"),
        nullable=False,
        index=True,
    )
    request_no = Column(String, nullable=False, unique=True, index=True)
    client_reference = Column(String, nullable=True, index=True)
    status = Column(String, nullable=False, default="Submitted", index=True)
    recipient_name = Column(String, nullable=False)
    recipient_company = Column(String, nullable=True)
    recipient_phone = Column(String, nullable=True)
    recipient_email = Column(String, nullable=True)
    address_line_1 = Column(String, nullable=False)
    address_line_2 = Column(String, nullable=True)
    city = Column(String, nullable=False)
    state = Column(String, nullable=False)
    postal_code = Column(String, nullable=False)
    country = Column(String, nullable=False, default="USA")
    label_source = Column(String, nullable=False, default="Hisbenew")
    label_url = Column(Text, nullable=True)
    label_name = Column(String, nullable=True)
    courier = Column(String, nullable=True)
    shipping_service = Column(String, nullable=True)
    tracking_number = Column(String, nullable=True, index=True)
    shipping_cost = Column(Float, nullable=False, default=0)
    pick_pack_cost = Column(Float, nullable=False, default=0)
    label_cost = Column(Float, nullable=False, default=0)
    other_cost = Column(Float, nullable=False, default=0)
    total_cost = Column(Float, nullable=False, default=0)
    notes = Column(Text, nullable=True)
    submitted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    shipped_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    service_taker = relationship("ServiceTaker", back_populates="orders")
    items = relationship(
        "ServiceTakerOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="ServiceTakerOrderItem.id",
    )


class ServiceTakerOrderItem(Base):
    __tablename__ = "service_taker_order_items"
    __table_args__ = (
        UniqueConstraint(
            "order_id",
            "product_id",
            name="uq_service_taker_order_product",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    order_id = Column(
        Integer,
        ForeignKey("service_taker_orders.id"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        Integer,
        ForeignKey("service_taker_products.id"),
        nullable=False,
        index=True,
    )
    quantity = Column(Integer, nullable=False)

    order = relationship("ServiceTakerOrder", back_populates="items")
    product = relationship("ServiceTakerProduct")


class ServiceTakerInventoryTransaction(Base):
    __tablename__ = "service_taker_inventory_transactions"
    __table_args__ = (
        Index(
            "ix_service_taker_inventory_ledger",
            "service_taker_id",
            "product_id",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    service_taker_id = Column(
        Integer,
        ForeignKey("service_takers.id"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        Integer,
        ForeignKey("service_taker_products.id"),
        nullable=False,
        index=True,
    )
    movement_type = Column(String, nullable=False)
    quantity_change = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    reference_type = Column(String, nullable=True)
    reference_id = Column(Integer, nullable=True)
    reference_no = Column(String, nullable=True, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    product = relationship(
        "ServiceTakerProduct",
        back_populates="inventory_transactions",
    )
