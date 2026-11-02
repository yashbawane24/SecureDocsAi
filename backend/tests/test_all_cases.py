import io
import os
import re
import tempfile
import logging
from datetime import datetime, timedelta, timezone
import pytest
from pypdf import PdfReader

from app.core.config import settings
from app.core.security import hash_password, hash_token, generate_share_token, create_access_token
from app.models import (
    Organization, Role, Department, User, Document, Share, ShareType, AccessMode,
    AuditLog, AuditAction, Notification, NotificationEventType, OTPRequest,
    OrganizationInvite, UserStatus, PermissionScope
)
from app.services.storage import store_encrypted_document
from app.seed import generate_sample_pdf
from tests.conftest import TestAsyncSessionLocal

async def create_test_org_and_users():
    """Sets up two test organizations with roles and users."""
    async with TestAsyncSessionLocal() as session:
        # Org 1: Northwind
        org1 = Organization(
            name="Northwind Test",
            slug="northwind-test",
            brand_accent_color="#1E6B52",
            allowed_email_domains="northwind.test",
            invite_code="NWH-TEST"
        )
        # Org 2: Orbitline
        org2 = Organization(
            name="Orbitline Test",
            slug="orbitline-test",
            brand_accent_color="#2F5F8A",
            allowed_email_domains="orbitline.test",
            invite_code="ORB-TEST"
        )
        session.add_all([org1, org2])
        await session.flush()

        all_perms = [
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "members.manage", "roles.manage", "departments.manage", "org.settings"
        ]

        # Roles Org 1
        r1_owner = Role(organization_id=org1.id, name="Owner", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r1_admin = Role(organization_id=org1.id, name="Admin", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r1_dept_head = Role(organization_id=org1.id, name="Department Head", is_builtin=True, scope=PermissionScope.OWN_DEPARTMENT.value, permissions=[
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve", "departments.manage"
        ])
        r1_mgr = Role(organization_id=org1.id, name="Manager", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=[
            "documents.upload", "documents.delete_own", "shares.create_internal", "shares.allow_download", "shares.revoke_any_in_scope"
        ])
        r1_emp = Role(organization_id=org1.id, name="Employee", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=["documents.upload", "documents.delete_own"])

        # Roles Org 2
        r2_owner = Role(organization_id=org2.id, name="Owner", is_builtin=True, scope=PermissionScope.WHOLE_ORGANIZATION.value, permissions=all_perms)
        r2_emp = Role(organization_id=org2.id, name="Employee", is_builtin=True, scope=PermissionScope.OWN_DIRECT_REPORTS.value, permissions=["documents.upload", "documents.delete_own"])

        session.add_all([r1_owner, r1_admin, r1_dept_head, r1_mgr, r1_emp, r2_owner, r2_emp])
        await session.flush()

        # Departments
        d1_fin = Department(organization_id=org1.id, name="Finance")
        d1_eng = Department(organization_id=org1.id, name="Engineering")
        d2_prod = Department(organization_id=org2.id, name="Product")
        session.add_all([d1_fin, d1_eng, d2_prod])
        await session.flush()

        # Users Org 1
        priya = User(
            organization_id=org1.id, full_name="Priya Raman", email="priya.admin@meridian.test",
            hashed_password=hash_password("Test@1234"), role_id=r1_admin.id, role_name="Admin",
            department_id=d1_fin.id, department_name="Finance", status=UserStatus.ACTIVE.value
        )
        session.add(priya)
        await session.flush()

        arjun = User(
            organization_id=org1.id, full_name="Arjun Nair", email="arjun.mgr@meridian.test",
            hashed_password=hash_password("Test@1234"), role_id=r1_mgr.id, role_name="Manager",
            department_id=d1_fin.id, department_name="Finance", reports_to_id=priya.id,
            status=UserStatus.ACTIVE.value
        )
        session.add(arjun)
        await session.flush()

        kavya = User(
            organization_id=org1.id, full_name="Kavya Iyer", email="kavya.emp@meridian.test",
            hashed_password=hash_password("Test@1234"), role_id=r1_emp.id, role_name="Employee",
            department_id=d1_fin.id, department_name="Finance", reports_to_id=arjun.id,
            status=UserStatus.ACTIVE.value
        )
        vikram = User(
            organization_id=org1.id, full_name="Vikram Shah", email="vikram.admin@meridian.test",
            hashed_password=hash_password("Test@1234"), role_id=r1_admin.id, role_name="Admin",
            department_id=d1_eng.id, department_name="Engineering", status=UserStatus.ACTIVE.value
        )
        session.add_all([kavya, vikram])

        # Users Org 2
        neha = User(
            organization_id=org2.id, full_name="Neha Gupta", email="neha@orbitline.test",
            hashed_password=hash_password("Test@1234"), role_id=r2_owner.id, role_name="Owner",
            department_id=d2_prod.id, department_name="Product", status=UserStatus.ACTIVE.value
        )
        tom = User(
            organization_id=org2.id, full_name="Tom Mathew", email="tom@orbitline.test",
            hashed_password=hash_password("Test@1234"), role_id=r2_emp.id, role_name="Employee",
            department_id=d2_prod.id, department_name="Product", reports_to_id=neha.id,
            status=UserStatus.ACTIVE.value
        )
        session.add_all([neha, tom])
        await session.flush()

        # Documents
        pdf_bytes = generate_sample_pdf("Test Doc", "REF-01", 2, "Confidential", ["Content paragraph."])
        s_name, iv, tag, size = store_encrypted_document(pdf_bytes, "Test_Doc.pdf")
        doc1 = Document(
            organization_id=org1.id, title="Test Doc", original_filename="Test_Doc.pdf",
            stored_filename=s_name, file_size_bytes=size, owner_id=priya.id,
            encryption_iv=iv, encryption_tag=tag
        )
        s_name2, iv2, tag2, size2 = store_encrypted_document(pdf_bytes, "Vendor_NDA.pdf")
        doc_arjun = Document(
            organization_id=org1.id, title="Vendor NDA", original_filename="Vendor_NDA.pdf",
            stored_filename=s_name2, file_size_bytes=size2, owner_id=arjun.id,
            encryption_iv=iv2, encryption_tag=tag2
        )
        s_name_org2, iv_o2, tag_o2, size_o2 = store_encrypted_document(pdf_bytes, "Org2_Roadmap.pdf")
        doc_org2 = Document(
            organization_id=org2.id, title="Org2 Roadmap", original_filename="Org2_Roadmap.pdf",
            stored_filename=s_name_org2, file_size_bytes=size_o2, owner_id=neha.id,
            encryption_iv=iv_o2, encryption_tag=tag_o2
        )
        session.add_all([doc1, doc_arjun, doc_org2])
        await session.commit()

        return {
            "org1_id": org1.id, "org2_id": org2.id,
            "priya": priya, "arjun": arjun, "kavya": kavya, "vikram": vikram,
            "neha": neha, "tom": tom,
            "doc1_id": doc1.id, "doc_arjun_id": doc_arjun.id, "doc_org2_id": doc_org2.id,
            "r1_mgr": r1_mgr, "r1_emp": r1_emp
        }

@pytest.mark.asyncio
async def test_view_once_link(client):
    """View-once link works once, then returns 410 on second open."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="recipient@example.com",
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=True,
            is_used=False,
            views_used=0
        )
        session.add(share)
        await session.commit()

    resp1 = await client.get(f"/api/view/s/{token}/content")
    assert resp1.status_code == 200

    resp2 = await client.get(f"/api/view/s/{token}/content")
    assert resp2.status_code == 410

@pytest.mark.asyncio
async def test_view_session_flow(client):
    """Test: two content requests in one session = 1 view counted; a second session for a view-once share = 410; parallel session requests = only one succeeds."""
    import asyncio
    from sqlalchemy import select
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="test_session@example.com",
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=True,
            is_used=False,
            views_used=0
        )
        session.add(share)
        await session.commit()
        share_id = share.id

    # 1. Create first session
    sess_resp = await client.post(f"/api/view/s/{token}/session")
    assert sess_resp.status_code == 200
    sess_data = sess_resp.json()
    assert "session_id" in sess_data
    session_id = sess_data["session_id"]

    # 2. Two content requests in one session -> both return 200
    c1 = await client.get(f"/api/view/s/{token}/content?session_id={session_id}")
    assert c1.status_code == 200

    c2 = await client.get(f"/api/view/s/{token}/content?session_id={session_id}")
    assert c2.status_code == 200

    # Verify only 1 view counted
    async with TestAsyncSessionLocal() as session:
        sh = (await session.execute(select(Share).where(Share.id == share_id))).scalars().first()
        assert sh.views_used == 1
        assert sh.is_used is True

    # 3. A second session for a view-once share returns 410
    sess_resp2 = await client.post(f"/api/view/s/{token}/session")
    assert sess_resp2.status_code == 410

    # 4. Parallel session requests test on a fresh view-once share
    token_par = generate_share_token()
    token_par_h = hash_token(token_par)
    async with TestAsyncSessionLocal() as session:
        share_par = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="test_par@example.com",
            token_hash=token_par_h,
            access_mode=AccessMode.VIEW_ONLY,
            is_view_once=True,
            is_used=False,
            views_used=0
        )
        session.add(share_par)
        await session.commit()

    resps = await asyncio.gather(
        client.post(f"/api/view/s/{token_par}/session"),
        client.post(f"/api/view/s/{token_par}/session"),
        return_exceptions=True
    )
    print("PARALLEL RESPS:", [getattr(r, "status_code", repr(r)) for r in resps])
    statuses = [r.status_code for r in resps if hasattr(r, "status_code")]
    assert 200 in statuses
    assert 410 in statuses

@pytest.mark.asyncio
async def test_timed_share_server_enforced(client):
    """Timed share: request after server window fails even if client sends fake time."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="recipient@example.com",
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY,
            time_limit_seconds=120,
            first_opened_at=datetime.now(timezone.utc) - timedelta(seconds=130)
        )
        session.add(share)
        await session.commit()

    headers = {"X-Client-Timestamp": "2020-01-01T00:00:00Z"}
    resp = await client.get(f"/api/view/s/{token}/content", headers=headers)
    assert resp.status_code == 410

@pytest.mark.asyncio
async def test_max_views_enforced_exactly(client):
    """Max views is enforced exactly."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="recipient@example.com",
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY,
            max_views=2,
            views_used=0
        )
        session.add(share)
        await session.commit()

    resp1 = await client.get(f"/api/view/s/{token}/content")
    assert resp1.status_code == 200

    resp2 = await client.get(f"/api/view/s/{token}/content")
    assert resp2.status_code == 200

    resp3 = await client.get(f"/api/view/s/{token}/content")
    assert resp3.status_code == 410

@pytest.mark.asyncio
async def test_expiry_date_enforced(client):
    """Expiry date is enforced."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="recipient@example.com",
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1)
        )
        session.add(share)
        await session.commit()

    resp = await client.get(f"/api/view/s/{token}/content")
    assert resp.status_code == 410

