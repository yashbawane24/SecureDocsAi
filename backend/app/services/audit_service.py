"""
Audit Logging Service
Enforces append-only immutable security ledger for all operations:
- OPEN, DOWNLOAD, REVOKE, FAILED_ATTEMPT, LOGIN, OTP_REQUEST, OTP_FAIL, PREVIEW, etc.
- Zero update or delete operations are implemented.
"""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Request
from app.models import AuditLog, AuditAction

def extract_client_info(request: Optional[Request]) -> tuple[str, str]:
    """Extracts client IP address and User-Agent from FastAPI request headers."""
    if not request:
        return "127.0.0.1", "system"
        
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "127.0.0.1"
        
    ua = request.headers.get("User-Agent", "Unknown")
    return ip, ua

async def record_audit_event(
    db: AsyncSession,
    action: AuditAction,
    result: str, # SUCCESS, FAILURE, BLOCKED
    actor_id: Optional[int] = None,
    actor_email: Optional[str] = None,
    document_id: Optional[int] = None,
    share_id: Optional[int] = None,
    details: Optional[str] = None,
    request: Optional[Request] = None,
    ip_override: Optional[str] = None,
    ua_override: Optional[str] = None,
    organization_id: Optional[int] = None
) -> AuditLog:
    """
    Appends a new immutable log entry to the audit log table.
    """
    ip, ua = extract_client_info(request)
    if ip_override:
        ip = ip_override
    if ua_override:
        ua = ua_override

    # Default org_id fallback
    org_id = organization_id if organization_id is not None else 1

    entry = AuditLog(
        organization_id=org_id,
        action=action,
        result=result,
        actor_id=actor_id,
        actor_email=actor_email,
        document_id=document_id,
        share_id=share_id,
        ip_address=ip,
        user_agent=ua,
        details=details,
        timestamp=datetime.now(timezone.utc)
    )
    db.add(entry)
    await db.commit()
    try:
        await db.refresh(entry)
    except Exception:
        pass
    return entry
