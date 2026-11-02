import asyncio
import json
from typing import Dict, Any, Set, Optional

class EventBus:
    """
    In-memory pub/sub event bus for Server-Sent Events (SSE).
    Supports broadcasting organization-scoped and user-scoped real-time events.
    """
    def __init__(self):
        self._subscribers: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    async def publish(
        self,
        event_type: str,
        payload: Dict[str, Any],
        organization_id: Optional[int] = None,
        user_id: Optional[int] = None
    ):
        msg = {
            "type": event_type,
            "organization_id": organization_id,
            "user_id": user_id,
            "payload": payload,
        }
        dead = []
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.discard(q)

event_bus = EventBus()

