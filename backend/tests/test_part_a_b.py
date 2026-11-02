import io
import re
import csv
import json
import pytest
import pytest_asyncio
import fitz  # PyMuPDF
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.models import Document, DocumentFinding, AuditLog, Share, Organization
from app.services.scanner.recognizers import (
    verhoeff_validate,
    verhoeff_generate,
    luhn_validate,
    mask_sensitive_value,
    run_custom_recognizers,
)
from app.services.scanner.risk import calculate_risk_score, score_to_risk_level
from app.services.scanner.detector import scan_pdf_bytes_in_memory
from app.services.scanner.redactor import create_redacted_pdf_bytes
from app.api.audit import sanitize_csv_cell
from app.services.mailpit_dev import get_messages, clear_messages
import app.seed as seed_mod
from tests.conftest import test_engine, TestAsyncSessionLocal


_MODULE_SEEDED = False


@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_test_db():
    """
    Override conftest's per-function wipe so the full PART B8 seed runs once for this module.
    """
    global _MODULE_SEEDED
    from app.core.rate_limiter import rate_limiter
    rate_limiter.reset()
    if not _MODULE_SEEDED:
        seed_mod.engine = test_engine
        seed_mod.AsyncSessionLocal = TestAsyncSessionLocal
        await seed_mod.seed_database()
        _MODULE_SEEDED = True
    yield


# =====================================================================
# 1. UNIT TESTS
# =====================================================================

def test_aadhaar_verhoeff_checksum():
    valid_aadhaar_formatted = verhoeff_generate("48291037462")
    valid_digits = valid_aadhaar_formatted.replace(" ", "")
    assert len(valid_digits) == 12
    assert verhoeff_validate(valid_digits) is True

    # Flip last digit -> invalid Verhoeff checksum
    flipped_last = str((int(valid_digits[-1]) + 1) % 10)
    invalid_aadhaar = valid_digits[:-1] + flipped_last
    assert verhoeff_validate(invalid_aadhaar) is False

    # First digit 0 or 1 is invalid for Aadhaar
    assert verhoeff_validate("123456789012") is False


def test_pan_regex_and_context_boost():
    text_no_ctx = "Reference code ABCDE1234F recorded."
    text_with_ctx = "Income Tax Permanent Account Number (PAN): ABCDE1234F."

    findings_no_ctx = [f for f in run_custom_recognizers(text_no_ctx) if f.entity_type == "IN_PAN"]
    findings_with_ctx = [f for f in run_custom_recognizers(text_with_ctx) if f.entity_type == "IN_PAN"]

    assert len(findings_no_ctx) == 1
    assert len(findings_with_ctx) == 1
    assert findings_with_ctx[0].confidence > findings_no_ctx[0].confidence


def test_credit_card_luhn_check():
    assert luhn_validate("4532015112830366") is True
    assert luhn_validate("4532015112830367") is False


def test_risk_score_formula_diminishing_cooccurrence_spread_and_cap():
    # Single low-weight finding -> LOW
    low_res = calculate_risk_score(
        findings=[
            {
                "entity_type": "PERSON",
                "category": "Identity",
                "value_hash": "h1",
                "confidence": 0.85,
                "page_number": 1,
            }
        ],
        full_text="Team agenda with Priya.",
    )
    assert 0 <= low_res["risk_score"] <= 25
    assert low_res["risk_level"] == "LOW"

    # Co-occurrence (Name + Aadhaar + Bank Account) + Multi-page spread -> HIGH/CRITICAL
    high_findings = [
        {"entity_type": "PERSON", "category": "Identity", "value_hash": "p1", "confidence": 0.95, "page_number": 1},
        {"entity_type": "IN_AADHAAR", "category": "Identity", "value_hash": "a1", "confidence": 0.95, "page_number": 1},
        {"entity_type": "IN_AADHAAR", "category": "Identity", "value_hash": "a2", "confidence": 0.95, "page_number": 2},
        {"entity_type": "BANK_ACCOUNT", "category": "Financial", "value_hash": "b1", "confidence": 0.90, "page_number": 3},
        {"entity_type": "SECRETS", "category": "Credentials", "value_hash": "s1", "confidence": 0.99, "page_number": 4},
    ]
    crit_res = calculate_risk_score(
        findings=high_findings,
        full_text="CONFIDENTIAL payroll salary CTC bank account aadhaar.",
    )
    assert crit_res["risk_score"] >= 76
    assert crit_res["risk_score"] <= 100
    assert crit_res["risk_level"] == "CRITICAL"
    labels = " ".join(b["label"] for b in crit_res["risk_breakdown"])
    assert "exposure" in labels.lower() or "aadhaar" in labels.lower()


