import os
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.client import SpApiJsonResult
from app.integrations.amazon.constants import (
    FBA_LOGICAL_LOCATIONS,
    JOB_TYPE_FBA_INVENTORY_SYNC,
)
from app.integrations.amazon.exceptions import AmazonTemporaryError
from app.integrations.amazon.fba_inventory import (
    query_fba_inventory,
    sync_fba_inventory,
    upsert_fba_inventory_summary,
)
from app.integrations.amazon.jobs import enqueue_amazon_job, process_amazon_job
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonFbaInventory,
    AmazonFbaInventoryHistory,
    AmazonInventoryLocation,
    AmazonProductMapping,
    AmazonSyncJob,
)
from app.integrations.amazon.router import retry_fba_inventory_job
from app.integrations.amazon.security import CredentialCipher
from app.models import ActivityLog, Product, User


class FakeFbaClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get_fba_inventory_summaries(self, *, next_token=None, seller_sku=None):
        self.calls.append((next_token, seller_sku))
        page = self.pages[len(self.calls) - 1]
        if isinstance(page, Exception):
            raise page
        return page


class AmazonPhase3Tests(unittest.TestCase):
    def setUp(self):
        self.original_key = os.environ.get("AMAZON_CREDENTIALS_ENCRYPTION_KEY")
        self.key = Fernet.generate_key().decode("ascii")
        os.environ["AMAZON_CREDENTIALS_ENCRYPTION_KEY"] = self.key
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(
            self.engine,
            tables=[
                Product.__table__,
                User.__table__,
                ActivityLog.__table__,
                AmazonAccount.__table__,
                AmazonProductMapping.__table__,
                AmazonSyncJob.__table__,
                AmazonApiLog.__table__,
                AmazonInventoryLocation.__table__,
                AmazonFbaInventory.__table__,
                AmazonFbaInventoryHistory.__table__,
            ],
        )
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        cipher = CredentialCipher(self.key)
        self.account = AmazonAccount(
            account_name="Hisbenew Amazon",
            encrypted_lwa_client_id=cipher.encrypt("test-client"),
            encrypted_lwa_client_secret=cipher.encrypt("test-secret"),
            encrypted_refresh_token=cipher.encrypt("test-refresh"),
            encrypted_seller_id=cipher.encrypt("A1TESTSELLER"),
            app_id="test-app",
            marketplace_id="ATVPDKIKX0DER",
            region="NA",
            endpoint="https://sellingpartnerapi-na.amazon.com",
            currency="USD",
            is_active=True,
            connection_status="Connected",
        )
        self.product = Product(
            article_no="FBA-KNIFE-01",
            name="FBA Knife",
            factory_stock=100,
            usa_stock=20,
            reserved_stock=10,
            low_stock_alert=5,
        )
        self.admin = User(
            name="Admin",
            username="admin",
            pin="unused",
            role="admin",
            is_active=True,
        )
        self.db.add_all([self.account, self.product, self.admin])
        self.db.commit()
        self.db.refresh(self.account)
        self.db.refresh(self.product)
        self.db.refresh(self.admin)
        self.mapping = AmazonProductMapping(
            amazon_account_id=self.account.id,
            product_id=self.product.id,
            seller_sku="FBA-KNIFE-01",
            merchant_seller_sku="FBA-KNIFE-01",
            asin="B0TESTFBA1",
            marketplace_id=self.account.marketplace_id,
            fulfillment_mode="FBA",
            fba_enabled=True,
            fbm_enabled=False,
            currency="USD",
        )
        self.db.add(self.mapping)
        self.db.commit()
        self.db.refresh(self.mapping)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if self.original_key is None:
            os.environ.pop("AMAZON_CREDENTIALS_ENCRYPTION_KEY", None)
        else:
            os.environ["AMAZON_CREDENTIALS_ENCRYPTION_KEY"] = self.original_key

    def inventory_summary(self, **overrides):
        summary = {
            "asin": "B0TESTFBA1",
            "fnSku": "X00TESTFBA1",
            "sellerSku": "FBA-KNIFE-01",
            "condition": "NewItem",
            "productName": "Hisbenew FBA Knife",
            "lastUpdatedTime": "2026-07-24T10:00:00Z",
            "inventoryDetails": {
                "fulfillableQuantity": 4,
                "inboundWorkingQuantity": 1,
                "inboundShippedQuantity": 2,
                "inboundReceivingQuantity": 3,
                "reservedQuantity": {
                    "totalReservedQuantity": 5,
                    "pendingCustomerOrderQuantity": 2,
                    "pendingTransshipmentQuantity": 2,
                    "fcProcessingQuantity": 1,
                },
                "unfulfillableQuantity": {
                    "totalUnfulfillableQuantity": 2,
                    "customerDamagedQuantity": 1,
                    "warehouseDamagedQuantity": 1,
                    "distributorDamagedQuantity": 0,
                    "carrierDamagedQuantity": 0,
                    "defectiveQuantity": 0,
                    "expiredQuantity": 0,
                },
                "researchingQuantity": {
                    "totalResearchingQuantity": 1,
                    "researchingQuantityBreakdown": [],
                },
            },
            "totalQuantity": 18,
        }
        summary.update(overrides)
        return summary

    def api_page(self, summaries=None, next_token=None):
        body = {
            "payload": {
                "granularity": {
                    "granularityType": "Marketplace",
                    "granularityId": "ATVPDKIKX0DER",
                },
                "inventorySummaries": (
                    summaries if summaries is not None else [self.inventory_summary()]
                ),
            },
            "pagination": {"nextToken": next_token} if next_token else {},
        }
        return SpApiJsonResult(
            body=body,
            amazon_request_id="FBA-REQUEST",
            http_status=200,
            duration_ms=20,
        )

    def test_fba_import_keeps_factory_stock_separate_and_enriches_mapping(self):
        before = (
            self.product.factory_stock,
            self.product.usa_stock,
            self.product.reserved_stock,
        )
        inventory, created, changed, mapped = upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=self.inventory_summary(),
            synced_at=self.account.created_at,
        )
        self.db.commit()
        self.db.refresh(self.product)
        self.db.refresh(self.mapping)

        self.assertTrue(created)
        self.assertTrue(changed)
        self.assertTrue(mapped)
        self.assertEqual(inventory.fulfillable_quantity, 4)
        self.assertEqual(inventory.reserved_quantity, 5)
        self.assertEqual(inventory.researching_quantity, 1)
        self.assertEqual(self.mapping.fnsku, "X00TESTFBA1")
        self.assertEqual(
            (
                self.product.factory_stock,
                self.product.usa_stock,
                self.product.reserved_stock,
            ),
            before,
        )
        self.product.factory_stock += 25
        self.db.commit()
        self.db.refresh(inventory)
        self.assertEqual(inventory.fulfillable_quantity, 4)

    def test_history_snapshot_is_preserved_only_when_quantities_change(self):
        synced_at = self.account.created_at
        upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=self.inventory_summary(),
            synced_at=synced_at,
        )
        self.db.commit()
        upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=self.inventory_summary(),
            synced_at=synced_at,
        )
        self.db.commit()
        self.assertEqual(self.db.query(AmazonFbaInventoryHistory).count(), 1)

        changed_summary = self.inventory_summary(totalQuantity=19)
        changed_summary["inventoryDetails"]["fulfillableQuantity"] = 5
        upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=changed_summary,
            synced_at=synced_at,
        )
        self.db.commit()
        self.assertEqual(self.db.query(AmazonFbaInventoryHistory).count(), 2)

    def test_low_stock_and_reconciliation_keep_locations_separate(self):
        upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=self.inventory_summary(),
            synced_at=self.account.created_at,
        )
        self.db.commit()
        rows, total, summary = query_fba_inventory(
            self.db,
            account_id=self.account.id,
            low_stock_only=True,
        )

        self.assertEqual(total, 1)
        self.assertEqual(summary["low_stock_count"], 1)
        self.assertTrue(rows[0]["is_low_stock"])
        self.assertEqual(rows[0]["factory_available_quantity"], 110)
        self.assertEqual(rows[0]["fulfillable_quantity"], 4)
        self.assertEqual(rows[0]["total_owned_quantity"], 138)
        self.assertFalse(rows[0]["has_discrepancy"])

    def test_unmapped_fba_inventory_appears_as_reconciliation_discrepancy(self):
        unmatched = self.inventory_summary(
            sellerSku="UNMAPPED-FBA-SKU",
            fnSku="X00UNMAPPED",
            asin="B0UNMAPPED",
        )
        upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=unmatched,
            synced_at=self.account.created_at,
        )
        self.db.commit()
        rows, total, summary = query_fba_inventory(
            self.db,
            account_id=self.account.id,
            discrepancies_only=True,
        )

        self.assertEqual(total, 1)
        self.assertEqual(summary["discrepancy_count"], 1)
        self.assertIn("not mapped", rows[0]["discrepancy_reasons"][0])

    def test_listing_without_erp_product_is_a_reconciliation_discrepancy(self):
        self.mapping.product_id = None
        self.db.commit()
        _, _, _, mapped = upsert_fba_inventory_summary(
            self.db,
            account=self.account,
            summary=self.inventory_summary(),
            synced_at=self.account.created_at,
        )
        self.db.commit()

        rows, total, summary = query_fba_inventory(
            self.db,
            account_id=self.account.id,
            discrepancies_only=True,
        )

        self.assertFalse(mapped)
        self.assertEqual(total, 1)
        self.assertEqual(summary["mapped_count"], 0)
        self.assertEqual(summary["unmapped_count"], 1)
        self.assertIn("not mapped", rows[0]["discrepancy_reasons"][0])
        mapped_rows, mapped_total, _ = query_fba_inventory(
            self.db,
            account_id=self.account.id,
            mapped_only=True,
        )
        self.assertEqual(mapped_rows, [])
        self.assertEqual(mapped_total, 0)

    def test_job_failure_is_logged_and_retry_completes(self):
        job = enqueue_amazon_job(
            self.db,
            amazon_account_id=self.account.id,
            job_type=JOB_TYPE_FBA_INVENTORY_SYNC,
        )
        self.db.commit()
        self.db.refresh(job)

        class FailingClient:
            def __init__(self, account):
                self.account = account

            def get_fba_inventory_summaries(self, **_kwargs):
                raise AmazonTemporaryError(
                    "Amazon FBA inventory timed out.",
                    error_code="fba_timeout",
                )

        with (
            patch("app.integrations.amazon.jobs.SessionLocal", self.session_factory),
            patch(
                "app.integrations.amazon.fba_inventory.AmazonSpApiClient",
                FailingClient,
            ),
        ):
            process_amazon_job(job.id)

        self.db.expire_all()
        retrying_job = self.db.query(AmazonSyncJob).filter_by(id=job.id).one()
        self.assertEqual(retrying_job.status, "Retrying")
        failure_log = self.db.query(AmazonApiLog).one()
        self.assertFalse(failure_log.success)
        self.assertEqual(failure_log.operation, "getInventorySummaries")

        background_tasks = BackgroundTasks()
        retry_fba_inventory_job(
            job.id,
            background_tasks=background_tasks,
            db=self.db,
            user=self.admin,
        )

        page = self.api_page()

        class SuccessfulClient:
            def __init__(self, account):
                self.account = account

            def get_fba_inventory_summaries(self, **_kwargs):
                return page

        with (
            patch("app.integrations.amazon.jobs.SessionLocal", self.session_factory),
            patch(
                "app.integrations.amazon.fba_inventory.AmazonSpApiClient",
                SuccessfulClient,
            ),
        ):
            process_amazon_job(job.id)

        self.db.expire_all()
        completed_job = self.db.query(AmazonSyncJob).filter_by(id=job.id).one()
        self.assertEqual(completed_job.status, "Completed")
        self.assertEqual(self.db.query(AmazonFbaInventory).count(), 1)
        self.assertEqual(
            self.db.query(AmazonInventoryLocation).count(),
            len(FBA_LOGICAL_LOCATIONS),
        )
        self.assertEqual(self.db.query(AmazonApiLog).count(), 2)

    def test_paginated_sync_imports_all_pages(self):
        first = self.api_page(next_token="NEXT")
        second = self.api_page(
            summaries=[
                self.inventory_summary(
                    sellerSku="SECOND-FBA-SKU",
                    fnSku="X00SECOND",
                    asin="B0SECOND",
                )
            ]
        )
        client = FakeFbaClient([first, second])
        result = sync_fba_inventory(
            self.db,
            account=self.account,
            client=client,
        )
        self.db.commit()

        self.assertEqual(result.imported, 2)
        self.assertEqual(result.pages, 2)
        self.assertEqual(client.calls[1][0], "NEXT")
        self.assertEqual(self.db.query(AmazonFbaInventory).count(), 2)


if __name__ == "__main__":
    unittest.main()
