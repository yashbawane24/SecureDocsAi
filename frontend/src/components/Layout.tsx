import React, { useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Clock, RefreshCw, LogOut, Menu, FileLock2 } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAuth } from '../context/AuthContext';

export const Layout: React.FC = () => {
  const { user, loading, logout, refreshUser } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  if (loading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg)',
          color: 'var(--ink2)',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '28px',
            height: '28px',
            border: '3px solid var(--line)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span className="mono" style={{ fontSize: '13px' }}>
          Loading workspace...
        </span>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/#roles" state={{ from: location }} replace />;
  }

  // Pending approval screen
  if (user.status === 'PENDING') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg)',
          padding: '24px',
        }}
      >
        <div
          className="craft-card"
          style={{
            maxWidth: '460px',
            width: '100%',
            padding: '36px 32px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--risk-medium-bg)',
              color: 'var(--risk-medium-fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Clock size={22} strokeWidth={1.85} />
          </div>

          <h2 style={{ marginBottom: '8px', fontSize: '22px' }}>Waiting for Approval</h2>
          <p style={{ fontSize: '14px', color: 'var(--ink2)', lineHeight: 1.55, marginBottom: '24px' }}>
            Your account request for{' '}
            <strong>{user.organization_name || user.organization?.name || 'the organisation'}</strong> has been
            submitted. An administrator or department head will approve your membership shortly.
          </p>

          <div
            style={{
              padding: '14px 16px',
              backgroundColor: 'var(--panel)',
              borderRadius: '14px',
              border: '1px solid var(--line)',
              fontSize: '13px',
              textAlign: 'left',
              marginBottom: '24px',
            }}
          >
            <div style={{ color: 'var(--ink3)', fontSize: '11.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Account details
            </div>
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{user.full_name}</div>
            <div className="mono" style={{ color: 'var(--ink2)', fontSize: '12.5px' }}>
              {user.email}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button onClick={refreshUser} className="btn btn-secondary">
              <RefreshCw size={15} /> Check status
            </button>
            <button onClick={logout} className="btn btn-danger">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Left Rounded Navy Sidebar */}
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      {/* Right Rounded Main Panel */}
      <main className="app-main-panel">
        {/* Mobile-only top drawer bar */}
        <div className="mobile-drawer-bar">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="btn btn-secondary btn-sm"
            aria-label="Open menu"
          >
            <Menu size={17} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                backgroundColor: 'var(--navy)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileLock2 size={15} color="var(--cyan)" />
            </div>
            <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--ink)' }}>SecureDocs AI</span>
          </div>
          <div style={{ width: '34px' }} />
        </div>

        <Outlet />
      </main>

      <style>{`
        .mobile-drawer-bar {
          display: none;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 18px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--line);
        }
        @media (max-width: 900px) {
          .mobile-drawer-bar {
            display: flex;
          }
        }
      `}</style>
    </div>
  );
};
