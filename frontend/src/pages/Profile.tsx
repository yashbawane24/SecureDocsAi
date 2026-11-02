import React from 'react';
import { User, Mail, Shield, Building, Network } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Profile: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '640px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Account Profile</h1>
        <p style={{ fontSize: '13px', color: 'var(--ink-2)', marginTop: '4px' }}>
          Your verified credentials and assigned role in {user.organization?.name}.
        </p>
      </div>

      <div className="craft-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: '#2457D6',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              fontWeight: 700,
            }}
          >
            {user.full_name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>{user.full_name}</h2>
            <div className="mono" style={{ fontSize: '12px', color: 'var(--ink-2)' }}>{user.email}</div>
          </div>
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--rule)' }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)', marginBottom: '4px' }}>
              Assigned Role
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{user.role}</div>
          </div>

          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)', marginBottom: '4px' }}>
              Department
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{user.department || 'General'}</div>
          </div>

          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)', marginBottom: '4px' }}>
              Organization
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{user.organization?.name}</div>
          </div>

          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)', marginBottom: '4px' }}>
              Account Status
            </div>
            <span className={`chip chip-${user.status.toLowerCase()}`}>
              {user.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
