"""Validated request and response schemas for Phase 1 Amazon settings."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .constants import (
    CONNECTION_MISSING_CREDENTIALS,
    DEFAULT_ACCOUNT_NAME,
    DEFAULT_CURRENCY,
    DEFAULT_MARKETPLACE_ID,
    DEFAULT_REGION,
    REGION_ENDPOINTS,
)


class AmazonSettingsUpdate(BaseModel):
    account_name: str = Field(default=DEFAULT_ACCOUNT_NAME, min_length=1, max_length=160)
    client_identifier: str | None = Field(default=None, max_length=2048)
    client_secret: str | None = Field(default=None, max_length=4096)
    app_id: str | None = Field(default=None, max_length=512)
    refresh_token: str | None = Field(default=None, max_length=8192)
    seller_id: str | None = Field(default=None, max_length=2048)
    marketplace_id: str = Field(default=DEFAULT_MARKETPLACE_ID, min_length=1, max_length=64)
    region: str = Field(default=DEFAULT_REGION, min_length=2, max_length=2)
    endpoint: str = Field(default=REGION_ENDPOINTS[DEFAULT_REGION], max_length=255)
    currency: str = Field(default=DEFAULT_CURRENCY, min_length=3, max_length=3)
    is_active: bool = True
    lwa_secret_rotation_due_date: datetime | None = None
    reauthorize: bool = False

    @field_validator(
        "account_name",
        "client_identifier",
        "client_secret",
        "app_id",
        "refresh_token",
        "seller_id",
        "marketplace_id",
        "endpoint",
        mode="before",
    )
    @classmethod
    def strip_strings(cls, value):
        if value is None:
            return None
        return str(value).strip()

    @field_validator("region")
    @classmethod
    def validate_region(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in REGION_ENDPOINTS:
            raise ValueError("Region must be NA, EU, or FE.")
        return normalized

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("Currency must be a three-letter code.")
        return normalized

    @model_validator(mode="after")
    def validate_endpoint(self):
        expected_endpoint = REGION_ENDPOINTS[self.region]
        if self.endpoint.rstrip("/") != expected_endpoint:
            raise ValueError(
                f"Endpoint for region {self.region} must be {expected_endpoint}."
            )
        self.endpoint = expected_endpoint
        return self


class AmazonSettingsResponse(BaseModel):
    id: int | None = None
    account_name: str = DEFAULT_ACCOUNT_NAME
    marketplace_id: str = DEFAULT_MARKETPLACE_ID
    region: str = DEFAULT_REGION
    endpoint: str = REGION_ENDPOINTS[DEFAULT_REGION]
    currency: str = DEFAULT_CURRENCY
    is_active: bool = True
    connection_status: str = CONNECTION_MISSING_CREDENTIALS
    sanitized_last_error: str | None = None
    authorization_date: datetime | None = None
    last_connection_test: datetime | None = None
    last_successful_connection: datetime | None = None
    last_failed_connection: datetime | None = None
    last_successful_sync: datetime | None = None
    auto_sync_enabled: bool = True
    auto_sync_interval_minutes: int = 15
    auto_sync_last_started_at: datetime | None = None
    auto_sync_last_finished_at: datetime | None = None
    auto_sync_next_run_at: datetime | None = None
    auto_sync_last_error: str | None = None
    lwa_secret_rotation_due_date: datetime | None = None
    client_identifier_saved: bool = False
    client_identifier_masked: str | None = None
    client_secret_saved: bool = False
    app_id_saved: bool = False
    app_id_masked: str | None = None
    refresh_token_saved: bool = False
    seller_id_saved: bool = False
    seller_id_masked: str | None = None
    credentials_complete: bool = False
    encryption_key_configured: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AmazonAutoSyncSettingsUpdate(BaseModel):
    enabled: bool = True
    interval_minutes: int = Field(default=15, ge=5, le=60)

    @field_validator("interval_minutes")
    @classmethod
    def validate_interval(cls, value: int) -> int:
        if value not in {5, 15, 30, 60}:
            raise ValueError("Interval must be 5, 15, 30, or 60 minutes.")
        return value


class AmazonConnectionStatusResponse(BaseModel):
    account_id: int | None = None
    connection_status: str = CONNECTION_MISSING_CREDENTIALS
    is_active: bool = True
    marketplace_id: str = DEFAULT_MARKETPLACE_ID
    region: str = DEFAULT_REGION
    last_connection_test: datetime | None = None
    last_successful_connection: datetime | None = None
    last_failed_connection: datetime | None = None
    sanitized_last_error: str | None = None


class ConfirmAmazonAction(BaseModel):
    confirm: bool = False


class AmazonListingConnectRequest(BaseModel):
    product_id: int = Field(gt=0)


class AmazonListingSyncSettingsUpdate(BaseModel):
    sync_price: bool | None = None
    sync_inventory: bool | None = None

    @model_validator(mode="after")
    def require_change(self):
        if self.sync_price is None and self.sync_inventory is None:
            raise ValueError("At least one synchronization setting is required.")
        return self


class AmazonListingInventoryResponse(BaseModel):
    fulfillable_quantity: int = 0
    inbound_working_quantity: int = 0
    inbound_shipped_quantity: int = 0
    inbound_receiving_quantity: int = 0
    inbound_quantity: int = 0
    reserved_quantity: int = 0
    pending_customer_order_quantity: int = 0
    pending_transshipment_quantity: int = 0
    fc_processing_quantity: int = 0
    unfulfillable_quantity: int = 0
    damaged_quantity: int = 0
    researching_quantity: int = 0
    total_quantity: int = 0
    minimum_fba_quantity: int = 0
    health: Literal["Healthy", "Low stock", "Out of stock"]
    last_amazon_update: datetime | None = None
    last_successful_sync: datetime | None = None


class AmazonListingResponse(BaseModel):
    id: int
    amazon_account_id: int
    product_id: int | None = None
    erp_sku: str | None = None
    erp_product_name: str | None = None
    seller_sku: str
    merchant_seller_sku: str | None = None
    asin: str | None = None
    fnsku: str | None = None
    upc_ean: str | None = None
    product_title: str | None = None
    image_url: str | None = None
    amazon_image_url: str | None = None
    is_variation_parent: bool = False
    marketplace_id: str
    fulfillment_mode: str
    fba_enabled: bool
    fbm_enabled: bool
    condition_type: str | None = None
    listing_status: str | None = None
    product_status: Literal["Active", "Inactive"] = "Inactive"
    listing_issues: list[dict] = Field(default_factory=list)
    issue_count: int = 0
    amazon_price: float | None = None
    currency: str
    sync_price: bool = False
    sync_inventory: bool = False
    last_amazon_quantity: int | None = None
    fba_inventory: AmazonListingInventoryResponse | None = None
    last_listing_sync: datetime | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonListingSummary(BaseModel):
    total: int = 0
    mapped: int = 0
    unmapped: int = 0
    with_issues: int = 0
    variation_parents_hidden: int = 0


class AmazonListingListResponse(BaseModel):
    items: list[AmazonListingResponse] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 100
    summary: AmazonListingSummary = Field(default_factory=AmazonListingSummary)


class AmazonListingAutoMatchResponse(BaseModel):
    matched: int
    unmatched: int


class AmazonSyncJobResponse(BaseModel):
    id: int
    amazon_account_id: int
    job_type: str
    reference_type: str | None = None
    reference_id: str | None = None
    status: str
    attempt_count: int
    maximum_attempts: int
    error_code: str | None = None
    error_message: str | None = None
    amazon_request_id: str | None = None
    response_summary: dict = Field(default_factory=dict)
    scheduled_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    next_retry_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AmazonSyncAllResponse(BaseModel):
    jobs: list[AmazonSyncJobResponse] = Field(default_factory=list)
    queued_count: int = 0
    already_running_count: int = 0


class AmazonFbaInventoryThresholdUpdate(BaseModel):
    minimum_fba_quantity: int = Field(ge=0, le=1_000_000)


class AmazonInventoryLocationResponse(BaseModel):
    id: int
    location_code: str
    location_name: str
    category: str
    source_of_truth: str
    is_read_only: bool
    is_active: bool


class AmazonFbaInventoryResponse(BaseModel):
    id: int
    amazon_account_id: int
    product_mapping_id: int | None = None
    product_id: int | None = None
    erp_sku: str | None = None
    erp_product_name: str | None = None
    seller_sku: str
    fnsku: str | None = None
    asin: str | None = None
    product_name: str | None = None
    condition: str | None = None
    marketplace_id: str
    fulfillable_quantity: int
    inbound_working_quantity: int
    inbound_shipped_quantity: int
    inbound_receiving_quantity: int
    inbound_quantity: int
    reserved_quantity: int
    pending_customer_order_quantity: int
    pending_transshipment_quantity: int
    fc_processing_quantity: int
    unfulfillable_quantity: int
    damaged_quantity: int
    researching_quantity: int
    total_quantity: int
    minimum_fba_quantity: int
    is_low_stock: bool
    factory_stock: int
    usa_stock: int
    front_room_stock: int
    factory_reserved_quantity: int
    factory_available_quantity: int
    total_owned_quantity: int
    is_mapped: bool
    discrepancy_reasons: list[str] = Field(default_factory=list)
    has_discrepancy: bool
    last_amazon_update: datetime | None = None
    last_successful_sync: datetime | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonFbaInventorySummary(BaseModel):
    sku_count: int = 0
    fulfillable_quantity: int = 0
    inbound_quantity: int = 0
    reserved_quantity: int = 0
    unfulfillable_quantity: int = 0
    researching_quantity: int = 0
    total_quantity: int = 0
    low_stock_count: int = 0
    discrepancy_count: int = 0
    mapped_count: int = 0
    unmapped_count: int = 0


class AmazonFbaInventoryListResponse(BaseModel):
    items: list[AmazonFbaInventoryResponse] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 200
    summary: AmazonFbaInventorySummary = Field(
        default_factory=AmazonFbaInventorySummary
    )


class AmazonFbaInventoryHistoryResponse(BaseModel):
    id: int
    fba_inventory_id: int
    sync_job_id: int | None = None
    seller_sku: str
    fnsku: str | None = None
    asin: str | None = None
    fulfillable_quantity: int
    inbound_working_quantity: int
    inbound_shipped_quantity: int
    inbound_receiving_quantity: int
    reserved_quantity: int
    unfulfillable_quantity: int
    researching_quantity: int
    total_quantity: int
    last_amazon_update: datetime | None = None
    snapshot_at: datetime


class AmazonOrderSyncRequest(BaseModel):
    days: int = Field(default=14, ge=1, le=14)
    mode: Literal["incremental", "backfill"] = "incremental"


class AmazonOrderItemResponse(BaseModel):
    id: int
    amazon_order_item_id: str
    product_mapping_id: int | None = None
    product_id: int | None = None
    erp_sku: str | None = None
    erp_product_name: str | None = None
    seller_sku: str
    asin: str | None = None
    title: str | None = None
    condition_type: str | None = None
    quantity_ordered: int
    quantity_shipped: int
    currency: str
    unit_price: float
    item_price: float
    item_tax: float
    shipping_price: float
    shipping_tax: float
    discount: float
    promotion_discount: float
    item_status: str
    is_mapped: bool
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonOrderIssueResponse(BaseModel):
    code: str
    message: str
    seller_sku: str | None = None
    amazon_order_item_id: str | None = None


class AmazonOrderResponse(BaseModel):
    id: int
    amazon_order_id: str
    amazon_account_id: int
    marketplace_id: str
    marketplace_name: str | None = None
    fulfillment_channel: str
    sales_channel: str
    purchase_date: datetime
    last_update_date: datetime
    order_status: str
    erp_status: str
    currency: str
    order_total: float
    item_total: float
    shipping_total: float
    tax_total: float
    promotion_total: float
    payment_status: str
    shipment_status: str
    erp_sales_order_id: int | None = None
    carrier_name: str | None = None
    tracking_number: str | None = None
    earliest_ship_date: datetime | None = None
    latest_ship_date: datetime | None = None
    earliest_delivery_date: datetime | None = None
    latest_delivery_date: datetime | None = None
    item_count: int
    unit_count: int
    mapped_item_count: int
    unmapped_item_count: int
    mapping_status: str
    programs: list[str] = Field(default_factory=list)
    issues: list[AmazonOrderIssueResponse] = Field(default_factory=list)
    issue_count: int
    items: list[AmazonOrderItemResponse] = Field(default_factory=list)
    last_amazon_update: datetime | None = None
    last_successful_sync: datetime | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonOrderSummary(BaseModel):
    order_count: int = 0
    orders_today: int = 0
    unit_count: int = 0
    revenue: float = 0
    pending_count: int = 0
    unshipped_count: int = 0
    partially_shipped_count: int = 0
    shipped_count: int = 0
    cancelled_count: int = 0
    mapped_item_count: int = 0
    unmapped_item_count: int = 0
    orders_with_issues: int = 0


class AmazonOrderListResponse(BaseModel):
    items: list[AmazonOrderResponse] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 200
    summary: AmazonOrderSummary = Field(default_factory=AmazonOrderSummary)


class AmazonOrderIssueListResponse(BaseModel):
    orders: list[AmazonOrderResponse] = Field(default_factory=list)
    total: int = 0
    unmapped_item_count: int = 0


class AmazonOrderMappingRetryResponse(BaseModel):
    amazon_order_id: str
    mapped_items: int
    unmapped_items: int


class AmazonOrderStatusHistoryResponse(BaseModel):
    id: int
    amazon_order_database_id: int
    sync_job_id: int | None = None
    previous_order_status: str | None = None
    order_status: str
    previous_erp_status: str | None = None
    erp_status: str
    previous_shipment_status: str | None = None
    shipment_status: str
    changed_at: datetime


class AmazonFbaInboundSourceAddress(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    company_name: str | None = Field(default=None, max_length=50)
    address_line1: str = Field(min_length=1, max_length=180)
    address_line2: str | None = Field(default=None, max_length=60)
    city: str = Field(min_length=1, max_length=60)
    district_or_county: str | None = Field(default=None, max_length=150)
    state_or_province_code: str | None = Field(default=None, max_length=30)
    postal_code: str = Field(min_length=1, max_length=30)
    country_code: str = Field(min_length=2, max_length=2)
    phone_number: str = Field(min_length=1, max_length=30)
    email: str | None = Field(default=None, max_length=320)

    @field_validator(
        "name",
        "company_name",
        "address_line1",
        "address_line2",
        "city",
        "district_or_county",
        "state_or_province_code",
        "postal_code",
        "country_code",
        "phone_number",
        "email",
        mode="before",
    )
    @classmethod
    def strip_address_fields(cls, value):
        if value is None:
            return None
        return str(value).strip()

    @field_validator("country_code")
    @classmethod
    def normalize_country_code(cls, value: str) -> str:
        return value.upper()

    def amazon_payload(self) -> dict:
        values = {
            "name": self.name,
            "companyName": self.company_name,
            "addressLine1": self.address_line1,
            "addressLine2": self.address_line2,
            "city": self.city,
            "districtOrCounty": self.district_or_county,
            "stateOrProvinceCode": self.state_or_province_code,
            "postalCode": self.postal_code,
            "countryCode": self.country_code,
            "phoneNumber": self.phone_number,
            "email": self.email,
        }
        return {key: value for key, value in values.items() if value}


class AmazonFbaInboundPlanItemCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=1_000_000)
    prep_owner: str = Field(default="SELLER", max_length=20)
    label_owner: str = Field(default="SELLER", max_length=20)
    expiration_date: str | None = Field(default=None, max_length=20)
    manufacturing_lot_code: str | None = Field(default=None, max_length=100)

    @field_validator("prep_owner", "label_owner")
    @classmethod
    def validate_owners(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"AMAZON", "SELLER", "NONE"}:
            raise ValueError("Owner must be AMAZON, SELLER, or NONE.")
        return normalized


class AmazonFbaInboundPlanCreate(BaseModel):
    plan_name: str = Field(min_length=1, max_length=200)
    source_warehouse_id: str = Field(min_length=1, max_length=100)
    source_address_reference: str = Field(min_length=1, max_length=200)
    packing_type: str = Field(default="CASE_PACKED", max_length=40)
    source_address: AmazonFbaInboundSourceAddress
    items: list[AmazonFbaInboundPlanItemCreate] = Field(
        min_length=1,
        max_length=1500,
    )
    confirm_external_creation: bool = False

    @field_validator(
        "plan_name",
        "source_warehouse_id",
        "source_address_reference",
        "packing_type",
        mode="before",
    )
    @classmethod
    def strip_plan_fields(cls, value):
        return str(value or "").strip()

    @model_validator(mode="after")
    def require_external_confirmation(self):
        if not self.confirm_external_creation:
            raise ValueError(
                "Confirm that this action creates an inbound plan in Amazon Seller Central."
            )
        self.packing_type = self.packing_type.upper()
        return self


class AmazonFbaInboundPlanConfirmRequest(BaseModel):
    placement_option_id: str = Field(min_length=1, max_length=100)
    confirm_external_action: bool = False

    @model_validator(mode="after")
    def require_confirmation(self):
        self.placement_option_id = self.placement_option_id.strip()
        if not self.confirm_external_action:
            raise ValueError(
                "Confirm that this action accepts an Amazon placement option."
            )
        return self


class AmazonFbaInboundCartonUpsert(BaseModel):
    carton_reference: str | None = Field(default=None, max_length=100)
    box_id: str | None = Field(default=None, max_length=100)
    tracking_number: str | None = Field(default=None, max_length=100)
    quantity: int = Field(default=1, ge=1, le=100_000)
    length: float | None = Field(default=None, gt=0)
    width: float | None = Field(default=None, gt=0)
    height: float | None = Field(default=None, gt=0)
    dimension_unit: str = Field(default="CM", max_length=10)
    weight: float | None = Field(default=None, gt=0)
    weight_unit: str = Field(default="KG", max_length=10)


class AmazonFbaInboundCartonBatch(BaseModel):
    cartons: list[AmazonFbaInboundCartonUpsert] = Field(
        min_length=1,
        max_length=1000,
    )


class AmazonFbaInboundTrackingUpdate(BaseModel):
    carrier_name: str = Field(min_length=1, max_length=100)
    tracking_number: str = Field(min_length=1, max_length=100)
    mark_shipped: bool = False
    submit_to_amazon: bool = False
    confirm_stock_movement: bool = False

    @model_validator(mode="after")
    def require_stock_confirmation(self):
        self.carrier_name = self.carrier_name.strip()
        self.tracking_number = self.tracking_number.strip()
        if self.mark_shipped and not self.confirm_stock_movement:
            raise ValueError(
                "Confirm the Factory Available to FBA In Transit stock movement."
            )
        return self


class AmazonFbaInboundReconcileItem(BaseModel):
    shipment_item_id: int = Field(gt=0)
    quantity_received: int = Field(ge=0, le=1_000_000)
    quantity_missing: int = Field(default=0, ge=0, le=1_000_000)
    quantity_damaged: int = Field(default=0, ge=0, le=1_000_000)


class AmazonFbaInboundReconcileRequest(BaseModel):
    items: list[AmazonFbaInboundReconcileItem] = Field(
        min_length=1,
        max_length=1500,
    )
    note: str | None = Field(default=None, max_length=1000)
    confirm_reconciliation: bool = False

    @model_validator(mode="after")
    def require_reconciliation_confirmation(self):
        if not self.confirm_reconciliation:
            raise ValueError(
                "Confirm the append-only inbound reconciliation movements."
            )
        return self


class AmazonFbaInboundStockMovementResponse(BaseModel):
    id: int
    event_key: str
    movement_type: str
    from_location: str
    to_location: str
    quantity: int
    reconciliation_reference: str | None = None
    note: str | None = None
    created_at: datetime


class AmazonFbaInboundCartonResponse(BaseModel):
    id: int
    carton_reference: str
    amazon_package_id: str | None = None
    box_id: str | None = None
    tracking_number: str | None = None
    quantity: int
    length: float | None = None
    width: float | None = None
    height: float | None = None
    dimension_unit: str | None = None
    weight: float | None = None
    weight_unit: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonFbaShipmentItemResponse(BaseModel):
    id: int
    product_mapping_id: int | None = None
    product_id: int | None = None
    erp_sku: str | None = None
    erp_product_name: str | None = None
    seller_sku: str
    asin: str | None = None
    fnsku: str | None = None
    quantity_planned: int
    quantity_shipped: int
    quantity_received: int
    quantity_damaged: int
    quantity_missing: int
    quantity_in_discrepancy: int
    is_mapped: bool
    issues: list[str] = Field(default_factory=list)
    last_amazon_update: datetime | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonFbaShipmentResponse(BaseModel):
    id: int
    inbound_plan_database_id: int
    amazon_shipment_id: str
    shipment_confirmation_id: str | None = None
    shipment_name: str | None = None
    amazon_reference_id: str | None = None
    destination_code: str | None = None
    destination_country: str | None = None
    shipping_mode: str | None = None
    carrier_name: str | None = None
    tracking_number: str | None = None
    shipment_status: str
    planned_quantity: int
    shipped_quantity: int
    received_quantity: int
    damaged_quantity: int
    missing_quantity: int
    discrepancy_quantity: int
    expected_delivery_date: datetime | None = None
    received_date: datetime | None = None
    confirmed_at: datetime | None = None
    reconciled_at: datetime | None = None
    last_amazon_update: datetime | None = None
    last_successful_sync: datetime | None = None
    last_error: str | None = None
    issue_count: int
    items: list[AmazonFbaShipmentItemResponse] = Field(default_factory=list)
    cartons: list[AmazonFbaInboundCartonResponse] = Field(default_factory=list)
    movements: list[AmazonFbaInboundStockMovementResponse] = Field(
        default_factory=list
    )
    created_at: datetime
    updated_at: datetime


class AmazonFbaInboundPlanItemResponse(BaseModel):
    id: int
    product_mapping_id: int | None = None
    product_id: int | None = None
    erp_sku: str | None = None
    erp_product_name: str | None = None
    factory_stock: int | None = None
    seller_sku: str
    asin: str | None = None
    fnsku: str | None = None
    quantity_planned: int
    prep_owner: str
    label_owner: str
    expiration_date: str | None = None
    manufacturing_lot_code: str | None = None
    is_mapped: bool
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class AmazonFbaInboundPlanResponse(BaseModel):
    id: int
    inbound_plan_id: str
    amazon_account_id: int
    plan_name: str
    marketplace_id: str
    source_warehouse_id: str | None = None
    source_address_reference: str | None = None
    packing_type: str
    status: str
    amazon_operation_id: str | None = None
    packing_option_id: str | None = None
    placement_option_id: str | None = None
    transportation_option_id: str | None = None
    options: dict = Field(default_factory=dict)
    planned_quantity: int
    shipped_quantity: int
    received_quantity: int
    missing_quantity: int
    damaged_quantity: int
    discrepancy_quantity: int
    confirmed_at: datetime | None = None
    last_amazon_update: datetime | None = None
    last_successful_sync: datetime | None = None
    last_error: str | None = None
    issue_count: int
    items: list[AmazonFbaInboundPlanItemResponse] = Field(default_factory=list)
    shipments: list[AmazonFbaShipmentResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AmazonFbaInboundSummary(BaseModel):
    plan_count: int = 0
    active_plan_count: int = 0
    shipment_count: int = 0
    planned_quantity: int = 0
    shipped_quantity: int = 0
    received_quantity: int = 0
    missing_quantity: int = 0
    damaged_quantity: int = 0
    discrepancy_quantity: int = 0
    plans_with_issues: int = 0


class AmazonFbaInboundPlanListResponse(BaseModel):
    items: list[AmazonFbaInboundPlanResponse] = Field(default_factory=list)
    total: int = 0
    summary: AmazonFbaInboundSummary = Field(
        default_factory=AmazonFbaInboundSummary
    )


class AmazonFbaInboundShipmentListResponse(BaseModel):
    items: list[AmazonFbaShipmentResponse] = Field(default_factory=list)
    total: int = 0


class AmazonFbaInboundPlacementOptionResponse(BaseModel):
    placement_option_id: str
    status: str
    fees: list[dict] = Field(default_factory=list)
    shipment_count: int = 0


class AmazonFbaInboundPlacementOptionListResponse(BaseModel):
    items: list[AmazonFbaInboundPlacementOptionResponse] = Field(
        default_factory=list
    )


class AmazonFbaInboundTrackingResponse(BaseModel):
    shipment: AmazonFbaShipmentResponse
    units_moved_to_transit: int = 0
    submitted_to_amazon: bool = False


class AmazonFbaInboundReconcileResponse(BaseModel):
    shipment: AmazonFbaShipmentResponse
    movements_created: int = 0
    discrepancy_quantity: int = 0


class AmazonFbaInboundLabelDocumentResponse(BaseModel):
    document_type: str
    download_url: str
    expires_at: datetime | None = None


class AmazonFbaInboundLabelListResponse(BaseModel):
    items: list[AmazonFbaInboundLabelDocumentResponse] = Field(
        default_factory=list
    )


class AmazonFinanceSyncRequest(BaseModel):
    days: int = Field(default=30, ge=1, le=180)
    mode: Literal["incremental", "backfill"] = "incremental"


class AmazonBalanceResponse(BaseModel):
    amount: float | None = None
    total_amount: float | None = None
    available_amount: float | None = None
    deferred_amount: float | None = None
    deferred_transaction_count: int = 0
    currency: str = DEFAULT_CURRENCY
    financial_event_group_id: str | None = None
    updated_at: datetime | None = None
    error: str | None = None
    stale: bool = True
    source: str = "Amazon Payments"


class AmazonSettlementAccountingPostRequest(BaseModel):
    settlement_ids: list[int] = Field(min_length=1, max_length=100)
    confirm_posting: bool = False

    @field_validator("settlement_ids")
    @classmethod
    def validate_settlement_ids(cls, value: list[int]) -> list[int]:
        cleaned = sorted({int(item) for item in value if int(item) > 0})
        if not cleaned:
            raise ValueError("Select at least one settlement.")
        return cleaned


class AmazonPricingSettingsUpdate(BaseModel):
    price_sync_enabled: bool
    approval_threshold_percent: float = Field(ge=1, le=100)


class AmazonPricingRuleUpdate(BaseModel):
    minimum_price: float | None = Field(default=None, gt=0, le=1_000_000)
    maximum_price: float | None = Field(default=None, gt=0, le=1_000_000)
    sale_price: float | None = Field(default=None, gt=0, le=1_000_000)
    sale_start_date: datetime | None = None
    sale_end_date: datetime | None = None
    sync_price: bool = False

    @model_validator(mode="after")
    def validate_rules(self):
        if (
            self.minimum_price is not None
            and self.maximum_price is not None
            and self.minimum_price > self.maximum_price
        ):
            raise ValueError("Minimum price cannot exceed maximum price.")
        if self.sale_price is not None:
            if self.minimum_price is not None and self.sale_price < self.minimum_price:
                raise ValueError("Sale price is below the configured minimum.")
            if self.maximum_price is not None and self.sale_price > self.maximum_price:
                raise ValueError("Sale price is above the configured maximum.")
            if not self.sale_start_date or not self.sale_end_date:
                raise ValueError("Sale price requires both start and end dates.")
            if self.sale_start_date >= self.sale_end_date:
                raise ValueError("Sale end date must be after the start date.")
        elif self.sale_start_date or self.sale_end_date:
            raise ValueError("Sale dates require a sale price.")
        return self


class AmazonPriceChangeCreate(BaseModel):
    mapping_id: int = Field(gt=0)
    requested_price: float = Field(gt=0, le=1_000_000)
    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value):
        if value is None:
            return None
        return str(value).strip() or None


class AmazonPriceChangeReview(BaseModel):
    approved: bool
    review_note: str | None = Field(default=None, max_length=1000)

    @field_validator("review_note", mode="before")
    @classmethod
    def strip_review_note(cls, value):
        if value is None:
            return None
        return str(value).strip() or None


class AmazonPriceBulkSyncRequest(BaseModel):
    change_ids: list[int] = Field(min_length=1, max_length=100)

    @field_validator("change_ids")
    @classmethod
    def validate_change_ids(cls, value: list[int]) -> list[int]:
        cleaned = list(dict.fromkeys(int(item) for item in value if int(item) > 0))
        if not cleaned:
            raise ValueError("Select at least one approved price change.")
        return cleaned
