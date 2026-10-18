import base64
import hashlib
import hmac
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from app import call_relay


class RelayConfigTests(unittest.TestCase):
    def test_expiring_credentials_and_no_secret_disclosure(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            secret = 'a' * 48
            (folder / '.turn-secret').write_text(secret)
            (folder / '.turn-host').write_text('api.hisbenew.com')
            with patch.object(call_relay, 'APP_DATA_DIR', folder), patch.object(call_relay.time, 'time', return_value=1000):
                servers = call_relay.ice_servers(7)
            self.assertEqual(servers[1]['username'], '87400:7')
            expected = base64.b64encode(hmac.new(secret.encode(), b'87400:7', hashlib.sha1).digest()).decode()
            self.assertEqual(servers[1]['credential'], expected)
            self.assertNotIn(secret, str(servers))

    def test_unconfigured_server_keeps_existing_configuration(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(call_relay, 'APP_DATA_DIR', Path(directory)):
            self.assertEqual(call_relay.ice_servers(7), call_relay.INTERNAL_CALL_ICE_SERVERS)
