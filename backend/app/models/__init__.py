import enum
import json
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, ForeignKey, Text, Enum
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class UserStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"
    DEACTIVATED = "DEACTIVATED"

class PermissionScope(str, enum.Enum):
    OWN_DIRECT_REPORTS = "OWN_DIRECT_REPORTS"
    OWN_DEPARTMENT = "OWN_DEPARTMENT"
    WHOLE_ORGANIZATION = "WHOLE_ORGANIZATION"

class ScanStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    SCANNING = "SCANNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class RiskLevel(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

DEFAULT_RISK_POLICY = {
    "LOW": {
        "allow_internal": True,
        "allow_external": True,
        "allow_download": True,
        "require_otp_external": False,
        "force_watermark": False,
        "force_strict_viewing": False,
        "max_duration_hours": 168,
        "external_safe_copy_only": False,
        "require_approval": False,
        "require_approval_external_safe_copy": False,
    },
    "MEDIUM": {
        "allow_internal": True,
        "allow_external": True,
        "allow_download": True,
        "require_otp_external": True,
        "force_watermark": True,
        "force_strict_viewing": False,
        "max_duration_hours": 168,
        "external_safe_copy_only": False,
        "require_approval": False,
        "require_approval_external_safe_copy": False,
    },
    "HIGH": {
        "allow_internal": True,
        "allow_external": True,
        "allow_download": False,
        "require_otp_external": True,
        "force_watermark": True,
        "force_strict_viewing": True,
        "max_duration_hours": 24,
        "external_safe_copy_only": True,
        "require_approval": False,
        "require_approval_external_safe_copy": False,
    },
    "CRITICAL": {
        "allow_internal": False,
        "allow_external": False,
        "allow_download": False,
        "require_otp_external": True,
        "force_watermark": True,
        "force_strict_viewing": True,
        "max_duration_hours": 24,
        "external_safe_copy_only": True,
        "require_approval": True,
        "require_approval_external_safe_copy": True,
    },
}

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    logo_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    brand_accent_color: Mapped[str] = mapped_column(String(20), default="#1E6B52")
    allowed_email_domains: Mapped[str] = mapped_column(String(255), default="")  # comma-separated e.g. "northwind.test"
    invite_code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    users: Mapped[List["User"]] = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    departments: Mapped[List["Department"]] = relationship("Department", back_populates="organization", cascade="all, delete-orphan")
    roles: Mapped[List["Role"]] = relationship("Role", back_populates="organization", cascade="all, delete-orphan")
    documents: Mapped[List["Document"]] = relationship("Document", back_populates="organization", cascade="all, delete-orphan")
    shares: Mapped[List["Share"]] = relationship("Share", back_populates="organization", cascade="all, delete-orphan")

    @property
    def settings(self) -> Dict[str, Any]:
        try:
            data = json.loads(self.settings_json)
            if "risk_policy" not in data:
                data["risk_policy"] = DEFAULT_RISK_POLICY
            return data
        except Exception:
            return {"risk_policy": DEFAULT_RISK_POLICY}

    @settings.setter
    def settings(self, val: Dict[str, Any]):
        self.settings_json = json.dumps(val)

class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    head_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="departments")
    head: Mapped[Optional["User"]] = relationship("User", foreign_keys=[head_id])
    members: Mapped[List["User"]] = relationship("User", back_populates="department_rel", foreign_keys="User.department_id")

class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    scope: Mapped[str] = mapped_column(String(50), default=PermissionScope.WHOLE_ORGANIZATION.value)
    permissions_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="roles")
    users: Mapped[List["User"]] = relationship("User", back_populates="role_rel")

    @property
    def permissions(self) -> List[str]:
        try:
            return json.loads(self.permissions_json)
        except Exception:
            return []

    @permissions.setter
    def permissions(self, val: List[str]):
        self.permissions_json = json.dumps(val)

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    
    role_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("roles.id"), nullable=True)
    role_name: Mapped[str] = mapped_column(String(50), nullable=False, default="Employee")
    
    department_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    department_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    reports_to_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=UserStatus.ACTIVE.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    avatar_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    # Relationships
    organization: Mapped["Organization"] = relationship("Organization", back_populates="users")
    role_rel: Mapped[Optional["Role"]] = relationship("Role", back_populates="users", foreign_keys=[role_id])
    department_rel: Mapped[Optional["Department"]] = relationship("Department", back_populates="members", foreign_keys=[department_id])
    manager: Mapped[Optional["User"]] = relationship("User", remote_side=[id], backref="direct_reports")
    documents: Mapped[List["Document"]] = relationship("Document", back_populates="owner", cascade="all, delete-orphan")
    notifications: Mapped[List["Notification"]] = relationship("Notification", back_populates="user", cascade="all, delete-orphan")

    @property
    def role(self) -> str:
        return self.role_name

