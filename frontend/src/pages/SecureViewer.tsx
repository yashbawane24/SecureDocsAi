import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  Shield,
  ShieldAlert,
  Clock,
  Download,
  AlertTriangle,
  KeyRound,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  Info,
  X,
  Lock,
  Eye,
  EyeOff,
  FileText,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { api, ViewerSession, DocumentFindingItem } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Configure pdfjs worker using local bundled asset URL (safe with strict CSP and offline)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function maskEmailAddress(email: string): string {
  const trimmed = (email || '').trim();
  if (!trimmed.includes('@')) return trimmed;
  const [local, domain] = trimmed.split('@');
  if (!local) return trimmed;
  return `${local[0]}***@${domain}`;
}

export const SecureViewer: React.FC = () => {
  const { user: loggedInUser } = useAuth();
  const { shareId, documentId, token } = useParams<{
    shareId?: string;
    documentId?: string;
    token?: string;
  }>();
  const [searchParams] = useSearchParams();

  const [session, setSession] = useState<ViewerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Countdown timer state
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [hasExpiredLive, setHasExpiredLive] = useState(false);

  // OTP flow state for external links (A3)
  const [otpEmail, setOtpEmail] = useState('');
  const [maskedOtpEmail, setMaskedOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // PDF rendering state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [scale, setScale] = useState<number>(1.2);
  const [renderingPage, setRenderingPage] = useState<boolean>(false);

  // Panels state
  const [showLeftThumbnails, setShowLeftThumbnails] = useState(true);
  const [showRightDetails, setShowRightDetails] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // A6: Strict Viewing & Screenshot Deterrence state
  const [isShieldBlanked, setIsShieldBlanked] = useState(false);
  const [shieldTriggerReason, setShieldTriggerReason] = useState<string | null>(null);
  const [isHoldingToView, setIsHoldingToView] = useState(false);
  const [pressAndHoldEnabled, setPressAndHoldEnabled] = useState(false);

  // B6: Selective click-to-reveal for safe copies
  const [parentFindings, setParentFindings] = useState<DocumentFindingItem[]>([]);
  const [revealedValues, setRevealedValues] = useState<Record<number, { value: string; expiresAt: number }>>({});
  const [revealingId, setRevealingId] = useState<number | null>(null);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const lastReportedTriggerRef = useRef<number>(0);

  // Protected safe copy / document password state
  const [docPassword, setDocPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordAttempts, setPasswordAttempts] = useState(0);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [isFitWidth, setIsFitWidth] = useState<boolean>(false);

  // View session and View-Once confirmation state (in-memory only)
  const [viewOnceConfirmed, setViewOnceConfirmed] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionCreatingRef = useRef(false);

  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageWrappersRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeRenderTasksRef = useRef<Map<number, any>>(new Map());
  const renderGenerationRef = useRef<number>(0);

  const isInternal = Boolean(shareId);
  const isDocPreview = Boolean(documentId);
  const isExternalLink = Boolean(token);

  const isStrictMode = Boolean(
    session?.strict_viewing ||
      session?.is_view_once ||
      session?.risk_level === 'HIGH' ||
      session?.risk_level === 'CRITICAL'
  );

  const getContentUrl = useCallback((): string => {
    if (isInternal && shareId) {
      return sessionId ? api.getInternalContentUrl(shareId, sessionId) : '';
    }
    if (isDocPreview && documentId) return api.getDocPreviewContentUrl(documentId);
    if (isExternalLink && token) {
      return sessionId ? api.getLinkContentUrl(token, sessionId) : '';
    }
    return '';
  }, [isInternal, isDocPreview, isExternalLink, shareId, documentId, token, sessionId]);

  const getDownloadUrl = useCallback((): string => {
    if (isInternal && shareId) return api.getInternalDownloadUrl(shareId);
    if (isExternalLink && token) return api.getLinkDownloadUrl(token);
    return '';
  }, [isInternal, isExternalLink, shareId, token]);

  // 1. Fetch View Status (Fixed A3: do NOT include otpEmail in dependencies!)
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      let data: ViewerSession;
      if (isInternal && shareId) {
        data = await api.getInternalViewStatus(shareId);
      } else if (isDocPreview && documentId) {
        data = await api.getDocPreviewStatus(documentId);
      } else if (isExternalLink && token) {
        data = await api.getLinkViewStatus(token);
      } else {
        throw new Error('No valid document link provided.');
      }

      setSession(data);
      if (data.seconds_remaining !== null && data.seconds_remaining !== undefined) {
        setSecondsRemaining(data.seconds_remaining);
        if (data.seconds_remaining <= 0) {
          setHasExpiredLive(true);
        }
      }
      if (data.viewer_email) {
        setOtpEmail((prev) => prev || data.viewer_email || '');
      }
      if (
        data.strict_viewing ||
        data.is_view_once ||
        data.risk_level === 'HIGH' ||
        data.risk_level === 'CRITICAL'
      ) {
        setPressAndHoldEnabled(true);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Unable to load this document.');
    } finally {
      setLoading(false);
    }
  }, [isInternal, isDocPreview, isExternalLink, shareId, documentId, token]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Initial page from query param (?page=2)
  useEffect(() => {
    const p = Number(searchParams.get('page'));
    if (p && p >= 1) {
      setCurrentPage(p);
      setPageInput(String(p));
    }
  }, [searchParams]);

  // Resend OTP 60s countdown (A3)
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Load parent findings if viewing a safe copy with reveal permission (B6)
  useEffect(() => {
    if (
      session?.status === 'VALID' &&
      session.is_safe_copy &&
      session.parent_document_id &&
      session.can_reveal_sensitive
    ) {
      api
        .getDocumentFindings(session.parent_document_id)
        .then((res) => setParentFindings(res.findings || []))
        .catch(() => {});
    }
  }, [session?.status, session?.is_safe_copy, session?.parent_document_id, session?.can_reveal_sensitive]);

  // Report suspected screenshot / capture attempt to backend (A6)
  const triggerCaptureShield = useCallback(
    (triggerType: string) => {
      if (session?.status !== 'VALID') return;
      setIsShieldBlanked(true);
      setIsHoldingToView(false);
      setShieldTriggerReason(triggerType);

      const now = Date.now();
      if (now - lastReportedTriggerRef.current > 1500) {
        lastReportedTriggerRef.current = now;
        api
          .reportSecurityEvent({
            share_id: session.share_id ?? (shareId ? Number(shareId) : undefined),
            document_id: session.document_id ?? (documentId ? Number(documentId) : undefined),
            token: token,
            event_type: 'SCREENSHOT_ATTEMPT_SUSPECTED',
            trigger_type: triggerType,
            details: `Viewer shield triggered by ${triggerType}`,
          })
          .catch(() => {});
      }
    },
    [session, shareId, documentId, token]
  );

  // 2. A6: Screenshot Deterrence & Keyboard/Focus Listeners
  useEffect(() => {
    if (session?.status !== 'VALID') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block Ctrl/Cmd + P (Print) and Ctrl/Cmd + S (Save)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        triggerCaptureShield('print_or_save_shortcut');
        return;
      }

      // Detect macOS Cmd+Shift+3 / 4 / 5 and Windows/Linux Ctrl+Shift+3/4/5 or Win+Shift+S
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === '3' || e.key === '4' || e.key === '5' || e.key === 's' || e.key === 'S' || e.code === 'Digit3' || e.code === 'Digit4' || e.code === 'Digit5')
      ) {
        e.preventDefault();
        triggerCaptureShield(`screenshot_hotkey_${e.key}`);
        return;
      }

      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        e.preventDefault();
        triggerCaptureShield('print_screen_keydown');
        return;
      }

      // Standard page navigation shortcuts
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentPage((prev) => Math.min(prev + 1, numPages || prev));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentPage((prev) => Math.max(prev - 1, 1));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setScale((prev) => Math.min(prev + 0.15, 3.0));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setScale((prev) => Math.max(prev - 0.15, 0.5));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('').catch(() => {});
        }
        triggerCaptureShield('print_screen_keyup');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleWindowBlur = () => {
      if (isStrictMode) {
        triggerCaptureShield('window_blur');
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isStrictMode) {
        triggerCaptureShield('visibility_hidden');
      }
    };

    const handleMouseLeave = () => {
      if (isStrictMode) {
        triggerCaptureShield('mouse_leave_window');
      }
    };

    // DevTools size-difference detector
    const handleResizeCheck = () => {
      if (!isStrictMode) return;
      const widthDiff = window.outerWidth - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      if (widthDiff > 240 || heightDiff > 240) {
        triggerCaptureShield('devtools_open_suspected');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', handleResizeCheck);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResizeCheck);
    };
  }, [numPages, session?.status, isStrictMode, triggerCaptureShield]);

  // 3. Live Server-Synchronized Countdown Timer
  useEffect(() => {
    if (session?.status !== 'VALID') return;
    if (secondsRemaining === null || secondsRemaining === undefined) return;
    if (secondsRemaining <= 0) {
      setHasExpiredLive(true);
      return;
    }

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          setHasExpiredLive(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsRemaining, session?.status]);

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

  // 4. Session establishment (atomic view consumption in-memory)
  const createSession = useCallback(async () => {
    if (sessionCreatingRef.current) return;
    sessionCreatingRef.current = true;
    try {
      let res: { session_id: string; expires_at: string; seconds_remaining: number };
      if (isInternal && shareId) {
        res = await api.createInternalViewSession(shareId);
      } else if (isExternalLink && token) {
        res = await api.createLinkViewSession(token);
      } else {
        return;
      }
      setSessionId(res.session_id);
      if (res.seconds_remaining !== undefined && res.seconds_remaining !== null) {
        setSecondsRemaining(res.seconds_remaining);
      }
    } catch (err: any) {
      if (
        err?.status === 410 ||
        err?.message?.includes('already been viewed') ||
        err?.message?.includes('410') ||
        err?.message?.includes('Access limit reached')
      ) {
        setSession((prev) => (prev ? { ...prev, status: 'ALREADY_USED', is_view_once: true } : prev));
      } else {
        console.error('Session establishment warning:', err);
        setError(err.message || 'Unable to establish view session.');
      }
    }
  }, [isInternal, isExternalLink, shareId, token]);

  // Automatically start session for regular shares; view-once awaits user confirmation
  useEffect(() => {
    if (session?.status === 'VALID' && !sessionId && !sessionCreatingRef.current) {
      if (!session.is_view_once || viewOnceConfirmed) {
        createSession();
      }
    }
  }, [session?.status, session?.is_view_once, viewOnceConfirmed, sessionId, createSession]);

  // 5. Load PDF Document via pdf.js with password handling & session id
  const loadPDF = useCallback(async (pwd?: string) => {
    if (!session || session.status !== 'VALID' || hasExpiredLive) return;
    if ((isInternal || isExternalLink) && !sessionId) return;
    try {
      const url = getContentUrl();
      if (!url) return;

      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 410) {
          setSession((prev) => (prev ? { ...prev, status: 'ALREADY_USED', is_view_once: true } : prev));
          setHasExpiredLive(true);
          return;
        }
        throw new Error(`Failed to load document: HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        password: pwd || docPassword || undefined,
      });

      loadingTask.onPassword = (callback, reason) => {
        setRequiresPassword(true);
        if (reason === 1 /* NEED_PASSWORD */) {
          if (pwd) callback(pwd);
        } else if (reason === 2 /* INCORRECT_PASSWORD */) {
          setPasswordAttempts((prev) => {
            const next = prev + 1;
            if (next >= 5) {
              setPasswordError('Maximum 5 attempts reached. Please reload.');
            } else {
              setPasswordError(`Wrong password, try again (${5 - next} attempts remaining)`);
            }
            return next;
          });
        }
      };

      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setRequiresPassword(false);
      setPasswordError(null);
    } catch (err: any) {
      if (err.name === 'PasswordException' || err.message?.toLowerCase().includes('password')) {
        setRequiresPassword(true);
        if (pwd) {
          setPasswordAttempts((prev) => {
            const next = prev + 1;
            if (next >= 5) {
              setPasswordError('Maximum 5 attempts reached. Please reload.');
            } else {
              setPasswordError(`Wrong password, try again (${5 - next} attempts remaining)`);
            }
            return next;
          });
        }
      } else {
        setError(err.message || 'Error loading document.');
      }
    }
  }, [session, hasExpiredLive, getContentUrl, docPassword, isInternal, isExternalLink, sessionId]);

  useEffect(() => {
    loadPDF();
  }, [loadPDF]);

  // 5. High-DPI Canvas Rendering of ALL pages with Tiled Watermark
  const renderAllPages = useCallback(async () => {
    if (!pdfDoc) return;
    const num = pdfDoc.numPages;

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

    setRenderingPage(true);
    try {
      for (let pageNum = 1; pageNum <= num; pageNum++) {
        if (currentGen !== renderGenerationRef.current) break;

        const canvas = canvasRefs.current.get(pageNum);
        if (!canvas) continue;

        const page = await pdfDoc.getPage(pageNum);
        if (currentGen !== renderGenerationRef.current) break;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(300, containerWidth - 48); // 24px padding on each side
        const fitScale = availableWidth / unscaledViewport.width;
        const effectiveScale = isFitWidth ? fitScale : scale;
        const viewport = page.getViewport({ scale: effectiveScale });
        const pixelRatio = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const wrapper = pageWrappersRef.current.get(pageNum);
        if (wrapper) {
          wrapper.style.width = `${viewport.width}px`;
          wrapper.style.height = `${viewport.height}px`;
        }

        const context = canvas.getContext('2d');
        if (!context) continue;

        // Reset transform to identity and clear canvas
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        const transform = pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null;
        const renderTask = page.render({
          canvasContext: context,
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

        // Dynamic Watermark Overlay (A6: heavier diagonal watermark for strict viewing)
        const watermarkName = session?.viewer_name || session?.viewer_email || 'RECIPIENT';
        const watermarkEmail = session?.viewer_email || '';
        const viewerIp = session?.viewer_ip || '127.0.0.1';
        const shareRef = session?.share_id ? `SHARE#${session.share_id}` : session?.tracking_hash?.slice(0, 10) || 'PREVIEW';
        const timestampIso = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(pixelRatio, pixelRatio);
        context.rotate((-28 * Math.PI) / 180);
        context.font = isStrictMode
          ? '700 12px "IBM Plex Mono", monospace'
          : '600 11px "IBM Plex Mono", monospace';
        context.fillStyle = isStrictMode
          ? 'rgba(180, 35, 24, 0.24)'
          : 'rgba(180, 35, 24, 0.14)';
        context.textAlign = 'center';

        const line1 = `${watermarkName.toUpperCase()} • ${watermarkEmail}`;
        const line2 = `IP ${viewerIp} • ${timestampIso} • ${shareRef}`;

        const stepX = isStrictMode ? 220 : 270;
        const stepY = isStrictMode ? 125 : 165;
        const diag = Math.sqrt(viewport.width * viewport.width + viewport.height * viewport.height);

        for (let x = -diag; x < diag * 1.5; x += stepX) {
          for (let y = -diag; y < diag * 1.5; y += stepY) {
            context.fillText(line1, x, y);
            context.fillText(line2, x, y + 15);
          }
        }
        context.restore();
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
    } catch (e) {
      console.error('Canvas render error:', e);
    } finally {
      if (currentGen === renderGenerationRef.current) {
        setRenderingPage(false);
      }
    }
  }, [pdfDoc, scale, isFitWidth, containerWidth, session, isStrictMode]);

  const activePageOnZoomRef = useRef(currentPage);
  useEffect(() => {
    activePageOnZoomRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    renderAllPages().then(() => {
      const p = activePageOnZoomRef.current;
      if (p > 1) {
        pageWrappersRef.current.get(p)?.scrollIntoView({ block: 'start' });
      }
    });
  }, [renderAllPages]);

  const scrollToPage = (pageNum: number) => {
    if (pageNum < 1 || pageNum > (numPages || 1)) return;
    setCurrentPage(pageNum);
    setPageInput(String(pageNum));
    const el = pageWrappersRef.current.get(pageNum);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const toggleFullscreen = () => {
    if (!viewerContainerRef.current) return;
    if (!document.fullscreenElement) {
      viewerContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // OTP handlers for External links (A3)
  const sendOtpCode = async (emailToUse: string) => {
    if (!token || !emailToUse.trim()) return;
    setSubmittingOtp(true);
    setOtpError(null);
    try {
      const turnstileToken = 'dev-token-always-pass';
      const res = await api.requestLinkOtp(token, emailToUse.trim(), turnstileToken);
      if (res.success) {
        setMaskedOtpEmail(res.masked_email || maskEmailAddress(emailToUse));
        setOtpStep('verify');
        setResendCooldown(res.resend_cooldown_seconds || 60);
      } else {
        setOtpError(res.message || 'Could not send verification code.');
      }
    } catch (err: any) {
      setOtpError(err.message || 'Could not send verification code.');
    } finally {
      setSubmittingOtp(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendOtpCode(otpEmail);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !otpEmail.trim() || !otpCode.trim()) return;

    setSubmittingOtp(true);
    setOtpError(null);
    try {
      await api.verifyLinkOtp(token, otpEmail.trim(), otpCode.trim());
      await fetchStatus();
    } catch (err: any) {
      setOtpError(err.message || 'Verification failed. Please check the 6-digit code.');
    } finally {
      setSubmittingOtp(false);
    }
  };

  // B6: Handle 10-second click-to-reveal on redacted items
  const handleRevealFinding = async (findingId: number) => {
    if (!session?.parent_document_id) return;
    setRevealingId(findingId);
    try {
      const res = await api.revealSensitiveFinding(session.parent_document_id, findingId);
      const expiresAt = Date.now() + (res.expires_in_seconds || 10) * 1000;
      setRevealedValues((prev) => ({
        ...prev,
        [findingId]: { value: res.raw_value, expiresAt },
      }));
      setTimeout(() => {
        setRevealedValues((prev) => {
          const copy = { ...prev };
          delete copy[findingId];
          return copy;
        });
      }, (res.expires_in_seconds || 10) * 1000);
    } catch (err: any) {
      alert(err.message || 'Unable to reveal sensitive value.');
    } finally {
      setRevealingId(null);
    }
  };

  const formatCountdown = (totalSec: number | null) => {
    if (totalSec === null || totalSec === undefined) return '';
    const m = Math.floor(Math.max(0, totalSec) / 60);
    const s = Math.max(0, totalSec) % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const renderStatusActionButton = () => {
    if (loggedInUser) {
      return (
        <Link to="/dashboard" className="btn btn-primary" data-testid="status-action-btn">
          Go to dashboard
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) window.history.back();
          else window.close();
        }}
        className="btn btn-secondary"
        data-testid="status-action-btn"
      >
        Close
      </button>
    );
  };

  // ------------------------------------------------------------------
  // A7: PLAIN-LANGUAGE STATUS SCREENS (No jargon!)
  // ------------------------------------------------------------------

  if (loading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--navy)',
          color: '#FFFFFF',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid var(--navy-2)',
            borderTopColor: 'var(--cyan)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span className="mono" style={{ fontSize: '13px', color: 'var(--navy-text)' }}>
          Opening secure document...
        </span>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const statusScreenBackdrop: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--navy)',
    padding: '24px',
  };

  const statusWhiteCard: React.CSSProperties = {
    maxWidth: '440px',
    width: '100%',
    padding: '36px 32px',
    textAlign: 'center',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E1E6EE',
    borderRadius: '20px',
    color: '#0B1220',
  };

  // 1. NOT_YOUR_SHARE
  if (session?.status === 'NOT_YOUR_SHARE') {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--risk-critical-bg)',
              color: 'var(--risk-critical-fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Lock size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            This document was shared with someone else
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            You are signed in with a different account than the recipient this link was created for.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            {renderStatusActionButton()}
          </div>
        </div>
      </div>
    );
  }

  // 2. EXPIRED or LIVE EXPIRED
  if (session?.status === 'EXPIRED' || hasExpiredLive) {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--risk-critical-bg)',
              color: 'var(--risk-critical-fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Clock size={22} />
          </div>
          <h2
            style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}
            data-testid="status-title"
          >
            This link has expired
          </h2>
          <p
            style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}
            data-testid="status-text"
          >
            The time limit set by the sender has ended. Ask them to share the document again if you still need it.
          </p>
          {renderStatusActionButton()}
        </div>
      </div>
    );
  }

  // 3. REVOKED
  if (session?.status === 'REVOKED') {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--risk-critical-bg)',
              color: 'var(--risk-critical-fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <ShieldAlert size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            Access has been turned off
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            The sender or an administrator has turned off this link. Contact the sender if you still need to view the document.
          </p>
          {renderStatusActionButton()}
        </div>
      </div>
    );
  }

  // 4. USED / MAX_VIEWS_REACHED
  if (
    session?.status === 'ALREADY_USED' ||
    session?.status === 'MAX_VIEWS_REACHED' ||
    session?.status === 'USED'
  ) {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
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
            <Eye size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            This link has already been used
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            {session.is_view_once
              ? 'This link was set to open only once and has already been viewed.'
              : 'This document was shared with a view limit that has now been reached. Ask the sender for a new link if you need to open it again.'}
          </p>
          {renderStatusActionButton()}
        </div>
      </div>
    );
  }

  // 5. NO_PERMISSION
  if (session?.status === 'NO_PERMISSION') {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
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
            <Lock size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            You don&apos;t have access to this document
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            Your current role does not include permission to open this file. Ask the owner or an administrator for access.
          </p>
          {renderStatusActionButton()}
        </div>
      </div>
    );
  }

  // 5.5. AUTHENTICATION REQUIRED (For internal shares accessed while logged out)
  if (!session && error && (error.toLowerCase().includes('authenticat') || error.includes('401') || error.toLowerCase().includes('log in'))) {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#EBF3FF',
              color: '#2563EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Lock size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            Sign in required
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            This document was shared internally. Please sign in to your organisation account to open it.
          </p>
          <Link
            to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}
            className="btn btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none', padding: '10px 24px', borderRadius: '6px' }}
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // 6. NOT_FOUND / INVALID_LINK
  if (!session || session.status === 'NOT_FOUND' || session.status === 'INVALID_LINK' || (!session && error)) {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--risk-critical-bg)',
              color: 'var(--risk-critical-fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <AlertTriangle size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            Link not found
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            {error || 'We could not find a document at this address. Check the link or ask the sender for a new one.'}
          </p>
          {renderStatusActionButton()}
        </div>
      </div>
    );
  }

  // 7. A3: OTP CHALLENGE SCREEN FOR EXTERNAL LINKS ("Verify your email")
  if (session.status === 'OTP_REQUIRED') {
    const displayedMask = maskedOtpEmail || maskEmailAddress(otpEmail || session.viewer_email || '');
    return (
      <div style={statusScreenBackdrop}>
        <div data-testid="otp-challenge-card" style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#E3ECFB',
              color: '#2457D6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <KeyRound size={22} />
          </div>
          <h2
            style={{ fontSize: '20px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}
            data-testid="otp-heading"
          >
            Verify your email
          </h2>
          {session.document_title && (
            <div style={{ fontSize: '12.5px', color: '#2457D6', fontWeight: 700, marginBottom: '8px' }}>
              Document: {session.document_title}
            </div>
          )}
          <p
            style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '20px' }}
            data-testid="otp-subtitle"
          >
            {otpStep === 'request'
              ? 'Enter the email address this link was shared with to receive a one-time 6-digit verification code.'
              : `We sent a 6-digit code to ${displayedMask}. It expires in 5 minutes.`}
          </p>

          {otpError && (
            <div
              data-testid="otp-error"
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: '#FDECEA',
                border: '1px solid #F6D6D1',
                color: '#B42318',
                fontSize: '12.5px',
                fontWeight: 600,
                marginBottom: '14px',
              }}
            >
              {otpError}
            </div>
          )}

          {otpStep === 'request' ? (
            <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="email"
                data-testid="otp-email-input"
                className="form-input mono"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
                placeholder="recipient@domain.com"
                required
                style={{ backgroundColor: '#FFFFFF', borderColor: '#E1E6EE', color: '#0B1220' }}
              />
              <button
                type="submit"
                data-testid="otp-send-btn"
                disabled={submittingOtp}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                <span>{submittingOtp ? 'Sending code...' : 'Send 6-digit code'}</span>
                <ArrowRight size={15} />
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="text"
                data-testid="otp-code-input"
                className="form-input mono"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                required
                maxLength={6}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E1E6EE',
                  color: '#0B1220',
                  textAlign: 'center',
                  fontSize: '20px',
                  letterSpacing: '6px',
                }}
              />
              <button
                type="submit"
                data-testid="otp-verify-btn"
                disabled={submittingOtp || otpCode.length < 6}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                <span>{submittingOtp ? 'Verifying...' : 'Open document'}</span>
                <ArrowRight size={15} />
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                <button
                  type="button"
                  data-testid="otp-resend-btn"
                  disabled={resendCooldown > 0 || submittingOtp}
                  onClick={() => sendOtpCode(otpEmail)}
                  className="btn btn-ghost btn-sm"
                  style={{ color: resendCooldown > 0 ? '#8892A3' : '#2457D6', fontSize: '12.5px' }}
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOtpStep('request');
                    setOtpCode('');
                    setOtpError(null);
                  }}
                  className="btn btn-ghost btn-sm"
                  style={{ color: '#566275', fontSize: '12.5px' }}
                >
                  Change email
                </button>
              </div>
            </form>
          )}

          {session.demo_mode && (
            <div
              data-testid="demo-mode-otp-note"
              style={{
                marginTop: '16px',
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: '#EFF8FF',
                border: '1px solid #B2DDFF',
                color: '#175CD3',
                fontSize: '12px',
                textAlign: 'center',
              }}
            >
              Demo mode: codes appear in Demo inbox inside SecureDocs.
            </div>
          )}
        </div>
      </div>
    );
  }

  // 8. VIEW ONCE CONFIRMATION CARD (B2: Before opening a view-once share)
  if (session?.status === 'VALID' && session.is_view_once && !viewOnceConfirmed) {
    return (
      <div style={statusScreenBackdrop}>
        <div style={statusWhiteCard}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#FEF3F2',
              color: '#B42318',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Eye size={22} />
          </div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#0B1220', marginBottom: '8px' }}>
            View once document
          </h2>
          <p style={{ fontSize: '13.5px', color: '#566275', lineHeight: 1.55, marginBottom: '24px' }}>
            This document can be opened once. You&apos;ll have up to 10 minutes. Closing or reloading the page ends access.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', height: '42px', fontSize: '14px' }}
            onClick={() => {
              setViewOnceConfirmed(true);
              createSession();
            }}
          >
            Open now
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // FULL SECURE DOCUMENT VIEWER INTERFACE (Dark Navy Backdrop + White Top Bar)
  // ------------------------------------------------------------------
  const isCanvasBlurred = isStrictMode && pressAndHoldEnabled && !isHoldingToView;

  return (
    <div
      ref={viewerContainerRef}
      style={{
        height: '100vh',
        width: '100vw',
        backgroundColor: 'var(--navy)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* A6: Instant Black Capture Deterrence Overlay covering EVERYTHING */}
      {isShieldBlanked && (
        <div
          data-testid="screenshot-blackout-overlay"
          onClick={() => {
            setIsShieldBlanked(false);
            setShieldTriggerReason(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#000000',
            color: '#FFFFFF',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px',
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          <ShieldAlert size={44} color="#B42318" style={{ marginBottom: '16px' }} />
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', color: '#FFFFFF' }}>
            Protected Document Hidden
          </h2>
          <p style={{ fontSize: '14px', color: '#C5CFE0', maxWidth: '460px', lineHeight: 1.6, marginBottom: '20px' }}>
            This page hid itself because the window lost focus or a capture key was pressed
            {shieldTriggerReason ? ` (${shieldTriggerReason.replace(/_/g, ' ')})` : ''}.
            This event has been recorded in the audit log.
          </p>
          <button type="button" className="btn btn-cyan" data-testid="resume-viewing-btn">
            Click to return to document
          </button>
        </div>
      )}

      {/* View Once Top Bar */}
      {session.is_view_once && (
        <div
          data-testid="view-once-banner"
          style={{
            height: '36px',
            backgroundColor: '#FEF3F2',
            borderBottom: '1px solid #FECDCA',
            color: '#B42318',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            fontSize: '13px',
            fontWeight: 600,
            zIndex: 101,
          }}
        >
          <span>View once · ends when you close this page</span>
          {secondsRemaining !== null && (
            <span
              style={{
                fontFamily: 'monospace',
                backgroundColor: '#FEE4E2',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      )}

      {/* White Top Bar */}
      <div
        style={{
          height: '54px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E1E6EE',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 18px',
          color: '#0B1220',
          zIndex: 100,
        }}
      >
        {/* Left: Doc Title & Red CONFIDENTIAL Outline Tag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setShowLeftThumbnails(!showLeftThumbnails)}
            className="btn btn-ghost btn-sm"
            style={{ color: showLeftThumbnails ? '#0B1220' : '#566275', padding: '6px' }}
            title="Toggle Thumbnails"
          >
            <FileText size={17} strokeWidth={1.75} />
          </button>

          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: '#0B1220',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '280px',
            }}
          >
            {session.document_title || 'Protected Document'}
          </span>

          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              padding: '2px 8px',
              borderRadius: '4px',
              border: '1px solid #B42318',
              color: '#B42318',
              backgroundColor: '#FDECEA',
            }}
          >
            CONFIDENTIAL
          </span>

          {session.is_safe_copy && (
            <span className="chip chip-safe-copy" style={{ fontSize: '11px' }}>
              Safe copy
            </span>
          )}

          {isStrictMode && (
            <span
              data-testid="strict-viewing-badge"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: '999px',
                backgroundColor: '#FDECEA',
                color: '#B42318',
              }}
            >
              Strict viewing
            </span>
          )}
        </div>

        {/* Center: Page Controls & Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            disabled={currentPage <= 1}
            className="btn btn-ghost btn-sm"
            style={{ color: '#0B1220', padding: '4px' }}
            title="Previous Page"
          >
            <ChevronLeft size={17} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12.5px' }}>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt(pageInput, 10);
                  if (!isNaN(val) && val >= 1 && val <= numPages) {
                    setCurrentPage(val);
                  } else {
                    setPageInput(String(currentPage));
                  }
                }
              }}
              style={{
                width: '36px',
                height: '26px',
                textAlign: 'center',
                backgroundColor: '#F5F7FA',
                border: '1px solid #E1E6EE',
                borderRadius: '6px',
                color: '#0B1220',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                fontWeight: 600,
                padding: 0,
              }}
            />
            <span className="mono" style={{ color: '#566275' }}>
              / {numPages}
            </span>
          </div>

          <button
            type="button"
            onClick={() => scrollToPage(Math.max(currentPage - 1, 1))}
            disabled={currentPage <= 1}
            className="btn btn-ghost btn-sm"
            style={{ color: '#0B1220', padding: '4px' }}
            title="Previous Page"
          >
            <ChevronLeft size={17} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const p = parseInt(pageInput, 10);
                  if (!isNaN(p) && p >= 1 && p <= numPages) {
                    scrollToPage(p);
                  } else {
                    setPageInput(String(currentPage));
                  }
                }
              }}
              style={{
                width: '36px',
                height: '26px',
                textAlign: 'center',
                border: '1px solid #E1E6EE',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#0B1220',
              }}
            />
            <span style={{ color: '#566275', fontSize: '12.5px' }}>/ {numPages}</span>
          </div>
          <button
            type="button"
            onClick={() => scrollToPage(Math.min(currentPage + 1, numPages))}
            disabled={currentPage >= numPages}
            className="btn btn-ghost btn-sm"
            style={{ color: '#0B1220', padding: '4px' }}
            title="Next Page"
          >
            <ChevronRight size={17} />
          </button>

          <div style={{ width: '1px', height: '18px', backgroundColor: '#E1E6EE', margin: '0 4px' }} />

          <button
            type="button"
            onClick={() => {
              setIsFitWidth(false);
              setScale((s) => Math.max(s - 0.15, 0.5));
            }}
            className="btn btn-ghost btn-sm"
            style={{ color: '#0B1220', padding: '4px' }}
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <span
            className="mono"
            style={{ fontSize: '12px', minWidth: '42px', textAlign: 'center', color: '#0B1220', fontWeight: 600, cursor: 'pointer' }}
            title="Click to toggle 100% / 150%"
            onClick={() => {
              setIsFitWidth(false);
              setScale((s) => (Math.abs(s - 1.0) < 0.1 ? 1.5 : 1.0));
            }}
          >
            {isFitWidth ? 'Fit' : `${Math.round(scale * 100)}%`}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsFitWidth(false);
              setScale((s) => Math.min(s + 0.15, 3.0));
            }}
            className="btn btn-ghost btn-sm"
            style={{ color: '#0B1220', padding: '4px' }}
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>

          <button
            type="button"
            onClick={() => setIsFitWidth(!isFitWidth)}
            className={`btn btn-sm ${isFitWidth ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '12px', padding: '0 8px', height: '28px' }}
            title="Fit Width"
          >
            Fit width
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="btn btn-ghost btn-sm"
            style={{ color: '#0B1220', padding: '4px' }}
            title="Full Screen"
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>

        {/* Right: Press-and-hold toggle, Mono Countdown Timer, Download, Details */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isStrictMode && (
            <button
              type="button"
              data-testid="press-hold-indicator"
              onMouseDown={() => setIsHoldingToView(true)}
              onMouseUp={() => setIsHoldingToView(false)}
              onMouseLeave={() => setIsHoldingToView(false)}
              onTouchStart={() => setIsHoldingToView(true)}
              onTouchEnd={() => setIsHoldingToView(false)}
              className="btn btn-secondary btn-sm"
              style={{
                backgroundColor: isHoldingToView ? 'var(--navy)' : '#F5F7FA',
                borderColor: '#E1E6EE',
                color: isHoldingToView ? '#FFFFFF' : '#0B1220',
                fontSize: '11.5px',
              }}
            >
              <Eye size={13} />
              <span>{isHoldingToView ? 'Viewing (Hold active)' : 'Press and hold to view'}</span>
            </button>
          )}

          {secondsRemaining !== null && (
            <div
              data-testid="viewer-countdown"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                backgroundColor: '#FDECEA',
                border: '1px solid #F6D6D1',
                borderRadius: '999px',
                color: '#B42318',
              }}
            >
              <Clock size={13} />
              <span className="mono" style={{ fontSize: '12px', fontWeight: 700 }}>
                {formatCountdown(secondsRemaining)}
              </span>
            </div>
          )}

          {session.access_mode === 'ALLOW_DOWNLOAD' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {session.is_password_protected && (
                <span
                  data-testid="viewer-download-password-note"
                  style={{ fontSize: '11px', color: '#566275', maxWidth: '210px', lineHeight: 1.25, textAlign: 'right' }}
                >
                  This PDF asks for a password when opened in any PDF reader (Preview, Acrobat, Chrome).
                </span>
              )}
              <a
                href={getDownloadUrl()}
                download
                className="btn btn-primary btn-sm"
                style={{ textDecoration: 'none' }}
              >
                <Download size={13} /> Download
              </a>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowRightDetails(!showRightDetails)}
            className="btn btn-ghost btn-sm"
            style={{ color: showRightDetails ? '#2457D6' : '#566275', padding: '6px' }}
            title="Document Details"
          >
            <Info size={17} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Honest Screenshot Deterrence Disclaimer Banner (A6) */}
      <div
        data-testid="viewer-security-disclaimer"
        style={{
          backgroundColor: 'var(--navy-2)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '6px 18px',
          fontSize: '11.5px',
          color: 'var(--navy-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={13} color="var(--cyan)" />
          <span>
            Screenshots can&apos;t be fully blocked by a browser. This page hides itself when it detects a capture attempt, and every page carries your name, so any leaked image can be traced to you.
          </span>
        </div>
        {isStrictMode && (
          <span style={{ color: 'var(--cyan)', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Press & hold mouse button on the page to unblur
          </span>
        )}
      </div>

      {/* Main Viewport Body */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {/* Left Thumbnails Panel */}
        {showLeftThumbnails && (
          <div
            style={{
              width: '160px',
              backgroundColor: 'var(--navy-2)',
              borderRight: '1px solid rgba(255, 255, 255, 0.08)',
              overflowY: 'auto',
              padding: '12px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              zIndex: 10,
            }}
          >
            <div
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--navy-muted)',
                fontWeight: 700,
                padding: '0 4px',
              }}
            >
              Pages ({numPages})
            </div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pg) => (
              <div
                key={pg}
                onClick={() => scrollToPage(pg)}
                style={{
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '8px',
                  backgroundColor: currentPage === pg ? 'rgba(91, 224, 255, 0.14)' : 'transparent',
                  border:
                    currentPage === pg
                      ? '2px solid var(--cyan)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100px',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#0B1220',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  Page {pg}
                </div>
                <div className="mono" style={{ fontSize: '10.5px', color: 'var(--navy-muted)', marginTop: '4px' }}>
                  {pg}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Center: Canvas Page Container (overflow-y: auto, align-items: flex-start, padding: 24px) */}
        <div
          ref={scrollContainerRef}
          data-testid="viewer-canvas-area"
          onMouseDown={() => setIsHoldingToView(true)}
          onMouseUp={() => setIsHoldingToView(false)}
          onMouseLeave={() => setIsHoldingToView(false)}
          onTouchStart={() => setIsHoldingToView(true)}
          onTouchEnd={() => setIsHoldingToView(false)}
          style={{
            flex: 1,
            backgroundColor: 'var(--navy)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            padding: '24px',
            position: 'relative',
            cursor: isStrictMode ? 'pointer' : 'default',
          }}
        >
          {requiresPassword ? (
            <div
              style={{
                margin: 'auto',
                padding: '36px 28px',
                textAlign: 'center',
                backgroundColor: '#121F38',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                maxWidth: '400px',
                width: '100%',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: '#1E2D4A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <Lock size={24} color="var(--cyan)" />
              </div>
              <h4 style={{ fontSize: '17px', fontWeight: 700, color: '#FFFFFF' }}>Password Protected</h4>
              <p style={{ fontSize: '13px', color: 'var(--navy-text)', marginTop: '6px', marginBottom: '20px' }}>
                This copy is password-protected. Enter the password to view.
              </p>
              {passwordError && (
                <div style={{ color: '#FF7B72', fontSize: '12.5px', marginBottom: '14px', fontWeight: 600 }}>
                  {passwordError}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!docPassword.trim() || passwordAttempts >= 5) return;
                  setIsUnlocking(true);
                  loadPDF(docPassword.trim()).finally(() => setIsUnlocking(false));
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <input
                  type="password"
                  data-testid="viewer-doc-password-input"
                  className="form-input mono"
                  placeholder="Enter password"
                  value={docPassword}
                  disabled={passwordAttempts >= 5}
                  onChange={(e) => setDocPassword(e.target.value)}
                  style={{ backgroundColor: '#0A1324', color: '#FFFFFF', borderColor: 'rgba(255, 255, 255, 0.18)' }}
                  required
                />
                <button
                  type="submit"
                  disabled={isUnlocking || passwordAttempts >= 5}
                  data-testid="viewer-doc-unlock-btn"
                  className="btn btn-primary"
                  style={{ width: '100%', height: '42px', fontSize: '14px' }}
                >
                  {isUnlocking ? 'Unlocking...' : 'Unlock document'}
                </button>
              </form>
            </div>
          ) : !pdfDoc ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '380px', color: '#94A3B8' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  border: '3px solid rgba(255, 255, 255, 0.12)',
                  borderTopColor: '#3B82F6',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  marginBottom: '16px',
                }}
              />
              <span style={{ fontSize: '13.5px', color: '#CBD5E1', fontWeight: 500 }}>
                {error || 'Loading secure document...'}
              </span>
            </div>
          ) : (
            Array.from({ length: Math.max(1, numPages) }, (_, i) => i + 1).map((pg) => (
              <div
                key={pg}
                id={`viewer-page-${pg}`}
                ref={(el) => {
                  if (el) pageWrappersRef.current.set(pg, el);
                  else pageWrappersRef.current.delete(pg);
                }}
                style={{
                  position: 'relative',
                  margin: '0 auto 16px',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '4px',
                  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <canvas
                  ref={(el) => {
                    if (el) {
                      canvasRefs.current.set(pg, el);
                      if (pg === 1) (mainCanvasRef as any).current = el;
                    } else {
                      canvasRefs.current.delete(pg);
                      if (pg === 1 && (mainCanvasRef as any).current === el) (mainCanvasRef as any).current = null;
                    }
                  }}
                  data-testid={pg === 1 ? 'pdf-canvas' : undefined}
                  style={{
                    display: 'block',
                    filter: isCanvasBlurred ? 'blur(18px)' : 'none',
                    transition: 'filter 120ms ease-out',
                  }}
                />

                {/* Press and Hold Prompt Overlay when blurred */}
                {isCanvasBlurred && (
                  <div
                    data-testid={pg === 1 ? 'press-hold-overlay' : undefined}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(10, 19, 36, 0.45)',
                      color: '#FFFFFF',
                      padding: '24px',
                      textAlign: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <div
                      style={{
                        padding: '16px 24px',
                        borderRadius: '16px',
                        backgroundColor: 'var(--navy)',
                        border: '1px solid rgba(91, 224, 255, 0.25)',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
                      }}
                    >
                      <EyeOff size={22} color="var(--cyan)" style={{ margin: '0 auto 8px' }} />
                      <div style={{ fontSize: '14.5px', fontWeight: 700, marginBottom: '4px' }}>
                        Press and hold to view
                      </div>
                      <div style={{ fontSize: '12.5px', color: 'var(--navy-text)' }}>
                        Hold down your mouse button or finger on the page to unblur content.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* B6: Selective Click-to-Reveal Panel for Authorized Users on Safe Copies */}
        {session.is_safe_copy && session.can_reveal_sensitive && parentFindings.length > 0 && (
          <div
            data-testid="safe-copy-reveal-panel"
            style={{
              width: '280px',
              backgroundColor: 'var(--navy-2)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '16px',
              color: '#FFFFFF',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
              Redacted items ({parentFindings.length})
            </div>
            <p style={{ fontSize: '11.5px', color: 'var(--navy-text)', margin: 0, lineHeight: 1.45 }}>
              You have permission to temporarily reveal original values for 10 seconds. Every reveal is recorded in the audit log.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {parentFindings.map((f) => {
                const revealed = revealedValues[f.id];
                return (
                  <div
                    key={f.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--navy)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      fontSize: '11.5px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, color: '#FFFFFF' }}>{f.entity_type}</span>
                      <span className="mono" style={{ color: 'var(--navy-muted)' }}>
                        p.{f.page_number}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: '12px',
                        color: revealed ? 'var(--cyan)' : 'var(--navy-text)',
                        marginBottom: '6px',
                      }}
                    >
                      {revealed ? revealed.value : f.masked_value}
                    </div>
                    {!revealed ? (
                      <button
                        type="button"
                        data-testid={`reveal-finding-${f.id}`}
                        disabled={revealingId === f.id}
                        onClick={() => handleRevealFinding(f.id)}
                        className="btn btn-cyan btn-sm"
                        style={{ width: '100%', height: '26px', fontSize: '11px' }}
                      >
                        <Eye size={11} /> {revealingId === f.id ? 'Revealing...' : 'Reveal for 10s'}
                      </button>
                    ) : (
                      <div style={{ fontSize: '10.5px', color: 'var(--cyan)', fontWeight: 600 }}>
                        Visible for 10s (audited)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Right Details Panel */}
        {showRightDetails && (
          <div
            style={{
              width: '280px',
              backgroundColor: 'var(--navy-2)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '18px',
              color: '#FFFFFF',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              zIndex: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>Share details</h3>
              <button
                type="button"
                onClick={() => setShowRightDetails(false)}
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px', color: 'var(--navy-muted)' }}
              >
                <X size={15} />
              </button>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--navy-muted)', marginBottom: '2px' }}>Document</div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#FFFFFF' }}>{session.document_title}</div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--navy-muted)', marginBottom: '2px' }}>Viewer</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                {session.viewer_name || session.viewer_email || 'Verified Recipient'}
              </div>
              <div className="mono" style={{ fontSize: '11.5px', color: 'var(--navy-muted)' }}>
                {session.viewer_email}
              </div>
            </div>

            <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)' }} />

            <div>
              <div
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--navy-muted)',
                  fontWeight: 700,
                  marginBottom: '8px',
                }}
              >
                Share settings
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--navy-muted)' }}>Access mode</span>
                  <span style={{ fontWeight: 600 }}>
                    {session.access_mode === 'ALLOW_DOWNLOAD' ? 'Download ok' : 'View-only'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--navy-muted)' }}>View once</span>
                  <span style={{ fontWeight: 600 }}>{session.is_view_once ? 'Yes' : 'No'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--navy-muted)' }}>Strict viewing</span>
                  <span style={{ fontWeight: 600 }}>{isStrictMode ? 'On' : 'Standard'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--navy-muted)' }}>Time limit</span>
                  <span className="mono">
                    {session.time_limit_seconds
                      ? `${Math.round(session.time_limit_seconds / 60)} min`
                      : 'None'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)' }} />

            <div>
              <div
                style={{
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--navy-muted)',
                  fontWeight: 700,
                  marginBottom: '8px',
                }}
              >
                Document watermark
              </div>
              <p style={{ fontSize: '11.5px', color: 'var(--navy-text)', lineHeight: 1.5, marginBottom: '8px' }}>
                Every page carries your name, email, IP address, and share ID:
              </p>
              <div
                className="mono"
                style={{
                  fontSize: '11px',
                  backgroundColor: 'var(--navy)',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(91, 224, 255, 0.2)',
                  color: 'var(--cyan)',
                  wordBreak: 'break-all',
                }}
              >
                {session.tracking_hash || 'WATERMARK-ACTIVE'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
