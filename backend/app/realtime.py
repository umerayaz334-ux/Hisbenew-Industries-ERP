import asyncio
import contextlib
import json
import uuid
from collections import defaultdict
from collections.abc import Iterable

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

from .config import REALTIME_REDIS_CHANNEL, REDIS_URL

try:
    import redis.asyncio as redis_async
except ImportError:  # Portable/local installs do not require Redis.
    redis_async = None


class RealtimeHub:
    """Deliver user events locally and across workers through optional Redis."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._redis = None
        self._pubsub = None
        self._listener_task: asyncio.Task | None = None
        self._instance_id = uuid.uuid4().hex

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        if not REDIS_URL:
            print("Realtime events: in-process mode (set REDIS_URL for multiple workers)")
            return
        if redis_async is None:
            print("Realtime events: Redis package is unavailable; using in-process mode")
            return
        try:
            self._redis = redis_async.from_url(
                REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=5,
                health_check_interval=30,
            )
            await self._redis.ping()
            self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
            await self._pubsub.subscribe(REALTIME_REDIS_CHANNEL)
            self._listener_task = asyncio.create_task(self._listen_for_worker_events())
            print(f"Realtime events: Redis channel {REALTIME_REDIS_CHANNEL}")
        except Exception as exc:
            print(f"Realtime Redis unavailable; using in-process mode: {exc}")
            await self._close_redis()

    async def stop(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener_task
        self._listener_task = None
        await self._close_redis()
        async with self._lock:
            self._connections.clear()
        self._loop = None

    async def _close_redis(self) -> None:
        if self._pubsub:
            with contextlib.suppress(Exception):
                await self._pubsub.unsubscribe(REALTIME_REDIS_CHANNEL)
            with contextlib.suppress(Exception):
                await self._pubsub.aclose()
        self._pubsub = None
        if self._redis:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
        self._redis = None

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[int(user_id)].add(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(int(user_id))
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(int(user_id), None)

    async def _send_local(self, user_ids: Iterable[int], event: dict) -> None:
        targets: list[tuple[int, WebSocket]] = []
        async with self._lock:
            for user_id in set(int(value) for value in user_ids):
                targets.extend(
                    (user_id, websocket)
                    for websocket in self._connections.get(user_id, set())
                )
        if not targets:
            return
        results = await asyncio.gather(
            *(websocket.send_json(event) for _, websocket in targets),
            return_exceptions=True,
        )
        for (user_id, websocket), result in zip(targets, results):
            if isinstance(result, Exception):
                await self.disconnect(user_id, websocket)

    async def publish(self, user_ids: Iterable[int], event: dict) -> None:
        targets = sorted(set(int(value) for value in user_ids))
        if not targets:
            return
        encoded_event = jsonable_encoder(event)
        await self._send_local(targets, encoded_event)
        if not self._redis:
            return
        envelope = {
            "origin": self._instance_id,
            "targets": targets,
            "event": encoded_event,
        }
        try:
            await self._redis.publish(
                REALTIME_REDIS_CHANNEL,
                json.dumps(envelope, separators=(",", ":")),
            )
        except Exception as exc:
            print(f"Realtime Redis publish failed: {exc}")

    def publish_from_thread(self, user_ids: Iterable[int], event: dict) -> None:
        """Schedule a publish from FastAPI's synchronous route worker thread."""
        loop = self._loop
        if not loop or loop.is_closed():
            return
        coroutine = self.publish(user_ids, event)
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is loop:
            loop.create_task(coroutine)
            return
        future = asyncio.run_coroutine_threadsafe(coroutine, loop)
        future.add_done_callback(self._consume_publish_result)

    @staticmethod
    def _consume_publish_result(future) -> None:
        with contextlib.suppress(Exception):
            future.result()

    async def _listen_for_worker_events(self) -> None:
        while self._pubsub:
            try:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if not message:
                    await asyncio.sleep(0.01)
                    continue
                envelope = json.loads(message.get("data") or "{}")
                if envelope.get("origin") == self._instance_id:
                    continue
                await self._send_local(
                    envelope.get("targets") or [],
                    envelope.get("event") or {},
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"Realtime Redis listener recovered from an error: {exc}")
                await asyncio.sleep(1)


realtime_hub = RealtimeHub()
