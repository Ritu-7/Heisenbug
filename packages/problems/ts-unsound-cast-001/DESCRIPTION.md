# TYPE-001 · Unsound type assertion silently breaks at runtime

**Track:** Type Safety · **Difficulty:** Easy · **Est. time:** 20 min  
**Skills:** typescript · type-safety · static-analysis  
**Stack:** TypeScript

---

## Ticket context

**Reported by:** On-call engineer (post-incident review)  
**Severity:** 🟡 Medium  
**Affects:** Production — user profile loading  
**Reproducibility:** Happens whenever the user API returns a malformed response (field renamed, API schema drift, network truncation)

### User-facing symptom

The application crashes with:

```
TypeError: Cannot read properties of undefined (reading 'toLowerCase')
    at loadUser (userLoader.js:34:18)
```

This error is confusing: the stack trace points to **our code**, but the real
cause is that the external API returned `{}` instead of a full `User` object.
TypeScript did not catch this because the code uses `data as User` — an
assertion that bypasses all type checking.

### Root-cause area (your job is to fix it)

`src/userLoader.ts` — the `loadUser` function receives an `unknown` value from
an external API fetch and immediately casts it with `as User`. This compiles
cleanly, but it is an **unsound assertion**: TypeScript trusts the developer's
claim without validating a single field at runtime. If the API response is
missing `email`, the cast succeeds but `user.email.toLowerCase()` crashes.

---

## Codebase tour

```
src/
  userLoader.ts     ← the file you will edit
```

---

## Requirements you must satisfy

### R1 — Add real runtime validation before accepting external data

Replace the bare `as User` assertion with a **type guard function** — a
function that takes `unknown` and returns `data is User`, checking every
required field (`id`, `email`, `name`, `role`) at runtime before narrowing
the type.

### R2 — Reject invalid data with a clear error

If the API response does not match the `User` shape, `loadUser` must throw a
descriptive `Error` before accessing any property on the response.

### R3 — Preserve the existing function signature

The exported `loadUser(fetchFn, userId)` signature must remain unchanged.
You may add helper functions.

---

## Acceptance criteria (auto-checked by static analysis — no test runner needed)

| ID | Suite | Check | Weight |
|----|-------|-------|--------|
| V1 | Visible | Code compiles without errors under `tsc --noEmit` | 20 pts |
| V2 | Visible | Code compiles cleanly (no syntax errors in diagnostics) | 20 pts |
| H1 | Hidden | Code compiles cleanly under `tsc --noEmit --strict` | 30 pts |
| H2 | Hidden | AST check: no bare `as User` assertion without a preceding type guard | 30 pts |

**Visible total:** 40 pts · **Hidden total:** 60 pts · **Grand total:** 100 pts

> **Note:** This problem is graded entirely by static analysis — `tsc` and the
> TypeScript compiler API. Your code is **never executed**. There is no test
> runner, no Docker container, and no runtime environment involved.
