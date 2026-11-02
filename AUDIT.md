# AUDIT.md — Initial System Audit & Status Matrix

**Product:** Ledger Vault (Secure Document Sharing Platform)  
**Environment:** Information Security Coursework & Production Assessment  
**Audit Date:** 2026-10-25  
**Current Workspace State:** Fresh project initialization in workspace (`/Users/yash/IS project `). No legacy code exists in this directory.

---

## Executive Summary

This audit assesses the implementation readiness of all features specified in **PHASE 1** for the **Ledger Vault** platform. Each item is classified under one of four statuses:
- **Broken**: Implemented but failing or introducing security vulnerabilities.
- **Partial**: Partially scaffolded or missing critical security/business constraints.
- **Missing**: Not yet implemented in the codebase.
- **Done**: Fully operational, cryptographically validated, covered by tests.

In accordance with project guidelines, work proceeds systematically in the sequence:  
**Broken → Partial → Missing → Redesign & Hardening**.

---

## Phase 1 Feature Audit Matrix

| # | Feature Area | Status | Target File Paths Involved | Audit Findings & Security Directives |
|---|--------------|--------|----------------------------|---------------------------------------|
| **1** | **Encrypted Storage** | Missing | `backend/app/services/crypto.py`<br>`backend/app/services/storage.py`<br>`backend/tests/test_crypto_storage.py` | Files must be encrypted at rest with AES-256-GCM using `cryptography` library. Master key loaded strictly from environment variable `AES_SECRET_KEY` (never hardcoded, minimum 32 bytes hex/base64). Decryption and watermarking must occur strictly in-memory (`io.BytesIO`) and be returned via FastAPI `StreamingResponse`. Zero plaintext bytes written to disk/temp files. Needs explicit code comments and an automated test verifying no plaintext leaks to disk. |
| **2** | **Share Controls** | Missing | `backend/app/models/share.py`<br>`backend/app/services/share_service.py`<br>`backend/app/api/shares.py`<br>`backend/tests/test_share_controls.py` | Server-enforced on every request: View-Once; Time-limited viewing (2 min, 10 min, 30 min, 1 hour, custom) with countdown starting at *first open* and persisted server-side; Max views; Expiry timestamp; Access mode (`VIEW_ONLY` vs `ALLOW_DOWNLOAD`); Instant revocation. Client countdown is display-only; system clock tampering must be thwarted. Tokens generated via `secrets.token_urlsafe(32)` and stored *hashed* (`SHA-256`) in the database. |
| **3** | **Secure Viewer** (`/share/:token`) | Missing | `frontend/src/pages/SecureViewer.tsx`<br>`frontend/src/components/WatermarkCanvas.tsx`<br>`frontend/src/index.css`<br>`backend/app/api/view.py` | Render PDF pages to HTML5 Canvas via `pdfjs-dist` (no native browser PDF toolbar). Strictly disable print, download, text selection (`user-select: none`), right-click context menu, and keyboard shortcuts (`Ctrl/Cmd+P`, `Ctrl/Cmd+S`). Add `@media print { body { display:none !important; } }`. Faint tiled watermark with viewer name, timestamp, and tracking hash overlaying canvas. Live server-synchronized countdown locking to "Access expired" upon expiry. Distinct screens for: revoked, expired, already used, max views reached, not your share, invalid link. Transparent DRM honest disclaimer. |
| **4** | **Watermarked Downloads** | Missing | `backend/app/services/watermark.py`<br>`backend/app/api/view.py`<br>`backend/tests/test_watermark.py` | Enabled strictly when sender explicitly permits `ALLOW_DOWNLOAD`. Dynamic PDF stamping on every page running diagonally with downloader's legal name, email, UTC timestamp, and unique `DL-xxxxxxxx` tracking ID using `pypdf` + `reportlab`. Decrypted and merged strictly in-memory (`io.BytesIO`). Every download appends a record to the immutable audit log. |
| **5** | **Notifications System** | Missing | `backend/app/models/notification.py`<br>`backend/app/api/notifications.py`<br>`frontend/src/components/Topbar.tsx`<br>`frontend/src/hooks/useNotifications.ts` | Top-bar bell with dynamic unread counter badge. Real-time events: `DOC_OPENED`, `DOC_EXPIRED`, `UNAUTHORIZED_ACCESS_ATTEMPT`. Support "Mark as read" and "Mark all read". Client polls endpoint `/api/notifications` every 20 seconds. |
| **6** | **Share Management** | Missing | `backend/app/api/shares.py`<br>`frontend/src/pages/ShareManagement.tsx`<br>`frontend/src/components/ShareModal.tsx`<br>`frontend/src/pages/Documents.tsx` | Dedicated "Share" action per document. "Shared Links" overview listing recipient, share type (Internal/Link), views used vs max, time remaining, first opened timestamp, status (`ACTIVE`, `EXPIRED`, `REVOKED`, `USED`), and a two-step confirmable "Revoke" button. |
| **7** | **Immutable Audit Log** | Missing | `backend/app/models/audit.py`<br>`backend/app/services/audit_service.py`<br>`backend/app/api/audit.py`<br>`frontend/src/pages/AuditLog.tsx` | Append-only database table: `OPEN`, `DOWNLOAD`, `REVOKE`, `FAILED_ATTEMPT`, `LOGIN`, `OTP_REQUEST`, `OTP_FAIL`. Captures actor ID, client IP (`X-Forwarded-For` / remote addr), user agent, UTC timestamp, event details, and outcome. Zero `UPDATE` or `DELETE` endpoints. Role-restricted Admin filtering interface (filter by action, date, actor). |
| **8** | **Internal Role-Based Sharing (RBAC)** | Missing | `backend/app/models/user.py`<br>`backend/app/services/rbac.py`<br>`backend/app/api/shares.py`<br>`frontend/src/components/ShareModal.tsx`<br>`frontend/src/pages/SharedWithMe.tsx` | Roles: `Admin` (Department Head), `Manager`, `Employee` with `reports_to_id` hierarchy. Backend policy engine: Admin shares to anyone in their department; Manager shares to direct reports and their direct Admin; Employee cannot create shares (HTTP 403, and action hidden in UI). Internal shares cryptographically bound to recipient user ID. Opening an internal token as a different user triggers HTTP 403, writes an `UNAUTHORIZED_ACCESS_ATTEMPT` audit row, and generates a security notification to the document owner. Tabbed Share modal ("Share via link" & "Share with team member"). "Shared with me" recipient page. |
| **9** | **Email OTP for External Links** | Missing | `backend/app/services/otp.py`<br>`backend/app/services/email.py`<br>`backend/app/api/auth.py`<br>`backend/app/api/view.py`<br>`frontend/src/pages/OtpVerification.tsx` | 6-digit numeric OTP, valid for 5 minutes, stored as salt + HMAC-SHA256/bcrypt hash, single-use. OTP code strictly never returned in API response, frontend state, or logs. 5 incorrect verification attempts lock the OTP session. 60-second resend cooldown timer. Maximum 5 OTP requests per email per hour. Uniform response: `"If this address is allowed, a code has been sent"` regardless of email authorization to prevent user enumeration. Dev mode connects via SMTP to Mailpit (`localhost:1025`, web UI `localhost:8025`). Prod mode supports Resend/SendGrid API keys. |
| **10** | **Deployment & Security Hardening** | Missing | `docker-compose.yml`<br>`backend/Dockerfile`<br>`frontend/Dockerfile`<br>`backend/app/core/config.py`<br>`backend/app/core/security_headers.py`<br>`.env.example` | Production `docker-compose.yml` comprising `backend`, `frontend`, `postgres`, `redis`, and `mailpit`. Redis-backed sliding-window rate limiter with graceful in-memory fallback in dev mode with logger warning. Cloudflare Turnstile integration on OTP endpoints (using official always-pass test keys in dev). Strict `HttpOnly`, `SameSite=Lax`, `Secure` session cookies. CORS locked to configured `FRONTEND_URL`. Security headers: CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Strict startup assertion refusing to boot in production if critical secrets are unset. Exhaustive `.env.example`. |

