import asyncio
import json
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.models import User
from app.api.deps import get_current_user
from app.services.event_bus import event_bus

router = APIRouter(prefix="/events", tags=["Server-Sent Events"])


@router.get("/stream")
async def stream_events(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """
    Server-Sent Events (SSE) stream pushing real-time notifications,
    share status updates, scan completions, and approval changes.
    """
    org_id = current_user.organization_id
    uid = current_user.id

    async def _event_generator():
        q = event_bus.subscribe()
        try:
            # Initial handshake event
            yield f"data: {json.dumps({'type': 'connected', 'user_id': uid, 'organization_id': org_id})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    msg_org = msg.get("organization_id")
                    msg_uid = msg.get("user_id")
                    if msg_org is not None and msg_org != org_id:
                        continue
                    if msg_uid is not None and msg_uid != uid:
                        continue
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            event_bus.unsubscribe(q)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

