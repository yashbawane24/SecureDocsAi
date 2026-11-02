# CHANGES_PLAN.md — Root Cause Analysis & Implementation Plan (SecureDocs AI)

## Overview
This plan documents:
1. Product rename from **"Ledger Vault"** to **"SecureDocs AI"** across the entire UI, backend metadata, watermark defaults, and emails while preserving all working functionality.
2. Root cause analysis and fix specifications for **PART A (A1–A7)**.
3. Architecture and implementation details for **PART B (B1–B8)** — Sensitive Data Detection, Explainable Risk Scoring (0–100), Risk-Based Sharing Policy, True PDF Redaction & AES-256 Password-Encrypted Safe Copies, and Selective Sensitive Value Reveal.
4. Comprehensive automated verification suite for **PART C** (Pytest + Playwright E2E + Visual Screenshots).

---

## PART A — Root Cause Analysis of Every Bug

### A1. Organisation Settings Page Shows "Not Found" and All Fields Are Empty
- **Root Cause 1 (404 Not Found on API URL):**
  - `frontend/src/api/client.ts` (`getCurrentOrg`, `updateCurrentOrg`) sends requests to `GET /api/org/current` and `PATCH /api/org/current`.
  - However, `backend/app/api/organizations.py` declares `router = APIRouter(prefix="/organizations")` mounted under `/api` in `backend/app/main.py` (resulting in `/api/organizations/current`). No router was mounted at `/api/org/settings` or `/api/org/current`, causing FastAPI to return `HTTP 404: {"detail": "Not Found"}`.
- **Root Cause 2 (Empty Fields & Schema Mismatch):**
  - `OrganizationResponse` in `backend/app/schemas/__init__.py` returned `allowed_email_domains: str` (a comma-separated string) and nested policy settings inside `settings: Dict[str, Any]` (`allow_external_links`, `require_otp_external`, `max_share_duration_seconds`, `allow_downloads`, `default_watermark`).
  - Meanwhile, `frontend/src/pages/OrgSettings.tsx` expected `data.allowed_email_domains` to be a `string[]` (calling `.join(', ')` which throws a TypeError on a string) and read top-level fields (`data.allow_external_links`, `data.always_require_otp`, `data.max_share_duration_hours`, `data.allow_downloads`, `data.default_watermark_text`) that were `undefined` on the response.
- **Root Cause 3 (Permission & UI Controls):**
  - `GET /organizations/current` only checked `get_current_user` rather than `require_permission("org.settings")`, and there was no `POST /api/org/invite-code/regenerate` endpoint. The header had a "Refresh" button instead of a dirty-state-aware "Save changes" button.
- **Fix:**
  - Expose `GET /api/org/settings`, `PATCH /api/org/settings`, and `POST /api/org/invite-code/regenerate` (all enforcing `require_permission("org.settings")`), while keeping `/api/org/current` and `/api/organizations/current` as compatible aliases.
  - Serialize all fields (`name`, `slug`, `logo_url`, `brand_accent_color`, `invite_code`, `allowed_email_domains` as `List[str]`, `allow_external_links`, `always_require_otp`, `max_share_duration_hours`, `allow_downloads`, `default_watermark_text`, and `risk_policy`) in `OrganizationResponse`.
  - Update `OrgSettings.tsx` to populate all fields (including Logo URL, Accent Colour, Invite Code, Allowed Domains, Security Policies, and the B5 Risk Policy matrix), show a toast notification on save, update UI state immediately without page reload, and replace the "Refresh" button with a "Save changes" button enabled only when form state has changed (`isDirty`).

### A2. How People Join — Make the Invite Code Easy to Find and Share
- **Root Cause:**
  - The organization invite code (`NWH-2026`) was hidden inside the broken `/settings` page, `/members` had no unified "Invite people" panel with link/QR sharing, and `/join` did not read `?code=...` from the URL query string to pre-fill the invite code.
