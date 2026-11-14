import unittest
from unittest import mock

from fastapi import HTTPException

from app.services.shipping import easypost


def rate(rate_id, price, days):
    return {"id": rate_id, "carrier": "USPS", "service": "X", "rate": price, "delivery_days": days, "currency": "USD"}


class EasyPostServiceTests(unittest.TestCase):
    def test_rates_are_sorted_and_tagged(self):
        rates = easypost._tag_rates([rate("a", 20, 1), rate("b", 5, 5), rate("c", 8, 2)])
        self.assertEqual([item["id"] for item in rates], ["b", "c", "a"])
        self.assertIn("cheapest", rates[0]["tags"])
        self.assertIn("fastest", rates[2]["tags"])
        self.assertIn("best_value", rates[1]["tags"])

    def test_clean_address_defaults_country_and_drops_blanks(self):
        address = easypost._clean_address({"street1": " 1 Main St ", "city": "Austin", "zip": "", "bogus": "x"})
        self.assertEqual(address, {"street1": "1 Main St", "city": "Austin", "country": "US"})

    def test_rate_out_handles_missing_days(self):
        out = easypost._rate_out({"id": "rate_1", "rate": "6.47", "delivery_days": None, "est_delivery_days": 3})
        self.assertEqual(out["rate"], 6.47)
        self.assertEqual(out["delivery_days"], 3)

    def test_rejected_api_key_is_reported_clearly(self):
        response = mock.Mock(status_code=401, json=lambda: {"error": {"message": "Unauthorized"}})
        with mock.patch.object(easypost.requests, "request", return_value=response):
            with self.assertRaises(HTTPException) as caught:
                easypost._call("GET", "/addresses", "EZTKbad")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("API key", caught.exception.detail)

    def test_carrier_field_errors_are_included(self):
        payload = {"error": {"message": "Invalid", "errors": [{"field": "zip", "message": "is required"}]}}
        self.assertEqual(easypost._error_message(payload, 422), "Invalid zip: is required")


if __name__ == "__main__":
    unittest.main()
