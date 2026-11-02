import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export const Join: React.FC = () => {
  const { join, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const tokenParam = searchParams.get('token') || '';
  const codeParam = searchParams.get('code') || '';

  const [inviteToken, setInviteToken] = useState(tokenParam);
  const [inviteCode, setInviteCode] = useState(codeParam);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isInviteMode, setIsInviteMode] = useState(Boolean(tokenParam));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tokenParam) {
      setIsInviteMode(true);
      setInviteToken(tokenParam);
    } else if (codeParam) {
      setIsInviteMode(false);
      setInviteCode(codeParam);
    }
  }, [tokenParam, codeParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isInviteMode && inviteToken) {
        await api.acceptInvite({
          token: inviteToken.trim(),
          full_name: fullName.trim(),
          password,
        });
        await refreshUser();
        navigate('/dashboard');
      } else {
        await join({
          invite_code: inviteCode.trim(),
          full_name: fullName.trim(),
          email: email.trim(),
          password,
        });
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit join request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--background)',
        padding: '32px 16px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        className="craft-card"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '36px 32px',
          boxShadow: 'var(--shadow-card)',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'var(--accent)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
              margin: '0 auto 12px',
            }}
          >
            SD
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }}>
            {isInviteMode ? 'Accept invitation' : 'Join an organisation'}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            {isInviteMode
              ? 'Enter your name and password to activate your SecureDocs AI account.'
              : 'Enter your organisation code and work email to request membership.'}
          </p>
        </div>

        {/* Tab Switch */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--background)',
            borderRadius: '6px',
            padding: '3px',
            marginBottom: '20px',
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            onClick={() => setIsInviteMode(false)}
            style={{
              flex: 1,
              padding: '6px',
              fontSize: '12px',
              fontWeight: !isInviteMode ? 600 : 400,
              backgroundColor: !isInviteMode ? 'var(--surface)' : 'transparent',
              color: !isInviteMode ? 'var(--text)' : 'var(--muted)',
              border: 'none',
              borderRadius: '4px',
              boxShadow: !isInviteMode ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
            }}
          >
            Invite code
          </button>
          <button
            type="button"
            onClick={() => setIsInviteMode(true)}
            style={{
              flex: 1,
              padding: '6px',
              fontSize: '12px',
              fontWeight: isInviteMode ? 600 : 400,
              backgroundColor: isInviteMode ? 'var(--surface)' : 'transparent',
              color: isInviteMode ? 'var(--text)' : 'var(--muted)',
              border: 'none',
              borderRadius: '4px',
              boxShadow: isInviteMode ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              cursor: 'pointer',
            }}
          >
            Direct invite link
          </button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: '16px',
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {isInviteMode ? (
            <div>
              <label className="form-label" htmlFor="join-token">
                Invite token
              </label>
              <input
                id="join-token"
                type="text"
                className="form-input mono"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="e.g. INVITE_TOKEN_NWH_INTERN_2026"
                required
              />
            </div>
          ) : (
            <div>
              <label className="form-label" htmlFor="join-code">
                Organisation invite code
              </label>
              <input
                id="join-code"
                type="text"
                className="form-input mono"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="e.g. NWH-2026 or ORB-2026"
                required
              />
              <div className="form-hint" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                Sample codes: <code>NWH-2026</code> (Northwind Health) or <code>ORB-2026</code> (Orbitline Systems)
              </div>
            </div>
          )}

          <div>
            <label className="form-label" htmlFor="join-name">
              Full name
            </label>
            <input
              id="join-name"
              type="text"
              className="form-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Sanjay Kumar"
              required
            />
          </div>

          {!isInviteMode && (
            <div>
              <label className="form-label" htmlFor="join-email">
                Work email address
              </label>
              <input
                id="join-email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. sanjay@northwind.test"
                required
              />
            </div>
          )}

          <div>
            <label className="form-label" htmlFor="join-password">
              Password
            </label>
            <input
              id="join-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', height: '36px', marginTop: '6px' }}
          >
            <span>{loading ? 'Submitting...' : isInviteMode ? 'Activate account' : 'Request to join'}</span>
            <ArrowRight size={15} style={{ marginLeft: '6px' }} />
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: 'var(--muted)' }}>
          Back to{' '}
          <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
          {' '}or{' '}
          <Link to="/signup" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            Create organisation
          </Link>
        </div>
      </div>
    </div>
  );
};
