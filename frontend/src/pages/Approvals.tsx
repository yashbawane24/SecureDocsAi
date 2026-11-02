import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  X,
  RefreshCw,
  ShieldAlert,
  Copy,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { RiskChip } from '../components/RiskChip';

export const Approvals: React.FC = () => {
  const { hasPermission, user } = useAuth();
  const qc = useQueryClient();

  const canReview =
    hasPermission('org.settings') ||
    hasPermission('members.approve') ||
    user?.role === 'Owner' ||
    user?.role === 'Admin' ||
    user?.role === 'Department Head';

  const [tab, setTab] = useState<'waiting' | 'my'>(canReview ? 'waiting' : 'my');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [comments, setComments] = useState<Record<number, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data: approvals = [], isLoading, error } = useQuery({
    queryKey: ['approvals', tab, statusFilter],
    queryFn: () => api.listApprovalRequests(statusFilter === 'ALL' ? undefined : statusFilter, tab),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: queryKeys.approvalsAll });
    qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    qc.invalidateQueries({ queryKey: queryKeys.myShares });
    qc.invalidateQueries({ queryKey: queryKeys.sharedWithMe });
    qc.invalidateQueries({ queryKey: queryKeys.notifications });
    qc.invalidateQueries({ queryKey: queryKeys.auditAll });
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, comment }: { id: number; comment?: string }) =>
      api.approveShareRequest(id, comment),
    onSuccess: () => {
      setToastMsg('Share request approved and share link created.');
      setTimeout(() => setToastMsg(null), 3500);
      invalidateAll();
    },
    onError: (err: any) => alert(err.message || 'Failed to approve request'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comment }: { id: number; comment?: string }) =>
      api.rejectShareRequest(id, comment),
    onSuccess: () => {
      setToastMsg('Share request rejected.');
      setTimeout(() => setToastMsg(null), 3500);
      invalidateAll();
    },
    onError: (err: any) => alert(err.message || 'Failed to reject request'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Share Approvals</h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Review and approve requests to share Critical or policy-restricted documents.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={statusFilter === st ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
          <button onClick={invalidateAll} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        {canReview && (
          <button
            type="button"
            className={tab === 'waiting' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            onClick={() => setTab('waiting')}
            data-testid="tab-waiting"
          >
            Waiting for me
          </button>
        )}
        <button
          type="button"
          className={tab === 'my' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => setTab('my')}
          data-testid="tab-my"
        >
          My requests
        </button>
      </div>

      {toastMsg && (
        <div
          role="status"
          data-testid="approvals-toast"
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--success-bg)',
            border: '1px solid rgba(46, 125, 79, 0.35)',
            color: 'var(--success)',
            borderRadius: '6px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Check size={15} /> {toastMsg}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          {(error as any)?.message || 'Failed to load approval requests.'}
        </div>
      )}

      <div className="craft-card" style={{ padding: '20px' }}>
        {isLoading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            Loading share approval requests...
          </div>
        ) : approvals.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
            <ShieldAlert size={32} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: '14px' }}>No share approval requests found.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {approvals.map((req) => (
              <div
                key={req.id}
                data-testid={`approval-row-${req.id}`}
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--background)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <Link
                        to={`/documents/${req.document_id}?tab=risk`}
                        style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)', textDecoration: 'none' }}
                      >
                        {req.document_title}
                      </Link>
                      <RiskChip
                        riskScore={req.risk_score ?? req.document_risk_score}
                        riskLevel={req.risk_level ?? req.document_risk_level}
                        size="sm"
                      />
                      <span className={`chip chip-${req.status.toLowerCase()}`} data-testid={`approval-status-${req.id}`}>
                        {req.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                      Requested by <strong>{req.requester_name}</strong> ({req.requester_email}) •{' '}
                      {(req.share_type || req.share_payload?.share_type) === 'INTERNAL'
                        ? `Internal share to ${req.recipient_email || req.share_payload?.recipient_email || 'peer'}`
                        : `External OTP link to ${req.recipient_email || req.share_payload?.recipient_email || 'recipient'}`}
                    </div>
                  </div>

                  <span className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {new Date(req.created_at).toLocaleString()}
                  </span>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    fontSize: '12px',
                    color: 'var(--text)',
                  }}
                >
                  <strong>Justification:</strong> {req.reason}
                </div>

                {req.status === 'PENDING' && canReview && tab === 'waiting' && req.requester_id !== user?.id && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
                    <input
                      type="text"
                      data-testid={`approval-comment-${req.id}`}
                      className="form-input"
                      style={{ flex: 1, minWidth: '220px', height: '32px', fontSize: '12px' }}
                      placeholder="Optional reviewer note..."
                      value={comments[req.id] || ''}
                      onChange={(e) => setComments((prev) => ({ ...prev, [req.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      data-testid={`approve-request-btn-${req.id}`}
                      disabled={approveMutation.isPending}
                      onClick={() => approveMutation.mutate({ id: req.id, comment: comments[req.id] })}
                      className="btn btn-primary btn-sm"
                    >
                      <Check size={13} /> Approve & create share
                    </button>
                    <button
                      type="button"
                      data-testid={`reject-request-btn-${req.id}`}
                      disabled={rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate({ id: req.id, comment: comments[req.id] })}
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)' }}
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                )}

                {req.status !== 'PENDING' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--muted)' }}>
                    <span>
                      Reviewed by <strong>{req.reviewer_name || 'Approver'}</strong>
                      {(req.review_comment || req.reviewer_comment) ? ` — "${req.review_comment || req.reviewer_comment}"` : ''}
                    </span>
                    {req.created_share_token && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const url =
                            req.share_type === 'INTERNAL' && req.created_share_id
                              ? `${window.location.origin}/viewer/${req.created_share_id}`
                              : `${window.location.origin}/s/${req.created_share_token}`;
                          navigator.clipboard.writeText(url);
                          setCopiedId(req.id);
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                      >
                        {copiedId === req.id ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedId === req.id ? 'Copied' : 'Copy share link'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
