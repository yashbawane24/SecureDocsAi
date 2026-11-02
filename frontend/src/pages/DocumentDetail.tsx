import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Share2,
  Eye,
  ArrowLeft,
  Download,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  CheckCircle2,
  FileText,
  FileCheck2,
  Layers,
  Activity,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Lock,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, DocumentFindingItem } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';
import { ShareModal } from '../components/ShareModal';
import { SafeCopyModal } from '../components/SafeCopyModal';
import { RiskChip } from '../components/RiskChip';
import { ShareStatusChip } from '../components/ShareStatusChip';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export const DocumentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const docId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();

  const paramTab = searchParams.get('tab');
  const initialTab =
    paramTab === 'shares' || paramTab === 'overview'
      ? 'shares'
      : paramTab === 'activity'
      ? 'activity'
      : 'risk';
  const [activeTab, setActiveTab] = useState<'risk' | 'shares' | 'activity'>(initialTab);

  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isSafeCopyModalOpen, setIsSafeCopyModalOpen] = useState(false);

  // Preview & Toolbar State
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [highlightedFinding, setHighlightedFinding] = useState<DocumentFindingItem | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isFitWidth, setIsFitWidth] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [containerWidth, setContainerWidth] = useState<number>(560);
  const [showAllContributors, setShowAllContributors] = useState(false);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const previewCardRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const activeRenderTasksRef = useRef<Map<number, any>>(new Map());
  const renderGenerationRef = useRef<number>(0);

  const { data: doc, isLoading, error } = useQuery({
    queryKey: queryKeys.documentDetail(docId),
    queryFn: () => api.getDocumentDetail(docId),
    enabled: Boolean(docId),
  });

  const { data: riskAnalysis } = useQuery({
    queryKey: queryKeys.documentFindings(docId),
    queryFn: () => api.getDocumentFindings(docId),
    enabled: Boolean(docId),
  });

  const rescanMutation = useMutation({
    mutationFn: () => api.rescanDocument(docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documentDetail(docId) });
      qc.invalidateQueries({ queryKey: queryKeys.documentFindings(docId) });
      qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (shareId: number) => api.revokeShare(shareId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documentDetail(docId) });
      qc.invalidateQueries({ queryKey: queryKeys.myShares });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    },
  });

  const [docPassword, setDocPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Track container width for responsive fit-width calculation
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    ro.observe(scrollContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Load PDF with credentials & password handling
  const loadPdfDocument = useCallback(async (pwd?: string) => {
    if (!docId) return;
    try {
      const url = api.getDocPreviewContentUrl(docId);
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Preview load error');
      const buf = await res.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        password: pwd || docPassword || undefined,
      });

      loadingTask.onPassword = (callback, reason) => {
        setRequiresPassword(true);
        if (pwd) {
          callback(pwd);
        }
      };

      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setRequiresPassword(false);
      setPasswordError(null);
    } catch (err: any) {
      if (err.name === 'PasswordException' || err.message?.toLowerCase().includes('password')) {
        setRequiresPassword(true);
        if (pwd) setPasswordError('Incorrect password. Please try again.');
      }
    }
  }, [docId, docPassword]);

  useEffect(() => {
    loadPdfDocument();
  }, [loadPdfDocument]);

  const findings: DocumentFindingItem[] = riskAnalysis?.findings || doc?.findings || [];
  const totalPages = Math.max(1, pdfDoc?.numPages || riskAnalysis?.page_count || doc?.page_count || 1);

  // Render all pages scaled to FIT CARD WIDTH without clipping
  const renderAllPages = useCallback(async () => {
    if (!pdfDoc) return;
    const numPages = pdfDoc.numPages;

    const currentGen = ++renderGenerationRef.current;

    // Cancel any previous in-flight render tasks
    activeRenderTasksRef.current.forEach((task) => {
      try {
        task.cancel();
      } catch {
        // ignore
      }
    });
    activeRenderTasksRef.current.clear();

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (currentGen !== renderGenerationRef.current) break;

      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) continue;

      try {
        const page = await pdfDoc.getPage(pageNum);
        if (currentGen !== renderGenerationRef.current) break;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(260, containerWidth - 48); // 24px padding on each side
        const fitScale = availableWidth / unscaledViewport.width;
        const scale = isFitWidth ? fitScale * zoomLevel : 1.0 * zoomLevel;
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const wrapper = pageContainerRefs.current.get(pageNum);
        if (wrapper) {
          wrapper.style.width = `${viewport.width}px`;
          wrapper.style.height = `${viewport.height}px`;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        // Reset transform to identity and clear canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform: transform || undefined,
        });

        activeRenderTasksRef.current.set(pageNum, renderTask);

        try {
          await renderTask.promise;
        } catch (err: any) {
          if (err?.name === 'RenderingCancelledException' || err?.message?.includes('cancelled')) {
            continue;
          }
          throw err;
        } finally {
          if (activeRenderTasksRef.current.get(pageNum) === renderTask) {
            activeRenderTasksRef.current.delete(pageNum);
          }
        }

        if (currentGen !== renderGenerationRef.current) break;

        // Draw bounding boxes for findings on this page
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        const pageFindings = findings.filter((f) => f.page_number === pageNum);
        for (const f of pageFindings) {
          const isTarget = highlightedFinding?.id === f.id;
          for (const box of f.bboxes || []) {
            const x0 = Array.isArray(box) ? box[0] : box.x0;
            const y0 = Array.isArray(box) ? box[1] : box.y0;
            const x1 = Array.isArray(box) ? box[2] : box.x1;
            const y1 = Array.isArray(box) ? box[3] : box.y1;
            const rx = x0 * scale;
            const ry = y0 * scale;
            const rw = Math.max(16, (x1 - x0) * scale);
            const rh = Math.max(12, (y1 - y0) * scale);

            ctx.save();
            ctx.fillStyle = isTarget ? 'rgba(180, 35, 24, 0.32)' : 'rgba(47, 91, 234, 0.16)';
            ctx.strokeStyle = isTarget ? '#B42318' : '#2F5BEA';
            ctx.lineWidth = isTarget ? 2.5 : 1.25;
            ctx.fillRect(rx - 2, ry - 2, rw + 4, rh + 4);
            ctx.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4);
            ctx.restore();
          }
        }
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } catch {
        // ignore cancellation
      }
    }
  }, [pdfDoc, containerWidth, isFitWidth, zoomLevel, findings, highlightedFinding]);

  useEffect(() => {
    renderAllPages();
  }, [renderAllPages]);

  const scrollToPage = (pageNum: number) => {
    setSelectedPage(pageNum);
    const el = pageContainerRefs.current.get(pageNum);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleShowOnPage = (finding: DocumentFindingItem) => {
    const pageNum = finding.page_number || 1;
    setSelectedPage(pageNum);
    setHighlightedFinding(finding);
    scrollToPage(pageNum);
  };

  const toggleFullscreen = () => {
    if (!previewCardRef.current) return;
    if (!document.fullscreenElement) {
      previewCardRef.current.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const switchTab = (tab: 'risk' | 'shares' | 'activity') => {
    setActiveTab(tab);
    searchParams.set('tab', tab);
    setSearchParams(searchParams, { replace: true });
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div style={{ padding: '64px', textAlign: 'center', color: 'var(--ink2)' }}>
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
        <span style={{ fontSize: '13px' }}>Loading document & risk analysis...</span>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="craft-card" style={{ padding: '36px', textAlign: 'center' }}>
        <AlertTriangle size={32} style={{ color: 'var(--risk-critical-fg)', margin: '0 auto 12px' }} />
        <h2 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--ink)' }}>
          Unable to open document
        </h2>
        <p style={{ fontSize: '13.5px', color: 'var(--ink2)', marginBottom: '20px' }}>
          {(error as any)?.message || 'Document not found'}
        </p>
        <Link to="/documents" className="btn btn-secondary">
          <ArrowLeft size={14} /> Back to documents
        </Link>
      </div>
    );
  }

  const score = riskAnalysis?.risk_score ?? doc.risk_score ?? 0;
  const riskLevel = (riskAnalysis?.risk_level ?? doc.risk_level ?? 'LOW').toUpperCase();
  const verdict = riskAnalysis?.risk_verdict ?? doc.risk_verdict ?? 'Scan completed.';
  const breakdown = riskAnalysis?.risk_breakdown ?? doc.risk_breakdown ?? [];
  const recommendations =
    riskAnalysis?.recommendations ??
    riskAnalysis?.risk_recommendations ??
    doc.recommendations ??
    doc.risk_recommendations ??
    [];
  const categoryCounts =
    riskAnalysis?.category_summary ??
    riskAnalysis?.category_counts ??
    doc.category_summary ??
    doc.category_counts ??
    {};
  const pageHeatmap = riskAnalysis?.page_heatmap ?? doc.page_heatmap ?? {};

  const dialColor =
    riskLevel === 'CRITICAL'
      ? '#B42318'
      : riskLevel === 'HIGH'
      ? '#C2571A'
      : riskLevel === 'MEDIUM'
      ? '#B7791F'
      : '#1F8A5B';

  // Semicircle gauge: draw the coloured arc for at least 3% so Low scores are visible
  const semiArcLength = 157;
  const arcPercent = Math.max(0.03, score / 100);
  const semiDash = Math.min(semiArcLength, arcPercent * semiArcLength);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to="/documents" className="btn btn-secondary btn-sm" style={{ padding: '0 10px' }} title="Back">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
                {doc.title}
              </h1>
              <RiskChip
                riskScore={score}
                riskLevel={riskLevel}
                scanStatus={doc.scan_status}
                isSafeCopy={doc.is_safe_copy}
                isPasswordProtected={doc.is_password_protected}
              />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '3px' }}>
              <span className="mono">{doc.original_filename}</span> · {formatBytes(doc.file_size_bytes)} · {totalPages}{' '}
              {totalPages === 1 ? 'page' : 'pages'} · Uploaded{' '}
              {new Date(doc.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!doc.is_safe_copy && findings.length > 0 && (
            <button
              type="button"
              data-testid="create-safe-copy-btn"
              onClick={() => setIsSafeCopyModalOpen(true)}
              className="btn btn-secondary"
            >
              <ShieldCheck size={16} /> Create safe copy
            </button>
          )}

          <button
            type="button"
            data-testid="rescan-doc-btn"
            disabled={rescanMutation.isPending}
            onClick={() => rescanMutation.mutate()}
            className="btn btn-secondary"
          >
            <RefreshCw size={15} /> {rescanMutation.isPending ? 'Scanning...' : 'Rescan'}
          </button>

          <a
            href={api.getRiskReportUrl(doc.id)}
            download
            data-testid="download-risk-report-btn"
            className="btn btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            <Download size={15} /> Download report
          </a>

          <Link to={`/viewer/doc/${doc.id}`} className="btn btn-secondary">
            <Eye size={15} /> Full viewer
          </Link>

          {(hasPermission('shares.create_internal') || hasPermission('shares.create_external')) && (
            <button
              type="button"
              data-testid="detail-share-btn"
              onClick={() => setIsShareModalOpen(true)}
              className="btn btn-primary"
            >
              <Share2 size={15} /> Share
            </button>
          )}
        </div>
      </div>

      {/* Main Split Layout: Left Preview (55%) + Right Analysis Tabs (45%) */}
      <div className="doc-detail-split">
        {/* Left Column: Preview Card (height: calc(100vh - 140px), sticky at top 20px) */}
        <div
          ref={previewCardRef}
          className="craft-card doc-detail-preview-col"
          data-testid="bbox-preview-card"
        >
          {/* Preview Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              paddingBottom: '10px',
              borderBottom: '1px solid var(--line)',
              flexShrink: 0,
            }}
          >
            {/* Page navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                disabled={selectedPage <= 1}
                onClick={() => scrollToPage(Math.max(1, selectedPage - 1))}
                className="btn btn-secondary btn-sm"
                style={{ width: '30px', height: '30px', padding: 0 }}
                title="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)', minWidth: '60px', textAlign: 'center' }}>
                {selectedPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={selectedPage >= totalPages}
                onClick={() => scrollToPage(Math.min(totalPages, selectedPage + 1))}
                className="btn btn-secondary btn-sm"
                style={{ width: '30px', height: '30px', padding: 0 }}
                title="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Zoom Controls & Fit Width */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={() => {
                  setIsFitWidth(false);
                  setZoomLevel((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
                }}
                className="btn btn-secondary btn-sm"
                style={{ width: '30px', height: '30px', padding: 0 }}
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="mono" style={{ fontSize: '11.5px', fontWeight: 600, minWidth: '40px', textAlign: 'center' }}>
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsFitWidth(false);
                  setZoomLevel((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))));
                }}
                className="btn btn-secondary btn-sm"
                style={{ width: '30px', height: '30px', padding: 0 }}
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsFitWidth(true);
                  setZoomLevel(1.0);
                }}
                className={`btn btn-sm ${isFitWidth ? 'btn-primary' : 'btn-secondary'}`}
                style={{ height: '30px', fontSize: '11.5px', padding: '0 10px' }}
              >
                Fit width
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="btn btn-secondary btn-sm"
                style={{ width: '30px', height: '30px', padding: 0 }}
                title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>

          {/* Slim row of page thumbnails / sensitivity heatmap under the toolbar */}
          <div
            data-testid="page-heatmap-card"
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              padding: '8px 0',
              borderBottom: '1px solid var(--line)',
              flexShrink: 0,
            }}
          >
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => {
              const count = Number(pageHeatmap[String(pg)] || 0);
              const isSelected = selectedPage === pg;
              const dotColor =
                count >= 5 ? '#B42318' : count >= 2 ? '#C2571A' : count === 1 ? '#B7791F' : 'var(--ink3)';
              return (
                <button
                  key={pg}
                  type="button"
                  data-testid={`heatmap-page-${pg}`}
                  onClick={() => scrollToPage(pg)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 8px',
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                    backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    transition: 'all 120ms ease-out',
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: dotColor,
                    }}
                  />
                  <span>Page {pg}</span>
                  {count > 0 && (
                    <span style={{ fontSize: '10.5px', color: dotColor, fontWeight: 700 }}>
                      ({count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* All pages stacked vertically in a scrollable area inside the card with light grey background */}
          <div
            ref={scrollContainerRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              backgroundColor: '#F1F1F0',
              borderRadius: '12px',
              padding: '24px',
              marginTop: '10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '16px',
            }}
          >
            {requiresPassword ? (
              <div
                style={{
                  margin: 'auto',
                  padding: '32px 24px',
                  textAlign: 'center',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '14px',
                  border: '1px solid var(--line)',
                  maxWidth: '380px',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--panel)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 14px',
                  }}
                >
                  <Lock size={22} color="var(--accent)" />
                </div>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>Password Protected</h4>
                <p style={{ fontSize: '13px', color: 'var(--ink2)', marginTop: '4px', marginBottom: '16px' }}>
                  This document is password-encrypted. Enter the password to unlock the preview.
                </p>
                {passwordError && (
                  <div style={{ color: '#B42318', fontSize: '12.5px', marginBottom: '12px', fontWeight: 600 }}>
                    {passwordError}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!docPassword.trim()) return;
                    setIsUnlocking(true);
                    loadPdfDocument(docPassword.trim()).finally(() => setIsUnlocking(false));
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                >
                  <input
                    type="password"
                    data-testid="doc-preview-password-input"
                    className="form-input mono"
                    placeholder="Enter password (e.g. SD-...)"
                    value={docPassword}
                    onChange={(e) => setDocPassword(e.target.value)}
                    required
                  />
                  <button
                    type="submit"
                    disabled={isUnlocking}
                    data-testid="doc-preview-unlock-btn"
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                  >
                    {isUnlocking ? 'Unlocking...' : 'Unlock document'}
                  </button>
                </form>
              </div>
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                <div
                  key={pg}
                  id={`pdf-page-${pg}`}
                  ref={(el) => {
                    if (el) pageContainerRefs.current.set(pg, el);
                    else pageContainerRefs.current.delete(pg);
                  }}
                  style={{
                    position: 'relative',
                    margin: '0 auto 16px',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '4px',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <canvas
                    ref={(el) => {
                      if (el) canvasRefs.current.set(pg, el);
                      else canvasRefs.current.delete(pg);
                    }}
                    data-testid={pg === 1 ? 'highlight-preview-canvas' : undefined}
                    style={{ display: 'block' }}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Tabs ("Risk analysis", "Shares", "Activity") */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {/* Tab Switcher */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: '12px',
              padding: '3px',
              gap: '4px',
              alignSelf: 'flex-start',
            }}
          >
            <button
              type="button"
              data-testid="tab-risk-analysis"
              onClick={() => switchTab('risk')}
              style={{
                padding: '8px 16px',
                borderRadius: '9px',
                border: 'none',
                backgroundColor: activeTab === 'risk' ? '#2A2B2F' : 'transparent',
                color: activeTab === 'risk' ? '#FFFFFF' : 'var(--ink2)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Risk analysis
            </button>
            <button
              type="button"
              data-testid="tab-shares"
              onClick={() => switchTab('shares')}
              style={{
                padding: '8px 16px',
                borderRadius: '9px',
                border: 'none',
                backgroundColor: activeTab === 'shares' ? '#2A2B2F' : 'transparent',
                color: activeTab === 'shares' ? '#FFFFFF' : 'var(--ink2)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Shares ({(doc.shares || []).length})
            </button>
            <button
              type="button"
              data-testid="tab-activity"
              onClick={() => switchTab('activity')}
              style={{
                padding: '8px 16px',
                borderRadius: '9px',
                border: 'none',
                backgroundColor: activeTab === 'activity' ? '#2A2B2F' : 'transparent',
                color: activeTab === 'activity' ? '#FFFFFF' : 'var(--ink2)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Activity
            </button>
          </div>

          {activeTab === 'risk' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} data-testid="risk-analysis-panel">
              {/* 1. Score Card: gauge (coloured arc >= 3%), verdict, and 3 stats in one row */}
              <div className="craft-card" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                  <div style={{ width: '140px', textAlign: 'center', flexShrink: 0 }}>
                    <svg viewBox="0 0 120 70" style={{ width: '136px', height: '80px', overflow: 'visible' }}>
                      <path
                        d="M 10 60 A 50 50 0 0 1 110 60"
                        fill="none"
                        stroke="var(--line)"
                        strokeWidth="10"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 10 60 A 50 50 0 0 1 110 60"
                        fill="none"
                        stroke={dialColor}
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${semiDash} ${semiArcLength}`}
                      />
                    </svg>
                    <div style={{ marginTop: '-34px' }}>
                      <div
                        data-testid="risk-score-number"
                        style={{
                          fontSize: '34px',
                          fontWeight: 700,
                          letterSpacing: '-0.04em',
                          color: 'var(--ink)',
                          lineHeight: 1,
                        }}
                      >
                        {score}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          color: dialColor,
                          marginTop: '3px',
                        }}
                      >
                        {riskLevel}
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <div
                      data-testid="risk-verdict-text"
                      style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.4, marginBottom: '6px' }}
                    >
                      {verdict}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--ink2)' }}>
                      Scanned in memory · Raw sensitive values are never stored in the database.
                    </div>
                  </div>
                </div>

                {/* 3 small stats inside the same card in one row (Plus Jakarta Sans bold, not mono) */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '12px',
                    borderTop: '1px solid var(--line)',
                    paddingTop: '16px',
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>
                      {findings.length}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '2px' }}>Findings</div>
                  </div>
                  <div
                    style={{
                      textAlign: 'center',
                      borderLeft: '1px solid var(--line)',
                      borderRight: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>
                      {Object.keys(pageHeatmap).length}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '2px' }}>Pages affected</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>
                      {Object.values(categoryCounts).filter((c) => c > 0).length}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '2px' }}>Categories</div>
                  </div>
                </div>
              </div>

              {/* 2. "Why this score": labels wrap (grid: label 1fr, bar 140px, points 56px) */}
              <div className="craft-card" data-testid="why-this-score-card">
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)' }}>Why this score</h3>
                  <p style={{ fontSize: '12.5px', color: 'var(--ink2)', marginTop: '2px' }}>
                    Additive point breakdown from entity detectors and document structure.
                  </p>
                </div>

                {breakdown.length === 0 ? (
                  <div style={{ fontSize: '13px', color: 'var(--ink2)', padding: '8px 0' }}>
                    No high-risk contributors detected (+0 points).
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(showAllContributors ? breakdown : breakdown.slice(0, 6)).map((item, idx) => {
                      const barPct = Math.min(100, Math.max(8, (item.points / 50) * 100));
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 140px 56px',
                            alignItems: 'center',
                            gap: '12px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: 600,
                              color: 'var(--ink)',
                              lineHeight: 1.4,
                              wordBreak: 'break-word',
                            }}
                          >
                            {item.label || item.factor}
                          </span>
                          <div
                            style={{
                              width: '140px',
                              height: '6px',
                              backgroundColor: 'var(--panel)',
                              borderRadius: '999px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${barPct}%`,
                                height: '100%',
                                backgroundColor: dialColor,
                                borderRadius: '999px',
                              }}
                            />
                          </div>
                          <span
                            className="mono"
                            style={{
                              fontSize: '12.5px',
                              fontWeight: 700,
                              color: dialColor,
                              textAlign: 'right',
                            }}
                          >
                            +{item.points}
                          </span>
                        </div>
                      );
                    })}

                    {breakdown.length > 6 && (
                      <button
                        type="button"
                        onClick={() => setShowAllContributors(!showAllContributors)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent)',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                          padding: '6px 0 0',
                          alignSelf: 'flex-start',
                        }}
                      >
                        {showAllContributors ? 'Show less' : `Show all (${breakdown.length})`}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Categories: 3×2 grid of light tiles without heavy borders. Count in Plus Jakarta Sans 22px bold. Tiles with 0 muted (opacity .55) */}
              <div className="craft-card" data-testid="category-summary-grid">
                <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px' }}>
                  Categories
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  {[
                    { name: 'Identity', color: '#2F5BEA' },
                    { name: 'Financial', color: '#B7791F' },
                    { name: 'Health', color: '#C2571A' },
                    { name: 'Credentials', color: '#B42318' },
                    { name: 'Contact', color: '#1F8A5B' },
                    { name: 'Legal/HR', color: '#6E7076' },
                  ].map((cat) => {
                    const count = categoryCounts[cat.name] || 0;
                    const isMuted = count === 0;
                    return (
                      <div
                        key={cat.name}
                        style={{
                          padding: '14px 16px',
                          borderRadius: '12px',
                          backgroundColor: 'var(--panel)',
                          border: '1px solid var(--line)',
                          opacity: isMuted ? 0.55 : 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: cat.color,
                            }}
                          />
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                            {cat.name}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '22px',
                            fontWeight: 700,
                            color: 'var(--ink)',
                            lineHeight: 1.2,
                          }}
                        >
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. Recommendations: plain list, 12px gap */}
              <div className="craft-card" data-testid="recommendations-card">
                <h3 style={{ fontSize: '15.5px', fontWeight: 700, marginBottom: '14px', color: 'var(--ink)' }}>
                  Recommendations
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(recommendations.length > 0
                    ? recommendations
                    : ['Safe to share under standard organisation policy.']
                  ).map((rec, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        fontSize: '13.5px',
                        color: 'var(--ink)',
                        lineHeight: 1.5,
                      }}
                    >
                      <CheckCircle2 size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5. Detected Sensitive Items Table with "Create safe copy" button in header */}
              <div className="craft-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)' }}>
                      Detected sensitive items ({findings.length})
                    </h3>
                    <div style={{ fontSize: '12.5px', color: 'var(--ink2)', marginTop: '2px' }}>
                      Only masked values and salted SHA-256 fingerprints are stored
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSafeCopyModalOpen(true)}
                    className="btn btn-primary btn-sm"
                  >
                    <FileCheck2 size={14} />
                    <span>Create safe copy</span>
                  </button>
                </div>

                {findings.length === 0 ? (
                  <div style={{ padding: '28px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13px' }}>
                    No sensitive entities detected in this document.
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table className="craft-table" data-testid="findings-table">
                      <thead>
                        <tr>
                          <th>TYPE</th>
                          <th>MASKED VALUE</th>
                          <th>PAGE</th>
                          <th>CONFIDENCE</th>
                          <th style={{ textAlign: 'right' }}>LOCATE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {findings.map((f) => {
                          const isActive = highlightedFinding?.id === f.id;
                          return (
                            <tr
                              key={f.id}
                              data-testid={`finding-row-${f.id}`}
                              style={{ backgroundColor: isActive ? 'var(--ice)' : undefined }}
                            >
                              <td>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>
                                  {f.entity_type}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--ink2)' }}>{f.category}</div>
                              </td>
                              <td>
                                <code
                                  data-testid={`finding-masked-${f.id}`}
                                  className="mono"
                                  style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    padding: '2px 7px',
                                    borderRadius: '6px',
                                    backgroundColor: 'var(--panel)',
                                    border: '1px solid var(--line)',
                                  }}
                                >
                                  {f.masked_value}
                                </code>
                              </td>
                              <td className="mono" style={{ fontSize: '12px', color: 'var(--ink2)' }}>
                                p.{f.page_number}
                              </td>
                              <td className="mono" style={{ fontSize: '12px', fontWeight: 600, color: dialColor }}>
                                {Math.round((f.confidence || 0.85) * 100)}%
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  type="button"
                                  data-testid={`show-on-page-${f.id}`}
                                  onClick={() => handleShowOnPage(f)}
                                  className="btn btn-secondary btn-sm"
                                  style={{ fontSize: '11.5px', height: '28px' }}
                                >
                                  <MapPin size={12} /> Show on page
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Safe Copies Lineage */}
              {doc.safe_copies && doc.safe_copies.length > 0 && (
                <div className="craft-card">
                  <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '10px', color: 'var(--ink)' }}>
                    Redacted safe copies ({doc.safe_copies.length})
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {doc.safe_copies.map((sc) => (
                      <div
                        key={sc.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          backgroundColor: 'var(--panel)',
                          borderRadius: '12px',
                          border: '1px solid var(--line)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <Layers size={16} color="var(--accent)" />
                          <div>
                            <Link
                              to={`/documents/${sc.id}`}
                              style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--ink)', textDecoration: 'none' }}
                            >
                              {sc.title}
                            </Link>
                            <div className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                              Created {new Date(sc.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <RiskChip
                          riskScore={sc.risk_score}
                          riskLevel={sc.risk_level}
                          isSafeCopy={true}
                          isPasswordProtected={sc.is_password_protected}
                          onClick={() => navigate(`/documents/${sc.id}`)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'shares' && (
            <div className="craft-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)' }}>
                    Shares ({(doc.shares || []).length})
                  </h3>
                  <div style={{ fontSize: '12.5px', color: 'var(--ink2)' }}>
                    Active and historical shares for this document
                  </div>
                </div>
                <button type="button" onClick={() => setIsShareModalOpen(true)} className="btn btn-primary btn-sm">
                  <Share2 size={14} /> Share
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {!doc.shares || doc.shares.length === 0 ? (
                  <div style={{ padding: '28px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13.5px' }}>
                    No shares created yet for this document.
                  </div>
                ) : (
                  doc.shares.map((share) => (
                    <div
                      key={share.id}
                      style={{
                        padding: '12px 14px',
                        backgroundColor: 'var(--panel)',
                        borderRadius: '14px',
                        border: '1px solid var(--line)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink)' }}>
                          {share.share_type === 'INTERNAL'
                            ? share.recipient_name || share.recipient_email
                            : share.recipient_email || 'External OTP Link'}
                        </div>
                        <div className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)', marginTop: '2px' }}>
                          {share.access_mode === 'ALLOW_DOWNLOAD' ? 'Download ok' : 'View-only'} ·{' '}
                          {share.is_view_once
                            ? 'View once'
                            : share.time_limit_seconds
                            ? `${Math.round(share.time_limit_seconds / 60)}m limit`
                            : 'Watermarked'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShareStatusChip
                          status={share.status}
                          isRevoked={share.is_revoked || share.status === 'REVOKED'}
                          isUsed={share.is_used || share.status === 'USED'}
                          viewsUsed={share.views_used}
                          firstOpenedAt={share.first_opened_at}
                          expiresAt={share.expires_at}
                        />
                        {share.status === 'ACTIVE' && hasPermission('shares.revoke_any_in_scope') && (
                          <button
                            type="button"
                            onClick={() => revokeMutation.mutate(share.id)}
                            className="btn btn-danger btn-sm"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="craft-card">
              <h3 style={{ fontSize: '15.5px', fontWeight: 700, marginBottom: '14px', color: 'var(--ink)' }}>
                Document activity
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {!doc.recent_activity || doc.recent_activity.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13px' }}>
                    No access events logged yet.
                  </div>
                ) : (
                  doc.recent_activity.map((event) => (
                    <div
                      key={event.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--line)',
                        fontSize: '13px',
                      }}
                    >
                      <div>
                        <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {event.actor_email || 'System'}
                        </span>
                        <span style={{ color: 'var(--accent)', fontWeight: 700, marginLeft: '8px', fontSize: '12px' }}>
                          {event.action}
                        </span>
                        <div style={{ fontSize: '12px', color: 'var(--ink2)', marginTop: '2px' }}>
                          {event.details || event.result}
                        </div>
                      </div>
                      <span className="mono" style={{ fontSize: '11.5px', color: 'var(--ink3)' }}>
                        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Share Drawer */}
      {isShareModalOpen && (
        <ShareModal
          isOpen={isShareModalOpen}
          documentId={doc.id}
          documentTitle={doc.title}
          riskScore={score}
          riskLevel={riskLevel}
          riskVerdict={verdict}
          isSafeCopy={doc.is_safe_copy}
          onClose={() => setIsShareModalOpen(false)}
          onOpenSafeCopyModal={() => {
            setIsShareModalOpen(false);
            setIsSafeCopyModalOpen(true);
          }}
          onSuccess={() => {
            setIsShareModalOpen(false);
            qc.invalidateQueries({ queryKey: queryKeys.documentDetail(docId) });
          }}
        />
      )}

      {/* Safe Copy Modal */}
      {isSafeCopyModalOpen && (
        <SafeCopyModal
          isOpen={isSafeCopyModalOpen}
          documentId={doc.id}
          documentTitle={doc.title}
          originalRiskScore={score}
          originalRiskLevel={riskLevel}
          onClose={() => setIsSafeCopyModalOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: queryKeys.documentDetail(docId) });
            qc.invalidateQueries({ queryKey: queryKeys.documentAnalysis(docId) });
            qc.invalidateQueries({ queryKey: queryKeys.documentsAll });
          }}
        />
      )}

      <style>{`
        .doc-detail-split {
          display: grid;
          grid-template-columns: minmax(440px, 55%) minmax(0, 45%);
          gap: 20px;
          align-items: start;
        }
        .doc-detail-preview-col {
          position: sticky;
          top: 20px;
          height: calc(100vh - 140px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 16px;
        }
        @media (max-width: 1200px) {
          .doc-detail-split {
            grid-template-columns: 1fr;
          }
          .doc-detail-preview-col {
            position: static;
            height: auto;
          }
        }
      `}</style>
    </div>
  );
};
