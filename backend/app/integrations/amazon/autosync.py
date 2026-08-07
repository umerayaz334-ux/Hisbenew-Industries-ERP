"""Persistent, non-overlapping automatic Amazon synchronization."""

import asyncio
import contextlib
from datetime import datetime, timedelta

from sqlalchemy import or_

from ...database import SessionLocal
from .constants import CONNECTION_CONNECTED
from .jobs import enqueue_full_amazon_sync_jobs, process_amazon_job
from .models import AmazonAccount, AmazonSyncJob
from .security import sanitize_external_message

AUTO_SYNC_CHECK_SECONDS = 30
AUTO_SYNC_JOB_STATUSES = ("Pending", "Processing", "Retrying")
AUTO_SYNC_RETRY_BATCH_SIZE = 20


def run_due_amazon_retries(
    *,
    maximum_jobs: int = AUTO_SYNC_RETRY_BATCH_SIZE,
) -> int:
    """Claim and process retryable jobs whose backoff period has elapsed."""
    db = SessionLocal()
    claimed_job_ids: list[int] = []
    try:
        now = datetime.utcnow()
        candidate_ids = [
            job_id
            for (job_id,) in (
                db.query(AmazonSyncJob.id)
                .filter(
                    AmazonSyncJob.status == "Retrying",
                    or_(
                        AmazonSyncJob.next_retry_at.is_(None),
                        AmazonSyncJob.next_retry_at <= now,
                    ),
                )
                .order_by(
                    AmazonSyncJob.priority.asc(),
                    AmazonSyncJob.next_retry_at.asc(),
                    AmazonSyncJob.id.asc(),
                )
                .limit(max(1, int(maximum_jobs)))
                .all()
            )
        ]
        for job_id in candidate_ids:
            claimed = (
                db.query(AmazonSyncJob)
                .filter(
                    AmazonSyncJob.id == job_id,
                    AmazonSyncJob.status == "Retrying",
                    or_(
                        AmazonSyncJob.next_retry_at.is_(None),
                        AmazonSyncJob.next_retry_at <= now,
                    ),
                )
                .update(
                    {
                        AmazonSyncJob.status: "Pending",
                        AmazonSyncJob.updated_at: now,
                    },
                    synchronize_session=False,
                )
            )
            if claimed:
                claimed_job_ids.append(job_id)
        db.commit()
    except Exception as exc:
        db.rollback()
        safe_error = sanitize_external_message(str(exc)) or "Amazon retries failed."
        print(f"Amazon retries could not be claimed: {safe_error}")
        return 0
    finally:
        db.close()

    for job_id in claimed_job_ids:
        process_amazon_job(job_id)
    return len(claimed_job_ids)


def run_due_amazon_auto_sync() -> bool:
    """Run a due full sync and return whether a new cycle was started."""
    db = SessionLocal()
    account_id = None
    created_job_ids: list[int] = []
    try:
        account = (
            db.query(AmazonAccount)
            .filter(
                AmazonAccount.auto_sync_enabled == True,
                AmazonAccount.is_active == True,
                AmazonAccount.connection_status == CONNECTION_CONNECTED,
            )
            .order_by(AmazonAccount.id.asc())
            .first()
        )
        if not account:
            return False

        account_id = account.id
        now = datetime.utcnow()
        interval_minutes = max(
            5, min(60, int(account.auto_sync_interval_minutes or 15))
        )
        due_at = (
            account.auto_sync_last_started_at
            + timedelta(minutes=interval_minutes)
            if account.auto_sync_last_started_at
            else now
        )
        if now < due_at:
            return False

        active_job = (
            db.query(AmazonSyncJob.id)
            .filter(
                AmazonSyncJob.amazon_account_id == account.id,
                AmazonSyncJob.status.in_(AUTO_SYNC_JOB_STATUSES),
            )
            .first()
        )
        if active_job:
            return False

        jobs, created_ids = enqueue_full_amazon_sync_jobs(db, account=account)
        if not created_ids:
            return False

        created_job_ids = [job.id for job in jobs if job.id in created_ids]
        account.auto_sync_last_started_at = now
        account.auto_sync_last_error = None
        account.updated_at = now
        db.commit()
    except Exception as exc:
        db.rollback()
        safe_error = sanitize_external_message(str(exc)) or "Automatic sync failed."
        if account_id:
            account = db.query(AmazonAccount).filter(
                AmazonAccount.id == account_id
            ).first()
            if account:
                account.auto_sync_last_error = safe_error
                account.updated_at = datetime.utcnow()
                db.commit()
        print(f"Amazon auto sync could not be queued: {safe_error}")
        return False
    finally:
        db.close()

    for job_id in created_job_ids:
        process_amazon_job(job_id)

    db = SessionLocal()
    try:
        account = db.query(AmazonAccount).filter(
            AmazonAccount.id == account_id
        ).first()
        jobs = db.query(AmazonSyncJob).filter(
            AmazonSyncJob.id.in_(created_job_ids)
        ).all()
        unfinished = [job for job in jobs if job.status != "Completed"]
        finished_at = datetime.utcnow()
        if account:
            account.auto_sync_last_finished_at = finished_at
            account.auto_sync_last_error = (
                f"{len(unfinished)} Amazon sync area"
                f"{'' if len(unfinished) == 1 else 's'} require attention."
                if unfinished
                else None
            )
            account.updated_at = finished_at
            db.commit()
    finally:
        db.close()
    return True


class AmazonAutoSyncService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if not self._task:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def _run(self) -> None:
        await asyncio.sleep(10)
        while True:
            try:
                await asyncio.to_thread(run_due_amazon_retries)
                await asyncio.to_thread(run_due_amazon_auto_sync)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                safe_error = (
                    sanitize_external_message(str(exc))
                    or "Automatic sync failed."
                )
                print(f"Amazon auto sync recovered from an error: {safe_error}")
            await asyncio.sleep(AUTO_SYNC_CHECK_SECONDS)


amazon_auto_sync_service = AmazonAutoSyncService()
