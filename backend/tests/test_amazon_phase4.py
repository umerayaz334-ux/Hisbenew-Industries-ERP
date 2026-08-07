import os
import unittest
from datetime import datetime
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.client import SpApiJsonResult
from app.integrations.amazon.constants import JOB_TYPE_FBA_ORDERS_SYNC
from app.integrations.amazon.exceptions import AmazonTemporaryError
from app.integrations.amazon.jobs import enqueue_amazon_job, process_amazon_job
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonOrder,
    AmazonOrderItem,
    AmazonOrderStatusHistory,
    AmazonProductMapping,
    AmazonSyncJob,
)
from app.integrations.amazon.orders import (
    query_fba_orders,
    retry_order_mapping,
    sync_fba_orders,
    upsert_fba_order,
)
from app.integrations.amazon.router import retry_fba_order_job
from app.integrations.amazon.security import CredentialCipher
from app.models import (
    ActivityLog,
    Customer,
    FulfillmentOrder,
    Order,
    OrderItem,
    OrderWorkflowTask,
    Product,
    Shipping,
    StockMovement,
    User,
    Worker,
)


class FakeOrderClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def search_fba_orders(
        self,
        *,
        created_after=None,
        last_updated_after=None,
        pagination_token=None,
    ):
        self.calls.append(
            (created_after, last_updated_after, pagination_token)
        )
        page = self.pages[len(self.calls) - 1]
        if isinstance(page, Exception):
            raise page
        return page


