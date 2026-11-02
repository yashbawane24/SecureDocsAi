import hashlib
import io
import json
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, update, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import settings
from app.core.security import hash_token, create_access_token, decode_access_token
from app.models import (
    Share, Document, DocumentFinding, User, ShareType, AccessMode, AuditAction,
    NotificationEventType, RiskLevel
)
from app.schemas import (
    ViewerSessionResponse, OTPRequestSchema, OTPVerifySchema, GenericResponse,
    SecurityEventRequest, DocumentFindingResponse
)
from app.api.deps import get_optional_current_user, get_current_user, user_has_permission
from app.services.share_service import (
    evaluate_share_status, ShareAccessResult, get_server_utc,
    create_view_session, validate_view_session
)
from app.services.event_bus import event_bus
from app.services.storage import load_decrypted_document
from app.services.watermark import apply_download_watermark, generate_dl_id
from app.services.audit_service import record_audit_event
from app.services.notification_service import create_notification
from app.services.otp_service import request_otp_for_share, verify_otp_code
from app.services.email import mask_email_address
from app.services.scanner import create_redacted_pdf_bytes

router = APIRouter(prefix="/view", tags=["Viewer Engine"])


def get_otp_session_email(request: Request, token_hash: str) -> Optional[str]:
    """Extract verified OTP session email from signed cookie."""
    cookie_val = request.cookies.get(f"otp_session_{token_hash[:16]}")
    if not cookie_val:
        return None
    payload = decode_access_token(cookie_val)
    if payload and payload.get("token_hash") == token_hash:
        return payload.get("email")
    return None


def set_otp_session_cookie(response: Response, token_hash: str, email: str):
    """Sets signed short-lived session cookie verifying email OTP access."""
    from datetime import timedelta
    token = create_access_token(
        data={"token_hash": token_hash, "email": email},
        expires_delta=timedelta(minutes=60)
    )
    response.set_cookie(
        key=f"otp_session_{token_hash[:16]}",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=3600,
        path="/"
    )


async def _get_redacted_findings_for_safe_copy(db: AsyncSession, doc: Optional[Document]) -> List[DocumentFindingResponse]:
    if not doc or not doc.is_safe_copy or not doc.parent_document_id:
        return []
    rows = (
        await db.execute(
            select(DocumentFinding)
            .where(DocumentFinding.document_id == doc.parent_document_id)
            .order_by(DocumentFinding.page_number.asc())
        )
    ).scalars().all()
    return [
        DocumentFindingResponse(
            id=f.id,
            document_id=f.document_id,
            entity_type=f.entity_type,
            category=f.category,
            masked_value=f.masked_value,
            value_hash=f.value_hash,
            page_number=f.page_number,
            bboxes=f.bboxes,
            confidence=f.confidence,
            detector_name=f.detector_name,
            masked_context=f.masked_context,
            created_at=f.created_at,
        )
        for f in rows
    ]


async def _load_canvas_pdf_stream(db: AsyncSession, doc: Document) -> io.BytesIO:
    """
    Loads decrypted PDF stream for the in-app HTML5 canvas viewer.
    For password-protected safe copies, returns the AES-256 encrypted PDF bytes
    so pdf.js decrypts it in-memory client-side upon password entry.
    """
    return load_decrypted_document(
        stored_filename=doc.stored_filename,
        iv_hex=doc.encryption_iv,
        tag_hex=doc.encryption_tag,
    )


