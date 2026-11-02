# QA_REPORT.md — Quality Assurance, Risk Analysis & Security Verification Report

**Product:** SecureDocs AI (Sensitive Document Control, NLP Risk Analysis & Redaction Platform)  
**Evaluated Organizations:** Northwind Health (`northwind.test`, Invite Code `NWH-2026`) & Orbitline Systems (`orbitline.test`, Invite Code `ORB-2026`)  
**Assessment Date:** 2026-10-29  
**Version:** 3.0.0 (PART A Bug Fixes + PART B Sensitive Data Detection, Risk Score & Redaction + PART C E2E & Visual QA)  

---

## 1. Executive Summary

**SecureDocs AI** (renamed from Ledger Vault across all UI views, browser titles, emails, exports, and reports) underwent complete automated unit, integration, end-to-end browser, and multi-viewport visual verification across **PART A**, **PART B**, and **PART C**:

1. **PART A Bug Fixes Verified (A1–A7):**
   - **A1 (Organisation Settings):** Fixed `/api/org/settings` (`GET` & `PATCH`) and `/api/org/invite-code/regenerate` (`POST`) requiring `org.settings` permission. All fields load with real database values, and the dirty-aware **Save changes** button updates the UI live without a page refresh.
   - **A2 (Invite Code & Join Link):** Invite code (`NWH-2026`) is displayed in **Settings → Access & Membership** and **Members → Invite people** (2-tab modal with `"Invite by email"` and `"Share join link"` showing the code, full `/join?code=NWH-2026` URL, Copy button, inline QR code SVG, and Regenerate button with confirmation). Visiting `/join?code=NWH-2026` pre-fills the code and places new joiners in `PENDING` status until approved.
   - **A3 (External OTP Links & Mailpit):** Visiting `/s/:token` displays `"Verify your email"` and never starts the countdown timer or increments `views_used` until after 6-digit OTP verification. Code screen shows `"We sent a 6-digit code to l***@medisupply.test. It expires in 5 minutes."` with a 60-second resend countdown. Supports `MAIL_MODE=mailpit | smtp | resend`.
   - **A4 (Audit & Shares CSV Export):** Streaming `GET /api/audit/export.csv` and `GET /api/shares/export.csv` endpoints respect active UI filters, sanitize cells starting with `=`, `+`, `-`, `@`, or `\t` against CSV formula injection, and log `AUDIT_EXPORT`.
   - **A5 (Instant Live UI Updates):** Centralized TanStack Query keys in `frontend/src/api/queryKeys.ts`, optimistic updates with rollback on mark-read / mark-all-read / revoke, and live Server-Sent Events (`GET /api/events/stream`) with 20-second polling fallback.
   - **A6 (View-Once & Strict Viewing Screenshot Deterrence):** Default press-and-hold blur (`filter: blur(18px)` until mouse/touch hold), instant full-viewport black overlay on `window` `blur`, `visibilitychange` (`hidden`), `mouseleave`, `PrintScreen` `keyup` (plus clipboard clear), `Cmd/Ctrl+Shift+3/4/5`, `Win+Shift+S`, and DevTools size-delta detection, heavy diagonal watermark, and `SCREENSHOT_ATTEMPT_SUSPECTED` audit logging + sender notification.
   - **A7 (Plain-Language Status Screens):** Rewrote all viewer status screens in plain language (`"This link has expired"`, `"The time limit set by the sender has ended. Ask them to share the document again if you still need it."`) and removed all banned jargon (`"disclosure"`, `"custody"`, `"zero-trust"`, `"memory buffers purged"`).
2. **PART B Sensitive Data Detection, Risk Score & Redaction Verified (B1–B8):**
   - **3-Layer In-Memory Scanner:** Presidio + spaCy NER, custom Indian & secret recognizers (Verhoeff-validated `IN_AADHAAR`, `IN_PAN`, `IN_GSTIN`, `IN_IFSC`, `IN_UPI_ID`, `IN_PASSPORT`, `IN_VOTER_ID`, `IN_VEHICLE_REG`, `IN_PHONE`, contextual `BANK_ACCOUNT`, and `SECRETS`), and document classifiers.
   - **Zero Raw Sensitive Values Stored:** Verified via database inspection and DOM assertions that only masked values, salted SHA-256 hashes, bounding boxes, and masked context snippets are stored or rendered.
   - **Explainable 0–100 Risk Score & Policy Enforcement:** Enforces `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL` sharing rules on both backend (`HTTP 403` + `SHARE_BLOCKED_BY_RISK_POLICY`) and frontend (`ShareModal` + `/approvals` workflow).
   - **True PDF Redaction (`PyMuPDF`) & Password Protection (`pypdf`):** Verified that redacted text is permanently removed from the underlying PDF stream (`page.get_text()` contains zero redacted characters), metadata/XMP/attachments are scrubbed, and re-scanning the safe copy yields a lower risk score.

