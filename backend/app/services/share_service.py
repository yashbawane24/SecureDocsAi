"""
Share Enforcement and Lifecycle Engine
Enforces:
- View-Once server tracking
- Time-limited countdown from server-recorded first_opened_at
- Max views counting
- Hard expiration timestamps
- Revocation states
- Recipient identity binding for internal shares
- OTP gate for external links (countdown and views start ONLY after verification)
"""

from datetime import datetime, timedelta, timezone
from typing import Tuple, Optional
from app.models import Share, User, ShareType

class ShareAccessResult:
    VALID = "VALID"
    INVALID_LINK = "INVALID_LINK"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"
    ALREADY_USED = "ALREADY_USED"
    MAX_VIEWS_REACHED = "MAX_VIEWS_REACHED"
    NOT_YOUR_SHARE = "NOT_YOUR_SHARE"
    OTP_REQUIRED = "OTP_REQUIRED"

def get_server_utc() -> datetime:
    return datetime.now(timezone.utc)

def evaluate_share_status(
    share: Optional[Share],
    current_user: Optional[User] = None,
    verified_otp_email: Optional[str] = None
) -> Tuple[str, Optional[int]]:
    """
    Evaluates whether a share can currently be accessed.
    Returns: (status: str, seconds_remaining: Optional[int])
    """
    if share is None:
        return ShareAccessResult.INVALID_LINK, None

    # 1. Instant revocation check
    if share.is_revoked:
        return ShareAccessResult.REVOKED, 0

    now = get_server_utc()

    # 2. Hard expiration date check
    if share.expires_at is not None:
        exp = share.expires_at if share.expires_at.tzinfo else share.expires_at.replace(tzinfo=timezone.utc)
        if now > exp:
            return ShareAccessResult.EXPIRED, 0

    # 3. View-Once check
    if share.is_view_once and (share.is_used or share.views_used >= 1):
        return ShareAccessResult.ALREADY_USED, 0

    # 4. Max views check
    if share.max_views is not None and share.views_used >= share.max_views:
        return ShareAccessResult.MAX_VIEWS_REACHED, 0

    # 5. Time-limited countdown check (enforced strictly server-side from first_opened_at)
    seconds_remaining = None
    if share.time_limit_seconds is not None:
        if share.first_opened_at is not None:
            first_opened = share.first_opened_at if share.first_opened_at.tzinfo else share.first_opened_at.replace(tzinfo=timezone.utc)
            deadline = first_opened + timedelta(seconds=share.time_limit_seconds)
            remaining = int((deadline - now).total_seconds())
            if remaining <= 0:
                return ShareAccessResult.EXPIRED, 0
            seconds_remaining = remaining
        else:
            seconds_remaining = share.time_limit_seconds

    # Also compute remaining if expires_at is closer than time limit
    if share.expires_at is not None:
        exp = share.expires_at if share.expires_at.tzinfo else share.expires_at.replace(tzinfo=timezone.utc)
        exp_remaining = int((exp - now).total_seconds())
        if seconds_remaining is None or exp_remaining < seconds_remaining:
            seconds_remaining = max(0, exp_remaining)

    # 6. Internal Share identity binding
    if share.share_type == ShareType.INTERNAL:
        if current_user is None or current_user.id != share.recipient_user_id:
            return ShareAccessResult.NOT_YOUR_SHARE, None

    # 7. External Share OTP gate (do not expose countdown before verification)
    if share.share_type == ShareType.LINK and share.requires_otp:
        if not verified_otp_email or (share.recipient_email and verified_otp_email.strip().lower() != share.recipient_email.strip().lower()):
            return ShareAccessResult.OTP_REQUIRED, None

    return ShareAccessResult.VALID, seconds_remaining


# ==============================================================================
# VIEW SESSION MANAGEMENT
# ==============================================================================
import secrets
from app.core.security import hash_token

ACTIVE_VIEW_SESSIONS: dict = {}

def create_view_session(
    share_id: int,
    user_id: Optional[int] = None,
    client_ip: Optional[str] = None,
    time_limit_seconds: Optional[int] = None,
    is_view_once: bool = False
) -> Tuple[str, datetime, int]:
    """Generates an active view session id and records it with an expiry."""
    raw_session_id = secrets.token_urlsafe(32)
    session_hash = hash_token(raw_session_id)
    now = get_server_utc()

    if time_limit_seconds is not None and time_limit_seconds > 0:
        duration = time_limit_seconds
    elif is_view_once:
        duration = 600  # 10 minutes
    else:
        duration = 3600  # 1 hour default

    expires_at = now + timedelta(seconds=duration)

    ACTIVE_VIEW_SESSIONS[session_hash] = {
        "share_id": share_id,
        "user_id": user_id,
        "client_ip": client_ip,
        "expires_at": expires_at,
        "is_view_once": is_view_once,
        "created_at": now
    }
    return raw_session_id, expires_at, duration

def validate_view_session(raw_session_id: str, share_id: int, client_ip: Optional[str] = None) -> bool:
    """Returns True if the session token is valid and unexpired for the specified share."""
    if not raw_session_id:
        return False
    session_hash = hash_token(raw_session_id)
    sess = ACTIVE_VIEW_SESSIONS.get(session_hash)
    if not sess:
        return False
    if sess["share_id"] != share_id:
        return False
    now = get_server_utc()
    if now > sess["expires_at"]:
        ACTIVE_VIEW_SESSIONS.pop(session_hash, None)
        return False
    return True

