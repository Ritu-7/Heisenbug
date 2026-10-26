# Editorial — py-missing-null-check-001

## The Bug

`dict.get(key)` in Python returns `Optional[T]` — it returns `None` when the
key is absent. The type hint is truthful: the return type is `Optional[User]`.
Accessing `.email` on a `None` value raises:

```
AttributeError: 'NoneType' object has no attribute 'email'
```

This is one of the most common runtime crashes in Python, and mypy's `--strict`
mode is specifically designed to catch it **before** it reaches production.

## What mypy sees

With `--strict`, mypy infers:

```python
user = _USER_REGISTRY.get(user_id)  # user: Optional[User]
return user.email                    # ERROR: Item "None" of "Optional[User]"
                                     #        has no attribute "email" [union-attr]
```

The `[union-attr]` error code is mypy's signal that you are accessing an
attribute on a union type that includes `None`, without first narrowing the type.

## The Correct Fix

Any of these patterns satisfies both mypy and the AST checker:

### Pattern 1 — Explicit `if user is None: raise` (recommended)

```python
user = _USER_REGISTRY.get(user_id)
if user is None:
    raise KeyError(f"User '{user_id}' not found in registry")
return user.email   # mypy narrows to User here
```

### Pattern 2 — `assert user is not None`

```python
user = _USER_REGISTRY.get(user_id)
assert user is not None, f"User '{user_id}' not found"
return user.email
```

### Pattern 3 — Truthiness guard

```python
user = _USER_REGISTRY.get(user_id)
if not user:
    raise KeyError(f"User '{user_id}' not found")
return user.email
```

## What Does NOT Work

### ❌ try/except around the attribute access

```python
try:
    return user.email    # still Optional[User] — mypy still errors
except:
    return ""
```

This does not add a guard *before* the attribute access; it merely catches the
crash after it happens. mypy still sees `user.email` on an `Optional[User]`
and errors. The AST checker confirms there is no `if user is None` (or
equivalent) preceding the access.

### ❌ Suppressing mypy with `# type: ignore`

Adding `# type: ignore` to silence mypy is the Python equivalent of the
TypeScript `as User` unsound cast — it hides the problem rather than fixing it.
The AST checker looks at the structure of the code, not the mypy output, so a
`# type: ignore` comment does not help.

## The AST Check Logic

The hidden H2 check runs a Python subprocess that:

1. Parses the submitted file with `ast.parse()`.
2. For each function, finds variables assigned from `.get()` calls.
3. For each such variable, checks whether any attribute access (`.anything`)
   happens **before** a None guard (`if var is None`, `if not var`,
   `if var is not None`, `isinstance(var, ...)`) in source-code order.
4. If an unguarded attribute access is found, the check fails.

This mirrors the TypeScript `hasGuardBefore` logic in `staticTscGrader.ts`
exactly — the guard must appear before the unsafe access, not after.