async def _build_share_session_response(
    share: Optional[Share],
    current_user: Optional[User],
    verified_email: Optional[str],
    token_h: str,
    request: Request,
    db: AsyncSession
) -> ViewerSessionResponse:
    if not share:
        return ViewerSessionResponse(
            status=ShareAccessResult.INVALID_LINK,
            message="This link is not valid. Check that you copied the full address."
        )

    if current_user and share.organization_id != current_user.organization_id and share.share_type == ShareType.INTERNAL:
        return ViewerSessionResponse(
            status=ShareAccessResult.NOT_YOUR_SHARE,
            message="This document was shared with someone in another organisation."
        )

    status_str, seconds_remaining = evaluate_share_status(share, current_user, verified_email)
    client_ip = request.client.host if request.client else "127.0.0.1"

    if status_str == ShareAccessResult.NOT_YOUR_SHARE:
        actor_email = current_user.email if current_user else "Anonymous"
        actor_id = current_user.id if current_user else None

        await record_audit_event(
            db=db,
            action=AuditAction.FAILED_ATTEMPT,
            result="BLOCKED",
            actor_id=actor_id,
            actor_email=actor_email,
            document_id=share.document_id,
            share_id=share.id,
            details=f"Blocked access attempt to internal share #{share.id} by {actor_email}",
            request=request,
            organization_id=share.organization_id,
        )

        await create_notification(
            db=db,
            user_id=share.created_by_id,
            event_type=NotificationEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
            title="Unauthorized Access Attempt Blocked",
            message=f"{actor_email} tried to open '{share.document.title}', which was shared with someone else.",
            document_id=share.document_id,
            share_id=share.id,
            organization_id=share.organization_id,
        )

        return ViewerSessionResponse(
            status=ShareAccessResult.NOT_YOUR_SHARE,
            message="This document was shared with a specific team member. Sign in with the right account to open it."
        )

    doc = share.document
    if share.share_type == ShareType.INTERNAL:
        viewer_name = current_user.full_name if current_user else "Team Member"
        viewer_email = current_user.email if current_user else ""
    else:
        if status_str == ShareAccessResult.OTP_REQUIRED:
            viewer_email = ""
            viewer_name = "External Recipient"
        else:
            viewer_email = verified_email or share.recipient_email or "External Recipient"
            viewer_name = viewer_email.split("@")[0].replace(".", " ").title()

    tracking_hash = hashlib.sha256(f"{token_h}:{viewer_email or 'pending'}".encode()).hexdigest()[:12]

    is_strict = bool(
        share.strict_viewing
        or share.is_view_once
        or (doc and doc.risk_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value))
    )

    can_reveal = bool(current_user and user_has_permission(current_user, "documents.reveal_sensitive"))
    redacted_findings = await _get_redacted_findings_for_safe_copy(db, doc) if status_str == ShareAccessResult.VALID else []

    messages = {
        ShareAccessResult.REVOKED: "The sender has turned off access to this document.",
        ShareAccessResult.EXPIRED: "The time limit set by the sender has ended. Ask them to share the document again if you still need it.",
        ShareAccessResult.ALREADY_USED: "This link was set to open only once, and it has already been viewed.",
        ShareAccessResult.MAX_VIEWS_REACHED: "This link has reached the maximum number of views set by the sender.",
        ShareAccessResult.OTP_REQUIRED: "Verify your email address to open this document.",
        ShareAccessResult.VALID: "Document ready."
    }

    return ViewerSessionResponse(
        status=status_str,
        document_title=doc.title if doc else "Shared Document",
        document_id=share.document_id,
        share_id=share.id,
        sender_name=share.created_by.full_name if share.created_by else "Sender",
        viewer_name=viewer_name,
        viewer_email=viewer_email or None,
        viewer_ip=client_ip,
        masked_recipient_email=mask_email_address(share.recipient_email) if share.recipient_email else None,
        tracking_hash=tracking_hash,
        access_mode=share.access_mode,
        time_limit_seconds=share.time_limit_seconds,
        seconds_remaining=seconds_remaining,
        first_opened_at=share.first_opened_at,
        max_views=share.max_views,
        views_used=share.views_used,
        expires_at=share.expires_at,
        is_view_once=share.is_view_once,
        strict_viewing=is_strict,
        is_safe_copy=bool(doc and doc.is_safe_copy),
        is_password_protected=bool(doc and doc.is_password_protected),
        parent_document_id=doc.parent_document_id if doc else None,
        can_reveal_sensitive=can_reveal,
        redacted_findings=redacted_findings,
        demo_mode=settings.DEMO_MODE,
        message=messages.get(status_str, "")
    )