---

## Phase 2 Design System Directives

- **Product Identity:** "Ledger Vault".
- **Visual Aesthetic:** Serious institutional records system, calm, precise, typographic, information-dense, confident (law firm archive / government record repository aesthetic).
- **Prohibited:** No purple/indigo gradients, no glassmorphism, no emojis, no rounded-2xl cards, no bounce animations, no Inter/Poppins/Roboto.
- **Typography:** IBM Plex Sans (UI body), IBM Plex Mono (hashes, tokens, timestamps, countdowns), Newsreader (serif for titles & brand mark). Tabular numerals throughout.
- **Palette:** `--paper` (#F4F2EC), `--surface` (#FBFAF7), `--ink` (#1B1B18), `--ink-2` (#5C5A52), `--rule` (#DAD6CC), `--accent` (#8A2B1E oxblood). Dark theme tokens provided.
- **Components:** 240px fixed sidebar, hairline 1px rules, dense tables, status badges, slip-style Share modal with dynamic summary sentence, responsive across 1440px, 768px, 375px.

---

## Execution Plan & Order of Implementation

1. **Backend Foundation & Security Core:**
   - Architecture & directory layout: `backend/app/core/`, `backend/app/models/`, `backend/app/services/`, `backend/app/api/`.
   - Database ORM models (SQLAlchemy with SQLite dev / PostgreSQL prod): User, Department, Document, Share, OTPRequest, Notification, AuditLog.
   - Crypto service: AES-256-GCM encryption/decryption strictly in `io.BytesIO`.
   - Watermark service: Dynamic diagonal overlay using `reportlab` & `pypdf`.
   - RBAC rules and policy evaluation engine.
   - Token generation (`secrets.token_urlsafe(32)`) and SHA-256 storage.
   - OTP service with hashing, rate limiting, and Mailpit SMTP delivery.
   - Security middleware: Rate limiting, Turnstile verification, Security headers, Auth cookies.
2. **Phase 3 Seed Script:**
   - Multi-page PDF generation with `reportlab` (3–5 pages realistic text, tables, headers).
   - Meridian Labs hierarchy (Priya, Arjun, Kavya, Rohan, Vikram, Sneha, Aditya).
   - Encrypting documents through normal pipeline.
   - Pre-seeding S1–S7 shares covering all lifecycle states.
   - Pre-seeding notifications and 25 realistic audit log rows.
3. **Frontend Implementation & Redesign:**
   - Vite + React + TypeScript + Tailwind v3 configured with exact CSS variables and custom typography.
   - Google Fonts: IBM Plex Sans, IBM Plex Mono, Newsreader.
   - Layout: 240px sidebar, header with unread notifications polling every 20s.
   - Split login screen, Documents table, Share modal (slip layout with live sentence), "Shared with me", "Shared links" management, Audit log with filters.
   - Secure Viewer at `/share/:token` with Canvas rendering via `pdfjs-dist`, live countdown, tiled watermark overlay, print/save blocking, disclaimer, and error screens.
4. **Phase 4 Testing & Verification:**
   - Comprehensive backend test suite (`pytest` + `httpx`) covering all 12 mandatory cases.
   - Automated verification script checking zero plaintext disk writes.
   - Browser & responsive testing, screenshots in `/qa/screenshots`.
   - Deliverables: `README.md`, `QA_REPORT.md`, `.env.example`, `docker-compose.yml`.
