import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Signup: React.FC = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signup({
        org_name: orgName.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
        password,
      });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please check inputs.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        backgroundColor: 'var(--background)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Left Column: Dark Brand Panel */}
      <div
        style={{
          flex: 1,
          backgroundColor: 'var(--navy)',
          color: '#FFFFFF',
          padding: '48px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          borderRight: '1px solid var(--navy-2)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                backgroundColor: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '13px',
              }}
            >
              SD
            </div>
            <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
              SecureDocs AI
            </span>
          </div>

          <p style={{ fontSize: '15px', color: '#84888E', maxWidth: '420px', lineHeight: 1.5, marginBottom: '36px' }}>
            Set up an isolated workspace for your organisation with custom brand accent, departments, and roles.
          </p>

          {/* Document Preview Card */}
          <div
            style={{
              maxWidth: '460px',
              backgroundColor: '#0F1012',
              borderRadius: '8px',
              border: '1px solid #26292E',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '36px',
                backgroundColor: '#17191C',
                borderBottom: '1px solid #26292E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 12px',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>Governance_Policy_2026.pdf</span>
                <span className="mono" style={{ color: '#84888E' }}>p. 1 / 2</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={12} style={{ color: 'var(--danger)' }} />
                <span className="mono" style={{ color: 'var(--danger)', fontWeight: 600 }}>15:00</span>
              </div>
            </div>

            <div
              style={{
                height: '240px',
                backgroundColor: '#202328',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '180px',
                  height: '210px',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '3px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  padding: '16px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: 'rotate(-25deg)',
                    pointerEvents: 'none',
                    opacity: 0.16,
                    color: '#B42318',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8px',
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  NEW ORG VAULT • RESTRICTED
                </div>
                <div style={{ width: '45%', height: '7px', backgroundColor: '#141414', borderRadius: '1px' }} />
                <div style={{ width: '80%', height: '4px', backgroundColor: '#E6E5E0', borderRadius: '1px' }} />
                <div style={{ width: '90%', height: '4px', backgroundColor: '#E6E5E0', borderRadius: '1px' }} />
                <div style={{ width: '70%', height: '4px', backgroundColor: '#E6E5E0', borderRadius: '1px' }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: '12px', color: '#84888E' }}>
          Owner account provisioned immediately · Built-in roles included · Complete tenant isolation
        </div>
      </div>

      {/* Right Column: Signup Form */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px',
          backgroundColor: 'var(--background)',
        }}
      >
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
              Create organisation
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Register your organisation to set up an isolated workspace. You will be assigned the Owner role.
            </p>
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
            <div>
              <label className="form-label" htmlFor="signup-org">
                Organisation name
              </label>
              <input
                id="signup-org"
                type="text"
                className="form-input"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Apex Health Systems"
                required
              />
            </div>

            <div>
              <label className="form-label" htmlFor="signup-name">
                Your full name
              </label>
              <input
                id="signup-name"
                type="text"
                className="form-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Elena Rostova"
                required
              />
            </div>

            <div>
              <label className="form-label" htmlFor="signup-email">
                Work email address
              </label>
              <input
                id="signup-email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="elena@apexhealth.com"
                required
              />
            </div>

            <div>
              <label className="form-label" htmlFor="signup-password">
                Password
              </label>
              <input
                id="signup-password"
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
              <span>{loading ? 'Creating organisation...' : 'Create organisation and enter'}</span>
              <ArrowRight size={15} style={{ marginLeft: '6px' }} />
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: 'var(--muted)' }}>
            Already have an organisation?{' '}
            <Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
              Sign in
            </Link>
            {' '}or{' '}
            <Link to="/join" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
              Join with code
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
