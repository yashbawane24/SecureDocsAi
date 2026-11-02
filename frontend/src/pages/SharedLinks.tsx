import React, { useState, useEffect } from 'react';
import { Copy, Check, Ban, RefreshCw, ExternalLink } from 'lucide-react';
import { ShareItem, api } from '../api/client';
import { ShareStatusChip } from '../components/ShareStatusChip';

export const SharedLinks: React.FC = () => {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchShares = async () => {
    setLoading(true);
    try {
      const data = await api.listMyShares();
      setShares(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve shares.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShares();
  }, []);

  const handleRevoke = async (id: number) => {
    try {
      await api.revokeShare(id);
      setRevokingId(null);
      fetchShares();
    } catch (err: any) {
      alert(err.message || 'Revocation failed.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="badge badge-active">ACTIVE</span>;
      case 'EXPIRED':
        return <span className="badge badge-expired">EXPIRED</span>;
      case 'REVOKED':
        return <span className="badge badge-revoked">REVOKED</span>;
      case 'USED':
        return <span className="badge badge-used">USED</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const formatRemainingTime = (seconds?: number | null) => {
    if (seconds === null || seconds === undefined) return '—';
    if (seconds <= 0) return '00:00 (Expired)';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} remaining`;
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 className="font-display" style={{ fontSize: '26px', color: 'var(--ink)' }}>
            Shared Documents Management
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--ink-2)', marginTop: '4px' }}>
            Active and historical share controls, access tracking, and immediate revocation.
          </p>
        </div>

        <button onClick={fetchShares} className="btn btn-secondary" title="Refresh">
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            backgroundColor: 'rgba(138, 43, 30, 0.08)',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            fontSize: '13px',
            borderRadius: '2px',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-2)', fontSize: '13px' }}>
            Loading active shares...
          </div>
        ) : shares.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: '14px', color: 'var(--ink-2)' }}>
              No document shares have been issued yet.
            </p>
          </div>
        ) : (
          <table className="dense-table">
            <thead>
              <tr>
                <th style={{ width: '25%' }}>Document & Recipient</th>
                <th style={{ width: '12%' }}>Type</th>
                <th style={{ width: '12%' }}>Views / Max</th>
                <th style={{ width: '18%' }}>Time Remaining</th>
                <th style={{ width: '13%' }}>First Opened</th>
                <th style={{ width: '10%' }}>Status</th>
                <th style={{ width: '10%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr key={share.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{share.document_title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--ink-2)' }}>
                      To: {share.recipient_name || share.recipient_email || 'Public Link'}
                    </div>
                  </td>
                  <td>
                    <span className="section-label" style={{ fontSize: '11px' }}>
                      {share.share_type}
                    </span>
                    {share.access_mode === 'ALLOW_DOWNLOAD' && (
                      <div style={{ fontSize: '11px', color: 'var(--ok)', marginTop: '2px' }}>
                        + Download
                      </div>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {share.views_used} / {share.max_views !== null ? share.max_views : '∞'}
                    {share.is_view_once && (
                      <div style={{ fontSize: '10px', color: 'var(--warn)', textTransform: 'uppercase' }}>
                        View-Once
                      </div>
                    )}
                  </td>
                  <td className="tabular-nums" style={{ fontSize: '13px', color: 'var(--ink-2)' }}>
                    {formatRemainingTime(share.seconds_remaining)}
                  </td>
                  <td className="tabular-nums" style={{ fontSize: '12px', color: 'var(--ink-2)' }}>
                    {share.first_opened_at
                      ? new Date(share.first_opened_at).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Not yet opened'}
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
                    {share.is_revoked || share.status === 'EXPIRED' || share.status === 'USED' ? (
                      <span style={{ fontSize: '12px', color: 'var(--ink-2)' }}>—</span>
                    ) : revokingId === share.id ? (
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleRevoke(share.id)}
                          className="btn btn-danger"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setRevokingId(null)}
                          className="btn btn-secondary"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRevokingId(share.id)}
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '12px', color: 'var(--accent)' }}
                        title="Revoke access immediately"
                      >
                        <Ban size={13} />
                        <span>Revoke</span>
                      </button>
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
