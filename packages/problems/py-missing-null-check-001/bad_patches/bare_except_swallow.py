# bad_patches/bare_except_swallow.py — Plausible wrong fix for py-missing-null-check-001
#
# This "fix" wraps the attribute access in a try/except block and swallows the
# AttributeError with a bare `except: pass`. It fails on multiple fronts:
#
# 1. The try/except does NOT prevent the AttributeError from happening — it
#    merely catches it after the fact and silently returns "". This is worse
#    than the original: the caller gets an empty string with no indication that
#    the lookup failed.
#
# 2. The `user.email` attribute access still happens BEFORE any None check,
#    so the AST checker correctly identifies it as an unguarded access on an
#    Optional value.
#
# 3. Under mypy --strict, `user` is still `Optional[User]`, so `user.email`
#    is still a hard type error regardless of the try/except.
#
# 4. A bare `except: pass` is an antipattern that swallows ALL exceptions
#    including KeyboardInterrupt, SystemExit, and unrelated bugs — making
#    debugging extremely difficult.

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


_USER_REGISTRY: Dict[str, User] = {
    "u-001": User("u-001", "alice@example.com", "Alice"),
    "u-002": User("u-002", "bob@example.com", "Bob"),
}


def get_user_email(user_id: str) -> str:
    """Return the email address for the given user ID."""
    user = _USER_REGISTRY.get(user_id)
    # "Fix": wrap in try/except — but this doesn't add a None check before the access!
    # user.email still fires on None; the AttributeError is caught and swallowed.
    # mypy --strict still errors: Item "None" of "Optional[User]" has no attribute "email"
    try:
        return user.email  # still BUG: no guard before attribute access
    except:  # noqa: E722  bare except — terrible practice
        pass
    return ""  # silently returns empty string — caller never knows lookup failed