class OrganizationInvite(Base):
    __tablename__ = "organization_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("roles.id"), nullable=False)
    department_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    manager_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING, ACCEPTED, CANCELLED
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    organization: Mapped["Organization"] = relationship("Organization")
    role: Mapped["Role"] = relationship("Role")
    department: Mapped[Optional["Department"]] = relationship("Department")
    manager: Mapped[Optional["User"]] = relationship("User")

class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), default="application/pdf")
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    encryption_iv: Mapped[str] = mapped_column(String(64), nullable=False)   # hex AES GCM IV
    encryption_tag: Mapped[str] = mapped_column(String(64), nullable=False)  # hex AES GCM Tag
    
    # Sensitive Data Scanner & Risk Score Fields (PART B)
    scan_status: Mapped[str] = mapped_column(String(20), default=ScanStatus.COMPLETED.value)
    scan_progress: Mapped[int] = mapped_column(Integer, default=100)
    scan_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(20), default=RiskLevel.LOW.value)
    risk_verdict: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_breakdown_json: Mapped[str] = mapped_column(Text, default="[]")
    category_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    recommendations_json: Mapped[str] = mapped_column(Text, default="[]")
    page_heatmap_json: Mapped[str] = mapped_column(Text, default="{}")
    page_count: Mapped[int] = mapped_column(Integer, default=1)
    scanned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Safe Copy / Redaction Lineage (B6)
    parent_document_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("documents.id"), nullable=True)
    is_safe_copy: Mapped[bool] = mapped_column(Boolean, default=False)
    redaction_style: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # "blackout" | "label"
    is_password_protected: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="documents")
    owner: Mapped["User"] = relationship("User", back_populates="documents")
    shares: Mapped[List["Share"]] = relationship("Share", back_populates="document", cascade="all, delete-orphan")
    findings: Mapped[List["DocumentFinding"]] = relationship(
        "DocumentFinding",
        back_populates="document",
        cascade="all, delete-orphan",
        foreign_keys="DocumentFinding.document_id"
    )
    safe_copies: Mapped[List["Document"]] = relationship(
        "Document",
        remote_side=[parent_document_id],
        viewonly=True
    )

    @property
    def risk_breakdown(self) -> List[Dict[str, Any]]:
        try:
            return json.loads(self.risk_breakdown_json)
        except Exception:
            return []

    @property
    def category_summary(self) -> Dict[str, int]:
        try:
            return json.loads(self.category_summary_json)
        except Exception:
            return {}

    @property
    def recommendations(self) -> List[str]:
        try:
            return json.loads(self.recommendations_json)
        except Exception:
            return []

    @property
    def page_heatmap(self) -> Dict[str, int]:
        try:
            return json.loads(self.page_heatmap_json)
        except Exception:
            return {}

class DocumentFinding(Base):
    """
    Stores ONLY masked values, salted SHA-256 hashes, and AES-GCM encrypted tokens for selective reveal.
    NEVER stores raw sensitive plaintext in the database.
    """
    __tablename__ = "document_findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False)  # Identity, Financial, Health, Credentials, Contact, Legal/HR
    masked_value: Mapped[str] = mapped_column(String(255), nullable=False)
    value_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)  # salted SHA-256
    page_number: Mapped[int] = mapped_column(Integer, default=1)
    bbox_json: Mapped[str] = mapped_column(Text, default="[]")  # list of [x0, y0, x1, y1]
    confidence: Mapped[float] = mapped_column(Float, default=0.85)
    detector_name: Mapped[str] = mapped_column(String(100), default="custom")
    masked_context: Mapped[str] = mapped_column(Text, default="")
    encrypted_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # AES-256-GCM ciphertext (iv:tag:ct) for reveal_sensitive
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped["Document"] = relationship("Document", back_populates="findings", foreign_keys=[document_id])

    @property
    def bboxes(self) -> List[List[float]]:
        try:
            return json.loads(self.bbox_json)
        except Exception:
            return []

class ShareType(str, enum.Enum):
    INTERNAL = "INTERNAL"
    LINK = "LINK"

class AccessMode(str, enum.Enum):
    VIEW_ONLY = "VIEW_ONLY"
    ALLOW_DOWNLOAD = "ALLOW_DOWNLOAD"