def test_value_masking_never_leaks_raw():
    assert mask_sensitive_value("IN_AADHAAR", "4921 8430 4821") == "XXXX XXXX 4821"
    assert mask_sensitive_value("IN_PAN", "ABCDE1234F") == "ABCDE****F"
    assert mask_sensitive_value("EMAIL_ADDRESS", "arjun@northwind.test") == "a****@northwind.test"
    secret_masked = mask_sensitive_value("SECRETS", "AKIAIOSFODNN7EXAMPLE")
    assert "AKIAIOSFODNN7EXAMPLE" not in secret_masked


def test_true_pdf_redaction_removes_text_and_metadata():
    doc = fitz.open()
    page = doc.new_page()
    formatted = verhoeff_generate("56781234901")
    digits_only = formatted.replace(" ", "")
    page.insert_text((72, 100), f"Employee Aadhaar: {formatted}", fontsize=12)
    doc.set_metadata({"author": "Secret Author", "title": "Confidential HR"})
    raw_pdf = doc.tobytes()
    doc.close()

    scan_res = scan_pdf_bytes_in_memory(raw_pdf)
    aadhaar_findings = [f for f in scan_res["findings"] if f["entity_type"] == "IN_AADHAAR"]
    assert len(aadhaar_findings) >= 1

    redacted_pdf, count = create_redacted_pdf_bytes(
        raw_pdf,
        findings_to_redact=aadhaar_findings,
        style="blackout",
    )
    assert count >= 1

    # Verify with PyMuPDF that the underlying text is truly gone and metadata is scrubbed
    verify_doc = fitz.open(stream=redacted_pdf, filetype="pdf")
    extracted_text = "".join(p.get_text("text") for p in verify_doc)
    assert formatted not in extracted_text
    assert digits_only not in extracted_text
    assert not (verify_doc.metadata.get("author") or "").strip()
    verify_doc.close()


def test_csv_formula_injection_escaping():
    assert sanitize_csv_cell("=cmd|' /C calc'!A0") == "'=cmd|' /C calc'!A0"
    assert sanitize_csv_cell("+SUM(A1:A2)") == "'+SUM(A1:A2)"
    assert sanitize_csv_cell("-2+3") == "'-2+3"
    assert sanitize_csv_cell("@import") == "'@import"
    assert sanitize_csv_cell("\tmalicious") == "'\tmalicious"
    assert sanitize_csv_cell("Normal text") == "Normal text"


# =====================================================================
# 2. INTEGRATION TESTS (PART A & PART B)
# =====================================================================