@pytest.mark.asyncio
async def test_instant_revoke(client):
    """Revoke takes effect on the very next request."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="recipient@example.com",
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY,
            is_revoked=False
        )
        session.add(share)
        await session.commit()
        share_id = share.id

    resp1 = await client.get(f"/api/view/s/{token}/content")
    assert resp1.status_code == 200

    priya_token = create_access_token(data={"sub": str(data["priya"].id), "role": "Admin", "org_id": data["org1_id"]})
    revoke_resp = await client.post(f"/api/shares/{share_id}/revoke", headers={"Authorization": f"Bearer {priya_token}"})
    assert revoke_resp.status_code == 200

    resp2 = await client.get(f"/api/view/s/{token}/content")
    assert resp2.status_code == 410

@pytest.mark.asyncio
async def test_rbac_sharing_rules(client):
    """An Employee creating a share gets 403. Manager sharing outside chain gets 403."""
    data = await create_test_org_and_users()

    kavya_token = create_access_token(data={"sub": str(data["kavya"].id), "role": "Employee", "org_id": data["org1_id"]})
    resp_emp = await client.post("/api/shares", json={
        "document_id": data["doc1_id"],
        "share_type": "LINK",
        "access_mode": "VIEW_ONLY"
    }, headers={"Authorization": f"Bearer {kavya_token}"})
    assert resp_emp.status_code == 403

    arjun_token = create_access_token(data={"sub": str(data["arjun"].id), "role": "Manager", "org_id": data["org1_id"]})
    resp_mgr_outside = await client.post("/api/shares", json={
        "document_id": data["doc_arjun_id"],
        "share_type": "INTERNAL",
        "recipient_user_id": data["vikram"].id,
        "access_mode": "VIEW_ONLY"
    }, headers={"Authorization": f"Bearer {arjun_token}"})
    assert resp_mgr_outside.status_code == 403

    resp_mgr_admin = await client.post("/api/shares", json={
        "document_id": data["doc_arjun_id"],
        "share_type": "INTERNAL",
        "recipient_user_id": data["priya"].id,
        "access_mode": "VIEW_ONLY"
    }, headers={"Authorization": f"Bearer {arjun_token}"})
    assert resp_mgr_admin.status_code == 200

@pytest.mark.asyncio
async def test_internal_share_viewer_by_id(client):
    """Internal share opens via /api/view/internal/:shareId for recipient and returns 403 for others."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.INTERNAL,
            recipient_user_id=data["kavya"].id,
            token_hash=token_h,
            access_mode=AccessMode.VIEW_ONLY
        )
        session.add(share)
        await session.commit()
        share_id = share.id

    # 1. Kavya (authorized recipient) opens via internal route
    kavya_token = create_access_token(data={"sub": str(data["kavya"].id), "role": "Employee", "org_id": data["org1_id"]})
    resp_status = await client.get(f"/api/view/internal/{share_id}/status", headers={"Authorization": f"Bearer {kavya_token}"})
    assert resp_status.status_code == 200
    assert resp_status.json()["status"] == "VALID"

    resp_content = await client.get(f"/api/view/internal/{share_id}/content", headers={"Authorization": f"Bearer {kavya_token}"})
    assert resp_content.status_code == 200

    # 2. Vikram (different user) gets 403
    vikram_token = create_access_token(data={"sub": str(data["vikram"].id), "role": "Employee", "org_id": data["org1_id"]})
    resp_vikram = await client.get(f"/api/view/internal/{share_id}/content", headers={"Authorization": f"Bearer {vikram_token}"})
    assert resp_vikram.status_code == 403

