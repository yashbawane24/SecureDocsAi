import csv
import io
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import AuditLog, AuditAction, User, Share, Organization, PermissionScope
from app.schemas import AuditLogResponse
from app.api.deps import require_permission
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/audit", tags=["Audit Ledger"])


def sanitize_csv_cell(val: Optional[object]) -> str:
    """
    Neutralises CSV formula injection by prefixing any cell starting with
    =, +, -, @, or a tab (\\t) with a single quote (').
    """
    if val is None:
        return ""
    s = str(val)
    if s and s[0] in ("=", "+", "-", "@", "\t"):
        return f"'{s}"
    return s


async def _query_filtered_audit_logs(
    db: AsyncSession,
    current_user: User,
    action: Optional[AuditAction] = None,
    result: Optional[str] = None,
    actor_email: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
) -> List[AuditLog]:
    stmt = (
        select(AuditLog)
        .where(AuditLog.organization_id == current_user.organization_id)
        .options(selectinload(AuditLog.document))
    )

    scope = current_user.role_rel.scope if current_user.role_rel else PermissionScope.WHOLE_ORGANIZATION.value
    if current_user.role_name not in ("Owner", "Admin") and scope == PermissionScope.OWN_DEPARTMENT.value:
        dept_user_ids = (
            await db.execute(
                select(User.id).where(
                    and_(
                        User.organization_id == current_user.organization_id,
                        User.department_id == current_user.department_id
                    )
                )
            )
        ).scalars().all()
        stmt = stmt.where(AuditLog.actor_id.in_(dept_user_ids))

    if action:
        stmt = stmt.where(AuditLog.action == action)
    if result:
        stmt = stmt.where(AuditLog.result == result)
    if actor_email:
        stmt = stmt.where(AuditLog.actor_email.ilike(f"%{actor_email.strip()}%"))
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            if dt_from.tzinfo is None:
                dt_from = dt_from.replace(tzinfo=timezone.utc)
            stmt = stmt.where(AuditLog.timestamp >= dt_from)
        except Exception:
            pass
    if date_to:
        try:
            if len(date_to.strip()) == 10:
                dt_to = datetime.fromisoformat(f"{date_to.strip()}T23:59:59+00:00")
            else:
                dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            if dt_to.tzinfo is None:
                dt_to = dt_to.replace(tzinfo=timezone.utc)
            stmt = stmt.where(AuditLog.timestamp <= dt_to)
        except Exception:
            pass

    stmt = stmt.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


@router.get("", response_model=List[AuditLogResponse])
async def list_audit_logs(
    action: Optional[AuditAction] = Query(None, description="Filter by event action"),
    result: Optional[str] = Query(None, description="Filter by result (SUCCESS, FAILURE, BLOCKED)"),
    actor_email: Optional[str] = Query(None, description="Filter by actor email"),
    date_from: Optional[str] = Query(None, description="ISO start date/time"),
    date_to: Optional[str] = Query(None, description="ISO end date/time"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_permission("audit.view")),
    db: AsyncSession = Depends(get_db)
):
    """
    Inspection of immutable audit ledger scoped strictly to user's organization.
    """
    rows = await _query_filtered_audit_logs(
        db=db,
        current_user=current_user,
        action=action,
        result=result,
        actor_email=actor_email,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )

    # Preload users and shares for actor names and recipients
    user_map = {
        u.id: u.full_name
        for u in (await db.execute(select(User).where(User.organization_id == current_user.organization_id))).scalars().all()
    }
    share_ids = {r.share_id for r in rows if r.share_id}
    share_recipient_map = {}
    if share_ids:
        shares = (
            await db.execute(
                select(Share)
                .where(Share.id.in_(share_ids))
                .options(selectinload(Share.recipient_user))
            )
        ).scalars().all()
        for s in shares:
            share_recipient_map[s.id] = s.recipient_email or (s.recipient_user.email if s.recipient_user else "")

    results = []
    for r in rows:
        actor_name = user_map.get(r.actor_id) if r.actor_id else None
        if not actor_name:
            actor_name = r.actor_email.split("@")[0].replace(".", " ").title() if r.actor_email else "System"
        results.append(AuditLogResponse(
            id=r.id,
            organization_id=r.organization_id,
            action=r.action,
            actor_id=r.actor_id,
            actor_email=r.actor_email,
            actor_name=actor_name,
            document_id=r.document_id,
            document_title=r.document.title if r.document else None,
            share_id=r.share_id,
            recipient=share_recipient_map.get(r.share_id) if r.share_id else None,
            ip_address=r.ip_address,
            user_agent=r.user_agent,
            result=r.result,
            details=r.details,
            timestamp=r.timestamp
        ))
    return results


