import asyncio
import io
import json
import secrets
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import (
    APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Request, BackgroundTasks, Query
)
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete
from sqlalchemy.orm import selectinload

from app.core.database import get_db, AsyncSessionLocal
from app.models import (
    Document, DocumentFinding, Share, User, AuditLog, AuditAction,
    PermissionScope, ScanStatus, RiskLevel, NotificationEventType
)
from app.schemas import (
    DocumentResponse, DocumentDetailResponse, ShareResponse, AuditLogResponse,
    DocumentFindingResponse, DocumentAnalysisResponse,
    SafeCopyCreateRequest, SafeCopyCreateResponse, SensitiveRevealResponse
)
from app.api.deps import get_current_user, require_permission, user_has_permission
from app.services.storage import store_encrypted_document, load_decrypted_document
from app.services.audit_service import record_audit_event
from app.services.notification_service import create_notification
from app.services.share_service import evaluate_share_status, ShareAccessResult
from app.services.event_bus import event_bus
from app.services.scanner import (
    convert_upload_to_pdf_bytes,
    scan_pdf_bytes_in_memory,
    create_redacted_pdf_bytes,
    encrypt_pdf_with_password,
    generate_risk_report_pdf,
    decrypt_finding_value,
)

router = APIRouter(prefix="/documents", tags=["Documents"])


