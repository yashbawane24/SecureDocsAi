import React, { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, ShieldCheck, Lock, Copy, Check, EyeOff, FileCheck2, Sparkles, AlertTriangle
} from 'lucide-react';
import { api, DocumentFindingItem, DocumentItem, SafeCopyCreateResponse } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { RiskChip } from './RiskChip';

interface SafeCopyModalProps {
  isOpen?: boolean;
  document?: DocumentItem;
  documentId?: number;
  documentTitle?: string;
  originalRiskScore?: number;
  originalRiskLevel?: string;
  findings?: DocumentFindingItem[];
  onClose: () => void;
  onCreated?: (safeDocIdOrResult: any) => void;
  onShareSafeCopy?: (safeCopy: DocumentItem) => void;
}

const ALL_CATEGORIES = ['Identity', 'Financial', 'Health', 'Credentials', 'Contact', 'Legal/HR'];

export const SafeCopyModal: React.FC<SafeCopyModalProps> = ({
  isOpen = true,
  document: docProp,
  documentId,
  documentTitle,
  originalRiskScore,
  originalRiskLevel,
  findings: findingsProp,
  onClose,
  onCreated,
  onShareSafeCopy,
}) => {
  const queryClient = useQueryClient();
  const targetDocId = docProp?.id ?? documentId ?? 0;
  const targetDocTitle = docProp?.title ?? documentTitle ?? 'Document';
  const origScore = docProp?.risk_score ?? originalRiskScore ?? 0;
  const origLevel = docProp?.risk_level ?? originalRiskLevel ?? 'LOW';

  const [fetchedFindings, setFetchedFindings] = useState<DocumentFindingItem[]>([]);

  useEffect(() => {
    if ((!findingsProp || findingsProp.length === 0) && targetDocId) {
      api
        .getDocumentAnalysis(targetDocId)
        .then((res) => {
          const list = res.findings || [];
          setFetchedFindings(list);
          setSelectedFindingIds(list.map((f) => f.id));
        })
        .catch(() => {});
    }
  }, [findingsProp, targetDocId]);

  const findings = findingsProp && findingsProp.length > 0 ? findingsProp : fetchedFindings;

  const presentCategories = useMemo(() => {
    const set = new Set<string>();
    findings.forEach((f) => set.add(f.category || 'Identity'));
    return ALL_CATEGORIES.filter((c) => set.has(c));
  }, [findings]);

  const [selectedFindingIds, setSelectedFindingIds] = useState<number[]>(() =>
    (findingsProp || []).map((f) => f.id)
  );
  const [style, setStyle] = useState<'blackout' | 'label'>('blackout');
  const [protectWithPassword, setProtectWithPassword] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'auto' | 'custom'>('auto');
  const [customPassword, setCustomPassword] = useState('');
  const [createdResult, setCreatedResult] = useState<SafeCopyCreateResponse | null>(null);
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleCategory = (cat: string) => {
    const catIds = findings.filter((f) => f.category === cat).map((f) => f.id);
    const allSelected = catIds.every((id) => selectedFindingIds.includes(id));
    if (allSelected) {
      setSelectedFindingIds((prev) => prev.filter((id) => !catIds.includes(id)));
    } else {
      setSelectedFindingIds((prev) => Array.from(new Set([...prev, ...catIds])));
    }
  };

  const toggleFinding = (id: number) => {
    setSelectedFindingIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.createSafeCopy(targetDocId, {
        finding_ids: selectedFindingIds,
        style,
        generate_password: protectWithPassword && passwordMode === 'auto',
        password: protectWithPassword && passwordMode === 'custom' ? customPassword : null,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documentsAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.documentDetail(targetDocId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.documentAnalysis(targetDocId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditAll });
      setCreatedResult(res);
      if (onCreated) onCreated(res.safe_copy?.id ?? res);
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to create safe copy.');
    },
  });

  const handleCopyPassword = () => {
    if (!createdResult?.generated_password) return;
    navigator.clipboard.writeText(createdResult.generated_password);
    setCopiedPwd(true);
    setTimeout(() => setCopiedPwd(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="craft-card"
        style={{ maxWidth: '640px', width: '95%', padding: '24px', backgroundColor: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
        data-testid="safe-copy-modal"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '16px' }}>Create Redacted Safe Copy — {targetDocTitle}</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                Permanently removes sensitive text, metadata, and XMP streams from the PDF
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ maxHeight: '72vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {createdResult ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'rgba(30, 107, 82, 0.08)',
                  border: '1px solid rgba(30, 107, 82, 0.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <FileCheck2 size={20} style={{ color: 'var(--accent)' }} />
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>
                    {createdResult.safe_copy.title} created
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '12px' }}>
                  Redacted <strong>{createdResult.redacted_count}</strong> sensitive item(s) and re-scanned the safe copy to verify removal.
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Original risk:</div>
                  <RiskChip level={origLevel} score={origScore} />
                  <span style={{ color: 'var(--muted)' }}>→</span>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>New safe copy risk:</div>
                  <RiskChip
                    level={createdResult.new_risk_level}
                    score={createdResult.new_risk_score}
                    isSafeCopy
                  />
                </div>
              </div>

              {createdResult.generated_password && (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'var(--warning-bg)',
                    border: '1px solid rgba(183, 121, 31, 0.35)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Lock size={14} /> PDF Encryption Password (save this now — shown only once)
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <code
                      data-testid="safe-copy-generated-password"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: 'var(--surface)',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '14px',
                        fontWeight: 600,
                      }}
                    >
                      {createdResult.generated_password}
                    </code>
                    <button className="btn btn-secondary btn-sm" onClick={handleCopyPassword}>
                      {copiedPwd ? <Check size={14} /> : <Copy size={14} />}
                      {copiedPwd ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button className="btn btn-secondary" onClick={onClose}>
                  Done
                </button>
                {onShareSafeCopy && (
                  <button
                    className="btn btn-primary"
                    data-testid="share-created-safe-copy-btn"
                    onClick={() => {
                      onShareSafeCopy(createdResult.safe_copy);
                    }}
                  >
                    Share Safe Copy Now
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* 1. Redaction Style */}
              <div>
                <label className="form-label">Redaction Style</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setStyle('blackout')}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: style === 'blackout' ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: style === 'blackout' ? 'var(--background)' : 'var(--surface)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <EyeOff size={14} /> Solid Black Box
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '4px' }}>
                      Replaces sensitive text with opaque black bars (█████)
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStyle('label')}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: style === 'label' ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: style === 'label' ? 'var(--background)' : 'var(--surface)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sparkles size={14} /> Type Label Box
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '4px' }}>
                      Replaces text with [REDACTED: AADHAAR], [REDACTED: PAN], etc.
                    </div>
                  </button>
                </div>
              </div>

              {/* 2. Categories Filter */}
              {presentCategories.length > 0 && (
                <div>
                  <label className="form-label">Categories to Redact</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {presentCategories.map((cat) => {
                      const catIds = findings.filter((f) => f.category === cat).map((f) => f.id);
                      const checked = catIds.length > 0 && catIds.every((id) => selectedFindingIds.includes(id));
                      return (
                        <label
                          key={cat}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            background: checked ? 'var(--background)' : 'var(--surface)',
                            fontSize: '12.5px',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCategory(cat)}
                          />
                          <span>{cat}</span>
                          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
                            ({catIds.length})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. Individual Findings List */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Sensitive Findings ({selectedFindingIds.length} of {findings.length} selected)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelectedFindingIds(findings.map((f) => f.id))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelectedFindingIds([])}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: '190px',
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}
                >
                  {findings.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                      No sensitive findings detected in this document.
                    </div>
                  ) : (
                    findings.map((f) => (
                      <label
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          fontSize: '12.5px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <input
                            type="checkbox"
                            checked={selectedFindingIds.includes(f.id)}
                            onChange={() => toggleFinding(f.id)}
                          />
                          <span className="chip" style={{ fontSize: '11px' }}>
                            {f.entity_type}
                          </span>
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {f.masked_value}
                          </code>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          Page {f.page_number} · {Math.round(f.confidence * 100)}%
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* 4. Optional Password Encryption */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={protectWithPassword}
                    onChange={(e) => setProtectWithPassword(e.target.checked)}
                    data-testid="safe-copy-password-checkbox"
                  />
                  <Lock size={14} /> Encrypt downloaded PDF with a password (AES-256)
                </label>

                {protectWithPassword && (
                  <div style={{ marginTop: '10px', paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12.5px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          checked={passwordMode === 'auto'}
                          onChange={() => setPasswordMode('auto')}
                        />
                        Auto-generate strong 16-char password
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          checked={passwordMode === 'custom'}
                          onChange={() => setPasswordMode('custom')}
                        />
                        Custom password
                      </label>
                    </div>
                    {passwordMode === 'custom' && (
                      <input
                        type="password"
                        className="form-input"
                        placeholder="Enter PDF encryption password (min 8 chars)"
                        value={customPassword}
                        onChange={(e) => setCustomPassword(e.target.value)}
                      />
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="confirm-create-safe-copy-btn"
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  <ShieldCheck size={15} />
                  {createMutation.isPending ? 'Redacting & Re-scanning...' : 'Create Redacted Safe Copy'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
