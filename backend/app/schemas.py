from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import Optional


class BaseModelUTC(BaseModel):
    model_config = {
        "json_encoders": {
            datetime: lambda dt: (
                dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
                if dt.tzinfo is None
                else dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            )
        }
    }


BaseModel = BaseModelUTC


class ProductCreate(BaseModel):
    article_no: str
    name: str
    category: str | None = None
    image_url: str | None = None
    share_image_url: str | None = None
    label_url: str | None = None
    options: str | None = None
    notes: str | None = None
    factory_stock: int = 0
    usa_stock: int = 0
    front_room_stock: int = 0
    reserved_stock: int = 0
    cost_price: float = 0
    selling_price: float = 0
    unit_weight_kg: float = Field(default=0, ge=0)
    low_stock_alert: int = 10
    workflow_required: bool = True


class ProductOut(ProductCreate):
    id: int
    image_url: Optional[str] = None
    share_image_url: Optional[str] = None
    label_url: Optional[str] = None
    available_stock: int

    model_config = {
        "from_attributes": True
    }


class CustomerCreate(BaseModel):
    name: str
    company_name: str | None = None
    email: str | None = None
    phone: str | None = None
    country: str | None = None
    address: str | None = None
    shipping_address: str | None = None
    platform: str | None = None


class CustomerOut(CustomerCreate):
    id: int

    model_config = {
        "from_attributes": True
    }


class SchoolStudentCreate(BaseModel):
    campus_id: int | None = None
    academic_session_id: int | None = None
    school_class_id: int | None = None
    school_section_id: int | None = None
    application_id: int | None = None
    admission_no: str = Field(default="", max_length=50)
    student_name: str = Field(min_length=1, max_length=150)
    father_name: str | None = Field(default=None, max_length=150)
    guardian_name: str | None = Field(default=None, max_length=150)
    guardian_phone: str | None = Field(default=None, max_length=50)
    date_of_birth: str | None = Field(default=None, max_length=20)
    gender: str | None = Field(default=None, max_length=30)
    class_name: str = Field(min_length=1, max_length=80)
    section: str | None = Field(default=None, max_length=30)
    roll_number: str | None = Field(default=None, max_length=30)
    admission_date: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=500)
    status: str = Field(default="Active", max_length=30)
    notes: str | None = Field(default=None, max_length=1000)
    photo_url: str | None = Field(default=None, max_length=2000000)
    preferred_language: str = Field(default="en", max_length=10)
    b_form_no: str | None = Field(default=None, max_length=50)
    birth_certificate_no: str | None = Field(default=None, max_length=80)
    mother_name: str | None = Field(default=None, max_length=150)
    previous_school: str | None = Field(default=None, max_length=200)
    blood_group: str | None = Field(default=None, max_length=20)
    family_discount_percent: float = Field(default=0, ge=0, le=100)
    graduation_date: str | None = Field(default=None, max_length=20)
    withdrawal_date: str | None = Field(default=None, max_length=20)
    alumni_since: str | None = Field(default=None, max_length=20)


class SchoolStudentOut(SchoolStudentCreate):
    id: int
    workspace_id: int | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }


from pydantic import Field, constr

class TenantCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=160)
    slug: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=80)
    logo: str | None = None
    status: str = "active"
    admin_name: str | None = Field(default=None, max_length=120)
    admin_username: str | None = Field(default=None, max_length=80)
    admin_pin: constr(pattern=r"^\d{4}$") = "0000"
    admin_email: str | None = Field(default=None, max_length=160)
    admin_phone: str | None = Field(default=None, max_length=80)
    module_slugs: list[str] | None = None


class TenantUpdate(BaseModel):
    company_name: str | None = Field(default=None, max_length=160)
    slug: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=80)
    logo: str | None = None
    status: str | None = None


class TenantOut(BaseModel):
    id: int
    company_name: str
    slug: str
    email: str | None = None
    phone: str | None = None
    logo: str | None = None
    status: str
    user_count: int = 0
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }


class ModuleOut(BaseModel):
    id: int
    name: str
    slug: str
    page_name: str | None = None
    description: str | None = None
    default_enabled: bool = True
    enabled: bool = True

    model_config = {
        "from_attributes": True
    }


