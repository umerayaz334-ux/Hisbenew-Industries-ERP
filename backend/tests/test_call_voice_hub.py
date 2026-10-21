import asyncio
import unittest

from app.services.call_voice import CallVoiceHub


class FakeSocket:
    def __init__(self):
        self.json = []
        self.audio = []

    async def send_json(self, payload):
        self.json.append(payload)

    async def send_bytes(self, payload):
        self.audio.append(payload)

    async def close(self):
        pass


class CallVoiceHubTests(unittest.TestCase):
    def test_voice_frames_are_forwarded_only_to_the_other_call_participant(self):
        async def run():
            hub = CallVoiceHub()
            worker = FakeSocket()
            admin = FakeSocket()
            await hub.join(81, 11, worker)
            await hub.join(81, 12, admin)
            await hub.forward(81, 11, b"voice-frame")
            await hub.forward(81, 11, b"x" * 8001)
            self.assertEqual(admin.audio, [b"voice-frame"])
            self.assertEqual(worker.audio, [])
            self.assertIn({"type": "peer-ready"}, worker.json)
            self.assertIn({"type": "peer-ready"}, admin.json)

        asyncio.run(run())

    def test_leaving_call_removes_only_that_participant_and_notifies_peer(self):
        async def run():
            hub = CallVoiceHub()
            worker = FakeSocket()
            admin = FakeSocket()
            await hub.join(82, 11, worker)
            await hub.join(82, 12, admin)
            await hub.leave(82, 11, worker)
            # A disconnected socket cannot be authenticated or reach forward()
            # in the route; the remaining participant receives no stray data.
            self.assertEqual(admin.audio, [])
            self.assertIn({"type": "peer-left"}, admin.json)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
