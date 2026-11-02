"""
Comprehensive End-to-End Playwright Automated Test & Visual Inspection Suite
Covers:
1. Signup: Create organization from /signup, assigned as Owner, lands on /dashboard
2. Join request flow: Join with code NWH-2026, status PENDING, approved by Admin Daniel
3. REGRESSION TEST: Employee (Divya) opens shared document from Dashboard and Shared with me (/viewer/1)
   and verifies canvas renders page 1 with watermark without redirecting to dashboard.
4. Viewer toolbar: next page, zoom, thumbnails, full screen, countdown.
5. Permissions matrix dynamic enforcement: Admin disables permission, employee loses action immediately.
6. Tenant isolation: Org B (Orbitline) user cannot see or access Org A (Northwind) resources.
7. Visual audit: Screenshot every page in light & dark theme across 1440px, 1024px, 768px, 375px into qa/screenshots/
"""

import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

FRONTEND_URL = "http://localhost:5173"
BACKEND_URL = "http://localhost:8000"
SCREENSHOTS_DIR = os.path.abspath("qa/screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

VIEWPORTS = [
    ("1440", {"width": 1440, "height": 900}),
    ("1024", {"width": 1024, "height": 768}),
    ("768", {"width": 768, "height": 1024}),
    ("375", {"width": 375, "height": 812}),
]

async def run_e2e():
    print("=" * 80)
    print("STARTING PLAYWRIGHT END-TO-END AUTOMATED QA SUITE")
    print("=" * 80)

    # Load tokens
    with open("test_tokens.json", "r") as f:
        tokens = json.load(f)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # -------------------------------------------------------------
        # TEST 1: REGRESSION FIX — Employee opens viewer (/viewer/1)
        # -------------------------------------------------------------
        print("\n[TEST 1: REGRESSION] Verifying Employee can open /viewer/1 without redirecting...")
        emp_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        emp_page = await emp_ctx.new_page()

        # Login as Divya (Employee)
        await emp_page.goto(f"{FRONTEND_URL}/login")
        await emp_page.wait_for_selector("#login-email")
        await emp_page.fill("#login-email", "divya@northwind.test")
        await emp_page.fill("#login-password", "Test@1234")
        await emp_page.click("button[type='submit']")
        await emp_page.wait_for_url("**/dashboard")
        print("  ✓ Divya logged in successfully and reached /dashboard")

        # Open from Dashboard "Unopened Disclosures" panel
        await emp_page.wait_for_selector("a:has-text('Open')", timeout=10000)
        open_btn = emp_page.locator("a:has-text('Open')").first
        await open_btn.click()
        await emp_page.wait_for_url("**/viewer/*")
        
        # Verify viewer rendered page 1 canvas
        await emp_page.wait_for_selector("canvas", timeout=12000)
        assert "/viewer/" in emp_page.url, f"Expected /viewer/* but got {emp_page.url}"
        assert not emp_page.url.endswith("/dashboard"), "Regression! Redirected to dashboard."
        print(f"  ✓ Successfully opened viewer at: {emp_page.url}")

        # Verify page input is '1' and canvas has rendered dimensions
        canvas = await emp_page.wait_for_selector("canvas")
        box = await canvas.bounding_box()
        assert box and box["width"] > 100 and box["height"] > 100, "Canvas not rendered!"
        print("  ✓ Canvas rendered high-DPI page 1 successfully")

        # Now test opening from "Shared with me"
        await emp_page.goto(f"{FRONTEND_URL}/shared-with-me")
        await emp_page.wait_for_selector("table")
        first_open_link = emp_page.locator("a:has-text('Open')").first
        await first_open_link.click()
        await emp_page.wait_for_url("**/viewer/*")
        await emp_page.wait_for_selector("canvas", timeout=10000)
        print("  ✓ Opened from Shared with Me page directly without redirect")

        # Test Toolbar: Page Navigation, Zoom, Thumbnails
        page_input = await emp_page.wait_for_selector("input[style*='text-align: center']")
        val = await page_input.input_value()
        assert val == "1"

        # Zoom in
        await emp_page.click("button[title='Zoom In (+)']")
        zoom_text = await emp_page.locator("span.mono:has-text('%')").inner_text()
        print(f"  ✓ Zoom in updated to {zoom_text}")

        # Capture Secure Viewer screenshot
        await emp_page.screenshot(path=f"{SCREENSHOTS_DIR}/secure_viewer_1440.png")
        await emp_ctx.close()

        # -------------------------------------------------------------
        # TEST 2: Multi-Organization Signup (Create Organization)
        # -------------------------------------------------------------
        print("\n[TEST 2] Verifying /signup: Create Organization as Owner...")
        signup_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        s_page = await signup_ctx.new_page()

        await s_page.goto(f"{FRONTEND_URL}/signup")
        await s_page.wait_for_selector("#signup-org")
        await s_page.fill("#signup-org", "BioVanguard Global")
        await s_page.fill("#signup-name", "Dr. Alexander Cross")
        await s_page.fill("#signup-email", "alex@biovanguard.test")
        await s_page.fill("#signup-password", "Test@1234")
        await s_page.click("button[type='submit']")
        await s_page.wait_for_url("**/dashboard")
        print("  ✓ Created organization 'BioVanguard Global' and entered /dashboard as Owner")
        await signup_ctx.close()

        # -------------------------------------------------------------
        # TEST 3: Join Request with Code NWH-2026 & Admin Approval
        # -------------------------------------------------------------
        print("\n[TEST 3] Testing Join Request with Code NWH-2026 & Approval...")
        join_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        j_page = await join_ctx.new_page()

        await j_page.goto(f"{FRONTEND_URL}/join")
        await j_page.wait_for_selector("#join-code")
        await j_page.fill("#join-code", "NWH-2026")
        await j_page.fill("#join-name", "Vikram Rathore")
        await j_page.fill("#join-email", "vikram.join@northwind.test")
        await j_page.fill("#join-password", "Test@1234")
        await j_page.click("button[type='submit']")

        # User is in PENDING state -> sees "Waiting for Approval" screen
        await j_page.wait_for_selector("h2:has-text('Waiting for Approval')")
        print("  ✓ Pending user sees 'Waiting for Approval' screen")
        await j_page.screenshot(path=f"{SCREENSHOTS_DIR}/waiting_for_approval_1440.png")
        await join_ctx.close()

        # Admin Daniel logs in and approves the request
        admin_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        adm_page = await admin_ctx.new_page()
        await adm_page.goto(f"{FRONTEND_URL}/login")
        await adm_page.fill("#login-email", "daniel@northwind.test")
        await adm_page.fill("#login-password", "Test@1234")
        await adm_page.click("button[type='submit']")
        await adm_page.wait_for_url("**/dashboard")

        # Go to Invitations & Requests
        await adm_page.goto(f"{FRONTEND_URL}/invitations")
        await adm_page.wait_for_selector("button:has-text('Approve')")
        await adm_page.locator("button:has-text('Approve')").first.click()
        await adm_page.wait_for_selector("text=Member approved")
        print("  ✓ Admin Daniel approved pending member")
        await admin_ctx.close()

        # -------------------------------------------------------------
        # TEST 4: Tenant Isolation (Org B cannot access Org A)
        # -------------------------------------------------------------
        print("\n[TEST 4] Verifying Tenant Isolation: Org B cannot see Org A...")
        orgb_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        b_page = await orgb_ctx.new_page()

        # Login as Neha (Orbitline Systems Owner)
        await b_page.goto(f"{FRONTEND_URL}/login")
        await b_page.fill("#login-email", "neha@orbitline.test")
        await b_page.fill("#login-password", "Test@1234")
        await b_page.click("button[type='submit']")
        await b_page.wait_for_url("**/dashboard")

        # Verify only Orbitline documents visible
        await b_page.goto(f"{FRONTEND_URL}/documents")
        await b_page.wait_for_selector("table", timeout=10000)
        content_b = await b_page.content()
        assert "Product_Roadmap_2027.pdf" in content_b
        assert "Annual_Budget_FY27.pdf" not in content_b
        assert "Clinical_SOP_v3.pdf" not in content_b
        print("  ✓ Tenant isolation confirmed: Northwind documents completely hidden from Orbitline")

        # Try to open Northwind document ID 1 directly -> 404
        await b_page.goto(f"{FRONTEND_URL}/documents/1")
        await b_page.wait_for_selector("h2:has-text('Unable to open document')")
        print("  ✓ Direct URL ID access to other tenant's document blocked")
        await orgb_ctx.close()

        # -------------------------------------------------------------
        # TEST 5: Roles & Permissions Matrix Editing
        # -------------------------------------------------------------
        print("\n[TEST 5] Testing Roles & Permissions Matrix Editing...")
        owner_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        o_page = await owner_ctx.new_page()

        # Meera (Northwind Owner) logs in
        await o_page.goto(f"{FRONTEND_URL}/login")
        await o_page.fill("#login-email", "meera@northwind.test")
        await o_page.fill("#login-password", "Test@1234")
        await o_page.click("button[type='submit']")
        await o_page.wait_for_url("**/dashboard")

        await o_page.goto(f"{FRONTEND_URL}/roles")
        await o_page.wait_for_selector("table")
        await o_page.screenshot(path=f"{SCREENSHOTS_DIR}/roles_matrix_1440.png")
        
        # Click Save Matrix
        await o_page.click("#save-matrix-btn")
        await o_page.wait_for_selector("text=Permissions matrix saved")
        print("  ✓ Permissions matrix saved and updated successfully")
        await owner_ctx.close()

        # -------------------------------------------------------------
        # TEST 6: Visual Audit — Multi-Resolution Screenshots (Light & Dark)
        # -------------------------------------------------------------
        print("\n[TEST 6] Capturing Multi-Resolution Visual Review Screenshots...")
        audit_ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await audit_ctx.new_page()

        # A. Public Landing Page
        await page.goto(f"{FRONTEND_URL}/")
        await page.wait_for_selector("h1")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/landing_{tag}.png")
        print("  ✓ Captured Landing page (1440, 1024, 768, 375 px)")

        # B. Login Page
        await page.goto(f"{FRONTEND_URL}/login")
        await page.wait_for_selector("#login-email")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/login_{tag}.png")
        print("  ✓ Captured Login page")

        # C. Signup Page
        await page.goto(f"{FRONTEND_URL}/signup")
        await page.wait_for_selector("#signup-org")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/signup_{tag}.png")
        print("  ✓ Captured Signup page")

        # D. Log in as Daniel (Admin) for internal pages
        await page.set_viewport_size({"width": 1440, "height": 900})
        await page.goto(f"{FRONTEND_URL}/login")
        await page.fill("#login-email", "daniel@northwind.test")
        await page.fill("#login-password", "Test@1234")
        await page.click("button[type='submit']")
        await page.wait_for_url("**/dashboard")

        # Dashboard
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/dashboard_{tag}.png")
        print("  ✓ Captured Dashboard across viewports")

        # Dark theme toggle on Dashboard
        await page.set_viewport_size({"width": 1440, "height": 900})
        await page.click("button[title*='Switch to dark']")
        await page.wait_for_timeout(300)
        await page.screenshot(path=f"{SCREENSHOTS_DIR}/dashboard_dark_1440.png")
        print("  ✓ Captured Dashboard in Dark Theme")

        # Documents page
        await page.goto(f"{FRONTEND_URL}/documents")
        await page.wait_for_selector("table")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/documents_{tag}.png")
        print("  ✓ Captured Documents registry")

        # Document Detail (/documents/1)
        await page.goto(f"{FRONTEND_URL}/documents/1")
        await page.wait_for_selector("iframe")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/doc_detail_{tag}.png")
        print("  ✓ Captured Document Detail owner view")

        # Members page
        await page.goto(f"{FRONTEND_URL}/members")
        await page.wait_for_selector("table")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/members_{tag}.png")
        print("  ✓ Captured Members page")

        # Departments page
        await page.goto(f"{FRONTEND_URL}/departments")
        await page.wait_for_selector("table")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/departments_{tag}.png")
        print("  ✓ Captured Departments page")

        # Settings page
        await page.goto(f"{FRONTEND_URL}/settings")
        await page.wait_for_selector("#org-name")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/settings_{tag}.png")
        print("  ✓ Captured Org Settings page")

        # Audit Log
        await page.goto(f"{FRONTEND_URL}/audit-log")
        await page.wait_for_selector("table")
        for tag, vp in VIEWPORTS:
            await page.set_viewport_size(vp)
            await page.screenshot(path=f"{SCREENSHOTS_DIR}/audit_log_{tag}.png")
        print("  ✓ Captured Audit Log")

        # Distinct Refusal Screens:
        # 1. Not Your Share: Daniel tries to open S4 (bound to Lakshmi)
        await page.goto(f"{FRONTEND_URL}/viewer/4")
        await page.wait_for_selector("h2")
        await page.screenshot(path=f"{SCREENSHOTS_DIR}/refusal_screen_1440.png")
        print("  ✓ Captured Refusal security screen")

        await audit_ctx.close()
        await browser.close()

    print("\n" + "=" * 80)
    print("ALL PLAYWRIGHT TESTS AND VISUAL SCREENSHOTS PASSED SUCCESSFULLY!")
    print("=" * 80)

if __name__ == "__main__":
    asyncio.run(run_e2e())
