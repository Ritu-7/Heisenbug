# Bad Patch: `try/catch` around the unsound cast

## What it does

Wraps the `data as User` assertion in a `try/catch` block, apparently hoping
to catch type-related errors at runtime.

## Why it fails

### 1. TypeScript `as` assertions are erased at compile time

`data as User` is purely a compile-time directive. It tells the TypeScript
compiler "trust me, this is a `User`" — but it compiles to **nothing** in
JavaScript. There is no runtime operation, no check, no coercion. The
try/catch catches nothing because the cast cannot throw.

### 2. The actual crash happens outside the try block

The `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`
occurs on `user.email.toLowerCase()`, which is **inside the `return`
statement** outside the try block in this patch. The catch clause is never
reached.

### 3. The bare `as User` assertion is still present

The AST check looks for `AsExpression` nodes whose target type references
`User` without a preceding type guard. This patch still has `data as User`,
so it correctly fails the hidden structural check.

### 4. `--strict` mode reveals the underlying problem

Under `--strict`, TypeScript notices that `user` is potentially uninitialised
(`let user: User;` without a guaranteed assignment path), and may flag
additional narrowing issues. The strict compilation check fails.

## Score: 20 / 100

| Check | Result | Reason |
|-------|--------|--------|
| V1 — compiles (non-strict) | ✅ PASS | TypeScript accepts the cast without --strict |
| V2 — no syntax errors | ✅ PASS | File is syntactically valid |
| H1 — compiles --strict | ❌ FAIL | `let user: User` without guaranteed init; strict narrowing errors |
| H2 — no bare `as User` without guard | ❌ FAIL | `data as User` is still present, no guard precedes it |
