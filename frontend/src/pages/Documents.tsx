import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload,
  Share2,
  FileText,
  RefreshCw,
  LayoutGrid,
  List,
  Eye,
  Trash2,
  X,
  FileCheck,
  Search,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DocumentItem, api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { ShareModal } from '../components/ShareModal';
import { SafeCopyModal } from '../components/SafeCopyModal';
import { RiskChip } from '../components/RiskChip';

export const Documents: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialRisk = searchParams.get('risk') || 'ALL';
  const isRiskView = searchParams.get('view') === 'risk';
  const [riskFilter, setRiskFilter] = useState<string>(initialRisk);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const [selectedDocForShare, setSelectedDocForShare] = useState<DocumentItem | null>(null);
  const [selectedDocForSafeCopy, setSelectedDocForSafeCopy] = useState<DocumentItem | null>(null);

  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStep, setUploadStep] = useState<number>(0);

  useEffect(() => {
    const paramRisk = searchParams.get('risk');
    if (paramRisk && paramRisk !== riskFilter) {
      setRiskFilter(paramRisk);
    }
    if (searchParams.get('upload') === 'true') {
      setShowUploadPanel(true);
    }
  }, [searchParams]);

  const filterParams = {
    risk_level: riskFilter !== 'ALL' ? riskFilter : undefined,
    search: searchQuery.trim() || undefined,
  };

  const { data: rawDocuments = [], isLoading, error } = useQuery({
    queryKey: queryKeys.documents(filterParams),
    queryFn: () => api.listDocuments(filterParams),
    refetchInterval: (query) => {
      const list = query.state.data as DocumentItem[] | undefined;
      if (list?.some((d) => d.scan_status === 'QUEUED' || d.scan_status === 'SCANNING')) {
        return 1500;
      }
      return false;
    },
  });

  // Sort by risk score descending when in Risk analysis view
  const documents = isRiskView
    ? [...rawDocuments].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
    : rawDocuments;

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      setUploadStep(1);
      setTimeout(() => setUploadStep((s) => (s === 1 ? 2 : s)), 300);
      setTimeout(() => setUploadStep((s) => (s === 2 ? 3 : s)), 650);
      const created = await api.uploadDocument(formData);
      setUploadStep(4);
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      qc.invalidateQueries({ queryKey: queryKeys.auditAll });
      qc.invalidateQueries({ queryKey: queryKeys.notifications });
      setTimeout(() => {
        setShowUploadPanel(false);
        setUploadTitle('');
        setUploadFile(null);
        setUploadStep(0);
      }, 450);
    },
    onError: (err: any) => {
      setUploadStep(0);
      alert(err.message || 'Upload failed.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: number) => api.deleteDocument(docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
      qc.invalidateQueries({ queryKey: queryKeys.myShares });
      qc.invalidateQueries({ queryKey: queryKeys.auditAll });
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to delete document');
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setUploadFile(file);
      if (!uploadTitle) {
        setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    const formData = new FormData();
    formData.append('title', uploadTitle || uploadFile.name);
    formData.append('file', uploadFile);
    uploadMutation.mutate(formData);
  };

  const handleDelete = (docId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm('Delete this document? All active shares for this document will be turned off.')) return;
    deleteMutation.mutate(docId);
  };

  const handleRiskFilterChange = (val: string) => {
    setRiskFilter(val);
    if (val === 'ALL') {
      searchParams.delete('risk');
    } else {
      searchParams.set('risk', val);
    }
    setSearchParams(searchParams, { replace: true });
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const uploadSteps = [
    { step: 1, label: 'Encrypting (AES-256-GCM)' },
    { step: 2, label: 'Scanning for sensitive data' },
    { step: 3, label: 'Scoring risk (0–100)' },
    { step: 4, label: 'Ready' },
  ];

  const orgName = user?.organization_name || user?.organization?.name || 'Northwind Health';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
            {isRiskView ? 'Risk analysis' : 'My documents'}
          </h1>
          <p style={{ fontSize: '13.5px', color: 'var(--ink2)', marginTop: '4px' }}>
            {isRiskView
              ? `Automated PII, financial, and health sensitivity classification across ${orgName}.`
              : `Encrypted document vault with AI risk scoring for ${orgName}.`}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* List / Grid Toggle */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--surface)',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              padding: '3px',
              height: '42px',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="btn btn-ghost btn-sm"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '9px',
                backgroundColor: viewMode === 'list' ? 'var(--navy)' : 'transparent',
                color: viewMode === 'list' ? '#FFFFFF' : 'var(--ink2)',
              }}
              title="Table view"
            >
              <List size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className="btn btn-ghost btn-sm"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '9px',
                backgroundColor: viewMode === 'grid' ? 'var(--navy)' : 'transparent',
                color: viewMode === 'grid' ? '#FFFFFF' : 'var(--ink2)',
              }}
              title="Grid view"
            >
              <LayoutGrid size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: queryKeys.documentsAll })}
            className="btn btn-secondary"
            style={{ width: '42px', padding: 0 }}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>

          {hasPermission('documents.upload') && (
            <button
              type="button"
              onClick={() => setShowUploadPanel((prev) => !prev)}
              className="btn btn-primary"
              id="upload-doc-btn"
              data-testid="upload-doc-btn"
            >
              <Upload size={16} />
              <span>Upload document</span>
            </button>
          )}
        </div>
      </div>

      {/* Drag-and-Drop Upload Area at the Top when Uploading */}
      {showUploadPanel && (
        <div
          className="craft-card"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--ice-border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)' }}>
                Upload & scan document
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--ink2)', marginTop: '2px' }}>
                Files are encrypted with AES-256-GCM at rest and scanned across 14 sensitive-data detectors.
              </p>
            </div>
            {!uploadMutation.isPending && (
              <button
                type="button"
                onClick={() => setShowUploadPanel(false)}
                className="btn btn-ghost btn-sm"
                style={{ width: '32px', height: '32px', padding: 0 }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                border: '2px dashed var(--ice-border)',
                borderRadius: '16px',
                padding: '28px 20px',
                textAlign: 'center',
                backgroundColor: 'var(--ice)',
                cursor: 'pointer',
              }}
              onClick={() => document.getElementById('file-upload-input')?.click()}
            >
              <input
                id="file-upload-input"
                data-testid="file-upload-input"
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    setUploadFile(file);
                    if (!uploadTitle) {
                      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
                    }
                  }
                }}
              />

              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px',
                }}
              >
                <Upload size={20} color="var(--accent)" />
              </div>

              {uploadFile ? (
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--ink)' }}>{uploadFile.name}</div>
                  <div className="mono" style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '2px' }}>
                    {formatBytes(uploadFile.size)}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>
                    Drag & drop a PDF, DOCX, or TXT file here, or click to browse
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--ink2)', marginTop: '4px' }}>
                    Automatic conversion to watermarked PDF with full NLP & regex risk analysis
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <label className="form-label" htmlFor="upload-doc-title">
                  Document title
                </label>
                <input
                  id="upload-doc-title"
                  data-testid="upload-doc-title"
                  type="text"
                  className="form-input"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. Q4 Employee Compensation Review"
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowUploadPanel(false)}
                  disabled={uploadMutation.isPending}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadMutation.isPending || !uploadFile}
                  className="btn btn-primary"
                  id="submit-upload-btn"
                  data-testid="submit-upload-btn"
                >
                  <FileCheck size={16} />
                  <span>{uploadMutation.isPending ? 'Scanning & Encrypting...' : 'Upload & Scan'}</span>
                </button>
              </div>
            </div>

            {uploadStep > 0 && (
              <div
                data-testid="upload-step-indicator"
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--panel)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '16px',
                }}
              >
                {uploadSteps.map((s) => {
                  const done = uploadStep > s.step || uploadStep === 4;
                  const current = uploadStep === s.step && uploadStep < 4;
                  return (
                    <div
                      key={s.step}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12.5px',
                        color: done ? 'var(--accent)' : current ? 'var(--ink)' : 'var(--ink3)',
                        fontWeight: current || done ? 700 : 500,
                      }}
                    >
                      <CheckCircle2 size={15} style={{ opacity: done || current ? 1 : 0.4 }} />
                      <span>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Filter Bar: Search + Risk Level Filter */}
      <div
        className="craft-card"
        style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={16} style={{ position: 'absolute', left: '14px', top: '13px', color: 'var(--ink3)' }} />
          <input
            type="text"
            data-testid="documents-search-input"
            className="form-input"
            style={{ paddingLeft: '38px' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents by title or filename..."
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12.5px', color: 'var(--ink2)', fontWeight: 600 }}>Risk level:</span>
          {(['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((lvl) => {
            const active = riskFilter === lvl;
            return (
              <button
                key={lvl}
                type="button"
                data-testid={`risk-filter-${lvl.toLowerCase()}`}
                onClick={() => handleRiskFilterChange(lvl)}
                className={active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                style={{ height: '32px', fontSize: '12.5px', borderRadius: '999px' }}
              >
                {lvl === 'ALL' ? 'All' : lvl.charAt(0) + lvl.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--risk-critical-bg)',
            border: '1px solid var(--danger-card-border)',
            color: 'var(--risk-critical-fg)',
            fontSize: '13.5px',
            borderRadius: '14px',
            fontWeight: 600,
          }}
        >
          {(error as any)?.message || 'Failed to load documents.'}
        </div>
      )}

      {/* Main Content: Table or Grid */}
      {isLoading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink2)' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              border: '3px solid var(--line)',
              borderTopColor: 'var(--accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 10px',
            }}
          />
          <span className="mono" style={{ fontSize: '13px' }}>
            Loading encrypted documents...
          </span>
        </div>
      ) : documents.length === 0 ? (
        <div className="craft-card" style={{ padding: '64px 24px', textAlign: 'center' }}>
          <FileText size={36} style={{ color: 'var(--ink3)', margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px', color: 'var(--ink)' }}>
            No documents found
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--ink2)', marginBottom: '18px' }}>
            Upload a PDF, DOCX, or TXT document to scan for sensitive information and share securely.
          </p>
          {hasPermission('documents.upload') && (
            <button type="button" onClick={() => setShowUploadPanel(true)} className="btn btn-primary">
              <Upload size={16} /> Upload document
            </button>
          )}
        </div>
      ) : viewMode === 'list' ? (
        <div className="craft-card" style={{ padding: '8px 20px 20px' }}>
          <div className="table-wrapper">
            <table className="craft-table" data-testid="documents-table">
              <thead>
                <tr>
                  <th>DOCUMENT</th>
                  <th>RISK</th>
                  <th>SIZE</th>
                  <th>ACTIVE SHARES</th>
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} data-testid={`doc-row-${doc.id}`}>
                    <td>
                      <Link
                        to={`/documents/${doc.id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            backgroundColor: '#EEF3FB',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <FileText size={17} color="#566275" />
                        </div>

                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: '13.5px' }}>
                            {doc.title}
                          </div>
                          <div className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                            {doc.original_filename} · {doc.page_count || 1}p ·{' '}
                            {new Date(doc.created_at).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <RiskChip
                          riskScore={doc.risk_score}
                          riskLevel={doc.risk_level}
                          scanStatus={doc.scan_status}
                          scanProgress={doc.scan_progress}
                          isSafeCopy={doc.is_safe_copy}
                          isPasswordProtected={doc.is_password_protected}
                          onClick={() => navigate(`/documents/${doc.id}?tab=risk`)}
                        />
                        {doc.findings_count !== undefined && doc.findings_count > 0 && (
                          <span className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                            {doc.findings_count} items
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: '12.5px', color: 'var(--ink2)' }}>
                        {formatBytes(doc.file_size_bytes)}
                      </span>
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{
                          fontSize: '12.5px',
                          fontWeight: 600,
                          color: doc.active_shares_count > 0 ? 'var(--accent)' : 'var(--ink3)',
                        }}
                      >
                        {doc.active_shares_count} active
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <Link
                          to={`/documents/${doc.id}?tab=risk`}
                          className="btn btn-secondary btn-sm"
                          title="Risk analysis & details"
                          data-testid={`risk-analysis-link-${doc.id}`}
                        >
                          <ShieldAlert size={14} /> Risk
                        </Link>

                        <Link
                          to={`/viewer/doc/${doc.id}`}
                          className="btn btn-secondary btn-sm"
                          title="Preview Document in Viewer"
                        >
                          <Eye size={14} /> Preview
                        </Link>

                        {(hasPermission('shares.create_internal') || hasPermission('shares.create_external')) && (
                          <button
                            type="button"
                            onClick={() => setSelectedDocForShare(doc)}
                            className="btn btn-primary btn-sm"
                            title="Share Document"
                            data-testid={`share-doc-btn-${doc.id}`}
                          >
                            <Share2 size={14} /> Share
                          </button>
                        )}

                        {(hasPermission('documents.delete_own') || user?.role === 'Owner') && (
                          <button
                            type="button"
                            onClick={(e) => handleDelete(doc.id, e)}
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--risk-critical-fg)', padding: '6px' }}
                            title="Delete document"
                            data-testid={`delete-doc-btn-${doc.id}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grid View */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '14px',
          }}
        >
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="craft-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '14px',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <RiskChip
                    riskScore={doc.risk_score}
                    riskLevel={doc.risk_level}
                    scanStatus={doc.scan_status}
                    scanProgress={doc.scan_progress}
                    isSafeCopy={doc.is_safe_copy}
                    isPasswordProtected={doc.is_password_protected}
                    size="sm"
                    onClick={() => navigate(`/documents/${doc.id}?tab=risk`)}
                  />
                  <span className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                    {formatBytes(doc.file_size_bytes)}
                  </span>
                </div>

                <Link
                  to={`/documents/${doc.id}?tab=risk`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--ink)', marginBottom: '4px' }}>
                    {doc.title}
                  </div>
                  <div className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                    {doc.original_filename}
                  </div>
                </Link>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--line)',
                }}
              >
                <span className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                  {doc.active_shares_count} active shares
                </span>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <Link to={`/viewer/doc/${doc.id}`} className="btn btn-secondary btn-sm">
                    <Eye size={14} />
                  </Link>
                  {(hasPermission('shares.create_internal') || hasPermission('shares.create_external')) && (
                    <button
                      type="button"
                      onClick={() => setSelectedDocForShare(doc)}
                      className="btn btn-primary btn-sm"
                    >
                      <Share2 size={14} /> Share
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Share Drawer */}
      {selectedDocForShare && (
        <ShareModal
          isOpen={Boolean(selectedDocForShare)}
          documentId={selectedDocForShare.id}
          documentTitle={selectedDocForShare.title}
          riskScore={selectedDocForShare.risk_score}
          riskLevel={selectedDocForShare.risk_level}
          riskVerdict={selectedDocForShare.risk_verdict}
          isSafeCopy={selectedDocForShare.is_safe_copy}
          onClose={() => setSelectedDocForShare(null)}
          onOpenSafeCopyModal={() => {
            const docToRedact = selectedDocForShare;
            setSelectedDocForShare(null);
            setSelectedDocForSafeCopy(docToRedact);
          }}
          onSuccess={() => {
            setSelectedDocForShare(null);
            qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
          }}
        />
      )}

      {/* Safe Copy Modal */}
      {selectedDocForSafeCopy && (
        <SafeCopyModal
          isOpen={Boolean(selectedDocForSafeCopy)}
          documentId={selectedDocForSafeCopy.id}
          documentTitle={selectedDocForSafeCopy.title}
          originalRiskScore={selectedDocForSafeCopy.risk_score ?? 0}
          originalRiskLevel={selectedDocForSafeCopy.risk_level ?? 'LOW'}
          onClose={() => setSelectedDocForSafeCopy(null)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
          }}
        />
      )}
    </div>
  );
};