---

## 2. Automated Test Execution Results

### A. Backend Unit & Integration Suite (`pytest backend/tests/test_part_a_b.py`)

| Test Name | Requirement Verified | Result |
|---|---|---|
| `test_aadhaar_verhoeff_checksum` | B2: Verhoeff checksum accepts valid 12-digit Aadhaar (first digit 2–9) and rejects single-digit flips | **PASSED** |
| `test_pan_regex_and_context_boost` | B2: `IN_PAN` regex `[A-Z]{5}[0-9]{4}[A-Z]` confidence boosted when near `"pan"` / `"income tax"` | **PASSED** |
| `test_credit_card_luhn_check` | B2: Credit card Luhn checksum validation | **PASSED** |
| `test_risk_score_formula_diminishing_cooccurrence_spread_and_cap` | B4: Logarithmic diminishing returns, co-occurrence bonuses, multi-page spread, and 0–100 cap | **PASSED** |
| `test_value_masking_never_leaks_raw` | B3: Masking formats (`XXXX XXXX 4821`, `ABCDE****F`, `a****@northwind.test`, masked secrets) | **PASSED** |
| `test_true_pdf_redaction_removes_text_and_metadata` | B6: PyMuPDF `apply_redactions()` permanently deletes underlying text from PDF stream and scrubs metadata | **PASSED** |
| `test_csv_formula_injection_escaping` | A4: Cells starting with `=`, `+`, `-`, `@`, `\t` are prefixed with `'` | **PASSED** |
| `test_b8_seeded_documents_and_zero_raw_values_in_db` | B3 & B8: All 5 seeded B8 documents match target risk levels and zero raw secrets exist in `document_findings` | **PASSED** |
| `test_a1_org_settings_get_patch_and_regenerate` | A1 & A2: `GET /api/org/settings`, `PATCH /api/org/settings`, `POST /api/org/invite-code/regenerate` | **PASSED** |
| `test_a3_external_otp_flow_and_mailpit_delivery` | A3: Visiting `/s/:token/status` does not start timer; OTP arrives in Mailpit; verifying opens share | **PASSED** |
| `test_a4_audit_csv_export_and_audit_log_entry` | A4: `GET /api/audit/export.csv` streams 11-column CSV and records `AUDIT_EXPORT` | **PASSED** |
| `test_b5_b6_risk_policy_enforcement_approval_and_safe_copy` | B5 & B6: Critical share blocked (`403`), approval workflow creates share, and Safe Copy reduces risk score | **PASSED** |

**Backend Test Summary:** `12 passed in 1.55s` (100% Pass Rate)

---

### B. Playwright End-to-End Browser & Visual QA Suite (`tests_e2e_part_abc.py`)

| Check ID | E2E Scenario Verified | Result |
|---|---|---|
| `A2.JoinPrefill` | `/join?code=NWH-2026` pre-fills invite code and displays SecureDocs AI branding | **PASSED** |
| `B7.Dashboard` | Dashboard loads with SecureDocs AI branding, Risk overview card, and live counts | **PASSED** |
| `A1.OrgSettings` | Organisation settings loads all fields, Risk policy, invite code `NWH-2026`, and dirty-aware Save changes works without reload | **PASSED** |
| `A2.InviteModal` | Members page `"Invite people"` modal shows both tabs, join link, `NWH-2026` code, QR code SVG, and Regenerate button | **PASSED** |
| `A5.MemberApproveLive` | Approving pending member updates Pending/Active counts live without page reload | **PASSED** |
| `A5.NotificationsLive` | Marking notifications read updates badge & list immediately via optimistic TanStack Query update | **PASSED** |
| `B7.DocumentsRiskTable` | Documents table displays Risk column with Low/Medium/High/Critical chips and Risk filter | **PASSED** |
| `B1.UploadTxtAndScanLive` | Uploading `.txt` file converts to PDF in memory, scans sensitive entities, and updates table live without reload | **PASSED** |
| `B7.RiskAnalysisTab` | Document Risk analysis tab renders 0–100 score dial, `"Why this score"`, category summary, heatmap, and masked findings only | **PASSED** |
| `B7.ShowOnPageHighlight` | `"Show on page"` scrolls to PDF page and renders highlight bounding box on canvas | **PASSED** |
| `B6.SafeCopyCreation` | Creating a safe copy applies true PyMuPDF redaction, AES-256 password encryption, and displays reduced risk score + one-time password | **PASSED** |
| `B5.ShareModalRiskPolicy` | Share modal enforces Critical risk policy, recommending Safe Copy or Owner/Admin approval | **PASSED** |
| `B5.ApprovalsWorkflow` | Approvals page (`/approvals`) lists Critical share requests and allows Owner/Admin approval or rejection | **PASSED** |
| `A4.CsvExportButtons` | Audit log and Shared links pages provide Export CSV buttons respecting active filters | **PASSED** |
| `A7.PlainLanguageErrorScreens` | Expired screen shows exact plain-language title, message, and `"Go to dashboard"` button with zero banned jargon | **PASSED** |
| `A3.ExternalOtpAndMailpit` | External `/s/:token` link verifies email via Mailpit 6-digit OTP and opens document without premature expiry | **PASSED** |
| `A6.ScreenshotDeterrence` | Strict viewer blurs until press-and-hold, blacks out instantly on capture triggers, and logs `SCREENSHOT_ATTEMPT_SUSPECTED` | **PASSED** |

