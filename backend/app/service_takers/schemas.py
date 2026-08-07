from datetime import datetime

from pydantic import BaseModel, Field, constr


class ServiceTakerCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=200)
    username: str = Field(min_length=1, max_length=100)
    pin: constr(pattern=r"^\d{4}$") = "0000"
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=100)
    billing_address: str | None = Field(default=None, max_length=2000)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    pick_pack_fee: float = Field(default=0, ge=0)
    additional_item_fee: float = Field(default=0, ge=0)
    label_fee: float = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=4000)


class ServiceTakerUpdate(BaseModel):
    company_name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_name: str | None = Field(default=None, min_length=1, max_length=200)
    username: str | None = Field(default=None, min_length=1, max_length=100)
    pin: constr(pattern=r"^\d{4}$") | None = None
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=100)
    billing_address: str | None = Field(default=None, max_length=2000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    pick_pack_fee: float | None = Field(default=None, ge=0)
    additional_item_fee: float | None = Field(default=None, ge=0)
    label_fee: float | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=4000)
    is_active: bool | None = None


class ServiceTakerProductCreate(BaseModel):
    service_taker_id: int | None = Field(default=None, ge=1)
    sku: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=240)
    barcode: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    unit_weight_kg: float | None = Field(default=None, ge=0)
    length_cm: float | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    storage_location: str | None = Field(default=None, max_length=120)


class ServiceTakerProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=240)
    barcode: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    unit_weight_kg: float | None = Field(default=None, ge=0)
    length_cm: float | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    storage_location: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class ServiceTakerInboundItemCreate(BaseModel):
    product_id: int = Field(ge=1)
    quantity: int = Field(ge=1)


class ServiceTakerInboundCreate(BaseModel):
    service_taker_id: int | None = Field(default=None, ge=1)
    client_reference: str | None = Field(default=None, max_length=160)
    carrier: str | None = Field(default=None, max_length=160)
    tracking_number: str | None = Field(default=None, max_length=200)
    expected_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=4000)
    items: list[ServiceTakerInboundItemCreate] = Field(min_length=1, max_length=200)


class ServiceTakerInboundReceiveItem(BaseModel):
    product_id: int = Field(ge=1)
    quantity: int = Field(ge=0)


class ServiceTakerInboundReceive(BaseModel):
    items: list[ServiceTakerInboundReceiveItem] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=4000)


class ServiceTakerOrderItemCreate(BaseModel):
    product_id: int = Field(ge=1)
    quantity: int = Field(ge=1)


class ServiceTakerOrderCreate(BaseModel):
    service_taker_id: int | None = Field(default=None, ge=1)
    client_reference: str | None = Field(default=None, max_length=160)
    recipient_name: str = Field(min_length=1, max_length=200)
    recipient_company: str | None = Field(default=None, max_length=200)
    recipient_phone: str | None = Field(default=None, max_length=100)
    recipient_email: str | None = Field(default=None, max_length=200)
    address_line_1: str = Field(min_length=1, max_length=300)
    address_line_2: str | None = Field(default=None, max_length=300)
    city: str = Field(min_length=1, max_length=160)
    state: str = Field(min_length=1, max_length=160)
    postal_code: str = Field(min_length=1, max_length=40)
    country: str = Field(default="USA", min_length=2, max_length=100)
    label_source: str = Field(default="Hisbenew", pattern="^(Client|Hisbenew)$")
    notes: str | None = Field(default=None, max_length=4000)
    items: list[ServiceTakerOrderItemCreate] = Field(min_length=1, max_length=200)


class ServiceTakerOrderAdminUpdate(BaseModel):
    status: str | None = Field(
        default=None,
        pattern="^(Submitted|Awaiting label|Processing|Ready|Shipped|Cancelled)$",
    )
    courier: str | None = Field(default=None, max_length=160)
    shipping_service: str | None = Field(default=None, max_length=160)
    tracking_number: str | None = Field(default=None, max_length=200)
    shipping_cost: float | None = Field(default=None, ge=0)
    pick_pack_cost: float | None = Field(default=None, ge=0)
    label_cost: float | None = Field(default=None, ge=0)
    other_cost: float | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=4000)
