import re
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from app.core.config import settings
from app.models import User
from app.api.deps import get_current_user
from app.services.mailpit_dev import get_messages, clear_messages

router = APIRouter(prefix="/demo-inbox", tags=["Demo Inbox"])

@router.get("/status")
async def get_demo_inbox_status():
    """Returns whether demo mode is enabled."""
    return {"demo_mode": bool(settings.DEMO_MODE)}

@router.get("/messages")
async def get_demo_inbox_messages(
    current_user: User = Depends(get_current_user)
):
    """
    Returns captured emails in development demo mode.
    Restricted strictly to Owner/Admin and only when DEMO_MODE=True.
    Returns 404 otherwise.
    """
    if not settings.DEMO_MODE or current_user.role_name not in ("Owner", "Admin", "Department Head", "Manager"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo inbox not available.")

    raw_msgs = get_messages()
    formatted = []
    for m in raw_msgs:
        to_list = [addr.get("Address", "") for addr in m.get("To", [])]
        to_str = ", ".join(to_list)
        text_content = m.get("Text", "") or m.get("Snippet", "") or ""
        html_content = m.get("HTML", "") or ""
        
        # Extract 6-digit OTP code if present
        code_match = re.search(r"\b(\d{6})\b", text_content + " " + html_content)
        code = code_match.group(1) if code_match else None

        formatted.append({
            "id": m.get("ID"),
            "to": to_str,
            "subject": m.get("Subject", "Notification"),
            "time": m.get("Created"),
            "snippet": m.get("Snippet", ""),
            "code": code,
            "text": text_content,
            "html": html_content
        })
    return {"messages": formatted, "count": len(formatted)}

@router.delete("/messages")
async def clear_demo_inbox_messages(
    current_user: User = Depends(get_current_user)
):
    """Clears captured demo inbox messages."""
    if not settings.DEMO_MODE or current_user.role_name not in ("Owner", "Admin", "Department Head", "Manager"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo inbox not available.")
    clear_messages()
    return {"success": True, "message": "Demo inbox cleared."}

