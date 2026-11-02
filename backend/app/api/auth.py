import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import (
    verify_password, get_password_hash, create_access_token,
    hash_token, hash_otp, generate_otp_salt, generate_random_numeric_otp
)
from app.core.config import settings
from app.models import (
    User, Organization, Role, Department, OrganizationInvite,
    AuditAction, NotificationEventType, PermissionScope, UserStatus
)
from app.schemas import (
    UserLogin, UserResponse, OrganizationSignup, JoinRequest,
    ForgotPasswordRequest, ResetPasswordRequest, InviteAccept, GenericResponse
)
from app.api.deps import (
    get_current_user, get_optional_current_user, user_has_permission
)
from app.services.audit_service import record_audit_event
from app.services.notification_service import create_notification
from app.services.email import send_otp_email

router = APIRouter(prefix="/auth", tags=["Authentication & Onboarding"])

def get_user_permissions(user: User) -> List[str]:
    if user.role_name == "Owner":
        return [
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "documents.reveal_sensitive",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "members.manage", "roles.manage", "departments.manage", "org.settings"
        ]
    if user.role_rel and user.role_rel.permissions is not None:
        return user.role_rel.permissions
    if user.role_name == "Admin":
        return [
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "documents.reveal_sensitive",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "members.manage", "roles.manage", "departments.manage", "org.settings"
        ]
    if user.role_name == "Department Head":
        return [
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "departments.manage"
        ]
    if user.role_name == "Manager":
        return [
            "documents.upload", "documents.delete_own", "shares.create_internal",
            "shares.allow_download", "shares.revoke_any_in_scope"
        ]
    if user.role_name == "Employee":
        return ["documents.upload", "documents.delete_own"]
    return []

def serialize_user(user: User) -> UserResponse:
    perms = get_user_permissions(user)
    return UserResponse(
        id=user.id,
        organization_id=user.organization_id,
        organization_name=user.organization.name if user.organization else None,
        organization_slug=user.organization.slug if user.organization else None,
        brand_accent_color=user.organization.brand_accent_color if user.organization else "#1E6B52",
        email=user.email,
        full_name=user.full_name,
        role_id=user.role_id,
        role_name=user.role_name,
        role=user.role_name,
        department_id=user.department_id,
        department_name=user.department_name,
        department=user.department_name,
        reports_to_id=user.reports_to_id,
        reports_to_name=user.manager.full_name if user.manager else None,
        status=user.status,
        is_active=user.is_active,
        avatar_color=user.avatar_color,
        permissions=perms,
        created_at=user.created_at
    )

def set_auth_cookie(response: Response, user_id: int, role: str, org_id: int):
    token = create_access_token(data={"sub": str(user_id), "role": role, "org_id": org_id})
    is_prod = settings.ENV == "production"
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=is_prod,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/"
    )

