import React, { useState } from 'react';
import {
  RefreshCw,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShareItem, api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { ShareStatusChip } from '../components/ShareStatusChip';

export const SharedByMe: React.FC = () => {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data: shares = [], isLoading, error } = useQuery({
    queryKey: queryKeys.myShares,
    queryFn: () => api.listMyShares(),
  });

  // Optimistic update + rollback on error for Revoke (A5)
  const revokeMutation = useMutation({
    mutationFn: (id: number) => api.revokeShare(id),
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: queryKeys.myShares });
      const prev = qc.getQueryData<ShareItem[]>(queryKeys.myShares);
      if (prev) {
        qc.setQueryData<ShareItem[]>(
          queryKeys.myShares,
          prev.map((s) => (s.id === id ? { ...s, status: 'REVOKED' } : s))
        );
      }
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.myShares, ctx.prev);
      }
      alert(err?.message || 'Failed to revoke share');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.myShares });
      qc.invalidateQueries({ queryKey: queryKeys.sharedWithMe });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
      qc.invalidateQueries({ queryKey: queryKeys.auditAll });
    },
  });

  const handleRevoke = (id: number) => {
    revokeMutation.mutate(id);
  };

  const handleCopy = (share: ShareItem) => {
    const link =
      share.share_type === 'INTERNAL'
        ? `${window.location.origin}/viewer/${share.id}`
        : `${window.location.origin}/s/${share.token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportCsv = () => {
    const url = api.getSharesExportUrl();
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Shared links</h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Active and past document shares created from your account.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            data-testid="export-shares-csv-btn"
            onClick={handleExportCsv}
            className="btn btn-secondary"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: queryKeys.myShares })}
            className="btn btn-secondary"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            fontSize: '13px',
            borderRadius: '6px',
          }}
        >
          {(error as any)?.message || 'Failed to load shares.'}
        </div>
      )}

      <div className="craft-card" style={{ overflowX: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
            <span className="mono" style={{ fontSize: '13px' }}>Loading shares...</span>
          </div>
        ) : shares.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: '14px', color: 'var(--muted)' }}>
              You have not shared any documents yet.
            </p>
          </div>
        ) : (
          <table className="craft-table">
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Document</th>
                <th style={{ width: '22%' }}>Recipient / Link</th>
                <th style={{ width: '18%' }}>Rules & Limits</th>
                <th style={{ width: '12%' }}>Status</th>
                <th style={{ width: '16%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.id} data-testid={`share-row-${share.id}`}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{share.document_title}</div>
                    <div className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      Created {new Date(share.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '13px', color: 'var(--text)' }}>
                      {share.share_type === 'INTERNAL'
                        ? share.recipient_name || share.recipient_email || 'Internal User'
                        : share.recipient_email || 'External Link'}
                    </div>
                    <div className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      {share.share_type === 'INTERNAL' ? 'Internal share' : 'OTP Link'}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span>{share.access_mode === 'ALLOW_DOWNLOAD' ? 'Downloadable' : 'View only'}</span>
                      {share.is_view_once && <span style={{ color: 'var(--warning)' }}>View once</span>}
                      {share.strict_viewing && <span style={{ color: 'var(--danger)' }}>Strict viewing</span>}
                      {share.seconds_remaining !== null && share.seconds_remaining !== undefined && (
                        <span className="mono" style={{ color: 'var(--warning)' }}>
                          {Math.round(share.seconds_remaining / 60)} min left
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <ShareStatusChip
                      testId={`share-status-${share.id}`}
                      status={share.status}
                      isRevoked={share.is_revoked || share.status === 'REVOKED'}
                      isUsed={share.is_used || share.status === 'USED'}
                      viewsUsed={share.views_used}
                      firstOpenedAt={share.first_opened_at}
                      expiresAt={share.expires_at}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => handleCopy(share)}
                        className="btn btn-secondary btn-sm"
                        title="Copy viewer link"
                      >
                        {copiedId === share.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>

                      {share.status === 'ACTIVE' && hasPermission('shares.revoke_any_in_scope') && (
                        <button
                          data-testid={`revoke-share-${share.id}`}
                          onClick={() => handleRevoke(share.id)}
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          title="Revoke access"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
