import json
import secrets
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import hash_token
from app.models import (
    ShareApprovalRequest, Document, Share, User, ShareType, AccessMode,
    AuditAction, NotificationEventType
)
from app.schemas import (
    ApprovalRequestCreate, ApprovalReviewRequest, ApprovalRequestResponse
)
from app.api.deps import get_current_user, user_has_permission
from app.services.audit_service import record_audit_event
from app.services.notification_service import create_notification
from app.services.event_bus import event_bus

router = APIRouter(prefix="/approvals", tags=["Share Approvals"])


def can_user_approve_shares(user: User) -> bool:
    return (
        user.role_name in ("Owner", "Admin", "Department Head")
        or user_has_permission(user, "members.approve")
        or user_has_permission(user, "org.settings")
    )


def serialize_approval(req: ShareApprovalRequest) -> ApprovalRequestResponse:
    doc = req.document
    requester = req.requester
    reviewer = req.reviewer
    return ApprovalRequestResponse(
        id=req.id,
        organization_id=req.organization_id,
        document_id=req.document_id,
        document_title=doc.title if doc else "Document",
        document_risk_score=doc.risk_score if doc else 0,
        document_risk_level=doc.risk_level if doc else "CRITICAL",
        is_safe_copy=doc.is_safe_copy if doc else False,
        requester_id=req.requester_id,
        requester_name=requester.full_name if requester else "User",
        requester_email=requester.email if requester else "",
        share_payload=req.share_payload,
        reason=req.reason,
        status=req.status,
        reviewer_id=req.reviewer_id,
        reviewer_name=reviewer.full_name if reviewer else None,
        review_comment=req.review_comment,
        reviewed_at=req.reviewed_at,
        created_share_id=req.created_share_id,
        created_share_token=req.created_share_token,
        created_at=req.created_at,
    )


