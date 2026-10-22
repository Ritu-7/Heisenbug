// solutions/reference.ts — Reference solution for ts-unsound-cast-001
//
// Replace the bare `as User` assertion with a proper type guard that validates
// every field at runtime before narrowing the type.

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "candidate" | "recruiter";
}

const VALID_ROLES = new Set<string>(["admin", "candidate", "recruiter"]);

/**
 * Type guard: validates that `data` has the exact shape of User at runtime.
 * Returns true iff every required field is present with the correct primitive type.
 */
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

/**
 * Fetches a user by ID from the external API.
 * Throws a descriptive error if the API response is not a valid User shape,
 * instead of silently propagating the wrong type and crashing later.
 */
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

  // `data` is now narrowed to User by the type guard — no cast needed.
  return {
    id: data.id,
    email: data.email.toLowerCase(),
    name: data.name.trim(),
    role: data.role,
  };
}
