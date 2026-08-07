import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.integrations.amazon.accounts import (
    public_amazon_settings,
    update_amazon_account,
)
from app.integrations.amazon.client import ConnectionTestResult
from app.integrations.amazon.constants import (
    CONNECTION_CONNECTED,
    CONNECTION_NOT_CONNECTED,
    JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
    JOB_TYPE_FBA_INVENTORY_SYNC,
    JOB_TYPE_FBA_ORDERS_SYNC,
    JOB_TYPE_FINANCE_BALANCE_SYNC,
    JOB_TYPE_FINANCES_SYNC,
    JOB_TYPE_LISTINGS_IMPORT,
)
from app.integrations.amazon.exceptions import AmazonAuthorizationError
from app.integrations.amazon.models import (
    AmazonAccount,
    AmazonApiLog,
    AmazonSyncJob,
)
from app.integrations.amazon.router import (
    clear_credentials,
    require_amazon_admin,
    sync_all_amazon_data,
    test_connection as run_connection_test,
)
from app.integrations.amazon.schemas import (
    AmazonSettingsUpdate,
    ConfirmAmazonAction,
)
from app.integrations.amazon.security import CredentialCipher
from app.models import ActivityLog, User


class AmazonPhase1Tests(unittest.TestCase):
    def setUp(self):
        self.original_key = os.environ.get("AMAZON_CREDENTIALS_ENCRYPTION_KEY")
        self.key = Fernet.generate_key().decode("ascii")
        os.environ["AMAZON_CREDENTIALS_ENCRYPTION_KEY"] = self.key
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[
                User.__table__,
                ActivityLog.__table__,
                AmazonAccount.__table__,
                AmazonSyncJob.__table__,
                AmazonApiLog.__table__,
            ],
        )
        session_factory = sessionmaker(bind=self.engine)
        self.db = session_factory()
        self.admin = User(
            name="Admin",
            username="admin",
            pin="unused",
            role="admin",
            is_active=True,
        )
        self.manager = User(
            name="Manager",
            username="manager",
            pin="unused",
            role="manager",
            is_active=True,
        )
        self.db.add_all([self.admin, self.manager])
        self.db.commit()
        self.db.refresh(self.admin)
        self.db.refresh(self.manager)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if self.original_key is None:
            os.environ.pop("AMAZON_CREDENTIALS_ENCRYPTION_KEY", None)
        else:
            os.environ[
                "AMAZON_CREDENTIALS_ENCRYPTION_KEY"
            ] = self.original_key

    def full_payload(self, **overrides):
        data = {
            "account_name": "Hisbenew Amazon USA",
            "client_identifier": "amzn1.application-oa2-client.test-client",
            "client_secret": "test-client-secret-keep-private",
            "app_id": "amzn1.sp.solution.test-app",
            "refresh_token": "Atzr|test-refresh-token-keep-private",
            "seller_id": "A1TESTSELLER123",
            "marketplace_id": "ATVPDKIKX0DER",
            "region": "NA",
            "endpoint": "https://sellingpartnerapi-na.amazon.com",
            "currency": "USD",
            "is_active": True,
        }
        data.update(overrides)
        return AmazonSettingsUpdate(**data)

    def create_account(self):
        account, _, _ = update_amazon_account(
            self.db,
            payload=self.full_payload(),
            user=self.admin,
        )
        self.db.commit()
        self.db.refresh(account)
        return account

    def test_credentials_are_encrypted_and_never_returned(self):
        payload = self.full_payload()
        account, credential_fields, created = update_amazon_account(
            self.db,
            payload=payload,
            user=self.admin,
        )
        self.db.commit()

        self.assertTrue(created)
        self.assertIn("client_secret", credential_fields)
        self.assertNotEqual(
            account.encrypted_lwa_client_secret,
            payload.client_secret,
        )
        self.assertNotEqual(
            account.encrypted_refresh_token,
            payload.refresh_token,
        )
        cipher = CredentialCipher(self.key)
        self.assertEqual(
            cipher.decrypt(account.encrypted_lwa_client_secret),
            payload.client_secret,
        )
        self.assertEqual(
            cipher.decrypt(account.encrypted_refresh_token),
            payload.refresh_token,
        )

        response_json = public_amazon_settings(account).model_dump_json()
        self.assertNotIn(payload.client_secret, response_json)
        self.assertNotIn(payload.refresh_token, response_json)
        self.assertNotIn(payload.seller_id, response_json)
        self.assertTrue(json.loads(response_json)["client_secret_saved"])

        audit_json = "\n".join(
            log.detail or ""
            for log in self.db.query(ActivityLog).all()
        )
        self.assertNotIn(payload.client_secret, audit_json)
        self.assertNotIn(payload.refresh_token, audit_json)
        self.assertNotIn(payload.seller_id, audit_json)

    def test_blank_credential_fields_preserve_saved_values(self):
        account = self.create_account()
        original_secret = account.encrypted_lwa_client_secret
        original_refresh = account.encrypted_refresh_token

        updated, credential_fields, _ = update_amazon_account(
            self.db,
            payload=self.full_payload(
                account_name="Renamed Amazon account",
                client_identifier="",
                client_secret="",
                app_id="",
                refresh_token="",
                seller_id="",
            ),
            user=self.admin,
        )
        self.db.commit()

        self.assertEqual(updated.encrypted_lwa_client_secret, original_secret)
        self.assertEqual(updated.encrypted_refresh_token, original_refresh)
        self.assertEqual(credential_fields, [])
        self.assertEqual(updated.connection_status, CONNECTION_NOT_CONNECTED)

    def test_non_admin_is_rejected_by_settings_dependency(self):
        request = SimpleNamespace(
            state=SimpleNamespace(user_id=self.manager.id)
        )
        with self.assertRaises(HTTPException) as context:
            require_amazon_admin(request, self.db)
        self.assertEqual(context.exception.status_code, 403)

    def test_successful_connection_records_status_api_log_and_audit(self):
        account = self.create_account()
        result = ConnectionTestResult(
            marketplace_ids=("ATVPDKIKX0DER",),
            amazon_request_id="TEST-REQUEST-ID",
            http_status=200,
            duration_ms=25,
        )

        with patch(
            "app.integrations.amazon.router.AmazonSpApiClient.test_connection",
            return_value=result,
        ):
            response = run_connection_test(db=self.db, user=self.admin)

        self.assertEqual(response.connection_status, CONNECTION_CONNECTED)
        self.db.refresh(account)
        self.assertEqual(account.connection_status, CONNECTION_CONNECTED)
        api_log = self.db.query(AmazonApiLog).one()
        self.assertTrue(api_log.success)
        self.assertEqual(api_log.amazon_request_id, "TEST-REQUEST-ID")
        self.assertTrue(
            self.db.query(ActivityLog)
            .filter(ActivityLog.action == "amazon connection tested")
            .count()
        )

    def test_failed_connection_is_sanitized(self):
        account = self.create_account()
        unsafe_error = AmazonAuthorizationError(
            "Authorization: Bearer Atza|TOPSECRET refresh_token=Atzr|TOPSECRET",
            error_code="invalid_grant",
            http_status=401,
        )

        with patch(
            "app.integrations.amazon.router.AmazonSpApiClient.test_connection",
            side_effect=unsafe_error,
        ):
            with self.assertRaises(HTTPException) as context:
                run_connection_test(db=self.db, user=self.admin)

        self.assertEqual(context.exception.status_code, 401)
        self.db.refresh(account)
        serialized = json.dumps(
            {
                "error": account.sanitized_last_error,
                "api_log": self.db.query(AmazonApiLog).one().error_message,
                "audits": [
                    log.detail
                    for log in self.db.query(ActivityLog).all()
                ],
            }
        )
        self.assertNotIn("TOPSECRET", serialized)
        self.assertNotIn("Atza|", serialized)
        self.assertNotIn("Atzr|", serialized)

    def test_clear_credentials_requires_confirmation_and_preserves_account(self):
        account = self.create_account()
        with self.assertRaises(HTTPException) as context:
            clear_credentials(
                ConfirmAmazonAction(confirm=False),
                db=self.db,
                user=self.admin,
            )
        self.assertEqual(context.exception.status_code, 400)

        response = clear_credentials(
            ConfirmAmazonAction(confirm=True),
            db=self.db,
            user=self.admin,
        )
        self.assertEqual(response.id, account.id)
        self.assertFalse(response.client_secret_saved)
        self.assertFalse(response.refresh_token_saved)
        self.assertFalse(response.is_active)
        self.assertIsNotNone(
            self.db.query(AmazonAccount)
            .filter(AmazonAccount.id == account.id)
            .first()
        )

    def test_sync_all_queues_each_workspace_once(self):
        account = self.create_account()
        account.connection_status = CONNECTION_CONNECTED
        self.db.commit()
        background_tasks = BackgroundTasks()

        response = sync_all_amazon_data(
            background_tasks=background_tasks,
            db=self.db,
            user=self.admin,
        )

        expected_types = {
            JOB_TYPE_LISTINGS_IMPORT,
            JOB_TYPE_FBA_INVENTORY_SYNC,
            JOB_TYPE_FBA_ORDERS_SYNC,
            JOB_TYPE_FBA_INBOUND_PLANS_SYNC,
            JOB_TYPE_FINANCES_SYNC,
            JOB_TYPE_FINANCE_BALANCE_SYNC,
        }
        self.assertEqual(response.queued_count, 6)
        self.assertEqual(response.already_running_count, 0)
        self.assertEqual({job.job_type for job in response.jobs}, expected_types)
        self.assertEqual(len(background_tasks.tasks), 6)
        self.assertEqual(self.db.query(AmazonSyncJob).count(), 6)

        duplicate_response = sync_all_amazon_data(
            background_tasks=BackgroundTasks(),
            db=self.db,
            user=self.admin,
        )
        self.assertEqual(duplicate_response.queued_count, 0)
        self.assertEqual(duplicate_response.already_running_count, 6)
        self.assertEqual(self.db.query(AmazonSyncJob).count(), 6)


if __name__ == "__main__":
    unittest.main()
