## Editorial — TYPE-001: Unsound type assertion silently breaks at runtime

### Root cause

`data as User` is a **type assertion** — it is a compile-time-only annotation
that tells TypeScript's type checker to treat `data` as `User`. It compiles
to **nothing** in JavaScript. No property check, no structural validation,
no coercion is performed. The JavaScript runtime has no concept of TypeScript
interfaces.

When the external API returns `{}`, `null`, or an object with `email: 42`,
TypeScript is satisfied because the assertion silenced its warnings. But the
next line `user.email.toLowerCase()` accesses a property that does not exist
(or has the wrong type), causing a `TypeError` at runtime — far from the
actual source of the problem, making debugging difficult.

### Why the compiler doesn't catch it

TypeScript's type system is **structural and opt-in at runtime boundaries**.
At compile time, the assertion `data as User` is valid because TypeScript
assumes the developer knows something the type system cannot — for instance,
that a deserialized JSON object matches an interface. TypeScript gives you the
benefit of the doubt with `as`, even under `--strict`. (Note: TypeScript *will*
refuse assertions that are clearly impossible, e.g. `"hello" as number`, but
`unknown as User` is always permitted.)

The only way to make the boundary safe is to add **your own runtime check**.

### Approaches compared

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **Type guard function** (recommended) | Explicit, composable, testable; narrows type without a cast; zero deps | Manual to write for large schemas | Any trusted boundary; safe by default |
| **Schema validation library** (zod, io-ts, valibot) | Generates TypeScript types from schema; rich error messages | Adds a dependency | Production APIs, complex schemas |
| **`as unknown as T` double-cast** | Silences more type errors | Still entirely unsound; zero runtime safety | Never — this is worse |
| **`try/catch` around the cast** | Looks safe | `as T` never throws; catch is dead code; crash still happens downstream | Never — this is a common mistake |

### Recommended approach: type guard function

```typescript
function isUser(data: unknown): data is User {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d["id"] === "string" &&
    typeof d["email"] === "string" &&
    typeof d["name"] === "string" &&
    typeof d["role"] === "string" &&
    ["admin", "candidate", "recruiter"].includes(d["role"] as string)
  );
}
```

Then in `loadUser`:

```typescript
if (!isUser(data)) {
  throw new Error(`API returned invalid user shape: ${JSON.stringify(data)}`);
}
// data is now narrowed to User — no cast required.
```

### Why this is safe under `--strict`

Under strict mode, TypeScript requires that every type be provably correct.
The type guard narrows `data` from `unknown` to `User` through a conditional
branch — this is the only mechanism that TypeScript recognises as a legitimate
narrowing of `unknown`. After the `if (!isUser(data)) throw` guard, the type
checker knows `data` is `User` in all subsequent code paths.

### Common pitfalls

- **Checking only one field:** If your guard only checks `typeof data.email === "string"`,
  an object with `email` but without `id` will pass. Check every field.
- **Checking shape but not role enum:** The `role` field has only three allowed
  values. Accept only those; reject unknown strings.
- **Validating inside a try/catch:** `as T` cannot throw, so a try/catch around
  it is dead code. Validate before you cast.
- **Re-exporting the interface:** Make sure the `User` interface export is
  preserved — downstream modules may import it.

### How the grader works

This problem uses `testFramework: "static-tsc"`. The grader:

1. Writes your submitted code to a temporary `.ts` file.
2. Runs `tsc --noEmit` → visible check V1.
3. Runs `tsc --noEmit --strict` → hidden check H1.
4. Uses the TypeScript compiler API to walk the AST of your file, looking for
   `AsExpression` nodes whose cast target references `User` and are **not**
   preceded by a narrowing guard in the same function scope → hidden check H2.

No Docker container is spun up. Your code is never executed.
