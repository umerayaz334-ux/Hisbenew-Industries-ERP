import json
import os
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.client import SpApiJsonResult
from app.integrations.amazon.constants import JOB_TYPE_FBA_INBOUND_PLANS_SYNC
from app.integrations.amazon.exceptions import AmazonTemporaryError
from app.integrations.amazon.inbound import (
    AMAZON_DAMAGED,
    AMAZON_MISSING,
    FACTORY_AVAILABLE,
    FBA_FULFILLABLE,
    FBA_IN_TRANSIT,
    confirm_inbound_plan,
    create_inbound_plan,
    query_inbound_shipments,
    reconcile_inbound_shipment,
    save_tracking_and_departure,
    sync_inbound_plan,
    sync_inbound_plans,
    upsert_local_cartons,
)
from app.integrations.amazon.jobs import enqueue_amazon_job, process_amazon_job
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonFbaInboundPlan,
    AmazonFbaInboundPlanItem,
    AmazonFbaInboundStockMovement,
    AmazonFbaShipment,
    AmazonFbaShipmentCarton,
    AmazonFbaShipmentItem,
    AmazonProductMapping,
    AmazonSyncJob,
)
from app.integrations.amazon.security import CredentialCipher
from app.models import Product, StockMovement, User


def result(body, request_id="request-safe", status=200, duration=4):
    return SpApiJsonResult(
        body=body,
        amazon_request_id=request_id,
        http_status=status,
        duration_ms=duration,
    )


class FakeInboundClient:
    def __init__(self):
        self.created_payload = None
        self.plan_pages = [
            result(
                {
                    "inboundPlans": [
                        {
                            "inboundPlanId": "wf-plan-000000000000000000000000000001",
                            "name": "Imported plan",
                            "marketplaceIds": ["ATVPDKIKX0DER"],
                            "status": "ACTIVE",
                            "lastUpdatedAt": "2026-07-22T10:00:00Z",
                            "sourceAddress": {
                                "name": "PII MUST NOT BE STORED",
                                "phoneNumber": "PII MUST NOT BE STORED",
                                "addressLine1": "PII MUST NOT BE STORED",
                            },
                        }
                    ]
                }
            )
        ]
        self.plan_page_calls = 0

    def create_inbound_plan(self, *, name, source_address, items):
        self.created_payload = {
            "name": name,
            "source_address": source_address,
            "items": items,
        }
        return result(
            {
                "inboundPlanId": "wf-plan-000000000000000000000000000002",
                "operationId": "op-create-0000000000000000000000000001",
            },
            status=202,
        )

    def list_inbound_plans(self, *, pagination_token=None, status=None):
        page = self.plan_pages[self.plan_page_calls]
        self.plan_page_calls += 1
        if isinstance(page, Exception):
            raise page
        return page

    def get_inbound_plan(self, inbound_plan_id):
        return result(
            {
                "inboundPlanId": inbound_plan_id,
                "name": "Synced plan",
                "marketplaceIds": ["ATVPDKIKX0DER"],
                "status": "ACTIVE",
                "lastUpdatedAt": "2026-07-23T10:00:00Z",
                "sourceAddress": {
                    "name": "PII MUST NOT BE STORED",
                    "email": "private@example.com",
                },
                "packingOptions": [
                    {"packingOptionId": "packing-safe", "status": "ACCEPTED"}
                ],
                "placementOptions": [
                    {"placementOptionId": "placement-safe", "status": "OFFERED"}
                ],
                "shipments": [
                    {
                        "shipmentId": "sh-shipment-00000000000000000000000001",
                        "status": "READY_TO_SHIP",
                    }
                ],
            }
        )

    def list_inbound_plan_items(self, inbound_plan_id, *, pagination_token=None):
        return result(
            {
                "items": [
                    {
                        "msku": "FBA-INBOUND-SKU",
                        "asin": "B0INBOUND",
                        "fnsku": "X00INBOUND",
                        "quantity": 10,
                        "prepOwner": "SELLER",
                        "labelOwner": "SELLER",
                    }
                ]
            }
        )

    def get_inbound_shipment(self, inbound_plan_id, shipment_id):
        return result(
            {
                "shipmentId": shipment_id,
                "shipmentConfirmationId": "FBA-SHIP-CONFIRM",
                "name": "Shipment one",
                "status": "IN_TRANSIT",
                "placementOptionId": "placement-safe",
                "amazonReferenceId": "reference-safe",
                "destination": {
                    "warehouseId": "ABE8",
                    "address": {
                        "countryCode": "US",
                        "name": "PII MUST NOT BE STORED",
                        "addressLine1": "PII MUST NOT BE STORED",
                    },
                },
                "selectedDeliveryWindow": {
                    "start": "2026-07-28T08:00:00Z",
                    "end": "2026-07-30T08:00:00Z",
                },
            }
        )

    def list_inbound_shipment_items(
        self,
        inbound_plan_id,
        shipment_id,
        *,
        pagination_token=None,
    ):
        return result(
            {
                "items": [
                    {
                        "msku": "FBA-INBOUND-SKU",
                        "asin": "B0INBOUND",
                        "fnsku": "X00INBOUND",
                        "quantity": 10,
                        "prepInstructions": [],
                        "labelOwner": "SELLER",
                    }
                ]
            }
        )

    def list_inbound_shipment_boxes(
        self,
        inbound_plan_id,
        shipment_id,
        *,
        pagination_token=None,
    ):
        return result(
            {
                "boxes": [
                    {
                        "packageId": "package-safe",
                        "boxId": "box-safe",
                        "quantity": 1,
                        "dimensions": {
                            "length": 30,
                            "width": 20,
                            "height": 15,
                            "unitOfMeasurement": "CM",
                        },
                        "weight": {"value": 5, "unit": "KG"},
                    }
                ]
            }
        )

    def get_legacy_inbound_shipment_items(
        self,
        shipment_confirmation_id,
        *,
        next_token=None,
    ):
        return result(
            {
                "payload": {
                    "ItemData": [
                        {
                            "SellerSKU": "FBA-INBOUND-SKU",
                            "FulfillmentNetworkSKU": "X00INBOUND",
                            "QuantityShipped": 10,
                            "QuantityReceived": 7,
                        }
                    ]
                }
            }
        )

    def confirm_placement_option(self, inbound_plan_id, placement_option_id):
        return result(
            {"operationId": "op-confirm-safe"},
            status=202,
        )

    def update_inbound_shipment_tracking(
        self,
        inbound_plan_id,
        shipment_id,
        *,
        tracking_details,
    ):
        return result({}, status=204)