class TenantModuleUpdate(BaseModel):
    enabled: bool


class TenantModuleBulkUpdate(BaseModel):
    modules: dict[str, bool] = Field(default_factory=dict)


class CustomPageCreate(BaseModel):
    page_name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=120)
    fields: list[dict] = Field(default_factory=list)
    is_active: bool = True


class CustomPageUpdate(BaseModel):
    page_name: str | None = Field(default=None, max_length=120)
    slug: str | None = Field(default=None, max_length=120)
    fields: list[dict] | None = None
    is_active: bool | None = None


class CustomPageOut(BaseModel):
    id: int
    tenant_id: int
    page_name: str
    slug: str
    fields: list[dict] = Field(default_factory=list)
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }


class UserCreate(BaseModel):
    name: str
    username: str | None = None
    tenant_id: int | None = None
    pin: constr(pattern=r"^\d{4}$") = "0000"
    role: str
    phone: str | None = None
    email: str | None = None
    allowed_pages: list[str] | None = None
    customer_privacy_settings: dict[str, bool] | None = None
    session_expiry_minutes: int | None = Field(default=0, ge=0)
    is_active: bool = True
    worker_id: int | None = None


class UserUpdate(BaseModel):
    name: str
    username: str | None = None
    tenant_id: int | None = None
    pin: Optional[constr(pattern=r"^\d{4}$")] = None
    role: str
    phone: str | None = None
    email: str | None = None
    allowed_pages: list[str] | None = None
    customer_privacy_settings: dict[str, bool] | None = None
    session_expiry_minutes: int | None = Field(default=0, ge=0)
    is_active: bool = True
    worker_id: int | None = None


class UserOut(BaseModel):
    id: int
    tenant_id: int | None = None
    tenant_name: str | None = None
    tenant_slug: str | None = None
    name: str
    username: str
    role: str
    phone: str | None = None
    email: str | None = None
    allowed_pages: list[str] = Field(default_factory=list)
    customer_privacy_settings: dict[str, bool] = Field(default_factory=dict)
    session_expiry_minutes: int = 0
    is_active: bool = True
    worker_id: int | None = None
    last_login: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }


class LoginResponse(UserOut):
    access_token: str
    token_type: str = "bearer"

    model_config = {
        "from_attributes": True
    }


class RoleRequestCreate(BaseModel):
    requested_role: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    message: str | None = None


class RoleRequestUpdate(BaseModel):
    status: str = "Reviewed"
    admin_note: str | None = None


class RoleRequestOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    username: str | None = None
    requested_role: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    message: str | None = None
    status: str
    admin_note: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }


class PublicAccessRequestCreate(BaseModel):
    tenant_slug: str | None = Field(default=None, max_length=120)
    full_name: str = Field(min_length=1, max_length=120)
    preferred_username: str | None = Field(default=None, max_length=80)
    work_email: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=80)
    requested_workspace: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=800)


class PublicAccessRequestReview(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    username: str | None = Field(default=None, max_length=80)
    pin: constr(pattern=r"^\d{4}$") = "0000"
    role: str = "unassigned"
    phone: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=160)
    allowed_pages: list[str] | None = None
    customer_privacy_settings: dict[str, bool] | None = None
    session_expiry_minutes: int | None = Field(default=0, ge=0)
    is_active: bool = True
    admin_note: str | None = Field(default=None, max_length=800)


class PublicAccessRequestUpdate(BaseModel):
    status: str = "Reviewed"
    admin_note: str | None = Field(default=None, max_length=800)


class PublicAccessRequestOut(BaseModel):
    id: int
    tenant_id: int | None = None
    tenant_name: str | None = None
    tenant_slug: str | None = None
    full_name: str
    preferred_username: str | None = None
    work_email: str | None = None
    phone: str | None = None
    requested_workspace: str | None = None
    suggested_role: str | None = None
    message: str | None = None
    status: str
    admin_note: str | None = None
    approved_user_id: int | None = None
    reviewed_by_user_id: int | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }

class InternalMessageCreate(BaseModel):
    recipient_user_id: int
    body: str


class InternalMessageOut(BaseModel):
    id: int
    sender_user_id: int
    recipient_user_id: int
    sender_name: str
    recipient_name: str
    body: str
    read_at: datetime | None = None
    created_at: datetime
    is_mine: bool = False


