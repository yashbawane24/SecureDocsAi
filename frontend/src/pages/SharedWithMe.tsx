import React from 'react';
import { Link } from 'react-router-dom';
import { Eye, RefreshCw, FileText } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { ShareStatusChip } from '../components/ShareStatusChip';

export const SharedWithMe: React.FC = () => {
  const qc = useQueryClient();

  const { data: shares = [], isLoading, error } = useQuery({
    queryKey: queryKeys.sharedWithMe,
    queryFn: () => api.listSharedWithMe(),
  });

  const getStatusChip = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="chip chip-active">Active</span>;
      case 'EXPIRED':
        return <span className="chip chip-expired">Expired</span>;
      case 'REVOKED':
        return <span className="chip chip-revoked">Revoked</span>;
      case 'USED':
        return <span className="chip chip-used">Used</span>;
      default:
        return <span className="chip">{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Shared with Me</h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Internal documents shared directly with your account.
          </p>
        </div>

        <button
          onClick={() => qc.invalidateQueries({ queryKey: queryKeys.sharedWithMe })}
          className="btn btn-secondary"
        >
          <RefreshCw size={14} /> Refresh
        </button>
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
          {(error as any)?.message || 'Failed to load shared documents.'}
        </div>
      )}

      <div className="craft-card" style={{ overflowX: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
            <span className="mono" style={{ fontSize: '13px' }}>Loading shared documents...</span>
          </div>
        ) : shares.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: '14px', color: 'var(--muted)' }}>
              No documents are currently shared with your account.
            </p>
          </div>
        ) : (
          <table className="craft-table">
            <thead>
              <tr>
                <th style={{ width: '38%' }}>Document Title</th>
                <th style={{ width: '22%' }}>Sender</th>
                <th style={{ width: '18%' }}>Rules & Limits</th>
                <th style={{ width: '10%' }}>Status</th>
                <th style={{ width: '12%', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <FileText size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{share.document_title}</div>
                        <div className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          Shared {new Date(share.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: '#2F5F8A',
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {share.created_by_name.slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontSize: '13px', color: 'var(--text)' }}>{share.created_by_name}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span>{share.access_mode === 'ALLOW_DOWNLOAD' ? 'Download permitted' : 'View only'}</span>
                      {share.is_view_once && <span style={{ color: 'var(--warning)', fontWeight: 500 }}>View Once</span>}
                      {share.time_limit_seconds && (
                        <span className="mono">{Math.round(share.time_limit_seconds / 60)} min limit</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <ShareStatusChip
                      status={share.status}
                      isRevoked={share.is_revoked || share.status === 'REVOKED'}
                      isUsed={share.is_used || share.status === 'USED'}
                      viewsUsed={share.views_used}
                      firstOpenedAt={share.first_opened_at}
                      expiresAt={share.expires_at}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {share.status === 'ACTIVE' ? (
                      <Link
                        to={`/viewer/${share.id}`}
                        className="btn btn-primary btn-sm"
                        id={`open-share-${share.id}`}
                      >
                        <Eye size={13} /> Open
                      </Link>
                    ) : (
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--muted)' }}>Closed</span>
                    )}
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
