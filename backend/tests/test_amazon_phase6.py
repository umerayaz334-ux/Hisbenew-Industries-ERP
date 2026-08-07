import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.client import AmazonSpApiClient, SpApiJsonResult
from app.integrations.amazon.finances import (
    post_settlements_to_accounting,
    profitability_report,
    query_financial_transactions,
    reconciliation_issues,
    sync_current_balance,
    sync_finances,
)
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonFinancialTransaction,
    AmazonFinancialTransactionItem,
    AmazonOrder,
    AmazonProductMapping,
    AmazonSettlement,
)
from app.models import (
    AccountingAccount,
    AccountingTransaction,
    Customer,
    Order,
    Product,
)


class FakeFinanceClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def list_financial_transactions(
        self,
        *,
        posted_after=None,
        posted_before=None,
        next_token=None,
        transaction_status=None,
    ):
        self.calls.append(
            (posted_after, posted_before, next_token, transaction_status)
        )
        return self.pages[len(self.calls) - 1]


class FakeBalanceClient:
    def __init__(self, group_pages, deferred_pages):
        self.group_pages = group_pages
        self.deferred_pages = deferred_pages
        self.group_calls = []
        self.deferred_calls = []

    def list_financial_event_groups(
        self,
        *,
        started_after,
        started_before,
        next_token=None,
    ):
        self.group_calls.append((started_after, started_before, next_token))
        return self.group_pages[len(self.group_calls) - 1]

    def list_financial_transactions(
        self,
        *,
        posted_after,
        posted_before,
        next_token=None,
        transaction_status=None,
    ):
        self.deferred_calls.append(
            (posted_after, posted_before, next_token, transaction_status)
        )
        return self.deferred_pages[len(self.deferred_calls) - 1]