- **Fix:**
  - Show the invite code, full join link (`http://<frontend>/join?code=NWH-2026`), Copy button, QR code (rendered via lightweight SVG QR generator), and Regenerate button (with confirmation `"The old code will stop working"`) in **two places**:
    1. `OrgSettings.tsx` → "Access & membership" section.
    2. `Members.tsx` → "Invite people" button opening a two-tab modal/panel:
       - Tab 1 ("Invite by email"): email, role, department, manager → sends invite email and creates a 7-day invite.
       - Tab 2 ("Share join link"): shows the invite code, full link `/join?code=...` with Copy button, SVG QR code, and Regenerate button with confirmation.
  - Update `Join.tsx` to read `useSearchParams().get('code')` and pre-fill the invite code automatically. Users joining via `/join?code=...` are created with `status = PENDING` until approved.

### A3. OTP for External Links Does Not Work (Link Shows "Access expired")
- **Root Cause 1 (Frontend `useEffect` Loop & Premature Client Expiry State in `SecureViewer.tsx`):**
  - In `frontend/src/pages/SecureViewer.tsx` (line 120), `fetchStatus` included `otpEmail` in its `useCallback` dependency array (`[isInternal, isDocPreview, isExternalLink, shareId, documentId, token, otpEmail]`), and `useEffect(() => { fetchStatus(); }, [fetchStatus])` re-triggered `fetchStatus()` on every keystroke in the email field.
  - Furthermore, `evaluate_share_status()` in `backend/app/services/share_service.py` checked `share.is_view_once`, `share.max_views`, and computed `seconds_remaining` BEFORE checking `OTP_REQUIRED`, and `SecureViewer.tsx` set `secondsRemaining` and `hasExpiredLive = true` if `seconds_remaining <= 0` even before OTP verification occurred.
  - In `backend/app/api/view.py` (`_build_share_session_response`), `viewer_email` was populated with `share.recipient_email` even when `status == OTP_REQUIRED`, leaking/pre-filling the recipient's address before verification.
- **Root Cause 2 (Seeded Share Expiry & Test Mutation):**
  - In `backend/app/seed.py`, `S6` was seeded with a short `expires_at=now + timedelta(days=3)` which expired after 3 days, and `S7` was mutated to `is_revoked=True` by earlier test runs without resetting.
- **Root Cause 3 (Mail Delivery Modes & Masked Email / Cooldown UI):**
  - `backend/app/services/email.py` only attempted raw SMTP without a `MAIL_MODE` switch (`mailpit`, `smtp`, `resend`) or startup connection check.
  - The OTP verification screen did not mask the recipient address (`l***@medisupply.test`) or display a live 60-second resend countdown button.
