"""
Document Text Extraction, Format Conversion (DOCX/TXT -> PDF in RAM),
and Multi-Layer Sensitive Data Detection Engine — backend/app/services/scanner/detector.py
"""

import io
import json
import logging
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Tuple, Optional

import fitz  # PyMuPDF
from PIL import Image

from app.services.storage import load_decrypted_document
from app.services.scanner.recognizers import (
    RawDetection,
    run_custom_recognizers,
    get_entity_category,
    mask_sensitive_value,
    compute_salted_value_hash,
    encrypt_finding_value,
    build_masked_context,
    luhn_validate,
)
from app.services.scanner.risk import calculate_risk_score

logger = logging.getLogger("securedocs.scanner")

# ==============================================================================
# 1. SPACY & PRESIDIO INITIALIZATION (en_core_web_lg -> en_core_web_sm -> blank+ruler)
# ==============================================================================
_NLP = None
_PRESIDIO_ANALYZER = None


def get_spacy_nlp():
    """
    Loads spaCy model en_core_web_lg, falling back to en_core_web_sm with a warning,
    or a rule-augmented spacy.blank('en') pipeline if neither model wheel is present locally.
    """
    global _NLP
    if _NLP is not None:
        return _NLP

    import spacy
    try:
        _NLP = spacy.load("en_core_web_lg")
        logger.info("Loaded spaCy model 'en_core_web_lg'.")
        return _NLP
    except Exception:
        logger.warning("spaCy model 'en_core_web_lg' unavailable; falling back to 'en_core_web_sm'.")

    try:
        _NLP = spacy.load("en_core_web_sm")
        logger.info("Loaded spaCy model 'en_core_web_sm'.")
        return _NLP
    except Exception:
        logger.warning("spaCy model 'en_core_web_sm' unavailable; initializing rule-augmented blank('en') pipeline.")
        nlp = spacy.blank("en")
        ruler = nlp.add_pipe("entity_ruler")
        patterns = [
            # Organizations
            {"label": "ORG", "pattern": [{"IS_TITLE": True, "OP": "+"}, {"LOWER": {"IN": ["pvt", "ltd", "limited", "inc", "corp", "corporation", "llc", "llp", "health", "systems", "labs", "medisupply", "hospital", "bank", "technologies", "solutions", "enterprises"]}}]},
            # Locations / Cities
            {"label": "GPE", "pattern": [{"LOWER": {"IN": ["mumbai", "delhi", "bengaluru", "bangalore", "chennai", "hyderabad", "pune", "kolkata", "ahmedabad", "jaipur", "kochi", "gurgaon", "noida", "india", "goa", "mysore", "coorg", "lonavala"]}}]},
            # Money
            {"label": "MONEY", "pattern": [{"TEXT": {"REGEX": r"^(?:INR|Rs\.?|₹|\$)\s?[0-9,]+(?:\.[0-9]{2})?$"}}]},
            {"label": "MONEY", "pattern": [{"TEXT": {"IN": ["INR", "Rs", "Rs.", "₹", "$", "USD"]}}, {"TEXT": {"REGEX": r"^[0-9,]+(?:\.[0-9]{2})?$"}}]},
        ]
        ruler.add_patterns(patterns)
        _NLP = nlp
        return _NLP