@pytest.mark.asyncio
async def test_b8_seeded_documents_and_zero_raw_values_in_db():
    async with TestAsyncSessionLocal() as db:
        res = await db.execute(select(Document))
        docs = {d.original_filename: d for d in res.scalars().all()}

        assert "HR_Employee_Master.pdf" in docs
        assert docs["HR_Employee_Master.pdf"].risk_level == "CRITICAL"
        assert docs["HR_Employee_Master.pdf"].risk_score >= 76

        assert "Patient_Discharge_Summary.pdf" in docs
        assert docs["Patient_Discharge_Summary.pdf"].risk_level == "HIGH"
        assert 51 <= docs["Patient_Discharge_Summary.pdf"].risk_score <= 75

        assert "Vendor_Invoice_Medisupply.pdf" in docs
        assert docs["Vendor_Invoice_Medisupply.pdf"].risk_level == "MEDIUM"
        assert 26 <= docs["Vendor_Invoice_Medisupply.pdf"].risk_score <= 50

        assert "Team_Offsite_Agenda.pdf" in docs
        assert docs["Team_Offsite_Agenda.pdf"].risk_level == "LOW"
        assert docs["Team_Offsite_Agenda.pdf"].risk_score <= 25

        assert "Dev_Server_Notes.pdf" in docs
        assert docs["Dev_Server_Notes.pdf"].risk_level == "CRITICAL"
        assert docs["Dev_Server_Notes.pdf"].risk_score >= 85

        # B3: Verify zero raw sensitive values in document_findings
        f_res = await db.execute(select(DocumentFinding))
        all_findings = f_res.scalars().all()
        assert len(all_findings) > 20
        for f in all_findings:
            for raw_secret in ["ABCDE1234F", "PQRSX6789K", "AKIAIOSFODNN7EXAMPLE", "SuperSecretProdDB!2026"]:
                assert raw_secret not in (f.masked_value or "")
                assert raw_secret not in (f.masked_context or "")


@pytest.mark.asyncio
async def test_a1_org_settings_get_patch_and_regenerate():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login_res = await client.post(
            "/api/auth/login",
            json={"email": "meera@northwind.test", "password": "Test@1234"},
        )
        assert login_res.status_code == 200

        # GET /api/org/settings
        get_res = await client.get("/api/org/settings")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["name"] == "Northwind Health"
        assert data["invite_code"]
        assert "risk_policy" in data

        # PATCH /api/org/settings
        patch_res = await client.patch(
            "/api/org/settings",
            json={"max_share_duration_hours": 14, "default_watermark_text": "CONFIDENTIAL - NORTHWIND"},
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["max_share_duration_hours"] == 14

        # Regenerate invite code & restore NWH-2026 for subsequent E2E tests
        regen_res = await client.post("/api/org/invite-code/regenerate")
        assert regen_res.status_code == 200
        new_code = regen_res.json()["invite_code"]
        assert new_code != "NWH-2026"

        # Restore NWH-2026 in DB so seeded E2E tests know the code
        async with TestAsyncSessionLocal() as db:
            org = (await db.execute(select(Organization).where(Organization.slug == "northwind"))).scalar_one()
            org.invite_code = "NWH-2026"
            await db.commit()


@pytest.mark.asyncio
async def test_a3_external_otp_flow_and_mailpit_delivery():
    with open("test_tokens.json", "r") as f:
        tokens = json.load(f)
    s6_token = tokens["S6"]

    clear_messages()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Visiting status before OTP does NOT start timer or consume views
        st1 = await client.get(f"/api/view/s/{s6_token}/status")
        assert st1.status_code == 200
        body1 = st1.json()
        assert body1["status"] == "OTP_REQUIRED"
        assert body1["first_opened_at"] is None
        assert body1["views_used"] == 0

        # 2. Request OTP
        req_otp = await client.post(
            f"/api/view/s/{s6_token}/otp/request",
            json={"email": "legal@medisupply.test", "turnstile_token": "dev-token-always-pass"},
        )
        assert req_otp.status_code == 200
        otp_data = req_otp.json()
        assert otp_data["success"] is True
        assert otp_data["masked_email"] == "l***@medisupply.test"

        # 3. Read OTP from Mailpit messages store
        msgs = get_messages()
        assert len(msgs) >= 1
        m = re.search(r"\b(\d{6})\b", msgs[0].get("Text", "") or msgs[0].get("HTML", ""))
        assert m is not None
        code = m.group(1)

        # 4. Verify OTP
        ver_res = await client.post(
            f"/api/view/s/{s6_token}/otp/verify",
            json={"email": "legal@medisupply.test", "code": code},
        )
        assert ver_res.status_code == 200

        # 5. Status is now VALID and timer/views start only when content is fetched
        st2 = await client.get(f"/api/view/s/{s6_token}/status")
        assert st2.status_code == 200
        assert st2.json()["status"] == "VALID"


@pytest.mark.asyncio
async def test_a4_audit_csv_export_and_audit_log_entry():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/api/auth/login",
            json={"email": "meera@northwind.test", "password": "Test@1234"},
        )
        res = await client.get("/api/audit/export.csv?result=SUCCESS")
        assert res.status_code == 200
        assert "text/csv" in res.headers.get("content-type", "")
        assert "securedocs-audit-northwind-" in res.headers.get("content-disposition", "")

        reader = csv.reader(io.StringIO(res.text))
        rows = list(reader)
        assert rows[0] == [
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
        ]
        assert len(rows) >= 2

        # Verify AUDIT_EXPORT was written to the audit log
        logs_res = await client.get("/api/audit?action=AUDIT_EXPORT")
        assert logs_res.status_code == 200
        assert len(logs_res.json()) >= 1


