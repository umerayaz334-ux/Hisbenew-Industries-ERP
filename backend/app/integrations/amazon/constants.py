"""Non-sensitive Amazon Selling Partner API constants."""

DEFAULT_MARKETPLACE_ID = "ATVPDKIKX0DER"
DEFAULT_REGION = "NA"
DEFAULT_CURRENCY = "USD"
DEFAULT_ACCOUNT_NAME = "Amazon Seller Account"

REGION_ENDPOINTS = {
    "NA": "https://sellingpartnerapi-na.amazon.com",
    "EU": "https://sellingpartnerapi-eu.amazon.com",
    "FE": "https://sellingpartnerapi-fe.amazon.com",
}

LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
SELLERS_MARKETPLACE_PARTICIPATIONS_PATH = "/sellers/v1/marketplaceParticipations"
LISTINGS_ITEMS_PATH = "/listings/2021-08-01/items"
FBA_INVENTORY_SUMMARIES_PATH = "/fba/inventory/v1/summaries"
ORDERS_PATH = "/orders/2026-01-01/orders"
FBA_INBOUND_PATH = "/inbound/fba/2024-03-20"
FBA_INBOUND_LEGACY_PATH = "/fba/inbound/v0"
FINANCES_TRANSACTIONS_PATH = "/finances/2024-06-19/transactions"
FINANCES_EVENT_GROUPS_PATH = "/finances/v0/financialEventGroups"
SP_API_USER_AGENT = "HisbenewIndustriesERP/1.0 (Language=Python/3.12)"

JOB_TYPE_LISTINGS_IMPORT = "Listings Import"
JOB_TYPE_LISTING_SYNC = "Listing Sync"
JOB_TYPE_FBA_INVENTORY_SYNC = "FBA Inventory Sync"
JOB_TYPE_FBA_ORDERS_SYNC = "FBA Orders Sync"
JOB_TYPE_FBA_ORDER_REFRESH = "FBA Order Refresh"
JOB_TYPE_FBA_INBOUND_PLANS_SYNC = "FBA Inbound Plans Sync"
JOB_TYPE_FBA_INBOUND_PLAN_SYNC = "FBA Inbound Plan Sync"
JOB_TYPE_FBA_INBOUND_SHIPMENT_REFRESH = "FBA Inbound Shipment Refresh"
JOB_TYPE_FINANCES_SYNC = "Finances Sync"
JOB_TYPE_FINANCE_BALANCE_SYNC = "Finance Balance Sync"
JOB_TYPE_PRICE_SYNC = "Price Sync"

PRICE_CHANGE_STATUSES = {
    "Pending Approval",
    "Approved",
    "Rejected",
    "Queued",
    "Processing",
    "Submitted",
    "Failed",
    "Cancelled",
}

FULFILLMENT_MODES = {"FBA", "FBM", "BOTH"}

FBA_LOGICAL_LOCATIONS = (
    ("FBA_IN_TRANSIT", "FBA In Transit"),
    ("FBA_INBOUND", "FBA Inbound"),
    ("FBA_FULFILLABLE", "FBA Fulfillable"),
    ("FBA_RESERVED", "FBA Reserved"),
    ("FBA_UNFULFILLABLE", "FBA Unfulfillable"),
    ("FBA_RESEARCHING", "FBA Researching"),
    ("AMAZON_MISSING", "Amazon Missing"),
    ("AMAZON_DAMAGED", "Amazon Damaged"),
    ("CUSTOMER_RETURNS", "Customer Returns"),
)

CONNECTION_MISSING_CREDENTIALS = "Missing Credentials"
CONNECTION_NOT_CONNECTED = "Not Connected"
CONNECTION_TESTING = "Testing"
CONNECTION_CONNECTED = "Connected"
CONNECTION_FAILED = "Connection Failed"
CONNECTION_AUTHORIZATION_EXPIRED = "Authorization Expired"
CONNECTION_PERMISSION_MISSING = "Permission Missing"
CONNECTION_DISABLED = "Disabled"

CONNECTION_STATUSES = {
    CONNECTION_MISSING_CREDENTIALS,
    CONNECTION_NOT_CONNECTED,
    CONNECTION_TESTING,
    CONNECTION_CONNECTED,
    CONNECTION_FAILED,
    CONNECTION_AUTHORIZATION_EXPIRED,
    CONNECTION_PERMISSION_MISSING,
    CONNECTION_DISABLED,
}

JOB_STATUSES = {
    "Pending",
    "Processing",
    "Completed",
    "Failed",
    "Retrying",
    "Cancelled",
}

SENSITIVE_CREDENTIAL_FIELDS = (
    "encrypted_lwa_client_id",
    "encrypted_lwa_client_secret",
    "encrypted_refresh_token",
    "encrypted_seller_id",
)