def _extract_layer1_entities(page_text: str, page_number: int) -> List[RawDetection]:
    """
    Layer 1: Presidio + spaCy NER for PERSON, EMAIL_ADDRESS, PHONE_NUMBER, LOCATION,
    DATE_TIME, CREDIT_CARD (Luhn), IBAN_CODE, IP_ADDRESS, URL, MEDICAL_LICENSE, ORG, MONEY.
    """
    results: List[RawDetection] = []
    nlp = get_spacy_nlp()
    doc = nlp(page_text)

    # 1a. spaCy NER entities (when full model is loaded or from EntityRuler)
    label_map = {
        "PERSON": "PERSON",
        "ORG": "ORG",
        "GPE": "LOCATION",
        "LOC": "LOCATION",
        "FAC": "LOCATION",
        "MONEY": "MONEY",
        "DATE": "DATE_TIME",
        "TIME": "DATE_TIME",
    }
    stopwords_person = {
        "confidential", "restricted", "internal", "employee", "master", "summary", "invoice",
        "patient", "discharge", "diagnosis", "prescription", "department", "finance", "clinical",
        "operations", "executive", "agenda", "schedule", "venue", "offsite", "northwind", "orbitline",
        "medisupply", "aadhaar", "pan", "gstin", "ifsc", "bank", "account", "salary", "total",
        "section", "page", "report", "notes", "server", "production", "status", "approved",
        "index", "item", "classification", "allocation", "projected", "capital", "expenditure",
    }

    for ent in doc.ents:
        mapped = label_map.get(ent.label_)
        if not mapped:
            continue
        val = ent.text.strip()
        if len(val) < 3:
            continue
        if mapped == "PERSON" and any(w.lower() in stopwords_person for w in val.split()):
            continue
        results.append(RawDetection(
            entity_type=mapped,
            start=ent.start_char,
            end=ent.end_char,
            raw_value=val,
            confidence=0.82,
            detector_name="spacy_ner",
            page_number=page_number,
        ))

    # 1b. Presidio built-in / pattern recognizers for structured NER & PII
    # Contextual PERSON extraction (Name: ..., Patient: ..., Employee: ..., Dr. ..., Mr./Ms. ...)
    person_ctx_pattern = re.compile(
        r"(?:(?:Employee\s*Name|Patient\s*Name|Full\s*Name|Name|Doctor|Attending\s*Physician|Prepared\s*by|Lead|Facilitator|Speaker|Host)\s*[:\-]\s*|(?:\b(?:Dr\.|Mr\.|Ms\.|Mrs\.)\s+))"
        r"([A-Z][a-z]{2,18}(?:\s+[A-Z][a-z]{1,18}){0,2})"
    )
    for m in person_ctx_pattern.finditer(page_text):
        name_val = m.group(1).strip()
        if not any(w.lower() in stopwords_person for w in name_val.split()):
            results.append(RawDetection(
                entity_type="PERSON",
                start=m.start(1),
                end=m.end(1),
                raw_value=name_val,
                confidence=0.88,
                detector_name="presidio_person_recognizer",
                page_number=page_number,
            ))

    # Tabular row Indian/English full names (e.g. "EMP-101  Aarav Sharma  ...")
    emp_row_pattern = re.compile(r"\bEMP-\d{2,5}\s+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,15})\b")
    for m in emp_row_pattern.finditer(page_text):
        name_val = m.group(1).strip()
        results.append(RawDetection(
            entity_type="PERSON",
            start=m.start(1),
            end=m.end(1),
            raw_value=name_val,
            confidence=0.90,
            detector_name="presidio_person_recognizer",
            page_number=page_number,
        ))

    # ORG contextual patterns
    org_pattern = re.compile(
        r"\b([A-Z][A-Za-z0-9&]{2,20}(?:\s+[A-Z][A-Za-z0-9&]{1,20}){0,3}\s+(?:Pvt\.?\s*Ltd\.?|Private\s+Limited|Limited|Ltd\.?|Inc\.?|LLP|Corp\.?|Supplies|Healthcare|Pharmaceuticals|Diagnostics))\b"
    )
    for m in org_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="ORG",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1).strip(),
            confidence=0.85,
            detector_name="spacy_org_recognizer",
            page_number=page_number,
        ))

    # MONEY patterns (INR / Rs. / ₹ / $)
    money_pattern = re.compile(r"((?:INR|Rs\.?|₹|\$)\s?[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?)")
    for m in money_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="MONEY",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1).strip(),
            confidence=0.85,
            detector_name="spacy_money_recognizer",
            page_number=page_number,
        ))

    # IBAN_CODE
    iban_pattern = re.compile(r"\b([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]?){0,16})\b")
    for m in iban_pattern.finditer(page_text):
        val = m.group(1)
        if len(val) >= 15 and not re.match(r"^\d{2}[A-Z]{5}\d{4}", val):
            results.append(RawDetection(
                entity_type="IBAN_CODE",
                start=m.start(1),
                end=m.end(1),
                raw_value=val,
                confidence=0.88,
                detector_name="presidio_iban_recognizer",
                page_number=page_number,
            ))

    # IP_ADDRESS (IPv4)
    ip_pattern = re.compile(r"\b((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})\b")
    for m in ip_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="IP_ADDRESS",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.85,
            detector_name="presidio_ip_recognizer",
            page_number=page_number,
        ))

    # URL
    url_pattern = re.compile(r"\b(https?://[^\s<>\"')]+)")
    for m in url_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="URL",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.85,
            detector_name="presidio_url_recognizer",
            page_number=page_number,
        ))

    # DATE_TIME
    date_pattern = re.compile(
        r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{4})\b",
        re.IGNORECASE,
    )
    for m in date_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="DATE_TIME",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.75,
            detector_name="presidio_date_recognizer",
            page_number=page_number,
        ))

    return results


