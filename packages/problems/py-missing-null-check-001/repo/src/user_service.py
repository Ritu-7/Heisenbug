# src/user_service.py — In-memory user lookup service
# NULL-001: Fix missing None check on Optional return value
#
# This module looks up a user record from an in-memory registry and returns
# the user's email address. The current implementation passes a basic syntax
# check, but it contains a type-safety bug: `dict.get()` can return None, and
# the code immediately accesses `.email` on the result without any guard.
#
# Under mypy --strict, this is a hard error:
#   Item "None" of "Optional[User]" has no attribute "email"
#
# YOUR JOB: add a real runtime None check so the None case is explicitly
# handled before any attribute is accessed on the result of .get().

from __future__ import annotations

from typing import Dict, Optional


class User:
    """Represents a registered user."""

    def __init__(self, user_id: str, email: str, name: str) -> None:
        self.user_id = user_id
        self.email = email
        self.name = name

    def __repr__(self) -> str:
        return f"User(user_id={self.user_id!r}, email={self.email!r})"


# In-memory user registry (simulates a database or cache)
_USER_REGISTRY: Dict[str, User] = {
    "u-001": User("u-001", "alice@example.com", "Alice"),
    "u-002": User("u-002", "bob@example.com", "Bob"),
}


def get_user_email(user_id: str) -> str:
    """Return the email address for the given user ID.

    Raises:
        ??? — currently crashes with AttributeError if user_id is not found,
        because `users.get()` returns None and `.email` is accessed on None.

    YOUR JOB: replace the crash with an explicit, descriptive error.
    """
    # ─────────────────────────────────────────────────────────────────────────
    # BUG: dict.get() returns Optional[User] — it is None when user_id is
    # absent. Accessing user.email on None raises:
    #   AttributeError: 'NoneType' object has no attribute 'email'
    # mypy --strict correctly flags this as a type error. Fix it.
    user = _USER_REGISTRY.get(user_id)
    return user.email  # BUG: no None check — crashes when user is not found
    # ─────────────────────────────────────────────────────────────────────────
