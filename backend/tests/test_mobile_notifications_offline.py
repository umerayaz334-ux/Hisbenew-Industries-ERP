import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app import main
from app.database import Base
from app.models import Tenant, User, InternalMessage, Worker, WorkerExpense, Product, Customer, Order, OrderItem
from app.schemas import WorkerExpenseCreate


class MobileDataTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine, tables=[Tenant.__table__, User.__table__, Worker.__table__, WorkerExpense.__table__, InternalMessage.__table__, Product.__table__, Customer.__table__, Order.__table__, OrderItem.__table__])
        self.db = Session(self.engine)
        self.worker = Worker(id=1, tenant_id=1, name='Worker', role='worker')
        self.user = User(id=1, tenant_id=1, username='worker', name='Worker', role='worker', worker_id=1)
        self.db.add_all([self.worker, self.user, User(id=2, tenant_id=1, username='admin', name='Admin', role='admin'),
                         User(id=3, tenant_id=2, username='other', name='Other', role='admin')])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_notification_preview_only_returns_incoming_unread_messages(self):
        self.db.add_all([
            InternalMessage(id=1, tenant_id=1, sender_user_id=2, recipient_user_id=1, body='Unread preview'),
            InternalMessage(id=2, tenant_id=1, sender_user_id=1, recipient_user_id=2, body='Outgoing'),
            InternalMessage(id=3, tenant_id=2, sender_user_id=3, recipient_user_id=1, body='Other tenant'),
        ])
        self.db.commit()
        with patch.object(main, 'get_authenticated_user', return_value=self.user), patch.object(main, 'tenant_scope_id_for_request', return_value=1):
            rows = main.get_internal_message_users(SimpleNamespace(), self.db)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].unread_message_preview, 'Unread preview')
        self.assertEqual(rows[0].unread_message_id, 1)
        self.assertIsNone(self.db.get(InternalMessage, 1).read_at)

    def test_summaries_bound_previews_and_use_two_queries(self):
        from app.messenger_queries import conversation_summaries
        self.db.add_all([InternalMessage(id=index, tenant_id=1, sender_user_id=2, recipient_user_id=1, body=f'Message {index}') for index in range(1, 9)])
        self.db.add(InternalMessage(id=9, tenant_id=2, sender_user_id=3, recipient_user_id=1, body='Other company'))
        self.db.commit()
        statements = []
        def record(_connection, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)
        event.listen(self.engine, 'before_cursor_execute', record)
        try:
            counts, activity, previews = conversation_summaries(self.db, 1, 1, list(range(2, 40)))
        finally:
            event.remove(self.engine, 'before_cursor_execute', record)
        self.assertEqual(len(statements), 2)
        self.assertEqual(counts, {2: 8})
        self.assertEqual([item.id for item in previews[2]], [8, 7, 6, 5, 4])
        self.assertEqual(set(activity), {2})

    def test_spending_retries_create_one_record_and_reject_changed_payload(self):
        payload = WorkerExpenseCreate(amount=100, note='Fuel', spent_at=datetime(2026, 10, 17), client_request_id='repeat-id')
        with patch.object(main, 'get_authenticated_user', return_value=self.user):
            first = main.create_worker_expense(payload, SimpleNamespace(), self.db)
            second = main.create_worker_expense(payload, SimpleNamespace(), self.db)
            self.assertEqual(first['id'], second['id'])
            self.assertEqual(self.db.query(WorkerExpense).count(), 1)
            with self.assertRaises(HTTPException) as error:
                main.create_worker_expense(payload.model_copy(update={'amount': 200}), SimpleNamespace(), self.db)
            self.assertEqual(error.exception.status_code, 409)

    def test_manufacturing_aggregates_pending_demand_against_stock_once(self):
        product = Product(id=1, tenant_id=1, article_no='A', name='Chair', factory_stock=5, usa_stock=1, reserved_stock=6)
        self.db.add(product)
        for ident, qty, status, shipping, tenant in [(1, 4, 'New', 'Pending', 1), (2, 5, 'New', 'Pending', 1), (3, 20, 'Cancelled', 'Pending', 1), (4, 20, 'New', 'Shipped', 1), (5, 20, 'New', 'Pending', 2)]:
            order = Order(id=ident, tenant_id=tenant, customer_id=1, order_no=str(ident), status=status, shipping_status=shipping)
            order.items.append(OrderItem(tenant_id=tenant, product=product, quantity=qty))
            self.db.add(order)
        self.db.commit()
        with patch.object(main, 'require_page_access', return_value=self.user) as access:
            rows = main.manufacturing_dispatch_needs(SimpleNamespace(state=SimpleNamespace(tenant_id=1)), self.db)
        access.assert_called_once()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['required_quantity'], 9)
        self.assertEqual(rows[0]['available_stock'], 6)
        self.assertEqual(rows[0]['shortage'], 3)
        self.assertEqual(len(rows[0]['orders']), 2)


if __name__ == '__main__':
    unittest.main()
