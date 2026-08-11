from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
import json

from .config import (
    APP_DATA_DIR,
    DATABASE_MAX_OVERFLOW,
    DATABASE_POOL_RECYCLE,
    DATABASE_POOL_SIZE,
    DATABASE_POOL_TIMEOUT,
    DATABASE_URL,
)

APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

SQLALCHEMY_DATABASE_URL = DATABASE_URL
is_sqlite_database = SQLALCHEMY_DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False, "timeout": 30} if is_sqlite_database else {}
engine_options = {
    "connect_args": connect_args,
    "pool_pre_ping": True,
}
if not is_sqlite_database:
    engine_options.update(
        pool_size=DATABASE_POOL_SIZE,
        max_overflow=DATABASE_MAX_OVERFLOW,
        pool_timeout=DATABASE_POOL_TIMEOUT,
        pool_recycle=DATABASE_POOL_RECYCLE,
    )

engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_options)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

DEFAULT_TENANT_SLUG = "hisbenew"
DEFAULT_TENANT_NAME = "Hisbenew"
TENANT_SCOPED_TABLES = (
    "users",
    "activity_logs",
    "user_role_requests",
    "public_access_requests",
    "internal_messages",
    "internal_calls",
    "internal_call_signals",
    "order_import_batches",
    "inspiration_items",
    "products",
    "customers",
    "orders",
    "order_items",
    "stock_movements",
    "suppliers",
    "supplier_order_items",
    "supplier_supply_items",
    "supplier_transactions",
    "supplier_payments",
    "workflow_steps",
    "workers",
    "worker_payments",
    "shipping",
    "fulfillment_shipments",
    "fulfillment_boxes",
    "fulfillment_box_items",
    "fulfillment_inventory_discrepancies",
    "fulfillment_orders",
    "fulfillment_order_items",
    "fulfillment_picks",
    "courier_payments",
    "regular_bills",
    "regular_bill_payments",
    "accounting_accounts",
    "accounting_transactions",
    "production_batches",
    "production_tasks",
    "shared_data",
    "workspace_data",
    "order_workflow_tasks",
    "order_follow_ups",
    "service_takers",
    "service_taker_products",
    "service_taker_inbounds",
    "service_taker_inbound_items",
    "service_taker_orders",
    "service_taker_order_items",
    "service_taker_inventory_transactions",
    "amazon_accounts",
    "print_agents",
    "print_jobs",
)


def backfill_tenant_relationships(connection, default_tenant_id: int) -> None:
    statements = (
        """
        UPDATE service_takers
        SET tenant_id = COALESCE(
            (SELECT users.tenant_id FROM users WHERE users.id = service_takers.user_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT users.tenant_id FROM users WHERE users.id = service_takers.user_id),
            :tenant_id
        )
        """,
        """
        UPDATE service_taker_products
        SET tenant_id = COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_products.service_taker_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_products.service_taker_id),
            :tenant_id
        )
        """,
        """
        UPDATE service_taker_inbounds
        SET tenant_id = COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_inbounds.service_taker_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_inbounds.service_taker_id),
            :tenant_id
        )
        """,
        """
        UPDATE service_taker_inbound_items
        SET tenant_id = COALESCE(
            (SELECT service_taker_inbounds.tenant_id FROM service_taker_inbounds WHERE service_taker_inbounds.id = service_taker_inbound_items.inbound_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT service_taker_inbounds.tenant_id FROM service_taker_inbounds WHERE service_taker_inbounds.id = service_taker_inbound_items.inbound_id),
            :tenant_id
        )
        """,
        """
        UPDATE service_taker_orders
        SET tenant_id = COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_orders.service_taker_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_orders.service_taker_id),
            :tenant_id
        )
        """,
        """
        UPDATE service_taker_order_items
        SET tenant_id = COALESCE(
            (SELECT service_taker_orders.tenant_id FROM service_taker_orders WHERE service_taker_orders.id = service_taker_order_items.order_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT service_taker_orders.tenant_id FROM service_taker_orders WHERE service_taker_orders.id = service_taker_order_items.order_id),
            :tenant_id
        )
        """,
        """
        UPDATE service_taker_inventory_transactions
        SET tenant_id = COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_inventory_transactions.service_taker_id),
            :tenant_id
        )
        WHERE tenant_id IS NULL OR tenant_id != COALESCE(
            (SELECT service_takers.tenant_id FROM service_takers WHERE service_takers.id = service_taker_inventory_transactions.service_taker_id),
            :tenant_id
        )
        """,
        """
        UPDATE amazon_accounts
        SET tenant_id = COALESCE(
            (SELECT users.tenant_id FROM users WHERE users.id = amazon_accounts.created_by_user_id AND users.role != 'super_admin'),
            (SELECT users.tenant_id FROM users WHERE users.id = amazon_accounts.updated_by_user_id AND users.role != 'super_admin'),
            (SELECT tenants.id FROM tenants WHERE lower(tenants.slug) = 'hisbenew' LIMIT 1),
            (SELECT tenants.id FROM tenants WHERE lower(tenants.slug) = 'hisbenew-industries' LIMIT 1),
            :tenant_id
        )
        WHERE tenant_id IS NULL
        """,
    )
    for statement in statements:
        try:
            connection.execute(text(statement), {"tenant_id": default_tenant_id})
        except Exception as exc:
            print(f"Tenant ownership backfill skipped: {exc}")


