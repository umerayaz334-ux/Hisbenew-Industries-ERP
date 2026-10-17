import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import main
from app.database import Base
from app.models import Tenant, User, InternalMessage, Worker, WorkerExpense
from app.schemas import WorkerExpenseCreate


class MobileDataTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine, tables=[Tenant.__table__, User.__table__, Worker.__table__, WorkerExpense.__table__, InternalMessage.__table__])
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


if __name__ == '__main__':
    unittest.main()
