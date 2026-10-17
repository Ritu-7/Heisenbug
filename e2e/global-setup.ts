import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup() {
  // Sets up Clerk testing tokens to bypass bot detection during Playwright test runs
  try {
    await clerkSetup();
  } catch (err) {
    console.warn('[e2e/global-setup] Clerk testing token setup warning:', err);
  }
}
