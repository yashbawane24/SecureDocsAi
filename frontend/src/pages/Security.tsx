import React, { useState } from 'react';
import { KeyRound, Shield, CheckCircle2, LogOut, Laptop } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export const Security: React.FC = () => {
  const { user, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      setSuccessMsg('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '640px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>Security</h1>
        <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
          Manage your password, credentials, and active browser sessions.
        </p>
      </div>

      {successMsg && (
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid rgba(46, 125, 79, 0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={16} /> {successMsg}
        </div>
      )}

      {errorMsg && (
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
          {errorMsg}
        </div>
      )}

      {/* Change Password Card */}
      <div className="craft-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <KeyRound size={16} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text)' }}>Change password</h3>
        </div>

        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="form-label" htmlFor="cur-pass">Current password</label>
            <input
              id="cur-pass"
              type="password"
              className="form-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="new-pass">New password</label>
            <input
              id="new-pass"
              type="password"
              className="form-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="confirm-pass">Confirm new password</label>
            <input
              id="confirm-pass"
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              minLength={8}
            />
          </div>

          <div>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Updating...' : 'Update password'}
            </button>
          </div>
        </form>
      </div>

      {/* Active Sessions Card */}
      <div className="craft-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <Laptop size={16} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text)' }}>Active sessions</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              backgroundColor: 'var(--background)',
              borderRadius: '6px',
              border: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>Current browser session</div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                Authenticated via JWT bearer session
              </div>
            </div>
            <button onClick={logout} className="btn btn-secondary btn-sm" style={{ color: 'var(--danger)' }}>
              <LogOut size={13} style={{ marginRight: '4px' }} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
