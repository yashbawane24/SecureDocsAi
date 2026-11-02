export interface RiskPolicyLevel {
  allow_internal: boolean;
  allow_external: boolean;
  allow_download: boolean;
  require_otp_external: boolean;
  force_watermark: boolean;
  force_strict_viewing: boolean;
  max_duration_hours: number;
  external_safe_copy_only: boolean;
  require_approval: boolean;
  require_approval_external_safe_copy: boolean;
}

export type RiskPolicyMap = Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', RiskPolicyLevel>;

export interface Organization {
  id: number;
  name: string;
  slug: string;
  logo_url?: string | null;
  brand_accent_color: string;
  allowed_email_domains: string[];
  invite_code: string;
  allow_external_links: boolean;
  always_require_otp: boolean;
  max_share_duration_hours: number;
  allow_downloads: boolean;
  default_watermark_text: string;
  risk_policy?: RiskPolicyMap;
  created_at: string;
}

export interface Role {
  id: number;
  organization_id: number;
  name: string;
  is_builtin: boolean;
  scope: 'OWN_DIRECT_REPORTS' | 'OWN_DEPARTMENT' | 'WHOLE_ORGANIZATION';
  permissions: string[];
  created_at: string;
}

export interface Department {
  id: number;
  organization_id: number;
  name: string;
  head_id?: number | null;
  head_name?: string | null;
  member_count: number;
  created_at: string;
}

export interface User {
  id: number;
  organization_id: number;
  organization_name?: string | null;
  organization_slug?: string | null;
  brand_accent_color?: string | null;
  organization?: Organization;
  email: string;
  full_name: string;
  role_id?: number | null;
  role_name?: string;
  role: string;
  department_id?: number | null;
  department_name?: string | null;
  department?: string | null;
  reports_to_id?: number | null;
  reports_to_name?: string | null;
  manager_name?: string | null;
  status: 'ACTIVE' | 'PENDING' | 'DEACTIVATED';
  is_active: boolean;
  avatar_color?: string | null;
  permissions?: string[];
  created_at: string;
}

export interface InviteItem {
  id: number;
  email: string;
  role_id?: number;
  role_name: string;
  department_id?: number | null;
  department_name?: string | null;
  manager_id?: number | null;
  manager_name?: string | null;
  invite_token?: string | null;
  invite_url?: string | null;
  status: string;
  expires_at: string;
  created_at: string;
}

export interface RiskContributorItem {
  label: string;
  factor?: string;
  entity_type?: string | null;
  count: number;
  unique_count: number;
  avg_confidence: number;
  points: number;
}

export interface BBoxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DocumentFindingItem {
  id: number;
  document_id: number;
  entity_type: string;
  category: string;
  masked_value: string;
  value_hash: string;
  page_number: number;
  bboxes: any[];
  confidence: number;
  detector_name: string;
  masked_context: string;
  context_snippet?: string;
  created_at: string;
}

export interface DocumentItem {
  id: number;
  organization_id: number;
  title: string;
  original_filename: string;
  file_size_bytes: number;
  mime_type: string;
  owner_id: number;
  owner_name?: string;
  active_shares_count: number;
  scan_status: 'QUEUED' | 'SCANNING' | 'COMPLETED' | 'FAILED';
  scan_progress: number;
  scan_error?: string | null;
  risk_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  risk_verdict?: string | null;
  risk_breakdown: RiskContributorItem[];
  category_summary: Record<string, number>;
  category_counts?: Record<string, number>;
  recommendations: string[];
  risk_recommendations?: string[];
  page_heatmap: Record<string, number>;
  page_count: number;
  findings_count: number;
  parent_document_id?: number | null;
  parent_document_title?: string | null;
  is_safe_copy: boolean;
  redaction_style?: string | null;
  is_password_protected: boolean;
  safe_copy_id?: number | null;
  safe_copies?: DocumentItem[];
  scanned_at?: string | null;
  created_at: string;
}

