# Bad Patch: `bare except: pass` swallows the error without fixing the root cause

## What it does

Wraps the `user.email` attribute access in a `try/except` block with a bare
`except: pass`, catching the `AttributeError` that fires when `user` is `None`
and silently returning an empty string `""`.

## Why it fails

### 1. The attribute access still happens before any None check

The line `return user.email` is the very first thing inside the `try` block —
`user` is still `Optional[User]` at that point, still potentially `None`. The
try/except doesn't prevent the `AttributeError`; it merely catches it after it
fires. The **root cause** (missing None guard before the access) is untouched.

The AST check walks the function body looking for attribute accesses on
variables assigned from `.get()` calls. It finds `user.email` at line 48 and
confirms there is no `if user is None`, `if user is not None`, truthiness check,
or `isinstance` guard that appears *before* that line in the function. The
check correctly flags this as an unguarded access.

### 2. mypy --strict still errors

Under `mypy --strict`, `_USER_REGISTRY.get(user_id)` returns `Optional[User]`,
so `user` is typed as `Optional[User]`. The `try/except` block does nothing
to narrow that type. mypy will still report:

```
error: Item "None" of "Optional[User]" has no attribute "email"  [union-attr]
```

### 3. Bare `except: pass` is an antipattern that silences bugs

A bare `except:` catches **everything** — `KeyboardInterrupt`, `SystemExit`,
`MemoryError`, and any future programming mistakes in the same block. Returning
`""` silently means callers get wrong data with no indication of failure, which
is worse than the original crash (at least the crash is visible).

### 4. The function's return type contract is broken

The function promises to return `str`. Returning `""` when a user is not found
violates the semantic contract (the caller cannot distinguish "empty email" from
"user not found") and may propagate silent data corruption downstream.

## Score: 20 / 100

| Check | Result | Reason |
|-------|--------|--------|
| V1 — syntax check (parses cleanly) | ✅ PASS | Valid Python syntax |
| V2 — mypy non-strict | ❌ FAIL | `user.email` on `Optional[User]` is a type error even without `--strict` |
| H1 — mypy --strict | ❌ FAIL | `Item "None" of "Optional[User]" has no attribute "email" [union-attr]` |
| H2 — AST: no unguarded `.get()` result attribute access | ❌ FAIL | `user.email` at line 48 has no preceding None guard |