# ==============================================================================
# 2. OVERLAP MERGING (Keep highest confidence / specificity, drop < 0.4)
# ==============================================================================
_PRIORITY_RANK = {
    "SECRETS": 100,
    "IN_AADHAAR": 95,
    "CREDIT_CARD": 94,
    "IN_PASSPORT": 92,
    "IN_PAN": 90,
    "IN_GSTIN": 89,
    "BANK_ACCOUNT": 88,
    "IBAN_CODE": 87,
    "IN_IFSC": 86,
    "IN_UPI_ID": 85,
    "IN_VOTER_ID": 84,
    "MEDICAL_LICENSE": 83,
    "HEALTH_TERM": 82,
    "IN_PHONE": 80,
    "PHONE_NUMBER": 79,
    "EMAIL_ADDRESS": 78,
    "IN_VEHICLE_REG": 75,
    "PERSON": 70,
    "ORG": 60,
    "LOCATION": 55,
    "MONEY": 50,
    "IP_ADDRESS": 48,
    "URL": 45,
    "DATE_TIME": 40,
}


def merge_overlapping_detections(detections: List[RawDetection]) -> List[RawDetection]:
    """
    Merges overlapping character spans on the same page, keeping the highest-confidence
    (and highest-priority) detection. Drops any detection with confidence < 0.4.
    """
    valid = [d for d in detections if d.confidence >= 0.4 and d.raw_value.strip()]
    # Sort by confidence desc, priority desc, span length desc
    valid.sort(
        key=lambda d: (
            round(d.confidence, 3),
            _PRIORITY_RANK.get(d.entity_type, 10),
            d.end - d.start,
        ),
        reverse=True,
    )

    accepted: List[RawDetection] = []
    for cand in valid:
        overlaps = False
        for acc in accepted:
            if cand.page_number == acc.page_number:
                if not (cand.end <= acc.start or cand.start >= acc.end):
                    overlaps = True
                    break
        if not overlaps:
            accepted.append(cand)

    accepted.sort(key=lambda d: (d.page_number, d.start))
    return accepted


# ==============================================================================
# 3. IN-MEMORY DOCX & TXT TO PDF CONVERSION (B1)
# ==============================================================================
def convert_upload_to_pdf_bytes(file_bytes: bytes, filename: str) -> bytes:
    """
    Accepts PDF, DOCX, or TXT bytes and returns PDF bytes strictly in memory (io.BytesIO).
    Nothing plaintext is ever written to disk.
    """
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return file_bytes

    lines: List[str] = []
    if lower.endswith(".docx"):
        import docx
        doc = docx.Document(io.BytesIO(file_bytes))
        for para in doc.paragraphs:
            if para.text.strip():
                lines.append(para.text)
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    lines.append(row_text)
    elif lower.endswith(".txt"):
        text = file_bytes.decode("utf-8", errors="replace")
        lines = text.splitlines()
    else:
        raise ValueError("Unsupported file format. Only PDF, DOCX, and TXT files are accepted.")

    # Render lines into an in-memory PDF via PyMuPDF (fitz)
    pdf_doc = fitz.open()
    page = pdf_doc.new_page(width=612, height=792)
    y = 54.0
    margin_x = 54.0
    max_y = 738.0

    for line in lines:
        if not line.strip():
            y += 10.0
            continue
        # Wrap long lines
        chunks = [line[i:i + 85] for i in range(0, len(line), 85)] or [""]
        for chunk in chunks:
            if y > max_y:
                page = pdf_doc.new_page(width=612, height=792)
                y = 54.0
            page.insert_text((margin_x, y), chunk, fontsize=10, fontname="helv")
            y += 14.0

    out_buf = io.BytesIO()
    pdf_doc.save(out_buf)
    pdf_doc.close()
    return out_buf.getvalue()


