from typing import Optional, Callable
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import User, Role, Organization, UserStatus

async def get_token_from_request(request: Request) -> Optional[str]:
    """Extract JWT token from either HttpOnly cookie or Authorization header."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header.split(" ")[1]

    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token

    return None

async def get_optional_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """Retrieves current user if authenticated, without raising an exception if anonymous."""
    token = await get_token_from_request(request)
    if not token:
        return None
        
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        return None
        
    try:
        user_id = int(payload["sub"])
    except (ValueError, TypeError):
        return None

    stmt = (
        select(User)
        .where(User.id == user_id)
        .options(
            selectinload(User.organization),
            selectinload(User.role_rel),
            selectinload(User.department_rel),
            selectinload(User.manager)
        )
    )
    user = (await db.execute(stmt)).scalars().first()
    if user and not user.is_active:
        return None
    return user

async def get_current_user(
    user: Optional[User] = Depends(get_optional_current_user)
) -> User:
    """Enforces authentication. Raises 401 if unauthenticated."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status == UserStatus.PENDING.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending administrator approval."
        )
    if user.status == UserStatus.DEACTIVATED.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated."
        )
    return user

def user_has_permission(user: User, perm_key: str) -> bool:
    """Evaluates whether the given user possesses the specified permission key."""
    # Owner role has all permissions unconditionally
    if user.role_name == "Owner":
        return True

    # Admin role has all permissions except ownership transfer
    if user.role_name == "Admin":
        return True

    # Check dynamically assigned permissions on role object
    if user.role_rel and user.role_rel.permissions:
        return perm_key in user.role_rel.permissions

    # Fallback built-in defaults if role_rel not attached
    if user.role_name == "Department Head":
        return perm_key in [
            "documents.upload", "documents.delete_own", "documents.view_all_in_scope",
            "shares.create_internal", "shares.create_external", "shares.allow_download",
            "shares.revoke_any_in_scope", "audit.view", "members.invite", "members.approve",
            "departments.manage"
        ]
    elif user.role_name == "Manager":
        return perm_key in [
            "documents.upload", "documents.delete_own", "shares.create_internal",
            "shares.allow_download", "shares.revoke_any_in_scope"
        ]
    elif user.role_name == "Employee":
        return perm_key in ["documents.upload", "documents.delete_own"]

    return False

def require_permission(perm_key: str) -> Callable:
    """FastAPI dependency factory enforcing a specific permission key."""
    async def _perm_dependency(current_user: User = Depends(get_current_user)) -> User:
        if not user_has_permission(current_user, perm_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: action requires '{perm_key}' privilege."
            )
        return current_user
    return _perm_dependency

# Convenience role guards
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role_name not in ("Owner", "Admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges required."
        )
    return current_user

async def require_share_privilege(current_user: User = Depends(get_current_user)) -> User:
    if not (user_has_permission(current_user, "shares.create_internal") or user_has_permission(current_user, "shares.create_external")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to initiate document shares."
        )
    return current_user
