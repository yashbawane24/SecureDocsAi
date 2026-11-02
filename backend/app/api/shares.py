import csv
import io
import secrets
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import hash_token
from app.models import (
    Share, Document, User, ShareType, AccessMode, AuditAction,
    NotificationEventType, PermissionScope, ScanStatus, RiskLevel,
    ShareApprovalRequest, Organization, DEFAULT_RISK_POLICY
)
from app.schemas import ShareCreate, ShareResponse
from app.api.deps import (
    get_current_user, require_share_privilege, user_has_permission
)
from app.api.audit import sanitize_csv_cell
from app.services.share_service import evaluate_share_status, ShareAccessResult
from app.services.audit_service import record_audit_event
from app.services.notification_service import create_notification
from app.services.event_bus import event_bus

router = APIRouter(prefix="/shares", tags=["Shares"])


def serialize_share(share: Share, raw_token: Optional[str] = None) -> ShareResponse:
    status_str, remaining = evaluate_share_status(share, None, None)

    if share.is_revoked:
        display_status = "REVOKED"
    elif status_str == ShareAccessResult.EXPIRED:
        display_status = "EXPIRED"
    elif status_str == ShareAccessResult.ALREADY_USED:
        display_status = "USED"
    elif status_str == ShareAccessResult.MAX_VIEWS_REACHED:
        display_status = "EXHAUSTED"
    else:
        display_status = "ACTIVE"

    doc = share.document
    return ShareResponse(
        id=share.id,
        organization_id=share.organization_id,
        document_id=share.document_id,
        document_title=doc.title if doc else "Document",
        document_risk_level=doc.risk_level if doc else "LOW",
        document_risk_score=doc.risk_score if doc else 0,
        is_safe_copy=doc.is_safe_copy if doc else False,
        created_by_id=share.created_by_id,
        created_by_name=share.created_by.full_name if share.created_by else "User",
        share_type=share.share_type,
        recipient_user_id=share.recipient_user_id,
        recipient_name=share.recipient_user.full_name if share.recipient_user else None,
        recipient_email=share.recipient_email or (share.recipient_user.email if share.recipient_user else None),
        token=raw_token,
        access_mode=share.access_mode,
        is_view_once=share.is_view_once,
        strict_viewing=bool(share.strict_viewing or share.is_view_once),
        time_limit_seconds=share.time_limit_seconds,
        first_opened_at=share.first_opened_at,
        max_views=share.max_views,
        views_used=share.views_used,
        expires_at=share.expires_at,
        is_revoked=share.is_revoked,
        is_used=share.is_used,
        requires_otp=share.requires_otp,
        approval_id=share.approval_id,
        status=display_status,
        seconds_remaining=remaining,
        created_at=share.created_at
    )