export interface DocumentAnalysis {
  document_id: number;
  title: string;
  scan_status: 'QUEUED' | 'SCANNING' | 'COMPLETED' | 'FAILED';
  scan_progress: number;
  scan_error?: string | null;
  risk_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  risk_verdict: string;
  risk_breakdown: RiskContributorItem[];
  category_summary: Record<string, number>;
  category_counts?: Record<string, number>;
  recommendations: string[];
  risk_recommendations?: string[];
  page_heatmap: Record<string, number>;
  page_count: number;
  findings: DocumentFindingItem[];
  is_safe_copy: boolean;
  parent_document_id?: number | null;
  safe_copy_id?: number | null;
  scanned_at?: string | null;
}

export interface SafeCopyCreatePayload {
  finding_ids?: number[] | null;
  categories?: string[] | null;
  entity_types?: string[] | null;
  style?: 'blackout' | 'label';
  password?: string | null;
  generate_password?: boolean;
}

export interface SafeCopyCreateResponse {
  safe_copy: DocumentItem;
  generated_password?: string | null;
  redacted_count: number;
  new_risk_score: number;
  new_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ShareItem {
  id: number;
  organization_id?: number;
  document_id: number;
  document_title: string;
  document_risk_level?: string | null;
  document_risk_score?: number | null;
  is_safe_copy?: boolean;
  created_by_id: number;
  created_by_name: string;
  share_type: 'INTERNAL' | 'LINK';
  recipient_user_id?: number | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  token?: string | null;
  access_mode: 'VIEW_ONLY' | 'ALLOW_DOWNLOAD';
  is_view_once: boolean;
  strict_viewing?: boolean;
  time_limit_seconds?: number | null;
  first_opened_at?: string | null;
  max_views?: number | null;
  views_used: number;
  expires_at?: string | null;
  is_revoked: boolean;
  is_used: boolean;
  requires_otp: boolean;
  approval_id?: number | null;
  status: string;
  seconds_remaining?: number | null;
  created_at: string;
}

export interface ApprovalRequestItem {
  id: number;
  organization_id: number;
  document_id: number;
  document_title: string;
  document_risk_score: number;
  document_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  risk_score?: number;
  risk_level?: string;
  is_safe_copy: boolean;
  requester_id: number;
  requester_name: string;
  requester_email: string;
  share_type?: string;
  recipient_email?: string;
  share_payload: Record<string, any>;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewer_id?: number | null;
  reviewer_name?: string | null;
  review_comment?: string | null;
  reviewer_comment?: string | null;
  reviewed_at?: string | null;
  created_share_id?: number | null;
  created_share_token?: string | null;
  created_at: string;
}

export interface AuditLogItem {
  id: number;
  organization_id?: number;
  action: string;
  actor_id?: number | null;
  actor_email?: string | null;
  actor_name?: string | null;
  document_id?: number | null;
  document_title?: string | null;
  share_id?: number | null;
  recipient?: string | null;
  ip_address: string;
  user_agent: string;
  result: string;
  details?: string | null;
  timestamp: string;
}

export interface DocumentDetail extends DocumentItem {
  shares: ShareItem[];
  recent_activity: AuditLogItem[];
  findings: DocumentFindingItem[];
}

export interface SparklinePoint {
  day: string;
  value: number;
}

export interface DashboardMetrics {
  total_documents: number;
  active_shares: number;
  views_this_week: number;
  shares_expiring_soon: number;
  pending_members: number;
  pending_approvals_count: number;
  unauthorized_attempts_week: number;
  risk_overview: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>;
  documents_sparkline: SparklinePoint[];
  shares_sparkline: SparklinePoint[];
  views_sparkline: SparklinePoint[];
  expiring_sparkline: SparklinePoint[];
  views_daily_history: { date: string; views: number; downloads?: number }[];
  expiring_shares: ShareItem[];
  recent_activity: AuditLogItem[];
  unopened_shares: ShareItem[];
  pending_join_requests: User[];
  pending_approvals: ApprovalRequestItem[];
}

export interface ViewerSession {
  status: 'VALID' | 'REVOKED' | 'EXPIRED' | 'ALREADY_USED' | 'MAX_VIEWS_REACHED' | 'NOT_YOUR_SHARE' | 'INVALID_LINK' | 'OTP_REQUIRED' | 'NO_PERMISSION' | 'NOT_FOUND' | 'USED';
  document_id?: number;
  share_id?: number;
  document_title?: string;
  risk_level?: string | null;
  risk_score?: number | null;
  sender_name?: string;
  viewer_name?: string;
  viewer_email?: string;
  viewer_ip?: string;
  masked_recipient_email?: string | null;
  tracking_hash?: string;
  access_mode?: 'VIEW_ONLY' | 'ALLOW_DOWNLOAD';
  time_limit_seconds?: number | null;
  seconds_remaining?: number | null;
  first_opened_at?: string | null;
  max_views?: number | null;
  views_used?: number;
  expires_at?: string | null;
  is_view_once?: boolean;
  strict_viewing?: boolean;
  is_owner_preview?: boolean;
  is_safe_copy?: boolean;
  is_password_protected?: boolean;
  parent_document_id?: number | null;
  can_reveal_sensitive?: boolean;
  redacted_findings?: DocumentFindingItem[];
  demo_mode?: boolean;
  message?: string;
}

export interface NotificationItem {
  id: number;
  organization_id: number;
  user_id: number;
  event_type: string;
  title: string;
  message: string;
  document_id?: number | null;
  share_id?: number | null;
  is_read: boolean;
  created_at: string;
}

const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let errorDetail = 'Request failed';
    try {
      const errData = await res.json();
      errorDetail = errData.detail || errData.message || errorDetail;
    } catch {
      errorDetail = `HTTP ${res.status}: ${res.statusText}`;
    }
    throw new Error(errorDetail);
  }

  return res.json();
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async signup(data: { org_name: string; full_name: string; email: string; password: string }): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/auth/signup`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async join(data: { invite_code: string; full_name: string; email: string; password: string }): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/auth/join`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async acceptInvite(data: { token: string; full_name: string; password: string }): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/auth/accept-invite`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    return fetchJSON(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword(data: { email: string; code: string; new_password: string }): Promise<{ message: string }> {
    return fetchJSON(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async logout(): Promise<void> {
    await fetchJSON(`${API_BASE}/auth/logout`, { method: 'POST' });
  },

  async getMe(): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/auth/me`);
  },

  async getAllowedRecipients(): Promise<User[]> {
    return fetchJSON<User[]>(`${API_BASE}/auth/allowed-recipients`);
  },

  // Organization Settings (A1 & A2 & B5)
  async getOrgSettings(): Promise<Organization> {
    return fetchJSON<Organization>(`${API_BASE}/org/settings`);
  },

  async updateOrgSettings(payload: Partial<Organization>): Promise<Organization> {
    return fetchJSON<Organization>(`${API_BASE}/org/settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async regenerateInviteCode(): Promise<Organization> {
    return fetchJSON<Organization>(`${API_BASE}/org/invite-code/regenerate`, {
      method: 'POST',
    });
  },

  async getCurrentOrg(): Promise<Organization> {
    return this.getOrgSettings();
  },

  async updateCurrentOrg(payload: Partial<Organization>): Promise<Organization> {
    return this.updateOrgSettings(payload);
  },

  // Roles & Permissions
  async listRoles(): Promise<Role[]> {
    return fetchJSON<Role[]>(`${API_BASE}/roles`);
  },

  async createRole(data: { name: string; scope: string; permissions: string[] }): Promise<Role> {
    return fetchJSON<Role>(`${API_BASE}/roles`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateRole(id: number, data: { name?: string; scope?: string; permissions?: string[] }): Promise<Role> {
    return fetchJSON<Role>(`${API_BASE}/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async updateRoleMatrix(roles: { role_id: number; scope: string; permissions: string[] }[]): Promise<Role[]> {
    return fetchJSON<Role[]>(`${API_BASE}/roles/matrix`, {
      method: 'PATCH',
      body: JSON.stringify({ roles }),
    });
  },

  async deleteRole(id: number): Promise<void> {
    await fetchJSON(`${API_BASE}/roles/${id}`, { method: 'DELETE' });
  },

  // Departments
  async listDepartments(): Promise<Department[]> {
    return fetchJSON<Department[]>(`${API_BASE}/departments`);
  },

  async createDepartment(data: { name: string; head_id?: number | null }): Promise<Department> {
    return fetchJSON<Department>(`${API_BASE}/departments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateDepartment(id: number, data: { name?: string; head_id?: number | null }): Promise<Department> {
    return fetchJSON<Department>(`${API_BASE}/departments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Members
  async listMembers(params?: { search?: string; role?: string; department?: string; status?: string }): Promise<User[]> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.role) query.set('role', params.role);
    if (params?.department) query.set('department', params.department);
    if (params?.status) query.set('status_filter', params.status);
    return fetchJSON<User[]>(`${API_BASE}/members?${query.toString()}`);
  },

  async getOrgTree(): Promise<any> {
    return fetchJSON<any>(`${API_BASE}/members/tree`);
  },

  async updateMember(id: number, data: { role_id?: number; department_id?: number; reports_to_id?: number | null; status?: string }): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/members/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async approveMember(id: number): Promise<User> {
    return fetchJSON<User>(`${API_BASE}/members/${id}/approve`, { method: 'POST' });
  },

  async rejectMember(id: number): Promise<{ message: string }> {
    return fetchJSON(`${API_BASE}/members/${id}/reject`, { method: 'POST' });
  },

  async listInvites(): Promise<InviteItem[]> {
    return fetchJSON<InviteItem[]>(`${API_BASE}/members/invites`);
  },

  async createInvite(data: { email: string; role_id: number; department_id?: number; manager_id?: number }): Promise<any> {
    return fetchJSON<any>(`${API_BASE}/members/invites`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteInvite(id: number): Promise<void> {
    await fetchJSON(`${API_BASE}/members/invites/${id}`, { method: 'DELETE' });
  },

  // Dashboard
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    return fetchJSON<DashboardMetrics>(`${API_BASE}/dashboard/metrics`);
  },

  // Documents (Part B)
  async listDocuments(riskLevelOrParams?: string | { risk_level?: string; search?: string }): Promise<DocumentItem[]> {
    const query = new URLSearchParams();
    if (typeof riskLevelOrParams === 'string') {
      if (riskLevelOrParams && riskLevelOrParams !== 'ALL') {
        query.set('risk_level', riskLevelOrParams);
      }
    } else if (riskLevelOrParams && typeof riskLevelOrParams === 'object') {
      if (riskLevelOrParams.risk_level && riskLevelOrParams.risk_level !== 'ALL') {
        query.set('risk_level', riskLevelOrParams.risk_level);
      }
      if (riskLevelOrParams.search) {
        query.set('search', riskLevelOrParams.search);
      }
    }
    const qs = query.toString();
    return fetchJSON<DocumentItem[]>(`${API_BASE}/documents${qs ? `?${qs}` : ''}`);
  },

  async getDocumentDetail(id: number): Promise<DocumentDetail> {
    const raw = await fetchJSON<any>(`${API_BASE}/documents/${id}`);
    if (raw && raw.document) {
      return {
        ...raw.document,
        shares: raw.shares || [],
        recent_activity: raw.activity || raw.recent_activity || [],
        findings: raw.findings || [],
      };
    }
    return {
      ...raw,
      shares: raw.shares || [],
      recent_activity: raw.activity || raw.recent_activity || [],
      findings: raw.findings || [],
    };
  },

  async getDocumentAnalysis(id: number): Promise<DocumentAnalysis> {
    return fetchJSON<DocumentAnalysis>(`${API_BASE}/documents/${id}/analysis`);
  },

  async getDocumentFindings(id: number): Promise<DocumentAnalysis> {
    return this.getDocumentAnalysis(id);
  },

  async rescanDocument(id: number): Promise<DocumentAnalysis> {
    return fetchJSON<DocumentAnalysis>(`${API_BASE}/documents/${id}/rescan`, {
      method: 'POST',
    });
  },

  async createSafeCopy(id: number, payload: SafeCopyCreatePayload): Promise<SafeCopyCreateResponse> {
    return fetchJSON<SafeCopyCreateResponse>(`${API_BASE}/documents/${id}/safe-copy`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getDocumentDownloadUrl(id: number): string {
    return `${API_BASE}/documents/${id}/download`;
  },

  getRiskReportUrl(id: number): string {
    return `${API_BASE}/documents/${id}/report.pdf`;
  },

  async revealSensitiveFinding(docId: number, findingId: number): Promise<{ finding_id: number; entity_type: string; raw_value: string; expires_in_seconds: number }> {
    return fetchJSON(`${API_BASE}/documents/${docId}/findings/${findingId}/reveal`, {
      method: 'POST',
    });
  },

  async uploadDocument(formData: FormData): Promise<DocumentItem> {
    const res = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  async deleteDocument(id: number): Promise<void> {
    await fetchJSON(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
  },

  // Shares & Export CSV (A4)
  async createShare(payload: any): Promise<ShareItem> {
    return fetchJSON<ShareItem>(`${API_BASE}/shares`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listMyShares(): Promise<ShareItem[]> {
    return fetchJSON<ShareItem[]>(`${API_BASE}/shares/my-shares`);
  },

  async listSharedWithMe(): Promise<ShareItem[]> {
    return fetchJSON<ShareItem[]>(`${API_BASE}/shares/shared-with-me`);
  },

  async revokeShare(id: number): Promise<ShareItem> {
    return fetchJSON<ShareItem>(`${API_BASE}/shares/${id}/revoke`, {
      method: 'POST',
    });
  },

  getSharesExportUrl(): string {
    return `${API_BASE}/shares/export.csv`;
  },

  // Share Approvals (B5 & B7)
  async listApprovals(statusFilter?: string, tab?: string): Promise<ApprovalRequestItem[]> {
    const query = new URLSearchParams();
    if (statusFilter && statusFilter !== 'ALL') {
      query.set('status_filter', statusFilter);
    }
    if (tab) {
      query.set('tab', tab);
    }
    const qs = query.toString();
    return fetchJSON<ApprovalRequestItem[]>(`${API_BASE}/approvals${qs ? `?${qs}` : ''}`);
  },

  async listApprovalRequests(statusFilter?: string, tab?: string): Promise<ApprovalRequestItem[]> {
    return this.listApprovals(statusFilter, tab);
  },

  async createApprovalRequest(payload: {
    document_id: number;
    share_type: 'INTERNAL' | 'LINK';
    recipient_user_id?: number | null;
    recipient_email?: string | null;
    access_mode?: 'VIEW_ONLY' | 'ALLOW_DOWNLOAD';
    is_view_once?: boolean;
    time_limit_seconds?: number | null;
    max_views?: number | null;
    expires_at?: string | null;
    requires_otp?: boolean;
    reason: string;
  }): Promise<ApprovalRequestItem> {
    return fetchJSON<ApprovalRequestItem>(`${API_BASE}/approvals`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async approveShareRequest(id: number, comment?: string): Promise<ApprovalRequestItem> {
    return fetchJSON<ApprovalRequestItem>(`${API_BASE}/approvals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment || 'Approved' }),
    });
  },

  async rejectShareRequest(id: number, comment?: string): Promise<ApprovalRequestItem> {
    return fetchJSON<ApprovalRequestItem>(`${API_BASE}/approvals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment || 'Rejected' }),
    });
  },

  // Secure Viewers & Screenshot Deterrence (A3, A6, A7)
  async reportSecurityEvent(payload: {
    share_id?: number;
    token?: string;
    document_id?: number;
    event_type?: string;
    trigger_type: string;
    details?: string;
  }): Promise<{ success: boolean; message: string }> {
    return fetchJSON(`${API_BASE}/view/security-event`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // 1. Internal Share Viewer (Authenticated)
  async getInternalViewStatus(shareId: number | string): Promise<ViewerSession> {
    return fetchJSON<ViewerSession>(`${API_BASE}/view/internal/${shareId}/status`);
  },

  async createInternalViewSession(shareId: number | string): Promise<{ session_id: string; expires_at: string; seconds_remaining: number }> {
    return fetchJSON(`${API_BASE}/view/internal/${shareId}/session`, {
      method: 'POST',
    });
  },

  getInternalContentUrl(shareId: number | string, sessionId?: string): string {
    const base = `${API_BASE}/view/internal/${shareId}/content`;
    return sessionId ? `${base}?session_id=${encodeURIComponent(sessionId)}` : base;
  },

  getInternalDownloadUrl(shareId: number | string): string {
    return `${API_BASE}/view/internal/${shareId}/download`;
  },

  // 2. Owner Preview Viewer
  async getDocPreviewStatus(docId: number | string): Promise<ViewerSession> {
    return fetchJSON<ViewerSession>(`${API_BASE}/view/doc/${docId}/status`);
  },

  getDocPreviewContentUrl(docId: number | string): string {
    return `${API_BASE}/view/doc/${docId}/content`;
  },

  // 3. External Link Share Viewer (OTP Protected)
  async getLinkViewStatus(token: string): Promise<ViewerSession> {
    return fetchJSON<ViewerSession>(`${API_BASE}/view/s/${token}/status`);
  },

  async createLinkViewSession(token: string): Promise<{ session_id: string; expires_at: string; seconds_remaining: number }> {
    return fetchJSON(`${API_BASE}/view/s/${token}/session`, {
      method: 'POST',
    });
  },

  async requestLinkOtp(token: string, email: string, turnstileToken?: string): Promise<{ success: boolean; message: string; masked_email?: string; retry_after?: number; resend_cooldown_seconds?: number }> {
    return fetchJSON(`${API_BASE}/view/s/${token}/otp/request`, {
      method: 'POST',
      body: JSON.stringify({ email, turnstile_token: turnstileToken }),
    });
  },

  async verifyLinkOtp(token: string, email: string, code: string): Promise<{ success: boolean; message: string }> {
    return fetchJSON(`${API_BASE}/view/s/${token}/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
  },

  getLinkContentUrl(token: string, sessionId?: string): string {
    const base = `${API_BASE}/view/s/${token}/content`;
    return sessionId ? `${base}?session_id=${encodeURIComponent(sessionId)}` : base;
  },

  getLinkDownloadUrl(token: string): string {
    return `${API_BASE}/view/s/${token}/download`;
  },

  // Legacy fallback
  async getViewStatus(token: string): Promise<ViewerSession> {
    return this.getLinkViewStatus(token);
  },
  getViewContentUrl(token: string): string {
    return this.getLinkContentUrl(token);
  },
  getViewDownloadUrl(token: string): string {
    return this.getLinkDownloadUrl(token);
  },
  async requestOtp(token: string, email: string, turnstileToken?: string) {
    return this.requestLinkOtp(token, email, turnstileToken);
  },
  async verifyOtp(token: string, email: string, code: string) {
    return this.verifyLinkOtp(token, email, code);
  },

  // Notifications
  async getNotifications(): Promise<{ notifications: NotificationItem[]; unread_count: number }> {
    return fetchJSON(`${API_BASE}/notifications`);
  },

  async markNotificationRead(id: number): Promise<void> {
    await fetchJSON(`${API_BASE}/notifications/${id}/read`, { method: 'POST' });
  },

  async markAllNotificationsRead(): Promise<void> {
    await fetchJSON(`${API_BASE}/notifications/read-all`, { method: 'POST' });
  },

  // Audit & CSV Export (A4)
  async listAuditLogs(params?: {
    action?: string;
    result?: string;
    actor_email?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogItem[]> {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.result) query.set('result', params.result);
    if (params?.actor_email) query.set('actor_email', params.actor_email);
    if (params?.date_from) query.set('date_from', params.date_from);
    if (params?.date_to) query.set('date_to', params.date_to);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    return fetchJSON<AuditLogItem[]>(`${API_BASE}/audit?${query.toString()}`);
  },

  getAuditExportUrl(params?: {
    action?: string;
    result?: string;
    actor_email?: string;
    date_from?: string;
    date_to?: string;
  }): string {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.result) query.set('result', params.result);
    if (params?.actor_email) query.set('actor_email', params.actor_email);
    if (params?.date_from) query.set('date_from', params.date_from);
    if (params?.date_to) query.set('date_to', params.date_to);
    const qs = query.toString();
    return `${API_BASE}/audit/export.csv${qs ? `?${qs}` : ''}`;
  },

  // Demo Inbox (Dev Mode Email Simulator)
  async getDemoInboxMessages(): Promise<{ messages: any[]; count: number }> {
    return fetchJSON<{ messages: any[]; count: number }>(`${API_BASE}/demo-inbox/messages`);
  },

  async clearDemoInbox(): Promise<{ status: string }> {
    return fetchJSON<{ status: string }>(`${API_BASE}/demo-inbox/messages`, {
      method: 'DELETE',
    });
  },
};
