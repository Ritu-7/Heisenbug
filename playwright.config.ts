import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [
    ['list'],
    ['github'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: process.env.CI
        ? 'node apps/api/dist/index.js'
        : 'npm --workspace=@heisenbug/api run dev',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ||
          'postgresql://neondb_owner:npg_HREtBgIDO19u@ep-billowing-leaf-az3yxma3-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
        PORT: '3001',
        JWT_SECRET:
          process.env.JWT_SECRET || 'jfSKBkvJP9ynQM78g9OFLl55mC0vSm6la0KqQ9M+Oa+665famfaLfJG7gboUzmmi',
        CLERK_PUBLISHABLE_KEY:
          process.env.CLERK_PUBLISHABLE_KEY ||
          'pk_test_bmV4dC1kb3J5LTQ1MjguY2xlcmsuYWNjb3VudHMuZGV2JA',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
          'pk_test_bmV4dC1kb3J5LTQ1MjguY2xlcmsuYWNjb3VudHMuZGV2JA',
        CLERK_SECRET_KEY:
          process.env.CLERK_SECRET_KEY ||
          'sk_test_CPWfOno8bpFZTxxUPah5RsdeSB4agy7tNIaTgMdLxB',
      },
    },
    {
      command: process.env.CI
        ? 'npm --workspace=@heisenbug/web run start'
        : 'npm --workspace=@heisenbug/web run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: '3000',
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
          'pk_test_bmV4dC1kb3J5LTQ1MjguY2xlcmsuYWNjb3VudHMuZGV2JA',
        CLERK_SECRET_KEY:
          process.env.CLERK_SECRET_KEY ||
          'sk_test_CPWfOno8bpFZTxxUPah5RsdeSB4agy7tNIaTgMdLxB',
      },
    },
  ],
});
