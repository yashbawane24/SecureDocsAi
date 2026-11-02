import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import {
  FileLock2,
  Crown,
  Building2,
  Briefcase,
  User as UserIcon,
  Check,
  ArrowRight,
  Link2,
  ShieldCheck,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type PortalRole = 'admin' | 'head' | 'manager' | 'employee' | 'universal';

interface PortalConfig {
  key: PortalRole;
  title: string;
  shortLabel: string;
  subtitle: string;
  acceptedRoles: string[];
  icon: React.ComponentType<any>;
  capabilities: string[];
  demoAccounts: { label: string; email: string; org: string }[];
}

const PORTALS: Record<PortalRole, PortalConfig> = {
  universal: {
    key: 'universal',
    title: 'Sign in to SecureDocs AI',
    shortLabel: 'Sign in',
    subtitle: 'Sign in with your work email to access your documents and workspace.',
    acceptedRoles: ['Owner', 'Admin', 'Department Head', 'Manager', 'Employee'],
    icon: FileLock2,
    capabilities: [
      'Encrypted document access and sharing',
      'AI risk analysis and findings masking',
      'Role-governed security permissions',
    ],
    demoAccounts: [
      { label: 'Meera Krishnan (Owner)', email: 'meera@northwind.test', org: 'Northwind Health' },
      { label: 'Ananya Rao (Head)', email: 'ananya@northwind.test', org: 'Northwind Health' },
      { label: 'Karthik Subramanian (Manager)', email: 'karthik@northwind.test', org: 'Northwind Health' },
      { label: 'Divya Menon (Employee)', email: 'divya@northwind.test', org: 'Northwind Health' },
    ],
  },
  admin: {
    key: 'admin',
    title: 'Owner & Admin sign-in',
    shortLabel: 'Admin',
    subtitle: 'Full organisation control, risk policy management, and critical share approvals.',
    acceptedRoles: ['Owner', 'Admin'],
    icon: Crown,
    capabilities: [
      'Manage members, roles and departments',
      'Approve critical-risk shares',
      'Set risk policy and export audit logs',
    ],
    demoAccounts: [
      { label: 'Meera Krishnan (Owner)', email: 'meera@northwind.test', org: 'Northwind Health' },
      { label: 'Daniel Varma (Admin)', email: 'daniel@northwind.test', org: 'Northwind Health' },
      { label: 'Neha Kapoor (Owner)', email: 'neha@orbitline.test', org: 'Orbitline Systems' },
    ],
  },
  head: {
    key: 'head',
    title: 'Department Head sign-in',
    shortLabel: 'Head',
    subtitle: 'Department-wide document governance, external sharing, and member approvals.',
    acceptedRoles: ['Department Head'],
    icon: Building2,
    capabilities: [
      'See every document in the department',
      'Share internally and externally',
      'Approve joiners and review activity',
    ],
    demoAccounts: [
      { label: 'Ananya Rao (HR Head)', email: 'ananya@northwind.test', org: 'Northwind Health' },
      { label: 'Vikram Nair (Finance Head)', email: 'vikram@northwind.test', org: 'Northwind Health' },
      { label: 'Sana Mirza (Clinical Head)', email: 'sana@northwind.test', org: 'Northwind Health' },
    ],
  },
  manager: {
    key: 'manager',
    title: 'Manager sign-in',
    shortLabel: 'Manager',
    subtitle: 'Team document collaboration, internal sharing, and real-time access tracking.',
    acceptedRoles: ['Manager'],
    icon: Briefcase,
    capabilities: [
      'Upload and scan documents',
      'Share with direct reports and head',
      'Track and revoke own shares',
    ],
    demoAccounts: [
      { label: 'Karthik Subramanian (Manager)', email: 'karthik@northwind.test', org: 'Northwind Health' },
      { label: 'Lakshmi Pillai (Manager)', email: 'lakshmi@northwind.test', org: 'Northwind Health' },
    ],
  },
  employee: {
    key: 'employee',
    title: 'Employee sign-in',
    shortLabel: 'Employee',
    subtitle: 'Access files shared with you, upload documents for AI risk scanning, and request shares.',
    acceptedRoles: ['Employee'],
    icon: UserIcon,
    capabilities: [
      'Open documents shared with you',
      'Upload your own files',
      'Request a share from your manager',
    ],
    demoAccounts: [
      { label: 'Divya Menon (Employee)', email: 'divya@northwind.test', org: 'Northwind Health' },
      { label: 'Farhan Ali (Employee)', email: 'farhan@northwind.test', org: 'Northwind Health' },
      { label: 'Tom Mathew (Employee)', email: 'tom@orbitline.test', org: 'Orbitline Systems' },
    ],
  },
};

function getPortalForUserRole(userRole: string): { portal: PortalRole; roleDisplayName: string; portalDisplayName: string } {
  if (userRole === 'Owner' || userRole === 'Admin') {
    return { portal: 'admin', roleDisplayName: userRole, portalDisplayName: 'Owner & Admin' };
  }
  if (userRole === 'Department Head') {
    return { portal: 'head', roleDisplayName: 'Department Head', portalDisplayName: 'Department Head' };
  }
  if (userRole === 'Manager') {
    return { portal: 'manager', roleDisplayName: 'Manager', portalDisplayName: 'Manager' };
  }
  return { portal: 'employee', roleDisplayName: userRole || 'Employee', portalDisplayName: 'Employee' };
}

export const LoginRedirect: React.FC = () => {
  return <Navigate to="/#roles" replace />;
};

export const RoleLogin: React.FC<{ portal: PortalRole }> = ({ portal }) => {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const config = PORTALS[portal];
  const RoleIcon = config.icon;

  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{
    message: string;
    targetPortal: PortalRole;
    targetLabel: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // Explicit check: only show demo accounts when VITE_DEMO_MODE === 'true'
  const showDemoAccounts = import.meta.env.VITE_DEMO_MODE === 'true';

  useEffect(() => {
    const prefillEmail = searchParams.get('email');
    if (prefillEmail) {
      setEmail(prefillEmail);
    }
    setError(null);
    setMismatch(null);
  }, [portal, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMismatch(null);
    setLoading(true);

    try {
      const loggedUser = await login(email.trim(), password);
      const actualRole = loggedUser.role || 'Employee';
      const isKnownStandardRole = ['Owner', 'Admin', 'Department Head', 'Manager', 'Employee'].includes(actualRole);
      const matchesPortal =
        config.acceptedRoles.includes(actualRole) ||
        (portal === 'employee' && !isKnownStandardRole);

      if (!matchesPortal) {
        const target = getPortalForUserRole(actualRole);
        await logout();
        const article = /^[aeiou]/i.test(target.roleDisplayName) ? 'an' : 'a';
        setMismatch({
          message: `This is ${article} ${target.roleDisplayName} account. Use ${target.portalDisplayName} sign-in.`,
          targetPortal: target.portal,
          targetLabel: `Go to ${target.portalDisplayName} sign-in`,
        });
        return;
      }

      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your work email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Test@1234');
    setError(null);
    setMismatch(null);
  };

  const otherPortals = (['admin', 'head', 'manager', 'employee'] as PortalRole[]).filter((p) => p !== portal);
  const notRolePrompt =
    portal === 'admin'
      ? 'Not an admin?'
      : portal === 'head'
      ? 'Not a department head?'
      : portal === 'manager'
      ? 'Not a manager?'
      : 'Not an employee?';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'row',
        backgroundColor: 'var(--surface)',
        fontFamily: 'var(--font-sans)',
      }}
      className="role-login-split"
    >
      {/* Left 45%: Navy Brand & Role Panel */}
      <div
        style={{
          width: '45%',
          minWidth: '380px',
          backgroundColor: 'var(--navy)',
          color: '#FFFFFF',
          padding: '44px 48px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
        className="role-login-left"
      >
        {/* Subtle grid pattern matching hero */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(to right, rgba(91, 224, 255, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(91, 224, 255, 0.04) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at 30% 30%, black 20%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle at 30% 30%, black 20%, transparent 80%)',
            pointerEvents: 'none',
          }}
        />

        {/* Top Logo */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              textDecoration: 'none',
              color: '#FFFFFF',
            }}
          >
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '10px',
                backgroundColor: 'var(--navy-2)',
                border: '1px solid rgba(91, 224, 255, 0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileLock2 size={18} strokeWidth={1.85} color="var(--cyan)" />
            </div>
            <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.03em' }}>
              SecureDocs AI
            </span>
          </Link>
        </div>

        {/* Center Role Details */}
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '420px', margin: '36px 0' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              backgroundColor: 'rgba(91, 224, 255, 0.12)',
              border: '1px solid rgba(91, 224, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px',
            }}
          >
            <RoleIcon size={22} strokeWidth={1.85} color="var(--cyan)" />
          </div>

          <h1
            style={{
              fontSize: '32px',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              color: '#FFFFFF',
              marginBottom: '12px',
            }}
          >
            {config.title}
          </h1>

          <p
            style={{
              fontSize: '14.5px',
              color: 'var(--navy-text)',
              lineHeight: 1.6,
              marginBottom: '28px',
            }}
          >
            {config.subtitle}
          </p>

          <div
            style={{
              backgroundColor: 'var(--navy-2)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '18px',
              padding: '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--navy-group)',
              }}
            >
              Portal capabilities
            </div>
            {config.capabilities.map((cap, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '13.5px',
                  color: '#E8EDF5',
                  fontWeight: 500,
                }}
              >
                <span
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(91, 224, 255, 0.14)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Check size={13} strokeWidth={2.4} color="var(--cyan)" />
                </span>
                <span>{cap}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Role Switcher */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            paddingTop: '20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--navy-muted)',
          }}
        >
          <span>{notRolePrompt}</span>
          {otherPortals.map((otherKey, index) => (
            <React.Fragment key={otherKey}>
              <Link
                to={`/login/${otherKey}${email ? `?email=${encodeURIComponent(email)}` : ''}`}
                style={{
                  color: 'var(--cyan)',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                {PORTALS[otherKey].shortLabel}
              </Link>
              {index < otherPortals.length - 1 && (
                <span style={{ color: 'var(--navy-group)' }}>·</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Right 55%: White Form Panel */}
      <div
        style={{
          flex: 1,
          backgroundColor: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 32px',
        }}
      >
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ marginBottom: '28px' }}>
            <Link
              to="/#roles"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                color: 'var(--ink2)',
                textDecoration: 'none',
                marginBottom: '16px',
              }}
            >
              <ArrowLeft size={14} />
              <span>All sign-in portals</span>
            </Link>
            <h2
              style={{
                fontSize: '26px',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                color: 'var(--ink)',
                marginBottom: '6px',
              }}
            >
              {config.title}
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--ink2)' }}>
              Enter your organisation credentials to open your workspace.
            </p>
          </div>

          {/* Role Mismatch Banner */}
          {mismatch && (
            <div
              data-testid="role-mismatch-alert"
              style={{
                marginBottom: '20px',
                padding: '16px',
                borderRadius: '14px',
                backgroundColor: 'var(--danger-card-bg)',
                border: '1px solid var(--danger-card-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <AlertCircle
                  size={18}
                  color="var(--risk-critical-fg)"
                  style={{ flexShrink: 0, marginTop: '1px' }}
                />
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--risk-critical-fg)', lineHeight: 1.45 }}>
                  {mismatch.message}
                </div>
              </div>
              <button
                type="button"
                data-testid="switch-correct-portal-btn"
                onClick={() =>
                  navigate(`/login/${mismatch.targetPortal}?email=${encodeURIComponent(email.trim())}`)
                }
                className="btn btn-primary"
                style={{ width: '100%', height: '38px', fontSize: '13px' }}
              >
                <span>{mismatch.targetLabel}</span>
                <ArrowRight size={15} />
              </button>
            </div>
          )}

          {/* Standard Auth Error */}
          {error && (
            <div
              data-testid="login-error-alert"
              style={{
                marginBottom: '18px',
                padding: '12px 14px',
                borderRadius: '12px',
                backgroundColor: 'var(--risk-critical-bg)',
                border: '1px solid var(--danger-card-border)',
                color: 'var(--risk-critical-fg)',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label className="form-label" htmlFor="login-email">
                Work email
              </label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organisation.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label className="form-label" htmlFor="login-password" style={{ margin: 0 }}>
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--accent)',
                    textDecoration: 'none',
                  }}
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="login-password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '4px' }}
            >
              <span>{loading ? 'Signing in...' : 'Sign in'}</span>
              <ArrowRight size={16} />
            </button>
          </form>

          <div
            style={{
              marginTop: '24px',
              paddingTop: '20px',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '13px',
              color: 'var(--ink2)',
            }}
          >
            <span>New here?</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Link
                to="/join"
                style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
              >
                Join with invite code
              </Link>
              {portal === 'admin' && (
                <>
                  <span style={{ color: 'var(--line)' }}>·</span>
                  <Link
                    to="/signup"
                    style={{ color: 'var(--ink2)', fontWeight: 600, textDecoration: 'none' }}
                  >
                    Create organisation
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Demo Accounts Box — ONLY rendered when VITE_DEMO_MODE === 'true' */}
          {showDemoAccounts && (
            <div
              data-testid="demo-accounts-box"
              style={{
                marginTop: '24px',
                padding: '16px',
                borderRadius: '14px',
                backgroundColor: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--ink3)',
                  marginBottom: '10px',
                }}
              >
                {config.shortLabel} Demo Accounts (Test@1234)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {config.demoAccounts.map((acct) => (
                  <button
                    key={acct.email}
                    type="button"
                    onClick={() => handleQuickFill(acct.email)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--line)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '12.5px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{acct.label}</span>
                    <span className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                      {acct.email}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .role-login-split {
            flex-direction: column !important;
          }
          .role-login-left {
            width: 100% !important;
            min-width: 0 !important;
            padding: 28px 24px !important;
          }
        }
      `}</style>
    </div>
  );
};

export const OpenSharedLink: React.FC = () => {
  const navigate = useNavigate();
  const [inputVal, setInputVal] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleOpen = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const raw = inputVal.trim();
    if (!raw) {
      setError('Paste a shared link or access token to continue.');
      return;
    }

    // Extract token from full URL (/s/:token or /share/:token) or raw token string
    let token = raw;
    try {
      if (raw.includes('/s/')) {
        token = raw.split('/s/')[1].split(/[?#]/)[0].trim();
      } else if (raw.includes('/share/')) {
        token = raw.split('/share/')[1].split(/[?#]/)[0].trim();
      } else if (raw.includes('/viewer/')) {
        const shareId = raw.split('/viewer/')[1].split(/[?#]/)[0].trim();
        navigate(`/viewer/${shareId}`);
        return;
      }
    } catch {
      token = raw;
    }

    if (!token) {
      setError('Could not find a valid share token in that link.');
      return;
    }

    navigate(`/s/${encodeURIComponent(token)}`);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--landing-bg)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '28px 24px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Top Navbar */}
      <div
        style={{
          maxWidth: '1160px',
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            textDecoration: 'none',
            color: 'var(--ink)',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              backgroundColor: 'var(--navy)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileLock2 size={18} strokeWidth={1.85} color="var(--cyan)" />
          </div>
          <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.03em' }}>
            SecureDocs AI
          </span>
        </Link>

        <Link to="/#roles" className="btn btn-secondary" style={{ borderRadius: '999px' }}>
          Workspace sign in
        </Link>
      </div>

      {/* Centred White Card */}
      <div
        style={{
          maxWidth: '480px',
          width: '100%',
          margin: '40px auto',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: '24px',
          padding: '36px 32px',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            backgroundColor: 'var(--ice)',
            border: '1px solid var(--ice-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
          }}
        >
          <Link2 size={22} color="var(--accent)" />
        </div>

        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--ink)',
            marginBottom: '8px',
          }}
        >
          Open a shared link
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--ink2)', lineHeight: 1.55, marginBottom: '24px' }}>
          Paste the link or token you received. We will send a 6-digit verification code to the recipient email address on the share.
        </p>

        {error && (
          <div
            style={{
              marginBottom: '16px',
              padding: '12px 14px',
              borderRadius: '12px',
              backgroundColor: 'var(--risk-critical-bg)',
              color: 'var(--risk-critical-fg)',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleOpen} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label className="form-label" htmlFor="shared-link-input">
              Shared link or token
            </label>
            <input
              id="shared-link-input"
              type="text"
              className="form-input mono"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="https://.../s/TOKEN_S6_MEDI_INVOICE"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            <span>Continue to verification</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div
          style={{
            marginTop: '24px',
            paddingTop: '18px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '12.5px',
            color: 'var(--ink2)',
          }}
        >
          <ShieldCheck size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span>The access timer starts only after you verify your email code.</span>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: '12.5px', color: 'var(--ink3)' }}>
        SecureDocs AI · Encrypted external document delivery
      </div>
    </div>
  );
};
