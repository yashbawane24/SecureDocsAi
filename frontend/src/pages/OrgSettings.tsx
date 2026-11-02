import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save,
  CheckCircle2,
  Copy,
  Check,
  Palette,
  Shield,
  KeyRound,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Organization, RiskPolicyMap, api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { QrCodeSvg } from '../components/QrCodeSvg';

const DEFAULT_RISK_POLICY: RiskPolicyMap = {
  LOW: {
    allow_internal: true,
    allow_external: true,
    allow_download: true,
    require_otp_external: false,
    force_watermark: false,
    force_strict_viewing: false,
    max_duration_hours: 168,
    external_safe_copy_only: false,
    require_approval: false,
    require_approval_external_safe_copy: false,
  },
  MEDIUM: {
    allow_internal: true,
    allow_external: true,
    allow_download: true,
    require_otp_external: true,
    force_watermark: true,
    force_strict_viewing: false,
    max_duration_hours: 168,
    external_safe_copy_only: false,
    require_approval: false,
    require_approval_external_safe_copy: false,
  },
  HIGH: {
    allow_internal: true,
    allow_external: true,
    allow_download: false,
    require_otp_external: true,
    force_watermark: true,
    force_strict_viewing: true,
    max_duration_hours: 24,
    external_safe_copy_only: true,
    require_approval: false,
    require_approval_external_safe_copy: false,
  },
  CRITICAL: {
    allow_internal: false,
    allow_external: false,
    allow_download: false,
    require_otp_external: true,
    force_watermark: true,
    force_strict_viewing: true,
    max_duration_hours: 24,
    external_safe_copy_only: true,
    require_approval: true,
    require_approval_external_safe_copy: true,
  },
};