---

## 3. Visual QA Screenshot Inventory (`qa/after/`)

All 15 changed/new screens were captured at both **Desktop (`1440×900`)** and **Mobile (`390×844`)** viewports in both **Light** and **Dark** themes (`60` screenshots in `qa/after/`):

| Page / Component | Light (`1440` & `390`) | Dark (`1440` & `390`) |
|---|---|---|
| **Join Page Pre-filled (`/join?code=NWH-2026`)** | `join-prefilled-1440-light.png`<br>`join-prefilled-390-light.png` | `join-prefilled-1440-dark.png`<br>`join-prefilled-390-dark.png` |
| **Dashboard Risk Overview (`/dashboard`)** | `dashboard-risk-overview-1440-light.png`<br>`dashboard-risk-overview-390-light.png` | `dashboard-risk-overview-1440-dark.png`<br>`dashboard-risk-overview-390-dark.png` |
| **Organisation Settings & Risk Policy (`/settings`)** | `org-settings-1440-light.png`<br>`org-settings-390-light.png` | `org-settings-1440-dark.png`<br>`org-settings-390-dark.png` |
| **Members Invite Modal & QR Code (`/members`)** | `members-invite-modal-1440-light.png`<br>`members-invite-modal-390-light.png` | `members-invite-modal-1440-dark.png`<br>`members-invite-modal-390-dark.png` |
| **Documents Table with Risk Column (`/documents`)** | `documents-risk-table-1440-light.png`<br>`documents-risk-table-390-light.png` | `documents-risk-table-1440-dark.png`<br>`documents-risk-table-390-dark.png` |
| **Document Risk Analysis Tab (`/documents/:id?tab=risk`)** | `document-risk-analysis-1440-light.png`<br>`document-risk-analysis-390-light.png` | `document-risk-analysis-1440-dark.png`<br>`document-risk-analysis-390-dark.png` |
| **Create Redacted Safe Copy Modal** | `safe-copy-modal-1440-light.png`<br>`safe-copy-modal-390-light.png` | `safe-copy-modal-1440-dark.png`<br>`safe-copy-modal-390-dark.png` |
| **Risk-Aware Share Modal** | `share-modal-risk-policy-1440-light.png`<br>`share-modal-risk-policy-390-light.png` | `share-modal-risk-policy-1440-dark.png`<br>`share-modal-risk-policy-390-dark.png` |
| **Critical Share Approvals Queue (`/approvals`)** | `approvals-page-1440-light.png`<br>`approvals-page-390-light.png` | `approvals-page-1440-dark.png`<br>`approvals-page-390-dark.png` |
| **Audit Log with CSV Export (`/audit`)** | `audit-log-export-1440-light.png`<br>`audit-log-export-390-light.png` | `audit-log-export-1440-dark.png`<br>`audit-log-export-390-dark.png` |
| **Plain-Language Expired Screen (`/viewer/4`)** | `expired-plain-language-1440-light.png`<br>`expired-plain-language-390-light.png` | `expired-plain-language-1440-dark.png`<br>`expired-plain-language-390-dark.png` |
| **External OTP Step 1 — Verify Email (`/s/:token`)** | `otp-email-step-1440-light.png`<br>`otp-email-step-390-light.png` | `otp-email-step-1440-dark.png`<br>`otp-email-step-390-dark.png` |
| **External OTP Step 2 — 6-Digit Code & Countdown** | `otp-code-step-1440-light.png`<br>`otp-code-step-390-light.png` | `otp-code-step-1440-dark.png`<br>`otp-code-step-390-dark.png` |
| **Strict Viewer — Press & Hold Blur Deterrence** | `strict-viewer-press-hold-1440-light.png`<br>`strict-viewer-press-hold-390-light.png` | `strict-viewer-press-hold-1440-dark.png`<br>`strict-viewer-press-hold-390-dark.png` |
| **Strict Viewer — Instant Capture Blackout Overlay** | `strict-viewer-blackout-1440-light.png`<br>`strict-viewer-blackout-390-light.png` | `strict-viewer-blackout-1440-dark.png`<br>`strict-viewer-blackout-390-dark.png` |
