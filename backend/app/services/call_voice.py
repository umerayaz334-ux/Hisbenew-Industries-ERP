"""Forwards live voice between the two people on a call.

Both sides send 16-bit mono PCM to this process. The office server is on a
public address, so the phones never have to find each other through the network.
"""

import asyncio

from fastapi import WebSocket


class CallVoiceHub:
    def __init__(self) -> None:
        self._rooms: dict[int, dict[int, WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def join(self, call_id: int, user_id: int, websocket: WebSocket) -> int:
        async with self._lock:
            room = self._rooms.setdefault(call_id, {})
            previous = room.get(user_id)
            room[user_id] = websocket
            peers = len(room)
            others = [socket for person_id, socket in room.items() if person_id != user_id]
        if previous is not None and previous is not websocket:
            try:
                await previous.close()
            except Exception:
                pass
        await websocket.send_json({"type": "joined", "peers": peers})
        if peers >= 2:
            await self._send_json(others, {"type": "peer-ready"})
            await websocket.send_json({"type": "peer-ready"})
        return peers

    async def leave(self, call_id: int, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(call_id)
            if not room or room.get(user_id) is not websocket:
                return
            room.pop(user_id, None)
            if not room:
                self._rooms.pop(call_id, None)
            others = list(room.values())
        await self._send_json(others, {"type": "peer-left"})

    async def forward(self, call_id: int, user_id: int, payload: bytes) -> None:
        if not payload or len(payload) > 8000:
            return
        async with self._lock:
            room = self._rooms.get(call_id, {})
            targets = [socket for person_id, socket in room.items() if person_id != user_id]
        dead: list[WebSocket] = []
        for socket in targets:
            try:
                await socket.send_bytes(payload)
            except Exception:
                dead.append(socket)
        if dead:
            async with self._lock:
                room = self._rooms.get(call_id, {})
                for person_id, socket in list(room.items()):
                    if socket in dead:
                        room.pop(person_id, None)
                if room is not None and not room:
                    self._rooms.pop(call_id, None)

    async def _send_json(self, sockets: list[WebSocket], payload: dict) -> None:
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                continue


call_voice_hub = CallVoiceHub()
