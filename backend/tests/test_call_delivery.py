import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.main import internal_call_delivery_status


class InternalCallDeliveryTests(unittest.TestCase):
    def test_call_shows_calling_until_recipient_checks_it(self):
        created = datetime.now(timezone.utc).replace(tzinfo=None)
        call = SimpleNamespace(
            status="ringing",
            created_at=created,
            recipient_last_seen_at=None,
        )

        self.assertEqual(internal_call_delivery_status(call, created), "calling")
        self.assertEqual(
            internal_call_delivery_status(call, created + timedelta(seconds=7)),
            "unreachable",
        )

    def test_call_shows_ringing_after_recipient_app_checks_it(self):
        created = datetime.now(timezone.utc).replace(tzinfo=None)
        call = SimpleNamespace(
            status="ringing",
            created_at=created,
            recipient_last_seen_at=created + timedelta(milliseconds=1),
        )

        self.assertEqual(
            internal_call_delivery_status(call, created + timedelta(seconds=8)),
            "ringing",
        )


if __name__ == "__main__":
    unittest.main()
