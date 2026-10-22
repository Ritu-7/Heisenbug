// src/userLoader.ts — External API response handler
// TYPE-001: Fix unsound type assertion
//
// This module fetches a user record from an external API endpoint and returns
// a typed User object. The current implementation compiles cleanly under tsc,
// but it contains a critical type-safety bug: a raw `as User` assertion with
// no runtime validation, which will throw a TypeError at runtime on any
// malformed API response.
//
// YOUR JOB: replace the unsound cast with real runtime validation.

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "candidate" | "recruiter";
}

/**
 * Fetches a user by ID from the external API.
 * Returns a User object or throws if the user is not found or the response
 * is malformed.
 *
 * BUG: `data as User` is an unsound assertion — TypeScript trusts us that
 * `data` is a User, but we never validate it. A malformed API response
 * (e.g. missing `email`, or `data` being null) will cause a runtime crash
 * on `user.email.toLowerCase()` with no useful error message.
 */
export async function loadUser(
  fetchFn: (url: string) => Promise<unknown>,
  userId: string
): Promise<User> {
  const data = await fetchFn(`/api/users/${userId}`);

  // ──────────────────────────────────────────────────────────────────────────
  // BUG: Unsound type assertion — no runtime validation performed.
  // TypeScript accepts this, but if `data` is null, {}, or missing fields,
  // the next line throws a TypeError that is hard to debug.
  const user = data as User;
  // ──────────────────────────────────────────────────────────────────────────

  return {
    id: user.id,
    email: user.email.toLowerCase(),
    name: user.name.trim(),
    role: user.role,
  };
}
