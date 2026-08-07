import os
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.client import SpApiJsonResult
from app.integrations.amazon.constants import JOB_TYPE_LISTINGS_IMPORT
from app.integrations.amazon.jobs import enqueue_amazon_job, process_amazon_job
from app.integrations.amazon.listings import (
    auto_match_unmapped_listings,
    import_all_listings,
    listing_issues,
    mapping_response,
    query_listing_mappings,
    upsert_listing_item,
)
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonFbaInventory,
    AmazonProductMapping,
    AmazonSyncJob,
)
from app.integrations.amazon.router import connect_listing, disconnect_listing
from app.integrations.amazon.schemas import AmazonListingConnectRequest
from app.integrations.amazon.security import CredentialCipher
from app.models import ActivityLog, Product, User


class FakeListingsClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def search_listing_items(self, seller_id, *, page_token=None):
        self.calls.append((seller_id, page_token))
        return self.pages[len(self.calls) - 1]


class AmazonPhase2Tests(unittest.TestCase):
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
                AmazonFbaInventory.__table__,
                AmazonSyncJob.__table__,
                AmazonApiLog.__table__,
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
            article_no="KNIFE-TRAPPER-01-FBA",
            name="Trapper Knife",
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

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if self.original_key is None:
            os.environ.pop("AMAZON_CREDENTIALS_ENCRYPTION_KEY", None)
        else:
            os.environ["AMAZON_CREDENTIALS_ENCRYPTION_KEY"] = self.original_key

    def listing_item(self, **overrides):
        item = {
            "sku": "KNIFE-TRAPPER-01-FBA",
            "summaries": [
                {
                    "marketplaceId": "ATVPDKIKX0DER",
                    "asin": "B0TESTASIN",
                    "conditionType": "new_new",
                    "status": ["BUYABLE", "DISCOVERABLE"],
                    "itemName": "Hisbenew Trapper Knife",
                }
            ],
            "issues": [],
            "attributes": {
                "main_product_image_locator": [
                    {
                        "media_location": (
                            "https://m.media-amazon.com/images/I/test-main.jpg"
                        ),
                        "marketplace_id": "ATVPDKIKX0DER",
                    }
                ]
            },
            "offers": [
                {
                    "marketplaceId": "ATVPDKIKX0DER",
                    "price": {"currency": "USD", "amount": "29.95"},
                }
            ],
            "fulfillmentAvailability": [
                {
                    "fulfillmentChannelCode": "AMAZON_NA",
                    "quantity": 12,
                }
            ],
        }
        item.update(overrides)
        return item

    def test_import_captures_listing_and_exact_sku_auto_matches(self):
        mapping, created, auto_matched = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(fnsku="X00TESTFNSKU"),
        )
        self.db.commit()

        self.assertTrue(created)
        self.assertTrue(auto_matched)
        self.assertEqual(mapping.product_id, self.product.id)
        self.assertEqual(mapping.asin, "B0TESTASIN")
        self.assertEqual(mapping.fnsku, "X00TESTFNSKU")
        self.assertEqual(mapping.fulfillment_mode, "FBA")
        self.assertEqual(mapping.listing_status, "BUYABLE, DISCOVERABLE")
        self.assertEqual(
            mapping.amazon_image_url,
            "https://m.media-amazon.com/images/I/test-main.jpg",
        )
        self.assertEqual(mapping.amazon_price, 29.95)
        self.assertEqual(mapping.last_amazon_quantity, 12)
        self.assertEqual(mapping_response(mapping)["product_status"], "Active")

    def test_discoverable_only_listing_is_reported_as_inactive(self):
        mapping, _, _ = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(
                summaries=[
                    {
                        "marketplaceId": "ATVPDKIKX0DER",
                        "asin": "B0TESTASIN",
                        "conditionType": "new_new",
                        "status": ["DISCOVERABLE"],
                        "itemName": "Hisbenew Trapper Knife",
                    }
                ]
            ),
        )
        self.db.commit()

        response = mapping_response(mapping, self.product)
        self.assertEqual(response["product_status"], "Inactive")
        self.assertEqual(response["listing_status"], "DISCOVERABLE")

    def test_variation_parent_is_persisted_but_hidden_from_sellable_listings(self):
        parent_item = self.listing_item(
            attributes={
                "parentage_level": [
                    {
                        "value": "parent",
                        "marketplace_id": "ATVPDKIKX0DER",
                    }
                ]
            },
        )
        parent_mapping, _, auto_matched = upsert_listing_item(
            self.db,
            account=self.account,
            item=parent_item,
        )
        child_mapping, _, _ = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(sku="VARIATION-CHILD-SKU"),
        )
        self.db.commit()

        items, total, summary = query_listing_mappings(
            self.db,
            account_id=self.account.id,
        )
        matched, unmatched = auto_match_unmapped_listings(
            self.db,
            account_id=self.account.id,
        )

        self.assertTrue(parent_mapping.is_variation_parent)
        self.assertFalse(auto_matched)
        self.assertIsNone(parent_mapping.product_id)
        self.assertEqual([item["id"] for item in items], [child_mapping.id])
        self.assertEqual(total, 1)
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["unmapped"], 1)
        self.assertEqual(summary["variation_parents_hidden"], 1)
        self.assertEqual((matched, unmatched), (0, 1))

    def test_listing_response_includes_fba_inventory_breakdown_and_health(self):
        mapping, _, _ = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(),
        )
        self.db.flush()
        self.db.add(
            AmazonFbaInventory(
                amazon_account_id=self.account.id,
                product_mapping_id=mapping.id,
                marketplace_id=self.account.marketplace_id,
                seller_sku=mapping.seller_sku,
                fnsku="X00TESTFNSKU",
                fulfillable_quantity=4,
                inbound_working_quantity=1,
                inbound_shipped_quantity=2,
                inbound_receiving_quantity=3,
                reserved_quantity=5,
                pending_customer_order_quantity=2,
                pending_transshipment_quantity=2,
                fc_processing_quantity=1,
                unfulfillable_quantity=2,
                customer_damaged_quantity=1,
                warehouse_damaged_quantity=1,
                researching_quantity=1,
                total_quantity=18,
                minimum_fba_quantity=10,
            )
        )
        self.db.commit()

        items, total, _ = query_listing_mappings(
            self.db,
            account_id=self.account.id,
        )
        inventory = items[0]["fba_inventory"]

        self.assertEqual(total, 1)
        self.assertEqual(inventory["fulfillable_quantity"], 4)
        self.assertEqual(inventory["inbound_quantity"], 6)
        self.assertEqual(inventory["reserved_quantity"], 5)
        self.assertEqual(inventory["pending_transshipment_quantity"], 2)
        self.assertEqual(inventory["damaged_quantity"], 2)
        self.assertEqual(inventory["health"], "Low stock")

    def test_reimport_updates_one_mapping_without_duplicate(self):
        first, _, _ = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(),
        )
        self.db.commit()
        second, created, _ = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(
                offers=[
                    {
                        "marketplaceId": "ATVPDKIKX0DER",
                        "price": {"currency": "USD", "amount": "31.50"},
                    }
                ]
            ),
        )
        self.db.commit()

        self.assertFalse(created)
        self.assertEqual(first.id, second.id)
        self.assertEqual(
            self.db.query(AmazonProductMapping).count(),
            1,
        )
        self.assertEqual(second.amazon_price, 31.5)

    def test_unmatched_listing_remains_visible_and_issue_is_sanitized(self):
        item = self.listing_item(
            sku="UNMATCHED-SKU",
            issues=[
                {
                    "code": "90000900",
                    "severity": "ERROR",
                    "message": (
                        "Authorization: Bearer Atza|TOPSECRET "
                        "listing data is incomplete"
                    ),
                    "attributeNames": ["item_name"],
                }
            ],
        )
        mapping, _, auto_matched = upsert_listing_item(
            self.db,
            account=self.account,
            item=item,
        )
        self.db.commit()

        self.assertFalse(auto_matched)
        self.assertIsNone(mapping.product_id)
        serialized = str(listing_issues(mapping))
        self.assertNotIn("TOPSECRET", serialized)
        self.assertIn("[REDACTED]", serialized)

    def test_paginated_import_records_counts(self):
        first_page = SpApiJsonResult(
            body={
                "items": [self.listing_item()],
                "pagination": {"nextToken": "NEXT"},
            },
            amazon_request_id="REQUEST-1",
            http_status=200,
            duration_ms=10,
        )
        second_page = SpApiJsonResult(
            body={
                "items": [self.listing_item(sku="UNMATCHED-SKU")],
                "pagination": {},
            },
            amazon_request_id="REQUEST-2",
            http_status=200,
            duration_ms=15,
        )
        client = FakeListingsClient([first_page, second_page])

        result = import_all_listings(
            self.db,
            account=self.account,
            client=client,
        )
        self.db.commit()

        self.assertEqual(result.imported, 2)
        self.assertEqual(result.pages, 2)
        self.assertEqual(result.auto_matched, 1)
        self.assertEqual(result.unmatched, 1)
        self.assertEqual(result.duration_ms, 25)
        self.assertEqual(client.calls[1][1], "NEXT")

    def test_manual_mapping_connects_and_disconnects_without_deleting_listing(self):
        mapping, _, _ = upsert_listing_item(
            self.db,
            account=self.account,
            item=self.listing_item(sku="MANUAL-MAP-SKU"),
        )
        self.db.commit()
        self.db.refresh(mapping)

        connected = connect_listing(
            mapping.id,
            AmazonListingConnectRequest(product_id=self.product.id),
            db=self.db,
            user=self.admin,
        )
        self.assertEqual(connected["product_id"], self.product.id)
        self.assertEqual(connected["erp_sku"], self.product.article_no)

        disconnected = disconnect_listing(
            mapping.id,
            db=self.db,
            user=self.admin,
        )
        self.assertIsNone(disconnected["product_id"])
        self.assertEqual(
            self.db.query(AmazonProductMapping)
            .filter(AmazonProductMapping.id == mapping.id)
            .count(),
            1,
        )

    def test_database_job_completes_and_records_api_log(self):
        job = enqueue_amazon_job(
            self.db,
            amazon_account_id=self.account.id,
            job_type=JOB_TYPE_LISTINGS_IMPORT,
        )
        self.db.commit()
        self.db.refresh(job)
        page = SpApiJsonResult(
            body={"items": [self.listing_item()], "pagination": {}},
            amazon_request_id="JOB-REQUEST",
            http_status=200,
            duration_ms=20,
        )

        class PatchedClient:
            def __init__(self, account):
                self.account = account

            def search_listing_items(self, seller_id, *, page_token=None):
                return page

        with (
            patch(
                "app.integrations.amazon.jobs.SessionLocal",
                self.session_factory,
            ),
            patch(
                "app.integrations.amazon.listings.AmazonSpApiClient",
                PatchedClient,
            ),
        ):
            process_amazon_job(job.id)

        self.db.expire_all()
        completed_job = (
            self.db.query(AmazonSyncJob)
            .filter(AmazonSyncJob.id == job.id)
            .one()
        )
        self.assertEqual(completed_job.status, "Completed")
        self.assertEqual(completed_job.amazon_request_id, "JOB-REQUEST")
        api_log = self.db.query(AmazonApiLog).one()
        self.assertTrue(api_log.success)
        self.assertEqual(api_log.operation, "searchListingsItems")


if __name__ == "__main__":
    unittest.main()