async def enforce_and_apply_risk_policy(
    db: AsyncSession,
    doc: Document,
    share_in: ShareCreate,
    current_user: User,
    request: Optional[Request] = None,
    bypass_approval_check: bool = False,
) -> dict:
    """
    Enforces B5 Risk-Based Sharing Policy server-side.
    Returns adjusted share settings dict {"requires_otp": bool, "strict_viewing": bool, "time_limit_seconds": Optional[int]}.
    Raises HTTPException(403/409) and writes SHARE_BLOCKED_BY_RISK audit event if blocked.
    """
    # 1. Block while scan is QUEUED or SCANNING
    if doc.scan_status in (ScanStatus.QUEUED.value, ScanStatus.SCANNING.value):
        await record_audit_event(
            db=db,
            action=AuditAction.SHARE_BLOCKED_BY_RISK,
            result="BLOCKED",
            actor_id=current_user.id,
            actor_email=current_user.email,
            document_id=doc.id,
            details="Share blocked: document sensitive data scan is still in progress.",
            request=request,
            organization_id=current_user.organization_id,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Scanning for sensitive data — usually under a minute."
        )

    # 2. Determine effective risk level (FAILED scan treated as HIGH)
    effective_level = doc.risk_level or RiskLevel.LOW.value
    if doc.scan_status == ScanStatus.FAILED.value:
        effective_level = RiskLevel.HIGH.value

    # Check if this is a safe copy of a CRITICAL parent
    parent_is_critical = False
    if doc.is_safe_copy and doc.parent_document_id:
        parent_doc = (await db.execute(select(Document).where(Document.id == doc.parent_document_id))).scalars().first()
        if parent_doc and parent_doc.risk_level == RiskLevel.CRITICAL.value:
            parent_is_critical = True

    org_settings = current_user.organization.settings if current_user.organization else {}
    risk_policy_map = org_settings.get("risk_policy") or DEFAULT_RISK_POLICY
    level_rules = risk_policy_map.get(effective_level, DEFAULT_RISK_POLICY.get(effective_level, DEFAULT_RISK_POLICY["LOW"]))

    has_valid_approval = bypass_approval_check
    if not has_valid_approval and share_in.approval_id:
        appr = (
            await db.execute(
                select(ShareApprovalRequest).where(
                    and_(
                        ShareApprovalRequest.id == share_in.approval_id,
                        ShareApprovalRequest.document_id == doc.id,
                        ShareApprovalRequest.organization_id == current_user.organization_id,
                        ShareApprovalRequest.status == "APPROVED",
                    )
                )
            )
        ).scalars().first()
        if appr:
            has_valid_approval = True

    # Check if user has shares.approve at org scope (Owner, Admin)
    is_org_approver = current_user.role_name in ("Owner", "Admin") or (
        current_user.role and getattr(current_user.role, "scope", "") in ("WHOLE_ORGANIZATION", "whole_organization") and user_has_permission(current_user, "shares.approve")
    )

    # 3. CRITICAL rules
    if effective_level == RiskLevel.CRITICAL.value and not doc.is_safe_copy:
        if is_org_approver:
            if share_in.confirm_critical == "SHARE":
                await record_audit_event(
                    db=db,
                    action=AuditAction.CRITICAL_SHARE_SELF_AUTHORISED,
                    result="SUCCESS",
                    actor_id=current_user.id,
                    actor_email=current_user.email,
                    document_id=doc.id,
                    details=f"Critical original self-authorised for sharing. Reason: {share_in.confirm_reason or 'Direct authorization'}",
                    request=request,
                    organization_id=current_user.organization_id,
                )
                has_valid_approval = True
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This file is Critical (score 100). Type SHARE to confirm sharing the original."
                )
        elif level_rules.get("require_approval", True) and not has_valid_approval:
            await record_audit_event(
                db=db,
                action=AuditAction.SHARE_BLOCKED_BY_RISK,
                result="BLOCKED",
                actor_id=current_user.id,
                actor_email=current_user.email,
                document_id=doc.id,
                details=f"Share blocked by CRITICAL risk policy (score {doc.risk_score}). Approval required.",
                request=request,
                organization_id=current_user.organization_id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Critical risk documents cannot be shared without approval from an Admin or Department Head, or share a redacted safe copy."
            )

    # Safe copy of CRITICAL document shared externally also requires approval
    if doc.is_safe_copy and parent_is_critical and share_in.share_type == ShareType.LINK:
        crit_rules = risk_policy_map.get("CRITICAL", DEFAULT_RISK_POLICY["CRITICAL"])
        if crit_rules.get("require_approval_external_safe_copy", True) and not has_valid_approval:
            await record_audit_event(
                db=db,
                action=AuditAction.SHARE_BLOCKED_BY_RISK,
                result="BLOCKED",
                actor_id=current_user.id,
                actor_email=current_user.email,
                document_id=doc.id,
                details="External share of safe copy derived from CRITICAL document requires approval.",
                request=request,
                organization_id=current_user.organization_id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="External sharing of a safe copy from a Critical document requires approval from an Admin or Department Head."
            )

    # 4. HIGH rules (and CRITICAL if approved)
    if effective_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value):
        # External sharing of unredacted HIGH document is blocked
        if share_in.share_type == ShareType.LINK and not doc.is_safe_copy and not has_valid_approval:
            if level_rules.get("external_safe_copy_only", True):
                await record_audit_event(
                    db=db,
                    action=AuditAction.SHARE_BLOCKED_BY_RISK,
                    result="BLOCKED",
                    actor_id=current_user.id,
                    actor_email=current_user.email,
                    document_id=doc.id,
                    details=f"External link blocked for {effective_level} original document '{doc.title}'. Safe copy required.",
                    request=request,
                    organization_id=current_user.organization_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="High-risk original documents cannot be shared externally. Create and share a redacted safe copy instead."
                )

        # Original download disabled for HIGH/CRITICAL originals
        if share_in.access_mode == AccessMode.ALLOW_DOWNLOAD and not doc.is_safe_copy and not level_rules.get("allow_download", False):
            await record_audit_event(
                db=db,
                action=AuditAction.SHARE_BLOCKED_BY_RISK,
                result="BLOCKED",
                actor_id=current_user.id,
                actor_email=current_user.email,
                document_id=doc.id,
                details=f"Download mode blocked for {effective_level} original document '{doc.title}'.",
                request=request,
                organization_id=current_user.organization_id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Downloads are disabled for {effective_level.title()}-risk original documents. Share as View-Only or create a safe copy."
            )

        # Internal sharing requires time limit <= 24h (86400s) or view_once
        max_sec = int(level_rules.get("max_duration_hours", 24)) * 3600
        if not share_in.is_view_once:
            if share_in.time_limit_seconds is None or share_in.time_limit_seconds > max_sec:
                # Default to 3600s (1h) if none provided, or block if explicitly > 24h
                if share_in.time_limit_seconds is not None and share_in.time_limit_seconds > max_sec:
                    await record_audit_event(
                        db=db,
                        action=AuditAction.SHARE_BLOCKED_BY_RISK,
                        result="BLOCKED",
                        actor_id=current_user.id,
                        actor_email=current_user.email,
                        document_id=doc.id,
                        details=f"Time limit {share_in.time_limit_seconds}s exceeds {max_sec}s maximum for {effective_level} document.",
                        request=request,
                        organization_id=current_user.organization_id,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"{effective_level.title()}-risk shares must be View-Once or have a time limit of at most 24 hours."
                    )

    # Compute enforced attributes
    requires_otp = bool(share_in.requires_otp)
    if share_in.share_type == ShareType.LINK:
        if org_settings.get("require_otp_external", True) or level_rules.get("require_otp_external", True):
            requires_otp = True

    strict_viewing = bool(
        share_in.strict_viewing
        or share_in.is_view_once
        or level_rules.get("force_strict_viewing", False)
        or effective_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value)
    )

    time_limit_seconds = share_in.time_limit_seconds
    if effective_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value) and not share_in.is_view_once and time_limit_seconds is None:
        time_limit_seconds = 3600  # Enforce 1h session limit when none was set

    await record_audit_event(
        db=db,
        action=AuditAction.RISK_POLICY_APPLIED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Risk policy ({effective_level}, score {doc.risk_score}) applied: strict_viewing={strict_viewing}, otp={requires_otp}.",
        request=request,
        organization_id=current_user.organization_id,
    )

    return {
        "requires_otp": requires_otp,
        "strict_viewing": strict_viewing,
        "time_limit_seconds": time_limit_seconds,
    }