@pytest.mark.asyncio
async def test_b5_b6_risk_policy_enforcement_approval_and_safe_copy():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/api/auth/login",
            json={"email": "meera@northwind.test", "password": "Test@1234"},
        )
        docs_res = await client.get("/api/documents")
        docs = {d["original_filename"]: d for d in docs_res.json()}

        crit_doc = docs["HR_Employee_Master.pdf"]
        high_doc = docs["Patient_Discharge_Summary.pdf"]

        # 1. Sharing CRITICAL document directly is blocked by Risk Policy (HTTP 403)
        blocked_res = await client.post(
            "/api/shares",
            json={
                "document_id": crit_doc["id"],
                "share_type": "LINK",
                "recipient_email": "auditor@external.test",
                "access_mode": "VIEW_ONLY",
            },
        )
        assert blocked_res.status_code == 403

        # Verify SHARE_BLOCKED_BY_RISK_POLICY in audit log
        audit_res = await client.get("/api/audit?action=SHARE_BLOCKED_BY_RISK_POLICY")
        assert len(audit_res.json()) >= 1

        # 2. Request approval for CRITICAL document -> Approve -> Share becomes active
        app_req = await client.post(
            "/api/approvals",
            json={
                "document_id": crit_doc["id"],
                "share_type": "LINK",
                "recipient_email": "board@external.test",
                "access_mode": "VIEW_ONLY",
                "is_view_once": True,
                "reason": "Annual statutory board audit review",
            },
        )
        assert app_req.status_code == 200
        approval_id = app_req.json()["id"]

        approve_res = await client.post(
            f"/api/approvals/{approval_id}/approve",
            json={"comment": "Approved for statutory audit"},
        )
        assert approve_res.status_code == 200
        assert approve_res.json()["status"] == "APPROVED"
        assert approve_res.json()["created_share_id"] is not None

        # 3. Create Redacted Safe Copy of HIGH-risk document -> Verify lower risk score -> Share externally
        sc_res = await client.post(
            f"/api/documents/{high_doc['id']}/safe-copy",
            json={"style": "blackout", "generate_password": True},
        )
        assert sc_res.status_code == 200
        sc_data = sc_res.json()
        assert sc_data["new_risk_score"] < high_doc["risk_score"]
        assert sc_data["generated_password"]

        safe_doc_id = sc_data["safe_copy"]["id"]
        ext_share_res = await client.post(
            "/api/shares",
            json={
                "document_id": safe_doc_id,
                "share_type": "LINK",
                "recipient_email": "specialist@clinic.test",
                "access_mode": "VIEW_ONLY",
                "time_limit_seconds": 600,
            },
        )
        assert ext_share_res.status_code == 200
