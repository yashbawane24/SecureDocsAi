import re
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Annotated, Union
from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

EmailType = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        pattern=r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    )
]

from app.models import (
    ShareType, AccessMode, NotificationEventType, AuditAction, DEFAULT_RISK_POLICY
)

# ----------------- Organization Schemas -----------------
class OrganizationResponse(BaseModel):
    id: int
    name: str
    slug: str
    logo_url: Optional[str] = None
    brand_accent_color: str
    allowed_email_domains: List[str] = []
    invite_code: str
    allow_external_links: bool = True
    always_require_otp: bool = True
    max_share_duration_hours: int = 168
    allow_downloads: bool = True
    default_watermark_text: str = "CONFIDENTIAL"
    risk_policy: Dict[str, Any] = DEFAULT_RISK_POLICY
    settings: Dict[str, Any] = {}
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    brand_accent_color: Optional[str] = None
    allowed_email_domains: Optional[Union[List[str], str]] = None
    invite_code: Optional[str] = None
    allow_external_links: Optional[bool] = None
    always_require_otp: Optional[bool] = None
    max_share_duration_hours: Optional[int] = None
    allow_downloads: Optional[bool] = None
    default_watermark_text: Optional[str] = None
    risk_policy: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    regenerate_invite_code: bool = False

class OrganizationSignup(BaseModel):
    org_name: str
    full_name: str
    email: EmailType
    password: str
    turnstile_token: Optional[str] = None

class JoinRequest(BaseModel):
    invite_code: Optional[str] = None
    full_name: str
    email: EmailType
    password: str