@router.post("", response_model=ShareResponse)
async def create_share(
    share_in: ShareCreate,
    request: Request,
    current_user: User = Depends(require_share_privilege),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates an internal or external document share.
    Enforces multi-tenant isolation, permission matrix, organization security policies, and B5 risk policy.
    """
    doc_stmt = (
        select(Document)
        .where(
            and_(
                Document.id == share_in.document_id,
                Document.organization_id == current_user.organization_id
            )
        )
    )
    doc = (await db.execute(doc_stmt)).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    is_owner = (doc.owner_id == current_user.id)
    can_share_any = user_has_permission(current_user, "documents.view_all_in_scope")
    if not is_owner and not can_share_any and current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only share documents that you own."
        )

    if share_in.share_type == ShareType.INTERNAL:
        if not user_has_permission(current_user, "shares.create_internal"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: 'shares.create_internal' required.")
    elif share_in.share_type == ShareType.LINK:
        if not user_has_permission(current_user, "shares.create_external"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: 'shares.create_external' required.")
        org_settings = current_user.organization.settings if current_user.organization else {}
        if not org_settings.get("allow_external_links", True):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="External link sharing is disabled by organization policy.")

    if share_in.access_mode == AccessMode.ALLOW_DOWNLOAD:
        if not user_has_permission(current_user, "shares.allow_download"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: 'shares.allow_download' required.")

    # Enforce B5 Risk-Based Sharing Policy
    policy_enforced = await enforce_and_apply_risk_policy(
        db=db,
        doc=doc,
        share_in=share_in,
        current_user=current_user,
        request=request,
    )

    recipient_user = None
    if share_in.share_type == ShareType.INTERNAL:
        if not share_in.recipient_user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Internal shares require a recipient team member.")
        recip_stmt = (
            select(User)
            .where(
                and_(
                    User.id == share_in.recipient_user_id,
                    User.organization_id == current_user.organization_id
                )
            )
        )
        recipient_user = (await db.execute(recip_stmt)).scalars().first()
        if not recipient_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient user not found in this organization.")

        scope = current_user.role_rel.scope if current_user.role_rel else PermissionScope.WHOLE_ORGANIZATION.value
        if current_user.role_name not in ("Owner", "Admin") and scope != PermissionScope.WHOLE_ORGANIZATION.value:
            if scope == PermissionScope.OWN_DEPARTMENT.value or current_user.role_name == "Department Head":
                if recipient_user.department_id != current_user.department_id:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only share within your department.")
            elif scope == PermissionScope.OWN_DIRECT_REPORTS.value or current_user.role_name == "Manager":
                is_direct_report = (recipient_user.reports_to_id == current_user.id)
                is_supervisor = (recipient_user.id == current_user.reports_to_id)
                if not (is_direct_report or is_supervisor):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only share to direct reports or their direct supervisor.")

    raw_token = secrets.token_urlsafe(32)
    token_h = hash_token(raw_token)

    share = Share(
        organization_id=current_user.organization_id,
        document_id=doc.id,
        created_by_id=current_user.id,
        share_type=share_in.share_type,
        recipient_user_id=share_in.recipient_user_id if share_in.share_type == ShareType.INTERNAL else None,
        recipient_email=share_in.recipient_email if share_in.share_type == ShareType.LINK else None,
        token_hash=token_h,
        access_mode=share_in.access_mode,
        is_view_once=share_in.is_view_once,
        strict_viewing=policy_enforced["strict_viewing"],
        time_limit_seconds=policy_enforced["time_limit_seconds"],
        max_views=share_in.max_views,
        expires_at=share_in.expires_at,
        requires_otp=policy_enforced["requires_otp"],
        approval_id=share_in.approval_id,
        is_revoked=False,
        is_used=False,
        views_used=0,
        first_opened_at=None,
        created_at=datetime.now(timezone.utc)
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)

    share.document = doc
    share.created_by = current_user
    share.recipient_user = recipient_user

    await record_audit_event(
        db=db,
        action=AuditAction.OPEN,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        share_id=share.id,
        details=f"Created {share.share_type.value} share for '{doc.title}' (Mode: {share.access_mode.value})",
        request=request,
        organization_id=current_user.organization_id
    )

    await event_bus.publish(
        event_type="share.created",
        payload={"share_id": share.id, "document_id": doc.id},
        organization_id=current_user.organization_id,
    )

    return serialize_share(share, raw_token=raw_token)


@router.get("/my-shares", response_model=List[ShareResponse])
async def list_my_shares(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List shares within user's scope (Owner/Admin see org shares; others see shares they created)."""
    if current_user.role_name in ("Owner", "Admin"):
        stmt = (
            select(Share)
            .where(Share.organization_id == current_user.organization_id)
            .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
            .order_by(Share.created_at.desc())
        )
    else:
        stmt = (
            select(Share)
            .where(
                and_(
                    Share.created_by_id == current_user.id,
                    Share.organization_id == current_user.organization_id
                )
            )
            .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
            .order_by(Share.created_at.desc())
        )
    shares = (await db.execute(stmt)).scalars().all()
    return [serialize_share(s) for s in shares]


@router.get("/export.csv")
async def export_shares_csv(
    request: Request,
    status_filter: Optional[str] = Query(None),
    share_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Exports shared links to a CSV file with formula-injection protection."""
    shares_resp = await list_my_shares(current_user=current_user, db=db)
    if status_filter and status_filter != "ALL":
        shares_resp = [s for s in shares_resp if s.status == status_filter]
    if share_type and share_type != "ALL":
        shares_resp = [s for s in shares_resp if s.share_type.value == share_type]

    org = (await db.execute(select(Organization).where(Organization.id == current_user.organization_id))).scalars().first()
    org_slug = (org.slug if org and org.slug else "org").lower()
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"securedocs-shares-{org_slug}-{date_str}.csv"

    def _csv_gen():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "share_id",
            "document",
            "risk_level",
            "share_type",
            "recipient",
            "access_mode",
            "views_used",
            "max_views",
            "status",
            "created_by",
            "created_at_utc",
        ])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)

        for s in shares_resp:
            recip = s.recipient_email or s.recipient_name or ""
            writer.writerow([
                sanitize_csv_cell(s.id),
                sanitize_csv_cell(s.document_title),
                sanitize_csv_cell(s.document_risk_level),
                sanitize_csv_cell(s.share_type.value if hasattr(s.share_type, "value") else s.share_type),
                sanitize_csv_cell(recip),
                sanitize_csv_cell(s.access_mode.value if hasattr(s.access_mode, "value") else s.access_mode),
                sanitize_csv_cell(s.views_used),
                sanitize_csv_cell(s.max_views if s.max_views is not None else "Unlimited"),
                sanitize_csv_cell(s.status),
                sanitize_csv_cell(s.created_by_name),
                sanitize_csv_cell(s.created_at.isoformat() if s.created_at else ""),
            ])
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        _csv_gen(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/shared-with-me", response_model=List[ShareResponse])
async def list_shared_with_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all internal shares assigned to the current user."""
    stmt = (
        select(Share)
        .where(
            and_(
                Share.share_type == ShareType.INTERNAL,
                Share.recipient_user_id == current_user.id,
                Share.organization_id == current_user.organization_id
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
        .order_by(Share.created_at.desc())
    )
    shares = (await db.execute(stmt)).scalars().all()
    return [serialize_share(s) for s in shares]


@router.post("/{share_id}/revoke", response_model=ShareResponse)
async def revoke_share(
    share_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Instantly revokes a share and broadcasts over SSE."""
    stmt = (
        select(Share)
        .where(
            and_(
                Share.id == share_id,
                Share.organization_id == current_user.organization_id
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share record not found.")

    is_owner = (share.created_by_id == current_user.id)
    can_revoke_any = user_has_permission(current_user, "shares.revoke_any_in_scope")
    if not is_owner and not can_revoke_any and current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied to revoke this share.")

    share.is_revoked = True
    await db.commit()
    await db.refresh(share)

    if share.recipient_user_id:
        await create_notification(
            db=db,
            user_id=share.recipient_user_id,
            event_type=NotificationEventType.SHARE_REVOKED,
            title="Document Access Revoked",
            message=f"Access to '{share.document.title}' was revoked by {current_user.full_name}.",
            document_id=share.document_id,
            share_id=share.id,
            organization_id=current_user.organization_id
        )

    await record_audit_event(
        db=db,
        action=AuditAction.REVOKE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=share.document_id,
        share_id=share.id,
        details=f"Share {share.id} for '{share.document.title}' instantly revoked.",
        request=request,
        organization_id=current_user.organization_id
    )

    await event_bus.publish(
        event_type="share.revoked",
        payload={"share_id": share.id, "document_id": share.document_id},
        organization_id=current_user.organization_id,
    )

    return serialize_share(share)
