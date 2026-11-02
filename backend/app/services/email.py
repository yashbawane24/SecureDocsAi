"""
Email Delivery Service for SecureDocs AI
Supports three delivery modes controlled by env var MAIL_MODE:
- MAIL_MODE=mailpit (default for dev): SMTP to Mailpit (localhost:1025, UI at http://localhost:8025).
- MAIL_MODE=smtp: Real SMTP (works with Gmail using an App Password via STARTTLS/SSL).
- MAIL_MODE=resend: Resend REST API.

SECURITY REQUIREMENT:
The OTP code is NEVER logged in any logger, console output, or trace.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import httpx

from app.core.config import settings
from app.services.mailpit_dev import ensure_mailpit_dev_servers, record_message_direct

logger = logging.getLogger("securedocs.email")


def mask_email_address(email_addr: str) -> str:
    """Masks an email address like legal@medisupply.test -> l***@medisupply.test."""
    if not email_addr or "@" not in email_addr:
        return "***"
    local, domain = email_addr.strip().split("@", 1)
    if len(local) <= 1:
        masked_local = f"{local}***"
    else:
        masked_local = f"{local[0]}***"
    return f"{masked_local}@{domain}"


def verify_email_transport_on_startup() -> bool:
    """
    On startup, logs which MAIL_MODE is active and whether the SMTP connection works.
    Never logs any OTP codes or secrets.
    """
    mode = (settings.MAIL_MODE or "demo").strip().lower()
    if mode in ("demo", "mailpit"):
        try:
            ensure_mailpit_dev_servers(settings.SMTP_HOST, settings.SMTP_PORT, 8025)
        except Exception:
            pass
        logger.info("[Email Startup] MAIL_MODE=demo active. In-app demo inbox ready at /demo-inbox and Mailpit UI at http://localhost:8025.")
        print("[Email Startup] MAIL_MODE=demo active — In-app Demo Inbox ready at /demo-inbox and Mailpit UI at http://localhost:8025.")
        return True

    elif mode == "smtp":
        try:
            if settings.SMTP_PORT == 465:
                with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=5) as server:
                    if settings.SMTP_USER and settings.SMTP_PASSWORD:
                        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.noop()
            else:
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=5) as server:
                    server.ehlo()
                    if settings.SMTP_PORT in (587, 2525):
                        server.starttls()
                        server.ehlo()
                    if settings.SMTP_USER and settings.SMTP_PASSWORD:
                        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.noop()
            logger.info(f"[Email Startup] MAIL_MODE=smtp active. Connected to {settings.SMTP_HOST}:{settings.SMTP_PORT} successfully.")
            print(f"[Email Startup] MAIL_MODE=smtp active — SMTP connection to {settings.SMTP_HOST}:{settings.SMTP_PORT} OK.")
            return True
        except Exception as e:
            logger.warning(f"[Email Startup] MAIL_MODE=smtp configured, but connection check failed: {e}")
            print(f"[Email Startup] MAIL_MODE=smtp configured — connection check failed: {e}")
            return False

    elif mode == "resend":
        has_key = bool(settings.RESEND_API_KEY)
        logger.info(f"[Email Startup] MAIL_MODE=resend active. API key configured: {has_key}.")
        print(f"[Email Startup] MAIL_MODE=resend active — API key configured: {has_key}.")
        return has_key

    else:
        logger.warning(f"[Email Startup] Unknown MAIL_MODE='{mode}', defaulting to mailpit.")
        return False


def _dispatch_mime_message(recipient_email: str, subject: str, text_body: str, html_body: str) -> bool:
    mode = (settings.MAIL_MODE or "mailpit").strip().lower()
    sender = settings.MAIL_FROM or settings.SMTP_FROM or "security@securedocs.ai"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    if mode == "resend":
        if not settings.RESEND_API_KEY:
            logger.warning("MAIL_MODE=resend is active, but RESEND_API_KEY is not set.")
            return False
        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                    json={
                        "from": sender,
                        "to": [recipient_email],
                        "subject": subject,
                        "html": html_body,
                        "text": text_body,
                    },
                )
                return resp.status_code in (200, 201)
        except Exception as e:
            logger.warning(f"Resend API dispatch failed: {e}")
            return False

    if mode in ("demo", "mailpit"):
        record_message_direct(sender, [recipient_email], msg.as_bytes())
        logger.info(f"Email recorded in embedded demo inbox for {recipient_email}")
        return True

    # mode == "smtp"
    try:
        if settings.SMTP_PORT == 465:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=8) as server:
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=8) as server:
                server.ehlo()
                if settings.SMTP_PORT in (587, 2525):
                    server.starttls()
                    server.ehlo()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)
        logger.info(f"Email dispatched via SMTP to {recipient_email}")
        return True
    except Exception as e:
        logger.warning(f"SMTP dispatch to {settings.SMTP_HOST}:{settings.SMTP_PORT} failed ({e}).")
        return False


def send_otp_email(recipient_email: str, otp_code: str, document_title: str) -> bool:
    """
    Sends the 6-digit OTP verification code to the recipient.
    SECURITY: The code is transmitted ONLY in the email body, NEVER logged!
    """
    subject = "Verification code for document access — SecureDocs AI"

    html_body = f"""<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F6F6F3; color: #141413; padding: 24px; }}
        .card {{ max-width: 500px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E6E5E0; border-radius: 8px; padding: 28px; }}
        .header {{ font-size: 18px; font-weight: 600; color: #1E6B52; margin-bottom: 12px; }}
        .code {{ font-family: monospace; font-size: 28px; letter-spacing: 6px; font-weight: bold; padding: 14px 20px; background: #F6F6F3; border: 1px solid #E6E5E0; border-radius: 6px; text-align: center; margin: 24px 0; color: #141413; }}
        .footer {{ font-size: 12px; color: #6B6B66; border-top: 1px solid #E6E5E0; padding-top: 12px; margin-top: 24px; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">SecureDocs AI Verification Code</div>
        <p>A request was made to view the shared document: <strong>{document_title}</strong>.</p>
        <p>Enter this single-use 6-digit code to verify your email address. It expires in <strong>5 minutes</strong>.</p>
        <div class="code">{otp_code}</div>
        <p>If you did not request access to this document, you can safely ignore this email.</p>
        <div class="footer">
          SecureDocs AI — Secure Document Sharing & Risk Control
        </div>
      </div>
    </body>
    </html>"""

    text_body = (
        f"Your SecureDocs AI verification code for '{document_title}' is: {otp_code}\n\n"
        f"This code expires in 5 minutes. Do not share this code."
    )

    return _dispatch_mime_message(recipient_email, subject, text_body, html_body)


def send_invite_email(recipient_email: str, org_name: str, role_name: str, invite_url: str) -> bool:
    """Sends a 7-day organization invitation email."""
    subject = f"You have been invited to join {org_name} on SecureDocs AI"
    html_body = f"""<!DOCTYPE html>
    <html>
    <body style="font-family: system-ui, sans-serif; background: #F6F6F3; padding: 24px; color: #141413;">
      <div style="max-width: 500px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E6E5E0; border-radius: 8px; padding: 28px;">
        <h2 style="font-size: 18px; color: #1E6B52; margin-top: 0;">Join {org_name} on SecureDocs AI</h2>
        <p>You have been invited to join <strong>{org_name}</strong> with the role <strong>{role_name}</strong>.</p>
        <p><a href="{invite_url}" style="display:inline-block;padding:10px 18px;background:#1E6B52;color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;">Accept invitation</a></p>
        <p style="font-size: 12px; color: #6B6B66;">Or copy this link: {invite_url}</p>
      </div>
    </body>
    </html>"""
    text_body = f"You have been invited to join {org_name} ({role_name}) on SecureDocs AI.\nAccept your invitation: {invite_url}"
    return _dispatch_mime_message(recipient_email, subject, text_body, html_body)
