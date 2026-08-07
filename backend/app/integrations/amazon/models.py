"""Database models owned by the Amazon integration."""

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

from ...database import Base
from .constants import CONNECTION_MISSING_CREDENTIALS


class AmazonAccount(Base):
    __tablename__ = "amazon_accounts"
    __table_args__ = (
        UniqueConstraint(
            "account_name",
            "marketplace_id",
            name="uq_amazon_accounts_name_marketplace",
        ),
        Index("ix_amazon_accounts_active_status", "is_active", "connection_status"),
        Index("ix_amazon_accounts_marketplace", "marketplace_id", "region"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_name = Column(String, nullable=False)
    encrypted_lwa_client_id = Column(Text, nullable=True)
    encrypted_lwa_client_secret = Column(Text, nullable=True)
    encrypted_refresh_token = Column(Text, nullable=True)
    encrypted_seller_id = Column(Text, nullable=True)
    app_id = Column(String, nullable=True)
    marketplace_id = Column(String, nullable=False, index=True)
    region = Column(String, nullable=False, index=True)
    endpoint = Column(String, nullable=False)
    currency = Column(String, nullable=False, default="USD")
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    connection_status = Column(
        String,
        nullable=False,
        default=CONNECTION_MISSING_CREDENTIALS,
        index=True,
    )
    sanitized_last_error = Column(Text, nullable=True)
    authorization_date = Column(DateTime, nullable=True)
    last_connection_test = Column(DateTime, nullable=True)
    last_successful_connection = Column(DateTime, nullable=True)
    last_failed_connection = Column(DateTime, nullable=True)
    last_successful_sync = Column(DateTime, nullable=True)
    lwa_secret_rotation_due_date = Column(DateTime, nullable=True)
    current_balance = Column(Float, nullable=True)
    current_balance_currency = Column(String, nullable=True)
    current_balance_event_group_id = Column(String, nullable=True)
    current_balance_updated_at = Column(DateTime, nullable=True)
    current_balance_error = Column(Text, nullable=True)
    deferred_balance = Column(Float, nullable=True)
    deferred_balance_currency = Column(String, nullable=True)
    deferred_transaction_count = Column(Integer, nullable=False, default=0)
    deferred_balance_updated_at = Column(DateTime, nullable=True)
    deferred_balance_error = Column(Text, nullable=True)
    auto_sync_enabled = Column(Boolean, nullable=False, default=True)
    auto_sync_interval_minutes = Column(Integer, nullable=False, default=15)
    auto_sync_last_started_at = Column(DateTime, nullable=True)
    auto_sync_last_finished_at = Column(DateTime, nullable=True)
    auto_sync_last_error = Column(Text, nullable=True)
    price_sync_enabled = Column(Boolean, nullable=False, default=False)
    price_change_approval_percent = Column(Float, nullable=False, default=10)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonProductMapping(Base):
    __tablename__ = "amazon_product_mappings"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "marketplace_id",
            "seller_sku",
            name="uq_amazon_product_mapping_offer",
        ),
        Index(
            "ix_amazon_product_mappings_product",
            "product_id",
            "amazon_account_id",
        ),
        Index(
            "ix_amazon_product_mappings_status",
            "amazon_account_id",
            "listing_status",
        ),
        Index(
            "ix_amazon_product_mappings_fulfillment",
            "amazon_account_id",
            "fulfillment_mode",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    seller_sku = Column(String, nullable=False, index=True)
    merchant_seller_sku = Column(String, nullable=True)
    asin = Column(String, nullable=True, index=True)
    fnsku = Column(String, nullable=True, index=True)
    upc_ean = Column(String, nullable=True)
    product_title = Column(Text, nullable=True)
    amazon_image_url = Column(Text, nullable=True)
    product_type = Column(String, nullable=False, default="PRODUCT")
    is_variation_parent = Column(Boolean, nullable=False, default=False)
    marketplace_id = Column(String, nullable=False, index=True)
    fulfillment_mode = Column(String, nullable=False, default="FBA", index=True)
    fba_enabled = Column(Boolean, nullable=False, default=False)
    fbm_enabled = Column(Boolean, nullable=False, default=False)
    condition_type = Column(String, nullable=True)
    listing_status = Column(String, nullable=True, index=True)
    listing_issues_json = Column(Text, nullable=True)
    amazon_price = Column(Float, nullable=True)
    fba_price = Column(Float, nullable=True)
    fbm_price = Column(Float, nullable=True)
    minimum_price = Column(Float, nullable=True)
    maximum_price = Column(Float, nullable=True)
    sale_price = Column(Float, nullable=True)
    sale_start_date = Column(DateTime, nullable=True)
    sale_end_date = Column(DateTime, nullable=True)
    currency = Column(String, nullable=False, default="USD")
    sync_price = Column(Boolean, nullable=False, default=False)
    sync_inventory = Column(Boolean, nullable=False, default=False)
    fbm_inventory_sync_enabled = Column(Boolean, nullable=False, default=False)
    fbm_safety_stock = Column(Integer, nullable=False, default=0)
    fbm_max_quantity = Column(Integer, nullable=True)
    fbm_handling_time = Column(Integer, nullable=True)
    fbm_shipping_template = Column(String, nullable=True)
    last_amazon_quantity = Column(Integer, nullable=True)
    last_erp_quantity = Column(Integer, nullable=True)
    pending_amazon_quantity = Column(Integer, nullable=True)
    last_inventory_sync = Column(DateTime, nullable=True)
    last_price_sync = Column(DateTime, nullable=True)
    pending_price = Column(Float, nullable=True)
    last_price_submission_id = Column(String, nullable=True)
    last_price_status = Column(String, nullable=True)
    last_listing_sync = Column(DateTime, nullable=True, index=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonPriceChange(Base):
    __tablename__ = "amazon_price_changes"
    __table_args__ = (
        Index(
            "ix_amazon_price_changes_account_status",
            "amazon_account_id",
            "status",
            "created_at",
        ),
        Index(
            "ix_amazon_price_changes_mapping_created",
            "product_mapping_id",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=False,
        index=True,
    )
    sync_job_id = Column(
        Integer,
        ForeignKey("amazon_sync_jobs.id"),
        nullable=True,
        index=True,
    )
    seller_sku = Column(String, nullable=False, index=True)
    marketplace_id = Column(String, nullable=False, index=True)
    currency = Column(String, nullable=False, default="USD")
    current_price = Column(Float, nullable=True)
    requested_price = Column(Float, nullable=False)
    minimum_price = Column(Float, nullable=True)
    maximum_price = Column(Float, nullable=True)
    sale_price = Column(Float, nullable=True)
    sale_start_date = Column(DateTime, nullable=True)
    sale_end_date = Column(DateTime, nullable=True)
    change_percent = Column(Float, nullable=True)
    approval_threshold_percent = Column(Float, nullable=False, default=10)
    requires_approval = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="Pending Approval", index=True)
    reason = Column(Text, nullable=True)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_note = Column(Text, nullable=True)
    amazon_submission_id = Column(String, nullable=True, index=True)
    amazon_status = Column(String, nullable=True, index=True)
    amazon_issues_json = Column(Text, nullable=True)
    last_error = Column(Text, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonInventoryLocation(Base):
    __tablename__ = "amazon_inventory_locations"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "location_code",
            name="uq_amazon_inventory_location_code",
        ),
        Index(
            "ix_amazon_inventory_locations_account_active",
            "amazon_account_id",
            "is_active",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    location_code = Column(String, nullable=False, index=True)
    location_name = Column(String, nullable=False)
    category = Column(String, nullable=False, default="FBA")
    source_of_truth = Column(String, nullable=False, default="Amazon")
    is_read_only = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaInventory(Base):
    __tablename__ = "amazon_fba_inventory"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "marketplace_id",
            "seller_sku",
            "fnsku",
            name="uq_amazon_fba_inventory_item",
        ),
        Index(
            "ix_amazon_fba_inventory_account_fulfillable",
            "amazon_account_id",
            "fulfillable_quantity",
        ),
        Index(
            "ix_amazon_fba_inventory_mapping",
            "product_mapping_id",
            "amazon_account_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=True,
        index=True,
    )
    seller_sku = Column(String, nullable=False, index=True)
    fnsku = Column(String, nullable=False, default="", index=True)
    asin = Column(String, nullable=True, index=True)
    product_name = Column(Text, nullable=True)
    condition = Column(String, nullable=True)
    marketplace_id = Column(String, nullable=False, index=True)
    fulfillable_quantity = Column(Integer, nullable=False, default=0)
    inbound_working_quantity = Column(Integer, nullable=False, default=0)
    inbound_shipped_quantity = Column(Integer, nullable=False, default=0)
    inbound_receiving_quantity = Column(Integer, nullable=False, default=0)
    reserved_quantity = Column(Integer, nullable=False, default=0)
    pending_customer_order_quantity = Column(Integer, nullable=False, default=0)
    pending_transshipment_quantity = Column(Integer, nullable=False, default=0)
    fc_processing_quantity = Column(Integer, nullable=False, default=0)
    unfulfillable_quantity = Column(Integer, nullable=False, default=0)
    customer_damaged_quantity = Column(Integer, nullable=False, default=0)
    warehouse_damaged_quantity = Column(Integer, nullable=False, default=0)
    distributor_damaged_quantity = Column(Integer, nullable=False, default=0)
    carrier_damaged_quantity = Column(Integer, nullable=False, default=0)
    defective_quantity = Column(Integer, nullable=False, default=0)
    expired_quantity = Column(Integer, nullable=False, default=0)
    researching_quantity = Column(Integer, nullable=False, default=0)
    total_quantity = Column(Integer, nullable=False, default=0)
    minimum_fba_quantity = Column(Integer, nullable=False, default=10)
    last_amazon_update = Column(DateTime, nullable=True)
    last_successful_sync = Column(DateTime, nullable=True, index=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaInventoryHistory(Base):
    __tablename__ = "amazon_fba_inventory_history"
    __table_args__ = (
        Index(
            "ix_amazon_fba_inventory_history_item_snapshot",
            "fba_inventory_id",
            "snapshot_at",
        ),
        Index(
            "ix_amazon_fba_inventory_history_account_snapshot",
            "amazon_account_id",
            "snapshot_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    fba_inventory_id = Column(
        Integer,
        ForeignKey("amazon_fba_inventory.id"),
        nullable=False,
        index=True,
    )
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=True,
        index=True,
    )
    sync_job_id = Column(
        Integer,
        ForeignKey("amazon_sync_jobs.id"),
        nullable=True,
        index=True,
    )
    seller_sku = Column(String, nullable=False, index=True)
    fnsku = Column(String, nullable=False, default="")
    asin = Column(String, nullable=True)
    fulfillable_quantity = Column(Integer, nullable=False, default=0)
    inbound_working_quantity = Column(Integer, nullable=False, default=0)
    inbound_shipped_quantity = Column(Integer, nullable=False, default=0)
    inbound_receiving_quantity = Column(Integer, nullable=False, default=0)
    reserved_quantity = Column(Integer, nullable=False, default=0)
    unfulfillable_quantity = Column(Integer, nullable=False, default=0)
    researching_quantity = Column(Integer, nullable=False, default=0)
    total_quantity = Column(Integer, nullable=False, default=0)
    last_amazon_update = Column(DateTime, nullable=True)
    snapshot_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class AmazonOrder(Base):
    __tablename__ = "amazon_orders"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "amazon_order_id",
            name="uq_amazon_orders_account_order",
        ),
        Index(
            "ix_amazon_orders_account_purchase",
            "amazon_account_id",
            "purchase_date",
        ),
        Index(
            "ix_amazon_orders_account_status",
            "amazon_account_id",
            "order_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_order_id = Column(String, nullable=False, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    marketplace_id = Column(String, nullable=False, index=True)
    marketplace_name = Column(String, nullable=True)
    fulfillment_channel = Column(String, nullable=False, default="AMAZON", index=True)
    sales_channel = Column(String, nullable=False, default="AMAZON")
    purchase_date = Column(DateTime, nullable=False, index=True)
    last_update_date = Column(DateTime, nullable=False, index=True)
    order_status = Column(String, nullable=False, index=True)
    erp_status = Column(String, nullable=False, index=True)
    currency = Column(String, nullable=False, default="USD")
    order_total = Column(Float, nullable=False, default=0)
    item_total = Column(Float, nullable=False, default=0)
    shipping_total = Column(Float, nullable=False, default=0)
    tax_total = Column(Float, nullable=False, default=0)
    promotion_total = Column(Float, nullable=False, default=0)
    payment_status = Column(String, nullable=False, default="Amazon Managed")
    shipment_status = Column(String, nullable=False, default="Pending", index=True)
    erp_sales_order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    carrier_name = Column(String, nullable=True)
    tracking_number = Column(String, nullable=True)
    earliest_ship_date = Column(DateTime, nullable=True)
    latest_ship_date = Column(DateTime, nullable=True)
    earliest_delivery_date = Column(DateTime, nullable=True)
    latest_delivery_date = Column(DateTime, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    unit_count = Column(Integer, nullable=False, default=0)
    mapped_item_count = Column(Integer, nullable=False, default=0)
    unmapped_item_count = Column(Integer, nullable=False, default=0)
    programs_json = Column(Text, nullable=True)
    last_amazon_update = Column(DateTime, nullable=True)
    last_successful_sync = Column(DateTime, nullable=True, index=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonOrderItem(Base):
    __tablename__ = "amazon_order_items"
    __table_args__ = (
        UniqueConstraint(
            "amazon_order_database_id",
            "amazon_order_item_id",
            name="uq_amazon_order_items_order_item",
        ),
        Index(
            "ix_amazon_order_items_mapping",
            "product_mapping_id",
            "product_id",
        ),
        Index(
            "ix_amazon_order_items_sku",
            "seller_sku",
            "asin",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_order_database_id = Column(
        Integer,
        ForeignKey("amazon_orders.id"),
        nullable=False,
        index=True,
    )
    amazon_order_item_id = Column(String, nullable=False, index=True)
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=True,
        index=True,
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    seller_sku = Column(String, nullable=False, index=True)
    asin = Column(String, nullable=True, index=True)
    title = Column(Text, nullable=True)
    condition_type = Column(String, nullable=True)
    quantity_ordered = Column(Integer, nullable=False, default=0)
    quantity_shipped = Column(Integer, nullable=False, default=0)
    currency = Column(String, nullable=False, default="USD")
    unit_price = Column(Float, nullable=False, default=0)
    item_price = Column(Float, nullable=False, default=0)
    item_tax = Column(Float, nullable=False, default=0)
    shipping_price = Column(Float, nullable=False, default=0)
    shipping_tax = Column(Float, nullable=False, default=0)
    discount = Column(Float, nullable=False, default=0)
    promotion_discount = Column(Float, nullable=False, default=0)
    item_status = Column(String, nullable=False, default="Pending", index=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonOrderStatusHistory(Base):
    __tablename__ = "amazon_order_status_history"
    __table_args__ = (
        Index(
            "ix_amazon_order_status_history_order_changed",
            "amazon_order_database_id",
            "changed_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_order_database_id = Column(
        Integer,
        ForeignKey("amazon_orders.id"),
        nullable=False,
        index=True,
    )
    sync_job_id = Column(
        Integer,
        ForeignKey("amazon_sync_jobs.id"),
        nullable=True,
        index=True,
    )
    previous_order_status = Column(String, nullable=True)
    order_status = Column(String, nullable=False)
    previous_erp_status = Column(String, nullable=True)
    erp_status = Column(String, nullable=False)
    previous_shipment_status = Column(String, nullable=True)
    shipment_status = Column(String, nullable=False)
    changed_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class AmazonFinancialTransaction(Base):
    __tablename__ = "amazon_financial_transactions"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "transaction_id",
            name="uq_amazon_financial_transactions_account_transaction",
        ),
        Index(
            "ix_amazon_financial_transactions_account_date",
            "amazon_account_id",
            "transaction_date",
        ),
        Index(
            "ix_amazon_financial_transactions_order",
            "amazon_account_id",
            "amazon_order_id",
        ),
        Index(
            "ix_amazon_financial_transactions_settlement",
            "amazon_account_id",
            "settlement_reference",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    transaction_id = Column(String, nullable=False, index=True)
    transaction_type = Column(String, nullable=False, index=True)
    transaction_status = Column(String, nullable=False, default="RELEASED", index=True)
    description = Column(Text, nullable=True)
    amazon_order_id = Column(String, nullable=True, index=True)
    amazon_order_database_id = Column(
        Integer,
        ForeignKey("amazon_orders.id"),
        nullable=True,
        index=True,
    )
    seller_sku = Column(String, nullable=True, index=True)
    asin = Column(String, nullable=True, index=True)
    marketplace_id = Column(String, nullable=True, index=True)
    currency = Column(String, nullable=False, default="USD")
    product_revenue = Column(Float, nullable=False, default=0)
    shipping_revenue = Column(Float, nullable=False, default=0)
    tax_amount = Column(Float, nullable=False, default=0)
    referral_fee = Column(Float, nullable=False, default=0)
    fba_fee = Column(Float, nullable=False, default=0)
    storage_fee = Column(Float, nullable=False, default=0)
    refund_amount = Column(Float, nullable=False, default=0)
    reimbursement_amount = Column(Float, nullable=False, default=0)
    advertising_charge = Column(Float, nullable=False, default=0)
    other_fee = Column(Float, nullable=False, default=0)
    other_revenue = Column(Float, nullable=False, default=0)
    product_cost = Column(Float, nullable=False, default=0)
    inbound_shipping_cost = Column(Float, nullable=False, default=0)
    packaging_cost = Column(Float, nullable=False, default=0)
    net_amount = Column(Float, nullable=False, default=0)
    classified_net_amount = Column(Float, nullable=False, default=0)
    reconciliation_difference = Column(Float, nullable=False, default=0)
    estimated_profit = Column(Float, nullable=False, default=0)
    settlement_reference = Column(String, nullable=True, index=True)
    financial_event_group_id = Column(String, nullable=True, index=True)
    related_identifiers_json = Column(Text, nullable=True)
    breakdowns_json = Column(Text, nullable=True)
    erp_accounting_entry_id = Column(
        Integer,
        ForeignKey("accounting_transactions.id"),
        nullable=True,
        index=True,
    )
    transaction_date = Column(DateTime, nullable=False, index=True)
    last_successful_sync = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFinancialTransactionItem(Base):
    __tablename__ = "amazon_financial_transaction_items"
    __table_args__ = (
        UniqueConstraint(
            "financial_transaction_id",
            "item_index",
            name="uq_amazon_financial_transaction_items_index",
        ),
        Index(
            "ix_amazon_financial_transaction_items_product",
            "product_id",
            "seller_sku",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    financial_transaction_id = Column(
        Integer,
        ForeignKey("amazon_financial_transactions.id"),
        nullable=False,
        index=True,
    )
    item_index = Column(Integer, nullable=False)
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=True,
        index=True,
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    seller_sku = Column(String, nullable=True, index=True)
    asin = Column(String, nullable=True, index=True)
    quantity = Column(Integer, nullable=False, default=0)
    currency = Column(String, nullable=False, default="USD")
    product_revenue = Column(Float, nullable=False, default=0)
    shipping_revenue = Column(Float, nullable=False, default=0)
    referral_fee = Column(Float, nullable=False, default=0)
    fba_fee = Column(Float, nullable=False, default=0)
    storage_fee = Column(Float, nullable=False, default=0)
    refund_amount = Column(Float, nullable=False, default=0)
    reimbursement_amount = Column(Float, nullable=False, default=0)
    advertising_charge = Column(Float, nullable=False, default=0)
    other_fee = Column(Float, nullable=False, default=0)
    other_revenue = Column(Float, nullable=False, default=0)
    net_amount = Column(Float, nullable=False, default=0)
    product_cost = Column(Float, nullable=False, default=0)
    inbound_shipping_cost = Column(Float, nullable=False, default=0)
    packaging_cost = Column(Float, nullable=False, default=0)
    estimated_profit = Column(Float, nullable=False, default=0)
    breakdowns_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonSettlement(Base):
    __tablename__ = "amazon_settlements"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "settlement_reference",
            name="uq_amazon_settlements_account_reference",
        ),
        Index(
            "ix_amazon_settlements_account_status",
            "amazon_account_id",
            "settlement_status",
        ),
        Index(
            "ix_amazon_settlements_account_date",
            "amazon_account_id",
            "latest_transaction_date",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    settlement_reference = Column(String, nullable=False, index=True)
    marketplace_id = Column(String, nullable=True, index=True)
    currency = Column(String, nullable=False, default="USD")
    settlement_status = Column(String, nullable=False, default="Expected", index=True)
    transaction_count = Column(Integer, nullable=False, default=0)
    product_revenue = Column(Float, nullable=False, default=0)
    shipping_revenue = Column(Float, nullable=False, default=0)
    reimbursement_amount = Column(Float, nullable=False, default=0)
    amazon_fees = Column(Float, nullable=False, default=0)
    refund_amount = Column(Float, nullable=False, default=0)
    expected_amount = Column(Float, nullable=False, default=0)
    actual_amount = Column(Float, nullable=False, default=0)
    difference_amount = Column(Float, nullable=False, default=0)
    first_transaction_date = Column(DateTime, nullable=True)
    latest_transaction_date = Column(DateTime, nullable=True, index=True)
    erp_accounting_entry_id = Column(
        Integer,
        ForeignKey("accounting_transactions.id"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaInboundPlan(Base):
    __tablename__ = "amazon_fba_inbound_plans"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "inbound_plan_id",
            name="uq_amazon_fba_inbound_plan",
        ),
        Index(
            "ix_amazon_fba_inbound_plans_account_status",
            "amazon_account_id",
            "status",
        ),
        Index(
            "ix_amazon_fba_inbound_plans_updated",
            "amazon_account_id",
            "last_amazon_update",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    inbound_plan_id = Column(String, nullable=False, index=True)
    plan_name = Column(String, nullable=False)
    marketplace_id = Column(String, nullable=False, index=True)
    source_warehouse_id = Column(String, nullable=True)
    source_address_reference = Column(String, nullable=True)
    packing_type = Column(String, nullable=False, default="CASE_PACKED")
    status = Column(String, nullable=False, default="CREATING", index=True)
    amazon_operation_id = Column(String, nullable=True, index=True)
    packing_option_id = Column(String, nullable=True)
    placement_option_id = Column(String, nullable=True)
    transportation_option_id = Column(String, nullable=True)
    options_json = Column(Text, nullable=True)
    planned_quantity = Column(Integer, nullable=False, default=0)
    shipped_quantity = Column(Integer, nullable=False, default=0)
    received_quantity = Column(Integer, nullable=False, default=0)
    missing_quantity = Column(Integer, nullable=False, default=0)
    damaged_quantity = Column(Integer, nullable=False, default=0)
    discrepancy_quantity = Column(Integer, nullable=False, default=0)
    confirmed_at = Column(DateTime, nullable=True)
    last_amazon_update = Column(DateTime, nullable=True)
    last_successful_sync = Column(DateTime, nullable=True, index=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaInboundPlanItem(Base):
    __tablename__ = "amazon_fba_inbound_plan_items"
    __table_args__ = (
        UniqueConstraint(
            "inbound_plan_database_id",
            "seller_sku",
            name="uq_amazon_fba_inbound_plan_item",
        ),
        Index(
            "ix_amazon_fba_inbound_plan_items_mapping",
            "product_mapping_id",
            "product_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    inbound_plan_database_id = Column(
        Integer,
        ForeignKey("amazon_fba_inbound_plans.id"),
        nullable=False,
        index=True,
    )
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=True,
        index=True,
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    seller_sku = Column(String, nullable=False, index=True)
    asin = Column(String, nullable=True, index=True)
    fnsku = Column(String, nullable=True, index=True)
    quantity_planned = Column(Integer, nullable=False, default=0)
    prep_owner = Column(String, nullable=False, default="SELLER")
    label_owner = Column(String, nullable=False, default="SELLER")
    expiration_date = Column(String, nullable=True)
    manufacturing_lot_code = Column(String, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaShipment(Base):
    __tablename__ = "amazon_fba_shipments"
    __table_args__ = (
        UniqueConstraint(
            "amazon_account_id",
            "amazon_shipment_id",
            name="uq_amazon_fba_shipment",
        ),
        Index(
            "ix_amazon_fba_shipments_plan_status",
            "inbound_plan_database_id",
            "shipment_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    inbound_plan_database_id = Column(
        Integer,
        ForeignKey("amazon_fba_inbound_plans.id"),
        nullable=False,
        index=True,
    )
    amazon_shipment_id = Column(String, nullable=False, index=True)
    shipment_confirmation_id = Column(String, nullable=True, index=True)
    shipment_name = Column(String, nullable=True)
    amazon_reference_id = Column(String, nullable=True)
    placement_option_id = Column(String, nullable=True)
    transportation_option_id = Column(String, nullable=True)
    destination_code = Column(String, nullable=True, index=True)
    destination_country = Column(String, nullable=True)
    shipping_mode = Column(String, nullable=True)
    carrier_name = Column(String, nullable=True)
    tracking_number = Column(String, nullable=True)
    shipment_status = Column(String, nullable=False, default="WORKING", index=True)
    planned_quantity = Column(Integer, nullable=False, default=0)
    shipped_quantity = Column(Integer, nullable=False, default=0)
    received_quantity = Column(Integer, nullable=False, default=0)
    damaged_quantity = Column(Integer, nullable=False, default=0)
    missing_quantity = Column(Integer, nullable=False, default=0)
    discrepancy_quantity = Column(Integer, nullable=False, default=0)
    expected_delivery_date = Column(DateTime, nullable=True)
    received_date = Column(DateTime, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    reconciled_at = Column(DateTime, nullable=True)
    last_amazon_update = Column(DateTime, nullable=True)
    last_successful_sync = Column(DateTime, nullable=True, index=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaShipmentItem(Base):
    __tablename__ = "amazon_fba_shipment_items"
    __table_args__ = (
        UniqueConstraint(
            "shipment_database_id",
            "seller_sku",
            name="uq_amazon_fba_shipment_item",
        ),
        Index(
            "ix_amazon_fba_shipment_items_mapping",
            "product_mapping_id",
            "product_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    shipment_database_id = Column(
        Integer,
        ForeignKey("amazon_fba_shipments.id"),
        nullable=False,
        index=True,
    )
    inbound_plan_item_id = Column(
        Integer,
        ForeignKey("amazon_fba_inbound_plan_items.id"),
        nullable=True,
        index=True,
    )
    product_mapping_id = Column(
        Integer,
        ForeignKey("amazon_product_mappings.id"),
        nullable=True,
        index=True,
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    seller_sku = Column(String, nullable=False, index=True)
    asin = Column(String, nullable=True, index=True)
    fnsku = Column(String, nullable=True, index=True)
    quantity_planned = Column(Integer, nullable=False, default=0)
    quantity_shipped = Column(Integer, nullable=False, default=0)
    quantity_received = Column(Integer, nullable=False, default=0)
    quantity_damaged = Column(Integer, nullable=False, default=0)
    quantity_missing = Column(Integer, nullable=False, default=0)
    quantity_in_discrepancy = Column(Integer, nullable=False, default=0)
    last_amazon_update = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaShipmentCarton(Base):
    __tablename__ = "amazon_fba_shipment_cartons"
    __table_args__ = (
        UniqueConstraint(
            "shipment_database_id",
            "carton_reference",
            name="uq_amazon_fba_shipment_carton",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    shipment_database_id = Column(
        Integer,
        ForeignKey("amazon_fba_shipments.id"),
        nullable=False,
        index=True,
    )
    carton_reference = Column(String, nullable=False, index=True)
    amazon_package_id = Column(String, nullable=True, index=True)
    box_id = Column(String, nullable=True, index=True)
    tracking_number = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    length = Column(Float, nullable=True)
    width = Column(Float, nullable=True)
    height = Column(Float, nullable=True)
    dimension_unit = Column(String, nullable=True)
    weight = Column(Float, nullable=True)
    weight_unit = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonFbaInboundStockMovement(Base):
    __tablename__ = "amazon_fba_inbound_stock_movements"
    __table_args__ = (
        UniqueConstraint("event_key", name="uq_amazon_fba_inbound_movement_event"),
        Index(
            "ix_amazon_fba_inbound_movements_product_date",
            "product_id",
            "created_at",
        ),
        Index(
            "ix_amazon_fba_inbound_movements_shipment",
            "shipment_database_id",
            "shipment_item_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_key = Column(String, nullable=False, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    inbound_plan_database_id = Column(
        Integer,
        ForeignKey("amazon_fba_inbound_plans.id"),
        nullable=False,
        index=True,
    )
    shipment_database_id = Column(
        Integer,
        ForeignKey("amazon_fba_shipments.id"),
        nullable=False,
        index=True,
    )
    shipment_item_id = Column(
        Integer,
        ForeignKey("amazon_fba_shipment_items.id"),
        nullable=False,
        index=True,
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    movement_type = Column(String, nullable=False, index=True)
    from_location = Column(String, nullable=False, index=True)
    to_location = Column(String, nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    reconciliation_reference = Column(String, nullable=True, index=True)
    note = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class AmazonSyncJob(Base):
    __tablename__ = "amazon_sync_jobs"
    __table_args__ = (
        Index(
            "ix_amazon_sync_jobs_queue",
            "status",
            "priority",
            "scheduled_at",
        ),
        Index(
            "ix_amazon_sync_jobs_account_status",
            "amazon_account_id",
            "status",
        ),
        Index(
            "ix_amazon_sync_jobs_reference",
            "reference_type",
            "reference_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    job_type = Column(String, nullable=False, index=True)
    reference_type = Column(String, nullable=True)
    reference_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default="Pending", index=True)
    priority = Column(Integer, nullable=False, default=100)
    attempt_count = Column(Integer, nullable=False, default=0)
    maximum_attempts = Column(Integer, nullable=False, default=5)
    request_payload_sanitized = Column(Text, nullable=True)
    response_payload_sanitized = Column(Text, nullable=True)
    error_code = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    amazon_request_id = Column(String, nullable=True, index=True)
    scheduled_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    next_retry_at = Column(DateTime, nullable=True, index=True)
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class AmazonApiLog(Base):
    __tablename__ = "amazon_api_logs"
    __table_args__ = (
        Index(
            "ix_amazon_api_logs_account_created",
            "amazon_account_id",
            "created_at",
        ),
        Index(
            "ix_amazon_api_logs_operation_success",
            "operation",
            "success",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    amazon_account_id = Column(
        Integer,
        ForeignKey("amazon_accounts.id"),
        nullable=False,
        index=True,
    )
    api_name = Column(String, nullable=False, default="SP-API")
    operation = Column(String, nullable=False, index=True)
    http_status = Column(Integer, nullable=True)
    amazon_request_id = Column(String, nullable=True, index=True)
    duration_ms = Column(Integer, nullable=True)
    success = Column(Boolean, nullable=False, default=False, index=True)
    error_code = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
