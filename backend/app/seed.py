import os
import shutil
import asyncio
import io
import json
import secrets
from datetime import datetime, timedelta, timezone

from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from app.core.config import settings
from app.core.database import engine, Base, AsyncSessionLocal
from app.core.security import get_password_hash, hash_token
from app.models import (
    Organization, Department, Role, User, Document, DocumentFinding, Share, ShareType,
    AccessMode, Notification, NotificationEventType, AuditLog, AuditAction,
    OrganizationInvite, UserStatus, PermissionScope, ScanStatus, DEFAULT_RISK_POLICY
)
from app.services.storage import store_encrypted_document
from app.services.scanner import scan_pdf_bytes_in_memory, verhoeff_generate


def generate_sample_pdf(
    title: str,
    doc_ref: str,
    num_pages: int,
    subtitle: str,
    paragraphs: list,
    include_financial_table: bool = True,
    extra_page_text: str = ""
) -> bytes:
    """Generates realistic multi-page PDF documents strictly in memory (io.BytesIO)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=54, leftMargin=54, topMargin=54, bottomMargin=54
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#141414'),
        spaceAfter=6
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=14,
        textColor=colors.HexColor('#6B6B66'),
        spaceAfter=18
    )
    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=15,
        textColor=colors.HexColor('#141414'),
        spaceAfter=12
    )

    story = []
    story.append(Paragraph(title, title_style))
    story.append(Paragraph(f"Ref: {doc_ref} · {subtitle}", subtitle_style))
    story.append(Spacer(1, 10))

    for p in paragraphs:
        story.append(Paragraph(p, body_style))

    if include_financial_table:
        table_data = [
            ['Index Item', 'Classification', 'FY-26 Allocation', 'FY-27 Projected', 'Status'],
            ['Capital Expenditure (CapEx)', 'Tier-1 Reserved', '$14,200,000', '$16,850,000', 'Approved'],
            ['Operational Expenditure (OpEx)', 'Unrestricted', '$8,450,000', '$9,100,000', 'Pending'],
            ['R&D / Infrastructure', 'Standard', '$5,100,000', '$6,750,000', 'Approved'],
            ['Regulatory & Compliance', 'Priority', '$1,800,000', '$2,200,000', 'Active Review']
        ]
        t = Table(table_data, colWidths=[160, 90, 85, 85, 80])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#15171A')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#ECECEA')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 7),
            ('TOPPADDING', (0, 0), (-1, 0), 7),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (2, 0), (3, -1), 'RIGHT'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8.5),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('LINEBELOW', (0, -1), (-1, -1), 1, colors.HexColor('#E6E5E0')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E6E5E0'))
        ]))
        story.append(t)
        story.append(Spacer(1, 18))

    for page_idx in range(2, num_pages + 1):
        story.append(Paragraph(f"Section {page_idx}: Operational Notes", title_style))
        story.append(Paragraph(
            extra_page_text or f"Page {page_idx} of {num_pages} contains operational notes and verification schedules for {doc_ref}.",
            body_style
        ))
        story.append(Spacer(1, 14))

    doc.build(story)
    return buf.getvalue()


async def seed_database():
    print("=" * 80)
    print("STARTING DUAL-TENANT SEEDING FOR SECUREDOCS AI")
    print("=" * 80)

    # 1. Wipe and recreate tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # 2. Reset storage directory
    if os.path.exists(settings.STORAGE_DIR):
        shutil.rmtree(settings.STORAGE_DIR)
    os.makedirs(settings.STORAGE_DIR, exist_ok=True)

    default_pw_hash = get_password_hash("Test@1234")
    now = datetime.now(timezone.utc)

    all_perms = [
        "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
        "documents.reveal_sensitive",
        "shares.create_internal", "shares.create_external", "shares.allow_download",
        "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
        "members.manage", "roles.manage", "departments.manage", "org.settings"
    ]

    async with AsyncSessionLocal() as db:
        # -------------------------------------------------------------
        # ORGANIZATION 1: Northwind Health
        # -------------------------------------------------------------
        org1 = Organization(
            name="Northwind Health",
            slug="northwind",
            brand_accent_color="#1E6B52",
            allowed_email_domains="northwind.test",
            invite_code="NWH-2026",
            settings={
                "allow_external_links": True,
                "require_otp_external": True,
                "max_share_duration_seconds": 86400,
                "allow_downloads": True,
                "default_watermark": "NORTHWIND CONFIDENTIAL",
                "risk_policy": DEFAULT_RISK_POLICY
            }
        )
        # ORGANIZATION 2: Orbitline Systems
        org2 = Organization(
            name="Orbitline Systems",
            slug="orbitline",
            brand_accent_color="#2F5F8A",
            allowed_email_domains="orbitline.test",
            invite_code="ORB-2026",
            settings={
                "allow_external_links": True,
                "require_otp_external": True,
                "max_share_duration_seconds": 86400,
                "allow_downloads": False,
                "default_watermark": "ORBITLINE PROPRIETARY",
                "risk_policy": DEFAULT_RISK_POLICY
            }
        )
        db.add_all([org1, org2])
        await db.flush()

        # Seed Built-in Roles for Org 1
        r1_owner = Role(organization_id=org1.id, name="Owner", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r1_admin = Role(organization_id=org1.id, name="Admin", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r1_dept_head = Role(organization_id=org1.id, name="Department Head", is_builtin=True, scope=PermissionScope.OWN_DEPARTMENT.value, permissions=[
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "departments.manage"
        ])
        r1_manager = Role(organization_id=org1.id, name="Manager", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=[
            "documents.upload", "documents.delete_own", "shares.create_internal",
            "shares.allow_download", "shares.revoke_any_in_scope"
        ])
        r1_employee = Role(organization_id=org1.id, name="Employee", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=["documents.upload", "documents.delete_own"])
        db.add_all([r1_owner, r1_admin, r1_dept_head, r1_manager, r1_employee])

        # Seed Built-in Roles for Org 2
        r2_owner = Role(organization_id=org2.id, name="Owner", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r2_admin = Role(organization_id=org2.id, name="Admin", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r2_dept_head = Role(organization_id=org2.id, name="Department Head", is_builtin=True, scope=PermissionScope.OWN_DEPARTMENT.value, permissions=[
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "departments.manage"
        ])
        r2_manager = Role(organization_id=org2.id, name="Manager", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=[
            "documents.upload", "documents.delete_own", "shares.create_internal",
            "shares.allow_download", "shares.revoke_any_in_scope"
        ])
        r2_employee = Role(organization_id=org2.id, name="Employee", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=["documents.upload", "documents.delete_own"])
        db.add_all([r2_owner, r2_admin, r2_dept_head, r2_manager, r2_employee])
        await db.flush()

        # Departments for Org 1
        d1_exec = Department(organization_id=org1.id, name="Executive")
        d1_finance = Department(organization_id=org1.id, name="Finance")
        d1_clinical = Department(organization_id=org1.id, name="Clinical Operations")
        # Departments for Org 2
        d2_product = Department(organization_id=org2.id, name="Product & Engineering")
        db.add_all([d1_exec, d1_finance, d1_clinical, d2_product])
        await db.flush()

        # Users for Org 1
        u_meera = User(
            organization_id=org1.id, email="meera@northwind.test", full_name="Meera Krishnan",
            hashed_password=default_pw_hash, role_id=r1_owner.id, role_name="Owner",
            department_id=d1_exec.id, department_name="Executive", status=UserStatus.ACTIVE.value,
            avatar_color="#1E6B52"
        )
        u_daniel = User(
            organization_id=org1.id, email="daniel@northwind.test", full_name="Daniel Joseph",
            hashed_password=default_pw_hash, role_id=r1_admin.id, role_name="Admin",
            department_id=d1_exec.id, department_name="Executive", status=UserStatus.ACTIVE.value,
            avatar_color="#2F5F8A"
        )
        db.add_all([u_meera, u_daniel])
        await db.flush()

        u_ananya = User(
            organization_id=org1.id, email="ananya@northwind.test", full_name="Ananya Rao",
            hashed_password=default_pw_hash, role_id=r1_dept_head.id, role_name="Department Head",
            department_id=d1_finance.id, department_name="Finance", reports_to_id=u_meera.id,
            status=UserStatus.ACTIVE.value, avatar_color="#8A6A12"
        )
        u_rahul = User(
            organization_id=org1.id, email="rahul@northwind.test", full_name="Rahul Verma",
            hashed_password=default_pw_hash, role_id=r1_dept_head.id, role_name="Department Head",
            department_id=d1_clinical.id, department_name="Clinical Operations", reports_to_id=u_meera.id,
            status=UserStatus.ACTIVE.value, avatar_color="#8A2B1E"
        )
        db.add_all([u_ananya, u_rahul])
        await db.flush()

        u_karthik = User(
            organization_id=org1.id, email="karthik@northwind.test", full_name="Karthik S",
            hashed_password=default_pw_hash, role_id=r1_manager.id, role_name="Manager",
            department_id=d1_finance.id, department_name="Finance", reports_to_id=u_ananya.id,
            status=UserStatus.ACTIVE.value, avatar_color="#2C4A6B"
        )
        db.add(u_karthik)
        await db.flush()

        u_divya = User(
            organization_id=org1.id, email="divya@northwind.test", full_name="Divya M",
            hashed_password=default_pw_hash, role_id=r1_employee.id, role_name="Employee",
            department_id=d1_finance.id, department_name="Finance", reports_to_id=u_karthik.id,
            status=UserStatus.ACTIVE.value, avatar_color="#2E7D4F"
        )
        u_farhan = User(
            organization_id=org1.id, email="farhan@northwind.test", full_name="Farhan Ali",
            hashed_password=default_pw_hash, role_id=r1_employee.id, role_name="Employee",
            department_id=d1_finance.id, department_name="Finance", reports_to_id=u_karthik.id,
            status=UserStatus.ACTIVE.value, avatar_color="#6B6B66"
        )
        u_lakshmi = User(
            organization_id=org1.id, email="lakshmi@northwind.test", full_name="Lakshmi P",
            hashed_password=default_pw_hash, role_id=r1_employee.id, role_name="Employee",
            department_id=d1_clinical.id, department_name="Clinical Operations", reports_to_id=u_rahul.id,
            status=UserStatus.ACTIVE.value, avatar_color="#B7791F"
        )
        u_sanjay = User(
            organization_id=org1.id, email="newjoiner@northwind.test", full_name="Sanjay K",
            hashed_password=default_pw_hash, role_id=r1_employee.id, role_name="Employee",
            department_id=d1_finance.id, department_name="Finance", reports_to_id=u_karthik.id,
            status=UserStatus.PENDING.value, avatar_color="#B42318"
        )
        db.add_all([u_divya, u_farhan, u_lakshmi, u_sanjay])
        await db.flush()

        d1_exec.head_id = u_meera.id
        d1_finance.head_id = u_ananya.id
        d1_clinical.head_id = u_rahul.id

        # Open invite for Org 1: intern@northwind.test
        inv_token = "INVITE_TOKEN_NWH_INTERN_2026"
        open_invite = OrganizationInvite(
            organization_id=org1.id,
            email="intern@northwind.test",
            role_id=r1_employee.id,
            department_id=d1_finance.id,
            manager_id=u_karthik.id,
            token_hash=hash_token(inv_token),
            status="PENDING",
            expires_at=now + timedelta(days=7)
        )
        db.add(open_invite)

        # Users for Org 2 (Orbitline Systems)
        u_neha = User(
            organization_id=org2.id, email="neha@orbitline.test", full_name="Neha Gupta",
            hashed_password=default_pw_hash, role_id=r2_owner.id, role_name="Owner",
            department_id=d2_product.id, department_name="Product & Engineering",
            status=UserStatus.ACTIVE.value, avatar_color="#2F5F8A"
        )
        db.add(u_neha)
        await db.flush()

        u_tom = User(
            organization_id=org2.id, email="tom@orbitline.test", full_name="Tom Mathew",
            hashed_password=default_pw_hash, role_id=r2_employee.id, role_name="Employee",
            department_id=d2_product.id, department_name="Product & Engineering", reports_to_id=u_neha.id,
            status=UserStatus.ACTIVE.value, avatar_color="#1E6B52"
        )
        db.add(u_tom)
        d2_product.head_id = u_neha.id
        await db.flush()

        # -------------------------------------------------------------
        # 3. DOCUMENTS (Part B8 5 Seed Documents + 6 Core Documents)
        # -------------------------------------------------------------
        valid_aadhaar_1 = verhoeff_generate("23456789012")
        valid_aadhaar_1_spaced = f"{valid_aadhaar_1[:4]} {valid_aadhaar_1[4:8]} {valid_aadhaar_1[8:]}"
        valid_aadhaar_2 = verhoeff_generate("45678912345")
        valid_aadhaar_2_spaced = f"{valid_aadhaar_2[:4]} {valid_aadhaar_2[4:8]} {valid_aadhaar_2[8:]}"

        doc_specs = [
            # --- B8 REQUIRED SEED TEST DOCUMENTS ---
            (
                org1.id, u_meera.id, "HR_Employee_Master.pdf", 2, "NWH-HR-2026", "Confidential — HR Only",
                [
                    "Confidential — HR Only. Annual Employee Master Directory & Compensation Register.",
                    f"1. Employee Name: Arjun Mehta | Email: arjun.mehta@northwind.test | Phone: +91 9876543210 | "
                    f"PAN Card: ABCDE1234F | Aadhaar UID: {valid_aadhaar_1_spaced} | "
                    f"Bank Account No: 00112233445566 | IFSC: HDFC0001234 | Annual Salary CTC: $145,000.",
                    f"2. Employee Name: Priya Nair | Email: priya.nair@northwind.test | Phone: +91 9123456789 | "
                    f"PAN Card: PQRSX6789K | Aadhaar UID: {valid_aadhaar_2_spaced} | "
                    f"Bank Account No: 00998877665544 | IFSC: SBIN0005678 | Annual Salary CTC: $132,000.",
                ],
                True
            ),
            (
                org1.id, u_rahul.id, "Patient_Discharge_Summary.pdf", 2, "NWH-CLN-8841", "Clinical Discharge Summary",
                [
                    "Northwind Health Clinical Department — Inpatient Discharge Record.",
                    "Patient Name: Rajesh Sharma | Date of Birth: 14/05/1979 | Contact Phone: +91 9845012345 | "
                    "Patient Email: rajesh.sharma@patient.test.",
                    "Attending Physician: Dr. Vikram Sethi (Medical License: MCI-44821, Reg: DMC-88310). "
                    "Primary Clinical Diagnosis: Acute Bronchitis (ICD-10 J20.9) and Type 2 Diabetes Mellitus (ICD-10 E11.9). "
                    "Discharge Prescription & Medication: Azithromycin 500mg once daily for 5 days, Metformin 500mg twice daily.",
                ],
                False
            ),
            (
                org1.id, u_ananya.id, "Vendor_Invoice_Medisupply.pdf", 2, "NWH-INV-5502", "Commercial Tax Invoice",
                [
                    "Supplier: Medisupply Healthcare Pvt Ltd | Buyer: Northwind Health Supply Chain.",
                    "Supplier GSTIN: 29ABCDE1234F1Z5 | Remittance Bank Account: 50200012345678 | IFSC: HDFC0000240 | "
                    "Billing Contact: billing@medisupply.test | Support Phone: +91 9880011223.",
                    "Invoice Total Amount: $42,500.00 | Tax Component: $7,650.00 | Net Payable: $50,150.00.",
                ],
                False
            ),
            (
                org1.id, u_karthik.id, "Team_Offsite_Agenda.pdf", 2, "NWH-TEAM-1126", "Quarterly Planning Workshop",
                [
                    "Quarterly Team Offsite Agenda — 15 November 2026 to 16 November 2026.",
                    "Facilitator: Meera Krishnan | Host: Daniel Joseph.",
                    "09:30 AM — Morning coffee & welcome remarks. 11:00 AM — Q1 roadmap brainstorming session. "
                    "01:00 PM — Team lunch. 02:30 PM — Retrospective and wrap-up notes.",
                ],
                False
            ),
            (
                org1.id, u_daniel.id, "Dev_Server_Notes.pdf", 2, "NWH-INFRA-9001", "Confidential — Infrastructure Runbook",
                [
                    "Confidential — Internal Only. Production Cluster Credentials & Failover Notes.",
                    "AWS Access Key ID: AKIAIOSFODNN7EXAMPLE | Primary Database password: P@ssw0rd_ProdDb2026! | "
                    "Service API Secret: api_key = \"mock_sec_key_99887766554433221100aabbccddeeff\".",
                    "Internal Gateway JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlNlY3VyZURvY3MiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c "
                    "| Bastion Host IPs: 10.24.18.105, 192.168.10.44 | "
                    "-----BEGIN RSA PRIVATE KEY----- MIIEpAIBAAKCAQEA0123456789abcdef9876543210fedcba -----END RSA PRIVATE KEY-----",
                ],
                False
            ),
            # --- EXISTING CORE DOCUMENTS (Supporting S1-S8 Shares) ---
            (
                org1.id, u_ananya.id, "Annual_Budget_FY27.pdf", 4, "NWH-FIN-2027", "Financial Operations Review",
                [
                    "Annual Budget FY27 allocation summary prepared by Finance Department (ananya@northwind.test, +91 9811122233).",
                    "Departmental budget projections and capital expenditure targets for the upcoming fiscal year."
                ],
                True
            ),
            (
                org1.id, u_karthik.id, "Payroll_Summary_Oct.pdf", 3, "NWH-PAY-1026", "October Compensation Summary",
                [
                    "October Departmental Payroll Summary prepared by Karthik S (karthik@northwind.test, +91 9822233344).",
                    "Aggregate disbursement totals across Executive, Finance, and Clinical Operations teams."
                ],
                True
            ),
            (
                org1.id, u_ananya.id, "Vendor_Contract_Medisupply.pdf", 4, "NWH-LEG-7712", "Master Supply Agreement",
                [
                    "Master Supply Agreement between Northwind Health and Medisupply (legal@medisupply.test, GSTIN: 27AABCU9603R1ZM).",
                    "Standard delivery schedules, service level covenants, and quarterly review terms."
                ],
                False
            ),
            (
                org1.id, u_rahul.id, "Clinical_SOP_v3.pdf", 5, "NWH-OPS-0319", "Standard Operating Procedures",
                [
                    "Clinical Standard Operating Procedures v3 — hygiene, shift handover, and equipment calibration checklists.",
                    "Prepared for Clinical Operations staff."
                ],
                False
            ),
            (
                org1.id, u_meera.id, "Board_Meeting_Minutes.pdf", 3, "NWH-BRD-0926", "Executive Governance Minutes",
                [
                    "Minutes of the Q3 Board of Directors Meeting (Chair: Meera Krishnan, meera@northwind.test).",
                    "Summary of strategic initiatives, hospital expansion milestones, and audit committee updates."
                ],
                False
            ),
            (
                org2.id, u_neha.id, "Product_Roadmap_2027.pdf", 4, "ORB-PRD-2027", "Platform Architecture Vision",
                [
                    "Orbitline Systems 2027 Product Roadmap prepared by Neha Gupta (neha@orbitline.test).",
                    "Key engineering milestones and release schedule."
                ],
                False
            ),
        ]

        doc_map = {}
        b8_filenames = [
            "HR_Employee_Master.pdf",
            "Patient_Discharge_Summary.pdf",
            "Vendor_Invoice_Medisupply.pdf",
            "Team_Offsite_Agenda.pdf",
            "Dev_Server_Notes.pdf",
        ]
        scan_summary_rows = []

        for org_id, owner_id, filename, pages, ref, subtitle, paragraphs, inc_table in doc_specs:
            pdf_bytes = generate_sample_pdf(
                title=filename.replace(".pdf", "").replace("_", " "),
                doc_ref=ref,
                num_pages=pages,
                subtitle=subtitle,
                paragraphs=paragraphs,
                include_financial_table=inc_table
            )
            stored_name, iv_hex, tag_hex, size = store_encrypted_document(pdf_bytes, filename)
            scan_result = scan_pdf_bytes_in_memory(pdf_bytes)
            findings_list = scan_result["findings"]

            doc_obj = Document(
                organization_id=org_id,
                title=filename.replace(".pdf", "").replace("_", " "),
                original_filename=filename,
                stored_filename=stored_name,
                file_size_bytes=size,
                mime_type="application/pdf",
                owner_id=owner_id,
                encryption_iv=iv_hex,
                encryption_tag=tag_hex,
                scan_status=ScanStatus.COMPLETED.value,
                scan_progress=100,
                risk_score=scan_result["risk_score"],
                risk_level=scan_result["risk_level"],
                risk_verdict=scan_result["risk_verdict"],
                risk_breakdown_json=json.dumps(scan_result["risk_breakdown"]),
                category_summary_json=json.dumps(scan_result["category_summary"]),
                recommendations_json=json.dumps(scan_result["recommendations"]),
                page_heatmap_json=json.dumps(scan_result["page_heatmap"]),
                page_count=scan_result["page_count"],
                scanned_at=now
            )
            db.add(doc_obj)
            await db.flush()

            for f in findings_list:
                db.add(DocumentFinding(
                    document_id=doc_obj.id,
                    organization_id=org_id,
                    entity_type=f["entity_type"],
                    category=f["category"],
                    page_number=f["page_number"],
                    confidence=f["confidence"],
                    masked_value=f["masked_value"],
                    value_hash=f["value_hash"],
                    encrypted_value=f.get("encrypted_value"),
                    masked_context=f["masked_context"],
                    bbox_json=json.dumps(f["bboxes"]),
                    detector_name=f["detector_name"]
                ))

            await db.flush()
            doc_map[filename] = doc_obj
            scan_summary_rows.append((filename, scan_result["risk_score"], scan_result["risk_level"], len(findings_list)))

        # -------------------------------------------------------------
        # 4. SHARES COVERING EVERY STATE
        # -------------------------------------------------------------
        # S1: Active timed internal (Karthik → Divya, 10 min, unopened)
        token_s1 = "TOKEN_S1_0123456789abcdef"
        s1 = Share(
            organization_id=org1.id,
            document_id=doc_map["Payroll_Summary_Oct.pdf"].id,
            created_by_id=u_karthik.id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=u_divya.id,
            token_hash=hash_token(token_s1),
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=False,
            time_limit_seconds=600,
            first_opened_at=None,
            max_views=None,
            views_used=0,
            expires_at=now + timedelta(days=7),
            is_revoked=False,
            is_used=False
        )

        # S2: View-once used (Ananya → Farhan)
        token_s2 = "TOKEN_S2_0123456789abcdef"
        s2 = Share(
            organization_id=org1.id,
            document_id=doc_map["Annual_Budget_FY27.pdf"].id,
            created_by_id=u_ananya.id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=u_farhan.id,
            token_hash=hash_token(token_s2),
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=True,
            strict_viewing=True,
            first_opened_at=now - timedelta(hours=3),
            max_views=1,
            views_used=1,
            expires_at=now + timedelta(days=7),
            is_revoked=False,
            is_used=True
        )

        # S3: Max-views with download (Karthik → Divya, 1 of 3 used)
        token_s3 = "TOKEN_S3_0123456789abcdef"
        s3 = Share(
            organization_id=org1.id,
            document_id=doc_map["Payroll_Summary_Oct.pdf"].id,
            created_by_id=u_karthik.id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=u_divya.id,
            token_hash=hash_token(token_s3),
            access_mode=AccessMode.ALLOW_DOWNLOAD,
            is_view_once=False,
            first_opened_at=now - timedelta(hours=1),
            max_views=3,
            views_used=1,
            expires_at=now + timedelta(days=7),
            is_revoked=False,
            is_used=False
        )

        # S4: Expired (Rahul → Lakshmi, expired yesterday)
        token_s4 = "TOKEN_S4_0123456789abcdef"
        s4 = Share(
            organization_id=org1.id,
            document_id=doc_map["Clinical_SOP_v3.pdf"].id,
            created_by_id=u_rahul.id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=u_lakshmi.id,
            token_hash=hash_token(token_s4),
            access_mode=AccessMode.VIEW_ONLY,
            expires_at=now - timedelta(days=1),
            is_revoked=False,
            is_used=False
        )

        # S5: Revoked (Ananya → Karthik)
        token_s5 = "TOKEN_S5_0123456789abcdef"
        s5 = Share(
            organization_id=org1.id,
            document_id=doc_map["Vendor_Contract_Medisupply.pdf"].id,
            created_by_id=u_ananya.id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=u_karthik.id,
            token_hash=hash_token(token_s5),
            access_mode=AccessMode.VIEW_ONLY,
            is_revoked=True,
            is_used=False
        )

        # S6: External OTP link (Ananya → legal@medisupply.test, view once)
        token_s6 = "TOKEN_S6_0123456789abcdef"
        s6 = Share(
            organization_id=org1.id,
            document_id=doc_map["Vendor_Contract_Medisupply.pdf"].id,
            created_by_id=u_ananya.id,
            share_type=ShareType.LINK,
            recipient_email="legal@medisupply.test",
            token_hash=hash_token(token_s6),
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=True,
            strict_viewing=True,
            requires_otp=True,
            expires_at=now + timedelta(days=7),
            is_revoked=False,
            is_used=False
        )

        # S7: External timed link (Meera → auditor@external.test, 1 hour, 2 views)
        token_s7 = "TOKEN_S7_0123456789abcdef"
        s7 = Share(
            organization_id=org1.id,
            document_id=doc_map["Board_Meeting_Minutes.pdf"].id,
            created_by_id=u_meera.id,
            share_type=ShareType.LINK,
            recipient_email="auditor@external.test",
            token_hash=hash_token(token_s7),
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=False,
            time_limit_seconds=3600,
            max_views=2,
            views_used=0,
            requires_otp=True,
            expires_at=now + timedelta(days=7),
            is_revoked=False,
            is_used=False
        )

        # S8 (Orbitline Share): Neha → Tom
        token_s8 = "TOKEN_S8_0123456789abcdef"
        s8 = Share(
            organization_id=org2.id,
            document_id=doc_map["Product_Roadmap_2027.pdf"].id,
            created_by_id=u_neha.id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=u_tom.id,
            token_hash=hash_token(token_s8),
            access_mode=AccessMode.VIEW_ONLY,
            time_limit_seconds=1800,
            expires_at=now + timedelta(days=7),
            is_revoked=False,
            is_used=False
        )

        db.add_all([s1, s2, s3, s4, s5, s6, s7, s8])
        await db.flush()

        # -------------------------------------------------------------
        # 5. NOTIFICATIONS
        # -------------------------------------------------------------
        n1 = Notification(
            organization_id=org1.id, user_id=u_karthik.id,
            event_type=NotificationEventType.DOC_OPENED,
            title="Document Opened",
            message="Divya M opened 'Payroll Summary Oct'.",
            document_id=doc_map["Payroll_Summary_Oct.pdf"].id,
            share_id=s3.id, is_read=False, created_at=now - timedelta(minutes=40)
        )
        n2 = Notification(
            organization_id=org1.id, user_id=u_ananya.id,
            event_type=NotificationEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
            title="Unauthorized Access Blocked",
            message="Someone without permission tried to open 'Vendor Contract Medisupply'.",
            document_id=doc_map["Vendor_Contract_Medisupply.pdf"].id,
            share_id=s5.id, is_read=False, created_at=now - timedelta(hours=2)
        )
        n3 = Notification(
            organization_id=org1.id, user_id=u_daniel.id,
            event_type=NotificationEventType.MEMBER_JOIN_REQUEST,
            title="New Join Request",
            message="Sanjay K (newjoiner@northwind.test) requested to join Northwind Health.",
            is_read=False, created_at=now - timedelta(hours=1)
        )
        n4 = Notification(
            organization_id=org1.id, user_id=u_meera.id,
            event_type=NotificationEventType.SCAN_COMPLETED,
            title="Critical Risk Document Detected",
            message=f"HR Employee Master scored {doc_map['HR_Employee_Master.pdf'].risk_score}/100 (CRITICAL).",
            document_id=doc_map["HR_Employee_Master.pdf"].id,
            is_read=False, created_at=now - timedelta(minutes=25)
        )
        db.add_all([n1, n2, n3, n4])

        # -------------------------------------------------------------
        # 6. 14 DAYS OF REALISTIC AUDIT & VIEW ACTIVITY
        # -------------------------------------------------------------
        audit_events = []
        views_distribution = [2, 6, 8, 3, 0, 7, 9, 4, 0, 5, 8, 1, 6, 4]
        downloads_distribution = [0, 1, 2, 0, 0, 1, 3, 1, 0, 1, 2, 0, 1, 0]
        sample_users = [u_ananya, u_karthik, u_divya, u_farhan, u_rahul]
        sample_docs = list(doc_map.values())

        for d in range(14, 0, -1):
            day_t = now - timedelta(days=d, hours=3, minutes=15)
            audit_events.append(AuditLog(
                organization_id=org1.id, action=AuditAction.LOGIN, actor_id=u_meera.id,
                actor_email=u_meera.email, ip_address="192.168.1.10", user_agent="Mozilla/5.0",
                result="SUCCESS", details="Sign in confirmed", timestamp=day_t
            ))
            v_cnt = views_distribution[14 - d]
            for v_idx in range(v_cnt):
                usr = sample_users[v_idx % len(sample_users)]
                doc = sample_docs[v_idx % len(sample_docs)]
                audit_events.append(AuditLog(
                    organization_id=org1.id, action=AuditAction.OPEN, actor_id=usr.id,
                    actor_email=usr.email, document_id=doc.id,
                    ip_address=f"192.168.1.{20 + v_idx}", user_agent="Mozilla/5.0",
                    result="SUCCESS", details=f"Document '{doc.title}' view stream opened",
                    timestamp=day_t + timedelta(minutes=10 * v_idx + 5)
                ))

            dl_cnt = downloads_distribution[14 - d]
            for dl_idx in range(dl_cnt):
                audit_events.append(AuditLog(
                    organization_id=org1.id, action=AuditAction.DOWNLOAD, actor_id=u_divya.id,
                    actor_email=u_divya.email, document_id=doc_map["Payroll_Summary_Oct.pdf"].id,
                    share_id=s3.id, ip_address="192.168.1.42", user_agent="Mozilla/5.0",
                    result="SUCCESS", details="Watermarked PDF export generated",
                    timestamp=day_t + timedelta(hours=1, minutes=15 * dl_idx)
                ))

            if d in (2, 5):
                audit_events.append(AuditLog(
                    organization_id=org1.id, action=AuditAction.FAILED_ATTEMPT,
                    actor_email="anonymous@intruder.test", document_id=doc_map["Annual_Budget_FY27.pdf"].id,
                    ip_address="203.0.113.88", user_agent="curl/7.68.0",
                    result="BLOCKED", details="Unauthorized internal share access attempt",
                    timestamp=day_t + timedelta(hours=2)
                ))

        db.add_all(audit_events)
        await db.commit()

        # Save test tokens mapping for E2E tests
        token_map = {
            "S1": token_s1,
            "S1_id": s1.id,
            "S2": token_s2,
            "S2_id": s2.id,
            "S3": token_s3,
            "S3_id": s3.id,
            "S4": token_s4,
            "S4_id": s4.id,
            "S5": token_s5,
            "S5_id": s5.id,
            "S6": token_s6,
            "S6_id": s6.id,
            "S7": token_s7,
            "S7_id": s7.id,
            "S8": token_s8,
            "S8_id": s8.id,
            "doc_budget_id": doc_map["Annual_Budget_FY27.pdf"].id,
            "doc_payroll_id": doc_map["Payroll_Summary_Oct.pdf"].id,
            "doc_hr_master_id": doc_map["HR_Employee_Master.pdf"].id,
            "doc_patient_id": doc_map["Patient_Discharge_Summary.pdf"].id,
            "doc_vendor_invoice_id": doc_map["Vendor_Invoice_Medisupply.pdf"].id,
            "doc_offsite_agenda_id": doc_map["Team_Offsite_Agenda.pdf"].id,
            "doc_dev_notes_id": doc_map["Dev_Server_Notes.pdf"].id,
            "org1_invite_token": inv_token
        }
        with open("test_tokens.json", "w") as f:
            json.dump(token_map, f, indent=2)

    frontend_base = settings.FRONTEND_URL
    print("\n" + "=" * 90)
    print("SEEDED ORGANIZATIONS, USERS & ACTIVE SHARES TABLE")
    print("=" * 90)
    print(f"ORGANIZATION 1: Northwind Health (Domain: northwind.test, Code: NWH-2026, Accent: #1E6B52)")
    print(f"  Owner:       Meera Krishnan (meera@northwind.test)")
    print(f"  Admin:       Daniel Joseph (daniel@northwind.test)")
    print(f"  Finance:     Ananya Rao (Head), Karthik S (Mgr), Divya M (Emp), Farhan Ali (Emp)")
    print(f"  Clinical:    Rahul Verma (Head), Lakshmi P (Emp)")
    print(f"  Pending:     Sanjay K (newjoiner@northwind.test)")
    print(f"  Open Invite: intern@northwind.test (Token: {inv_token})")
    print("-" * 90)
    print(f"ORGANIZATION 2: Orbitline Systems (Domain: orbitline.test, Code: ORB-2026, Accent: #2F5F8A)")
    print(f"  Owner:       Neha Gupta (neha@orbitline.test)")
    print(f"  Employee:    Tom Mathew (tom@orbitline.test)")
    print("=" * 90)
    print(f"{'ID':<4} | {'STATUS':<9} | {'TYPE':<10} | {'RECIPIENT':<26} | {'VIEWER URL'}")
    print("-" * 90)
    print(f"{'S1':<4} | {'ACTIVE':<9} | {'INTERNAL':<10} | {'Divya M (divya@)':<26} | {frontend_base}/viewer/{s1.id}")
    print(f"{'S2':<4} | {'USED':<9} | {'INTERNAL':<10} | {'Farhan Ali (farhan@)':<26} | {frontend_base}/viewer/{s2.id}")
    print(f"{'S3':<4} | {'ACTIVE':<9} | {'INTERNAL':<10} | {'Divya M (Download)':<26} | {frontend_base}/viewer/{s3.id}")
    print(f"{'S4':<4} | {'EXPIRED':<9} | {'INTERNAL':<10} | {'Lakshmi P (lakshmi@)':<26} | {frontend_base}/viewer/{s4.id}")
    print(f"{'S5':<4} | {'REVOKED':<9} | {'INTERNAL':<10} | {'Karthik S (karthik@)':<26} | {frontend_base}/viewer/{s5.id}")
    print(f"{'S6':<4} | {'ACTIVE':<9} | {'LINK+OTP':<10} | {'legal@medisupply.test':<26} | {frontend_base}/s/{token_s6}")
    print(f"{'S7':<4} | {'ACTIVE':<9} | {'LINK+OTP':<10} | {'auditor@external.test':<26} | {frontend_base}/s/{token_s7}")
    print(f"{'S8':<4} | {'ACTIVE':<9} | {'ORBITLINE':<10} | {'Tom Mathew (tom@)':<26} | {frontend_base}/viewer/{s8.id}")
    print("=" * 90)
    print("SEEDED DOCUMENTS RISK ANALYSIS SUMMARY (PART B8)")
    print("-" * 90)
    print(f"{'DOCUMENT FILENAME':<36} | {'SCORE':<8} | {'RISK LEVEL':<12} | {'FINDINGS'}")
    print("-" * 90)
    for fname, sc, lvl, fcnt in scan_summary_rows:
        marker = " *B8*" if fname in b8_filenames else ""
        print(f"{fname:<36} | {f'{sc}/100':<8} | {lvl:<12} | {fcnt} findings{marker}")
    print("=" * 90)
    print("Universal Password for all test users: Test@1234\n")


if __name__ == "__main__":
    asyncio.run(seed_database())