class InternalMessageUserOut(BaseModel):
    id: int
    name: str
    username: str
    role: str
    unread_count: int = 0
    last_message_at: datetime | None = None


class InternalCallCreate(BaseModel):
    recipient_user_id: int
    call_type: str = "audio"


class InternalCallAction(BaseModel):
    action: str


class InternalCallOut(BaseModel):
    id: int
    caller_user_id: int
    caller_name: str
    recipient_user_id: int
    recipient_name: str
    call_type: str = "audio"
    other_user_id: int
    other_user_name: str
    other_user_role: str | None = None
    status: str
    is_incoming: bool = False
    answered_at: datetime | None = None
    ended_at: datetime | None = None
    ended_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime | None = None


class InternalCallSignalCreate(BaseModel):
    signal_type: str
    payload: dict


class InternalCallSignalOut(BaseModel):
    id: int
    call_id: int
    sender_user_id: int
    signal_type: str
    payload: dict
    created_at: datetime


class ActivityPageViewCreate(BaseModel):
    page: str
    user_id: int | None = None
    user_name: str | None = None


class ActivityLogOut(BaseModel):
    id: int
    tenant_id: int | None = None
    actor_user_id: int | None = None
    actor_user_name: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    summary: str
    detail: str | None = None
    page: str | None = None
    request_method: str | None = None
    request_path: str | None = None
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class LoginRequest(BaseModel):
    username: str | None = None
    name: str | None = None
    tenant_slug: str | None = None
    pin: constr(pattern=r"^\d{4}$")


class UserProfileUpdate(BaseModel):
    name: str
    username: str | None = None
    pin: Optional[constr(pattern=r"^\d{4}$")] = None


class InspirationItemCreate(BaseModel):
    title: str
    notes: str | None = None
    image_url: str | None = None
    status: str = "saved"


class InspirationItemUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    image_url: str | None = None
    status: str | None = None


class InspirationItemOut(BaseModel):
    id: int
    title: str
    notes: str | None = None
    image_url: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }


class SupplierCreate(BaseModel):
    name: str
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None


class SupplierPaymentCreate(BaseModel):
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    payment_date: datetime | None = None


class SupplierOrderItemCreate(BaseModel):
    product_id: int
    ordered_quantity: int
    purchase_price: float
    stock_type: str = "factory_stock"
    reference: str | None = None
    note: str | None = None


class SupplierOrderItemReceive(BaseModel):
    received_quantity: int
    purchase_price: float | None = None
    stock_type: str | None = None
    complete_order: bool = False
    note: str | None = None


class SupplierSupplyItemCreate(BaseModel):
    sku: str | None = None
    item_name: str
    category: str = "Miscellaneous"
    usage_area: str = "General"
    quantity: int = 1
    unit_price: float = 0
    note: str | None = None


class SupplierSupplyItemBatchCreate(BaseModel):
    items: list[SupplierSupplyItemCreate]


class SupplierSupplyItemUpdate(BaseModel):
    sku: str | None = None
    item_name: str | None = None
    category: str | None = None
    usage_area: str | None = None
    quantity: int | None = None
    unit_price: float | None = None
    note: str | None = None


class StockMovementUpdate(BaseModel):
    quantity: int | None = None
    purchase_price: float | None = None
    source: str | None = None
    reference: str | None = None
    note: str | None = None
    faulty: bool | None = None
    faulty_quantity: int | None = None
    faulty_note: str | None = None


class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: float
    stock_source: str = "Factory"


class OrderCreate(BaseModel):
    order_no: str | None = None
    customer_id: int
    import_customer_name: str | None = None
    import_customer_company_name: str | None = None
    import_contact_name: str | None = None
    import_contact_phone: str | None = None
    import_shipping_name: str | None = None
    import_shipping_address: str | None = None
    import_ship_date: datetime | None = None
    platform: str = "Manual"
    order_date: datetime | None = None
    payment_status: str = "Pending"
    shipping_status: str = "Pending"
    notes: str | None = None
    order_total_usd: float = 0
    platform_fee_usd: float = 0
    deduction_usd: float = 0
    expected_payout_usd: float = 0
    expected_payout_date: datetime | None = None
    payment_source: str | None = None
    payout_status: str = "Not Received"
    received_payout_usd: float = 0
    remaining_payout_usd: float = 0
    exchange_rate: float = 0
    received_pkr: float = 0
    bank_charges_pkr: float = 0
    final_received_pkr: float = 0
    payout_notes: str | None = None
    payout_received_date: datetime | None = None
    items: list[OrderItemCreate]