class AmazonPhase4Tests(unittest.TestCase):
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
                Customer.__table__,
                User.__table__,
                ActivityLog.__table__,
                Worker.__table__,
                Order.__table__,
                OrderItem.__table__,
                StockMovement.__table__,
                Shipping.__table__,
                OrderWorkflowTask.__table__,
                FulfillmentOrder.__table__,
                AmazonAccount.__table__,
                AmazonProductMapping.__table__,
                AmazonSyncJob.__table__,
                AmazonApiLog.__table__,
                AmazonOrder.__table__,
                AmazonOrderItem.__table__,
                AmazonOrderStatusHistory.__table__,
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
            article_no="FBA-ORDER-SKU",
            name="FBA Order Product",
            factory_stock=100,
            usa_stock=20,
            reserved_stock=10,
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
            seller_sku="FBA-ORDER-SKU",
            merchant_seller_sku="FBA-ORDER-SKU",
            asin="B0ORDERTEST",
            marketplace_id=self.account.marketplace_id,
            fulfillment_mode="FBA",
            fba_enabled=True,
            fbm_enabled=False,
            currency="USD",
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

    def order_payload(self, **overrides):
        order = {
            "orderId": "111-2222222-3333333",
            "createdTime": "2026-07-20T10:00:00Z",
            "lastUpdatedTime": "2026-07-20T12:00:00Z",
            "programs": ["PRIME"],
            "salesChannel": {
                "channelName": "AMAZON",
                "marketplaceId": "ATVPDKIKX0DER",
                "marketplaceName": "Amazon.com",
            },
            "buyer": {
                "buyerName": "PII MUST NOT BE STORED",
            },
            "recipient": {
                "deliveryAddress": {
                    "addressLine1": "PII MUST NOT BE STORED",
                }
            },
            "proceeds": {
                "grandTotal": {"amount": "49.99", "currencyCode": "USD"},
                "breakdowns": [
                    {
                        "type": "ITEM",
                        "subtotal": {"amount": "44.99", "currencyCode": "USD"},
                    },
                    {
                        "type": "SHIPPING",
                        "subtotal": {"amount": "5.00", "currencyCode": "USD"},
                    },
                ],
            },
            "fulfillment": {
                "fulfillmentStatus": "UNSHIPPED",
                "fulfilledBy": "AMAZON",
                "fulfillmentServiceLevel": "STANDARD",
                "shipByWindow": {
                    "earliestDateTime": "2026-07-20T13:00:00Z",
                    "latestDateTime": "2026-07-21T13:00:00Z",
                },
            },
            "orderItems": [
                {
                    "orderItemId": "ITEM-111",
                    "quantityOrdered": 2,
                    "product": {
                        "asin": "B0ORDERTEST",
                        "sellerSku": "FBA-ORDER-SKU",
                        "title": "FBA Order Product",
                        "price": {
                            "unitPrice": {
                                "amount": "22.495",
                                "currencyCode": "USD",
                            }
                        },
                    },
                    "proceeds": {
                        "proceedsTotal": {
                            "amount": "44.99",
                            "currencyCode": "USD",
                        },
                        "breakdowns": [
                            {
                                "type": "ITEM",
                                "subtotal": {
                                    "amount": "44.99",
                                    "currencyCode": "USD",
                                },
                            }
                        ],
                    },
                    "fulfillment": {
                        "quantityFulfilled": 0,
                        "quantityUnfulfilled": 2,
                    },
                }
            ],
        }
        order.update(overrides)
        return order

    def page(self, orders=None, next_token=None):
        return SpApiJsonResult(
            body={
                "orders": orders if orders is not None else [self.order_payload()],
                "pagination": {"nextToken": next_token} if next_token else {},
            },
            amazon_request_id="ORDER-REQUEST",
            http_status=200,
            duration_ms=25,
        )

    def test_import_is_idempotent_maps_items_and_never_enters_factory_workflow(self):
        stock_before = (
            self.product.factory_stock,
            self.product.usa_stock,
            self.product.reserved_stock,
        )
        first = sync_fba_orders(
            self.db,
            account=self.account,
            client=FakeOrderClient([self.page()]),
        )
        self.db.commit()
        second = sync_fba_orders(
            self.db,
            account=self.account,
            client=FakeOrderClient([self.page()]),
        )
        self.db.commit()
        self.db.refresh(self.product)

        self.assertEqual(first.created, 1)
        self.assertEqual(first.created_order_total, 49.99)
        self.assertEqual(first.created_order_currency, "USD")
        self.assertEqual(second.created, 0)
        self.assertEqual(second.created_order_total, 0)
        self.assertIsNone(second.created_order_currency)
        self.assertEqual(second.updated, 1)
        self.assertEqual(self.db.query(AmazonOrder).count(), 1)
        self.assertEqual(self.db.query(AmazonOrderItem).count(), 1)
        item = self.db.query(AmazonOrderItem).one()
        order = self.db.query(AmazonOrder).one()
        self.assertEqual(item.product_id, self.product.id)
        self.assertEqual(order.fulfillment_channel, "AMAZON")
        self.assertIsNone(order.erp_sales_order_id)
        self.assertEqual(
            (
                self.product.factory_stock,
                self.product.usa_stock,
                self.product.reserved_stock,
            ),
            stock_before,
        )
        self.assertEqual(self.db.query(Order).count(), 0)
        self.assertEqual(self.db.query(OrderItem).count(), 0)
        self.assertEqual(self.db.query(StockMovement).count(), 0)
        self.assertEqual(self.db.query(OrderWorkflowTask).count(), 0)
        self.assertEqual(self.db.query(Shipping).count(), 0)
        self.assertEqual(self.db.query(FulfillmentOrder).count(), 0)
        self.assertEqual(self.db.query(AmazonOrderStatusHistory).count(), 1)

    def test_status_and_cancellation_updates_preserve_history(self):
        synced_at = self.account.created_at
        upsert_fba_order(
            self.db,
            account=self.account,
            raw_order=self.order_payload(),
            synced_at=synced_at,
        )
        self.db.commit()

        shipped = self.order_payload(
            lastUpdatedTime="2026-07-21T12:00:00Z",
            fulfillment={
                "fulfillmentStatus": "SHIPPED",
                "fulfilledBy": "AMAZON",
            },
        )
        shipped["orderItems"][0]["fulfillment"]["quantityFulfilled"] = 2
        upsert_fba_order(
            self.db,
            account=self.account,
            raw_order=shipped,
            synced_at=synced_at,
        )
        self.db.commit()
        order = self.db.query(AmazonOrder).one()
        self.assertEqual(order.order_status, "SHIPPED")
        self.assertEqual(order.erp_status, "Completed")
        self.assertEqual(self.db.query(AmazonOrderItem).one().quantity_shipped, 2)

        cancelled = self.order_payload(
            lastUpdatedTime="2026-07-22T12:00:00Z",
            fulfillment={
                "fulfillmentStatus": "CANCELLED",
                "fulfilledBy": "AMAZON",
            },
        )
        upsert_fba_order(
            self.db,
            account=self.account,
            raw_order=cancelled,
            synced_at=synced_at,
        )
        self.db.commit()
        self.assertEqual(order.order_status, "CANCELLED")
        self.assertEqual(order.erp_status, "Cancelled")
        self.assertEqual(order.shipment_status, "Cancelled")
        self.assertEqual(self.db.query(AmazonOrderStatusHistory).count(), 3)

    def test_unmapped_order_issue_clears_after_mapping_retry(self):
        raw_order = self.order_payload()
        raw_order["orderItems"][0]["product"]["sellerSku"] = "UNMAPPED-SKU"
        upsert_fba_order(
            self.db,
            account=self.account,
            raw_order=raw_order,
            synced_at=self.account.created_at,
        )
        self.db.commit()
        rows, total, summary = query_fba_orders(
            self.db,
            account_id=self.account.id,
            issues_only=True,
        )
        self.assertEqual(total, 1)
        self.assertEqual(summary["unmapped_item_count"], 1)
        self.assertEqual(rows[0]["issues"][0]["code"], "unmapped_seller_sku")

        self.db.add(
            AmazonProductMapping(
                amazon_account_id=self.account.id,
                product_id=self.product.id,
                seller_sku="UNMAPPED-SKU",
                marketplace_id=self.account.marketplace_id,
                fulfillment_mode="FBA",
                fba_enabled=True,
                fbm_enabled=False,
                currency="USD",
            )
        )
        self.db.commit()
        order = self.db.query(AmazonOrder).one()
        result = retry_order_mapping(
            self.db,
            account_id=self.account.id,
            order=order,
        )
        self.db.commit()
        self.assertEqual(result["mapped_items"], 1)
        self.assertEqual(result["unmapped_items"], 0)
        _, issues_total, _ = query_fba_orders(
            self.db,
            account_id=self.account.id,
            issues_only=True,
        )
        self.assertEqual(issues_total, 0)

    def test_paginated_order_import(self):
        second_order = self.order_payload(
            orderId="111-2222222-4444444",
        )
        second_order["orderItems"][0]["orderItemId"] = "ITEM-222"
        client = FakeOrderClient(
            [
                self.page(next_token="NEXT"),
                self.page(orders=[second_order]),
            ]
        )
        result = sync_fba_orders(
            self.db,
            account=self.account,
            client=client,
        )
        self.db.commit()
        self.assertEqual(result.imported, 2)
        self.assertEqual(result.pages, 2)
        self.assertEqual(client.calls[1][2], "NEXT")
        self.assertEqual(self.db.query(AmazonOrder).count(), 2)

    def test_incremental_order_sync_uses_last_updated_cursor(self):
        client = FakeOrderClient([self.page(orders=[])])
        result = sync_fba_orders(
            self.db,
            account=self.account,
            last_updated_after=datetime(2026, 7, 24, 12, 0, 0),
            client=client,
        )

        created_after, last_updated_after, pagination_token = client.calls[0]
        self.assertIsNone(created_after)
        self.assertEqual(last_updated_after, "2026-07-24T12:00:00Z")
        self.assertIsNone(pagination_token)
        self.assertEqual(result.sync_mode, "incremental")
        self.assertEqual(result.imported, 0)

    def test_non_fba_order_is_rejected_before_any_erp_effect(self):
        merchant = self.order_payload(
            fulfillment={
                "fulfillmentStatus": "UNSHIPPED",
                "fulfilledBy": "MERCHANT",
            }
        )
        with self.assertRaises(AmazonTemporaryError):
            upsert_fba_order(
                self.db,
                account=self.account,
                raw_order=merchant,
                synced_at=self.account.created_at,
            )
        self.assertEqual(self.db.query(AmazonOrder).count(), 0)
        self.assertEqual(self.db.query(Order).count(), 0)
        self.assertEqual(self.product.reserved_stock, 10)

    def test_order_job_error_is_sanitized_and_retry_completes(self):
        job = enqueue_amazon_job(
            self.db,
            amazon_account_id=self.account.id,
            job_type=JOB_TYPE_FBA_ORDERS_SYNC,
            request_payload={
                "days": 14,
                "marketplace_id": self.account.marketplace_id,
                "fulfilled_by": "AMAZON",
                "pii_requested": False,
            },
        )
        self.db.commit()

        class FailingClient:
            def __init__(self, account):
                self.account = account

            def search_fba_orders(self, **_kwargs):
                raise AmazonTemporaryError(
                    "Amazon Orders API is temporarily unavailable.",
                    error_code="orders_unavailable",
                    http_status=503,
                )

        with (
            patch("app.integrations.amazon.jobs.SessionLocal", self.session_factory),
            patch(
                "app.integrations.amazon.orders.AmazonSpApiClient",
                FailingClient,
            ),
        ):
            process_amazon_job(job.id)

        self.db.expire_all()
        retrying = self.db.query(AmazonSyncJob).filter_by(id=job.id).one()
        self.assertEqual(retrying.status, "Retrying")
        failed_log = self.db.query(AmazonApiLog).one()
        self.assertEqual(failed_log.api_name, "Orders API")
        self.assertEqual(failed_log.operation, "searchOrders")

        retry_fba_order_job(
            job.id,
            background_tasks=BackgroundTasks(),
            db=self.db,
            user=self.admin,
        )
        page = self.page()

        class SuccessfulClient:
            def __init__(self, account):
                self.account = account

            def search_fba_orders(self, **_kwargs):
                return page

        with (
            patch("app.integrations.amazon.jobs.SessionLocal", self.session_factory),
            patch(
                "app.integrations.amazon.orders.AmazonSpApiClient",
                SuccessfulClient,
            ),
        ):
            process_amazon_job(job.id)

        self.db.expire_all()
        completed = self.db.query(AmazonSyncJob).filter_by(id=job.id).one()
        self.assertEqual(completed.status, "Completed")
        self.assertEqual(self.db.query(AmazonOrder).count(), 1)
        self.assertEqual(self.db.query(AmazonApiLog).count(), 2)
        persisted_logs = " ".join(
            str(value or "")
            for value in (
                completed.request_payload_sanitized,
                completed.response_payload_sanitized,
                completed.error_message,
                *(log.error_message for log in self.db.query(AmazonApiLog).all()),
            )
        )
        self.assertNotIn("PII MUST NOT BE STORED", persisted_logs)


if __name__ == "__main__":
    unittest.main()
