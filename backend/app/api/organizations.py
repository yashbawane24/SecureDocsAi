import secrets
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import Organization, User, AuditAction, DEFAULT_RISK_POLICY
from app.schemas import OrganizationResponse, OrganizationUpdate
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import record_audit_event
from app.services.event_bus import event_bus

router = APIRouter(tags=["Organizations"])


def serialize_org(org: Organization) -> OrganizationResponse:
    raw_domains = org.allowed_email_domains or ""
    if isinstance(raw_domains, list):
        domains_list = [str(d).strip().lower() for d in raw_domains if str(d).strip()]
    else:
        domains_list = [d.strip().lower() for d in str(raw_domains).split(",") if d.strip()]

    s = dict(org.settings or {})
    allow_external_links = bool(s.get("allow_external_links", True))
    always_require_otp = bool(s.get("require_otp_external", s.get("always_require_otp", True)))
    if "max_share_duration_hours" in s:
        max_hours = int(s["max_share_duration_hours"])
    elif "max_share_duration_seconds" in s:
        max_hours = max(1, int(s["max_share_duration_seconds"]) // 3600)
    else:
        max_hours = 168
    allow_downloads = bool(s.get("allow_downloads", True))
    default_watermark = str(s.get("default_watermark_text") or s.get("default_watermark") or f"{org.name.upper()} CONFIDENTIAL")
    risk_policy = s.get("risk_policy") or DEFAULT_RISK_POLICY

    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        logo_url=org.logo_url or "",
        brand_accent_color=org.brand_accent_color or "#1E6B52",
        allowed_email_domains=domains_list,
        invite_code=org.invite_code,
        allow_external_links=allow_external_links,
        always_require_otp=always_require_otp,
        max_share_duration_hours=max_hours,
        allow_downloads=allow_downloads,
        default_watermark_text=default_watermark,
        risk_policy=risk_policy,
        settings=s,
        created_at=org.created_at,
    )


async def _get_org_for_user(user: User, db: AsyncSession) -> Organization:
    stmt = select(Organization).where(Organization.id == user.organization_id)
    org = (await db.execute(stmt)).scalars().first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization record not found.")
    return org


@router.get("/org/settings", response_model=OrganizationResponse)
@router.get("/organizations/settings", response_model=OrganizationResponse)
async def get_organization_settings(
    current_user: User = Depends(require_permission("org.settings")),
    db: AsyncSession = Depends(get_db)
):
    """Returns full organization settings, branding, invite code, and security/risk policies."""
    org = await _get_org_for_user(current_user, db)
    return serialize_org(org)


@router.get("/org/current", response_model=OrganizationResponse)
@router.get("/organizations/current", response_model=OrganizationResponse)
async def get_current_organization(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns organization info for the current authenticated user."""
    org = await _get_org_for_user(current_user, db)
    return serialize_org(org)


@router.patch("/org/settings", response_model=OrganizationResponse)
@router.patch("/org/current", response_model=OrganizationResponse)
@router.patch("/organizations/current", response_model=OrganizationResponse)
async def update_organization_settings(
    payload: OrganizationUpdate,
    request: Request,
    current_user: User = Depends(require_permission("org.settings")),
    db: AsyncSession = Depends(get_db)
):
    """Updates organization profile, branding, allowed domains, security policies, and risk policy."""
    org = await _get_org_for_user(current_user, db)

    if payload.name is not None and payload.name.strip():
        org.name = payload.name.strip()
    if payload.logo_url is not None:
        org.logo_url = payload.logo_url.strip()
    if payload.brand_accent_color is not None and payload.brand_accent_color.strip():
        org.brand_accent_color = payload.brand_accent_color.strip()

    if payload.allowed_email_domains is not None:
        if isinstance(payload.allowed_email_domains, list):
            org.allowed_email_domains = ",".join(
                d.strip().lower() for d in payload.allowed_email_domains if str(d).strip()
            )
        else:
            org.allowed_email_domains = ",".join(
                d.strip().lower() for d in str(payload.allowed_email_domains).split(",") if d.strip()
            )

    if payload.invite_code is not None and payload.invite_code.strip():
        org.invite_code = payload.invite_code.strip().upper()

    current_settings = dict(org.settings or {})
    if payload.settings is not None:
        current_settings.update(payload.settings)

    if payload.allow_external_links is not None:
        current_settings["allow_external_links"] = bool(payload.allow_external_links)
    if payload.always_require_otp is not None:
        current_settings["require_otp_external"] = bool(payload.always_require_otp)
        current_settings["always_require_otp"] = bool(payload.always_require_otp)
    if payload.max_share_duration_hours is not None:
        hours = max(1, int(payload.max_share_duration_hours))
        current_settings["max_share_duration_hours"] = hours
        current_settings["max_share_duration_seconds"] = hours * 3600
    if payload.allow_downloads is not None:
        current_settings["allow_downloads"] = bool(payload.allow_downloads)
    if payload.default_watermark_text is not None:
        current_settings["default_watermark_text"] = payload.default_watermark_text.strip()
        current_settings["default_watermark"] = payload.default_watermark_text.strip()
    if payload.risk_policy is not None:
        merged_rp = dict(current_settings.get("risk_policy") or DEFAULT_RISK_POLICY)
        for lvl, rules in payload.risk_policy.items():
            if isinstance(rules, dict):
                merged_rp[lvl] = {**merged_rp.get(lvl, {}), **rules}
        current_settings["risk_policy"] = merged_rp

    org.settings = current_settings

    if payload.regenerate_invite_code:
        prefix = (org.slug[:3] if org.slug else "ORG").upper()
        org.invite_code = f"{prefix}-{secrets.token_hex(2).upper()}"

    await db.commit()
    await db.refresh(org)

    await record_audit_event(
        db=db,
        action=AuditAction.ORG_SETTINGS_UPDATE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Updated organization settings for '{org.name}'.",
        request=request,
        organization_id=org.id
    )

    await event_bus.publish(
        event_type="org.updated",
        payload={"organization_id": org.id, "invite_code": org.invite_code},
        organization_id=org.id,
    )

    return serialize_org(org)


@router.post("/org/invite-code/regenerate", response_model=OrganizationResponse)
@router.post("/organizations/invite-code/regenerate", response_model=OrganizationResponse)
async def regenerate_organization_invite_code(
    request: Request,
    current_user: User = Depends(require_permission("org.settings")),
    db: AsyncSession = Depends(get_db)
):
    """Regenerates the organization's join invite code and invalidates the old code."""
    org = await _get_org_for_user(current_user, db)
    old_code = org.invite_code
    prefix = (org.slug[:3] if org.slug else "ORG").upper()
    new_code = f"{prefix}-{secrets.token_hex(2).upper()}"
    while new_code == old_code:
        new_code = f"{prefix}-{secrets.token_hex(2).upper()}"

    org.invite_code = new_code
    await db.commit()
    await db.refresh(org)

    await record_audit_event(
        db=db,
        action=AuditAction.ORG_SETTINGS_UPDATE,
        result="SUCCESS",
        actor_id=current_user.id,
        actor_email=current_user.email,
        details=f"Regenerated organization invite code (new code: {new_code}).",
        request=request,
        organization_id=org.id
    )

    await event_bus.publish(
        event_type="org.updated",
        payload={"organization_id": org.id, "invite_code": org.invite_code},
        organization_id=org.id,
    )

    return serialize_org(org)
