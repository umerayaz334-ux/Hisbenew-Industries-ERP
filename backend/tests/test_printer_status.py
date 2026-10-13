import asyncio
import importlib.util
import json
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from app.routers import print_agent_router as router


class PrinterStatusTests(unittest.TestCase):
    def test_empty_heartbeat_clears_saved_and_cached_printers(self):
        record = SimpleNamespace(security_token='test', printers_json='[{"name":"USB","is_connected":true}]')
        db = Mock()
        db.query.return_value.filter.return_value.first.return_value = record
        with patch.dict(router.connected_agents, {'test': {'status': {'printers': [{'name': 'USB'}]}}}, clear=True):
            router.printer_agent_heartbeat(router.AgentHeartbeatPayload(agent_id='test', security_token='test', printers=[]), db)
            self.assertEqual(json.loads(record.printers_json), [])
            self.assertEqual(router.connected_agents['test']['status']['printers'], [])
            db.commit.assert_called_once()

    def test_online_agent_can_report_disconnected_usb(self):
        agent = {'name': 'test', 'websocket': object(), 'last_seen': datetime.utcnow(),
                 'status': {'printers': [{'name': 'USB', 'is_connected': False}]}}
        with patch.dict(router.connected_agents, {'test': agent}, clear=True):
            result = asyncio.run(router.get_print_agent_printers(Mock()))
            self.assertTrue(result['agent_online'])
            self.assertFalse(result['printers'][0]['is_connected'])
            agent['last_seen'] = datetime.utcnow() - timedelta(seconds=60)
            agent['status']['printers'][0]['is_connected'] = True
            result = asyncio.run(router.get_print_agent_printers(Mock()))
            self.assertFalse(result['agent_online'])
            self.assertFalse(result['printers'][0]['is_connected'])

    def test_agent_pushes_plug_and_unplug_over_websocket(self):
        directory = Path(__file__).resolve().parents[2] / 'print-agent'
        sys.path.insert(0, str(directory))
        try:
            spec = importlib.util.spec_from_file_location('test_printer_agent_module', directory / 'printer_agent.py')
            agent = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(agent)
        finally:
            sys.path.remove(str(directory))
        states = [{'connected': value, 'printers': [{'name': 'USB', 'is_connected': value}]} for value in (True, False)]
        ws = Mock()
        class StopLoop(BaseException):
            pass
        with patch.object(agent, 'active_websocket', ws), patch.object(agent, 'read_printer_status', side_effect=states), patch.object(agent.time, 'sleep', side_effect=[None, StopLoop()]):
            with self.assertRaises(StopLoop):
                agent.heartbeat_loop({'security_token': ''})
        messages = [json.loads(call.args[0]) for call in ws.send.call_args_list]
        self.assertEqual([message['status']['connected'] for message in messages], [True, False])
