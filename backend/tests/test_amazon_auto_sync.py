import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.integrations.amazon.autosync import (
    run_due_amazon_auto_sync,
    run_due_amazon_retries,
)
from app.integrations.amazon.models import AmazonAccount, AmazonSyncJob
from app.models import User


class AmazonAutoSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(
            self.engine,
            tables=[
                User.__table__,
                AmazonAccount.__table__,
                AmazonSyncJob.__table__,
            ],
        )
        self.session_factory = sessionmaker(bind=self.engine)
        db = self.session_factory()
        db.add(
            AmazonAccount(
                account_name="Hisbenew Amazon",
                marketplace_id="ATVPDKIKX0DER",
                region="NA",
                endpoint="https://sellingpartnerapi-na.amazon.com",
                currency="USD",
                is_active=True,
                connection_status="Connected",
                auto_sync_enabled=True,
                auto_sync_interval_minutes=15,
            )
        )
        db.commit()
        db.close()

    def tearDown(self):
        self.engine.dispose()

    def test_due_cycle_queues_once_and_records_completion(self):
        def complete_job(job_id):
            db = self.session_factory()
            job = db.query(AmazonSyncJob).filter(
                AmazonSyncJob.id == job_id
            ).one()
            job.status = "Completed"
            db.commit()
            db.close()

        with (
            patch(
                "app.integrations.amazon.autosync.SessionLocal",
                self.session_factory,
            ),
            patch(
                "app.integrations.amazon.autosync.process_amazon_job",
                side_effect=complete_job,
            ) as process_job,
        ):
            self.assertTrue(run_due_amazon_auto_sync())
            self.assertFalse(run_due_amazon_auto_sync())

        db = self.session_factory()
        account = db.query(AmazonAccount).one()
        jobs = db.query(AmazonSyncJob).all()
        self.assertEqual(len(jobs), 6)
        self.assertEqual(process_job.call_count, 6)
        self.assertIsNotNone(account.auto_sync_last_started_at)
        self.assertIsNotNone(account.auto_sync_last_finished_at)
        self.assertIsNone(account.auto_sync_last_error)
        db.close()

    def test_due_retries_are_claimed_and_processed(self):
        db = self.session_factory()
        account = db.query(AmazonAccount).one()
        now = datetime.utcnow()
        due_job = AmazonSyncJob(
            amazon_account_id=account.id,
            job_type="Listings Import",
            status="Retrying",
            priority=10,
            attempt_count=1,
            maximum_attempts=5,
            scheduled_at=now - timedelta(minutes=2),
            next_retry_at=now - timedelta(minutes=1),
        )
        future_job = AmazonSyncJob(
            amazon_account_id=account.id,
            job_type="Finances Sync",
            status="Retrying",
            priority=20,
            attempt_count=1,
            maximum_attempts=5,
            scheduled_at=now,
            next_retry_at=now + timedelta(minutes=5),
        )
        db.add_all([due_job, future_job])
        db.commit()
        due_job_id = due_job.id
        future_job_id = future_job.id
        db.close()

        def complete_job(job_id):
            job_db = self.session_factory()
            job = job_db.query(AmazonSyncJob).filter(
                AmazonSyncJob.id == job_id
            ).one()
            self.assertEqual(job.status, "Pending")
            job.status = "Completed"
            job_db.commit()
            job_db.close()

        with (
            patch(
                "app.integrations.amazon.autosync.SessionLocal",
                self.session_factory,
            ),
            patch(
                "app.integrations.amazon.autosync.process_amazon_job",
                side_effect=complete_job,
            ) as process_job,
        ):
            self.assertEqual(run_due_amazon_retries(), 1)

        process_job.assert_called_once_with(due_job_id)
        db = self.session_factory()
        self.assertEqual(
            db.query(AmazonSyncJob).filter(
                AmazonSyncJob.id == due_job_id
            ).one().status,
            "Completed",
        )
        self.assertEqual(
            db.query(AmazonSyncJob).filter(
                AmazonSyncJob.id == future_job_id
            ).one().status,
            "Retrying",
        )
        db.close()


if __name__ == "__main__":
    unittest.main()
