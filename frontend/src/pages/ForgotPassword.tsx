import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, KeyRound } from 'lucide-react';
import { api } from '../api/client';

export const ForgotPassword: React.FC = () => {
  const [step, setStep] = useState<'REQUEST' | 'RESET'>('REQUEST');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.forgotPassword(email.trim());
      setMessage(res.message || 'Verification code sent to your email.');
      setStep('RESET');
    } catch (err: any) {
      setError(err.message || 'Failed to request reset code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await api.resetPassword({
        email: email.trim(),
        code: code.trim(),
        new_password: newPassword,
      });
      setMessage(res.message || 'Password reset successfully! You can now sign in.');
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
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
        backgroundColor: '#F7F7F4',
        padding: '32px 16px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        className="craft-card"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '36px 32px',
          boxShadow: 'var(--shadow-subtle)',
          backgroundColor: '#FFFFFF',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'var(--navy)',
              color: 'var(--cyan)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}
          >
            <KeyRound size={18} />
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#141414' }}>
            Reset Password
          </h2>
          <p style={{ fontSize: '13px', color: '#6B6B66', marginTop: '6px' }}>
            {step === 'REQUEST'
              ? 'Enter your work email address to receive a 6-digit recovery code.'
              : 'Enter the 6-digit recovery code sent to your email and your new password.'}
          </p>
        </div>

        {error && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 14px',
              backgroundColor: 'var(--status-danger-bg)',
              border: '1px solid var(--status-danger)',
              color: 'var(--status-danger)',
              fontSize: '13px',
              borderRadius: 'var(--radius-btn)',
            }}
          >
            {error}
          </div>
        )}

        {message && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 14px',
              backgroundColor: 'var(--status-success-bg)',
              border: '1px solid var(--status-success)',
              color: 'var(--status-success)',
              fontSize: '13px',
              borderRadius: 'var(--radius-btn)',
            }}
          >
            {message}
          </div>
        )}

        {step === 'REQUEST' ? (
          <form onSubmit={handleRequestCode} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label className="form-label" htmlFor="forgot-email">
                Work Email Address
              </label>
              <input
                id="forgot-email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.test"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', height: '38px', marginTop: '6px' }}
            >
              <span>{loading ? 'Sending code...' : 'Send Recovery Code'}</span>
              <ArrowRight size={15} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label className="form-label" htmlFor="reset-code">
                6-Digit Recovery Code
              </label>
              <input
                id="reset-code"
                type="text"
                className="form-input mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
                maxLength={6}
              />
              <div className="form-hint">Sent via Mailpit/SMTP in dev environment.</div>
            </div>

            <div>
              <label className="form-label" htmlFor="reset-new-password">
                New Password
              </label>
              <input
                id="reset-new-password"
                type="password"
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', height: '38px', marginTop: '6px' }}
            >
              <span>{loading ? 'Updating password...' : 'Set New Password'}</span>
              <ArrowRight size={15} />
            </button>
          </form>
        )}

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: '#6B6B66' }}>
          Remember your password?{' '}
          <Link to="/#roles" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};
