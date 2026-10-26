import unittest
from app.customer_email import render_customer_email


class CustomerEmailTests(unittest.TestCase):
    def test_tracking_has_styled_package_tracking_and_account_cards(self):
        settings = {"from_name": "Hisbenew Industries", "from_email": "info@hisbenew.com"}
        context = {"order_no": "LOCAL-1001", "product_name": "Chef Knife Set", "package_details": "24 pieces · Individual boxes · Weight: 8.5 kg",
                   "courier": "DHL", "tracking_number": "1234567890", "currency": "USD", "account_balance": "250.00"}
        html = render_customer_email(settings, "service_taker_tracking", context, "Your tracking update", "Details", "Hello Alex,\n\nYour order has a tracking update.\nCourier: DHL\nThank you,\nHisbenew")
        for item in ("LOCAL-1001", "Chef Knife Set", "1234567890", "background:#173a57", "info@hisbenew.com"):
            self.assertIn(item, html)
        self.assertNotIn("%%", html)
        self.assertNotIn("Order amount due", html)
        self.assertNotIn("TOTAL PENDING BALANCE", html)
        self.assertNotIn("250.00", html)

    def test_reminder_has_no_shipment_and_escapes_customer_content(self):
        html = render_customer_email({"from_name": "<Brand>"}, "service_taker_balance_reminder", {"account_balance": "500.00"}, "Balance reminder", "", "Hello <script>alert(1)</script>")
        self.assertIn("Balance reminder", html)
        self.assertNotIn("TRACKING NUMBER", html)
        self.assertIn("&lt;Brand&gt;", html)
        self.assertNotIn("<script>", html)
