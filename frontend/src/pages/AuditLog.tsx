import React, { useState } from 'react';
import { RefreshCw, Search, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';

export const AuditLog: React.FC = () => {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Filters (date range, user, action, result)
  const [actionFilter, setActionFilter] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<string>('');
  const [emailSearch, setEmailSearch] = useState<string>('');
  const [appliedEmail, setAppliedEmail] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const filterParams = {
    action: actionFilter || undefined,
    result: resultFilter || undefined,
    actor_email: appliedEmail.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    limit: 200,
  };

  const { data: logs = [], isLoading, error } = useQuery({
    queryKey: queryKeys.auditLogs(filterParams),
    queryFn: () => api.listAuditLogs(filterParams),
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedEmail(emailSearch);
  };

  const handleExportCsv = async () => {
    const url = api.getAuditExportUrl({
      action: actionFilter || undefined,
      result: resultFilter || undefined,
      actor_email: (appliedEmail || emailSearch).trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: queryKeys.auditAll });
    }, 800);
  };

  const getResultChip = (result: string) => {
    if (result === 'SUCCESS') {
      return <span className="chip chip-active">SUCCESS</span>;
    } else if (result === 'BLOCKED') {
      return <span className="chip chip-revoked">BLOCKED</span>;
    } else {
      return <span className="chip chip-expiring">{result}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Audit log</h1>
            <span className="chip chip-active" style={{ fontSize: '10px' }}>Immutable</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Record of document access events, scans, shares, and permission updates for {user?.organization?.name}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            data-testid="export-audit-csv-btn"
            onClick={handleExportCsv}
            className="btn btn-secondary"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: queryKeys.auditAll })}
            className="btn btn-secondary"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="craft-card" style={{ padding: '14px 16px' }}>
        <form
          onSubmit={handleSearchSubmit}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '210px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
              <input
                type="text"
                data-testid="audit-email-filter"
                className="form-input"
                style={{ paddingLeft: '32px' }}
                value={emailSearch}
                onChange={(e) => {
                  setEmailSearch(e.target.value);
                  setAppliedEmail(e.target.value);
                }}
                placeholder="Filter by actor email..."
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              Filter
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="date"
              data-testid="audit-date-from"
              className="form-input"
              style={{ width: '138px' }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="From date"
            />
            <input
              type="date"
              data-testid="audit-date-to"
              className="form-input"
              style={{ width: '138px' }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
            />

            <select
              data-testid="audit-action-filter"
              className="form-select"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ width: '170px' }}
            >
              <option value="">All Actions</option>
              <option value="OPEN">OPEN</option>
              <option value="DOWNLOAD">DOWNLOAD</option>
              <option value="REVOKE">REVOKE</option>
              <option value="LOGIN">LOGIN</option>
              <option value="AUDIT_EXPORT">AUDIT_EXPORT</option>
              <option value="SCAN_COMPLETED">SCAN_COMPLETED</option>
              <option value="SAFE_COPY_CREATED">SAFE_COPY_CREATED</option>
              <option value="SENSITIVE_VALUE_REVEALED">SENSITIVE_VALUE_REVEALED</option>
              <option value="SCREENSHOT_ATTEMPT_SUSPECTED">SCREENSHOT_ATTEMPT_SUSPECTED</option>
              <option value="SHARE_BLOCKED_BY_RISK_POLICY">SHARE_BLOCKED_BY_RISK_POLICY</option>
              <option value="FAILED_ATTEMPT">FAILED_ATTEMPT</option>
              <option value="MEMBER_APPROVE">MEMBER_APPROVE</option>
              <option value="ROLE_PERMS_UPDATE">ROLE_PERMS_UPDATE</option>
            </select>

            <select
              data-testid="audit-result-filter"
              className="form-select"
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              style={{ width: '130px' }}
            >
              <option value="">All Outcomes</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILURE">FAILURE</option>
              <option value="BLOCKED">BLOCKED</option>
            </select>
          </div>
        </form>
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
          {(error as any)?.message || 'Failed to load audit log.'}
        </div>
      )}

      {/* Audit Log Table */}
      <div className="craft-card" style={{ overflowX: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
            <span className="mono" style={{ fontSize: '13px' }}>Loading audit log...</span>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
            <p style={{ fontSize: '14px' }}>No audit entries matched the selected filters.</p>
          </div>
        ) : (
          <table className="craft-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>Timestamp (UTC)</th>
                <th style={{ width: '14%' }}>Action</th>
                <th style={{ width: '10%' }}>Outcome</th>
                <th style={{ width: '20%' }}>Actor</th>
                <th style={{ width: '13%' }}>IP Address</th>
                <th style={{ width: '27%' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td className="mono" style={{ fontSize: '11px', color: 'var(--text)' }}>
                    {new Date(row.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: '11px', fontWeight: 600 }}>
                      {row.action}
                    </span>
                  </td>
                  <td>{getResultChip(row.result)}</td>
                  <td>
                    <div style={{ fontSize: '13px', color: 'var(--text)' }}>
                      {row.actor_email || 'Anonymous / External'}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {row.ip_address}
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.4 }}>
                    {row.details || '—'}
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