async def _stream_share_bytes(
    share: Share,
    current_user: Optional[User],
    verified_email: Optional[str],
    request: Request,
    db: AsyncSession
) -> StreamingResponse:
    status_str, _ = evaluate_share_status(share, current_user, verified_email)

    if status_str != ShareAccessResult.VALID:
        status_code = status.HTTP_410_GONE if status_str in (
            ShareAccessResult.EXPIRED,
            ShareAccessResult.ALREADY_USED,
            ShareAccessResult.MAX_VIEWS_REACHED,
            ShareAccessResult.REVOKED
        ) else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail=f"Access refused: {status_str}")

    now = get_server_utc()

    if share.first_opened_at is None:
        share.first_opened_at = now
        await db.commit()

        viewer_identity = current_user.full_name if current_user else (verified_email or share.recipient_email or "Recipient")
        await create_notification(
            db=db,
            user_id=share.created_by_id,
            event_type=NotificationEventType.DOC_OPENED,
            title="Document Opened",
            message=f"{viewer_identity} opened '{share.document.title}'.",
            document_id=share.document_id,
            share_id=share.id,
            organization_id=share.organization_id,
        )

    share.views_used += 1
    if share.is_view_once:
        share.is_used = True
    await db.commit()

    actor_email = current_user.email if current_user else (verified_email or share.recipient_email)
    actor_id = current_user.id if current_user else None

    await record_audit_event(
        db=db,
        action=AuditAction.OPEN,
        result="SUCCESS",
        actor_id=actor_id,
        actor_email=actor_email,
        document_id=share.document_id,
        share_id=share.id,
        details=f"Opened document in secure viewer. Views used: {share.views_used}",
        request=request,
        organization_id=share.organization_id,
    )

    doc = share.document
    decrypted_stream = await _load_canvas_pdf_stream(db, doc)

    return StreamingResponse(
        decrypted_stream,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename={doc.original_filename}",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
    )


async def _stream_session_bytes(share: Share, db: AsyncSession) -> StreamingResponse:
    """Streams PDF content within an active session without consuming another view."""
    doc = share.document
    decrypted_stream = await _load_canvas_pdf_stream(db, doc)
    return StreamingResponse(
        decrypted_stream,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename={doc.original_filename}",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
    )


