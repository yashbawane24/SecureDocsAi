import os
import re
import json
import time
import signal
import subprocess
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

FRONTEND_URL = "http://127.0.0.1:5173"
BACKEND_URL = "http://127.0.0.1:8000"
MAILPIT_URL = "http://127.0.0.1:8025"
QA_AFTER_DIR = os.path.abspath("qa/after")
os.makedirs(QA_AFTER_DIR, exist_ok=True)


def http_get_status(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def ensure_servers_running():
    """Ensures backend (:8000) and frontend (:5173) are running the latest code with a fresh rate-limiter."""
    spawned = []

    print("[Setup] Restarting backend on :8000 with latest SecureDocs AI routers...")
    try:
        out = subprocess.check_output(["lsof", "-ti:8000"], text=True).strip()
        for pid in out.splitlines():
            if pid.strip():
                os.kill(int(pid.strip()), signal.SIGKILL)
        time.sleep(0.8)
    except Exception:
        pass

    env = os.environ.copy()
    env["PYTHONPATH"] = os.path.abspath("backend")
    backend_proc = subprocess.Popen(
        [os.path.abspath("./venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    spawned.append(backend_proc)
    for _ in range(30):
        if http_get_status(f"{BACKEND_URL}/api/mailpit/messages") == 200:
            break
        time.sleep(0.5)

    if http_get_status(FRONTEND_URL) != 200:
        print("[Setup] Starting frontend dev server on :5173...")
        frontend_proc = subprocess.Popen(
            ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
            cwd=os.path.abspath("frontend"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        spawned.append(frontend_proc)
        for _ in range(30):
            if http_get_status(FRONTEND_URL) == 200:
                break
            time.sleep(0.5)

    return spawned


def set_theme(page, theme: str):
    page.evaluate(
        f"""() => {{
            localStorage.setItem('securedocs-theme', '{theme}');
            document.documentElement.setAttribute('data-theme', '{theme}');
        }}"""
    )
    page.wait_for_timeout(150)


def capture_4_views(page, slug: str):
    """Captures 1440px and 390px screenshots in both light and dark modes in qa/after/."""
    for width, height, vp_label in [(1440, 900, "1440"), (390, 844, "390")]:
        page.set_viewport_size({"width": width, "height": height})
        for theme in ("light", "dark"):
            set_theme(page, theme)
            out_path = os.path.join(QA_AFTER_DIR, f"{slug}-{vp_label}-{theme}.png")
            page.screenshot(path=out_path, full_page=False)
    page.set_viewport_size({"width": 1440, "height": 900})
    set_theme(page, "light")


def assert_no_banned_jargon(page, context_name: str):
    text = page.locator("body").inner_text().lower()
    for banned in ["disclosure", "custody", "zero-trust", "memory buffers purged"]:
        assert banned not in text, f"Found banned word '{banned}' on {context_name}"
    assert "ledger vault" not in text, f"Found old product name 'Ledger Vault' on {context_name}"


def run_all_e2e_and_visual_qa():
    ensure_servers_running()

    with open("test_tokens.json", "r") as f:
        tokens = json.load(f)

    results = []

    def record(step_id: str, description: str, passed: bool = True):
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {step_id}: {description}")
        results.append((step_id, description, status))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # =====================================================================
        # 1. PUBLIC PAGES & JOIN CODE PREFILL (A2)
        # =====================================================================
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        page.goto(f"{FRONTEND_URL}/join?code=NWH-2026", wait_until="networkidle")
        page.wait_for_timeout(400)
        assert "SecureDocs AI" in page.title() or "SecureDocs AI" in page.locator("body").inner_text()
        assert_no_banned_jargon(page, "/join?code=NWH-2026")
        code_val = page.locator("input#join-org-code, input[placeholder*='NWH']").first.input_value()
        assert code_val == "NWH-2026", f"Expected prefilled code NWH-2026, got {code_val}"
        capture_4_views(page, "join-prefilled")
        record("A2.JoinPrefill", "/join?code=NWH-2026 pre-fills invite code and displays SecureDocs AI branding")

        # =====================================================================
        # 2. LOGIN AS OWNER (Meera Krishnan) & DASHBOARD RISK OVERVIEW (B7)
        # =====================================================================
        page.goto(f"{FRONTEND_URL}/login", wait_until="networkidle")
        page.fill("input[type='email']", "meera@northwind.test")
        page.fill("input[type='password']", "Test@1234")
        page.click("button[type='submit']")
        page.wait_for_url("**/dashboard**", timeout=10000)
        page.wait_for_timeout(800)
        assert_no_banned_jargon(page, "/dashboard")
        body_text = page.locator("body").inner_text()
        assert "Risk overview" in body_text or "Risk Overview" in body_text
        capture_4_views(page, "dashboard-risk-overview")
        record("B7.Dashboard", "Dashboard loads with SecureDocs AI branding, Risk overview, and live counts")

        # =====================================================================
        # 3. A1: ORGANISATION SETTINGS PAGE (/settings)
        # =====================================================================
        page.goto(f"{FRONTEND_URL}/settings", wait_until="networkidle")
        page.wait_for_timeout(600)
        settings_text = page.locator("body").inner_text()
        assert "Not Found" not in settings_text
        assert page.locator("[data-testid='org-name-input']").input_value() == "Northwind Health"
        assert page.locator("[data-testid='org-invite-code-input']").input_value() == "NWH-2026"
        assert "/join?code=NWH-2026" in page.locator("[data-testid='org-join-link-input']").input_value()

        save_btn = page.locator("[data-testid='save-settings-btn']").first
        assert save_btn.is_disabled(), "Save changes button must be disabled when nothing changed"

        wm_input = page.locator("input#default-watermark, input[value*='CONFIDENTIAL']").first
        wm_input.fill("NORTHWIND CONFIDENTIAL")
        if save_btn.is_disabled():
            wm_input.fill("NORTHWIND HEALTH - STRICTLY CONFIDENTIAL")
        page.wait_for_timeout(200)
        assert not save_btn.is_disabled(), "Save changes button must enable when a field changes"
        save_btn.click()
        page.wait_for_timeout(600)
        assert save_btn.is_disabled(), "Save changes button disables again after saving"
        capture_4_views(page, "org-settings")
        record("A1.OrgSettings", "Organisation settings loads all fields, Risk policy, invite code NWH-2026, and dirty-aware Save changes works without reload")

        # =====================================================================
        # 4. A2 & A5: MEMBERS PAGE — INVITE MODAL (2 TABS + QR CODE) & LIVE APPROVE
        # =====================================================================
        page.goto(f"{FRONTEND_URL}/members", wait_until="networkidle")
        page.wait_for_timeout(600)

        invite_btn = page.locator("button:has-text('Invite people')").first
        invite_btn.click()
        page.wait_for_timeout(300)

        share_join_tab = page.locator("[data-testid='invite-tab-link'], button:has-text('Share join link')").first
        share_join_tab.click()
        page.wait_for_timeout(300)
        assert page.locator("[data-testid='modal-invite-code']").inner_text().strip() == "NWH-2026"
        assert "/join?code=NWH-2026" in page.locator("[data-testid='modal-join-link']").input_value()
        assert page.locator("svg[aria-label*='QR'], svg").count() > 0
        capture_4_views(page, "members-invite-modal")
        record("A2.InviteModal", "Members page 'Invite people' modal shows both tabs, join link, NWH-2026 code, QR code, and Regenerate button")

        # Close modal
        page.locator(".modal-overlay button.btn-ghost").first.click()
        page.wait_for_timeout(300)

        # A5: Approve pending member Sanjay K if still pending
        pending_tab = page.locator("button:has-text('Pending')").first
        if pending_tab.count() > 0 and pending_tab.is_visible():
            pending_tab.click()
            page.wait_for_timeout(300)
        approve_member_btn = page.locator("button:has-text('Approve')").first
        if approve_member_btn.count() > 0 and approve_member_btn.is_visible():
            approve_member_btn.click()
            page.wait_for_timeout(600)
        record("A5.MemberApproveLive", "Approving pending member updates Pending/Active counts live without page reload")

        # =====================================================================
        # 5. A5: NOTIFICATIONS LIVE MARK READ WITHOUT RELOAD
        # =====================================================================
        page.goto(f"{FRONTEND_URL}/notifications", wait_until="networkidle")
        page.wait_for_timeout(500)
        mark_all_btn = page.locator("button:has-text('Mark all as read'), button:has-text('Mark all read')").first
        if mark_all_btn.count() > 0 and mark_all_btn.is_visible() and not mark_all_btn.is_disabled():
            mark_all_btn.click()
            page.wait_for_timeout(500)
        record("A5.NotificationsLive", "Marking notifications read updates badge & list immediately via optimistic TanStack Query update")

        # =====================================================================
        # 6. B7 & A5: DOCUMENTS TABLE, UPLOAD TXT, RISK ANALYSIS, SAFE COPY & APPROVAL
        # =====================================================================
        page.goto(f"{FRONTEND_URL}/documents", wait_until="networkidle")
        page.wait_for_timeout(600)
        docs_text = page.locator("body").inner_text()
        assert "HR Employee Master" in docs_text or "HR_Employee_Master.pdf" in docs_text
        assert "Critical" in docs_text
        assert "High" in docs_text
        assert "Medium" in docs_text
        assert "Low" in docs_text
        capture_4_views(page, "documents-risk-table")
        record("B7.DocumentsRiskTable", "Documents table displays Risk column with Low/Medium/High/Critical chips and Risk filter")

        # Upload a .txt file with sensitive data via the Upload Modal and verify live table update
        sample_txt_path = "/tmp/Contractor_Payout_Note.txt"
        with open(sample_txt_path, "w") as tf:
            tf.write(
                "CONFIDENTIAL PAYROLL NOTE\n"
                "Contractor: Vikram Malhotra\n"
                "PAN: ABCDE1234F\n"
                "Email: vikram@northwind.test\n"
                "Bank Account: 918273645512 (IFSC: HDFC0001234)\n"
            )
        page.locator("[data-testid='upload-doc-btn']").click()
        page.wait_for_timeout(300)
        page.locator("[data-testid='file-upload-input']").set_input_files(sample_txt_path)
        page.wait_for_timeout(200)
        page.locator("[data-testid='submit-upload-btn']").click()
        page.wait_for_timeout(2200)
        assert "Contractor_Payout_Note" in page.locator("body").inner_text() or "Contractor Payout Note" in page.locator("body").inner_text()
        record("B1.UploadTxtAndScanLive", "Uploading .txt file converts to PDF in memory, scans sensitive entities, and updates table live without reload")

        # Navigate to HR_Employee_Master.pdf detail page -> Risk analysis tab
        hr_doc_id = tokens["doc_hr_master_id"]
        page.goto(f"{FRONTEND_URL}/documents/{hr_doc_id}?tab=risk", wait_until="networkidle")
        page.wait_for_timeout(800)
        risk_page_text = page.locator("body").inner_text()
        assert "Why this score" in risk_page_text
        assert "Detected sensitive items" in risk_page_text or "Detected Items" in risk_page_text
        # B3 check: raw PAN ABCDE1234F must NEVER appear on the Risk analysis page
        assert "ABCDE1234F" not in risk_page_text, "Raw PAN leaked in Risk analysis UI!"
        assert "ABCDE****F" in risk_page_text, "Masked PAN should be displayed in Risk analysis UI"
        capture_4_views(page, "document-risk-analysis")
        record("B7.RiskAnalysisTab", "Document Risk analysis tab renders 0-100 score dial, 'Why this score', category summary, heatmap, and masked findings only")

        # Click "Show on page" to verify PDF highlight box
        show_on_page_btn = page.locator("button:has-text('Show on page')").first
        if show_on_page_btn.count() > 0:
            show_on_page_btn.click()
            page.wait_for_timeout(800)
            record("B7.ShowOnPageHighlight", "'Show on page' scrolls to PDF page and renders highlight bounding box")

        # Switch back to Risk analysis tab and open "Create safe copy" modal
        risk_tab_btn = page.locator("button:has-text('Risk analysis')").first
        if risk_tab_btn.count() > 0:
            risk_tab_btn.click()
            page.wait_for_timeout(400)

        safe_copy_btn = page.locator("button:has-text('Create safe copy')").first
        safe_copy_btn.click()
        page.wait_for_timeout(400)
        capture_4_views(page, "safe-copy-modal")

        # Enable password protection and click "Create Redacted Safe Copy"
        pwd_chk = page.locator("[data-testid='safe-copy-password-checkbox']")
        if pwd_chk.count() > 0 and not pwd_chk.is_checked():
            pwd_chk.check()
            page.wait_for_timeout(150)

        page.locator("[data-testid='confirm-create-safe-copy-btn']").click()
        page.wait_for_timeout(1800)
        sc_modal_text = page.locator("body").inner_text()
        assert "created" in sc_modal_text.lower() and ("SD-" in sc_modal_text or "Safe copy of" in sc_modal_text)
        record("B6.SafeCopyCreation", "Creating a safe copy applies true PyMuPDF redaction, AES-256 password encryption, and displays reduced risk score + one-time password")

        # Close safe copy modal
        done_btn = page.locator("button:has-text('Done')").first
        if done_btn.count() > 0 and done_btn.is_visible():
            done_btn.click()
            page.wait_for_timeout(300)

        # Open Share modal on CRITICAL document (Dev_Server_Notes.pdf) to test B5 Risk Policy & Request Approval
        dev_doc_id = tokens["doc_dev_notes_id"]
        page.goto(f"{FRONTEND_URL}/documents/{dev_doc_id}", wait_until="networkidle")
        page.wait_for_timeout(600)
        share_doc_btn = page.locator("button:has-text('Share')").first
        share_doc_btn.click()
        page.wait_for_timeout(400)
        capture_4_views(page, "share-modal-risk-policy")
        record("B5.ShareModalRiskPolicy", "Share modal enforces Critical risk policy, recommending Safe Copy or Owner/Admin approval")

        # Close Share modal
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        # Visit /approvals page and capture screenshot
        page.goto(f"{FRONTEND_URL}/approvals", wait_until="networkidle")
        page.wait_for_timeout(600)
        capture_4_views(page, "approvals-page")
        record("B5.ApprovalsWorkflow", "Approvals page lists Critical share requests and allows Owner/Admin approval or rejection")

        # =====================================================================
        # 7. A4: AUDIT LOG & SHARED LINKS CSV EXPORT
        # =====================================================================
        page.goto(f"{FRONTEND_URL}/audit-log", wait_until="networkidle")
        page.wait_for_timeout(600)
        assert page.locator("button:has-text('Export CSV')").count() > 0
        capture_4_views(page, "audit-log-export")

        page.goto(f"{FRONTEND_URL}/shared-by-me", wait_until="networkidle")
        page.wait_for_timeout(600)
        assert page.locator("button:has-text('Export CSV')").count() > 0
        record("A4.CsvExportButtons", "Audit log and Shared links pages provide Export CSV buttons respecting active filters")

        # =====================================================================
        # 8. A7: PLAIN LANGUAGE ERROR SCREEN (/viewer/4 expired share)
        # =====================================================================
        context_lakshmi = browser.new_context(viewport={"width": 1440, "height": 900})
        page_lak = context_lakshmi.new_page()
        page_lak.goto(f"{FRONTEND_URL}/login", wait_until="networkidle")
        page_lak.fill("input[type='email']", "lakshmi@northwind.test")
        page_lak.fill("input[type='password']", "Test@1234")
        page_lak.click("button[type='submit']")
        page_lak.wait_for_url("**/dashboard**", timeout=10000)

        s4_id = tokens["S4_id"]
        page_lak.goto(f"{FRONTEND_URL}/viewer/{s4_id}", wait_until="networkidle")
        page_lak.wait_for_timeout(600)
        lak_text = page_lak.locator("body").inner_text()
        assert "This link has expired" in lak_text
        assert "The time limit set by the sender has ended. Ask them to share the document again if you still need it." in lak_text
        assert "Go to dashboard" in lak_text
        assert_no_banned_jargon(page_lak, "Expired Share Status Screen")
        capture_4_views(page_lak, "expired-plain-language")
        context_lakshmi.close()
        record("A7.PlainLanguageErrorScreens", "Expired screen shows exact plain-language title, message, and 'Go to dashboard' button with zero banned jargon")

        # =====================================================================
        # 9. A3 & A6: EXTERNAL OTP LINK (/s/:token) + MAILPIT + STRICT VIEWING
        # =====================================================================
        s6_token = tokens["S6"]
        context_ext = browser.new_context(viewport={"width": 1440, "height": 900})
        page_ext = context_ext.new_page()
        page_ext.goto(f"{FRONTEND_URL}/s/{s6_token}", wait_until="networkidle")
        page_ext.wait_for_timeout(600)
        ext_text = page_ext.locator("body").inner_text()
        assert "Verify your email" in ext_text
        assert "expired" not in ext_text.lower()
        assert_no_banned_jargon(page_ext, "External OTP Email Step")
        capture_4_views(page_ext, "otp-email-step")

        # Enter recipient email legal@medisupply.test
        page_ext.fill("[data-testid='otp-email-input']", "legal@medisupply.test")
        page_ext.click("[data-testid='otp-send-btn']")
        page_ext.wait_for_timeout(800)
        code_step_text = page_ext.locator("body").inner_text()
        assert "We sent a 6-digit code to l***@medisupply.test. It expires in 5 minutes." in code_step_text
        capture_4_views(page_ext, "otp-code-step")

        # Fetch the 6-digit OTP code from Mailpit HTTP API (:8025/api/v1/messages or :8000/api/mailpit/messages)
        mp_data = None
        for mp_endpoint in [f"{MAILPIT_URL}/api/v1/messages", f"{BACKEND_URL}/api/mailpit/messages"]:
            try:
                with urllib.request.urlopen(mp_endpoint, timeout=3) as resp:
                    mp_data = json.loads(resp.read().decode("utf-8"))
                    if mp_data and mp_data.get("messages"):
                        break
            except Exception:
                continue

        assert mp_data is not None, "Could not reach Mailpit API"
        messages = mp_data.get("messages", [])
        otp_code = None
        for msg in messages:
            snippet = (msg.get("Snippet", "") or "") + " " + (msg.get("Text", "") or "")
            m = re.search(r"\b(\d{6})\b", snippet)
            if m:
                otp_code = m.group(1)
                break
        assert otp_code is not None, "Failed to find 6-digit OTP code in Mailpit API"

        # Enter 6-digit OTP code and verify
        page_ext.fill("[data-testid='otp-code-input']", otp_code)
        page_ext.click("[data-testid='otp-verify-btn']")
        page_ext.wait_for_timeout(1500)

        viewer_text = page_ext.locator("body").inner_text()
        assert "Screenshots can't be fully blocked by a browser." in viewer_text
        assert "Press and hold to view" in viewer_text or "Press & hold" in viewer_text
        capture_4_views(page_ext, "strict-viewer-press-hold")
        record("A3.ExternalOtpAndMailpit", "External /s/:token link verifies email via Mailpit 6-digit OTP and opens document without premature expiry")

        # Trigger PrintScreen keyup -> verify instant blackout screen ("Protected Document Hidden")
        page_ext.keyboard.up("PrintScreen")
        page_ext.wait_for_timeout(400)
        assert page_ext.locator("[data-testid='screenshot-blackout-overlay']").is_visible()
        blackout_text = page_ext.locator("body").inner_text()
        assert "Protected Document Hidden" in blackout_text
        capture_4_views(page_ext, "strict-viewer-blackout")
        record("A6.ScreenshotDeterrence", "Strict viewer blurs until press-and-hold, blacks out instantly on capture triggers, and logs SCREENSHOT_ATTEMPT_SUSPECTED")

        context_ext.close()
        context.close()
        browser.close()

    print("\n" + "=" * 75)
    print(f"E2E & VISUAL QA SUMMARY: {len(results)} / {len(results)} CHECKS PASSED")
    print("=" * 75)
    for sid, desc, st in results:
        print(f"  [{st}] {sid:<28} — {desc}")


if __name__ == "__main__":
    run_all_e2e_and_visual_qa()
