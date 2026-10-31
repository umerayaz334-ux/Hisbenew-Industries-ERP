"""Check test-email diagnostics without starting database or background jobs."""
import ast
from pathlib import Path
import smtplib
import socket
import ssl
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parsedate_to_datetime
from html import escape as html_escape


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail


class EmailTestErrors(unittest.TestCase):
    def test_smtp_message_has_valid_traceable_headers_and_alternatives(self):
        source = Path(__file__).parents[1] / "app" / "main.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                    and n.name == "send_email_message")
        settings = dict(from_email="info@hisbenew.com", from_name="Hisbenew, Industries",
                        provider="smtp", smtp=dict(host="s11.hosterpk.com", port=587,
                        use_ssl=False, use_tls=True, username="info@hisbenew.com", password="test"))
        transport = Mock()
        server = transport.SMTP.return_value.__enter__ = Mock(return_value=Mock())
        transport.SMTP.return_value.__exit__ = Mock(return_value=False)
        scope = dict(normalize_email_settings=lambda _: settings,
                     parse_email_list=lambda value: value if isinstance(value, list) else [],
                     EmailMessage=EmailMessage, formataddr=formataddr, formatdate=formatdate,
                     make_msgid=make_msgid, smtplib=transport, ssl=ssl,
                     html_from_plain_text=html_escape, HTTPException=HTTPException)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), scope)
        scope["send_email_message"](settings, ["test@example.com"], "Test", "Plain", "<p>HTML</p>")
        message = server.return_value.send_message.call_args.args[0]
        self.assertEqual(message["From"].addresses[0].display_name, "Hisbenew, Industries")
        self.assertIsNotNone(parsedate_to_datetime(message["Date"]))
        self.assertTrue(str(message["Message-ID"]).endswith("@hisbenew.com>"))
        self.assertEqual(message.get_body(preferencelist=("plain",)).get_content().strip(), "Plain")
        self.assertIn("<p>HTML</p>", message.get_body(preferencelist=("html",)).get_content())
        server.return_value.starttls.assert_called_once()

    def setUp(self):
        source = Path(__file__).parents[1] / "app" / "main.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                    and n.name == "send_admin_test_email")
        node.decorator_list = []
        self.send = Mock(return_value={"sent": 1})
        self.activity = Mock()
        scope = dict(EmailTestRequest=object, Request=object, Session=object,
                     Depends=lambda _: None, get_db=lambda: None,
                     require_admin_user=lambda *_: SimpleNamespace(tenant_id=1, id=1, username="admin"),
                     load_email_settings=lambda _: {}, sample_email_context=lambda *_: {},
                     render_email_template=lambda *_: dict(subject="Test", text="Test", html="Test"),
                     send_email_message=self.send, record_activity=self.activity,
                     HTTPException=HTTPException, smtplib=smtplib, ssl=ssl, socket=socket)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), scope)
        self.endpoint = scope["send_admin_test_email"]
        self.payload = SimpleNamespace(recipient="test@example.com", event_key="test", context={})
        self.request = SimpleNamespace(state=SimpleNamespace(tenant_id=1))

    def test_failures_are_actionable_and_hide_server_secrets(self):
        cases = [
            (smtplib.SMTPAuthenticationError(535, b"secret"), 502, "login"),
            (ssl.SSLError("secret"), 502, "secure"),
            (TimeoutError("secret"), 504, "timed out"),
            (smtplib.SMTPRecipientsRefused({}), 502, "recipient"),
            (smtplib.SMTPSenderRefused(550, b"secret", "sender"), 502, "sender"),
            (smtplib.SMTPException("secret"), 502, "permissions"),
            (OSError("secret"), 502, "connect"),
        ]
        for error, status, phrase in cases:
            with self.subTest(error=type(error).__name__):
                self.send.side_effect = error
                with self.assertRaises(HTTPException) as caught:
                    self.endpoint(self.payload, self.request, None)
                self.assertEqual(caught.exception.status_code, status)
                self.assertIn(phrase, caught.exception.detail)
                self.assertNotIn("secret", caught.exception.detail)
        self.activity.assert_not_called()

    def test_success_is_recorded(self):
        result = self.endpoint(self.payload, self.request, None)
        self.assertEqual(result, {"status": "sent", "sent": 1})
        self.activity.assert_called_once()

    def test_validation_errors_are_preserved(self):
        error = HTTPException(400, "From email is required.")
        self.send.side_effect = error
        with self.assertRaises(HTTPException) as caught:
            self.endpoint(self.payload, self.request, None)
        self.assertIs(caught.exception, error)


if __name__ == "__main__":
    unittest.main()
