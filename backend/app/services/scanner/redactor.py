"""
True PDF Redaction, Metadata Scrubbing, AES-256 Password Encryption,
and PDF Risk Analysis Report Generator — backend/app/services/scanner/redactor.py (PART B — B6 & B7)
"""

import io
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple

import fitz  # PyMuPDF
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

from app.services.scanner.recognizers import decrypt_finding_value


SHORT_ENTITY_LABELS = {
    "IN_AADHAAR": "AADHAAR",
    "IN_PAN": "PAN",
    "IN_GSTIN": "GSTIN",
    "IN_IFSC": "IFSC",
    "IN_UPI_ID": "UPI",
    "IN_PASSPORT": "PASSPORT",
    "IN_VOTER_ID": "VOTER-ID",
    "IN_VEHICLE_REG": "VEHICLE",
    "IN_PHONE": "PHONE",
    "PHONE_NUMBER": "PHONE",
    "BANK_ACCOUNT": "BANK-ACCT",
    "CREDIT_CARD": "CARD",
    "IBAN_CODE": "IBAN",
    "SECRETS": "SECRET",
    "MEDICAL_LICENSE": "MED-LIC",
    "HEALTH_TERM": "HEALTH",
    "EMAIL_ADDRESS": "EMAIL",
    "PERSON": "NAME",
    "ORG": "ORG",
    "LOCATION": "LOCATION",
    "MONEY": "AMOUNT",
    "DATE_TIME": "DATE",
}


def create_redacted_pdf_bytes(
    pdf_bytes: bytes,
    findings_to_redact: List[Any],
    style: str = "blackout"
) -> Tuple[bytes, int]:
    """
    Applies TRUE PyMuPDF redaction (page.add_redact_annot + page.apply_redactions)
    so underlying text is permanently removed from the PDF structure, not merely covered.
    Also scrubs PDF metadata (author, title, XMP) and removes embedded attachments.

    Returns: (redacted_pdf_bytes, count_of_redacted_findings)
    """
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    redacted_count = 0

    # Group findings by 1-based page_number
    by_page: Dict[int, List[Any]] = {}
    for f in findings_to_redact:
        pno = getattr(f, "page_number", None) or (f.get("page_number", 1) if isinstance(f, dict) else 1)
        by_page.setdefault(int(pno), []).append(f)

    for page_idx in range(len(pdf_doc)):
        page_num = page_idx + 1
        page_findings = by_page.get(page_num, [])
        if not page_findings:
            continue

        page = pdf_doc[page_idx]
        page_has_annot = False

        for f in page_findings:
            etype = getattr(f, "entity_type", None) or (f.get("entity_type") if isinstance(f, dict) else "REDACTED")
            enc_val = getattr(f, "encrypted_value", None) or (f.get("encrypted_value") if isinstance(f, dict) else None)
            bboxes = getattr(f, "bboxes", None) or (f.get("bboxes", []) if isinstance(f, dict) else [])

            rects: List[fitz.Rect] = []
            for box in bboxes:
                if len(box) == 4:
                    rects.append(fitz.Rect(box[0], box[1], box[2], box[3]))

            # Also search by decrypted value in memory to guarantee complete removal of all occurrences/lines
            if enc_val:
                raw_val = decrypt_finding_value(enc_val)
                if raw_val and raw_val != "[REDACTED]":
                    for line in raw_val.splitlines():
                        line_clean = line.strip()
                        if len(line_clean) >= 2:
                            found_rects = page.search_for(line_clean)
                            rects.extend(found_rects)

            if not rects:
                continue

            short_lbl = SHORT_ENTITY_LABELS.get(etype, etype)
            for r in rects:
                # Expand slightly by 0.5pt to ensure all glyph edges are caught
                expanded = fitz.Rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5)
                if style == "label":
                    page.add_redact_annot(
                        expanded,
                        text=f"[{short_lbl}]",
                        fontname="helv",
                        fontsize=7,
                        fill=(0.14, 0.15, 0.17),
                        text_color=(1, 1, 1),
                    )
                else:
                    page.add_redact_annot(
                        expanded,
                        text="",
                        fill=(0.06, 0.06, 0.07),
                    )
                page_has_annot = True
            redacted_count += 1

        if page_has_annot:
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

    # Scrub metadata (author, title, creator, producer, subject, keywords) and XMP
    try:
        pdf_doc.set_metadata({})
    except Exception:
        pass
    try:
        pdf_doc.del_xml_metadata()
    except Exception:
        pass

    # Remove any embedded files
    try:
        for emb_name in list(pdf_doc.embfile_names()):
            pdf_doc.embfile_del(emb_name)
    except Exception:
        pass

    out_buf = io.BytesIO()
    pdf_doc.save(out_buf, garbage=4, deflate=True, clean=True)
    pdf_doc.close()
    return out_buf.getvalue(), redacted_count


