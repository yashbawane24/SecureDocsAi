import asyncio
import os
from playwright.async_api import async_playwright

FRONTEND_URL = "http://localhost:5173"
OUT_DIR = os.path.abspath("qa/after")
os.makedirs(OUT_DIR, exist_ok=True)

async def set_theme(page, theme="light"):
    await page.evaluate(f"""(t) => {{
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('lv_theme', t);
    }}""", theme)
    await page.wait_for_timeout(300)

async def capture_all():
    print(f"Capturing screenshots to {OUT_DIR}...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # 1. Landing Page (Light & Dark)
        print("Capturing Landing...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await page.goto(f"{FRONTEND_URL}/")
        await page.wait_for_timeout(1000)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "landing.png"), full_page=True)
        await set_theme(page, "dark")
        await page.screenshot(path=os.path.join(OUT_DIR, "landing_dark.png"), full_page=True)
        await ctx.close()

        # 2. Login Page (Light & Dark)
        print("Capturing Login...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await page.goto(f"{FRONTEND_URL}/login")
        await page.wait_for_timeout(1000)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "login.png"), full_page=True)
        await set_theme(page, "dark")
        await page.screenshot(path=os.path.join(OUT_DIR, "login_dark.png"), full_page=True)
        await ctx.close()

        # 3. Signup Page
        print("Capturing Signup...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await page.goto(f"{FRONTEND_URL}/signup")
        await page.wait_for_timeout(1000)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "signup.png"), full_page=True)
        await ctx.close()

        # Helper login
        async def login(page, email, password="Test@1234"):
            await page.goto(f"{FRONTEND_URL}/login")
            await page.fill("#login-email", email)
            await page.fill("#login-password", password)
            await page.click("button[type='submit']")
            await page.wait_for_url("**/dashboard")
            await page.wait_for_timeout(1200)

        # 4. Dashboard - Meera (Owner) across viewports and themes
        print("Capturing Dashboard Meera...")
        for vp_name, w, h in [("1440", 1440, 900), ("1024", 1024, 768), ("390", 390, 844)]:
            ctx = await browser.new_context(viewport={"width": w, "height": h})
            page = await ctx.new_page()
            await login(page, "meera@northwind.test")
            await set_theme(page, "light")
            await page.screenshot(path=os.path.join(OUT_DIR, f"dashboard-meera-{vp_name}-light.png"), full_page=True)
            if vp_name == "1440":
                await page.screenshot(path=os.path.join(OUT_DIR, "dashboard-meera.png"), full_page=True)
            await set_theme(page, "dark")
            await page.screenshot(path=os.path.join(OUT_DIR, f"dashboard-meera-{vp_name}-dark.png"), full_page=True)
            if vp_name == "1440":
                await page.screenshot(path=os.path.join(OUT_DIR, "dashboard-meera-dark.png"), full_page=True)
            await ctx.close()

        # 5. Dashboard - Karthik (Manager)
        print("Capturing Dashboard Karthik...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await login(page, "karthik@northwind.test")
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "dashboard-karthik.png"), full_page=True)
        await ctx.close()

        # 6. Dashboard - Divya (Employee)
        print("Capturing Dashboard Divya...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await login(page, "divya@northwind.test")
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "dashboard-divya.png"), full_page=True)
        await ctx.close()

        # 7. Documents Page
        print("Capturing Documents...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await login(page, "meera@northwind.test")
        await page.goto(f"{FRONTEND_URL}/documents")
        await page.wait_for_timeout(1000)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "documents.png"), full_page=True)
        await ctx.close()

        # 8. Shared with me Page
        print("Capturing Shared with me...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await login(page, "divya@northwind.test")
        await page.goto(f"{FRONTEND_URL}/shared-with-me")
        await page.wait_for_timeout(1000)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "shared-with-me.png"), full_page=True)
        await ctx.close()

        # 9. Viewer Page (/viewer/1)
        print("Capturing Viewer...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await login(page, "divya@northwind.test")
        await page.goto(f"{FRONTEND_URL}/viewer/1")
        await page.wait_for_timeout(2500)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "viewer.png"), full_page=True)
        await ctx.close()

        # 10. Members Page
        print("Capturing Members...")
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        await login(page, "meera@northwind.test")
        await page.goto(f"{FRONTEND_URL}/members")
        await page.wait_for_timeout(1000)
        await set_theme(page, "light")
        await page.screenshot(path=os.path.join(OUT_DIR, "members.png"), full_page=True)
        await ctx.close()

        await browser.close()
        print("✓ All screenshots captured successfully!")

if __name__ == "__main__":
    asyncio.run(capture_all())