- **Fix:**
  - In `backend/app/services/share_service.py` and `backend/app/api/view.py`:
    - Ensure visiting `/s/:token` (`GET /api/view/s/:token/status`) NEVER sets `first_opened_at` and NEVER increments `views_used`.
    - When `share.share_type == ShareType.LINK and share.requires_otp` and the viewer does not yet have a valid verified OTP cookie, return `status = "OTP_REQUIRED"` with `seconds_remaining = None` (as long as the share isn't revoked, hard-expired, or already exhausted).
    - Start `first_opened_at` and increment `views_used` ONLY when `GET /api/view/s/:token/content` is called after successful OTP verification.
  - In `frontend/src/pages/SecureViewer.tsx`:
    - Remove `otpEmail` from `fetchStatus` dependencies so typing never re-fetches status.
    - Show the "Verify your email" screen for `OTP_REQUIRED`, then after requesting a code show: `"We sent a 6-digit code to l***@medisupply.test. It expires in 5 minutes."` along with a Resend button displaying a live `60 s` countdown timer.
  - In `backend/app/services/email.py` and `backend/app/core/config.py`:
    - Support `MAIL_MODE=mailpit` (default in dev, `localhost:1025`, UI `http://localhost:8025`), `MAIL_MODE=smtp` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` with STARTTLS/SSL support for Gmail App Passwords), and `MAIL_MODE=resend` (`RESEND_API_KEY`).
    - On FastAPI startup (`lifespan` in `main.py`), log the active `MAIL_MODE` and whether the SMTP/Mailpit connection test succeeds (never logging any OTP code).
  - Document `"Where do OTP emails go?"` in `README.md` covering all three modes and Gmail App Password setup.

### A4. Audit Log & Shared Links CSV Export
- **Root Cause:**
  - `AuditLog.tsx` had a client-side-only export button that did not call a backend streaming CSV endpoint, lacked date-range/user filters, did not record an `AUDIT_EXPORT` event in the audit log, did not neutralize CSV formula injection (`=`, `+`, `-`, `@`, `\t`), and `SharedByMe.tsx` (`/shared-links`) had no CSV export button.
- **Fix:**
  - Add `AuditAction.AUDIT_EXPORT` to `backend/app/models/__init__.py`.
  - Add `GET /api/audit/export.csv` in `backend/app/api/audit.py` supporting query filters (`date_from`, `date_to`, `actor_email`, `action`, `result`), requiring `audit.view`, recording an `AUDIT_EXPORT` audit log entry, sanitizing every cell starting with `=`, `+`, `-`, `@`, or `\t` by prefixing `'`, and returning a `StreamingResponse` with `Content-Disposition: attachment; filename="securedocs-audit-<org>-<YYYY-MM-DD>.csv"` and columns: `timestamp_utc,actor_name,actor_email,action,document,share_id,recipient,ip_address,user_agent,result,details`.
  - Update `AuditLog.tsx` with date range (`date_from`, `date_to`), user (`actor_email`), action, and result filters, wired to `GET /api/audit` and `GET /api/audit/export.csv`.
  - Add an "Export CSV" button on `SharedByMe.tsx` (`/shared-links` and `/shared-by-me`) and `GET /api/shares/export.csv` with CSV injection protection.

### A5. UI Does Not Update Until Page Refresh
- **Root Cause:**
  - Pages and components (`Topbar.tsx`, `Sidebar.tsx`, `Notifications.tsx`, `Dashboard.tsx`, `Documents.tsx`, `SharedByMe.tsx`, `Members.tsx`, `Invitations.tsx`, `OrgSettings.tsx`, `RolesPermissions.tsx`) each held isolated local `useState` state fetched inside `useEffect`. Mutating state in one component (e.g., marking a notification read on `/notifications` or revoking a share) did not invalidate or update the state in `Topbar.tsx`, `Sidebar.tsx`, or `Dashboard.tsx`.
- **Fix:**
  - Install `@tanstack/react-query` in `frontend/package.json` and wrap the app in `QueryClientProvider`.
  - Create `frontend/src/api/queryKeys.ts` as the single source of truth for all query keys (`auth.me`, `org.settings`, `dashboard.metrics`, `documents.list`, `documents.detail`, `documents.analysis`, `shares.mine`, `shares.withMe`, `approvals.list`, `notifications.list`, `audit.list`, `members.list`, `invites.list`, `departments.list`, `roles.list`).
  - Wire all queries and mutations across pages, `Sidebar.tsx`, and `Topbar.tsx` to TanStack Query keys.
  - Implement optimistic updates with error rollback for `markNotificationRead`, `markAllNotificationsRead`, and `revokeShare`.
  - Add SSE endpoint `GET /api/events/stream` (`backend/app/api/events.py` + `backend/app/services/event_bus.py`) that pushes real-time notification, scan progress/completion, approval, and share-status events to connected clients, with automatic 20-second polling fallback if SSE disconnects.

### A6. View-Once Screenshot Deterrence
- **Root Cause:**
  - `SecureViewer.tsx` only blocked `Ctrl/Cmd+P`, `Ctrl/Cmd+S`, and right-click context menu. It lacked active blur/focus/visibility/mouse-leave/key-combo blanking, "Press and hold to view", heavier forensic watermarks for strict viewing, and `SCREENSHOT_ATTEMPT_SUSPECTED` audit/notification logging.
- **Fix:**
  - Add `strict_viewing: Mapped[bool]` to `Share` (default `True` for `is_view_once=True` and for `HIGH`/`CRITICAL` risk documents, and configurable via a "Strict viewing" toggle in `ShareModal.tsx`).
  - Add `AuditAction.SCREENSHOT_ATTEMPT_SUSPECTED` and `POST /api/view/security-event` to log suspected capture triggers (`window_blur`, `visibility_hidden`, `mouse_leave`, `print_screen`, `shortcut_key`, `devtools_open`) to the audit log and send a notification to the document sender.
  - In `SecureViewer.tsx` when strict viewing is active:
    1. Immediately blank the entire viewer (full black overlay covering canvas and watermark) on `window` `blur`, `document` `visibilitychange` (`hidden`), `mouseleave` on `document.documentElement`, `PrintScreen` `keyup`, `Cmd/Ctrl+Shift+3/4/5` or `Win+Shift+S`, and DevTools open detection (`window.outerWidth - window.innerWidth > 160` or `window.outerHeight - window.innerHeight > 160`). Content returns only when the user clicks "Click to resume viewing" inside the page.
    2. Implement **"Press and hold to view"**: the document canvas is blurred (`filter: blur(18px)`) by default and becomes clear only while the user holds down the mouse button (`mousedown`/`mouseup`) or touch (`touchstart`/`touchend`).
    3. On `PrintScreen` `keyup`, attempt `navigator.clipboard.writeText("")` where allowed.
    4. Render a denser, heavier diagonal watermark containing viewer's name, email, client IP, UTC timestamp, and share ID repeated across the canvas.
    5. Display the required honest disclaimer: *"Screenshots can't be fully blocked by a browser. This page hides itself when it detects a capture attempt, and every page carries your name, so any leaked image can be traced to you."*
    6. Add the "Future work" hardware DRM (Widevine/FairPlay EME) note to `README.md`.

### A7. Error Screen Copy
- **Root Cause:**
  - `SecureViewer.tsx` status screens contained jargon such as `"disclosure"`, `"custody"`, `"zero-trust"`, and `"memory buffers have been purged"`, and always linked to `"Return to Dashboard"` even for unauthenticated external viewers.
- **Fix:**
  - Rewrite every status screen (`EXPIRED`, `REVOKED`, `ALREADY_USED` / `MAX_VIEWS_REACHED`, `NOT_YOUR_SHARE`, `NO_PERMISSION`, `INVALID_LINK` / `NOT_FOUND`) in plain, direct language with zero banned terms.
  - Specifically for `EXPIRED`:
    - Title: `"This link has expired"`
    - Text: `"The time limit set by the sender has ended. Ask them to share the document again if you still need it."`
    - Action Button: `"Go to dashboard"` if logged in (`user` present), otherwise `"Close"`.

---

## PART B — Sensitive Data Detection, Risk Score & Risk-Based Sharing

### B1–B4. NLP & Pattern Scanning Pipeline (`backend/app/services/scanner/`)
- **Pinned Packages (`backend/requirements.txt`):**
  - `presidio-analyzer==2.2.355`, `presidio-anonymizer==2.2.355`, `spacy==3.8.2` (loading `en_core_web_lg` with graceful fallback to `en_core_web_sm` and warning log), `PyMuPDF==1.24.13` (`fitz`), `pypdf==5.1.0`, `python-docx==1.1.2`, `pytesseract==0.3.13`.
- **Multi-Format Upload (`.pdf`, `.docx`, `.txt`):**
  - Convert `.docx` and `.txt` uploads to PDF purely in memory (`io.BytesIO`) using `python-docx` / `PyMuPDF` (`fitz`) before encrypting and storing, so viewing, watermarking, and redaction work uniformly.
- **Background Scan Lifecycle:**
  - `scan_status`: `QUEUED` → `SCANNING` → `COMPLETED` | `FAILED`, with `scan_progress` (`0–100`), `risk_score` (`0–100`), `risk_level` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), `risk_breakdown_json`, `risk_summary_json`, and `recommendations_json` stored on `Document`.