@pytest.mark.asyncio
async def test_tenant_isolation_org_b_cannot_access_org_a(client):
    """Tenant isolation: user from Org B gets 404/403 for Org A documents and shares."""
    data = await create_test_org_and_users()

    # Neha (Org 2) attempts to view/access Doc 1 (Org 1)
    neha_token = create_access_token(data={"sub": str(data["neha"].id), "role": "Owner", "org_id": data["org2_id"]})

    # Detail query
    resp_doc = await client.get(f"/api/documents/{data['doc1_id']}", headers={"Authorization": f"Bearer {neha_token}"})
    assert resp_doc.status_code == 404

    # Preview query
    resp_prev = await client.get(f"/api/view/doc/{data['doc1_id']}/status", headers={"Authorization": f"Bearer {neha_token}"})
    assert resp_prev.status_code == 200
    assert resp_prev.json()["status"] == "NOT_FOUND"

    # Audit log query by Org 2 user only returns Org 2 logs
    resp_audit = await client.get("/api/audit", headers={"Authorization": f"Bearer {neha_token}"})
    assert resp_audit.status_code == 200
    for row in resp_audit.json():
        assert row["organization_id"] == data["org2_id"]

@pytest.mark.asyncio
async def test_permission_matrix_enforcement(client):
    """Editing role permissions in the matrix blocks action immediately."""
    data = await create_test_org_and_users()
    priya_token = create_access_token(data={"sub": str(data["priya"].id), "role": "Admin", "org_id": data["org1_id"]})
    arjun_token = create_access_token(data={"sub": str(data["arjun"].id), "role": "Manager", "org_id": data["org1_id"]})

    # Admin updates permissions matrix: removes 'shares.create_internal' from Manager role
    resp_update = await client.patch("/api/roles/matrix", json={
        "roles": [
            {
                "role_id": data["r1_mgr"].id,
                "scope": "OWN_DIRECT_REPORTS",
                "permissions": ["documents.upload"] # removed sharing!
            }
        ]
    }, headers={"Authorization": f"Bearer {priya_token}"})
    assert resp_update.status_code == 200

    # Arjun tries to create internal share on next request -> 403 Forbidden!
    resp_share = await client.post("/api/shares", json={
        "document_id": data["doc_arjun_id"],
        "share_type": "INTERNAL",
        "recipient_user_id": data["kavya"].id,
        "access_mode": "VIEW_ONLY"
    }, headers={"Authorization": f"Bearer {arjun_token}"})
    assert resp_share.status_code == 403

