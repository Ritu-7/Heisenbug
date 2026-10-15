import { createClerkClient } from '@clerk/backend';

const CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY || 'sk_test_stp220g73j4tus1ZlV8JNEuNghs4eHG1uJ7fctDnBf';

const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });

const DEMO_USER_IDS: Record<string, string> = {
  'alice@heisenbug.dev': 'user_3Kj03zYIzBuj6qJn3k1Q1wcHn7e',
  'recruiter@heisenbug.dev': 'user_3Kj044VTw2XS8PQw3iHHckytYzj',
  'admin@heisenbug.dev': 'user_3Kj048oi2wO3sqP1mh97dCDOMtV',
  'author@heisenbug.dev': 'user_3Kj04GrfHvi9ziOyM8dMwYk4PTX',
};

/**
 * Obtains a genuine Clerk-issued session token using Clerk's backend SDK.
 * Used for authenticated Playwright E2E testing without bypasses or hardcoded JWTs.
 */
export async function getClerkSessionToken(email: string): Promise<string> {
  let userId = DEMO_USER_IDS[email.toLowerCase()];

  if (!userId) {
    const userList = await clerk.users.getUserList({ emailAddress: [email] });
    const user = userList.data?.[0];
    if (!user) {
      throw new Error(`Real Clerk user not found for email: ${email}`);
    }
    userId = user.id;
  }

  // Create real Clerk session and mint a genuine token
  const session = await clerk.sessions.createSession({ userId });
  const tokenObj = await clerk.sessions.getToken(session.id);

  if (!tokenObj?.jwt) {
    throw new Error(`Failed to obtain Clerk session token for user: ${userId}`);
  }

  return tokenObj.jwt;
}