class AmazonPhase6Tests(unittest.TestCase):
    def setUp(self):
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
                Order.__table__,
                AccountingAccount.__table__,
                AccountingTransaction.__table__,
                AmazonAccount.__table__,
                AmazonProductMapping.__table__,
                AmazonOrder.__table__,
                AmazonFinancialTransaction.__table__,
                AmazonFinancialTransactionItem.__table__,
                AmazonSettlement.__table__,
            ],
        )
        self.db = sessionmaker(bind=self.engine)()
        self.account = AmazonAccount(
            account_name="Hisbenew Amazon",
            marketplace_id="ATVPDKIKX0DER",
            region="NA",
            endpoint="https://sellingpartnerapi-na.amazon.com",
            currency="USD",
            is_active=True,
            connection_status="Connected",
        )
        self.product = Product(
            article_no="FIN-SKU",
            name="Finance Test Product",
            cost_price=20,
        )
        self.customer = Customer(name="Amazon managed customer")
        self.db.add_all([self.account, self.product, self.customer])
        self.db.commit()
        self.db.refresh(self.account)
        self.db.refresh(self.product)
        self.db.refresh(self.customer)
        self.mapping = AmazonProductMapping(
            amazon_account_id=self.account.id,
            product_id=self.product.id,
            seller_sku="FIN-SKU",
            asin="B0FINANCE",
            marketplace_id=self.account.marketplace_id,
            fulfillment_mode="FBA",
            fba_enabled=True,
            currency="USD",
        )
        self.amazon_order = AmazonOrder(
            amazon_account_id=self.account.id,
            amazon_order_id="111-2222222-3333333",
            marketplace_id=self.account.marketplace_id,
            fulfillment_channel="AMAZON",
            purchase_date=datetime(2026, 7, 1, 10, 0, 0),
            last_update_date=datetime(2026, 7, 1, 11, 0, 0),
            order_status="SHIPPED",
            erp_status="Completed",
            shipment_status="Shipped",
            currency="USD",
        )
        self.db.add_all([self.mapping, self.amazon_order])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    @staticmethod
    def money(amount):
        return {"currencyAmount": amount, "currencyCode": "USD"}

    def transaction(
        self,
        *,
        transaction_id="TX-SALE",
        transaction_type="Shipment",
        total=88,
        breakdowns=None,
        include_item=True,
        settlement_reference="SETTLEMENT-1",
    ):
        breakdowns = breakdowns or [
            {"breakdownType": "Principal", "breakdownAmount": self.money(100)},
            {
                "breakdownType": "ShippingCharge",
                "breakdownAmount": self.money(10),
            },
            {
                "breakdownType": "Referral Fee",
                "breakdownAmount": self.money(-15),
            },
            {
                "breakdownType": "FBA Fulfillment Fee",
                "breakdownAmount": self.money(-5),
            },
            {
                "breakdownType": "Storage Fee",
                "breakdownAmount": self.money(-2),
            },
        ]
        related = [
            {
                "relatedIdentifierName": "SETTLEMENT_ID",
                "relatedIdentifierValue": settlement_reference,
            }
        ]
        if include_item:
            related.append(
                {
                    "relatedIdentifierName": "ORDER_ID",
                    "relatedIdentifierValue": self.amazon_order.amazon_order_id,
                }
            )
        payload = {
            "transactionId": transaction_id,
            "transactionType": transaction_type,
            "transactionStatus": "RELEASED",
            "description": "PII-free finance fixture",
            "postedDate": "2026-07-20T10:00:00Z",
            "totalAmount": self.money(total),
            "relatedIdentifiers": related,
            "marketplaceDetails": {
                "marketplaceId": self.account.marketplace_id,
            },
            "breakdowns": breakdowns,
            "items": [],
        }
        if include_item:
            payload["items"] = [
                {
                    "totalAmount": self.money(total),
                    "contexts": [
                        {
                            "asin": "B0FINANCE",
                            "sku": "FIN-SKU",
                            "quantityShipped": 2,
                        }
                    ],
                    "breakdowns": breakdowns,
                }
            ]
        return payload

    def page(self, transactions, next_token=None):
        body = {"transactions": transactions}
        if next_token:
            body["nextToken"] = next_token
        return SpApiJsonResult(
            body=body,
            amazon_request_id="FINANCE-REQUEST",
            http_status=200,
            duration_ms=20,
        )

    def test_imports_revenue_fees_refund_reimbursement_and_is_idempotent(self):
        refund = self.transaction(
            transaction_id="TX-REFUND",
            transaction_type="Refund",
            total=-25,
            breakdowns=[
                {
                    "breakdownType": "Principal",
                    "breakdownAmount": self.money(-25),
                }
            ],
        )
        reimbursement = self.transaction(
            transaction_id="TX-REIMBURSEMENT",
            transaction_type="FBA Reimbursement",
            total=7,
            breakdowns=[
                {
                    "breakdownType": "Reimbursement",
                    "breakdownAmount": self.money(7),
                }
            ],
            include_item=False,
        )
        transactions = [self.transaction(), refund, reimbursement]
        first = sync_finances(
            self.db,
            account=self.account,
            client=FakeFinanceClient([self.page(transactions)]),
        )
        self.db.commit()
        second = sync_finances(
            self.db,
            account=self.account,
            client=FakeFinanceClient([self.page(transactions)]),
        )
        self.db.commit()

        self.assertEqual(first.created, 3)
        self.assertEqual(second.created, 0)
        self.assertEqual(second.updated, 3)
        self.assertEqual(self.db.query(AmazonFinancialTransaction).count(), 3)
        sale = (
            self.db.query(AmazonFinancialTransaction)
            .filter_by(transaction_id="TX-SALE")
            .one()
        )
        self.assertEqual(sale.product_revenue, 100)
        self.assertEqual(sale.shipping_revenue, 10)
        self.assertEqual(sale.referral_fee, 15)
        self.assertEqual(sale.fba_fee, 5)
        self.assertEqual(sale.storage_fee, 2)
        self.assertEqual(sale.net_amount, 88)
        self.assertEqual(sale.product_cost, 40)
        self.assertEqual(sale.estimated_profit, 48)
        self.assertEqual(sale.amazon_order_database_id, self.amazon_order.id)
        self.assertEqual(
            self.db.query(AmazonFinancialTransaction)
            .filter_by(transaction_id="TX-REFUND")
            .one()
            .refund_amount,
            25,
        )
        self.assertEqual(
            self.db.query(AmazonFinancialTransaction)
            .filter_by(transaction_id="TX-REIMBURSEMENT")
            .one()
            .reimbursement_amount,
            7,
        )
        settlement = self.db.query(AmazonSettlement).one()
        self.assertEqual(settlement.expected_amount, 70)
        self.assertEqual(settlement.settlement_status, "Expected")

    def test_pagination_profitability_reconciliation_and_settlement_posting(self):
        disbursement = self.transaction(
            transaction_id="TX-DISBURSEMENT",
            transaction_type="Disbursement",
            total=88,
            breakdowns=[
                {
                    "breakdownType": "Transfer",
                    "breakdownAmount": self.money(88),
                }
            ],
            include_item=False,
        )
        client = FakeFinanceClient(
            [
                self.page([self.transaction()], next_token="NEXT"),
                self.page([disbursement]),
            ]
        )
        result = sync_finances(
            self.db,
            account=self.account,
            client=client,
        )
        self.db.commit()

        self.assertEqual(result.pages, 2)
        self.assertEqual(client.calls[1][2], "NEXT")
        settlement = self.db.query(AmazonSettlement).one()
        self.assertEqual(settlement.actual_amount, 88)
        self.assertEqual(settlement.difference_amount, 0)
        self.assertEqual(settlement.settlement_status, "Reconciled")
        report = profitability_report(
            self.db,
            account_id=self.account.id,
            group_by="sku",
        )
        self.assertEqual(report[0]["key"], "FIN-SKU")
        self.assertEqual(report[0]["estimated_profit"], 48)
        self.assertEqual(reconciliation_issues(self.db, account_id=self.account.id), [])

        first_post = post_settlements_to_accounting(
            self.db,
            account_id=self.account.id,
            settlement_ids=[settlement.id],
        )
        self.db.commit()
        second_post = post_settlements_to_accounting(
            self.db,
            account_id=self.account.id,
            settlement_ids=[settlement.id],
        )
        self.db.commit()
        self.assertEqual(first_post["created"], 1)
        self.assertEqual(second_post["created"], 0)
        self.assertEqual(second_post["updated"], 1)
        self.assertEqual(self.db.query(AccountingTransaction).count(), 1)
        self.assertIsNotNone(settlement.erp_accounting_entry_id)
        linked = self.db.query(AmazonFinancialTransaction).all()
        self.assertTrue(all(row.erp_accounting_entry_id for row in linked))

    def test_transaction_summary_does_not_double_count_disbursement(self):
        sync_finances(
            self.db,
            account=self.account,
            client=FakeFinanceClient(
                [
                    self.page(
                        [
                            self.transaction(),
                            self.transaction(
                                transaction_id="TX-DISBURSEMENT",
                                transaction_type="Disbursement",
                                total=88,
                                breakdowns=[
                                    {
                                        "breakdownType": "Transfer",
                                        "breakdownAmount": self.money(88),
                                    }
                                ],
                                include_item=False,
                            ),
                        ]
                    )
                ]
            ),
        )
        self.db.commit()
        _, total, summary = query_financial_transactions(
            self.db,
            account_id=self.account.id,
        )
        self.assertEqual(total, 2)
        self.assertEqual(summary["net_proceeds"], 88)
        self.assertEqual(summary["amazon_fees"], 22)

    def test_client_preserves_finance_filters_for_next_page(self):
        calls = []
        client = AmazonSpApiClient(self.account)

        def fake_get_json(path, *, params, permission_message):
            calls.append((path, params, permission_message))
            return self.page([])

        client._get_json = fake_get_json
        client.list_financial_transactions(
            posted_after="2026-07-01T00:00:00Z",
            posted_before="2026-07-20T00:00:00Z",
        )
        client.list_financial_transactions(
            posted_after="2026-07-01T00:00:00Z",
            posted_before="2026-07-20T00:00:00Z",
            next_token="NEXT",
            transaction_status="DEFERRED",
        )

        self.assertEqual(calls[0][0], "/finances/2024-06-19/transactions")
        self.assertEqual(calls[0][1]["pageSize"], 500)
        self.assertEqual(calls[1][1]["nextToken"], "NEXT")
        self.assertEqual(calls[1][1]["transactionStatus"], "DEFERRED")
        self.assertEqual(
            calls[1][1]["postedAfter"],
            "2026-07-01T00:00:00Z",
        )

    def test_balance_combines_available_and_deferred_amounts(self):
        client = FakeBalanceClient(
            [
                SpApiJsonResult(
                    body={
                        "payload": {
                            "FinancialEventGroupList": [
                                {
                                    "FinancialEventGroupId": "OPEN-USD-1",
                                    "ProcessingStatus": "Open",
                                    "OriginalTotal": {
                                        "CurrencyAmount": -0.96,
                                        "CurrencyCode": "USD",
                                    },
                                },
                                {
                                    "FinancialEventGroupId": "CLOSED-USD",
                                    "ProcessingStatus": "Closed",
                                    "OriginalTotal": {
                                        "CurrencyAmount": 900,
                                        "CurrencyCode": "USD",
                                    },
                                },
                                {
                                    "FinancialEventGroupId": "OPEN-CAD",
                                    "ProcessingStatus": "Open",
                                    "OriginalTotal": {
                                        "CurrencyAmount": 40,
                                        "CurrencyCode": "CAD",
                                    },
                                },
                            ],
                            "NextToken": "BALANCE-NEXT",
                        }
                    },
                    amazon_request_id="BALANCE-REQUEST-1",
                    http_status=200,
                    duration_ms=15,
                ),
                SpApiJsonResult(
                    body={
                        "payload": {
                            "FinancialEventGroupList": []
                        }
                    },
                    amazon_request_id="BALANCE-REQUEST-2",
                    http_status=200,
                    duration_ms=10,
                ),
            ],
            [
                SpApiJsonResult(
                    body={
                        "transactions": [
                            {
                                "transactionStatus": "DEFERRED",
                                "totalAmount": self.money(100),
                            },
                            {
                                "transactionStatus": "DEFERRED",
                                "totalAmount": self.money(11.08),
                            },
                            {
                                "transactionStatus": "RELEASED",
                                "totalAmount": self.money(500),
                            },
                        ]
                    },
                    amazon_request_id="DEFERRED-REQUEST",
                    http_status=200,
                    duration_ms=12,
                )
            ]
        )

        result = sync_current_balance(
            self.db,
            account=self.account,
            client=client,
        )
        self.db.commit()

        self.assertEqual(client.group_calls[0][2], None)
        self.assertEqual(client.group_calls[1][2], "BALANCE-NEXT")
        self.assertEqual(
            client.group_calls[0][:2],
            client.group_calls[1][:2],
        )
        self.assertEqual(client.deferred_calls[0][3], "DEFERRED")
        self.assertAlmostEqual(result.available_balance, -0.96)
        self.assertAlmostEqual(result.deferred_balance, 111.08)
        self.assertAlmostEqual(result.total_balance, 110.12)
        self.assertEqual(result.deferred_transaction_count, 2)
        self.assertEqual(result.currency, "USD")
        self.assertEqual(result.open_group_count, 1)
        self.assertEqual(result.pages, 3)
        self.assertAlmostEqual(self.account.current_balance, -0.96)
        self.assertAlmostEqual(self.account.deferred_balance, 111.08)
        self.assertEqual(self.account.deferred_transaction_count, 2)
        self.assertEqual(self.account.current_balance_currency, "USD")
        self.assertEqual(
            self.account.current_balance_event_group_id,
            "OPEN-USD-1",
        )
        self.assertIsNotNone(self.account.current_balance_updated_at)
        self.assertIsNone(self.account.current_balance_error)
        self.assertIsNone(self.account.deferred_balance_error)

    def test_client_uses_financial_event_groups_balance_endpoint(self):
        calls = []
        client = AmazonSpApiClient(self.account)

        def fake_get_json(path, *, params, permission_message):
            calls.append((path, params, permission_message))
            return SpApiJsonResult(
                body={"payload": {"FinancialEventGroupList": []}},
                amazon_request_id="BALANCE-REQUEST",
                http_status=200,
                duration_ms=5,
            )

        client._get_json = fake_get_json
        client.list_financial_event_groups(
            started_after="2026-01-01T00:00:00Z",
            started_before="2026-06-29T00:00:00Z",
        )
        client.list_financial_event_groups(
            started_after="2026-01-01T00:00:00Z",
            started_before="2026-06-29T00:00:00Z",
            next_token="NEXT",
        )

        self.assertEqual(calls[0][0], "/finances/v0/financialEventGroups")
        self.assertEqual(
            calls[0][1],
            {
                "MaxResultsPerPage": 100,
                "FinancialEventGroupStartedAfter": "2026-01-01T00:00:00Z",
                "FinancialEventGroupStartedBefore": "2026-06-29T00:00:00Z",
            },
        )
        self.assertEqual(
            calls[1][1],
            {
                "MaxResultsPerPage": 100,
                "FinancialEventGroupStartedAfter": "2026-01-01T00:00:00Z",
                "FinancialEventGroupStartedBefore": "2026-06-29T00:00:00Z",
                "NextToken": "NEXT",
            },
        )


if __name__ == "__main__":
    unittest.main()