@pytest.mark.asyncio
async def test_invite_and_join_flow(client):
    """Invite flow, join code flow, and pending approval."""
    data = await create_test_org_and_users()
    priya_token = create_access_token(data={"sub": str(data["priya"].id), "role": "Admin", "org_id": data["org1_id"]})

    # 1. Admin creates invite
    resp_inv = await client.post("/api/members/invites", json={
        "email": "newbie@northwind.test",
        "role_id": data["r1_emp"].id
    }, headers={"Authorization": f"Bearer {priya_token}"})
    assert resp_inv.status_code == 200
    inv_token = resp_inv.json()["invite_token"]

    # 2. Member accepts invite
    resp_acc = await client.post("/api/auth/accept-invite", json={
        "token": inv_token,
        "full_name": "Newbie User",
        "password": "Test@1234"
    })
    assert resp_acc.status_code == 200
    assert resp_acc.json()["status"] == "ACTIVE"

    # 3. Join request via invite code -> PENDING status
    resp_join = await client.post("/api/auth/join", json={
        "invite_code": "NWH-TEST",
        "full_name": "Pending Guy",
        "email": "pending@northwind.test",
        "password": "Test@1234"
    })
    assert resp_join.status_code == 200
    pending_user_id = resp_join.json()["id"]
    assert resp_join.json()["status"] == "PENDING"

    # Pending user cannot list documents -> 403
    pending_token = create_access_token(data={"sub": str(pending_user_id), "role": "Employee", "org_id": data["org1_id"]})
    resp_docs = await client.get("/api/documents", headers={"Authorization": f"Bearer {pending_token}"})
    assert resp_docs.status_code == 403

    # Admin approves pending member
    resp_appr = await client.post(f"/api/members/{pending_user_id}/approve", headers={"Authorization": f"Bearer {priya_token}"})
    assert resp_appr.status_code == 200
    assert resp_appr.json()["status"] == "ACTIVE"

