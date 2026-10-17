import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app import main
from app.models import User, Tenant, InternalCall
from app.schemas import InternalCallAction


class DirectMessagingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine, tables=[Tenant.__table__, User.__table__])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id=1, tenant_id=1, name='Worker', role='worker'),
            User(id=2, tenant_id=1, name='Admin', role='admin'),
            User(id=3, tenant_id=2, name='Other company', role='admin'),
            User(id=4, tenant_id=1, name='Visitor', role='visitor'),
            User(id=5, tenant_id=1, name='Disabled', role='worker', is_active=False),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_new_coworkers_are_visible_without_requests_or_message_history(self):
        self.assertEqual(main.messenger_visible_contact_ids(self.db, 1, 1), {2})
        self.assertTrue(main.messenger_contact_allowed(self.db, 1, 2, 1))

    def test_direct_chat_preserves_company_active_and_visitor_boundaries(self):
        for recipient in [1, 3, 4, 5]:
            self.assertFalse(main.messenger_contact_allowed(self.db, 1, recipient, 1))


class CallResponseTests(unittest.TestCase):
    def test_duplicate_answer_and_decline_are_idempotent(self):
        for action, status in [('accept', 'accepted'), ('decline', 'declined')]:
            call = SimpleNamespace(recipient_user_id=2, status=status)
            with patch.object(main, 'get_authenticated_user', return_value=SimpleNamespace(id=2)), \
                 patch.object(main, 'get_internal_call_for_user', return_value=call), \
                 patch.object(main, 'internal_call_response', return_value={'status': status}):
                self.assertEqual(main.respond_to_internal_call(7, InternalCallAction(action=action), None, None), {'status': status})

    def test_caller_cannot_accept_on_behalf_of_recipient(self):
        call = SimpleNamespace(recipient_user_id=2, status='accepted')
        with patch.object(main, 'get_authenticated_user', return_value=SimpleNamespace(id=1)), \
             patch.object(main, 'get_internal_call_for_user', return_value=call):
            with self.assertRaises(HTTPException) as error:
                main.respond_to_internal_call(7, InternalCallAction(action='accept'), None, None)
            self.assertEqual(error.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
