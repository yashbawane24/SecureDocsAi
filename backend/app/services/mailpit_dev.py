"""
Embedded Mailpit-Compatible SMTP (:1025) & HTTP API/Web UI (:8025) Server for Local Development.
If an external Mailpit instance is already listening on 1025/8025, this module gracefully yields to it.
Otherwise, it starts a lightweight asyncio SMTP receiver on 127.0.0.1:1025 and a FastAPI/HTTP server on 127.0.0.1:8025
implementing the Mailpit v1 REST API (/api/v1/messages) and Web Inbox UI.
"""

import asyncio
import email
from email.policy import default as default_policy
import json
import logging
import socket
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import List, Dict, Any, Optional

logger = logging.getLogger("securedocs.mailpit")

# In-memory store of received messages (newest first)
_MESSAGES: List[Dict[str, Any]] = []
_LOCK = threading.Lock()
_STARTED = False


def _parse_raw_email(raw_bytes: bytes, mail_from: str, rcpt_tos: List[str]) -> Dict[str, Any]:
    msg = email.message_from_bytes(raw_bytes, policy=default_policy)
    subject = str(msg.get("Subject", ""))
    from_header = str(msg.get("From", mail_from))
    to_header = str(msg.get("To", ", ".join(rcpt_tos)))

    text_body = ""
    html_body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype == "text/plain" and not text_body:
                try:
                    text_body = part.get_content()
                except Exception:
                    payload = part.get_payload(decode=True)
                    text_body = payload.decode("utf-8", errors="replace") if payload else ""
            elif ctype == "text/html" and not html_body:
                try:
                    html_body = part.get_content()
                except Exception:
                    payload = part.get_payload(decode=True)
                    html_body = payload.decode("utf-8", errors="replace") if payload else ""
    else:
        ctype = msg.get_content_type()
        try:
            content = msg.get_content()
        except Exception:
            payload = msg.get_payload(decode=True)
            content = payload.decode("utf-8", errors="replace") if payload else ""
        if ctype == "text/html":
            html_body = content
        else:
            text_body = content

    msg_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    snippet = (text_body or html_body).strip().replace("\n", " ")[:160]

    return {
        "ID": msg_id,
        "MessageID": msg_id,
        "From": {"Name": "SecureDocs AI", "Address": from_header},
        "To": [{"Name": "", "Address": r} for r in (rcpt_tos or [to_header])],
        "Subject": subject,
        "Created": now_iso,
        "Snippet": snippet,
        "Text": text_body,
        "HTML": html_body,
        "Size": len(raw_bytes),
        "Read": False,
    }


def record_message_direct(mail_from: str, rcpt_tos: List[str], raw_bytes: bytes) -> Dict[str, Any]:
    parsed = _parse_raw_email(raw_bytes, mail_from, rcpt_tos)
    with _LOCK:
        _MESSAGES.insert(0, parsed)
        if len(_MESSAGES) > 200:
            _MESSAGES.pop()
    return parsed


def get_messages() -> List[Dict[str, Any]]:
    with _LOCK:
        return list(_MESSAGES)


def clear_messages():
    with _LOCK:
        _MESSAGES.clear()


