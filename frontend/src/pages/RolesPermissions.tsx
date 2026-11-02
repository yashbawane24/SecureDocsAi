import React, { useState, useEffect } from 'react';
import { Plus, Save, CheckCircle2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Role, api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'documents.upload': 'Upload and encrypt confidential documents',
  'documents.delete_own': 'Delete documents owned by self',
  'documents.view_all_in_scope': 'View all documents within role scope',
  'documents.reveal_sensitive': 'Reveal original values on redacted safe copies for 10 seconds (audited)',
  'shares.create_internal': 'Create internal shares for organisation peers',
  'shares.create_external': 'Generate external OTP access links',
  'shares.allow_download': 'Authorize recipients to download watermarked files',
  'shares.revoke_any_in_scope': 'Revoke any active shares within role scope',
  'audit.view': 'Inspect organisation audit logs and export CSV',
  'members.invite': 'Issue email invitations to prospective members',
  'members.approve': 'Approve or reject pending join requests',
  'members.manage': 'Modify member departments, roles, and status',
  'roles.manage': 'Edit permission matrix and create custom roles',
  'departments.manage': 'Create, edit, and assign department heads',
  'org.settings': 'Configure organisation branding, security, and risk policies',
};

export const RolesPermissions: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();

  const { data: fetchedRoles = [], isLoading } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.listRoles(),
  });

  const [roles, setRoles] = useState<Role[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleScope, setNewRoleScope] = useState<string>('OWN_DEPARTMENT');

  useEffect(() => {
    setRoles(fetchedRoles);
  }, [fetchedRoles]);

  const saveMatrixMutation = useMutation({
    mutationFn: (payload: any[]) => api.updateRoleMatrix(payload),
    onSuccess: async () => {
      setSuccessMsg('Permissions matrix saved. Changes take effect immediately.');
      setTimeout(() => setSuccessMsg(null), 4000);
      qc.invalidateQueries({ queryKey: queryKeys.roles });
      qc.invalidateQueries({ queryKey: queryKeys.me });
      await refreshUser();
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to save permission matrix.');
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: (payload: { name: string; scope: string; permissions: string[] }) =>
      api.createRole(payload),
    onSuccess: () => {
      setShowCreateModal(false);
      setNewRoleName('');
      qc.invalidateQueries({ queryKey: queryKeys.roles });
    },
    onError: (err: any) => alert(err.message || 'Failed to create role'),
  });

  const handleTogglePermission = (roleId: number, permKey: string) => {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.id !== roleId) return r;
        if (r.name === 'Owner') return r;

        const hasPerm = r.permissions.includes(permKey);
        const updatedPerms = hasPerm
          ? r.permissions.filter((p) => p !== permKey)
          : [...r.permissions, permKey];

        return { ...r, permissions: updatedPerms };
      })
    );
  };

  const handleScopeChange = (roleId: number, newScope: any) => {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.id !== roleId) return r;
        if (r.name === 'Owner') return r;
        return { ...r, scope: newScope };
      })
    );
  };

  const handleSaveChanges = () => {
    setError(null);
    const payload = roles.map((r) => ({
      role_id: r.id,
      scope: r.scope,
      permissions: r.permissions,
    }));
    saveMatrixMutation.mutate(payload);
  };

  const handleCreateRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    createRoleMutation.mutate({
      name: newRoleName.trim(),
      scope: newRoleScope,
      permissions: ['documents.upload', 'documents.delete_own'],
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Roles & Permissions Matrix</h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Central permission policy grid for {user?.organization?.name}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-secondary">
            <Plus size={14} /> Create Custom Role
          </button>
          <button
            onClick={handleSaveChanges}
            disabled={saveMatrixMutation.isPending}
            className="btn btn-primary"
            id="save-matrix-btn"
          >
            <Save size={14} />
            <span>{saveMatrixMutation.isPending ? 'Saving...' : 'Save Matrix'}</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid rgba(46, 125, 79, 0.3)',
            borderRadius: '8px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={16} /> {successMsg}
        </div>
      )}

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
          {error}
        </div>
      )}

      {/* Permissions Matrix Table */}
      <div className="craft-card" style={{ overflowX: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
            <span className="mono" style={{ fontSize: '13px' }}>Loading permissions grid...</span>
          </div>
        ) : (
          <table className="craft-table" style={{ width: '100%', minWidth: '880px' }}>
            <thead>
              <tr>
                <th style={{ width: '30%', minWidth: '240px' }}>Permission Key</th>
                {roles.map((role) => (
                  <th key={role.id} style={{ textAlign: 'center', minWidth: '120px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '12px' }}>
                      {role.name}
                    </div>
                    {role.is_builtin && (
                      <span className="mono" style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 400 }}>
                        (Built-in)
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ backgroundColor: 'var(--background)' }}>
                <td style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>
                  Enforced Scope
                </td>
                {roles.map((role) => (
                  <td key={role.id} style={{ textAlign: 'center' }}>
                    {role.name === 'Owner' ? (
                      <span className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>Whole Org</span>
                    ) : (
                      <select
                        className="form-select"
                        value={role.scope}
                        onChange={(e) => handleScopeChange(role.id, e.target.value)}
                        style={{ height: '28px', fontSize: '11px', padding: '2px 6px' }}
                      >
                        <option value="OWN_DIRECT_REPORTS">Direct Reports</option>
                        <option value="OWN_DEPARTMENT">Department</option>
                        <option value="WHOLE_ORGANIZATION">Whole Org</option>
                      </select>
                    )}
                  </td>
                ))}
              </tr>

              {Object.keys(PERMISSION_DESCRIPTIONS).map((permKey) => (
                <tr key={permKey}>
                  <td>
                    <div className="mono" style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>
                      {permKey}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {PERMISSION_DESCRIPTIONS[permKey]}
                    </div>
                  </td>
                  {roles.map((role) => {
                    const isChecked = role.permissions.includes(permKey);
                    const isOwner = role.name === 'Owner';
                    return (
                      <td key={role.id} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isOwner}
                          onChange={() => handleTogglePermission(role.id, permKey)}
                          style={{
                            width: '16px',
                            height: '16px',
                            accentColor: 'var(--accent)',
                            cursor: isOwner ? 'not-allowed' : 'pointer',
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Custom Role Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '400px', padding: '24px', backgroundColor: 'var(--surface)' }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '14px' }}>Create Custom Role</h3>
            <form onSubmit={handleCreateRole} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label" htmlFor="new-role-name">Role Name</label>
                <input
                  id="new-role-name"
                  type="text"
                  className="form-input"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Compliance Officer"
                  required
                />
              </div>

              <div>
                <label className="form-label" htmlFor="new-role-scope">Default Scope</label>
                <select
                  id="new-role-scope"
                  className="form-select"
                  value={newRoleScope}
                  onChange={(e) => setNewRoleScope(e.target.value)}
                >
                  <option value="OWN_DIRECT_REPORTS">Direct Reports</option>
                  <option value="OWN_DEPARTMENT">Own Department</option>
                  <option value="WHOLE_ORGANIZATION">Whole Organisation</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={createRoleMutation.isPending} className="btn btn-primary">
                  Create Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
