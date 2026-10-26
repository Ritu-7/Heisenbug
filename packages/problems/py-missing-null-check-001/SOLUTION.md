# Solution — py-missing-null-check-001

The fix is a single `if user is None: raise KeyError(...)` guard inserted
immediately after the `.get()` call, before any attribute access.

```python
def get_user_email(user_id: str) -> str:
    user: Optional[User] = _USER_REGISTRY.get(user_id)

    if user is None:
        raise KeyError(f"User '{user_id}' not found in registry")

    return user.email  # mypy narrows type to User — no error
```

**Why this works:**

- mypy's control-flow analysis (type narrowing) sees the `if user is None: raise`
  and knows that on the line after it, `user` can no longer be `None`. So
  `user.email` is now accessing an attribute on `User`, not `Optional[User]`.
- The H2 AST check finds the `if user is None:` node at a line number *before*
  `user.email`, so `hasGuardBefore` returns `True` and the check passes.
- The explicit `KeyError` gives callers a useful message including the user ID.