@router.get("/export.csv")
async def export_audit_logs_csv(
    request: Request,
    action: Optional[AuditAction] = Query(None),
    result: Optional[str] = Query(None),
    actor_email: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("audit.view")),
    db: AsyncSession = Depends(get_db)
):
    """
    Streams filtered audit log rows as a CSV attachment with formula-injection protection.
    Writes an AUDIT_EXPORT event to the audit log.
    """
    rows = await _query_filtered_audit_logs(
        db=db,
        current_user=current_user,
        action=action,
        result=result,
        actor_email=actor_email,
        date_from=date_from,
        date_to=date_to,
        limit=2000,
        offset=0,
    )

    # Record the export itself in the audit log
    await record_audit_event(
        db=db,
        action=AuditAction.AUDIT_EXPORT,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Exported {len(rows)} audit log rows to CSV.",
        request=request,
        organization_id=current_user.organization_id,
    )

    org = (await db.execute(select(Organization).where(Organization.id == current_user.organization_id))).scalars().first()
    org_slug = (org.slug if org and org.slug else "org").lower()
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"securedocs-audit-{org_slug}-{date_str}.csv"

    user_map = {
        u.id: u.full_name
        for u in (await db.execute(select(User).where(User.organization_id == current_user.organization_id))).scalars().all()
    }
    share_ids = {r.share_id for r in rows if r.share_id}
    share_recipient_map = {}
    if share_ids:
        shares = (
            await db.execute(
                select(Share)
                .where(Share.id.in_(share_ids))
                .options(selectinload(Share.recipient_user))
            )
        ).scalars().all()
        for s in shares:
            share_recipient_map[s.id] = s.recipient_email or (s.recipient_user.email if s.recipient_user else "")

    def _csv_generator():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "timestamp_utc",
            "actor_name",
            "actor_email",
            "action",
            "document",
            "share_id",
            "recipient",
            "ip_address",
            "user_agent",
            "result",
            "details",
        ])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)

        for r in rows:
            actor_name = user_map.get(r.actor_id) if r.actor_id else None
            if not actor_name:
                actor_name = r.actor_email.split("@")[0].replace(".", " ").title() if r.actor_email else "System"
            ts_str = r.timestamp.isoformat() if r.timestamp else ""
            action_str = r.action.value if hasattr(r.action, "value") else str(r.action)
            doc_title = r.document.title if r.document else ""
            recip = share_recipient_map.get(r.share_id, "") if r.share_id else ""

            writer.writerow([
                sanitize_csv_cell(ts_str),
                sanitize_csv_cell(actor_name),
                sanitize_csv_cell(r.actor_email or ""),
                sanitize_csv_cell(action_str),
                sanitize_csv_cell(doc_title),
                sanitize_csv_cell(r.share_id if r.share_id is not None else ""),
                sanitize_csv_cell(recip),
                sanitize_csv_cell(r.ip_address),
                sanitize_csv_cell(r.user_agent),
                sanitize_csv_cell(r.result),
                sanitize_csv_cell(r.details or ""),
            ])
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        _csv_generator(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