class OrderPayoutUpdate(BaseModel):
    order_total_usd: float = 0
    platform_fee_usd: float = 0
    deduction_usd: float = 0
    expected_payout_usd: float = 0
    expected_payout_date: datetime | None = None
    payment_source: str | None = None
    payout_status: str = "Not Received"
    received_payout_usd: float = 0
    remaining_payout_usd: float | None = None
    exchange_rate: float = 0
    received_pkr: float = 0
    bank_charges_pkr: float = 0
    final_received_pkr: float = 0
    payout_notes: str | None = None
    payout_received_date: datetime | None = None


class OrderItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    article_no: str
    product_image_url: str | None = None
    quantity: int
    unit_price: float
    line_total: float
    stock_source: str
    manufacturing_required: bool
    product_cost_price: float

    model_config = {
        "from_attributes": True
    }


class OrderOut(BaseModel):
    id: int
    order_no: str
    customer_id: int
    customer_name: str
    customer_company_name: str | None = None
    import_customer_name: str | None = None
    import_customer_company_name: str | None = None
    import_contact_name: str | None = None
    import_contact_phone: str | None = None
    import_shipping_name: str | None = None
    import_shipping_address: str | None = None
    import_ship_date: datetime | None = None
    import_batch_key: str | None = None
    customer_match_reason: str | None = None
    needs_customer_assignment: bool = False
    platform: str
    order_date: datetime
    status: str
    payment_status: str
    shipping_status: str
    total_amount: float
    payout_amount_usd: float = 0
    order_total_usd: float
    platform_fee_usd: float
    deduction_usd: float
    expected_payout_usd: float
    expected_payout_date: datetime | None = None
    payment_source: str | None = None
    payout_status: str
    received_payout_usd: float
    remaining_payout_usd: float
    exchange_rate: float
    received_pkr: float
    bank_charges_pkr: float
    final_received_pkr: float
    payout_notes: str | None = None
    payout_received_date: datetime | None = None
    notes: str | None = None
    items: list[OrderItemOut]

    model_config = {
        "from_attributes": True
    }


class StockMovementOut(BaseModel):
    id: int
    product_id: int
    article_no: str
    product_name: str
    product_image_url: str | None = None
    product_cost_price: float = 0
    product_selling_price: float = 0
    movement_type: str
    quantity: int
    stock_type: str | None = None
    purchase_price: float = 0
    source: str | None = None
    supplier_id: int | None = None
    supplier_name: str | None = None
    reference: str | None = None
    note: str | None = None
    faulty: bool = False
    faulty_quantity: int = 0
    faulty_note: str | None = None
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class SupplierPaymentOut(BaseModel):
    id: int
    supplier_id: int
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    payment_date: datetime | None = None
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class SupplierTransactionOut(BaseModel):
    id: int
    supplier_id: int
    transaction_type: str
    reference: str | None = None
    amount: float
    balance_after: float
    note: str | None = None
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class SupplierOrderItemOut(BaseModel):
    id: int
    supplier_id: int
    product_id: int
    article_no: str
    product_name: str
    product_image_url: str | None = None
    ordered_quantity: int
    received_quantity: int
    pending_quantity: int
    purchase_price: float
    line_total: float
    pending_total: float
    stock_type: str
    reference: str | None = None
    note: str | None = None
    status: str
    is_closed: bool = False
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }


class SupplierSupplyItemOut(BaseModel):
    id: int
    supplier_id: int
    sku: str | None = None
    item_name: str
    category: str
    usage_area: str
    quantity: int
    unit_price: float
    line_total: float
    note: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True
    }


