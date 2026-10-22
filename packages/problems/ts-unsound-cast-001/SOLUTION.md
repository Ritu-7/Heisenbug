## Solution — TYPE-001: Unsound type assertion silently breaks at runtime

### Key insight

`data as User` is a compile-time lie to the compiler. Replace it with a
**type guard** that validates every field at runtime, so the type system's
guarantees actually reflect reality.

### Reference solution

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "candidate" | "recruiter";
}

const VALID_ROLES = new Set<string>(["admin", "candidate", "recruiter"]);

function isUser(data: unknown): data is User {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d["id"] === "string" &&
    typeof d["email"] === "string" &&
    typeof d["name"] === "string" &&
    typeof d["role"] === "string" &&
    VALID_ROLES.has(d["role"] as string)
  );
}

export async function loadUser(
  fetchFn: (url: string) => Promise<unknown>,
  userId: string
): Promise<User> {
  const data = await fetchFn(`/api/users/${userId}`);

  if (!isUser(data)) {
    throw new Error(
      `API returned an invalid user shape for userId=${userId}: ` +
        JSON.stringify(data)
    );
  }

  return {
    id: data.id,
    email: data.email.toLowerCase(),
    name: data.name.trim(),
    role: data.role,
  };
}
```

### What changed

| Before | After |
|--------|-------|
| `const user = data as User;` | Type guard `isUser(data)` validates all fields |
| Silent crash on `user.email.toLowerCase()` | Descriptive `Error` thrown before any field access |
| Fails `tsc --strict` (latent issues) | Passes `tsc --strict` cleanly |
| Fails AST check (bare `as User` present) | Passes AST check (no unsafe assertion) |