class Share(Base):
    __tablename__ = "shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("documents.id"), nullable=False)
    created_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    share_type: Mapped[ShareType] = mapped_column(Enum(ShareType), nullable=False)
    recipient_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    recipient_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    access_mode: Mapped[AccessMode] = mapped_column(Enum(AccessMode), default=AccessMode.VIEW_ONLY)
    is_view_once: Mapped[bool] = mapped_column(Boolean, default=False)
    strict_viewing: Mapped[bool] = mapped_column(Boolean, default=False)
    time_limit_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    first_opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    max_views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    views_used: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_otp: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="shares")
    document: Mapped["Document"] = relationship("Document", back_populates="shares")
    created_by: Mapped["User"] = relationship("User", foreign_keys=[created_by_id])
    recipient_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[recipient_user_id])

class ShareApprovalRequest(Base):
    __tablename__ = "share_approval_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    requester_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    share_payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)  # PENDING, APPROVED, REJECTED
    reviewer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    review_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_share_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("shares.id"), nullable=True)
    created_share_token: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped["Document"] = relationship("Document", foreign_keys=[document_id])
    requester: Mapped["User"] = relationship("User", foreign_keys=[requester_id])
    reviewer: Mapped[Optional["User"]] = relationship("User", foreign_keys=[reviewer_id])

    @property
    def share_payload(self) -> Dict[str, Any]:
        try:
            return json.loads(self.share_payload_json)
        except Exception:
            return {}

class OTPRequest(Base):
    __tablename__ = "otp_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    share_id: Mapped[int] = mapped_column(Integer, ForeignKey("shares.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    salt: Mapped[str] = mapped_column(String(32), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

class NotificationEventType(str, enum.Enum):
    DOC_OPENED = "DOC_OPENED"
    DOC_EXPIRED = "DOC_EXPIRED"
    UNAUTHORIZED_ACCESS_ATTEMPT = "UNAUTHORIZED_ACCESS_ATTEMPT"
    MEMBER_JOIN_REQUEST = "MEMBER_JOIN_REQUEST"
    SHARE_REVOKED = "SHARE_REVOKED"
    SCREENSHOT_ATTEMPT_SUSPECTED = "SCREENSHOT_ATTEMPT_SUSPECTED"
    APPROVAL_REQUESTED = "APPROVAL_REQUESTED"
    APPROVAL_RESOLVED = "APPROVAL_RESOLVED"
    SCAN_COMPLETED = "SCAN_COMPLETED"

class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    event_type: Mapped[NotificationEventType] = mapped_column(Enum(NotificationEventType), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    document_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("documents.id"), nullable=True)
    share_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("shares.id"), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped["User"] = relationship("User", back_populates="notifications")

class AuditAction(str, enum.Enum):
    OPEN = "OPEN"
    PREVIEW = "PREVIEW"
    DOWNLOAD = "DOWNLOAD"
    REVOKE = "REVOKE"
    FAILED_ATTEMPT = "FAILED_ATTEMPT"
    LOGIN = "LOGIN"
    OTP_REQUEST = "OTP_REQUEST"
    OTP_FAIL = "OTP_FAIL"
    ROLE_CHANGE = "ROLE_CHANGE"
    PERMISSION_CHANGE = "PERMISSION_CHANGE"
    INVITE_CREATE = "INVITE_CREATE"
    INVITE_ACCEPT = "INVITE_ACCEPT"
    MEMBER_APPROVE = "MEMBER_APPROVE"
    MEMBER_DEACTIVATE = "MEMBER_DEACTIVATE"
    ORG_SETTINGS_UPDATE = "ORG_SETTINGS_UPDATE"
    AUDIT_EXPORT = "AUDIT_EXPORT"
    SCREENSHOT_ATTEMPT_SUSPECTED = "SCREENSHOT_ATTEMPT_SUSPECTED"
    RISK_POLICY_APPLIED = "RISK_POLICY_APPLIED"
    SHARE_BLOCKED_BY_RISK = "SHARE_BLOCKED_BY_RISK"
    APPROVAL_REQUESTED = "APPROVAL_REQUESTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CRITICAL_SHARE_SELF_AUTHORISED = "CRITICAL_SHARE_SELF_AUTHORISED"
    SAFE_COPY_CREATED = "SAFE_COPY_CREATED"
    SENSITIVE_VALUE_REVEALED = "SENSITIVE_VALUE_REVEALED"
    DOCUMENT_SCANNED = "DOCUMENT_SCANNED"

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    action: Mapped[AuditAction] = mapped_column(Enum(AuditAction), nullable=False, index=True)
    actor_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    actor_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    document_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("documents.id"), nullable=True)
    share_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("shares.id"), nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False)
    user_agent: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str] = mapped_column(String(50), nullable=False)  # SUCCESS, FAILURE, BLOCKED
    details: Mapped[str] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    document: Mapped[Optional["Document"]] = relationship("Document", foreign_keys=[document_id])
