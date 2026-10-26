# NULL-001 — Optional return silently causes AttributeError at runtime

**Track:** Type Safety · **Difficulty:** Easy · **Est. time:** 15 min  
**Skills:** python · type-hints · static-analysis  
**Stack:** Python 3.10+

---

## Ticket context

**Reported by:** On-call engineer (post-incident review)  
**Severity:** 🟡 Medium  
**Affects:** Production — user profile lookup  
**Reproducibility:** Happens whenever a user ID is looked up that does not exist in the registry

### User-facing symptom

The service crashes with:

```
AttributeError: 'NoneType' object has no attribute 'email'
    at get_user_email (user_service.py:47)
```

This error is confusing: the stack trace points to **our code**, but the real
cause is that `dict.get()` returned `None` for an unknown user ID — and the
code immediately tried to read `.email` on it. The type hint `Optional[User]`
is right there in the type system, but there is no runtime check.

### Root-cause area (your job is to fix it)

`src/user_service.py` — the `get_user_email` function calls
`_USER_REGISTRY.get(user_id)`, which returns `Optional[User]`. The result is
immediately used as `user.email` with no guard. If `user_id` is absent, `user`
is `None` and the attribute access raises `AttributeError`.

mypy in strict mode already knows this is wrong and flags it:

```
error: Item "None" of "Optional[User]" has no attribute "email"  [union-attr]
```

---

## Codebase tour

```
src/
  user_service.py     ← the file you will edit
```

---

## Requirements you must satisfy

### R1 — Add a real runtime None check before accessing `.email`

After `_USER_REGISTRY.get(user_id)`, add an explicit guard that handles the
`None` case **before** any attribute access on the result. An `if user is None:
raise ...` is the clearest form. `assert user is not None` is also acceptable.
Do **not** use `try/except` to swallow the `AttributeError` — that is a
different antipattern and does not fix the root cause.

### R2 — Raise a clear, descriptive error for missing users

If the user is not found, raise a `KeyError` (or `ValueError`) with a message
that includes the `user_id`, so callers get actionable information instead of a
confusing `AttributeError: 'NoneType'`.

### R3 — Preserve the existing function signature

`get_user_email(user_id: str) -> str` must remain unchanged. You may add helper
functions or intermediate variables.

---

## Acceptance criteria (auto-checked by static analysis — no test runner needed)

| ID | Suite | Check | Weight |
|----|-------|-------|--------|
| V1 | Visible | File parses as valid Python (no `SyntaxError`) | 20 pts |
| V2 | Visible | mypy (non-strict) reports no errors | 20 pts |
| H1 | Hidden | mypy `--strict` reports no errors | 30 pts |
| H2 | Hidden | AST check: no unguarded attribute access on `.get()` result | 30 pts |

**Visible total:** 40 pts · **Hidden total:** 60 pts · **Grand total:** 100 pts

> **Note:** This problem is graded entirely by static analysis — `mypy` and
> the Python `ast` module. Your code is **never executed**. There is no test
> runner, no Docker container, and no runtime environment involved.
