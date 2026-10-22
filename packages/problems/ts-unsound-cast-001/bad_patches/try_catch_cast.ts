// bad_patches/try_catch_cast.ts — Plausible wrong fix for ts-unsound-cast-001
//
// This "fix" wraps the unsound `as User` assertion in a try/catch, hoping to
// catch runtime errors. It fails on multiple fronts:
//
// 1. The cast itself never throws — `as User` is erased at compile time.
//    It's a compiler directive, not a runtime operation. The try/catch around
//    it is useless.
// 2. The actual TypeError happens on `user.email.toLowerCase()` inside the
//    return statement — outside the try block in this patch.
// 3. The cast `data as User` is still present, so the AST check correctly
//    identifies it as an unsound assertion.
// 4. Under --strict, TypeScript flags that `user` may be an empty object
//    because we have not narrowed it — tsc --strict will still error.

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "candidate" | "recruiter";
}

export async function loadUser(
  fetchFn: (url: string) => Promise<unknown>,
  userId: string
): Promise<User> {
  const data = await fetchFn(`/api/users/${userId}`);

  // "Fix": try/catch around the cast — but the cast never throws!
  // This does nothing to prevent the runtime crash on malformed data.
  let user: User;
  try {
    user = data as User; // still an unsound assertion — no runtime validation
  } catch {
    throw new Error("Unexpected cast error"); // dead code
  }

  return {
    id: user.id,
    email: user.email.toLowerCase(), // still crashes here on null/missing email
    name: user.name.trim(),
    role: user.role,
  };
}