class _SMTPClientHandler(threading.Thread):
    def __init__(self, conn: socket.socket, addr):
        super().__init__(daemon=True)
        self.conn = conn
        self.addr = addr

    def run(self):
        try:
            self.conn.settimeout(10.0)
            self.conn.sendall(b"220 localhost ESMTP Mailpit\r\n")
            mail_from = ""
            rcpt_tos: List[str] = []
            in_data = False
            data_lines: List[bytes] = []
            buf = b""

            while True:
                chunk = self.conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\r\n" in buf:
                    line, buf = buf.split(b"\r\n", 1)
                    if in_data:
                        if line == b".":
                            raw_bytes = b"\r\n".join(data_lines)
                            record_message_direct(mail_from, rcpt_tos, raw_bytes)
                            in_data = False
                            data_lines = []
                            self.conn.sendall(b"250 2.0.0 Ok: queued\r\n")
                        else:
                            if line.startswith(b".."):
                                line = line[1:]
                            data_lines.append(line)
                    else:
                        cmd_str = line.decode("utf-8", errors="replace").strip()
                        upper = cmd_str.upper()
                        if upper.startswith("EHLO") or upper.startswith("HELO"):
                            self.conn.sendall(b"250-localhost\r\n250 SIZE 10240000\r\n")
                        elif upper.startswith("MAIL FROM:"):
                            mail_from = cmd_str[10:].strip().strip("<>")
                            rcpt_tos = []
                            self.conn.sendall(b"250 2.1.0 Ok\r\n")
                        elif upper.startswith("RCPT TO:"):
                            addr = cmd_str[8:].strip().strip("<>")
                            rcpt_tos.append(addr)
                            self.conn.sendall(b"250 2.1.5 Ok\r\n")
                        elif upper == "DATA":
                            in_data = True
                            data_lines = []
                            self.conn.sendall(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                        elif upper == "RSET":
                            mail_from = ""
                            rcpt_tos = []
                            in_data = False
                            self.conn.sendall(b"250 2.0.0 Ok\r\n")
                        elif upper == "NOOP":
                            self.conn.sendall(b"250 2.0.0 Ok\r\n")
                        elif upper == "QUIT":
                            self.conn.sendall(b"221 2.0.0 Bye\r\n")
                            return
                        else:
                            self.conn.sendall(b"250 Ok\r\n")
        except Exception:
            pass
        finally:
            try:
                self.conn.close()
            except Exception:
                pass


class _MailpitHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # keep console clean

    def _send_json(self, status_code: int, payload: Any):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/api/v1/messages", "/api/v1/messages/"):
            msgs = get_messages()
            self._send_json(200, {
                "total": len(msgs),
                "unread": sum(1 for m in msgs if not m.get("Read")),
                "count": len(msgs),
                "start": 0,
                "messages": msgs,
            })
            return

        if path.startswith("/api/v1/message/") or path.startswith("/api/v1/messages/"):
            msg_id = path.rstrip("/").split("/")[-1]
            msgs = get_messages()
            if msg_id == "latest" and msgs:
                self._send_json(200, msgs[0])
                return
            for m in msgs:
                if m["ID"] == msg_id:
                    self._send_json(200, m)
                    return
            self._send_json(404, {"error": "Message not found"})
            return

        # Render friendly HTML Mailpit Inbox UI at http://localhost:8025
        msgs = get_messages()
        rows_html = ""
        for m in msgs:
            to_addrs = ", ".join(t["Address"] for t in m.get("To", []))
            rows_html += f"""
            <div style="border:1px solid #E6E5E0;border-radius:8px;padding:16px;margin-bottom:12px;background:#fff;">
              <div style="display:flex;justify-content:space-between;font-size:13px;color:#5C5A52;margin-bottom:6px;">
                <span><strong>To:</strong> {to_addrs}</span>
                <span>{m.get('Created', '')}</span>
              </div>
              <div style="font-size:15px;font-weight:600;color:#141414;margin-bottom:8px;">{m.get('Subject', '')}</div>
              <pre style="background:#F6F6F3;padding:10px;border-radius:6px;font-size:12px;white-space:pre-wrap;margin:0;">{m.get('Text', '')}</pre>
            </div>
            """
        if not rows_html:
            rows_html = "<p style='color:#666;'>No emails received yet.</p>"

        html = f"""<!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Mailpit — SecureDocs AI Dev Inbox</title></head>
        <body style="font-family:system-ui,sans-serif;background:#F6F6F3;margin:0;padding:24px;">
          <div style="max-width:860px;margin:0 auto;">
            <h1 style="font-size:20px;margin-bottom:4px;">Mailpit Local Inbox (SecureDocs AI)</h1>
            <p style="font-size:13px;color:#5C5A52;margin-top:0;">SMTP listening on 127.0.0.1:1025 • REST API at <code>/api/v1/messages</code></p>
            {rows_html}
          </div>
        </body>
        </html>"""
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        if self.path.startswith("/api/v1/messages"):
            clear_messages()
            self._send_json(200, {"status": "cleared"})
        else:
            self._send_json(404, {"error": "Not found"})


def _is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def ensure_mailpit_dev_servers(smtp_host: str = "127.0.0.1", smtp_port: int = 1025, http_port: int = 8025):
    global _STARTED
    if _STARTED:
        return
    _STARTED = True

    target_host = "127.0.0.1" if smtp_host in ("localhost", "127.0.0.1") else smtp_host

    if not _is_port_open(target_host, smtp_port):
        def _run_smtp():
            try:
                srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                srv.bind(("127.0.0.1", smtp_port))
                srv.listen(16)
                while True:
                    conn, addr = srv.accept()
                    _SMTPClientHandler(conn, addr).start()
            except Exception as e:
                logger.debug(f"Embedded SMTP listener on :{smtp_port} exited: {e}")

        t_smtp = threading.Thread(target=_run_smtp, daemon=True)
        t_smtp.start()

    if not _is_port_open("127.0.0.1", http_port):
        def _run_http():
            try:
                httpd = HTTPServer(("127.0.0.1", http_port), _MailpitHTTPHandler)
                httpd.serve_forever()
            except Exception as e:
                logger.debug(f"Embedded Mailpit HTTP UI on :{http_port} exited: {e}")

        t_http = threading.Thread(target=_run_http, daemon=True)
        t_http.start()

