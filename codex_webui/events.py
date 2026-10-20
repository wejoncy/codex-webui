"""Bounded event fan-out; slow subscribers never block the RPC reader."""
from __future__ import annotations

import asyncio


class EventHub:
    def __init__(self, capacity: int = 512):
        self.capacity = capacity
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self.capacity)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, message: dict) -> None:
        for queue in tuple(self._subscribers):
            if queue.full():
                self.unsubscribe(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"method": "webui/resyncRequired", "params": {}})
            else:
                queue.put_nowait(message)