# ==============================================================================
# 0. SCREENSHOT / CAPTURE DETERRENCE TELEMETRY (A6)
# ==============================================================================
@router.post("/security-event", response_model=GenericResponse)
async def report_viewer_security_event(
    payload: SecurityEventRequest,
    request: Request,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Records a suspected screenshot or screen capture attempt (SCREENSHOT_ATTEMPT_SUSPECTED)
    in the immutable audit log and notifies the sender.
    """
    share: Optional[Share] = None
    doc: Optional[Document] = None

    if payload.share_id:
        share = (
            await db.execute(
                select(Share)
                .where(Share.id == payload.share_id)
                .options(selectinload(Share.document))
            )
        ).scalars().first()
        if share:
            doc = share.document
    elif payload.token:
        token_h = hash_token(payload.token)
        share = (
            await db.execute(
                select(Share)
                .where(Share.token_hash == token_h)
                .options(selectinload(Share.document))
            )
        ).scalars().first()
        if share:
            doc = share.document
    elif payload.document_id:
        doc = (await db.execute(select(Document).where(Document.id == payload.document_id))).scalars().first()

    org_id = (share.organization_id if share else (doc.organization_id if doc else (current_user.organization_id if current_user else 1)))
    actor_email = current_user.email if current_user else (share.recipient_email if share else "External Viewer")
    actor_id = current_user.id if current_user else None
    doc_title = doc.title if doc else "Protected Document"

    await record_audit_event(
        db=db,
        action=AuditAction.SCREENSHOT_ATTEMPT_SUSPECTED,
        result="BLOCKED",
        actor_id=actor_id,
        actor_email=actor_email,
        document_id=doc.id if doc else None,
        share_id=share.id if share else None,
        details=f"Suspected capture or focus-loss trigger ({payload.trigger_type}) while viewing '{doc_title}'.",
        request=request,
        organization_id=org_id,
    )

    notify_user_id = share.created_by_id if share else (doc.owner_id if doc else None)
    if notify_user_id:
        await create_notification(
            db=db,
            user_id=notify_user_id,
            event_type=NotificationEventType.SCREENSHOT_ATTEMPT_SUSPECTED,
            title="Capture Attempt Detected",
            message=f"Viewer ({actor_email}) triggered capture protection ({payload.trigger_type}) on '{doc_title}'.",
            document_id=doc.id if doc else None,
            share_id=share.id if share else None,
            organization_id=org_id,
        )

    return GenericResponse(success=True, message="Security event recorded.")


# ==============================================================================
# 1. INTERNAL SHARE ROUTES (/viewer/:shareId)
# ==============================================================================
@router.get("/internal/{share_id}/status", response_model=ViewerSessionResponse)
async def get_internal_share_status(
    share_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Evaluates internal share status for logged-in recipient."""
    stmt = (
        select(Share)
        .where(
            and_(
                Share.id == share_id,
                Share.organization_id == current_user.organization_id,
                Share.share_type == ShareType.INTERNAL
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()

    if not share:
        return ViewerSessionResponse(
            status="NOT_FOUND",
            message="This link is not valid or the share was removed."
        )

    if share.recipient_user_id != current_user.id and current_user.role_name not in ("Owner", "Admin"):
        await record_audit_event(
            db=db,
            action=AuditAction.FAILED_ATTEMPT,
            result="BLOCKED",
            actor_id=current_user.id,
            actor_email=current_user.email,
            document_id=share.document_id,
            share_id=share.id,
            details=f"Blocked access attempt to internal document '{share.document.title}' by {current_user.email}",
            request=request,
            organization_id=share.organization_id,
        )
        await create_notification(
            db=db,
            user_id=share.created_by_id,
            event_type=NotificationEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
            title="Unauthorized Access Attempt Blocked",
            message=f"{current_user.email} tried to open '{share.document.title}', which was shared with someone else.",
            document_id=share.document_id,
            share_id=share.id,
            organization_id=share.organization_id,
        )
        return ViewerSessionResponse(
            status=ShareAccessResult.NOT_YOUR_SHARE,
            message="This document was shared with a specific team member. Sign in with the right account to open it."
        )

    # Allow Owner/Admin to view or recipient to view
    effective_user = share.recipient_user if (current_user.role_name in ("Owner", "Admin") and share.recipient_user) else current_user
    return await _build_share_session_response(
        share=share,
        current_user=effective_user,
        verified_email=current_user.email,
        token_h=share.token_hash,
        request=request,
        db=db
    )


@router.post("/internal/{share_id}/session")
async def create_internal_view_session(
    share_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Consumes 1 view atomically, creates a view session, and returns the session token."""
    stmt = (
        select(Share)
        .where(
            and_(
                Share.id == share_id,
                Share.organization_id == current_user.organization_id,
                Share.share_type == ShareType.INTERNAL
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal share not found.")

    if share.recipient_user_id != current_user.id and current_user.role_name not in ("Owner", "Admin") and share.created_by_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access refused: not your share.")

    status_str, _ = evaluate_share_status(share, current_user, current_user.email)
    if status_str != ShareAccessResult.VALID:
        status_code = status.HTTP_410_GONE if status_str in (
            ShareAccessResult.EXPIRED,
            ShareAccessResult.ALREADY_USED,
            ShareAccessResult.MAX_VIEWS_REACHED,
            ShareAccessResult.REVOKED
        ) else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail=f"Access refused: {status_str}")

    # Extract all necessary scalar values before atomic update & commit
    s_id = share.id
    s_org_id = share.organization_id
    s_created_by_id = share.created_by_id
    s_doc_id = share.document_id
    s_doc_title = share.document.title if share.document else "Document"
    s_is_view_once = share.is_view_once
    s_time_limit = share.time_limit_seconds
    s_first_opened = share.first_opened_at
    s_views_used = share.views_used

    now = get_server_utc()
    if s_is_view_once:
        update_stmt = (
            update(Share)
            .where(and_(Share.id == s_id, Share.is_used == False, Share.views_used < 1))
            .values(
                views_used=Share.views_used + 1,
                is_used=True,
                first_opened_at=func.coalesce(Share.first_opened_at, now)
            )
        )
    else:
        update_stmt = (
            update(Share)
            .where(and_(
                Share.id == s_id,
                or_(Share.max_views.is_(None), Share.views_used < Share.max_views),
                Share.is_revoked == False
            ))
            .values(
                views_used=Share.views_used + 1,
                first_opened_at=func.coalesce(Share.first_opened_at, now)
            )
        )

    res = await db.execute(update_stmt)
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This link was set to open only once and has already been viewed." if s_is_view_once else "Access limit reached or link expired."
        )

    await record_audit_event(
        db=db,
        action=AuditAction.OPEN,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=s_doc_id,
        share_id=s_id,
        details=f"Created view session. View-once: {s_is_view_once}",
        request=request,
        organization_id=s_org_id,
    )

    if s_first_opened is None:
        try:
            await create_notification(
                db=db,
                user_id=s_created_by_id,
                event_type=NotificationEventType.DOC_OPENED,
                title="Document Opened",
                message=f"{current_user.full_name or current_user.email} opened '{s_doc_title}'.",
                document_id=s_doc_id,
                share_id=s_id,
                organization_id=s_org_id,
            )
        except Exception:
            pass

    session_id, expires_at, duration = create_view_session(
        share_id=s_id,
        user_id=current_user.id,
        client_ip=request.client.host if request.client else None,
        time_limit_seconds=s_time_limit,
        is_view_once=s_is_view_once
    )

    await event_bus.publish(
        "share.opened",
        {"share_id": s_id, "views_used": s_views_used + 1, "is_used": s_is_view_once, "first_opened_at": now.isoformat()},
        organization_id=s_org_id
    )

    return {
        "session_id": session_id,
        "expires_at": expires_at.isoformat(),
        "seconds_remaining": duration
    }


@router.get("/internal/{share_id}/content")
async def get_internal_share_content(
    share_id: int,
    request: Request,
    session_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Streams internal decrypted PDF content for canvas viewer."""
    stmt = (
        select(Share)
        .where(
            and_(
                Share.id == share_id,
                Share.organization_id == current_user.organization_id,
                Share.share_type == ShareType.INTERNAL
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal share not found.")

    if share.recipient_user_id != current_user.id and current_user.role_name not in ("Owner", "Admin") and share.created_by_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access refused: not your share.")

    if session_id:
        if not validate_view_session(session_id, share.id, request.client.host if request.client else None):
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="View session expired or invalid.")
        return await _stream_session_bytes(share, db)

    return await _stream_share_bytes(share, current_user, current_user.email, request, db)


@router.get("/internal/{share_id}/download")
async def download_internal_share(
    share_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Watermarked download for internal shares (when permitted)."""
    stmt = (
        select(Share)
        .where(
            and_(
                Share.id == share_id,
                Share.organization_id == current_user.organization_id,
                Share.share_type == ShareType.INTERNAL
            )
        )
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal share not found.")

    if share.access_mode != AccessMode.ALLOW_DOWNLOAD:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Download not permitted for this share.")

    return await download_watermarked_document(share.token_hash, request, current_user, db, is_token_hash=True)


# ==============================================================================
# 2. OWNER PREVIEW ROUTES (/viewer/doc/:documentId)
# ==============================================================================
@router.get("/doc/{document_id}/status", response_model=ViewerSessionResponse)
async def get_document_preview_status(
    document_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Allows document owners and admins to preview their files with audit logging."""
    stmt = (
        select(Document)
        .where(
            and_(
                Document.id == document_id,
                Document.organization_id == current_user.organization_id
            )
        )
        .options(selectinload(Document.owner))
    )
    doc = (await db.execute(stmt)).scalars().first()
    if not doc:
        return ViewerSessionResponse(
            status="NOT_FOUND",
            message="This document does not exist or has been removed."
        )

    is_owner = (doc.owner_id == current_user.id)
    can_view_all = user_has_permission(current_user, "documents.view_all_in_scope")

    if not is_owner and not can_view_all and current_user.role_name not in ("Owner", "Admin"):
        return ViewerSessionResponse(
            status="NO_PERMISSION",
            message="You don't have permission to view this document."
        )

    await record_audit_event(
        db=db,
        action=AuditAction.PREVIEW,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Previewed document '{doc.title}'",
        request=request,
        organization_id=current_user.organization_id,
    )

    can_reveal = user_has_permission(current_user, "documents.reveal_sensitive")
    redacted_findings = await _get_redacted_findings_for_safe_copy(db, doc)

    return ViewerSessionResponse(
        status="VALID",
        document_title=doc.title,
        document_id=doc.id,
        sender_name=doc.owner.full_name if doc.owner else "Owner",
        viewer_name=current_user.full_name,
        viewer_email=current_user.email,
        viewer_ip=request.client.host if request.client else "127.0.0.1",
        tracking_hash="OWNER-PREVIEW",
        access_mode=AccessMode.VIEW_ONLY,
        strict_viewing=False,
        is_owner_preview=True,
        is_safe_copy=bool(doc.is_safe_copy),
        is_password_protected=bool(doc.is_password_protected),
        parent_document_id=doc.parent_document_id,
        can_reveal_sensitive=can_reveal,
        redacted_findings=redacted_findings,
        message="Document Preview"
    )


@router.get("/doc/{document_id}/content")
async def get_document_preview_content(
    document_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Streams decrypted document bytes for owner preview."""
    stmt = (
        select(Document)
        .where(
            and_(
                Document.id == document_id,
                Document.organization_id == current_user.organization_id
            )
        )
    )
    doc = (await db.execute(stmt)).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    is_owner = (doc.owner_id == current_user.id)
    can_view_all = user_has_permission(current_user, "documents.view_all_in_scope")
    if not is_owner and not can_view_all and current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No preview permission.")

    decrypted_stream = await _load_canvas_pdf_stream(db, doc)

    return StreamingResponse(
        decrypted_stream,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename={doc.original_filename}",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
    )


# ==============================================================================
# 3. EXTERNAL LINK ROUTES (/s/:token and legacy /share/:token)
# ==============================================================================
@router.get("/s/{token}/status", response_model=ViewerSessionResponse)
@router.get("/{token}/status", response_model=ViewerSessionResponse)
async def get_view_status(
    token: str,
    request: Request,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Evaluates external or legacy share status.
    Visiting this endpoint NEVER starts the timer or increments view counts.
    """
    token_h = hash_token(token)
    stmt = (
        select(Share)
        .where(Share.token_hash == token_h)
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()

    verified_email = get_otp_session_email(request, token_h)
    return await _build_share_session_response(
        share=share,
        current_user=current_user,
        verified_email=verified_email,
        token_h=token_h,
        request=request,
        db=db
    )


@router.post("/s/{token}/otp/request", response_model=GenericResponse)
@router.post("/{token}/otp/request", response_model=GenericResponse)
async def request_view_otp(
    token: str,
    payload: OTPRequestSchema,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Request 6-digit OTP code for external link access."""
    token_h = hash_token(token)
    stmt = (
        select(Share)
        .where(Share.token_hash == token_h)
        .options(selectinload(Share.document))
    )
    share = (await db.execute(stmt)).scalars().first()
    masked = mask_email_address(payload.email)

    if not share or share.share_type != ShareType.LINK or not share.requires_otp:
        return GenericResponse(
            success=True,
            message="If this address is allowed, a code has been sent.",
            masked_email=masked,
            retry_after=60,
        )

    ip = request.client.host if request.client else "127.0.0.1"
    success, message, retry_after = await request_otp_for_share(
        db=db,
        share=share,
        email=payload.email,
        turnstile_token=payload.turnstile_token,
        client_ip=ip
    )

    await record_audit_event(
        db=db,
        action=AuditAction.OTP_REQUEST,
        result="SUCCESS" if success else "BLOCKED",
        actor_email=payload.email,
        document_id=share.document_id,
        share_id=share.id,
        details=f"OTP request outcome: {message}",
        request=request,
        organization_id=share.organization_id,
    )

    return GenericResponse(
        success=success,
        message=message,
        masked_email=masked,
        retry_after=retry_after if retry_after is not None else 60,
    )


@router.post("/s/{token}/otp/verify", response_model=GenericResponse)
@router.post("/{token}/otp/verify", response_model=GenericResponse)
async def verify_view_otp(
    token: str,
    payload: OTPVerifySchema,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """Verify 6-digit OTP code."""
    token_h = hash_token(token)
    stmt = select(Share).where(Share.token_hash == token_h)
    share = (await db.execute(stmt)).scalars().first()

    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid share token.")

    is_valid, msg = await verify_otp_code(
        db=db,
        share_id=share.id,
        email=payload.email,
        submitted_code=payload.code
    )

    if not is_valid:
        await record_audit_event(
            db=db,
            action=AuditAction.OTP_FAIL,
            result="FAILURE",
            actor_email=payload.email,
            document_id=share.document_id,
            share_id=share.id,
            details=f"OTP verification failed: {msg}",
            request=request,
            organization_id=share.organization_id,
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    set_otp_session_cookie(response, token_h, payload.email.strip().lower())

    await record_audit_event(
        db=db,
        action=AuditAction.LOGIN,
        result="SUCCESS",
        actor_email=payload.email,
        document_id=share.document_id,
        share_id=share.id,
        details="OTP verified successfully for external link access.",
        request=request,
        organization_id=share.organization_id,
    )

    return GenericResponse(success=True, message="Verification confirmed.")


@router.post("/s/{token}/session")
@router.post("/{token}/session")
async def create_external_view_session(
    token: str,
    request: Request,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Consumes 1 view atomically, creates a view session, and returns the session token."""
    token_h = hash_token(token)
    stmt = (
        select(Share)
        .where(or_(Share.token_hash == token_h, Share.token_hash == token))
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid document link.")

    actual_token_hash = share.token_hash
    verified_email = get_otp_session_email(request, actual_token_hash)
    status_str, _ = evaluate_share_status(share, current_user, verified_email)
    if status_str != ShareAccessResult.VALID:
        status_code = status.HTTP_410_GONE if status_str in (
            ShareAccessResult.EXPIRED,
            ShareAccessResult.ALREADY_USED,
            ShareAccessResult.MAX_VIEWS_REACHED,
            ShareAccessResult.REVOKED
        ) else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail=f"Access refused: {status_str}")

    # Extract scalar values before update and commit
    s_id = share.id
    s_org_id = share.organization_id
    s_created_by_id = share.created_by_id
    s_doc_id = share.document_id
    s_doc_title = share.document.title if share.document else "Document"
    s_is_view_once = share.is_view_once
    s_time_limit = share.time_limit_seconds
    s_first_opened = share.first_opened_at
    s_views_used = share.views_used
    s_recipient_email = share.recipient_email

    now = get_server_utc()
    if s_is_view_once:
        update_stmt = (
            update(Share)
            .where(and_(Share.id == s_id, Share.is_used == False, Share.views_used < 1))
            .values(
                views_used=Share.views_used + 1,
                is_used=True,
                first_opened_at=func.coalesce(Share.first_opened_at, now)
            )
        )
    else:
        update_stmt = (
            update(Share)
            .where(and_(
                Share.id == s_id,
                or_(Share.max_views.is_(None), Share.views_used < Share.max_views),
                Share.is_revoked == False
            ))
            .values(
                views_used=Share.views_used + 1,
                first_opened_at=func.coalesce(Share.first_opened_at, now)
            )
        )

    res = await db.execute(update_stmt)
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This link was set to open only once and has already been viewed." if s_is_view_once else "Access limit reached or link expired."
        )

    actor_email = current_user.email if current_user else (verified_email or s_recipient_email)
    actor_id = current_user.id if current_user else None
    await record_audit_event(
        db=db,
        action=AuditAction.OPEN,
        result="SUCCESS",
        actor_id=actor_id,
        actor_email=actor_email,
        document_id=s_doc_id,
        share_id=s_id,
        details=f"Created view session. View-once: {s_is_view_once}",
        request=request,
        organization_id=s_org_id,
    )

    viewer_identity = current_user.full_name if current_user else (verified_email or s_recipient_email or "Recipient")
    if s_first_opened is None:
        try:
            await create_notification(
                db=db,
                user_id=s_created_by_id,
                event_type=NotificationEventType.DOC_OPENED,
                title="Document Opened",
                message=f"{viewer_identity} opened '{s_doc_title}'.",
                document_id=s_doc_id,
                share_id=s_id,
                organization_id=s_org_id,
            )
        except Exception:
            pass

    session_id, expires_at, duration = create_view_session(
        share_id=s_id,
        user_id=actor_id,
        client_ip=request.client.host if request.client else None,
        time_limit_seconds=s_time_limit,
        is_view_once=s_is_view_once
    )

    await event_bus.publish(
        "share.opened",
        {"share_id": s_id, "views_used": s_views_used + 1, "is_used": s_is_view_once, "first_opened_at": now.isoformat()},
        organization_id=s_org_id
    )

    return {
        "session_id": session_id,
        "expires_at": expires_at.isoformat(),
        "seconds_remaining": duration
    }


@router.get("/s/{token}/content")
@router.get("/{token}/content")
async def get_document_content(
    token: str,
    request: Request,
    session_id: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Streams decrypted PDF content directly from memory to canvas viewer."""
    token_h = hash_token(token)
    stmt = (
        select(Share)
        .where(or_(Share.token_hash == token_h, Share.token_hash == token))
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid document link.")

    if session_id:
        if not validate_view_session(session_id, share.id, request.client.host if request.client else None):
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="View session expired or invalid.")
        return await _stream_session_bytes(share, db)

    actual_token_hash = share.token_hash
    verified_email = get_otp_session_email(request, actual_token_hash)
    return await _stream_share_bytes(share, current_user, verified_email, request, db)


@router.get("/s/{token}/download")
@router.get("/{token}/download")
async def download_watermarked_document(
    token: str,
    request: Request,
    current_user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    is_token_hash: bool = False
):
    """Downloads watermarked copy of document (ONLY when sender and risk policy allow)."""
    token_h = token if is_token_hash else hash_token(token)
    stmt = (
        select(Share)
        .where(or_(Share.token_hash == token_h, Share.token_hash == token))
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
    )
    share = (await db.execute(stmt)).scalars().first()

    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid document link.")

    if share.access_mode != AccessMode.ALLOW_DOWNLOAD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The sender has restricted this document to viewing only. Downloads are not permitted."
        )

    doc = share.document
    if doc and not doc.is_safe_copy and doc.risk_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Downloads are disabled for High and Critical risk original documents."
        )

    actual_token_hash = share.token_hash
    verified_email = get_otp_session_email(request, actual_token_hash)
    status_str, _ = evaluate_share_status(share, current_user, verified_email)

    if status_str != ShareAccessResult.VALID:
        status_code = status.HTTP_410_GONE if status_str in (
            ShareAccessResult.EXPIRED,
            ShareAccessResult.ALREADY_USED,
            ShareAccessResult.MAX_VIEWS_REACHED,
            ShareAccessResult.REVOKED
        ) else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail=f"Download refused: {status_str}")

    now = get_server_utc()

    if share.first_opened_at is None:
        share.first_opened_at = now
        await db.commit()

    share.views_used += 1
    if share.is_view_once:
        share.is_used = True
    await db.commit()

    if share.share_type == ShareType.INTERNAL:
        downloader_name = current_user.full_name if current_user else "Authorized Recipient"
        downloader_email = current_user.email if current_user else "internal@recipient.test"
    else:
        downloader_email = verified_email or share.recipient_email or "external@recipient.test"
        downloader_name = downloader_email.split("@")[0].replace(".", " ").title()

    dl_id = generate_dl_id()

    actor_id = current_user.id if current_user else None
    await record_audit_event(
        db=db,
        action=AuditAction.DOWNLOAD,
        result="SUCCESS",
        actor_id=actor_id,
        actor_email=downloader_email,
        document_id=share.document_id,
        share_id=share.id,
        details=f"Watermarked download generated. DL-ID: {dl_id}, Downloader: {downloader_name} <{downloader_email}>",
        request=request,
        organization_id=share.organization_id,
    )

    decrypted_stream = load_decrypted_document(
        stored_filename=doc.stored_filename,
        iv_hex=doc.encryption_iv,
        tag_hex=doc.encryption_tag
    )

    # If the document is already AES-256 password-encrypted (pypdf), stream it directly so password protection remains intact
    if doc.is_password_protected:
        safe_filename = f"PROTECTED_{dl_id}_{doc.original_filename}"
        return StreamingResponse(
            decrypted_stream,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"',
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache"
            }
        )

    watermarked_stream = apply_download_watermark(
        pdf_stream=decrypted_stream,
        downloader_name=downloader_name,
        downloader_email=downloader_email,
        timestamp=now,
        dl_id=dl_id
    )

    safe_filename = f"WATERMARKED_{dl_id}_{doc.original_filename}"

    return StreamingResponse(
        watermarked_stream,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
    )