@router.post("/login", response_model=UserResponse)
async def login(
    credentials: UserLogin,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(User)
        .where(User.email == credentials.email.lower().strip())
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    user = (await db.execute(stmt)).scalars().first()

    if not user or not verify_password(credentials.password, user.hashed_password):
        await record_audit_event(
            db=db,
            action=AuditAction.LOGIN,
            result="FAILURE",
            actor_email=credentials.email,
            details="Invalid credentials provided",
            request=request,
            organization_id=user.organization_id if user else 1
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )

    if user.status == UserStatus.DEACTIVATED.value or not user.is_active:
        await record_audit_event(
            db=db,
            action=AuditAction.LOGIN,
            result="BLOCKED",
            actor_id=user.id,
            actor_email=user.email,
            details="Account is deactivated",
            request=request,
            organization_id=user.organization_id
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated by administrator."
        )

    set_auth_cookie(response, user.id, user.role_name, user.organization_id)

    await record_audit_event(
        db=db,
        action=AuditAction.LOGIN,
        result="SUCCESS",
        actor_id=user.id,
        actor_email=user.email,
        details=f"Successful login for {user.full_name} ({user.role_name})",
        request=request,
        organization_id=user.organization_id
    )

    return serialize_user(user)

@router.post("/signup", response_model=UserResponse)
async def create_organization(
    payload: OrganizationSignup,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new Organization, seeds built-in roles, and assigns creator as Owner.
    """
    # Check email not taken
    existing_user = (await db.execute(select(User).where(User.email == payload.email.lower().strip()))).scalars().first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An account with this email already exists.")

    slug = re.sub(r"[^a-z0-9]+", "-", payload.org_name.lower()).strip("-")
    if not slug:
        slug = f"org-{secrets.token_hex(4)}"

    # Ensure unique slug
    base_slug = slug
    idx = 1
    while True:
        existing_org = (await db.execute(select(Organization).where(Organization.slug == slug))).scalars().first()
        if not existing_org:
            break
        slug = f"{base_slug}-{idx}"
        idx += 1

    invite_code = f"{slug[:3].upper()}-2026"
    allowed_domain = payload.email.split("@")[1].lower()

    org = Organization(
        name=payload.org_name.strip(),
        slug=slug,
        brand_accent_color="#1E6B52",
        allowed_email_domains=allowed_domain,
        invite_code=invite_code,
        settings={
            "allow_external_links": True,
            "require_otp_external": True,
            "max_share_duration_seconds": 86400,
            "allow_downloads": True,
            "default_watermark": "CONFIDENTIAL"
        }
    )
    db.add(org)
    await db.flush()

    # Seed Built-in Roles for this organization
    all_perms = [
        "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
        "documents.reveal_sensitive",
        "shares.create_internal", "shares.create_external", "shares.allow_download",
        "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
        "members.manage", "roles.manage", "departments.manage", "org.settings"
    ]
    role_owner = Role(
        organization_id=org.id,
        name="Owner",
        is_builtin=True,
        scope=PermissionScope.WHOLE_ORGANIZATION.value,
        permissions=all_perms
    )
    role_admin = Role(
        organization_id=org.id,
        name="Admin",
        is_builtin=True,
        scope=PermissionScope.WHOLE_ORGANIZATION.value,
        permissions=all_perms
    )
    role_dept_head = Role(
        organization_id=org.id,
        name="Department Head",
        is_builtin=True,
        scope=PermissionScope.OWN_DEPARTMENT.value,
        permissions=[
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "departments.manage"
        ]
    )
    role_manager = Role(
        organization_id=org.id,
        name="Manager",
        is_builtin=True,
        scope=PermissionScope.OWN_DIRECT_REPORTS.value,
        permissions=[
            "documents.upload", "documents.delete_own", "shares.create_internal",
            "shares.allow_download", "shares.revoke_any_in_scope"
        ]
    )
    role_employee = Role(
        organization_id=org.id,
        name="Employee",
        is_builtin=True,
        scope=PermissionScope.OWN_DIRECT_REPORTS.value,
        permissions=["documents.upload", "documents.delete_own"]
    )
    db.add_all([role_owner, role_admin, role_dept_head, role_manager, role_employee])
    await db.flush()

    # Create default Department "General"
    dept = Department(organization_id=org.id, name="Executive")
    db.add(dept)
    await db.flush()

    # Create Owner User
    owner_user = User(
        organization_id=org.id,
        email=payload.email.lower().strip(),
        full_name=payload.full_name.strip(),
        hashed_password=get_password_hash(payload.password),
        role_id=role_owner.id,
        role_name="Owner",
        department_id=dept.id,
        department_name=dept.name,
        status=UserStatus.ACTIVE.value,
        is_active=True,
        avatar_color="#1E6B52"
    )
    db.add(owner_user)
    await db.commit()
    await db.refresh(owner_user)
    dept.head_id = owner_user.id
    await db.commit()

    set_auth_cookie(response, owner_user.id, "Owner", org.id)

    # Reload relationships for serializer
    stmt = (
        select(User)
        .where(User.id == owner_user.id)
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    owner_user = (await db.execute(stmt)).scalars().first()

    await record_audit_event(
        db=db,
        action=AuditAction.LOGIN,
        result="SUCCESS",
        actor_id=owner_user.id,
        actor_email=owner_user.email,
        details=f"Created organization '{org.name}' ({org.slug}) and registered as Owner",
        request=request,
        organization_id=org.id
    )

    return serialize_user(owner_user)

@router.post("/join", response_model=UserResponse)
async def request_to_join_org(
    payload: JoinRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Submits a join request to an organization using invite code or matching email domain.
    Account created in PENDING status until approved.
    """
    email_clean = payload.email.lower().strip()
    existing = (await db.execute(select(User).where(User.email == email_clean))).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An account with this email already exists.")

    org: Optional[Organization] = None

    if payload.invite_code:
        code_clean = payload.invite_code.strip().upper()
        org = (await db.execute(select(Organization).where(Organization.invite_code == code_clean))).scalars().first()

    if not org:
        domain = email_clean.split("@")[1].lower()
        orgs = (await db.execute(select(Organization))).scalars().all()
        for o in orgs:
            allowed = [d.strip().lower() for d in o.allowed_email_domains.split(",") if d.strip()]
            if domain in allowed:
                org = o
                break

    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid organization invite code or unauthorized email domain.")

    # Find employee role in org
    emp_role = (
        await db.execute(
            select(Role).where(and_(Role.organization_id == org.id, Role.name == "Employee"))
        )
    ).scalars().first()

    new_user = User(
        organization_id=org.id,
        email=email_clean,
        full_name=payload.full_name.strip(),
        hashed_password=get_password_hash(payload.password),
        role_id=emp_role.id if emp_role else None,
        role_name="Employee",
        status=UserStatus.PENDING.value,
        is_active=True,
        avatar_color="#B7791F"
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    # Notify org admins
    admins = (
        await db.execute(
            select(User).where(and_(User.organization_id == org.id, User.role_name.in_(["Owner", "Admin"])))
        )
    ).scalars().all()
    for admin in admins:
        await create_notification(
            db=db,
            user_id=admin.id,
            event_type=NotificationEventType.MEMBER_JOIN_REQUEST,
            title="New Member Join Request",
            message=f"{new_user.full_name} ({new_user.email}) requested to join {org.name}.",
            organization_id=org.id
        )

    set_auth_cookie(response, new_user.id, "Employee", org.id)

    stmt = (
        select(User)
        .where(User.id == new_user.id)
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    new_user = (await db.execute(stmt)).scalars().first()
    return serialize_user(new_user)

@router.post("/accept-invite", response_model=UserResponse)
async def accept_invitation(
    payload: InviteAccept,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Accepts an organization invitation, sets credentials, activates account immediately."""
    token_h = hash_token(payload.token.strip())
    stmt = (
        select(OrganizationInvite)
        .where(and_(OrganizationInvite.token_hash == token_h, OrganizationInvite.status == "PENDING"))
        .options(selectinload(OrganizationInvite.organization), selectinload(OrganizationInvite.role), selectinload(OrganizationInvite.department))
    )
    invite = (await db.execute(stmt)).scalars().first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired invitation link.")

    now = datetime.now(timezone.utc)
    exp = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
    if now > exp:
        invite.status = "EXPIRED"
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This invitation has expired (valid for 7 days).")

    # Create active user
    new_user = User(
        organization_id=invite.organization_id,
        email=invite.email.lower().strip(),
        full_name=payload.full_name.strip(),
        hashed_password=get_password_hash(payload.password),
        role_id=invite.role_id,
        role_name=invite.role.name if invite.role else "Employee",
        department_id=invite.department_id,
        department_name=invite.department.name if invite.department else None,
        reports_to_id=invite.manager_id,
        status=UserStatus.ACTIVE.value,
        is_active=True,
        avatar_color="#1E6B52"
    )
    db.add(new_user)
    invite.status = "ACCEPTED"
    await db.commit()
    await db.refresh(new_user)

    set_auth_cookie(response, new_user.id, new_user.role_name, invite.organization_id)

    stmt = (
        select(User)
        .where(User.id == new_user.id)
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    new_user = (await db.execute(stmt)).scalars().first()

    await record_audit_event(
        db=db,
        action=AuditAction.INVITE_ACCEPT,
        result="SUCCESS",
        actor_id=new_user.id,
        actor_email=new_user.email,
        details=f"Accepted invitation to join {invite.organization.name} as {new_user.role_name}",
        request=request,
        organization_id=invite.organization_id
    )

    return serialize_user(new_user)

@router.post("/forgot-password", response_model=GenericResponse)
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    """Sends password reset 6-digit verification code."""
    email_clean = payload.email.lower().strip()
    user = (await db.execute(select(User).where(User.email == email_clean))).scalars().first()
    if user:
        code = generate_random_numeric_otp()
        # In dev, send to Mailpit
        send_otp_email(user.email, code, "SecureDocs AI Password Reset")
    return GenericResponse(success=True, message="If an account exists with this email, a verification code has been sent.")

@router.post("/reset-password", response_model=GenericResponse)
async def reset_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    """Resets password with valid verification code."""
    email_clean = payload.email.lower().strip()
    user = (await db.execute(select(User).where(User.email == email_clean))).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password reset failed.")

    user.hashed_password = get_password_hash(payload.new_password)
    await db.commit()
    return GenericResponse(success=True, message="Password successfully reset. You may now sign in.")

@router.post("/logout")
async def logout(response: Response, request: Request, db: AsyncSession = Depends(get_db)):
    response.delete_cookie("access_token", path="/")
    return {"message": "Logged out successfully."}

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return serialize_user(current_user)

@router.get("/allowed-recipients", response_model=List[UserResponse])
async def get_allowed_recipients(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns users in the same organization permitted for sharing under RBAC & scope rules.
    """
    scope = current_user.role_rel.scope if current_user.role_rel else PermissionScope.WHOLE_ORGANIZATION.value

    stmt = (
        select(User)
        .where(
            and_(
                User.organization_id == current_user.organization_id,
                User.id != current_user.id,
                User.status == UserStatus.ACTIVE.value,
                User.is_active == True
            )
        )
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    all_users = (await db.execute(stmt)).scalars().all()

    # Apply scope filtering
    if current_user.role_name in ("Owner", "Admin") or scope == PermissionScope.WHOLE_ORGANIZATION.value:
        return [serialize_user(u) for u in all_users]

    if scope == PermissionScope.OWN_DEPARTMENT.value or current_user.role_name == "Department Head":
        filtered = [u for u in all_users if u.department_id == current_user.department_id]
        return [serialize_user(u) for u in filtered]

    if scope == PermissionScope.OWN_DIRECT_REPORTS.value or current_user.role_name == "Manager":
        # Direct reports + own manager/head
        filtered = [u for u in all_users if u.reports_to_id == current_user.id or u.id == current_user.reports_to_id]
        return [serialize_user(u) for u in filtered]

    # Employee: if internal sharing is enabled for their role, peers in own department
    if user_has_permission(current_user, "shares.create_internal"):
        filtered = [u for u in all_users if u.department_id == current_user.department_id]
        return [serialize_user(u) for u in filtered]

    return []
