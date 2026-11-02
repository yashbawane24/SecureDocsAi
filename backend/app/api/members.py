import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.security import hash_token
from app.models import (
    User, Role, Department, OrganizationInvite, AuditAction,
    UserStatus
)
from app.schemas import (
    UserResponse, UserMemberUpdate, InviteCreate, InviteResponse
)
from app.api.deps import (
    get_current_user, require_permission, user_has_permission
)
from app.api.auth import serialize_user
from app.services.audit_service import record_audit_event
from app.services.email import send_invite_email
from app.services.event_bus import event_bus

router = APIRouter(prefix="/members", tags=["Members & Onboarding"])

@router.get("", response_model=List[UserResponse])
async def list_members(
    search: Optional[str] = None,
    role: Optional[str] = None,
    department: Optional[str] = None,
    status_filter: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists members in current user's organization with filtering options."""
    stmt = (
        select(User)
        .where(User.organization_id == current_user.organization_id)
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
        .order_by(User.id.asc())
    )
    users = (await db.execute(stmt)).scalars().all()

    # In-memory filter
    results = []
    for u in users:
        if search:
            q = search.lower()
            if q not in u.full_name.lower() and q not in u.email.lower():
                continue
        if role and u.role_name.lower() != role.lower():
            continue
        if department and (not u.department_name or u.department_name.lower() != department.lower()):
            continue
        if status_filter and u.status.lower() != status_filter.lower():
            continue
        results.append(serialize_user(u))
    return results

@router.get("/tree")
async def get_org_tree(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Generates reporting line organizational tree for current organization."""
    stmt = (
        select(User)
        .where(
            and_(
                User.organization_id == current_user.organization_id,
                User.status == UserStatus.ACTIVE.value
            )
        )
        .options(selectinload(User.role_rel), selectinload(User.department_rel))
    )
    users = (await db.execute(stmt)).scalars().all()

    user_map = {}
    for u in users:
        user_map[u.id] = {
            "id": u.id,
            "name": u.full_name,
            "email": u.email,
            "role": u.role_name,
            "department": u.department_name,
            "avatar_color": u.avatar_color or "#1E6B52",
            "reports_to_id": u.reports_to_id,
            "reports": []
        }

    roots = []
    for u_id, u_node in user_map.items():
        mgr_id = u_node["reports_to_id"]
        if mgr_id and mgr_id in user_map:
            user_map[mgr_id]["reports"].append(u_node)
        else:
            roots.append(u_node)

    return {"roots": roots, "total_members": len(users)}

@router.patch("/{member_id}", response_model=UserResponse)
async def update_member(
    member_id: int,
    payload: UserMemberUpdate,
    request: Request,
    current_user: User = Depends(require_permission("members.manage")),
    db: AsyncSession = Depends(get_db)
):
    """Updates member role, department, manager, or activation status."""
    stmt = (
        select(User)
        .where(
            and_(
                User.id == member_id,
                User.organization_id == current_user.organization_id
            )
        )
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    user = (await db.execute(stmt)).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")

    # Guard: The last Owner cannot be demoted or deactivated
    if user.role_name == "Owner" and (payload.role_id is not None or payload.status == UserStatus.DEACTIVATED.value):
        owner_count_stmt = select(User).where(
            and_(
                User.organization_id == current_user.organization_id,
                User.role_name == "Owner",
                User.status == UserStatus.ACTIVE.value
            )
        )
        owners = (await db.execute(owner_count_stmt)).scalars().all()
        if len(owners) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote or deactivate the organization's sole Owner."
            )

    if payload.role_id is not None:
        role = (
            await db.execute(
                select(Role).where(and_(Role.id == payload.role_id, Role.organization_id == current_user.organization_id))
            )
        ).scalars().first()
        if role:
            user.role_id = role.id
            user.role_name = role.name

    if payload.department_id is not None:
        dept = (
            await db.execute(
                select(Department).where(and_(Department.id == payload.department_id, Department.organization_id == current_user.organization_id))
            )
        ).scalars().first()
        if dept:
            user.department_id = dept.id
            user.department_name = dept.name

    if payload.reports_to_id is not None:
        if payload.reports_to_id == user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Member cannot report to themselves.")
        user.reports_to_id = payload.reports_to_id

    if payload.status is not None:
        user.status = payload.status
        if payload.status == UserStatus.DEACTIVATED.value:
            user.is_active = False
        elif payload.status == UserStatus.ACTIVE.value:
            user.is_active = True

    await db.commit()
    await db.refresh(user)

    await record_audit_event(
        db=db,
        action=AuditAction.MEMBER_DEACTIVATE if user.status == UserStatus.DEACTIVATED.value else AuditAction.ROLE_CHANGE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Updated member '{user.full_name}' ({user.role_name}, Status: {user.status})",
        request=request,
        organization_id=current_user.organization_id
    )
    event_bus.publish("member_updated", {"member_id": user.id}, organization_id=current_user.organization_id)

    return serialize_user(user)

@router.post("/{member_id}/approve", response_model=UserResponse)
async def approve_join_request(
    member_id: int,
    request: Request,
    current_user: User = Depends(require_permission("members.approve")),
    db: AsyncSession = Depends(get_db)
):
    """Approves a pending member and activates their account."""
    stmt = (
        select(User)
        .where(
            and_(
                User.id == member_id,
                User.organization_id == current_user.organization_id,
                User.status == UserStatus.PENDING.value
            )
        )
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    user = (await db.execute(stmt)).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending member request not found.")

    user.status = UserStatus.ACTIVE.value
    user.is_active = True
    await db.commit()
    await db.refresh(user)

    await record_audit_event(
        db=db,
        action=AuditAction.MEMBER_APPROVE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Approved join request for {user.full_name} ({user.email})",
        request=request,
        organization_id=current_user.organization_id
    )
    event_bus.publish("member_updated", {"member_id": user.id, "action": "approved"}, organization_id=current_user.organization_id)

    return serialize_user(user)

@router.post("/{member_id}/reject")
async def reject_join_request(
    member_id: int,
    request: Request,
    current_user: User = Depends(require_permission("members.approve")),
    db: AsyncSession = Depends(get_db)
):
    """Rejects and purges a pending member request."""
    stmt = (
        select(User)
        .where(
            and_(
                User.id == member_id,
                User.organization_id == current_user.organization_id,
                User.status == UserStatus.PENDING.value
            )
        )
    )
    user = (await db.execute(stmt)).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending member request not found.")

    email = user.email
    name = user.full_name
    await db.delete(user)
    await db.commit()

    await record_audit_event(
        db=db,
        action=AuditAction.MEMBER_APPROVE,
        result="BLOCKED",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Rejected join request for {name} ({email})",
        request=request,
        organization_id=current_user.organization_id
    )
    event_bus.publish("member_updated", {"member_id": member_id, "action": "rejected"}, organization_id=current_user.organization_id)
    return {"message": f"Join request for {email} was rejected."}

# ==============================================================================
# INVITATIONS WORKFLOW
# ==============================================================================

@router.get("/invites", response_model=List[InviteResponse])
async def list_invites(
    current_user: User = Depends(require_permission("members.invite")),
    db: AsyncSession = Depends(get_db)
):
    """Lists all open organization invitations."""
    stmt = (
        select(OrganizationInvite)
        .where(
            and_(
                OrganizationInvite.organization_id == current_user.organization_id,
                OrganizationInvite.status == "PENDING"
            )
        )
        .options(
            selectinload(OrganizationInvite.role),
            selectinload(OrganizationInvite.department),
            selectinload(OrganizationInvite.manager)
        )
        .order_by(OrganizationInvite.created_at.desc())
    )
    invites = (await db.execute(stmt)).scalars().all()
    results = []
    for inv in invites:
        results.append(InviteResponse(
            id=inv.id,
            email=inv.email,
            role_id=inv.role_id,
            role_name=inv.role.name if inv.role else "Employee",
            department_id=inv.department_id,
            department_name=inv.department.name if inv.department else None,
            manager_id=inv.manager_id,
            manager_name=inv.manager.full_name if inv.manager else None,
            status=inv.status,
            expires_at=inv.expires_at,
            created_at=inv.created_at
        ))
    return results

@router.post("/invites")
async def create_invite(
    payload: InviteCreate,
    request: Request,
    current_user: User = Depends(require_permission("members.invite")),
    db: AsyncSession = Depends(get_db)
):
    """Creates a 7-day invitation link and dispatches notification."""
    email_clean = payload.email.lower().strip()
    existing = (await db.execute(select(User).where(User.email == email_clean))).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with this email already exists.")

    raw_token = secrets.token_urlsafe(32)
    token_h = hash_token(raw_token)
    expires = datetime.now(timezone.utc) + timedelta(days=7)

    role_obj = (await db.execute(select(Role).where(Role.id == payload.role_id))).scalars().first()
    role_name = role_obj.name if role_obj else "Employee"
    org_name = current_user.organization.name if current_user.organization else "SecureDocs AI"

    invite = OrganizationInvite(
        organization_id=current_user.organization_id,
        email=email_clean,
        role_id=payload.role_id,
        department_id=payload.department_id,
        manager_id=payload.manager_id,
        token_hash=token_h,
        status="PENDING",
        expires_at=expires
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    invite_url = f"{settings.FRONTEND_URL}/join?token={raw_token}"
    send_invite_email(recipient_email=email_clean, org_name=org_name, role_name=role_name, invite_url=invite_url)

    await record_audit_event(
        db=db,
        action=AuditAction.INVITE_CREATE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Issued invitation to {email_clean} as {role_name} (Expires in 7 days)",
        request=request,
        organization_id=current_user.organization_id
    )
    event_bus.publish("member_updated", {"invite_id": invite.id, "action": "invite_created"}, organization_id=current_user.organization_id)

    return {
        "id": invite.id,
        "email": email_clean,
        "role_name": role_name,
        "message": f"Invitation dispatched to {email_clean}",
        "invite_token": raw_token,
        "invite_url": invite_url
    }

@router.delete("/invites/{invite_id}")
async def cancel_invite(
    invite_id: int,
    request: Request,
    current_user: User = Depends(require_permission("members.invite")),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(OrganizationInvite)
        .where(
            and_(
                OrganizationInvite.id == invite_id,
                OrganizationInvite.organization_id == current_user.organization_id
            )
        )
    )
    invite = (await db.execute(stmt)).scalars().first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found.")

    invite.status = "CANCELLED"
    await db.commit()
    event_bus.publish("member_updated", {"invite_id": invite.id, "action": "invite_cancelled"}, organization_id=current_user.organization_id)
    return {"message": "Invitation cancelled."}
