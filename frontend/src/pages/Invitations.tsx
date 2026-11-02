import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Check,
  X,
  Trash2,
  RefreshCw,
  Copy,
  QrCode,
  Link2,
  Clock,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { QrCodeSvg } from '../components/QrCodeSvg';

export const Invitations: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const qc = useQueryClient();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState<number | ''>('');
  const [inviteDeptId, setInviteDeptId] = useState<number | ''>('');
  const [inviteManagerId, setInviteManagerId] = useState<number | ''>('');
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { data: org } = useQuery({
    queryKey: queryKeys.orgSettings,
    queryFn: () => api.getOrgSettings(),
    enabled: Boolean(user),
  });

  const { data: invites = [] } = useQuery({
    queryKey: queryKeys.invites,
    queryFn: () => api.listInvites(),
    enabled: Boolean(user),
  });

  const { data: members = [] } = useQuery({
    queryKey: queryKeys.members(),
    queryFn: () => api.listMembers(),
    enabled: Boolean(user),
  });

  const { data: roles = [] } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.listRoles(),
    enabled: Boolean(user),
  });

  const { data: departments = [] } = useQuery({
    queryKey: queryKeys.departments,
    queryFn: () => api.listDepartments(),
    enabled: Boolean(user),
  });

  const pendingUsers = members.filter((m) => m.status === 'PENDING');
  const inviteCode = org?.invite_code || 'NWH-2026';
  const fullJoinUrl = `${window.location.origin}/join?code=${inviteCode}`;

  useEffect(() => {
    if (roles.length > 0 && !inviteRoleId) {
      const empRole = roles.find((r) => r.name === 'Employee') || roles[0];
      setInviteRoleId(empRole.id);
    }
  }, [roles, inviteRoleId]);

  const showToast = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 3500);
  };

  const invalidateMembershipQueries = () => {
    qc.invalidateQueries({ queryKey: queryKeys.invites });
    qc.invalidateQueries({ queryKey: queryKeys.membersAll });
    qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    qc.invalidateQueries({ queryKey: queryKeys.orgTree });
    qc.invalidateQueries({ queryKey: queryKeys.notifications });
    qc.invalidateQueries({ queryKey: queryKeys.orgSettings });
  };

  const createInviteMutation = useMutation({
    mutationFn: (payload: {
      email: string;
      role_id: number;
      department_id?: number;
      manager_id?: number;
    }) => api.createInvite(payload),
    onSuccess: (res) => {
      setCreatedInviteToken(res.invite_token || null);
      showToast(`Invitation dispatched to ${inviteEmail}.`);
      invalidateMembershipQueries();
    },
    onError: (e: any) => alert(e.message || 'Failed to create invite'),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (id: number) => api.deleteInvite(id),
    onSuccess: () => {
      showToast('Invitation cancelled.');
      invalidateMembershipQueries();
    },
    onError: (e: any) => alert(e.message || 'Failed to cancel invite'),
  });

  const approveMutation = useMutation({
    mutationFn: (userId: number) => api.approveMember(userId),
    onSuccess: () => {
      showToast('Member approved and account activated.');
      invalidateMembershipQueries();
    },
    onError: (e: any) => alert(e.message || 'Failed to approve member'),
  });

  const rejectMutation = useMutation({
    mutationFn: (userId: number) => api.rejectMember(userId),
    onSuccess: () => {
      showToast('Join request rejected.');
      invalidateMembershipQueries();
    },
    onError: (e: any) => alert(e.message || 'Failed to reject member'),
  });

  const regenerateCodeMutation = useMutation({
    mutationFn: () => api.regenerateInviteCode(),
    onSuccess: () => {
      showToast('Invite code regenerated successfully.');
      invalidateMembershipQueries();
    },
    onError: (e: any) => alert(e.message || 'Failed to regenerate invite code'),
  });

  const handleCreateInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteRoleId) return;
    createInviteMutation.mutate({
      email: inviteEmail.trim(),
      role_id: Number(inviteRoleId),
      department_id: inviteDeptId ? Number(inviteDeptId) : undefined,
      manager_id: inviteManagerId ? Number(inviteManagerId) : undefined,
    });
  };

  const handleCancelInvite = (id: number) => {
    if (!confirm('Cancel this invitation? The recipient will not be able to use the link.')) return;
    cancelInviteMutation.mutate(id);
  };

  const handleApprove = (userId: number) => {
    approveMutation.mutate(userId);
  };

  const handleReject = (userId: number) => {
    if (!confirm('Reject and remove this join request?')) return;
    rejectMutation.mutate(userId);
  };

  const handleRegenerateCode = () => {
    if (!confirm('Regenerate invite code? The old code will stop working.')) return;
    regenerateCodeMutation.mutate();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title">Invitations & requests</h1>
          <p className="page-subtitle">
            Manage join requests, share join links, and issue direct email invitations for {org?.name || user?.organization_name || 'your organisation'}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={invalidateMembershipQueries} className="btn btn-secondary">
            <RefreshCw size={15} /> Refresh
          </button>
          {hasPermission('members.invite') && (
            <button
              type="button"
              onClick={() => {
                setCreatedInviteToken(null);
                setShowInviteModal(true);
              }}
              className="btn btn-primary"
              id="invite-member-btn"
            >
              <UserPlus size={15} /> Invite by email
            </button>
          )}
        </div>
      </div>

      {actionSuccess && (
        <div
          role="status"
          style={{
            padding: '12px 18px',
            backgroundColor: '#E3F3EA',
            color: '#1F8A5B',
            border: '1px solid #C4E9D4',
            borderRadius: '12px',
            fontSize: '13.5px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <Check size={18} /> {actionSuccess}
        </div>
      )}

      {/* Share Join Link & Code Card */}
      <div className="craft-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <div>
            <h3 className="craft-card-title">Share Join Link & Code</h3>
            <p className="craft-card-subtitle">
              Anyone with this link or code can request to join. All prospective members require approval before accessing documents.
            </p>
          </div>
          {hasPermission('org.settings') && (
            <button
              type="button"
              onClick={handleRegenerateCode}
              disabled={regenerateCodeMutation.isPending}
              className="btn btn-secondary btn-sm"
              title="Generate a new invite code"
            >
              <RefreshCw size={14} /> Regenerate code
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) auto', gap: '24px', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label className="form-label">Organisation Invite Code</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  data-testid="invite-code-display"
                  className="mono"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '8px 16px',
                    backgroundColor: 'var(--panel)',
                    border: '1.5px dashed var(--line)',
                    borderRadius: '10px',
                    fontSize: '17px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: 'var(--ink)',
                  }}
                >
                  {inviteCode}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(inviteCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  {copiedCode ? <Check size={14} color="#1F8A5B" /> : <Copy size={14} />}
                  <span>{copiedCode ? 'Copied' : 'Copy code'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">Full Join Link</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="text"
                  readOnly
                  data-testid="join-link-input"
                  className="form-input mono"
                  value={fullJoinUrl}
                  style={{ flex: 1, backgroundColor: 'var(--panel)', fontSize: '13px' }}
                />
                <button
                  type="button"
                  data-testid="copy-join-link-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(fullJoinUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="btn btn-primary btn-sm"
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* QR Code preview */}
          <div
            style={{
              padding: '12px',
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--line)',
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <QrCodeSvg value={fullJoinUrl} size={112} />
            <span style={{ fontSize: '11px', color: 'var(--ink3)', fontWeight: 600 }}>Scan to join</span>
          </div>
        </div>
      </div>

      {/* Section 1: Pending Join Requests Queue */}
      <div className="craft-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 className="craft-card-title">
              Pending Join Requests ({pendingUsers.length})
            </h3>
            <p className="craft-card-subtitle">
              Prospective members who registered via invite code or allowed domain awaiting approval
            </p>
          </div>
        </div>

        {pendingUsers.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13.5px' }}>
            No pending join requests awaiting approval.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {pendingUsers.map((pUser) => (
              <div
                key={pUser.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  backgroundColor: 'var(--panel)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      backgroundColor: pUser.avatar_color || '#2F5BEA',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '13px',
                      flexShrink: 0,
                    }}
                  >
                    {pUser.full_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink)' }}>
                      {pUser.full_name}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--ink2)', marginTop: '2px' }}>
                      <span className="mono">{pUser.email}</span> · {pUser.role || 'Employee'} {pUser.department ? `· ${pUser.department}` : ''}
                    </div>
                  </div>
                </div>

                {hasPermission('members.approve') && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => handleApprove(pUser.id)}
                      disabled={approveMutation.isPending}
                      className="btn btn-primary btn-sm"
                      id={`approve-user-${pUser.id}`}
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(pUser.id)}
                      disabled={rejectMutation.isPending}
                      className="btn btn-danger btn-sm"
                      id={`reject-user-${pUser.id}`}
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Active Direct Invitations */}
      <div className="craft-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 className="craft-card-title">Active Invitations ({invites.length})</h3>
            <p className="craft-card-subtitle">
              Direct invite links dispatched to prospective team members
            </p>
          </div>
        </div>

        {invites.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13.5px' }}>
            No active email invitations pending. Click "Invite by email" to invite someone.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="craft-table">
              <thead>
                <tr>
                  <th>Email Address</th>
                  <th>Assigned Role</th>
                  <th>Department</th>
                  <th>Expires</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>{inv.email}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '13.5px' }}>{inv.role_name}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '13.5px', color: 'var(--ink2)' }}>{inv.department_name || '—'}</span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        {inv.invite_token && (
                          <button
                            type="button"
                            onClick={() => {
                              const link = `${window.location.origin}/join?token=${inv.invite_token}`;
                              navigator.clipboard.writeText(link);
                              showToast('Invite link copied to clipboard.');
                            }}
                            className="btn btn-secondary btn-sm"
                            title="Copy link"
                          >
                            <Copy size={13} /> Copy link
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCancelInvite(inv.id)}
                          className="btn btn-ghost btn-sm"
                          style={{ color: '#B42318' }}
                          title="Cancel invite"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send Invitation Modal */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '480px', maxWidth: '92vw', padding: '28px', backgroundColor: 'var(--surface)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 className="craft-card-title">Send Member Invitation</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="btn btn-ghost btn-sm"
                style={{ width: '32px', height: '32px', padding: 0 }}
              >
                <X size={16} />
              </button>
            </div>

            {createdInviteToken ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    backgroundColor: '#E3F3EA',
                    color: '#1F8A5B',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 14px',
                  }}
                >
                  <Check size={24} />
                </div>
                <h4 style={{ fontSize: '16px', fontWeight: 700 }}>Invitation Created</h4>
                <p style={{ fontSize: '13px', color: 'var(--ink2)', marginTop: '4px', marginBottom: '20px' }}>
                  The recipient can join using the link below (valid for 7 days):
                </p>

                <div
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'var(--panel)',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginBottom: '20px',
                  }}
                >
                  <span className="mono" style={{ fontSize: '12px', color: 'var(--ink)', wordBreak: 'break-all', textAlign: 'left' }}>
                    {`${window.location.origin}/join?token=${createdInviteToken}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/join?token=${createdInviteToken}`);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    {copiedLink ? <Check size={14} color="#1F8A5B" /> : <Copy size={14} />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setCreatedInviteToken(null);
                    setInviteEmail('');
                  }}
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label className="form-label" htmlFor="inv-email">Work Email Address</label>
                  <input
                    id="inv-email"
                    type="email"
                    className="form-input"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@domain.com"
                    required
                  />
                </div>

                <div>
                  <label className="form-label" htmlFor="inv-role">Assign Role</label>
                  <select
                    id="inv-role"
                    className="form-select"
                    value={inviteRoleId}
                    onChange={(e) => setInviteRoleId(Number(e.target.value))}
                  >
                    {roles.filter((r) => r.name !== 'Owner').map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" htmlFor="inv-dept">Department (Optional)</label>
                  <select
                    id="inv-dept"
                    className="form-select"
                    value={inviteDeptId}
                    onChange={(e) => setInviteDeptId(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">No Department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" htmlFor="inv-mgr">Manager / Reporting Line (Optional)</label>
                  <select
                    id="inv-mgr"
                    className="form-select"
                    value={inviteManagerId}
                    onChange={(e) => setInviteManagerId(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">None (Top-Level)</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button type="button" onClick={() => setShowInviteModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createInviteMutation.isPending}
                    className="btn btn-primary"
                    id="send-invite-submit-btn"
                  >
                    {createInviteMutation.isPending ? 'Sending...' : 'Send Invitation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
