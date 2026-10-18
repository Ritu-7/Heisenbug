import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup() {
  if (!process.env.CLERK_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_bmV4dC1kb3J5LTQ1MjguY2xlcmsuYWNjb3VudHMuZGV2JA';
  }
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
  }
  if (!process.env.CLERK_SECRET_KEY) {
    process.env.CLERK_SECRET_KEY = 'sk_test_CPWfOno8bpFZTxxUPah5RsdeSB4agy7tNIaTgMdLxB';
  }

  // Sets up Clerk testing tokens to bypass bot detection during Playwright test runs
  try {
    await clerkSetup();
  } catch (err) {
    console.warn('[e2e/global-setup] Clerk testing token setup warning:', err);
  }
}