class SupplierOut(BaseModel):
    id: int
    name: str
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    created_at: datetime
    payments: list[SupplierPaymentOut] = []
    transactions: list[SupplierTransactionOut] = []
    stock_movements: list[StockMovementOut] = []
    ordered_items: list[SupplierOrderItemOut] = []
    supply_items: list[SupplierSupplyItemOut] = []
    ordered_units: int = 0
    received_ordered_units: int = 0
    pending_ordered_units: int = 0
    ordered_total: float = 0
    pending_ordered_total: float = 0
    supply_units: int = 0
    supply_total: float = 0
    balance_due: float = 0
    balance_status: str = "Settled"

    model_config = {
        "from_attributes": True
    }


class WorkflowStepCreate(BaseModel):
    product_id: int
    step_order: int
    step_name: str
    worker_role: str | None = None
    rate_per_piece: float = 0
    estimated_minutes_per_piece: float = 0
    is_optional: bool = False
    is_active: bool = True


class WorkflowStepUpdate(WorkflowStepCreate):
    pass


class WorkflowCopyRequest(BaseModel):
    source_product_id: int
    target_product_id: int
    replace_existing: bool = True


class WorkflowStepOut(WorkflowStepCreate):
    id: int
    article_no: str
    product_name: str

    model_config = {
        "from_attributes": True
    }


class WorkerCreate(BaseModel):
    name: str
    role: str
    phone: str | None = None
    email: str | None = None
    department: str | None = None
    rate_per_piece: float = 0
    is_active: bool = True


class WorkerOut(WorkerCreate):
    id: int
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class WorkerPaymentCreate(BaseModel):
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    paid_at: datetime | None = None
    account_id: int | None = None


class WorkerPaymentOut(BaseModel):
    id: int
    worker_id: int
    worker_name: str | None = None
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    accounting_transaction_id: int | None = None
    paid_at: datetime
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class ShippingCreate(BaseModel):
    order_id: int
    courier_name: str | None = None
    tracking_number: str | None = None
    package_weight_kg: float | None = Field(default=None, gt=0)
    shipping_cost: float | None = None
    shipping_note: str | None = None
    shipping_service: str = "duty_paid"


class ShippingUpdate(BaseModel):
    courier_name: str | None = None
    tracking_number: str | None = None
    package_weight_kg: float | None = Field(default=None, gt=0)
    shipping_cost: float | None = None
    shipping_note: str | None = None
    shipping_service: str | None = None


class ShippingOut(BaseModel):
    id: int
    order_id: int
    order_no: str | None = None
    customer_name: str | None = None
    courier_name: str | None = None
    tracking_number: str | None = None
    package_weight_kg: float | None = None
    shipping_cost: float | None = None
    shipping_note: str | None = None
    shipping_service: str | None = None
    destination_zip_prefix: str | None = None
    shipping_zone: str | None = None
    calculated_weight_kg: float | None = None
    estimated_shipping_cost: float | None = None
    rate_source_version: str | None = None
    shipped_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }


class FulfillmentShipmentBoxItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class FulfillmentShipmentBoxCreate(BaseModel):
    box_number: str
    weight_kg: float | None = Field(default=None, gt=0)
    length_cm: float | None = Field(default=None, gt=0)
    width_cm: float | None = Field(default=None, gt=0)
    height_cm: float | None = Field(default=None, gt=0)
    location: str | None = None
    notes: str | None = None
    items: list[FulfillmentShipmentBoxItemCreate] = Field(default_factory=list)


class FulfillmentShipmentCreate(BaseModel):
    shipment_no: str | None = None
    destination_name: str | None = None
    source_stock: str = "Factory"
    notes: str | None = None
    sent_at: datetime | None = None
    boxes: list[FulfillmentShipmentBoxCreate] = Field(default_factory=list)


class FulfillmentShipmentReceiptUpdate(BaseModel):
    party: str


class FulfillmentBoxItemOut(BaseModel):
    id: int
    box_id: int
    box_number: str
    location: str | None = None
    shipment_id: int
    shipment_no: str
    product_id: int
    article_no: str
    product_name: str
    product_image_url: str | None = None
    quantity: int
    available_quantity: int


class FulfillmentShipmentBoxOut(BaseModel):
    id: int
    box_number: str
    weight_kg: float | None = None
    length_cm: float | None = None
    width_cm: float | None = None
    height_cm: float | None = None
    location: str | None = None
    notes: str | None = None
    total_units: int = 0
    available_units: int = 0
    items: list[FulfillmentBoxItemOut] = Field(default_factory=list)