@pytest.mark.asyncio
async def test_signup_creates_org_and_owner_protection(client):
    """Signup creates org + Owner; last Owner cannot be demoted or deactivated."""
    resp_signup = await client.post("/api/auth/signup", json={
        "org_name": "Acme Health",
        "full_name": "Alice Smith",
        "email": "alice@acme.test",
        "password": "Test@1234"
    })
    assert resp_signup.status_code == 200
    owner_id = resp_signup.json()["id"]
    org_id = resp_signup.json()["organization_id"]
    assert resp_signup.json()["role_name"] == "Owner"

    owner_token = create_access_token(data={"sub": str(owner_id), "role": "Owner", "org_id": org_id})

    # Attempt to deactivate sole owner -> 400 Bad Request
    resp_deact = await client.patch(f"/api/members/{owner_id}", json={
        "status": "DEACTIVATED"
    }, headers={"Authorization": f"Bearer {owner_token}"})
    assert resp_deact.status_code == 400

@pytest.mark.asyncio
async def test_watermarked_download_content(client):
    """Downloaded PDF contains downloader email and DL- ID in text."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="downloader@audit.test",
            token_hash=token_h,
            access_mode=AccessMode.ALLOW_DOWNLOAD
        )
        session.add(share)
        await session.commit()

    resp = await client.get(f"/api/view/s/{token}/download")
    assert resp.status_code == 200
    pdf_bytes = resp.content

    reader = PdfReader(io.BytesIO(pdf_bytes))
    found_email = False
    found_dl = False
    for page in reader.pages:
        text = page.extract_text()
        if "downloader@audit.test" in text:
            found_email = True
        if "DL-" in text:
            found_dl = True

    assert found_email is True
    assert found_dl is True

@pytest.mark.asyncio
async def test_no_plaintext_file_on_disk(client):
    """No plaintext file appears in storage directory or temp dir."""
    data = await create_test_org_and_users()
    token = generate_share_token()
    token_h = hash_token(token)

    async with TestAsyncSessionLocal() as session:
        share = Share(
            organization_id=data["org1_id"],
            document_id=data["doc1_id"],
            created_by_id=data["priya"].id,
            share_type=ShareType.LINK,
            recipient_email="safe@audit.test",
            token_hash=token_h,
            access_mode=AccessMode.ALLOW_DOWNLOAD
        )
        session.add(share)
        await session.commit()

    temp_before = set(os.listdir(tempfile.gettempdir()))

    resp_view = await client.get(f"/api/view/s/{token}/content")
    assert resp_view.status_code == 200

    resp_dl = await client.get(f"/api/view/s/{token}/download")
    assert resp_dl.status_code == 200

    storage_files = os.listdir(settings.STORAGE_DIR)
    for f in storage_files:
        assert f.endswith(".enc"), f"Plaintext or non-enc file found in storage: {f}"
        full_path = os.path.join(settings.STORAGE_DIR, f)
        with open(full_path, "rb") as fh:
            header = fh.read(4)
            assert header != b"%PDF", f"Unencrypted PDF header found in {f}!"

    temp_after = set(os.listdir(tempfile.gettempdir()))
    new_temp = temp_after - temp_before
    for tf in new_temp:
        assert not tf.endswith(".pdf"), f"Plaintext PDF detected in temp dir: {tf}"

@pytest.mark.asyncio
async def test_audit_log_immutable_no_update_or_delete(client):
    """Audit log has no update/delete route (405 Method Not Allowed)."""
    data = await create_test_org_and_users()
    priya_token = create_access_token(data={"sub": str(data["priya"].id), "role": "Admin", "org_id": data["org1_id"]})

    resp_del = await client.delete("/api/audit/1", headers={"Authorization": f"Bearer {priya_token}"})
    assert resp_del.status_code in (404, 405)

    resp_put = await client.put("/api/audit/1", json={"details": "tampered"}, headers={"Authorization": f"Bearer {priya_token}"})
    assert resp_put.status_code in (404, 405)

@pytest.mark.asyncio
async def test_dashboard_metrics_role_scoping(client):
    """Admin/Owner sees whole org metrics; Employee only sees own metrics."""
    data = await create_test_org_and_users()
    admin_token = create_access_token(data={"sub": str(data["priya"].id), "role": "Admin", "org_id": data["org1_id"]})
    emp_token = create_access_token(data={"sub": str(data["kavya"].id), "role": "Employee", "org_id": data["org1_id"]})

    resp_admin = await client.get("/api/dashboard/metrics", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp_admin.status_code == 200
    metrics_admin = resp_admin.json()
    assert metrics_admin["total_documents"] >= 1
    assert "active_shares" in metrics_admin
    assert "views_daily_history" in metrics_admin
    assert len(metrics_admin["views_sparkline"]) == 7

    resp_emp = await client.get("/api/dashboard/metrics", headers={"Authorization": f"Bearer {emp_token}"})
    assert resp_emp.status_code == 200
    metrics_emp = resp_emp.json()
    assert metrics_emp["total_documents"] == 0
    assert metrics_emp["active_shares"] == 0


@pytest.mark.asyncio
async def test_aadhaar_and_sample_testing_pdf():
    """Verifies custom Aadhaar context-based detection and sample_test_documents/testing.pdf scanning."""
    from app.services.scanner.recognizers import run_custom_recognizers
    from app.services.scanner.detector import scan_pdf_bytes_in_memory
    import os

    # 1. Text test: Aadhaar with invalid checksum but context word
    findings = run_custom_recognizers("Aadhaar Number: 4829 1037 4625")
    aadhaar_findings = [f for f in findings if f.entity_type == "IN_AADHAAR"]
    assert len(aadhaar_findings) == 1
    assert aadhaar_findings[0].detector_name == "custom_aadhaar_context"
    assert aadhaar_findings[0].confidence == 0.75

    # 2. File test: testing.pdf (if present)
    testing_pdf_path = "sample_test_documents/testing.pdf"
    if os.path.exists(testing_pdf_path):
        with open(testing_pdf_path, "rb") as f:
            pdf_bytes = f.read()
        res = scan_pdf_bytes_in_memory(pdf_bytes)
        assert res.get("risk_level") == "CRITICAL"
        found_types = set(f["entity_type"] for f in res.get("findings", []))
        expected_types = {
            "IN_AADHAAR",
            "IN_PAN",
            "EMAIL_ADDRESS",
            "IN_PHONE",
            "BANK_ACCOUNT",
            "IN_IFSC",
            "IN_GSTIN",
            "MEDICAL_LICENSE",
            "HEALTH_TERM",
            "SECRETS",
        }
        for exp in expected_types:
            assert exp in found_types, f"Expected {exp} in findings, got {found_types}"


@pytest.mark.asyncio
async def test_no_self_approval_and_owner_critical_confirm(client):
    """Tests: self-approve returns 403; a Manager's request is approved by the Head; an Owner/Admin shares a Critical original with the typed confirm, with no approval record created."""
    from sqlalchemy import select
    data = await create_test_org_and_users()
    admin_token = create_access_token(data={"sub": str(data["priya"].id), "role": "Admin", "org_id": data["org1_id"]})
    mgr_token = create_access_token(data={"sub": str(data["arjun"].id), "role": "Manager", "org_id": data["org1_id"]})

    # Create a Department Head user
    async with TestAsyncSessionLocal() as session:
        dept_head = User(
            organization_id=data["org1_id"],
            full_name="Deepa Head",
            email="deepa.head@northwind.test",
            hashed_password=hash_password("Test@1234"),
            role_name="Department Head",
            department_name="Finance",
            status=UserStatus.ACTIVE.value
        )
        session.add(dept_head)

        doc = (await session.execute(select(Document).where(Document.id == data["doc1_id"]))).scalars().first()
        doc.risk_level = "CRITICAL"
        doc.risk_score = 100
        await session.commit()
        dept_head_id = dept_head.id

    head_token = create_access_token(data={"sub": str(dept_head_id), "role": "Department Head", "org_id": data["org1_id"]})

    # 1. Manager (Arjun) requests approval for critical original
    req_resp = await client.post(
        "/api/approvals",
        json={
            "document_id": data["doc1_id"],
            "share_type": "INTERNAL",
            "recipient_user_id": data["kavya"].id,
            "access_mode": "VIEW_ONLY",
            "is_view_once": False,
            "reason": "Need Kavya to verify clinical numbers"
        },
        headers={"Authorization": f"Bearer {mgr_token}"}
    )
    assert req_resp.status_code == 200
    appr_id = req_resp.json()["id"]

    # Self-approval returns 403
    self_appr = await client.post(
        f"/api/approvals/{appr_id}/approve",
        json={"comment": "Self approving"},
        headers={"Authorization": f"Bearer {mgr_token}"}
    )
    assert self_appr.status_code == 403

    # 2. Department Head approves Manager's request -> 200
    head_appr = await client.post(
        f"/api/approvals/{appr_id}/approve",
        json={"comment": "Approved by dept head"},
        headers={"Authorization": f"Bearer {head_token}"}
    )
    assert head_appr.status_code == 200
    assert head_appr.json()["status"] == "APPROVED"

    # 3. Admin (Priya) shares Critical original with typed confirm "SHARE" -> succeeds directly without approval record
    before_apprs = (await client.get("/api/approvals", headers={"Authorization": f"Bearer {admin_token}"})).json()
    count_before = len(before_apprs)

    admin_share = await client.post(
        "/api/shares",
        json={
            "document_id": data["doc1_id"],
            "share_type": "INTERNAL",
            "recipient_user_id": data["kavya"].id,
            "access_mode": "VIEW_ONLY",
            "confirm_critical": "SHARE",
            "confirm_reason": "Executive urgent review"
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert admin_share.status_code == 200

    after_apprs = (await client.get("/api/approvals", headers={"Authorization": f"Bearer {admin_token}"})).json()
    assert len(after_apprs) == count_before




