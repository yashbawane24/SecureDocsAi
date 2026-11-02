import React from 'react';

export interface ShareStatusProps {
  status?: string;
  isRevoked?: boolean;
  isUsed?: boolean;
  viewsUsed?: number;
  firstOpenedAt?: string | null;
  expiresAt?: string | null;
  approvalStatus?: string;
}

export const getShareStatusDisplay = (props: ShareStatusProps): { label: string; tone: 'danger' | 'warning' | 'neutral' | 'info' | 'success' } => {
  if (props.isRevoked || props.status === 'REVOKED') {
    return { label: 'Revoked', tone: 'danger' };
  }
  if (props.approvalStatus === 'PENDING' || props.status === 'PENDING_APPROVAL') {
    return { label: 'Pending approval', tone: 'warning' };
  }
  if (props.isUsed || props.status === 'USED' || props.status === 'CONSUMED') {
    return { label: 'Used', tone: 'neutral' };
  }
  if (props.status === 'EXPIRED' || (props.expiresAt && new Date(props.expiresAt).getTime() < Date.now())) {
    return { label: 'Expired', tone: 'neutral' };
  }
  if (props.firstOpenedAt || (props.viewsUsed && props.viewsUsed > 0) || props.status === 'OPENED') {
    const timeStr = props.firstOpenedAt ? new Date(props.firstOpenedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return { label: timeStr ? `Opened at ${timeStr}` : 'Opened', tone: 'info' };
  }
  return { label: 'Unopened', tone: 'success' };
};

export const ShareStatusChip: React.FC<ShareStatusProps & { testId?: string }> = (props) => {
  const { label, tone } = getShareStatusDisplay(props);
  const toneStyles: Record<string, { bg: string; color: string; border: string }> = {
    danger: { bg: '#FEF3F2', color: '#B42318', border: '#FECDCA' },
    warning: { bg: '#FFFAEB', color: '#B54708', border: '#FEDF89' },
    neutral: { bg: '#F2F4F7', color: '#344054', border: '#D0D5DD' },
    info: { bg: '#F0F9FF', color: '#026AA2', border: '#B9E6FE' },
    success: { bg: '#ECFDF3', color: '#027A48', border: '#A6F4C5' },
  };
  const style = toneStyles[tone] || toneStyles.neutral;

  return (
    <span
      data-testid={props.testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11.5px',
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
      }}
    >
      {label}
    </span>
  );
};

