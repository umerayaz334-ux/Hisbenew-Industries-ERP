from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form, Request, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, select
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
import asyncio
import calendar
import contextlib
import csv
from email.message import EmailMessage
from html import escape as html_escape
import io
import json
import math
import os
import re
import shutil
import sqlite3
import smtplib
import ssl
import socket
import tempfile
import uuid
import zipfile
from pathlib import Path
from ipaddress import ip_address
from xml.sax.saxutils import escape as xml_escape
from urllib.parse import urlparse
from urllib import request as urllib_request

from .config import APP_DATA_DIR, CORS_ALLOW_ORIGINS, CORS_ALLOW_ORIGIN_REGEX, FRONTEND_DIST_DIR, INTERNAL_CALL_ICE_SERVERS, STATIC_DIR, UPLOAD_DIR
from .database import Base, DEFAULT_TENANT_NAME, DEFAULT_TENANT_SLUG, engine, SessionLocal, ensure_scaling_indexes, migrate_database
from .models import Tenant, Module, TenantModule, CustomPage, Product, Customer, User, ActivityLog, UserRoleRequest, PublicAccessRequest, InternalMessage, InternalCall, InternalCallSignal, InspirationItem, OrderImportBatch, Order, OrderItem, StockMovement, Supplier, SupplierOrderItem, SupplierSupplyItem, SupplierTransaction, SupplierPayment, WorkflowStep, Worker, WorkerPayment, Shipping, FulfillmentShipment, FulfillmentBox, FulfillmentBoxItem, FulfillmentInventoryDiscrepancy, FulfillmentOrder, FulfillmentOrderItem, FulfillmentPick, CourierPayment, RegularBill, RegularBillPayment, AccountingAccount, AccountingTransaction, ProductionBatch, ProductionTask, SharedData, WorkspaceData, OrderWorkflowTask, OrderFollowUp
from .integrations.amazon import router as amazon_router
from .integrations.amazon.autosync import amazon_auto_sync_service
from .integrations.amazon.constants import (
    JOB_TYPE_FBA_ORDERS_SYNC,
    JOB_TYPE_FINANCES_SYNC,
)
from .integrations.amazon.models import (
    AmazonAccount,
    AmazonFbaInboundPlan,
    AmazonFbaInventory,
    AmazonFinancialTransaction,
    AmazonOrder,
    AmazonOrderItem,
    AmazonProductMapping,
    AmazonSettlement,
    AmazonSyncJob,
)
from .school import ensure_default_school_foundation, router as school_router
from .service_takers import router as service_taker_router
from .deployment_control import router as deployment_router
from .security import (
    create_access_token,
    decode_access_token,
    hash_pin,
    sanitize_upload_filename,
    validate_upload_extension,
    verify_pin,
)
from .realtime import realtime_hub
from .label_printing import LabelPrintError, list_label_printers, print_tspl_labels
from .product_catalog import (
    CATALOG_DOWNLOAD_TOKEN_TTL_SECONDS,
    MAX_FAIRE_WORKBOOK_BYTES,
    ProductCatalogError,
    build_product_catalog_pdf,
    create_catalog_download_token,
    decode_catalog_download_token,
    import_faire_workbook,
    verify_catalog_download_token,
)
from .usa_shipping import (
    MAX_RATE_WORKBOOK_BYTES,
    RateWorkbookError,
    activate_usa_rate_card,
    calculate_order_usa_shipping,
    normalize_service as normalize_usa_shipping_service,
    parse_usa_rate_workbook,
    usa_rate_card_summary,
)
from .schemas import (
    TenantCreate, TenantUpdate, TenantDeleteRequest, TenantOut, ModuleOut, TenantModuleUpdate,
    TenantModuleBulkUpdate, CustomPageCreate, CustomPageUpdate, CustomPageOut,
    ProductCreate, ProductOut,
    CustomerCreate, CustomerOut,
    UserCreate, UserUpdate, UserPinReset, UserOut, LoginRequest, LoginResponse, UserProfileUpdate,
    RoleRequestCreate, RoleRequestUpdate, RoleRequestOut,
    PublicAccessRequestCreate, PublicAccessRequestReview, PublicAccessRequestUpdate, PublicAccessRequestOut,
    InternalMessageCreate, InternalMessageOut, InternalMessageUserOut,
    InternalCallCreate, InternalCallAction, InternalCallOut,
    InternalCallSignalCreate, InternalCallSignalOut,
    ActivityPageViewCreate, ActivityLogOut,
    InspirationItemCreate, InspirationItemUpdate, InspirationItemOut,
    SupplierCreate, SupplierOut, SupplierPaymentCreate,
    SupplierOrderItemCreate, SupplierOrderItemReceive,
    SupplierSupplyItemBatchCreate, SupplierSupplyItemUpdate,
    OrderCreate, OrderOut, OrderPayoutUpdate,
    StockMovementOut, StockMovementUpdate,
    WorkflowStepCreate, WorkflowStepUpdate, WorkflowCopyRequest, WorkflowStepOut,
    WorkerCreate, WorkerOut, WorkerPaymentCreate, WorkerPaymentOut,
    ShippingCreate, ShippingUpdate, ShippingOut,
    FulfillmentShipmentCreate, FulfillmentShipmentOut, FulfillmentShipmentReceiptUpdate,
    FulfillmentOrderItemCreate,
    FulfillmentOrderOut, FulfillmentBoxLocationUpdate, FulfillmentBoxMergeRequest,
    FulfillmentInventoryDiscrepancyCreate, FulfillmentInventoryDiscrepancyOut,
    CourierPaymentCreate, CourierPaymentOut,
    RegularBillCreate, RegularBillUpdate, RegularBillPaymentCreate, RegularBillOut,
    AccountingAccountCreate, AccountingAccountUpdate, AccountingAccountOut,
    AccountingTransactionCreate, AccountingTransactionUpdate, AccountingTransactionOut,
    ManualProductionTaskCreate, ProductionBatchCreate, ProductionBatchUpdate, ProductionTaskAssign,
    ProductionTaskProgressUpdate, ProductionTaskComplete,
    SharedDataCreate, SharedDataOut, WorkspaceDataPayload,
    OrderWorkflowTaskCreate, OrderWorkflowTaskComplete, OrderFollowUpUpdate
)

# Dependency function must be defined before it is used in route dependencies
def get_db(request: Request):
    """Provide a transactional scope around a series of operations."""
    db = SessionLocal()
    tenant_id = getattr(getattr(request, "state", None), "tenant_id", None) if request else None
    if tenant_id is not None:
        db.info["tenant_id"] = tenant_id
    try:
        yield db
    finally:
        db.close()

from .print_agent import router as print_agent_router

# Initialize FastAPI application with a descriptive title
app = FastAPI(title="Hisbenew Industries ERP")
app.include_router(school_router)
app.include_router(amazon_router)
app.include_router(service_taker_router)
app.include_router(deployment_router)
app.include_router(print_agent_router)
app.router.add_event_handler("startup", realtime_hub.start)
app.router.add_event_handler("shutdown", realtime_hub.stop)
app.router.add_event_handler("startup", amazon_auto_sync_service.start)
app.router.add_event_handler("shutdown", amazon_auto_sync_service.stop)

ALL_ERP_PAGES = [
    "School ERP",
    "Dashboard",
    "Customers",
    "Orders",
    "Payouts",
    "Billings",
    "Accounting",
    "Shipping",
    "Shipping Balance",
    "Warehouse / Fulfillment",
    "Warehouse Dispatch",
    "Warehouse Shipments",
    "Warehouse Stock",
    "Service Takers",
    "Service Dashboard",
    "Service Products",
    "Service Inbound",
    "Service Shipments",
    "Service Charges",
    "Follow Ups",
    "Products",
    "Inventory",
    "Label Printer",
    "Label Printer 2",
    "Suppliers",
    "Manufacturing",
    "Production",
    "Workers",
    "Worker Payouts",
    "Reports",
    "Website",
    "Deployment",
    "Settings",
    "Amazon Settings",
    "Amazon Listings",
    "Amazon FBA Orders",
    "Amazon FBA Inbound",
    "Amazon Finances",
    "Amazon Pricing",
    "Quotes",
    "Add Company",
    "Companies",
    "Users",
    "Inspiration",
    "TempData",
    "Messages",
    "Copy Clipboard",
    "My Tasks",
]

TENANT_MODULE_EXCLUDED_PAGES = {"Add Company", "Companies"}

SERVICE_TAKER_PORTAL_PAGES = [
    "Service Dashboard",
    "Service Products",
    "Service Inbound",
    "Service Shipments",
    "Service Charges",
]

WORKSPACE_DATA_PAGES = {
    "copy-clipboard": "Copy Clipboard",
    "quotes": "Quotes",
    "temp-data": "TempData",
}
MAX_WORKSPACE_DATA_BYTES = 5 * 1024 * 1024

DEFAULT_WEBSITE_SETTINGS = {
    "brand_name": "Hisbenew",
    "tagline": "Handmade knives & wholesale blades",
    "meta_title": "Hisbenew | Handmade Knives, Chef Blades & Wholesale Knife Sets",
    "meta_description": (
        "Shop handmade chef knives, hunting blades, collector pieces, and wholesale "
        "knife sets from Hisbenew Industries."
    ),
    "meta_keywords": "handmade knives, chef knives, hunting knives, wholesale knives, custom blades",
    "canonical_url": "",
    "announcement_text": "Wholesale and custom knife orders are open for this season.",
    "theme_style": "atelier",
    "hero_product_id": 0,
    "hero_image_url": "",
    "hero_badge": "Custom made",
    "hero_title": "Premium custom knives designed for chefs, hunters, and wholesale buyers.",
    "hero_subtitle": (
        "Discover artisanal kitchen blades, rugged field knives, and bulk-ready sets "
        "with fast fulfillment and curated quality."
    ),
    "primary_cta_label": "Browse catalog",
    "secondary_cta_label": "Request wholesale quote",
    "contact_heading": "Ready to stock wholesale blades?",
    "contact_text": "Connect with our team for custom orders, bulk pricing, and delivery support.",
    "contact_button_label": "Contact sales",
    "phone": "",
    "email": "",
    "whatsapp": "",
    "collections_heading": "Shop by collection",
    "collections_text": "Explore focused knife categories for kitchens, outdoors, gifting, and retail shelves.",
    "featured_heading": "Featured blades",
    "featured_text": "Best-fit products selected from live ERP inventory for buyers ready to compare.",
    "about_heading": "Built for serious buyers and long-term partners.",
    "about_text": (
        "Hisbenew combines workshop finishing, practical materials, and export-ready "
        "fulfillment for retailers, chefs, collectors, and outdoor customers."
    ),
    "process_heading": "From inquiry to dispatch",
    "process_text": "Clear product selection, confirmed availability, careful packing, and reliable handoff.",
    "trust_metric_1_value": "25+",
    "trust_metric_1_label": "blade designs",
    "trust_metric_2_value": "100+",
    "trust_metric_2_label": "buyer partners",
    "trust_metric_3_value": "4.9/5",
    "trust_metric_3_label": "average feedback",
    "featured_limit": 8,
    "show_prices": True,
    "show_stock_badges": True,
    "show_featured_products": True,
    "section_order": ["hero", "trust", "collections", "featured", "about", "process", "contact"],
    "hidden_section_ids": [],
    "featured_product_ids": [],
    "hidden_product_ids": [],
    "product_order_ids": [],
}

WEBSITE_SETTINGS_FILE = APP_DATA_DIR / "website_settings.json"
EMAIL_SETTINGS_FILE = APP_DATA_DIR / "email_settings.json"
ACCESS_PRIVACY_SETTINGS_FILE = APP_DATA_DIR / "access_privacy_settings.json"
CALL_SETTINGS_FILE = APP_DATA_DIR / "call_settings.json"

DEFAULT_CALL_SETTINGS = {
    "video_calls_enabled": True,
}


class CallSettingsPayload(BaseModel):
    video_calls_enabled: bool = DEFAULT_CALL_SETTINGS["video_calls_enabled"]


def normalize_call_settings(settings: dict | None = None) -> dict:
    normalized = DEFAULT_CALL_SETTINGS.copy()
    if not isinstance(settings, dict):
        return normalized
    value = settings.get("video_calls_enabled", True)
    if isinstance(value, str):
        normalized["video_calls_enabled"] = value.strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
    else:
        normalized["video_calls_enabled"] = bool(value)
    return normalized


def load_call_settings() -> dict:
    if CALL_SETTINGS_FILE.exists():
        try:
            return normalize_call_settings(
                json.loads(CALL_SETTINGS_FILE.read_text(encoding="utf-8"))
            )
        except (OSError, json.JSONDecodeError):
            pass
    return DEFAULT_CALL_SETTINGS.copy()


def save_call_settings(settings: dict) -> dict:
    normalized = normalize_call_settings(settings)
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    CALL_SETTINGS_FILE.write_text(
        json.dumps(normalized, indent=2),
        encoding="utf-8",
    )
    return normalized

DEFAULT_ACCESS_PRIVACY_SETTINGS = {
    "hide_customer_business_for_non_admin": True,
    "hide_worker_customer_names_except_shipping": True,
    "hide_customer_phone_for_non_admin": True,
}


class AccessPrivacySettingsPayload(BaseModel):
    hide_customer_business_for_non_admin: bool = DEFAULT_ACCESS_PRIVACY_SETTINGS[
        "hide_customer_business_for_non_admin"
    ]
    hide_worker_customer_names_except_shipping: bool = DEFAULT_ACCESS_PRIVACY_SETTINGS[
        "hide_worker_customer_names_except_shipping"
    ]
    hide_customer_phone_for_non_admin: bool = DEFAULT_ACCESS_PRIVACY_SETTINGS[
        "hide_customer_phone_for_non_admin"
    ]


def default_access_privacy_settings_for_role(role: str | None = None) -> dict:
    normalized_role = str(role or "").strip().lower()
    if normalized_role in {"admin", "super_admin"}:
        return {
            "hide_customer_business_for_non_admin": False,
            "hide_worker_customer_names_except_shipping": False,
            "hide_customer_phone_for_non_admin": False,
        }
    if normalized_role in {"manager", "warehouse"}:
        return {
            "hide_customer_business_for_non_admin": True,
            "hide_worker_customer_names_except_shipping": False,
            "hide_customer_phone_for_non_admin": True,
        }
    if normalized_role == "worker":
        return DEFAULT_ACCESS_PRIVACY_SETTINGS.copy()
    return DEFAULT_ACCESS_PRIVACY_SETTINGS.copy()


def normalize_access_privacy_settings(
    settings: dict | None = None,
    role: str | None = None,
) -> dict:
    normalized = default_access_privacy_settings_for_role(role)
    if not isinstance(settings, dict):
        return normalized

    for key, default_value in DEFAULT_ACCESS_PRIVACY_SETTINGS.items():
        value = settings.get(key, default_value)
        if isinstance(value, bool):
            normalized[key] = value
        elif isinstance(value, str):
            normalized[key] = value.strip().lower() in {"1", "true", "yes", "on"}
        else:
            normalized[key] = bool(value)
    return normalized


def load_access_privacy_settings() -> dict:
    if not ACCESS_PRIVACY_SETTINGS_FILE.exists():
        return DEFAULT_ACCESS_PRIVACY_SETTINGS.copy()

    try:
        return normalize_access_privacy_settings(
            json.loads(ACCESS_PRIVACY_SETTINGS_FILE.read_text(encoding="utf-8"))
        )
    except (OSError, json.JSONDecodeError):
        return DEFAULT_ACCESS_PRIVACY_SETTINGS.copy()


def save_access_privacy_settings(settings: dict) -> dict:
    normalized = normalize_access_privacy_settings(settings)
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    ACCESS_PRIVACY_SETTINGS_FILE.write_text(
        json.dumps(normalized, indent=2),
        encoding="utf-8",
    )
    return normalized

DEFAULT_EMAIL_EVENTS = {
    "production_task_assigned": {
        "label": "Production task assigned",
        "description": "Sent when a worker is assigned to a production task.",
        "enabled": True,
        "recipients": "worker",
        "subject": "New production task: {{task_name}}",
        "preheader": "{{worker_name}}, a production task is ready for you.",
        "heading": "New production task assigned",
        "body": (
            "Hi {{worker_name}},\n\n"
            "You have been assigned {{task_name}} for {{product_name}}.\n"
            "Quantity: {{quantity}}\n"
            "Batch: {{batch_no}}\n"
            "Due: {{due_date}}\n\n"
            "Please open ERP My Tasks to start or update this work."
        ),
    },
    "manual_task_assigned": {
        "label": "Manual worker task assigned",
        "description": "Sent when a manual task is created from Workers.",
        "enabled": True,
        "recipients": "worker",
        "subject": "Manual task assigned: {{task_name}}",
        "preheader": "A manual production job was assigned in ERP.",
        "heading": "Manual task assigned",
        "body": (
            "Hi {{worker_name}},\n\n"
            "{{task_name}} has been assigned for {{product_name}}.\n"
            "Quantity: {{quantity}}\n"
            "Due: {{due_date}}\n"
            "Notes: {{notes}}\n\n"
            "Please review it in ERP My Tasks."
        ),
    },
    "batch_auto_assigned": {
        "label": "Production batch auto-assigned",
        "description": "Sent when auto-assign selects workers for batch tasks.",
        "enabled": False,
        "recipients": "worker",
        "subject": "Auto-assigned task: {{task_name}}",
        "preheader": "ERP auto-assigned a production task to you.",
        "heading": "Production work auto-assigned",
        "body": (
            "Hi {{worker_name}},\n\n"
            "ERP auto-assigned {{task_name}} for {{product_name}}.\n"
            "Batch: {{batch_no}}\n"
            "Quantity: {{quantity}}\n\n"
            "Open My Tasks to review the next step."
        ),
    },
    "order_workflow_task_assigned": {
        "label": "Order workflow task assigned",
        "description": "Sent when an order task is assigned to a worker.",
        "enabled": False,
        "recipients": "worker",
        "subject": "Order task assigned: {{task_name}}",
        "preheader": "An order workflow task needs attention.",
        "heading": "Order task assigned",
        "body": (
            "Hi {{worker_name}},\n\n"
            "You have a new {{task_name}} task for order {{order_no}}.\n"
            "Customer: {{customer_name}}\n"
            "Due: {{due_date}}\n\n"
            "Please open ERP to complete the workflow."
        ),
    },
}

DEFAULT_EMAIL_SETTINGS = {
    "enabled": False,
    "provider": "smtp",
    "from_name": "Hisbenew ERP",
    "from_email": "",
    "reply_to": "",
    "admin_recipients": "",
    "cc": "",
    "bcc": "",
    "smtp": {
        "host": "",
        "port": 587,
        "username": "",
        "password": "",
        "use_tls": True,
        "use_ssl": False,
    },
    "api": {
        "provider": "resend",
        "api_key": "",
        "endpoint": "",
        "bearer_token": "",
    },
    "style": {
        "accent_color": "#173a57",
        "background_color": "#f6f7f9",
        "button_label": "Open ERP",
        "button_url": "",
        "footer_text": "This message was sent by Hisbenew Industries ERP.",
    },
    "events": DEFAULT_EMAIL_EVENTS,
}


class WebsiteSettingsPayload(BaseModel):
    brand_name: str = DEFAULT_WEBSITE_SETTINGS["brand_name"]
    tagline: str = DEFAULT_WEBSITE_SETTINGS["tagline"]
    meta_title: str = DEFAULT_WEBSITE_SETTINGS["meta_title"]
    meta_description: str = DEFAULT_WEBSITE_SETTINGS["meta_description"]
    meta_keywords: str = DEFAULT_WEBSITE_SETTINGS["meta_keywords"]
    canonical_url: str = ""
    announcement_text: str = DEFAULT_WEBSITE_SETTINGS["announcement_text"]
    theme_style: str = DEFAULT_WEBSITE_SETTINGS["theme_style"]
    hero_product_id: int = 0
    hero_image_url: str = ""
    hero_badge: str = DEFAULT_WEBSITE_SETTINGS["hero_badge"]
    hero_title: str = DEFAULT_WEBSITE_SETTINGS["hero_title"]
    hero_subtitle: str = DEFAULT_WEBSITE_SETTINGS["hero_subtitle"]
    primary_cta_label: str = DEFAULT_WEBSITE_SETTINGS["primary_cta_label"]
    secondary_cta_label: str = DEFAULT_WEBSITE_SETTINGS["secondary_cta_label"]
    contact_heading: str = DEFAULT_WEBSITE_SETTINGS["contact_heading"]
    contact_text: str = DEFAULT_WEBSITE_SETTINGS["contact_text"]
    contact_button_label: str = DEFAULT_WEBSITE_SETTINGS["contact_button_label"]
    phone: str = ""
    email: str = ""
    whatsapp: str = ""
    collections_heading: str = DEFAULT_WEBSITE_SETTINGS["collections_heading"]
    collections_text: str = DEFAULT_WEBSITE_SETTINGS["collections_text"]
    featured_heading: str = DEFAULT_WEBSITE_SETTINGS["featured_heading"]
    featured_text: str = DEFAULT_WEBSITE_SETTINGS["featured_text"]
    about_heading: str = DEFAULT_WEBSITE_SETTINGS["about_heading"]
    about_text: str = DEFAULT_WEBSITE_SETTINGS["about_text"]
    process_heading: str = DEFAULT_WEBSITE_SETTINGS["process_heading"]
    process_text: str = DEFAULT_WEBSITE_SETTINGS["process_text"]
    trust_metric_1_value: str = DEFAULT_WEBSITE_SETTINGS["trust_metric_1_value"]
    trust_metric_1_label: str = DEFAULT_WEBSITE_SETTINGS["trust_metric_1_label"]
    trust_metric_2_value: str = DEFAULT_WEBSITE_SETTINGS["trust_metric_2_value"]
    trust_metric_2_label: str = DEFAULT_WEBSITE_SETTINGS["trust_metric_2_label"]
    trust_metric_3_value: str = DEFAULT_WEBSITE_SETTINGS["trust_metric_3_value"]
    trust_metric_3_label: str = DEFAULT_WEBSITE_SETTINGS["trust_metric_3_label"]
    featured_limit: int = DEFAULT_WEBSITE_SETTINGS["featured_limit"]
    show_prices: bool = DEFAULT_WEBSITE_SETTINGS["show_prices"]
    show_stock_badges: bool = DEFAULT_WEBSITE_SETTINGS["show_stock_badges"]
    show_featured_products: bool = DEFAULT_WEBSITE_SETTINGS["show_featured_products"]
    section_order: list[str] = Field(default_factory=lambda: DEFAULT_WEBSITE_SETTINGS["section_order"].copy())
    hidden_section_ids: list[str] = Field(default_factory=list)
    featured_product_ids: list[int] = Field(default_factory=list)
    hidden_product_ids: list[int] = Field(default_factory=list)
    product_order_ids: list[int] = Field(default_factory=list)

SUPER_ADMIN_PLATFORM_PAGES = ["Dashboard", "Add Company", "Companies", "Users", "Settings"]

ROLE_PAGE_DEFAULTS = {
    "super_admin": SUPER_ADMIN_PLATFORM_PAGES.copy(),
    "admin": [
        page
        for page in ALL_ERP_PAGES
        if page not in {"My Tasks", "Add Company", "Companies"} and page not in SERVICE_TAKER_PORTAL_PAGES
    ],
    "manager": [
        "Dashboard",
        "Customers",
        "Orders",
        "Payouts",
        "Billings",
        "Accounting",
        "Shipping",
        "Shipping Balance",
        "Warehouse / Fulfillment",
        "Follow Ups",
        "Products",
        "Inventory",
        "Label Printer",
        "Suppliers",
        "Manufacturing",
        "Production",
        "Worker Payouts",
        "Reports",
        "Website",
        "Settings",
        "Quotes",
        "Inspiration",
        "TempData",
        "Messages",
        "Copy Clipboard",
    ],
    "warehouse": [
        "Dashboard",
        "Warehouse Dispatch",
        "Warehouse Shipments",
        "Warehouse Stock",
        "Label Printer",
        "Messages",
        "Settings",
    ],
    "worker": ["Dashboard", "My Tasks", "Worker Payouts", "Manufacturing", "Production", "Messages", "Settings"],
    "unassigned": ["Dashboard"],
    "school": ["Dashboard"],
    "service_taker": SERVICE_TAKER_PORTAL_PAGES.copy(),
}

PAGE_PARENT_MAP = {
    "Payouts": "Orders",
    "Billings": "Orders",
    "Accounting": "Orders",
    "Follow Ups": "Orders",
    "Shipping Balance": "Shipping",
    "Warehouse / Fulfillment": "Shipping",
    "Warehouse Dispatch": "Warehouse / Fulfillment",
    "Warehouse Shipments": "Warehouse / Fulfillment",
    "Warehouse Stock": "Warehouse / Fulfillment",
    "Service Takers": "Shipping",
    "Inventory": "Products",
    "Label Printer": "Products",
    "Suppliers": "Products",
    "Production": "Manufacturing",
    "Workers": "Manufacturing",
    "Worker Payouts": "Manufacturing",
    "Quotes": "Settings",
    "Users": "Settings",
    "Add Company": "Settings",
    "Companies": "Settings",
    "Website": "Settings",
    "Deployment": "Settings",
    "Amazon Settings": "Settings",
    "Amazon Listings": "Products",
    "Amazon FBA Orders": "Products",
    "Amazon FBA Inbound": "Products",
    "Amazon Finances": "Accounting",
    "Amazon Pricing": "Products",
    "Inspiration": "Products",
    "Copy Clipboard": "Settings",
}


def normalize_username(username: str | None, name: str) -> str:
    return (username or name).strip()


def normalize_allowed_pages(role: str, pages: list[str] | None) -> list[str]:
    if role == "service_taker":
        return SERVICE_TAKER_PORTAL_PAGES.copy()
    if role == "super_admin":
        return SUPER_ADMIN_PLATFORM_PAGES.copy()
    requested = ROLE_PAGE_DEFAULTS.get(role, ROLE_PAGE_DEFAULTS["worker"]) if pages is None else pages
    if role == "unassigned":
        requested = ROLE_PAGE_DEFAULTS[role]
    normalized = []

    for page in requested:
        if page == "Payments":
            page = "Billings"
        if page not in ALL_ERP_PAGES or page in normalized:
            continue
        normalized.append(page)

    for admin_page in (
        "Deployment",
        "Amazon Settings",
        "Amazon Listings",
        "Amazon FBA Orders",
        "Amazon FBA Inbound",
        "Amazon Finances",
        "Amazon Pricing",
        "Service Takers",
    ):
        if role in {"admin", "super_admin"} and admin_page not in normalized:
            normalized.append(admin_page)
        if role not in {"admin", "super_admin"} and admin_page in normalized:
            normalized.remove(admin_page)
    for service_page in SERVICE_TAKER_PORTAL_PAGES:
        if service_page in normalized:
            normalized.remove(service_page)

    can_print_product_labels = role in {"admin", "super_admin", "manager"} and "Products" in normalized
    can_print_warehouse_labels = role == "warehouse" and any(
        page in normalized
        for page in ("Warehouse / Fulfillment", "Warehouse Dispatch", "Warehouse Shipments", "Warehouse Stock")
    )
    if (can_print_product_labels or can_print_warehouse_labels) and "Label Printer" not in normalized:
        normalized.append("Label Printer")
    if "Dashboard" not in normalized:
        normalized.insert(0, "Dashboard")
    return normalized


def normalize_session_expiry_minutes(value: int | None) -> int:
    if value is None:
        return 0
    return max(0, int(value))

TENANT_ADMIN_ROLES = {"admin", "super_admin"}
TENANT_ALWAYS_ALLOWED_PAGES = {"Dashboard", "Settings", "Users"}
SCRATCH_COMPANY_NAME = "Cuterex"
SCRATCH_COMPANY_SLUG = "cuterex"
SCRATCH_COMPANY_ADMIN_USERNAME = "Cuterex"
SCRATCH_COMPANY_ADMIN_PIN = "1234"


def slugify_tenant_value(value: str | None, fallback: str = "tenant") -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    cleaned = cleaned.strip("-")
    return cleaned or fallback


def normalize_tenant_status(status: str | None) -> str:
    cleaned = str(status or "active").strip().lower()
    if cleaned not in {"active", "inactive"}:
        raise HTTPException(status_code=400, detail="Tenant status must be active or inactive")
    return cleaned


def is_tenant_admin(user: User | None) -> bool:
    return bool(user and user.role in TENANT_ADMIN_ROLES)


def get_default_tenant(db: Session) -> Tenant:
    tenant = (
        db.query(Tenant)
        .execution_options(skip_tenant_scope=True)
        .filter(Tenant.slug == DEFAULT_TENANT_SLUG)
        .first()
    )
    if tenant:
        if tenant.company_name != DEFAULT_TENANT_NAME:
            tenant.company_name = DEFAULT_TENANT_NAME
            tenant.updated_at = datetime.utcnow()
            db.add(tenant)
            db.commit()
            db.refresh(tenant)
        return tenant

    tenant = Tenant(
        company_name=DEFAULT_TENANT_NAME,
        slug=DEFAULT_TENANT_SLUG,
        status="active",
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def get_or_create_company_tenant(
    db: Session,
    *,
    company_name: str,
    slug: str,
    status: str = "active",
) -> Tenant:
    clean_slug = slugify_tenant_value(slug)
    tenant = tenant_for_slug(db, clean_slug)
    if tenant:
        changed = False
        if tenant.company_name != company_name:
            tenant.company_name = company_name
            changed = True
        if (tenant.status or "active") != status:
            tenant.status = status
            changed = True
        if changed:
            tenant.updated_at = datetime.utcnow()
            db.add(tenant)
            db.flush()
        return tenant

    tenant = Tenant(
        company_name=company_name,
        slug=clean_slug,
        status=status,
    )
    db.add(tenant)
    db.flush()
    return tenant


def get_tenant_or_404(db: Session, tenant_id: int) -> Tenant:
    tenant = (
        db.query(Tenant)
        .execution_options(skip_tenant_scope=True)
        .filter(Tenant.id == tenant_id)
        .first()
    )
    if not tenant:
        raise HTTPException(status_code=404, detail="Company tenant not found")
    return tenant


def tenant_for_slug(db: Session, slug: str | None) -> Tenant | None:
    clean_slug = slugify_tenant_value(slug, "")
    if not clean_slug:
        return None
    return (
        db.query(Tenant)
        .execution_options(skip_tenant_scope=True)
        .filter(Tenant.slug == clean_slug)
        .first()
    )


def require_tenant_admin(request: Request, db: Session) -> User:
    user = get_authenticated_user(request, db)
    if not is_tenant_admin(user):
        raise HTTPException(status_code=403, detail="Company admin access is required.")
    return user


def require_super_admin(request: Request, db: Session) -> User:
    user = get_authenticated_user(request, db)
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access is required")
    return user


def tenant_id_for_write(
    request: Request,
    db: Session,
    requested_tenant_id: int | None = None,
) -> int:
    user = require_tenant_admin(request, db)
    if user.role == "super_admin" and requested_tenant_id is not None:
        return get_tenant_or_404(db, requested_tenant_id).id
    if user.tenant_id is not None:
        if requested_tenant_id is not None and requested_tenant_id != user.tenant_id:
            raise HTTPException(status_code=403, detail="This user cannot write into another company tenant.")
        return user.tenant_id
    return get_default_tenant(db).id


TENANT_PAGE_SET_CACHE_KEY = "tenant_enabled_page_sets"


def clear_tenant_page_set_cache(db: Session, tenant_id: int | None = None) -> None:
    cache = db.info.get(TENANT_PAGE_SET_CACHE_KEY)
    if not cache:
        return
    if tenant_id is None:
        cache.clear()
        return
    cache.pop(int(tenant_id), None)


def tenant_enabled_page_set(db: Session, tenant_id: int | None) -> tuple[set[str], set[str]]:
    if tenant_id is None:
        return set(), set()
    cache = db.info.setdefault(TENANT_PAGE_SET_CACHE_KEY, {})
    cache_key = int(tenant_id)
    if cache_key in cache:
        return cache[cache_key]
    rows = (
        db.query(TenantModule, Module)
        .execution_options(skip_tenant_scope=True)
        .join(Module, Module.id == TenantModule.module_id)
        .filter(TenantModule.tenant_id == tenant_id)
        .all()
    )
    enabled = {
        module.page_name
        for tenant_module, module in rows
        if tenant_module.enabled and module.page_name
    }
    disabled = {
        module.page_name
        for tenant_module, module in rows
        if not tenant_module.enabled and module.page_name
    }
    cache[cache_key] = (enabled, disabled)
    return cache[cache_key]


def tenant_filtered_allowed_pages(
    db: Session | None,
    tenant_id: int | None,
    pages: list[str],
) -> list[str]:
    if db is None or tenant_id is None:
        return pages
    enabled, disabled = tenant_enabled_page_set(db, tenant_id)
    known_pages = enabled | disabled
    if not known_pages:
        return pages
    return [
        page
        for page in pages
        if page in TENANT_ALWAYS_ALLOWED_PAGES or page not in known_pages or page in enabled
    ]


def tenant_response(tenant: Tenant, db: Session) -> dict:
    user_count = (
        db.query(func.count(User.id))
        .execution_options(skip_tenant_scope=True)
        .filter(User.tenant_id == tenant.id)
        .scalar()
        or 0
    )
    return {
        "id": tenant.id,
        "company_name": tenant.company_name,
        "slug": tenant.slug,
        "email": tenant.email,
        "phone": tenant.phone,
        "logo": tenant.logo,
        "status": tenant.status or "active",
        "user_count": user_count,
        "created_at": tenant.created_at or tenant.updated_at or datetime.utcnow(),
        "updated_at": tenant.updated_at,
    }


def module_response(module: Module, enabled: bool = True) -> dict:
    return {
        "id": module.id,
        "name": module.name,
        "slug": module.slug,
        "page_name": module.page_name,
        "description": module.description,
        "default_enabled": bool(module.default_enabled),
        "enabled": bool(enabled),
    }


def custom_page_response(page: CustomPage) -> dict:
    try:
        fields = json.loads(page.fields_json or "[]")
    except (TypeError, json.JSONDecodeError):
        fields = []
    return {
        "id": page.id,
        "tenant_id": page.tenant_id,
        "page_name": page.page_name,
        "slug": page.slug,
        "fields": fields if isinstance(fields, list) else [],
        "is_active": bool(page.is_active),
        "created_at": page.created_at,
        "updated_at": page.updated_at,
    }


def user_customer_privacy_settings(user: User | None) -> dict:
    if not user:
        return default_access_privacy_settings_for_role(None)
    try:
        stored_settings = (
            json.loads(user.customer_privacy_settings)
            if user.customer_privacy_settings
            else None
        )
    except (TypeError, json.JSONDecodeError):
        stored_settings = None
    return normalize_access_privacy_settings(stored_settings, user.role)


def create_user_access_token(user: User) -> str:
    session_expiry_minutes = normalize_session_expiry_minutes(
        user.session_expiry_minutes
    )
    if session_expiry_minutes == 0:
        return create_access_token(subject=user.id, never_expires=True)
    return create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=session_expiry_minutes),
    )


def user_response(user: User, db: Session | None = None) -> dict:
    try:
        stored_pages = json.loads(user.allowed_pages) if user.allowed_pages else None
    except (TypeError, json.JSONDecodeError):
        stored_pages = None

    return {
        "id": user.id,
        "tenant_id": user.tenant_id,
        "tenant_name": user.tenant.company_name if user.tenant else None,
        "tenant_slug": user.tenant.slug if user.tenant else None,
        "name": user.name,
        "username": user.username or user.name,
        "pin": user.raw_pin if user.raw_pin else ("0000" if not user.pin or user.pin.startswith("pbkdf2_sha256$") else user.pin),
        "role": user.role,
        "phone": user.phone,
        "email": user.email,
        "allowed_pages": tenant_filtered_allowed_pages(
            db,
            user.tenant_id,
            normalize_allowed_pages(user.role, stored_pages),
        ),
        "customer_privacy_settings": user_customer_privacy_settings(user),
        "session_expiry_minutes": normalize_session_expiry_minutes(
            user.session_expiry_minutes
        ),
        "is_active": user.is_active,
        "worker_id": user.worker_id,
        "last_login": user.last_login,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


PUBLIC_ACCESS_WORKSPACE_ROLE_HINTS = {
    "factory operations": "manager",
    "warehouse and fulfillment": "warehouse",
    "warehouse / fulfillment": "warehouse",
    "finance and accounting": "manager",
    "school erp": "unassigned",
    "service taker portal": "unassigned",
}


def suggested_role_for_public_request(requested_workspace: str | None) -> str:
    clean_workspace = (requested_workspace or "").strip().lower()
    return PUBLIC_ACCESS_WORKSPACE_ROLE_HINTS.get(clean_workspace, "unassigned")


def public_access_request_response(access_request: PublicAccessRequest, db: Session | None = None) -> dict:
    tenant = None
    if db is not None and access_request.tenant_id is not None:
        tenant = (
            db.query(Tenant)
            .execution_options(skip_tenant_scope=True)
            .filter(Tenant.id == access_request.tenant_id)
            .first()
        )
    return {
        "id": access_request.id,
        "tenant_id": access_request.tenant_id,
        "tenant_name": tenant.company_name if tenant else None,
        "tenant_slug": tenant.slug if tenant else None,
        "full_name": access_request.full_name,
        "preferred_username": access_request.preferred_username,
        "work_email": access_request.work_email,
        "phone": access_request.phone,
        "requested_workspace": access_request.requested_workspace,
        "suggested_role": suggested_role_for_public_request(access_request.requested_workspace),
        "message": access_request.message,
        "status": access_request.status,
        "admin_note": access_request.admin_note,
        "approved_user_id": access_request.approved_user_id,
        "reviewed_by_user_id": access_request.reviewed_by_user_id,
        "reviewed_at": access_request.reviewed_at,
        "created_at": access_request.created_at,
        "updated_at": access_request.updated_at,
    }

def role_request_response(role_request: UserRoleRequest) -> dict:
    return {
        "id": role_request.id,
        "user_id": role_request.user_id,
        "user_name": role_request.user_name,
        "username": role_request.username,
        "requested_role": role_request.requested_role,
        "contact_phone": role_request.contact_phone,
        "contact_email": role_request.contact_email,
        "message": role_request.message,
        "status": role_request.status,
        "admin_note": role_request.admin_note,
        "reviewed_at": role_request.reviewed_at,
        "created_at": role_request.created_at,
        "updated_at": role_request.updated_at,
    }


def internal_message_response(message: InternalMessage, current_user_id: int) -> dict:
    return {
        "id": message.id,
        "sender_user_id": message.sender_user_id,
        "recipient_user_id": message.recipient_user_id,
        "sender_name": message.sender.name if message.sender else "User",
        "recipient_name": message.recipient.name if message.recipient else "User",
        "body": message.body,
        "read_at": message.read_at,
        "created_at": message.created_at,
        "is_mine": message.sender_user_id == current_user_id,
    }


ACTIVE_INTERNAL_CALL_STATUSES = ("ringing", "accepted")
TERMINAL_INTERNAL_CALL_STATUSES = ("declined", "cancelled", "ended", "missed", "failed")


def internal_call_response(call: InternalCall, current_user_id: int) -> dict:
    is_incoming = call.recipient_user_id == current_user_id
    other_user = call.caller if is_incoming else call.recipient
    return {
        "id": call.id,
        "caller_user_id": call.caller_user_id,
        "caller_name": call.caller.name if call.caller else "User",
        "recipient_user_id": call.recipient_user_id,
        "recipient_name": call.recipient.name if call.recipient else "User",
        "call_type": call.call_type or "audio",
        "other_user_id": other_user.id if other_user else 0,
        "other_user_name": other_user.name if other_user else "User",
        "other_user_role": other_user.role if other_user else None,
        "status": call.status,
        "is_incoming": is_incoming,
        "answered_at": call.answered_at,
        "ended_at": call.ended_at,
        "ended_by_user_id": call.ended_by_user_id,
        "created_at": call.created_at,
        "updated_at": call.updated_at,
    }


def internal_call_signal_response(signal: InternalCallSignal) -> dict:
    try:
        payload = json.loads(signal.payload)
    except (TypeError, json.JSONDecodeError):
        payload = {}
    return {
        "id": signal.id,
        "call_id": signal.call_id,
        "sender_user_id": signal.sender_user_id,
        "signal_type": signal.signal_type,
        "payload": payload,
        "created_at": signal.created_at,
    }


def publish_internal_message(message: InternalMessage) -> None:
    for user_id in {message.sender_user_id, message.recipient_user_id}:
        realtime_hub.publish_from_thread(
            [user_id],
            {
                "type": "message.created",
                "message": internal_message_response(message, user_id),
            },
        )


def publish_internal_call(call: InternalCall) -> None:
    for user_id in {call.caller_user_id, call.recipient_user_id}:
        realtime_hub.publish_from_thread(
            [user_id],
            {
                "type": "call.updated",
                "call": internal_call_response(call, user_id),
            },
        )


def publish_internal_call_signal(call: InternalCall, signal: InternalCallSignal) -> None:
    recipient_user_id = (
        call.recipient_user_id
        if signal.sender_user_id == call.caller_user_id
        else call.caller_user_id
    )
    realtime_hub.publish_from_thread(
        [recipient_user_id],
        {
            "type": "call.signal",
            "call_id": call.id,
            "signal": internal_call_signal_response(signal),
        },
    )


def expire_stale_internal_calls(db: Session) -> None:
    now = datetime.utcnow()
    ring_cutoff = now - timedelta(seconds=60)
    participant_cutoff = now - timedelta(seconds=35)
    stale_ringing = (
        db.query(InternalCall)
        .filter(
            InternalCall.status == "ringing",
            InternalCall.created_at < ring_cutoff,
        )
        .all()
    )
    stale_accepted = (
        db.query(InternalCall)
        .filter(
            InternalCall.status == "accepted",
            or_(
                InternalCall.caller_last_seen_at.is_(None),
                InternalCall.recipient_last_seen_at.is_(None),
                InternalCall.caller_last_seen_at < participant_cutoff,
                InternalCall.recipient_last_seen_at < participant_cutoff,
            ),
        )
        .all()
    )
    if not stale_ringing and not stale_accepted:
        return
    for call in stale_ringing:
        call.status = "missed"
        call.ended_at = now
    for call in stale_accepted:
        call.status = "failed"
        call.ended_at = now
    db.commit()
    for call in (*stale_ringing, *stale_accepted):
        publish_internal_call(call)


def touch_internal_call_participant(
    db: Session,
    call: InternalCall,
    current_user_id: int,
) -> None:
    if call.status not in ACTIVE_INTERNAL_CALL_STATUSES:
        return
    now = datetime.utcnow()
    refresh_cutoff = now - timedelta(seconds=5)
    field_name = (
        "caller_last_seen_at"
        if call.caller_user_id == current_user_id
        else "recipient_last_seen_at"
    )
    last_seen = getattr(call, field_name)
    if last_seen and last_seen >= refresh_cutoff:
        return
    setattr(call, field_name, now)
    db.commit()


def get_internal_call_for_user(db: Session, call_id: int, user_id: int) -> InternalCall:
    call = (
        db.query(InternalCall)
        .filter(
            InternalCall.id == call_id,
            or_(
                InternalCall.caller_user_id == user_id,
                InternalCall.recipient_user_id == user_id,
            ),
        )
        .first()
    )
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call


def get_authenticated_user(request: Request, db: Session) -> User:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    authenticated_user = getattr(request.state, "authenticated_user", None)
    if authenticated_user and authenticated_user.id == user_id and authenticated_user.is_active:
        return authenticated_user

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


def require_page_access(request: Request, db: Session, page: str) -> User:
    user = get_authenticated_user(request, db)

    try:
        stored_pages = json.loads(user.allowed_pages) if user.allowed_pages else None
    except (TypeError, json.JSONDecodeError):
        stored_pages = None

    allowed_pages = tenant_filtered_allowed_pages(
        db,
        user.tenant_id,
        normalize_allowed_pages(user.role, stored_pages),
    )
    if page not in allowed_pages:
        raise HTTPException(status_code=403, detail=f"{page} access is required.")
    return user


def ensure_username_available(
    db: Session, username: str, excluded_user_id: int | None = None
) -> None:
    query = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(func.lower(func.coalesce(User.username, User.name)) == username.lower())
    )
    if excluded_user_id is not None:
        query = query.filter(User.id != excluded_user_id)
    if query.first():
        raise HTTPException(status_code=400, detail="Username is already in use")


ENTITY_LABELS = {
    "products": "product",
    "customers": "customer",
    "orders": "order",
    "suppliers": "supplier",
    "stock-movements": "stock movement",
    "workflow-steps": "workflow operation",
    "workers": "worker",
    "worker-payments": "worker payment",
    "shipping": "shipping record",
    "fulfillment": "fulfillment",
    "courier-payments": "courier payment",
    "regular-bills": "regular bill",
    "accounting": "accounting record",
    "production": "production",
    "users": "user",
    "inspiration": "inspiration item",
}

ACTION_LABELS = {
    "POST": "added",
    "PUT": "updated",
    "PATCH": "updated",
    "DELETE": "removed",
}


def parse_actor_from_request(request: Request) -> tuple[int | None, str | None]:
    raw_user_id = request.headers.get("x-erp-user-id")
    actor_user_id = None
    if raw_user_id:
        try:
            actor_user_id = int(raw_user_id)
        except ValueError:
            actor_user_id = None
    actor_user_name = request.headers.get("x-erp-user-name") or None
    return actor_user_id, actor_user_name


def describe_activity_request(method: str, path: str) -> dict:
    segments = [segment for segment in path.strip("/").split("/") if segment]
    root = segments[0] if segments else "record"
    action = ACTION_LABELS.get(method, method.lower())
    entity_type = ENTITY_LABELS.get(root, root.replace("-", " "))
    entity_id = next((segment for segment in segments[1:] if segment.isdigit()), None)

    if root == "products" and len(segments) > 2 and segments[2] == "update-stock":
        entity_type = "stock"
        summary = f"Updated stock #{entity_id}" if entity_id else "Updated stock"
    elif root == "regular-bills" and "payments" in segments:
        entity_type = "bill payment"
        summary = f"{action.capitalize()} bill payment"
    elif root == "production":
        entity_type = "production"
        summary = f"{action.capitalize()} production record"
    else:
        summary = f"{action.capitalize()} {entity_type}"
        if entity_id:
            summary = f"{summary} #{entity_id}"

    return {
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "summary": summary,
    }


def customer_name(customer: Customer | None) -> str:
    if not customer:
        return "Unknown customer"
    return customer.company_name or customer.name or f"Customer #{customer.id}"


def access_privacy_context(request: Request, db: Session) -> dict:
    user = get_authenticated_user(request, db)
    return {
        "user_id": user.id,
        "role": (user.role or "").strip().lower(),
        "settings": user_customer_privacy_settings(user),
    }


def access_privacy_role(privacy: dict | None) -> str:
    return str((privacy or {}).get("role") or "admin").strip().lower()


def access_privacy_settings(privacy: dict | None) -> dict:
    return normalize_access_privacy_settings(
        (privacy or {}).get("settings"),
        (privacy or {}).get("role"),
    )


def access_privacy_is_non_admin(privacy: dict | None) -> bool:
    return access_privacy_role(privacy) not in {"admin", "super_admin"}


def access_privacy_hides_customer_business(privacy: dict | None) -> bool:
    settings = access_privacy_settings(privacy)
    return bool(settings.get("hide_customer_business_for_non_admin", True))


def access_privacy_hides_customer_phone(privacy: dict | None) -> bool:
    settings = access_privacy_settings(privacy)
    return bool(settings.get("hide_customer_phone_for_non_admin", True))


def access_privacy_is_shipping_task(task_type: str | None) -> bool:
    return str(task_type or "").strip().lower() == "shipping"


def access_privacy_hides_worker_customer_name(
    privacy: dict | None,
    task_type: str | None = None,
) -> bool:
    settings = access_privacy_settings(privacy)
    return (
        settings.get("hide_worker_customer_names_except_shipping", True)
        and not access_privacy_is_shipping_task(task_type)
    )


def customer_personal_label(customer: Customer | None, order: Order | None = None) -> str:
    values = [
        customer.name if customer else "",
        order.import_contact_name if order else "",
        order.import_shipping_name if order else "",
        order.import_customer_name if order else "",
    ]
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned:
            return cleaned
    return f"Customer #{customer.id}" if customer else "Unknown customer"


def privacy_customer_phone(customer: Customer | None, privacy: dict | None = None) -> str:
    if not customer or access_privacy_hides_customer_phone(privacy):
        return ""
    return customer.phone or ""


def privacy_order_contact_phone(order: Order | None, privacy: dict | None = None) -> str:
    if not order or access_privacy_hides_customer_phone(privacy):
        return ""
    return order.import_contact_phone or ""


def privacy_shipping_phone(order: Order | None, privacy: dict | None = None) -> str:
    if not order:
        return ""
    return privacy_order_contact_phone(order, privacy) or privacy_customer_phone(order.customer, privacy)


def customer_response(customer: Customer, privacy: dict | None = None) -> dict:
    return {
        "id": customer.id,
        "name": customer.name,
        "company_name": None
        if access_privacy_hides_customer_business(privacy)
        else customer.company_name,
        "email": customer.email,
        "phone": None if access_privacy_hides_customer_phone(privacy) else customer.phone,
        "country": customer.country,
        "address": customer.address,
        "shipping_address": customer.shipping_address,
        "platform": customer.platform,
    }


def order_activity_context(order: Order | None) -> dict | None:
    if not order:
        return None
    return {
        "entity_id": order.order_no,
        "detail": customer_name(order.customer),
    }


def enrich_activity_context(
    db: Session,
    context: dict,
    method: str,
    path: str,
    query_params=None,
) -> dict:
    segments = [segment for segment in path.strip("/").split("/") if segment]
    root = segments[0] if segments else ""
    entity_id = next((segment for segment in segments[1:] if segment.isdigit()), None)
    action = context["action"]

    def latest(model):
        return db.query(model).order_by(model.id.desc()).first()

    try:
        if root == "orders":
            order = (
                latest(Order)
                if method == "POST"
                else db.query(Order).filter(Order.id == int(entity_id)).first()
                if entity_id
                else None
            )
            order_context = order_activity_context(order)
            if order_context:
                context.update(order_context)
                context["summary"] = f"{action.capitalize()} order {order.order_no}"

        elif root == "customers":
            customer = (
                latest(Customer)
                if method == "POST"
                else db.query(Customer).filter(Customer.id == int(entity_id)).first()
                if entity_id
                else None
            )
            if customer:
                label = customer_name(customer)
                context["entity_id"] = customer.id
                context["detail"] = customer.email or customer.phone or "Customer"
                context["summary"] = f"{action.capitalize()} customer {label}"

        elif root == "shipping":
            shipping = None
            is_mark_shipped = len(segments) > 1 and segments[1] == "mark-shipped"
            if is_mark_shipped:
                order_id = query_params.get("order_id") if query_params else None
                order = (
                    db.query(Order).filter(Order.id == int(order_id)).first()
                    if order_id and str(order_id).isdigit()
                    else None
                )
                if order:
                    context["entity_id"] = order.order_no
                    context["detail"] = customer_name(order.customer)
                    context["summary"] = f"Marked order {order.order_no} shipped"
                    return context
                shipping = latest(Shipping)
            elif entity_id:
                shipping = db.query(Shipping).filter(Shipping.id == int(entity_id)).first()

            if shipping and shipping.order:
                context["entity_id"] = shipping.order.order_no
                context["detail"] = customer_name(shipping.order.customer)
                context["summary"] = (
                    f"Marked order {shipping.order.order_no} shipped"
                    if is_mark_shipped
                    else f"{action.capitalize()} shipping for order {shipping.order.order_no}"
                )

        elif root == "fulfillment":
            section = segments[1] if len(segments) > 1 else ""
            if section == "shipments":
                shipment = (
                    latest(FulfillmentShipment)
                    if method == "POST" and not entity_id
                    else db.query(FulfillmentShipment).filter(FulfillmentShipment.id == int(entity_id)).first()
                    if entity_id
                    else None
                )
                if shipment:
                    context["entity_type"] = "fulfillment shipment"
                    context["entity_id"] = shipment.shipment_no
                    context["detail"] = shipment.destination_name or shipment.source_stock
                    context["summary"] = f"{action.capitalize()} fulfillment shipment {shipment.shipment_no}"
            elif section == "orders":
                order = (
                    latest(FulfillmentOrder)
                    if method == "POST" and not entity_id
                    else db.query(FulfillmentOrder).filter(FulfillmentOrder.id == int(entity_id)).first()
                    if entity_id
                    else None
                )
                if order:
                    context["entity_type"] = "fulfillment order"
                    context["entity_id"] = order.fulfillment_order_no
                    context["detail"] = order.customer_name or order.platform
                    context["summary"] = (
                        f"Marked fulfillment order {order.fulfillment_order_no} shipped"
                        if "ship" in segments
                        else f"{action.capitalize()} fulfillment order {order.fulfillment_order_no}"
                    )

        elif root == "products":
            product = (
                latest(Product)
                if method == "POST"
                else db.query(Product).filter(Product.id == int(entity_id)).first()
                if entity_id
                else None
            )
            if product:
                context["entity_id"] = product.article_no
                context["detail"] = product.name
                if len(segments) > 2 and segments[2] == "update-stock":
                    context["summary"] = f"Updated stock {product.article_no}"
                else:
                    context["summary"] = f"{action.capitalize()} product {product.article_no}"

        elif root == "suppliers":
            supplier = (
                latest(Supplier)
                if method == "POST"
                else db.query(Supplier).filter(Supplier.id == int(entity_id)).first()
                if entity_id
                else None
            )
            if supplier:
                context["entity_id"] = supplier.id
                context["detail"] = supplier.phone or supplier.email or "Supplier"
                context["summary"] = f"{action.capitalize()} supplier {supplier.name}"

        elif root == "regular-bills":
            bill_id = segments[1] if len(segments) > 1 and segments[1].isdigit() else None
            bill = (
                latest(RegularBill)
                if method == "POST" and not bill_id
                else db.query(RegularBill).filter(RegularBill.id == int(bill_id)).first()
                if bill_id
                else None
            )
            if bill:
                context["entity_id"] = bill.id
                context["detail"] = bill.vendor or bill.category or "Regular bill"
                context["summary"] = (
                    f"{action.capitalize()} payment for {bill.name}"
                    if "payments" in segments
                    else f"{action.capitalize()} bill {bill.name}"
                )

    except Exception as enrich_error:
        print(f"Activity enrichment failed: {enrich_error}")

    return context


def activity_log_response(activity: ActivityLog) -> dict:
    return {
        "id": activity.id,
        "tenant_id": activity.tenant_id,
        "actor_user_id": activity.actor_user_id,
        "actor_user_name": activity.actor_user_name,
        "action": activity.action,
        "entity_type": activity.entity_type,
        "entity_id": activity.entity_id,
        "summary": activity.summary,
        "detail": activity.detail,
        "page": activity.page,
        "request_method": activity.request_method,
        "request_path": activity.request_path,
        "created_at": activity.created_at,
    }


def record_activity(
    db: Session,
    *,
    actor_user_id: int | None,
    actor_user_name: str | None,
    action: str,
    summary: str,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    detail: str | None = None,
    page: str | None = None,
    request_method: str | None = None,
    request_path: str | None = None,
) -> ActivityLog:
    if actor_user_id is None and not actor_user_name:
        actor_user_name = "System"

    activity = ActivityLog(
        actor_user_id=actor_user_id,
        actor_user_name=actor_user_name,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        summary=summary,
        detail=detail,
        page=page,
        request_method=request_method,
        request_path=request_path,
        created_at=datetime.utcnow(),
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def should_audit_request(request: Request, status_code: int) -> bool:
    if request.method not in ACTION_LABELS:
        return False
    if status_code < 200 or status_code >= 400:
        return False

    path = request.url.path
    skipped_prefixes = (
        "/activity-logs",
        "/login",
        "/static",
        "/health",
    )
    if path.startswith(skipped_prefixes):
        return False
    if path.startswith("/users/") and path.endswith("/activity-logs"):
        return False

    return path.startswith(
        (
            "/products",
            "/customers",
            "/orders",
            "/suppliers",
            "/stock-movements",
            "/workflow-steps",
            "/workers",
            "/worker-payments",
            "/shipping",
            "/fulfillment",
            "/service-takers",
            "/courier-payments",
            "/regular-bills",
            "/accounting",
            "/production",
            "/users",
            "/tenants",
            "/modules",
            "/custom-pages",
            "/inspiration",
        )
    )

# Directory to save uploaded images
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
FULFILLMENT_DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".txt",
    ".csv",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
    ".zip",
    ".btw",
}
FULFILLMENT_DOCUMENT_CONTENT_TYPES = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/csv": ".csv",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
}


def save_uploaded_file(upload: UploadFile) -> str:
    safe_name = sanitize_upload_filename(upload.filename or "upload")
    extension = validate_upload_extension(safe_name, upload.content_type)
    final_filename = f"{uuid.uuid4().hex}{extension}"
    file_path = UPLOAD_DIR / final_filename
    with file_path.open("wb") as file:
        shutil.copyfileobj(upload.file, file)
    return f"/static/uploads/{final_filename}".replace("\\", "/")


def fulfillment_document_extension(filename: str, content_type: str | None) -> str:
    extension = os.path.splitext(filename or "")[1].lower()
    if extension in FULFILLMENT_DOCUMENT_EXTENSIONS:
        return extension
    if content_type:
        mapped = FULFILLMENT_DOCUMENT_CONTENT_TYPES.get(content_type.lower())
        if mapped:
            return mapped
    raise HTTPException(
        status_code=400,
        detail="Unsupported fulfillment file type. Upload PDF, image, CSV, spreadsheet, document, ZIP, or BTW label files.",
    )


def save_fulfillment_document(upload: UploadFile) -> tuple[str, str]:
    safe_name = sanitize_upload_filename(upload.filename or "label")
    extension = fulfillment_document_extension(safe_name, upload.content_type)
    final_filename = f"fulfillment-{uuid.uuid4().hex}{extension}"
    file_path = UPLOAD_DIR / final_filename
    with file_path.open("wb") as file:
        shutil.copyfileobj(upload.file, file)
    return f"/static/uploads/{final_filename}".replace("\\", "/"), safe_name


@app.post("/products", response_model=ProductOut)
async def create_product(
    article_no: str = Form(...),
    name: str = Form(...),
    category: str = Form(None),
    options: str = Form(None),
    notes: str = Form(None),
    factory_stock: int = Form(...),
    usa_stock: int = Form(...),
    front_room_stock: int = Form(0),
    reserved_stock: int = Form(...),
    cost_price: float = Form(...),
    selling_price: float = Form(...),
    unit_weight_kg: float = Form(0),
    low_stock_alert: int = Form(...),
    workflow_required: bool = Form(...),
    image: UploadFile = File(None),  # <-- receive file here
    share_image_file: UploadFile = File(None),
    label_file: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    # Check for duplicate article_no
    if db.query(Product).filter(Product.article_no == article_no).first():
        raise HTTPException(status_code=400, detail="Product article number exists")
    if unit_weight_kg < 0:
        raise HTTPException(status_code=400, detail="Unit shipping weight cannot be negative")

    image_url = None
    if image:
        image_url = save_uploaded_file(image)

    share_image_url = None
    if share_image_file:
        share_image_url = save_uploaded_file(share_image_file)

    label_url = None
    if label_file:
        label_url = save_uploaded_file(label_file)

    new_product = Product(
        article_no=article_no,
        name=name,
        category=category,
        options=(options or "").strip() or None,
        notes=(notes or "").strip() or None,
        factory_stock=factory_stock,
        usa_stock=usa_stock,
        front_room_stock=front_room_stock,
        reserved_stock=reserved_stock,
        cost_price=cost_price,
        selling_price=selling_price,
        unit_weight_kg=unit_weight_kg,
        low_stock_alert=low_stock_alert,
        workflow_required=workflow_required,
        image_url=image_url,
        share_image_url=share_image_url,
        label_url=label_url,
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    # Keep opening movements location-specific so the audit ledger can be
    # reconciled with the same fields displayed throughout the ERP.
    for stock_field in STOCK_FIELD_LABELS:
        opening_quantity = int(getattr(new_product, stock_field) or 0)
        if opening_quantity <= 0:
            continue
        db.add(StockMovement(
            product_id=new_product.id,
            movement_type="Initial Stock",
            quantity=opening_quantity,
            stock_type=stock_field,
            source="System",
            reference=new_product.article_no,
            note=f"Product created with opening {STOCK_FIELD_LABELS[stock_field].lower()}",
            created_at=datetime.utcnow(),
        ))
    db.commit()

    # Return a structured product response
    return product_response(new_product)


@app.get("/users", response_model=list[UserOut])
def list_users(request: Request, db: Session = Depends(get_db)):
    actor = require_page_access(request, db, "Users")
    query = db.query(User).options(joinedload(User.tenant))
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    return [user_response(user, db) for user in query.order_by(User.id.desc()).all()]


def is_auth_exempt_path(path: str, method: str = "GET") -> bool:
    request_method = str(method or "GET").upper()
    clean_path = (path or "/").rstrip("/") or "/"
    return (
        request_method == "OPTIONS"
        or clean_path == "/"
        or clean_path == "/login"
        or (request_method == "POST" and clean_path.endswith("/access-requests"))
        or (request_method == "POST" and clean_path.endswith("/public-order"))
        or clean_path == "/catalog"
        or clean_path.startswith("/catalog/")
        or clean_path.startswith("/portal")
        or clean_path == "/school/admission/apply"
        or clean_path.startswith("/school/admissions/public")
        or (request_method == "GET" and clean_path.startswith("/website"))
        or (request_method == "GET" and clean_path in {"/website-settings", "/website-products"})
        or (request_method == "GET" and clean_path == "/products/catalog-download-file")
        or clean_path.startswith("/static")
        or clean_path.startswith("/assets")
        or clean_path.startswith("/favicon")
        or clean_path.startswith("/manifest")
        or clean_path.startswith("/public-live-chat")
        or clean_path.startswith("/sw.js")
        or clean_path.startswith("/health")
        or clean_path.startswith("/app-install-info")
        or clean_path.startswith("/local-label-printers")
        or clean_path.startswith("/api/admin/upload-database")
        or clean_path.startswith("/api/printer-agents")
        or clean_path.startswith("/printer-agents")
        or clean_path.startswith("/api/print-jobs")
        or clean_path.startswith("/print-jobs")
        or clean_path.startswith("/print-agent")
        or clean_path.startswith("/docs")
        or clean_path.startswith("/redoc")
        or clean_path == "/openapi.json"
    )


@app.post("/api/admin/upload-database")
async def upload_database_sync_file(file: UploadFile = File(...)):
    db_file_path = APP_DATA_DIR / "hisbenew_industries.db"
    backup_file_path = APP_DATA_DIR / "hisbenew_industries.db.bak"
    
    try:
        engine.dispose()
    except Exception:
        pass
        
    if db_file_path.exists():
        import shutil
        try:
            shutil.copy(db_file_path, backup_file_path)
        except Exception:
            pass

    content = await file.read()
    if len(content) < 1000:
        raise HTTPException(status_code=400, detail="Invalid database file size.")

    with open(db_file_path, "wb") as f:
        f.write(content)

    try:
        migrate_database()
        ensure_scaling_indexes()
    except Exception as exc:
        print(f"Post-upload migration notice: {exc}")

    return {
        "status": "success",
        "detail": "Production database updated with local data successfully.",
        "file_size": len(content),
        "path": str(db_file_path),
    }


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if is_auth_exempt_path(request.url.path, request.method):
        return await call_next(request)

    authorization = request.headers.get("Authorization")
    if not authorization:
        return JSONResponse(
            status_code=401,
            content={"detail": "Authentication required."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid authentication scheme."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(token)
    except HTTPException as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers or {"WWW-Authenticate": "Bearer"},
        )

    user_id = int(payload.get("sub", "0"))
    db = SessionLocal()
    request_tenant_id = None
    request_tenant_slug = None
    tenant_error: tuple[int, str] | None = None
    try:
        user = (
            db.query(User)
            .execution_options(skip_tenant_scope=True)
            .filter(User.id == user_id, User.is_active == True)
            .first()
        )
        if user and user.tenant_id is not None:
            tenant = (
                db.query(Tenant)
                .execution_options(skip_tenant_scope=True)
                .filter(Tenant.id == user.tenant_id)
                .first()
            )
            if tenant:
                request_tenant_id = tenant.id
                request_tenant_slug = tenant.slug
                if (tenant.status or "active") != "active" and user.role != "super_admin":
                    tenant_error = (403, "This company tenant is inactive.")
        selected_tenant_header = (request.headers.get("X-ERP-Tenant-Id") or "").strip()
        if user and user.role == "super_admin" and selected_tenant_header:
            try:
                selected_tenant_id = int(selected_tenant_header)
            except ValueError:
                tenant_error = (400, "X-ERP-Tenant-Id must be a number.")
            else:
                selected_tenant = (
                    db.query(Tenant)
                    .execution_options(skip_tenant_scope=True)
                    .filter(Tenant.id == selected_tenant_id)
                    .first()
                )
                if not selected_tenant:
                    tenant_error = (404, "Selected company tenant was not found.")
                else:
                    request_tenant_id = selected_tenant.id
                    request_tenant_slug = selected_tenant.slug
    finally:
        db.close()

    if not user:
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or expired authentication token."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    if tenant_error:
        return JSONResponse(
            status_code=tenant_error[0],
            content={"detail": tenant_error[1]},
        )

    if user.role == "school":
        school_allowed = (
            request.url.path.startswith("/school")
            or (
                request.method == "GET"
                and request.url.path == f"/users/{user.id}"
            )
            or (
                request.method == "POST"
                and request.url.path == "/activity-logs/page-view"
            )
        )
        if not school_allowed:
            return JSONResponse(
                status_code=403,
                content={"detail": "This account is restricted to the school workspace."},
            )

    if user.role == "service_taker":
        service_taker_allowed = (
            request.url.path.startswith("/service-takers/portal")
            or (
                request.method == "GET"
                and request.url.path == f"/users/{user.id}"
            )
            or (
                request.method == "POST"
                and request.url.path == "/activity-logs/page-view"
            )
        )
        if not service_taker_allowed:
            return JSONResponse(
                status_code=403,
                content={"detail": "This account is restricted to the service portal."},
            )

    request.state.user_id = user.id
    request.state.user_name = user.username or user.name
    request.state.tenant_id = request_tenant_id
    request.state.tenant_slug = request_tenant_slug
    request.state.authenticated_user = user
    return await call_next(request)


@app.get("/user-access-options")
def get_user_access_options():
    return {
        "pages": ALL_ERP_PAGES,
        "role_defaults": ROLE_PAGE_DEFAULTS,
        "parent_map": PAGE_PARENT_MAP,
        "privacy_settings": DEFAULT_ACCESS_PRIVACY_SETTINGS,
        "privacy_role_defaults": {
            role: default_access_privacy_settings_for_role(role)
            for role in ROLE_PAGE_DEFAULTS
        },
    }


@app.post("/user-access-privacy-settings")
@app.put("/user-access-privacy-settings")
@app.patch("/user-access-privacy-settings")
def update_user_access_privacy_settings(
    payload: AccessPrivacySettingsPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    require_page_access(request, db, "Users")
    return save_access_privacy_settings(payload.model_dump())



def module_slug_for_page(page: str) -> str:
    return slugify_tenant_value(page, "module")


def ensure_default_modules_for_db(db: Session) -> None:
    existing_by_slug = {
        module.slug: module
        for module in db.query(Module).execution_options(skip_tenant_scope=True).all()
    }
    for page in ALL_ERP_PAGES:
        if page in TENANT_MODULE_EXCLUDED_PAGES:
            continue
        slug = module_slug_for_page(page)
        if slug in existing_by_slug:
            module = existing_by_slug[slug]
            module.name = module.name or page
            module.page_name = module.page_name or page
            db.add(module)
            continue
        module = Module(
            name=page,
            slug=slug,
            page_name=page,
            description=f"Controls access to {page}.",
            default_enabled=True,
        )
        db.add(module)
        existing_by_slug[slug] = module
    db.flush()

    tenants = db.query(Tenant).execution_options(skip_tenant_scope=True).all()
    modules = db.query(Module).execution_options(skip_tenant_scope=True).all()
    for tenant in tenants:
        sync_tenant_modules(db, tenant.id, None, commit=False, modules=modules)
    db.commit()


def ensure_default_modules() -> None:
    db = SessionLocal()
    try:
        ensure_default_modules_for_db(db)
    finally:
        db.close()


def sync_tenant_modules(
    db: Session,
    tenant_id: int,
    enabled_by_slug: dict[str, bool] | None = None,
    *,
    commit: bool = True,
    modules: list[Module] | None = None,
) -> list[TenantModule]:
    if modules is None:
        modules = (
            db.query(Module)
            .execution_options(skip_tenant_scope=True)
            .order_by(Module.name.asc())
            .all()
        )
    modules = [
        module
        for module in modules
        if module.page_name not in TENANT_MODULE_EXCLUDED_PAGES
    ]
    existing = {
        tenant_module.module_id: tenant_module
        for tenant_module in (
            db.query(TenantModule)
            .execution_options(skip_tenant_scope=True)
            .filter(TenantModule.tenant_id == tenant_id)
            .all()
        )
    }
    normalized_enabled = {
        slugify_tenant_value(slug, ""): bool(enabled)
        for slug, enabled in (enabled_by_slug or {}).items()
    }

    rows = []
    for module in modules:
        tenant_module = existing.get(module.id)
        if not tenant_module:
            tenant_module = TenantModule(
                tenant_id=tenant_id,
                module_id=module.id,
                enabled=bool(module.default_enabled),
            )
            db.add(tenant_module)
        if enabled_by_slug is not None and module.slug in normalized_enabled:
            tenant_module.enabled = normalized_enabled[module.slug]
        rows.append(tenant_module)
    clear_tenant_page_set_cache(db, tenant_id)
    if commit:
        db.commit()
    return rows


def tenant_modules_for_response(db: Session, tenant_id: int) -> list[dict]:
    modules = (
        db.query(Module)
        .execution_options(skip_tenant_scope=True)
        .order_by(Module.name.asc())
        .all()
    )
    tenant_modules = (
        db.query(TenantModule)
        .execution_options(skip_tenant_scope=True)
        .filter(TenantModule.tenant_id == tenant_id)
        .all()
    )
    enabled_by_module_id = {
        tenant_module.module_id: bool(tenant_module.enabled)
        for tenant_module in tenant_modules
    }
    return [
        module_response(
            module,
            enabled_by_module_id.get(module.id, bool(module.default_enabled)),
        )
        for module in modules
        if module.page_name not in TENANT_MODULE_EXCLUDED_PAGES
    ]


@app.get("/tenant-context")
def get_tenant_context(request: Request, db: Session = Depends(get_db)):
    user = get_authenticated_user(request, db)
    tenant_id = getattr(request.state, "tenant_id", None) or user.tenant_id
    tenant = get_tenant_or_404(db, tenant_id) if tenant_id is not None else None
    modules = tenant_modules_for_response(db, tenant_id) if tenant_id is not None else []
    custom_pages = (
        db.query(CustomPage)
        .filter(CustomPage.tenant_id == tenant_id, CustomPage.is_active == True)
        .order_by(CustomPage.page_name.asc())
        .all()
        if tenant_id is not None
        else []
    )
    return {
        "tenant": tenant_response(tenant, db) if tenant else None,
        "modules": modules,
        "custom_pages": [custom_page_response(page) for page in custom_pages],
    }


@app.get("/tenants", response_model=list[TenantOut])
def list_tenants(request: Request, db: Session = Depends(get_db)):
    require_super_admin(request, db)
    tenants = (
        db.query(Tenant)
        .execution_options(skip_tenant_scope=True)
        .order_by(Tenant.company_name.asc(), Tenant.id.asc())
        .all()
    )
    return [tenant_response(tenant, db) for tenant in tenants]


@app.post("/tenants", response_model=TenantOut)
def create_tenant(
    payload: TenantCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_super_admin(request, db)
    clean_name = payload.company_name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Company name is required")
    slug = slugify_tenant_value(payload.slug or clean_name)
    if tenant_for_slug(db, slug):
        raise HTTPException(status_code=400, detail="Company slug is already in use")

    tenant = Tenant(
        company_name=clean_name,
        slug=slug,
        email=(payload.email or "").strip() or None,
        phone=(payload.phone or "").strip() or None,
        logo=(payload.logo or "").strip() or None,
        status=normalize_tenant_status(payload.status),
    )
    db.add(tenant)
    db.flush()
    ensure_default_modules_for_db(db)
    enabled_by_slug = None
    if payload.module_slugs is not None:
        selected = {slugify_tenant_value(slug, "") for slug in payload.module_slugs}
        enabled_by_slug = {
            module.slug: module.slug in selected
            for module in db.query(Module).execution_options(skip_tenant_scope=True).all()
        }
    sync_tenant_modules(db, tenant.id, enabled_by_slug, commit=False)

    if payload.admin_name:
        admin_name = payload.admin_name.strip()
        admin_username = normalize_username(payload.admin_username, admin_name)
        ensure_username_available(db, admin_username)
        admin_user = User(
            tenant_id=tenant.id,
            name=admin_name,
            username=admin_username,
            pin=hash_pin(payload.admin_pin),
            raw_pin=payload.admin_pin,
            role="admin",
            phone=(payload.admin_phone or "").strip() or None,
            email=(payload.admin_email or "").strip() or None,
            allowed_pages=json.dumps(ROLE_PAGE_DEFAULTS["admin"]),
            customer_privacy_settings=json.dumps(default_access_privacy_settings_for_role("admin")),
            session_expiry_minutes=0,
            is_active=True,
        )
        db.add(admin_user)

    db.commit()
    db.refresh(tenant)
    return tenant_response(tenant, db)


@app.put("/tenants/{tenant_id}", response_model=TenantOut)
def update_tenant(
    tenant_id: int,
    payload: TenantUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_super_admin(request, db)
    tenant = get_tenant_or_404(db, tenant_id)
    data = payload.model_dump(exclude_unset=True)
    if "company_name" in data and data["company_name"] is not None:
        clean_name = data["company_name"].strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Company name is required")
        tenant.company_name = clean_name
    if "slug" in data and data["slug"] is not None:
        slug = slugify_tenant_value(data["slug"])
        duplicate = tenant_for_slug(db, slug)
        if duplicate and duplicate.id != tenant.id:
            raise HTTPException(status_code=400, detail="Company slug is already in use")
        tenant.slug = slug
    if "status" in data and data["status"] is not None:
        tenant.status = normalize_tenant_status(data["status"])
    for field in ("email", "phone", "logo"):
        if field in data:
            setattr(tenant, field, (data[field] or "").strip() or None)
    tenant.updated_at = datetime.utcnow()
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant_response(tenant, db)


def table_primary_key_column(table):
    pk_columns = list(table.primary_key.columns)
    if len(pk_columns) == 1:
        return pk_columns[0]
    return table.c.id if "id" in table.c else None


def table_id_values(db: Session, table, condition) -> set:
    pk_column = table_primary_key_column(table)
    if pk_column is None:
        return set()
    return set(db.execute(select(pk_column).where(condition)).scalars().all())


def add_deleted_count(counts: dict[str, int], key: str, amount: int | None) -> None:
    if amount is None or amount < 0:
        amount = 0
    counts[key] = counts.get(key, 0) + int(amount)


def collect_tenant_related_row_ids(db: Session, tenant_id: int) -> dict[str, set]:
    ids_by_table: dict[str, set] = {}
    for table in Base.metadata.sorted_tables:
        if table.name == "tenants" or "tenant_id" not in table.c:
            continue
        row_ids = table_id_values(db, table, table.c.tenant_id == tenant_id)
        if row_ids:
            ids_by_table[table.name] = row_ids

    changed = True
    while changed:
        changed = False
        for table in Base.metadata.sorted_tables:
            pk_column = table_primary_key_column(table)
            if pk_column is None or table.name == "tenants":
                continue
            conditions = []
            for foreign_key in table.foreign_keys:
                parent_ids = ids_by_table.get(foreign_key.column.table.name)
                if parent_ids:
                    conditions.append(foreign_key.parent.in_(list(parent_ids)))
            if not conditions:
                continue
            condition = conditions[0] if len(conditions) == 1 else or_(*conditions)
            row_ids = table_id_values(db, table, condition)
            if not row_ids:
                continue
            existing = ids_by_table.setdefault(table.name, set())
            before = len(existing)
            existing.update(row_ids)
            changed = changed or len(existing) != before
    return ids_by_table


def collect_tenant_static_uploads(db: Session, ids_by_table: dict[str, set]) -> set[str]:
    file_urls: set[str] = set()
    for table in Base.metadata.sorted_tables:
        row_ids = ids_by_table.get(table.name)
        pk_column = table_primary_key_column(table)
        if not row_ids or pk_column is None:
            continue
        upload_columns = [
            column
            for column in table.columns
            if any(part in column.name.lower() for part in ("url", "file", "image", "logo"))
        ]
        if not upload_columns:
            continue
        for row in db.execute(select(*upload_columns).where(pk_column.in_(list(row_ids)))).all():
            for value in row:
                if isinstance(value, str):
                    collect_static_upload_urls(file_urls, value)
    return file_urls


def delete_tenant_related_rows(db: Session, ids_by_table: dict[str, set]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in reversed(Base.metadata.sorted_tables):
        row_ids = ids_by_table.get(table.name)
        pk_column = table_primary_key_column(table)
        if not row_ids or pk_column is None:
            continue
        result = db.execute(table.delete().where(pk_column.in_(list(row_ids))))
        add_deleted_count(counts, table.name, result.rowcount)
    return counts


@app.delete("/tenants/{tenant_id}")
def delete_tenant(
    tenant_id: int,
    payload: TenantDeleteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    actor = require_super_admin(request, db)
    tenant = get_tenant_or_404(db, tenant_id)
    confirmation = (payload.confirmation or "").strip()
    if confirmation != tenant.company_name:
        raise HTTPException(status_code=400, detail="Type the exact company name to confirm deletion.")
    if tenant.slug == DEFAULT_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="The default Hisbenew company cannot be deleted.")
    if actor.tenant_id == tenant.id:
        raise HTTPException(status_code=400, detail="You cannot delete the company you are currently signed into.")

    tenant_name = tenant.company_name
    tenant_slug = tenant.slug
    db.info.pop("tenant_id", None)
    row_ids = collect_tenant_related_row_ids(db, tenant.id)
    file_urls = collect_tenant_static_uploads(db, row_ids)
    deleted_counts = delete_tenant_related_rows(db, row_ids)
    db.delete(tenant)
    record_activity(
        db,
        actor_user_id=actor.id,
        actor_user_name=actor.name,
        action="deleted company",
        entity_type="tenant",
        entity_id=tenant_id,
        summary=f"Deleted company {tenant_name}",
        request_method="DELETE",
        request_path=f"/tenants/{tenant_id}",
        detail=json.dumps({"company_name": tenant_name, "slug": tenant_slug, "deleted_counts": deleted_counts}),
    )
    db.commit()
    file_cleanup_error = None
    try:
        delete_static_upload_urls(file_urls, deleted_counts)
    except OSError as exc:
        file_cleanup_error = str(exc)
    response = {
        "detail": "Company and tenant data deleted.",
        "deleted_tenant_id": tenant_id,
        "deleted_company_name": tenant_name,
        "deleted_counts": deleted_counts,
    }
    if file_cleanup_error:
        response["file_cleanup_error"] = file_cleanup_error
    return response

@app.get("/tenants/{tenant_id}/modules", response_model=list[ModuleOut])
def get_tenant_modules(
    tenant_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    require_super_admin(request, db)
    get_tenant_or_404(db, tenant_id)
    return tenant_modules_for_response(db, tenant_id)


@app.put("/tenants/{tenant_id}/modules", response_model=list[ModuleOut])
def update_tenant_modules(
    tenant_id: int,
    payload: TenantModuleBulkUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_super_admin(request, db)
    get_tenant_or_404(db, tenant_id)
    ensure_default_modules_for_db(db)
    sync_tenant_modules(db, tenant_id, payload.modules)
    return tenant_modules_for_response(db, tenant_id)


@app.patch("/tenants/{tenant_id}/modules/{module_slug}", response_model=list[ModuleOut])
def update_tenant_module(
    tenant_id: int,
    module_slug: str,
    payload: TenantModuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_super_admin(request, db)
    get_tenant_or_404(db, tenant_id)
    clean_slug = slugify_tenant_value(module_slug, "")
    module = (
        db.query(Module)
        .execution_options(skip_tenant_scope=True)
        .filter(Module.slug == clean_slug)
        .first()
    )
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    sync_tenant_modules(db, tenant_id, {module.slug: payload.enabled})
    return tenant_modules_for_response(db, tenant_id)


@app.get("/modules", response_model=list[ModuleOut])
def list_modules(request: Request, db: Session = Depends(get_db)):
    user = get_authenticated_user(request, db)
    tenant_id = getattr(request.state, "tenant_id", None) or user.tenant_id
    if tenant_id is None:
        return [
            module_response(module, module.default_enabled)
            for module in db.query(Module).all()
            if module.page_name not in TENANT_MODULE_EXCLUDED_PAGES
        ]
    return tenant_modules_for_response(db, tenant_id)


@app.get("/custom-pages", response_model=list[CustomPageOut])
def list_custom_pages(request: Request, db: Session = Depends(get_db)):
    user = get_authenticated_user(request, db)
    tenant_id = getattr(request.state, "tenant_id", None) or user.tenant_id
    query = db.query(CustomPage)
    if tenant_id is not None:
        query = query.filter(CustomPage.tenant_id == tenant_id)
    pages = query.order_by(CustomPage.page_name.asc(), CustomPage.id.asc()).all()
    return [custom_page_response(page) for page in pages]


@app.post("/custom-pages", response_model=CustomPageOut)
def create_custom_page(
    payload: CustomPageCreate,
    request: Request,
    tenant_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    target_tenant_id = tenant_id_for_write(request, db, tenant_id)
    page_name = payload.page_name.strip()
    slug = slugify_tenant_value(payload.slug or page_name, "custom-page")
    duplicate = (
        db.query(CustomPage)
        .execution_options(skip_tenant_scope=True)
        .filter(CustomPage.tenant_id == target_tenant_id, CustomPage.slug == slug)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="Custom page slug already exists for this company")
    page = CustomPage(
        tenant_id=target_tenant_id,
        page_name=page_name,
        slug=slug,
        fields_json=json.dumps(payload.fields),
        is_active=payload.is_active,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return custom_page_response(page)


@app.put("/custom-pages/{page_id}", response_model=CustomPageOut)
def update_custom_page(
    page_id: int,
    payload: CustomPageUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_tenant_admin(request, db)
    page = db.query(CustomPage).filter(CustomPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Custom page not found")
    data = payload.model_dump(exclude_unset=True)
    if "page_name" in data and data["page_name"] is not None:
        page_name = data["page_name"].strip()
        if not page_name:
            raise HTTPException(status_code=400, detail="Page name is required")
        page.page_name = page_name
    if "slug" in data and data["slug"] is not None:
        slug = slugify_tenant_value(data["slug"], "custom-page")
        duplicate = (
            db.query(CustomPage)
            .execution_options(skip_tenant_scope=True)
            .filter(CustomPage.tenant_id == page.tenant_id, CustomPage.slug == slug, CustomPage.id != page.id)
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=400, detail="Custom page slug already exists for this company")
        page.slug = slug
    if "fields" in data and data["fields"] is not None:
        page.fields_json = json.dumps(data["fields"])
    if "is_active" in data and data["is_active"] is not None:
        page.is_active = bool(data["is_active"])
    page.updated_at = datetime.utcnow()
    db.add(page)
    db.commit()
    db.refresh(page)
    return custom_page_response(page)


@app.delete("/custom-pages/{page_id}")
def delete_custom_page(
    page_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    require_tenant_admin(request, db)
    page = db.query(CustomPage).filter(CustomPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Custom page not found")
    db.delete(page)
    db.commit()
    return {"detail": "Custom page deleted", "deleted_page_id": page_id}


DATA_ERASE_OPTIONS = [
    {
        "key": "customers",
        "label": "Customers",
        "pages": ["Customers"],
        "description": "Customer records. Related orders are erased first.",
    },
    {
        "key": "orders",
        "label": "Orders, payouts, follow ups",
        "pages": ["Orders", "Payouts", "Follow Ups"],
        "description": "Orders, order lines, payout accounting, follow ups, shared order data, and order tasks.",
    },
    {
        "key": "shipping",
        "label": "Shipping and courier balances",
        "pages": ["Shipping", "Shipping Balance"],
        "description": "Shipping records and courier payment transactions.",
    },
    {
        "key": "products",
        "label": "Products and inventory",
        "pages": ["Products", "Inventory"],
        "description": "Products, product files, stock movements, product workflows, and dependent test records.",
    },
    {
        "key": "suppliers",
        "label": "Accounts / suppliers",
        "pages": ["Accounts"],
        "description": "Supplier accounts, purchases, supplies, payments, and supplier stock movements.",
    },
    {
        "key": "fulfillment",
        "label": "Warehouse / fulfillment",
        "pages": ["Warehouse / Fulfillment", "Warehouse Dispatch", "Warehouse Shipments", "Warehouse Stock"],
        "description": "Fulfillment shipments, boxes, orders, picks, and label files.",
    },
    {
        "key": "manufacturing",
        "label": "Manufacturing workflows",
        "pages": ["Manufacturing"],
        "description": "Workflow steps. Production batches and tasks are erased first.",
    },
    {
        "key": "production",
        "label": "Production",
        "pages": ["Production"],
        "description": "Production batches and worker tasks.",
    },
    {
        "key": "workers",
        "label": "Workers",
        "pages": ["Workers", "My Tasks", "Worker Payouts"],
        "description": "Worker records, worker accounts, payout history, and open worker assignment tasks. User accounts are preserved unless Users is selected.",
    },
    {
        "key": "payments",
        "label": "Billings",
        "pages": ["Billings"],
        "description": "Regular bills and bill payment history.",
    },
    {
        "key": "accounting",
        "label": "Accounting",
        "pages": ["Accounting"],
        "description": "Accounting accounts and manual/accounting transactions.",
    },
    {
        "key": "inspiration",
        "label": "Inspiration",
        "pages": ["Inspiration"],
        "description": "Inspiration records and their uploaded images.",
    },
    {
        "key": "users",
        "label": "Users and activity",
        "pages": ["Users"],
        "description": "Non-admin users and activity logs. Admin users are preserved.",
    },
    {
        "key": "website",
        "label": "Website settings",
        "pages": ["Website"],
        "description": "Resets website settings to defaults.",
    },
    {
        "key": "uploads",
        "label": "Host uploaded files",
        "pages": ["Products", "Website"],
        "description": "Deletes files from backend/static/uploads, including old unused uploads.",
    },
]


class DataEraseRequest(BaseModel):
    keys: list[str] = Field(default_factory=list)
    confirm: bool = False
    include_files: bool = True


DATA_BACKUP_VERSION = 1
DATA_BACKUP_APP_ID = "hisbenew-industries-erp"
DATA_BACKUP_DATABASE_PATH = "database/hisbenew_industries.db"
DATA_BACKUP_WEBSITE_SETTINGS_PATH = "app_data/website_settings.json"
DATA_BACKUP_EMAIL_SETTINGS_PATH = "app_data/email_settings.json"
DATA_BACKUP_CALL_SETTINGS_PATH = "app_data/call_settings.json"
DATA_BACKUP_SCHOOL_SETTINGS_PATH = "app_data/school_settings.json"
DATA_BACKUP_UPLOADS_PREFIX = "static/uploads"


def require_admin_user(request: Request, db: Session) -> User:
    user_id = getattr(request.state, "user_id", None)
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if user.role not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Only administrators can manage ERP data.")
    return user


def sqlite_database_path() -> Path:
    if not engine.url.get_backend_name().startswith("sqlite"):
        raise HTTPException(
            status_code=400,
            detail="Backup and restore are available for the local SQLite database only.",
        )

    database = engine.url.database
    if not database:
        raise HTTPException(status_code=400, detail="Database file path could not be found.")
    return Path(database).expanduser().resolve()


def validate_backup_member_name(name: str) -> str:
    raw_name = str(name or "").replace("\\", "/")
    if raw_name.startswith("/") or raw_name.startswith("\\"):
        raise HTTPException(status_code=400, detail="Backup file contains unsafe paths.")
    cleaned = raw_name.strip("/")
    path = Path(cleaned)
    if (
        not cleaned
        or path.is_absolute()
        or any(part in {"..", ""} for part in path.parts)
        or re.match(r"^[a-zA-Z]:", cleaned)
    ):
        raise HTTPException(status_code=400, detail="Backup file contains unsafe paths.")
    return cleaned


def write_directory_to_zip(archive: zipfile.ZipFile, root: Path, prefix: str) -> int:
    if not root.exists():
        return 0

    file_count = 0
    safe_root = root.resolve()
    for path in sorted(safe_root.rglob("*")):
        if not path.is_file():
            continue
        relative_path = path.relative_to(safe_root).as_posix()
        archive.write(path, f"{prefix.rstrip('/')}/{relative_path}")
        file_count += 1
    return file_count


def create_sqlite_snapshot(source_path: Path, destination_path: Path) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(str(source_path))
    try:
        destination = sqlite3.connect(str(destination_path))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()


def build_data_backup_archive(temp_dir: Path, admin_user: User) -> tuple[Path, str]:
    database_path = sqlite_database_path()
    if not database_path.exists():
        raise HTTPException(status_code=404, detail="Database file was not found.")

    created_at = datetime.utcnow()
    timestamp = created_at.strftime("%Y%m%d-%H%M%S")
    backup_filename = f"hisbenew-erp-data-backup-{timestamp}.zip"
    archive_path = temp_dir / backup_filename
    database_snapshot = temp_dir / "database-snapshot.sqlite"
    create_sqlite_snapshot(database_path, database_snapshot)

    metadata = {
        "app": DATA_BACKUP_APP_ID,
        "kind": "erp-data-backup",
        "version": DATA_BACKUP_VERSION,
        "created_at": created_at.isoformat(timespec="seconds") + "Z",
        "created_by": admin_user.username or admin_user.name,
        "database": DATA_BACKUP_DATABASE_PATH,
        "website_settings": DATA_BACKUP_WEBSITE_SETTINGS_PATH if WEBSITE_SETTINGS_FILE.exists() else None,
        "email_settings": DATA_BACKUP_EMAIL_SETTINGS_PATH if EMAIL_SETTINGS_FILE.exists() else None,
        "call_settings": DATA_BACKUP_CALL_SETTINGS_PATH if CALL_SETTINGS_FILE.exists() else None,
        "school_settings": DATA_BACKUP_SCHOOL_SETTINGS_PATH if SCHOOL_SETTINGS_FILE.exists() else None,
    }

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.write(database_snapshot, DATA_BACKUP_DATABASE_PATH)
        upload_count = write_directory_to_zip(archive, UPLOAD_DIR, DATA_BACKUP_UPLOADS_PREFIX)
        metadata["upload_files"] = upload_count
        if WEBSITE_SETTINGS_FILE.exists():
            archive.write(WEBSITE_SETTINGS_FILE, DATA_BACKUP_WEBSITE_SETTINGS_PATH)
        if EMAIL_SETTINGS_FILE.exists():
            archive.write(EMAIL_SETTINGS_FILE, DATA_BACKUP_EMAIL_SETTINGS_PATH)
        if CALL_SETTINGS_FILE.exists():
            archive.write(CALL_SETTINGS_FILE, DATA_BACKUP_CALL_SETTINGS_PATH)
        if SCHOOL_SETTINGS_FILE.exists():
            archive.write(SCHOOL_SETTINGS_FILE, DATA_BACKUP_SCHOOL_SETTINGS_PATH)
        archive.writestr("metadata.json", json.dumps(metadata, indent=2))

    return archive_path, backup_filename


def read_backup_metadata(archive: zipfile.ZipFile) -> dict:
    try:
        raw_metadata = archive.read("metadata.json")
        metadata = json.loads(raw_metadata.decode("utf-8"))
    except KeyError:
        raise HTTPException(status_code=400, detail="Backup is missing metadata.json.")
    except Exception:
        raise HTTPException(status_code=400, detail="Backup metadata could not be read.")

    if metadata.get("app") != DATA_BACKUP_APP_ID or metadata.get("kind") != "erp-data-backup":
        raise HTTPException(status_code=400, detail="This is not a Hisbenew ERP data backup.")
    return metadata


def extract_backup_archive(upload: UploadFile, temp_dir: Path) -> tuple[Path, dict]:
    filename = sanitize_upload_filename(upload.filename or "backup.zip")
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a .zip backup file.")

    archive_path = temp_dir / filename
    with archive_path.open("wb") as file:
        shutil.copyfileobj(upload.file, file)

    if not zipfile.is_zipfile(archive_path):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid zip backup.")

    extract_dir = temp_dir / "restore"
    extract_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive_path) as archive:
        metadata = read_backup_metadata(archive)
        database_member = validate_backup_member_name(
            metadata.get("database") or DATA_BACKUP_DATABASE_PATH
        )
        names = {validate_backup_member_name(name) for name in archive.namelist()}
        if database_member not in names:
            raise HTTPException(status_code=400, detail="Backup is missing the database file.")
        archive.extractall(extract_dir)

    return extract_dir, metadata


def clear_directory_contents(root: Path) -> int:
    root.mkdir(parents=True, exist_ok=True)
    deleted = 0
    for path in sorted(root.rglob("*"), reverse=True):
        try:
            if path.is_file():
                path.unlink()
                deleted += 1
            elif path.is_dir():
                path.rmdir()
        except OSError:
            continue
    return deleted


def copy_directory_contents(source: Path, destination: Path) -> int:
    copied = 0
    if not source.exists():
        destination.mkdir(parents=True, exist_ok=True)
        return copied

    destination.mkdir(parents=True, exist_ok=True)
    safe_source = source.resolve()
    for path in sorted(safe_source.rglob("*")):
        relative_path = path.relative_to(safe_source)
        target = destination / relative_path
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied += 1
    return copied


def restore_data_backup_from_extract(extract_dir: Path, metadata: dict) -> dict:
    database_member = validate_backup_member_name(
        metadata.get("database") or DATA_BACKUP_DATABASE_PATH
    )
    extracted_database = (extract_dir / database_member).resolve()
    if not extracted_database.is_file():
        raise HTTPException(status_code=400, detail="Backup database file could not be found.")

    target_database = sqlite_database_path()
    target_database.parent.mkdir(parents=True, exist_ok=True)

    engine.dispose()
    replacement_database = target_database.with_suffix(f"{target_database.suffix}.restore")
    shutil.copy2(extracted_database, replacement_database)
    os.replace(replacement_database, target_database)

    deleted_uploads = clear_directory_contents(UPLOAD_DIR)
    copied_uploads = copy_directory_contents(
        extract_dir / DATA_BACKUP_UPLOADS_PREFIX,
        UPLOAD_DIR,
    )

    website_settings_member = metadata.get("website_settings") or DATA_BACKUP_WEBSITE_SETTINGS_PATH
    restored_website_settings = False
    if website_settings_member:
        website_settings_path = extract_dir / validate_backup_member_name(website_settings_member)
        if website_settings_path.is_file():
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(website_settings_path, WEBSITE_SETTINGS_FILE)
            restored_website_settings = True

    email_settings_member = metadata.get("email_settings") or DATA_BACKUP_EMAIL_SETTINGS_PATH
    restored_email_settings = False
    if email_settings_member:
        email_settings_path = extract_dir / validate_backup_member_name(email_settings_member)
        if email_settings_path.is_file():
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(email_settings_path, EMAIL_SETTINGS_FILE)
            restored_email_settings = True

    call_settings_member = metadata.get("call_settings") or DATA_BACKUP_CALL_SETTINGS_PATH
    restored_call_settings = False
    if call_settings_member:
        call_settings_path = extract_dir / validate_backup_member_name(call_settings_member)
        if call_settings_path.is_file():
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(call_settings_path, CALL_SETTINGS_FILE)
            restored_call_settings = True

    school_settings_member = metadata.get("school_settings") or DATA_BACKUP_SCHOOL_SETTINGS_PATH
    restored_school_settings = False
    if school_settings_member:
        school_settings_path = extract_dir / validate_backup_member_name(school_settings_member)
        if school_settings_path.is_file():
            APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(school_settings_path, SCHOOL_SETTINGS_FILE)
            restored_school_settings = True

    Base.metadata.create_all(bind=engine)
    migrate_database()
    ensure_scaling_indexes()
    ensure_default_modules()

    return {
        "database": "restored",
        "uploads_deleted": deleted_uploads,
        "uploads_restored": copied_uploads,
        "website_settings_restored": restored_website_settings,
        "email_settings_restored": restored_email_settings,
        "call_settings_restored": restored_call_settings,
        "school_settings_restored": restored_school_settings,
    }


def expand_data_erase_keys(raw_keys: list[str]) -> set[str]:
    known_keys = {option["key"] for option in DATA_ERASE_OPTIONS}
    requested = {str(key).strip() for key in raw_keys if str(key).strip()}
    unknown = sorted(requested - known_keys - {"all"})
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown erase option: {', '.join(unknown)}")

    if "all" in requested:
        requested = set(known_keys)

    if "customers" in requested:
        requested.add("orders")
    if "orders" in requested:
        requested.add("shipping")
    if "products" in requested:
        requested.update({"orders", "shipping", "fulfillment", "production", "manufacturing"})
    if "manufacturing" in requested:
        requested.add("production")
    if "workers" in requested:
        requested.add("production")

    return requested


def add_erase_count(counts: dict[str, int], key: str, amount: int | None) -> None:
    value = int(amount or 0)
    if value:
        counts[key] = counts.get(key, 0) + value


def delete_query_rows(query, counts: dict[str, int], key: str) -> int:
    count = query.count()
    if count:
        query.delete(synchronize_session=False)
        add_erase_count(counts, key, count)
    return count


def static_upload_path_from_url(value: str | None) -> Path | None:
    if not value:
        return None

    parsed_path = urlparse(str(value)).path if str(value).startswith(("http://", "https://")) else str(value)
    if not parsed_path.startswith("/static/"):
        return None

    relative_path = parsed_path.removeprefix("/static/").lstrip("/")
    try:
        candidate = (STATIC_DIR / relative_path).resolve()
        candidate.relative_to(STATIC_DIR.resolve())
    except (OSError, ValueError):
        return None

    return candidate if candidate.is_file() else None


def collect_static_upload_urls(file_urls: set[str], *values: str | None) -> None:
    for value in values:
        if static_upload_path_from_url(value):
            file_urls.add(str(value))


def delete_static_upload_urls(file_urls: set[str], counts: dict[str, int]) -> None:
    deleted = 0
    for file_url in sorted(file_urls):
        path = static_upload_path_from_url(file_url)
        if not path:
            continue
        try:
            path.unlink()
            deleted += 1
        except FileNotFoundError:
            continue
    add_erase_count(counts, "host_files", deleted)


def delete_upload_tree(root: Path, counts: dict[str, int]) -> None:
    try:
        safe_root = root.resolve()
        safe_root.relative_to(UPLOAD_DIR.resolve())
    except (OSError, ValueError):
        return

    if not safe_root.exists():
        return

    deleted = 0
    for path in sorted(safe_root.rglob("*"), reverse=True):
        try:
            if path.is_file():
                path.unlink()
                deleted += 1
            elif path.is_dir() and path != safe_root:
                path.rmdir()
        except OSError:
            continue
    add_erase_count(counts, "host_files", deleted)


def erase_shipping_data(db: Session, counts: dict[str, int]) -> None:
    delete_query_rows(db.query(Shipping), counts, "shipping_records")
    delete_query_rows(db.query(CourierPayment), counts, "courier_payments")


def delete_courier_payments_for_shipping_records(
    db: Session,
    shipping_records: list[Shipping],
    counts: dict[str, int],
) -> None:
    payment_ids: set[int] = set()
    for shipping in shipping_records:
        if not shipping.courier_name:
            continue
        if shipping.tracking_number:
            payments = (
                db.query(CourierPayment)
                .filter(
                    CourierPayment.courier_name == shipping.courier_name,
                    CourierPayment.payment_reference == shipping.tracking_number,
                )
                .all()
            )
        elif shipping.shipping_cost:
            payments = (
                db.query(CourierPayment)
                .filter(
                    CourierPayment.courier_name == shipping.courier_name,
                    CourierPayment.amount == shipping.shipping_cost,
                )
                .order_by(CourierPayment.id.desc())
                .limit(1)
                .all()
            )
        else:
            payments = []
        payment_ids.update(payment.id for payment in payments)

    if payment_ids:
        delete_query_rows(
            db.query(CourierPayment).filter(CourierPayment.id.in_(payment_ids)),
            counts,
            "courier_payments",
        )


def delete_order_records(db: Session, orders: list[Order], counts: dict[str, int]) -> None:
    order_ids = [order.id for order in orders]
    order_numbers = [order.order_no for order in orders if order.order_no]

    for order in orders:
        was_shipped = is_stock_deducted_shipping_status(order.shipping_status)
        for item in list(order.items):
            product = db.query(Product).filter(Product.id == item.product_id).first()
            if product:
                release_order_stock(product, item.quantity, item.stock_source, was_shipped)

    if order_ids:
        shipping_records = db.query(Shipping).filter(Shipping.order_id.in_(order_ids)).all()
        delete_courier_payments_for_shipping_records(db, shipping_records, counts)
        delete_query_rows(db.query(OrderWorkflowTask).filter(OrderWorkflowTask.order_id.in_(order_ids)), counts, "order_workflow_tasks")
        delete_query_rows(db.query(OrderFollowUp).filter(OrderFollowUp.order_id.in_(order_ids)), counts, "order_follow_ups")
        delete_query_rows(db.query(SharedData).filter(SharedData.order_id.in_(order_ids)), counts, "shared_data")
        delete_query_rows(db.query(OrderItem).filter(OrderItem.order_id.in_(order_ids)), counts, "order_items")
        delete_query_rows(db.query(Shipping).filter(Shipping.order_id.in_(order_ids)), counts, "shipping_records")
        delete_query_rows(
            db.query(AccountingTransaction).filter(
                AccountingTransaction.source_type == ACCOUNTING_ORDER_SOURCE,
                AccountingTransaction.source_id.in_(order_ids),
            ),
            counts,
            "accounting_transactions",
        )

    if order_numbers:
        delete_query_rows(db.query(StockMovement).filter(StockMovement.reference.in_(order_numbers)), counts, "stock_movements")

    if order_ids:
        delete_query_rows(db.query(Order).filter(Order.id.in_(order_ids)), counts, "orders")


def erase_order_data(db: Session, counts: dict[str, int]) -> None:
    delete_order_records(db, db.query(Order).all(), counts)


def erase_fulfillment_data(db: Session, counts: dict[str, int], file_urls: set[str]) -> None:
    for order in db.query(FulfillmentOrder).all():
        collect_static_upload_urls(file_urls, order.label_file_url)

    delete_query_rows(db.query(FulfillmentPick), counts, "fulfillment_picks")
    delete_query_rows(db.query(FulfillmentOrderItem), counts, "fulfillment_order_items")
    delete_query_rows(db.query(FulfillmentOrder), counts, "fulfillment_orders")
    delete_query_rows(
        db.query(FulfillmentInventoryDiscrepancy),
        counts,
        "fulfillment_inventory_discrepancies",
    )
    delete_query_rows(db.query(FulfillmentBoxItem), counts, "fulfillment_box_items")
    delete_query_rows(db.query(FulfillmentBox), counts, "fulfillment_boxes")
    delete_query_rows(db.query(FulfillmentShipment), counts, "fulfillment_shipments")


def erase_production_data(db: Session, counts: dict[str, int]) -> None:
    delete_query_rows(db.query(ProductionTask), counts, "production_tasks")
    delete_query_rows(db.query(ProductionBatch), counts, "production_batches")


def erase_product_data(db: Session, counts: dict[str, int], file_urls: set[str]) -> None:
    for product in db.query(Product).all():
        collect_static_upload_urls(file_urls, product.image_url, product.share_image_url, product.label_url)

    delete_query_rows(db.query(SupplierOrderItem), counts, "supplier_order_items")
    delete_query_rows(db.query(WorkflowStep), counts, "workflow_steps")
    delete_query_rows(db.query(StockMovement), counts, "stock_movements")
    delete_query_rows(db.query(Product), counts, "products")


def erase_supplier_data(db: Session, counts: dict[str, int]) -> None:
    delete_query_rows(db.query(SupplierOrderItem), counts, "supplier_order_items")
    delete_query_rows(db.query(SupplierSupplyItem), counts, "supplier_supply_items")
    delete_query_rows(db.query(SupplierPayment), counts, "supplier_payments")
    delete_query_rows(db.query(SupplierTransaction), counts, "supplier_transactions")
    delete_query_rows(db.query(StockMovement).filter(StockMovement.supplier_id.isnot(None)), counts, "stock_movements")
    delete_query_rows(db.query(Supplier), counts, "suppliers")


def erase_worker_data(db: Session, counts: dict[str, int]) -> None:
    for user in db.query(User).filter(User.worker_id.isnot(None)).all():
        user.worker_id = None
    worker_payment_transaction_ids = [
        row[0]
        for row in db.query(WorkerPayment.accounting_transaction_id)
        .filter(WorkerPayment.accounting_transaction_id.isnot(None))
        .all()
    ]
    if worker_payment_transaction_ids:
        delete_query_rows(
            db.query(AccountingTransaction).filter(
                AccountingTransaction.id.in_(worker_payment_transaction_ids),
                AccountingTransaction.source_type == ACCOUNTING_WORKER_PAYMENT_SOURCE,
            ),
            counts,
            "accounting_transactions",
        )
    delete_query_rows(db.query(OrderWorkflowTask), counts, "order_workflow_tasks")
    delete_query_rows(db.query(WorkerPayment), counts, "worker_payments")
    delete_query_rows(db.query(Worker), counts, "workers")


def erase_inspiration_data(db: Session, counts: dict[str, int], file_urls: set[str]) -> None:
    for item in db.query(InspirationItem).all():
        collect_static_upload_urls(file_urls, item.image_url)
    delete_query_rows(db.query(InspirationItem), counts, "inspiration_items")


def reset_website_settings(counts: dict[str, int]) -> None:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    WEBSITE_SETTINGS_FILE.write_text(
        json.dumps(DEFAULT_WEBSITE_SETTINGS, indent=2),
        encoding="utf-8",
    )
    add_erase_count(counts, "website_settings_reset", 1)


@app.get("/admin/data-erase/options")
def get_data_erase_options(request: Request, db: Session = Depends(get_db)):
    require_admin_user(request, db)
    return {"options": DATA_ERASE_OPTIONS}


@app.get("/admin/data/backup")
def download_data_backup(request: Request, db: Session = Depends(get_db)):
    admin_user = require_admin_user(request, db)
    temp_dir = Path(tempfile.mkdtemp(prefix="hisbenew-erp-backup-"))

    try:
        archive_path, backup_filename = build_data_backup_archive(temp_dir, admin_user)
        record_activity(
            db,
            actor_user_id=admin_user.id,
            actor_user_name=admin_user.username or admin_user.name,
            action="exported",
            entity_type="ERP data",
            entity_id=None,
            summary="Downloaded ERP data backup",
            detail=json.dumps({"format": "zip", "version": DATA_BACKUP_VERSION}),
            page="Settings",
            request_method="GET",
            request_path="/admin/data/backup",
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=backup_filename,
        background=BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True)),
    )


@app.post("/admin/data/restore")
def restore_data_backup(
    request: Request,
    file: UploadFile = File(...),
    confirm: bool = Form(False),
    db: Session = Depends(get_db),
):
    admin_user = require_admin_user(request, db)
    if not confirm:
        raise HTTPException(status_code=400, detail="Restore confirmation is required.")

    temp_dir = Path(tempfile.mkdtemp(prefix="hisbenew-erp-restore-"))
    try:
        extract_dir, metadata = extract_backup_archive(file, temp_dir)
        actor_name = admin_user.username or admin_user.name
        actor_id = admin_user.id
        db.close()

        restore_counts = restore_data_backup_from_extract(extract_dir, metadata)

        restored_db = SessionLocal()
        try:
            record_activity(
                restored_db,
                actor_user_id=actor_id,
                actor_user_name=actor_name,
                action="imported",
                entity_type="ERP data",
                entity_id=None,
                summary="Restored ERP data backup",
                detail=json.dumps(
                    {
                        "backup_created_at": metadata.get("created_at"),
                        "counts": restore_counts,
                    },
                    sort_keys=True,
                ),
                page="Settings",
                request_method="POST",
                request_path="/admin/data/restore",
            )
        finally:
            restored_db.close()
    except HTTPException:
        raise
    except Exception as restore_error:
        raise HTTPException(
            status_code=500,
            detail=f"Backup could not be restored: {restore_error}",
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return {
        "status": "restored",
        "backup_created_at": metadata.get("created_at"),
        "counts": restore_counts,
    }


@app.post("/admin/data-erase")
def erase_data(payload: DataEraseRequest, request: Request, db: Session = Depends(get_db)):
    admin_user = require_admin_user(request, db)
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Erase confirmation is required.")

    keys = expand_data_erase_keys(payload.keys)
    if not keys:
        raise HTTPException(status_code=400, detail="Choose at least one area to erase.")

    counts: dict[str, int] = {}
    file_urls: set[str] = set()

    try:
        if "fulfillment" in keys:
            erase_fulfillment_data(db, counts, file_urls)
        if "shipping" in keys:
            erase_shipping_data(db, counts)
        if "orders" in keys:
            erase_order_data(db, counts)
        if "production" in keys:
            erase_production_data(db, counts)
        if "workers" in keys:
            erase_worker_data(db, counts)
        if "manufacturing" in keys:
            delete_query_rows(db.query(WorkflowStep), counts, "workflow_steps")
        if "suppliers" in keys:
            erase_supplier_data(db, counts)
        if "payments" in keys:
            delete_query_rows(db.query(RegularBillPayment), counts, "regular_bill_payments")
            delete_query_rows(db.query(RegularBill), counts, "regular_bills")
        if "accounting" in keys:
            db.query(WorkerPayment).update(
                {WorkerPayment.accounting_transaction_id: None},
                synchronize_session=False,
            )
            delete_query_rows(db.query(AccountingTransaction), counts, "accounting_transactions")
            delete_query_rows(db.query(AccountingAccount), counts, "accounting_accounts")
        if "inspiration" in keys:
            erase_inspiration_data(db, counts, file_urls)
        if "products" in keys:
            erase_product_data(db, counts, file_urls)
        if "customers" in keys:
            delete_query_rows(db.query(Customer), counts, "customers")
        if "users" in keys:
            delete_query_rows(db.query(ActivityLog), counts, "activity_logs")
            delete_query_rows(db.query(User).filter(~User.role.in_(["admin", "super_admin"])), counts, "non_admin_users")
        if "website" in keys:
            reset_website_settings(counts)

        if payload.include_files:
            delete_static_upload_urls(file_urls, counts)
            if "uploads" in keys:
                delete_upload_tree(UPLOAD_DIR, counts)

        db.commit()
    except Exception:
        db.rollback()
        raise

    record_activity(
        db,
        actor_user_id=admin_user.id,
        actor_user_name=admin_user.username or admin_user.name,
        action="removed",
        entity_type="ERP data",
        entity_id=None,
        summary=f"Erased ERP data areas: {', '.join(sorted(keys))}",
        detail=json.dumps(counts, sort_keys=True),
        page="Settings",
        request_method="POST",
        request_path="/admin/data-erase",
    )

    return {
        "status": "erased",
        "keys": sorted(keys),
        "counts": counts,
        "files_included": payload.include_files,
    }


class EmailPreviewRequest(BaseModel):
    event_key: str = "production_task_assigned"
    context: dict = Field(default_factory=dict)


class EmailTestRequest(EmailPreviewRequest):
    recipient: str


def json_clone(value):
    return json.loads(json.dumps(value))


def deep_merge_dict(base: dict, incoming: dict | None) -> dict:
    merged = json_clone(base)
    if not isinstance(incoming, dict):
        return merged
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def normalize_email_settings(settings: dict | None = None) -> dict:
    normalized = deep_merge_dict(DEFAULT_EMAIL_SETTINGS, settings or {})
    normalized["enabled"] = bool(normalized.get("enabled"))
    normalized["provider"] = (
        normalized.get("provider")
        if normalized.get("provider") in {"smtp", "resend", "webhook"}
        else "smtp"
    )
    try:
        normalized["smtp"]["port"] = int(normalized["smtp"].get("port") or 587)
    except (TypeError, ValueError):
        normalized["smtp"]["port"] = 587
    normalized["smtp"]["use_tls"] = bool(normalized["smtp"].get("use_tls"))
    normalized["smtp"]["use_ssl"] = bool(normalized["smtp"].get("use_ssl"))

    incoming_events = normalized.get("events") if isinstance(normalized.get("events"), dict) else {}
    events = {}
    for event_key, default_event in DEFAULT_EMAIL_EVENTS.items():
        event = deep_merge_dict(default_event, incoming_events.get(event_key, {}))
        event["enabled"] = bool(event.get("enabled"))
        event["recipients"] = (
            event.get("recipients")
            if event.get("recipients") in {"worker", "admins", "both", "custom"}
            else default_event["recipients"]
        )
        event["custom_recipients"] = str(event.get("custom_recipients") or "")
        events[event_key] = event
    normalized["events"] = events
    return normalized


def load_email_settings() -> dict:
    if EMAIL_SETTINGS_FILE.exists():
        try:
            return normalize_email_settings(
                json.loads(EMAIL_SETTINGS_FILE.read_text(encoding="utf-8"))
            )
        except (OSError, json.JSONDecodeError):
            pass
    return normalize_email_settings()


def save_email_settings(settings: dict) -> dict:
    normalized = normalize_email_settings(settings)
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    EMAIL_SETTINGS_FILE.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    return normalized


def parse_email_list(value: str | list | None) -> list[str]:
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r"[,;\n]+", str(value or ""))
    seen: set[str] = set()
    emails: list[str] = []
    for item in raw_items:
        email = str(item or "").strip()
        if not email or "@" not in email:
            continue
        key = email.lower()
        if key not in seen:
            emails.append(email)
            seen.add(key)
    return emails


def render_email_tokens(template: str, context: dict) -> str:
    def replace(match):
        key = match.group(1).strip()
        value = context.get(key, "")
        if value is None:
            return ""
        return str(value)

    return re.sub(r"{{\s*([a-zA-Z0-9_]+)\s*}}", replace, str(template or ""))


def html_from_plain_text(value: str) -> str:
    return "<br>".join(html_escape(value).splitlines())


def render_email_template(settings: dict, event_key: str, context: dict) -> dict:
    normalized = normalize_email_settings(settings)
    event = normalized["events"].get(event_key) or next(iter(normalized["events"].values()))
    style = normalized["style"]
    subject = render_email_tokens(event.get("subject", ""), context).strip() or "ERP notification"
    preheader = render_email_tokens(event.get("preheader", ""), context).strip()
    heading = render_email_tokens(event.get("heading", ""), context).strip() or subject
    body_text = render_email_tokens(event.get("body", ""), context).strip()
    button_label = render_email_tokens(style.get("button_label", "Open ERP"), context).strip()
    button_url = render_email_tokens(style.get("button_url", ""), context).strip()
    accent = style.get("accent_color") or "#173a57"
    background = style.get("background_color") or "#f6f7f9"
    footer = render_email_tokens(style.get("footer_text", ""), context).strip()

    button_html = ""
    if button_url:
        button_html = (
            f'<p style="margin:24px 0 0">'
            f'<a href="{html_escape(button_url)}" '
            f'style="display:inline-block;background:{html_escape(accent)};color:#ffffff;'
            f'text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700">'
            f"{html_escape(button_label or 'Open ERP')}</a></p>"
        )

    html_body = f"""
<!doctype html>
<html>
  <body style="margin:0;background:{html_escape(background)};font-family:Arial,Helvetica,sans-serif;color:#111827">
    <div style="display:none;max-height:0;overflow:hidden">{html_escape(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{html_escape(background)};padding:28px 0">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:calc(100% - 28px);background:#ffffff;border:1px solid #dbe3eb;border-radius:14px;overflow:hidden">
            <tr><td style="height:6px;background:{html_escape(accent)}"></td></tr>
            <tr>
              <td style="padding:30px">
                <p style="margin:0 0 10px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Hisbenew ERP</p>
                <h1 style="margin:0;color:#101827;font-size:26px;line-height:1.2">{html_escape(heading)}</h1>
                <div style="margin-top:18px;color:#334155;font-size:15px;line-height:1.65">{html_from_plain_text(body_text)}</div>
                {button_html}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;line-height:1.5">
                {html_escape(footer)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
""".strip()

    return {
        "subject": subject,
        "preheader": preheader,
        "heading": heading,
        "text": body_text,
        "html": html_body,
    }


def send_email_message(settings: dict, recipients: list[str], subject: str, text: str, html: str) -> dict:
    normalized = normalize_email_settings(settings)
    recipients = parse_email_list(recipients)
    if not recipients:
        raise HTTPException(status_code=400, detail="No email recipients found.")

    from_email = (normalized.get("from_email") or "").strip()
    from_name = (normalized.get("from_name") or "Hisbenew ERP").strip()
    if not from_email:
        raise HTTPException(status_code=400, detail="From email is required.")

    cc = parse_email_list(normalized.get("cc"))
    bcc = parse_email_list(normalized.get("bcc"))
    all_recipients = recipients + cc + bcc
    provider = normalized.get("provider")

    if provider == "smtp":
        smtp_settings = normalized["smtp"]
        host = (smtp_settings.get("host") or "").strip()
        if not host:
            raise HTTPException(status_code=400, detail="SMTP host is required.")

        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = f"{from_name} <{from_email}>"
        message["To"] = ", ".join(recipients)
        if cc:
            message["Cc"] = ", ".join(cc)
        if normalized.get("reply_to"):
            message["Reply-To"] = normalized["reply_to"]
        message.set_content(text or subject)
        message.add_alternative(html or html_from_plain_text(text or subject), subtype="html")

        port = int(smtp_settings.get("port") or 587)
        username = (smtp_settings.get("username") or "").strip()
        password = smtp_settings.get("password") or ""
        if smtp_settings.get("use_ssl"):
            with smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context()) as server:
                if username:
                    server.login(username, password)
                server.send_message(message, to_addrs=all_recipients)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.ehlo()
                if smtp_settings.get("use_tls"):
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if username:
                    server.login(username, password)
                server.send_message(message, to_addrs=all_recipients)
        return {"provider": "smtp", "sent": len(recipients), "recipients": recipients}

    if provider == "resend":
        api_key = (normalized["api"].get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="Resend API key is required.")
        payload = {
            "from": f"{from_name} <{from_email}>",
            "to": recipients,
            "subject": subject,
            "html": html,
            "text": text,
        }
        if cc:
            payload["cc"] = cc
        if bcc:
            payload["bcc"] = bcc
        if normalized.get("reply_to"):
            payload["reply_to"] = normalized["reply_to"]
        req = urllib_request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=25) as response:
            raw = response.read().decode("utf-8", errors="replace")
        return {"provider": "resend", "sent": len(recipients), "response": raw}

    if provider == "webhook":
        endpoint = (normalized["api"].get("endpoint") or "").strip()
        if not endpoint:
            raise HTTPException(status_code=400, detail="Webhook endpoint is required.")
        headers = {"Content-Type": "application/json"}
        token = (normalized["api"].get("bearer_token") or normalized["api"].get("api_key") or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        payload = {
            "from": {"name": from_name, "email": from_email},
            "to": recipients,
            "cc": cc,
            "bcc": bcc,
            "subject": subject,
            "text": text,
            "html": html,
        }
        req = urllib_request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=25) as response:
            raw = response.read().decode("utf-8", errors="replace")
        return {"provider": "webhook", "sent": len(recipients), "response": raw}

    raise HTTPException(status_code=400, detail="Choose a valid email provider.")


def worker_notification_email(db: Session, worker: Worker | None) -> str:
    if not worker:
        return ""
    if worker.email:
        return worker.email
    user = (
        db.query(User)
        .filter(User.worker_id == worker.id, User.email.isnot(None), User.is_active == True)
        .first()
    )
    return user.email if user else ""


def email_recipients_for_event(settings: dict, event: dict, context: dict) -> list[str]:
    mode = event.get("recipients") or "worker"
    recipients: list[str] = []
    if mode in {"worker", "both"}:
        recipients.extend(parse_email_list(context.get("recipient_email") or context.get("worker_email")))
    if mode in {"admins", "both"}:
        recipients.extend(parse_email_list(settings.get("admin_recipients")))
    if mode == "custom":
        recipients.extend(parse_email_list(event.get("custom_recipients")))
    return parse_email_list(recipients)


def send_configured_email_event(db: Session, event_key: str, context: dict) -> dict:
    settings = load_email_settings()
    event = settings["events"].get(event_key)
    if not settings.get("enabled") or not event or not event.get("enabled"):
        return {"status": "skipped", "reason": "disabled"}

    recipients = email_recipients_for_event(settings, event, context)
    if not recipients:
        return {"status": "skipped", "reason": "no_recipients"}

    rendered = render_email_template(settings, event_key, context)
    try:
        result = send_email_message(
            settings,
            recipients,
            rendered["subject"],
            rendered["text"],
            rendered["html"],
        )
        return {"status": "sent", **result}
    except Exception as email_error:
        print(f"Email notification failed for {event_key}: {email_error}")
        return {"status": "failed", "error": str(email_error)}


def production_product_name(record) -> str:
    product = getattr(record, "product", None)
    if product:
        return product.name
    return (getattr(record, "custom_product_name", None) or "Custom work").strip()


def production_article_no(record) -> str:
    product = getattr(record, "product", None)
    if product:
        return product.article_no
    return (getattr(record, "custom_article_no", None) or "Custom").strip()


def production_product_image_url(record) -> str | None:
    product = getattr(record, "product", None)
    return product.image_url if product else None


def production_product_id(record) -> int | None:
    return record.product_id if getattr(record, "product", None) else None


def production_task_email_context(db: Session, task: ProductionTask, worker: Worker | None = None, extra: dict | None = None) -> dict:
    worker = worker or task.worker
    batch = task.batch
    due_date = task.expected_completion_time or (batch.due_date if batch else None)
    context = {
        "task_id": task.id,
        "task_name": task.step_name,
        "worker_name": worker.name if worker else "Worker",
        "worker_email": worker_notification_email(db, worker),
        "recipient_email": worker_notification_email(db, worker),
        "product_name": production_product_name(task),
        "article_no": production_article_no(task),
        "batch_no": batch.batch_no if batch else "",
        "quantity": task.assigned_quantity or 0,
        "completed_quantity": task.completed_quantity or 0,
        "due_date": format_datetime_for_email(due_date),
        "notes": "",
    }
    context.update(extra or {})
    return context


def order_workflow_task_email_context(db: Session, task: OrderWorkflowTask) -> dict:
    order = task.order
    worker = task.assigned_worker
    customer = order.customer if order else None
    return {
        "task_id": task.id,
        "task_name": task.title or task.task_type,
        "worker_name": worker.name if worker else "Worker",
        "worker_email": worker_notification_email(db, worker),
        "recipient_email": worker_notification_email(db, worker),
        "order_no": order.order_no if order else "",
        "customer_name": customer_personal_label(customer, order)
        if access_privacy_is_shipping_task(task.task_type)
        else "",
        "customer_email": customer.email if customer else "",
        "due_date": format_datetime_for_email(task.due_at),
        "notes": task.notes or "",
    }


def format_datetime_for_email(value) -> str:
    if not value:
        return "Not set"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    return str(value)


def sample_email_context(event_key: str, overrides: dict | None = None) -> dict:
    base = {
        "task_id": 101,
        "task_name": "Polishing",
        "worker_name": "Hafiz Umer",
        "worker_email": "worker@example.com",
        "recipient_email": "worker@example.com",
        "product_name": "Chef Knife Set",
        "article_no": "KLC-602",
        "batch_no": "PB-20260714-001",
        "quantity": 24,
        "completed_quantity": 0,
        "due_date": "2026-07-14 18:00",
        "notes": "Finish edge polishing before packing.",
        "order_no": "ORD-1001",
        "customer_name": "Wholesale Buyer",
        "customer_email": "buyer@example.com",
    }
    base.update(overrides or {})
    return base


@app.get("/admin/email-settings")
def get_admin_email_settings(request: Request, db: Session = Depends(get_db)):
    require_admin_user(request, db)
    return load_email_settings()


@app.get("/admin/call-settings")
def get_admin_call_settings(request: Request, db: Session = Depends(get_db)):
    require_admin_user(request, db)
    return load_call_settings()


@app.put("/admin/call-settings")
def update_admin_call_settings(
    payload: CallSettingsPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    admin_user = require_admin_user(request, db)
    settings = save_call_settings(payload.model_dump())
    record_activity(
        db,
        actor_user_id=admin_user.id,
        actor_user_name=admin_user.username or admin_user.name,
        action="updated",
        entity_type="call settings",
        summary=(
            "Enabled ERP video calls"
            if settings["video_calls_enabled"]
            else "Disabled ERP video calls"
        ),
        page="Settings",
        request_method="PUT",
        request_path="/admin/call-settings",
    )
    return settings


@app.put("/admin/email-settings")
def update_admin_email_settings(payload: dict, request: Request, db: Session = Depends(get_db)):
    admin_user = require_admin_user(request, db)
    settings = save_email_settings(payload)
    record_activity(
        db,
        actor_user_id=admin_user.id,
        actor_user_name=admin_user.username or admin_user.name,
        action="updated",
        entity_type="email settings",
        summary="Updated ERP email API settings",
        page="Settings",
        request_method="PUT",
        request_path="/admin/email-settings",
    )
    return settings


@app.post("/admin/email/preview")
def preview_admin_email(payload: EmailPreviewRequest, request: Request, db: Session = Depends(get_db)):
    require_admin_user(request, db)
    settings = load_email_settings()
    context = sample_email_context(payload.event_key, payload.context)
    return render_email_template(settings, payload.event_key, context)


@app.post("/admin/email/test")
def send_admin_test_email(payload: EmailTestRequest, request: Request, db: Session = Depends(get_db)):
    admin_user = require_admin_user(request, db)
    settings = load_email_settings()
    context = sample_email_context(payload.event_key, payload.context)
    context["recipient_email"] = payload.recipient
    rendered = render_email_template(settings, payload.event_key, context)
    result = send_email_message(
        settings,
        [payload.recipient],
        rendered["subject"],
        rendered["text"],
        rendered["html"],
    )
    record_activity(
        db,
        actor_user_id=admin_user.id,
        actor_user_name=admin_user.username or admin_user.name,
        action="sent",
        entity_type="test email",
        summary=f"Sent test email to {payload.recipient}",
        page="Settings",
        request_method="POST",
        request_path="/admin/email/test",
    )
    return {"status": "sent", **result}


def normalize_website_settings(settings: dict | None = None) -> dict:
    incoming = settings or {}
    normalized = DEFAULT_WEBSITE_SETTINGS.copy()

    for key, default_value in DEFAULT_WEBSITE_SETTINGS.items():
        value = incoming.get(key, default_value)
        if isinstance(default_value, bool):
            normalized[key] = bool(value)
        elif isinstance(default_value, int):
            try:
                if key == "featured_limit":
                    normalized[key] = max(1, min(24, int(value)))
                elif key == "hero_product_id":
                    normalized[key] = max(0, int(value))
                else:
                    normalized[key] = int(value)
            except (TypeError, ValueError):
                normalized[key] = default_value
        elif isinstance(default_value, list):
            normalized[key] = value if isinstance(value, list) else default_value.copy()
        else:
            normalized[key] = str(value or "").strip() or default_value

    for optional_key in ("phone", "email", "whatsapp", "canonical_url", "hero_image_url"):
        normalized[optional_key] = str(incoming.get(optional_key) or "").strip()

    valid_sections = DEFAULT_WEBSITE_SETTINGS["section_order"]
    ordered_sections = [
        section
        for section in normalized.get("section_order", [])
        if section in valid_sections
    ]
    normalized["section_order"] = ordered_sections + [
        section for section in valid_sections if section not in ordered_sections
    ]
    normalized["hidden_section_ids"] = [
        section
        for section in normalized.get("hidden_section_ids", [])
        if section in valid_sections and section != "hero"
    ]

    for key in ("featured_product_ids", "hidden_product_ids", "product_order_ids"):
        clean_ids = []
        seen = set()
        for value in normalized.get(key, []):
            try:
                product_id = int(value)
            except (TypeError, ValueError):
                continue
            if product_id <= 0 or product_id in seen:
                continue
            clean_ids.append(product_id)
            seen.add(product_id)
        normalized[key] = clean_ids[:500]

    return normalized


def load_website_settings() -> dict:
    try:
        if WEBSITE_SETTINGS_FILE.exists():
            return normalize_website_settings(
                json.loads(WEBSITE_SETTINGS_FILE.read_text(encoding="utf-8"))
            )
    except (OSError, json.JSONDecodeError):
        pass
    return DEFAULT_WEBSITE_SETTINGS.copy()


def save_website_settings(settings: dict) -> dict:
    normalized = normalize_website_settings(settings)
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    WEBSITE_SETTINGS_FILE.write_text(
        json.dumps(normalized, indent=2),
        encoding="utf-8",
    )
    return normalized


@app.get("/website-settings")
def get_website_settings():
    return load_website_settings()


@app.put("/website-settings")
def update_website_settings(payload: WebsiteSettingsPayload):
    return save_website_settings(payload.model_dump())


@app.get("/website-products")
def get_public_website_products(db: Session = Depends(get_db)):
    db.info["tenant_id"] = get_default_tenant(db).id
    settings = load_website_settings()
    hidden_product_ids = set(settings.get("hidden_product_ids") or [])
    return [
        public_website_product_response(product)
        for product in db.query(Product).order_by(Product.id.desc()).all()
        if product.id not in hidden_product_ids
    ]


@app.post("/users", response_model=UserOut)
def create_user(user: UserCreate, request: Request, db: Session = Depends(get_db)):
    clean_name = user.name.strip()
    clean_username = normalize_username(user.username, clean_name)
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not clean_username:
        raise HTTPException(status_code=400, detail="Username is required")
    ensure_username_available(db, clean_username)
    actor = require_page_access(request, db, "Users")
    target_tenant_id = (
        get_tenant_or_404(db, user.tenant_id).id
        if actor.role == "super_admin" and user.tenant_id is not None
        else (actor.tenant_id or get_default_tenant(db).id)
    )
    if actor.role == "super_admin":
        db.info["tenant_id"] = target_tenant_id

    worker_id = user.worker_id
    if user.role == "worker" and worker_id is None:
        new_worker = Worker(
            tenant_id=target_tenant_id,
            name=clean_name,
            role="Worker",
            phone=user.phone,
            email=user.email,
            department=None,
            rate_per_piece=0,
            is_active=user.is_active,
        )
        db.add(new_worker)
        db.commit()
        db.refresh(new_worker)
        worker_id = new_worker.id

    new_user = User(
        tenant_id=target_tenant_id,
        name=clean_name,
        username=clean_username,
        pin=hash_pin(user.pin),
        raw_pin=user.pin,
        role=user.role,
        phone=user.phone,
        email=user.email,
        allowed_pages=json.dumps(normalize_allowed_pages(user.role, user.allowed_pages)),
        customer_privacy_settings=json.dumps(
            normalize_access_privacy_settings(
                user.customer_privacy_settings,
                user.role,
            )
        ),
        session_expiry_minutes=normalize_session_expiry_minutes(
            user.session_expiry_minutes
        ),
        is_active=user.is_active,
        worker_id=worker_id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return user_response(new_user, db)


@app.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    identifier = (payload.username or payload.name or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Username is required")

    query = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(
            func.lower(func.coalesce(User.username, User.name)) == identifier.lower(),
            User.is_active == True,
        )
    )
    if payload.tenant_slug:
        tenant = tenant_for_slug(db, payload.tenant_slug)
        if not tenant:
            raise HTTPException(status_code=401, detail="Invalid credentials or inactive user")
        query = query.filter(User.tenant_id == tenant.id)
    user = query.first()
    if not user or not verify_pin(payload.pin, user.pin):
        raise HTTPException(status_code=401, detail="Invalid credentials or inactive user")
    if user.tenant_id is None:
        user.tenant_id = get_default_tenant(db).id
    elif user.tenant and (user.tenant.status or "active") != "active" and user.role != "super_admin":
        raise HTTPException(status_code=401, detail="Invalid credentials or inactive user")

    if not user.pin.startswith("pbkdf2_sha256$"):
        user.pin = hash_pin(payload.pin)

    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)
    record_activity(
        db,
        actor_user_id=user.id,
        actor_user_name=user.name,
        action="signed in",
        entity_type="user",
        entity_id=user.id,
        summary=f"{user.name} signed in",
        request_method="POST",
        request_path="/login",
    )
    access_token = create_user_access_token(user)
    return {
        **user_response(user, db),
        "access_token": access_token,
        "token_type": "bearer",
    }


@app.put("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, request: Request, db: Session = Depends(get_db)):
    actor = require_page_access(request, db, "Users")
    query = db.query(User)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    existing = query.filter(User.id == user_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    clean_name = payload.name.strip()
    clean_username = normalize_username(payload.username, clean_name)
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not clean_username:
        raise HTTPException(status_code=400, detail="Username is required")
    ensure_username_available(db, clean_username, existing.id)
    if payload.tenant_id is not None:
        if actor.role != "super_admin":
            raise HTTPException(status_code=403, detail="Only a super admin can move users between companies.")
        existing.tenant_id = get_tenant_or_404(db, payload.tenant_id).id
    elif existing.tenant_id is None:
        existing.tenant_id = actor.tenant_id or get_default_tenant(db).id

    existing.name = clean_name
    existing.username = clean_username
    if payload.pin is not None:
        existing.pin = hash_pin(payload.pin)
        existing.raw_pin = payload.pin
    existing.role = payload.role
    existing.phone = payload.phone
    existing.email = payload.email
    existing.allowed_pages = json.dumps(
        normalize_allowed_pages(payload.role, payload.allowed_pages)
    )
    existing.customer_privacy_settings = json.dumps(
        normalize_access_privacy_settings(
            payload.customer_privacy_settings,
            payload.role,
        )
    )
    existing.session_expiry_minutes = normalize_session_expiry_minutes(
        payload.session_expiry_minutes
    )
    existing.is_active = payload.is_active
    existing.worker_id = payload.worker_id
    if actor.role == "super_admin" and existing.tenant_id is not None:
        db.info["tenant_id"] = existing.tenant_id

    if payload.role == "worker" and existing.worker_id is None:
        new_worker = Worker(
            tenant_id=existing.tenant_id,
            name=clean_name,
            role="Worker",
            phone=payload.phone,
            email=payload.email,
            department=None,
            rate_per_piece=0,
            is_active=payload.is_active,
        )
        db.add(new_worker)
        db.commit()
        db.refresh(new_worker)
        existing.worker_id = new_worker.id

    db.commit()
    db.refresh(existing)
    return user_response(existing, db)


@app.patch("/users/{user_id}/pin", response_model=UserOut)
def reset_user_pin(user_id: int, payload: UserPinReset, request: Request, db: Session = Depends(get_db)):
    actor = require_super_admin(request, db)
    existing = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.id == user_id)
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    existing.pin = hash_pin(payload.pin)
    existing.raw_pin = payload.pin
    existing.updated_at = datetime.utcnow()
    if existing.tenant_id is not None:
        db.info["tenant_id"] = existing.tenant_id
    record_activity(
        db,
        actor_user_id=actor.id,
        actor_user_name=actor.name,
        action="reset user pin",
        entity_type="user",
        entity_id=existing.id,
        summary=f"Reset login PIN for {existing.name}",
        request_method="PATCH",
        request_path=f"/users/{user_id}/pin",
    )
    db.commit()
    db.refresh(existing)
    return user_response(existing, db)

@app.post("/users/{user_id}/customer-privacy-settings", response_model=UserOut)
@app.put("/users/{user_id}/customer-privacy-settings", response_model=UserOut)
@app.patch("/users/{user_id}/customer-privacy-settings", response_model=UserOut)
def update_user_customer_privacy_settings(
    user_id: int,
    payload: AccessPrivacySettingsPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    actor = require_page_access(request, db, "Users")
    query = db.query(User)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    existing = query.filter(User.id == user_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")

    existing.customer_privacy_settings = json.dumps(
        normalize_access_privacy_settings(
            payload.model_dump(),
            existing.role,
        )
    )
    if actor.role == "super_admin" and existing.tenant_id is not None:
        db.info["tenant_id"] = existing.tenant_id
    db.commit()
    db.refresh(existing)
    return user_response(existing, db)


@app.put("/users/{user_id}/profile", response_model=UserOut)
def update_user_profile(user_id: int, payload: UserProfileUpdate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.id == user_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")

    clean_name = payload.name.strip()
    clean_username = (
        normalize_username(payload.username, clean_name)
        if payload.username is not None
        else (existing.username or clean_name).strip()
    )
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name is required")
    ensure_username_available(db, clean_username, existing.id)

    existing.name = clean_name
    existing.username = clean_username
    if payload.pin is not None:
        existing.pin = hash_pin(payload.pin)

    db.commit()
    db.refresh(existing)
    return user_response(existing, db)


@app.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).execution_options(skip_tenant_scope=True).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user_response(user, db)


@app.post("/role-requests", response_model=RoleRequestOut)
def create_role_request(
    payload: RoleRequestCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = getattr(request.state, "user_id", None)
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    role_request = UserRoleRequest(
        user_id=user.id,
        user_name=user.name,
        username=user.username,
        requested_role=(payload.requested_role or "").strip() or None,
        contact_phone=(payload.contact_phone or user.phone or "").strip() or None,
        contact_email=(payload.contact_email or user.email or "").strip() or None,
        message=(payload.message or "").strip() or None,
        status="Open",
    )
    db.add(role_request)
    db.commit()
    db.refresh(role_request)
    return role_request_response(role_request)


@app.get("/role-requests", response_model=list[RoleRequestOut])
def get_role_requests(request: Request, db: Session = Depends(get_db)):
    actor = require_page_access(request, db, "Users")
    query = db.query(UserRoleRequest)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    requests = (
        query
        .order_by(UserRoleRequest.created_at.desc(), UserRoleRequest.id.desc())
        .limit(200)
        .all()
    )
    return [role_request_response(item) for item in requests]


@app.patch("/role-requests/{request_id}", response_model=RoleRequestOut)
def update_role_request(
    request_id: int,
    payload: RoleRequestUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    actor = require_page_access(request, db, "Users")
    query = db.query(UserRoleRequest)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    role_request = query.filter(UserRoleRequest.id == request_id).first()
    if not role_request:
        raise HTTPException(status_code=404, detail="Role request not found")

    clean_status = (payload.status or "Reviewed").strip() or "Reviewed"
    role_request.status = clean_status
    role_request.admin_note = (payload.admin_note or "").strip() or None
    role_request.reviewed_at = datetime.utcnow()
    if actor.role == "super_admin" and role_request.tenant_id is not None:
        db.info["tenant_id"] = role_request.tenant_id
    db.commit()
    db.refresh(role_request)
    return role_request_response(role_request)


@app.delete("/role-requests/{request_id}")
def delete_role_request(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    actor = require_page_access(request, db, "Users")
    query = db.query(UserRoleRequest)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    role_request = query.filter(UserRoleRequest.id == request_id).first()
    if not role_request:
        raise HTTPException(status_code=404, detail="Role request not found")

    db.delete(role_request)
    db.commit()
    return {"status": "deleted", "deleted_request_id": request_id}


@app.post("/access-requests", response_model=PublicAccessRequestOut)
def create_public_access_request(
    payload: PublicAccessRequestCreate,
    db: Session = Depends(get_db),
):
    clean_name = (payload.full_name or "").strip()
    tenant = tenant_for_slug(db, payload.tenant_slug) if payload.tenant_slug else get_default_tenant(db)
    if not tenant:
        raise HTTPException(status_code=400, detail="Requested company tenant was not found.")
    clean_username = (payload.preferred_username or "").strip() or None
    clean_email = (payload.work_email or "").strip() or None
    clean_phone = (payload.phone or "").strip() or None
    clean_workspace = (payload.requested_workspace or "").strip() or None
    clean_message = (payload.message or "").strip() or None

    if not clean_name:
        raise HTTPException(status_code=400, detail="Full name is required.")
    if not clean_email and not clean_phone:
        raise HTTPException(status_code=400, detail="Add an email or phone number.")

    access_request = PublicAccessRequest(
        tenant_id=tenant.id,
        full_name=clean_name,
        preferred_username=clean_username,
        work_email=clean_email,
        phone=clean_phone,
        requested_workspace=clean_workspace,
        message=clean_message,
        status="Pending",
    )
    db.add(access_request)
    db.commit()
    db.refresh(access_request)
    return public_access_request_response(access_request, db)


class PublicOrderCreatePayload(BaseModel):
    customer_name: str
    customer_email: str | None = None
    customer_phone: str | None = None
    shipping_address: str | None = None
    payment_method: str | None = "card"
    notes: str | None = None
    items: list[dict] = Field(default_factory=list)
    total_usd: float = 0.0


@app.post("/public-order")
def create_public_website_order(
    payload: PublicOrderCreatePayload,
    db: Session = Depends(get_db),
):
    clean_name = (payload.customer_name or "").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Customer name is required.")

    tenant = get_default_tenant(db)
    tenant_id = tenant.id if tenant else 1

    clean_email = (payload.customer_email or "").strip() or None
    clean_phone = (payload.customer_phone or "").strip() or None
    clean_address = (payload.shipping_address or "").strip() or None

    customer = None
    if clean_email:
        customer = (
            db.query(Customer)
            .execution_options(skip_tenant_scope=True)
            .filter(Customer.email == clean_email)
            .first()
        )

    if not customer:
        customer = Customer(
            tenant_id=tenant_id,
            name=clean_name,
            email=clean_email,
            phone=clean_phone,
            address=clean_address,
            shipping_address=clean_address,
            platform="Website",
        )
        db.add(customer)
        db.flush()

    order_no = f"ORD-WEB-{int(datetime.utcnow().timestamp())}"
    order = Order(
        tenant_id=tenant_id,
        order_no=order_no,
        customer_id=customer.id,
        import_customer_name=clean_name,
        import_contact_phone=clean_phone,
        import_shipping_name=clean_name,
        import_shipping_address=clean_address,
        platform="Website",
        order_date=datetime.utcnow(),
        payment_status="Paid" if payload.payment_method == "card" else "Pending",
        shipping_status="Pending",
        order_total_usd=float(payload.total_usd or 0),
        notes=f"Website order via {payload.payment_method or 'Card'}. Address: {clean_address}",
    )
    db.add(order)
    db.flush()

    for item in payload.items:
        product_id = item.get("id")
        quantity = max(1, int(item.get("quantity", 1)))
        price = float(item.get("price", 0))
        line_total = float(price * quantity)
        if product_id:
            order_item = OrderItem(
                tenant_id=tenant_id,
                order_id=order.id,
                product_id=int(product_id),
                quantity=quantity,
                unit_price=price,
                line_total=line_total,
                stock_source="Factory",
            )
            db.add(order_item)

    record_activity(
        db,
        actor_user_id=None,
        actor_user_name="Website Customer",
        action="Created",
        entity_type="Order",
        entity_id=str(order.id),
        summary=f"Website order #{order.order_no} placed by {clean_name} (${payload.total_usd:.2f})",
        detail=f"Customer: {clean_name} ({clean_email or 'no email'}), Total: ${payload.total_usd:.2f}",
        page="Orders",
        request_method="POST",
        request_path="/public-order",
    )

    db.commit()
    return {
        "status": "success",
        "order_id": order.order_no,
        "customer_name": clean_name,
        "total_usd": payload.total_usd,
    }


class PublicLiveChatPayload(BaseModel):
    session_id: str
    visitor_name: str | None = None
    visitor_email: str | None = None
    message: str


@app.post("/public-live-chat")
def post_public_live_chat(
    payload: PublicLiveChatPayload,
    db: Session = Depends(get_db),
):
    session_id = (payload.session_id or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    clean_message = (payload.message or "").strip()
    if not clean_message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    tenant = get_default_tenant(db)
    tenant_id = tenant.id if tenant else 1

    visitor_username = f"visitor_{session_id[:16]}"
    clean_name = (payload.visitor_name or "").strip() or "Website Visitor"
    display_name = f"💬 {clean_name}"

    visitor_user = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.username == visitor_username)
        .first()
    )

    if not visitor_user:
        visitor_user = User(
            tenant_id=tenant_id,
            name=display_name,
            username=visitor_username,
            email=(payload.visitor_email or "").strip() or None,
            role="visitor",
            is_active=True,
        )
        db.add(visitor_user)
        db.flush()
    else:
        if payload.visitor_name and visitor_user.name != display_name:
            visitor_user.name = display_name
            db.flush()

    admin_user = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.is_active == True, User.role.in_(["admin", "super_admin", "manager"]))
        .order_by(User.id.asc())
        .first()
    ) or (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.is_active == True, User.id != visitor_user.id)
        .order_by(User.id.asc())
        .first()
    )

    admin_id = admin_user.id if admin_user else 1
    now = datetime.utcnow()

    msg = InternalMessage(
        tenant_id=tenant_id,
        sender_user_id=visitor_user.id,
        recipient_user_id=admin_id,
        body=clean_message,
        created_at=now,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    with contextlib.suppress(Exception):
        publish_internal_message(msg)

    record_activity(
        db,
        actor_user_id=visitor_user.id,
        actor_user_name=visitor_user.name,
        action="Live Chat Message",
        entity_type="InternalMessage",
        entity_id=str(msg.id),
        summary=f"Live Chat message from {clean_name}: {clean_message[:60]}",
        detail=clean_message,
        page="Messages",
        request_method="POST",
        request_path="/public-live-chat",
    )

    return {
        "status": "success",
        "message_id": msg.id,
        "created_at": now.isoformat(),
    }


@app.get("/public-live-chat/{session_id}")
def get_public_live_chat(
    session_id: str,
    db: Session = Depends(get_db),
):
    session_id = (session_id or "").strip()
    if not session_id:
        return []

    visitor_username = f"visitor_{session_id[:16]}"
    visitor_user = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.username == visitor_username)
        .first()
    )

    if not visitor_user:
        return []

    messages = (
        db.query(InternalMessage)
        .execution_options(skip_tenant_scope=True)
        .filter(
            (InternalMessage.sender_user_id == visitor_user.id)
            | (InternalMessage.recipient_user_id == visitor_user.id)
        )
        .order_by(InternalMessage.created_at.asc())
        .all()
    )

    results = []
    for msg in messages:
        sender_user = (
            db.query(User)
            .execution_options(skip_tenant_scope=True)
            .filter(User.id == msg.sender_user_id)
            .first()
        )
        is_from_visitor = (msg.sender_user_id == visitor_user.id)
        results.append({
            "id": msg.id,
            "sender_name": visitor_user.name if is_from_visitor else (sender_user.name if sender_user else "Hisbenew Factory Support"),
            "is_from_visitor": is_from_visitor,
            "body": msg.body,
            "created_at": msg.created_at.isoformat() if msg.created_at else "",
        })

    return results


@app.get("/access-requests", response_model=list[PublicAccessRequestOut])
def list_public_access_requests(request: Request, db: Session = Depends(get_db)):
    actor = require_page_access(request, db, "Users")
    query = db.query(PublicAccessRequest)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    requests = (
        query
        .order_by(PublicAccessRequest.created_at.desc(), PublicAccessRequest.id.desc())
        .limit(200)
        .all()
    )
    return [public_access_request_response(item, db) for item in requests]


@app.post("/access-requests/{request_id}/approve", response_model=PublicAccessRequestOut)
def approve_public_access_request(
    request_id: int,
    payload: PublicAccessRequestReview,
    request: Request,
    db: Session = Depends(get_db),
):
    admin_user = require_page_access(request, db, "Users")
    query = db.query(PublicAccessRequest)
    if admin_user.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    access_request = query.filter(PublicAccessRequest.id == request_id).first()
    if not access_request:
        raise HTTPException(status_code=404, detail="Access request not found")
    if access_request.approved_user_id:
        raise HTTPException(status_code=400, detail="This request is already approved")

    clean_name = (payload.name or access_request.full_name or "").strip()
    clean_username = normalize_username(
        payload.username or access_request.preferred_username,
        clean_name,
    )
    clean_role = (payload.role or "unassigned").strip()
    if clean_role not in ROLE_PAGE_DEFAULTS:
        clean_role = "unassigned"

    if not clean_name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not clean_username:
        raise HTTPException(status_code=400, detail="Username is required")
    ensure_username_available(db, clean_username)

    target_tenant_id = access_request.tenant_id or admin_user.tenant_id or get_default_tenant(db).id
    if admin_user.role == "super_admin":
        db.info["tenant_id"] = target_tenant_id

    clean_phone = (payload.phone or access_request.phone or "").strip() or None
    clean_email = (payload.email or access_request.work_email or "").strip() or None
    worker_id = None
    if clean_role == "worker":
        new_worker = Worker(
            tenant_id=target_tenant_id,
            name=clean_name,
            role="Worker",
            phone=clean_phone,
            email=clean_email,
            department=None,
            rate_per_piece=0,
            is_active=payload.is_active,
        )
        db.add(new_worker)
        db.commit()
        db.refresh(new_worker)
        worker_id = new_worker.id

    new_user = User(
        tenant_id=target_tenant_id,
        name=clean_name,
        username=clean_username,
        pin=hash_pin(payload.pin),
        role=clean_role,
        phone=clean_phone,
        email=clean_email,
        allowed_pages=json.dumps(normalize_allowed_pages(clean_role, payload.allowed_pages)),
        customer_privacy_settings=json.dumps(
            normalize_access_privacy_settings(
                payload.customer_privacy_settings,
                clean_role,
            )
        ),
        session_expiry_minutes=normalize_session_expiry_minutes(
            payload.session_expiry_minutes
        ),
        is_active=payload.is_active,
        worker_id=worker_id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_request.status = "Approved"
    access_request.admin_note = (payload.admin_note or "").strip() or None
    access_request.approved_user_id = new_user.id
    access_request.reviewed_by_user_id = admin_user.id
    access_request.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(access_request)

    record_activity(
        db,
        actor_user_id=admin_user.id,
        actor_user_name=admin_user.name,
        action="approved access request",
        entity_type="user",
        entity_id=new_user.id,
        summary=f"Approved access request for {new_user.name}",
        detail=f"Request #{access_request.id} became @{new_user.username}",
        request_method="POST",
        request_path=f"/access-requests/{request_id}/approve",
    )
    return public_access_request_response(access_request, db)


@app.patch("/access-requests/{request_id}", response_model=PublicAccessRequestOut)
def update_public_access_request(
    request_id: int,
    payload: PublicAccessRequestUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    admin_user = require_page_access(request, db, "Users")
    query = db.query(PublicAccessRequest)
    if admin_user.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    access_request = query.filter(PublicAccessRequest.id == request_id).first()
    if not access_request:
        raise HTTPException(status_code=404, detail="Access request not found")

    clean_status = (payload.status or "Reviewed").strip() or "Reviewed"
    if clean_status not in {"Pending", "Contacted", "Rejected", "Reviewed", "Approved"}:
        raise HTTPException(status_code=400, detail="Unsupported access request status")
    if access_request.approved_user_id and clean_status != "Approved":
        raise HTTPException(status_code=400, detail="Approved requests cannot be reopened")

    access_request.status = clean_status
    access_request.admin_note = (payload.admin_note or "").strip() or None
    access_request.reviewed_by_user_id = admin_user.id
    access_request.reviewed_at = datetime.utcnow()
    if admin_user.role == "super_admin" and access_request.tenant_id is not None:
        db.info["tenant_id"] = access_request.tenant_id
    db.commit()
    db.refresh(access_request)
    return public_access_request_response(access_request, db)


@app.delete("/access-requests/{request_id}")
def delete_public_access_request(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    actor = require_page_access(request, db, "Users")
    query = db.query(PublicAccessRequest)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    access_request = query.filter(PublicAccessRequest.id == request_id).first()
    if not access_request:
        raise HTTPException(status_code=404, detail="Access request not found")

    db.delete(access_request)
    db.commit()
    return {"status": "deleted", "deleted_request_id": request_id}

@app.get("/internal-message-users", response_model=list[InternalMessageUserOut])
def get_internal_message_users(request: Request, db: Session = Depends(get_db)):
    current_user = get_authenticated_user(request, db)
    users = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.is_active == True, User.id != current_user.id)
        .order_by(User.name.asc())
        .all()
    )
    unread_rows = (
        db.query(InternalMessage.sender_user_id, func.count(InternalMessage.id))
        .execution_options(skip_tenant_scope=True)
        .filter(
            InternalMessage.read_at.is_(None),
        )
        .group_by(InternalMessage.sender_user_id)
        .all()
    )
    unread_by_sender = {sender_id: count for sender_id, count in unread_rows}

    results = []
    for user in users:
        if user.role == "visitor":
            last_message_at = (
                db.query(func.max(InternalMessage.created_at))
                .execution_options(skip_tenant_scope=True)
                .filter(
                    or_(
                        InternalMessage.sender_user_id == user.id,
                        InternalMessage.recipient_user_id == user.id,
                    )
                )
                .scalar()
            )
            if not last_message_at:
                continue
        else:
            last_message_at = (
                db.query(func.max(InternalMessage.created_at))
                .execution_options(skip_tenant_scope=True)
                .filter(
                    (
                        (InternalMessage.sender_user_id == current_user.id)
                        & (InternalMessage.recipient_user_id == user.id)
                    )
                    | (
                        (InternalMessage.sender_user_id == user.id)
                        & (InternalMessage.recipient_user_id == current_user.id)
                    )
                )
                .scalar()
            )
        results.append(
            {
                "id": user.id,
                "name": user.name,
                "username": user.username or user.name,
                "role": user.role,
                "unread_count": int(unread_by_sender.get(user.id, 0) or 0),
                "last_message_at": last_message_at,
            }
        )

    return sorted(
        results,
        key=lambda item: (
            item["unread_count"] > 0,
            item["last_message_at"] or datetime.min,
            item["name"].lower(),
        ),
        reverse=True,
    )


@app.get("/internal-messages/unread-count")
def get_internal_message_unread_count(request: Request, db: Session = Depends(get_db)):
    current_user = get_authenticated_user(request, db)
    unread_count = (
        db.query(func.count(InternalMessage.id))
        .filter(
            InternalMessage.recipient_user_id == current_user.id,
            InternalMessage.read_at.is_(None),
        )
        .scalar()
    )
    return {"unread_count": int(unread_count or 0)}


@app.get("/internal-messages", response_model=list[InternalMessageOut])
def get_internal_messages(
    request: Request,
    user_id: int = Query(...),
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    other_user = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.id == user_id, User.is_active == True)
        .first()
    )
    if not other_user:
        raise HTTPException(status_code=404, detail="User not found")

    if other_user.role == "visitor":
        db.query(InternalMessage).execution_options(skip_tenant_scope=True).filter(
            InternalMessage.sender_user_id == other_user.id,
            InternalMessage.read_at.is_(None),
        ).update({InternalMessage.read_at: datetime.utcnow()}, synchronize_session=False)
    else:
        db.query(InternalMessage).execution_options(skip_tenant_scope=True).filter(
            InternalMessage.sender_user_id == other_user.id,
            InternalMessage.recipient_user_id == current_user.id,
            InternalMessage.read_at.is_(None),
        ).update({InternalMessage.read_at: datetime.utcnow()}, synchronize_session=False)
    db.commit()

    if other_user.role == "visitor":
        messages = (
            db.query(InternalMessage)
            .execution_options(skip_tenant_scope=True)
            .filter(
                (InternalMessage.sender_user_id == other_user.id)
                | (InternalMessage.recipient_user_id == other_user.id)
            )
            .order_by(InternalMessage.created_at.asc(), InternalMessage.id.asc())
            .all()
        )
    else:
        messages = (
            db.query(InternalMessage)
            .execution_options(skip_tenant_scope=True)
            .filter(
                (
                    (InternalMessage.sender_user_id == current_user.id)
                    & (InternalMessage.recipient_user_id == other_user.id)
                )
                | (
                    (InternalMessage.sender_user_id == other_user.id)
                    & (InternalMessage.recipient_user_id == current_user.id)
                )
            )
            .order_by(InternalMessage.created_at.asc(), InternalMessage.id.asc())
            .all()
        )
    return [internal_message_response(message, current_user.id) for message in messages]


@app.post("/internal-messages", response_model=InternalMessageOut)
def create_internal_message(
    payload: InternalMessageCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    recipient = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.id == payload.recipient_user_id, User.is_active == True)
        .first()
    )
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if recipient.id == current_user.id:
        raise HTTPException(status_code=400, detail="Choose another user to message")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message is required")

    message = InternalMessage(
        sender_user_id=current_user.id,
        recipient_user_id=recipient.id,
        body=body,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    response = internal_message_response(message, current_user.id)
    publish_internal_message(message)
    return response


@app.get("/internal-calls/active", response_model=InternalCallOut | None)
def get_active_internal_call(request: Request, db: Session = Depends(get_db)):
    current_user = get_authenticated_user(request, db)
    expire_stale_internal_calls(db)
    call = (
        db.query(InternalCall)
        .filter(
            InternalCall.status.in_(ACTIVE_INTERNAL_CALL_STATUSES),
            or_(
                InternalCall.caller_user_id == current_user.id,
                InternalCall.recipient_user_id == current_user.id,
            ),
        )
        .order_by(InternalCall.created_at.desc(), InternalCall.id.desc())
        .first()
    )
    if call:
        touch_internal_call_participant(db, call, current_user.id)
    return internal_call_response(call, current_user.id) if call else None


@app.get("/internal-calls/config")
def get_internal_call_config(request: Request, db: Session = Depends(get_db)):
    get_authenticated_user(request, db)
    return {
        "ice_servers": INTERNAL_CALL_ICE_SERVERS,
        **load_call_settings(),
    }


@app.get("/internal-calls/{call_id}", response_model=InternalCallOut)
def get_internal_call(
    call_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    expire_stale_internal_calls(db)
    call = get_internal_call_for_user(db, call_id, current_user.id)
    touch_internal_call_participant(db, call, current_user.id)
    return internal_call_response(call, current_user.id)


@app.post("/internal-calls", response_model=InternalCallOut)
def create_internal_call(
    payload: InternalCallCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    recipient = (
        db.query(User)
        .filter(User.id == payload.recipient_user_id, User.is_active == True)
        .first()
    )
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found")
    if recipient.id == current_user.id:
        raise HTTPException(status_code=400, detail="Choose another user to call")

    call_type = payload.call_type.strip().lower()
    if call_type not in {"audio", "video"}:
        raise HTTPException(status_code=400, detail="Call type must be audio or video")
    if call_type == "video" and not load_call_settings()["video_calls_enabled"]:
        raise HTTPException(
            status_code=403,
            detail="Video calls are disabled by the ERP administrator",
        )

    expire_stale_internal_calls(db)
    current_user_call = (
        db.query(InternalCall)
        .filter(
            InternalCall.status.in_(ACTIVE_INTERNAL_CALL_STATUSES),
            or_(
                InternalCall.caller_user_id == current_user.id,
                InternalCall.recipient_user_id == current_user.id,
            ),
        )
        .first()
    )
    if current_user_call:
        raise HTTPException(status_code=409, detail="You already have an active call")

    recipient_call = (
        db.query(InternalCall)
        .filter(
            InternalCall.status.in_(ACTIVE_INTERNAL_CALL_STATUSES),
            or_(
                InternalCall.caller_user_id == recipient.id,
                InternalCall.recipient_user_id == recipient.id,
            ),
        )
        .first()
    )
    if recipient_call:
        raise HTTPException(status_code=409, detail=f"{recipient.name} is on another call")

    now = datetime.utcnow()
    call = InternalCall(
        caller_user_id=current_user.id,
        recipient_user_id=recipient.id,
        call_type=call_type,
        status="ringing",
        caller_last_seen_at=now,
        recipient_last_seen_at=now,
    )
    db.add(call)
    db.commit()
    db.refresh(call)
    response = internal_call_response(call, current_user.id)
    publish_internal_call(call)
    return response


@app.post("/internal-calls/{call_id}/respond", response_model=InternalCallOut)
def respond_to_internal_call(
    call_id: int,
    payload: InternalCallAction,
    request: Request,
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    call = get_internal_call_for_user(db, call_id, current_user.id)
    if call.recipient_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the called user can respond")
    if call.status != "ringing":
        raise HTTPException(status_code=409, detail="This call is no longer ringing")

    action = payload.action.strip().lower()
    now = datetime.utcnow()
    if action == "accept":
        call.status = "accepted"
        call.answered_at = now
        call.caller_last_seen_at = now
        call.recipient_last_seen_at = now
    elif action == "decline":
        call.status = "declined"
        call.ended_at = now
        call.ended_by_user_id = current_user.id
    else:
        raise HTTPException(status_code=400, detail="Action must be accept or decline")
    db.commit()
    db.refresh(call)
    response = internal_call_response(call, current_user.id)
    publish_internal_call(call)
    return response


@app.post("/internal-calls/{call_id}/end", response_model=InternalCallOut)
def end_internal_call(
    call_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    call = get_internal_call_for_user(db, call_id, current_user.id)
    if call.status not in TERMINAL_INTERNAL_CALL_STATUSES:
        call.status = "cancelled" if call.status == "ringing" else "ended"
        call.ended_at = datetime.utcnow()
        call.ended_by_user_id = current_user.id
        db.commit()
        db.refresh(call)
    response = internal_call_response(call, current_user.id)
    publish_internal_call(call)
    return response


@app.get(
    "/internal-calls/{call_id}/signals",
    response_model=list[InternalCallSignalOut],
)
def get_internal_call_signals(
    call_id: int,
    request: Request,
    after_id: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    call = get_internal_call_for_user(db, call_id, current_user.id)
    touch_internal_call_participant(db, call, current_user.id)
    signals = (
        db.query(InternalCallSignal)
        .filter(
            InternalCallSignal.call_id == call_id,
            InternalCallSignal.sender_user_id != current_user.id,
            InternalCallSignal.id > after_id,
        )
        .order_by(InternalCallSignal.id.asc())
        .limit(250)
        .all()
    )
    return [internal_call_signal_response(signal) for signal in signals]


@app.post(
    "/internal-calls/{call_id}/signals",
    response_model=InternalCallSignalOut,
)
def create_internal_call_signal(
    call_id: int,
    payload: InternalCallSignalCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    current_user = get_authenticated_user(request, db)
    call = get_internal_call_for_user(db, call_id, current_user.id)
    touch_internal_call_participant(db, call, current_user.id)
    if call.status not in ACTIVE_INTERNAL_CALL_STATUSES:
        raise HTTPException(status_code=409, detail="This call has ended")

    signal_type = payload.signal_type.strip().lower()
    if signal_type not in {"offer", "answer", "ice", "media-state"}:
        raise HTTPException(status_code=400, detail="Unsupported call signal")
    encoded_payload = json.dumps(payload.payload, separators=(",", ":"))
    if len(encoded_payload) > 100_000:
        raise HTTPException(status_code=413, detail="Call signal is too large")

    signal = InternalCallSignal(
        call_id=call.id,
        sender_user_id=current_user.id,
        signal_type=signal_type,
        payload=encoded_payload,
    )
    db.add(signal)
    db.commit()
    db.refresh(signal)
    response = internal_call_signal_response(signal)
    publish_internal_call_signal(call, signal)
    return response


@app.websocket("/ws/realtime")
async def realtime_websocket(websocket: WebSocket):
    """Authenticated push channel for messages, calls, and WebRTC signaling."""
    await websocket.accept()
    user_id: int | None = None
    connected = False
    try:
        try:
            auth_message = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        except (asyncio.TimeoutError, ValueError, TypeError):
            await websocket.close(code=4401, reason="Authentication required")
            return
        if not isinstance(auth_message, dict) or auth_message.get("type") != "auth" or not auth_message.get("token"):
            await websocket.close(code=4401, reason="Authentication required")
            return
        try:
            token_payload = decode_access_token(str(auth_message["token"]))
            user_id = int(token_payload.get("sub", "0"))
        except (HTTPException, TypeError, ValueError):
            await websocket.close(code=4401, reason="Invalid authentication token")
            return

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
            if not user:
                await websocket.close(code=4401, reason="Invalid authentication token")
                return
            expire_stale_internal_calls(db)
            active_call = (
                db.query(InternalCall)
                .filter(
                    InternalCall.status.in_(ACTIVE_INTERNAL_CALL_STATUSES),
                    or_(
                        InternalCall.caller_user_id == user_id,
                        InternalCall.recipient_user_id == user_id,
                    ),
                )
                .order_by(InternalCall.created_at.desc(), InternalCall.id.desc())
                .first()
            )
            active_call_payload = (
                internal_call_response(active_call, user_id) if active_call else None
            )
        finally:
            db.close()

        await realtime_hub.connect(user_id, websocket)
        connected = True
        await websocket.send_json({"type": "realtime.ready"})
        if active_call_payload:
            await websocket.send_json(
                {"type": "call.updated", "call": active_call_payload}
            )

        while True:
            message = await websocket.receive_json()
            message_type = str(message.get("type") or "")
            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if message_type != "call.heartbeat":
                continue
            try:
                call_id = int(message.get("call_id") or 0)
            except (TypeError, ValueError):
                continue
            if call_id <= 0:
                continue
            db = SessionLocal()
            try:
                call = get_internal_call_for_user(db, call_id, user_id)
                touch_internal_call_participant(db, call, user_id)
                if call.status in TERMINAL_INTERNAL_CALL_STATUSES:
                    await websocket.send_json(
                        {
                            "type": "call.updated",
                            "call": internal_call_response(call, user_id),
                        }
                    )
            except HTTPException:
                await websocket.send_json(
                    {"type": "call.missing", "call_id": call_id}
                )
            finally:
                db.close()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"Realtime WebSocket closed after an error: {exc}")
        with contextlib.suppress(Exception):
            await websocket.close(code=1011)
    finally:
        if connected and user_id is not None:
            await realtime_hub.disconnect(user_id, websocket)


@app.get("/users/{user_id}/activity-logs", response_model=list[ActivityLogOut])
def get_user_activity_logs(
    user_id: int,
    request: Request,
    limit: int = Query(100, ge=1, le=300),
    action: str | None = Query(None),
    db: Session = Depends(get_db),
):
    actor = require_page_access(request, db, "Users")
    user_query = db.query(User)
    if actor.role == "super_admin":
        user_query = user_query.execution_options(skip_tenant_scope=True)
    user = user_query.filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(ActivityLog).filter(ActivityLog.actor_user_id == user_id)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    if action and action != "all":
        query = query.filter(ActivityLog.action == action)
    logs = query.order_by(ActivityLog.created_at.desc()).limit(limit).all()
    return [activity_log_response(activity) for activity in logs]


@app.delete("/users/{user_id}/activity-logs")
def clear_user_activity_logs(user_id: int, request: Request, db: Session = Depends(get_db)):
    actor = require_page_access(request, db, "Users")
    user_query = db.query(User)
    if actor.role == "super_admin":
        user_query = user_query.execution_options(skip_tenant_scope=True)
    user = user_query.filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    activity_query = db.query(ActivityLog).filter(ActivityLog.actor_user_id == user_id)
    if actor.role == "super_admin":
        activity_query = activity_query.execution_options(skip_tenant_scope=True)
    deleted_count = activity_query.delete(synchronize_session=False)
    db.commit()
    return {"deleted_count": deleted_count}


@app.get("/activity-logs", response_model=list[ActivityLogOut])
def get_activity_logs(
    request: Request,
    user_id: int | None = Query(None),
    limit: int = Query(120, ge=1, le=500),
    action: str | None = Query(None),
    db: Session = Depends(get_db),
):
    actor = require_page_access(request, db, "Users")
    query = db.query(ActivityLog)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    if user_id is not None:
        query = query.filter(ActivityLog.actor_user_id == user_id)
    if action and action != "all":
        query = query.filter(ActivityLog.action == action)
    logs = query.order_by(ActivityLog.created_at.desc()).limit(limit).all()
    return [activity_log_response(activity) for activity in logs]


@app.post("/activity-logs/page-view", response_model=ActivityLogOut)
def log_page_view(
    payload: ActivityPageViewCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    actor_user_id, actor_user_name = parse_actor_from_request(request)
    actor_user_id = payload.user_id or actor_user_id
    actor_user_name = payload.user_name or actor_user_name
    page = payload.page.strip()
    if not page:
        raise HTTPException(status_code=400, detail="Page name is required")

    activity = record_activity(
        db,
        actor_user_id=actor_user_id,
        actor_user_name=actor_user_name,
        action="opened page",
        entity_type="page",
        entity_id=page,
        summary=f"Opened {page}",
        page=page,
        request_method="POST",
        request_path="/activity-logs/page-view",
    )
    return activity_log_response(activity)


def delete_worker_record(
    db: Session,
    worker: Worker,
    *,
    delete_linked_users: bool = True,
) -> None:
    if delete_linked_users:
        for linked_user in db.query(User).filter(User.worker_id == worker.id).all():
            linked_user.worker_id = None
            db.delete(linked_user)
    else:
        db.query(User).filter(User.worker_id == worker.id).update(
            {User.worker_id: None},
            synchronize_session=False,
        )

    db.query(ProductionTask).filter(ProductionTask.worker_id == worker.id).update(
        {ProductionTask.worker_id: None},
        synchronize_session=False,
    )
    db.query(OrderWorkflowTask).filter(
        OrderWorkflowTask.assigned_worker_id == worker.id
    ).delete(synchronize_session=False)
    payment_transaction_ids = [
        row[0]
        for row in db.query(WorkerPayment.accounting_transaction_id)
        .filter(
            WorkerPayment.worker_id == worker.id,
            WorkerPayment.accounting_transaction_id.isnot(None),
        )
        .all()
    ]
    if payment_transaction_ids:
        db.query(AccountingTransaction).filter(
            AccountingTransaction.id.in_(payment_transaction_ids),
            AccountingTransaction.source_type == ACCOUNTING_WORKER_PAYMENT_SOURCE,
        ).delete(synchronize_session=False)
    db.delete(worker)


@app.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    actor = require_page_access(request, db, "Users")
    query = db.query(User)
    if actor.role == "super_admin":
        query = query.execution_options(skip_tenant_scope=True)
    existing = query.filter(User.id == user_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role == "super_admin" and existing.tenant_id is not None:
        db.info["tenant_id"] = existing.tenant_id
    worker_query = db.query(Worker)
    if actor.role == "super_admin":
        worker_query = worker_query.execution_options(skip_tenant_scope=True)
    linked_worker = (
        worker_query.filter(Worker.id == existing.worker_id).first()
        if existing.worker_id
        else None
    )
    existing.worker_id = None
    db.delete(existing)
    if linked_worker:
        delete_worker_record(db, linked_worker, delete_linked_users=False)
    db.commit()
    return {
        "status": "deleted",
        "deleted_worker_id": linked_worker.id if linked_worker else None,
    }

@app.get("/inspiration", response_model=list[InspirationItemOut])
def list_inspiration(db: Session = Depends(get_db)):
    return db.query(InspirationItem).order_by(InspirationItem.id.desc()).all()

@app.post("/inspiration", response_model=InspirationItemOut)
def create_inspiration(item: InspirationItemCreate, db: Session = Depends(get_db)):
    new_item = InspirationItem(**item.model_dump())
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    return new_item

@app.put("/inspiration/{item_id}", response_model=InspirationItemOut)
def update_inspiration(item_id: int, payload: InspirationItemUpdate, db: Session = Depends(get_db)):
    item = db.query(InspirationItem).filter(InspirationItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inspiration item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item

@app.delete("/inspiration/{item_id}")
def delete_inspiration(item_id: int, db: Session = Depends(get_db)):
    item = db.query(InspirationItem).filter(InspirationItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inspiration item not found")
    db.delete(item)
    db.commit()
    return {"status": "deleted"}

# Mount the static directory to serve uploaded images and other static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

INITIALIZE_DATABASE_ON_IMPORT = os.getenv(
    "SKIP_DATABASE_INITIALIZATION",
    "0",
).strip().lower() not in {"1", "true", "yes"}

if INITIALIZE_DATABASE_ON_IMPORT:
    Base.metadata.create_all(bind=engine)
    migrate_database()
    ensure_scaling_indexes()
    ensure_default_school_foundation()

# Ensure there is at least one admin user with a default PIN for first-time login

def ensure_default_admin():
    db = SessionLocal()
    try:
        default_tenant = get_default_tenant(db)
        ensure_default_modules_for_db(db)
        hafiz_umer = (
            db.query(User)
            .execution_options(skip_tenant_scope=True)
            .filter(
                or_(
                    func.lower(func.coalesce(User.name, "")) == "hafiz umer",
                    func.lower(func.coalesce(User.username, "")) == "hafiz umer",
                    func.lower(func.coalesce(User.username, "")) == "hafizumer",
                )
            )
            .first()
        )
        if not hafiz_umer:
            hafiz_umer = User(
                tenant_id=None,
                name="Hafiz Umer",
                username="hafizumer",
                pin=hash_pin("1234"),
                role="super_admin",
                is_active=True,
            )
        hafiz_umer.role = "super_admin"
        hafiz_umer.tenant_id = None
        hafiz_umer.allowed_pages = json.dumps(ROLE_PAGE_DEFAULTS["super_admin"])
        hafiz_umer.customer_privacy_settings = json.dumps(
            default_access_privacy_settings_for_role("super_admin")
        )
        db.add(hafiz_umer)
        db.commit()

        company_admin = (
            db.query(User)
            .execution_options(skip_tenant_scope=True)
            .filter(
                User.tenant_id == default_tenant.id,
                or_(
                    func.lower(func.coalesce(User.name, "")) == "hisbenew company admin",
                    func.lower(func.coalesce(User.username, "")) == "hisbenew",
                    func.lower(func.coalesce(User.username, "")) == "hisbenew.admin",
                    func.lower(func.coalesce(User.username, "")) == "hisbenew.company.admin",
                ),
            )
            .order_by(User.id.asc())
            .first()
        )
        if not company_admin:
            admin_username = "hisbenew"
            suffix = 1
            while (
                db.query(User)
                .execution_options(skip_tenant_scope=True)
                .filter(func.lower(func.coalesce(User.username, User.name)) == admin_username.lower())
                .first()
            ):
                suffix += 1
                admin_username = f"hisbenew{suffix}"
            company_admin = User(
                tenant_id=default_tenant.id,
                name="Hisbenew Company Admin",
                username=admin_username,
                pin=hash_pin("0000"),
                role="admin",
                allowed_pages=json.dumps(ROLE_PAGE_DEFAULTS["admin"]),
                customer_privacy_settings=json.dumps(
                    default_access_privacy_settings_for_role("admin")
                ),
                is_active=True,
            )
            db.add(company_admin)
            db.commit()
        else:
            company_admin.role = "admin"
            company_admin.tenant_id = default_tenant.id
            company_admin.name = "Hisbenew Company Admin"
            company_admin.username = "hisbenew"
            company_admin.pin = hash_pin("0000")
            company_admin.allowed_pages = json.dumps(ROLE_PAGE_DEFAULTS["admin"])
            company_admin.customer_privacy_settings = json.dumps(
                default_access_privacy_settings_for_role("admin")
            )
            company_admin.is_active = True
            db.add(company_admin)
            db.commit()

        sync_tenant_modules(db, default_tenant.id, None, commit=False)
        scratch_tenant = get_or_create_company_tenant(
            db,
            company_name=SCRATCH_COMPANY_NAME,
            slug=SCRATCH_COMPANY_SLUG,
            status="active",
        )
        sync_tenant_modules(db, scratch_tenant.id, None, commit=False)

        cuterex_user = (
            db.query(User)
            .execution_options(skip_tenant_scope=True)
            .filter(
                or_(
                    func.lower(func.coalesce(User.name, "")) == "cuterex",
                    func.lower(func.coalesce(User.username, "")) == "cuterex",
                )
            )
            .first()
        )
        if not cuterex_user:
            cuterex_user = User(
                tenant_id=scratch_tenant.id,
                name="Cuterex",
                username=SCRATCH_COMPANY_ADMIN_USERNAME,
                pin=hash_pin(SCRATCH_COMPANY_ADMIN_PIN),
                raw_pin=SCRATCH_COMPANY_ADMIN_PIN,
                role="admin",
                allowed_pages=json.dumps(ROLE_PAGE_DEFAULTS["admin"]),
                customer_privacy_settings=json.dumps(
                    default_access_privacy_settings_for_role("admin")
                ),
                is_active=True,
            )
        else:
            cuterex_user.tenant_id = scratch_tenant.id
            cuterex_user.name = cuterex_user.name or "Cuterex"
            cuterex_user.username = cuterex_user.username or SCRATCH_COMPANY_ADMIN_USERNAME
            cuterex_user.pin = hash_pin(SCRATCH_COMPANY_ADMIN_PIN)
            cuterex_user.raw_pin = SCRATCH_COMPANY_ADMIN_PIN
            cuterex_user.role = "admin"
            cuterex_user.allowed_pages = json.dumps(ROLE_PAGE_DEFAULTS["admin"])
            cuterex_user.customer_privacy_settings = json.dumps(
                default_access_privacy_settings_for_role("admin")
            )
            cuterex_user.is_active = True
        db.add(cuterex_user)
        db.commit()

        # Seed Cuterex products if workspace is empty
        try:
            cuterex_p_count = db.query(Product).execution_options(skip_tenant_scope=True).filter(Product.tenant_id == scratch_tenant.id).count()
            if cuterex_p_count == 0:
                sample_products = [
                    {"article_no": "CTX-01", "name": "Cuterex Professional Chef Knife Set", "category": "Chef Knife Sets", "wholesale_price": 45.0, "retail_price": 89.99, "stock_quantity": 50},
                    {"article_no": "CTX-02", "name": "Cuterex Damascus Folding Pocket Knife", "category": "Folding Knifes", "wholesale_price": 25.0, "retail_price": 49.99, "stock_quantity": 100},
                    {"article_no": "CTX-03", "name": "Cuterex Heavy Duty Meat Cleaver", "category": "Cleaver Knifes", "wholesale_price": 35.0, "retail_price": 69.99, "stock_quantity": 40},
                    {"article_no": "CTX-04", "name": "Cuterex Handmade Hunting Knife with Leather Sheath", "category": "Hunting & Skinner Knifes", "wholesale_price": 30.0, "retail_price": 59.99, "stock_quantity": 60},
                    {"article_no": "CTX-05", "name": "Cuterex Premium ULU Pizza Cutter", "category": "ULU & Pizza Cutters", "wholesale_price": 18.0, "retail_price": 34.99, "stock_quantity": 85},
                ]
                for item in sample_products:
                    db.add(Product(
                        tenant_id=scratch_tenant.id,
                        article_no=item["article_no"],
                        name=item["name"],
                        category=item["category"],
                        wholesale_price=item["wholesale_price"],
                        retail_price=item["retail_price"],
                        stock_quantity=item["stock_quantity"],
                        unit="pcs",
                        status="Active",
                    ))
                db.commit()

            cuterex_o_count = db.query(Order).execution_options(skip_tenant_scope=True).filter(Order.tenant_id == scratch_tenant.id).count()
            if cuterex_o_count == 0:
                sample_orders = [
                    {"order_no": "CTX-ORD-101", "platform": "Faire", "total_amount": 279.97, "status": "New", "days_ago": 1},
                    {"order_no": "CTX-ORD-102", "platform": "Wholesale Direct", "total_amount": 149.98, "status": "New", "days_ago": 3},
                    {"order_no": "CTX-ORD-103", "platform": "Faire", "total_amount": 420.00, "status": "Fulfilled", "days_ago": 5},
                    {"order_no": "CTX-ORD-104", "platform": "Direct", "total_amount": 510.50, "status": "New", "days_ago": 7},
                ]
                for item in sample_orders:
                    o_date = datetime.utcnow() - timedelta(days=item["days_ago"])
                    db.add(Order(
                        tenant_id=scratch_tenant.id,
                        order_no=item["order_no"],
                        platform=item["platform"],
                        total_amount=item["total_amount"],
                        order_total_usd=item["total_amount"],
                        status=item["status"],
                        order_date=o_date,
                        created_at=o_date,
                    ))
                db.commit()
        except Exception as seed_exc:
            print(f"Cuterex initial data seed notice: {seed_exc}")
            db.rollback()

    finally:
        db.close()

if INITIALIZE_DATABASE_ON_IMPORT:
    ensure_default_admin()
    ensure_default_modules()

# Note: The FastAPI app has already been instantiated above; avoid re-instantiating here.

# Allow frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
)

@app.middleware("http")
async def private_network_access_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/local-label-printers"):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.middleware("http")
async def audit_activity_middleware(request: Request, call_next):
    response = await call_next(request)
    if should_audit_request(request, response.status_code):
        db = SessionLocal()
        try:
            actor_user_id = getattr(request.state, "user_id", None)
            actor_user_name = getattr(request.state, "user_name", None)
            request_tenant_id = getattr(request.state, "tenant_id", None)
            if actor_user_id is None:
                actor_user_id, actor_user_name = parse_actor_from_request(request)
            if request_tenant_id is not None:
                db.info["tenant_id"] = request_tenant_id
            context = describe_activity_request(request.method, request.url.path)
            context = enrich_activity_context(
                db,
                context,
                request.method,
                request.url.path,
                request.query_params,
            )
            record_activity(
                db,
                actor_user_id=actor_user_id,
                actor_user_name=actor_user_name,
                action=context["action"],
                entity_type=context["entity_type"],
                entity_id=context["entity_id"],
                summary=context["summary"],
                detail=context.get("detail"),
                request_method=request.method,
                request_path=request.url.path,
            )
        except Exception as audit_error:
            print(f"Activity audit failed: {audit_error}")
        finally:
            db.close()
    return response


# Helper responses
ORDER_IMPORT_UNASSIGNED_CUSTOMER_NAME = "Unassigned customer"
ORDER_IMPORT_UNASSIGNED_CUSTOMER_COMPANY = "Needs customer assignment"
ORDER_IMPORT_UNASSIGNED_CUSTOMER_PLATFORM = "Import Review"


def is_unassigned_import_customer(customer: Customer | None) -> bool:
    if not customer:
        return False
    return (
        str(customer.name or "").strip().lower() == ORDER_IMPORT_UNASSIGNED_CUSTOMER_NAME.lower()
        and str(customer.company_name or "").strip().lower() == ORDER_IMPORT_UNASSIGNED_CUSTOMER_COMPANY.lower()
    )


def order_imported_customer_from_note(order: Order) -> str | None:
    match = re.search(
        r"Imported customer from CSV:\s*(.+?)(?:\.|\n|$)",
        order.notes or "",
        re.IGNORECASE,
    )
    if not match:
        return None
    return match.group(1).strip() or None


def order_display_customer_labels(
    order: Order,
    customer: Customer | None,
    needs_customer_assignment: bool,
) -> tuple[str, str | None]:
    if needs_customer_assignment:
        imported_name = (
            order.import_customer_name
            or order.import_customer_company_name
            or order_imported_customer_from_note(order)
        )
        imported_company = order.import_customer_company_name
        if imported_name:
            return imported_name, imported_company

    return (
        customer.name if customer else "Unknown customer",
        customer.company_name if customer else None,
    )


def privacy_order_customer_labels(
    order: Order,
    customer: Customer | None,
    needs_customer_assignment: bool,
    privacy: dict | None = None,
    task_type: str | None = None,
) -> tuple[str, str | None]:
    if access_privacy_hides_worker_customer_name(privacy, task_type):
        return "", None

    if access_privacy_hides_customer_business(privacy):
        return customer_personal_label(customer, order), None

    return order_display_customer_labels(order, customer, needs_customer_assignment)


def privacy_stored_customer_name(
    value: str | None,
    privacy: dict | None = None,
    task_type: str | None = None,
) -> str | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    if access_privacy_hides_worker_customer_name(privacy, task_type):
        return None
    if access_privacy_hides_customer_business(privacy):
        return None
    return cleaned


def product_response(product: Product):
    return {
        "id": product.id,
        "article_no": product.article_no,
        "name": product.name,
        "category": product.category,
        "image_url": product.image_url,
        "share_image_url": product.share_image_url,
        "label_url": product.label_url,
        "options": product.options,
        "notes": product.notes,
        "factory_stock": product.factory_stock,
        "usa_stock": product.usa_stock,
        "front_room_stock": product.front_room_stock,
        "reserved_stock": product.reserved_stock,
        "available_stock": (
            (product.factory_stock or 0)
            + (product.usa_stock or 0)
            + (product.front_room_stock or 0)
            - (product.reserved_stock or 0)
        ),
        "cost_price": product.cost_price,
        "selling_price": product.selling_price,
        "unit_weight_kg": product.unit_weight_kg,
        "low_stock_alert": product.low_stock_alert,
        "workflow_required": product.workflow_required,
    }


def public_website_product_response(product: Product):
    return {
        "id": product.id,
        "article_no": product.article_no,
        "name": product.name,
        "category": product.category,
        "image_url": product.image_url,
        "notes": product.notes,
        "available_stock": (
            (product.factory_stock or 0)
            + (product.usa_stock or 0)
            + (product.front_room_stock or 0)
            - (product.reserved_stock or 0)
        ),
        "selling_price": product.selling_price,
    }


def order_response(order: Order, privacy: dict | None = None):
    expected_payout_amount = expected_order_payout(order)
    received_payout_amount = float(order.received_payout_usd or 0)
    payout_amount = expected_payout_amount or received_payout_amount or 0
    remaining_payout = order.remaining_payout_usd
    if remaining_payout is None or (
        expected_payout_amount > 0
        and float(remaining_payout or 0) <= 0
        and received_payout_amount <= 0
    ):
        remaining_payout = expected_payout_amount - received_payout_amount
    remaining_payout = max(float(remaining_payout or 0), 0)
    customer = order.customer
    needs_customer_assignment = is_unassigned_import_customer(customer)
    customer_label, customer_company_label = privacy_order_customer_labels(
        order,
        customer,
        needs_customer_assignment,
        privacy,
    )

    return {
        "id": order.id,
        "order_no": order.order_no,
        "customer_id": order.customer_id,
        "customer_name": customer_label,
        "customer_company_name": customer_company_label,
        "import_customer_name": order.import_customer_name,
        "import_customer_company_name": None
        if access_privacy_hides_customer_business(privacy)
        else order.import_customer_company_name,
        "import_contact_name": order.import_contact_name,
        "import_contact_phone": privacy_order_contact_phone(order, privacy),
        "import_shipping_name": order.import_shipping_name,
        "import_shipping_address": order.import_shipping_address,
        "import_ship_date": order.import_ship_date,
        "import_batch_key": order.import_batch_key,
        "customer_match_reason": None,
        "needs_customer_assignment": needs_customer_assignment,
        "platform": order.platform,
        "order_date": order.order_date,
        "status": order.status,
        "payment_status": order.payment_status,
        "shipping_status": order.shipping_status,
        "total_amount": order.total_amount,
        "payout_amount_usd": payout_amount,
        "order_total_usd": order.order_total_usd,
        "platform_fee_usd": order.platform_fee_usd,
        "deduction_usd": order.deduction_usd,
        "expected_payout_usd": expected_payout_amount,
        "expected_payout_date": order.expected_payout_date,
        "payment_source": order.payment_source,
        "payout_status": order.payout_status,
        "received_payout_usd": received_payout_amount,
        "remaining_payout_usd": remaining_payout,
        "exchange_rate": order.exchange_rate,
        "received_pkr": order.received_pkr,
        "bank_charges_pkr": order.bank_charges_pkr,
        "final_received_pkr": order.final_received_pkr,
        "payout_notes": order.payout_notes,
        "payout_received_date": order.payout_received_date,
        "notes": order.notes,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name": item.product.name,
                "article_no": item.product.article_no,
                "category": item.product.category,
                "product_image_url": item.product.image_url,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "line_total": item.line_total,
                "stock_source": item.stock_source,
                "manufacturing_required": item.manufacturing_required,
                "product_cost_price": item.product.cost_price,
            } for item in order.items
        ]
    }

def stock_movement_response(movement: StockMovement):
    return {
        "id": movement.id,
        "product_id": movement.product_id,
        "article_no": movement.product.article_no,
        "product_name": movement.product.name,
        "product_image_url": movement.product.image_url,
        "product_cost_price": movement.product.cost_price,
        "product_selling_price": movement.product.selling_price,
        "movement_type": movement.movement_type,
        "quantity": movement.quantity,
        "stock_type": movement.stock_type,
        "purchase_price": movement.purchase_price,
        "source": movement.source,
        "supplier_id": movement.supplier_id,
        "supplier_name": movement.supplier.name if movement.supplier else None,
        "reference": movement.reference,
        "note": movement.note,
        "faulty": movement.faulty,
        "faulty_quantity": movement.faulty_quantity,
        "faulty_note": movement.faulty_note,
        "created_at": movement.created_at,
    }


STOCK_FIELD_LABELS = {
    "factory_stock": "PK stock",
    "usa_stock": "USA stock",
    "front_room_stock": "Front Room stock",
    "reserved_stock": "Reserved stock",
}

INVENTORY_LOCATION_LABELS = {
    "factory_stock": "PK",
    "usa_stock": "USA",
    "front_room_stock": "Front Room",
}


def infer_stock_movement_type(movement: StockMovement) -> str | None:
    """Return the product field affected by a movement, including legacy rows."""
    if movement.stock_type in STOCK_FIELD_LABELS:
        return movement.stock_type

    note = str(movement.note or "").lower()
    if "reserved stock" in note or movement.movement_type == "Order Reservation":
        return "reserved_stock"
    if "usa stock" in note:
        return "usa_stock"
    if "front room" in note:
        return "front_room_stock"
    if "factory stock" in note:
        return "factory_stock"

    source = str(movement.source or "").strip().lower()
    if movement.movement_type == "Order Deduction":
        return "usa_stock" if source == "usa" else "factory_stock"
    if source in {"usa", "usa stock", "usa_stock"}:
        return "usa_stock"
    if source in {"front room", "front_room", "front_room_stock"}:
        return "front_room_stock"
    if source in {"factory", "factory stock", "factory_stock", "production"}:
        return "factory_stock"
    return None


def supplier_movement_effective_quantity(movement: StockMovement) -> int:
    """Usable stock contributed by a supplier receipt after faulty units."""
    quantity = int(movement.quantity or 0)
    faulty_quantity = int(movement.faulty_quantity or 0) if movement.faulty else 0
    return quantity - min(max(faulty_quantity, 0), max(quantity, 0))

def normalize_stock_source(stock_source: str) -> str:
    if not stock_source:
        raise HTTPException(status_code=400, detail="Stock source is required")
    source = stock_source.lower().strip()
    if source not in ("factory", "usa"):
        raise HTTPException(status_code=400, detail="Stock source must be either 'factory' or 'usa'")
    return source


def reserve_order_item(product: Product, quantity: int, stock_source: str):
    source = normalize_stock_source(stock_source)
    current_reserved = product.reserved_stock or 0
    factory = product.factory_stock or 0
    usa = product.usa_stock or 0
    front_room = product.front_room_stock or 0

    product.reserved_stock = current_reserved + quantity
    movement_type = "Order Reservation"
    movement_qty = quantity

    manufacturing_required = (factory + usa + front_room - product.reserved_stock) < 0
    return manufacturing_required, movement_type, movement_qty


def deduct_order_item_on_ship(product: Product, quantity: int, stock_source: str):
    source = normalize_stock_source(stock_source)

    if source == "factory":
        product.factory_stock = (product.factory_stock or 0) - quantity
    else:
        product.usa_stock = (product.usa_stock or 0) - quantity

    product.reserved_stock = max((product.reserved_stock or 0) - quantity, 0)
    movement_type = "Order Deduction"
    movement_qty = -quantity

    return movement_type, movement_qty


def release_order_stock(product: Product, quantity: int, stock_source: str, was_shipped: bool):
    source = normalize_stock_source(stock_source)
    if was_shipped:
        if source == "factory":
            product.factory_stock = (product.factory_stock or 0) + quantity
        else:
            product.usa_stock = (product.usa_stock or 0) + quantity
    else:
        product.reserved_stock = max((product.reserved_stock or 0) - quantity, 0)


def supplier_payment_response(payment: SupplierPayment):
    return {
        "id": payment.id,
        "supplier_id": payment.supplier_id,
        "amount": payment.amount,
        "payment_method": payment.payment_method,
        "payment_reference": payment.payment_reference,
        "note": payment.note,
        "payment_date": payment.payment_date,
        "created_at": payment.created_at,
    }


def supplier_transaction_response(transaction: SupplierTransaction):
    return {
        "id": transaction.id,
        "supplier_id": transaction.supplier_id,
        "transaction_type": transaction.transaction_type,
        "reference": transaction.reference,
        "amount": transaction.amount,
        "balance_after": transaction.balance_after,
        "note": transaction.note,
        "created_at": transaction.created_at,
    }


SUPPLIER_STOCK_FIELDS = {
    "factory_stock": "Factory stock",
    "usa_stock": "USA stock",
    "reserved_stock": "Reserved stock",
}


def normalize_supplier_stock_type(stock_type: str | None) -> str:
    normalized = (stock_type or "factory_stock").strip()
    if normalized not in SUPPLIER_STOCK_FIELDS:
        raise HTTPException(status_code=400, detail="Stock type must be factory_stock, usa_stock, or reserved_stock")
    return normalized


def supplier_order_status(order_item: SupplierOrderItem) -> str:
    ordered_quantity = max(order_item.ordered_quantity or 0, 0)
    received_quantity = max(order_item.received_quantity or 0, 0)
    saved_status = (order_item.status or "").strip()

    if order_item.is_closed and saved_status in ("Removed", "Cancelled"):
        return saved_status
    if order_item.is_closed:
        if received_quantity < ordered_quantity:
            return "Closed Short"
        if received_quantity == ordered_quantity:
            return "Received"
        return "Over Received"
    if received_quantity <= 0:
        return "Ordered"
    if received_quantity < ordered_quantity:
        return "Partially Received"
    if received_quantity == ordered_quantity:
        return "Received"
    return "Over Received"


def supplier_order_pending_quantity(order_item: SupplierOrderItem) -> int:
    if order_item.is_closed:
        return 0
    return max((order_item.ordered_quantity or 0) - (order_item.received_quantity or 0), 0)


def supplier_order_item_response(order_item: SupplierOrderItem):
    ordered_quantity = max(order_item.ordered_quantity or 0, 0)
    received_quantity = max(order_item.received_quantity or 0, 0)
    pending_quantity = supplier_order_pending_quantity(order_item)
    purchase_price = order_item.purchase_price or 0
    product = order_item.product

    return {
        "id": order_item.id,
        "supplier_id": order_item.supplier_id,
        "product_id": order_item.product_id,
        "article_no": product.article_no if product else "",
        "product_name": product.name if product else "",
        "product_image_url": product.image_url if product else None,
        "ordered_quantity": ordered_quantity,
        "received_quantity": received_quantity,
        "pending_quantity": pending_quantity,
        "purchase_price": purchase_price,
        "line_total": ordered_quantity * purchase_price,
        "pending_total": pending_quantity * purchase_price,
        "stock_type": order_item.stock_type or "factory_stock",
        "reference": order_item.reference,
        "note": order_item.note,
        "status": supplier_order_status(order_item),
        "is_closed": bool(order_item.is_closed),
        "closed_at": order_item.closed_at,
        "created_at": order_item.created_at,
        "updated_at": order_item.updated_at,
    }


def clean_supply_text(value: str | None, fallback: str = "") -> str:
    cleaned = (value or "").strip()
    return cleaned or fallback


def supplier_supply_item_response(item: SupplierSupplyItem):
    quantity = max(item.quantity or 0, 0)
    unit_price = item.unit_price or 0
    return {
        "id": item.id,
        "supplier_id": item.supplier_id,
        "sku": item.sku,
        "item_name": item.item_name,
        "category": item.category or "Miscellaneous",
        "usage_area": item.usage_area or "General",
        "quantity": quantity,
        "unit_price": unit_price,
        "line_total": quantity * unit_price,
        "note": item.note,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def supplier_payable_purchase_quantity(movement: StockMovement) -> int:
    total_quantity = max(movement.quantity or 0, 0)
    if not movement.faulty:
        return total_quantity

    faulty_quantity = min(max(movement.faulty_quantity or 0, 0), total_quantity)
    return max(total_quantity - faulty_quantity, 0)


def supplier_response(supplier: Supplier):
    ordered_items = list(supplier.order_items or [])
    supply_items = list(supplier.supply_items or [])
    ordered_units = sum(max(item.ordered_quantity or 0, 0) for item in ordered_items)
    received_ordered_units = sum(max(item.received_quantity or 0, 0) for item in ordered_items)
    pending_ordered_units = sum(
        supplier_order_pending_quantity(item)
        for item in ordered_items
    )
    ordered_total = sum(
        max(item.ordered_quantity or 0, 0) * (item.purchase_price or 0)
        for item in ordered_items
    )
    pending_ordered_total = sum(
        supplier_order_pending_quantity(item) * (item.purchase_price or 0)
        for item in ordered_items
    )
    total_transactions = sum(t.amount for t in supplier.transactions)
    total_purchase_value = sum(
        (m.purchase_price or 0) * supplier_payable_purchase_quantity(m)
        for m in supplier.stock_movements
        if m.supplier_id == supplier.id and m.movement_type == "Supplier Purchase"
    )
    supply_total = sum(
        max(item.quantity or 0, 0) * (item.unit_price or 0)
        for item in supply_items
    )
    supply_units = sum(max(item.quantity or 0, 0) for item in supply_items)
    total_payments = sum(p.amount for p in supplier.payments)
    balance = total_transactions + total_purchase_value + supply_total - total_payments
    status = "Settled"
    if balance > 0:
        status = "Pending"
    elif balance < 0:
        status = "Advance"

    return {
        "id": supplier.id,
        "name": supplier.name,
        "contact_person": supplier.contact_person,
        "email": supplier.email,
        "phone": supplier.phone,
        "address": supplier.address,
        "created_at": supplier.created_at,
        "transactions": [supplier_transaction_response(t) for t in supplier.transactions],
        "payments": [supplier_payment_response(p) for p in supplier.payments],
        "stock_movements": [stock_movement_response(m) for m in supplier.stock_movements],
        "ordered_items": [supplier_order_item_response(item) for item in ordered_items],
        "supply_items": [supplier_supply_item_response(item) for item in supply_items],
        "ordered_units": ordered_units,
        "received_ordered_units": received_ordered_units,
        "pending_ordered_units": pending_ordered_units,
        "ordered_total": ordered_total,
        "pending_ordered_total": pending_ordered_total,
        "supply_units": supply_units,
        "supply_total": supply_total,
        "balance_due": balance,
        "balance_status": status,
    }


def workflow_step_response(step: WorkflowStep):
    return {
        "id": step.id,
        "product_id": step.product_id,
        "article_no": step.product.article_no,
        "product_name": step.product.name,
        "step_order": step.step_order,
        "step_name": step.step_name,
        "worker_role": step.worker_role,
        "rate_per_piece": step.rate_per_piece,
        "estimated_minutes_per_piece": step.estimated_minutes_per_piece,
        "is_optional": step.is_optional,
        "is_active": step.is_active,
    }

def shipping_response(shipping: Shipping, privacy: dict | None = None):
    order = shipping.order
    customer = order.customer if order else None
    return {
        "id": shipping.id,
        "order_id": shipping.order_id,
        "order_no": order.order_no if order else None,
        "customer_name": customer_personal_label(customer, order) if order else None,
        "courier_name": shipping.courier_name,
        "tracking_number": shipping.tracking_number,
        "package_weight_kg": shipping.package_weight_kg,
        "shipping_cost": shipping.shipping_cost,
        "shipping_note": shipping.shipping_note,
        "shipping_service": shipping.shipping_service,
        "destination_zip_prefix": shipping.destination_zip_prefix,
        "shipping_zone": shipping.shipping_zone,
        "calculated_weight_kg": shipping.calculated_weight_kg,
        "estimated_shipping_cost": shipping.estimated_shipping_cost,
        "rate_source_version": shipping.rate_source_version,
        "shipped_at": shipping.shipped_at,
        "created_at": shipping.created_at,
        "updated_at": shipping.updated_at,
    }


def order_items_summary(order: Order | None) -> list[dict]:
    if not order:
        return []
    return [
        {
            "id": item.id,
            "product_id": item.product_id,
            "article_no": item.product.article_no if item.product else "",
            "product_name": item.product.name if item.product else "",
            "product_image_url": item.product.image_url if item.product else None,
            "product_label_url": item.product.label_url if item.product else None,
            "quantity": item.quantity,
            "stock_source": item.stock_source,
            "manufacturing_required": item.manufacturing_required,
        }
        for item in order.items
    ]


def order_workflow_task_default_quantity(order: Order | None) -> int:
    if not order:
        return 1
    quantity = sum(max(int(item.quantity or 0), 0) for item in order.items or [])
    return max(quantity, 1)


def normalize_order_workflow_task_earning(
    payload: OrderWorkflowTaskCreate,
    order: Order,
    worker: Worker,
) -> tuple[int, float, float]:
    assigned_quantity = int(
        payload.assigned_quantity or order_workflow_task_default_quantity(order)
    )
    assigned_quantity = max(assigned_quantity, 1)
    rate_per_piece = (
        float(payload.rate_per_piece)
        if payload.rate_per_piece is not None
        else float(worker.rate_per_piece or 0)
    )
    rate_per_piece = max(rate_per_piece, 0)
    labor_cost = (
        float(payload.labor_cost)
        if payload.labor_cost is not None
        else assigned_quantity * rate_per_piece
    )
    labor_cost = max(labor_cost, 0)
    return assigned_quantity, rate_per_piece, labor_cost


def order_workflow_task_response(task: OrderWorkflowTask, privacy: dict | None = None):
    order = task.order
    customer = order.customer if order else None
    if order:
        needs_customer_assignment = is_unassigned_import_customer(customer)
        customer_label, _customer_company_label = privacy_order_customer_labels(
            order,
            customer,
            needs_customer_assignment,
            privacy,
            task.task_type,
        )
    else:
        customer_label = ""
    return {
        "id": task.id,
        "order_id": task.order_id,
        "order_no": order.order_no if order else None,
        "customer_id": order.customer_id if order else None,
        "customer_name": customer_label,
        "customer_phone": privacy_customer_phone(customer, privacy),
        "customer_address": (customer.shipping_address or customer.address) if customer else "",
        "platform": order.platform if order else "",
        "order_date": order.order_date if order else None,
        "shipping_status": order.shipping_status if order else "",
        "payment_status": order.payment_status if order else "",
        "total_amount": order.total_amount if order else 0,
        "task_type": task.task_type,
        "title": task.title,
        "status": task.status,
        "assigned_quantity": task.assigned_quantity or order_workflow_task_default_quantity(order),
        "completed_quantity": task.assigned_quantity
        if task.status == "Completed"
        else 0,
        "rate_per_piece": task.rate_per_piece or 0,
        "labor_cost": task.labor_cost or 0,
        "assigned_worker_id": task.assigned_worker_id,
        "assigned_worker_name": task.assigned_worker.name if task.assigned_worker else None,
        "assigned_by_user_id": task.assigned_by_user_id,
        "assigned_by_user_name": task.assigned_by_user_name,
        "notes": task.notes,
        "due_at": task.due_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "items": order_items_summary(order),
    }


def order_follow_up_response(follow_up: OrderFollowUp, privacy: dict | None = None):
    order = follow_up.order
    customer = follow_up.customer
    return {
        "id": follow_up.id,
        "order_id": follow_up.order_id,
        "order_no": order.order_no if order else None,
        "customer_id": follow_up.customer_id,
        "customer_name": customer_personal_label(customer, order)
        if access_privacy_hides_customer_business(privacy)
        else customer_name(customer),
        "customer_phone": privacy_customer_phone(customer, privacy),
        "customer_email": customer.email if customer else "",
        "customer_platform": customer.platform if customer else "",
        "platform": order.platform if order else "",
        "order_date": order.order_date if order else None,
        "shipping_status": order.shipping_status if order else "",
        "payout_status": order.payout_status if order else "",
        "status": follow_up.status,
        "channel": follow_up.channel,
        "message": follow_up.message,
        "follow_up_due_at": follow_up.follow_up_due_at,
        "followed_up_at": follow_up.followed_up_at,
        "review_provided": follow_up.review_provided,
        "review_note": follow_up.review_note,
        "created_at": follow_up.created_at,
        "updated_at": follow_up.updated_at,
        "items": order_items_summary(order),
    }


def ensure_order_follow_ups(db: Session):
    delivered_orders = (
        db.query(Order)
        .filter(func.lower(func.coalesce(Order.shipping_status, "")) == "delivered")
        .all()
    )
    if not delivered_orders:
        return

    existing_order_ids = {
        row[0]
        for row in db.query(OrderFollowUp.order_id)
        .filter(OrderFollowUp.order_id.in_([order.id for order in delivered_orders]))
        .all()
    }
    created = False
    now = datetime.utcnow()
    for order in delivered_orders:
        if order.id in existing_order_ids:
            continue
        follow_up = OrderFollowUp(
            order_id=order.id,
            customer_id=order.customer_id,
            status="Pending",
            channel="WhatsApp",
            follow_up_due_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(follow_up)
        created = True

    if created:
        db.commit()


def next_fulfillment_shipment_number(db: Session) -> str:
    next_number = (db.query(func.max(FulfillmentShipment.id)).scalar() or 0) + 1
    date_code = datetime.utcnow().strftime("%Y%m%d")
    while True:
        shipment_no = f"FS-{date_code}-{next_number:04d}"
        if not db.query(FulfillmentShipment.id).filter(FulfillmentShipment.shipment_no == shipment_no).first():
            return shipment_no
        next_number += 1


def next_fulfillment_order_number(db: Session) -> str:
    next_number = (db.query(func.max(FulfillmentOrder.id)).scalar() or 0) + 1
    date_code = datetime.utcnow().strftime("%Y%m%d")
    while True:
        order_no = f"FO-{date_code}-{next_number:04d}"
        if not db.query(FulfillmentOrder.id).filter(FulfillmentOrder.fulfillment_order_no == order_no).first():
            return order_no
        next_number += 1


def clean_optional_text(value: str | None) -> str | None:
    return str(value or "").strip() or None


def normalized_fulfillment_shipment_status(shipment: FulfillmentShipment) -> str:
    status = str(shipment.status or "").strip().lower()
    if status == "canceled":
        return "Canceled"
    if status == "received" or shipment.received_at:
        return "Received"
    if shipment.admin_received_at and shipment.fulfillment_received_at:
        return "Received"
    if shipment.admin_received_at:
        return "Delivered"
    if shipment.fulfillment_received_at:
        return "Fulfillment received"
    if status in {"", "sent", "in transit"}:
        return "In Transit"
    return str(shipment.status or "In Transit").strip()


def fulfillment_box_item_response(box_item: FulfillmentBoxItem):
    box = box_item.box
    shipment = box.shipment if box else None
    product = box_item.product
    return {
        "id": box_item.id,
        "box_id": box_item.box_id,
        "box_number": box.box_number if box else "",
        "location": box.location if box else None,
        "shipment_id": box.shipment_id if box else None,
        "shipment_no": shipment.shipment_no if shipment else "",
        "product_id": box_item.product_id,
        "article_no": product.article_no if product else "",
        "product_name": product.name if product else "",
        "product_image_url": product.image_url if product else None,
        "quantity": box_item.quantity or 0,
        "available_quantity": box_item.available_quantity or 0,
    }


def fulfillment_inventory_discrepancy_response(discrepancy: FulfillmentInventoryDiscrepancy):
    box_item = discrepancy.box_item
    box = box_item.box if box_item else None
    shipment = box.shipment if box else None
    product = discrepancy.product
    return {
        "id": discrepancy.id,
        "box_item_id": discrepancy.box_item_id,
        "box_id": box.id if box else 0,
        "box_number": box.box_number if box else "",
        "location": box.location if box else None,
        "shipment_id": shipment.id if shipment else 0,
        "shipment_no": shipment.shipment_no if shipment else "",
        "product_id": discrepancy.product_id,
        "article_no": product.article_no if product else "",
        "product_name": product.name if product else "",
        "reason": discrepancy.reason,
        "quantity_delta": discrepancy.quantity_delta,
        "available_before": discrepancy.available_before,
        "available_after": discrepancy.available_after,
        "reference": discrepancy.reference,
        "notes": discrepancy.notes,
        "created_by_name": discrepancy.created_by_name,
        "created_at": discrepancy.created_at,
    }


FULFILLMENT_DISCREPANCY_RULES = {
    "damaged": ("Damaged", {"remove"}),
    "missing": ("Missing", {"remove"}),
    "customer return": ("Customer return", {"add"}),
    "returned": ("Customer return", {"add"}),
    "recovered": ("Recovered", {"add"}),
    "found": ("Recovered", {"add"}),
    "count correction": ("Count correction", {"add", "remove"}),
}


def normalize_fulfillment_discrepancy(reason: str, direction: str) -> tuple[str, str]:
    reason_key = " ".join(str(reason or "").strip().lower().split())
    rule = FULFILLMENT_DISCREPANCY_RULES.get(reason_key)
    if not rule:
        raise HTTPException(
            status_code=400,
            detail="Reason must be Damaged, Missing, Customer return, Recovered, or Count correction",
        )

    normalized_direction = str(direction or "").strip().lower()
    if normalized_direction not in rule[1]:
        allowed = " or ".join(sorted(rule[1]))
        raise HTTPException(
            status_code=400,
            detail=f"{rule[0]} inventory must use the {allowed} direction",
        )
    return rule[0], normalized_direction


def fulfillment_box_response(box: FulfillmentBox):
    items = sorted(box.items or [], key=lambda item: item.id)
    return {
        "id": box.id,
        "box_number": box.box_number,
        "weight_kg": box.weight_kg,
        "length_cm": box.length_cm,
        "width_cm": box.width_cm,
        "height_cm": box.height_cm,
        "location": box.location,
        "notes": box.notes,
        "total_units": sum(max(item.quantity or 0, 0) for item in items),
        "available_units": sum(max(item.available_quantity or 0, 0) for item in items),
        "items": [fulfillment_box_item_response(item) for item in items],
    }


def fulfillment_shipment_response(shipment: FulfillmentShipment):
    boxes = sorted(
        shipment.boxes or [],
        key=lambda box: ((box.box_number or "").lower(), box.id),
    )
    box_responses = [fulfillment_box_response(box) for box in boxes]
    return {
        "id": shipment.id,
        "shipment_no": shipment.shipment_no,
        "destination_name": shipment.destination_name,
        "source_stock": shipment.source_stock,
        "status": normalized_fulfillment_shipment_status(shipment),
        "carton_count": shipment.carton_count,
        "total_units": sum(box["total_units"] for box in box_responses),
        "available_units": sum(box["available_units"] for box in box_responses),
        "notes": shipment.notes,
        "sent_at": shipment.sent_at,
        "admin_received_at": shipment.admin_received_at,
        "fulfillment_received_at": shipment.fulfillment_received_at,
        "received_at": shipment.received_at,
        "created_at": shipment.created_at,
        "updated_at": shipment.updated_at,
        "boxes": box_responses,
    }


def fulfillment_order_item_response(item: FulfillmentOrderItem):
    product = item.product
    return {
        "id": item.id,
        "product_id": item.product_id,
        "article_no": product.article_no if product else "",
        "product_name": product.name if product else "",
        "product_image_url": product.image_url if product else None,
        "quantity": item.quantity or 0,
        "picked_quantity": item.picked_quantity or 0,
    }


def fulfillment_pick_response(pick: FulfillmentPick):
    box_item = pick.box_item
    box = box_item.box if box_item else None
    shipment = box.shipment if box else None
    product = pick.product
    return {
        "id": pick.id,
        "box_item_id": pick.box_item_id,
        "product_id": pick.product_id,
        "article_no": product.article_no if product else "",
        "product_name": product.name if product else "",
        "shipment_id": shipment.id if shipment else None,
        "shipment_no": shipment.shipment_no if shipment else "",
        "box_id": box.id if box else None,
        "box_number": box.box_number if box else "",
        "location": box.location if box else None,
        "quantity": pick.quantity or 0,
        "created_at": pick.created_at,
    }


def fulfillment_available_box_items_query(db: Session, product_id: int):
    return (
        db.query(FulfillmentBoxItem)
        .join(FulfillmentBox, FulfillmentBox.id == FulfillmentBoxItem.box_id)
        .join(FulfillmentShipment, FulfillmentShipment.id == FulfillmentBox.shipment_id)
        .filter(FulfillmentBoxItem.product_id == product_id)
        .filter(FulfillmentBoxItem.available_quantity > 0)
        .filter(func.lower(func.coalesce(FulfillmentShipment.status, "")) == "received")
        .order_by(
            FulfillmentShipment.sent_at.asc(),
            FulfillmentShipment.id.asc(),
            FulfillmentBox.id.asc(),
            FulfillmentBoxItem.id.asc(),
        )
    )


def fulfillment_pick_plan_for_order(db: Session, order: FulfillmentOrder) -> list[dict]:
    plan = []
    for item in order.items or []:
        product = item.product
        required = max((item.quantity or 0) - (item.picked_quantity or 0), 0)
        remaining = required
        available_total = 0
        picks = []

        for box_item in fulfillment_available_box_items_query(db, item.product_id).all():
            available = max(box_item.available_quantity or 0, 0)
            if available <= 0:
                continue
            available_total += available
            if remaining <= 0:
                continue
            pick_quantity = min(available, remaining)
            box = box_item.box
            shipment = box.shipment if box else None
            picks.append(
                {
                    "box_item_id": box_item.id,
                    "box_id": box_item.box_id,
                    "box_number": box.box_number if box else "",
                    "location": box.location if box else None,
                    "shipment_id": box.shipment_id if box else None,
                    "shipment_no": shipment.shipment_no if shipment else "",
                    "quantity": pick_quantity,
                    "available_before_pick": available,
                }
            )
            remaining -= pick_quantity

        plan.append(
            {
                "product_id": item.product_id,
                "article_no": product.article_no if product else "",
                "product_name": product.name if product else "",
                "required_quantity": required,
                "available_quantity": available_total,
                "shortage_quantity": max(required - available_total, 0),
                "picks": picks,
            }
        )

    return plan


def fulfillment_order_response(
    order: FulfillmentOrder,
    db: Session,
    privacy: dict | None = None,
):
    items = sorted(order.items or [], key=lambda item: item.id)
    picks = sorted(order.picks or [], key=lambda pick: pick.id)
    return {
        "id": order.id,
        "fulfillment_order_no": order.fulfillment_order_no,
        "customer_name": privacy_stored_customer_name(
            order.customer_name,
            privacy,
            "Shipping",
        ),
        "platform": order.platform,
        "ship_to": order.ship_to,
        "status": order.status,
        "label_file_url": order.label_file_url,
        "label_file_name": order.label_file_name,
        "notes": order.notes,
        "total_units": sum(max(item.quantity or 0, 0) for item in items),
        "created_at": order.created_at,
        "shipped_at": order.shipped_at,
        "updated_at": order.updated_at,
        "items": [fulfillment_order_item_response(item) for item in items],
        "picks": [fulfillment_pick_response(pick) for pick in picks],
        "pick_plan": fulfillment_pick_plan_for_order(db, order)
        if str(order.status or "").strip().lower() != "shipped"
        else [],
    }


def parse_fulfillment_order_items(items_json: str, db: Session) -> list[FulfillmentOrderItemCreate]:
    try:
        raw_items = json.loads(items_json or "[]")
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Order items must be valid JSON") from error

    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(status_code=400, detail="Fulfillment order must include at least one SKU")

    parsed_items = []
    for index, raw_item in enumerate(raw_items, start=1):
        try:
            item = FulfillmentOrderItemCreate.model_validate(raw_item)
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"Order item #{index} is invalid") from error
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product for order item #{index} not found")
        parsed_items.append(item)

    return parsed_items


def fulfillment_inventory_response(db: Session) -> list[dict]:
    box_items = (
        db.query(FulfillmentBoxItem)
        .join(FulfillmentBox, FulfillmentBox.id == FulfillmentBoxItem.box_id)
        .join(FulfillmentShipment, FulfillmentShipment.id == FulfillmentBox.shipment_id)
        .filter(FulfillmentBoxItem.available_quantity > 0)
        .filter(func.lower(func.coalesce(FulfillmentShipment.status, "")) == "received")
        .order_by(FulfillmentBoxItem.product_id.asc(), FulfillmentBoxItem.id.asc())
        .all()
    )
    return [fulfillment_box_item_response(box_item) for box_item in box_items]


def fulfillment_inventory_locations_response(db: Session) -> list[dict]:
    box_items = (
        db.query(FulfillmentBoxItem)
        .join(FulfillmentBox, FulfillmentBox.id == FulfillmentBoxItem.box_id)
        .join(FulfillmentShipment, FulfillmentShipment.id == FulfillmentBox.shipment_id)
        .filter(func.lower(func.coalesce(FulfillmentShipment.status, "")) == "received")
        .order_by(FulfillmentBoxItem.product_id.asc(), FulfillmentBoxItem.id.asc())
        .all()
    )
    return [fulfillment_box_item_response(box_item) for box_item in box_items]


def fulfillment_dashboard_response(
    db: Session,
    privacy: dict | None = None,
) -> dict:
    shipments = (
        db.query(FulfillmentShipment)
        .order_by(FulfillmentShipment.sent_at.desc(), FulfillmentShipment.id.desc())
        .limit(30)
        .all()
    )
    all_orders = (
        db.query(FulfillmentOrder)
        .order_by(FulfillmentOrder.created_at.desc(), FulfillmentOrder.id.desc())
        .all()
    )
    orders = all_orders[:80]
    inventory = fulfillment_inventory_response(db)
    inventory_locations = fulfillment_inventory_locations_response(db)
    discrepancies = (
        db.query(FulfillmentInventoryDiscrepancy)
        .order_by(
            FulfillmentInventoryDiscrepancy.created_at.desc(),
            FulfillmentInventoryDiscrepancy.id.desc(),
        )
        .limit(100)
        .all()
    )
    return {
        "stats": {
            "unfulfilled_orders": sum(
                1 for order in all_orders if str(order.status or "").strip().lower() != "shipped"
            ),
            "shipped_orders": sum(
                1 for order in all_orders if str(order.status or "").strip().lower() == "shipped"
            ),
            "fulfillment_units": sum(max(item.get("available_quantity") or 0, 0) for item in inventory),
            "active_boxes": len({item.get("box_id") for item in inventory if item.get("available_quantity", 0) > 0}),
            "recent_shipments": len(shipments),
        },
        "shipments": [fulfillment_shipment_response(shipment) for shipment in shipments],
        "orders": [
            fulfillment_order_response(order, db, privacy)
            for order in orders
        ],
        "inventory": inventory,
        "inventory_locations": inventory_locations,
        "discrepancies": [
            fulfillment_inventory_discrepancy_response(discrepancy)
            for discrepancy in discrepancies
        ],
    }


@app.get("/fulfillment/dashboard")
def get_fulfillment_dashboard(request: Request, db: Session = Depends(get_db)):
    privacy = access_privacy_context(request, db)
    return fulfillment_dashboard_response(db, privacy)


@app.get("/fulfillment/shipments", response_model=list[FulfillmentShipmentOut])
def get_fulfillment_shipments(db: Session = Depends(get_db)):
    shipments = (
        db.query(FulfillmentShipment)
        .order_by(FulfillmentShipment.sent_at.desc(), FulfillmentShipment.id.desc())
        .all()
    )
    return [fulfillment_shipment_response(shipment) for shipment in shipments]


@app.post("/fulfillment/shipments/{shipment_id}/receive", response_model=FulfillmentShipmentOut)
@app.patch("/fulfillment/shipments/{shipment_id}/receive", response_model=FulfillmentShipmentOut)
def receive_fulfillment_shipment(
    shipment_id: int,
    payload: FulfillmentShipmentReceiptUpdate,
    db: Session = Depends(get_db),
):
    shipment = db.query(FulfillmentShipment).filter(FulfillmentShipment.id == shipment_id).first()
    if not shipment:
        raise HTTPException(status_code=404, detail="Fulfillment shipment not found")
    if str(shipment.status or "").strip().lower() == "canceled":
        raise HTTPException(status_code=400, detail="Canceled shipments cannot be received")

    party = str(payload.party or "").strip().lower()
    if party not in {"admin", "fulfillment"}:
        raise HTTPException(status_code=400, detail="Receipt party must be admin or fulfillment")

    now = datetime.utcnow()
    if party == "admin" and not shipment.admin_received_at:
        shipment.admin_received_at = now
    if party == "fulfillment" and not shipment.fulfillment_received_at:
        shipment.fulfillment_received_at = now

    if shipment.admin_received_at and shipment.fulfillment_received_at:
        shipment.status = "Received"
        shipment.received_at = shipment.received_at or now
    elif shipment.admin_received_at:
        shipment.status = "Delivered"
    elif shipment.fulfillment_received_at:
        shipment.status = "Fulfillment received"
    else:
        shipment.status = "In Transit"

    shipment.updated_at = now
    db.add(shipment)
    db.commit()
    db.refresh(shipment)
    return fulfillment_shipment_response(shipment)


@app.patch("/fulfillment/boxes/{box_id}/location")
def update_fulfillment_box_location(
    box_id: int,
    payload: FulfillmentBoxLocationUpdate,
    db: Session = Depends(get_db),
):
    box = db.query(FulfillmentBox).filter(FulfillmentBox.id == box_id).first()
    if not box:
        raise HTTPException(status_code=404, detail="Fulfillment box not found")

    box.location = clean_optional_text(payload.location)
    if box.shipment:
        box.shipment.updated_at = datetime.utcnow()
        db.add(box.shipment)
    db.add(box)
    db.commit()
    db.refresh(box)
    return fulfillment_box_response(box)


@app.post(
    "/fulfillment/inventory/discrepancies",
    response_model=FulfillmentInventoryDiscrepancyOut,
)
def create_fulfillment_inventory_discrepancy(
    payload: FulfillmentInventoryDiscrepancyCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    reason, direction = normalize_fulfillment_discrepancy(
        payload.reason,
        payload.direction,
    )
    box_item = (
        db.query(FulfillmentBoxItem)
        .filter(FulfillmentBoxItem.id == payload.box_item_id)
        .first()
    )
    if not box_item:
        raise HTTPException(status_code=404, detail="Fulfillment box stock was not found")

    box = box_item.box
    shipment = box.shipment if box else None
    if not shipment or normalized_fulfillment_shipment_status(shipment) != "Received":
        raise HTTPException(
            status_code=400,
            detail="Only received fulfillment stock can be adjusted",
        )

    quantity = int(payload.quantity)
    available_before = max(box_item.available_quantity or 0, 0)
    quantity_delta = quantity if direction == "add" else -quantity
    if quantity_delta < 0 and quantity > available_before:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Box {box.box_number} only has {available_before} available unit(s) "
                f"of {box_item.product.article_no if box_item.product else 'this product'}"
            ),
        )

    available_after = available_before + quantity_delta
    box_item.available_quantity = available_after
    now = datetime.utcnow()
    reference = clean_optional_text(payload.reference)
    notes = clean_optional_text(payload.notes)
    discrepancy = FulfillmentInventoryDiscrepancy(
        box_item_id=box_item.id,
        product_id=box_item.product_id,
        reason=reason,
        quantity_delta=quantity_delta,
        available_before=available_before,
        available_after=available_after,
        reference=reference,
        notes=notes,
        created_by_user_id=getattr(request.state, "user_id", None),
        created_by_name=getattr(request.state, "user_name", None),
        created_at=now,
    )
    movement_note = f"{reason}: {abs(quantity_delta)} unit(s) in box {box.box_number}"
    if notes:
        movement_note = f"{movement_note}. {notes}"
    movement = StockMovement(
        product_id=box_item.product_id,
        movement_type="Fulfillment Discrepancy",
        quantity=quantity_delta,
        stock_type="fulfillment_stock",
        source=f"Box {box.box_number}",
        reference=reference or shipment.shipment_no,
        note=movement_note,
        faulty=reason == "Damaged",
        faulty_quantity=quantity if reason == "Damaged" else 0,
        faulty_note=notes if reason == "Damaged" else None,
        created_at=now,
    )
    shipment.updated_at = now
    db.add(box_item)
    db.add(discrepancy)
    db.add(movement)
    db.add(shipment)
    db.commit()
    db.refresh(discrepancy)
    return fulfillment_inventory_discrepancy_response(discrepancy)


@app.post("/fulfillment/boxes/merge")
def merge_fulfillment_boxes(
    payload: FulfillmentBoxMergeRequest,
    db: Session = Depends(get_db),
):
    if payload.source_box_id == payload.target_box_id:
        raise HTTPException(status_code=400, detail="Choose two different boxes to merge")

    source_box = (
        db.query(FulfillmentBox)
        .filter(FulfillmentBox.id == payload.source_box_id)
        .first()
    )
    target_box = (
        db.query(FulfillmentBox)
        .filter(FulfillmentBox.id == payload.target_box_id)
        .first()
    )
    if not source_box or not target_box:
        raise HTTPException(status_code=404, detail="Source or target box was not found")

    source_items = [
        item for item in (source_box.items or []) if max(item.available_quantity or 0, 0) > 0
    ]
    if not source_items:
        raise HTTPException(status_code=400, detail="Source box has no available units to merge")

    now = datetime.utcnow()
    moved_units = 0
    moved_skus = 0
    target_items_by_product = {
        item.product_id: item for item in (target_box.items or [])
    }

    for source_item in source_items:
        move_quantity = max(source_item.available_quantity or 0, 0)
        if move_quantity <= 0:
            continue

        target_item = target_items_by_product.get(source_item.product_id)
        if target_item:
            target_item.quantity = (target_item.quantity or 0) + move_quantity
            target_item.available_quantity = (
                target_item.available_quantity or 0
            ) + move_quantity
        else:
            target_item = FulfillmentBoxItem(
                box_id=target_box.id,
                product_id=source_item.product_id,
                quantity=move_quantity,
                available_quantity=move_quantity,
                created_at=now,
            )
            db.add(target_item)
            target_items_by_product[source_item.product_id] = target_item

        source_item.quantity = max((source_item.quantity or 0) - move_quantity, 0)
        source_item.available_quantity = 0
        moved_units += move_quantity
        moved_skus += 1
        db.add(source_item)
        db.add(target_item)

    merge_note = (
        f"Merged {moved_units} unit(s) from box {source_box.box_number} "
        f"into box {target_box.box_number}"
    )
    extra_note = clean_optional_text(payload.note)
    if extra_note:
        merge_note = f"{merge_note}. {extra_note}"

    target_box.notes = "\n".join(
        part for part in [clean_optional_text(target_box.notes), merge_note] if part
    )
    source_box.notes = "\n".join(
        part
        for part in [
            clean_optional_text(source_box.notes),
            f"Merged available stock into box {target_box.box_number}",
        ]
        if part
    )

    for shipment in {source_box.shipment, target_box.shipment}:
        if shipment:
            shipment.updated_at = now
            db.add(shipment)

    db.add(source_box)
    db.add(target_box)
    db.commit()
    db.refresh(source_box)
    db.refresh(target_box)
    return {
        "message": merge_note,
        "moved_units": moved_units,
        "moved_skus": moved_skus,
        "source_box": fulfillment_box_response(source_box),
        "target_box": fulfillment_box_response(target_box),
    }


@app.post("/fulfillment/shipments", response_model=FulfillmentShipmentOut)
def create_fulfillment_shipment(
    shipment: FulfillmentShipmentCreate,
    db: Session = Depends(get_db),
):
    if not shipment.boxes:
        raise HTTPException(status_code=400, detail="Add at least one carton or box")

    source = normalize_stock_source(shipment.source_stock)
    source_label = "Factory" if source == "factory" else "USA"
    stock_field = "factory_stock" if source == "factory" else "usa_stock"
    shipment_no = clean_optional_text(shipment.shipment_no) or next_fulfillment_shipment_number(db)

    if db.query(FulfillmentShipment).filter(FulfillmentShipment.shipment_no == shipment_no).first():
        raise HTTPException(status_code=400, detail="Fulfillment shipment number already exists")

    box_numbers = []
    required_by_product: dict[int, int] = {}
    for box in shipment.boxes:
        box_number = clean_optional_text(box.box_number)
        if not box_number:
            raise HTTPException(status_code=400, detail="Every box needs a box number")
        if box_number.lower() in box_numbers:
            raise HTTPException(status_code=400, detail=f"Box number {box_number} is duplicated")
        box_numbers.append(box_number.lower())
        if not box.items:
            raise HTTPException(status_code=400, detail=f"Box {box_number} must include at least one SKU")
        for item in box.items:
            required_by_product[item.product_id] = required_by_product.get(item.product_id, 0) + item.quantity

    products = {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_(required_by_product.keys())).all()
    }
    for product_id, required_quantity in required_by_product.items():
        product = products.get(product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"Product #{product_id} not found")
        available = max(getattr(product, stock_field) or 0, 0)
        if available < required_quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{product.article_no} only has {available} units in {source_label} stock; "
                    f"{required_quantity} requested for fulfillment"
                ),
            )

    now = datetime.utcnow()
    new_shipment = FulfillmentShipment(
        shipment_no=shipment_no,
        destination_name=clean_optional_text(shipment.destination_name) or "Fulfillment center",
        source_stock=source_label,
        status="In Transit",
        carton_count=len(shipment.boxes),
        notes=clean_optional_text(shipment.notes),
        sent_at=shipment.sent_at or now,
        created_at=now,
        updated_at=now,
    )
    db.add(new_shipment)
    db.flush()

    for product_id, required_quantity in required_by_product.items():
        product = products[product_id]
        setattr(product, stock_field, (getattr(product, stock_field) or 0) - required_quantity)
        db.add(product)

    for box in shipment.boxes:
        new_box = FulfillmentBox(
            shipment_id=new_shipment.id,
            box_number=clean_optional_text(box.box_number),
            weight_kg=box.weight_kg,
            length_cm=box.length_cm,
            width_cm=box.width_cm,
            height_cm=box.height_cm,
            location=clean_optional_text(box.location),
            notes=clean_optional_text(box.notes),
            created_at=now,
        )
        db.add(new_box)
        db.flush()

        for item in box.items:
            product = products[item.product_id]
            box_item = FulfillmentBoxItem(
                box_id=new_box.id,
                product_id=item.product_id,
                quantity=item.quantity,
                available_quantity=item.quantity,
                created_at=now,
            )
            movement = StockMovement(
                product_id=item.product_id,
                movement_type="Fulfillment Shipment",
                quantity=-item.quantity,
                stock_type=stock_field,
                source=source_label,
                reference=shipment_no,
                note=f"Sent to fulfillment in box {new_box.box_number}",
                created_at=now,
            )
            db.add(box_item)
            db.add(movement)
            db.add(product)

    db.commit()
    db.refresh(new_shipment)
    return fulfillment_shipment_response(new_shipment)


@app.get("/fulfillment/orders", response_model=list[FulfillmentOrderOut])
def get_fulfillment_orders(request: Request, db: Session = Depends(get_db)):
    privacy = access_privacy_context(request, db)
    orders = (
        db.query(FulfillmentOrder)
        .order_by(FulfillmentOrder.created_at.desc(), FulfillmentOrder.id.desc())
        .all()
    )
    return [fulfillment_order_response(order, db, privacy) for order in orders]


@app.post("/fulfillment/orders", response_model=FulfillmentOrderOut)
async def create_fulfillment_order(
    request: Request,
    fulfillment_order_no: str = Form(None),
    customer_name: str = Form(None),
    platform: str = Form(None),
    ship_to: str = Form(None),
    notes: str = Form(None),
    items_json: str = Form(...),
    label_file: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    order_no = clean_optional_text(fulfillment_order_no) or next_fulfillment_order_number(db)
    if db.query(FulfillmentOrder).filter(FulfillmentOrder.fulfillment_order_no == order_no).first():
        raise HTTPException(status_code=400, detail="Fulfillment order number already exists")

    items = parse_fulfillment_order_items(items_json, db)
    label_url = None
    label_name = None
    if label_file:
        label_url, label_name = save_fulfillment_document(label_file)

    now = datetime.utcnow()
    order = FulfillmentOrder(
        fulfillment_order_no=order_no,
        customer_name=clean_optional_text(customer_name),
        platform=clean_optional_text(platform),
        ship_to=clean_optional_text(ship_to),
        status="Unfulfilled",
        label_file_url=label_url,
        label_file_name=label_name,
        notes=clean_optional_text(notes),
        created_at=now,
        updated_at=now,
    )
    db.add(order)
    db.flush()

    for item in items:
        order_item = FulfillmentOrderItem(
            fulfillment_order_id=order.id,
            product_id=item.product_id,
            quantity=item.quantity,
            picked_quantity=0,
        )
        db.add(order_item)

    db.commit()
    db.refresh(order)
    privacy = access_privacy_context(request, db)
    return fulfillment_order_response(order, db, privacy)


@app.post("/fulfillment/orders/{order_id}/label", response_model=FulfillmentOrderOut)
async def upload_fulfillment_order_label(
    order_id: int,
    request: Request,
    label_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    order = db.query(FulfillmentOrder).filter(FulfillmentOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Fulfillment order not found")

    label_url, label_name = save_fulfillment_document(label_file)
    order.label_file_url = label_url
    order.label_file_name = label_name
    order.updated_at = datetime.utcnow()
    db.add(order)
    db.commit()
    db.refresh(order)
    privacy = access_privacy_context(request, db)
    return fulfillment_order_response(order, db, privacy)


@app.patch("/fulfillment/orders/{order_id}/ship", response_model=FulfillmentOrderOut)
def ship_fulfillment_order(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    order = db.query(FulfillmentOrder).filter(FulfillmentOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Fulfillment order not found")
    if str(order.status or "").strip().lower() == "shipped":
        return fulfillment_order_response(order, db, privacy)

    pick_plan = fulfillment_pick_plan_for_order(db, order)
    shortages = [
        f"{line['article_no']}: short {line['shortage_quantity']}"
        for line in pick_plan
        if line["shortage_quantity"] > 0
    ]
    if shortages:
        raise HTTPException(
            status_code=400,
            detail="Cannot ship. Fulfillment stock shortage: " + "; ".join(shortages),
        )

    now = datetime.utcnow()
    for item in order.items or []:
        remaining = max((item.quantity or 0) - (item.picked_quantity or 0), 0)
        if remaining <= 0:
            continue

        for box_item in fulfillment_available_box_items_query(db, item.product_id).all():
            if remaining <= 0:
                break
            available = max(box_item.available_quantity or 0, 0)
            if available <= 0:
                continue
            pick_quantity = min(available, remaining)
            box_item.available_quantity = available - pick_quantity
            item.picked_quantity = (item.picked_quantity or 0) + pick_quantity

            pick = FulfillmentPick(
                fulfillment_order_id=order.id,
                box_item_id=box_item.id,
                product_id=item.product_id,
                quantity=pick_quantity,
                created_at=now,
            )
            movement = StockMovement(
                product_id=item.product_id,
                movement_type="Fulfillment Order Shipped",
                quantity=-pick_quantity,
                source="Warehouse / Fulfillment",
                reference=order.fulfillment_order_no,
                note=(
                    f"Picked {pick_quantity} unit(s) from box "
                    f"{box_item.box.box_number if box_item.box else box_item.box_id}"
                ),
                created_at=now,
            )
            db.add(box_item)
            db.add(item)
            db.add(pick)
            db.add(movement)
            remaining -= pick_quantity

    order.status = "Shipped"
    order.shipped_at = now
    order.updated_at = now
    db.add(order)
    db.commit()
    db.refresh(order)
    return fulfillment_order_response(order, db, privacy)


@app.get("/suppliers", response_model=list[SupplierOut])
def get_suppliers(db: Session = Depends(get_db)):
    return [supplier_response(s) for s in db.query(Supplier).order_by(Supplier.id.desc()).all()]


@app.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def get_supplier(supplier_id: int, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier_response(supplier)


@app.post("/suppliers", response_model=SupplierOut)
def create_supplier(supplier: SupplierCreate, db: Session = Depends(get_db)):
    new_supplier = Supplier(**supplier.model_dump())
    db.add(new_supplier)
    db.commit()
    db.refresh(new_supplier)
    return supplier_response(new_supplier)


@app.put("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, supplier: SupplierCreate, db: Session = Depends(get_db)):
    existing = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Supplier not found")

    for key, value in supplier.model_dump().items():
        setattr(existing, key, value)

    db.commit()
    db.refresh(existing)
    return supplier_response(existing)


@app.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    db.delete(supplier)
    db.commit()
    return {"detail": "Supplier deleted"}


@app.post("/suppliers/{supplier_id}/ordered-items", response_model=SupplierOut)
def create_supplier_order_item(
    supplier_id: int,
    order_item: SupplierOrderItemCreate,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    product = db.query(Product).filter(Product.id == order_item.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    ordered_quantity = int(order_item.ordered_quantity or 0)
    purchase_price = float(order_item.purchase_price or 0)
    if ordered_quantity <= 0:
        raise HTTPException(status_code=400, detail="Ordered quantity must be greater than zero")
    if purchase_price <= 0:
        raise HTTPException(status_code=400, detail="Purchase price must be greater than zero")

    stock_type = normalize_supplier_stock_type(order_item.stock_type)
    new_order_item = SupplierOrderItem(
        supplier_id=supplier_id,
        product_id=product.id,
        ordered_quantity=ordered_quantity,
        received_quantity=0,
        purchase_price=purchase_price,
        stock_type=stock_type,
        reference=order_item.reference,
        note=order_item.note,
        status="Ordered",
        is_closed=False,
        closed_at=None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    db.add(new_order_item)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.delete("/suppliers/{supplier_id}/ordered-items/{order_item_id}", response_model=SupplierOut)
def remove_supplier_order_item(
    supplier_id: int,
    order_item_id: int,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    order_item = db.query(SupplierOrderItem).filter(
        SupplierOrderItem.id == order_item_id,
        SupplierOrderItem.supplier_id == supplier_id,
    ).first()
    if not order_item:
        raise HTTPException(status_code=404, detail="Ordered item not found")

    now = datetime.utcnow()
    order_item.is_closed = True
    order_item.closed_at = now
    order_item.status = "Removed"
    order_item.updated_at = now

    db.add(order_item)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.post("/suppliers/{supplier_id}/ordered-items/{order_item_id}/receive", response_model=SupplierOut)
def receive_supplier_order_item(
    supplier_id: int,
    order_item_id: int,
    receipt: SupplierOrderItemReceive,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    order_item = db.query(SupplierOrderItem).filter(
        SupplierOrderItem.id == order_item_id,
        SupplierOrderItem.supplier_id == supplier_id,
    ).first()
    if not order_item:
        raise HTTPException(status_code=404, detail="Ordered item not found")

    product = db.query(Product).filter(Product.id == order_item.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    received_quantity = int(receipt.received_quantity or 0)
    purchase_price = (
        float(receipt.purchase_price)
        if receipt.purchase_price is not None
        else float(order_item.purchase_price or 0)
    )
    if received_quantity <= 0:
        raise HTTPException(status_code=400, detail="Received quantity must be greater than zero")
    if purchase_price <= 0:
        raise HTTPException(status_code=400, detail="Purchase price must be greater than zero")

    stock_type = normalize_supplier_stock_type(receipt.stock_type or order_item.stock_type)
    old_stock = getattr(product, stock_type) or 0
    setattr(product, stock_type, old_stock + received_quantity)

    total_received = (order_item.received_quantity or 0) + received_quantity
    should_close_order = bool(receipt.complete_order) or total_received >= (order_item.ordered_quantity or 0)
    order_item.received_quantity = total_received
    order_item.purchase_price = purchase_price
    order_item.stock_type = stock_type
    order_item.is_closed = should_close_order
    order_item.closed_at = datetime.utcnow() if should_close_order else None
    order_item.status = supplier_order_status(order_item)
    order_item.updated_at = datetime.utcnow()

    stock_label = SUPPLIER_STOCK_FIELDS[stock_type]
    note_parts = [
        f"Received {received_quantity} units against supplier order #{order_item.id}.",
        f"Ordered {order_item.ordered_quantity or 0}, total received {total_received}.",
        f"{stock_label} adjusted from {old_stock} to {old_stock + received_quantity}.",
    ]
    if should_close_order:
        note_parts.append("Order line completed and removed from active queue.")
    else:
        remaining_quantity = max((order_item.ordered_quantity or 0) - total_received, 0)
        note_parts.append(f"Order line left open with {remaining_quantity} pending.")
    if receipt.note:
        note_parts.append(receipt.note)

    movement = StockMovement(
        product_id=product.id,
        supplier_id=supplier.id,
        movement_type="Supplier Purchase",
        quantity=received_quantity,
        stock_type=stock_type,
        purchase_price=purchase_price,
        source=supplier.name,
        reference=product.article_no,
        note=" ".join(note_parts),
        created_at=datetime.utcnow(),
    )

    db.add(product)
    db.add(order_item)
    db.add(movement)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.post("/suppliers/{supplier_id}/supply-items", response_model=SupplierOut)
def create_supplier_supply_items(
    supplier_id: int,
    payload: SupplierSupplyItemBatchCreate,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    if not payload.items:
        raise HTTPException(status_code=400, detail="Add at least one supplies or accessories line")

    now = datetime.utcnow()
    for item in payload.items:
        item_name = clean_supply_text(item.item_name)
        quantity = int(item.quantity or 0)
        unit_price = float(item.unit_price or 0)
        if not item_name:
            raise HTTPException(status_code=400, detail="Every supply line needs an item name")
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Every supply line needs a quantity greater than zero")
        if unit_price <= 0:
            raise HTTPException(status_code=400, detail="Every supply line needs a unit price greater than zero")

        db.add(
            SupplierSupplyItem(
                supplier_id=supplier.id,
                sku=clean_supply_text(item.sku) or None,
                item_name=item_name,
                category=clean_supply_text(item.category, "Miscellaneous"),
                usage_area=clean_supply_text(item.usage_area, "General"),
                quantity=quantity,
                unit_price=unit_price,
                note=clean_supply_text(item.note) or None,
                created_at=now,
                updated_at=now,
            )
        )

    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.patch("/suppliers/{supplier_id}/supply-items/{supply_item_id}", response_model=SupplierOut)
def update_supplier_supply_item(
    supplier_id: int,
    supply_item_id: int,
    payload: SupplierSupplyItemUpdate,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    item = db.query(SupplierSupplyItem).filter(
        SupplierSupplyItem.id == supply_item_id,
        SupplierSupplyItem.supplier_id == supplier_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Supply item not found")

    data = payload.model_dump(exclude_unset=True)
    if "item_name" in data:
        item_name = clean_supply_text(data["item_name"])
        if not item_name:
            raise HTTPException(status_code=400, detail="Supply item name is required")
        item.item_name = item_name
    if "quantity" in data:
        quantity = int(data["quantity"] or 0)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
        item.quantity = quantity
    if "unit_price" in data:
        unit_price = float(data["unit_price"] or 0)
        if unit_price <= 0:
            raise HTTPException(status_code=400, detail="Unit price must be greater than zero")
        item.unit_price = unit_price
    if "sku" in data:
        item.sku = clean_supply_text(data["sku"]) or None
    if "category" in data:
        item.category = clean_supply_text(data["category"], "Miscellaneous")
    if "usage_area" in data:
        item.usage_area = clean_supply_text(data["usage_area"], "General")
    if "note" in data:
        item.note = clean_supply_text(data["note"]) or None
    item.updated_at = datetime.utcnow()

    db.add(item)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.delete("/suppliers/{supplier_id}/supply-items/{supply_item_id}", response_model=SupplierOut)
def delete_supplier_supply_item(
    supplier_id: int,
    supply_item_id: int,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    item = db.query(SupplierSupplyItem).filter(
        SupplierSupplyItem.id == supply_item_id,
        SupplierSupplyItem.supplier_id == supplier_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Supply item not found")

    db.delete(item)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.post("/suppliers/{supplier_id}/payments", response_model=SupplierOut)
def create_supplier_payment(supplier_id: int, payment: SupplierPaymentCreate, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    payment_data = payment.model_dump()
    payment_date = payment_data.pop("payment_date", None)
    if payment_date is None:
        payment_date = datetime.utcnow()

    new_payment = SupplierPayment(
        supplier_id=supplier_id,
        payment_date=payment_date,
        **payment_data,
    )

    db.add(new_payment)
    db.commit()
    db.refresh(new_payment)
    db.refresh(supplier)
    return supplier_response(supplier)


@app.patch("/suppliers/{supplier_id}/payments/{payment_id}", response_model=SupplierOut)
def update_supplier_payment(supplier_id: int, payment_id: int, payment: SupplierPaymentCreate, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    existing = db.query(SupplierPayment).filter(SupplierPayment.id == payment_id, SupplierPayment.supplier_id == supplier_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Payment not found")

    data = payment.model_dump()
    for key, value in data.items():
        setattr(existing, key, value)

    db.add(existing)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.delete("/suppliers/{supplier_id}/payments/{payment_id}", response_model=SupplierOut)
def delete_supplier_payment(supplier_id: int, payment_id: int, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    existing = db.query(SupplierPayment).filter(SupplierPayment.id == payment_id, SupplierPayment.supplier_id == supplier_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Payment not found")

    db.delete(existing)
    db.commit()
    db.refresh(supplier)
    return supplier_response(supplier)


@app.patch("/stock-movements/{movement_id}", response_model=StockMovementOut)
def update_stock_movement(movement_id: int, update: StockMovementUpdate, db: Session = Depends(get_db)):
    movement = db.query(StockMovement).filter(StockMovement.id == movement_id).first()
    if not movement:
        raise HTTPException(status_code=404, detail="Stock movement not found")

    is_supplier_receipt = movement.movement_type == "Supplier Purchase"
    stock_field = infer_stock_movement_type(movement) if is_supplier_receipt else None
    old_effective_quantity = (
        supplier_movement_effective_quantity(movement)
        if is_supplier_receipt
        else 0
    )

    data = update.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(movement, key, value)

    if movement.quantity is None or movement.quantity < 1:
        raise HTTPException(status_code=400, detail="Stock movement quantity must be at least 1")
    if (movement.faulty_quantity or 0) < 0 or (movement.faulty_quantity or 0) > movement.quantity:
        raise HTTPException(status_code=400, detail="Faulty quantity cannot exceed the movement quantity")

    if is_supplier_receipt:
        if not stock_field:
            raise HTTPException(
                status_code=400,
                detail="This legacy purchase has no stock location. Adjust it from Inventory instead.",
            )
        movement.stock_type = stock_field
        stock_delta = supplier_movement_effective_quantity(movement) - old_effective_quantity
        if stock_delta:
            product_column = getattr(Product, stock_field)
            db.query(Product).filter(Product.id == movement.product_id).update(
                {product_column: func.coalesce(product_column, 0) + stock_delta},
                synchronize_session=False,
            )

    db.add(movement)
    db.commit()
    db.refresh(movement)
    return stock_movement_response(movement)


@app.delete("/stock-movements/{movement_id}")
def delete_stock_movement(movement_id: int, db: Session = Depends(get_db)):
    movement = db.query(StockMovement).filter(StockMovement.id == movement_id).first()
    if not movement:
        raise HTTPException(status_code=404, detail="Stock movement not found")

    stock_delta = 0
    stock_field = None
    if movement.movement_type == "Supplier Purchase":
        stock_field = infer_stock_movement_type(movement)
        if not stock_field:
            raise HTTPException(
                status_code=400,
                detail="This legacy purchase has no stock location. Adjust it from Inventory instead.",
            )
        stock_delta = -supplier_movement_effective_quantity(movement)

    if stock_field and stock_delta:
        product_column = getattr(Product, stock_field)
        db.query(Product).filter(Product.id == movement.product_id).update(
            {product_column: func.coalesce(product_column, 0) + stock_delta},
            synchronize_session=False,
        )

    db.delete(movement)
    db.commit()
    return {"detail": "Stock movement deleted"}


def courier_payment_response(payment: CourierPayment):
    return {
        "id": payment.id,
        "courier_name": payment.courier_name,
        "amount": payment.amount,
        "payment_method": payment.payment_method,
        "payment_reference": payment.payment_reference,
        "note": payment.note,
        "payment_date": payment.payment_date,
        "created_at": payment.created_at,
    }


VALID_BILL_FREQUENCIES = {"Weekly", "Monthly", "Quarterly", "Yearly", "One-time"}
VALID_BILL_STATUSES = {"Active", "Paused", "Completed"}


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def next_regular_bill_due_date(
    current_due_date: datetime | None,
    frequency: str,
    paid_at: datetime,
) -> datetime | None:
    if frequency == "One-time":
        return None

    def advance_once(value: datetime) -> datetime:
        if frequency == "Weekly":
            return value + timedelta(days=7)
        if frequency == "Monthly":
            return add_months(value, 1)
        if frequency == "Quarterly":
            return add_months(value, 3)
        if frequency == "Yearly":
            return add_months(value, 12)
        return add_months(value, 1)

    next_due = advance_once(current_due_date or paid_at)
    while next_due.date() <= paid_at.date():
        next_due = advance_once(next_due)

    return next_due


def regular_bill_due_status(
    bill: RegularBill,
    today: datetime | None = None,
) -> tuple[str, int | None]:
    if bill.status != "Active":
        return bill.status or "Paused", None
    if not bill.next_due_date:
        return "No date", None

    current_day = (today or datetime.utcnow()).date()
    days_until_due = (bill.next_due_date.date() - current_day).days
    if days_until_due < 0:
        return "Overdue", days_until_due
    if days_until_due == 0:
        return "Due today", days_until_due
    if days_until_due <= (bill.reminder_days or 0):
        return "Upcoming", days_until_due
    return "Scheduled", days_until_due


def regular_bill_payment_response(payment: RegularBillPayment):
    return {
        "id": payment.id,
        "bill_id": payment.bill_id,
        "amount": payment.amount,
        "payment_method": payment.payment_method,
        "payment_reference": payment.payment_reference,
        "note": payment.note,
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }


def sync_regular_bill_last_paid_at(bill: RegularBill):
    latest_payment = max(
        bill.payments or [],
        key=lambda payment: payment.paid_at or payment.created_at,
        default=None,
    )
    bill.last_paid_at = latest_payment.paid_at if latest_payment else None


def regular_bill_response(bill: RegularBill):
    due_status, days_until_due = regular_bill_due_status(bill)
    payments = sorted(
        bill.payments or [],
        key=lambda payment: payment.paid_at or payment.created_at,
        reverse=True,
    )

    return {
        "id": bill.id,
        "name": bill.name,
        "category": bill.category,
        "vendor": bill.vendor,
        "amount": bill.amount,
        "currency": bill.currency,
        "frequency": bill.frequency,
        "next_due_date": bill.next_due_date,
        "reminder_days": bill.reminder_days,
        "payment_method": bill.payment_method,
        "account_reference": bill.account_reference,
        "status": bill.status,
        "notes": bill.notes,
        "last_paid_at": bill.last_paid_at,
        "created_at": bill.created_at,
        "updated_at": bill.updated_at,
        "days_until_due": days_until_due,
        "due_status": due_status,
        "payments": [regular_bill_payment_response(payment) for payment in payments],
    }


ACCOUNTING_DIRECTIONS = {"Money In", "Money Out"}
ACCOUNTING_ACCOUNT_TYPES = {"Bank", "Cash", "Platform", "Wallet", "Other"}
ACCOUNTING_ORDER_SOURCE = "order_payout"
ACCOUNTING_WORKER_PAYMENT_SOURCE = "worker_payment"


def normalize_accounting_direction(direction: str | None) -> str:
    value = (direction or "").strip().lower().replace("_", " ").replace("-", " ")
    aliases = {
        "in": "Money In",
        "income": "Money In",
        "money in": "Money In",
        "money_in": "Money In",
        "out": "Money Out",
        "expense": "Money Out",
        "expenses": "Money Out",
        "money out": "Money Out",
        "money_out": "Money Out",
    }
    normalized = aliases.get(value, (direction or "").strip())
    if normalized not in ACCOUNTING_DIRECTIONS:
        raise HTTPException(status_code=400, detail="Direction must be Money In or Money Out")
    return normalized


def normalize_accounting_currency(currency: str | None) -> str:
    value = (currency or "PKR").strip().upper()
    return value or "PKR"


def normalize_accounting_account_type(account_type: str | None) -> str:
    value = (account_type or "Bank").strip().title()
    if value not in ACCOUNTING_ACCOUNT_TYPES:
        return "Other"
    return value


def accounting_amount_pkr(
    *,
    amount: float,
    currency: str,
    exchange_rate: float | None,
    amount_pkr: float | None,
) -> float:
    if amount_pkr is not None:
        return round(float(amount_pkr), 2)
    if normalize_accounting_currency(currency) == "PKR":
        return round(float(amount or 0), 2)
    rate = float(exchange_rate or 0)
    return round(float(amount or 0) * rate, 2) if rate > 0 else 0


def platform_label(platform: str | None) -> str | None:
    value = (platform or "").strip()
    if not value or value.lower() == "manual":
        return None
    return value


def ensure_platform_account(db: Session, platform: str | None) -> AccountingAccount | None:
    label = platform_label(platform)
    if not label:
        return None

    account = (
        db.query(AccountingAccount)
        .filter(
            func.lower(AccountingAccount.platform) == label.lower(),
            AccountingAccount.account_type == "Platform",
        )
        .first()
    )
    if account:
        return account

    account_name = f"{label} Payouts"
    account = (
        db.query(AccountingAccount)
        .filter(func.lower(AccountingAccount.name) == account_name.lower())
        .first()
    )
    if account:
        account.platform = label
        account.account_type = "Platform"
        account.currency = account.currency or "USD"
        account.is_active = True
        db.add(account)
        db.flush()
        return account

    account = AccountingAccount(
        name=account_name,
        account_type="Platform",
        platform=label,
        currency="USD",
        opening_balance=0,
        notes="Auto-created from order payouts.",
        is_active=True,
    )
    db.add(account)
    db.flush()
    return account


def ensure_default_accounting_accounts(db: Session) -> bool:
    changed = False
    default_accounts = [
        {
            "name": "Cash",
            "account_type": "Cash",
            "currency": "PKR",
            "notes": "Default cash account.",
        },
        {
            "name": "Bank",
            "account_type": "Bank",
            "currency": "PKR",
            "notes": "Default bank account.",
        },
    ]
    for account_data in default_accounts:
        exists = (
            db.query(AccountingAccount)
            .filter(func.lower(AccountingAccount.name) == account_data["name"].lower())
            .first()
        )
        if not exists:
            db.add(AccountingAccount(opening_balance=0, is_active=True, **account_data))
            changed = True

    for (platform,) in db.query(Order.platform).distinct().all():
        if platform_label(platform):
            before_count = db.query(AccountingAccount).count()
            ensure_platform_account(db, platform)
            changed = changed or db.query(AccountingAccount).count() != before_count

    if changed:
        db.flush()
    return changed


def accounting_account_response(account: AccountingAccount) -> dict:
    balance = float(account.opening_balance or 0)
    balance_pkr = balance if normalize_accounting_currency(account.currency) == "PKR" else 0

    for transaction in account.transactions or []:
        sign = 1 if transaction.direction == "Money In" else -1
        balance += sign * float(transaction.amount or 0)
        balance_pkr += sign * float(transaction.amount_pkr or 0)

    return {
        "id": account.id,
        "name": account.name,
        "account_type": account.account_type,
        "platform": account.platform,
        "currency": account.currency,
        "opening_balance": account.opening_balance,
        "notes": account.notes,
        "is_active": account.is_active,
        "balance": round(balance, 2),
        "balance_pkr": round(balance_pkr, 2),
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


def accounting_transaction_response(transaction: AccountingTransaction) -> dict:
    return {
        "id": transaction.id,
        "account_id": transaction.account_id,
        "account_name": transaction.account.name if transaction.account else None,
        "direction": transaction.direction,
        "category": transaction.category,
        "amount": transaction.amount,
        "currency": transaction.currency,
        "exchange_rate": transaction.exchange_rate,
        "amount_pkr": transaction.amount_pkr,
        "counterparty": transaction.counterparty,
        "platform": transaction.platform,
        "reference": transaction.reference,
        "source_type": transaction.source_type,
        "source_id": transaction.source_id,
        "description": transaction.description,
        "transaction_date": transaction.transaction_date,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
    }


def worker_payment_response(payment: WorkerPayment) -> dict:
    return {
        "id": payment.id,
        "worker_id": payment.worker_id,
        "worker_name": payment.worker.name if payment.worker else None,
        "amount": payment.amount,
        "payment_method": payment.payment_method,
        "payment_reference": payment.payment_reference,
        "note": payment.note,
        "accounting_transaction_id": payment.accounting_transaction_id,
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }


FAIRE_COMMISSION_RATE = 0.15
FAIRE_PAYOUT_FEE_RATE = 0.029


def is_faire_platform(value: str | None) -> bool:
    return str(value or "").strip().lower() == "faire"


def calculate_faire_payout_breakdown(order_total_usd: float | int | None) -> dict:
    gross = max(float(order_total_usd or 0), 0)
    commission = round(gross * FAIRE_COMMISSION_RATE, 2)
    payout_fee = round(gross * FAIRE_PAYOUT_FEE_RATE, 2)
    final_payout = round(max(gross - commission - payout_fee, 0), 2)
    return {
        "order_total_usd": round(gross, 2),
        "platform_fee_usd": commission,
        "deduction_usd": payout_fee,
        "expected_payout_usd": final_payout,
    }


def expected_order_payout(order: Order) -> float:
    expected = float(order.expected_payout_usd or 0)
    if expected > 0:
        return expected
    order_total = float(order.order_total_usd or 0)
    deductions = float(order.platform_fee_usd or 0) + float(order.deduction_usd or 0)
    if order_total > 0 and deductions <= 0 and is_faire_platform(order.platform):
        return calculate_faire_payout_breakdown(order_total)["expected_payout_usd"]
    return max(order_total - deductions, 0)


def platform_payout_summary(db: Session) -> list[dict]:
    platforms: dict[str, dict] = {}
    for order in db.query(Order).all():
        label = platform_label(order.platform)
        if not label:
            continue

        expected = expected_order_payout(order)
        received = float(order.received_payout_usd or 0)
        pending = max(expected - received, 0)

        if label not in platforms:
            account = (
                db.query(AccountingAccount)
                .filter(
                    func.lower(AccountingAccount.platform) == label.lower(),
                    AccountingAccount.account_type == "Platform",
                )
                .first()
            )
            platforms[label] = {
                "platform": label,
                "orders_count": 0,
                "expected_usd": 0,
                "received_usd": 0,
                "pending_usd": 0,
                "account_id": account.id if account else None,
                "account_name": account.name if account else f"{label} Payouts",
            }

        platforms[label]["orders_count"] += 1
        platforms[label]["expected_usd"] += expected
        platforms[label]["received_usd"] += received
        platforms[label]["pending_usd"] += pending

    return [
        {
            **platform,
            "expected_usd": round(platform["expected_usd"], 2),
            "received_usd": round(platform["received_usd"], 2),
            "pending_usd": round(platform["pending_usd"], 2),
        }
        for platform in sorted(platforms.values(), key=lambda item: item["platform"].lower())
    ]


def accounting_overview_response(db: Session) -> dict:
    accounts = db.query(AccountingAccount).order_by(AccountingAccount.account_type, AccountingAccount.name).all()
    transactions = (
        db.query(AccountingTransaction)
        .order_by(AccountingTransaction.transaction_date.desc(), AccountingTransaction.id.desc())
        .all()
    )
    money_in_pkr = sum(float(t.amount_pkr or 0) for t in transactions if t.direction == "Money In")
    money_out_pkr = sum(float(t.amount_pkr or 0) for t in transactions if t.direction == "Money Out")
    expenses_pkr = sum(
        float(t.amount_pkr or 0)
        for t in transactions
        if t.direction == "Money Out" or (t.category or "").lower() == "expense"
    )
    platforms = platform_payout_summary(db)

    return {
        "summary": {
            "money_in_pkr": round(money_in_pkr, 2),
            "money_out_pkr": round(money_out_pkr, 2),
            "expenses_pkr": round(expenses_pkr, 2),
            "net_pkr": round(money_in_pkr - money_out_pkr, 2),
            "pending_platform_payout_usd": round(sum(p["pending_usd"] for p in platforms), 2),
            "accounts_count": len(accounts),
            "transactions_count": len(transactions),
        },
        "accounts": [accounting_account_response(account) for account in accounts],
        "platforms": platforms,
        "recent_transactions": [
            accounting_transaction_response(transaction)
            for transaction in transactions[:8]
        ],
    }


def sync_order_payout_accounting(db: Session, order: Order) -> AccountingTransaction | None:
    existing = (
        db.query(AccountingTransaction)
        .filter(
            AccountingTransaction.source_type == ACCOUNTING_ORDER_SOURCE,
            AccountingTransaction.source_id == order.id,
        )
        .first()
    )
    platform = platform_label(order.platform)
    received_amount = max(float(order.received_payout_usd or 0), 0)

    if not platform or received_amount <= 0:
        if existing:
            db.delete(existing)
        return None

    account = ensure_platform_account(db, platform)
    if not account:
        return None

    rate = float(order.exchange_rate or 0)
    amount_pkr = float(order.final_received_pkr or order.received_pkr or 0)
    if amount_pkr <= 0:
        amount_pkr = accounting_amount_pkr(
            amount=received_amount,
            currency="USD",
            exchange_rate=rate,
            amount_pkr=None,
        )

    transaction_date = order.payout_received_date or datetime.utcnow()
    description = f"Payout received for order {order.order_no}"
    if order.payout_notes:
        description = f"{description}. {order.payout_notes}"

    data = {
        "account_id": account.id,
        "direction": "Money In",
        "category": "Order Payout",
        "amount": received_amount,
        "currency": "USD",
        "exchange_rate": rate,
        "amount_pkr": amount_pkr or 0,
        "counterparty": customer_name(order.customer),
        "platform": platform,
        "reference": order.order_no,
        "source_type": ACCOUNTING_ORDER_SOURCE,
        "source_id": order.id,
        "description": description,
        "transaction_date": transaction_date,
    }

    if existing:
        for key, value in data.items():
            setattr(existing, key, value)
        db.add(existing)
        db.flush()
        return existing

    transaction = AccountingTransaction(**data)
    db.add(transaction)
    db.flush()
    return transaction


def remove_order_payout_accounting(db: Session, order_id: int) -> None:
    transactions = (
        db.query(AccountingTransaction)
        .filter(
            AccountingTransaction.source_type == ACCOUNTING_ORDER_SOURCE,
            AccountingTransaction.source_id == order_id,
        )
        .all()
    )
    for transaction in transactions:
        db.delete(transaction)


def validate_regular_bill_payload(payload: RegularBillCreate | RegularBillUpdate):
    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Bill name is required")
    if payload.amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")
    if payload.frequency not in VALID_BILL_FREQUENCIES:
        raise HTTPException(status_code=400, detail="Unsupported bill frequency")
    if payload.status not in VALID_BILL_STATUSES:
        raise HTTPException(status_code=400, detail="Unsupported bill status")
    if payload.reminder_days < 0:
        raise HTTPException(status_code=400, detail="Reminder days cannot be negative")

    return clean_name


def production_task_response(task: ProductionTask):
    remaining_quantity = task.assigned_quantity - task.completed_quantity

    progress_percent = 0
    if task.assigned_quantity > 0:
        progress_percent = round((task.completed_quantity / task.assigned_quantity) * 100, 1)

    timing_status = task.timing_status
    delay_minutes = task.delay_minutes
    if (
        task.status != "Completed"
        and task.expected_completion_time
        and datetime.utcnow() > task.expected_completion_time
    ):
        timing_status = "Late"
        delay_minutes = int(
            (datetime.utcnow() - task.expected_completion_time).total_seconds() / 60
        )

    return {
        "id": task.id,
        "batch_id": task.batch_id,
        "batch_no": task.batch.batch_no if task.batch else None,
        "source_type": task.batch.source_type if task.batch else "Workflow",
        "product_id": production_product_id(task),
        "article_no": production_article_no(task),
        "product_name": production_product_name(task),
        "product_image_url": production_product_image_url(task),
        "custom_product_name": task.custom_product_name,
        "custom_article_no": task.custom_article_no,
        "workflow_step_id": task.workflow_step_id,
        "step_order": task.step_order,
        "step_name": task.step_name,
        "worker_role": task.worker_role,
        "worker_id": task.worker_id,
        "worker_name": task.worker.name if task.worker else None,
        "assigned_quantity": task.assigned_quantity,
        "completed_quantity": task.completed_quantity,
        "remaining_quantity": remaining_quantity,
        "progress_percent": progress_percent,
        "rate_per_piece": task.rate_per_piece,
        "estimated_minutes_per_piece": task.estimated_minutes_per_piece,
        "estimated_total_minutes": task.estimated_total_minutes,
        "expected_completion_time": task.expected_completion_time,
        "actual_start_time": task.actual_start_time,
        "actual_completion_time": task.actual_completion_time,
        "status": task.status,
        "timing_status": timing_status,
        "delay_minutes": delay_minutes,
        "delay_reason": task.delay_reason,
        "labor_cost": task.labor_cost,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


def effective_batch_status(batch: ProductionBatch) -> str:
    tasks = list(batch.tasks)
    if tasks and all(task.status == "Completed" for task in tasks):
        return "Completed"
    if any(
        task.status == "In Progress" or task.completed_quantity > 0
        for task in tasks
    ):
        return "In Progress"
    return batch.status or "Pending"


def production_batch_response(batch: ProductionBatch):
    tasks = sorted(batch.tasks, key=lambda x: x.step_order)

    total_tasks = len(tasks)
    completed_tasks = len([t for t in tasks if t.status == "Completed"])
    total_assigned = sum(task.assigned_quantity or 0 for task in tasks)
    total_completed = sum(task.completed_quantity or 0 for task in tasks)
    progress_percent = (
        round((total_completed / total_assigned) * 100, 1)
        if total_assigned > 0
        else 0
    )

    current_task = None
    for task in tasks:
        if task.status != "Completed":
            current_task = task
            break

    now = datetime.utcnow()
    effective_status = effective_batch_status(batch)
    due_status = "No due date"
    if batch.due_date:
        if effective_status == "Completed":
            completed_at = batch.actual_completion or now
            due_status = "Late" if completed_at > batch.due_date else "On time"
        elif now > batch.due_date:
            due_status = "Overdue"
        elif batch.due_date.date() == now.date():
            due_status = "Due today"
        else:
            due_status = "Scheduled"

    return {
        "id": batch.id,
        "batch_no": batch.batch_no,
        "product_id": production_product_id(batch),
        "article_no": production_article_no(batch),
        "product_name": production_product_name(batch),
        "custom_product_name": batch.custom_product_name,
        "custom_article_no": batch.custom_article_no,
        "batch_quantity": batch.batch_quantity,
        "priority": batch.priority,
        "status": effective_status,
        "source_type": batch.source_type or "Workflow",
        "notes": batch.notes,
        "due_date": batch.due_date,
        "due_status": due_status,
        "expected_completion": batch.expected_completion,
        "actual_completion": batch.actual_completion,
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "unassigned_tasks": sum(
            1
            for task in tasks
            if task.status != "Completed" and task.worker_id is None
        ),
        "late_tasks": sum(
            1
            for task in tasks
            if task.status != "Completed"
            and (
                task.timing_status == "Late"
                or (
                    task.expected_completion_time is not None
                    and task.expected_completion_time < now
                )
            )
        ),
        "progress_percent": progress_percent,
        "current_step": current_task.step_name if current_task else "Completed",
        "current_task_id": current_task.id if current_task else None,
        "estimated_total_minutes": sum(
            task.estimated_total_minutes or 0 for task in tasks
        ),
        "estimated_labor_cost": sum(
            (task.assigned_quantity or 0) * (task.rate_per_piece or 0)
            for task in tasks
        ),
        "actual_labor_cost": sum(task.labor_cost or 0 for task in tasks),
        "created_at": batch.created_at,
        "updated_at": batch.updated_at,
        "tasks": [production_task_response(t) for t in tasks],
    }

# Dashboard
def amazon_dashboard_summary(db: Session, privacy: dict) -> dict:
    """Return PII-free Amazon operational totals for the admin dashboard."""
    if access_privacy_role(privacy) not in {"admin", "super_admin"}:
        return {"visible": False}

    account = db.query(AmazonAccount).order_by(AmazonAccount.id.asc()).first()
    if not account:
        return {
            "visible": True,
            "configured": False,
            "connection_status": "Not configured",
        }

    orders_query = db.query(AmazonOrder).filter(
        AmazonOrder.amazon_account_id == account.id,
        AmazonOrder.fulfillment_channel == "AMAZON",
    )
    open_statuses = {
        "PENDING_AVAILABILITY",
        "PENDING",
        "UNSHIPPED",
        "PARTIALLY_SHIPPED",
        "UNFULFILLABLE",
    }
    status_counts = {
        str(status or "").strip().upper(): int(count or 0)
        for status, count in (
            orders_query.with_entities(
                AmazonOrder.order_status,
                func.count(AmazonOrder.id),
            )
            .group_by(AmazonOrder.order_status)
            .all()
        )
    }
    today_utc = datetime.combine(datetime.utcnow().date(), datetime.min.time())
    order_count = sum(status_counts.values())
    open_order_count = sum(
        status_counts.get(status, 0) for status in open_statuses
    )
    orders_today = orders_query.filter(
        AmazonOrder.purchase_date >= today_utc
    ).count()
    orders_with_issues = orders_query.filter(
        or_(
            AmazonOrder.unmapped_item_count > 0,
            AmazonOrder.last_error.is_not(None),
        )
    ).count()
    unmapped_items = int(
        orders_query.with_entities(
            func.coalesce(func.sum(AmazonOrder.unmapped_item_count), 0)
        ).scalar()
        or 0
    )

    (
        fulfillable_units,
        reserved_units,
        unfulfillable_units,
        inbound_inventory_units,
    ) = (
        db.query(
            func.coalesce(func.sum(AmazonFbaInventory.fulfillable_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInventory.reserved_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInventory.unfulfillable_quantity), 0),
            func.coalesce(
                func.sum(
                    AmazonFbaInventory.inbound_working_quantity
                    + AmazonFbaInventory.inbound_shipped_quantity
                    + AmazonFbaInventory.inbound_receiving_quantity
                ),
                0,
            ),
        )
        .filter(AmazonFbaInventory.amazon_account_id == account.id)
        .one()
    )
    (
        planned_inbound,
        shipped_inbound,
        received_inbound,
        missing_inbound,
        damaged_inbound,
        discrepancy_inbound,
    ) = (
        db.query(
            func.coalesce(func.sum(AmazonFbaInboundPlan.planned_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInboundPlan.shipped_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInboundPlan.received_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInboundPlan.missing_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInboundPlan.damaged_quantity), 0),
            func.coalesce(func.sum(AmazonFbaInboundPlan.discrepancy_quantity), 0),
        )
        .filter(AmazonFbaInboundPlan.amazon_account_id == account.id)
        .one()
    )
    inbound_in_transit = max(
        0,
        int(shipped_inbound or 0)
        - int(received_inbound or 0)
        - int(missing_inbound or 0)
        - int(damaged_inbound or 0),
    )
    last_order_sync = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type == JOB_TYPE_FBA_ORDERS_SYNC,
        )
        .order_by(AmazonSyncJob.id.desc())
        .first()
    )
    last_finance_sync = (
        db.query(AmazonSyncJob)
        .filter(
            AmazonSyncJob.amazon_account_id == account.id,
            AmazonSyncJob.job_type == JOB_TYPE_FINANCES_SYNC,
        )
        .order_by(AmazonSyncJob.id.desc())
        .first()
    )
    (
        amazon_product_revenue,
        amazon_shipping_revenue,
        amazon_referral_fees,
        amazon_fba_fees,
        amazon_storage_fees,
        amazon_advertising_fees,
        amazon_other_fees,
        amazon_refunds,
        amazon_reimbursements,
    ) = (
        db.query(
            func.coalesce(
                func.sum(AmazonFinancialTransaction.product_revenue),
                0,
            ),
            func.coalesce(
                func.sum(AmazonFinancialTransaction.shipping_revenue),
                0,
            ),
            func.coalesce(
                func.sum(AmazonFinancialTransaction.referral_fee),
                0,
            ),
            func.coalesce(func.sum(AmazonFinancialTransaction.fba_fee), 0),
            func.coalesce(func.sum(AmazonFinancialTransaction.storage_fee), 0),
            func.coalesce(
                func.sum(AmazonFinancialTransaction.advertising_charge),
                0,
            ),
            func.coalesce(func.sum(AmazonFinancialTransaction.other_fee), 0),
            func.coalesce(func.sum(AmazonFinancialTransaction.refund_amount), 0),
            func.coalesce(
                func.sum(AmazonFinancialTransaction.reimbursement_amount),
                0,
            ),
        )
        .filter(AmazonFinancialTransaction.amazon_account_id == account.id)
        .one()
    )
    expected_settlement = float(
        db.query(
            func.coalesce(func.sum(AmazonSettlement.expected_amount), 0)
        )
        .filter(
            AmazonSettlement.amazon_account_id == account.id,
            AmazonSettlement.settlement_status == "Expected",
        )
        .scalar()
        or 0
    )
    settlement_differences = db.query(AmazonSettlement).filter(
        AmazonSettlement.amazon_account_id == account.id,
        AmazonSettlement.settlement_status == "Difference",
    ).count()
    failed_sync_jobs = db.query(AmazonSyncJob).filter(
        AmazonSyncJob.amazon_account_id == account.id,
        AmazonSyncJob.status == "Failed",
    ).count()
    listing_errors = db.query(AmazonProductMapping).filter(
        AmazonProductMapping.amazon_account_id == account.id,
        or_(
            AmazonProductMapping.last_error.is_not(None),
            func.length(
                func.trim(
                    func.coalesce(
                        AmazonProductMapping.listing_issues_json,
                        "",
                    )
                )
            )
            > 2,
        ),
    ).count()
    low_fba_stock_skus = db.query(AmazonFbaInventory).filter(
        AmazonFbaInventory.amazon_account_id == account.id,
        AmazonFbaInventory.fulfillable_quantity
        <= AmazonFbaInventory.minimum_fba_quantity,
    ).count()

    return {
        "visible": True,
        "configured": True,
        "connection_status": account.connection_status,
        "order_count": order_count,
        "open_order_count": open_order_count,
        "orders_today": orders_today,
        "pending_order_count": (
            status_counts.get("PENDING", 0)
            + status_counts.get("PENDING_AVAILABILITY", 0)
        ),
        "unshipped_order_count": status_counts.get("UNSHIPPED", 0),
        "partially_shipped_order_count": status_counts.get(
            "PARTIALLY_SHIPPED", 0
        ),
        "shipped_order_count": status_counts.get("SHIPPED", 0),
        "cancelled_order_count": status_counts.get("CANCELLED", 0),
        "orders_with_issues": orders_with_issues,
        "unmapped_item_count": unmapped_items,
        "fulfillable_units": int(fulfillable_units or 0),
        "reserved_units": int(reserved_units or 0),
        "unfulfillable_units": int(unfulfillable_units or 0),
        "inbound_inventory_units": int(inbound_inventory_units or 0),
        "planned_inbound_units": int(planned_inbound or 0),
        "in_transit_units": inbound_in_transit,
        "received_inbound_units": int(received_inbound or 0),
        "inbound_discrepancy_units": int(discrepancy_inbound or 0),
        "financial_transaction_count": db.query(
            AmazonFinancialTransaction
        ).filter(
            AmazonFinancialTransaction.amazon_account_id == account.id
        ).count(),
        "fba_revenue": round(
            float(amazon_product_revenue or 0)
            + float(amazon_shipping_revenue or 0),
            2,
        ),
        "amazon_fees": round(
            float(amazon_referral_fees or 0)
            + float(amazon_fba_fees or 0)
            + float(amazon_storage_fees or 0)
            + float(amazon_advertising_fees or 0)
            + float(amazon_other_fees or 0),
            2,
        ),
        "refund_amount": round(float(amazon_refunds or 0), 2),
        "reimbursement_amount": round(float(amazon_reimbursements or 0), 2),
        "expected_settlement": round(expected_settlement, 2),
        "settlement_difference_count": settlement_differences,
        "failed_sync_job_count": failed_sync_jobs,
        "listing_error_count": listing_errors,
        "low_fba_stock_sku_count": low_fba_stock_skus,
        "currency": account.currency,
        "last_order_sync_at": (
            last_order_sync.completed_at
            or last_order_sync.started_at
            or last_order_sync.created_at
            if last_order_sync
            else None
        ),
        "last_order_sync_status": (
            last_order_sync.status if last_order_sync else "Never"
        ),
        "last_finance_sync_at": (
            last_finance_sync.completed_at
            or last_finance_sync.started_at
            or last_finance_sync.created_at
            if last_finance_sync
            else None
        ),
        "last_finance_sync_status": (
            last_finance_sync.status if last_finance_sync else "Never"
        ),
    }


@app.get("/dashboard-stats")
def dashboard_stats(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    privacy = access_privacy_context(request, db)
    now = datetime.now()
    today = now.date()

    products = db.query(Product).all()
    orders = db.query(Order).all()
    workflow_steps = db.query(WorkflowStep).all()
    workers = db.query(Worker).all()
    shipping_records = db.query(Shipping).all()
    regular_bills = db.query(RegularBill).all()
    dashboard_amazon_account = (
        db.query(AmazonAccount).order_by(AmazonAccount.id.asc()).first()
    )
    amazon_orders = (
        db.query(AmazonOrder)
        .filter(AmazonOrder.amazon_account_id == dashboard_amazon_account.id)
        .all()
        if dashboard_amazon_account
        else []
    )

    production_batches = db.query(ProductionBatch).all()
    production_tasks = db.query(ProductionTask).all()
    production_batch_statuses = [
        effective_batch_status(batch) for batch in production_batches
    ]

    total_factory_stock = sum(p.factory_stock for p in products)
    total_usa_stock = sum(p.usa_stock for p in products)
    total_front_room_stock = sum((p.front_room_stock or 0) for p in products)
    total_reserved_stock = sum(p.reserved_stock for p in products)

    low_stock_count = sum(
        1 for p in products
        if (
            (p.factory_stock or 0)
            + (p.usa_stock or 0)
            + (p.front_room_stock or 0)
            - (p.reserved_stock or 0)
        ) <= p.low_stock_alert
    )

    new_orders_today = sum(
        1 for o in orders
        if o.order_date and o.order_date.date() == today
    )

    pending_shipping_orders = sum(
        1 for o in orders
        if not is_stock_deducted_shipping_status(o.shipping_status)
    )

    shipped_orders = sum(
        1 for o in orders
        if is_stock_deducted_shipping_status(o.shipping_status)
    )

    shipping_cost_pending = sum(
        1 for s in shipping_records
        if s.shipping_cost is None or s.shipping_cost == 0
    )

    regular_bill_alerts = []
    for bill in regular_bills:
        due_status, days_until_due = regular_bill_due_status(bill, now)
        if bill.status == "Active" and days_until_due is not None and days_until_due <= (bill.reminder_days or 0):
            regular_bill_alerts.append({
                "id": bill.id,
                "name": bill.name,
                "category": bill.category,
                "vendor": bill.vendor,
                "amount": bill.amount,
                "currency": bill.currency,
                "frequency": bill.frequency,
                "next_due_date": bill.next_due_date,
                "days_until_due": days_until_due,
                "due_status": due_status,
                "payment_method": bill.payment_method,
            })

    regular_bill_alert_count = len(regular_bill_alerts)
    overdue_regular_bills_count = sum(
        1 for bill in regular_bill_alerts if bill["days_until_due"] < 0
    )
    regular_bills_due_amount = sum(
        bill["amount"] or 0 for bill in regular_bill_alerts
    )
    regular_bill_alerts = sorted(
        regular_bill_alerts,
        key=lambda item: item["days_until_due"],
    )[:6]

    manufacturing_required_items = sum(
        1 for o in orders for i in o.items
        if i.manufacturing_required
    )

    if now.hour < 12:
        greeting = "Good Morning"
    elif now.hour < 17:
        greeting = "Good Afternoon"
    else:
        greeting = "Good Evening"

    week_start = today - timedelta(days=7)
    sales_start = today - timedelta(days=6)
    fourteen_days_start = today - timedelta(days=13)
    sales_14_days_total = 0.0
    sales_last_7_days = {
        sales_start + timedelta(days=offset): {
            "order_count": 0,
            "sales_amount": 0.0,
            "erp_order_count": 0,
            "amazon_order_count": 0,
            "erp_sales_amount": 0.0,
            "amazon_sales_amount": 0.0,
            "platform_sales": {},
        }
        for offset in range(7)
    }
    dashboard_amazon_orders = [
        order
        for order in amazon_orders
        if str(order.currency or "USD").strip().upper() == "USD"
        and str(order.order_status or "").strip().lower()
        not in {"cancelled", "canceled"}
    ]
    amazon_linked_erp_order_ids = {
        int(order.erp_sales_order_id)
        for order in dashboard_amazon_orders
        if order.erp_sales_order_id is not None
    }
    amazon_order_numbers = {
        str(order.amazon_order_id or "").strip().lower()
        for order in dashboard_amazon_orders
        if str(order.amazon_order_id or "").strip()
    }
    product_by_id = {product.id: product for product in products}
    product_by_sku = {
        str(product.article_no or "").strip().casefold(): product
        for product in products
        if str(product.article_no or "").strip()
    }
    amazon_mappings = (
        db.query(AmazonProductMapping)
        .filter(AmazonProductMapping.amazon_account_id == dashboard_amazon_account.id)
        .all()
        if dashboard_amazon_account
        else []
    )
    amazon_mapping_by_id = {mapping.id: mapping for mapping in amazon_mappings}
    dashboard_amazon_order_ids = {
        order.id
        for order in dashboard_amazon_orders
        if order.purchase_date
        and order.purchase_date.date() in sales_last_7_days
    }
    amazon_items_by_order_id = {}
    if dashboard_amazon_order_ids:
        for item in (
            db.query(AmazonOrderItem)
            .filter(
                AmazonOrderItem.amazon_order_database_id.in_(
                    dashboard_amazon_order_ids
                )
            )
            .all()
        ):
            amazon_items_by_order_id.setdefault(
                item.amazon_order_database_id,
                [],
            ).append(item)

    top_selling_products = {}

    def record_top_selling_product(
        *,
        product,
        fallback_sku,
        fallback_name,
        fallback_image_url,
        quantity,
        sales_amount,
        platform,
    ):
        clean_quantity = max(int(quantity or 0), 0)
        if clean_quantity <= 0:
            return
        clean_sku = str(
            product.article_no if product else fallback_sku or "Unmapped"
        ).strip() or "Unmapped"
        product_key = (
            f"product:{product.id}"
            if product
            else f"sku:{clean_sku.casefold()}"
        )
        entry = top_selling_products.setdefault(
            product_key,
            {
                "product_id": product.id if product else None,
                "article_no": clean_sku,
                "product_name": (
                    str(product.name or "").strip()
                    if product
                    else str(fallback_name or clean_sku).strip()
                ),
                "image_url": (
                    str(product.image_url or "").strip()
                    if product
                    else str(fallback_image_url or "").strip()
                ),
                "units_sold": 0,
                "sales_amount": 0.0,
                "platforms": set(),
            },
        )
        entry["units_sold"] += clean_quantity
        entry["sales_amount"] += max(float(sales_amount or 0), 0)
        entry["platforms"].add(str(platform or "ERP").strip() or "ERP")

    pending_shipping_list = []
    recent_week_orders = []
    weekly_payout_received = 0.0
    weekly_pending_payouts = 0

    for order in orders:
        order_day = order.order_date.date() if order.order_date else None
        order_status = str(order.status or "").strip().lower()
        is_linked_amazon_order = (
            order.id in amazon_linked_erp_order_ids
            or str(order.order_no or "").strip().lower() in amazon_order_numbers
        )
        if order_status not in {"cancelled", "canceled"} and not is_linked_amazon_order:
            order_sales_usd = max(
                float(order.order_total_usd or order.total_amount or 0),
                0,
            )
            if order_day and order_day >= fourteen_days_start:
                sales_14_days_total += order_sales_usd

            if order_day in sales_last_7_days:
                sales_last_7_days[order_day]["order_count"] += 1
                sales_last_7_days[order_day]["erp_order_count"] += 1
                sales_last_7_days[order_day]["sales_amount"] += order_sales_usd
                sales_last_7_days[order_day]["erp_sales_amount"] += order_sales_usd
                platform_label = str(order.platform or "ERP").strip() or "ERP"
                platform_key = platform_label.casefold()
                platform_sales = sales_last_7_days[order_day]["platform_sales"]
                platform_entry = platform_sales.setdefault(
                    platform_key,
                    {
                        "platform": platform_label,
                        "order_count": 0,
                        "sales_amount": 0.0,
                    },
                )
                platform_entry["order_count"] += 1
                platform_entry["sales_amount"] += order_sales_usd
                for item in order.items:
                    item_quantity = max(int(item.quantity or 0), 0)
                    item_sales = max(
                        float(
                            item.line_total
                            or item_quantity * float(item.unit_price or 0)
                        ),
                        0,
                    )
                    record_top_selling_product(
                        product=item.product,
                        fallback_sku=None,
                        fallback_name=None,
                        fallback_image_url=None,
                        quantity=item_quantity,
                        sales_amount=item_sales,
                        platform=platform_label,
                    )

        if not is_stock_deducted_shipping_status(order.shipping_status):
            customer_label, _customer_company_label = privacy_order_customer_labels(
                order,
                order.customer,
                is_unassigned_import_customer(order.customer),
                privacy,
                "Shipping",
            )
            pending_shipping_list.append({
                "order_id": order.id,
                "order_no": order.order_no,
                "customer_name": customer_label,
                "platform": order.platform,
                "total_amount": order.total_amount,
                "shipping_status": order.shipping_status,
            })

        if order.order_date and order.order_date.date() >= sales_start:
            customer_label, _customer_company_label = privacy_order_customer_labels(
                order,
                order.customer,
                is_unassigned_import_customer(order.customer),
                privacy,
            )
            recent_week_orders.append({
                "order_id": order.id,
                "order_no": order.order_no,
                "customer_name": customer_label,
                "platform": order.platform,
                "order_date": order.order_date,
                "total_amount": order.total_amount,
                "total_amount_usd": order.order_total_usd or 0,
                "remaining_payout_usd": order.remaining_payout_usd or 0,
                "status": order.status,
                "payout_status": order.payout_status,
            })

        if order.payout_received_date and order.payout_received_date.date() >= week_start:
            weekly_payout_received += order.received_payout_usd or 0

        if (order.remaining_payout_usd or 0) > 0 and (
            (order.order_date and order.order_date.date() >= week_start)
            or (order.expected_payout_date and order.expected_payout_date.date() >= week_start)
        ):
            weekly_pending_payouts += 1

    for amazon_order in dashboard_amazon_orders:
        order_day = (
            amazon_order.purchase_date.date()
            if amazon_order.purchase_date
            else None
        )
        amazon_sales_usd = max(
            float(amazon_order.order_total or 0),
            0,
        )
        if order_day and order_day >= fourteen_days_start:
            sales_14_days_total += amazon_sales_usd

        if order_day not in sales_last_7_days:
            continue
        sales_last_7_days[order_day]["order_count"] += 1
        sales_last_7_days[order_day]["amazon_order_count"] += 1
        sales_last_7_days[order_day]["sales_amount"] += amazon_sales_usd
        sales_last_7_days[order_day]["amazon_sales_amount"] += amazon_sales_usd
        platform_sales = sales_last_7_days[order_day]["platform_sales"]
        platform_entry = platform_sales.setdefault(
            "amazon",
            {
                "platform": "Amazon",
                "order_count": 0,
                "sales_amount": 0.0,
            },
        )
        platform_entry["order_count"] += 1
        platform_entry["sales_amount"] += amazon_sales_usd
        for item in amazon_items_by_order_id.get(amazon_order.id, []):
            mapping = amazon_mapping_by_id.get(item.product_mapping_id)
            mapped_product_id = item.product_id or (
                mapping.product_id if mapping else None
            )
            product = product_by_id.get(mapped_product_id)
            if not product:
                product = product_by_sku.get(
                    str(item.seller_sku or "").strip().casefold()
                )
            item_quantity = max(int(item.quantity_ordered or 0), 0)
            item_sales = max(
                float(
                    item.item_price
                    or item_quantity * float(item.unit_price or 0)
                ),
                0,
            )
            record_top_selling_product(
                product=product,
                fallback_sku=item.seller_sku,
                fallback_name=item.title,
                fallback_image_url=(
                    mapping.amazon_image_url if mapping else None
                ),
                quantity=item_quantity,
                sales_amount=item_sales,
                platform="Amazon",
            )

    top_selling_product_rows = [
        {
            "product_id": item["product_id"],
            "article_no": item["article_no"],
            "product_name": item["product_name"],
            "image_url": item["image_url"],
            "units_sold": item["units_sold"],
            "sales_amount": round(item["sales_amount"], 2),
            "platforms": sorted(item["platforms"]),
        }
        for item in sorted(
            top_selling_products.values(),
            key=lambda item: (
                item["units_sold"],
                item["sales_amount"],
            ),
            reverse=True,
        )[:6]
    ]

    active_production_tasks = []
    tasks_completing_today = []
    late_production_tasks = []
    todo_tasks = []
    today_tasks = []
    weekly_completed_tasks = 0
    weekly_assigned_tasks = 0

    for task in production_tasks:
        task_source_type = task.batch.source_type if task.batch else "Workflow"
        task_is_today = (
            task.status != "Completed"
            and (
                (task.expected_completion_time and task.expected_completion_time.date() == today)
                or (task.created_at and task.created_at.date() == today)
            )
        )

        if task.status in ["Ready", "In Progress"]:
            active_production_tasks.append({
                "task_id": task.id,
                "batch_no": task.batch.batch_no if task.batch else "",
                "source_type": task_source_type,
                "product_name": production_product_name(task),
                "article_no": production_article_no(task),
                "product_image_url": production_product_image_url(task),
                "step_name": task.step_name,
                "worker_id": task.worker_id,
                "worker_name": task.worker.name if task.worker else "Not assigned",
                "worker_role": task.worker_role,
                "status": task.status,
                "assigned_quantity": task.assigned_quantity,
                "completed_quantity": task.completed_quantity,
                "remaining_quantity": task.assigned_quantity - task.completed_quantity,
                "progress_percent": round((task.completed_quantity / task.assigned_quantity) * 100, 1)
                if task.assigned_quantity > 0 else 0,
                "expected_completion_time": task.expected_completion_time,
                "timing_status": task.timing_status,
            })

        if (
            task.expected_completion_time
            and task.expected_completion_time.date() == today
            and task.status != "Completed"
        ):
            tasks_completing_today.append({
                "task_id": task.id,
                "batch_no": task.batch.batch_no if task.batch else "",
                "source_type": task_source_type,
                "step_name": task.step_name,
                "worker_id": task.worker_id,
                "worker_name": task.worker.name if task.worker else "Not assigned",
                "expected_completion_time": task.expected_completion_time,
                "status": task.status,
            })

        if task_is_today:
            today_tasks.append({
                "task_id": task.id,
                "batch_no": task.batch.batch_no if task.batch else "",
                "source_type": task_source_type,
                "product_name": production_product_name(task),
                "article_no": production_article_no(task),
                "product_image_url": production_product_image_url(task),
                "step_name": task.step_name,
                "worker_id": task.worker_id,
                "worker_name": task.worker.name if task.worker else "Not assigned",
                "status": task.status,
                "assigned_quantity": task.assigned_quantity,
                "completed_quantity": task.completed_quantity,
                "remaining_quantity": task.assigned_quantity - task.completed_quantity,
                "expected_completion_time": task.expected_completion_time,
                "timing_status": task.timing_status,
            })

        if task.timing_status == "Late":
            late_production_tasks.append({
                "task_id": task.id,
                "batch_no": task.batch.batch_no if task.batch else "",
                "source_type": task_source_type,
                "step_name": task.step_name,
                "worker_id": task.worker_id,
                "worker_name": task.worker.name if task.worker else "Not assigned",
                "delay_minutes": task.delay_minutes,
                "delay_reason": task.delay_reason,
            })

        if task.status == "Completed" and task.actual_completion_time and task.actual_completion_time.date() >= week_start:
            weekly_completed_tasks += 1

        if task.created_at and task.created_at.date() >= week_start:
            weekly_assigned_tasks += 1

        if task.status != "Completed" and (
            (task.expected_completion_time and task.expected_completion_time.date() >= week_start)
            or (task.created_at and task.created_at.date() >= week_start)
        ):
            todo_tasks.append({
                "task_id": task.id,
                "batch_no": task.batch.batch_no if task.batch else "",
                "source_type": task_source_type,
                "product_name": production_product_name(task),
                "article_no": production_article_no(task),
                "product_image_url": production_product_image_url(task),
                "step_name": task.step_name,
                "worker_id": task.worker_id,
                "worker_name": task.worker.name if task.worker else "Not assigned",
                "status": task.status,
                "remaining_quantity": task.assigned_quantity - task.completed_quantity,
                "expected_completion_time": task.expected_completion_time,
                "timing_status": task.timing_status,
            })

    todo_tasks = sorted(
        todo_tasks,
        key=lambda item: item["expected_completion_time"] or now,
        reverse=False,
    )[:8]

    recent_week_orders = sorted(
        recent_week_orders,
        key=lambda item: item["order_date"],
        reverse=True,
    )[:6]

    worker_overview = []
    for worker in workers:
        worker_active_task = None

        for task in production_tasks:
            if task.worker_id == worker.id and task.status in ["Ready", "In Progress"]:
                worker_active_task = task
                break

        worker_overview.append({
            "worker_id": worker.id,
            "worker_name": worker.name,
            "role": worker.role,
            "active": worker.is_active,
            "current_task": worker_active_task.step_name if worker_active_task else "No active task",
            "batch_no": worker_active_task.batch.batch_no if worker_active_task and worker_active_task.batch else "",
            "task_status": worker_active_task.status if worker_active_task else "",
        })

    return {
        "company_name": "Hisbenew Industries",
        "greeting": greeting,

        "total_products": len(products),
        "total_orders": len(orders),
        "new_orders_today": new_orders_today,

        "total_workers": len(workers),
        "active_workers": sum(1 for w in workers if w.is_active),
        "inactive_workers": sum(1 for w in workers if not w.is_active),

        "total_factory_stock": total_factory_stock,
        "total_usa_stock": total_usa_stock,
        "total_front_room_stock": total_front_room_stock,
        "total_reserved_stock": total_reserved_stock,

        "low_stock_count": low_stock_count,
        "workflow_steps": len(workflow_steps),

        "manufacturing_required_items": manufacturing_required_items,

        "pending_shipping_orders": pending_shipping_orders,
        "shipped_orders": shipped_orders,
 "shipping_cost_pending": shipping_cost_pending,
        "upcoming_regular_bills": regular_bill_alerts,
        "upcoming_regular_bills_count": regular_bill_alert_count,
        "overdue_regular_bills_count": overdue_regular_bills_count,
        "regular_bills_due_amount": regular_bills_due_amount,

        "production_total_batches": len(production_batches),
        "production_pending_batches": production_batch_statuses.count("Pending"),
        "production_in_progress_batches": production_batch_statuses.count("In Progress"),
        "production_completed_batches": production_batch_statuses.count("Completed"),

        "production_total_tasks": len(production_tasks),
        "production_ready_tasks": sum(1 for t in production_tasks if t.status == "Ready"),
        "production_in_progress_tasks": sum(1 for t in production_tasks if t.status == "In Progress"),
        "production_completed_tasks": sum(1 for t in production_tasks if t.status == "Completed"),
        "production_late_tasks": len(late_production_tasks),
        "production_completing_today": len(tasks_completing_today),

        "weekly_payout_received": weekly_payout_received,
        "weekly_completed_tasks": weekly_completed_tasks,
        "weekly_pending_payouts": weekly_pending_payouts,
        "weekly_assigned_tasks": weekly_assigned_tasks,
        "sales_14_days_total": round(sales_14_days_total, 2),
        "sales_last_7_days": [
            {
                "date": sales_day.isoformat(),
                "order_count": values["order_count"],
                "sales_amount": round(values["sales_amount"], 2),
                "erp_order_count": values["erp_order_count"],
                "amazon_order_count": values["amazon_order_count"],
                "erp_sales_amount": round(values["erp_sales_amount"], 2),
                "amazon_sales_amount": round(values["amazon_sales_amount"], 2),
                "platform_sales": [
                    {
                        "platform": platform["platform"],
                        "order_count": platform["order_count"],
                        "sales_amount": round(platform["sales_amount"], 2),
                    }
                    for platform in sorted(
                        values["platform_sales"].values(),
                        key=lambda item: item["sales_amount"],
                        reverse=True,
                    )
                    if platform["sales_amount"] > 0
                ],
            }
            for sales_day, values in sales_last_7_days.items()
        ],
        "top_selling_products_7_days": top_selling_product_rows,
        "recent_week_orders": sorted(
            recent_week_orders,
            key=lambda item: item["order_date"] or datetime.min,
            reverse=True,
        ),
        "todo_tasks": todo_tasks,
        "today_tasks": sorted(
            today_tasks,
            key=lambda item: item["expected_completion_time"] or now,
        )[:12],

        "pending_shipping_list": pending_shipping_list[:8],
        "worker_overview": worker_overview[:8],
        "active_production_tasks": active_production_tasks[:8],
        "tasks_completing_today": tasks_completing_today[:8],
        "late_production_tasks": late_production_tasks[:8],
        "amazon": amazon_dashboard_summary(db, privacy),
    }

# Products API
@app.get("/products", response_model=list[ProductOut])
def get_products(db: Session = Depends(get_db)):
    return [product_response(p) for p in db.query(Product).order_by(Product.category, Product.article_no).all()]


def require_local_printer_bridge(request: Request) -> None:
    client_host = request.client.host if request.client else ""
    normalized_host = str(client_host or "").strip().lower().strip("[]")
    if normalized_host == "localhost":
        return

    try:
        if ip_address(normalized_host).is_loopback:
            return
    except ValueError:
        pass

    raise HTTPException(
        status_code=403,
        detail="Local printer bridge commands are only accepted from this computer.",
    )


@app.get("/label-printers")
def get_label_printers():
    try:
        return list_label_printers()
    except LabelPrintError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/label-printers/print")
def print_labels_directly(payload: dict):
    try:
        return print_tspl_labels(
            labels=payload.get("labels") or [],
            size=payload.get("size") or {},
            printer_name=payload.get("printer_name"),
        )
    except LabelPrintError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/local-label-printers")
def get_local_label_printers(request: Request):
    require_local_printer_bridge(request)
    try:
        data = list_label_printers()
        data["connection_scope"] = "this_laptop"
        return data
    except LabelPrintError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/local-label-printers/print")
def print_local_labels_directly(payload: dict, request: Request):
    require_local_printer_bridge(request)
    try:
        return print_tspl_labels(
            labels=payload.get("labels") or [],
            size=payload.get("size") or {},
            printer_name=payload.get("printer_name"),
        )
    except LabelPrintError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def run_faire_product_import(content: bytes) -> dict:
    import_db = SessionLocal()
    try:
        return import_faire_workbook(import_db, content, UPLOAD_DIR)
    finally:
        import_db.close()


@app.post("/products/import-faire")
async def import_faire_product_catalog(file: UploadFile = File(...)):
    filename = sanitize_upload_filename(file.filename or "faire-products.xlsx")
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload a Faire .xlsx export file.")

    content = await file.read(MAX_FAIRE_WORKBOOK_BYTES + 1)
    if len(content) > MAX_FAIRE_WORKBOOK_BYTES:
        raise HTTPException(status_code=400, detail="The Faire workbook is larger than 30 MB.")
    try:
        return await asyncio.to_thread(run_faire_product_import, content)
    except ProductCatalogError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="The Faire catalog could not be imported.") from exc


def product_catalog_pdf_response(db: Session, product_ids: list[int] | None = None) -> Response:
    query = db.query(Product)
    if product_ids is not None:
        query = query.filter(Product.id.in_(product_ids))
    products = query.order_by(Product.category, Product.name, Product.article_no).all()
    try:
        pdf_content = build_product_catalog_pdf(products, UPLOAD_DIR)
    except ProductCatalogError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="The product catalog could not be generated.") from exc

    filename = f"hisbenew-wholesale-catalog-{datetime.now():%Y-%m-%d}.pdf"
    return Response(
        content=pdf_content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.get("/products/catalog.pdf")
def download_product_catalog(db: Session = Depends(get_db)):
    return product_catalog_pdf_response(db)


@app.post("/products/catalog-download")
def create_product_catalog_download(
    request: Request,
    payload: dict | None = None,
    db: Session = Depends(get_db),
):
    user = require_page_access(request, db, "Products")
    requested_ids = (payload or {}).get("product_ids")
    if not isinstance(requested_ids, list) or not requested_ids:
        raise HTTPException(status_code=400, detail="Select at least one product for the catalog.")
    product_ids = sorted({int(value) for value in requested_ids})
    existing_ids = {
        value for (value,) in db.query(Product.id).filter(Product.id.in_(product_ids)).all()
    }
    if len(existing_ids) != len(product_ids):
        raise HTTPException(status_code=400, detail="One or more selected products no longer exist.")
    token = create_catalog_download_token(user.id, product_ids=product_ids)
    return {
        "download_url": f"/products/catalog-download-file?token={token}",
        "expires_in_seconds": CATALOG_DOWNLOAD_TOKEN_TTL_SECONDS,
    }


@app.get("/products/catalog-download-file")
def download_product_catalog_file(
    token: str = Query(..., min_length=20),
    db: Session = Depends(get_db),
):
    try:
        user_id, product_ids = decode_catalog_download_token(token)
    except ProductCatalogError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = (
        db.query(User)
        .execution_options(skip_tenant_scope=True)
        .filter(User.id == user_id, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="The catalog download link is no longer valid.")
    db.info["tenant_id"] = user.tenant_id or get_default_tenant(db).id
    try:
        stored_pages = json.loads(user.allowed_pages) if user.allowed_pages else None
    except (TypeError, json.JSONDecodeError):
        stored_pages = None
    if "Products" not in tenant_filtered_allowed_pages(
        db,
        user.tenant_id,
        normalize_allowed_pages(user.role, stored_pages),
    ):
        raise HTTPException(status_code=403, detail="Products access is required.")
    return product_catalog_pdf_response(db, product_ids=product_ids)

@app.put("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    article_no: str = Form(...),
    name: str = Form(...),
    category: str = Form(None),
    options: str = Form(None),
    notes: str = Form(None),
    factory_stock: int | None = Form(None),
    usa_stock: int | None = Form(None),
    front_room_stock: int | None = Form(None),
    reserved_stock: int | None = Form(None),
    cost_price: float = Form(...),
    selling_price: float = Form(...),
    unit_weight_kg: float | None = Form(None),
    low_stock_alert: int = Form(...),
    workflow_required: bool = Form(...),
    image: UploadFile = File(None),
    share_image_file: UploadFile = File(None),
    label_file: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if unit_weight_kg is not None and unit_weight_kg < 0:
        raise HTTPException(status_code=400, detail="Unit shipping weight cannot be negative")

    # Check for duplicate article_no (only if article_no changed)
    if article_no != product.article_no:
        if db.query(Product).filter(Product.article_no == article_no).first():
            raise HTTPException(status_code=400, detail="Product article number already exists")

    # Handle image upload
    if image:
        product.image_url = save_uploaded_file(image)

    # Handle share image upload
    if share_image_file:
        product.share_image_url = save_uploaded_file(share_image_file)

    # Handle label upload
    if label_file:
        product.label_url = save_uploaded_file(label_file)

    old_stock = {
        "factory_stock": int(product.factory_stock or 0),
        "usa_stock": int(product.usa_stock or 0),
        "front_room_stock": int(product.front_room_stock or 0),
        "reserved_stock": int(product.reserved_stock or 0),
    }

    # Update product fields. Stock fields are optional so a metadata edit cannot
    # overwrite a newer inventory adjustment made elsewhere in the ERP.
    product.article_no = article_no
    product.name = name
    product.category = category
    product.options = (options or "").strip() or None
    product.notes = (notes or "").strip() or None
    requested_stock = {
        "factory_stock": factory_stock,
        "usa_stock": usa_stock,
        "front_room_stock": front_room_stock,
        "reserved_stock": reserved_stock,
    }
    for stock_field, next_value in requested_stock.items():
        if next_value is None:
            continue
        if next_value < 0:
            raise HTTPException(status_code=400, detail=f"{STOCK_FIELD_LABELS[stock_field]} cannot be negative")
        setattr(product, stock_field, next_value)
    product.cost_price = cost_price
    product.selling_price = selling_price
    if unit_weight_kg is not None:
        product.unit_weight_kg = unit_weight_kg
    product.low_stock_alert = low_stock_alert
    product.workflow_required = workflow_required

    for stock_field, next_value in requested_stock.items():
        if next_value is None or next_value == old_stock[stock_field]:
            continue
        db.add(StockMovement(
            product_id=product.id,
            movement_type="Manual Update",
            quantity=next_value - old_stock[stock_field],
            stock_type=stock_field,
            source="Products",
            reference=product.article_no,
            note=(
                f"{STOCK_FIELD_LABELS[stock_field]} adjusted from "
                f"{old_stock[stock_field]} to {next_value} from the product editor."
            ),
            created_at=datetime.utcnow(),
        ))

    db.add(product)
    db.commit()
    db.refresh(product)
    return product_response(product)

@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Check if product is used in any orders
    order_items = db.query(OrderItem).filter(OrderItem.product_id == product_id).all()
    if order_items:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete product: it is used in one or more orders"
        )

    # Check if product has workflow steps
    workflow_steps = db.query(WorkflowStep).filter(WorkflowStep.product_id == product_id).all()
    if workflow_steps:
        for step in workflow_steps:
            db.delete(step)

    # Delete stock movements associated with this product
    stock_movements = db.query(StockMovement).filter(StockMovement.product_id == product_id).all()
    if stock_movements:
        for movement in stock_movements:
            db.delete(movement)

    db.delete(product)
    db.commit()

    return {"message": "Product deleted successfully", "deleted_product_id": product_id}

@app.patch("/products/{product_id}/update-stock")
def update_product_stock(
    product_id: int,
    factory_stock: int | None = Form(None),
    usa_stock: int | None = Form(None),
    front_room_stock: int | None = Form(None),
    reserved_stock: int | None = Form(None),
    factory_delta: int | None = Form(None),
    usa_delta: int | None = Form(None),
    front_room_delta: int | None = Form(None),
    reserved_delta: int | None = Form(None),
    source_type: str | None = Form(None),
    supplier_id: int | None = Form(None),
    purchase_price: float | None = Form(None),
    update_note: str = Form(None),
    db: Session = Depends(get_db),
):
    """Update stock from one authoritative server-side balance.

    Absolute values support stock counts/adjustments. Delta values support
    receipts and production without relying on a possibly stale browser value.
    """
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    supplier = None
    if supplier_id is not None:
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
    
    absolute_values = {
        "factory_stock": factory_stock,
        "usa_stock": usa_stock,
        "front_room_stock": front_room_stock,
        "reserved_stock": reserved_stock,
    }
    delta_values = {
        "factory_stock": factory_delta,
        "usa_stock": usa_delta,
        "front_room_stock": front_room_delta,
        "reserved_stock": reserved_delta,
    }
    initial_values = {
        field: int(getattr(product, field) or 0) for field in STOCK_FIELD_LABELS
    }

    for stock_field in STOCK_FIELD_LABELS:
        absolute_value = absolute_values[stock_field]
        delta_value = delta_values[stock_field]
        if absolute_value is not None and delta_value is not None:
            raise HTTPException(
                status_code=400,
                detail=f"Send either an absolute value or a delta for {STOCK_FIELD_LABELS[stock_field]}, not both",
            )
        if absolute_value is not None:
            if absolute_value < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"{STOCK_FIELD_LABELS[stock_field]} cannot be negative",
                )
            setattr(product, stock_field, absolute_value)

    db.add(product)
    db.flush()

    # SQL expressions keep concurrent receipts additive instead of letting the
    # last request overwrite stock calculated from an older browser snapshot.
    for stock_field, delta_value in delta_values.items():
        if delta_value is None or delta_value == 0:
            continue
        product_column = getattr(Product, stock_field)
        db.query(Product).filter(Product.id == product_id).update(
            {product_column: func.coalesce(product_column, 0) + delta_value},
            synchronize_session=False,
        )

    db.flush()
    db.expire(product)
    db.refresh(product)
    
    def build_movement(
        type_label,
        quantity,
        stock_field,
        source_label,
        note,
        purchase_price_value=0,
    ):
        return StockMovement(
            product_id=product_id,
            supplier_id=supplier_id if source_type == "supplier" else None,
            movement_type=type_label,
            quantity=quantity,
            stock_type=stock_field,
            purchase_price=purchase_price_value,
            source=source_label,
            reference=product.article_no,
            note=note,
            created_at=datetime.utcnow(),
        )
    
    movement_type = "Manual Update"
    source_label = "Manual"
    if source_type == "supplier":
        movement_type = "Supplier Purchase"
        source_label = supplier.name if supplier else "Supplier"
    elif source_type == "factory":
        movement_type = "Factory Manufactured"
        source_label = "Factory"
    
    # Record the exact signed change against the same committed product balance.
    for stock_field in STOCK_FIELD_LABELS:
        final_value = int(getattr(product, stock_field) or 0)
        delta_value = delta_values[stock_field]
        old_value = (
            final_value - delta_value
            if delta_value is not None
            else initial_values[stock_field]
        )
        diff = final_value - old_value
        if diff == 0:
            continue
        db.add(build_movement(
            movement_type,
            diff,
            stock_field,
            source_label,
            (
                f"{STOCK_FIELD_LABELS[stock_field]} adjusted from {old_value} "
                f"to {final_value}. {update_note or ''}"
            ),
            purchase_price if source_type == "supplier" else 0,
        ))
    
    db.commit()
    db.refresh(product)
    return product_response(product)

@app.post("/products/{product_id}/move-stock")
def move_product_stock(
    product_id: int,
    source_stock: str = Form(...),
    destination_stock: str = Form(...),
    quantity: int = Form(...),
    note: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Atomically transfer product stock between physical inventory locations."""
    if source_stock not in INVENTORY_LOCATION_LABELS:
        raise HTTPException(status_code=400, detail="Choose a valid source location")
    if destination_stock not in INVENTORY_LOCATION_LABELS:
        raise HTTPException(status_code=400, detail="Choose a valid destination location")
    if source_stock == destination_stock:
        raise HTTPException(status_code=400, detail="Source and destination must be different")
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Move quantity must be greater than zero")

    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    source_column = getattr(Product, source_stock)
    destination_column = getattr(Product, destination_stock)
    updated_rows = (
        db.query(Product)
        .filter(
            Product.id == product_id,
            func.coalesce(source_column, 0) >= quantity,
        )
        .update(
            {
                source_column: func.coalesce(source_column, 0) - quantity,
                destination_column: func.coalesce(destination_column, 0) + quantity,
            },
            synchronize_session=False,
        )
    )
    if updated_rows != 1:
        db.rollback()
        current_product = db.query(Product).filter(Product.id == product_id).first()
        current_balance = int(getattr(current_product, source_stock) or 0)
        source_label = INVENTORY_LOCATION_LABELS[source_stock]
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only {current_balance} units are available in {source_label}; "
                f"cannot move {quantity}."
            ),
        )

    db.flush()
    db.expire(product)
    db.refresh(product)

    source_label = INVENTORY_LOCATION_LABELS[source_stock]
    destination_label = INVENTORY_LOCATION_LABELS[destination_stock]
    route_label = f"{source_label} -> {destination_label}"
    transfer_reference = (
        f"MOVE-{product.id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    )
    clean_note = (note or "").strip()
    note_suffix = f" Note: {clean_note}" if clean_note else ""
    source_balance = int(getattr(product, source_stock) or 0)
    destination_balance = int(getattr(product, destination_stock) or 0)

    db.add_all(
        [
            StockMovement(
                product_id=product.id,
                movement_type="Inventory Transfer",
                quantity=-quantity,
                stock_type=source_stock,
                source=route_label,
                reference=transfer_reference,
                note=(
                    f"Moved {quantity} units out of {source_label}. "
                    f"Balance: {source_balance}.{note_suffix}"
                ),
                created_at=datetime.utcnow(),
            ),
            StockMovement(
                product_id=product.id,
                movement_type="Inventory Transfer",
                quantity=quantity,
                stock_type=destination_stock,
                source=route_label,
                reference=transfer_reference,
                note=(
                    f"Moved {quantity} units into {destination_label}. "
                    f"Balance: {destination_balance}.{note_suffix}"
                ),
                created_at=datetime.utcnow(),
            ),
        ]
    )
    db.commit()
    db.refresh(product)
    return product_response(product)

# Note: The form-based create_product endpoint defined above now handles both product creation and initial stock movement.

# Customers API
# @app.get("/school/settings")
# def get_school_settings(request: Request, db: Session = Depends(get_db)):
#     require_school_permission(request, db, "view_dashboard")
#     return load_school_settings()


# @app.put("/school/settings")
# def update_school_settings(
#     payload: dict,
#     request: Request,
#     db: Session = Depends(get_db),
# ):
#     require_school_permission(request, db, "manage_branding")
#     settings = save_school_settings(payload)
#     audit_school_action(
#         db,
#         request,
#         "update",
#         "SchoolBranding",
#         "global",
#         "Updated school branding and regional settings",
#     )
#     db.commit()
#     return settings


# def normalize_school_student_payload(payload: SchoolStudentCreate) -> dict:
#     values = payload.model_dump()
#     required_fields = ("student_name", "class_name")
#     for field in required_fields:
#         values[field] = str(values.get(field) or "").strip()
#         if not values[field]:
#             raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').title()} is required")

#     for field in (
#         "father_name",
#         "guardian_name",
#         "guardian_phone",
#         "date_of_birth",
#         "gender",
#         "section",
#         "roll_number",
#         "admission_date",
#         "address",
#         "notes",
#         "photo_url",
#         "b_form_no",
#         "birth_certificate_no",
#         "mother_name",
#         "previous_school",
#         "blood_group",
#         "graduation_date",
#         "withdrawal_date",
#         "alumni_since",
#     ):
#         value = values.get(field)
#         values[field] = str(value).strip() if value not in (None, "") else None

#     values["admission_no"] = str(values.get("admission_no") or "").strip()
#     allowed_statuses = {"Active", "Inactive", "Graduated", "Withdrawn", "Alumni"}
#     status = str(values.get("status") or "Active").strip().title()
#     values["status"] = status if status in allowed_statuses else "Active"
#     values["preferred_language"] = (
#         "ur" if str(values.get("preferred_language") or "en").lower() == "ur" else "en"
#     )
#     return values


# @app.get("/school/students", response_model=list[SchoolStudentOut])
# def get_school_students(
#     request: Request,
#     q: str | None = Query(default=None, max_length=150),
#     status: str | None = Query(default=None, max_length=30),
#     class_name: str | None = Query(default=None, max_length=80),
#     campus_id: int | None = Query(default=None),
#     db: Session = Depends(get_db),
# ):
#     access = require_school_permission(request, db, "view_students")
#     query = db.query(SchoolStudent).filter(
#         SchoolStudent.workspace_id == access["workspace"].id
#     )
#     if access["campus_ids"] is not None:
#         query = query.filter(SchoolStudent.campus_id.in_(list(access["campus_ids"])))
#     if campus_id is not None:
#         if access["campus_ids"] is not None and campus_id not in access["campus_ids"]:
#             raise HTTPException(status_code=403, detail="You do not have access to this campus.")
#         query = query.filter(SchoolStudent.campus_id == campus_id)
#     search = str(q or "").strip().lower()
#     if search:
#         pattern = f"%{search}%"
#         query = query.filter(
#             or_(
#                 func.lower(SchoolStudent.admission_no).like(pattern),
#                 func.lower(SchoolStudent.student_name).like(pattern),
#                 func.lower(func.coalesce(SchoolStudent.father_name, "")).like(pattern),
#                 func.lower(func.coalesce(SchoolStudent.guardian_name, "")).like(pattern),
#                 func.lower(func.coalesce(SchoolStudent.guardian_phone, "")).like(pattern),
#             )
#         )
#     if status:
#         query = query.filter(func.lower(SchoolStudent.status) == status.strip().lower())
#     if class_name:
#         query = query.filter(func.lower(SchoolStudent.class_name) == class_name.strip().lower())
#     return query.order_by(SchoolStudent.student_name.asc(), SchoolStudent.id.asc()).all()


# @app.post("/school/students", response_model=SchoolStudentOut)
# def create_school_student(
#     payload: SchoolStudentCreate,
#     request: Request,
#     db: Session = Depends(get_db),
# ):
#     access = require_school_permission(request, db, "manage_students")
#     values = normalize_school_student_payload(payload)
#     campus_id = values.get("campus_id")
#     if access["campus_ids"] is not None:
#         if campus_id is None and len(access["campus_ids"]) == 1:
#             campus_id = next(iter(access["campus_ids"]))
#             values["campus_id"] = campus_id
#         if campus_id not in access["campus_ids"]:
#             raise HTTPException(status_code=403, detail="You do not have access to this campus.")
#     campus = db.query(SchoolCampus).filter(
#         SchoolCampus.id == campus_id,
#         SchoolCampus.workspace_id == access["workspace"].id,
#     ).first()
#     if not campus:
#         raise HTTPException(status_code=400, detail="Select a valid campus.")
#     if not values["admission_no"]:
#         prefix = f"{(campus.code or 'DEA').upper()}-{datetime.now().year}-"
#         highest = 0
#         for (existing_number,) in db.query(SchoolStudent.admission_no).filter(
#             SchoolStudent.workspace_id == access["workspace"].id
#         ).all():
#             match = re.search(r"(\d+)$", str(existing_number or ""))
#             if match:
#                 highest = max(highest, int(match.group(1)))
#         values["admission_no"] = f"{prefix}{str(highest + 1).zfill(4)}"
#     academic_session = db.query(SchoolAcademicSession).filter(
#         SchoolAcademicSession.id == values.get("academic_session_id"),
#         SchoolAcademicSession.workspace_id == access["workspace"].id,
#     ).first()
#     if not academic_session:
#         raise HTTPException(status_code=400, detail="Select a valid academic session.")
#     duplicate = db.query(SchoolStudent).filter(
#         SchoolStudent.workspace_id == access["workspace"].id,
#         func.lower(SchoolStudent.admission_no) == values["admission_no"].lower()
#     ).first()
#     if duplicate:
#         raise HTTPException(status_code=409, detail="Admission number already exists")

#     student = SchoolStudent(workspace_id=access["workspace"].id, **values)
#     db.add(student)
#     db.flush()
#     audit_school_action(
#         db,
#         request,
#         "create",
#         "SchoolStudent",
#         student.id,
#         f"Admitted student {student.student_name}",
#     )
#     db.commit()
#     db.refresh(student)
#     return student


# @app.put("/school/students/{student_id}", response_model=SchoolStudentOut)
# def update_school_student(
#     student_id: int,
#     payload: SchoolStudentCreate,
#     request: Request,
#     db: Session = Depends(get_db),
# ):
#     access = require_school_permission(request, db, "manage_students")
#     student = db.query(SchoolStudent).filter(
#         SchoolStudent.id == student_id,
#         SchoolStudent.workspace_id == access["workspace"].id,
#     ).first()
#     if not student:
#         raise HTTPException(status_code=404, detail="Student not found")

#     values = normalize_school_student_payload(payload)
#     campus_id = values.get("campus_id")
#     if access["campus_ids"] is not None and campus_id not in access["campus_ids"]:
#         raise HTTPException(status_code=403, detail="You do not have access to this campus.")
#     if not db.query(SchoolCampus).filter(
#         SchoolCampus.id == campus_id,
#         SchoolCampus.workspace_id == access["workspace"].id,
#     ).first():
#         raise HTTPException(status_code=400, detail="Select a valid campus.")
#     if not db.query(SchoolAcademicSession).filter(
#         SchoolAcademicSession.id == values.get("academic_session_id"),
#         SchoolAcademicSession.workspace_id == access["workspace"].id,
#     ).first():
#         raise HTTPException(status_code=400, detail="Select a valid academic session.")
#     duplicate = db.query(SchoolStudent).filter(
#         SchoolStudent.id != student_id,
#         SchoolStudent.workspace_id == access["workspace"].id,
#         func.lower(SchoolStudent.admission_no) == values["admission_no"].lower(),
#     ).first()
#     if duplicate:
#         raise HTTPException(status_code=409, detail="Admission number already exists")

#     for key, value in values.items():
#         setattr(student, key, value)
#     student.updated_at = datetime.utcnow()
#     audit_school_action(
#         db,
#         request,
#         "update",
#         "SchoolStudent",
#         student.id,
#         f"Updated student {student.student_name}",
#     )
#     db.commit()
#     db.refresh(student)
#     return student


# @app.delete("/school/students/{student_id}")
# def delete_school_student(
#     student_id: int,
#     request: Request,
#     db: Session = Depends(get_db),
# ):
#     access = require_school_permission(request, db, "manage_students")
#     student = db.query(SchoolStudent).filter(
#         SchoolStudent.id == student_id,
#         SchoolStudent.workspace_id == access["workspace"].id,
#     ).first()
#     if not student:
#         raise HTTPException(status_code=404, detail="Student not found")
#     if student.status != "Withdrawn":
#         student.status = "Withdrawn"
#         student.withdrawal_date = datetime.now().date().isoformat()
#     student.archived_at = datetime.utcnow()
#     db.add(SchoolStudentLifecycleEvent(
#         workspace_id=student.workspace_id,
#         student_id=student.id,
#         event_type="Archived",
#         event_date=datetime.now().date().isoformat(),
#         from_campus_id=student.campus_id,
#         to_campus_id=student.campus_id,
#         from_class_name=student.class_name,
#         to_class_name=student.class_name,
#         from_section_name=student.section,
#         to_section_name=student.section,
#         reason="Student record archived from the register",
#         recorded_by_user_id=access["user"].id,
#     ))
#     audit_school_action(
#         db,
#         request,
#         "archive",
#         "SchoolStudent",
#         student.id,
#         f"Archived student {student.student_name}",
#     )
#     db.commit()
#     return {"detail": "Student archived successfully. Its complete history was preserved."}


@app.get("/customers", response_model=list[CustomerOut])
def get_customers(request: Request, db: Session = Depends(get_db)):
    privacy = access_privacy_context(request, db)
    return [
        customer_response(customer, privacy)
        for customer in db.query(Customer).order_by(Customer.id.desc()).all()
    ]

@app.post("/customers", response_model=CustomerOut)
def create_customer(
    customer: CustomerCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    new_customer = Customer(**customer.model_dump())
    db.add(new_customer)
    db.commit()
    db.refresh(new_customer)
    return customer_response(new_customer, privacy)

@app.put("/customers/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    customer: CustomerCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    for key, value in customer.model_dump().items():
        setattr(db_customer, key, value)
    
    db.commit()
    db.refresh(db_customer)
    return customer_response(db_customer, privacy)

@app.delete("/customers/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db)):
    db_customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # Delete related orders and their items
    orders = db.query(Order).filter(Order.customer_id == customer_id).all()
    for order in orders:
        db.query(OrderItem).filter(OrderItem.order_id == order.id).delete()
        db.query(Shipping).filter(Shipping.order_id == order.id).delete()
        db.query(SharedData).filter(SharedData.order_id == order.id).delete()
    
    db.query(Order).filter(Order.customer_id == customer_id).delete()
    db.delete(db_customer)
    db.commit()
    
    return {"detail": "Customer and related orders deleted successfully"}


CSV_IMPORT_ERROR_LIMIT = 25
CSV_BLANK_VALUES = {
    "",
    "na",
    "n/a",
    "none",
    "null",
    "-",
    "'-",
    "no scheduled order date",
    "not scheduled",
}


def normalize_csv_header(header: str | None) -> str:
    return (
        str(header or "")
        .strip()
        .lower()
        .replace("\ufeff", "")
        .replace("-", "_")
        .replace(" ", "_")
    )


def csv_row_value(row: dict, *keys: str) -> str:
    for key in keys:
        value = row.get(normalize_csv_header(key))
        cleaned = str(value or "").strip()
        if cleaned and cleaned.lower() not in CSV_BLANK_VALUES:
            return cleaned
    return ""


def add_csv_error(errors: list[dict], line: int | str, detail: str, name: str | None = None):
    if len(errors) < CSV_IMPORT_ERROR_LIMIT:
        error = {"row": line, "detail": detail}
        if name:
            error["name"] = name
        errors.append(error)


def csv_has_column(row: dict, *keys: str) -> bool:
    return any(normalize_csv_header(key) in row for key in keys)


def csv_customer_label(row: dict) -> str:
    return (
        csv_row_value(row, "contact_name", "customer_name", "name", "full_name")
        or csv_row_value(row, "store_name", "company_name", "company")
        or "Unknown contact"
    )


def csv_customer_profile_address(row: dict) -> str:
    direct_address = csv_row_value(
        row,
        "residential_address",
        "home_address",
        "profile_address",
        "customer_address",
        "billing_address",
        "bill_to_address",
        "store_address",
        "retailer_address",
        "company_address",
        "address",
    )
    if direct_address:
        return direct_address

    street_lines = [
        csv_row_value(row, "address_1", "address1", "street", "street_address"),
        csv_row_value(row, "address_2", "address2", "suite", "apartment"),
    ]
    city_state_zip = " ".join(
        part
        for part in [
            csv_row_value(row, "city"),
            csv_row_value(row, "state", "province", "region"),
            csv_row_value(row, "zip_code", "zip", "postal_code", "postcode"),
        ]
        if part
    )
    country = csv_row_value(row, "country", "customer_country")

    return "\n".join(part for part in [*street_lines, city_state_zip, country] if part)


def csv_customer_shipping_address(row: dict) -> str:
    direct_address = csv_row_value(
        row,
        "shipping_address",
        "ship_to_address",
        "delivery_address",
        "recipient_address",
        "commercial_address",
        "shop_address",
    )
    if direct_address:
        return direct_address

    street_lines = [
        csv_row_value(row, "shipping_address_1", "ship_address_1", "ship_to_address_1", "delivery_address_1"),
        csv_row_value(row, "shipping_address_2", "ship_address_2", "ship_to_address_2", "delivery_address_2"),
    ]
    city_state_zip = " ".join(
        part
        for part in [
            csv_row_value(row, "shipping_city", "ship_city", "delivery_city"),
            csv_row_value(row, "shipping_state", "ship_state", "shipping_province", "ship_province"),
            csv_row_value(row, "shipping_zip", "ship_zip", "shipping_postal_code", "ship_postal_code"),
        ]
        if part
    )
    country = csv_row_value(row, "shipping_country", "ship_country", "delivery_country")
    return "\n".join(part for part in [*street_lines, city_state_zip, country] if part)


def csv_customer_address(row: dict) -> str:
    return csv_customer_profile_address(row)


CUSTOMER_IMPORT_FIELDS = (
    "name",
    "company_name",
    "email",
    "phone",
    "country",
    "address",
    "shipping_address",
    "platform",
)
CUSTOMER_IMPORT_ACTIONS = {"skip", "add", "merge", "update"}


class CustomerImportResolution(BaseModel):
    action: str
    existing_id: int | None = None
    incoming: dict[str, object | None] = Field(default_factory=dict)


class CustomerImportResolveRequest(BaseModel):
    resolutions: list[CustomerImportResolution] = Field(default_factory=list)


def clean_customer_import_value(value) -> str | None:
    cleaned = str(value or "").strip().strip("'")
    if not cleaned or cleaned.lower() in CSV_BLANK_VALUES:
        return None
    return cleaned


def normalized_customer_key(value) -> str:
    return str(value or "").strip().lower()


def normalized_customer_address_key(value) -> str:
    normalized = str(value or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def normalized_customer_phone(value) -> str:
    digits = "".join(character for character in str(value or "") if character.isdigit())
    return digits if len(digits) >= 7 else ""


def customer_import_candidate_from_row(row: dict) -> dict:
    is_faire_contact = csv_has_column(row, "store_name", "contact_name", "email_address", "on_faire")
    company_name = csv_row_value(
        row,
        "store_name",
        "business_name",
        "business",
        "shop_name",
        "retailer_name",
        "company_name",
        "company",
    )
    name = (
        csv_row_value(
            row,
            "contact_name",
            "person_name",
            "buyer_name",
            "customer_name",
            "full_name",
            "name",
        )
        or company_name
    )
    email = csv_row_value(row, "email_address", "email", "customer_email")
    phone = csv_row_value(
        row,
        "phone",
        "phone_number",
        "mobile",
        "mobile_phone",
        "telephone",
        "tel",
        "contact_phone",
        "customer_phone",
        "store_phone",
    )
    platform = "Faire" if is_faire_contact else (csv_row_value(row, "platform", "source") or "Manual")

    return {
        "name": clean_customer_import_value(name),
        "company_name": clean_customer_import_value(company_name),
        "email": clean_customer_import_value(email),
        "phone": clean_customer_import_value(phone),
        "country": clean_customer_import_value(csv_row_value(row, "country", "customer_country")),
        "address": clean_customer_import_value(csv_customer_address(row)),
        "shipping_address": clean_customer_import_value(csv_customer_shipping_address(row)),
        "platform": clean_customer_import_value(platform) or "Manual",
    }


def normalize_customer_import_candidate(data: dict) -> dict:
    candidate = {
        field: clean_customer_import_value(data.get(field))
        for field in CUSTOMER_IMPORT_FIELDS
    }
    if not candidate["name"]:
        candidate["name"] = candidate["company_name"]
    candidate["platform"] = candidate["platform"] or "Manual"
    return candidate


def customer_business_key_from_values(name: str | None, company_name: str | None) -> str:
    return normalized_customer_key(company_name) or normalized_customer_key(name)


def customer_business_key(customer: Customer) -> str:
    return customer_business_key_from_values(customer.name, customer.company_name)


def candidate_business_key(candidate: dict) -> str:
    return customer_business_key_from_values(
        candidate.get("name"),
        candidate.get("company_name"),
    )


def is_company_only_customer(customer: Customer | None) -> bool:
    if not customer:
        return False
    name_key = normalized_customer_key(customer.name)
    company_key = normalized_customer_key(customer.company_name)
    return bool(name_key and company_key and name_key == company_key)


def candidate_has_contact_name(candidate: dict) -> bool:
    name_key = normalized_customer_key(candidate.get("name"))
    company_key = normalized_customer_key(candidate.get("company_name"))
    return bool(name_key and company_key and name_key != company_key)


def customer_import_snapshot(customer: Customer) -> dict:
    return {
        "id": customer.id,
        "name": customer.name,
        "company_name": customer.company_name,
        "email": customer.email,
        "phone": customer.phone,
        "country": customer.country,
        "address": customer.address,
        "shipping_address": customer.shipping_address,
        "platform": customer.platform,
    }


def customer_matching_address_keys(*values) -> list[str]:
    keys = []
    for value in values:
        key = normalized_customer_address_key(value)
        if key and key not in keys:
            keys.append(key)
    return keys


def customer_import_lookup(customers: list[Customer]) -> dict[str, dict]:
    lookup = {
        "email": {},
        "phone": {},
        "identity": {},
        "company_address": {},
        "name_company": {},
        "company": {},
        "address": {},
    }

    def remember_unique(bucket: str, key, customer: Customer) -> None:
        if not key:
            return
        existing = lookup[bucket].get(key)
        if existing is None and key in lookup[bucket]:
            return
        if existing and existing.id != customer.id:
            lookup[bucket][key] = None
            return
        lookup[bucket][key] = customer

    for customer in customers:
        email_key = normalized_customer_key(customer.email)
        if email_key and email_key not in lookup["email"]:
            lookup["email"][email_key] = customer

        phone_key = normalized_customer_phone(customer.phone)
        if phone_key and phone_key not in lookup["phone"]:
            lookup["phone"][phone_key] = customer

        name_key = normalized_customer_key(customer.name)
        company_key = normalized_customer_key(customer.company_name)
        address_keys = customer_matching_address_keys(
            customer.address,
            customer.shipping_address,
        )

        for address_key in address_keys:
            identity_key = (name_key, company_key, address_key)
            if all(identity_key) and identity_key not in lookup["identity"]:
                lookup["identity"][identity_key] = customer

            company_address_key = (company_key, address_key)
            if all(company_address_key) and company_address_key not in lookup["company_address"]:
                lookup["company_address"][company_address_key] = customer

            remember_unique("address", address_key, customer)

        name_company_key = (name_key, company_key)
        if all(name_company_key) and name_company_key not in lookup["name_company"]:
            lookup["name_company"][name_company_key] = customer

        remember_unique("company", company_key or name_key, customer)

    return lookup


def find_customer_import_conflict(candidate: dict, lookup: dict[str, dict]) -> tuple[Customer | None, str | None]:
    email_key = normalized_customer_key(candidate.get("email"))
    if email_key and email_key in lookup["email"]:
        return lookup["email"][email_key], "Email already exists"

    phone_key = normalized_customer_phone(candidate.get("phone"))
    if phone_key and phone_key in lookup["phone"]:
        return lookup["phone"][phone_key], "Phone number already exists"

    name_key = normalized_customer_key(candidate.get("name"))
    company_key = normalized_customer_key(candidate.get("company_name"))
    address_keys = customer_matching_address_keys(
        candidate.get("address"),
        candidate.get("shipping_address"),
    )

    for address_key in address_keys:
        identity_key = (name_key, company_key, address_key)
        if all(identity_key) and identity_key in lookup["identity"]:
            return lookup["identity"][identity_key], "Name, company, and address match"

        company_address_key = (company_key, address_key)
        if all(company_address_key) and company_address_key in lookup["company_address"]:
            return lookup["company_address"][company_address_key], "Company and address match"

        if address_key and address_key in lookup["address"] and lookup["address"][address_key]:
            return lookup["address"][address_key], "Address matches one saved customer"

    name_company_key = (name_key, company_key)
    if all(name_company_key) and name_company_key in lookup["name_company"]:
        return lookup["name_company"][name_company_key], "Name and company match"

    business_key = company_key or name_key
    if business_key and business_key in lookup["company"] and lookup["company"][business_key]:
        return lookup["company"][business_key], "Company name matches"

    return None, None


def create_customer_from_import_candidate(candidate: dict) -> Customer:
    return Customer(
        name=candidate["name"],
        company_name=candidate.get("company_name"),
        email=candidate.get("email"),
        phone=candidate.get("phone"),
        country=candidate.get("country"),
        address=candidate.get("address"),
        shipping_address=candidate.get("shipping_address"),
        platform=candidate.get("platform") or "Manual",
    )


def apply_customer_import_resolution(existing_customer: Customer, candidate: dict, replace_existing: bool) -> bool:
    changed = False
    existing_was_company_only = is_company_only_customer(existing_customer)
    incoming_has_contact_name = candidate_has_contact_name(candidate)

    if (
        not replace_existing
        and existing_was_company_only
        and incoming_has_contact_name
        and candidate.get("address")
        and existing_customer.address
        and not existing_customer.shipping_address
    ):
        existing_customer.shipping_address = existing_customer.address
        changed = True

    for field in CUSTOMER_IMPORT_FIELDS:
        value = candidate.get(field)
        if not value:
            continue

        current_value = str(getattr(existing_customer, field, "") or "").strip()
        should_prefer_incoming_contact = (
            not replace_existing
            and existing_was_company_only
            and incoming_has_contact_name
            and field in {"name", "email", "phone", "address"}
        )
        should_update = replace_existing or should_prefer_incoming_contact or not current_value
        if should_update and current_value != value:
            setattr(existing_customer, field, value)
            changed = True

    return changed


def should_auto_merge_customer_import(
    existing_customer: Customer | None,
    candidate: dict,
) -> bool:
    if not existing_customer or not is_company_only_customer(existing_customer):
        return False
    if not candidate_has_contact_name(candidate):
        return False
    return bool(customer_business_key(existing_customer) == candidate_business_key(candidate))


def clean_csv_number(value: str) -> str:
    cleaned = str(value or "").strip()
    for token in ("PKR", "Rs.", "Rs", "USD", "$", ","):
        cleaned = cleaned.replace(token, "")
    return cleaned.strip()


def parse_csv_float(value: str, field_name: str, line: int | str, default: float = 0) -> float:
    if value is None or str(value).strip() == "":
        return default
    try:
        return float(clean_csv_number(value))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a number on row {line}.") from exc


def parse_csv_int(value: str, field_name: str, line: int | str, default: int = 0, minimum: int | None = None) -> int:
    if value is None or str(value).strip() == "":
        parsed = default
    else:
        try:
            parsed = int(float(clean_csv_number(value)))
        except ValueError as exc:
            raise ValueError(f"{field_name} must be a whole number on row {line}.") from exc

    if minimum is not None and parsed < minimum:
        raise ValueError(f"{field_name} must be at least {minimum} on row {line}.")
    return parsed


CSV_ORDER_DATE_FIELDS = (
    "order_date",
    "order date",
    "date",
    "ordered_date",
    "ordered_at",
    "order_placed_at",
    "order_placed_date",
    "placed_at",
    "placed_date",
    "created_at",
    "created_date",
    "created",
    "sale_date",
    "purchase_date",
)
CSV_SHIP_DATE_FIELDS = (
    "ship_date",
    "shipping_date",
    "shipped_date",
    "shipped_at",
    "fulfilled_at",
    "fulfillment_date",
    "dispatch_date",
    "dispatched_at",
)
CSV_ORDER_DATE_HEADER_BLOCKLIST = (
    "ship",
    "shipping",
    "shipped",
    "fulfill",
    "dispatch",
    "delivery",
    "delivered",
    "payout",
    "paid",
    "payment",
    "release",
    "expected",
)


def csv_first_matching_date_value(row: dict, explicit_fields: tuple[str, ...], *, order_date_fallback: bool = False) -> str:
    value = csv_row_value(row, *explicit_fields)
    if value or not order_date_fallback:
        return value

    for key, raw_value in row.items():
        normalized_key = normalize_csv_header(key)
        if normalized_key.startswith("__"):
            continue
        if any(blocked in normalized_key for blocked in CSV_ORDER_DATE_HEADER_BLOCKLIST):
            continue
        if not (
            "date" in normalized_key
            or "created" in normalized_key
            or "ordered" in normalized_key
            or "placed" in normalized_key
        ):
            continue
        cleaned = str(raw_value or "").strip()
        if cleaned and cleaned.lower() not in CSV_BLANK_VALUES:
            return cleaned
    return ""


def csv_order_date_value(row: dict) -> str:
    return csv_first_matching_date_value(
        row,
        CSV_ORDER_DATE_FIELDS,
        order_date_fallback=True,
    )


def csv_ship_date_value(row: dict) -> str:
    return csv_first_matching_date_value(row, CSV_SHIP_DATE_FIELDS)


def parse_csv_numeric_datetime(text: str) -> datetime | None:
    numeric_text = text.replace(",", "")
    if not re.fullmatch(r"\d+(?:\.\d+)?", numeric_text):
        return None

    number = float(numeric_text)
    if 20_000 <= number <= 80_000:
        return datetime(1899, 12, 30) + timedelta(days=number)
    if 1_000_000_000 <= number <= 9_999_999_999:
        return datetime.fromtimestamp(number)
    if 1_000_000_000_000 <= number <= 9_999_999_999_999:
        return datetime.fromtimestamp(number / 1000)
    return None


def csv_datetime_text_variants(text: str) -> list[str]:
    cleaned = (
        text.strip()
        .strip("'")
        .replace("\u00a0", " ")
        .replace("T", " ")
    )
    cleaned = re.sub(r"\s*\([^)]*\)\s*$", "", cleaned)
    cleaned = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", r"\1", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+at\s+", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\w{3,9},\s+", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    variants = [cleaned]
    without_gmt = re.sub(r"\s+GMT[+-]\d{2}:?\d{2}$", "", cleaned, flags=re.IGNORECASE).strip()
    without_tz_name = re.sub(
        r"\s+(UTC|GMT|PKT|PST|PDT|MST|MDT|CST|CDT|EST|EDT)$",
        "",
        without_gmt,
        flags=re.IGNORECASE,
    ).strip()
    for candidate in (without_gmt, without_tz_name):
        if candidate and candidate not in variants:
            variants.append(candidate)

    for candidate in list(variants):
        no_time_comma = re.sub(r",\s+(?=\d{1,2}:\d{2})", " ", candidate)
        no_commas = candidate.replace(",", "")
        for extra in (no_time_comma, no_commas):
            extra = re.sub(r"\s+", " ", extra).strip()
            if extra and extra not in variants:
                variants.append(extra)

    return variants


CSV_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y.%m.%d",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%m-%d-%Y",
    "%m-%d-%y",
    "%m.%d.%Y",
    "%m.%d.%y",
    "%d/%m/%Y",
    "%d/%m/%y",
    "%d-%m-%Y",
    "%d-%m-%y",
    "%d.%m.%Y",
    "%d.%m.%y",
    "%B %d, %Y",
    "%b %d, %Y",
    "%B %d %Y",
    "%b %d %Y",
    "%d %B %Y",
    "%d %b %Y",
    "%d-%B-%Y",
    "%d-%b-%Y",
    "%B-%d-%Y",
    "%b-%d-%Y",
)
CSV_TIME_FORMAT_SUFFIXES = (
    "",
    " %H:%M",
    " %H:%M:%S",
    " %H:%M:%S.%f",
    " %I:%M %p",
    " %I:%M:%S %p",
    " %H:%M %z",
    " %H:%M:%S %z",
    " %I:%M %p %z",
    " %I:%M:%S %p %z",
)


def parse_csv_datetime(value: str, field_name: str, line: int | str) -> datetime | None:
    if value is None:
        return None

    text = str(value).strip().strip("'")
    if not text or text.lower() in CSV_BLANK_VALUES:
        return None

    parsed = parse_csv_numeric_datetime(text)

    for date_text in csv_datetime_text_variants(text):
        if parsed is not None:
            break
        iso_text = date_text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(iso_text)
            break
        except ValueError:
            pass

        for date_format in CSV_DATE_FORMATS:
            for time_suffix in CSV_TIME_FORMAT_SUFFIXES:
                try:
                    parsed = datetime.strptime(date_text, f"{date_format}{time_suffix}")
                    break
                except ValueError:
                    continue
            if parsed is not None:
                break

    if parsed is None:
        raise ValueError(
            f"{field_name} must be a valid date on row {line}. "
            "Examples: 2026-07-02, 07/02/2026, 2 Jul 2026, or an Excel serial date."
        )

    return parsed.replace(tzinfo=None)


async def read_csv_upload(upload: UploadFile) -> list[dict]:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file must include a header row")

    rows = []
    try:
        for line_number, raw_row in enumerate(reader, start=2):
            normalized_row = {
                normalize_csv_header(key): str(value or "").strip()
                for key, value in raw_row.items()
                if key is not None
            }
            if any(normalized_row.values()):
                normalized_row["__line_number"] = line_number
                rows.append(normalized_row)
    except csv.Error as exc:
        raise HTTPException(status_code=400, detail=f"CSV could not be read: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=400, detail="CSV file has no data rows")
    return rows


@app.post("/customers/import-csv")
async def import_customers_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    rows = await read_csv_upload(file)
    errors = []
    conflicts = []
    failed_rows = 0
    skipped_rows = 0
    merged_rows = 0
    imported_customers = []
    seen_email_keys = set()
    seen_phone_keys = set()
    seen_identity_keys = set()
    existing_customers = db.query(Customer).all()
    existing_lookup = customer_import_lookup(existing_customers)

    for row in rows:
        line = row["__line_number"]
        label = csv_customer_label(row)
        candidate = customer_import_candidate_from_row(row)
        if not candidate["name"]:
            failed_rows += 1
            add_csv_error(errors, line, "Customer name or store name is required.", label)
            continue

        existing_customer, conflict_reason = find_customer_import_conflict(candidate, existing_lookup)
        if existing_customer:
            if should_auto_merge_customer_import(existing_customer, candidate):
                if apply_customer_import_resolution(
                    existing_customer,
                    candidate,
                    replace_existing=False,
                ):
                    merged_rows += 1
                else:
                    skipped_rows += 1
                continue

            skipped_rows += 1
            conflicts.append(
                {
                    "row": line,
                    "name": label,
                    "reason": conflict_reason,
                    "incoming": candidate,
                    "existing": customer_import_snapshot(existing_customer),
                }
            )
            continue

        email_key = normalized_customer_key(candidate.get("email"))
        phone_key = normalized_customer_phone(candidate.get("phone"))
        identity_address_keys = customer_matching_address_keys(
            candidate.get("address"),
            candidate.get("shipping_address"),
        )
        identity_address_key = identity_address_keys[0] if identity_address_keys else ""
        identity_key = (
            normalized_customer_key(candidate.get("name")),
            normalized_customer_key(candidate.get("company_name")),
            identity_address_key,
        )

        if email_key and email_key in seen_email_keys:
            skipped_rows += 1
            add_csv_error(errors, line, "This email appears more than once in this CSV.", label)
            continue

        if phone_key and phone_key in seen_phone_keys:
            skipped_rows += 1
            add_csv_error(errors, line, "This phone number appears more than once in this CSV.", label)
            continue

        if all(identity_key) and identity_key in seen_identity_keys:
            skipped_rows += 1
            add_csv_error(errors, line, "This contact appears more than once in this CSV.", label)
            continue

        customer = create_customer_from_import_candidate(candidate)
        db.add(customer)
        imported_customers.append(customer)
        if email_key:
            seen_email_keys.add(email_key)
        if phone_key:
            seen_phone_keys.add(phone_key)
        if all(identity_key):
            seen_identity_keys.add(identity_key)

    try:
        if imported_customers or merged_rows:
            db.commit()
            for customer in imported_customers:
                db.refresh(customer)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Customers could not be imported.") from exc

    return {
        "total": len(rows),
        "created": len(imported_customers),
        "merged": merged_rows,
        "with_email": sum(1 for customer in imported_customers if customer.email),
        "with_phone": sum(1 for customer in imported_customers if customer.phone),
        "with_address": sum(1 for customer in imported_customers if customer.address),
        "with_shipping_address": sum(1 for customer in imported_customers if customer.shipping_address),
        "failed": failed_rows,
        "skipped": skipped_rows,
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
        "source_format": "Faire contacts" if any(
            csv_has_column(row, "store_name", "contact_name", "email_address", "on_faire")
            for row in rows
        ) else "CSV",
        "errors": errors,
    }


@app.post("/customers/import-conflicts/resolve")
def resolve_customer_import_conflicts(
    payload: CustomerImportResolveRequest,
    db: Session = Depends(get_db),
):
    errors = []
    added_customers = []
    merged_count = 0
    updated_count = 0
    skipped_count = 0
    unchanged_count = 0

    for index, resolution in enumerate(payload.resolutions, start=1):
        action = str(resolution.action or "").strip().lower()
        candidate = normalize_customer_import_candidate(resolution.incoming or {})
        label = candidate.get("name") or candidate.get("company_name") or f"Resolution {index}"

        if action not in CUSTOMER_IMPORT_ACTIONS:
            add_csv_error(errors, index, "Choose skip, add as new, merge missing, or update existing.", label)
            continue

        if action == "skip":
            skipped_count += 1
            continue

        if not candidate["name"]:
            add_csv_error(errors, index, "Customer name or store name is required.", label)
            continue

        if action == "add":
            customer = create_customer_from_import_candidate(candidate)
            db.add(customer)
            added_customers.append(customer)
            continue

        if not resolution.existing_id:
            add_csv_error(errors, index, "Existing customer was not found for this resolution.", label)
            continue

        existing_customer = db.query(Customer).filter(Customer.id == resolution.existing_id).first()
        if not existing_customer:
            add_csv_error(errors, index, "Existing customer was not found for this resolution.", label)
            continue

        changed = apply_customer_import_resolution(
            existing_customer,
            candidate,
            replace_existing=action == "update",
        )
        if not changed:
            unchanged_count += 1
        elif action == "merge":
            merged_count += 1
        else:
            updated_count += 1

    try:
        db.commit()
        for customer in added_customers:
            db.refresh(customer)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Customer import choices could not be applied.") from exc

    return {
        "processed": len(payload.resolutions),
        "added": len(added_customers),
        "merged": merged_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "unchanged": unchanged_count,
        "errors": errors,
    }


def normalize_import_stock_source(value: str) -> str:
    source = str(value or "Factory").strip().lower().replace("_", " ")
    if source in {"factory", "factory stock", "factory_stock"}:
        return "Factory"
    if source in {"usa", "us", "united states", "usa stock", "usa_stock"}:
        return "USA"
    raise ValueError("Stock source must be Factory or USA.")


def find_import_customer(row: dict, db: Session) -> Customer | None:
    customer, _reason = find_import_customer_match(row, db)
    return customer


def find_import_customer_match(
    row: dict,
    db: Session,
    customer_lookup: dict | None = None,
    customers_by_id: dict[int, Customer] | None = None,
) -> tuple[Customer | None, str | None]:
    customer_id = csv_row_value(row, "customer_id", "buyer_id")
    if customer_id:
        try:
            parsed_id = int(float(customer_id))
            customer = (
                customers_by_id.get(parsed_id)
                if customers_by_id is not None
                else db.query(Customer).filter(Customer.id == parsed_id).first()
            )
            return customer, "Customer ID match" if customer else None
        except ValueError:
            return None, None

    candidate = order_import_customer_candidate_from_row(
        row,
        order_import_customer_name(row),
        include_shipping_address=True,
    )
    customer, reason = find_customer_import_conflict(
        candidate,
        customer_lookup or customer_import_lookup(db.query(Customer).all()),
    )
    return customer, reason


def order_import_customer_name(row: dict) -> str:
    return csv_row_value(
        row,
        "retailer_name",
        "store_name",
        "company_name",
        "company",
        "customer_name",
        "customer",
        "name",
    )


def order_import_contact_name(row: dict) -> str:
    return csv_row_value(
        row,
        "contact_name",
        "buyer_name",
        "ordered_by",
        "purchaser_name",
        "team_member",
        "customer_contact",
        "full_name",
    )


def order_import_contact_phone(row: dict) -> str:
    return csv_row_value(
        row,
        "phone_number",
        "phone",
        "contact_phone",
        "customer_phone",
        "store_phone",
        "shop_phone",
        "business_phone",
        "retailer_phone",
        "shipping_phone",
        "telephone",
        "mobile_phone",
    )


def csv_order_shipping_name(row: dict) -> str:
    return csv_row_value(
        row,
        "shipping_name",
        "ship_to_name",
        "recipient_name",
        "delivery_name",
        "consignee",
        "retailer_name",
        "store_name",
        "company_name",
        "company",
    )


def csv_order_shipping_address(row: dict) -> str:
    direct_address = csv_customer_shipping_address(row)
    if direct_address:
        return direct_address

    explicit_street_lines = [
        csv_row_value(row, "shipping_address_1", "ship_address_1", "ship_to_address_1", "delivery_address_1"),
        csv_row_value(row, "shipping_address_2", "ship_address_2", "ship_to_address_2", "delivery_address_2"),
    ]
    street_lines = explicit_street_lines if any(explicit_street_lines) else [
        csv_row_value(row, "address_1", "address1"),
        csv_row_value(row, "address_2", "address2"),
    ]
    city_state_zip = " ".join(
        part
        for part in [
            csv_row_value(row, "shipping_city", "ship_city", "delivery_city", "city"),
            csv_row_value(row, "shipping_state", "ship_state", "shipping_province", "ship_province", "state", "province", "region"),
            csv_row_value(row, "shipping_zip", "ship_zip", "shipping_postal_code", "ship_postal_code", "zip_code", "zip", "postal_code", "postcode"),
        ]
        if part
    )
    country = csv_row_value(row, "shipping_country", "ship_country", "delivery_country", "country")
    return "\n".join(part for part in [*street_lines, city_state_zip, country] if part)


def order_import_customer_candidate_from_row(
    row: dict,
    fallback_name: str | None = None,
    include_shipping_address: bool = False,
) -> dict:
    candidate = normalize_customer_import_candidate(customer_import_candidate_from_row(row))
    candidate["address"] = clean_customer_import_value(
        csv_row_value(
            row,
            "residential_address",
            "home_address",
            "profile_address",
            "customer_address",
            "billing_address",
            "bill_to_address",
            "store_address",
            "retailer_address",
            "company_address",
        )
    )
    candidate["shipping_address"] = clean_customer_import_value(csv_order_shipping_address(row))
    fallback = clean_customer_import_value(fallback_name)
    account_name = clean_customer_import_value(
        csv_row_value(row, "retailer_name", "store_name", "company_name", "company")
    )
    contact_name = clean_customer_import_value(order_import_contact_name(row))
    if account_name:
        candidate["company_name"] = account_name
        candidate["name"] = account_name
    elif contact_name and not candidate.get("name"):
        candidate["name"] = contact_name
    if not candidate.get("name"):
        candidate["name"] = fallback or "Imported customer"
    if not candidate.get("company_name") and fallback and fallback != candidate.get("name"):
        candidate["company_name"] = fallback
    if include_shipping_address and not candidate.get("shipping_address"):
        candidate["shipping_address"] = clean_customer_import_value(csv_order_shipping_address(row))
    if (
        csv_has_column(row, "retailer_name")
        and csv_has_column(row, "sku")
        and csv_has_column(row, "wholesale_price")
    ):
        candidate["platform"] = "Faire"
    return candidate


def order_import_customer_key(candidate: dict, line: int | str) -> str:
    email_key = normalized_customer_key(candidate.get("email"))
    if email_key:
        return f"email:{email_key}"
    phone_key = normalized_customer_phone(candidate.get("phone"))
    if phone_key:
        return f"phone:{phone_key}"
    name_key = normalized_customer_key(candidate.get("name"))
    company_key = normalized_customer_key(candidate.get("company_name"))
    if name_key or company_key:
        return f"name:{name_key}|company:{company_key}"
    return f"line:{line}"


def find_import_product(row: dict, db: Session, product_lookup: dict | None = None) -> Product | None:
    product_id = csv_row_value(row, "product_id", "item_id")
    if product_id:
        try:
            parsed_id = int(float(product_id))
            if product_lookup is not None:
                return product_lookup["by_id"].get(parsed_id)
            return db.query(Product).filter(Product.id == parsed_id).first()
        except ValueError:
            return None

    article_no = csv_row_value(row, "article_no", "product_article_no", "sku", "product_sku")
    if article_no:
        if product_lookup is not None:
            product = product_lookup["by_article"].get(article_no.lower())
            if product:
                return product
        product = (
            db.query(Product)
            .filter(func.lower(Product.article_no) == article_no.lower())
            .first()
        )
        if product:
            return product

    product_name = csv_row_value(row, "product_name", "item_name")
    if product_name:
        if product_lookup is not None:
            return product_lookup["unique_by_name"].get(product_name.lower())
        matches = (
            db.query(Product)
            .filter(func.lower(Product.name) == product_name.lower())
            .all()
        )
        if len(matches) == 1:
            return matches[0]
    return None


def order_import_product_snapshot(product: Product) -> dict:
    return {
        "id": product.id,
        "article_no": product.article_no,
        "name": product.name,
        "image_url": product.image_url,
        "available_stock": (
            (product.factory_stock or 0)
            + (product.usa_stock or 0)
            + (product.front_room_stock or 0)
            - (product.reserved_stock or 0)
        ),
        "factory_stock": product.factory_stock,
        "usa_stock": product.usa_stock,
        "front_room_stock": product.front_room_stock,
        "reserved_stock": product.reserved_stock,
        "selling_price": product.selling_price,
        "cost_price": product.cost_price,
    }


def csv_order_number(row: dict) -> str:
    return csv_row_value(row, "order_no", "order_number", "order")


def csv_order_sku(row: dict) -> str:
    return csv_row_value(row, "sku", "article_no", "product_article_no", "product_sku")


def csv_order_product_name(row: dict) -> str:
    return csv_row_value(row, "product_name", "item_name", "item", "product")


def csv_order_unit_price_value(row: dict) -> str:
    return csv_row_value(
        row,
        "unit_price",
        "wholesale_price",
        "price",
        "line_unit_price",
        "selling_price",
    )


def csv_order_payout_value(row: dict) -> str:
    # Some order exports label the order payout as "Price".
    return csv_row_value(
        row,
        "payout_amount_usd",
        "payout_usd",
        "expected_payout_usd",
        "price",
    )


def is_faire_order_export(rows: list[dict]) -> bool:
    return any(
        csv_has_column(row, "retailer_name")
        and csv_has_column(row, "sku")
        and csv_has_column(row, "wholesale_price")
        for row in rows
    )


def clean_order_import_note(value: str) -> str | None:
    cleaned = str(value or "").strip().strip("'")
    if not cleaned or cleaned.lower() in CSV_BLANK_VALUES:
        return None
    return cleaned


def build_order_import_groups(rows: list[dict]) -> dict[str, dict]:
    grouped_rows: dict[str, dict] = {}

    for row in rows:
        line = row["__line_number"]
        order_no = csv_order_number(row)
        group_key = order_no or f"csv-row-{line}"
        grouped_rows.setdefault(
            group_key,
            {"key": group_key, "order_no": order_no, "line": line, "rows": []},
        )["rows"].append(row)

    return grouped_rows


def parse_order_import_datetime(value: str, field_name: str, line: int | str, issues: list[dict]) -> datetime | None:
    try:
        return parse_csv_datetime(value, field_name, line)
    except ValueError as exc:
        issues.append({"type": "invalid_date", "detail": str(exc)})
        return None


def build_order_import_context(db: Session) -> dict:
    customers = db.query(Customer).all()
    products = db.query(Product).all()
    products_by_name: dict[str, list[Product]] = {}
    for product in products:
        name_key = str(product.name or "").lower()
        if name_key:
            products_by_name.setdefault(name_key, []).append(product)

    return {
        "customer_lookup": customer_import_lookup(customers),
        "customers_by_id": {customer.id: customer for customer in customers},
        "product_lookup": {
            "by_id": {product.id: product for product in products},
            "by_article": {
                str(product.article_no or "").lower(): product
                for product in products
                if product.article_no
            },
            "unique_by_name": {
                name: matches[0]
                for name, matches in products_by_name.items()
                if len(matches) == 1
            },
        },
        "existing_order_numbers": {
            order_no
            for (order_no,) in db.query(Order.order_no).all()
            if order_no
        },
    }


def build_order_import_review(
    rows: list[dict],
    db: Session,
    preview_limit: int | None = None,
) -> dict:
    grouped_rows = build_order_import_groups(rows)
    faire_export = is_faire_order_export(rows)
    order_reviews = []
    missing_products_by_sku: dict[str, dict] = {}
    missing_customers_by_key: dict[str, dict] = {}
    context = build_order_import_context(db)
    preview_limit = max(int(preview_limit or 0), 0) or None

    for group in grouped_rows.values():
        first_row = group["rows"][0]
        line = group["line"]
        order_no = group["order_no"] or ""
        retailer_name = order_import_customer_name(first_row)
        customer_candidate = order_import_customer_candidate_from_row(first_row, retailer_name or order_no)
        customer, customer_match_reason = find_import_customer_match(
            first_row,
            db,
            context["customer_lookup"],
            context["customers_by_id"],
        )
        import_contact_name = clean_customer_import_value(order_import_contact_name(first_row))
        import_contact_phone = clean_customer_import_value(order_import_contact_phone(first_row))
        import_shipping_name = clean_customer_import_value(csv_order_shipping_name(first_row))
        import_shipping_address = clean_customer_import_value(csv_order_shipping_address(first_row))
        existing_order = bool(order_no and order_no in context["existing_order_numbers"])
        issues = []
        if not customer:
            issues.append(
                {
                    "type": "missing_customer",
                    "detail": "Customer not found. Import or create this retailer first.",
                }
            )
            customer_key = order_import_customer_key(customer_candidate, line)
            missing_customer = missing_customers_by_key.setdefault(
                customer_key,
                {
                    "key": customer_key,
                    **customer_candidate,
                    "orders_count": 0,
                    "order_keys": [],
                    "lines": [],
                },
            )
            missing_customer["orders_count"] += 1
            missing_customer["order_keys"].append(group["key"])
            missing_customer["lines"].append(line)
        if existing_order:
            issues.append(
                {
                    "type": "existing_order",
                    "detail": f"Order {order_no} already exists in ERP.",
                }
            )

        aggregated_items: dict[str, dict] = {}
        for item_row in group["rows"]:
            item_line = item_row["__line_number"]
            sku = csv_order_sku(item_row)
            product_name = csv_order_product_name(item_row)
            option_name = csv_row_value(item_row, "option_name", "option", "variant")
            product = find_import_product(item_row, db, context["product_lookup"])
            product_key = (
                normalized_customer_key(sku)
                or (f"product:{product.id}" if product else normalized_customer_key(product_name))
                or f"row:{item_line}"
            )
            quantity = 0
            try:
                quantity = parse_csv_int(
                    csv_row_value(item_row, "quantity", "qty", "units"),
                    "Quantity",
                    item_line,
                    default=1,
                    minimum=1,
                )
            except ValueError as exc:
                issues.append({"type": "invalid_quantity", "detail": str(exc)})

            unit_price = 0
            try:
                unit_price = parse_csv_float(
                    csv_order_unit_price_value(item_row),
                    "Unit price",
                    item_line,
                    default=float(product.selling_price or 0) if product else 0,
                )
            except ValueError as exc:
                issues.append({"type": "invalid_price", "detail": str(exc)})

            retail_price = 0
            try:
                retail_price = parse_csv_float(
                    csv_row_value(item_row, "retail_price"),
                    "Retail price",
                    item_line,
                    default=0,
                )
            except ValueError:
                retail_price = 0

            if not product:
                missing_detail = (
                    f"SKU {sku} was not found in ERP."
                    if sku
                    else f"Product not found on row {item_line}; SKU is missing."
                )
                issues.append({"type": "missing_product", "detail": missing_detail})
                if sku:
                    sku_key = normalized_customer_key(sku)
                    missing_entry = missing_products_by_sku.setdefault(
                        sku_key,
                        {
                            "sku": sku,
                            "name": product_name or sku,
                            "option_name": option_name,
                            "quantity": 0,
                            "wholesale_price": unit_price,
                            "retail_price": retail_price,
                            "rows": [],
                        },
                    )
                    missing_entry["quantity"] += quantity
                    missing_entry["rows"].append(item_line)
                    if product_name and not missing_entry.get("name"):
                        missing_entry["name"] = product_name
                    if retail_price and not missing_entry.get("retail_price"):
                        missing_entry["retail_price"] = retail_price
                    if unit_price and not missing_entry.get("wholesale_price"):
                        missing_entry["wholesale_price"] = unit_price

            stock_source_value = csv_row_value(item_row, "stock_source", "stock", "source", "warehouse") or "Factory"
            try:
                stock_source = normalize_import_stock_source(stock_source_value)
            except ValueError as exc:
                issues.append({"type": "invalid_stock_source", "detail": str(exc)})
                stock_source = "Factory"

            item = aggregated_items.setdefault(
                product_key,
                {
                    "sku": sku or (product.article_no if product else ""),
                    "product_name": product_name or (product.name if product else ""),
                    "option_name": option_name,
                    "quantity": 0,
                    "unit_price": unit_price,
                    "retail_price": retail_price,
                    "line_total": 0,
                    "stock_source": stock_source,
                    "product": order_import_product_snapshot(product) if product else None,
                    "missing_product": product is None,
                    "source_rows": [],
                },
            )
            item["quantity"] += quantity
            item["line_total"] += unit_price * quantity
            item["source_rows"].append(item_line)
            if quantity and item["line_total"]:
                item["unit_price"] = round(item["line_total"] / item["quantity"], 2)
            if retail_price:
                item["retail_price"] = retail_price

        items = list(aggregated_items.values())
        if not items:
            issues.append({"type": "missing_items", "detail": "Order has no product lines."})

        order_total = round(sum(float(item.get("line_total") or 0) for item in items), 2)
        total_quantity = sum(int(item.get("quantity") or 0) for item in items)
        payout_amount = 0.0
        payout_breakdown = (
            calculate_faire_payout_breakdown(order_total)
            if faire_export
            else {
                "order_total_usd": order_total,
                "platform_fee_usd": 0,
                "deduction_usd": 0,
                "expected_payout_usd": 0,
            }
        )
        payout_value = csv_order_payout_value(first_row)
        if payout_value:
            try:
                payout_amount = parse_csv_float(
                    payout_value,
                    "Payout amount",
                    line,
                    default=0,
                )
            except ValueError as exc:
                issues.append({"type": "invalid_payout", "detail": str(exc)})
        if faire_export:
            payout_amount = payout_breakdown["expected_payout_usd"]
        non_customer_issues = [
            issue for issue in issues if issue.get("type") != "missing_customer"
        ]
        order_reviews.append(
            {
                "key": group["key"],
                "line": line,
                "order_no": order_no,
                "retailer_name": retailer_name,
                "customer_id": customer.id if customer else None,
                "customer_name": (customer.company_name or customer.name) if customer else "",
                "import_customer_name": customer_candidate.get("name") or retailer_name or "",
                "import_customer_company_name": customer_candidate.get("company_name") or "",
                "import_contact_name": import_contact_name,
                "import_contact_phone": import_contact_phone,
                "import_shipping_name": import_shipping_name,
                "import_shipping_address": import_shipping_address,
                "customer_match_reason": customer_match_reason,
                "customer_candidate": None if customer else customer_candidate,
                "platform": "Faire" if faire_export else (
                    csv_row_value(first_row, "platform", "source") or (customer.platform if customer else "Manual") or "Manual"
                ),
                "status": csv_row_value(first_row, "shipping_status", "fulfillment_status", "status") or "Pending",
                "order_date": parse_order_import_datetime(
                    csv_order_date_value(first_row),
                    "Order date",
                    line,
                    issues,
                ),
                "ship_date": parse_order_import_datetime(
                    csv_ship_date_value(first_row),
                    "Ship date",
                    line,
                    issues,
                ),
                "notes": clean_order_import_note(csv_row_value(first_row, "notes", "note")) or "",
                "line_count": len(items),
                "total_quantity": total_quantity,
                "order_total_usd": payout_breakdown["order_total_usd"],
                "platform_fee_usd": payout_breakdown["platform_fee_usd"],
                "deduction_usd": payout_breakdown["deduction_usd"],
                "expected_payout_usd": payout_breakdown["expected_payout_usd"],
                "payout_amount_usd": round(payout_amount, 2),
                "can_import": len(issues) == 0,
                "can_import_with_customer_later": bool(not customer and not non_customer_issues),
                "issues": issues,
                "items": items,
            }
        )

    importable_orders = sum(1 for order in order_reviews if order["can_import"])
    issue_count = sum(len(order.get("issues") or []) for order in order_reviews)
    customer_later_orders_count = sum(
        1 for order in order_reviews if order.get("can_import_with_customer_later")
    )
    preview_orders = order_reviews[:preview_limit] if preview_limit else order_reviews
    return {
        "total_rows": len(rows),
        "orders_count": len(order_reviews),
        "importable_orders": importable_orders,
        "blocked_orders": len(order_reviews) - importable_orders,
        "issue_count": issue_count,
        "customer_later_orders_count": customer_later_orders_count,
        "preview_count": len(preview_orders),
        "orders_truncated": len(preview_orders) < len(order_reviews),
        "items_count": sum(order["line_count"] for order in order_reviews),
        "total_quantity": sum(order["total_quantity"] for order in order_reviews),
        "missing_products_count": len(missing_products_by_sku),
        "missing_products": sorted(
            missing_products_by_sku.values(),
            key=lambda item: item["sku"].lower(),
        ),
        "missing_customers_count": len(missing_customers_by_key),
        "missing_customers": sorted(
            missing_customers_by_key.values(),
            key=lambda item: (item.get("name") or item.get("company_name") or "").lower(),
        ),
        "source_format": "Faire orders" if faire_export else "CSV",
        "orders": preview_orders,
    }


class OrderImportProductRequest(BaseModel):
    sku: str
    name: str | None = None
    wholesale_price: float | None = 0
    retail_price: float | None = 0


class OrderImportMissingProductsRequest(BaseModel):
    products: list[OrderImportProductRequest] = Field(default_factory=list)


class OrderImportCustomerRequest(BaseModel):
    name: str | None = None
    company_name: str | None = None
    email: str | None = None
    phone: str | None = None
    country: str | None = None
    address: str | None = None
    shipping_address: str | None = None
    platform: str | None = "Manual"


class OrderImportMissingCustomersRequest(BaseModel):
    customers: list[OrderImportCustomerRequest] = Field(default_factory=list)


def ensure_unassigned_import_customer(db: Session) -> Customer:
    customer = (
        db.query(Customer)
        .filter(
            func.lower(Customer.name) == ORDER_IMPORT_UNASSIGNED_CUSTOMER_NAME.lower(),
            func.lower(Customer.company_name) == ORDER_IMPORT_UNASSIGNED_CUSTOMER_COMPANY.lower(),
        )
        .first()
    )
    if customer:
        return customer

    customer = Customer(
        name=ORDER_IMPORT_UNASSIGNED_CUSTOMER_NAME,
        company_name=ORDER_IMPORT_UNASSIGNED_CUSTOMER_COMPANY,
        platform=ORDER_IMPORT_UNASSIGNED_CUSTOMER_PLATFORM,
    )
    db.add(customer)
    db.flush()
    return customer


def order_import_review_for_customer_later(order_review: dict, customer: Customer) -> dict:
    updated = {**order_review}
    updated["customer_id"] = customer.id
    updated["customer_name"] = customer.name
    updated["issues"] = [
        issue
        for issue in order_review.get("issues", [])
        if issue.get("type") != "missing_customer"
    ]
    updated["can_import"] = len(updated["issues"]) == 0
    candidate = order_review.get("customer_candidate") or {}
    updated["import_customer_name"] = (
        candidate.get("name")
        or order_review.get("import_customer_name")
        or order_review.get("retailer_name")
        or "Unknown customer"
    )
    updated["import_customer_company_name"] = (
        candidate.get("company_name")
        or order_review.get("import_customer_company_name")
        or None
    )
    updated["import_contact_name"] = order_review.get("import_contact_name")
    updated["import_contact_phone"] = order_review.get("import_contact_phone")
    updated["import_shipping_name"] = order_review.get("import_shipping_name")
    updated["import_shipping_address"] = order_review.get("import_shipping_address")
    imported_name = (
        updated["import_customer_company_name"]
        or updated["import_customer_name"]
        or "Unknown customer"
    )
    note = (
        "Customer needs assignment."
        f" Imported customer from CSV: {imported_name}."
    )
    existing_note = str(order_review.get("notes") or "").strip()
    updated["notes"] = "\n".join(part for part in [existing_note, note] if part)
    return updated


def build_order_payload_from_import_review(order_review: dict, first_row: dict) -> OrderCreate:
    items = [
        {
            "product_id": item["product"]["id"],
            "quantity": int(item.get("quantity") or 0),
            "unit_price": float(item.get("unit_price") or 0),
            "stock_source": item.get("stock_source") or "Factory",
        }
        for item in order_review.get("items", [])
        if item.get("product")
    ]
    line = order_review.get("line") or first_row.get("__line_number") or "?"
    order_total = parse_csv_float(
        csv_row_value(first_row, "order_total_usd", "order_usd", "order_total", "total"),
        "Order total USD",
        line,
        default=float(order_review.get("order_total_usd") or 0),
    )
    platform = order_review.get("platform") or "Manual"
    faire_breakdown = (
        calculate_faire_payout_breakdown(order_total)
        if is_faire_platform(platform)
        else None
    )
    platform_fee = (
        faire_breakdown["platform_fee_usd"]
        if faire_breakdown
        else parse_csv_float(
            csv_row_value(first_row, "platform_fee_usd", "fee_usd"),
            "Platform fee USD",
            line,
            default=float(order_review.get("platform_fee_usd") or 0),
        )
    )
    deduction = (
        faire_breakdown["deduction_usd"]
        if faire_breakdown
        else parse_csv_float(
            csv_row_value(first_row, "deduction_usd", "deductions_usd"),
            "Deduction USD",
            line,
            default=float(order_review.get("deduction_usd") or 0),
        )
    )
    payout_received_date = parse_csv_datetime(
        csv_row_value(first_row, "payout_received_date", "released_date", "paid_date"),
        "Payout received date",
        line,
    )
    payout_value = csv_order_payout_value(first_row)
    payout_amount = parse_csv_float(
        payout_value,
        "Payout amount",
        line,
        default=0,
    )
    received_payout = parse_csv_float(
        csv_row_value(first_row, "received_payout_usd", "received_usd"),
        "Received payout",
        line,
        default=(
            faire_breakdown["expected_payout_usd"]
            if faire_breakdown and payout_received_date
            else payout_amount if payout_received_date and payout_amount > 0 else 0
        ),
    )
    if faire_breakdown:
        expected_payout = faire_breakdown["expected_payout_usd"]
    else:
        expected_payout = parse_csv_float(
            csv_row_value(first_row, "expected_payout_usd", "expected_usd") or payout_value,
            "Expected payout",
            line,
            default=float(order_review.get("expected_payout_usd") or payout_amount),
        )
    remaining_payout = parse_csv_float(
        csv_row_value(first_row, "remaining_payout_usd", "remaining_usd"),
        "Remaining payout",
        line,
        default=max(expected_payout - received_payout, 0),
    )
    payout_status = csv_row_value(first_row, "payout_status") or (
        "Received" if received_payout > 0 else "Not Received"
    )

    return OrderCreate(
        order_no=order_review.get("order_no") or None,
        customer_id=int(order_review["customer_id"]),
        import_customer_name=order_review.get("import_customer_name") or None,
        import_customer_company_name=order_review.get("import_customer_company_name") or None,
        import_contact_name=order_review.get("import_contact_name") or None,
        import_contact_phone=order_review.get("import_contact_phone") or None,
        import_shipping_name=order_review.get("import_shipping_name") or None,
        import_shipping_address=order_review.get("import_shipping_address") or None,
        import_ship_date=order_review.get("ship_date"),
        platform=platform,
        order_date=order_review.get("order_date"),
        payment_status=csv_row_value(first_row, "payment_status") or "Pending",
        shipping_status=order_review.get("status") or "Pending",
        notes=order_review.get("notes") or None,
        order_total_usd=order_total,
        platform_fee_usd=platform_fee,
        deduction_usd=deduction,
        expected_payout_usd=expected_payout,
        expected_payout_date=parse_csv_datetime(
            csv_row_value(first_row, "expected_payout_date", "payout_date"),
            "Expected payout date",
            line,
        ),
        payment_source=csv_row_value(first_row, "payment_source") or None,
        payout_status=payout_status,
        received_payout_usd=received_payout,
        remaining_payout_usd=remaining_payout,
        exchange_rate=parse_csv_float(
            csv_row_value(first_row, "exchange_rate", "usd_rate"),
            "Exchange rate",
            line,
            default=0,
        ),
        received_pkr=parse_csv_float(
            csv_row_value(first_row, "received_pkr"),
            "Received PKR",
            line,
            default=0,
        ),
        bank_charges_pkr=parse_csv_float(
            csv_row_value(first_row, "bank_charges_pkr", "bank_charges"),
            "Bank charges PKR",
            line,
            default=0,
        ),
        final_received_pkr=parse_csv_float(
            csv_row_value(first_row, "final_received_pkr", "final_pkr"),
            "Final received PKR",
            line,
            default=0,
        ),
        payout_notes=csv_row_value(first_row, "payout_notes") or None,
        payout_received_date=payout_received_date,
        items=items,
    )


# Orders API
STOCK_DEDUCTED_SHIPPING_STATUSES = {"shipped", "dispatched", "in transit", "delivered"}
ORDER_WORKFLOW_TASK_TYPES = {"preparation": "Preparation", "shipping": "Shipping"}
ORDER_WORKFLOW_OPEN_STATUSES = {"New", "Ready", "In Progress", "Pending Verification"}
FOLLOW_UP_STATUSES = {"Pending", "Followed Up", "Review Provided", "No Review", "Closed"}


def is_stock_deducted_shipping_status(status: str | None) -> bool:
    return str(status or "").strip().lower() in STOCK_DEDUCTED_SHIPPING_STATUSES


ORDER_EXPORT_CANCELED_STATUSES = {"canceled", "cancelled"}
ORDER_EXPORT_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ORDER_EXPORT_PRODUCT_COLUMNS = [
    ("image", "Image", 15),
    ("sku", "SKU", 16),
    ("price_pkr", "Price PKR", 14),
    ("stock", "Stock", 13),
    ("usa_stock", "USA Stock", 13),
    ("reserved", "Reserved", 13),
    ("manufacturing", "Manufacturing", 18),
    ("cost_pkr", "Cost PKR", 14),
    ("sold", "Sold", 11),
]
ORDER_EXPORT_THUMBNAIL_WIDTH_PX = 84
ORDER_EXPORT_THUMBNAIL_HEIGHT_PX = 62
ORDER_EXPORT_IMAGE_EMU_PER_PIXEL = 9525
ORDER_EXPORT_FROZEN_COLUMNS = 2
ORDER_EXPORT_IMAGE_CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
}
ORDER_EXPORT_FALSE_VALUES = {"0", "false", "no", "off", "without", "none"}


def normalize_order_export_thumbnail_flag(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in ORDER_EXPORT_FALSE_VALUES
    return bool(value)


def order_export_product_columns(include_thumbnails: bool) -> list[tuple[str, str, int]]:
    include_thumbnails = normalize_order_export_thumbnail_flag(include_thumbnails)
    if include_thumbnails:
        return ORDER_EXPORT_PRODUCT_COLUMNS
    return [
        column
        for column in ORDER_EXPORT_PRODUCT_COLUMNS
        if column[0] != "image"
    ]


def order_export_group(order: Order) -> str:
    order_status = str(order.status or "").strip().lower()
    shipping_status = str(order.shipping_status or "").strip().lower()
    if order_status in ORDER_EXPORT_CANCELED_STATUSES or shipping_status in ORDER_EXPORT_CANCELED_STATUSES:
        return "Canceled"
    if is_stock_deducted_shipping_status(order.shipping_status):
        return "Fulfilled"
    return "Unfulfilled"


def order_export_items_text(order: Order) -> str:
    parts = []
    for item in order.items or []:
        product = item.product
        article_no = product.article_no if product else ""
        product_name = product.name if product else ""
        label = " ".join(part for part in [article_no, product_name] if part).strip()
        quantity = item.quantity or 0
        parts.append(f"{quantity} x {label or 'Item'}")
    return "; ".join(parts)


def order_export_total_quantity(order: Order) -> int:
    return sum(int(item.quantity or 0) for item in order.items or [])


def order_export_matches(
    order: Order,
    shipping: Shipping | None,
    status: str,
    search: str | None,
    privacy: dict | None = None,
) -> bool:
    status_filter = (status or "All").strip()
    if status_filter != "All" and order_export_group(order) != status_filter:
        return False

    query = (search or "").strip().lower()
    if not query:
        return True

    customer = order.customer
    values = [
        order.order_no,
        order.status,
        order.shipping_status,
        order.payment_status,
        order.payout_status,
        order.platform,
        order.notes,
        order.import_customer_name,
        order.import_contact_name,
        order.import_contact_phone,
        order.import_shipping_name,
        order.import_shipping_address,
        customer_personal_label(customer, order) if customer or order else "",
        privacy_customer_phone(customer, privacy),
        customer.address if customer else "",
        customer.shipping_address if customer else "",
        shipping.courier_name if shipping else "",
        shipping.tracking_number if shipping else "",
    ]
    if not access_privacy_hides_customer_business(privacy):
        values.extend([
            order.import_customer_company_name,
            customer.company_name if customer else "",
        ])
    for item in order.items or []:
        product = item.product
        values.extend([
            product.article_no if product else "",
            product.name if product else "",
            item.stock_source,
        ])

    return any(query in str(value or "").lower() for value in values)


def clean_xlsx_text(value) -> str:
    text = str(value or "")
    return "".join(
        char
        for char in text
        if char in ("\t", "\n", "\r") or ord(char) >= 32
    )


def xlsx_col_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def xlsx_col_index(name: str) -> int:
    index = 0
    for char in str(name or "").strip().upper():
        if char < "A" or char > "Z":
            return 0
        index = (index * 26) + (ord(char) - 64)
    return index


def xlsx_cell_ref(row: int, column: int) -> str:
    return f"{xlsx_col_name(column)}{row}"


def excel_date_serial(value: datetime) -> float:
    if value.tzinfo is not None:
        value = value.replace(tzinfo=None)
    epoch = datetime(1899, 12, 30)
    delta = value - epoch
    return delta.days + (delta.seconds + delta.microseconds / 1_000_000) / 86_400


def xlsx_number(value) -> str:
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return f"{number:.10f}".rstrip("0").rstrip(".")


class XlsxFormula:
    def __init__(self, formula: str):
        self.formula = str(formula or "").lstrip("=")


def xlsx_formula(formula: str) -> XlsxFormula:
    return XlsxFormula(formula)


def xlsx_cell_display_text(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, XlsxFormula):
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return xlsx_number(value)
    return clean_xlsx_text(value)


def xlsx_cell(row: int, column: int, value, style: int = 6) -> str:
    ref = xlsx_cell_ref(row, column)
    style_attr = f' s="{style}"' if style is not None else ""

    if value is None or value == "":
        return f'<c r="{ref}"{style_attr}/>'

    if isinstance(value, XlsxFormula):
        formula = xml_escape(value.formula)
        return f'<c r="{ref}"{style_attr}><f>{formula}</f></c>'

    if isinstance(value, datetime):
        return f'<c r="{ref}"{style_attr}><v>{xlsx_number(excel_date_serial(value))}</v></c>'

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return f'<c r="{ref}"{style_attr}><v>{xlsx_number(value)}</v></c>'

    text = clean_xlsx_text(value)
    escaped = xml_escape(text)
    space_attr = ' xml:space="preserve"' if text != text.strip() else ""
    return f'<c r="{ref}"{style_attr} t="inlineStr"><is><t{space_attr}>{escaped}</t></is></c>'


def xlsx_row(row_index: int, cells: list[tuple[object, int]], start_column: int = 1, height: float | None = None) -> str:
    rendered = [
        xlsx_cell(row_index, start_column + index, value, style)
        for index, (value, style) in enumerate(cells)
    ]
    height_attr = f' ht="{height}" customHeight="1"' if height else ""
    return f'<row r="{row_index}"{height_attr}>{"".join(rendered)}</row>'


def xlsx_sparse_row(row_index: int, cells: list[tuple[int, object, int]], height: float | None = None) -> str:
    rendered = [xlsx_cell(row_index, column, value, style) for column, value, style in cells]
    height_attr = f' ht="{height}" customHeight="1"' if height else ""
    return f'<row r="{row_index}"{height_attr}>{"".join(rendered)}</row>'


ORDER_EXPORT_AUTOFIT_WRAP_STYLES = {5, 14}


def order_export_row_payload_cells(payload: dict) -> list[tuple[int, object, int]]:
    if payload["kind"] == "sparse":
        return payload["cells"]
    start_column = payload.get("start_column", 1)
    return [
        (start_column + index, value, style)
        for index, (value, style) in enumerate(payload["cells"])
    ]


def order_export_fit_column_widths(row_payloads: list[dict], last_column: int, fixed_columns: int) -> list[float]:
    widths = [8.0] * last_column
    minimums = [8.0] * last_column
    maximums = [34.0] * last_column

    if fixed_columns:
        minimums[0] = 12.0
        maximums[0] = 28.0
    for index in range(1, fixed_columns):
        minimums[index] = 9.0
        maximums[index] = 18.0
    for index in range(fixed_columns, last_column):
        minimums[index] = 10.0
        maximums[index] = 42.0

    for payload in row_payloads:
        for column, value, _style in order_export_row_payload_cells(payload):
            if column < 1 or column > last_column:
                continue
            text = xlsx_cell_display_text(value)
            if not text:
                continue
            longest_line = max((len(line) for line in text.splitlines()), default=0)
            candidate_width = min(max(longest_line + 2, minimums[column - 1]), maximums[column - 1])
            widths[column - 1] = max(widths[column - 1], candidate_width)

    return [round(width, 1) for width in widths]


def order_export_fit_row_height(payload: dict, column_widths: list[float]) -> float:
    base_height = 18.0
    max_lines = 1

    for column, value, style in order_export_row_payload_cells(payload):
        text = xlsx_cell_display_text(value)
        if not text:
            continue
        lines = text.splitlines() or [text]
        line_count = len(lines)
        if style in ORDER_EXPORT_AUTOFIT_WRAP_STYLES and 1 <= column <= len(column_widths):
            width = max(column_widths[column - 1] - 1, 6)
            line_count = sum(max(1, math.ceil(len(line) / width)) for line in lines)
        max_lines = max(max_lines, line_count)

    return min(base_height + ((max_lines - 1) * 14), 116.0)


def order_export_render_row_payload(payload: dict, column_widths: list[float] | None = None) -> str:
    height = payload.get("height")
    if column_widths is not None:
        height = order_export_fit_row_height(payload, column_widths)
    if payload["kind"] == "sparse":
        return xlsx_sparse_row(payload["row"], payload["cells"], height=height)
    return xlsx_row(
        payload["row"],
        payload["cells"],
        start_column=payload.get("start_column", 1),
        height=height,
    )


def orders_export_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="#,##0.00"/>
    <numFmt numFmtId="165" formatCode="&quot;PKR&quot; #,##0.00"/>
    <numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>
    <numFmt numFmtId="167" formatCode="0.00"/>
  </numFmts>
  <fonts count="6">
    <font><sz val="12"/><color rgb="FF17202A"/><name val="Calibri"/></font>
    <font><b/><sz val="22"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><sz val="11"/><color rgb="FF64748B"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF475569"/><name val="Calibri"/></font>
  </fonts>
  <fills count="11">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF5F3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD6ECE8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFBFCFD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFEEF2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF7EA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD6DEE6"/></left><right style="thin"><color rgb="FFD6DEE6"/></right><top style="thin"><color rgb="FFD6DEE6"/></top><bottom style="thin"><color rgb="FFD6DEE6"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF8CCBC4"/></left><right style="thin"><color rgb="FF8CCBC4"/></right><top style="thin"><color rgb="FF8CCBC4"/></top><bottom style="thin"><color rgb="FF8CCBC4"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="16">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="10" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="164" fontId="0" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="165" fontId="0" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="1" fontId="0" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="166" fontId="0" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
    <xf numFmtId="0" fontId="4" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="4" fillId="9" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium9"/>
</styleSheet>"""


def order_export_customer_label(order: Order, privacy: dict | None = None) -> str:
    customer = order.customer
    customer_label, _customer_company_label = privacy_order_customer_labels(
        order,
        customer,
        is_unassigned_import_customer(customer),
        privacy,
    )
    return customer_label or "Unknown customer"


def order_export_order_label(order: Order, privacy: dict | None = None) -> str:
    date_text = order.order_date.strftime("%Y-%m-%d") if order.order_date else ""
    return "\n".join(
        part
        for part in [
            order.order_no or "Order",
            order_export_customer_label(order, privacy),
            date_text,
        ]
        if part
    )


def order_export_product_sort_key(product: Product) -> tuple[str, str, str]:
    return (
        str(product.category or "Uncategorized").strip().lower(),
        str(product.article_no or "").strip().lower(),
        str(product.name or "").strip().lower(),
    )


def order_export_image_path(product: Product):
    image_url = str(product.image_url or "").strip()
    if not image_url:
        return None

    path_text = urlparse(image_url).path if image_url.startswith(("http://", "https://")) else image_url
    path_text = path_text.replace("\\", "/")
    if path_text.startswith("/static/"):
        relative = path_text[len("/static/"):]
    elif path_text.startswith("static/"):
        relative = path_text[len("static/"):]
    elif path_text.startswith("/uploads/"):
        relative = path_text.lstrip("/")
    elif path_text.startswith("uploads/"):
        relative = path_text
    else:
        return None

    try:
        candidate = (STATIC_DIR / relative).resolve()
        candidate.relative_to(STATIC_DIR.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def order_export_image_extension(image: dict) -> str:
    extension = str(image.get("extension") or "png").strip().lower().lstrip(".")
    if extension in {"jpeg", "jpg"}:
        return "jpg"
    return extension if extension in ORDER_EXPORT_IMAGE_CONTENT_TYPES else "png"


def order_export_image_content_type(image: dict) -> str:
    return ORDER_EXPORT_IMAGE_CONTENT_TYPES.get(order_export_image_extension(image), "image/png")


def order_export_raw_image_payload(image_path) -> dict | None:
    try:
        data = image_path.read_bytes()
    except OSError:
        return None

    extension = image_path.suffix.lower().lstrip(".")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        extension = "png"
    elif data.startswith(b"\xff\xd8"):
        extension = "jpg"
    elif extension == "jpeg":
        extension = "jpg"

    if extension not in ORDER_EXPORT_IMAGE_CONTENT_TYPES:
        return None

    return {
        "data": data,
        "extension": extension,
        "content_type": ORDER_EXPORT_IMAGE_CONTENT_TYPES[extension],
    }


def order_export_thumbnail_image(product: Product) -> dict | None:
    image_path = order_export_image_path(product)
    if image_path is None:
        return None

    try:
        from PIL import Image, ImageOps

        with Image.open(image_path) as image:
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image.thumbnail(
                (ORDER_EXPORT_THUMBNAIL_WIDTH_PX, ORDER_EXPORT_THUMBNAIL_HEIGHT_PX),
                Image.Resampling.LANCZOS,
            )
            canvas = Image.new(
                "RGBA",
                (ORDER_EXPORT_THUMBNAIL_WIDTH_PX, ORDER_EXPORT_THUMBNAIL_HEIGHT_PX),
                (255, 255, 255, 0),
            )
            left = (ORDER_EXPORT_THUMBNAIL_WIDTH_PX - image.width) // 2
            top = (ORDER_EXPORT_THUMBNAIL_HEIGHT_PX - image.height) // 2
            canvas.alpha_composite(image, (left, top))
            output = io.BytesIO()
            canvas.save(output, format="PNG", optimize=True)
            return {
                "data": output.getvalue(),
                "extension": "png",
                "content_type": "image/png",
            }
    except Exception:
        return order_export_raw_image_payload(image_path)


def order_export_quantity_map(orders: list[Order]) -> dict[int, dict[int, int]]:
    quantities: dict[int, dict[int, int]] = {}
    for order in orders:
        for item in order.items or []:
            if not item.product_id:
                continue
            product_quantities = quantities.setdefault(int(item.product_id), {})
            product_quantities[order.id] = product_quantities.get(order.id, 0) + int(item.quantity or 0)
    return quantities


def order_export_manufacturing_map(orders: list[Order]) -> dict[int, int]:
    quantities: dict[int, int] = {}
    for order in orders:
        for item in order.items or []:
            if not item.product_id:
                continue
            stock_source = str(item.stock_source or "").strip().lower()
            if item.manufacturing_required or stock_source in {"manufacturing", "production", "make"}:
                quantities[int(item.product_id)] = quantities.get(int(item.product_id), 0) + int(item.quantity or 0)
    return quantities


def order_export_display_number(value, default: object = ""):
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return default
    if not number:
        return default
    return int(number) if number.is_integer() else round(number, 2)


def order_export_money_value(*values):
    for value in values:
        try:
            number = float(value or 0)
        except (TypeError, ValueError):
            continue
        if number:
            return round(number, 2)
    return ""


def order_export_usd_to_pkr(exchange_rate, *values):
    rate = order_export_money_value(exchange_rate)
    if not rate:
        return ""
    total_usd = 0.0
    for value in values:
        try:
            total_usd += float(value or 0)
        except (TypeError, ValueError):
            continue
    if not total_usd:
        return ""
    return round(total_usd * float(rate), 2)


def order_export_address_parts(address_value) -> tuple[str, str]:
    if isinstance(address_value, Customer):
        address_text = address_value.address
    else:
        address_text = address_value

    if not address_text:
        return "", ""

    parts = [
        part.strip()
        for part in re.split(r"[\r\n]+|,\s*", str(address_text))
        if part.strip()
    ]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], ", ".join(parts[1:])


def order_export_contact_text(
    customer: Customer | None,
    privacy: dict | None = None,
) -> str:
    if not customer:
        return ""
    values = [privacy_customer_phone(customer, privacy), customer.email]
    return " / ".join(str(value).strip() for value in values if str(value or "").strip())


def order_export_order_contact_text(
    order: Order,
    customer: Customer | None,
    privacy: dict | None = None,
) -> str:
    values = [order.import_contact_name, privacy_order_contact_phone(order, privacy), order_export_contact_text(customer, privacy)]
    return " / ".join(str(value).strip() for value in values if str(value or "").strip())


def order_export_weight_text(shipping: Shipping | None) -> str:
    if not shipping or shipping.package_weight_kg in (None, ""):
        return ""
    try:
        weight = float(shipping.package_weight_kg or 0)
    except (TypeError, ValueError):
        return str(shipping.package_weight_kg or "")
    if not weight:
        return ""
    return f"{xlsx_number(weight)} KG"


def order_export_order_summary(order: Order) -> str:
    quantity_by_category: dict[str, int] = {}
    for item in order.items or []:
        product = item.product
        category = str(product.category if product else "").strip() or "Uncategorized"
        quantity_by_category[category] = quantity_by_category.get(category, 0) + int(item.quantity or 0)
    return ", ".join(
        f"{quantity} {category}"
        for category, quantity in quantity_by_category.items()
        if quantity
    )


def order_export_detail_value(
    key: str,
    order: Order,
    shipping: Shipping | None,
    detail_rows: dict[str, int],
    column: int,
    privacy: dict | None = None,
):
    customer = order.customer
    street, postal = order_export_address_parts(
        order.import_shipping_address
        or (customer.shipping_address if customer else "")
        or (customer.address if customer else "")
    )
    total_quantity = order_export_total_quantity(order)
    income_usd = order_export_money_value(
        order.received_payout_usd,
        order.expected_payout_usd,
        order.order_total_usd,
        order.total_amount,
    )
    shipping_cost = order_export_money_value(shipping.shipping_cost if shipping else None)
    manufacturing_qty = sum(
        int(item.quantity or 0)
        for item in order.items or []
        if item.manufacturing_required or str(item.stock_source or "").strip().lower() in {"manufacturing", "production", "make"}
    )
    bank_charges = order_export_money_value(order.bank_charges_pkr)
    exchange_rate = order_export_money_value(order.exchange_rate)
    deduction_pkr = order_export_usd_to_pkr(exchange_rate, order.platform_fee_usd, order.deduction_usd)

    if key == "status":
        return order.shipping_status or order.status or ""
    if key == "payment":
        return order.payment_status or ""
    if key == "trade_status":
        return order.payout_status or ""
    if key == "review":
        return order.payout_notes or ""
    if key == "manufacturing":
        return manufacturing_qty or ""
    if key == "shipping":
        return shipping.courier_name if shipping else ""
    if key == "income_pkr":
        direct_value = order_export_money_value(order.final_received_pkr, order.received_pkr)
        if direct_value:
            return direct_value
        if income_usd and exchange_rate:
            return round(float(income_usd) * float(exchange_rate), 2)
        return ""
    if key == "expense":
        total_expense = sum(float(value or 0) for value in [shipping_cost or 0, bank_charges or 0, deduction_pkr or 0])
        return round(total_expense, 2) if total_expense else ""
    if key == "total_profit":
        income_cell = xlsx_cell_ref(detail_rows["income_pkr"], column)
        expense_cell = xlsx_cell_ref(detail_rows["expense"], column)
        return xlsx_formula(f"{income_cell}-{expense_cell}")
    if key == "profit":
        return xlsx_formula(f"{xlsx_cell_ref(detail_rows['total_profit'], column)}*80%")
    if key == "trade_profit":
        return xlsx_formula(f"{xlsx_cell_ref(detail_rows['total_profit'], column)}*10%")
    if key == "order_date":
        return order.order_date or ""
    if key == "ship_date":
        return shipping.shipped_at if shipping else ""
    if key == "delivered_date":
        return shipping.shipped_at if is_stock_deducted_shipping_status(order.shipping_status) and shipping else ""
    if key == "tracking":
        return shipping.tracking_number if shipping else ""
    if key == "weight":
        return order_export_weight_text(shipping)
    if key == "duty":
        return shipping.shipping_note if shipping else ""
    if key == "items":
        return order_export_order_summary(order)
    if key == "shop":
        return order_export_customer_label(order, privacy)
    if key == "name":
        return customer_personal_label(customer, order) if customer or order else ""
    if key == "street":
        return street
    if key == "postal":
        return postal
    if key == "country":
        return customer.country if customer else ""
    if key == "contact":
        return order_export_order_contact_text(order, customer, privacy)
    if key == "area":
        return customer.platform if customer else ""
    if key == "shipping_city":
        return ""
    if key == "shipping_cost":
        return shipping_cost
    if key == "notes":
        return order.notes or ""
    if key == "total_quantity":
        return total_quantity or ""
    return ""


def order_export_detail_style(key: str, value) -> int:
    if key in {"order_date", "ship_date", "delivered_date"}:
        return 10
    if key in {"income_pkr", "expense", "total_profit", "profit", "trade_profit", "shipping_cost"}:
        return 8
    if key in {"manufacturing", "total_quantity"}:
        return 9
    if key in {"items", "street", "postal", "notes", "contact"}:
        return 14
    return 6


def order_export_view_cell_ref_position(ref: str) -> tuple[int, int] | None:
    match = re.fullmatch(r"([A-Z]+)(\d+)", str(ref or "").strip().upper())
    if not match:
        return None
    column = xlsx_col_index(match.group(1))
    row = int(match.group(2))
    if not row or not column:
        return None
    return row, column


def order_export_view_numeric_cell(
    raw_grid: dict[tuple[int, int], object],
    row: int,
    column: int,
    seen: set[tuple[int, int]] | None = None,
) -> float | None:
    seen = set(seen or set())
    key = (row, column)
    if key in seen:
        return None
    seen.add(key)

    value = raw_grid.get(key)
    if isinstance(value, XlsxFormula):
        return order_export_view_formula_value(value.formula, raw_grid, seen)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return float(value)
    return None


def order_export_view_formula_value(
    formula: str,
    raw_grid: dict[tuple[int, int], object],
    seen: set[tuple[int, int]] | None = None,
) -> float | None:
    formula_text = str(formula or "").lstrip("=").replace(" ", "").upper()

    sum_match = re.fullmatch(r"SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)", formula_text)
    if sum_match:
        start_column = xlsx_col_index(sum_match.group(1))
        start_row = int(sum_match.group(2))
        end_column = xlsx_col_index(sum_match.group(3))
        end_row = int(sum_match.group(4))
        if not start_column or not end_column:
            return None
        total = 0.0
        for row in range(min(start_row, end_row), max(start_row, end_row) + 1):
            for column in range(min(start_column, end_column), max(start_column, end_column) + 1):
                value = order_export_view_numeric_cell(raw_grid, row, column, set(seen or set()))
                if value is not None:
                    total += value
        return total

    subtract_match = re.fullmatch(r"([A-Z]+\d+)-([A-Z]+\d+)", formula_text)
    if subtract_match:
        left_position = order_export_view_cell_ref_position(subtract_match.group(1))
        right_position = order_export_view_cell_ref_position(subtract_match.group(2))
        if not left_position or not right_position:
            return None
        left = order_export_view_numeric_cell(raw_grid, *left_position, set(seen or set())) or 0.0
        right = order_export_view_numeric_cell(raw_grid, *right_position, set(seen or set())) or 0.0
        return left - right

    percent_match = re.fullmatch(r"([A-Z]+\d+)\*(\d+(?:\.\d+)?)%", formula_text)
    if percent_match:
        position = order_export_view_cell_ref_position(percent_match.group(1))
        if not position:
            return None
        base = order_export_view_numeric_cell(raw_grid, *position, set(seen or set()))
        if base is None:
            return None
        return base * (float(percent_match.group(2)) / 100)

    return None


def order_export_view_number_text(value: float, style: int | None = None) -> str:
    number = float(value)
    if style == 8:
        return f"PKR {number:,.2f}"
    if number.is_integer():
        return f"{int(number):,}"
    return f"{number:,.2f}".rstrip("0").rstrip(".")


def order_export_view_cell_display(
    value,
    raw_grid: dict[tuple[int, int], object],
    row: int,
    column: int,
    style: int | None = None,
) -> tuple[str, object]:
    if isinstance(value, XlsxFormula):
        computed = order_export_view_formula_value(value.formula, raw_grid, {(row, column)})
        if computed is None:
            return f"={value.formula}", None
        return order_export_view_number_text(computed, style), computed
    if value is None or value == "":
        return "", None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d"), value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return order_export_view_number_text(float(value), style), value
    return clean_xlsx_text(value), value


def order_export_view_response(sheet_payload: dict) -> dict:
    row_payloads = sheet_payload["row_payloads"]
    last_column = int(sheet_payload["last_column"])
    raw_grid: dict[tuple[int, int], object] = {}
    style_grid: dict[tuple[int, int], int] = {}
    row_heights: dict[int, float] = {}

    for payload in row_payloads:
        row = int(payload["row"])
        if payload.get("height"):
            row_heights[row] = payload["height"]
        for column, value, style in order_export_row_payload_cells(payload):
            raw_grid[(row, column)] = value
            style_grid[(row, column)] = style

    product_rows = sheet_payload.get("product_rows") or {}
    header_row = int(sheet_payload["header_row"])
    total_row = int(sheet_payload["total_row"])
    detail_start_row = int(sheet_payload["detail_start_row"])
    row_count = int(sheet_payload["row_count"])

    def row_kind(row: int) -> str:
        first_value = raw_grid.get((row, 1), "")
        first_style = style_grid.get((row, 1))
        if row == 1:
            return "title"
        if row == header_row:
            return "header"
        if row == total_row:
            return "total"
        if row >= detail_start_row:
            return "spacer" if first_style == 11 else "detail"
        if first_style == 5 and isinstance(first_value, str):
            return "category"
        return "product" if row in product_rows else "body"

    header_cells = {
        column: order_export_view_cell_display(
            raw_grid.get((header_row, column), ""),
            raw_grid,
            header_row,
            column,
            style_grid.get((header_row, column), 6),
        )[0]
        for column in range(1, last_column + 1)
    }

    rows = []
    for row in range(1, row_count + 1):
        cells = []
        for column in range(1, last_column + 1):
            value = raw_grid.get((row, column), "")
            style = style_grid.get((row, column), 6)
            display_value, raw_value = order_export_view_cell_display(
                value,
                raw_grid,
                row,
                column,
                style,
            )
            cell = {
                "column": column,
                "ref": xlsx_cell_ref(row, column),
                "style": style,
                "value": display_value,
            }
            if raw_value not in (None, ""):
                cell["raw_value"] = raw_value
            if isinstance(value, XlsxFormula):
                cell["formula"] = f"={value.formula}"
            cells.append(cell)

        row_data = {
            "index": row,
            "kind": row_kind(row),
            "height": row_heights.get(row),
            "cells": cells,
        }
        product = product_rows.get(row)
        if product:
            row_data["product"] = product
        rows.append(row_data)

    return {
        "title": "FAIRE ORDERS",
        "include_thumbnails": sheet_payload["include_thumbnails"],
        "fixed_columns": sheet_payload["fixed_columns"],
        "frozen_columns": sheet_payload["frozen_columns"],
        "order_start_column": sheet_payload["order_start_column"],
        "header_row": header_row,
        "data_start_row": sheet_payload["data_start_row"],
        "total_row": total_row,
        "detail_start_row": detail_start_row,
        "row_count": row_count,
        "column_count": last_column,
        "order_count": len(sheet_payload.get("orders") or []),
        "product_count": len(product_rows),
        "orders": sheet_payload.get("orders") or [],
        "columns": [
            {
                "index": column,
                "letter": xlsx_col_name(column),
                "width": sheet_payload["columns"][column - 1],
                "header": header_cells.get(column, ""),
                "frozen": column <= int(sheet_payload["frozen_columns"]),
            }
            for column in range(1, last_column + 1)
        ],
        "rows": rows,
    }


def orders_export_drawing_xml(images: list[dict]) -> str:
    anchors = []
    width_emu = ORDER_EXPORT_THUMBNAIL_WIDTH_PX * ORDER_EXPORT_IMAGE_EMU_PER_PIXEL
    height_emu = ORDER_EXPORT_THUMBNAIL_HEIGHT_PX * ORDER_EXPORT_IMAGE_EMU_PER_PIXEL
    for index, image in enumerate(images, start=1):
        row_zero_based = max(int(image["row"]) - 1, 0)
        name = xml_escape(str(image.get("name") or f"Product {index}"))
        anchors.append(
            f"""<xdr:oneCellAnchor>
  <xdr:from><xdr:col>0</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>{row_zero_based}</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from>
  <xdr:ext cx="{width_emu}" cy="{height_emu}"/>
  <xdr:pic>
    <xdr:nvPicPr><xdr:cNvPr id="{index}" name="Product {index}" descr="{name}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
    <xdr:blipFill><a:blip r:embed="rId{index}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
    <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width_emu}" cy="{height_emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>"""
        )

    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
{''.join(anchors)}
</xdr:wsDr>"""


def orders_export_drawing_rels_xml(images: list[dict]) -> str:
    relationships = "".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image{index}.{order_export_image_extension(image)}"/>'
        for index, image in enumerate(images, start=1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{relationships}
</Relationships>"""


def orders_export_image_content_types_xml(images: list[dict]) -> str:
    seen_extensions = set()
    defaults = []
    for image in images:
        extension = order_export_image_extension(image)
        if extension in seen_extensions:
            continue
        seen_extensions.add(extension)
        defaults.append(
            f'<Default Extension="{extension}" ContentType="{order_export_image_content_type(image)}"/>'
        )
    defaults.append(
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    )
    return "".join(defaults)


def orders_export_sheet_xml(
    orders: list[Order],
    products: list[Product],
    shipping_by_order_id: dict[int, Shipping],
    include_thumbnails: bool = True,
    include_payload: bool = False,
    privacy: dict | None = None,
) -> tuple[str, list[dict]] | tuple[str, list[dict], dict]:
    include_thumbnails = normalize_order_export_thumbnail_flag(include_thumbnails)
    header_row = 2
    data_start_row = 3
    product_columns = order_export_product_columns(include_thumbnails)
    fixed_column_keys = [key for key, _header, _width in product_columns]
    fixed_column_headers = [header for _key, header, _width in product_columns]
    fixed_column_widths = [width for _key, _header, width in product_columns]
    fixed_columns = len(product_columns)
    fixed_column_index = {
        key: index
        for index, key in enumerate(fixed_column_keys, start=1)
    }
    order_start_column = fixed_columns + 1
    frozen_columns = min(ORDER_EXPORT_FROZEN_COLUMNS, fixed_columns)
    quantity_by_product = order_export_quantity_map(orders)
    manufacturing_by_product = order_export_manufacturing_map(orders)
    sorted_orders = sorted(
        orders,
        key=lambda order: (
            order.order_date or datetime.min,
            str(order.order_no or ""),
            order.id or 0,
        ),
    )
    sorted_products = sorted(products, key=order_export_product_sort_key)
    last_column = max(fixed_columns + len(sorted_orders), 26)
    merges = [
        f"A1:{xlsx_cell_ref(1, last_column)}",
    ]
    row_payloads: list[dict] = []

    def add_sparse_row(row: int, cells: list[tuple[int, object, int]], height: float | None = None) -> None:
        row_payloads.append({
            "kind": "sparse",
            "row": row,
            "cells": cells,
            "height": height,
        })

    def add_row(
        row: int,
        cells: list[tuple[object, int]],
        start_column: int = 1,
        height: float | None = None,
    ) -> None:
        row_payloads.append({
            "kind": "dense",
            "row": row,
            "cells": cells,
            "start_column": start_column,
            "height": height,
        })

    add_sparse_row(1, [(1, "FAIRE ORDERS", 1)], height=28)

    order_headers = [f"Order {index}" for index, _order in enumerate(sorted_orders, start=1)]
    add_row(
        header_row,
        [(header, 5) for header in fixed_column_headers + order_headers],
        height=30,
    )

    images: list[dict] = []
    current_category = None
    row_index = data_start_row
    product_rows: list[int] = []
    product_row_details: dict[int, dict] = {}
    for product in sorted_products:
        category = str(product.category or "Uncategorized").strip() or "Uncategorized"
        if category != current_category:
            current_category = category
            merges.append(f"A{row_index}:{xlsx_cell_ref(row_index, fixed_columns)}")
            add_sparse_row(
                row_index,
                [(1, category.upper(), 5)],
                height=26,
            )
            row_index += 1

        product_quantities = quantity_by_product.get(product.id, {})
        product_total = sum(product_quantities.values())
        product_rows.append(row_index)
        product_row_details[row_index] = {
            "id": product.id,
            "sku": product.article_no or "",
            "name": product.name or "",
            "category": category,
            "image_url": product.image_url or "",
        }
        fixed_cells = [
            ("", 6),
            (product.article_no or "", 6),
            (order_export_display_number(product.selling_price), 8),
            (int(product.factory_stock or 0), 9),
            (int(product.usa_stock or 0), 9),
            (int(product.reserved_stock or 0), 9),
            (manufacturing_by_product.get(product.id, "") or "", 9),
            (order_export_display_number(product.cost_price), 8),
            (product_total or "", 9),
        ]
        if "image" not in fixed_column_index:
            fixed_cells = fixed_cells[1:]
        order_cells = [
            (product_quantities.get(order.id, "") or "", 9)
            for order in sorted_orders
        ]
        add_row(row_index, fixed_cells + order_cells, height=60)

        thumbnail = order_export_thumbnail_image(product) if include_thumbnails and not include_payload else None
        if thumbnail:
            images.append({
                "row": row_index,
                "name": product.article_no or product.name or f"Product {product.id}",
                **thumbnail,
            })
        row_index += 1

    if not sorted_products:
        merges.append(f"A{row_index}:{xlsx_cell_ref(row_index, fixed_columns)}")
        add_sparse_row(row_index, [(1, "No products found.", 14)], height=28)
        row_index += 1

    total_row = row_index
    data_end_row = max(total_row - 1, data_start_row)
    total_units = sum(order_export_total_quantity(order) for order in sorted_orders)
    totals_cells = [
        (1, "Column totals", 4),
    ]
    if fixed_column_index.get("sku", 0) > 1:
        totals_cells.append((fixed_column_index["sku"], len(sorted_products), 4))
    for key in ("stock", "usa_stock", "reserved", "manufacturing"):
        column = fixed_column_index[key]
        column_name = xlsx_col_name(column)
        totals_cells.append((
            column,
            xlsx_formula(f"SUM({column_name}{data_start_row}:{column_name}{data_end_row})"),
            15,
        ))
    totals_cells.append((fixed_column_index["sold"], total_units, 15))
    for order_index, _order in enumerate(sorted_orders, start=order_start_column):
        column_name = xlsx_col_name(order_index)
        totals_cells.append((order_index, xlsx_formula(f"SUM({column_name}{data_start_row}:{column_name}{data_end_row})"), 15))
    add_sparse_row(total_row, totals_cells, height=28)

    detail_specs = [
        ("status", "Status"),
        ("payment", "Payment"),
        ("trade_status", "Trade"),
        ("review", "Review"),
        ("spacer_1", ""),
        ("manufacturing", "Manufacturing"),
        ("shipping", "Shipping"),
        ("income_pkr", "Income PKR"),
        ("expense", "Expense PKR"),
        ("spacer_2", ""),
        ("order_date", "Order Date"),
        ("ship_date", "Ship Date"),
        ("delivered_date", "Delivered Date"),
        ("tracking", "Tracking"),
        ("weight", "Weight"),
        ("duty", "Duty"),
        ("items", ""),
        ("shop", "Shop"),
        ("name", "Name"),
        ("street", "Street"),
        ("postal", "Postal"),
        ("country", "Country"),
        ("contact", "Contact"),
        ("area", "Area"),
        ("shipping_city", "Shipping City"),
        ("shipping_cost", "Shipping Cost PKR"),
        ("notes", "Notes"),
    ]
    detail_start_row = total_row + 1
    detail_rows = {
        key: detail_start_row + index
        for index, (key, _label) in enumerate(detail_specs)
    }
    for index, (key, label) in enumerate(detail_specs):
        detail_row = detail_start_row + index
        label_style = 11 if key.startswith("spacer") else 4
        cells = [(1, label, label_style)]
        cells.extend((column, "", label_style) for column in range(2, order_start_column))
        if not key.startswith("spacer"):
            for column, order in enumerate(sorted_orders, start=order_start_column):
                shipping = shipping_by_order_id.get(order.id)
                value = order_export_detail_value(
                    key,
                    order,
                    shipping,
                    detail_rows,
                    column,
                    privacy,
                )
                cells.append((column, value, order_export_detail_style(key, value)))
        height = 34 if key in {"items", "street", "postal", "contact", "notes"} else 24
        add_sparse_row(detail_row, cells, height=height)
    row_index = detail_start_row + len(detail_specs)

    if include_thumbnails:
        columns = [
            *fixed_column_widths,
            *([17] * len(sorted_orders)),
        ]
        if len(columns) < last_column:
            columns.extend([13] * (last_column - len(columns)))
        row_fit_widths = None
        default_row_height = 22
    else:
        columns = order_export_fit_column_widths(row_payloads, last_column, fixed_columns)
        row_fit_widths = columns
        default_row_height = 18
    best_fit_attr = ' bestFit="1"' if not include_thumbnails else ""
    cols = "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"{best_fit_attr}/>'
        for index, width in enumerate(columns[:last_column], start=1)
    )
    merge_xml = "".join(f'<mergeCell ref="{ref}"/>' for ref in merges)
    sheet_data = "".join(
        order_export_render_row_payload(payload, row_fit_widths)
        for payload in row_payloads
    )
    dimension = f"A1:{xlsx_cell_ref(row_index - 1, last_column)}"
    drawing_xml = '<drawing r:id="rId1"/>' if images else ""

    sheet_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="{dimension}"/>
  <sheetViews><sheetView workbookViewId="0" zoomScale="90" zoomScaleNormal="90"><pane xSplit="{frozen_columns}" ySplit="{header_row}" topLeftCell="{xlsx_cell_ref(data_start_row, frozen_columns + 1)}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="{xlsx_cell_ref(data_start_row, frozen_columns + 1)}" sqref="{xlsx_cell_ref(data_start_row, frozen_columns + 1)}"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="{default_row_height}"/>
  <cols>{cols}</cols>
  <sheetData>{sheet_data}</sheetData>
  <mergeCells count="{len(merges)}">{merge_xml}</mergeCells>
  <pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
  {drawing_xml}
</worksheet>"""
    if include_payload:
        return sheet_xml, images, {
            "include_thumbnails": include_thumbnails,
            "header_row": header_row,
            "data_start_row": data_start_row,
            "total_row": total_row,
            "detail_start_row": detail_start_row,
            "row_count": row_index - 1,
            "last_column": last_column,
            "fixed_columns": fixed_columns,
            "frozen_columns": frozen_columns,
            "order_start_column": order_start_column,
            "columns": columns[:last_column],
            "row_payloads": row_payloads,
            "merges": merges,
            "product_columns": [
                {"key": key, "header": header, "width": width}
                for key, header, width in product_columns
            ],
            "product_rows": product_row_details,
            "orders": [
                {
                    "id": order.id,
                    "order_no": order.order_no or "",
                    "customer": order_export_customer_label(order, privacy),
                    "order_date": order.order_date.isoformat() if order.order_date else None,
                }
                for order in sorted_orders
            ],
        }
    return sheet_xml, images


def build_orders_export_xlsx(
    orders: list[Order],
    products: list[Product],
    shipping_by_order_id: dict[int, Shipping] | None = None,
    include_thumbnails: bool = True,
    privacy: dict | None = None,
) -> bytes:
    include_thumbnails = normalize_order_export_thumbnail_flag(include_thumbnails)
    sheet_xml, images = orders_export_sheet_xml(
        orders,
        products,
        shipping_by_order_id or {},
        include_thumbnails=include_thumbnails,
        privacy=privacy,
    )
    if not include_thumbnails:
        sheet_xml = sheet_xml.replace("\n  <drawing r:id=\"rId1\"/>\n", "\n  \n")
        images = []
    content_types_drawing = orders_export_image_content_types_xml(images) if images else ""
    sheet_relationships = (
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>"""
        if images
        else None
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  {content_types_drawing}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>""")
        workbook.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""")
        workbook.writestr("xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Orders Export" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcMode="auto"/>
</workbook>""")
        workbook.writestr("xl/_rels/workbook.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>""")
        workbook.writestr("xl/styles.xml", orders_export_styles_xml())
        workbook.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        if images and sheet_relationships:
            workbook.writestr("xl/worksheets/_rels/sheet1.xml.rels", sheet_relationships)
            workbook.writestr("xl/drawings/drawing1.xml", orders_export_drawing_xml(images))
            workbook.writestr("xl/drawings/_rels/drawing1.xml.rels", orders_export_drawing_rels_xml(images))
            for index, image in enumerate(images, start=1):
                workbook.writestr(
                    f"xl/media/image{index}.{order_export_image_extension(image)}",
                    image["data"],
                )
    return buffer.getvalue()


def mark_order_unfulfilled(order: Order | None) -> None:
    if not order:
        return
    if str(order.status or "").strip().lower() in {"canceled", "cancelled"}:
        return
    order.status = "Unfulfilled"


def normalize_order_workflow_task_type(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    task_type = ORDER_WORKFLOW_TASK_TYPES.get(normalized)
    if not task_type:
        raise HTTPException(status_code=400, detail="Task type must be Preparation or Shipping")
    return task_type


def next_order_number(db: Session) -> str:
    next_number = (db.query(func.max(Order.id)).scalar() or 0) + 1

    while next_number <= 99999:
        order_no = f"{next_number:05d}"
        if not db.query(Order.id).filter(Order.order_no == order_no).first():
            return order_no
        next_number += 1

    raise HTTPException(
        status_code=409,
        detail="No five-digit automatic order numbers are available",
    )


@app.get("/orders", response_model=list[OrderOut])
def get_orders(request: Request, db: Session = Depends(get_db)):
    privacy = access_privacy_context(request, db)
    orders = (
        db.query(Order)
        .order_by(Order.order_date.desc(), Order.id.desc())
        .all()
    )
    return [order_response(o, privacy) for o in orders]


@app.get("/orders/export.xlsx")
def export_orders_xlsx(
    request: Request,
    status: str = Query("All"),
    search: str | None = Query(None),
    include_thumbnails: bool = Query(True),
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    shipping_by_order_id = {
        shipping.order_id: shipping
        for shipping in db.query(Shipping).all()
        if shipping.order_id is not None
    }
    orders = [
        order
        for order in db.query(Order).order_by(Order.order_date.asc(), Order.id.asc()).all()
        if order_export_matches(
            order,
            shipping_by_order_id.get(order.id),
            status,
            search,
            privacy,
        )
    ]
    products = db.query(Product).all()
    content = build_orders_export_xlsx(
        orders,
        products,
        shipping_by_order_id,
        include_thumbnails=include_thumbnails,
        privacy=privacy,
    )
    filename = f"hisbenew-orders-{datetime.now().strftime('%Y%m%d-%H%M')}.xlsx"
    return Response(
        content=content,
        media_type=ORDER_EXPORT_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/orders/export-view")
def get_orders_export_view(
    request: Request,
    status: str = Query("All"),
    search: str | None = Query(None),
    include_thumbnails: bool = Query(True),
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    shipping_by_order_id = {
        shipping.order_id: shipping
        for shipping in db.query(Shipping).all()
        if shipping.order_id is not None
    }
    orders = [
        order
        for order in db.query(Order).order_by(Order.order_date.asc(), Order.id.asc()).all()
        if order_export_matches(
            order,
            shipping_by_order_id.get(order.id),
            status,
            search,
            privacy,
        )
    ]
    products = db.query(Product).all()
    _sheet_xml, _images, sheet_payload = orders_export_sheet_xml(
        orders,
        products,
        shipping_by_order_id,
        include_thumbnails=include_thumbnails,
        include_payload=True,
        privacy=privacy,
    )
    return order_export_view_response(sheet_payload)


def create_order_record(
    order: OrderCreate,
    db: Session,
    import_batch_key: str | None = None,
) -> Order:
    order_no = (order.order_no or "").strip() or next_order_number(db)
    if db.query(Order).filter(Order.order_no == order_no).first():
        raise HTTPException(status_code=400, detail="Order number exists")
    customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if len(order.items) == 0:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    total_amount = 0
    new_order = Order(
        order_no=order_no,
        customer_id=order.customer_id,
        import_customer_name=(order.import_customer_name or "").strip() or None,
        import_customer_company_name=(order.import_customer_company_name or "").strip() or None,
        import_contact_name=(order.import_contact_name or "").strip() or None,
        import_contact_phone=(order.import_contact_phone or "").strip() or None,
        import_shipping_name=(order.import_shipping_name or "").strip() or None,
        import_shipping_address=(order.import_shipping_address or "").strip() or None,
        import_ship_date=order.import_ship_date,
        import_batch_key=(import_batch_key or "").strip() or None,
        platform=order.platform,
        order_date=order.order_date or datetime.utcnow(),
        payment_status=order.payment_status,
        shipping_status=order.shipping_status,
        notes=order.notes,
        total_amount=0,
        order_total_usd=order.order_total_usd,
        platform_fee_usd=order.platform_fee_usd,
        deduction_usd=order.deduction_usd,
        expected_payout_usd=order.expected_payout_usd,
        expected_payout_date=order.expected_payout_date,
        payment_source=order.payment_source,
        payout_status=order.payout_status,
        received_payout_usd=order.received_payout_usd,
        remaining_payout_usd=order.remaining_payout_usd,
        exchange_rate=order.exchange_rate,
        received_pkr=order.received_pkr,
        bank_charges_pkr=order.bank_charges_pkr,
        final_received_pkr=order.final_received_pkr,
        payout_notes=order.payout_notes,
        payout_received_date=order.payout_received_date,
    )
    db.add(new_order)
    db.commit()
    db.refresh(new_order)

    for item in order.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        line_total = item.quantity * item.unit_price
        total_amount += line_total

        # If order is already fulfilled enough to leave the warehouse, deduct real stock.
        if is_stock_deducted_shipping_status(order.shipping_status):
            movement_type, movement_qty = deduct_order_item_on_ship(product, item.quantity, item.stock_source)
            manufacturing_required = (
                (product.factory_stock or 0)
                + (product.usa_stock or 0)
                + (product.front_room_stock or 0)
                - (product.reserved_stock or 0)
            ) < 0
        else:
            manufacturing_required, movement_type, movement_qty = reserve_order_item(product, item.quantity, item.stock_source)

        order_item = OrderItem(
            order_id=new_order.id,
            product_id=product.id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            line_total=line_total,
            stock_source=item.stock_source,
            manufacturing_required=manufacturing_required
        )
        db.add(order_item)

        movement = StockMovement(
            product_id=product.id,
            movement_type=movement_type,
            quantity=movement_qty,
            stock_type=(
                "reserved_stock"
                if movement_type == "Order Reservation"
                else ("usa_stock" if str(item.stock_source).lower() == "usa" else "factory_stock")
            ),
            source=item.stock_source,
            reference=order_no,
            note="Stock updated for order"
        )
        db.add(movement)

    new_order.total_amount = total_amount
    sync_order_payout_accounting(db, new_order)
    db.commit()
    db.refresh(new_order)
    return new_order


@app.post("/orders", response_model=OrderOut)
def create_order(
    order: OrderCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    new_order = create_order_record(order, db)
    return order_response(new_order, privacy)


@app.post("/orders/import-csv/review")
async def review_orders_csv(
    file: UploadFile = File(...),
    preview_limit: int = Query(200, ge=25, le=1000),
    db: Session = Depends(get_db),
):
    rows = await read_csv_upload(file)
    return build_order_import_review(rows, db, preview_limit=preview_limit)


@app.post("/orders/import-missing-products")
def create_order_import_missing_products(
    payload: OrderImportMissingProductsRequest,
    db: Session = Depends(get_db),
):
    errors = []
    created_products = []
    skipped = 0

    for index, candidate in enumerate(payload.products, start=1):
        sku = clean_customer_import_value(candidate.sku)
        if not sku:
            add_csv_error(errors, index, "SKU is required to add a product from import.")
            continue

        existing_product = (
            db.query(Product)
            .filter(func.lower(Product.article_no) == sku.lower())
            .first()
        )
        if existing_product:
            skipped += 1
            continue

        name = clean_customer_import_value(candidate.name) or sku
        wholesale_price = float(candidate.wholesale_price or 0)
        retail_price = float(candidate.retail_price or 0)
        product = Product(
            article_no=sku,
            name=name,
            category="Faire Import",
            options=None,
            notes="Created from Faire order CSV import.",
            factory_stock=0,
            usa_stock=0,
            reserved_stock=0,
            cost_price=wholesale_price,
            selling_price=retail_price or wholesale_price,
            low_stock_alert=10,
            workflow_required=True,
        )
        db.add(product)
        created_products.append(product)

    try:
        if created_products:
            db.commit()
            for product in created_products:
                db.refresh(product)
        else:
            db.rollback()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Missing products could not be added.") from exc

    return {
        "created": len(created_products),
        "skipped": skipped,
        "errors": errors,
        "products": [product_response(product) for product in created_products],
    }


@app.post("/orders/import-missing-customers")
def create_order_import_missing_customers(
    payload: OrderImportMissingCustomersRequest,
    db: Session = Depends(get_db),
):
    errors = []
    created_customers = []
    skipped = 0
    lookup = customer_import_lookup(db.query(Customer).all())

    for index, incoming in enumerate(payload.customers, start=1):
        candidate = normalize_customer_import_candidate(incoming.model_dump())
        if not candidate.get("name"):
            add_csv_error(errors, index, "Customer name is required to add a customer from import.")
            continue

        existing_customer, _reason = find_customer_import_conflict(candidate, lookup)
        if existing_customer:
            skipped += 1
            continue

        customer = create_customer_from_import_candidate(candidate)
        db.add(customer)
        created_customers.append(customer)
        if candidate.get("email"):
            lookup["email"][normalized_customer_key(candidate.get("email"))] = customer
        phone_key = normalized_customer_phone(candidate.get("phone"))
        if phone_key:
            lookup["phone"][phone_key] = customer
        name_key = normalized_customer_key(candidate.get("name"))
        company_key = normalized_customer_key(candidate.get("company_name"))
        address_keys = customer_matching_address_keys(
            candidate.get("address"),
            candidate.get("shipping_address"),
        )
        for address_key in address_keys:
            if all((name_key, company_key, address_key)):
                lookup["identity"][(name_key, company_key, address_key)] = customer
            if all((company_key, address_key)):
                lookup["company_address"][(company_key, address_key)] = customer
            existing_address_customer = lookup["address"].get(address_key)
            if existing_address_customer and existing_address_customer is not customer:
                lookup["address"][address_key] = None
            elif address_key not in lookup["address"]:
                lookup["address"][address_key] = customer
        if all((name_key, company_key)):
            lookup["name_company"][(name_key, company_key)] = customer
        business_key = company_key or name_key
        if business_key:
            existing_business_customer = lookup["company"].get(business_key)
            if existing_business_customer is None and business_key in lookup["company"]:
                pass
            elif existing_business_customer and existing_business_customer is not customer:
                lookup["company"][business_key] = None
            else:
                lookup["company"][business_key] = customer

    try:
        if created_customers:
            db.commit()
            for customer in created_customers:
                db.refresh(customer)
        else:
            db.rollback()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Missing customers could not be added.") from exc

    return {
        "created": len(created_customers),
        "skipped": skipped,
        "errors": errors,
        "customers": [customer_import_snapshot(customer) for customer in created_customers],
    }


def next_order_import_batch_key() -> str:
    return f"ORDER-CSV-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"


def order_import_batch_response(
    batch: OrderImportBatch,
    remaining_count: int | None = None,
) -> dict:
    remaining = int(remaining_count if remaining_count is not None else 0)
    imported_count = int(batch.imported_count or 0)
    reversed_count = int(batch.reversed_count or 0)
    if batch.status == "Reversed" and reversed_count == 0 and imported_count:
        reversed_count = max(imported_count - remaining, 0)
    return {
        "id": batch.id,
        "batch_key": batch.batch_key,
        "filename": batch.filename,
        "source_format": batch.source_format,
        "imported_count": imported_count,
        "item_count": int(batch.item_count or 0),
        "failed_count": int(batch.failed_count or 0),
        "needs_customer_assignment_count": int(batch.needs_customer_assignment_count or 0),
        "remaining_count": remaining,
        "reversed_count": reversed_count,
        "status": batch.status or "Imported",
        "created_by_user_id": batch.created_by_user_id,
        "created_by_name": batch.created_by_name,
        "created_at": batch.created_at,
        "reversed_at": batch.reversed_at,
    }


@app.post("/orders/import-csv")
async def import_orders_csv(
    request: Request,
    file: UploadFile = File(...),
    missing_customer_action: str = Form("skip"),
    db: Session = Depends(get_db),
):
    rows = await read_csv_upload(file)
    grouped_rows = build_order_import_groups(rows)
    review = build_order_import_review(rows, db)
    errors = []
    failed_orders = 0
    created_orders = 0
    created_items = 0
    needs_customer_assignment = 0
    missing_customer_action = str(missing_customer_action or "skip").strip().lower()
    if missing_customer_action not in {"skip", "add_later"}:
        raise HTTPException(status_code=400, detail="Missing customer action must be skip or add_later.")
    unassigned_customer = None
    batch_key = next_order_import_batch_key()
    batch = OrderImportBatch(
        batch_key=batch_key,
        filename=sanitize_upload_filename(file.filename or "orders.csv"),
        source_format=review["source_format"],
        status="Importing",
        created_by_user_id=getattr(request.state, "user_id", None),
        created_by_name=getattr(request.state, "user_name", None),
    )
    db.add(batch)
    db.commit()

    for order_review in review["orders"]:
        line = order_review["line"]
        group = grouped_rows[order_review["key"]]
        first_row = group["rows"][0]
        imported_with_customer_later = False
        try:
            if (
                missing_customer_action == "add_later"
                and order_review.get("can_import_with_customer_later")
            ):
                if unassigned_customer is None:
                    unassigned_customer = ensure_unassigned_import_customer(db)
                order_review = order_import_review_for_customer_later(order_review, unassigned_customer)
                imported_with_customer_later = True

            if not order_review["can_import"]:
                issue_text = "; ".join(issue["detail"] for issue in order_review["issues"])
                raise ValueError(issue_text)

            order_payload = build_order_payload_from_import_review(order_review, first_row)
            create_order_record(order_payload, db, import_batch_key=batch_key)
            created_orders += 1
            created_items += len(order_payload.items)
            if imported_with_customer_later:
                needs_customer_assignment += 1
        except HTTPException as exc:
            db.rollback()
            failed_orders += 1
            add_csv_error(errors, line, str(exc.detail))
        except ValueError as exc:
            db.rollback()
            failed_orders += 1
            add_csv_error(errors, line, str(exc))

    if created_orders:
        batch.imported_count = created_orders
        batch.item_count = created_items
        batch.failed_count = failed_orders
        batch.needs_customer_assignment_count = needs_customer_assignment
        batch.status = "Imported"
        db.add(batch)
        db.commit()
    else:
        db.delete(batch)
        db.commit()
        batch_key = None

    return {
        "created": created_orders,
        "items": created_items,
        "failed": failed_orders,
        "needs_customer_assignment": needs_customer_assignment,
        "import_batch_key": batch_key,
        "source_format": review["source_format"],
        "errors": errors,
    }


@app.get("/orders/import-batches")
def get_order_import_batches(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    batches = (
        db.query(OrderImportBatch)
        .order_by(OrderImportBatch.created_at.desc(), OrderImportBatch.id.desc())
        .limit(limit)
        .all()
    )
    if not batches:
        return []
    remaining_by_key = {
        batch_key: count
        for batch_key, count in (
            db.query(Order.import_batch_key, func.count(Order.id))
            .filter(Order.import_batch_key.in_([batch.batch_key for batch in batches]))
            .group_by(Order.import_batch_key)
            .all()
        )
    }
    return [
        order_import_batch_response(batch, remaining_by_key.get(batch.batch_key, 0))
        for batch in batches
    ]


@app.delete("/orders/import-batches/{batch_key}")
def reverse_order_import_batch(
    batch_key: str,
    request: Request,
    db: Session = Depends(get_db),
):
    clean_batch_key = str(batch_key or "").strip()
    if not clean_batch_key:
        raise HTTPException(status_code=400, detail="Import batch key is required.")

    batch = (
        db.query(OrderImportBatch)
        .filter(OrderImportBatch.batch_key == clean_batch_key)
        .first()
    )
    if not batch:
        raise HTTPException(status_code=404, detail="Import batch was not found.")

    orders = (
        db.query(Order)
        .filter(Order.import_batch_key == clean_batch_key)
        .order_by(Order.id.asc())
        .all()
    )
    counts: dict[str, int] = {}
    try:
        delete_order_records(db, orders, counts)
        reversed_count = int(counts.get("orders") or 0)
        batch.status = "Reversed"
        batch.reversed_at = datetime.utcnow()
        batch.reversed_count = int(batch.reversed_count or 0) + reversed_count
        db.add(batch)
        db.commit()
    except Exception:
        db.rollback()
        raise

    record_activity(
        db,
        actor_user_id=getattr(request.state, "user_id", None),
        actor_user_name=getattr(request.state, "user_name", None),
        action="removed",
        entity_type="Order CSV import",
        entity_id=clean_batch_key,
        summary=f"Reversed CSV order import {clean_batch_key}",
        detail=json.dumps(counts, sort_keys=True),
        page="Orders",
        request_method="DELETE",
        request_path=f"/orders/import-batches/{clean_batch_key}",
    )

    remaining_count = (
        db.query(Order)
        .filter(Order.import_batch_key == clean_batch_key)
        .count()
    )
    return {
        "status": "reversed",
        "batch": order_import_batch_response(batch, remaining_count),
        "counts": counts,
    }

@app.put("/orders/{order_id}", response_model=OrderOut)
def update_order(
    order_id: int,
    order: OrderCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    existing_order = db.query(Order).filter(Order.id == order_id).first()
    if not existing_order:
        raise HTTPException(status_code=404, detail="Order not found")

    order_no = (order.order_no or "").strip() or existing_order.order_no

    # Check if order_no changed and if new one exists
    if order_no != existing_order.order_no:
        if db.query(Order).filter(Order.order_no == order_no).first():
            raise HTTPException(status_code=400, detail="Order number already exists")

    customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if len(order.items) == 0:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    # Reverse stock reservations/deductions from previous order items
    for old_item in existing_order.items:
        product = db.query(Product).filter(Product.id == old_item.product_id).first()
        if product:
            was_shipped = is_stock_deducted_shipping_status(existing_order.shipping_status)
            release_order_stock(product, old_item.quantity, old_item.stock_source, was_shipped)

    # Delete old order items and stock movements
    for old_item in existing_order.items:
        db.delete(old_item)

    old_movements = db.query(StockMovement).filter(StockMovement.reference == existing_order.order_no).all()
    for movement in old_movements:
        db.delete(movement)

    # Update order details
    existing_order.order_no = order_no
    existing_order.customer_id = order.customer_id
    existing_order.import_customer_name = (
        (order.import_customer_name or "").strip() or None
    )
    existing_order.import_customer_company_name = (
        (order.import_customer_company_name or "").strip() or None
    )
    existing_order.import_contact_name = (
        (order.import_contact_name or "").strip() or None
    )
    if order.import_contact_phone is not None:
        existing_order.import_contact_phone = (
            (order.import_contact_phone or "").strip() or None
        )
    existing_order.import_shipping_name = (
        (order.import_shipping_name or "").strip() or None
    )
    existing_order.import_shipping_address = (
        (order.import_shipping_address or "").strip() or None
    )
    existing_order.import_ship_date = order.import_ship_date
    existing_order.platform = order.platform
    if order.order_date is not None:
        existing_order.order_date = order.order_date
    existing_order.payment_status = order.payment_status
    existing_order.shipping_status = order.shipping_status
    existing_order.notes = order.notes
    existing_order.order_total_usd = order.order_total_usd
    existing_order.platform_fee_usd = order.platform_fee_usd
    existing_order.deduction_usd = order.deduction_usd
    existing_order.expected_payout_usd = order.expected_payout_usd
    existing_order.expected_payout_date = order.expected_payout_date
    existing_order.payment_source = order.payment_source
    existing_order.payout_status = order.payout_status
    existing_order.received_payout_usd = order.received_payout_usd
    existing_order.remaining_payout_usd = order.remaining_payout_usd
    existing_order.exchange_rate = order.exchange_rate
    existing_order.received_pkr = order.received_pkr
    existing_order.bank_charges_pkr = order.bank_charges_pkr
    existing_order.final_received_pkr = order.final_received_pkr
    existing_order.payout_notes = order.payout_notes
    existing_order.payout_received_date = order.payout_received_date

    # Add new order items and manage reservations/deductions
    total_amount = 0
    for item in order.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        line_total = item.quantity * item.unit_price
        total_amount += line_total

        if is_stock_deducted_shipping_status(order.shipping_status):
            movement_type, movement_qty = deduct_order_item_on_ship(product, item.quantity, item.stock_source)
            manufacturing_required = (
                (product.factory_stock or 0)
                + (product.usa_stock or 0)
                + (product.front_room_stock or 0)
                - (product.reserved_stock or 0)
            ) < 0
        else:
            manufacturing_required, movement_type, movement_qty = reserve_order_item(product, item.quantity, item.stock_source)

        order_item = OrderItem(
            order_id=existing_order.id,
            product_id=product.id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            line_total=line_total,
            stock_source=item.stock_source,
            manufacturing_required=manufacturing_required
        )
        db.add(order_item)

        movement = StockMovement(
            product_id=product.id,
            movement_type=movement_type,
            quantity=movement_qty,
            stock_type=(
                "reserved_stock"
                if movement_type == "Order Reservation"
                else ("usa_stock" if str(item.stock_source).lower() == "usa" else "factory_stock")
            ),
            source=item.stock_source,
            reference=order_no,
            note="Stock updated for order"
        )
        db.add(movement)

    existing_order.total_amount = total_amount
    sync_order_payout_accounting(db, existing_order)
    db.commit()
    db.refresh(existing_order)
    return order_response(existing_order, privacy)

@app.put("/orders/{order_id}/payout", response_model=OrderOut)
def update_order_payout(
    order_id: int,
    payout: OrderPayoutUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    existing_order = db.query(Order).filter(Order.id == order_id).first()
    if not existing_order:
        raise HTTPException(status_code=404, detail="Order not found")

    allowed_statuses = {
        "Not Received",
        "Partially Received",
        "Received",
        "On Hold",
        "Disputed",
        "Refunded",
    }
    requested_status = (payout.payout_status or "Not Received").strip()
    if requested_status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid payout status")

    received_payout = max(float(payout.received_payout_usd or 0), 0)
    expected_payout = max(float(payout.expected_payout_usd or 0), 0)

    if requested_status in {"Received", "Partially Received"} and received_payout <= 0:
        raise HTTPException(
            status_code=400,
            detail="Enter the payout amount before marking this order as paid.",
        )

    payout_status = requested_status
    if requested_status == "Received" and expected_payout > received_payout:
        payout_status = "Partially Received"
    elif requested_status == "Not Received" and received_payout > 0:
        payout_status = (
            "Partially Received"
            if expected_payout > received_payout
            else "Received"
        )

    existing_order.order_total_usd = payout.order_total_usd
    existing_order.platform_fee_usd = payout.platform_fee_usd
    existing_order.deduction_usd = payout.deduction_usd
    existing_order.expected_payout_usd = expected_payout
    existing_order.expected_payout_date = payout.expected_payout_date
    existing_order.payment_source = payout.payment_source
    existing_order.payout_status = payout_status
    existing_order.received_payout_usd = received_payout
    existing_order.remaining_payout_usd = max(expected_payout - received_payout, 0)
    existing_order.exchange_rate = payout.exchange_rate
    existing_order.received_pkr = payout.received_pkr
    existing_order.bank_charges_pkr = payout.bank_charges_pkr
    existing_order.final_received_pkr = payout.final_received_pkr
    existing_order.payout_notes = payout.payout_notes
    existing_order.payout_received_date = (
        payout.payout_received_date
        or (datetime.utcnow() if payout_status == "Received" else None)
    )

    if existing_order.exchange_rate and existing_order.received_payout_usd:
        existing_order.received_pkr = existing_order.received_payout_usd * existing_order.exchange_rate
        existing_order.final_received_pkr = existing_order.received_pkr - (existing_order.bank_charges_pkr or 0)

    sync_order_payout_accounting(db, existing_order)
    db.commit()
    db.refresh(existing_order)
    return order_response(existing_order, privacy)

@app.delete("/orders/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    remove_order_payout_accounting(db, order_id)

    # Get shipping record for this order (if exists)
    shipping = db.query(Shipping).filter(Shipping.order_id == order_id).first()

    # Reverse stock reservations/deductions from order items
    for item in order.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product:
            was_shipped = is_stock_deducted_shipping_status(order.shipping_status)
            release_order_stock(product, item.quantity, item.stock_source, was_shipped)

    # Delete order items
    for item in order.items:
        db.delete(item)

    # Delete stock movements related to this order
    movements = db.query(StockMovement).filter(StockMovement.reference == order.order_no).all()
    for movement in movements:
        db.delete(movement)

    # Delete shipping record and reverse courier payments if they exist
    if shipping:
        # Delete courier payments matching the shipping courier and tracking number
        if shipping.courier_name:
            if shipping.tracking_number:
                # Delete payment with matching courier and tracking reference
                courier_payments = db.query(CourierPayment).filter(
                    CourierPayment.courier_name == shipping.courier_name,
                    CourierPayment.payment_reference == shipping.tracking_number
                ).all()
            else:
                # If no tracking number, try to find by courier and shipping cost
                if shipping.shipping_cost:
                    courier_payments = db.query(CourierPayment).filter(
                        CourierPayment.courier_name == shipping.courier_name,
                        CourierPayment.amount == shipping.shipping_cost
                    ).order_by(CourierPayment.id.desc()).limit(1).all()
                else:
                    courier_payments = []
            
            for payment in courier_payments:
                db.delete(payment)

        # Delete the shipping record
        db.delete(shipping)

    db.delete(order)
    db.commit()

    return {"message": "Order and shipping record deleted successfully. Courier payment reversed.", "deleted_order_id": order_id}

# Stock Movements API
@app.get("/stock-movements", response_model=list[StockMovementOut])
def get_stock_movements(db: Session = Depends(get_db)):
    return [stock_movement_response(m) for m in db.query(StockMovement).order_by(StockMovement.id.desc()).all()]

# Workflow Steps API
@app.post("/workflow-steps", response_model=WorkflowStepOut)
def create_workflow_step(step: WorkflowStepCreate, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == step.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if step.step_order < 1:
        raise HTTPException(status_code=400, detail="Step order must be at least 1")
    if not step.step_name.strip():
        raise HTTPException(status_code=400, detail="Step name is required")
    new_step = WorkflowStep(**step.model_dump())
    new_step.step_name = step.step_name.strip()
    new_step.worker_role = step.worker_role.strip() if step.worker_role else None
    db.add(new_step)
    db.commit()
    db.refresh(new_step)
    return workflow_step_response(new_step)

@app.get("/workflow-steps", response_model=list[WorkflowStepOut])
def get_workflow_steps(db: Session = Depends(get_db)):
    steps = db.query(WorkflowStep).order_by(WorkflowStep.product_id, WorkflowStep.step_order).all()
    return [workflow_step_response(s) for s in steps]


@app.put("/workflow-steps/{step_id}", response_model=WorkflowStepOut)
def update_workflow_step(
    step_id: int,
    payload: WorkflowStepUpdate,
    db: Session = Depends(get_db),
):
    step = db.query(WorkflowStep).filter(WorkflowStep.id == step_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Workflow step not found")

    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if payload.step_order < 1:
        raise HTTPException(status_code=400, detail="Step order must be at least 1")
    if not payload.step_name.strip():
        raise HTTPException(status_code=400, detail="Step name is required")

    for field, value in payload.model_dump().items():
        setattr(step, field, value)
    step.step_name = payload.step_name.strip()
    step.worker_role = payload.worker_role.strip() if payload.worker_role else None

    db.commit()
    db.refresh(step)
    return workflow_step_response(step)


@app.post("/workflow-steps/copy")
def copy_product_workflow(
    payload: WorkflowCopyRequest,
    db: Session = Depends(get_db),
):
    if payload.source_product_id == payload.target_product_id:
        raise HTTPException(
            status_code=400,
            detail="Source and target products must be different",
        )

    source_product = db.query(Product).filter(
        Product.id == payload.source_product_id
    ).first()
    target_product = db.query(Product).filter(
        Product.id == payload.target_product_id
    ).first()
    if not source_product or not target_product:
        raise HTTPException(status_code=404, detail="Source or target product not found")

    source_steps = (
        db.query(WorkflowStep)
        .filter(WorkflowStep.product_id == payload.source_product_id)
        .order_by(WorkflowStep.step_order)
        .all()
    )
    if not source_steps:
        raise HTTPException(status_code=400, detail="Source product has no workflow steps")

    existing_steps = db.query(WorkflowStep).filter(
        WorkflowStep.product_id == payload.target_product_id
    ).all()
    if existing_steps and not payload.replace_existing:
        raise HTTPException(
            status_code=400,
            detail="Target product already has workflow steps",
        )

    if payload.replace_existing:
        existing_ids = [step.id for step in existing_steps]
        if existing_ids:
            db.query(ProductionTask).filter(
                ProductionTask.workflow_step_id.in_(existing_ids)
            ).update(
                {ProductionTask.workflow_step_id: None},
                synchronize_session=False,
            )
        for existing_step in existing_steps:
            db.delete(existing_step)

    for source_step in source_steps:
        db.add(
            WorkflowStep(
                product_id=payload.target_product_id,
                step_order=source_step.step_order,
                step_name=source_step.step_name,
                worker_role=source_step.worker_role,
                rate_per_piece=source_step.rate_per_piece,
                estimated_minutes_per_piece=source_step.estimated_minutes_per_piece,
                is_optional=source_step.is_optional,
                is_active=source_step.is_active,
            )
        )

    db.commit()
    copied_steps = (
        db.query(WorkflowStep)
        .filter(WorkflowStep.product_id == payload.target_product_id)
        .order_by(WorkflowStep.step_order)
        .all()
    )
    return {
        "message": f"Workflow copied to {target_product.article_no}",
        "steps": [workflow_step_response(step) for step in copied_steps],
    }


@app.delete("/workflow-steps/{step_id}")
def delete_workflow_step(step_id: int, db: Session = Depends(get_db)):
    step = db.query(WorkflowStep).filter(WorkflowStep.id == step_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    db.delete(step)
    db.commit()
    return {"message": "Workflow step deleted successfully", "deleted_step_id": step_id}

# Shipping API

class ShippingWeightOverridePayload(BaseModel):
    weight_kg: float | None = Field(default=None, gt=0)


@app.get("/shipping/usa-rate-card")
def get_usa_shipping_rate_card():
    return usa_rate_card_summary()


@app.post("/shipping/usa-rate-card/upload")
async def upload_usa_shipping_rate_card(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require_admin_user(request, db)
    filename = sanitize_upload_filename(file.filename or "usa-rates.xlsx")
    if Path(filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=400, detail="Upload an XLSX shipping rate workbook.")
    try:
        workbook_bytes = await file.read(MAX_RATE_WORKBOOK_BYTES + 1)
        if len(workbook_bytes) > MAX_RATE_WORKBOOK_BYTES:
            raise HTTPException(status_code=400, detail="The rate workbook must be 16 MB or smaller.")
        rate_card = parse_usa_rate_workbook(workbook_bytes, filename)
        activate_usa_rate_card(rate_card, workbook_bytes)
    except RateWorkbookError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await file.close()
    return {
        "message": f"{filename} is now the active USA shipping rate sheet.",
        "rate_card": usa_rate_card_summary(),
    }


@app.patch("/shipping/orders/{order_id}/weight")
def update_pending_order_shipping_weight(
    order_id: int,
    payload: ShippingWeightOverridePayload,
    db: Session = Depends(get_db),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if is_stock_deducted_shipping_status(order.shipping_status):
        raise HTTPException(status_code=400, detail="The weight of a shipped order cannot be changed here.")

    order.shipping_weight_override_kg = payload.weight_kg
    db.commit()
    db.refresh(order)
    duty_paid = calculate_order_usa_shipping(order, "duty_paid")
    non_duty_paid = calculate_order_usa_shipping(order, "non_duty_paid")
    return {
        "order_id": order.id,
        "shipping_weight_override_kg": order.shipping_weight_override_kg,
        "usa_shipping": duty_paid,
        "usa_shipping_estimates": {
            "duty_paid": duty_paid,
            "non_duty_paid": non_duty_paid,
        },
    }

@app.get("/shipping", response_model=list[ShippingOut])
def get_shipping_records(request: Request, db: Session = Depends(get_db)):
    privacy = access_privacy_context(request, db)
    records = db.query(Shipping).order_by(Shipping.id.desc()).all()
    return [shipping_response(s, privacy) for s in records]


@app.get("/shipping/pending")
def get_pending_shipping_orders(request: Request, db: Session = Depends(get_db)):
    privacy = access_privacy_context(request, db)
    orders = (
        db.query(Order)
        .filter(
            ~func.lower(func.coalesce(Order.shipping_status, "")).in_(
                list(STOCK_DEDUCTED_SHIPPING_STATUSES)
            )
        )
        .order_by(Order.id.desc())
        .all()
    )

    pending_orders = []
    for order in orders:
        customer_label, _customer_company_label = privacy_order_customer_labels(
            order,
            order.customer,
            is_unassigned_import_customer(order.customer),
            privacy,
            "Shipping",
        )
        order_contact_phone = privacy_order_contact_phone(order, privacy)
        customer_phone = privacy_customer_phone(order.customer, privacy)
        duty_paid_estimate = calculate_order_usa_shipping(order, "duty_paid")
        non_duty_paid_estimate = calculate_order_usa_shipping(order, "non_duty_paid")
        pending_orders.append({
            "order_id": order.id,
            "order_no": order.order_no,
            "customer_id": order.customer.id if order.customer else None,
            "customer_name": customer_label,
            "order_contact_name": order.import_contact_name,
            "shipping_name": order.import_shipping_name,
            "customer_phone": customer_phone,
            "order_contact_phone": order_contact_phone,
            "shipping_phone": order_contact_phone or customer_phone,
            "shipping_phone_source": "Order sheet" if order_contact_phone else ("Customer" if customer_phone else ""),
            "customer_address": order.import_shipping_address
            or ((order.customer.shipping_address or order.customer.address) if order.customer else ""),
            "platform": order.platform,
            "order_date": order.order_date,
            "expected_ship_date": order.import_ship_date,
            "total_amount": order.total_amount,
            "order_total_usd": order.order_total_usd,
            "payment_status": order.payment_status,
            "shipping_status": order.shipping_status,
            "shipping_weight_override_kg": order.shipping_weight_override_kg,
            "usa_shipping": duty_paid_estimate,
            "usa_shipping_estimates": {
                "duty_paid": duty_paid_estimate,
                "non_duty_paid": non_duty_paid_estimate,
            },
            "items": [
                {
                    "product_id": item.product_id,
                    "article_no": item.product.article_no if item.product else "",
                    "product_name": item.product.name if item.product else "",
                    "product_image_url": item.product.image_url if item.product else None,
                    "product_label_url": item.product.label_url if item.product else None,
                    "product_selling_price": float(item.product.selling_price or 0) if item.product else item.unit_price,
                    "category": item.product.category if item.product else "",
                    "quantity": item.quantity,
                    "unit_weight_kg": float(item.product.unit_weight_kg or 0) if item.product else 0,
                    "line_weight_kg": round(
                        float(item.product.unit_weight_kg or 0) * int(item.quantity or 0),
                        3,
                    ) if item.product else 0,
                    "unit_price": item.unit_price,
                    "line_total": item.line_total,
                    "stock_source": item.stock_source,
                    "manufacturing_required": item.manufacturing_required,
                }
                for item in order.items
            ],
        })
    return pending_orders


def deduct_order_items_for_shipping(db: Session, order_obj: Order):
    for item in order_obj.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product for item {item.id} not found")

        movement_type, movement_qty = deduct_order_item_on_ship(product, item.quantity, item.stock_source)

        stock_movement = StockMovement(
            product_id=product.id,
            movement_type=movement_type,
            quantity=movement_qty,
            stock_type="usa_stock" if str(item.stock_source).lower() == "usa" else "factory_stock",
            source=item.stock_source,
            reference=order_obj.order_no,
            note="Stock deducted for shipped order"
        )
        db.add(stock_movement)


def upsert_shipping_for_order(db: Session, order: Order, shipping):
    existing_shipping = db.query(Shipping).filter(Shipping.order_id == shipping.order_id).first()
    shipping_service = normalize_usa_shipping_service(getattr(shipping, "shipping_service", None))
    usa_estimate = calculate_order_usa_shipping(order, shipping_service)
    calculated_weight = usa_estimate.get("calculation_weight_kg")
    estimated_cost = usa_estimate.get("estimated_shipping_cost")
    package_weight = shipping.package_weight_kg
    shipping_cost = shipping.shipping_cost
    if package_weight is None and usa_estimate.get("weight_complete"):
        package_weight = calculated_weight
    if shipping_cost is None and usa_estimate.get("status") == "ready":
        shipping_cost = estimated_cost
    rate_snapshot = {
        "shipping_service": shipping_service,
        "destination_zip_prefix": usa_estimate.get("destination_zip_prefix"),
        "shipping_zone": usa_estimate.get("zone_label"),
        "calculated_weight_kg": calculated_weight,
        "estimated_shipping_cost": estimated_cost,
        "rate_source_version": usa_estimate.get("source_date"),
    }

    if not is_stock_deducted_shipping_status(order.shipping_status):
        deduct_order_items_for_shipping(db, order)

    if existing_shipping:
        existing_shipping.courier_name = shipping.courier_name
        existing_shipping.tracking_number = shipping.tracking_number
        existing_shipping.package_weight_kg = package_weight
        existing_shipping.shipping_cost = shipping_cost
        existing_shipping.shipping_note = shipping.shipping_note
        for field_name, value in rate_snapshot.items():
            setattr(existing_shipping, field_name, value)
        existing_shipping.updated_at = datetime.utcnow()
        order.shipping_status = "Shipped"
        return existing_shipping

    new_shipping = Shipping(
        order_id=shipping.order_id,
        courier_name=shipping.courier_name,
        tracking_number=shipping.tracking_number,
        package_weight_kg=package_weight,
        shipping_cost=shipping_cost,
        shipping_note=shipping.shipping_note,
        **rate_snapshot,
        shipped_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    order.shipping_status = "Shipped"
    db.add(new_shipping)
    return new_shipping


@app.get("/order-workflow/tasks")
def get_order_workflow_tasks(
    request: Request,
    order_id: int | None = None,
    worker_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    query = db.query(OrderWorkflowTask)
    if order_id is not None:
        query = query.filter(OrderWorkflowTask.order_id == order_id)
    if worker_id is not None:
        query = query.filter(OrderWorkflowTask.assigned_worker_id == worker_id)
    if status:
        normalized = status.strip().lower()
        if normalized == "open":
            query = query.filter(OrderWorkflowTask.status.in_(list(ORDER_WORKFLOW_OPEN_STATUSES)))
        else:
            query = query.filter(func.lower(OrderWorkflowTask.status) == normalized)

    tasks = query.order_by(OrderWorkflowTask.id.desc()).all()
    return [order_workflow_task_response(task, privacy) for task in tasks]


@app.post("/orders/{order_id}/workflow-tasks")
def create_order_workflow_task(
    order_id: int,
    payload: OrderWorkflowTaskCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    worker = db.query(Worker).filter(Worker.id == payload.worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    if not worker.is_active:
        raise HTTPException(status_code=400, detail="Worker is inactive")

    task_type = normalize_order_workflow_task_type(payload.task_type)
    title = f"{task_type} for order {order.order_no}"
    now = datetime.utcnow()
    assigned_quantity, rate_per_piece, labor_cost = normalize_order_workflow_task_earning(
        payload,
        order,
        worker,
    )

    task = (
        db.query(OrderWorkflowTask)
        .filter(
            OrderWorkflowTask.order_id == order.id,
            OrderWorkflowTask.task_type == task_type,
            OrderWorkflowTask.status.in_(list(ORDER_WORKFLOW_OPEN_STATUSES)),
        )
        .first()
    )

    if task:
        assigned_name = task.assigned_worker.name if task.assigned_worker else "another worker"
        if task.assigned_worker_id == worker.id:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{task_type} is already assigned to {assigned_name}. "
                    "Cancel the current assignment before assigning it again."
                ),
            )
        raise HTTPException(
            status_code=409,
            detail=(
                f"{task_type} is already assigned to {assigned_name}. "
                "Cancel the current assignment before assigning another worker."
            ),
        )
    else:
        task = OrderWorkflowTask(
            order_id=order.id,
            task_type=task_type,
            title=title,
            status="New",
            assigned_worker_id=worker.id,
            assigned_by_user_id=payload.assigned_by_user_id,
            assigned_by_user_name=payload.assigned_by_user_name,
            assigned_quantity=assigned_quantity,
            rate_per_piece=rate_per_piece,
            labor_cost=labor_cost,
            notes=(payload.notes or "").strip() or None,
            due_at=payload.due_at,
            created_at=now,
            updated_at=now,
        )
        db.add(task)

    db.commit()
    db.refresh(task)
    send_configured_email_event(
        db,
        "order_workflow_task_assigned",
        order_workflow_task_email_context(db, task),
    )
    return order_workflow_task_response(task, privacy)


@app.patch("/order-workflow/tasks/{task_id}/cancel")
def cancel_order_workflow_task(
    task_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    task = db.query(OrderWorkflowTask).filter(OrderWorkflowTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Order workflow task not found")
    if task.status == "Completed":
        raise HTTPException(status_code=400, detail="Completed task cannot be canceled")
    if task.status == "Canceled":
        return order_workflow_task_response(task, privacy)

    task.status = "Canceled"
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return order_workflow_task_response(task, privacy)


@app.patch("/order-workflow/tasks/{task_id}/start")
def start_order_workflow_task(
    task_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    task = db.query(OrderWorkflowTask).filter(OrderWorkflowTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Order workflow task not found")
    if task.status == "Completed":
        raise HTTPException(status_code=400, detail="Completed task cannot be started")
    if task.status == "Canceled":
        raise HTTPException(status_code=400, detail="Canceled task cannot be started")
    if task.status == "Pending Verification":
        raise HTTPException(status_code=400, detail="Task is waiting admin verification")

    task.status = "In Progress"
    task.started_at = task.started_at or datetime.utcnow()
    task.updated_at = datetime.utcnow()
    if (
        task.order
        and not is_stock_deducted_shipping_status(task.order.shipping_status)
    ):
        mark_order_unfulfilled(task.order)
        if task.task_type == "Preparation":
            task.order.shipping_status = "Preparing"
        elif task.task_type == "Shipping":
            task.order.shipping_status = "Packed"

    db.commit()
    db.refresh(task)
    return order_workflow_task_response(task, privacy)


@app.patch("/order-workflow/tasks/{task_id}/complete")
def complete_order_workflow_task(
    task_id: int,
    payload: OrderWorkflowTaskComplete,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    task = db.query(OrderWorkflowTask).filter(OrderWorkflowTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Order workflow task not found")
    if task.status == "Completed":
        return order_workflow_task_response(task, privacy)
    if task.status == "Canceled":
        raise HTTPException(status_code=400, detail="Canceled task cannot be completed")
    if task.status == "Pending Verification" and not payload.verify:
        raise HTTPException(status_code=400, detail="Task is already waiting admin verification")
    if task.status == "New":
        raise HTTPException(status_code=400, detail="Accept the task before completing it")
    if not task.order:
        raise HTTPException(status_code=404, detail="Order not found")

    now = datetime.utcnow()
    should_record_shipping = (
        task.task_type == "Shipping"
        and (
            not payload.verify
            or any(
                value is not None and str(value).strip() != ""
                for value in [
                    payload.courier_name,
                    payload.tracking_number,
                    payload.package_weight_kg,
                ]
            )
        )
    )
    if should_record_shipping:
        tracking_number = (payload.tracking_number or "").strip()
        courier_name = (payload.courier_name or "").strip()
        if not courier_name:
            raise HTTPException(status_code=400, detail="Courier name is required to ship the order")
        if not tracking_number:
            raise HTTPException(status_code=400, detail="Tracking number is required to ship the order")
        if payload.package_weight_kg is None:
            raise HTTPException(status_code=400, detail="Package weight is required to ship the order")

        shipping_payload = ShippingCreate(
            order_id=task.order_id,
            courier_name=courier_name,
            tracking_number=tracking_number,
            package_weight_kg=payload.package_weight_kg,
            shipping_cost=payload.shipping_cost,
            shipping_note=(payload.shipping_note or payload.note or "").strip() or None,
        )
        upsert_shipping_for_order(db, task.order, shipping_payload)
    elif task.task_type == "Preparation" and not is_stock_deducted_shipping_status(task.order.shipping_status):
        task.order.shipping_status = "Packed"

    if payload.note:
        existing_note = (task.notes or "").strip()
        task.notes = f"{existing_note}\n{payload.note.strip()}".strip()
    task.updated_at = now
    task.assigned_quantity = task.assigned_quantity or order_workflow_task_default_quantity(task.order)
    task.rate_per_piece = task.rate_per_piece or 0

    if not payload.verify:
        task.status = "Pending Verification"
        task.completed_at = None
        if task.labor_cost is None:
            task.labor_cost = float(task.assigned_quantity or 1) * float(task.rate_per_piece or 0)
        db.commit()
        db.refresh(task)
        return order_workflow_task_response(task, privacy)

    task.status = "Completed"
    task.completed_at = now
    if task.labor_cost is None or float(task.labor_cost or 0) <= 0:
        task.labor_cost = float(task.assigned_quantity or 1) * float(task.rate_per_piece or 0)
    else:
        task.labor_cost = max(float(task.labor_cost or 0), 0)

    db.commit()
    db.refresh(task)
    return order_workflow_task_response(task, privacy)


@app.get("/order-follow-ups")
def get_order_follow_ups(
    request: Request,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    ensure_order_follow_ups(db)
    query = db.query(OrderFollowUp)
    if status:
        normalized = status.strip().lower()
        if normalized == "open":
            query = query.filter(OrderFollowUp.status.in_(["Pending", "Followed Up", "No Review"]))
        else:
            query = query.filter(func.lower(OrderFollowUp.status) == normalized)

    follow_ups = query.order_by(
        OrderFollowUp.follow_up_due_at.is_(None),
        OrderFollowUp.follow_up_due_at.asc(),
        OrderFollowUp.id.desc(),
    ).all()
    return [order_follow_up_response(follow_up, privacy) for follow_up in follow_ups]


@app.post("/orders/{order_id}/follow-up")
def ensure_order_follow_up(
    order_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    follow_up = db.query(OrderFollowUp).filter(OrderFollowUp.order_id == order.id).first()
    if not follow_up:
        now = datetime.utcnow()
        follow_up = OrderFollowUp(
            order_id=order.id,
            customer_id=order.customer_id,
            status="Pending",
            channel="WhatsApp",
            follow_up_due_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(follow_up)
        db.commit()
        db.refresh(follow_up)

    return order_follow_up_response(follow_up, privacy)


@app.patch("/order-follow-ups/{follow_up_id}")
def update_order_follow_up(
    follow_up_id: int,
    payload: OrderFollowUpUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    follow_up = db.query(OrderFollowUp).filter(OrderFollowUp.id == follow_up_id).first()
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")

    requested_status = (payload.status or "").strip()
    if requested_status not in FOLLOW_UP_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid follow-up status")

    now = datetime.utcnow()
    follow_up.status = requested_status
    if payload.channel is not None:
        follow_up.channel = payload.channel.strip() or follow_up.channel
    if payload.message is not None:
        follow_up.message = payload.message.strip() or None
    if payload.review_note is not None:
        follow_up.review_note = payload.review_note.strip() or None

    if requested_status in {"Followed Up", "Review Provided", "No Review", "Closed"}:
        follow_up.followed_up_at = follow_up.followed_up_at or now
    if requested_status == "Review Provided":
        follow_up.review_provided = True
    elif requested_status == "No Review":
        follow_up.review_provided = False
    elif payload.review_provided is not None:
        follow_up.review_provided = payload.review_provided

    follow_up.updated_at = now
    db.commit()
    db.refresh(follow_up)
    return order_follow_up_response(follow_up, privacy)


@app.post("/shipping/mark-shipped", response_model=ShippingOut)
def mark_order_shipped(
    shipping: ShippingCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    privacy = access_privacy_context(request, db)
    order = db.query(Order).filter(Order.id == shipping.order_id).first()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    shipping_record = upsert_shipping_for_order(db, order, shipping)
    db.commit()
    db.refresh(shipping_record)

    return shipping_response(shipping_record, privacy)


@app.patch("/shipping/{shipping_id}", response_model=ShippingOut)
def update_shipping_record(
    shipping_id: int,
    shipping_update: ShippingUpdate,
    request: Request,
    db: Session = Depends(get_db)
):
    privacy = access_privacy_context(request, db)
    record = db.query(Shipping).filter(Shipping.id == shipping_id).first()

    if not record:
        raise HTTPException(status_code=404, detail="Shipping record not found")

    if shipping_update.courier_name is not None:
        record.courier_name = shipping_update.courier_name

    if shipping_update.tracking_number is not None:
        record.tracking_number = shipping_update.tracking_number

    if shipping_update.package_weight_kg is not None:
        record.package_weight_kg = shipping_update.package_weight_kg

    if shipping_update.shipping_cost is not None:
        record.shipping_cost = shipping_update.shipping_cost

    if shipping_update.shipping_note is not None:
        record.shipping_note = shipping_update.shipping_note

    if shipping_update.shipping_service is not None:
        record.shipping_service = normalize_usa_shipping_service(shipping_update.shipping_service)

    record.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(record)

    return shipping_response(record, privacy)

@app.delete("/shipping/{shipping_id}")
def delete_shipping_record(shipping_id: int, db: Session = Depends(get_db)):
    record = db.query(Shipping).filter(Shipping.id == shipping_id).first()

    if not record:
        raise HTTPException(status_code=404, detail="Shipping record not found")

    # Delete associated courier payments
    if record.courier_name:
        if record.tracking_number:
            # Delete payment with matching courier and tracking reference
            courier_payments = db.query(CourierPayment).filter(
                CourierPayment.courier_name == record.courier_name,
                CourierPayment.payment_reference == record.tracking_number
            ).all()
        else:
            # If no tracking number, try to find by courier and shipping cost
            if record.shipping_cost:
                courier_payments = db.query(CourierPayment).filter(
                    CourierPayment.courier_name == record.courier_name,
                    CourierPayment.amount == record.shipping_cost
                ).order_by(CourierPayment.id.desc()).limit(1).all()
            else:
                courier_payments = []
        
        for payment in courier_payments:
            db.delete(payment)

    db.delete(record)
    db.commit()

    return {"message": "Shipping record deleted successfully. Courier payment reversed.", "deleted_shipping_id": shipping_id}

# Workers API
@app.post("/workers", response_model=WorkerOut)
def create_worker(worker: WorkerCreate, db: Session = Depends(get_db)):
    new_worker = Worker(**worker.model_dump())
    db.add(new_worker)
    db.commit()
    db.refresh(new_worker)
    return new_worker

@app.get("/workers", response_model=list[WorkerOut])
def get_workers(db: Session = Depends(get_db)):
    return db.query(Worker).order_by(Worker.id.desc()).all()

@app.put("/workers/{worker_id}", response_model=WorkerOut)
@app.patch("/workers/{worker_id}", response_model=WorkerOut)
def update_worker(worker_id: int, payload: WorkerCreate, db: Session = Depends(get_db)):
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    clean_name = payload.name.strip()
    clean_role = payload.role.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Worker name is required")
    if not clean_role:
        raise HTTPException(status_code=400, detail="Worker role is required")

    worker.name = clean_name
    worker.role = clean_role
    worker.phone = payload.phone
    worker.email = payload.email
    worker.department = payload.department
    worker.rate_per_piece = payload.rate_per_piece
    worker.is_active = payload.is_active
    db.commit()
    db.refresh(worker)
    return worker

@app.delete("/workers/{worker_id}")
def delete_worker(worker_id: int, db: Session = Depends(get_db)):
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    delete_worker_record(db, worker)
    db.commit()
    return {"message": "Worker deleted successfully", "deleted_worker_id": worker_id}


@app.get("/worker-payments", response_model=list[WorkerPaymentOut])
def get_worker_payments(
    worker_id: int | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    query = db.query(WorkerPayment)
    if worker_id is not None:
        query = query.filter(WorkerPayment.worker_id == worker_id)
    payments = (
        query.order_by(WorkerPayment.paid_at.desc(), WorkerPayment.id.desc())
        .limit(limit)
        .all()
    )
    return [worker_payment_response(payment) for payment in payments]


@app.post("/worker-payments", response_model=WorkerPaymentOut)
@app.post("/workers/{worker_id}/payments", response_model=WorkerPaymentOut)
def create_worker_payment(
    payment: WorkerPaymentCreate,
    worker_id: int | None = None,
    db: Session = Depends(get_db),
):
    target_worker_id = worker_id or getattr(payment, "worker_id", None)
    if not target_worker_id:
        raise HTTPException(status_code=400, detail="Worker ID is required.")

    worker = db.query(Worker).filter(Worker.id == target_worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    amount = float(payment.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than 0")

    account = None
    if payment.account_id:
        account = db.query(AccountingAccount).filter(AccountingAccount.id == payment.account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Accounting account not found")

    paid_at = payment.paid_at or datetime.utcnow()
    new_payment = WorkerPayment(
        worker_id=worker.id,
        amount=amount,
        payment_method=(payment.payment_method or "").strip() or None,
        payment_reference=(payment.payment_reference or "").strip() or None,
        note=(payment.note or "").strip() or None,
        paid_at=paid_at,
        created_at=datetime.utcnow(),
    )
    db.add(new_payment)
    db.flush()

    if account:
        currency = normalize_accounting_currency(account.currency)
        transaction = AccountingTransaction(
            account_id=account.id,
            direction="Money Out",
            category="Worker Payment",
            amount=amount,
            currency=currency,
            exchange_rate=1,
            amount_pkr=accounting_amount_pkr(
                amount=amount,
                currency=currency,
                exchange_rate=1,
                amount_pkr=amount if currency == "PKR" else None,
            ),
            counterparty=worker.name,
            platform=None,
            reference=new_payment.payment_reference,
            source_type=ACCOUNTING_WORKER_PAYMENT_SOURCE,
            source_id=new_payment.id,
            description=new_payment.note or f"Worker payment to {worker.name}",
            transaction_date=paid_at,
        )
        db.add(transaction)
        db.flush()
        new_payment.accounting_transaction_id = transaction.id

    db.commit()
    db.refresh(new_payment)
    return worker_payment_response(new_payment)


@app.delete("/workers/{worker_id}/payments/{payment_id}")
def delete_worker_payment(
    worker_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
):
    payment = (
        db.query(WorkerPayment)
        .filter(WorkerPayment.id == payment_id, WorkerPayment.worker_id == worker_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Worker payment not found")

    transaction_id = payment.accounting_transaction_id
    db.delete(payment)
    if transaction_id:
        transaction = (
            db.query(AccountingTransaction)
            .filter(
                AccountingTransaction.id == transaction_id,
                AccountingTransaction.source_type == ACCOUNTING_WORKER_PAYMENT_SOURCE,
            )
            .first()
        )
        if transaction:
            db.delete(transaction)

    db.commit()
    return {"detail": "Worker payment deleted"}

# Production APIs

def next_production_batch_number(db: Session) -> str:
    prefix = datetime.utcnow().strftime("PB-%Y%m%d")
    existing_numbers = [
        row[0]
        for row in db.query(ProductionBatch.batch_no)
        .filter(ProductionBatch.batch_no.like(f"{prefix}-%"))
        .all()
    ]
    suffixes = []
    for batch_no in existing_numbers:
        try:
            suffixes.append(int(batch_no.rsplit("-", 1)[-1]))
        except (TypeError, ValueError):
            continue
    return f"{prefix}-{max(suffixes, default=0) + 1:03d}"


def next_manual_task_number(db: Session) -> str:
    prefix = datetime.utcnow().strftime("MT-%Y%m%d")
    existing_numbers = [
        row[0]
        for row in db.query(ProductionBatch.batch_no)
        .filter(ProductionBatch.batch_no.like(f"{prefix}-%"))
        .all()
    ]
    suffixes = []
    for batch_no in existing_numbers:
        try:
            suffixes.append(int(batch_no.rsplit("-", 1)[-1]))
        except (TypeError, ValueError):
            continue
    return f"{prefix}-{max(suffixes, default=0) + 1:03d}"


@app.get("/production/planning")
def production_planning(db: Session = Depends(get_db)):
    products = db.query(Product).order_by(Product.article_no).all()
    workflow_steps = db.query(WorkflowStep).filter(
        WorkflowStep.is_active == True
    ).all()
    batches = db.query(ProductionBatch).all()
    workers = db.query(Worker).filter(Worker.is_active == True).all()

    steps_by_product = {}
    for step in workflow_steps:
        steps_by_product.setdefault(step.product_id, []).append(step)

    active_quantity_by_product = {}
    for batch in batches:
        if effective_batch_status(batch) == "Completed":
            continue
        if not batch.product:
            continue
        active_quantity_by_product[batch.product_id] = (
            active_quantity_by_product.get(batch.product_id, 0)
            + (batch.batch_quantity or 0)
        )

    product_plans = []
    for product in products:
        steps = steps_by_product.get(product.id, [])
        factory_stock = product.factory_stock or 0
        usa_stock = product.usa_stock or 0
        front_room_stock = product.front_room_stock or 0
        reserved_stock = product.reserved_stock or 0
        available_stock = factory_stock + usa_stock + front_room_stock - reserved_stock
        shortage_quantity = max(0, -available_stock)
        low_stock_gap = max(0, (product.low_stock_alert or 0) - available_stock)
        planned_quantity = active_quantity_by_product.get(product.id, 0)
        recommended_quantity = max(
            0,
            max(shortage_quantity, low_stock_gap) - planned_quantity,
        )

        product_plans.append(
            {
                "product_id": product.id,
                "article_no": product.article_no,
                "product_name": product.name,
                "factory_stock": factory_stock,
                "usa_stock": usa_stock,
                "front_room_stock": front_room_stock,
                "reserved_stock": reserved_stock,
                "available_stock": available_stock,
                "low_stock_alert": product.low_stock_alert or 0,
                "shortage_quantity": shortage_quantity,
                "active_batch_quantity": planned_quantity,
                "recommended_quantity": recommended_quantity,
                "workflow_step_count": len(steps),
                "workflow_ready": len(steps) > 0,
                "estimated_minutes_per_piece": sum(
                    step.estimated_minutes_per_piece or 0 for step in steps
                ),
                "estimated_labor_per_piece": sum(
                    step.rate_per_piece or 0 for step in steps
                ),
            }
        )

    return {
        "next_batch_no": next_production_batch_number(db),
        "active_workers": len(workers),
        "products_needing_production": sum(
            1 for product in product_plans if product["recommended_quantity"] > 0
        ),
        "products_missing_workflow": sum(
            1 for product in product_plans if not product["workflow_ready"]
        ),
        "products": product_plans,
    }


@app.get("/production/summary")
def production_summary(db: Session = Depends(get_db)):
    batches = db.query(ProductionBatch).all()
    tasks = db.query(ProductionTask).all()

    today = datetime.utcnow().date()

    completing_today = 0
    for task in tasks:
        if task.expected_completion_time and task.expected_completion_time.date() == today and task.status != "Completed":
            completing_today += 1

    batch_statuses = [effective_batch_status(batch) for batch in batches]
    active_tasks = [task for task in tasks if task.status != "Completed"]

    return {
        "total_batches": len(batches),
        "pending_batches": batch_statuses.count("Pending"),
        "in_progress_batches": batch_statuses.count("In Progress"),
        "completed_batches": batch_statuses.count("Completed"),
        "total_tasks": len(tasks),
        "ready_tasks": sum(1 for t in tasks if t.status == "Ready"),
        "in_progress_tasks": sum(1 for t in tasks if t.status == "In Progress"),
        "completed_tasks": sum(1 for t in tasks if t.status == "Completed"),
        "late_tasks": sum(
            1
            for task in tasks
            if task.timing_status == "Late"
            or (
                task.status != "Completed"
                and task.expected_completion_time is not None
                and task.expected_completion_time < datetime.utcnow()
            )
        ),
        "unassigned_tasks": sum(1 for t in active_tasks if t.worker_id is None),
        "completing_today": completing_today,
    }


@app.get("/production/batches")
def get_production_batches(db: Session = Depends(get_db)):
    batches = db.query(ProductionBatch).order_by(ProductionBatch.id.desc()).all()
    return [production_batch_response(b) for b in batches]


@app.post("/production/batches")
def create_production_batch(batch: ProductionBatchCreate, db: Session = Depends(get_db)):
    if batch.batch_quantity <= 0:
        raise HTTPException(status_code=400, detail="Batch quantity must be greater than 0")

    batch_no = (batch.batch_no or "").strip() or next_production_batch_number(db)
    existing = db.query(ProductionBatch).filter(
        ProductionBatch.batch_no == batch_no
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Batch number already exists")

    product = db.query(Product).filter(Product.id == batch.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    workflow_steps = (
        db.query(WorkflowStep)
        .filter(WorkflowStep.product_id == batch.product_id, WorkflowStep.is_active == True)
        .order_by(WorkflowStep.step_order)
        .all()
    )
    if not batch.include_optional_steps:
        workflow_steps = [step for step in workflow_steps if not step.is_optional]

    if len(workflow_steps) == 0:
        raise HTTPException(status_code=400, detail="No active workflow steps found for this product")

    now = datetime.utcnow()

    total_estimated_minutes = sum(
        (step.estimated_minutes_per_piece or 0) * batch.batch_quantity
        for step in workflow_steps
    )

    new_batch = ProductionBatch(
        batch_no=batch_no,
        product_id=batch.product_id,
        batch_quantity=batch.batch_quantity,
        priority=batch.priority,
        status="Pending",
        source_type="Workflow",
        notes=batch.notes,
        due_date=batch.due_date,
        expected_completion=now + timedelta(minutes=total_estimated_minutes),
        created_at=now,
        updated_at=now,
    )

    db.add(new_batch)
    db.commit()
    db.refresh(new_batch)

    for index, step in enumerate(workflow_steps):
        estimated_total = (step.estimated_minutes_per_piece or 0) * batch.batch_quantity

        task = ProductionTask(
            batch_id=new_batch.id,
            product_id=batch.product_id,
            workflow_step_id=step.id,
            step_order=step.step_order,
            step_name=step.step_name,
            worker_role=step.worker_role,
            assigned_quantity=batch.batch_quantity,
            completed_quantity=0,
            rate_per_piece=step.rate_per_piece or 0,
            estimated_minutes_per_piece=step.estimated_minutes_per_piece or 0,
            estimated_total_minutes=estimated_total,
            status="Ready" if index == 0 else "Pending",
            timing_status="Not Started",
            labor_cost=0,
            created_at=now,
            updated_at=now,
        )

        db.add(task)

    db.commit()
    db.refresh(new_batch)

    return production_batch_response(new_batch)


@app.post("/production/manual-tasks")
def create_manual_production_task(
    manual_task: ManualProductionTaskCreate,
    db: Session = Depends(get_db),
):
    clean_step_name = manual_task.step_name.strip()
    if not clean_step_name:
        raise HTTPException(status_code=400, detail="Task name is required")

    product = None
    custom_product_name = (manual_task.custom_product_name or "").strip()
    custom_article_no = (manual_task.custom_article_no or "").strip()
    if manual_task.product_id:
        product = db.query(Product).filter(Product.id == manual_task.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
    elif not custom_product_name:
        raise HTTPException(status_code=400, detail="Enter a custom work note or select a product")

    worker = db.query(Worker).filter(Worker.id == manual_task.worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    if not worker.is_active:
        raise HTTPException(status_code=400, detail="Worker is inactive")

    now = datetime.utcnow()
    estimated_minutes = (
        manual_task.estimated_minutes_per_piece or 0
    ) * manual_task.assigned_quantity
    due_date = manual_task.due_date or now.replace(
        hour=18,
        minute=0,
        second=0,
        microsecond=0,
    )
    production_product_id = product.id if product else 0
    production_custom_name = None if product else custom_product_name
    production_custom_article = None if product else custom_article_no or "Custom"

    batch = ProductionBatch(
        batch_no=next_manual_task_number(db),
        product_id=production_product_id,
        custom_product_name=production_custom_name,
        custom_article_no=production_custom_article,
        batch_quantity=manual_task.assigned_quantity,
        priority="Normal",
        status="Pending",
        source_type="Manual",
        notes=(manual_task.notes or "").strip() or None,
        due_date=due_date,
        expected_completion=due_date,
        created_at=now,
        updated_at=now,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    task = ProductionTask(
        batch_id=batch.id,
        product_id=production_product_id,
        custom_product_name=production_custom_name,
        custom_article_no=production_custom_article,
        workflow_step_id=None,
        step_order=1,
        step_name=clean_step_name,
        worker_role=(manual_task.worker_role or worker.role or "").strip() or None,
        worker_id=manual_task.worker_id,
        assigned_quantity=manual_task.assigned_quantity,
        completed_quantity=0,
        rate_per_piece=manual_task.rate_per_piece or worker.rate_per_piece or 0,
        estimated_minutes_per_piece=manual_task.estimated_minutes_per_piece or 0,
        estimated_total_minutes=estimated_minutes,
        expected_completion_time=due_date,
        status="Ready",
        timing_status="Not Started",
        labor_cost=0,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    send_configured_email_event(
        db,
        "manual_task_assigned",
        production_task_email_context(
            db,
            task,
            worker,
            {"notes": (manual_task.notes or "").strip() or "No notes"},
        ),
    )

    return {
        "message": "Manual task assigned",
        "task": production_task_response(task),
        "batch": production_batch_response(batch),
    }


@app.patch("/production/batches/{batch_id}")
def update_production_batch(
    batch_id: int,
    payload: ProductionBatchUpdate,
    db: Session = Depends(get_db),
):
    batch = db.query(ProductionBatch).filter(ProductionBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Production batch not found")

    if payload.priority is not None:
        batch.priority = payload.priority
    if "due_date" in payload.model_fields_set:
        batch.due_date = payload.due_date
    if "notes" in payload.model_fields_set:
        batch.notes = payload.notes
    batch.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(batch)
    return production_batch_response(batch)


@app.post("/production/batches/{batch_id}/auto-assign")
def auto_assign_production_batch(
    batch_id: int,
    db: Session = Depends(get_db),
):
    batch = db.query(ProductionBatch).filter(ProductionBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Production batch not found")

    workers = db.query(Worker).filter(Worker.is_active == True).all()
    if not workers:
        raise HTTPException(status_code=400, detail="No active workers are available")

    active_tasks = db.query(ProductionTask).filter(
        ProductionTask.status != "Completed",
        ProductionTask.worker_id.isnot(None),
    ).all()
    workloads = {worker.id: 0 for worker in workers}
    for active_task in active_tasks:
        if active_task.worker_id in workloads:
            workloads[active_task.worker_id] += 1

    assigned = []
    unmatched = []
    tasks = sorted(batch.tasks, key=lambda task: task.step_order)
    for task in tasks:
        if task.status == "Completed" or task.worker_id is not None:
            continue

        required_role = (task.worker_role or "").strip().lower()
        candidates = []
        for worker in workers:
            worker_role = (worker.role or "").strip().lower()
            department = (worker.department or "").strip().lower()
            role_matches = worker_role and (
                required_role in worker_role or worker_role in required_role
            )
            department_matches = department and (
                required_role in department or department in required_role
            )
            if not required_role or role_matches or department_matches:
                candidates.append(worker)

        if not candidates:
            unmatched.append(task.step_name)
            continue

        worker = min(candidates, key=lambda item: (workloads[item.id], item.id))
        task.worker_id = worker.id
        task.updated_at = datetime.utcnow()
        workloads[worker.id] += 1
        assigned.append(
            {
                "task_id": task.id,
                "step_name": task.step_name,
                "worker_id": worker.id,
                "worker_name": worker.name,
            }
        )

    db.commit()
    db.refresh(batch)
    for assigned_task in assigned:
        task = db.query(ProductionTask).filter(ProductionTask.id == assigned_task["task_id"]).first()
        if task:
            send_configured_email_event(
                db,
                "batch_auto_assigned",
                production_task_email_context(db, task),
            )
    return {
        "message": f"{len(assigned)} tasks assigned",
        "assigned": assigned,
        "unmatched_steps": unmatched,
        "batch": production_batch_response(batch),
    }


@app.get("/production/tasks")
def get_production_tasks(
    worker_id: int | None = None,
    db: Session = Depends(get_db)
):
    query = db.query(ProductionTask)
    if worker_id is not None:
        query = query.filter(ProductionTask.worker_id == worker_id)

    tasks = query.order_by(ProductionTask.id.desc()).all()
    return [production_task_response(t) for t in tasks]


@app.patch("/production/tasks/{task_id}/assign")
def assign_worker_to_task(
    task_id: int,
    assign_data: ProductionTaskAssign,
    db: Session = Depends(get_db)
):
    task = db.query(ProductionTask).filter(ProductionTask.id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Production task not found")

    worker = None
    previous_worker_id = task.worker_id
    if assign_data.worker_id:
        worker = db.query(Worker).filter(Worker.id == assign_data.worker_id).first()
        if not worker:
            raise HTTPException(status_code=404, detail="Worker not found")

    task.worker_id = assign_data.worker_id
    if assign_data.rate_per_piece is not None:
        if assign_data.rate_per_piece < 0:
            raise HTTPException(status_code=400, detail="Rate per piece cannot be negative")
        task.rate_per_piece = assign_data.rate_per_piece
        task.labor_cost = (task.completed_quantity or 0) * (task.rate_per_piece or 0)
    task.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(task)
    if assign_data.worker_id and assign_data.worker_id != previous_worker_id:
        send_configured_email_event(
            db,
            "production_task_assigned",
            production_task_email_context(db, task, worker),
        )

    return production_task_response(task)


@app.patch("/production/tasks/{task_id}/start")
def start_production_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(ProductionTask).filter(ProductionTask.id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Production task not found")

    if task.status == "Completed":
        raise HTTPException(status_code=400, detail="Completed task cannot be started again")
    if task.status == "Pending Verification":
        raise HTTPException(status_code=400, detail="Task is waiting admin verification")
    if task.status == "In Progress":
        raise HTTPException(status_code=400, detail="Task is already in progress")
    if task.worker_id is None:
        raise HTTPException(status_code=400, detail="Assign a worker before starting this task")

    previous_tasks = (
        db.query(ProductionTask)
        .filter(
            ProductionTask.batch_id == task.batch_id,
            ProductionTask.step_order < task.step_order
        )
        .all()
    )

    for previous_task in previous_tasks:
        if previous_task.status != "Completed":
            raise HTTPException(
                status_code=400,
                detail="Previous workflow step is not completed yet"
            )

    now = datetime.utcnow()

    task.status = "In Progress"
    task.actual_start_time = now
    task.expected_completion_time = now + timedelta(minutes=task.estimated_total_minutes or 0)
    task.updated_at = now
    task.batch.status = "In Progress"
    task.batch.updated_at = now

    db.commit()
    db.refresh(task)

    return production_task_response(task)


# Shared Data API (for logging when data is shared to WhatsApp, Email, etc.)
@app.post("/shared-data", response_model=SharedDataOut)
def log_shared_data(shared_data: SharedDataCreate, db: Session = Depends(get_db)):
    # Verify order and customer exist
    order = db.query(Order).filter(Order.id == shared_data.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    customer = db.query(Customer).filter(Customer.id == shared_data.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    new_shared_data = SharedData(**shared_data.model_dump())
    db.add(new_shared_data)
    db.commit()
    db.refresh(new_shared_data)
    return new_shared_data


@app.get("/shared-data")
def get_shared_data(order_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(SharedData)
    if order_id:
        query = query.filter(SharedData.order_id == order_id)
    return query.order_by(SharedData.shared_at.desc()).all()


def require_workspace_data_access(
    data_key: str,
    request: Request,
    db: Session,
) -> User:
    page = WORKSPACE_DATA_PAGES.get(str(data_key or "").strip().lower())
    if not page:
        raise HTTPException(status_code=404, detail="Workspace data key not found.")
    return require_page_access(request, db, page)


def workspace_data_timestamp(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.isoformat(timespec="milliseconds") + "Z"


@app.get("/workspace-data/{data_key}")
def get_workspace_data(
    data_key: str,
    request: Request,
    db: Session = Depends(get_db),
):
    require_workspace_data_access(data_key, request, db)
    record = (
        db.query(WorkspaceData)
        .filter(WorkspaceData.data_key == data_key)
        .first()
    )
    if not record:
        return {"data": None, "found": False, "updated_at": None}

    try:
        data = json.loads(record.payload)
    except (TypeError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=500,
            detail="Saved workspace data could not be read.",
        ) from error

    return {
        "data": data,
        "found": True,
        "updated_at": workspace_data_timestamp(record.updated_at),
    }


@app.put("/workspace-data/{data_key}")
def save_workspace_data(
    data_key: str,
    payload: WorkspaceDataPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    require_workspace_data_access(data_key, request, db)
    encoded = json.dumps(payload.data, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_WORKSPACE_DATA_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Workspace data is larger than the 5 MB limit.",
        )

    record = (
        db.query(WorkspaceData)
        .filter(WorkspaceData.data_key == data_key)
        .first()
    )
    if record:
        record.payload = encoded
        record.updated_at = datetime.utcnow()
    else:
        record = WorkspaceData(data_key=data_key, payload=encoded)
        db.add(record)

    db.commit()
    db.refresh(record)
    return {
        "data": payload.data,
        "found": True,
        "updated_at": workspace_data_timestamp(record.updated_at),
    }


@app.delete("/workspace-data/{data_key}")
def delete_workspace_data(
    data_key: str,
    request: Request,
    db: Session = Depends(get_db),
):
    require_workspace_data_access(data_key, request, db)
    deleted = (
        db.query(WorkspaceData)
        .filter(WorkspaceData.data_key == data_key)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": bool(deleted)}


@app.patch("/production/tasks/{task_id}/progress")
def update_task_progress(
    task_id: int,
    progress: ProductionTaskProgressUpdate,
    db: Session = Depends(get_db)
):
    task = db.query(ProductionTask).filter(ProductionTask.id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Production task not found")

    if progress.completed_quantity < 0:
        raise HTTPException(status_code=400, detail="Completed quantity cannot be negative")

    if progress.completed_quantity > task.assigned_quantity:
        raise HTTPException(status_code=400, detail="Completed quantity cannot be greater than assigned quantity")
    if task.status == "Pending":
        raise HTTPException(status_code=400, detail="Previous workflow step is not completed yet")
    if task.status == "Completed":
        raise HTTPException(status_code=400, detail="Completed task progress cannot be changed")
    if task.status == "Pending Verification":
        raise HTTPException(status_code=400, detail="Task is waiting admin verification")
    if task.worker_id is None:
        raise HTTPException(status_code=400, detail="Assign a worker before updating progress")

    task.completed_quantity = progress.completed_quantity
    task.labor_cost = task.completed_quantity * (task.rate_per_piece or 0)
    task.updated_at = datetime.utcnow()

    if task.completed_quantity > 0 and task.status == "Ready":
        task.status = "In Progress"
        if task.actual_start_time is None:
            task.actual_start_time = datetime.utcnow()
            task.expected_completion_time = task.actual_start_time + timedelta(
                minutes=task.estimated_total_minutes or 0
            )
        task.batch.status = "In Progress"
        task.batch.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(task)

    return production_task_response(task)


@app.patch("/production/tasks/{task_id}/complete")
def complete_production_task(
    task_id: int,
    complete_data: ProductionTaskComplete,
    db: Session = Depends(get_db)
):
    task = db.query(ProductionTask).filter(ProductionTask.id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Production task not found")

    if task.status == "Completed":
        raise HTTPException(status_code=400, detail="Task already completed")
    if task.status == "Pending Verification" and not complete_data.verify:
        raise HTTPException(status_code=400, detail="Task is already waiting admin verification")
    if task.status not in ["Ready", "In Progress", "Pending Verification"]:
        raise HTTPException(status_code=400, detail="Task is not ready to complete yet")
    if task.worker_id is None:
        raise HTTPException(status_code=400, detail="Assign a worker before completing this task")

    completed_qty = complete_data.completed_quantity
    if completed_qty is None:
        completed_qty = task.assigned_quantity

    if completed_qty < 0:
        raise HTTPException(status_code=400, detail="Completed quantity cannot be negative")
    if completed_qty > task.assigned_quantity:
        raise HTTPException(status_code=400, detail="Completed quantity cannot be greater than assigned quantity")

    previous_tasks = (
        db.query(ProductionTask)
        .filter(
            ProductionTask.batch_id == task.batch_id,
            ProductionTask.step_order < task.step_order,
        )
        .all()
    )
    if any(previous_task.status != "Completed" for previous_task in previous_tasks):
        raise HTTPException(
            status_code=400,
            detail="Previous workflow step is not completed yet",
        )

    now = datetime.utcnow()

    if task.actual_start_time is None:
        task.actual_start_time = now
    task.completed_quantity = completed_qty
    task.updated_at = now

    if not complete_data.verify:
        task.labor_cost = 0
        task.status = "Pending Verification"
        task.timing_status = "Pending Verification"
        task.delay_reason = complete_data.delay_reason
        task.batch.status = "In Progress"
        task.batch.updated_at = now
        db.commit()
        db.refresh(task)
        return production_task_response(task)

    task.labor_cost = task.completed_quantity * (task.rate_per_piece or 0)
    task.actual_completion_time = now
    task.status = "Completed"

    if task.expected_completion_time:
        delay_seconds = (now - task.expected_completion_time).total_seconds()

        if delay_seconds > 0:
            task.timing_status = "Late"
            task.delay_minutes = int(delay_seconds / 60)
            task.delay_reason = complete_data.delay_reason
        else:
            task.timing_status = "On Time"
            task.delay_minutes = 0
            task.delay_reason = None
    else:
        task.timing_status = "Completed"
        task.delay_minutes = 0
        task.delay_reason = complete_data.delay_reason

    next_task = (
        db.query(ProductionTask)
        .filter(
            ProductionTask.batch_id == task.batch_id,
            ProductionTask.step_order > task.step_order,
            ProductionTask.status == "Pending"
        )
        .order_by(ProductionTask.step_order)
        .first()
    )

    if next_task:
        next_task.status = "Ready"
        next_task.updated_at = now

    remaining_tasks = (
        db.query(ProductionTask)
        .filter(
            ProductionTask.batch_id == task.batch_id,
            ProductionTask.status != "Completed"
        )
        .all()
    )

    if len(remaining_tasks) == 0:
        batch = task.batch

        if batch.status != "Completed":
            batch.status = "Completed"
            batch.actual_completion = now
            batch.updated_at = now

            product = db.query(Product).filter(Product.id == batch.product_id).first()
            if product and (batch.source_type or "Workflow") != "Manual":
                product.factory_stock += batch.batch_quantity

                movement = StockMovement(
                    product_id=product.id,
                    movement_type="Production Completed",
                    quantity=batch.batch_quantity,
                    stock_type="factory_stock",
                    source="Production",
                    reference=batch.batch_no,
                    note="Factory stock added after production batch completed",
                    created_at=now,
                )
                db.add(movement)
    else:
        task.batch.status = "In Progress"
        task.batch.updated_at = now

    db.commit()
    db.refresh(task)

    return production_task_response(task)


# Regular Billing / Payments APIs

@app.get("/regular-bills", response_model=list[RegularBillOut])
def get_regular_bills(db: Session = Depends(get_db)):
    bills = db.query(RegularBill).order_by(
        RegularBill.status.asc(),
        RegularBill.next_due_date.asc(),
        RegularBill.name.asc(),
    ).all()
    return [regular_bill_response(bill) for bill in bills]


@app.post("/regular-bills", response_model=RegularBillOut)
def create_regular_bill(bill: RegularBillCreate, db: Session = Depends(get_db)):
    clean_name = validate_regular_bill_payload(bill)
    now = datetime.utcnow()

    new_bill = RegularBill(
        name=clean_name,
        category=(bill.category or "Utilities").strip() or "Utilities",
        vendor=(bill.vendor or "").strip() or None,
        amount=bill.amount,
        currency=(bill.currency or "PKR").strip() or "PKR",
        frequency=bill.frequency,
        next_due_date=bill.next_due_date,
        reminder_days=bill.reminder_days,
        payment_method=(bill.payment_method or "").strip() or None,
        account_reference=(bill.account_reference or "").strip() or None,
        status=bill.status,
        notes=(bill.notes or "").strip() or None,
        created_at=now,
        updated_at=now,
    )

    db.add(new_bill)
    db.commit()
    db.refresh(new_bill)
    return regular_bill_response(new_bill)


@app.put("/regular-bills/{bill_id}", response_model=RegularBillOut)
def update_regular_bill(
    bill_id: int,
    payload: RegularBillUpdate,
    db: Session = Depends(get_db),
):
    bill = db.query(RegularBill).filter(RegularBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Regular bill not found")

    clean_name = validate_regular_bill_payload(payload)
    bill.name = clean_name
    bill.category = (payload.category or "Utilities").strip() or "Utilities"
    bill.vendor = (payload.vendor or "").strip() or None
    bill.amount = payload.amount
    bill.currency = (payload.currency or "PKR").strip() or "PKR"
    bill.frequency = payload.frequency
    bill.next_due_date = payload.next_due_date
    bill.reminder_days = payload.reminder_days
    bill.payment_method = (payload.payment_method or "").strip() or None
    bill.account_reference = (payload.account_reference or "").strip() or None
    bill.status = payload.status
    bill.notes = (payload.notes or "").strip() or None
    bill.updated_at = datetime.utcnow()

    db.add(bill)
    db.commit()
    db.refresh(bill)
    return regular_bill_response(bill)


@app.delete("/regular-bills/{bill_id}")
def delete_regular_bill(bill_id: int, db: Session = Depends(get_db)):
    bill = db.query(RegularBill).filter(RegularBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Regular bill not found")

    db.delete(bill)
    db.commit()
    return {"detail": "Regular bill deleted"}


@app.post("/regular-bills/{bill_id}/payments", response_model=RegularBillOut)
def record_regular_bill_payment(
    bill_id: int,
    payload: RegularBillPaymentCreate,
    db: Session = Depends(get_db),
):
    bill = db.query(RegularBill).filter(RegularBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Regular bill not found")

    paid_amount = payload.amount if payload.amount is not None else bill.amount
    if paid_amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than 0")

    paid_at = payload.paid_at or datetime.utcnow()
    payment = RegularBillPayment(
        bill_id=bill.id,
        amount=paid_amount,
        payment_method=(payload.payment_method or bill.payment_method or "").strip() or None,
        payment_reference=(payload.payment_reference or "").strip() or None,
        note=(payload.note or "").strip() or None,
        paid_at=paid_at,
        created_at=datetime.utcnow(),
    )

    bill.last_paid_at = paid_at
    bill.next_due_date = next_regular_bill_due_date(
        bill.next_due_date,
        bill.frequency,
        paid_at,
    )
    if bill.frequency == "One-time":
        bill.status = "Completed"
    bill.updated_at = datetime.utcnow()

    db.add(payment)
    db.add(bill)
    db.commit()
    db.refresh(bill)
    return regular_bill_response(bill)


@app.put("/regular-bills/{bill_id}/payments/{payment_id}", response_model=RegularBillOut)
def update_regular_bill_payment(
    bill_id: int,
    payment_id: int,
    payload: RegularBillPaymentCreate,
    db: Session = Depends(get_db),
):
    bill = db.query(RegularBill).filter(RegularBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Regular bill not found")

    payment = (
        db.query(RegularBillPayment)
        .filter(
            RegularBillPayment.id == payment_id,
            RegularBillPayment.bill_id == bill_id,
        )
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found")

    paid_amount = payload.amount if payload.amount is not None else payment.amount
    if paid_amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than 0")

    payment.amount = paid_amount
    payment.payment_method = (payload.payment_method or "").strip() or None
    payment.payment_reference = (payload.payment_reference or "").strip() or None
    payment.note = (payload.note or "").strip() or None
    payment.paid_at = payload.paid_at or payment.paid_at or datetime.utcnow()
    sync_regular_bill_last_paid_at(bill)
    bill.updated_at = datetime.utcnow()

    db.add(payment)
    db.add(bill)
    db.commit()
    db.refresh(bill)
    return regular_bill_response(bill)


@app.delete("/regular-bills/{bill_id}/payments/{payment_id}", response_model=RegularBillOut)
def delete_regular_bill_payment(
    bill_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
):
    bill = db.query(RegularBill).filter(RegularBill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Regular bill not found")

    payment = (
        db.query(RegularBillPayment)
        .filter(
            RegularBillPayment.id == payment_id,
            RegularBillPayment.bill_id == bill_id,
        )
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found")

    db.delete(payment)
    db.flush()
    db.refresh(bill)
    sync_regular_bill_last_paid_at(bill)
    bill.updated_at = datetime.utcnow()

    db.add(bill)
    db.commit()
    db.refresh(bill)
    return regular_bill_response(bill)


@app.get("/accounting/overview")
def get_accounting_overview(db: Session = Depends(get_db)):
    if ensure_default_accounting_accounts(db):
        db.commit()
    return accounting_overview_response(db)


@app.get("/accounting/accounts", response_model=list[AccountingAccountOut])
def get_accounting_accounts(db: Session = Depends(get_db)):
    if ensure_default_accounting_accounts(db):
        db.commit()
    accounts = db.query(AccountingAccount).order_by(AccountingAccount.account_type, AccountingAccount.name).all()
    return [accounting_account_response(account) for account in accounts]


@app.post("/accounting/accounts", response_model=AccountingAccountOut)
def create_accounting_account(payload: AccountingAccountCreate, db: Session = Depends(get_db)):
    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Account name is required")

    existing = (
        db.query(AccountingAccount)
        .filter(func.lower(AccountingAccount.name) == clean_name.lower())
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Account name already exists")

    account = AccountingAccount(
        name=clean_name,
        account_type=normalize_accounting_account_type(payload.account_type),
        platform=payload.platform.strip() if payload.platform else None,
        currency=normalize_accounting_currency(payload.currency),
        opening_balance=max(float(payload.opening_balance or 0), 0),
        notes=payload.notes,
        is_active=payload.is_active,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return accounting_account_response(account)


@app.put("/accounting/accounts/{account_id}", response_model=AccountingAccountOut)
def update_accounting_account(
    account_id: int,
    payload: AccountingAccountUpdate,
    db: Session = Depends(get_db),
):
    account = db.query(AccountingAccount).filter(AccountingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Accounting account not found")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        clean_name = data["name"].strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Account name is required")
        duplicate = (
            db.query(AccountingAccount)
            .filter(
                func.lower(AccountingAccount.name) == clean_name.lower(),
                AccountingAccount.id != account_id,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=400, detail="Account name already exists")
        account.name = clean_name

    if "account_type" in data and data["account_type"] is not None:
        account.account_type = normalize_accounting_account_type(data["account_type"])
    if "platform" in data:
        account.platform = data["platform"].strip() if data["platform"] else None
    if "currency" in data and data["currency"] is not None:
        account.currency = normalize_accounting_currency(data["currency"])
    if "opening_balance" in data and data["opening_balance"] is not None:
        account.opening_balance = max(float(data["opening_balance"] or 0), 0)
    if "notes" in data:
        account.notes = data["notes"]
    if "is_active" in data and data["is_active"] is not None:
        account.is_active = data["is_active"]

    db.add(account)
    db.commit()
    db.refresh(account)
    return accounting_account_response(account)


@app.delete("/accounting/accounts/{account_id}")
def delete_accounting_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(AccountingAccount).filter(AccountingAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Accounting account not found")
    if account.transactions:
        raise HTTPException(
            status_code=400,
            detail="Delete or move this account's transactions first.",
        )

    db.delete(account)
    db.commit()
    return {"detail": "Accounting account deleted"}


@app.get("/accounting/transactions", response_model=list[AccountingTransactionOut])
def get_accounting_transactions(
    account_id: int | None = Query(default=None),
    direction: str | None = Query(default=None),
    category: str | None = Query(default=None),
    platform: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    query = db.query(AccountingTransaction)
    if account_id is not None:
        query = query.filter(AccountingTransaction.account_id == account_id)
    if direction:
        query = query.filter(AccountingTransaction.direction == normalize_accounting_direction(direction))
    if category:
        query = query.filter(func.lower(AccountingTransaction.category) == category.strip().lower())
    if platform:
        query = query.filter(func.lower(AccountingTransaction.platform) == platform.strip().lower())
    if q:
        search = f"%{q.strip().lower()}%"
        query = query.filter(
            func.lower(func.coalesce(AccountingTransaction.reference, "")).like(search)
            | func.lower(func.coalesce(AccountingTransaction.counterparty, "")).like(search)
            | func.lower(func.coalesce(AccountingTransaction.description, "")).like(search)
        )

    transactions = (
        query.order_by(AccountingTransaction.transaction_date.desc(), AccountingTransaction.id.desc())
        .limit(limit)
        .all()
    )
    return [accounting_transaction_response(transaction) for transaction in transactions]


@app.post("/accounting/transactions", response_model=AccountingTransactionOut)
def create_accounting_transaction(
    payload: AccountingTransactionCreate,
    db: Session = Depends(get_db),
):
    account = db.query(AccountingAccount).filter(AccountingAccount.id == payload.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Accounting account not found")

    amount = float(payload.amount or 0)
    if amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")

    currency = normalize_accounting_currency(payload.currency)
    transaction = AccountingTransaction(
        account_id=account.id,
        direction=normalize_accounting_direction(payload.direction),
        category=(payload.category or "Manual").strip() or "Manual",
        amount=amount,
        currency=currency,
        exchange_rate=float(payload.exchange_rate or 0),
        amount_pkr=accounting_amount_pkr(
            amount=amount,
            currency=currency,
            exchange_rate=payload.exchange_rate,
            amount_pkr=payload.amount_pkr,
        ),
        counterparty=payload.counterparty,
        platform=payload.platform.strip() if payload.platform else account.platform,
        reference=payload.reference,
        source_type=payload.source_type,
        source_id=payload.source_id,
        description=payload.description,
        transaction_date=payload.transaction_date or datetime.utcnow(),
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return accounting_transaction_response(transaction)


@app.put("/accounting/transactions/{transaction_id}", response_model=AccountingTransactionOut)
def update_accounting_transaction(
    transaction_id: int,
    payload: AccountingTransactionUpdate,
    db: Session = Depends(get_db),
):
    transaction = db.query(AccountingTransaction).filter(AccountingTransaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Accounting transaction not found")

    data = payload.model_dump(exclude_unset=True)
    if "account_id" in data and data["account_id"] is not None:
        account = db.query(AccountingAccount).filter(AccountingAccount.id == data["account_id"]).first()
        if not account:
            raise HTTPException(status_code=404, detail="Accounting account not found")
        transaction.account_id = account.id

    if "direction" in data and data["direction"] is not None:
        transaction.direction = normalize_accounting_direction(data["direction"])
    if "category" in data and data["category"] is not None:
        transaction.category = data["category"].strip() or "Manual"
    if "amount" in data and data["amount"] is not None:
        if float(data["amount"]) < 0:
            raise HTTPException(status_code=400, detail="Amount cannot be negative")
        transaction.amount = float(data["amount"])
    if "currency" in data and data["currency"] is not None:
        transaction.currency = normalize_accounting_currency(data["currency"])
    if "exchange_rate" in data and data["exchange_rate"] is not None:
        transaction.exchange_rate = float(data["exchange_rate"] or 0)
    if "counterparty" in data:
        transaction.counterparty = data["counterparty"]
    if "platform" in data:
        transaction.platform = data["platform"].strip() if data["platform"] else None
    if "reference" in data:
        transaction.reference = data["reference"]
    if "source_type" in data:
        transaction.source_type = data["source_type"]
    if "source_id" in data:
        transaction.source_id = data["source_id"]
    if "description" in data:
        transaction.description = data["description"]
    if "transaction_date" in data and data["transaction_date"] is not None:
        transaction.transaction_date = data["transaction_date"]

    if any(key in data for key in ("amount", "currency", "exchange_rate", "amount_pkr")):
        transaction.amount_pkr = accounting_amount_pkr(
            amount=transaction.amount,
            currency=transaction.currency,
            exchange_rate=transaction.exchange_rate,
            amount_pkr=data.get("amount_pkr"),
        )

    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return accounting_transaction_response(transaction)


@app.delete("/accounting/transactions/{transaction_id}")
def delete_accounting_transaction(transaction_id: int, db: Session = Depends(get_db)):
    transaction = db.query(AccountingTransaction).filter(AccountingTransaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Accounting transaction not found")

    db.delete(transaction)
    db.commit()
    return {"detail": "Accounting transaction deleted"}


@app.post("/accounting/sync-order-payouts")
def sync_accounting_order_payouts(db: Session = Depends(get_db)):
    orders = db.query(Order).all()
    synced = 0
    for order in orders:
        transaction = sync_order_payout_accounting(db, order)
        if transaction:
            synced += 1

    db.commit()
    return {
        "detail": "Order payouts synced to accounting",
        "synced": synced,
        "overview": accounting_overview_response(db),
    }


# Courier Payment / Shipping Balance APIs

@app.get("/courier-balances")
def get_courier_balances(db: Session = Depends(get_db)):
    shipping_records = db.query(Shipping).all()
    payments = db.query(CourierPayment).all()

    courier_names = set()

    for shipping in shipping_records:
        if shipping.courier_name:
            courier_names.add(shipping.courier_name.strip())

    for payment in payments:
        if payment.courier_name:
            courier_names.add(payment.courier_name.strip())

    balances = []

    for courier_name in sorted(courier_names):
        total_shipping_cost = sum(
            s.shipping_cost or 0
            for s in shipping_records
            if s.courier_name and s.courier_name.strip().lower() == courier_name.lower()
        )

        total_paid = sum(
            p.amount or 0
            for p in payments
            if p.courier_name and p.courier_name.strip().lower() == courier_name.lower()
        )

        total_shipments = sum(
            1
            for s in shipping_records
            if s.courier_name and s.courier_name.strip().lower() == courier_name.lower()
        )

        shipping_cost_pending = sum(
            1
            for s in shipping_records
            if s.courier_name
            and s.courier_name.strip().lower() == courier_name.lower()
            and (s.shipping_cost is None or s.shipping_cost == 0)
        )

        balance_due = total_shipping_cost - total_paid

        balances.append({
            "courier_name": courier_name,
            "total_shipments": total_shipments,
            "total_shipping_cost": total_shipping_cost,
            "total_paid": total_paid,
            "balance_due": balance_due,
            "shipping_cost_pending": shipping_cost_pending,
        })

    return balances


@app.get("/courier-payments", response_model=list[CourierPaymentOut])
def get_courier_payments(db: Session = Depends(get_db)):
    payments = db.query(CourierPayment).order_by(CourierPayment.id.desc()).all()
    return [courier_payment_response(p) for p in payments]


@app.post("/courier-payments", response_model=CourierPaymentOut)
def create_courier_payment(payment: CourierPaymentCreate, db: Session = Depends(get_db)):
    if payment.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than 0")

    new_payment = CourierPayment(
        courier_name=payment.courier_name.strip(),
        amount=payment.amount,
        payment_method=payment.payment_method,
        payment_reference=payment.payment_reference,
        note=payment.note,
        payment_date=payment.payment_date or datetime.utcnow(),
        created_at=datetime.utcnow(),
    )

    db.add(new_payment)
    db.commit()
    db.refresh(new_payment)

    return courier_payment_response(new_payment)


@app.delete("/courier-payments/{payment_id}")
def delete_courier_payment(payment_id: int, db: Session = Depends(get_db)):
    payment = db.query(CourierPayment).filter(CourierPayment.id == payment_id).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Courier payment not found")

    db.delete(payment)
    db.commit()

    return {
        "message": "Courier payment deleted successfully",
        "deleted_payment_id": payment_id,
    }


@app.get("/health", include_in_schema=False)
def health_check():
    return {"status": "ok"}


def is_loopback_host(hostname: str | None) -> bool:
    normalized = (hostname or "").strip().lower().strip("[]")
    return normalized in {"localhost", "127.0.0.1", "::1", "[::1]"}


def is_private_network_host(hostname: str | None) -> bool:
    normalized = (hostname or "").strip().lower().strip("[]")
    if not normalized:
        return False

    try:
        address = ip_address(normalized)
        return address.is_private or address.is_link_local
    except ValueError:
        return normalized.endswith(".local") or normalized.endswith(".lan")


def app_access_mode(hostname: str | None) -> str:
    if not hostname or is_loopback_host(hostname):
        return "local"
    if is_private_network_host(hostname):
        return "same_wifi"
    return "remote"


def get_lan_ipv4() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            candidate = probe.getsockname()[0]
            if not is_loopback_host(candidate):
                return candidate
    except OSError:
        pass

    try:
        for candidate in socket.gethostbyname_ex(socket.gethostname())[2]:
            if candidate and not is_loopback_host(candidate):
                return candidate
    except OSError:
        return None

    return None


def replace_origin_host(origin: str, hostname: str | None) -> str | None:
    if not origin or not hostname:
        return None

    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"}:
        return None

    netloc = hostname
    if parsed.port:
        netloc = f"{hostname}:{parsed.port}"
    return f"{parsed.scheme}://{netloc}"


def request_origin(value: str | None) -> str | None:
    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"

    return None


@app.get("/app-install-info", include_in_schema=False)
def app_install_info(request: Request):
    api_url = str(request.base_url).rstrip("/")
    frontend_origin = request_origin(request.headers.get("origin"))
    if not frontend_origin:
        frontend_origin = request_origin(request.headers.get("referer"))
    if not frontend_origin:
        frontend_origin = api_url

    parsed_frontend = urlparse(frontend_origin)
    network_host = parsed_frontend.hostname or request.url.hostname
    lan_host = get_lan_ipv4()
    lan_frontend_origin = replace_origin_host(frontend_origin, lan_host)
    lan_api_url = replace_origin_host(api_url, lan_host)
    access_mode = app_access_mode(network_host)
    reported_api_url = frontend_origin if access_mode == "remote" else api_url

    return {
        "status": "online",
        "app_name": "Hisbenew Industries ERP",
        "api_url": reported_api_url,
        "portal_url": f"{frontend_origin}/portal",
        "lan_api_url": lan_api_url,
        "lan_portal_url": f"{lan_frontend_origin}/portal" if lan_frontend_origin else None,
        "lan_host": lan_host,
        "network_host": network_host,
        "access_mode": access_mode,
        "same_wifi_ready": access_mode == "same_wifi",
        "remote_ready": access_mode == "remote",
        "server_time": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


def frontend_response(path: str = ""):
    if not FRONTEND_DIST_DIR.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")

    requested_file = (FRONTEND_DIST_DIR / path).resolve()
    try:
        requested_file.relative_to(FRONTEND_DIST_DIR)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")

    if requested_file.is_file():
        return FileResponse(requested_file)

    first_segment = path.split("/", 1)[0]
    if path in ("", "index.html") or first_segment in {"portal", "login", "catalog", "website", "school"}:
        index_file = FRONTEND_DIST_DIR / "index.html"
        if index_file.is_file():
            return FileResponse(index_file)

    raise HTTPException(status_code=404, detail="File not found")


@app.get("/website", include_in_schema=False)
def redirect_legacy_website_root():
    return RedirectResponse(url="/", status_code=308)


@app.get("/website/catalog", include_in_schema=False)
def redirect_legacy_website_catalog():
    return RedirectResponse(url="/catalog", status_code=308)


@app.get("/", include_in_schema=False)
def serve_frontend_root():
    return frontend_response()


@app.get("/{path:path}", include_in_schema=False)
def serve_frontend(path: str):
    return frontend_response(path)