# ----------------- Role & Permission Schemas -----------------
class RoleResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    is_builtin: bool
    scope: str
    permissions: List[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class RoleCreate(BaseModel):
    name: str
    scope: str = "WHOLE_ORGANIZATION"
    permissions: List[str] = []

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[str] = None
    permissions: Optional[List[str]] = None

class RoleMatrixItem(BaseModel):
    role_id: int
    scope: str
    permissions: List[str]

class RoleMatrixUpdate(BaseModel):
    roles: List[RoleMatrixItem]

# ----------------- Department Schemas -----------------
class DepartmentResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    head_id: Optional[int] = None
    head_name: Optional[str] = None
    member_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class DepartmentCreate(BaseModel):
    name: str
    head_id: Optional[int] = None

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    head_id: Optional[int] = None

# ----------------- User Schemas -----------------
class UserLogin(BaseModel):
    email: EmailType
    password: str

class UserResponse(BaseModel):
    id: int
    organization_id: int
    organization_name: Optional[str] = None
    organization_slug: Optional[str] = None
    brand_accent_color: Optional[str] = None
    email: str
    full_name: str
    role_id: Optional[int] = None
    role_name: str
    role: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    department: Optional[str] = None
    reports_to_id: Optional[int] = None
    reports_to_name: Optional[str] = None
    status: str
    is_active: bool
    avatar_color: Optional[str] = None
    permissions: List[str] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserMemberUpdate(BaseModel):
    role_id: Optional[int] = None
    department_id: Optional[int] = None
    reports_to_id: Optional[int] = None
    status: Optional[str] = None  # ACTIVE, PENDING, DEACTIVATED

class InviteCreate(BaseModel):
    email: EmailType
    role_id: int
    department_id: Optional[int] = None
    manager_id: Optional[int] = None

class InviteResponse(BaseModel):
    id: int
    email: str
    role_id: Optional[int] = None
    role_name: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    manager_id: Optional[int] = None
    manager_name: Optional[str] = None
    invite_token: Optional[str] = None
    status: str
    expires_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class InviteAccept(BaseModel):
    token: str
    full_name: str
    password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailType

class ResetPasswordRequest(BaseModel):
    email: EmailType
    code: str
    new_password: str

# ----------------- Sensitive Data & Risk Schemas -----------------
class RiskContributor(BaseModel):
    label: str
    entity_type: str
    count: int = 1
    unique_count: int = 1
    avg_confidence: float = 1.0
    points: float

class DocumentFindingResponse(BaseModel):
    id: int
    document_id: int
    entity_type: str
    category: str
    masked_value: str
    value_hash: str
    page_number: int
    bboxes: List[List[float]] = []
    confidence: float
    detector_name: str
    masked_context: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class DocumentAnalysisResponse(BaseModel):
    document_id: int
    title: str
    scan_status: str
    scan_progress: int
    scan_error: Optional[str] = None
    risk_score: int
    risk_level: str
    risk_verdict: str
    risk_breakdown: List[Dict[str, Any]] = []
    category_summary: Dict[str, int] = {}
    recommendations: List[str] = []
    page_heatmap: Dict[str, int] = {}
    page_count: int = 1
    findings: List[DocumentFindingResponse] = []
    is_safe_copy: bool = False
    is_password_protected: bool = False
    parent_document_id: Optional[int] = None
    safe_copy_id: Optional[int] = None
    scanned_at: Optional[datetime] = None

class SafeCopyCreateRequest(BaseModel):
    finding_ids: Optional[List[int]] = None
    categories: Optional[List[str]] = None
    entity_types: Optional[List[str]] = None
    style: str = "blackout"  # "blackout" | "label"
    password: Optional[str] = None
    generate_password: bool = False

class SafeCopyCreateResponse(BaseModel):
    safe_copy: "DocumentResponse"
    generated_password: Optional[str] = None
    redacted_count: int
    new_risk_score: int
    new_risk_level: str

class SensitiveRevealResponse(BaseModel):
    finding_id: int
    entity_type: str
    revealed_value: str
    expires_in_seconds: int = 10

# ----------------- Document Schemas -----------------
class DocumentResponse(BaseModel):
    id: int
    organization_id: int
    title: str
    original_filename: str
    file_size_bytes: int
    mime_type: str
    owner_id: int
    owner_name: Optional[str] = None
    active_shares_count: int = 0
    scan_status: str = "COMPLETED"
    scan_progress: int = 100
    scan_error: Optional[str] = None
    risk_score: int = 0
    risk_level: str = "LOW"
    risk_verdict: Optional[str] = None
    risk_breakdown: List[Dict[str, Any]] = []
    category_summary: Dict[str, int] = {}
    recommendations: List[str] = []
    page_heatmap: Dict[str, int] = {}
    page_count: int = 1
    findings_count: int = 0
    parent_document_id: Optional[int] = None
    parent_document_title: Optional[str] = None
    is_safe_copy: bool = False
    redaction_style: Optional[str] = None
    is_password_protected: bool = False
    safe_copy_id: Optional[int] = None
    scanned_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class DocumentDetailResponse(BaseModel):
    document: DocumentResponse
    shares: List["ShareResponse"]
    activity: List["AuditLogResponse"]
    findings: List[DocumentFindingResponse] = []

# ----------------- Share & Approval Schemas -----------------
class ShareCreate(BaseModel):
    document_id: int
    share_type: ShareType
    recipient_user_id: Optional[int] = None
    recipient_email: Optional[EmailType] = None
    access_mode: AccessMode = AccessMode.VIEW_ONLY
    is_view_once: bool = False
    strict_viewing: Optional[bool] = None
    time_limit_seconds: Optional[int] = None
    max_views: Optional[int] = None
    expires_at: Optional[datetime] = None
    requires_otp: bool = False
    approval_id: Optional[int] = None
    confirm_critical: Optional[str] = None
    confirm_reason: Optional[str] = None

    @field_validator('max_views')
    @classmethod
    def validate_max_views(cls, v):
        if v is not None and v < 1:
            raise ValueError("max_views must be at least 1")
        return v

    @field_validator('time_limit_seconds')
    @classmethod
    def validate_time_limit(cls, v):
        if v is not None and v <= 0:
            raise ValueError("time_limit_seconds must be positive")
        return v

    @field_validator('expires_at')
    @classmethod
    def validate_expires_at(cls, v):
        if v is not None:
            now = datetime.now(timezone.utc)
            v_tz = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
            if v_tz <= now:
                raise ValueError("expires_at must be in the future")
        return v

class ShareResponse(BaseModel):
    id: int
    organization_id: int
    document_id: int
    document_title: str
    document_risk_level: Optional[str] = "LOW"
    document_risk_score: Optional[int] = 0
    is_safe_copy: bool = False
    created_by_id: int
    created_by_name: str
    share_type: ShareType
    recipient_user_id: Optional[int] = None
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    token: Optional[str] = None  # Returned ONLY upon creation!
    access_mode: AccessMode
    is_view_once: bool
    strict_viewing: bool = False
    time_limit_seconds: Optional[int] = None
    first_opened_at: Optional[datetime] = None
    max_views: Optional[int] = None
    views_used: int
    expires_at: Optional[datetime] = None
    is_revoked: bool
    is_used: bool
    requires_otp: bool
    approval_id: Optional[int] = None
    status: str
    seconds_remaining: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class ApprovalRequestCreate(BaseModel):
    document_id: int
    share_type: ShareType
    recipient_user_id: Optional[int] = None
    recipient_email: Optional[EmailType] = None
    access_mode: AccessMode = AccessMode.VIEW_ONLY
    is_view_once: bool = False
    strict_viewing: bool = True
    time_limit_seconds: Optional[int] = 3600
    max_views: Optional[int] = None
    expires_at: Optional[datetime] = None
    requires_otp: bool = True
    reason: str

class ApprovalReviewRequest(BaseModel):
    comment: Optional[str] = None

class ApprovalRequestResponse(BaseModel):
    id: int
    organization_id: int
    document_id: int
    document_title: str
    document_risk_score: int
    document_risk_level: str
    is_safe_copy: bool = False
    requester_id: int
    requester_name: str
    requester_email: str
    share_payload: Dict[str, Any]
    reason: str
    status: str  # PENDING, APPROVED, REJECTED
    reviewer_id: Optional[int] = None
    reviewer_name: Optional[str] = None
    review_comment: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_share_id: Optional[int] = None
    created_share_token: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ----------------- Viewer Metadata Schemas -----------------
class ViewerSessionResponse(BaseModel):
    status: str  # VALID, REVOKED, EXPIRED, ALREADY_USED, MAX_VIEWS_REACHED, NOT_YOUR_SHARE, INVALID_LINK, OTP_REQUIRED, NO_PERMISSION
    document_title: Optional[str] = None
    document_id: Optional[int] = None
    share_id: Optional[int] = None
    sender_name: Optional[str] = None
    viewer_name: Optional[str] = None
    viewer_email: Optional[str] = None
    viewer_ip: Optional[str] = None
    masked_recipient_email: Optional[str] = None
    tracking_hash: Optional[str] = None
    access_mode: Optional[AccessMode] = None
    time_limit_seconds: Optional[int] = None
    seconds_remaining: Optional[int] = None
    first_opened_at: Optional[datetime] = None
    max_views: Optional[int] = None
    views_used: Optional[int] = None
    expires_at: Optional[datetime] = None
    is_view_once: Optional[bool] = None
    strict_viewing: bool = False
    is_owner_preview: bool = False
    is_safe_copy: bool = False
    is_password_protected: bool = False
    parent_document_id: Optional[int] = None
    can_reveal_sensitive: bool = False
    redacted_findings: List[DocumentFindingResponse] = []
    demo_mode: bool = False
    message: Optional[str] = None

class SecurityEventRequest(BaseModel):
    share_id: Optional[int] = None
    document_id: Optional[int] = None
    token: Optional[str] = None
    trigger_type: str  # window_blur, visibility_hidden, mouse_leave, print_screen, shortcut_key, devtools_open

# ----------------- OTP Schemas -----------------
class OTPRequestSchema(BaseModel):
    email: EmailType
    turnstile_token: Optional[str] = None

class OTPVerifySchema(BaseModel):
    email: EmailType
    code: str

class GenericResponse(BaseModel):
    success: bool
    message: str
    masked_email: Optional[str] = None
    retry_after: Optional[int] = None

# ----------------- Dashboard Metric Schemas -----------------
class SparklinePoint(BaseModel):
    day: str
    value: int

class DashboardMetricsResponse(BaseModel):
    total_documents: int
    active_shares: int
    views_this_week: int
    shares_expiring_soon: int
    pending_members: int
    unauthorized_attempts_week: int
    pending_approvals_count: int = 0
    risk_overview: Dict[str, int] = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    views_sparkline: List[SparklinePoint]
    documents_sparkline: List[SparklinePoint]
    shares_sparkline: List[SparklinePoint]
    expiring_sparkline: List[SparklinePoint]
    views_daily_history: List[Dict[str, Any]]
    expiring_shares: List[ShareResponse]
    recent_activity: List["AuditLogResponse"]
    unopened_shares: List[ShareResponse]
    pending_join_requests: List[UserResponse]
    pending_approvals: List[ApprovalRequestResponse] = []

# ----------------- Notification Schemas -----------------
class NotificationResponse(BaseModel):
    id: int
    organization_id: int
    user_id: int
    event_type: NotificationEventType
    title: str
    message: str
    document_id: Optional[int] = None
    share_id: Optional[int] = None
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# ----------------- Audit Log Schemas -----------------
class AuditLogResponse(BaseModel):
    id: int
    organization_id: int
    action: AuditAction
    actor_id: Optional[int] = None
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    document_id: Optional[int] = None
    document_title: Optional[str] = None
    share_id: Optional[int] = None
    recipient: Optional[str] = None
    ip_address: str
    user_agent: str
    result: str
    details: Optional[str] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
