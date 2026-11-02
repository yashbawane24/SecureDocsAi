from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.database import get_db
from app.models import Role, User, AuditAction, PermissionScope
from app.schemas import RoleResponse, RoleCreate, RoleUpdate, RoleMatrixUpdate
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/roles", tags=["Roles & Permissions Matrix"])

@router.get("", response_model=List[RoleResponse])
async def list_roles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists all roles in current user's organization."""
    stmt = (
        select(Role)
        .where(Role.organization_id == current_user.organization_id)
        .order_by(Role.id.asc())
    )
    roles = (await db.execute(stmt)).scalars().all()
    return roles

@router.post("", response_model=RoleResponse)
async def create_custom_role(
    payload: RoleCreate,
    request: Request,
    current_user: User = Depends(require_permission("roles.manage")),
    db: AsyncSession = Depends(get_db)
):
    """Creates a custom role for the organization."""
    existing = (
        await db.execute(
            select(Role).where(
                and_(
                    Role.organization_id == current_user.organization_id,
                    Role.name == payload.name.strip()
                )
            )
        )
    ).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A role with this name already exists.")

    role = Role(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        is_builtin=False,
        scope=payload.scope,
        permissions=payload.permissions
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)

    await record_audit_event(
        db=db,
        action=AuditAction.ROLE_CHANGE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Created custom role '{role.name}' with scope {role.scope}",
        request=request,
        organization_id=current_user.organization_id
    )
    return role

@router.patch("/matrix", response_model=List[RoleResponse])
async def update_permissions_matrix(
    payload: RoleMatrixUpdate,
    request: Request,
    current_user: User = Depends(require_permission("roles.manage")),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates permissions and scopes across roles in batch.
    Takes effect on the user's very next request.
    """
    updated_roles = []
    for item in payload.roles:
        stmt = (
            select(Role)
            .where(
                and_(
                    Role.id == item.role_id,
                    Role.organization_id == current_user.organization_id
                )
            )
        )
        role = (await db.execute(stmt)).scalars().first()
        if not role:
            continue

        # Prevent removing core Owner privileges
        if role.name == "Owner":
            continue

        role.scope = item.scope
        role.permissions = item.permissions
        updated_roles.append(role)

    await db.commit()

    await record_audit_event(
        db=db,
        action=AuditAction.PERMISSION_CHANGE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Updated permissions matrix for {len(updated_roles)} roles.",
        request=request,
        organization_id=current_user.organization_id
    )

    stmt = select(Role).where(Role.organization_id == current_user.organization_id).order_by(Role.id.asc())
    return (await db.execute(stmt)).scalars().all()

@router.patch("/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: int,
    payload: RoleUpdate,
    request: Request,
    current_user: User = Depends(require_permission("roles.manage")),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Role)
        .where(
            and_(
                Role.id == role_id,
                Role.organization_id == current_user.organization_id
            )
        )
    )
    role = (await db.execute(stmt)).scalars().first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found.")

    if payload.name is not None and not role.is_builtin:
        role.name = payload.name.strip()
    if payload.scope is not None and role.name != "Owner":
        role.scope = payload.scope
    if payload.permissions is not None and role.name != "Owner":
        role.permissions = payload.permissions

    await db.commit()
    await db.refresh(role)

    await record_audit_event(
        db=db,
        action=AuditAction.PERMISSION_CHANGE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Updated role '{role.name}' configuration.",
        request=request,
        organization_id=current_user.organization_id
    )
    return role

@router.delete("/{role_id}")
async def delete_role(
    role_id: int,
    request: Request,
    current_user: User = Depends(require_permission("roles.manage")),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Role)
        .where(
            and_(
                Role.id == role_id,
                Role.organization_id == current_user.organization_id
            )
        )
    )
    role = (await db.execute(stmt)).scalars().first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found.")
    if role.is_builtin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Built-in roles cannot be deleted.")

    # Check if users assigned
    users_with_role = (await db.execute(select(User).where(User.role_id == role.id))).scalars().first()
    if users_with_role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete role while members are assigned to it.")

    await db.delete(role)
    await db.commit()

    await record_audit_event(
        db=db,
        action=AuditAction.ROLE_CHANGE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Deleted custom role '{role.name}'",
        request=request,
        organization_id=current_user.organization_id
    )
    return {"message": "Role deleted successfully."}
