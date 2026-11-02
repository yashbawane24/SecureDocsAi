from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import (
    Document, Share, User, AuditLog, AuditAction, UserStatus, ShareType,
    ShareApprovalRequest
)
from app.schemas import (
    DashboardMetricsResponse, SparklinePoint, ShareResponse,
    AuditLogResponse, UserResponse, ApprovalRequestResponse
)
from app.api.deps import get_current_user, user_has_permission
from app.api.auth import serialize_user
from app.api.approvals import serialize_approval
from app.services.share_service import evaluate_share_status, ShareAccessResult

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

def is_share_active(s: Share, now: datetime) -> bool:
    if s.is_revoked or s.is_used:
        return False
    if s.max_views is not None and s.views_used >= s.max_views:
        return False
    if s.expires_at:
        exp = s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=timezone.utc)
        if exp <= now:
            return False
    if s.time_limit_seconds and s.first_opened_at:
        fo = s.first_opened_at if s.first_opened_at.tzinfo else s.first_opened_at.replace(tzinfo=timezone.utc)
        if fo + timedelta(seconds=s.time_limit_seconds) <= now:
            return False
    return True

@router.get("/metrics", response_model=DashboardMetricsResponse)
async def get_dashboard_metrics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    next_24h = now + timedelta(hours=24)

    org_id = current_user.organization_id
    is_admin_or_owner = current_user.role_name in ("Owner", "Admin")

    # 1. Total Documents
    doc_count_stmt = select(func.count(Document.id)).where(Document.organization_id == org_id)
    if not is_admin_or_owner:
        doc_count_stmt = doc_count_stmt.where(Document.owner_id == current_user.id)
    total_docs = (await db.execute(doc_count_stmt)).scalar() or 0

    # 2. Active Shares
    shares_stmt = select(Share).where(
        and_(
            Share.organization_id == org_id,
            Share.is_revoked == False
        )
    ).options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    
    if not is_admin_or_owner:
        shares_stmt = shares_stmt.where(
            (Share.created_by_id == current_user.id) | (Share.recipient_user_id == current_user.id)
        )
    all_shares = (await db.execute(shares_stmt)).scalars().all()
    active_shares = [s for s in all_shares if is_share_active(s, now)]

    # 3. Views this week (OPEN audit logs)
    week_views_stmt = select(func.count(AuditLog.id)).where(
        and_(
            AuditLog.organization_id == org_id,
            AuditLog.action == AuditAction.OPEN,
            AuditLog.timestamp >= seven_days_ago
        )
    )
    views_week = (await db.execute(week_views_stmt)).scalar() or 0

    # 4. Shares expiring in 24h
    expiring_soon = []
    for s in active_shares:
        is_expiring = False
        rem = None
        if s.expires_at:
            exp = s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=timezone.utc)
            if now < exp <= next_24h:
                is_expiring = True
                rem = max(0, int((exp - now).total_seconds()))
        if s.time_limit_seconds and s.first_opened_at:
            fo = s.first_opened_at if s.first_opened_at.tzinfo else s.first_opened_at.replace(tzinfo=timezone.utc)
            deadline = fo + timedelta(seconds=s.time_limit_seconds)
            if now < deadline <= next_24h:
                is_expiring = True
                rem = max(0, int((deadline - now).total_seconds()))
        elif s.time_limit_seconds and not s.first_opened_at and s.time_limit_seconds <= 86400:
            is_expiring = True
            rem = s.time_limit_seconds

        if is_expiring:
            expiring_soon.append(ShareResponse(
                id=s.id,
                organization_id=s.organization_id,
                document_id=s.document_id,
                document_title=s.document.title if s.document else "Document",
                created_by_id=s.created_by_id,
                created_by_name=s.created_by.full_name if s.created_by else "User",
                share_type=s.share_type,
                recipient_user_id=s.recipient_user_id,
                recipient_name=s.recipient_user.full_name if s.recipient_user else None,
                recipient_email=s.recipient_email,
                token=None,
                access_mode=s.access_mode,
                is_view_once=s.is_view_once,
                time_limit_seconds=s.time_limit_seconds,
                first_opened_at=s.first_opened_at,
                max_views=s.max_views,
                views_used=s.views_used,
                expires_at=s.expires_at,
                is_revoked=s.is_revoked,
                is_used=s.is_used,
                requires_otp=s.requires_otp,
                status="ACTIVE",
                seconds_remaining=rem,
                created_at=s.created_at
            ))

    # 5. Pending members
    pending_count_stmt = select(func.count(User.id)).where(
        and_(User.organization_id == org_id, User.status == UserStatus.PENDING.value)
    )
    pending_members = (await db.execute(pending_count_stmt)).scalar() or 0

    # 6. Unauthorized attempts this week
    unauth_stmt = select(func.count(AuditLog.id)).where(
        and_(
            AuditLog.organization_id == org_id,
            AuditLog.action == AuditAction.FAILED_ATTEMPT,
            AuditLog.timestamp >= seven_days_ago
        )
    )
    unauth_week = (await db.execute(unauth_stmt)).scalar() or 0

    # 7. 7-day sparklines
    sparklines = {
        "views": [],
        "docs": [],
        "shares": [],
        "expiring": []
    }
    for i in range(7):
        day_start = (now - timedelta(days=6-i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        day_label = day_start.strftime("%a")

        v_cnt = (await db.execute(
            select(func.count(AuditLog.id)).where(
                and_(AuditLog.organization_id == org_id, AuditLog.action == AuditAction.OPEN, AuditLog.timestamp >= day_start, AuditLog.timestamp < day_end)
            )
        )).scalar() or 0
        sparklines["views"].append(SparklinePoint(day=day_label, value=v_cnt))

        d_cnt = (await db.execute(
            select(func.count(Document.id)).where(
                and_(Document.organization_id == org_id, Document.created_at < day_end)
            )
        )).scalar() or 0
        sparklines["docs"].append(SparklinePoint(day=day_label, value=d_cnt))

        s_cnt = (await db.execute(
            select(func.count(Share.id)).where(
                and_(Share.organization_id == org_id, Share.created_at < day_end, Share.is_revoked == False)
            )
        )).scalar() or 0
        sparklines["shares"].append(SparklinePoint(day=day_label, value=s_cnt))

        # Dynamic expiring trajectory
        exp_at_day = len([
            s for s in active_shares
            if s.expires_at and (s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=timezone.utc)) < day_end + timedelta(hours=24)
        ])
        sparklines["expiring"].append(SparklinePoint(day=day_label, value=max(len(expiring_soon), exp_at_day)))

    # 8. 14-day view analytics chart for Recharts
    daily_history = []
    for i in range(14):
        day_start = (now - timedelta(days=13-i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        day_label = day_start.strftime("%d %b")

        v_cnt = (await db.execute(
            select(func.count(AuditLog.id)).where(
                and_(AuditLog.organization_id == org_id, AuditLog.action == AuditAction.OPEN, AuditLog.timestamp >= day_start, AuditLog.timestamp < day_end)
            )
        )).scalar() or 0

        dl_cnt = (await db.execute(
            select(func.count(AuditLog.id)).where(
                and_(AuditLog.organization_id == org_id, AuditLog.action == AuditAction.DOWNLOAD, AuditLog.timestamp >= day_start, AuditLog.timestamp < day_end)
            )
        )).scalar() or 0

        daily_history.append({
            "date": day_label,
            "views": v_cnt,
            "downloads": dl_cnt
        })

    # 9. Recent Activity Timeline (top 15)
    activity_stmt = (
        select(AuditLog)
        .where(AuditLog.organization_id == org_id)
        .options(selectinload(AuditLog.document))
        .order_by(AuditLog.timestamp.desc())
        .limit(15)
    )
    logs = (await db.execute(activity_stmt)).scalars().all()
    recent_activity = [
        AuditLogResponse(
            id=l.id,
            organization_id=l.organization_id,
            action=l.action,
            actor_id=l.actor_id,
            actor_email=l.actor_email,
            actor_name=l.actor_email.split("@")[0].replace(".", " ").title() if l.actor_email else "System",
            document_id=l.document_id,
            document_title=l.document.title if l.document else None,
            share_id=l.share_id,
            ip_address=l.ip_address,
            user_agent=l.user_agent,
            result=l.result,
            details=l.details,
            timestamp=l.timestamp
        )
        for l in logs
    ]

    # 10. Shared with me unopened items
    unopened_stmt = (
        select(Share)
        .where(
            and_(
                Share.organization_id == org_id,
                Share.share_type == ShareType.INTERNAL,
                Share.recipient_user_id == current_user.id,
                Share.is_revoked == False,
                Share.views_used == 0
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by))
        .order_by(Share.created_at.desc())
    )
    unopened_items = (await db.execute(unopened_stmt)).scalars().all()
    serialized_unopened = []
    for s in unopened_items:
        _, rem = evaluate_share_status(s, current_user, None)
        serialized_unopened.append(ShareResponse(
            id=s.id,
            organization_id=s.organization_id,
            document_id=s.document_id,
            document_title=s.document.title if s.document else "Document",
            created_by_id=s.created_by_id,
            created_by_name=s.created_by.full_name if s.created_by else "User",
            share_type=s.share_type,
            recipient_user_id=s.recipient_user_id,
            recipient_name=current_user.full_name,
            recipient_email=current_user.email,
            token=None,
            access_mode=s.access_mode,
            is_view_once=s.is_view_once,
            time_limit_seconds=s.time_limit_seconds,
            first_opened_at=s.first_opened_at,
            max_views=s.max_views,
            views_used=s.views_used,
            expires_at=s.expires_at,
            is_revoked=s.is_revoked,
            is_used=s.is_used,
            requires_otp=s.requires_otp,
            status="ACTIVE",
            seconds_remaining=rem,
            created_at=s.created_at
        ))

    # 11. Pending join requests (for admin)
    pending_users = []
    if current_user.role_name in ("Owner", "Admin") or user_has_permission(current_user, "members.approve"):
        p_stmt = (
            select(User)
            .where(and_(User.organization_id == org_id, User.status == UserStatus.PENDING.value))
            .options(
                selectinload(User.organization),
                selectinload(User.role_rel),
                selectinload(User.department_rel),
                selectinload(User.manager)
            )
        )
        pending_users = [serialize_user(u) for u in (await db.execute(p_stmt)).scalars().all()]

    # 12. Risk Overview across documents in scope
    docs_for_risk_stmt = select(Document).where(Document.organization_id == org_id)
    if not is_admin_or_owner and not user_has_permission(current_user, "documents.view_all_in_scope"):
        docs_for_risk_stmt = docs_for_risk_stmt.where(Document.owner_id == current_user.id)
    docs_for_risk = (await db.execute(docs_for_risk_stmt)).scalars().all()

    risk_overview = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    for d in docs_for_risk:
        lvl = (d.risk_level or "LOW").upper()
        if lvl in risk_overview:
            risk_overview[lvl] += 1
        else:
            risk_overview["LOW"] += 1

    # 13. Pending Share Approval Requests
    approvals_stmt = (
        select(ShareApprovalRequest)
        .where(
            and_(
                ShareApprovalRequest.organization_id == org_id,
                ShareApprovalRequest.status == "PENDING"
            )
        )
        .options(
            selectinload(ShareApprovalRequest.document),
            selectinload(ShareApprovalRequest.requester),
            selectinload(ShareApprovalRequest.reviewer)
        )
        .order_by(ShareApprovalRequest.created_at.desc())
    )
    if not is_admin_or_owner and current_user.role_name != "Department Head":
        approvals_stmt = approvals_stmt.where(ShareApprovalRequest.requester_id == current_user.id)

    pending_approval_objs = (await db.execute(approvals_stmt)).scalars().all()
    pending_approvals = [serialize_approval(req) for req in pending_approval_objs]

    return DashboardMetricsResponse(
        total_documents=total_docs,
        active_shares=len(active_shares),
        views_this_week=views_week,
        shares_expiring_soon=len(expiring_soon),
        pending_members=pending_members,
        pending_approvals_count=len(pending_approvals),
        unauthorized_attempts_week=unauth_week,
        risk_overview=risk_overview,
        views_sparkline=sparklines["views"],
        documents_sparkline=sparklines["docs"],
        shares_sparkline=sparklines["shares"],
        expiring_sparkline=sparklines["expiring"],
        views_daily_history=daily_history,
        expiring_shares=expiring_soon,
        recent_activity=recent_activity,
        unopened_shares=serialized_unopened,
        pending_join_requests=pending_users,
        pending_approvals=pending_approvals
    )
