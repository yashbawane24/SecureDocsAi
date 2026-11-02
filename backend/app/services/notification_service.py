"""
Security Notification Service
Generates actionable alerts for document owners and broadcasts via SSE:
- DOC_OPENED
- DOC_EXPIRED
- UNAUTHORIZED_ACCESS_ATTEMPT
- MEMBER_JOIN_REQUEST
- SHARE_REVOKED
- SCREENSHOT_ATTEMPT_SUSPECTED
- APPROVAL_REQUESTED
- APPROVAL_RESOLVED
- SCAN_COMPLETED
"""

from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import Notification, NotificationEventType, User
from app.services.event_bus import event_bus

async def create_notification(
    db: AsyncSession,
    user_id: int,
    event_type: NotificationEventType,
    title: str,
    message: str,
    document_id: Optional[int] = None,
    share_id: Optional[int] = None,
    organization_id: Optional[int] = None
) -> Notification:
    """Creates a user notification record and broadcasts over SSE."""
    if organization_id is None:
        user_row = (await db.execute(select(User.organization_id).where(User.id == user_id))).scalar()
        org_id = user_row if user_row is not None else 1
    else:
        org_id = organization_id

    notif = Notification(
        organization_id=org_id,
        user_id=user_id,
        event_type=event_type,
        title=title,
        message=message,
        document_id=document_id,
        share_id=share_id,
        is_read=False
    )
    db.add(notif)
    await db.commit()
    await db.refresh(notif)

    await event_bus.publish(
        event_type="notification.created",
        payload={
            "id": notif.id,
            "organization_id": notif.organization_id,
            "user_id": notif.user_id,
            "event_type": notif.event_type.value if hasattr(notif.event_type, "value") else str(notif.event_type),
            "title": notif.title,
            "message": notif.message,
            "document_id": notif.document_id,
            "share_id": notif.share_id,
            "is_read": notif.is_read,
            "created_at": notif.created_at.isoformat() if notif.created_at else None,
        },
        organization_id=org_id,
        user_id=user_id,
    )
    return notif
