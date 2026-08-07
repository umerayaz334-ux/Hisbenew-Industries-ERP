import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.client import SpApiJsonResult
from app.integrations.amazon.constants import JOB_TYPE_PRICE_SYNC
from app.integrations.amazon.jobs import enqueue_amazon_job, process_amazon_job
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonPriceChange,
    AmazonProductMapping,
    AmazonSyncJob,
)
from app.integrations.amazon.pricing import (
    create_price_change,
    price_submission_payload,
    review_price_change,
    submit_price_change,
    update_price_rules,
)
from app.integrations.amazon.security import CredentialCipher
from app.models import ActivityLog, Product, User


class FakePricingClient:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def patch_listing_price(self, seller_id, seller_sku, *, payload):
        self.calls.append((seller_id, seller_sku, payload))
        return self.result


class AmazonPhase7Tests(unittest.TestCase):
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
                AmazonPriceChange.__table__,
                AmazonApiLog.__table__,
            ],
        )
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        cipher = CredentialCipher(self.key)
        self.admin = User(
            name="Pricing Admin",
            username="pricing-admin",
            pin="unused",
            role="admin",
            is_active=True,
        )
        self.product = Product(article_no="PRICE-SKU", name="Pricing Knife")
        self.account = AmazonAccount(
            account_name="Hisbenew Amazon",
            encrypted_lwa_client_id=cipher.encrypt("client"),
            encrypted_lwa_client_secret=cipher.encrypt("secret"),
            encrypted_refresh_token=cipher.encrypt("refresh"),
            encrypted_seller_id=cipher.encrypt("A1PRICINGSELLER"),
            marketplace_id="ATVPDKIKX0DER",
            region="NA",
            endpoint="https://sellingpartnerapi-na.amazon.com",
            currency="USD",
            is_active=True,
            connection_status="Connected",
            price_sync_enabled=True,
            price_change_approval_percent=10,
        )
        self.db.add_all([self.admin, self.product, self.account])
        self.db.commit()
        self.mapping = AmazonProductMapping(
            amazon_account_id=self.account.id,
            product_id=self.product.id,
            seller_sku="PRICE-SKU",
            asin="B0PRICE",
            product_title="Pricing Knife",
            product_type="PRODUCT",
            marketplace_id=self.account.marketplace_id,
            fulfillment_mode="FBA",
            fba_enabled=True,
            listing_status="BUYABLE",
            amazon_price=100,
            minimum_price=80,
            maximum_price=150,
            currency="USD",
            sync_price=True,
        )
        self.db.add(self.mapping)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if self.original_key is None:
            os.environ.pop("AMAZON_CREDENTIALS_ENCRYPTION_KEY", None)
        else:
            os.environ["AMAZON_CREDENTIALS_ENCRYPTION_KEY"] = self.original_key

    def make_change(self, requested_price=105):
        change = create_price_change(
            self.db,
            account=self.account,
            mapping=self.mapping,
            requested_price=requested_price,
            reason="Seasonal pricing review",
            user=self.admin,
        )
        self.db.commit()
        return change

    @staticmethod
    def accepted_result():
        return SpApiJsonResult(
            body={
                "sku": "PRICE-SKU",
                "status": "ACCEPTED",
                "submissionId": "SUBMISSION-1",
                "issues": [],
            },
            amazon_request_id="PRICE-REQUEST-1",
            http_status=202,
            duration_ms=25,
        )

    def test_small_change_is_auto_approved_and_large_change_requires_review(self):
        small = self.make_change(105)
        self.assertEqual(small.status, "Approved")
        self.assertFalse(small.requires_approval)
        self.assertEqual(small.change_percent, 5)

        large = self.make_change(125)
        self.assertEqual(small.status, "Cancelled")
        self.assertEqual(large.status, "Pending Approval")
        self.assertTrue(large.requires_approval)
        self.assertEqual(large.change_percent, 25)

        review_price_change(
            large,
            approved=True,
            review_note="Margin reviewed",
            user=self.admin,
        )
        self.db.commit()
        self.assertEqual(large.status, "Approved")
        self.assertEqual(large.reviewed_by_user_id, self.admin.id)

    def test_price_boundaries_and_sale_schedule_are_validated(self):
        with self.assertRaisesRegex(ValueError, "below the configured minimum"):
            self.make_change(79)

        start = datetime(2026, 8, 1, 0, 0, 0)
        end = start + timedelta(days=7)
        update_price_rules(
            self.mapping,
            minimum_price=80,
            maximum_price=150,
            sale_price=90,
            sale_start_date=start,
            sale_end_date=end,
            sync_price=True,
        )
        self.db.commit()
        change = self.make_change(110)
        payload = price_submission_payload(self.mapping, change)
        offer = payload["patches"][0]["value"][0]
        self.assertEqual(payload["productType"], "PRODUCT")
        self.assertEqual(offer["our_price"][0]["schedule"][0]["value_with_tax"], 110)
        self.assertEqual(
            offer["minimum_seller_allowed_price"][0]["schedule"][0][
                "value_with_tax"
            ],
            80,
        )
        self.assertEqual(
            offer["maximum_seller_allowed_price"][0]["schedule"][0][
                "value_with_tax"
            ],
            150,
        )
        self.assertEqual(
            offer["discounted_price"][0]["schedule"][0]["value_with_tax"],
            90,
        )

    def test_approved_price_submission_records_amazon_acceptance(self):
        change = self.make_change(105)
        change.status = "Queued"
        self.db.commit()
        client = FakePricingClient(self.accepted_result())

        result = submit_price_change(
            self.db,
            account=self.account,
            change=change,
            client=client,
        )
        self.db.commit()

        self.assertEqual(result.status, "Submitted")
        self.assertEqual(change.amazon_submission_id, "SUBMISSION-1")
        self.assertEqual(self.mapping.pending_price, 105)
        self.assertEqual(self.mapping.last_price_status, "Submitted")
        self.assertIsNone(self.mapping.last_error)
        self.assertEqual(client.calls[0][0], "A1PRICINGSELLER")
        self.assertEqual(client.calls[0][1], "PRICE-SKU")

    def test_amazon_invalid_submission_is_failed_and_sanitized(self):
        change = self.make_change(105)
        change.status = "Queued"
        self.db.commit()
        client = FakePricingClient(
            SpApiJsonResult(
                body={
                    "status": "INVALID",
                    "submissionId": "SUBMISSION-BAD",
                    "issues": [
                        {
                            "code": "4000001",
                            "severity": "ERROR",
                            "message": (
                                "Authorization: Bearer Atza|TOPSECRET "
                                "price is invalid"
                            ),
                            "attributeNames": ["purchasable_offer"],
                        }
                    ],
                },
                amazon_request_id="PRICE-REQUEST-BAD",
                http_status=200,
                duration_ms=20,
            )
        )

        result = submit_price_change(
            self.db,
            account=self.account,
            change=change,
            client=client,
        )
        self.db.commit()

        self.assertEqual(result.status, "Failed")
        self.assertEqual(change.status, "Failed")
        self.assertNotIn("TOPSECRET", change.last_error)
        self.assertIn("[REDACTED]", change.last_error)
        self.assertIsNone(self.mapping.pending_price)

    def test_master_and_sku_switches_block_submission(self):
        change = self.make_change(105)
        change.status = "Queued"
        self.account.price_sync_enabled = False
        self.db.commit()
        client = FakePricingClient(self.accepted_result())
        with self.assertRaisesRegex(
            Exception,
            "price publishing is disabled",
        ):
            submit_price_change(
                self.db,
                account=self.account,
                change=change,
                client=client,
            )
        self.assertEqual(client.calls, [])

    def test_price_job_completes_and_logs_patch_operation(self):
        change = self.make_change(105)
        change.status = "Queued"
        job = enqueue_amazon_job(
            self.db,
            amazon_account_id=self.account.id,
            job_type=JOB_TYPE_PRICE_SYNC,
            reference_type="amazon price change",
            reference_id=change.id,
            priority=5,
        )
        self.db.flush()
        change.sync_job_id = job.id
        self.db.commit()

        class PatchedClient:
            def __init__(self, account):
                self.account = account

            def patch_listing_price(self, seller_id, seller_sku, *, payload):
                return AmazonPhase7Tests.accepted_result()

        with (
            patch(
                "app.integrations.amazon.jobs.SessionLocal",
                self.session_factory,
            ),
            patch(
                "app.integrations.amazon.pricing.AmazonSpApiClient",
                PatchedClient,
            ),
        ):
            process_amazon_job(job.id)

        self.db.expire_all()
        completed_job = self.db.query(AmazonSyncJob).filter_by(id=job.id).one()
        completed_change = (
            self.db.query(AmazonPriceChange).filter_by(id=change.id).one()
        )
        log = self.db.query(AmazonApiLog).one()
        self.assertEqual(completed_job.status, "Completed")
        self.assertEqual(completed_change.status, "Submitted")
        self.assertEqual(log.operation, "patchListingsItem")
        self.assertTrue(log.success)


if __name__ == "__main__":
    unittest.main()