def encrypt_pdf_with_password(pdf_bytes: bytes, password: str) -> bytes:
    """
    Encrypts PDF bytes with AES-256 password protection using pypdf strictly in memory.
    The password is NEVER stored on disk or in the database.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=password, owner_password=password, algorithm="AES-256")
    out_buf = io.BytesIO()
    writer.write(out_buf)
    return out_buf.getvalue()


def generate_risk_report_pdf(doc: Any, findings: List[Any]) -> bytes:
    """
    Generates a clean 1-2 page PDF report of the sensitive data analysis
    containing ONLY masked values (zero raw values).
    """
    buf = io.BytesIO()
    pdf = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=44,
        leftMargin=44,
        topMargin=44,
        bottomMargin=44,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, spaceAfter=6)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=16, spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=13, spaceAfter=6)
    meta = ParagraphStyle("Meta", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#5C5A52"), spaceAfter=10)

    story = []
    story.append(Paragraph(f"SecureDocs AI — Sensitive Data & Risk Analysis Report", h1))
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    story.append(Paragraph(f"Document: <b>{doc.title}</b> ({doc.original_filename}) &middot; Generated: {now_str}", meta))

    story.append(Paragraph(f"Risk Score: <b>{doc.risk_score} / 100 ({doc.risk_level})</b>", h2))
    story.append(Paragraph(doc.risk_verdict or "Risk analysis completed.", body))

    # Breakdown table
    breakdown = doc.risk_breakdown
    if breakdown:
        story.append(Paragraph("Why This Score (Risk Contributors)", h2))
        b_rows = [["Contributor", "Count", "Unique", "Avg Confidence", "Points Added"]]
        for item in breakdown:
            b_rows.append([
                str(item.get("label", "")),
                str(item.get("count", 1)),
                str(item.get("unique_count", 1)),
                f"{int(float(item.get('avg_confidence', 1.0)) * 100)}%",
                f"+{item.get('points', 0)}",
            ])
        t_b = Table(b_rows, colWidths=[240, 55, 55, 85, 75])
        t_b.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#15171A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#FFFFFF")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E6E5E0")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t_b)

    # Recommendations
    recs = doc.recommendations
    if recs:
        story.append(Paragraph("Recommended Actions", h2))
        for r in recs:
            story.append(Paragraph(f"&bull; {r}", body))

    # Findings table (masked values only!)
    if findings:
        story.append(Paragraph(f"Detected Findings ({len(findings)} total — Masked Only)", h2))
        f_rows = [["Type", "Category", "Masked Value", "Page", "Confidence"]]
        for f in findings[:60]:
            f_rows.append([
                str(f.entity_type),
                str(f.category),
                str(f.masked_value),
                f"Page {f.page_number}",
                f"{int(round(f.confidence * 100))}%",
            ])
        t_f = Table(f_rows, colWidths=[95, 80, 195, 65, 75])
        t_f.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E6B52")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#FFFFFF")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E6E5E0")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(t_f)

    pdf.build(story)
    return buf.getvalue()

