from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import Department, User, AuditAction
from app.schemas import DepartmentResponse, DepartmentCreate, DepartmentUpdate
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/departments", tags=["Departments"])

@router.get("", response_model=List[DepartmentResponse])
async def list_departments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists all departments in current user's organization with member counts."""
    stmt = (
        select(Department)
        .where(Department.organization_id == current_user.organization_id)
        .options(selectinload(Department.head))
        .order_by(Department.name.asc())
    )
    depts = (await db.execute(stmt)).scalars().all()

    results = []
    for d in depts:
        count_stmt = select(func.count(User.id)).where(User.department_id == d.id)
        count = (await db.execute(count_stmt)).scalar() or 0
        results.append(DepartmentResponse(
            id=d.id,
            organization_id=d.organization_id,
            name=d.name,
            head_id=d.head_id,
            head_name=d.head.full_name if d.head else None,
            member_count=count,
            created_at=d.created_at
        ))
    return results

@router.post("", response_model=DepartmentResponse)
async def create_department(
    payload: DepartmentCreate,
    request: Request,
    current_user: User = Depends(require_permission("departments.manage")),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new department in user's organization."""
    existing = (
        await db.execute(
            select(Department).where(
                and_(
                    Department.organization_id == current_user.organization_id,
                    Department.name == payload.name.strip()
                )
            )
        )
    ).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department with this name already exists.")

    dept = Department(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        head_id=payload.head_id
    )
    db.add(dept)
    await db.commit()
    await db.refresh(dept)

    await record_audit_event(
        db=db,
        action=AuditAction.ROLE_CHANGE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Created department '{dept.name}'",
        request=request,
        organization_id=current_user.organization_id
    )

    return DepartmentResponse(
        id=dept.id,
        organization_id=dept.organization_id,
        name=dept.name,
        head_id=dept.head_id,
        head_name=None,
        member_count=0,
        created_at=dept.created_at
    )

@router.patch("/{dept_id}", response_model=DepartmentResponse)
async def update_department(
    dept_id: int,
    payload: DepartmentUpdate,
    request: Request,
    current_user: User = Depends(require_permission("departments.manage")),
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(Department)
        .where(
            and_(
                Department.id == dept_id,
                Department.organization_id == current_user.organization_id
            )
        )
        .options(selectinload(Department.head))
    )
    dept = (await db.execute(stmt)).scalars().first()
    if not dept:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found.")

    if payload.name is not None:
        dept.name = payload.name.strip()
    if payload.head_id is not None:
        # Verify head belongs to org
        head = (
            await db.execute(
                select(User).where(and_(User.id == payload.head_id, User.organization_id == current_user.organization_id))
            )
        ).scalars().first()
        dept.head_id = head.id if head else None

    await db.commit()
    await db.refresh(dept)

    count_stmt = select(func.count(User.id)).where(User.department_id == dept.id)
    count = (await db.execute(count_stmt)).scalar() or 0

    return DepartmentResponse(
        id=dept.id,
        organization_id=dept.organization_id,
        name=dept.name,
        head_id=dept.head_id,
        head_name=dept.head.full_name if dept.head else None,
        member_count=count,
        created_at=dept.created_at
    )
