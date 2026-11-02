from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_

from app.core.database import get_db
from app.models import Notification, User
from app.schemas import NotificationResponse
from app.api.deps import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])

@router.get("", response_model=Dict[str, Any])
async def list_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List user notifications and unread count.
    Polled periodically by frontend topbar.
    """
    stmt = (
        select(Notification)
        .where(
            and_(
                Notification.user_id == current_user.id,
                Notification.organization_id == current_user.organization_id
            )
        )
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    items = (await db.execute(stmt)).scalars().all()
    unread_count = sum(1 for n in items if not n.is_read)

    return {
        "notifications": [NotificationResponse.model_validate(n) for n in items],
        "unread_count": unread_count
    }

@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Notification).where(
        and_(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
            Notification.organization_id == current_user.organization_id
        )
    )
    notif = (await db.execute(stmt)).scalars().first()
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")

    notif.is_read = True
    await db.commit()
    return {"message": "Notification marked as read."}

@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        update(Notification)
        .where(
            and_(
                Notification.user_id == current_user.id,
                Notification.organization_id == current_user.organization_id,
                Notification.is_read == False
            )
        )
        .values(is_read=True)
    )
    await db.execute(stmt)
    await db.commit()
    return {"message": "All notifications marked as read."}
