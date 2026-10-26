"""Exercise settings storage without starting the application's database jobs."""
import ast
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace, ModuleType
from unittest.mock import Mock, patch
import logging


class TenantEmailSettingsTests(unittest.TestCase):
    def test_connections_are_isolated_and_never_inherit_global_credentials(self):
        source = Path(__file__).parents[1] / "app" / "main.py"
        names = {"json_clone", "deep_merge_dict", "normalize_email_settings", "tenant_email_settings_file",
                 "load_email_settings", "save_email_settings"}
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        constants = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in {"DEFAULT_EMAIL_SETTINGS", "DEFAULT_EMAIL_EVENTS"}
                for target in node.targets
            ):
                constants.append(node)
        nodes = constants + nodes
        with tempfile.TemporaryDirectory() as directory:
            scope = {"Path": Path, "json": json, "APP_DATA_DIR": Path(directory),
                     "EMAIL_SETTINGS_FILE": Path(directory) / "email_settings.json"}
            exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), scope)
            save, load = scope["save_email_settings"], scope["load_email_settings"]
            save({"smtp": {"password": "global-secret"}})
            self.assertEqual(load(1)["smtp"]["password"], "")
            self.assertEqual(load(1)["from_email"], "info@hisbenew.com")
            tracking_template = load(1)["events"]["service_taker_tracking"]["body"]
            self.assertNotIn("{{account_balance}}", tracking_template)
            self.assertNotIn("{{order_balance}}", tracking_template)
            save({"enabled": True, "smtp": {"password": "tenant-one"}}, 1)
            save({"smtp": {"password": "tenant-two"}}, 2)
            self.assertEqual(load(1)["smtp"]["password"], "tenant-one")
            self.assertEqual(load(2)["smtp"]["password"], "tenant-two")
            self.assertEqual(load()["smtp"]["password"], "global-secret")
            self.assertFalse(load(3)["enabled"])

    def test_tracking_recipient_amounts_and_duplicate_suppression(self):
        source = Path(__file__).parents[1] / "app" / "service_takers" / "router.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "notify_local_order_tracking")
        scope = {"__package__": "app.service_takers", "Session": object,
                 "clean_text": lambda value: (value or "").strip(), "logging": logging,
                 "service_taker_account_balance": lambda *_: 250,
                 "manufacturing_balance_due": lambda _: 125}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), scope)
        mail = ModuleType("app.main")
        mail.load_email_settings = Mock(return_value={"enabled": True, "cc": "other@example.com", "events": {"service_taker_tracking": {"enabled": True}}})
        mail.render_email_template = Mock(side_effect=lambda settings, event, context: {
            "subject": "Tracking", "text": f"Tracking: {context['tracking_number']}", "html": "<p>Tracking</p>"})
        mail.send_email_message = Mock()
        client = SimpleNamespace(tenant_id=4, email="client@example.com", contact_name="Buyer", company_name="Buyer Ltd", currency="USD")
        order = SimpleNamespace(id=1, tenant_id=4, service_taker=client, tracking_number="TRACK-1",
                                courier="Courier", request_no="LOCAL-1", product_name="Chef Knife Set",
                                quantity=24, packaging="Individual boxes", shipping_weight_kg=8.5)
        with patch.dict("sys.modules", {"app.main": mail}):
            notify = scope["notify_local_order_tracking"]
            self.assertEqual(notify(None, order, "TRACK-1")["reason"], "tracking_unchanged")
            mail.send_email_message.assert_not_called()
            self.assertEqual(notify(None, order, None)["status"], "sent")
            args = mail.send_email_message.call_args.args
            mail.load_email_settings.assert_called_once_with(4)
            self.assertEqual(args[1], ["client@example.com"])
            self.assertEqual(args[0]["cc"], "")
            self.assertNotIn("125.00", args[3])
            self.assertNotIn("order_balance", mail.render_email_template.call_args.args[2])
            self.assertEqual(mail.render_email_template.call_args.args[2]["product_name"], "Chef Knife Set")
            self.assertEqual(mail.render_email_template.call_args.args[2]["package_details"], "24 pieces · Individual boxes · Weight: 8.5 kg")
            self.assertNotIn("account_balance", mail.render_email_template.call_args.args[2])
            client.tenant_id = 5
            self.assertEqual(notify(None, order, None)["reason"], "no_service_taker_email")
            self.assertEqual(mail.send_email_message.call_count, 1)

    def test_account_balance_matches_ledger_and_applies_confirmed_credit(self):
        source = Path(__file__).parents[1] / "app" / "service_takers" / "router.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "service_taker_account_balance")
        models = {name: type(name, (), {"service_taker_id": 1, "tenant_id": 4}) for name in (
            "ServiceTakerManufacturingOrder", "ServiceTakerOrder", "ServiceTakerShippingRequest")}
        rows = {
            models["ServiceTakerManufacturingOrder"]: [
                SimpleNamespace(status="Confirmed", quote=100, shipping_cost=10, paid=40),
                SimpleNamespace(status="Cancelled", quote=500, shipping_cost=30, paid=20),
                SimpleNamespace(status="Rejected", quote=200, shipping_cost=0, paid=0)],
            models["ServiceTakerOrder"]: [SimpleNamespace(status="Shipped", total=25), SimpleNamespace(status="Cancelled", total=90)],
            models["ServiceTakerShippingRequest"]: [SimpleNamespace(status="Submitted", shipping_cost=15), SimpleNamespace(status="Cancelled", shipping_cost=70)],
        }
        scope = {**models, "Session": object, "ServiceTaker": object,
                 "manufacturing_quote_total": lambda o: o.quote,
                 "manufacturing_paid_total": lambda o: o.paid, "order_total": lambda o: o.total}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), scope)
        db = Mock()
        db.query.side_effect = lambda model: SimpleNamespace(filter=lambda *_: SimpleNamespace(all=lambda: rows[model]))
        client = SimpleNamespace(id=1, tenant_id=4)
        self.assertEqual(scope["service_taker_account_balance"](db, client), 90)
        rows[models["ServiceTakerManufacturingOrder"]][0].paid = 500
        self.assertEqual(scope["service_taker_account_balance"](db, client), 0)

    def test_reminder_rejects_cross_tenant_and_zero_balances(self):
        from fastapi import HTTPException
        source = Path(__file__).parents[1] / "app" / "service_takers" / "router.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "admin_send_balance_reminder")
        node.decorator_list = []
        client = SimpleNamespace(id=7, tenant_id=4, email="client@example.com", contact_name="Buyer", company_name="Buyer Ltd", currency="USD")
        scope = {"__package__": "app.service_takers", "Request": object, "Session": object,
                 "Depends": lambda _: None, "get_db": lambda: None, "HTTPException": HTTPException,
                 "require_admin": lambda *_: SimpleNamespace(id=1, tenant_id=4, username="admin", name="Admin"),
                 "service_taker_by_id": lambda *_: client, "service_taker_account_balance": Mock(return_value=250), "logging": logging}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), scope)
        mail = ModuleType("app.main")
        mail.load_email_settings = Mock(return_value={"enabled": True})
        mail.render_email_template = Mock(return_value={"subject": "Reminder", "text": "Due", "html": "Due"})
        mail.send_email_message, mail.record_activity = Mock(), Mock()
        request = SimpleNamespace(state=SimpleNamespace(tenant_id=4), url=SimpleNamespace(path="/reminder"))
        with patch.dict("sys.modules", {"app.main": mail}):
            send = scope["admin_send_balance_reminder"]
            result = send(7, request, Mock())
            self.assertEqual(result["account_balance_due"], 250)
            self.assertEqual(mail.send_email_message.call_args.args[1], [client.email])
            self.assertEqual(mail.render_email_template.call_args.args[1], "service_taker_balance_reminder")
            mail.send_email_message.reset_mock()
            scope["service_taker_account_balance"].return_value = 0
            with self.assertRaises(HTTPException) as error:
                send(7, request, Mock())
            self.assertEqual(error.exception.status_code, 409)
            request.state.tenant_id = 8
            with self.assertRaises(HTTPException) as error:
                send(7, request, Mock())
            self.assertEqual(error.exception.status_code, 404)
            mail.send_email_message.assert_not_called()


if __name__ == "__main__":
    unittest.main()