export const OrgSettings: React.FC = () => {
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: org, isLoading } = useQuery({
    queryKey: queryKeys.orgSettings,
    queryFn: () => api.getOrgSettings(),
  });

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [accentColor, setAccentColor] = useState('#2457D6');
  const [allowedDomainsStr, setAllowedDomainsStr] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [allowExternalLinks, setAllowExternalLinks] = useState(true);
  const [alwaysRequireOtp, setAlwaysRequireOtp] = useState(true);
  const [maxShareDurationHours, setMaxShareDurationHours] = useState(24);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [defaultWatermark, setDefaultWatermark] = useState('');
  const [riskPolicy, setRiskPolicy] = useState<RiskPolicyMap>(DEFAULT_RISK_POLICY);

  useEffect(() => {
    if (!org) return;
    setName(org.name || '');
    setLogoUrl(org.logo_url || '');
    const loadedAccent =
      org.brand_accent_color && org.brand_accent_color.toUpperCase() !== '#1E6B52'
        ? org.brand_accent_color
        : '#2457D6';
    setAccentColor(loadedAccent);
    setAllowedDomainsStr((org.allowed_email_domains || []).join(', '));
    setInviteCode(org.invite_code || '');
    setAllowExternalLinks(Boolean(org.allow_external_links));
    setAlwaysRequireOtp(Boolean(org.always_require_otp));
    setMaxShareDurationHours(Number(org.max_share_duration_hours || 24));
    setAllowDownloads(Boolean(org.allow_downloads));
    setDefaultWatermark(org.default_watermark_text || 'CONFIDENTIAL');
    setRiskPolicy(org.risk_policy || DEFAULT_RISK_POLICY);
  }, [org]);

  const isDirty = useMemo(() => {
    if (!org) return false;
    const origDomains = (org.allowed_email_domains || []).join(', ');
    const origLogo = org.logo_url || '';
    const origPolicy = JSON.stringify(org.risk_policy || DEFAULT_RISK_POLICY);
    const currPolicy = JSON.stringify(riskPolicy);
    const origAccent =
      org.brand_accent_color && org.brand_accent_color.toUpperCase() !== '#1E6B52'
        ? org.brand_accent_color
        : '#2457D6';

    return (
      name.trim() !== (org.name || '') ||
      logoUrl.trim() !== origLogo ||
      accentColor !== origAccent ||
      allowedDomainsStr.trim() !== origDomains ||
      inviteCode.trim() !== (org.invite_code || '') ||
      allowExternalLinks !== Boolean(org.allow_external_links) ||
      alwaysRequireOtp !== Boolean(org.always_require_otp) ||
      Number(maxShareDurationHours) !== Number(org.max_share_duration_hours || 24) ||
      allowDownloads !== Boolean(org.allow_downloads) ||
      defaultWatermark.trim() !== (org.default_watermark_text || 'CONFIDENTIAL') ||
      currPolicy !== origPolicy
    );
  }, [
    org,
    name,
    logoUrl,
    accentColor,
    allowedDomainsStr,
    inviteCode,
    allowExternalLinks,
    alwaysRequireOtp,
    maxShareDurationHours,
    allowDownloads,
    defaultWatermark,
    riskPolicy,
  ]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const domains = allowedDomainsStr
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      return api.updateOrgSettings({
        name: name.trim(),
        logo_url: logoUrl.trim() || null,
        brand_accent_color: accentColor,
        allowed_email_domains: domains,
        invite_code: inviteCode.trim(),
        allow_external_links: allowExternalLinks,
        always_require_otp: alwaysRequireOtp,
        max_share_duration_hours: Number(maxShareDurationHours),
        allow_downloads: allowDownloads,
        default_watermark_text: defaultWatermark.trim(),
        risk_policy: riskPolicy,
      });
    },
    onSuccess: (updated: Organization) => {
      queryClient.setQueryData(queryKeys.orgSettings, updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.orgSettings });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditAll });
      document.documentElement.style.setProperty('--accent', updated.brand_accent_color);
      setSuccessMsg('Settings saved.');
      setErrorMsg(null);
      setTimeout(() => setSuccessMsg(null), 4000);
      refreshUser();
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to save settings.');
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.regenerateInviteCode(),
    onSuccess: (updated: Organization) => {
      queryClient.setQueryData(queryKeys.orgSettings, updated);
      setInviteCode(updated.invite_code);
      setShowRegenerateConfirm(false);
      setSuccessMsg(`New invite code generated: ${updated.invite_code}`);
      setTimeout(() => setSuccessMsg(null), 4000);
      queryClient.invalidateQueries({ queryKey: queryKeys.auditAll });
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to regenerate invite code.');
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;
    saveMutation.mutate();
  };

  const updatePolicyField = (
    lvl: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    key: keyof RiskPolicyMap['LOW'],
    value: boolean | number
  ) => {
    setRiskPolicy((prev) => ({
      ...prev,
      [lvl]: {
        ...prev[lvl],
        [key]: value,
      },
    }));
  };

  const fullJoinUrl = `${window.location.origin}/join?code=${encodeURIComponent(inviteCode || 'NWH-2026')}`;

  if (isLoading && !org) {
    return (
      <div style={{ padding: '40px', color: 'var(--ink-2)', fontSize: '14px' }}>
        Loading organisation settings...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '880px' }} data-testid="org-settings-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Organisation Settings</h1>
          <p style={{ fontSize: '13px', color: 'var(--ink-2)', marginTop: '4px' }}>
            Brand identity, invite codes, security defaults, and risk-based sharing policy.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saveMutation.isPending}
          className="btn btn-primary"
          id="save-settings-btn"
          data-testid="save-settings-btn"
        >
          <Save size={14} />
          <span>{saveMutation.isPending ? 'Saving...' : 'Save changes'}</span>
        </button>
      </div>

      {successMsg && (
        <div
          data-testid="settings-success-toast"
          style={{
            padding: '10px 16px',
            backgroundColor: 'var(--status-success-bg)',
            color: 'var(--status-success)',
            border: '1px solid rgba(46, 125, 79, 0.3)',
            borderRadius: 'var(--radius-card)',
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
          data-testid="settings-error-banner"
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

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Card 1: Branding & Profile */}
        <div className="craft-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Palette size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Brand Identity & Name</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label className="form-label" htmlFor="org-name">Organisation Name</label>
              <input
                id="org-name"
                data-testid="org-name-input"
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="form-label" htmlFor="org-logo">Logo URL (optional)</label>
              <input
                id="org-logo"
                data-testid="org-logo-input"
                type="text"
                className="form-input"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://northwind.test/logo.svg"
              />
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="accent-color">Brand Accent Colour</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <input
                id="accent-color"
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ width: '40px', height: '36px', border: '1px solid var(--rule)', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
              />
              <input
                type="text"
                data-testid="org-accent-input"
                className="form-input mono"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ width: '120px' }}
              />
              <div
                style={{
                  padding: '4px 12px',
                  borderRadius: '4px',
                  backgroundColor: accentColor,
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                Live Preview
              </div>
            </div>
            <div className="form-hint">Applied across buttons, active indicators, and badges.</div>
          </div>
        </div>

        {/* Card 2: Access & Membership (A2) */}
        <div className="craft-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <KeyRound size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Access & Membership</h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '20px',
              alignItems: 'center',
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: 'var(--paper)',
              border: '1px solid var(--rule)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="form-label" htmlFor="invite-code">Organisation Invite Code</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    id="invite-code"
                    data-testid="org-invite-code-input"
                    type="text"
                    className="form-input mono"
                    style={{ width: '160px', fontWeight: 700, fontSize: '14px' }}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    required
                  />
                  <button
                    type="button"
                    data-testid="copy-invite-code-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="regenerate-invite-code-btn"
                    onClick={() => setShowRegenerateConfirm(true)}
                    className="btn btn-ghost btn-sm"
                  >
                    <RefreshCw size={13} />
                    <span>Regenerate</span>
                  </button>
                </div>
              </div>

              {showRegenerateConfirm && (
                <div
                  data-testid="regenerate-confirm-box"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--status-warning-bg)',
                    border: '1px solid var(--status-warning)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    fontSize: '12.5px',
                  }}
                >
                  <span>
                    <strong>Confirm:</strong> The old code will stop working immediately.
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowRegenerateConfirm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-testid="confirm-regenerate-code-btn"
                      className="btn btn-primary btn-sm"
                      disabled={regenerateMutation.isPending}
                      onClick={() => regenerateMutation.mutate()}
                    >
                      {regenerateMutation.isPending ? 'Regenerating...' : 'Confirm Regenerate'}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">Direct Join Link</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    data-testid="org-join-link-input"
                    className="form-input mono"
                    style={{ fontSize: '12px' }}
                    value={fullJoinUrl}
                  />
                  <button
                    type="button"
                    data-testid="copy-join-link-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(fullJoinUrl);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="btn btn-secondary btn-sm"
                    style={{ flexShrink: 0 }}
                  >
                    {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                  </button>
                </div>
                <div className="form-hint">
                  People who join with this link or code start as Pending until approved by an Admin.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <QrCodeSvg value={fullJoinUrl} size={120} />
              <span style={{ fontSize: '11px', color: 'var(--ink-2)' }}>Scan to join</span>
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="allowed-domains">Allowed Email Domains</label>
            <input
              id="allowed-domains"
              data-testid="org-allowed-domains-input"
              type="text"
              className="form-input mono"
              value={allowedDomainsStr}
              onChange={(e) => setAllowedDomainsStr(e.target.value)}
              placeholder="e.g. northwind.test, northwind.com"
            />
            <div className="form-hint">Comma-separated domains eligible for self-service join requests.</div>
          </div>
        </div>

        {/* Card 3: Security Policies */}
        <div className="craft-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Shield size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Default Security Policies</h3>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Allow External Links</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-2)' }}>Permit team members with external share permission to create links for non-members.</div>
            </div>
            <input
              type="checkbox"
              data-testid="allow-external-links-checkbox"
              checked={allowExternalLinks}
              onChange={(e) => setAllowExternalLinks(e.target.checked)}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Always Require OTP for External Links</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-2)' }}>Require 6-digit email verification codes before external recipients can open shared links.</div>
            </div>
            <input
              type="checkbox"
              data-testid="always-require-otp-checkbox"
              checked={alwaysRequireOtp}
              onChange={(e) => setAlwaysRequireOtp(e.target.checked)}
            />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Downloads Allowed</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-2)' }}>Allow senders to permit watermarked PDF downloads (subject to document risk level).</div>
            </div>
            <input
              type="checkbox"
              data-testid="allow-downloads-checkbox"
              checked={allowDownloads}
              onChange={(e) => setAllowDownloads(e.target.checked)}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label className="form-label" htmlFor="max-duration">Maximum Share Duration (Hours)</label>
              <input
                id="max-duration"
                data-testid="max-duration-input"
                type="number"
                className="form-input"
                value={maxShareDurationHours}
                onChange={(e) => setMaxShareDurationHours(Number(e.target.value))}
                min={1}
                max={8760}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="default-watermark">Default Watermark Text</label>
              <input
                id="default-watermark"
                data-testid="default-watermark-input"
                type="text"
                className="form-input"
                value={defaultWatermark}
                onChange={(e) => setDefaultWatermark(e.target.value)}
                placeholder="e.g. NORTHWIND CONFIDENTIAL"
              />
            </div>
          </div>
        </div>

        {/* Card 4: Risk Policy Matrix (PART B5) */}
        <div className="craft-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }} data-testid="risk-policy-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <ShieldAlert size={16} style={{ color: 'var(--accent)' }} />
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Risk-Based Sharing Policy</h3>
              <div style={{ fontSize: '12px', color: 'var(--ink-2)' }}>
                Enforced automatically in the backend based on each document's 0–100 sensitive data risk score.
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="craft-table" style={{ width: '100%', fontSize: '12.5px' }}>
              <thead>
                <tr>
                  <th>Risk Level</th>
                  <th style={{ textAlign: 'center' }}>Internal Share</th>
                  <th style={{ textAlign: 'center' }}>External Link</th>
                  <th style={{ textAlign: 'center' }}>Allow Download</th>
                  <th style={{ textAlign: 'center' }}>Require OTP</th>
                  <th style={{ textAlign: 'center' }}>Strict Viewing</th>
                  <th style={{ textAlign: 'center' }}>Safe Copy Only (Ext)</th>
                  <th style={{ textAlign: 'center' }}>Require Approval</th>
                </tr>
              </thead>
              <tbody>
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((lvl) => {
                  const row = riskPolicy[lvl] || DEFAULT_RISK_POLICY[lvl];
                  return (
                    <tr key={lvl}>
                      <td style={{ fontWeight: 700 }}>{lvl}</td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.allow_internal)}
                          onChange={(e) => updatePolicyField(lvl, 'allow_internal', e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.allow_external)}
                          onChange={(e) => updatePolicyField(lvl, 'allow_external', e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.allow_download)}
                          onChange={(e) => updatePolicyField(lvl, 'allow_download', e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.require_otp_external)}
                          onChange={(e) => updatePolicyField(lvl, 'require_otp_external', e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.force_strict_viewing)}
                          onChange={(e) => updatePolicyField(lvl, 'force_strict_viewing', e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.external_safe_copy_only)}
                          onChange={(e) => updatePolicyField(lvl, 'external_safe_copy_only', e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.require_approval)}
                          onChange={(e) => updatePolicyField(lvl, 'require_approval', e.target.checked)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={!isDirty || saveMutation.isPending}
            className="btn btn-primary"
            data-testid="save-settings-bottom-btn"
          >
            <Save size={14} />
            <span>{saveMutation.isPending ? 'Saving...' : 'Save changes'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
