"""
In-Memory PDF Watermarking Service
Uses ReportLab and pypdf to dynamically stamp watermark overlays.

SECURITY REQUIREMENT:
All watermarking is performed strictly in memory using io.BytesIO buffers.
No temporary files or plaintext PDFs are written to disk.
"""

import io
import secrets
from datetime import datetime, timezone
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color
from pypdf import PdfReader, PdfWriter

def generate_dl_id() -> str:
    """Generate a unique tracking identifier format: DL-xxxxxxxx (8 hex chars)."""
    return f"DL-{secrets.token_hex(4)}"

def create_watermark_overlay(
    width: float,
    height: float,
    downloader_name: str,
    downloader_email: str,
    timestamp_str: str,
    dl_id: str
) -> io.BytesIO:
    """
    Generate a dynamic diagonal watermark overlay page matching the document page dimensions.
    Returns: in-memory io.BytesIO containing the overlay PDF.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.saveState()

    # Center translation and 45 degree diagonal tilt
    c.translate(width / 2.0, height / 2.0)
    c.rotate(45)

    # Subdued oxblood / charcoal security stamp styling
    c.setFillColor(Color(0.54, 0.17, 0.12, alpha=0.22)) # Deep oxblood tone with subtle opacity
    c.setFont("Helvetica-Bold", 12)

    line1 = f"CONFIDENTIAL — AUTHORIZED COPY"
    line2 = f"RECIPIENT: {downloader_name} <{downloader_email}>"
    line3 = f"UTC: {timestamp_str} | TRACKING: {dl_id}"
    line4 = f"UNAUTHORIZED REDISTRIBUTION PROHIBITED — MERIDIAN LABS"

    c.drawCentredString(0, 30, line1)
    c.drawCentredString(0, 10, line2)
    c.drawCentredString(0, -10, line3)
    c.drawCentredString(0, -30, line4)

    # Subtle repeated background tracking marks
    c.setFont("Helvetica", 9)
    c.setFillColor(Color(0.2, 0.2, 0.2, alpha=0.08))
    c.drawCentredString(-150, 120, f"LEDGER VAULT · {dl_id} · {downloader_email}")
    c.drawCentredString(150, -120, f"LEDGER VAULT · {dl_id} · {downloader_email}")

    c.restoreState()
    c.showPage()
    c.save()
    buf.seek(0)
    return buf

def apply_download_watermark(
    pdf_stream: io.BytesIO,
    downloader_name: str,
    downloader_email: str,
    timestamp: datetime = None,
    dl_id: str = None
) -> io.BytesIO:
    """
    Applies diagonal security watermark to every page of the input PDF stream.
    Strictly in-memory (io.BytesIO).
    Returns: io.BytesIO containing stamped PDF.
    """
    if timestamp is None:
        timestamp = datetime.now(timezone.utc)
    if dl_id is None:
        dl_id = generate_dl_id()

    timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S UTC")

    pdf_stream.seek(0)
    reader = PdfReader(pdf_stream)
    writer = PdfWriter()

    for page in reader.pages:
        page_box = page.mediabox
        width = float(page_box.width)
        height = float(page_box.height)

        overlay_stream = create_watermark_overlay(
            width=width,
            height=height,
            downloader_name=downloader_name,
            downloader_email=downloader_email,
            timestamp_str=timestamp_str,
            dl_id=dl_id
        )
        overlay_reader = PdfReader(overlay_stream)
        overlay_page = overlay_reader.pages[0]

        # Merge watermark on top of page
        page.merge_page(overlay_page)
        writer.add_page(page)

    output_stream = io.BytesIO()
    writer.write(output_stream)
    output_stream.seek(0)
    return output_stream
