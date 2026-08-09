"""Initialize the shared production database once before API workers start."""

from .database import Base, SessionLocal, engine, ensure_scaling_indexes, migrate_database
from .integrations.amazon.models import (  # noqa: F401
    AmazonAccount,
    AmazonApiLog,
    AmazonFbaInventory,
    AmazonFbaInventoryHistory,
    AmazonFbaInboundPlan,
    AmazonFbaInboundPlanItem,
    AmazonFbaInboundStockMovement,
    AmazonFbaShipment,
    AmazonFbaShipmentCarton,
    AmazonFbaShipmentItem,
    AmazonFinancialTransaction,
    AmazonFinancialTransactionItem,
    AmazonInventoryLocation,
    AmazonOrder,
    AmazonOrderItem,
    AmazonOrderStatusHistory,
    AmazonProductMapping,
    AmazonSettlement,
    AmazonSyncJob,
)
from .models import User  # noqa: F401 - imports and registers all model metadata
from .security import hash_pin


def bootstrap() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_database()
    ensure_scaling_indexes()

    db = SessionLocal()
    try:
        if not db.query(User).filter(User.role.in_(["admin", "super_admin"])).first():
            db.add(
                User(
                    name="adminmain",
                    username="adminmain",
                    pin=hash_pin("1234"),
                    role="super_admin",
                    is_active=True,
                )
            )
            db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    bootstrap()
