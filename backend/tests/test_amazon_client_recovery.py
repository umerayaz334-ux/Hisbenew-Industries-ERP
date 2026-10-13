import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import requests

from app.integrations.amazon.client import AmazonSpApiClient
from app.integrations.amazon.exceptions import AmazonPermissionError


def response(status):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps(
        {"errors": [{"code": "Unauthorized"}]} if status == 403 else {}
    ).encode()
    return result


class AmazonClientRecoveryTests(unittest.TestCase):
    def test_forbidden_token_is_refreshed_before_retry(self):
        client = AmazonSpApiClient(SimpleNamespace(endpoint="https://example.com"))
        with (
            patch("app.integrations.amazon.client.get_lwa_access_token",
                  return_value=SimpleNamespace(value="test")) as token,
            patch("app.integrations.amazon.client.requests.request",
                  side_effect=[response(403), response(200)]) as request,
        ):
            self.assertEqual(client._request("GET", "/orders").status_code, 200)
        self.assertEqual(request.call_count, 2)
        self.assertEqual([call.kwargs["force_refresh"] for call in token.call_args_list],
                         [False, True])

    def test_persistent_forbidden_still_reports_permissions(self):
        client = AmazonSpApiClient(SimpleNamespace(endpoint="https://example.com"))
        with (
            patch("app.integrations.amazon.client.get_lwa_access_token",
                  return_value=SimpleNamespace(value="test")),
            patch("app.integrations.amazon.client.requests.request",
                  side_effect=[response(403), response(403)]) as request,
        ):
            with self.assertRaises(AmazonPermissionError):
                client._request("GET", "/orders")
        self.assertEqual(request.call_count, 2)
