import React from 'react';
import { Loader2, Lock } from 'lucide-react';

interface RiskChipProps {
  level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string | null;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string | null;
  score?: number | null;
  riskScore?: number | null;
  scanStatus?: 'QUEUED' | 'SCANNING' | 'COMPLETED' | 'FAILED' | string | null;
  scanProgress?: number | null;
  isSafeCopy?: boolean;
  isPasswordProtected?: boolean;
  size?: 'sm' | 'md';
  onClick?: (e: React.MouseEvent) => void;
}

export const RiskChip: React.FC<RiskChipProps> = ({
  level,
  riskLevel,
  score,
  riskScore,
  scanStatus = 'COMPLETED',
  scanProgress = 100,
  isSafeCopy = false,
  isPasswordProtected = false,
  size = 'sm',
  onClick,
}) => {
  const resolvedLevel = level ?? riskLevel ?? 'LOW';
  const resolvedScore = score !== undefined ? score : riskScore !== undefined ? riskScore : 0;

  if (scanStatus === 'QUEUED' || scanStatus === 'SCANNING') {
    return (
      <span
        onClick={onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          height: '24px',
          padding: '0 10px',
          borderRadius: '999px',
          fontSize: '11.5px',
          fontWeight: 700,
          background: 'var(--ice)',
          color: 'var(--accent)',
          cursor: onClick ? 'pointer' : 'default',
          whiteSpace: 'nowrap',
        }}
      >
        <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
        Scanning {scanProgress ? `${scanProgress}%` : '...'}
      </span>
    );
  }

  const normLevel = (resolvedLevel || 'LOW').toUpperCase();

  const palette: Record<string, { bg: string; fg: string; label: string }> = {
    LOW: {
      bg: 'var(--risk-low-bg)',
      fg: 'var(--risk-low-fg)',
      label: 'Low',
    },
    MEDIUM: {
      bg: 'var(--risk-medium-bg)',
      fg: 'var(--risk-medium-fg)',
      label: 'Medium',
    },
    HIGH: {
      bg: 'var(--risk-high-bg)',
      fg: 'var(--risk-high-fg)',
      label: 'High',
    },
    CRITICAL: {
      bg: 'var(--risk-critical-bg)',
      fg: 'var(--risk-critical-fg)',
      label: 'Critical',
    },
  };

  const config = palette[normLevel] || palette.LOW;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
      <span
        onClick={onClick}
        data-testid={`risk-chip-${normLevel.toLowerCase()}`}
        title={onClick ? 'Click to view full risk analysis' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: size === 'sm' ? '24px' : '28px',
          padding: size === 'sm' ? '0 10px' : '0 12px',
          borderRadius: '999px',
          fontSize: size === 'sm' ? '11.5px' : '12.5px',
          fontWeight: 700,
          background: config.bg,
          color: config.fg,
          cursor: onClick ? 'pointer' : 'default',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        <span>{config.label}</span>
        {resolvedScore !== null && resolvedScore !== undefined && (
          <span style={{ marginLeft: '3px' }}>· {resolvedScore}</span>
        )}
      </span>
      {isSafeCopy && (
        <span
          data-testid="safe-copy-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '24px',
            padding: '0 9px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 700,
            background: 'var(--ice)',
            color: 'var(--accent)',
            border: '1px solid var(--ice-border)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Safe copy
        </span>
      )}
      {isPasswordProtected && (
        <span
          data-testid="password-protected-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            height: '24px',
            padding: '0 9px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 700,
            background: '#F0F5FF',
            color: '#2457D6',
            border: '1px solid #D0E1FD',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <Lock size={11} /> Password-protected
        </span>
      )}
    </span>
  );
};
