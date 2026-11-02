import os
import json
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT_DIR = os.path.join(os.path.dirname(__file__), "redesign")
os.makedirs(OUT_DIR, exist_ok=True)


def check_page_metrics(page, label):
    metrics = page.evaluate(
        """() => {
        const docEl = document.documentElement;
        const horizontalOverflow = docEl.scrollWidth > window.innerWidth + 2;
        const allEls = Array.from(document.querySelectorAll('*'));
        let greenLeakCount = 0;
        for (const el of allEls) {
            const st = window.getComputedStyle(el);
            if (
                st.backgroundColor === 'rgb(30, 107, 82)' ||
                st.color === 'rgb(30, 107, 82)' ||
                st.borderColor === 'rgb(30, 107, 82)'
            ) {
                greenLeakCount++;
            }
        }
        return {
            scrollWidth: docEl.scrollWidth,
            innerWidth: window.innerWidth,
            horizontalOverflow,
            greenLeakCount,
        };
    }"""
    )
    return {
        "label": label,
        **metrics,
    }


def main():
    report = {
        "checks": [],
        "role_redirect_test": None,
        "console_errors": [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Public pages at 1440px and 390px
        for width, suffix in [(1440, "1440"), (390, "390")]:
            ctx = browser.new_context(viewport={"width": width, "height": 900})
            page = ctx.new_page()
            page.on(
                "console",
                lambda msg: report["console_errors"].append(f"[{suffix}] {msg.text}")
                if msg.type == "error"
                else None,
            )

            public_routes = [
                ("landing", "/"),
                ("login_admin", "/login/admin"),
                ("login_head", "/login/head"),
                ("login_manager", "/login/manager"),
                ("login_employee", "/login/employee"),
                ("open_link", "/open"),
            ]

            for name, route in public_routes:
                page.goto(f"{BASE_URL}{route}", wait_until="networkidle")
                page.wait_for_timeout(350)
                page.screenshot(
                    path=os.path.join(OUT_DIR, f"{name}_{suffix}.png"),
                    full_page=(name == "landing"),
                )
                report["checks"].append(check_page_metrics(page, f"{name}_{suffix}"))

            ctx.close()

        # 2. Test Role Mismatch Warning & Redirect on /login/admin with Manager account
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/login/admin", wait_until="networkidle")
        page.fill("#login-email", "karthik@northwind.test")
        page.fill("#login-password", "Test@1234")
        page.click('button[type="submit"]')
        page.wait_for_selector('[data-testid="role-mismatch-alert"]', timeout=8000)
        mismatch_text = page.inner_text('[data-testid="role-mismatch-alert"]')
        page.screenshot(path=os.path.join(OUT_DIR, "login_role_mismatch_1440.png"))
        page.click('[data-testid="switch-correct-portal-btn"]')
        page.wait_for_url("**/login/manager?email=karthik%40northwind.test")
        prefilled_email = page.input_value("#login-email")
        report["role_redirect_test"] = {
            "passed": "Manager" in mismatch_text and prefilled_email == "karthik@northwind.test",
            "mismatch_text": mismatch_text,
            "redirected_url": page.url,
            "prefilled_email": prefilled_email,
        }
        ctx.close()

        # 3. Role-specific Dashboards at 1440px and 390px:
        #    Meera (Owner), Ananya (Head), Karthik (Manager), Divya (Employee)
        role_users = [
            ("meera_owner", "admin", "meera@northwind.test"),
            ("ananya_head", "head", "ananya@northwind.test"),
            ("karthik_manager", "manager", "karthik@northwind.test"),
            ("divya_employee", "employee", "divya@northwind.test"),
        ]

        for user_key, portal, email in role_users:
            for width, suffix in [(1440, "1440"), (390, "390")]:
                ctx = browser.new_context(viewport={"width": width, "height": 940})
                page = ctx.new_page()
                page.goto(f"{BASE_URL}/login/{portal}", wait_until="networkidle")
                page.fill("#login-email", email)
                page.fill("#login-password", "Test@1234")
                page.click('button[type="submit"]')
                page.wait_for_url("**/dashboard", timeout=10000)
                page.wait_for_timeout(600)
                page.screenshot(
                    path=os.path.join(OUT_DIR, f"dashboard_{user_key}_{suffix}.png"),
                    full_page=True,
                )
                report["checks"].append(
                    check_page_metrics(page, f"dashboard_{user_key}_{suffix}")
                )

                # For Meera at 1440px, also capture key internal pages
                if user_key == "meera_owner" and width == 1440:
                    extra_pages = [
                        ("documents", "/documents"),
                        ("document_detail", "/documents/1"),
                        ("approvals", "/approvals"),
                        ("audit_log", "/audit-log"),
                        ("members", "/members"),
                        ("settings", "/settings"),
                        ("secure_viewer", "/viewer/doc/1"),
                    ]
                    for p_name, p_route in extra_pages:
                        page.goto(f"{BASE_URL}{p_route}", wait_until="networkidle")
                        page.wait_for_timeout(500)
                        page.screenshot(
                            path=os.path.join(OUT_DIR, f"{p_name}_1440.png"),
                            full_page=(p_name != "secure_viewer"),
                        )
                        report["checks"].append(
                            check_page_metrics(page, f"{p_name}_1440")
                        )

                ctx.close()

        browser.close()

    with open(os.path.join(OUT_DIR, "verification_report.json"), "w") as f:
        json.dump(report, f, indent=2)

    print("Verification complete. Summary:")
    print(f"Total checks: {len(report['checks'])}")
    overflows = [c for c in report["checks"] if c["horizontalOverflow"]]
    green_leaks = [c for c in report["checks"] if c["greenLeakCount"] > 0]
    print(f"Horizontal overflows: {len(overflows)}")
    print(f"Green theme leaks: {len(green_leaks)}")
    print(f"Role redirect test: {report['role_redirect_test']}")
    print(f"Console errors: {len(report['console_errors'])}")


if __name__ == "__main__":
    main()

