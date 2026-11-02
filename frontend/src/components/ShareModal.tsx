import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Users,
  Link as LinkIcon,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  ShieldAlert,
  Sparkles,
  FileText,
  Search,
} from 'lucide-react';
import { DocumentItem, User, api, ShareItem, ApprovalRequestItem } from '../api/client';
import { queryClient, queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { RiskChip } from './RiskChip';

interface ShareModalProps {
  isOpen: boolean;
  documentId?: number;
  documentTitle?: string;
  riskScore?: number;
  riskLevel?: string;
  riskVerdict?: string | null;
  isSafeCopy?: boolean;
  onClose: () => void;
  onOpenSafeCopyModal?: () => void;
  onSuccess: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  documentId: initialDocId,
  onClose,
  onSuccess,
}) => {
  const { user, hasPermission } = useAuth();
  const canApproveShares = Boolean(
    user?.role === 'Owner' ||
      user?.role === 'Admin' ||
      user?.role_name === 'Owner' ||
      user?.role_name === 'Admin' ||
      hasPermission('shares.approve')
  );

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<number | ''>(initialDocId || '');

  const [tab, setTab] = useState<'internal' | 'link'>('internal');
  const [allowedRecipients, setAllowedRecipients] = useState<User[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<number | ''>('');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [externalEmail, setExternalEmail] = useState('');

  // Rules state
  const [accessMode, setAccessMode] = useState<'VIEW_ONLY' | 'ALLOW_DOWNLOAD'>('VIEW_ONLY');
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [strictViewing, setStrictViewing] = useState(false);
  const [timeLimitOption, setTimeLimitOption] = useState<string>('none');
  const [customTimeMinutes] = useState<number>(10);
  const [maxViews, setMaxViews] = useState<number>(3);
  const [expiryDays, setExpiryDays] = useState<string>('7');
  const [requiresOtp, setRequiresOtp] = useState<boolean>(true);

  // Critical sharing states
  const [criticalConfirmText, setCriticalConfirmText] = useState('');
  const [criticalSelfReason, setCriticalSelfReason] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [createdApproval, setCreatedApproval] = useState<ApprovalRequestItem | null>(null);
  const [creatingSafeCopy, setCreatingSafeCopy] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdShare, setCreatedShare] = useState<ShareItem | null>(null);
  const [copied, setCopied] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setCreatedShare(null);
    setCreatedApproval(null);
    setError(null);
    setApprovalReason('');
    setPeopleSearch('');

    const fetchInit = async () => {
      try {
        const [docs, recipients] = await Promise.allSettled([
          api.listDocuments(),
          api.getAllowedRecipients(),
        ]);

        if (docs.status === 'fulfilled') {
          setDocuments(docs.value);
          if (initialDocId) {
            setSelectedDocId(initialDocId);
          } else if (!selectedDocId && docs.value.length > 0) {
            setSelectedDocId(docs.value[0].id);
          }
        }

        if (recipients.status === 'fulfilled') {
          setAllowedRecipients(recipients.value);
          if (recipients.value.length > 0 && !selectedRecipientId) {
            setSelectedRecipientId(recipients.value[0].id);
          }
        }
      } catch (e: any) {
        setError(e.message || 'Failed to load recipients');
      }
    };

    fetchInit();
  }, [isOpen, initialDocId]);

  const currentDoc = documents.find((d) => d.id === Number(selectedDocId)) || null;
  const riskLevel = (currentDoc?.risk_level || 'LOW').toUpperCase() as
    | 'LOW'
    | 'MEDIUM'
    | 'HIGH'
    | 'CRITICAL';
  const isOriginalHighOrCritical = Boolean(
    currentDoc && !currentDoc.is_safe_copy && (riskLevel === 'HIGH' || riskLevel === 'CRITICAL')
  );
  const isCriticalBlocked = Boolean(
    currentDoc && !currentDoc.is_safe_copy && riskLevel === 'CRITICAL'
  );
  const isExternalBlockedForHighOriginal = Boolean(
    currentDoc && !currentDoc.is_safe_copy && riskLevel === 'HIGH' && tab === 'link'
  );
  const isDownloadDisabledByRisk = Boolean(riskLevel === 'HIGH' || riskLevel === 'CRITICAL');
  const isStrictForced = Boolean(isViewOnce || riskLevel === 'HIGH' || riskLevel === 'CRITICAL');

  useEffect(() => {
    if (!currentDoc) return;
    if (riskLevel === 'MEDIUM' || riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      setRequiresOtp(true);
    }
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      setAccessMode('VIEW_ONLY');
      setStrictViewing(true);
      setExpiryDays('1');
      if (timeLimitOption === 'none') {
        setTimeLimitOption('3600');
      }
    }
  }, [currentDoc?.id, riskLevel]);

  const handleSwitchToSafeCopy = async () => {
    if (!currentDoc) return;
    setError(null);
    if (currentDoc.safe_copy_id) {
      const existing = documents.find((d) => d.id === currentDoc.safe_copy_id);
      if (existing) {
        setSelectedDocId(existing.id);
        return;
      }
    }
    try {
      setCreatingSafeCopy(true);
      const res = await api.createSafeCopy(currentDoc.id, {
        style: 'blackout',
        generate_password: false,
      });
      const updatedDocs = await api.listDocuments();
      setDocuments(updatedDocs);
      setSelectedDocId(res.safe_copy.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.documentsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.documentDetail(currentDoc.id) });
    } catch (e: any) {
      setError(e.message || 'Could not generate safe copy');
    } finally {
      setCreatingSafeCopy(false);
    }
  };

  // Preset chips ("Quick internal", "View once", "Strict external")
  const applyPreset = (preset: 'quick_internal' | 'view_once' | 'strict_external') => {
    if (preset === 'quick_internal') {
      setIsViewOnce(false);
      setTimeLimitOption('none');
      setMaxViews(5);
      setExpiryDays(riskLevel === 'HIGH' || riskLevel === 'CRITICAL' ? '1' : '7');
      setAccessMode(isDownloadDisabledByRisk ? 'VIEW_ONLY' : 'ALLOW_DOWNLOAD');
    } else if (preset === 'view_once') {
      setIsViewOnce(true);
      setStrictViewing(true);
      setTimeLimitOption('600');
      setMaxViews(1);
      setAccessMode('VIEW_ONLY');
    } else if (preset === 'strict_external') {
      setIsViewOnce(false);
      setStrictViewing(true);
      setTimeLimitOption('1800');
      setMaxViews(3);
      setExpiryDays('1');
      setRequiresOtp(true);
      setAccessMode('VIEW_ONLY');
    }
  };

  const getSummarySentence = (): string => {
    let recipientStr = '';
    if (tab === 'internal') {
      const rec = allowedRecipients.find((u) => u.id === Number(selectedRecipientId));
      recipientStr = rec ? `${rec.full_name} (${rec.department || 'General'})` : 'Selected teammate';
    } else {
      recipientStr = externalEmail.trim() ? externalEmail.trim() : 'External link recipient';
    }

    const viewCountStr = isViewOnce
      ? 'view once'
      : maxViews
      ? `view up to ${maxViews} times`
      : 'view';
    const modeStr =
      accessMode === 'VIEW_ONLY'
        ? 'in the secure viewer only'
        : 'with watermarked download allowed';

    let timedStr = '';
    if (timeLimitOption !== 'none') {
      let mins = 0;
      if (timeLimitOption === '600') mins = 10;
      else if (timeLimitOption === '1800') mins = 30;
      else if (timeLimitOption === '3600') mins = 60;
      else if (timeLimitOption === 'custom') mins = customTimeMinutes;
      timedStr = `, expiring ${mins} minutes after first opening`;
    }

    const expiryStr = expiryDays ? `, valid for ${expiryDays} day(s)` : '';
    const otpStr = tab === 'link' && requiresOtp ? ' (verified by 6-digit email code)' : '';

    return `${recipientStr} will be able to ${viewCountStr} ${modeStr}${timedStr}${expiryStr}${otpStr}.`;
  };

  const invalidateShareQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.myShares });
    queryClient.invalidateQueries({ queryKey: queryKeys.sharedWithMe });
    queryClient.invalidateQueries({ queryKey: queryKeys.documentsAll });
    if (selectedDocId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.documentDetail(selectedDocId) });
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    queryClient.invalidateQueries({ queryKey: queryKeys.auditAll });
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocId) return;

    setError(null);
    setLoading(true);

    try {
      let timeLimitSeconds: number | null = null;
      if (timeLimitOption === '600') timeLimitSeconds = 600;
      else if (timeLimitOption === '1800') timeLimitSeconds = 1800;
      else if (timeLimitOption === '3600') timeLimitSeconds = 3600;
      else if (timeLimitOption === 'custom') timeLimitSeconds = Math.max(1, customTimeMinutes * 60);

      let expiresAt: string | null = null;
      if (expiryDays) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(expiryDays, 10));
        expiresAt = d.toISOString();
      }

      const payload: any = {
        document_id: Number(selectedDocId),
        share_type: tab === 'internal' ? 'INTERNAL' : 'LINK',
        recipient_user_id:
          tab === 'internal' && selectedRecipientId ? Number(selectedRecipientId) : null,
        recipient_email: tab === 'link' ? externalEmail.trim() : null,
        access_mode: accessMode,
        is_view_once: isViewOnce,
        strict_viewing: isStrictForced || strictViewing,
        time_limit_seconds: timeLimitSeconds,
        max_views: maxViews || null,
        expires_at: expiresAt,
        requires_otp: tab === 'link' ? requiresOtp : false,
      };

      if (isCriticalBlocked && canApproveShares) {
        payload.confirm_critical = criticalConfirmText.trim();
        payload.confirm_reason = criticalSelfReason.trim();
      }

      const result = await api.createShare(payload);
      setCreatedShare(result);
      invalidateShareQueries();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to create share link.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!selectedDocId) return;
    if (!approvalReason.trim()) {
      setError('Please enter a reason for requesting approval to share this Critical document.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const req = await api.createApprovalRequest({
        document_id: Number(selectedDocId),
        share_type: tab === 'internal' ? 'INTERNAL' : 'LINK',
        recipient_user_id:
          tab === 'internal' && selectedRecipientId ? Number(selectedRecipientId) : null,
        recipient_email: tab === 'link' ? externalEmail.trim() : null,
        access_mode: 'VIEW_ONLY',
        is_view_once: isViewOnce,
        time_limit_seconds: 3600,
        requires_otp: tab === 'link',
        reason: approvalReason.trim(),
      });
      setCreatedApproval(req);
      invalidateShareQueries();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to submit approval request.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredRecipients = allowedRecipients.filter((u) => {
    if (!peopleSearch.trim()) return true;
    const q = peopleSearch.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
        data-testid="share-modal"
      >
        {/* Header (Title + Close + Step indicator) */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#FFFFFF',
            flexShrink: 0,
          }}
        >
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
              Share document
            </h3>
            {/* Step indicator: 1 Recipient — 2 Rules — 3 Review */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: step === 1 ? 'var(--accent)' : '#1F8A5B',
                  }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: step === 1 ? 700 : 500,
                    color: step === 1 ? 'var(--ink)' : 'var(--ink2)',
                  }}
                >
                  1 Recipient
                </span>
              </div>
              <span style={{ width: '16px', height: '1px', backgroundColor: 'var(--line)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: step === 2 ? 'var(--accent)' : step > 2 ? '#1F8A5B' : 'var(--ink3)',
                  }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: step === 2 ? 700 : 500,
                    color: step === 2 ? 'var(--ink)' : 'var(--ink2)',
                  }}
                >
                  2 Rules
                </span>
              </div>
              <span style={{ width: '16px', height: '1px', backgroundColor: 'var(--line)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: step === 3 ? 'var(--accent)' : 'var(--ink3)',
                  }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: step === 3 ? 700 : 500,
                    color: step === 3 ? 'var(--ink)' : 'var(--ink2)',
                  }}
                >
                  3 Review
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ width: '32px', height: '32px', padding: 0 }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrolling Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Top of body: compact document row (file icon, name, risk chip) + inline safe copy notice */}
          {currentDoc && !createdShare && !createdApproval && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid var(--line)',
                backgroundColor: 'var(--surface)',
                marginBottom: '18px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <FileText size={18} color="var(--ink2)" style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 700,
                      color: 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {currentDoc.title}
                  </span>
                </div>
                <RiskChip
                  riskScore={currentDoc.risk_score}
                  riskLevel={currentDoc.risk_level}
                  isSafeCopy={currentDoc.is_safe_copy}
                  size="sm"
                />
              </div>

              {/* Inline notice for High/Critical: one line + Use safe copy link */}
              {isOriginalHighOrCritical && (
                <div
                  style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--line)',
                    fontSize: '12px',
                    color: 'var(--ink2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <span>Contains sensitive data ({currentDoc.risk_level.toLowerCase()} risk).</span>
                  <button
                    type="button"
                    data-testid="share-safe-copy-instead-btn"
                    disabled={creatingSafeCopy}
                    onClick={handleSwitchToSafeCopy}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {creatingSafeCopy
                      ? 'Creating...'
                      : currentDoc.safe_copy_id
                      ? 'Use safe copy'
                      : 'Use safe copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              data-testid="share-modal-error"
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                backgroundColor: 'var(--risk-critical-bg)',
                border: '1px solid var(--danger-card-border)',
                color: 'var(--risk-critical-fg)',
                fontSize: '12.5px',
                fontWeight: 600,
                borderRadius: '10px',
              }}
            >
              {error}
            </div>
          )}

          {/* Success / Result View: Approval Submitted */}
          {createdApproval ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                textAlign: 'center',
                padding: '28px 0',
              }}
              data-testid="approval-submitted-view"
            >
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--risk-medium-bg)',
                  color: 'var(--risk-medium-fg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                }}
              >
                <ShieldCheck size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>
                  Approval request sent
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--ink2)', marginTop: '6px', lineHeight: 1.5 }}>
                  Your request to share <strong>{createdApproval.document_title}</strong> has been sent
                  to your Admin or Department Head for review.
                </p>
              </div>
            </div>
          ) : createdShare ? (
            /* Success / Result View: Share Link Created */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                textAlign: 'center',
                padding: '24px 0',
              }}
            >
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                }}
              >
                <Check size={24} />
              </div>

              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>
                  Share link ready
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--ink2)', marginTop: '4px' }}>
                  {createdShare.share_type === 'INTERNAL'
                    ? `Shared with ${createdShare.recipient_name || createdShare.recipient_email}.`
                    : 'External OTP-protected link is ready to share.'}
                </p>
              </div>

              <div
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'var(--panel)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: '12px',
                    color: 'var(--ink)',
                    wordBreak: 'break-all',
                    textAlign: 'left',
                  }}
                >
                  {createdShare.share_type === 'INTERNAL'
                    ? `${window.location.origin}/viewer/${createdShare.id}`
                    : `${window.location.origin}/s/${createdShare.token}`}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    const link =
                      createdShare.share_type === 'INTERNAL'
                        ? `${window.location.origin}/viewer/${createdShare.id}`
                        : `${window.location.origin}/s/${createdShare.token}`;
                    navigator.clipboard.writeText(link);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ flexShrink: 0 }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy link'}</span>
                </button>
              </div>
            </div>
          ) : step === 1 ? (
            /* STEP 1: CHOOSE RECIPIENT */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Document select if none selected initially */}
              {!initialDocId && (
                <div>
                  <label className="form-label">Document</label>
                  <select
                    className="form-select"
                    value={selectedDocId}
                    onChange={(e) => setSelectedDocId(Number(e.target.value))}
                  >
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.risk_level} · {d.risk_score}/100
                        {d.is_safe_copy ? ' · Safe copy' : ''})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Segmented control (height 40px, radius 10px): Active segment white with shadow on light grey track */}
              <div>
                <label className="form-label">Share with</label>
                <div
                  style={{
                    display: 'flex',
                    backgroundColor: 'var(--panel)',
                    padding: '3px',
                    borderRadius: '10px',
                    height: '40px',
                    boxSizing: 'border-box',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setTab('internal')}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: '8px',
                      backgroundColor: tab === 'internal' ? '#FFFFFF' : 'transparent',
                      color: tab === 'internal' ? 'var(--ink)' : 'var(--ink2)',
                      boxShadow: tab === 'internal' ? '0 2px 6px rgba(0, 0, 0, 0.08)' : 'none',
                      fontWeight: tab === 'internal' ? 600 : 500,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 120ms ease-out',
                    }}
                  >
                    <Users size={15} /> Team member
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('link')}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: '8px',
                      backgroundColor: tab === 'link' ? '#FFFFFF' : 'transparent',
                      color: tab === 'link' ? 'var(--ink)' : 'var(--ink2)',
                      boxShadow: tab === 'link' ? '0 2px 6px rgba(0, 0, 0, 0.08)' : 'none',
                      fontWeight: tab === 'link' ? 600 : 500,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 120ms ease-out',
                    }}
                  >
                    <LinkIcon size={15} /> External link
                  </button>
                </div>
              </div>

              {isExternalBlockedForHighOriginal && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--risk-high-bg)',
                    border: '1px solid rgba(194, 87, 26, 0.25)',
                    fontSize: '12px',
                    color: 'var(--risk-high-fg)',
                    fontWeight: 600,
                  }}
                >
                  Policy restriction: High-risk original documents cannot be shared via external links.
                  Use a safe copy instead.
                </div>
              )}

              {tab === 'internal' ? (
                <div>
                  <label className="form-label">Select teammate</label>
                  {/* Search input "Search people…" */}
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <Search
                      size={15}
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--ink3)',
                      }}
                    />
                    <input
                      type="text"
                      className="form-input"
                      style={{ paddingLeft: '34px', height: '40px', fontSize: '13px' }}
                      placeholder="Search people…"
                      value={peopleSearch}
                      onChange={(e) => setPeopleSearch(e.target.value)}
                    />
                  </div>

                  {/* People list: rows 56px tall, avatar 32px, name 14px + "Role · Department" 12.5px muted, check icon when selected, max height 320px with internal scroll */}
                  <div
                    style={{
                      maxHeight: '320px',
                      overflowY: 'auto',
                      border: '1px solid var(--line)',
                      borderRadius: '12px',
                      backgroundColor: '#FFFFFF',
                    }}
                  >
                    {filteredRecipients.length === 0 ? (
                      <div
                        style={{
                          padding: '24px 16px',
                          textAlign: 'center',
                          color: 'var(--ink2)',
                          fontSize: '13px',
                        }}
                      >
                        No matching teammates found.
                      </div>
                    ) : (
                      filteredRecipients.map((rec) => (
                        <div
                          key={rec.id}
                          onClick={() => setSelectedRecipientId(rec.id)}
                          title={rec.email}
                          style={{
                            height: '56px',
                            padding: '0 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor:
                              selectedRecipientId === rec.id ? 'var(--accent-soft)' : '#FFFFFF',
                            borderBottom: '1px solid var(--line)',
                            cursor: 'pointer',
                            boxSizing: 'border-box',
                            transition: 'background-color 100ms ease-out',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: '#2F5BEA',
                                color: '#FFFFFF',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {rec.full_name.slice(0, 2).toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: '14px',
                                  color: 'var(--ink)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {rec.full_name}
                              </div>
                              <div
                                style={{
                                  fontSize: '12.5px',
                                  color: 'var(--ink2)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {rec.role} · {rec.department || 'General'}
                              </div>
                            </div>
                          </div>
                          {selectedRecipientId === rec.id && (
                            <Check size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                /* External Link: email input + note "They'll get a one-time code by email." */
                <div>
                  <label className="form-label" htmlFor="ext-email">
                    Recipient email
                  </label>
                  <input
                    id="ext-email"
                    type="email"
                    className="form-input mono"
                    value={externalEmail}
                    onChange={(e) => setExternalEmail(e.target.value)}
                    placeholder="partner@external.test"
                    required
                  />
                  <div style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '6px' }}>
                    They&apos;ll get a one-time code by email before the document opens.
                  </div>
                </div>
              )}
            </div>
          ) : step === 2 ? (
            /* STEP 2: CONFIGURE RULES */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Rule presets as chips */}
              <div>
                <label className="form-label">Rule presets</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => applyPreset('quick_internal')}
                    className="btn btn-secondary btn-sm"
                    style={{ borderRadius: '999px', height: '32px', fontSize: '12px' }}
                  >
                    Quick internal
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('view_once')}
                    className="btn btn-secondary btn-sm"
                    style={{ borderRadius: '999px', height: '32px', fontSize: '12px' }}
                  >
                    View once
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('strict_external')}
                    className="btn btn-secondary btn-sm"
                    style={{ borderRadius: '999px', height: '32px', fontSize: '12px' }}
                  >
                    Strict external
                  </button>
                </div>
              </div>

              {/* Toggles & Options Box */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  backgroundColor: 'var(--panel)',
                  padding: '16px',
                  borderRadius: '14px',
                  border: '1px solid var(--line)',
                }}
              >
                {/* View Once Toggle */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: '13.5px',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>View once</span>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                      Access closes as soon as viewing ends
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isViewOnce}
                    onChange={(e) => {
                      setIsViewOnce(e.target.checked);
                      if (e.target.checked) setStrictViewing(true);
                    }}
                  />
                </label>

                {/* Time Limit (Select) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--ink)' }}>
                      Time limit
                    </span>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                      Session timer after document is opened
                    </div>
                  </div>
                  <select
                    className="form-select"
                    style={{ width: '136px', height: '36px', fontSize: '12.5px' }}
                    value={timeLimitOption}
                    onChange={(e) => setTimeLimitOption(e.target.value)}
                  >
                    {riskLevel !== 'HIGH' && riskLevel !== 'CRITICAL' && (
                      <option value="none">No timer</option>
                    )}
                    <option value="600">10 minutes</option>
                    <option value="1800">30 minutes</option>
                    <option value="3600">1 hour</option>
                  </select>
                </div>

                {/* Max Views (Stepper) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--ink)' }}>
                      Max views
                    </span>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                      Total allowed document opens
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ width: '32px', height: '32px', padding: 0 }}
                      onClick={() => setMaxViews((v) => Math.max(1, v - 1))}
                    >
                      -
                    </button>
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        minWidth: '24px',
                        textAlign: 'center',
                        color: 'var(--ink)',
                      }}
                    >
                      {maxViews}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ width: '32px', height: '32px', padding: 0 }}
                      onClick={() => setMaxViews((v) => v + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Expiry Date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--ink)' }}>
                      Expiry date
                    </span>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                      {riskLevel === 'HIGH' || riskLevel === 'CRITICAL'
                        ? 'Capped at 24 hours by risk policy.'
                        : 'Link validity period'}
                    </div>
                  </div>
                  <select
                    className="form-select"
                    style={{ width: '136px', height: '36px', fontSize: '12.5px' }}
                    value={expiryDays}
                    disabled={riskLevel === 'HIGH' || riskLevel === 'CRITICAL'}
                    onChange={(e) => setExpiryDays(e.target.value)}
                  >
                    <option value="1">1 day (24h)</option>
                    {riskLevel !== 'HIGH' && riskLevel !== 'CRITICAL' && (
                      <>
                        <option value="3">3 days</option>
                        <option value="7">7 days</option>
                        <option value="14">14 days</option>
                        <option value="30">30 days</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Allow Download */}
                {hasPermission('shares.allow_download') && (
                  <div>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: isDownloadDisabledByRisk ? 'not-allowed' : 'pointer',
                        fontSize: '13.5px',
                        opacity: isDownloadDisabledByRisk ? 0.55 : 1,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          Allow download
                        </span>
                        <div style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                          {isDownloadDisabledByRisk
                            ? `Blocked by ${riskLevel.toLowerCase()}-risk policy (view-only enforced).`
                            : 'Recipient can download a watermarked copy.'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={isDownloadDisabledByRisk}
                        checked={!isDownloadDisabledByRisk && accessMode === 'ALLOW_DOWNLOAD'}
                        onChange={(e) =>
                          setAccessMode(e.target.checked ? 'ALLOW_DOWNLOAD' : 'VIEW_ONLY')
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* STEP 3: REVIEW & CONFIRM */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                className="craft-card"
                style={{
                  backgroundColor: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {/* Document summary */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--ink2)', fontWeight: 600 }}>
                      Document
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--ink)', marginTop: '2px' }}>
                      {currentDoc?.title || 'Selected document'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <RiskChip
                      riskScore={currentDoc?.risk_score}
                      riskLevel={riskLevel}
                      isSafeCopy={currentDoc?.is_safe_copy}
                      isPasswordProtected={currentDoc?.is_password_protected}
                    />
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: currentDoc?.is_safe_copy ? '#E6F4EA' : '#FCE8E6',
                        color: currentDoc?.is_safe_copy ? '#137333' : '#C5221F',
                      }}
                    >
                      {currentDoc?.is_safe_copy ? 'Safe copy' : 'Original'}
                    </span>
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '2px 0' }} />

                {/* Recipient summary */}
                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--ink2)', fontWeight: 600 }}>
                    Recipient
                  </div>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)', marginTop: '2px' }}>
                    {tab === 'internal' ? (
                      (() => {
                        const r = allowedRecipients.find((u) => u.id === Number(selectedRecipientId));
                        return r ? `${r.full_name} (${r.email} · ${r.role} · ${r.department || 'General'})` : 'Team member';
                      })()
                    ) : (
                      externalEmail || 'External recipient'
                    )}
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '2px 0' }} />

                {/* Rules summary */}
                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--ink2)', fontWeight: 600 }}>
                    Rules & Safeguards
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px', fontSize: '12.5px' }}>
                    <div>
                      <span style={{ color: 'var(--ink2)' }}>Access: </span>
                      <span style={{ fontWeight: 600 }}>{accessMode === 'ALLOW_DOWNLOAD' ? 'Download permitted' : 'View only'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink2)' }}>View limit: </span>
                      <span style={{ fontWeight: 600 }}>{isViewOnce ? 'View once' : maxViews ? `${maxViews} views max` : 'Unlimited'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink2)' }}>Time limit: </span>
                      <span style={{ fontWeight: 600 }}>
                        {timeLimitOption === 'none'
                          ? 'None'
                          : `${timeLimitOption === '600' ? 10 : timeLimitOption === '1800' ? 30 : timeLimitOption === '3600' ? 60 : customTimeMinutes} mins`}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink2)' }}>Expires in: </span>
                      <span style={{ fontWeight: 600 }}>{expiryDays ? `${expiryDays} days` : 'No expiry'}</span>
                    </div>
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '2px 0' }} />

                {/* What happens next */}
                <div style={{ backgroundColor: '#F0F5FF', padding: '10px 12px', borderRadius: '8px', border: '1px solid #D0E1FD' }}>
                  <div style={{ fontSize: '11.5px', color: '#175CD3', fontWeight: 600 }}>
                    What happens next:
                  </div>
                  <div style={{ fontSize: '13px', color: '#1E40AF', marginTop: '2px', fontWeight: 500 }}>
                    {tab === 'internal'
                      ? `${(() => {
                          const r = allowedRecipients.find((u) => u.id === Number(selectedRecipientId));
                          return r ? r.full_name.split(' ')[0] : 'The recipient';
                        })()} will see it in Shared with me`
                      : `${externalEmail} will get a one-time code by email`}
                  </div>
                </div>
              </div>

              {/* Critical Authorization / Request Step */}
              {isCriticalBlocked && canApproveShares && (
                <div
                  data-testid="critical-self-auth-box"
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--risk-critical-bg)',
                    border: '1px solid var(--danger-card-border)',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--risk-critical-fg)', marginBottom: '4px' }}>
                    This file is Critical (score 100). Type SHARE to confirm sharing the original.
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--ink2)', marginBottom: '10px' }}>
                    As an authorized approver, you can directly self-authorize this share. A CRITICAL_SHARE_SELF_AUTHORISED audit record will be logged.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Reason for sharing original..."
                      value={criticalSelfReason}
                      onChange={(e) => setCriticalSelfReason(e.target.value)}
                      data-testid="critical-self-reason-input"
                      required
                    />
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="Type SHARE to confirm"
                      value={criticalConfirmText}
                      onChange={(e) => setCriticalConfirmText(e.target.value)}
                      data-testid="critical-confirm-input"
                      required
                    />
                  </div>
                </div>
              )}

              {isCriticalBlocked && !canApproveShares && (
                <div
                  data-testid="critical-approval-box"
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--risk-critical-bg)',
                    border: '1px solid var(--danger-card-border)',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--risk-critical-fg)', marginBottom: '4px' }}>
                    Critical document · Approval required to share original
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--ink2)', marginBottom: '8px' }}>
                    Explain why an unredacted original needs to be shared:
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Explain reason for unredacted original..."
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    data-testid="approval-reason-input"
                    required
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Footer: Action buttons */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--line)',
            backgroundColor: '#FFFFFF',
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {createdShare || createdApproval ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                  className="btn btn-secondary"
                >
                  <ArrowLeft size={15} /> Back
                </button>
              ) : (
                <div />
              )}

              {step === 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={
                    isExternalBlockedForHighOriginal ||
                    (tab === 'internal' && !selectedRecipientId) ||
                    (tab === 'link' && !externalEmail.trim())
                  }
                  className="btn btn-primary"
                  data-testid="share-next-step-btn"
                >
                  <span>Next</span>
                  <ArrowRight size={15} />
                </button>
              ) : step === 2 ? (
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="btn btn-primary"
                  data-testid="share-step-2-next-btn"
                >
                  <span>Next: Review</span>
                  <ArrowRight size={15} />
                </button>
              ) : isCriticalBlocked ? (
                canApproveShares ? (
                  <button
                    type="button"
                    onClick={handleCreateShare}
                    disabled={loading || criticalConfirmText.trim() !== 'SHARE' || !criticalSelfReason.trim()}
                    className="btn btn-primary"
                    data-testid="confirm-critical-share-btn"
                  >
                    <span>{loading ? 'Authorizing...' : 'Confirm and Share'}</span>
                    <Check size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestApproval}
                    disabled={loading || !approvalReason.trim()}
                    className="btn btn-primary"
                    data-testid="submit-approval-request-btn"
                  >
                    <span>{loading ? 'Submitting...' : 'Submit for approval'}</span>
                    <ShieldAlert size={15} />
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleCreateShare}
                  disabled={loading}
                  className="btn btn-primary"
                  id="create-share-submit-btn"
                  data-testid="create-share-submit-btn"
                >
                  <span>
                    {loading
                      ? 'Creating...'
                      : tab === 'internal'
                      ? 'Share with team member'
                      : 'Create external link'}
                  </span>
                  <Check size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
