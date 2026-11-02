import React, { useState, useEffect } from 'react';
import { Network, Plus, Edit2, Users, RefreshCw, X, Check } from 'lucide-react';
import { Department, User, api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export const Departments: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptHeadId, setDeptHeadId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [depts, mems] = await Promise.all([
        api.listDepartments(),
        api.listMembers(),
      ]);
      setDepartments(depts);
      setMembers(mems);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateModal = () => {
    setEditingDept(null);
    setDeptName('');
    setDeptHeadId('');
    setShowModal(true);
  };

  const openEditModal = (dept: Department) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setDeptHeadId(dept.head_id || '');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) return;

    setSaving(true);
    try {
      if (editingDept) {
        await api.updateDepartment(editingDept.id, {
          name: deptName.trim(),
          head_id: deptHeadId ? Number(deptHeadId) : null,
        });
      } else {
        await api.createDepartment({
          name: deptName.trim(),
          head_id: deptHeadId ? Number(deptHeadId) : null,
        });
      }
      setShowModal(false);
      fetchData();
    } catch (e: any) {
      alert(e.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Departments</h1>
          <p style={{ fontSize: '13px', color: 'var(--ink-2)', marginTop: '4px' }}>
            Organizational units and department heads for {user?.organization?.name}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchData} className="btn btn-secondary">
            <RefreshCw size={14} /> Refresh
          </button>
          {hasPermission('departments.manage') && (
            <button onClick={openCreateModal} className="btn btn-primary" id="create-dept-btn">
              <Plus size={14} /> Create Department
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--status-danger-bg)',
            border: '1px solid var(--status-danger)',
            color: 'var(--status-danger)',
            fontSize: '13px',
            borderRadius: 'var(--radius-btn)',
          }}
        >
          {errorMsg}
        </div>
      )}

      <div className="craft-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-2)' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
            <span className="mono" style={{ fontSize: '13px' }}>Loading departments...</span>
          </div>
        ) : departments.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--ink-2)', fontSize: '13px' }}>
            No departments defined yet.
          </div>
        ) : (
          <table className="craft-table">
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Department Name</th>
                <th style={{ width: '30%' }}>Department Head</th>
                <th style={{ width: '18%' }}>Members</th>
                <th style={{ width: '12%', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{dept.name}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: '13px', color: dept.head_name ? 'var(--ink)' : 'var(--ink-2)' }}>
                      {dept.head_name || 'No Head Assigned'}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: '12px', color: 'var(--ink-2)' }}>
                      {dept.member_count} members
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {hasPermission('departments.manage') && (
                      <button
                        onClick={() => openEditModal(dept)}
                        className="btn btn-ghost btn-sm"
                        title="Edit department"
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '400px', padding: '24px', backgroundColor: 'var(--surface)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>
                {editingDept ? 'Edit Department' : 'Create Department'}
              </h3>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost" style={{ padding: '4px' }}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label" htmlFor="dept-name">Department Name</label>
                <input
                  id="dept-name"
                  type="text"
                  className="form-input"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="e.g. Clinical Operations"
                  required
                />
              </div>

              <div>
                <label className="form-label" htmlFor="dept-head">Department Head</label>
                <select
                  id="dept-head"
                  className="form-select"
                  value={deptHeadId}
                  onChange={(e) => setDeptHeadId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">No Head Assigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Saving...' : 'Save Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