class FulfillmentShipmentOut(BaseModel):
    id: int
    shipment_no: str
    destination_name: str | None = None
    source_stock: str
    status: str
    carton_count: int
    total_units: int = 0
    available_units: int = 0
    notes: str | None = None
    sent_at: datetime
    admin_received_at: datetime | None = None
    fulfillment_received_at: datetime | None = None
    received_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    boxes: list[FulfillmentShipmentBoxOut] = Field(default_factory=list)


class FulfillmentBoxLocationUpdate(BaseModel):
    location: str | None = None


class FulfillmentBoxMergeRequest(BaseModel):
    source_box_id: int
    target_box_id: int
    note: str | None = None


class FulfillmentInventoryDiscrepancyCreate(BaseModel):
    box_item_id: int
    reason: str
    direction: str
    quantity: int = Field(gt=0)
    reference: str | None = None
    notes: str | None = None


class FulfillmentInventoryDiscrepancyOut(BaseModel):
    id: int
    box_item_id: int
    box_id: int
    box_number: str
    location: str | None = None
    shipment_id: int
    shipment_no: str
    product_id: int
    article_no: str
    product_name: str
    reason: str
    quantity_delta: int
    available_before: int
    available_after: int
    reference: str | None = None
    notes: str | None = None
    created_by_name: str | None = None
    created_at: datetime


class FulfillmentOrderItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class FulfillmentOrderItemOut(BaseModel):
    id: int
    product_id: int
    article_no: str
    product_name: str
    product_image_url: str | None = None
    quantity: int
    picked_quantity: int = 0


class FulfillmentPickOut(BaseModel):
    id: int
    box_item_id: int
    product_id: int
    article_no: str
    product_name: str
    shipment_id: int
    shipment_no: str
    box_id: int
    box_number: str
    location: str | None = None
    quantity: int
    created_at: datetime


class FulfillmentPickPlanLine(BaseModel):
    box_item_id: int
    box_id: int
    box_number: str
    location: str | None = None
    shipment_id: int
    shipment_no: str
    quantity: int
    available_before_pick: int


class FulfillmentPickPlanItem(BaseModel):
    product_id: int
    article_no: str
    product_name: str
    required_quantity: int
    available_quantity: int
    shortage_quantity: int
    picks: list[FulfillmentPickPlanLine] = Field(default_factory=list)


class FulfillmentOrderOut(BaseModel):
    id: int
    fulfillment_order_no: str
    customer_name: str | None = None
    platform: str | None = None
    ship_to: str | None = None
    status: str
    label_file_url: str | None = None
    label_file_name: str | None = None
    notes: str | None = None
    total_units: int = 0
    created_at: datetime
    shipped_at: datetime | None = None
    updated_at: datetime
    items: list[FulfillmentOrderItemOut] = Field(default_factory=list)
    picks: list[FulfillmentPickOut] = Field(default_factory=list)
    pick_plan: list[FulfillmentPickPlanItem] = Field(default_factory=list)


class CourierPaymentCreate(BaseModel):
    courier_name: str
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    payment_date: datetime | None = None


class CourierPaymentOut(BaseModel):
    id: int
    courier_name: str
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    payment_date: datetime
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class RegularBillCreate(BaseModel):
    name: str
    category: str | None = "Utilities"
    vendor: str | None = None
    amount: float = 0
    currency: str = "PKR"
    frequency: str = "Monthly"
    next_due_date: datetime | None = None
    reminder_days: int = 7
    payment_method: str | None = None
    account_reference: str | None = None
    status: str = "Active"
    notes: str | None = None


class RegularBillUpdate(RegularBillCreate):
    pass


class RegularBillPaymentCreate(BaseModel):
    amount: float | None = None
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    paid_at: datetime | None = None


class RegularBillPaymentOut(BaseModel):
    id: int
    bill_id: int
    amount: float
    payment_method: str | None = None
    payment_reference: str | None = None
    note: str | None = None
    paid_at: datetime
    created_at: datetime

    model_config = {
        "from_attributes": True
    }