def ensure_amazon_account_tenant_unique_index(connection) -> None:
    statements = [
        "DROP INDEX IF EXISTS uq_amazon_accounts_name_marketplace",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_accounts_tenant_name_marketplace ON amazon_accounts (tenant_id, account_name, marketplace_id)",
    ]
    if connection.dialect.name != "sqlite":
        statements.insert(
            0,
            "ALTER TABLE amazon_accounts DROP CONSTRAINT IF EXISTS uq_amazon_accounts_name_marketplace",
        )
    for statement in statements:
        try:
            connection.execute(text(statement))
        except Exception as exc:
            print(f"Amazon account tenant index migration skipped: {exc}")

def sqlite_table_columns(connection, table_name: str) -> list[str]:
    return [row[1] for row in connection.execute(text(f"PRAGMA table_info({table_name})"))]


def ensure_tenant_schema_sqlite(connection) -> int:
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name VARCHAR NOT NULL,
            slug VARCHAR NOT NULL UNIQUE,
            email VARCHAR,
            phone VARCHAR,
            logo TEXT,
            status VARCHAR DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS modules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR NOT NULL,
            slug VARCHAR NOT NULL UNIQUE,
            page_name VARCHAR,
            description TEXT,
            default_enabled BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS tenant_modules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            module_id INTEGER NOT NULL,
            enabled BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, module_id),
            FOREIGN KEY(tenant_id) REFERENCES tenants(id),
            FOREIGN KEY(module_id) REFERENCES modules(id)
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS custom_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL,
            page_name VARCHAR NOT NULL,
            slug VARCHAR NOT NULL,
            fields_json TEXT NOT NULL DEFAULT '[]',
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, slug),
            FOREIGN KEY(tenant_id) REFERENCES tenants(id)
        )
    """))
    connection.execute(text(
        "INSERT OR IGNORE INTO tenants (company_name, slug, status) "
        "VALUES (:company_name, :slug, 'active')"
    ), {"company_name": DEFAULT_TENANT_NAME, "slug": DEFAULT_TENANT_SLUG})
    default_tenant_id = connection.execute(
        text("SELECT id FROM tenants WHERE slug = :slug"),
        {"slug": DEFAULT_TENANT_SLUG},
    ).scalar()

    for table_name in TENANT_SCOPED_TABLES:
        try:
            columns = sqlite_table_columns(connection, table_name)
        except Exception:
            columns = []
        if not columns:
            continue
        if "tenant_id" not in columns:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN tenant_id INTEGER"))
        if table_name == "users":
            connection.execute(
                text(
                    f"UPDATE {table_name} SET tenant_id = :tenant_id "
                    "WHERE tenant_id IS NULL AND role != 'super_admin'"
                ),
                {"tenant_id": default_tenant_id},
            )
        else:
            connection.execute(
                text(f"UPDATE {table_name} SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
                {"tenant_id": default_tenant_id},
            )
        connection.execute(text(
            f"CREATE INDEX IF NOT EXISTS ix_{table_name}_tenant_id ON {table_name}(tenant_id)"
        ))

    backfill_tenant_relationships(connection, int(default_tenant_id))
    ensure_amazon_account_tenant_unique_index(connection)
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tenants_slug ON tenants(slug)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_modules_tenant_id ON tenant_modules(tenant_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_custom_pages_tenant_id ON custom_pages(tenant_id)"))
    connection.commit()
    return int(default_tenant_id)


def ensure_tenant_schema_postgres(connection) -> int:
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS tenants (
            id SERIAL PRIMARY KEY,
            company_name VARCHAR NOT NULL,
            slug VARCHAR NOT NULL UNIQUE,
            email VARCHAR,
            phone VARCHAR,
            logo TEXT,
            status VARCHAR DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS modules (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL,
            slug VARCHAR NOT NULL UNIQUE,
            page_name VARCHAR,
            description TEXT,
            default_enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS tenant_modules (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            module_id INTEGER NOT NULL REFERENCES modules(id),
            enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, module_id)
        )
    """))
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS custom_pages (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            page_name VARCHAR NOT NULL,
            slug VARCHAR NOT NULL,
            fields_json TEXT NOT NULL DEFAULT '[]',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tenant_id, slug)
        )
    """))
    connection.execute(text(
        "INSERT INTO tenants (company_name, slug, status) "
        "VALUES (:company_name, :slug, 'active') "
        "ON CONFLICT (slug) DO NOTHING"
    ), {"company_name": DEFAULT_TENANT_NAME, "slug": DEFAULT_TENANT_SLUG})
    default_tenant_id = connection.execute(
        text("SELECT id FROM tenants WHERE slug = :slug"),
        {"slug": DEFAULT_TENANT_SLUG},
    ).scalar()

    for table_name in TENANT_SCOPED_TABLES:
        connection.execute(text(
            f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id)"
        ))
        if table_name == "users":
            connection.execute(
                text(
                    f"UPDATE {table_name} SET tenant_id = :tenant_id "
                    "WHERE tenant_id IS NULL AND role != 'super_admin'"
                ),
                {"tenant_id": default_tenant_id},
            )
        else:
            connection.execute(
                text(f"UPDATE {table_name} SET tenant_id = :tenant_id WHERE tenant_id IS NULL"),
                {"tenant_id": default_tenant_id},
            )
        connection.execute(text(
            f"CREATE INDEX IF NOT EXISTS ix_{table_name}_tenant_id ON {table_name}(tenant_id)"
        ))

    backfill_tenant_relationships(connection, int(default_tenant_id))
    ensure_amazon_account_tenant_unique_index(connection)
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tenants_slug ON tenants(slug)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tenant_modules_tenant_id ON tenant_modules(tenant_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_custom_pages_tenant_id ON custom_pages(tenant_id)"))
    return int(default_tenant_id)


SCALING_INDEXES = (
    "CREATE INDEX IF NOT EXISTS ix_internal_messages_recipient_unread "
    "ON internal_messages (recipient_user_id, read_at, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_internal_messages_conversation_sender "
    "ON internal_messages (sender_user_id, recipient_user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_internal_calls_caller_active "
    "ON internal_calls (caller_user_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_internal_calls_recipient_active "
    "ON internal_calls (recipient_user_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_internal_call_signals_call_sequence "
    "ON internal_call_signals (call_id, id)",
    "CREATE INDEX IF NOT EXISTS ix_orders_status_date "
    "ON orders (status, order_date)",
    "CREATE INDEX IF NOT EXISTS ix_orders_customer_date "
    "ON orders (customer_id, order_date)",
    "CREATE INDEX IF NOT EXISTS ix_stock_movements_product_date "
    "ON stock_movements (product_id, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_production_tasks_worker_status "
    "ON production_tasks (worker_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_order_workflow_tasks_worker_status "
    "ON order_workflow_tasks (assigned_worker_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_amazon_accounts_tenant_status "
    "ON amazon_accounts (tenant_id, is_active, connection_status)",
)


def ensure_scaling_indexes() -> None:
    """Create hot-path indexes for both portable SQLite and production PostgreSQL."""
    with engine.begin() as connection:
        for statement in SCALING_INDEXES:
            try:
                connection.execute(text(statement))
            except Exception as exc:
                # Older portable databases may not have every optional module table.
                print(f"Scaling index skipped: {exc}")


def migrate_database():
    """Run database migrations to add new columns if they don't exist."""
    if not is_sqlite_database:
        # create_all does not add columns to an existing production table.
        with engine.begin() as connection:
            ensure_tenant_schema_postgres(connection)
            connection.execute(
                text(
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS "
                    "front_room_stock INTEGER DEFAULT 0 NOT NULL"
                )
            )
            connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS raw_pin VARCHAR"))
            connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_privacy_settings TEXT"))
            connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_expiry_minutes INTEGER DEFAULT 0"))
        return
    with engine.connect() as connection:
        ensure_tenant_schema_sqlite(connection)

        # Add the USA fulfillment front-room location to portable databases.
        try:
            result = connection.execute(text("PRAGMA table_info(products)"))
            product_columns = [row[1] for row in result]
            if "front_room_stock" not in product_columns:
                connection.execute(
                    text(
                        "ALTER TABLE products ADD COLUMN "
                        "front_room_stock INTEGER DEFAULT 0 NOT NULL"
                    )
                )
                connection.commit()
                print("Added 'front_room_stock' column to products table")
        except Exception as e:
            print(f"Error adding front-room stock column to products table: {e}")

        # Check and add address column to customers table
        try:
            result = connection.execute(text("PRAGMA table_info(customers)"))
            columns = [row[1] for row in result]
            if "address" not in columns:
                connection.execute(text("ALTER TABLE customers ADD COLUMN address VARCHAR"))
                connection.commit()
                print("Added 'address' column to customers table")
            if "shipping_address" not in columns:
                connection.execute(text("ALTER TABLE customers ADD COLUMN shipping_address TEXT"))
                connection.commit()
                print("Added 'shipping_address' column to customers table")
        except Exception as e:
            print(f"Error adding address column: {e}")

        # Check and add new columns to users table
        try:
            result = connection.execute(text("PRAGMA table_info(users)"))
            user_columns = [row[1] for row in result]
            if "raw_pin" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN raw_pin VARCHAR"))
                connection.commit()
                print("Added 'raw_pin' column to users table")
            if "customer_privacy_settings" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN customer_privacy_settings TEXT"))
                connection.commit()
                print("Added 'customer_privacy_settings' column to users table")
            if "session_expiry_minutes" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN session_expiry_minutes INTEGER DEFAULT 0"))
                connection.commit()
                print("Added 'session_expiry_minutes' column to users table")
        except Exception as e:
            print(f"Error adding columns to users table: {e}")
        
        # Check and add payout-related columns to orders table
        try:
            result = connection.execute(text("PRAGMA table_info(orders)"))
            order_columns = [row[1] for row in result]
            payout_columns = {
                'order_total_usd': "FLOAT DEFAULT 0",
                'platform_fee_usd': "FLOAT DEFAULT 0",
                'deduction_usd': "FLOAT DEFAULT 0",
                'expected_payout_usd': "FLOAT DEFAULT 0",
                'expected_payout_date': "DATETIME",
                'payment_source': "VARCHAR",
                'payout_status': "VARCHAR DEFAULT 'Not Received'",
                'received_payout_usd': "FLOAT DEFAULT 0",
                'remaining_payout_usd': "FLOAT DEFAULT 0",
                'exchange_rate': "FLOAT DEFAULT 0",
                'received_pkr': "FLOAT DEFAULT 0",
                'bank_charges_pkr': "FLOAT DEFAULT 0",
                'final_received_pkr': "FLOAT DEFAULT 0",
                'payout_notes': "VARCHAR",
                'payout_received_date': "DATETIME",
                'import_customer_name': "VARCHAR",
                'import_customer_company_name': "VARCHAR",
                'import_contact_name': "VARCHAR",
                'import_contact_phone': "VARCHAR",
                'import_shipping_name': "VARCHAR",
                'import_shipping_address': "TEXT",
                'import_ship_date': "DATETIME",
                'import_batch_key': "VARCHAR",
                'shipping_weight_override_kg': "FLOAT"
            }
            for column_name, column_def in payout_columns.items():
                if column_name not in order_columns:
                    connection.execute(text(f"ALTER TABLE orders ADD COLUMN {column_name} {column_def}"))
                    connection.commit()
                    print(f"Added '{column_name}' column to orders table")
        except Exception as e:
            print(f"Error adding payout columns to orders table: {e}")

        # Create order import batch table for reversible CSV test uploads.
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS order_import_batches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_key VARCHAR NOT NULL UNIQUE,
                    filename VARCHAR,
                    source_format VARCHAR,
                    imported_count INTEGER DEFAULT 0,
                    item_count INTEGER DEFAULT 0,
                    failed_count INTEGER DEFAULT 0,
                    needs_customer_assignment_count INTEGER DEFAULT 0,
                    status VARCHAR DEFAULT 'Imported',
                    created_by_user_id INTEGER,
                    created_by_name VARCHAR,
                    reversed_at DATETIME,
                    reversed_count INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(created_by_user_id) REFERENCES users(id)
                )
            """))
            connection.commit()
            print("Created order_import_batches table (or already exists)")
        except Exception as e:
            print(f"Error creating order import batch table: {e}")

        # Check and add USA rate snapshot fields to shipping records
        try:
            result = connection.execute(text("PRAGMA table_info(shipping)"))
            shipping_columns = [row[1] for row in result]
            shipping_rate_columns = {
                "package_weight_kg": "FLOAT",
                "shipping_service": "VARCHAR DEFAULT 'duty_paid'",
                "destination_zip_prefix": "VARCHAR",
                "shipping_zone": "VARCHAR",
                "calculated_weight_kg": "FLOAT",
                "estimated_shipping_cost": "FLOAT",
                "rate_source_version": "VARCHAR",
            }
            for column_name, column_def in shipping_rate_columns.items():
                if column_name not in shipping_columns:
                    connection.execute(text(f"ALTER TABLE shipping ADD COLUMN {column_name} {column_def}"))
                    connection.commit()
                    print(f"Added '{column_name}' column to shipping table")
        except Exception as e:
            print(f"Error adding USA rate fields to shipping table: {e}")

        # Check and add access-control columns to users table
        try:
            result = connection.execute(text("PRAGMA table_info(users)"))
            user_columns = [row[1] for row in result]
            if "last_login" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN last_login DATETIME"))
                connection.commit()
                print("Added 'last_login' column to users table")
            if "username" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR"))
                connection.commit()
                print("Added 'username' column to users table")
            if "email" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
                connection.commit()
                print("Added 'email' column to users table")
            connection.execute(
                text(
                    "UPDATE users SET username = name "
                    "WHERE username IS NULL OR TRIM(username) = ''"
                )
            )
            connection.commit()
            if "allowed_pages" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN allowed_pages TEXT"))
                connection.commit()
                print("Added 'allowed_pages' column to users table")
            if "customer_privacy_settings" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN customer_privacy_settings TEXT"))
                connection.commit()
                print("Added 'customer_privacy_settings' column to users table")
            if "session_expiry_minutes" not in user_columns:
                connection.execute(
                    text("ALTER TABLE users ADD COLUMN session_expiry_minutes INTEGER DEFAULT 0")
                )
                connection.commit()
                print("Added 'session_expiry_minutes' column to users table")
            connection.execute(
                text(
                    "UPDATE users SET session_expiry_minutes = 0 "
                    "WHERE session_expiry_minutes IS NULL"
                )
            )
            connection.commit()
            result = connection.execute(text("SELECT id, role, allowed_pages FROM users WHERE allowed_pages IS NOT NULL"))
            for user_id, role, raw_pages in result:
                try:
                    pages = json.loads(raw_pages or "[]")
                except Exception:
                    continue
                normalized_pages = []
                for page in pages:
                    if page == "Payments":
                        page = "Billings"
                    if page and page not in normalized_pages:
                        normalized_pages.append(page)
                if normalized_pages != pages:
                    connection.execute(
                        text("UPDATE users SET allowed_pages = :pages WHERE id = :user_id"),
                        {"pages": json.dumps(normalized_pages), "user_id": user_id},
                    )
            connection.commit()
        except Exception as e:
            print(f"Error adding user access-control columns: {e}")

        # Create user role/contact request table for accounts waiting on access.
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS user_role_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    user_name VARCHAR NOT NULL,
                    username VARCHAR,
                    requested_role VARCHAR,
                    contact_phone VARCHAR,
                    contact_email VARCHAR,
                    message TEXT,
                    status VARCHAR DEFAULT 'Open',
                    admin_note TEXT,
                    reviewed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            """))
            connection.commit()
            print("Created user_role_requests table (or already exists)")
        except Exception as e:
            print(f"Error creating user role request table: {e}")

        # Create public signup/access request table for accounts awaiting admin approval.
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS public_access_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_name VARCHAR NOT NULL,
                    preferred_username VARCHAR,
                    work_email VARCHAR,
                    phone VARCHAR,
                    requested_workspace VARCHAR,
                    message TEXT,
                    status VARCHAR DEFAULT 'Pending',
                    admin_note TEXT,
                    approved_user_id INTEGER,
                    reviewed_by_user_id INTEGER,
                    reviewed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(approved_user_id) REFERENCES users(id),
                    FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id)
                )
            """))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_public_access_requests_status "
                "ON public_access_requests(status, created_at)"
            ))
            connection.commit()
            print("Created public_access_requests table (or already exists)")
        except Exception as e:
            print(f"Error creating public access request table: {e}")
        # Create internal ERP messages table for user-to-user communication.
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS internal_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_user_id INTEGER NOT NULL,
                    recipient_user_id INTEGER NOT NULL,
                    body TEXT NOT NULL,
                    read_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(sender_user_id) REFERENCES users(id),
                    FOREIGN KEY(recipient_user_id) REFERENCES users(id)
                )
            """))
            connection.commit()
            print("Created internal_messages table (or already exists)")
        except Exception as e:
            print(f"Error creating internal messages table: {e}")

        # Create peer-to-peer ERP voice call sessions and WebRTC signaling tables.
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS internal_calls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    caller_user_id INTEGER NOT NULL,
                    recipient_user_id INTEGER NOT NULL,
                    call_type VARCHAR NOT NULL DEFAULT 'audio',
                    status VARCHAR NOT NULL DEFAULT 'ringing',
                    answered_at DATETIME,
                    ended_at DATETIME,
                    ended_by_user_id INTEGER,
                    caller_last_seen_at DATETIME,
                    recipient_last_seen_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(caller_user_id) REFERENCES users(id),
                    FOREIGN KEY(recipient_user_id) REFERENCES users(id),
                    FOREIGN KEY(ended_by_user_id) REFERENCES users(id)
                )
            """))
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS internal_call_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    call_id INTEGER NOT NULL,
                    sender_user_id INTEGER NOT NULL,
                    signal_type VARCHAR NOT NULL,
                    payload TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(call_id) REFERENCES internal_calls(id),
                    FOREIGN KEY(sender_user_id) REFERENCES users(id)
                )
            """))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_internal_calls_status "
                "ON internal_calls(status)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_internal_calls_participants "
                "ON internal_calls(caller_user_id, recipient_user_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_internal_call_signals_call_id "
                "ON internal_call_signals(call_id, id)"
            ))
            call_columns = [
                row[1]
                for row in connection.execute(text("PRAGMA table_info(internal_calls)"))
            ]
            if "caller_last_seen_at" not in call_columns:
                connection.execute(text(
                    "ALTER TABLE internal_calls ADD COLUMN caller_last_seen_at DATETIME"
                ))
            if "recipient_last_seen_at" not in call_columns:
                connection.execute(text(
                    "ALTER TABLE internal_calls ADD COLUMN recipient_last_seen_at DATETIME"
                ))
            if "call_type" not in call_columns:
                connection.execute(text(
                    "ALTER TABLE internal_calls ADD COLUMN call_type VARCHAR NOT NULL DEFAULT 'audio'"
                ))
            connection.commit()
            print("Created internal voice call tables (or already exist)")
        except Exception as e:
            print(f"Error creating internal voice call tables: {e}")

        # Check and add email column to workers table
        try:
            result = connection.execute(text("PRAGMA table_info(workers)"))
            worker_columns = [row[1] for row in result]
            if "email" not in worker_columns:
                connection.execute(text("ALTER TABLE workers ADD COLUMN email VARCHAR"))
                connection.commit()
                print("Added 'email' column to workers table")
        except Exception as e:
            print(f"Error adding worker email column: {e}")

        # Create worker payments table for factory wage/account history.
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS worker_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    worker_id INTEGER NOT NULL,
                    amount FLOAT DEFAULT 0,
                    payment_method VARCHAR,
                    payment_reference VARCHAR,
                    note VARCHAR,
                    accounting_transaction_id INTEGER,
                    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(worker_id) REFERENCES workers(id),
                    FOREIGN KEY(accounting_transaction_id) REFERENCES accounting_transactions(id)
                )
            """))
            connection.commit()
            print("Created worker_payments table (or already exists)")

            result = connection.execute(text("PRAGMA table_info(worker_payments)"))
            worker_payment_columns = [row[1] for row in result]
            if "accounting_transaction_id" not in worker_payment_columns:
                connection.execute(
                    text("ALTER TABLE worker_payments ADD COLUMN accounting_transaction_id INTEGER")
                )
                connection.commit()
                print("Added 'accounting_transaction_id' column to worker_payments table")
        except Exception as e:
            print(f"Error creating worker payments table: {e}")

        # Check and add warehouse fulfillment box location
        try:
            result = connection.execute(text("PRAGMA table_info(fulfillment_boxes)"))
            fulfillment_box_columns = [row[1] for row in result]
            if "location" not in fulfillment_box_columns:
                connection.execute(text("ALTER TABLE fulfillment_boxes ADD COLUMN location VARCHAR"))
                connection.commit()
                print("Added 'location' column to fulfillment_boxes table")
        except Exception as e:
            print(f"Error adding fulfillment box location column: {e}")

        # Check and add fulfillment shipment receiving columns
        try:
            result = connection.execute(text("PRAGMA table_info(fulfillment_shipments)"))
            shipment_columns = [row[1] for row in result]
            receipt_columns = {
                "admin_received_at": "DATETIME",
                "fulfillment_received_at": "DATETIME",
                "received_at": "DATETIME",
            }
            for column_name, column_def in receipt_columns.items():
                if column_name not in shipment_columns:
                    connection.execute(
                        text(f"ALTER TABLE fulfillment_shipments ADD COLUMN {column_name} {column_def}")
                    )
                    connection.commit()
                    print(f"Added '{column_name}' column to fulfillment_shipments table")
            connection.execute(
                text(
                    """
                    UPDATE fulfillment_shipments
                    SET status = 'In Transit'
                    WHERE LOWER(COALESCE(status, '')) = 'sent'
                    """
                )
            )
            connection.commit()
        except Exception as e:
            print(f"Error adding fulfillment shipment receipt columns: {e}")

        # Check and add supplier_id column to stock_movements table
        try:
            result = connection.execute(text("PRAGMA table_info(stock_movements)"))
            columns = [row[1] for row in result]
            if "supplier_id" not in columns:
                connection.execute(text("ALTER TABLE stock_movements ADD COLUMN supplier_id INTEGER"))
                connection.commit()
                print("Added 'supplier_id' column to stock_movements table")
        except Exception as e:
            print(f"Error adding supplier_id column to stock_movements table: {e}")

        # Create supplier ordered-items table for stock ordered but not received yet
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS supplier_order_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_id INTEGER NOT NULL,
                    product_id INTEGER NOT NULL,
                    ordered_quantity INTEGER DEFAULT 0,
                    received_quantity INTEGER DEFAULT 0,
                    purchase_price FLOAT DEFAULT 0,
                    stock_type VARCHAR DEFAULT 'factory_stock',
                    reference VARCHAR,
                    note VARCHAR,
                    status VARCHAR DEFAULT 'Ordered',
                    is_closed BOOLEAN DEFAULT 0,
                    closed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
                    FOREIGN KEY(product_id) REFERENCES products(id)
                )
            """))
            connection.commit()
            print("Created supplier_order_items table (or already exists)")

            result = connection.execute(text("PRAGMA table_info(supplier_order_items)"))
            columns = [row[1] for row in result]
            if "is_closed" not in columns:
                connection.execute(text("ALTER TABLE supplier_order_items ADD COLUMN is_closed BOOLEAN DEFAULT 0"))
                connection.commit()
                print("Added 'is_closed' column to supplier_order_items table")
            if "closed_at" not in columns:
                connection.execute(text("ALTER TABLE supplier_order_items ADD COLUMN closed_at DATETIME"))
                connection.commit()
                print("Added 'closed_at' column to supplier_order_items table")
        except Exception as e:
            print(f"Error creating supplier_order_items table: {e}")

        # Create supplier supplies/accessories table for non-catalog purchases
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS supplier_supply_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_id INTEGER NOT NULL,
                    sku VARCHAR,
                    item_name VARCHAR NOT NULL,
                    category VARCHAR DEFAULT 'Miscellaneous',
                    usage_area VARCHAR DEFAULT 'General',
                    quantity INTEGER DEFAULT 1,
                    unit_price FLOAT DEFAULT 0,
                    note TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
                )
            """))
            connection.commit()
            print("Created supplier_supply_items table (or already exists)")

            result = connection.execute(text("PRAGMA table_info(supplier_supply_items)"))
            columns = [row[1] for row in result]
            supply_columns = {
                "sku": "VARCHAR",
                "item_name": "VARCHAR",
                "category": "VARCHAR DEFAULT 'Miscellaneous'",
                "usage_area": "VARCHAR DEFAULT 'General'",
                "quantity": "INTEGER DEFAULT 1",
                "unit_price": "FLOAT DEFAULT 0",
                "note": "TEXT",
                "created_at": "DATETIME DEFAULT CURRENT_TIMESTAMP",
                "updated_at": "DATETIME DEFAULT CURRENT_TIMESTAMP",
            }
            for column_name, column_def in supply_columns.items():
                if column_name not in columns:
                    connection.execute(
                        text(f"ALTER TABLE supplier_supply_items ADD COLUMN {column_name} {column_def}")
                    )
                    connection.commit()
                    print(f"Added '{column_name}' column to supplier_supply_items table")
        except Exception as e:
            print(f"Error creating supplier_supply_items table: {e}")

        # Check and add image_url / label_url columns to products table
        try:
            result = connection.execute(text("PRAGMA table_info(products)"))
            columns = [row[1] for row in result]
            if "image_url" not in columns:
                connection.execute(text("ALTER TABLE products ADD COLUMN image_url VARCHAR"))
                connection.commit()
                print("Added 'image_url' column to products table")
            if "share_image_url" not in columns:
                connection.execute(text("ALTER TABLE products ADD COLUMN share_image_url VARCHAR"))
                connection.commit()
                print("Added 'share_image_url' column to products table")
            if "label_url" not in columns:
                connection.execute(text("ALTER TABLE products ADD COLUMN label_url VARCHAR"))
                connection.commit()
                print("Added 'label_url' column to products table")
            if "options" not in columns:
                connection.execute(text("ALTER TABLE products ADD COLUMN options TEXT"))
                connection.commit()
                print("Added 'options' column to products table")
            if "notes" not in columns:
                connection.execute(text("ALTER TABLE products ADD COLUMN notes TEXT"))
                connection.commit()
                print("Added 'notes' column to products table")
            if "unit_weight_kg" not in columns:
                connection.execute(text("ALTER TABLE products ADD COLUMN unit_weight_kg FLOAT DEFAULT 0"))
                connection.commit()
                print("Added 'unit_weight_kg' column to products table")
        except Exception as e:
            print(f"Error adding product detail columns: {e}")

        try:
            result = connection.execute(text("PRAGMA table_info(stock_movements)"))
            columns = [row[1] for row in result]
            if "purchase_price" not in columns:
                connection.execute(text("ALTER TABLE stock_movements ADD COLUMN purchase_price FLOAT DEFAULT 0"))
                connection.commit()
                print("Added 'purchase_price' column to stock_movements table")
            if "stock_type" not in columns:
                connection.execute(text("ALTER TABLE stock_movements ADD COLUMN stock_type VARCHAR"))
                connection.commit()
                print("Added 'stock_type' column to stock_movements table")
            connection.execute(text("""
                UPDATE stock_movements
                SET stock_type = CASE
                    WHEN movement_type = 'Order Reservation' OR LOWER(COALESCE(note, '')) LIKE '%reserved stock%' THEN 'reserved_stock'
                    WHEN LOWER(COALESCE(note, '')) LIKE '%usa stock%' THEN 'usa_stock'
                    WHEN LOWER(COALESCE(note, '')) LIKE '%factory stock%' THEN 'factory_stock'
                    WHEN movement_type IN ('Production Completed', 'Factory Manufactured') THEN 'factory_stock'
                    WHEN movement_type = 'Order Deduction' AND LOWER(COALESCE(source, '')) = 'usa' THEN 'usa_stock'
                    WHEN movement_type = 'Order Deduction' THEN 'factory_stock'
                    ELSE stock_type
                END
                WHERE stock_type IS NULL
            """))
            connection.commit()
            if "faulty" not in columns:
                connection.execute(text("ALTER TABLE stock_movements ADD COLUMN faulty BOOLEAN DEFAULT 0"))
                connection.commit()
                print("Added 'faulty' column to stock_movements table")
            if "faulty_note" not in columns:
                connection.execute(text("ALTER TABLE stock_movements ADD COLUMN faulty_note VARCHAR"))
                connection.commit()
                print("Added 'faulty_note' column to stock_movements table")
            if "faulty_quantity" not in columns:
                connection.execute(text("ALTER TABLE stock_movements ADD COLUMN faulty_quantity INTEGER DEFAULT 0"))
                connection.commit()
                print("Added 'faulty_quantity' column to stock_movements table")
        except Exception as e:
            print(f"Error adding purchase_price/faulty columns to stock_movements table: {e}")

        # Check and create shared_data table if it doesn't exist
        try:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS shared_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    customer_id INTEGER NOT NULL,
                    shared_platform VARCHAR DEFAULT 'WhatsApp',
                    shared_data VARCHAR,
                    shared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(order_id) REFERENCES orders(id),
                    FOREIGN KEY(customer_id) REFERENCES customers(id)
                )
            """))
            connection.commit()
            print("Created shared_data table (or already exists)")
        except Exception as e:
            print(f"Error creating shared_data table: {e}")

        try:
            result = connection.execute(text("PRAGMA table_info(production_batches)"))
            columns = [row[1] for row in result]
            if "source_type" not in columns:
                connection.execute(
                    text("ALTER TABLE production_batches ADD COLUMN source_type VARCHAR DEFAULT 'Workflow'")
                )
                connection.commit()
                print("Added 'source_type' column to production_batches table")
            if "custom_product_name" not in columns:
                connection.execute(text("ALTER TABLE production_batches ADD COLUMN custom_product_name VARCHAR"))
                connection.commit()
                print("Added 'custom_product_name' column to production_batches table")
            if "custom_article_no" not in columns:
                connection.execute(text("ALTER TABLE production_batches ADD COLUMN custom_article_no VARCHAR"))
                connection.commit()
                print("Added 'custom_article_no' column to production_batches table")
        except Exception as e:
            print(f"Error adding production batch source_type column: {e}")

        try:
            result = connection.execute(text("PRAGMA table_info(production_tasks)"))
            columns = [row[1] for row in result]
            if "custom_product_name" not in columns:
                connection.execute(text("ALTER TABLE production_tasks ADD COLUMN custom_product_name VARCHAR"))
                connection.commit()
                print("Added 'custom_product_name' column to production_tasks table")
            if "custom_article_no" not in columns:
                connection.execute(text("ALTER TABLE production_tasks ADD COLUMN custom_article_no VARCHAR"))
                connection.commit()
                print("Added 'custom_article_no' column to production_tasks table")
        except Exception as e:
            print(f"Error adding production task custom product columns: {e}")

        try:
            result = connection.execute(text("PRAGMA table_info(order_workflow_tasks)"))
            columns = [row[1] for row in result]
            if columns:
                if "assigned_quantity" not in columns:
                    connection.execute(
                        text("ALTER TABLE order_workflow_tasks ADD COLUMN assigned_quantity INTEGER DEFAULT 1")
                    )
                    connection.commit()
                    print("Added 'assigned_quantity' column to order_workflow_tasks table")
                if "rate_per_piece" not in columns:
                    connection.execute(
                        text("ALTER TABLE order_workflow_tasks ADD COLUMN rate_per_piece FLOAT DEFAULT 0")
                    )
                    connection.commit()
                    print("Added 'rate_per_piece' column to order_workflow_tasks table")
                if "labor_cost" not in columns:
                    connection.execute(
                        text("ALTER TABLE order_workflow_tasks ADD COLUMN labor_cost FLOAT DEFAULT 0")
                    )
                    connection.commit()
                    print("Added 'labor_cost' column to order_workflow_tasks table")
                connection.execute(
                    text(
                        """
                        UPDATE order_workflow_tasks
                        SET assigned_quantity = COALESCE(
                            NULLIF(assigned_quantity, 0),
                            (
                                SELECT COALESCE(SUM(quantity), 1)
                                FROM order_items
                                WHERE order_items.order_id = order_workflow_tasks.order_id
                            ),
                            1
                        )
                        WHERE assigned_quantity IS NULL OR assigned_quantity <= 0
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        UPDATE order_workflow_tasks
                        SET rate_per_piece = COALESCE(rate_per_piece, 0),
                            labor_cost = COALESCE(labor_cost, 0)
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        UPDATE order_workflow_tasks
                        SET labor_cost = COALESCE(assigned_quantity, 1) * COALESCE(rate_per_piece, 0)
                        WHERE LOWER(COALESCE(status, '')) = 'completed'
                          AND COALESCE(labor_cost, 0) = 0
                          AND COALESCE(rate_per_piece, 0) > 0
                        """
                    )
                )
                connection.commit()
        except Exception as e:
            print(f"Error adding order workflow task earning columns: {e}")

        # Add workspace and campus boundaries to student records created before
        # the multi-campus school foundation was introduced.
        try:
            result = connection.execute(text("PRAGMA table_info(school_students)"))
            student_columns = [row[1] for row in result]
            school_student_columns = {
                "workspace_id": "INTEGER",
                "campus_id": "INTEGER",
                "academic_session_id": "INTEGER",
                "school_class_id": "INTEGER",
                "school_section_id": "INTEGER",
                "application_id": "INTEGER",
                "photo_url": "TEXT",
                "preferred_language": "VARCHAR DEFAULT 'en'",
                "b_form_no": "VARCHAR",
                "birth_certificate_no": "VARCHAR",
                "mother_name": "VARCHAR",
                "previous_school": "VARCHAR",
                "blood_group": "VARCHAR",
                "family_discount_percent": "FLOAT DEFAULT 0",
                "graduation_date": "VARCHAR",
                "withdrawal_date": "VARCHAR",
                "alumni_since": "VARCHAR",
                "archived_at": "DATETIME",
            }
            for column_name, column_def in school_student_columns.items():
                if column_name not in student_columns:
                    connection.execute(
                        text(f"ALTER TABLE school_students ADD COLUMN {column_name} {column_def}")
                    )
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_workspace_id "
                "ON school_students(workspace_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_campus_id "
                "ON school_students(campus_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_academic_session_id "
                "ON school_students(academic_session_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_school_class_id "
                "ON school_students(school_class_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_school_section_id "
                "ON school_students(school_section_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_application_id "
                "ON school_students(application_id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_b_form_no "
                "ON school_students(b_form_no)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_school_students_archived_at "
                "ON school_students(archived_at)"
            ))
            connection.commit()
        except Exception as e:
            print(f"Error adding school student foundation columns: {e}")

        # Phase 7 Amazon pricing controls. New tables are created from metadata;
        # these portable migrations add columns to existing Amazon tables.
        try:
            result = connection.execute(text("PRAGMA table_info(amazon_accounts)"))
            account_columns = [row[1] for row in result]
            amazon_account_pricing_columns = {
                "price_sync_enabled": "BOOLEAN NOT NULL DEFAULT 0",
                "price_change_approval_percent": "FLOAT NOT NULL DEFAULT 10",
                "current_balance": "FLOAT",
                "current_balance_currency": "VARCHAR",
                "current_balance_event_group_id": "VARCHAR",
                "current_balance_updated_at": "DATETIME",
                "current_balance_error": "TEXT",
                "deferred_balance": "FLOAT",
                "deferred_balance_currency": "VARCHAR",
                "deferred_transaction_count": "INTEGER NOT NULL DEFAULT 0",
                "deferred_balance_updated_at": "DATETIME",
                "deferred_balance_error": "TEXT",
                "auto_sync_enabled": "BOOLEAN NOT NULL DEFAULT 1",
                "auto_sync_interval_minutes": "INTEGER NOT NULL DEFAULT 15",
                "auto_sync_last_started_at": "DATETIME",
                "auto_sync_last_finished_at": "DATETIME",
                "auto_sync_last_error": "TEXT",
            }
            for column_name, column_def in amazon_account_pricing_columns.items():
                if column_name not in account_columns:
                    connection.execute(
                        text(
                            f"ALTER TABLE amazon_accounts "
                            f"ADD COLUMN {column_name} {column_def}"
                        )
                    )
            connection.execute(
                text(
                    "UPDATE amazon_accounts "
                    "SET auto_sync_interval_minutes = 15 "
                    "WHERE auto_sync_interval_minutes NOT IN (5, 15, 30, 60)"
                )
            )
            connection.execute(
                text(
                    "UPDATE amazon_accounts "
                    "SET auto_sync_last_started_at = CURRENT_TIMESTAMP "
                    "WHERE auto_sync_enabled = 1 "
                    "AND auto_sync_last_started_at IS NULL"
                )
            )

            result = connection.execute(
                text("PRAGMA table_info(amazon_product_mappings)")
            )
            mapping_columns = [row[1] for row in result]
            amazon_mapping_pricing_columns = {
                "product_type": "VARCHAR NOT NULL DEFAULT 'PRODUCT'",
                "amazon_image_url": "TEXT",
                "is_variation_parent": "BOOLEAN NOT NULL DEFAULT 0",
                "pending_price": "FLOAT",
                "last_price_submission_id": "VARCHAR",
                "last_price_status": "VARCHAR",
            }
            for column_name, column_def in amazon_mapping_pricing_columns.items():
                if column_name not in mapping_columns:
                    connection.execute(
                        text(
                            f"ALTER TABLE amazon_product_mappings "
                            f"ADD COLUMN {column_name} {column_def}"
                        )
                    )
            connection.commit()
        except Exception as e:
            print(f"Error adding Amazon pricing columns: {e}")

        # Product media and parcel details for the isolated service-taker catalog.
        try:
            result = connection.execute(
                text("PRAGMA table_info(service_taker_products)")
            )
            service_product_columns = [row[1] for row in result]
            service_product_media_columns = {
                "image_url": "TEXT",
                "length_cm": "FLOAT",
                "width_cm": "FLOAT",
                "height_cm": "FLOAT",
            }
            for column_name, column_def in service_product_media_columns.items():
                if column_name not in service_product_columns:
                    connection.execute(
                        text(
                            "ALTER TABLE service_taker_products "
                            f"ADD COLUMN {column_name} {column_def}"
                        )
                    )
            connection.commit()
        except Exception as e:
            print(f"Error adding service-taker product media columns: {e}")
