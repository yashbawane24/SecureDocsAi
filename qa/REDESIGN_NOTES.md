# SecureDocs AI — Frontend Redesign Documentation

## Executive Summary
The entire user interface of **SecureDocs AI** has been redesigned to achieve pixel-for-pixel fidelity with the reference designs (`SecureDocs_Landing.png` and `SecureDocs_Dashboard.png`) while strictly maintaining all existing backend APIs, database models, and business logic without any modifications.

---

## 1. Design System & Typography (`src/styles/tokens.css`)
- **Theme**: Navy + Cyan control-room security palette. Green is strictly prohibited except for the `Low` risk level indicator.
- **Typography**:
  - `Plus Jakarta Sans` (weights 400, 500, 600, 700) bundled locally via `@fontsource/plus-jakarta-sans`. Applied to all UI text, headings, buttons, and big metric values.
  - `JetBrains Mono` (weights 500, 600) bundled locally via `@fontsource/jetbrains-mono`. Strictly scoped to timers, document/share IDs, cryptographic hashes, file sizes, masked PII values, email addresses in tables, access rules, and chart axis labels.
  - Headings: weight 700, letter-spacing `-0.03em`. Page title 28px, landing section title 44px, card titles 15.5px, body text 14px, secondary text 12.5px.
  - Metric Numbers: 36px, weight 700, letter-spacing `-0.04em`, line-height 1.05.
- **Color Variables**:
  - Backgrounds: `--bg: #E7EBF2` (behind app shell), `--landing-bg: #F2F4F8` (landing page), `--panel: #F5F7FA` (main inner content panel), `--surface: #FFFFFF` (cards).
  - Borders: `--line: #E1E6EE`.
  - Inks: `--ink: #0B1220` (primary text), `--ink2: #566275` (secondary text), `--ink3: #8892A3` (muted labels/placeholders).
  - Navy & Cyan: `--navy: #0A1324` (sidebar, landing hero, primary buttons), `--navy-2: #121F38` (elevated items on navy), `--cyan: #5BE0FF` (active nav items, download chart bars, primary buttons on navy).
  - Accents & Cards: `--ice: #E3ECFB` with border `--ice-border: #CCDCF5` (Risk overview card), `--danger-card-bg: #FFF6F4` with border `--danger-card-border: #F6D6D1` (Blocked access attempts card), `--accent: #2457D6` (sparklines, links, positive week-over-week deltas).
  - Risk Tokens: Low (`#1F8A5B` on `#E3F3EA`), Medium (`#B7791F` on `#FBF1DE`), High (`#C2571A` on `#FDEEE4`), Critical (`#B42318` on `#FDECEA`).
- **Card Geometry & Spacing**:
  - Radius 20px on cards, 24px on main panel and sidebar, 32px on landing hero.
  - 14px gap between dashboard grid cards. Zero drop shadows.

---

## 2. Landing Page (`/` — `SecureDocs_Landing.png`)
The landing page was constructed with exact section-by-section fidelity:
1. **Top Navigation**: Navy rounded-square logo with cyan lock-file icon, links to Features, How it works, Roles, and Security, and pill buttons: *"Open a shared link"* (secondary pill) and *"Sign in"* (navy pill scrolling to roles).
2. **Hero Panel**: Large 32px rounded navy panel with subtle fade-out grid texture.
   - Left: Cyan pill chip *"Encrypted sharing with AI risk scoring"*, headline *"Share sensitive files. Keep control after you hit send."* with "Keep control" highlighted in `--cyan`, subtext, CTA buttons *"Choose your sign-in"* (cyan pill) and *"See how it works"* (white outline pill), and three security proof points.
   - Right: Interactive CSS composition featuring a tilted document card with redacted PII badges (`[AADHAAR]`, `[PAN]`, `[BANK A/C]`), diagonal watermark, a floating SVG gauge card (Risk Score 82, CRITICAL), a ticking live countdown card (`09:41 · View once`), and a cyan Safe Copy badge (`Risk 82 → 18`).
3. **Four-Column Stats Row**: Separated by vertical 1px divider lines: `AES-256-GCM`, `14 detectors`, `0–100`, and `1 click`.
4. **"What it does" Feature Grid**: Side-by-side title/paragraph layout above 3 cards: PII findings table (white card), share controls with active switches (navy card), and safe copies with removed items (navy card).
5. **"Pick your role to sign in" Grid**: 4 role cards with the Owner & Admin card highlighted in navy. Each card displays role badge, description, bulleted capabilities, and an arrow sign-in button.
6. **Bottom External Link Bar**: Rounded banner with lock icon, explanatory text, and quick-action buttons (*"Join with invite code"*, *"Create organisation"*, and *"Open shared link"*).

