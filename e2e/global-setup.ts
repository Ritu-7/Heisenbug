import { clerkSetup } from '@clerk/testing/playwright';

export default async function globalSetup() {
  // Sets up Clerk testing tokens to bypass bot detection during Playwright test runs
  await clerkSetup();
}
