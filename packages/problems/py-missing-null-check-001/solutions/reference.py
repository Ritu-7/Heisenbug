# solutions/reference.py — Reference solution for py-missing-null-check-001
#
# The fix: add an explicit `if user is None: raise` guard immediately after the
# `.get()` call. This satisfies mypy --strict (it narrows the type to User)
# and gives callers a clear, descriptive error instead of an AttributeError.

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
        KeyError: if user_id is not found in the registry.
    """
    user: Optional[User] = _USER_REGISTRY.get(user_id)

    # ── FIX: explicit None guard before attribute access ─────────────────────
    # `_USER_REGISTRY.get()` returns Optional[User]. We must check for None
    # before accessing `.email` — both for runtime correctness and to satisfy
    # mypy --strict, which refuses to allow attribute access on Optional types
    # without a prior narrowing check.
    if user is None:
        raise KeyError(f"User '{user_id}' not found in registry")
    # After this guard, mypy knows `user` is `User`, not `Optional[User]`.
    # ─────────────────────────────────────────────────────────────────────────

    return user.email  # Safe: mypy narrows type to User after the guard