@router.get("", response_model=List[ApprovalRequestResponse])
async def list_approval_requests(
    status_filter: Optional[str] = None,
    tab: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists share approval requests scoped strictly to the user's organization."""
    stmt = (
        select(ShareApprovalRequest)
        .where(ShareApprovalRequest.organization_id == current_user.organization_id)
        .options(
            selectinload(ShareApprovalRequest.document),
            selectinload(ShareApprovalRequest.requester),
            selectinload(ShareApprovalRequest.reviewer),
        )
    )
    if tab == "my":
        stmt = stmt.where(ShareApprovalRequest.requester_id == current_user.id)
    elif tab == "waiting":
        stmt = stmt.where(ShareApprovalRequest.requester_id != current_user.id)
        if not can_user_approve_shares(current_user):
            # Not an approver, cannot decide anything
            return []
    elif not can_user_approve_shares(current_user):
        stmt = stmt.where(ShareApprovalRequest.requester_id == current_user.id)

    if status_filter and status_filter != "ALL":
        stmt = stmt.where(ShareApprovalRequest.status == status_filter)

    stmt = stmt.order_by(ShareApprovalRequest.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [serialize_approval(r) for r in rows]


@router.post("", response_model=ApprovalRequestResponse)
async def create_approval_request(
    payload: ApprovalRequestCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a pending approval request to share a Critical document."""
    doc = (
        await db.execute(
            select(Document).where(
                and_(
                    Document.id == payload.document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please provide a reason for requesting approval.")

    share_dict = {
        "document_id": payload.document_id,
        "share_type": payload.share_type.value if hasattr(payload.share_type, "value") else str(payload.share_type),
        "recipient_user_id": payload.recipient_user_id,
        "recipient_email": payload.recipient_email,
        "access_mode": payload.access_mode.value if hasattr(payload.access_mode, "value") else str(payload.access_mode),
        "is_view_once": payload.is_view_once,
        "strict_viewing": True,
        "time_limit_seconds": payload.time_limit_seconds or 3600,
        "max_views": payload.max_views,
        "expires_at": payload.expires_at.isoformat() if payload.expires_at else None,
        "requires_otp": payload.requires_otp,
    }

    req_obj = ShareApprovalRequest(
        organization_id=current_user.organization_id,
        document_id=doc.id,
        requester_id=current_user.id,
        share_payload_json=json.dumps(share_dict),
        reason=payload.reason.strip(),
        status="PENDING",
    )
    db.add(req_obj)
    await db.commit()
    await db.refresh(req_obj)

    req_obj.document = doc
    req_obj.requester = current_user
    req_obj.reviewer = None

    await record_audit_event(
        db=db,
        action=AuditAction.APPROVAL_REQUESTED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Requested share approval for '{doc.title}' ({doc.risk_level}, score {doc.risk_score}). Reason: {req_obj.reason}",
        request=request,
        organization_id=current_user.organization_id,
    )

    # Notify organization approvers excluding the requester
    approvers = (
        await db.execute(
            select(User).where(
                and_(
                    User.organization_id == current_user.organization_id,
                    User.id != current_user.id,
                    User.role_name.in_(["Owner", "Admin", "Department Head"]),
                )
            )
        )
    ).scalars().all()
    for appr in approvers:
        await create_notification(
            db=db,
            user_id=appr.id,
            event_type=NotificationEventType.APPROVAL_REQUESTED,
            title="Share Approval Requested",
            message=f"{current_user.full_name} requested approval to share '{doc.title}' ({doc.risk_level} risk).",
            document_id=doc.id,
            organization_id=current_user.organization_id,
        )

    await event_bus.publish(
        event_type="approval.created",
        payload={"approval_id": req_obj.id, "document_id": doc.id},
        organization_id=current_user.organization_id,
    )

    return serialize_approval(req_obj)


@router.post("/{approval_id}/approve", response_model=ApprovalRequestResponse)
async def approve_share_request(
    approval_id: int,
    review: ApprovalReviewRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Approves a pending Critical document share request and automatically provisions the share."""
    if not can_user_approve_shares(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: Only Admins or Department Heads can approve share requests.")

    stmt = (
        select(ShareApprovalRequest)
        .where(
            and_(
                ShareApprovalRequest.id == approval_id,
                ShareApprovalRequest.organization_id == current_user.organization_id,
            )
        )
        .options(
            selectinload(ShareApprovalRequest.document),
            selectinload(ShareApprovalRequest.requester),
        )
    )
    req_obj = (await db.execute(stmt)).scalars().first()
    if not req_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found.")
    if req_obj.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Request is already {req_obj.status}.")

    if req_obj.requester_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can't approve your own request"
        )

    sp = req_obj.share_payload
    raw_token = secrets.token_urlsafe(32)
    token_h = hash_token(raw_token)

    expires_dt = None
    if sp.get("expires_at"):
        try:
            expires_dt = datetime.fromisoformat(str(sp["expires_at"]).replace("Z", "+00:00"))
        except Exception:
            expires_dt = None

    s_type = ShareType.LINK if sp.get("share_type") == "LINK" else ShareType.INTERNAL
    a_mode = AccessMode.ALLOW_DOWNLOAD if sp.get("access_mode") == "ALLOW_DOWNLOAD" else AccessMode.VIEW_ONLY

    new_share = Share(
        organization_id=current_user.organization_id,
        document_id=req_obj.document_id,
        created_by_id=req_obj.requester_id,
        share_type=s_type,
        recipient_user_id=sp.get("recipient_user_id") if s_type == ShareType.INTERNAL else None,
        recipient_email=sp.get("recipient_email") if s_type == ShareType.LINK else None,
        token_hash=token_h,
        access_mode=a_mode,
        is_view_once=bool(sp.get("is_view_once", False)),
        strict_viewing=True,
        time_limit_seconds=sp.get("time_limit_seconds", 3600),
        max_views=sp.get("max_views"),
        expires_at=expires_dt,
        requires_otp=True if s_type == ShareType.LINK else False,
        approval_id=req_obj.id,
        is_revoked=False,
        is_used=False,
        views_used=0,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_share)
    await db.flush()

    req_obj.status = "APPROVED"
    req_obj.reviewer_id = current_user.id
    req_obj.review_comment = (review.comment or "Approved").strip()
    req_obj.reviewed_at = datetime.now(timezone.utc)
    req_obj.created_share_id = new_share.id
    req_obj.created_share_token = raw_token

    await db.commit()
    await db.refresh(req_obj)
    req_obj.reviewer = current_user

    doc_title = req_obj.document.title if req_obj.document else "Document"

    await record_audit_event(
        db=db,
        action=AuditAction.APPROVED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=req_obj.document_id,
        share_id=new_share.id,
        details=f"Approved share request #{req_obj.id} for '{doc_title}'. Comment: {req_obj.review_comment}",
        request=request,
        organization_id=current_user.organization_id,
    )

    await create_notification(
        db=db,
        user_id=req_obj.requester_id,
        event_type=NotificationEventType.APPROVAL_RESOLVED,
        title="Share Request Approved",
        message=f"{current_user.full_name} approved your request to share '{doc_title}'. Comment: {req_obj.review_comment}",
        document_id=req_obj.document_id,
        share_id=new_share.id,
        organization_id=current_user.organization_id,
    )

    await event_bus.publish(
        event_type="approval.updated",
        payload={"approval_id": req_obj.id, "status": "APPROVED", "share_id": new_share.id},
        organization_id=current_user.organization_id,
    )

    return serialize_approval(req_obj)


@router.post("/{approval_id}/reject", response_model=ApprovalRequestResponse)
async def reject_share_request(
    approval_id: int,
    review: ApprovalReviewRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Rejects a pending Critical document share request."""
    if not can_user_approve_shares(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: Only Admins or Department Heads can reject share requests.")

    stmt = (
        select(ShareApprovalRequest)
        .where(
            and_(
                ShareApprovalRequest.id == approval_id,
                ShareApprovalRequest.organization_id == current_user.organization_id,
            )
        )
        .options(
            selectinload(ShareApprovalRequest.document),
            selectinload(ShareApprovalRequest.requester),
        )
    )
    req_obj = (await db.execute(stmt)).scalars().first()
    if not req_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found.")
    if req_obj.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Request is already {req_obj.status}.")

    if req_obj.requester_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can't approve your own request"
        )

    req_obj.status = "REJECTED"
    req_obj.reviewer_id = current_user.id
    req_obj.review_comment = (review.comment or "Rejected by reviewer").strip()
    req_obj.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(req_obj)
    req_obj.reviewer = current_user

    doc_title = req_obj.document.title if req_obj.document else "Document"

    await record_audit_event(
        db=db,
        action=AuditAction.REJECTED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=req_obj.document_id,
        details=f"Rejected share request #{req_obj.id} for '{doc_title}'. Comment: {req_obj.review_comment}",
        request=request,
        organization_id=current_user.organization_id,
    )

    await create_notification(
        db=db,
        user_id=req_obj.requester_id,
        event_type=NotificationEventType.APPROVAL_RESOLVED,
        title="Share Request Rejected",
        message=f"{current_user.full_name} rejected your request to share '{doc_title}'. Reason: {req_obj.review_comment}",
        document_id=req_obj.document_id,
        organization_id=current_user.organization_id,
    )

    await event_bus.publish(
        event_type="approval.updated",
        payload={"approval_id": req_obj.id, "status": "REJECTED"},
        organization_id=current_user.organization_id,
    )

    return serialize_approval(req_obj)

