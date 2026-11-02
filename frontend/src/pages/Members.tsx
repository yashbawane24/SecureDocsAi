import React, { useState } from 'react';
import {
  Search,
  UserCheck,
  UserX,
  Edit2,
  Network,
  List,
  RefreshCw,
  UserPlus,
  Copy,
  Check,
  X,
  RotateCcw,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { QrCodeSvg } from '../components/QrCodeSvg';

export const Members: React.FC = () => {
  const { user: currentUser, hasPermission } = useAuth();
  const qc = useQueryClient();

  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');

  // Filters
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Edit member modal
  const [editingMember, setEditingMember] = useState<User | null>(null);
  const [editRoleId, setEditRoleId] = useState<number | ''>('');
  const [editDeptId, setEditDeptId] = useState<number | ''>('');
  const [editReportsToId, setEditReportsToId] = useState<number | ''>('');
  const [editStatus, setEditStatus] = useState<string>('ACTIVE');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Invite people modal (A2: 2 tabs - "Invite by email" and "Share join link")
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState<number | ''>('');
  const [inviteDeptId, setInviteDeptId] = useState<number | ''>('');
  const [inviteManagerId, setInviteManagerId] = useState<number | ''>('');
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copiedJoinLink, setCopiedJoinLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedDirectLink, setCopiedDirectLink] = useState(false);

  const filterParams = {
    search: appliedSearch.trim() || undefined,
    role: roleFilter || undefined,
    department: deptFilter || undefined,
    status: statusFilter || undefined,
  };

  const { data: members = [], isLoading: loadingMembers } = useQuery({
    queryKey: queryKeys.members(filterParams),
    queryFn: () => api.listMembers(filterParams),
  });

  const { data: roles = [] } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.listRoles(),
  });

  const { data: departments = [] } = useQuery({
    queryKey: queryKeys.departments,
    queryFn: () => api.listDepartments(),
  });

  const { data: orgTreeRaw } = useQuery({
    queryKey: queryKeys.orgTree,
    queryFn: () => api.getOrgTree(),
  });

  const { data: orgSettings } = useQuery({
    queryKey: queryKeys.orgSettings,
    queryFn: () => api.getOrgSettings(),
    enabled: hasPermission('org.settings') || hasPermission('members.invite') || hasPermission('members.manage'),
  });

  const orgTree: any[] = Array.isArray(orgTreeRaw)
    ? orgTreeRaw
    : (orgTreeRaw as any)?.roots || [];

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const updateMemberMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) =>
      api.updateMember(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.membersAll });
      qc.invalidateQueries({ queryKey: queryKeys.orgTree });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      setEditingMember(null);
      showToast('Member updated.');
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to update member.');
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: (payload: {
      email: string;
      role_id: number;
      department_id?: number;
      manager_id?: number;
    }) => api.createInvite(payload),
    onSuccess: (res) => {
      setCreatedInviteToken(res.invite_token || null);
      qc.invalidateQueries({ queryKey: queryKeys.invites });
      qc.invalidateQueries({ queryKey: queryKeys.membersAll });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      showToast(`Invitation sent to ${inviteEmail}.`);
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to send invitation.');
    },
  });

  const regenerateCodeMutation = useMutation({
    mutationFn: () => api.regenerateInviteCode(),
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.orgSettings, updated);
      qc.invalidateQueries({ queryKey: queryKeys.orgSettings });
      qc.invalidateQueries({ queryKey: queryKeys.me });
      showToast(`New invite code generated: ${updated.invite_code}`);
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to regenerate invite code.');
    },
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(search);
  };

  const openEditModal = (member: User) => {
    setEditingMember(member);
    setEditRoleId(member.role_id || '');
    setEditDeptId(member.department_id || '');
    setEditReportsToId(member.reports_to_id || '');
    setEditStatus(member.status);
  };

  const handleSaveMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    updateMemberMutation.mutate({
      id: editingMember.id,
      payload: {
        role_id: editRoleId ? Number(editRoleId) : undefined,
        department_id: editDeptId ? Number(editDeptId) : undefined,
        reports_to_id: editReportsToId ? Number(editReportsToId) : null,
        status: editStatus,
      },
    });
  };

  const handleToggleDeactivate = (member: User) => {
    const isDeactivating = member.status !== 'DEACTIVATED';
    const confirmPrompt = isDeactivating
      ? `Deactivate member ${member.full_name}? They will lose access immediately.`
      : `Reactivate member ${member.full_name}?`;

    if (!confirm(confirmPrompt)) return;
    updateMemberMutation.mutate({
      id: member.id,
      payload: { status: isDeactivating ? 'DEACTIVATED' : 'ACTIVE' },
    });
  };

  const openInviteModal = (defaultTab: 'email' | 'link' = 'email') => {
    setInviteTab(defaultTab);
    setCreatedInviteToken(null);
    setInviteEmail('');
    if (!inviteRoleId && roles.length > 0) {
      const empRole = roles.find((r) => r.name === 'Employee') || roles[0];
      setInviteRoleId(empRole.id);
    }
    setShowInviteModal(true);
  };

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

  const handleRegenerateInviteCode = () => {
    if (!window.confirm('The old code will stop working. Generate a new invite code?')) {
      return;
    }
    regenerateCodeMutation.mutate();
  };

  const activeInviteCode =
    orgSettings?.invite_code || currentUser?.organization?.invite_code || 'NWH-2026';
  const joinLink = `${window.location.origin}/join?code=${encodeURIComponent(activeInviteCode)}`;

  // Org Chart Node Renderer
  const renderTreeNode = (node: any) => {
    const displayName = node.name || node.full_name || 'Member';
    const childNodes = node.reports || node.children || [];
    return (
      <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          className="craft-card"
          style={{
            padding: '12px 16px',
            minWidth: '180px',
            textAlign: 'center',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#2457D6',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 600,
              margin: '0 auto 6px',
            }}
          >
            {displayName.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{displayName}</div>
          <div style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 500 }}>{node.role}</div>
          <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{node.department || 'General'}</div>
        </div>

        {childNodes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '12px' }}>
            <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border)' }} />
            <div style={{ display: 'flex', gap: '24px', position: 'relative' }}>
              {childNodes.map((child: any) => renderTreeNode(child))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Organisation Members</h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Manage staff roles, reporting lines, and access status for {currentUser?.organization?.name}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* List vs Chart View Toggle */}
          <div style={{ display: 'flex', backgroundColor: 'var(--background)', borderRadius: '6px', border: '1px solid var(--border)', padding: '2px' }}>
            <button
              onClick={() => setViewMode('list')}
              className="btn btn-ghost"
              style={{
                padding: '4px 8px',
                height: '28px',
                backgroundColor: viewMode === 'list' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'list' ? 'var(--text)' : 'var(--muted)',
              }}
              title="Table view"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setViewMode('chart')}
              className="btn btn-ghost"
              style={{
                padding: '4px 8px',
                height: '28px',
                backgroundColor: viewMode === 'chart' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'chart' ? 'var(--text)' : 'var(--muted)',
              }}
              title="Org Chart view"
            >
              <Network size={14} />
            </button>
          </div>

          {(hasPermission('members.invite') || hasPermission('members.manage')) && (
            <button
              type="button"
              onClick={() => openInviteModal('email')}
              className="btn btn-primary"
              id="invite-people-btn"
              data-testid="invite-people-btn"
            >
              <UserPlus size={14} /> Invite people
            </button>
          )}
        </div>
      </div>

      {toastMsg && (
        <div
          role="status"
          data-testid="members-toast"
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--success-bg)',
            border: '1px solid rgba(46, 125, 79, 0.35)',
            color: 'var(--success)',
            fontSize: '13px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Check size={15} /> {toastMsg}
        </div>
      )}

      {/* Filter Bar for List View */}
      {viewMode === 'list' && (
        <div
          className="craft-card"
          style={{
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '220px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '32px' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              Search
            </button>
          </form>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {/* Role Filter */}
            <select
              className="form-select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{ width: '130px' }}
            >
              <option value="">All Roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>

            {/* Department Filter */}
            <select
              className="form-select"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              style={{ width: '140px' }}
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: '120px' }}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </div>
        </div>
      )}

      {/* Main Content Area: Table vs Org Chart Tree */}
      {loadingMembers ? (
        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
          <span className="mono" style={{ fontSize: '13px' }}>Loading organisation members...</span>
        </div>
      ) : viewMode === 'chart' ? (
        <div className="craft-card" style={{ padding: '36px', overflowX: 'auto', display: 'flex', justifyContent: 'center' }}>
          {orgTree.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>No reporting hierarchy defined.</div>
          ) : (
            <div style={{ display: 'flex', gap: '48px' }}>
              {orgTree.map((rootNode) => renderTreeNode(rootNode))}
            </div>
          )}
        </div>
      ) : (
        <div className="craft-card" style={{ overflowX: 'auto' }}>
          <table className="craft-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Member</th>
                <th style={{ width: '16%' }}>Role</th>
                <th style={{ width: '18%' }}>Department</th>
                <th style={{ width: '16%' }}>Reports To</th>
                <th style={{ width: '10%' }}>Status</th>
                <th style={{ width: '10%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: (member.avatar_color && member.avatar_color.toUpperCase() !== '#1E6B52') ? member.avatar_color : '#2457D6',
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {member.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{member.full_name}</div>
                        <div className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontWeight: 500, fontSize: '13px', color: member.role === 'Owner' ? 'var(--accent)' : 'inherit' }}>
                      {member.role}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                      {member.department || '—'}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                      {member.manager_name || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={`chip chip-${member.status.toLowerCase()}`}>
                      {member.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {hasPermission('members.manage') && (
                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                        <button
                          onClick={() => openEditModal(member)}
                          className="btn btn-ghost btn-sm"
                          title="Edit role & reporting line"
                          data-testid={`edit-member-${member.id}`}
                        >
                          <Edit2 size={13} />
                        </button>
                        {member.role !== 'Owner' && (
                          <button
                            onClick={() => handleToggleDeactivate(member)}
                            className="btn btn-ghost btn-sm"
                            style={{ color: member.status === 'DEACTIVATED' ? 'var(--success)' : 'var(--danger)' }}
                            title={member.status === 'DEACTIVATED' ? 'Reactivate' : 'Deactivate'}
                          >
                            {member.status === 'DEACTIVATED' ? <UserCheck size={13} /> : <UserX size={13} />}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A2: Invite People Modal with 2 Tabs ("Invite by email" and "Share join link") */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '500px', maxWidth: '94vw', padding: '24px', backgroundColor: 'var(--surface)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Invite people to {currentUser?.organization?.name}</h3>
              <button onClick={() => setShowInviteModal(false)} className="btn btn-ghost" style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            {/* Two Tabs */}
            <div
              style={{
                display: 'flex',
                backgroundColor: 'var(--background)',
                borderRadius: '6px',
                padding: '3px',
                border: '1px solid var(--border)',
                marginBottom: '18px',
              }}
            >
              <button
                type="button"
                data-testid="invite-tab-email"
                onClick={() => setInviteTab('email')}
                style={{
                  flex: 1,
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: inviteTab === 'email' ? 600 : 400,
                  backgroundColor: inviteTab === 'email' ? 'var(--surface)' : 'transparent',
                  color: inviteTab === 'email' ? 'var(--text)' : 'var(--muted)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Invite by email
              </button>
              <button
                type="button"
                data-testid="invite-tab-link"
                onClick={() => setInviteTab('link')}
                style={{
                  flex: 1,
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: inviteTab === 'link' ? 600 : 400,
                  backgroundColor: inviteTab === 'link' ? 'var(--surface)' : 'transparent',
                  color: inviteTab === 'link' ? 'var(--text)' : 'var(--muted)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Share join link
              </button>
            </div>

            {inviteTab === 'email' ? (
              createdInviteToken ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--success-bg)',
                      color: 'var(--success)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 12px',
                    }}
                  >
                    <Check size={20} />
                  </div>
                  <h4 style={{ fontSize: '15px', fontWeight: 600 }}>Invitation Email Sent</h4>
                  <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', marginBottom: '14px' }}>
                    An invitation email has been sent to <strong>{inviteEmail}</strong>. You can also share their direct link:
                  </p>

                  <div
                    style={{
                      padding: '10px',
                      backgroundColor: 'var(--background)',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '16px',
                    }}
                  >
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--text)', wordBreak: 'break-all', textAlign: 'left' }}>
                      {`${window.location.origin}/join?token=${createdInviteToken}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/join?token=${createdInviteToken}`);
                        setCopiedDirectLink(true);
                        setTimeout(() => setCopiedDirectLink(false), 2000);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      {copiedDirectLink ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCreatedInviteToken(null);
                      setInviteEmail('');
                    }}
                    className="btn btn-primary"
                  >
                    Invite another person
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label className="form-label" htmlFor="members-inv-email">Work email address</label>
                    <input
                      id="members-inv-email"
                      type="email"
                      className="form-input"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@northwind.test"
                      required
                    />
                  </div>

                  <div>
                    <label className="form-label" htmlFor="members-inv-role">Role</label>
                    <select
                      id="members-inv-role"
                      className="form-select"
                      value={inviteRoleId}
                      onChange={(e) => setInviteRoleId(Number(e.target.value))}
                    >
                      {roles
                        .filter((r) => r.name !== 'Owner')
                        .map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label" htmlFor="members-inv-dept">Department</label>
                    <select
                      id="members-inv-dept"
                      className="form-select"
                      value={inviteDeptId}
                      onChange={(e) => setInviteDeptId(e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">No department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label" htmlFor="members-inv-mgr">Manager</label>
                    <select
                      id="members-inv-mgr"
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

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                    <button type="button" onClick={() => setShowInviteModal(false)} className="btn btn-secondary">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createInviteMutation.isPending}
                      className="btn btn-primary"
                      data-testid="send-email-invite-btn"
                    >
                      {createInviteMutation.isPending ? 'Sending...' : 'Send invite email'}
                    </button>
                  </div>
                </form>
              )
            ) : (
              /* Tab 2: Share join link */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Anyone who joins with this organisation code or link will appear as <strong>Pending</strong> until approved by an administrator.
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: '16px',
                    alignItems: 'center',
                    padding: '14px',
                    backgroundColor: 'var(--background)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        Invite Code
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                        <code
                          data-testid="modal-invite-code"
                          className="mono"
                          style={{
                            fontSize: '18px',
                            fontWeight: 700,
                            color: 'var(--accent)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {activeInviteCode}
                        </code>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            navigator.clipboard.writeText(activeInviteCode);
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 2000);
                          }}
                        >
                          {copiedCode ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedCode ? 'Copied' : 'Copy code'}</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        Full Join Link
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                        <input
                          type="text"
                          readOnly
                          data-testid="modal-join-link"
                          className="form-input mono"
                          value={joinLink}
                          style={{ fontSize: '11px', height: '30px' }}
                        />
                        <button
                          type="button"
                          data-testid="copy-join-link-btn"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            navigator.clipboard.writeText(joinLink);
                            setCopiedJoinLink(true);
                            setTimeout(() => setCopiedJoinLink(false), 2000);
                          }}
                        >
                          {copiedJoinLink ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedJoinLink ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* QR Code */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <QrCodeSvg value={joinLink} size={112} />
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Scan to join</span>
                  </div>
                </div>

                {hasPermission('org.settings') && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      Need to invalidate the current code?
                    </span>
                    <button
                      type="button"
                      data-testid="modal-regenerate-code-btn"
                      onClick={handleRegenerateInviteCode}
                      disabled={regenerateCodeMutation.isPending}
                      className="btn btn-secondary btn-sm"
                    >
                      <RotateCcw size={13} />
                      <span>{regenerateCodeMutation.isPending ? 'Regenerating...' : 'Regenerate code'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <div className="modal-overlay" onClick={() => setEditingMember(null)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '420px', padding: '24px', backgroundColor: 'var(--surface)' }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
              Edit Member: {editingMember.full_name}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '16px' }}>
              {editingMember.email}
            </p>

            <form onSubmit={handleSaveMember} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Role */}
              <div>
                <label className="form-label" htmlFor="edit-role">Role</label>
                <select
                  id="edit-role"
                  className="form-select"
                  value={editRoleId}
                  onChange={(e) => setEditRoleId(Number(e.target.value))}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.scope})</option>
                  ))}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="form-label" htmlFor="edit-dept">Department</label>
                <select
                  id="edit-dept"
                  className="form-select"
                  value={editDeptId}
                  onChange={(e) => setEditDeptId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">No Department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Manager */}
              <div>
                <label className="form-label" htmlFor="edit-manager">Reports To (Manager)</label>
                <select
                  id="edit-manager"
                  className="form-select"
                  value={editReportsToId}
                  onChange={(e) => setEditReportsToId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">None (Top-Level)</option>
                  {members
                    .filter((m) => m.id !== editingMember.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>
                    ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="form-label" htmlFor="edit-status">Account Status</label>
                <select
                  id="edit-status"
                  className="form-select"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING">Pending Approval</option>
                  <option value="DEACTIVATED">Deactivated</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button type="button" onClick={() => setEditingMember(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={updateMemberMutation.isPending} className="btn btn-primary">
                  {updateMemberMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