---

## 3. Role-Based Portals & Access Control
- Dedicated authentication portals:
  - `/login/admin`: Owner & Administrator
  - `/login/head`: Department Head
  - `/login/manager`: Team Manager
  - `/login/employee`: Individual Contributor
  - `/open`: Dedicated recipient verification portal for external OTP shares
  - `/login`: Cleanly redirects to `/#roles`
- **Role Verification Guard**:
  - If a user signs into the wrong portal (e.g., Karthik the Manager signs in at `/login/admin`), the frontend detects the role mismatch after authentication, immediately clears the session, and presents an informative inline alert:
    `"This is a Manager account. Use Manager sign-in."`
    with a direct one-click redirect button to `/login/manager?email=karthik%40northwind.test`, preserving the user's entered email.
  - Verified and confirmed in automated testing (`role_redirect_test: passed: true`).

---

## 4. Role-Aware Dashboard (`SecureDocs_Dashboard.png`)
- **App Shell**: Outer page `--bg: #E7EBF2` with 16px padding. 256px sticky navy sidebar with 24px rounded corners and cyan active item indicator. Main panel `--panel: #F5F7FA` with 24px rounded corners and 26px padding.
- **Top Metric Cards (4 columns, 14px gap)**:
  - *Critical-risk documents*: Dark navy card, 36px number, cyan mini bar chart.
  - *Active shares*: White card, 36px number, +3 vs last week in `--accent` (`#2457D6`), blue sparkline.
  - *Views this week*: White card, 36px number, +18% in `--accent`, blue sparkline.
  - *Blocked access attempts*: `#FFF6F4` soft red card with `#F6D6D1` border, 36px number, last attempt actor and timestamp, red trend line.
- **Middle Row (8/4 Split Grid)**:
  - Left: *Views per day* 14-day stacked bar chart card with grey view bars, cyan download caps, dark navy active day bar, interactive selection, and navy hover tooltip.
  - Right: *Risk overview* soft blue card (`--ice: #E3ECFB`, border `--ice-border: #CCDCF5`), 36px scanned count, 4-color horizontal stacked distribution bar, and white pill rows with colored risk dots and category counts.
- **Bottom Row (8/4 Split Grid)**:
  - Left: *Recent shares* card with risk level filter dropdown, *Export CSV* action, and responsive tabular data (document icon, title, recipient avatar, risk badge, access rules, status chip).
  - Right: *Pending approvals* review queue with one-click *Approve* and *Reject* actions, followed by *Expiring soon* list with live JetBrains Mono countdown timers.
- **Role-Aware Views**:
  - *Department Head*: Department-scoped metrics, department recent shares, member join requests.
  - *Manager*: Team-scoped metrics, team documents, member join approval list.
  - *Employee*: Personal metrics, quick-upload dropzone, "Shared with me" and "Shared by me" tabs.

---

## 5. Automated Verification Results (`qa/verify_redesign.py`)
- **Total Checks Executed**: 27 browser sessions across desktop (`1440px`) and mobile (`390px`) viewports.
- **Horizontal Overflows**: `0` (Zero horizontal overflow across all tested routes and viewports).
- **Green Theme Leaks**: `0` (Strictly zero legacy `#1E6B52` or rogue green colors detected).
- **Role Redirect Guard**: `Passed` (verified email prefill and direct portal switching).
- **Verification Summary**:
  - `landing_1440`: 1440px / 1440px (overflow: false, green leaks: 0)
  - `landing_390`: 390px / 390px (overflow: false, green leaks: 0)
  - `login_admin_1440` / `login_admin_390`: (overflow: false, green leaks: 0)
  - `login_head_1440` / `login_head_390`: (overflow: false, green leaks: 0)
  - `login_manager_1440` / `login_manager_390`: (overflow: false, green leaks: 0)
  - `login_employee_1440` / `login_employee_390`: (overflow: false, green leaks: 0)
  - `open_link_1440` / `open_link_390`: (overflow: false, green leaks: 0)
  - `dashboard_meera_owner_1440` / `dashboard_meera_owner_390`: (overflow: false, green leaks: 0)
  - `dashboard_ananya_head_1440` / `dashboard_ananya_head_390`: (overflow: false, green leaks: 0)
  - `dashboard_karthik_manager_1440` / `dashboard_karthik_manager_390`: (overflow: false, green leaks: 0)
  - `dashboard_divya_employee_1440` / `dashboard_divya_employee_390`: (overflow: false, green leaks: 0)
  - `documents_1440`, `document_detail_1440`, `approvals_1440`, `audit_log_1440`, `members_1440`, `settings_1440`, `secure_viewer_1440`: (overflow: false, green leaks: 0)

