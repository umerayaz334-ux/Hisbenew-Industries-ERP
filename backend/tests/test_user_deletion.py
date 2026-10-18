import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.database import Base
from app.main import delete_user
from app.models import (
    AccountingAccount,
    AccountingTransaction,
    ActivityLog,
    InternalCall,
    InternalCallSignal,
    InternalMessage,
    Tenant,
    User,
    Worker,
    WorkerExpense,
    WorkerPayment,
)


class UserDeletionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.close()

        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add(Tenant(id=1, company_name="Hisbenew", slug="hisbenew"))
        self.worker = Worker(id=7, tenant_id=1, name="Ayesha", role="stitching")
        self.db.add(self.worker)
        self.db.flush()
        self.user = User(id=4, tenant_id=1, username="ayesha", name="Ayesha", role="worker", worker_id=7)
        self.admin = User(id=1, tenant_id=1, username="admin", name="Admin", role="admin")
        self.other = User(id=2, tenant_id=1, username="office", name="Office", role="admin")
        self.db.add_all([self.user, self.admin, self.other])
        account = AccountingAccount(id=1, tenant_id=1, name="Cash")
        self.db.add(account)
        self.db.flush()
        transaction = AccountingTransaction(
            id=9,
            tenant_id=1,
            account_id=1,
            direction="out",
            amount=500,
            source_type="worker_payment",
            source_id=3,
            description="Wage",
        )
        self.db.add(transaction)
        self.db.flush()
        self.db.add(WorkerPayment(id=3, tenant_id=1, worker_id=7, amount=500, accounting_transaction_id=9))
        self.db.add(WorkerExpense(id=8, tenant_id=1, worker_id=7, amount=40, note="Thread", created_by_user_id=4))
        self.db.add(InternalMessage(id=1, tenant_id=1, sender_user_id=4, recipient_user_id=2, body="On the way"))
        self.db.add(InternalMessage(id=2, tenant_id=1, sender_user_id=2, recipient_user_id=4, body="Reply"))
        self.db.add(InternalMessage(id=3, tenant_id=1, sender_user_id=1, recipient_user_id=2, body="Keep this"))
        call = InternalCall(id=5, tenant_id=1, caller_user_id=2, recipient_user_id=4, status="ended")
        self.db.add(call)
        self.db.flush()
        self.db.add(InternalCallSignal(id=6, tenant_id=1, call_id=5, sender_user_id=2, signal_type="offer", payload="{}"))
        self.db.add(ActivityLog(id=11, tenant_id=1, actor_user_id=4, action="opened page", summary="Opened Pay"))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_delete_removes_the_account_and_its_history(self):
        with patch("app.main.require_page_access", return_value=self.admin), patch(
            "app.main.tenant_scope_id_for_request", return_value=1
        ):
            result = delete_user(4, SimpleNamespace(), self.db)
        self.assertEqual(result["status"], "deleted")
        self.assertEqual(result["deleted_worker_id"], 7)
        self.assertIsNone(self.db.get(User, 4))
        self.assertIsNone(self.db.get(Worker, 7))
        self.assertEqual(self.db.query(WorkerPayment).count(), 0)
        self.assertEqual(self.db.query(WorkerExpense).count(), 0)
        self.assertEqual(self.db.query(AccountingTransaction).count(), 0)
        self.assertEqual([row.id for row in self.db.query(InternalMessage).all()], [3])
        self.assertEqual(self.db.query(InternalCall).count(), 0)
        self.assertEqual(self.db.query(InternalCallSignal).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)
        self.assertIsNotNone(self.db.get(User, 2))
        self.assertIsNotNone(self.db.get(AccountingAccount, 1))