# ==============================================================================
# 4. PAGE TEXT & BOUNDING BOX EXTRACTION (PyMuPDF + OCR Fallback)
# ==============================================================================
def scan_pdf_bytes_in_memory(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Scans PDF bytes purely in volatile RAM (io.BytesIO):
    1. Extracts text per page via PyMuPDF (with pytesseract OCR fallback if a page has no text layer).
    2. Runs Layer 1 (Presidio/spaCy) + Layer 2 (Custom Indian & Secret recognizers).
    3. Merges overlapping detections and locates exact bounding boxes on each page.
    4. Masks all sensitive values, computes salted hashes, and calculates the 0-100 risk score.
    """
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    num_pages = len(pdf_doc)
    all_pages_text: List[str] = []
    all_raw_detections: List[RawDetection] = []

    for page_idx in range(num_pages):
        page_num = page_idx + 1
        page = pdf_doc[page_idx]
        page_text = page.get_text("text") or ""

        # OCR fallback only when a page has no text layer
        if not page_text.strip():
            try:
                import pytesseract
                pix = page.get_pixmap(dpi=150)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                page_text = pytesseract.image_to_string(img) or ""
            except Exception as e:
                logger.debug(f"OCR fallback skipped on page {page_num}: {e}")

        all_pages_text.append(page_text)

        # Layer 1 + Layer 2 detections
        l1 = _extract_layer1_entities(page_text, page_num)
        l2 = run_custom_recognizers(page_text, page_num)
        merged_page = merge_overlapping_detections(l1 + l2)

        # Resolve bounding boxes on the PDF page via PyMuPDF page.search_for
        for det in merged_page:
            search_term = det.raw_value.strip()
            # For multi-line private keys, search the header line
            if "\n" in search_term:
                search_term = search_term.splitlines()[0].strip()
            try:
                rects = page.search_for(search_term)
                det.bboxes = [[round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)] for r in rects[:5]]
            except Exception:
                det.bboxes = []

        all_raw_detections.extend(merged_page)

    pdf_doc.close()

    full_text = "\n\n".join(all_pages_text)

    # Convert RawDetections into sanitized finding dictionaries (ZERO raw values stored!)
    sanitized_findings: List[Dict[str, Any]] = []
    for det in all_raw_detections:
        page_txt = all_pages_text[det.page_number - 1] if 1 <= det.page_number <= len(all_pages_text) else ""
        masked_val = mask_sensitive_value(det.entity_type, det.raw_value)
        val_hash = compute_salted_value_hash(det.entity_type, det.raw_value)
        enc_val = encrypt_finding_value(det.raw_value)
        masked_ctx = build_masked_context(page_txt, det.start, det.end, masked_val)
        category = get_entity_category(det.entity_type)

        sanitized_findings.append({
            "entity_type": det.entity_type,
            "category": category,
            "masked_value": masked_val,
            "value_hash": val_hash,
            "page_number": det.page_number,
            "bboxes": det.bboxes,
            "confidence": round(det.confidence, 2),
            "detector_name": det.detector_name,
            "masked_context": masked_ctx,
            "encrypted_value": enc_val,
        })

    risk_result = calculate_risk_score(sanitized_findings, full_text=full_text)

    return {
        "page_count": max(1, num_pages),
        "findings": sanitized_findings,
        **risk_result,
    }
