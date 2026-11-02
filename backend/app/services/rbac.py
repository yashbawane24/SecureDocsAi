"""
Role-Based Access Control (RBAC) Engine for Ledger Vault
Enforces organizational sharing rules:
1. Admin (Department Head): Can share to anyone in their department.
2. Manager: Can share to their direct reports and to their own Admin (manager).
3. Employee: Cannot start shares (enforced with HTTP 403).
"""

from typing import List, Optional
from app.models import User, UserRole

def can_user_share(user: User) -> bool:
    """Employees cannot initiate document shares."""
    return user.role in (UserRole.ADMIN, UserRole.MANAGER)

def can_share_to_recipient(sender: User, recipient: User) -> bool:
    """
    Validates whether `sender` is authorized to share a document with `recipient`.
    """
    if not can_user_share(sender):
        return False
        
    # Cannot share with oneself
    if sender.id == recipient.id:
        return False

    # Rule 1: Admin can share to anyone in their department
    if sender.role == UserRole.ADMIN:
        return sender.department == recipient.department

    # Rule 2: Manager can share to direct reports and to their own Admin
    if sender.role == UserRole.MANAGER:
        # Check if recipient is a direct report
        if recipient.reports_to_id == sender.id:
            return True
        # Check if recipient is the Manager's own Admin/supervisor
        if sender.reports_to_id is not None and recipient.id == sender.reports_to_id:
            return True
        return False

    return False

def filter_allowed_recipients(sender: User, potential_recipients: List[User]) -> List[User]:
    """Returns the subset of users that the sender is authorized to share documents with."""
    return [u for u in potential_recipients if can_share_to_recipient(sender, u)]