class RegularBillOut(RegularBillCreate):
    id: int
    last_paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    days_until_due: int | None = None
    due_status: str = "Scheduled"
    payments: list[RegularBillPaymentOut] = []

    model_config = {
        "from_attributes": True
    }


class AccountingAccountCreate(BaseModel):
    name: str
    account_type: str = "Bank"
    platform: str | None = None
    currency: str = "PKR"
    opening_balance: float = 0
    notes: str | None = None
    is_active: bool = True


class AccountingAccountUpdate(BaseModel):
    name: str | None = None
    account_type: str | None = None
    platform: str | None = None
    currency: str | None = None
    opening_balance: float | None = None
    notes: str | None = None
    is_active: bool | None = None


class AccountingAccountOut(AccountingAccountCreate):
    id: int
    balance: float = 0
    balance_pkr: float = 0
    created_at: datetime
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }


class AccountingTransactionCreate(BaseModel):
    account_id: int
    direction: str
    category: str = "Manual"
    amount: float
    currency: str = "PKR"
    exchange_rate: float = 1
    amount_pkr: float | None = None
    counterparty: str | None = None
    platform: str | None = None
    reference: str | None = None
    source_type: str | None = None
    source_id: int | None = None
    description: str | None = None
    transaction_date: datetime | None = None


class AccountingTransactionUpdate(BaseModel):
    account_id: int | None = None
    direction: str | None = None
    category: str | None = None
    amount: float | None = None
    currency: str | None = None
    exchange_rate: float | None = None
    amount_pkr: float | None = None
    counterparty: str | None = None
    platform: str | None = None
    reference: str | None = None
    source_type: str | None = None
    source_id: int | None = None
    description: str | None = None
    transaction_date: datetime | None = None


class AccountingTransactionOut(AccountingTransactionCreate):
    id: int
    account_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {
        "from_attributes": True
    }


class ProductionBatchCreate(BaseModel):
    batch_no: str | None = None
    product_id: int
    batch_quantity: int
    priority: str = "Normal"
    due_date: datetime | None = None
    notes: str | None = None
    include_optional_steps: bool = False


class ProductionBatchUpdate(BaseModel):
    priority: str | None = None
    due_date: datetime | None = None
    notes: str | None = None


class ManualProductionTaskCreate(BaseModel):
    product_id: int | None = None
    custom_product_name: str | None = None
    custom_article_no: str | None = None
    worker_id: int
    step_name: str
    assigned_quantity: int = Field(default=1, gt=0)
    due_date: datetime | None = None
    notes: str | None = None
    worker_role: str | None = None
    rate_per_piece: float = 0
    estimated_minutes_per_piece: float = 0


class ProductionTaskAssign(BaseModel):
    worker_id: int | None = None
    rate_per_piece: float | None = None


class ProductionTaskProgressUpdate(BaseModel):
    completed_quantity: int


class ProductionTaskComplete(BaseModel):
    completed_quantity: int | None = None
    delay_reason: str | None = None
    verify: bool = False


class SharedDataCreate(BaseModel):
    order_id: int
    customer_id: int
    shared_platform: str = "WhatsApp"
    shared_data: str


class SharedDataOut(BaseModel):
    id: int
    order_id: int
    customer_id: int
    shared_platform: str
    shared_data: str
    shared_at: datetime

    model_config = {
        "from_attributes": True
    }


class WorkspaceDataPayload(BaseModel):
    data: object


class OrderWorkflowTaskCreate(BaseModel):
    task_type: str
    worker_id: int
    assigned_quantity: int | None = Field(default=None, ge=1)
    rate_per_piece: float | None = Field(default=None, ge=0)
    labor_cost: float | None = Field(default=None, ge=0)
    notes: str | None = None
    due_at: datetime | None = None
    assigned_by_user_id: int | None = None
    assigned_by_user_name: str | None = None


class OrderWorkflowTaskComplete(BaseModel):
    note: str | None = None
    courier_name: str | None = None
    tracking_number: str | None = None
    package_weight_kg: float | None = Field(default=None, gt=0)
    shipping_cost: float | None = None
    shipping_note: str | None = None
    verify: bool = False


class OrderFollowUpUpdate(BaseModel):
    status: str
    channel: str | None = None
    message: str | None = None
    review_provided: bool | None = None
    review_note: str | None = None