def serialize_finding(f: DocumentFinding) -> DocumentFindingResponse:
    return DocumentFindingResponse(
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


def serialize_document(
    doc: Document,
    active_count: int = 0,
    findings_count: int = 0,
    safe_copy_id: Optional[int] = None,
    parent_title: Optional[str] = None,
) -> DocumentResponse:
    return DocumentResponse(
        id=doc.id,
        organization_id=doc.organization_id,
        title=doc.title,
        original_filename=doc.original_filename,
        file_size_bytes=doc.file_size_bytes,
        mime_type=doc.mime_type,
        owner_id=doc.owner_id,
        owner_name=doc.owner.full_name if doc.owner else "Owner",
        active_shares_count=active_count,
        scan_status=doc.scan_status or ScanStatus.COMPLETED.value,
        scan_progress=doc.scan_progress if doc.scan_progress is not None else 100,
        scan_error=doc.scan_error,
        risk_score=doc.risk_score or 0,
        risk_level=doc.risk_level or RiskLevel.LOW.value,
        risk_verdict=doc.risk_verdict,
        risk_breakdown=doc.risk_breakdown,
        category_summary=doc.category_summary,
        recommendations=doc.recommendations,
        page_heatmap=doc.page_heatmap,
        page_count=doc.page_count or 1,
        findings_count=findings_count,
        parent_document_id=doc.parent_document_id,
        parent_document_title=parent_title,
        is_safe_copy=bool(doc.is_safe_copy),
        redaction_style=doc.redaction_style,
        is_password_protected=bool(doc.is_password_protected),
        safe_copy_id=safe_copy_id,
        scanned_at=doc.scanned_at,
        created_at=doc.created_at,
    )


async def perform_document_scan(db: AsyncSession, doc: Document, pdf_bytes: Optional[bytes] = None) -> Document:
    """
    Runs the sensitive data detection and risk scoring pipeline strictly in memory
    and persists ONLY masked values, hashes, bounding boxes, and the score breakdown.
    """
    try:
        doc.scan_status = ScanStatus.SCANNING.value
        doc.scan_progress = 40
        await db.commit()

        await event_bus.publish(
            event_type="scan.progress",
            payload={"document_id": doc.id, "scan_status": "SCANNING", "scan_progress": 40},
            organization_id=doc.organization_id,
        )

        if pdf_bytes is None:
            stream = load_decrypted_document(doc.stored_filename, doc.encryption_iv, doc.encryption_tag)
            pdf_bytes = stream.read()

        scan_data = scan_pdf_bytes_in_memory(pdf_bytes)

        # Clear any old findings for this document
        await db.execute(delete(DocumentFinding).where(DocumentFinding.document_id == doc.id))

        for item in scan_data["findings"]:
            finding = DocumentFinding(
                organization_id=doc.organization_id,
                document_id=doc.id,
                entity_type=item["entity_type"],
                category=item["category"],
                masked_value=item["masked_value"],
                value_hash=item["value_hash"],
                page_number=item["page_number"],
                bbox_json=json.dumps(item["bboxes"]),
                confidence=item["confidence"],
                detector_name=item["detector_name"],
                masked_context=item["masked_context"],
                encrypted_value=item["encrypted_value"],
            )
            db.add(finding)

        doc.page_count = scan_data["page_count"]
        doc.risk_score = scan_data["risk_score"]
        doc.risk_level = scan_data["risk_level"]
        doc.risk_verdict = scan_data["risk_verdict"]
        doc.risk_breakdown_json = json.dumps(scan_data["risk_breakdown"])
        doc.category_summary_json = json.dumps(scan_data["category_summary"])
        doc.recommendations_json = json.dumps(scan_data["recommendations"])
        doc.page_heatmap_json = json.dumps(scan_data["page_heatmap"])
        doc.scan_status = ScanStatus.COMPLETED.value
        doc.scan_progress = 100
        doc.scan_error = None
        doc.scanned_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(doc)

        await event_bus.publish(
            event_type="scan.completed",
            payload={
                "document_id": doc.id,
                "scan_status": "COMPLETED",
                "scan_progress": 100,
                "risk_score": doc.risk_score,
                "risk_level": doc.risk_level,
            },
            organization_id=doc.organization_id,
        )
        return doc
    except Exception as e:
        doc.scan_status = ScanStatus.FAILED.value
        doc.scan_progress = 0
        doc.scan_error = str(e)
        # Treat failed scan as HIGH until rescanned (B5)
        doc.risk_level = RiskLevel.HIGH.value
        doc.risk_score = max(doc.risk_score or 0, 65)
        doc.risk_verdict = "Scan failed — document is treated as High risk until rescanned."
        await db.commit()
        await event_bus.publish(
            event_type="scan.failed",
            payload={"document_id": doc.id, "scan_status": "FAILED", "error": str(e)},
            organization_id=doc.organization_id,
        )
        return doc


async def _background_scan_runner(document_id: int, pdf_bytes: bytes):
    async with AsyncSessionLocal() as db:
        doc = (await db.execute(select(Document).where(Document.id == document_id))).scalars().first()
        if doc:
            await perform_document_scan(db, doc, pdf_bytes=pdf_bytes)


@router.get("", response_model=List[DocumentResponse])
async def list_documents(
    risk_level: Optional[str] = Query(None, description="Filter by LOW, MEDIUM, HIGH, CRITICAL"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List documents within user's permitted scope in their organization.
    """
    can_view_all = user_has_permission(current_user, "documents.view_all_in_scope")
    scope = current_user.role_rel.scope if current_user.role_rel else PermissionScope.WHOLE_ORGANIZATION.value

    base_conds = [Document.organization_id == current_user.organization_id]
    if risk_level and risk_level != "ALL":
        base_conds.append(Document.risk_level == risk_level.upper())

    if current_user.role_name in ("Owner", "Admin") or (can_view_all and scope == PermissionScope.WHOLE_ORGANIZATION.value):
        stmt = (
            select(Document)
            .where(and_(*base_conds))
            .options(selectinload(Document.owner))
            .order_by(Document.created_at.desc())
        )
    elif can_view_all and (scope == PermissionScope.OWN_DEPARTMENT.value or current_user.role_name == "Department Head"):
        stmt = (
            select(Document)
            .join(User, Document.owner_id == User.id)
            .where(
                and_(
                    *base_conds,
                    User.department_id == current_user.department_id
                )
            )
            .options(selectinload(Document.owner))
            .order_by(Document.created_at.desc())
        )
    else:
        stmt = (
            select(Document)
            .where(
                and_(
                    *base_conds,
                    Document.owner_id == current_user.id
                )
            )
            .options(selectinload(Document.owner))
            .order_by(Document.created_at.desc())
        )

    docs = (await db.execute(stmt)).scalars().all()

    # Map parent->safe_copy_id
    safe_copy_map = {}
    for d in docs:
        if d.is_safe_copy and d.parent_document_id:
            safe_copy_map[d.parent_document_id] = d.id

    results = []
    for doc in docs:
        share_stmt = select(func.count(Share.id)).where(
            and_(
                Share.document_id == doc.id,
                Share.is_revoked == False
            )
        )
        active_count = (await db.execute(share_stmt)).scalar() or 0
        f_count = (await db.execute(select(func.count(DocumentFinding.id)).where(DocumentFinding.document_id == doc.id))).scalar() or 0
        sc_id = safe_copy_map.get(doc.id)
        if not sc_id:
            sc_row = (
                await db.execute(
                    select(Document.id)
                    .where(and_(Document.parent_document_id == doc.id, Document.is_safe_copy == True))
                    .order_by(Document.created_at.desc())
                )
            ).scalars().first()
            sc_id = sc_row
        results.append(serialize_document(doc, active_count, f_count, safe_copy_id=sc_id))
    return results


@router.get("/{document_id}", response_model=DocumentDetailResponse)
async def get_document_details(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns document details, all associated share links, audit history, and sensitive data findings.
    """
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    is_owner = (doc.owner_id == current_user.id)
    can_view_all = user_has_permission(current_user, "documents.view_all_in_scope")
    if not is_owner and not can_view_all and current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to document management.")

    # Fetch shares
    share_stmt = (
        select(Share)
        .where(Share.document_id == doc.id)
        .options(selectinload(Share.document), selectinload(Share.created_by), selectinload(Share.recipient_user))
        .order_by(Share.created_at.desc())
    )
    shares = (await db.execute(share_stmt)).scalars().all()
    serialized_shares = []
    for s in shares:
        st, rem = evaluate_share_status(s, None, None)
        disp_st = "REVOKED" if s.is_revoked else ("EXPIRED" if st == ShareAccessResult.EXPIRED else ("USED" if st == ShareAccessResult.ALREADY_USED else "ACTIVE"))
        serialized_shares.append(ShareResponse(
            id=s.id,
            organization_id=s.organization_id,
            document_id=s.document_id,
            document_title=doc.title,
            document_risk_level=doc.risk_level,
            document_risk_score=doc.risk_score,
            is_safe_copy=doc.is_safe_copy,
            created_by_id=s.created_by_id,
            created_by_name=s.created_by.full_name if s.created_by else "User",
            share_type=s.share_type,
            recipient_user_id=s.recipient_user_id,
            recipient_name=s.recipient_user.full_name if s.recipient_user else None,
            recipient_email=s.recipient_email or (s.recipient_user.email if s.recipient_user else None),
            token=None,
            access_mode=s.access_mode,
            is_view_once=s.is_view_once,
            strict_viewing=bool(s.strict_viewing or s.is_view_once),
            time_limit_seconds=s.time_limit_seconds,
            first_opened_at=s.first_opened_at,
            max_views=s.max_views,
            views_used=s.views_used,
            expires_at=s.expires_at,
            is_revoked=s.is_revoked,
            is_used=s.is_used,
            requires_otp=s.requires_otp,
            approval_id=s.approval_id,
            status=disp_st,
            seconds_remaining=rem,
            created_at=s.created_at
        ))

    # Fetch audit activity
    audit_stmt = (
        select(AuditLog)
        .where(AuditLog.document_id == doc.id)
        .order_by(AuditLog.timestamp.desc())
        .limit(50)
    )
    logs = (await db.execute(audit_stmt)).scalars().all()
    serialized_logs = [
        AuditLogResponse(
            id=l.id,
            organization_id=l.organization_id,
            action=l.action,
            actor_id=l.actor_id,
            actor_email=l.actor_email,
            document_id=l.document_id,
            share_id=l.share_id,
            ip_address=l.ip_address,
            user_agent=l.user_agent,
            result=l.result,
            details=l.details,
            timestamp=l.timestamp
        )
        for l in logs
    ]

    # Fetch findings
    findings_rows = (
        await db.execute(
            select(DocumentFinding)
            .where(DocumentFinding.document_id == doc.id)
            .order_by(DocumentFinding.page_number.asc(), DocumentFinding.confidence.desc())
        )
    ).scalars().all()
    serialized_findings = [serialize_finding(f) for f in findings_rows]

    # Check if a safe copy exists
    sc_id = (
        await db.execute(
            select(Document.id)
            .where(and_(Document.parent_document_id == doc.id, Document.is_safe_copy == True))
            .order_by(Document.created_at.desc())
        )
    ).scalars().first()

    parent_title = None
    if doc.parent_document_id:
        parent_title = (
            await db.execute(select(Document.title).where(Document.id == doc.parent_document_id))
        ).scalar()

    return DocumentDetailResponse(
        document=serialize_document(
            doc,
            active_count=len([s for s in shares if not s.is_revoked]),
            findings_count=len(serialized_findings),
            safe_copy_id=sc_id,
            parent_title=parent_title,
        ),
        shares=serialized_shares,
        activity=serialized_logs,
        findings=serialized_findings,
    )


@router.get("/{document_id}/analysis", response_model=DocumentAnalysisResponse)
async def get_document_risk_analysis(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns the full Sensitive Data & Risk Score Analysis for a document."""
    doc = (
        await db.execute(
            select(Document).where(
                and_(
                    Document.id == document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    findings_rows = (
        await db.execute(
            select(DocumentFinding)
            .where(DocumentFinding.document_id == doc.id)
            .order_by(DocumentFinding.page_number.asc(), DocumentFinding.confidence.desc())
        )
    ).scalars().all()

    sc_id = (
        await db.execute(
            select(Document.id)
            .where(and_(Document.parent_document_id == doc.id, Document.is_safe_copy == True))
            .order_by(Document.created_at.desc())
        )
    ).scalars().first()

    return DocumentAnalysisResponse(
        document_id=doc.id,
        title=doc.title,
        scan_status=doc.scan_status or ScanStatus.COMPLETED.value,
        scan_progress=doc.scan_progress if doc.scan_progress is not None else 100,
        scan_error=doc.scan_error,
        risk_score=doc.risk_score or 0,
        risk_level=doc.risk_level or RiskLevel.LOW.value,
        risk_verdict=doc.risk_verdict or "Scan completed.",
        risk_breakdown=doc.risk_breakdown,
        category_summary=doc.category_summary,
        recommendations=doc.recommendations,
        page_heatmap=doc.page_heatmap,
        page_count=doc.page_count or 1,
        findings=[serialize_finding(f) for f in findings_rows],
        is_safe_copy=bool(doc.is_safe_copy),
        parent_document_id=doc.parent_document_id,
        safe_copy_id=sc_id,
        scanned_at=doc.scanned_at,
    )


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    title: str = Form(""),
    file: UploadFile = File(...),
    async_mode: bool = Form(False),
    request: Request = None,
    current_user: User = Depends(require_permission("documents.upload")),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload and encrypt document at rest using AES-256-GCM.
    Supports .pdf, .docx, and .txt (converting .docx and .txt to PDF in memory).
    Scans for sensitive data and computes the 0-100 risk score.
    Zero plaintext bytes are ever written to disk.
    """
    fname = (file.filename or "document.pdf").strip()
    lower_name = fname.lower()
    if not lower_name.endswith((".pdf", ".docx", ".txt")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF, DOCX, and TXT documents are supported."
        )

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty."
        )

    try:
        pdf_bytes = convert_upload_to_pdf_bytes(file_bytes, fname)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to process document: {e}"
        )

    pdf_filename = fname if lower_name.endswith(".pdf") else f"{fname.rsplit('.', 1)[0]}.pdf"
    stored_name, iv_hex, tag_hex, size = store_encrypted_document(pdf_bytes, pdf_filename)

    clean_title = title.strip() if title and title.strip() else fname.rsplit(".", 1)[0].replace("_", " ")

    doc = Document(
        organization_id=current_user.organization_id,
        title=clean_title,
        original_filename=pdf_filename,
        stored_filename=stored_name,
        file_size_bytes=size,
        mime_type="application/pdf",
        owner_id=current_user.id,
        encryption_iv=iv_hex,
        encryption_tag=tag_hex,
        scan_status=ScanStatus.QUEUED.value,
        scan_progress=10,
        risk_score=0,
        risk_level=RiskLevel.LOW.value,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    if async_mode:
        # Leave in QUEUED/SCANNING state for background task execution
        background_tasks.add_task(_background_scan_runner, doc.id, pdf_bytes)
        f_count = 0
    else:
        # Run scan immediately in memory so response returns with complete risk score & chip
        await perform_document_scan(db, doc, pdf_bytes=pdf_bytes)
        f_count = (await db.execute(select(func.count(DocumentFinding.id)).where(DocumentFinding.document_id == doc.id))).scalar() or 0

    await record_audit_event(
        db=db,
        action=AuditAction.DOCUMENT_SCANNED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Document '{doc.title}' uploaded, encrypted, and scanned (Risk: {doc.risk_level}, Score: {doc.risk_score}/100, Findings: {f_count}).",
        request=request,
        organization_id=current_user.organization_id
    )

    doc.owner = current_user
    return serialize_document(doc, active_count=0, findings_count=f_count)


@router.post("/{document_id}/rescan", response_model=DocumentAnalysisResponse)
async def rescan_document(
    document_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Re-runs the sensitive data scanner on an existing document in memory."""
    doc = (
        await db.execute(
            select(Document).where(
                and_(
                    Document.id == document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    await perform_document_scan(db, doc)

    await record_audit_event(
        db=db,
        action=AuditAction.DOCUMENT_SCANNED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Rescanned '{doc.title}': Risk {doc.risk_level} ({doc.risk_score}/100).",
        request=request,
        organization_id=current_user.organization_id,
    )

    return await get_document_risk_analysis(document_id=doc.id, current_user=current_user, db=db)


@router.post("/{document_id}/safe-copy", response_model=SafeCopyCreateResponse)
async def create_safe_copy(
    document_id: int,
    payload: SafeCopyCreateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a TRUE redacted (and optionally AES-256 password-encrypted) Safe Copy of the document.
    Re-scans the redacted PDF to compute its reduced risk score and stores it as a linked Document.
    """
    doc = (
        await db.execute(
            select(Document)
            .where(
                and_(
                    Document.id == document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
            .options(selectinload(Document.owner))
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    is_owner = (doc.owner_id == current_user.id)
    can_view_all = user_has_permission(current_user, "documents.view_all_in_scope")
    if not is_owner and not can_view_all and current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied to create a safe copy.")

    all_findings = (
        await db.execute(select(DocumentFinding).where(DocumentFinding.document_id == doc.id))
    ).scalars().all()

    # Filter findings to redact
    selected_findings = list(all_findings)
    if payload.finding_ids is not None:
        id_set = set(payload.finding_ids)
        selected_findings = [f for f in selected_findings if f.id in id_set]
    if payload.categories:
        cat_set = {c.lower() for c in payload.categories}
        selected_findings = [f for f in selected_findings if f.category.lower() in cat_set]
    if payload.entity_types:
        type_set = {t.upper() for t in payload.entity_types}
        selected_findings = [f for f in selected_findings if f.entity_type.upper() in type_set]

    style = "label" if payload.style == "label" else "blackout"

    # Load original decrypted PDF bytes in memory
    orig_stream = load_decrypted_document(doc.stored_filename, doc.encryption_iv, doc.encryption_tag)
    orig_pdf_bytes = orig_stream.read()

    # 1. Perform TRUE PyMuPDF redaction + metadata/XMP/attachment removal
    redacted_pdf_bytes, redacted_count = create_redacted_pdf_bytes(
        pdf_bytes=orig_pdf_bytes,
        findings_to_redact=selected_findings,
        style=style,
    )

    # 2. Scan the redacted PDF bytes (before password encryption) to verify the reduced risk score!
    scan_data = scan_pdf_bytes_in_memory(redacted_pdf_bytes)

    # 3. Optional AES-256 PDF password protection via pypdf
    final_password: Optional[str] = None
    if payload.generate_password:
        final_password = f"SD-{secrets.token_urlsafe(8)}"
    elif payload.password and payload.password.strip():
        final_password = payload.password.strip()

    is_pwd_protected = bool(final_password)
    bytes_to_store = redacted_pdf_bytes
    if final_password:
        bytes_to_store = encrypt_pdf_with_password(redacted_pdf_bytes, final_password)

    safe_filename = f"Safe_Copy_{doc.original_filename}"
    stored_name, iv_hex, tag_hex, size = store_encrypted_document(bytes_to_store, safe_filename)

    safe_title = f"Safe copy of {doc.title}"
    safe_doc = Document(
        organization_id=current_user.organization_id,
        title=safe_title,
        original_filename=safe_filename,
        stored_filename=stored_name,
        file_size_bytes=size,
        mime_type="application/pdf",
        owner_id=current_user.id,
        encryption_iv=iv_hex,
        encryption_tag=tag_hex,
        scan_status=ScanStatus.COMPLETED.value,
        scan_progress=100,
        risk_score=scan_data["risk_score"],
        risk_level=scan_data["risk_level"],
        risk_verdict=scan_data["risk_verdict"],
        risk_breakdown_json=json.dumps(scan_data["risk_breakdown"]),
        category_summary_json=json.dumps(scan_data["category_summary"]),
        recommendations_json=json.dumps(scan_data["recommendations"]),
        page_heatmap_json=json.dumps(scan_data["page_heatmap"]),
        page_count=scan_data["page_count"],
        scanned_at=datetime.now(timezone.utc),
        parent_document_id=doc.id,
        is_safe_copy=True,
        redaction_style=style,
        is_password_protected=is_pwd_protected,
    )
    db.add(safe_doc)
    await db.flush()

    # Persist remaining findings on the safe copy (if any)
    for item in scan_data["findings"]:
        db.add(DocumentFinding(
            organization_id=current_user.organization_id,
            document_id=safe_doc.id,
            entity_type=item["entity_type"],
            category=item["category"],
            masked_value=item["masked_value"],
            value_hash=item["value_hash"],
            page_number=item["page_number"],
            bbox_json=json.dumps(item["bboxes"]),
            confidence=item["confidence"],
            detector_name=item["detector_name"],
            masked_context=item["masked_context"],
            encrypted_value=item["encrypted_value"],
        ))

    await db.commit()
    await db.refresh(safe_doc)
    safe_doc.owner = current_user

    await record_audit_event(
        db=db,
        action=AuditAction.SAFE_COPY_CREATED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=safe_doc.id,
        details=(
            f"Created redacted safe copy '{safe_doc.title}' from '{doc.title}' "
            f"(style={style}, redacted={redacted_count}, password_protected={is_pwd_protected}, "
            f"new_risk={safe_doc.risk_level} {safe_doc.risk_score}/100)."
        ),
        request=request,
        organization_id=current_user.organization_id,
    )

    return SafeCopyCreateResponse(
        safe_copy=serialize_document(
            safe_doc,
            active_count=0,
            findings_count=len(scan_data["findings"]),
            parent_title=doc.title,
        ),
        generated_password=final_password,
        redacted_count=redacted_count,
        new_risk_score=safe_doc.risk_score,
        new_risk_level=safe_doc.risk_level,
    )


@router.get("/{document_id}/download")
async def download_document_file(
    document_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Downloads a document or safe copy.
    Enforces B5 Risk Policy: unredacted HIGH or CRITICAL originals cannot be downloaded directly.
    """
    doc = (
        await db.execute(
            select(Document).where(
                and_(
                    Document.id == document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if not doc.is_safe_copy and doc.risk_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Direct download of {doc.risk_level.title()}-risk original documents is disabled by policy. Download a safe copy instead."
        )

    decrypted_stream = load_decrypted_document(
        stored_filename=doc.stored_filename,
        iv_hex=doc.encryption_iv,
        tag_hex=doc.encryption_tag,
    )

    await record_audit_event(
        db=db,
        action=AuditAction.DOWNLOAD,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Downloaded '{doc.title}' ({'Safe copy' if doc.is_safe_copy else 'Original'}).",
        request=request,
        organization_id=current_user.organization_id,
    )

    return StreamingResponse(
        decrypted_stream,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{doc.original_filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{document_id}/report.pdf")
async def download_risk_analysis_report_pdf(
    document_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generates and streams a 1-2 page PDF report of the sensitive data analysis with masked values only."""
    doc = (
        await db.execute(
            select(Document).where(
                and_(
                    Document.id == document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    findings_rows = (
        await db.execute(
            select(DocumentFinding)
            .where(DocumentFinding.document_id == doc.id)
            .order_by(DocumentFinding.page_number.asc(), DocumentFinding.confidence.desc())
        )
    ).scalars().all()

    pdf_bytes = generate_risk_report_pdf(doc, findings_rows)
    safe_name = f"Risk_Report_{doc.original_filename}"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/{document_id}/findings/{finding_id}/reveal", response_model=SensitiveRevealResponse)
async def reveal_sensitive_finding(
    document_id: int,
    finding_id: int,
    request: Request,
    current_user: User = Depends(require_permission("documents.reveal_sensitive")),
    db: AsyncSession = Depends(get_db)
):
    """
    Reveals a single redacted sensitive value for 10 seconds to an authorized internal user
    with 'documents.reveal_sensitive' permission. Audited with SENSITIVE_VALUE_REVEALED.
    """
    doc = (
        await db.execute(
            select(Document).where(
                and_(
                    Document.id == document_id,
                    Document.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    # Look up finding on this document or its parent document (when viewing a safe copy)
    target_doc_ids = [doc.id]
    if doc.parent_document_id:
        target_doc_ids.append(doc.parent_document_id)

    finding = (
        await db.execute(
            select(DocumentFinding).where(
                and_(
                    DocumentFinding.id == finding_id,
                    DocumentFinding.document_id.in_(target_doc_ids),
                    DocumentFinding.organization_id == current_user.organization_id,
                )
            )
        )
    ).scalars().first()
    if not finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found.")

    revealed = decrypt_finding_value(finding.encrypted_value)

    await record_audit_event(
        db=db,
        action=AuditAction.SENSITIVE_VALUE_REVEALED,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=doc.id,
        details=f"Revealed sensitive {finding.entity_type} finding #{finding.id} on page {finding.page_number} of '{doc.title}' for 10s.",
        request=request,
        organization_id=current_user.organization_id,
    )

    return SensitiveRevealResponse(
        finding_id=finding.id,
        entity_type=finding.entity_type,
        revealed_value=revealed,
        expires_in_seconds=10,
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes document and cascades shares and findings, subject to permissions."""
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
    if is_owner and not user_has_permission(current_user, "documents.delete_own"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied to delete document.")
    if not is_owner and current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied.")

    await db.delete(doc)
    await db.commit()

    await record_audit_event(
        db=db,
        action=AuditAction.REVOKE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        document_id=document_id,
        details=f"Document '{doc.title}' deleted.",
        request=request,
        organization_id=current_user.organization_id
    )
    return {"message": "Document deleted successfully."}