class AmazonPhase5Tests(unittest.TestCase):
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
                StockMovement.__table__,
                AmazonAccount.__table__,
                AmazonProductMapping.__table__,
                AmazonSyncJob.__table__,
                AmazonApiLog.__table__,
                AmazonFbaInboundPlan.__table__,
                AmazonFbaInboundPlanItem.__table__,
                AmazonFbaShipment.__table__,
                AmazonFbaShipmentItem.__table__,
                AmazonFbaShipmentCarton.__table__,
                AmazonFbaInboundStockMovement.__table__,
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
            marketplace_id="ATVPDKIKX0DER",
            region="NA",
            endpoint="https://sellingpartnerapi-na.amazon.com",
            currency="USD",
            is_active=True,
            connection_status="Connected",
        )
        self.product = Product(
            article_no="FBA-INBOUND-SKU",
            name="FBA Inbound Product",
            factory_stock=100,
            usa_stock=5,
            reserved_stock=2,
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
            seller_sku="FBA-INBOUND-SKU",
            asin="B0INBOUND",
            fnsku="X00INBOUND",
            marketplace_id=self.account.marketplace_id,
            fulfillment_mode="FBA",
            fba_enabled=True,
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

    def create_synced_shipment(self):
        client = FakeInboundClient()
        sync_inbound_plans(self.db, account=self.account, client=client)
        self.db.commit()
        plan = self.db.query(AmazonFbaInboundPlan).one()
        sync_inbound_plan(
            self.db,
            account=self.account,
            inbound_plan_id=plan.inbound_plan_id,
            client=client,
        )
        self.db.commit()
        shipment = self.db.query(AmazonFbaShipment).one()
        item = self.db.query(AmazonFbaShipmentItem).one()
        return client, plan, shipment, item

    def test_create_plan_sends_address_once_but_never_stores_it(self):
        client = FakeInboundClient()
        plan, outcome = create_inbound_plan(
            self.db,
            account=self.account,
            plan_name="ERP created plan",
            source_warehouse_id="FACTORY",
            source_address_reference="Main factory dispatch desk",
            source_address={
                "name": "Private Contact",
                "addressLine1": "Private Address",
                "city": "Wazirabad",
                "postalCode": "52000",
                "countryCode": "PK",
                "phoneNumber": "Private Phone",
            },
            packing_type="CASE_PACKED",
            item_requests=[{"product_id": self.product.id, "quantity": 12}],
            client=client,
        )
        self.db.commit()

        self.assertEqual(outcome.http_status, 202)
        self.assertEqual(plan.planned_quantity, 12)
        self.assertEqual(self.db.query(AmazonFbaInboundPlanItem).count(), 1)
        self.assertEqual(self.product.factory_stock, 100)
        self.assertEqual(self.db.query(StockMovement).count(), 0)
        self.assertEqual(
            client.created_payload["source_address"]["name"],
            "Private Contact",
        )
        stored = " ".join(
            str(value)
            for row in self.db.query(AmazonFbaInboundPlan).all()
            for value in row.__dict__.values()
        )
        self.assertNotIn("Private Contact", stored)
        self.assertNotIn("Private Address", stored)
        self.assertNotIn("Private Phone", stored)

    def test_plan_import_is_idempotent_and_strips_source_address(self):
        first = FakeInboundClient()
        first_result = sync_inbound_plans(
            self.db,
            account=self.account,
            client=first,
        )
        second = FakeInboundClient()
        second_result = sync_inbound_plans(
            self.db,
            account=self.account,
            client=second,
        )
        self.db.commit()

        self.assertEqual(first_result.plans_created, 1)
        self.assertEqual(second_result.plans_created, 0)
        self.assertEqual(second_result.plans_updated, 1)
        self.assertEqual(self.db.query(AmazonFbaInboundPlan).count(), 1)
        plan = self.db.query(AmazonFbaInboundPlan).one()
        serialized = json.dumps(plan.__dict__, default=str)
        self.assertNotIn("PII MUST NOT BE STORED", serialized)

    def test_sync_updates_status_items_received_quantity_and_cartons(self):
        _, plan, shipment, item = self.create_synced_shipment()

        self.assertEqual(plan.status, "ACTIVE")
        self.assertEqual(shipment.shipment_status, "IN_TRANSIT")
        self.assertEqual(shipment.destination_code, "ABE8")
        self.assertEqual(shipment.received_quantity, 7)
        self.assertEqual(item.quantity_shipped, 10)
        self.assertEqual(item.quantity_received, 7)
        self.assertEqual(item.quantity_in_discrepancy, 3)
        self.assertEqual(self.db.query(AmazonFbaShipmentCarton).count(), 1)
        self.assertEqual(self.db.query(StockMovement).count(), 0)

    def test_tracking_and_departure_move_factory_stock_once(self):
        client, _, shipment, _ = self.create_synced_shipment()
        initial_generic_movements = self.db.query(StockMovement).count()

        moved, _, _, _ = save_tracking_and_departure(
            self.db,
            account=self.account,
            shipment=shipment,
            carrier_name="UPS",
            tracking_number="SAFE-TRACKING",
            mark_shipped=True,
            submit_to_amazon=False,
            created_by_user_id=self.admin.id,
            client=client,
        )
        self.db.commit()
        moved_again, _, _, _ = save_tracking_and_departure(
            self.db,
            account=self.account,
            shipment=shipment,
            carrier_name="UPS",
            tracking_number="SAFE-TRACKING",
            mark_shipped=True,
            submit_to_amazon=False,
            created_by_user_id=self.admin.id,
            client=client,
        )
        self.db.commit()

        self.db.refresh(self.product)
        self.assertEqual(moved, 10)
        self.assertEqual(moved_again, 0)
        self.assertEqual(self.product.factory_stock, 90)
        self.assertEqual(shipment.tracking_number, "SAFE-TRACKING")
        movement = self.db.query(AmazonFbaInboundStockMovement).one()
        self.assertEqual(movement.from_location, FACTORY_AVAILABLE)
        self.assertEqual(movement.to_location, FBA_IN_TRANSIT)
        self.assertEqual(
            self.db.query(StockMovement).count(),
            initial_generic_movements + 1,
        )

    def test_confirmation_records_amazon_operation_without_stock_change(self):
        client = FakeInboundClient()
        sync_inbound_plans(self.db, account=self.account, client=client)
        self.db.commit()
        plan = self.db.query(AmazonFbaInboundPlan).one()

        outcome = confirm_inbound_plan(
            self.db,
            account=self.account,
            plan=plan,
            placement_option_id="placement-safe",
            client=client,
        )
        self.db.commit()

        self.assertEqual(outcome.http_status, 202)
        self.assertEqual(plan.status, "CONFIRMING")
        self.assertEqual(plan.placement_option_id, "placement-safe")
        self.assertEqual(self.product.factory_stock, 100)
        self.assertEqual(self.db.query(StockMovement).count(), 0)

    def test_reconciliation_separates_received_missing_and_damaged(self):
        client, _, shipment, item = self.create_synced_shipment()
        save_tracking_and_departure(
            self.db,
            account=self.account,
            shipment=shipment,
            carrier_name="UPS",
            tracking_number="SAFE-TRACKING",
            mark_shipped=True,
            submit_to_amazon=False,
            created_by_user_id=self.admin.id,
            client=client,
        )
        self.db.commit()

        movement_count, discrepancy = reconcile_inbound_shipment(
            self.db,
            account=self.account,
            shipment=shipment,
            item_updates=[
                {
                    "shipment_item_id": item.id,
                    "quantity_received": 7,
                    "quantity_missing": 2,
                    "quantity_damaged": 1,
                }
            ],
            created_by_user_id=self.admin.id,
        )
        self.db.commit()

        self.assertEqual(movement_count, 3)
        self.assertEqual(discrepancy, 0)
        destinations = {
            movement.to_location
            for movement in self.db.query(AmazonFbaInboundStockMovement).all()
        }
        self.assertIn(FBA_FULFILLABLE, destinations)
        self.assertIn(AMAZON_MISSING, destinations)
        self.assertIn(AMAZON_DAMAGED, destinations)
        self.db.refresh(self.product)
        self.assertEqual(self.product.factory_stock, 90)

    def test_reconciliation_corrections_append_and_preserve_history(self):
        client, _, shipment, item = self.create_synced_shipment()
        save_tracking_and_departure(
            self.db,
            account=self.account,
            shipment=shipment,
            carrier_name="UPS",
            tracking_number="SAFE-TRACKING",
            mark_shipped=True,
            submit_to_amazon=False,
            created_by_user_id=self.admin.id,
            client=client,
        )
        reconcile_inbound_shipment(
            self.db,
            account=self.account,
            shipment=shipment,
            item_updates=[
                {
                    "shipment_item_id": item.id,
                    "quantity_received": 7,
                    "quantity_missing": 2,
                    "quantity_damaged": 1,
                }
            ],
            created_by_user_id=self.admin.id,
        )
        self.db.commit()
        history_before = self.db.query(AmazonFbaInboundStockMovement).count()
        original_ids = {
            movement.id
            for movement in self.db.query(AmazonFbaInboundStockMovement).all()
        }

        reconcile_inbound_shipment(
            self.db,
            account=self.account,
            shipment=shipment,
            item_updates=[
                {
                    "shipment_item_id": item.id,
                    "quantity_received": 8,
                    "quantity_missing": 1,
                    "quantity_damaged": 0,
                }
            ],
            created_by_user_id=self.admin.id,
        )
        self.db.commit()

        self.assertGreater(
            self.db.query(AmazonFbaInboundStockMovement).count(),
            history_before,
        )
        current_ids = {
            movement.id
            for movement in self.db.query(AmazonFbaInboundStockMovement).all()
        }
        self.assertTrue(original_ids.issubset(current_ids))
        self.assertTrue(
            any(
                "Correction" in movement.movement_type
                for movement in self.db.query(
                    AmazonFbaInboundStockMovement
                ).all()
            )
        )

    def test_reconciliation_report_displays_remaining_discrepancy(self):
        client, _, shipment, item = self.create_synced_shipment()
        save_tracking_and_departure(
            self.db,
            account=self.account,
            shipment=shipment,
            carrier_name="UPS",
            tracking_number="SAFE-TRACKING",
            mark_shipped=True,
            submit_to_amazon=False,
            created_by_user_id=self.admin.id,
            client=client,
        )
        reconcile_inbound_shipment(
            self.db,
            account=self.account,
            shipment=shipment,
            item_updates=[
                {
                    "shipment_item_id": item.id,
                    "quantity_received": 7,
                    "quantity_missing": 1,
                    "quantity_damaged": 0,
                }
            ],
            created_by_user_id=self.admin.id,
        )
        self.db.commit()

        rows = query_inbound_shipments(
            self.db,
            account_id=self.account.id,
            discrepancies_only=True,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["discrepancy_quantity"], 2)
        self.assertGreater(rows[0]["issue_count"], 0)

    def test_cartons_are_upserted_without_duplicate_rows(self):
        _, _, shipment, _ = self.create_synced_shipment()
        upsert_local_cartons(
            self.db,
            shipment=shipment,
            cartons=[
                {
                    "carton_reference": "ERP-BOX-1",
                    "box_id": "box-safe",
                    "quantity": 1,
                    "weight": 6,
                    "weight_unit": "KG",
                }
            ],
        )
        upsert_local_cartons(
            self.db,
            shipment=shipment,
            cartons=[
                {
                    "carton_reference": "ERP-BOX-1",
                    "box_id": "box-safe",
                    "quantity": 1,
                    "weight": 7,
                    "weight_unit": "KG",
                }
            ],
        )
        self.db.commit()

        cartons = (
            self.db.query(AmazonFbaShipmentCarton)
            .filter(AmazonFbaShipmentCarton.carton_reference == "ERP-BOX-1")
            .all()
        )
        self.assertEqual(len(cartons), 1)
        self.assertEqual(cartons[0].weight, 7)

    def test_job_failure_is_sanitized_and_retry_completes(self):
        job = enqueue_amazon_job(
            self.db,
            amazon_account_id=self.account.id,
            job_type=JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
            request_payload={
                "source_addresses_stored": False,
                "client_secret": "must-not-leak",
            },
        )
        self.db.commit()
        job_id = job.id
        failing = FakeInboundClient()
        failing.plan_pages = [
            AmazonTemporaryError(
                "Temporary inbound failure.",
                error_code="temporary_inbound",
                http_status=503,
            )
        ]
        with (
            patch("app.integrations.amazon.jobs.SessionLocal", self.session_factory),
            patch(
                "app.integrations.amazon.inbound.AmazonSpApiClient",
                return_value=failing,
            ),
        ):
            process_amazon_job(job_id)
        self.db.expire_all()
        failed = self.db.query(AmazonSyncJob).filter_by(id=job_id).one()
        self.assertEqual(failed.status, "Retrying")
        self.assertNotIn("must-not-leak", failed.request_payload_sanitized)
        self.assertNotIn("sourceAddress", failed.request_payload_sanitized)

        failed.status = "Pending"
        self.db.commit()
        successful = FakeInboundClient()
        with (
            patch("app.integrations.amazon.jobs.SessionLocal", self.session_factory),
            patch(
                "app.integrations.amazon.inbound.AmazonSpApiClient",
                return_value=successful,
            ),
        ):
            process_amazon_job(job_id)
        self.db.expire_all()
        completed = self.db.query(AmazonSyncJob).filter_by(id=job_id).one()
        self.assertEqual(completed.status, "Completed")
        api_logs = self.db.query(AmazonApiLog).all()
        self.assertTrue(
            all(log.api_name == "Fulfillment Inbound API" for log in api_logs)
        )


if __name__ == "__main__":
    unittest.main()