- **Three Detection Layers:**
  1. **Presidio + spaCy NER:** `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `LOCATION`, `DATE_TIME`, `CREDIT_CARD` (with Luhn validation), `IBAN_CODE`, `IP_ADDRESS`, `URL`, `MEDICAL_LICENSE`, `ORG`, `MONEY`.
  2. **Custom Indian & Secret Recognisers (Regex + Checksum + Context Boost):**
     - `IN_AADHAAR`: 12 digits (optional `4-4-4` spaces/hyphens), first digit `2–9`, strict **Verhoeff checksum** validation, context word boost (`aadhaar`, `uid`, `uidai`).
     - `IN_PAN`: `[A-Z]{5}[0-9]{4}[A-Z]` with 4th-char entity code check and context boost (`pan`, `income tax`, `permanent account`).
     - `IN_GSTIN`, `IN_IFSC`, `IN_UPI_ID`, `IN_PASSPORT`, `IN_VOTER_ID`, `IN_VEHICLE_REG`, `IN_PHONE` (`+91` / 10 digits starting `6–9`).
     - `BANK_ACCOUNT`: 9–18 digits strictly when near context words (`account`, `a/c`, `acct`, `bank`, `iban`, `ifsc`).
     - `SECRETS`: AWS access keys (`AKIA[0-9A-Z]{16}`), private key blocks (`-----BEGIN ... PRIVATE KEY-----`), JWT tokens, API keys near `api_key`/`secret`/`token`, and `password: <value>` patterns.
  3. **Document-Level Classifiers:**
     - `FINANCIAL`, `HEALTH`, `LEGAL`, `HR`, `CREDENTIALS`, and explicit markings (`confidential`, `internal only`, `restricted`, `do not distribute`).
- **Zero Raw Sensitive Value Storage (B3):**
  - `DocumentFinding` table stores ONLY `entity_type`, `category`, `masked_value` (e.g., `XXXX XXXX 4821`, `ABCPX****F`, `l***@medisupply.test`), `value_hash` (salted SHA-256 for unique counting), `page_number`, `bbox_json` (`[x0, y0, x1, y1]`), `confidence`, `detector_name`, `masked_context` (60-char snippet with the raw value replaced by its mask), and `encrypted_raw_value` (AES-256-GCM encrypted in-memory only for authorized `documents.reveal_sensitive` requests—never plaintext in DB or logs).
- **Explainable Risk Formula (B4 — `backend/app/services/scanner/risk.py`):**
  - Entity score: $\text{weight} \times \text{avg\_confidence} \times (1 + \log_2(\text{unique\_count}))$.
  - Combination bonuses: `PERSON` + ID (`IN_AADHAAR`/`IN_PAN`/`IN_PASSPORT`) `+10` ("Identity exposure"); `PERSON` + `HEALTH` `+10`; `PERSON` + `BANK_ACCOUNT`/`CREDIT_CARD` `+10`; any `SECRETS` `+15`.
  - Marking bonus `+5`; Document category classifier bonus up to `+10`.
  - Final score = $\min(100, \text{round}(\text{sum}))$. Levels: `LOW` (0–29), `MEDIUM` (30–59), `HIGH` (60–79), `CRITICAL` (80–100).

### B5–B8. Risk Policy, Approvals, True Redaction Safe Copies & UI
- **Risk-Based Sharing Policy & Approvals (`backend/app/api/approvals.py`, `backend/app/api/shares.py`):**
  - Enforced server-side on share creation, view, and download.
  - Configurable per organization in Settings → "Risk policy".
  - `ShareApprovalRequest` workflow for `CRITICAL` documents (request with reason → notification to Admin/Dept Head → approve/reject with comment → audited with `APPROVAL_REQUESTED`, `APPROVED`, `REJECTED`).
- **True Redaction & AES-256 Password-Protected Safe Copies (`backend/app/services/scanner/redactor.py`):**
  - Uses `PyMuPDF` (`page.add_redact_annot` + `page.apply_redactions`) to permanently strip underlying text and glyphs from the PDF, scrubs PDF metadata/XMP/embedded files, optionally encrypts with AES-256 user password via `pypdf`, stores as a linked `Document` (`parent_document_id`, `is_safe_copy=True`), and runs the scanner on the safe copy to prove its risk score drops to `LOW`/`MEDIUM`.
  - Selective 10-second reveal (`POST /api/documents/{id}/findings/{finding_id}/reveal`) gated by `documents.reveal_sensitive` permission and logged as `SENSITIVE_VALUE_REVEALED`.

---

## Files to Create or Modify

### Backend Files
- `backend/requirements.txt` — Pin all existing and new packages (`PyMuPDF`, `pypdf`, `python-docx`, `pytesseract`, `spacy`, `presidio-analyzer`, `presidio-anonymizer`).
- `backend/Dockerfile` — Add `tesseract-ocr` and spaCy model download (`en_core_web_lg` with fallback to `en_core_web_sm`).
- `backend/app/core/config.py` — Rename `PROJECT_NAME` to `"SecureDocs AI"`, add `MAIL_MODE`, `MAIL_FROM`, `RESEND_API_KEY`.
- `backend/app/models/__init__.py` — Add scan/risk/safe-copy fields to `Document`, `strict_viewing` & `approval_status` to `Share`, new models `DocumentFinding` and `ShareApprovalRequest`, and new `AuditAction` & `NotificationEventType` enums.
- `backend/app/schemas/__init__.py` — Update `OrganizationResponse`/`OrganizationUpdate`, `DocumentResponse`, `ShareCreate`/`ShareResponse`, `ViewerSessionResponse`, and add schemas for Risk Analysis, Findings, Safe Copy creation, and Approvals.
- `backend/app/services/email.py` — Implement `MAIL_MODE` (`mailpit`, `smtp`, `resend`), startup connectivity check, and SecureDocs AI branding.
- `backend/app/services/event_bus.py` *(new)* — In-memory async pub/sub broadcaster for Server-Sent Events (`/api/events/stream`).
- `backend/app/services/share_service.py` — Fix external OTP status evaluation so visiting `/s/:token` returns `OTP_REQUIRED` without starting countdowns or expiring prematurely.
- `backend/app/services/scanner/__init__.py` *(new)* — Scanner package exports.
- `backend/app/services/scanner/recognizers.py` *(new)* — Verhoeff checksum Aadhaar, PAN, GSTIN, IFSC, UPI, Passport, Voter ID, Vehicle Reg, Phone, Bank Account, Secrets, and Document Category classifiers.
- `backend/app/services/scanner/detector.py` *(new)* — In-memory PDF/DOCX/TXT text + bounding box extractor (PyMuPDF + OCR fallback), Presidio/spaCy NER + custom recognizer merger, value masking, and salted hashing.
- `backend/app/services/scanner/risk.py` *(new)* — Explainable 0–100 risk score calculator, contributor breakdown, category summary, and plain-language recommendations.
- `backend/app/services/scanner/redactor.py` *(new)* — PyMuPDF true redaction (`add_redact_annot` + `apply_redactions`), metadata scrubbing, `pypdf` AES-256 password encryption, and PDF Risk Analysis Report generator.
- `backend/app/api/organizations.py` — Expose `/api/org/settings`, `/api/org/invite-code/regenerate`, `/api/org/current`, and `/api/organizations/current` with full policy & risk policy serialization.
- `backend/app/api/audit.py` — Add date range filters and `GET /api/audit/export.csv` with formula-injection protection and `AUDIT_EXPORT` logging.
- `backend/app/api/shares.py` — Enforce B5 Risk-Based Sharing Policy, `strict_viewing`, and add `GET /api/shares/export.csv`.
- `backend/app/api/documents.py` — Support `.pdf`, `.docx`, `.txt` uploads, trigger background scan, expose Risk Analysis, Safe Copy creation, Risk Report PDF download, Rescan, and 10-second Sensitive Value Reveal endpoints.
- `backend/app/api/approvals.py` *(new)* — CRUD and approve/reject endpoints for Critical document share approval requests.
- `backend/app/api/events.py` *(new)* — `GET /api/events/stream` SSE endpoint.
- `backend/app/api/view.py` — Fix OTP status/verify/content lifecycle, add `POST /api/view/security-event` for `SCREENSHOT_ATTEMPT_SUSPECTED`, and return finding bounding boxes for safe copy reveal.
- `backend/app/api/dashboard.py` — Include `risk_overview` counts per level and `pending_approvals` in dashboard metrics.
- `backend/app/main.py` — Mount `org`, `approvals`, and `events` routers, and log `MAIL_MODE` + SMTP health on startup.
- `backend/app/seed.py` — Add the 5 required B8 test documents (`HR_Employee_Master.pdf`, `Patient_Discharge_Summary.pdf`, `Vendor_Invoice_Medisupply.pdf`, `Team_Offsite_Agenda.pdf`, `Dev_Server_Notes.pdf`), scan all seeded documents, add `documents.reveal_sensitive` permission, and print each document's score and risk level.

### Frontend Files
- `frontend/package.json` — Add `@tanstack/react-query`.
- `frontend/index.html` — Rename title to `SecureDocs AI`.
- `frontend/src/api/queryKeys.ts` *(new)* — Centralized query keys dictionary.
- `frontend/src/api/client.ts` — Add API methods for org settings, invite code regeneration, CSV exports, risk analysis, safe copy creation, reveal, approvals, and security events.
- `frontend/src/context/AuthContext.tsx` & `frontend/src/main.tsx` — Configure `QueryClientProvider` and SSE real-time listener (`useEventStream`).
- `frontend/src/components/Sidebar.tsx` & `frontend/src/components/Topbar.tsx` — Rename to `SecureDocs AI`, read live badge counts from shared TanStack Query keys, and add `Approvals` sidebar item with pending badge.
- `frontend/src/pages/OrgSettings.tsx` — Fix A1 (load all fields, logo, accent, invite code + QR + link, security policies, B5 Risk Policy matrix, dirty-aware "Save changes" button, toast).
- `frontend/src/pages/Members.tsx` & `frontend/src/pages/Join.tsx` — Fix A2 ("Invite people" modal with "Invite by email" and "Share join link" + QR code + Regenerate; `/join?code=...` pre-fill).
- `frontend/src/pages/SecureViewer.tsx` — Fix A3 (OTP verify email flow, masked email, 60s resend countdown), A6 (View-Once / Strict Viewing black overlay on blur/visibility/mouseleave/PrintScreen/shortcuts/DevTools, Press-and-hold to view, heavy watermark, clipboard clear, `SCREENSHOT_ATTEMPT_SUSPECTED` logging, honest disclaimer), A7 (plain-language error screens), and B6 (click redacted box to reveal for 10s).
- `frontend/src/pages/AuditLog.tsx` & `frontend/src/pages/SharedByMe.tsx` — Fix A4 (Export CSV with active filters).
- `frontend/src/pages/Documents.tsx` & `frontend/src/pages/DocumentDetail.tsx` — Implement B7 (Upload scan progress + inline risk chip, Risk column & filter, full "Risk analysis" tab with score dial, "Why this score", category summary, findings table with "Show on page" highlight, page heatmap, recommendations, "Create safe copy" modal, "Rescan", and "Download report (PDF)").
- `frontend/src/components/ShareModal.tsx` — Implement B7 Risk-aware share panel (risk banner, policy-disabled controls with explanations, 1-click "Share a safe copy instead", "Strict viewing" toggle, and "Request approval" flow for Critical documents).
- `frontend/src/pages/Approvals.tsx` *(new)* — Dedicated Approvals page for Admins/Department Heads to review, approve, or reject Critical document share requests.
- `frontend/src/pages/Dashboard.tsx` — Add "Risk overview" card and "Pending approvals" card.
- All other pages (`Landing.tsx`, `Login.tsx`, `Signup.tsx`, `ForgotPassword.tsx`, `Notifications.tsx`, `Departments.tsx`, `RolesPermissions.tsx`, `Profile.tsx`, `Security.tsx`, `SharedWithMe.tsx`) — Rename "Ledger Vault" to "SecureDocs AI", remove any banned copy, and wire mutations to `queryKeys.ts`.
