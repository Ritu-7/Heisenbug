import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Candidate Practice Flow', () => {
  test('sign in, view problem tabs, run partial starter code, submit reference solution for 100/100', async ({
    page,
    request,
  }) => {
    // 1. Sign in as the seeded candidate
    const loginRes = await request.post('http://localhost:3001/api/auth/login', {
      data: {
        email: 'alice@heisenbug.dev',
        password: 'testcandidate123',
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token } = await loginRes.json();
    expect(token).toBeTruthy();

    await page.addInitScript((authToken) => {
      localStorage.setItem('heisenbug_jwt_token', authToken);
    }, token);

    // 2. Open the catalogue
    await page.goto('/');
    await expect(page.locator('header')).toContainText('alice@heisenbug.dev');
    await expect(page.getByRole('heading', { name: 'Problem Catalogue' })).toBeVisible();

    // 3. Click into be-idempotency-001
    const problemLink = page.locator('a[href="/problems/be-idempotency-001"]');
    await expect(problemLink).toBeVisible();
    await problemLink.click();

    await page.waitForURL('**/problems/be-idempotency-001*');
    await expect(page.getByRole('heading', { name: 'Checkout double-charges on client retry', exact: true })).toBeVisible();

    // 4. Verify Description / Test cases / Hints tabs render real content
    // Description tab (default active) contains ticket context and test cases table
    await expect(page.locator('text=Ticket context')).toBeVisible();
    await expect(page.locator('text=Acceptance criteria (auto-checked)')).toBeVisible();
    await expect(page.locator('text=Idempotency-Key header is missing')).toBeVisible();

    // Switch to Hints tab
    const hintsTab = page.getByRole('button', { name: /^Hints/i });
    await expect(hintsTab).toBeVisible();
    await hintsTab.click();
    // Verify hints tab renders real content (either hint cards or fallback placeholder)
    await expect(page.locator('text=No hints written yet for this problem.')).toBeVisible();

    // Verify "Common Near-Misses" tab is NOT visible before solving
    await expect(page.getByRole('button', { name: /Common Near-Misses/i })).not.toBeVisible();

    // Switch back to Description tab
    const descTab = page.getByRole('button', { name: /^Description/i });
    await descTab.click();
    await expect(page.locator('text=Ticket context')).toBeVisible();

    // 5. If "Start session" button is present, click it to initialize a practice session
    const startSessionBtn = page.getByRole('button', { name: /Start session/i });
    if (await startSessionBtn.isVisible()) {
      await startSessionBtn.click();
      await expect(startSessionBtn).not.toBeVisible({ timeout: 15_000 });
    }

    const runBtn = page.getByRole('button', { name: /▶ Run/i });
    await expect(runBtn).toBeEnabled({ timeout: 15_000 });

    // 6. Click Run and assert the real partial-pass result renders
    await runBtn.click();
    // Wait for Docker test execution to finish and verdict banner to appear
    const runVerdict = page.locator('text=Run result');
    await expect(runVerdict).toBeVisible({ timeout: 60_000 });
    // Starter code does not pass all checks; assert partial score renders
    await expect(page.locator('text=/pts/').first()).toBeVisible();
    await expect(page.locator('text=V1').first()).toBeVisible();

    // 7. Load reference solution into the editor
    const refSolutionPath = path.resolve(
      __dirname,
      '../packages/problems/be-idempotency-001/solutions/reference.js',
    );
    expect(fs.existsSync(refSolutionPath)).toBeTruthy();
    const referenceCode = fs.readFileSync(refSolutionPath, 'utf-8');

    await page.evaluate((code) => {
      const setVal = (window as any).__setMonacoValue;
      if (typeof setVal === 'function') {
        setVal(code);
      } else {
        throw new Error('__setMonacoValue not available on window');
      }
    }, referenceCode);

    // Wait for autosave debounce (2000ms) to persist CODE_SAVE event to database
    await expect(page.locator('text=Saved to database')).toBeVisible({ timeout: 10_000 });

    // 8. Submit the reference solution with confidence rating
    const submitBtn = page.getByRole('button', { name: /^Submit$/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Verify inline confidence prompt appears right before submit fires
    await expect(page.locator('text=How confident are you this passes?')).toBeVisible();
    await expect(page.locator('text=Skip & Submit')).toBeVisible();

    // Select 80% confidence and submit
    const confidence80Btn = page.getByRole('button', { name: '80%' });
    await expect(confidence80Btn).toBeVisible();
    await confidence80Btn.click();

    const confirmSubmitBtn = page.getByRole('button', { name: /Submit \(80%\)/i });
    await expect(confirmSubmitBtn).toBeVisible();
    await confirmSubmitBtn.click();

    // 9. Assert real 100/100 verdict renders in the UI
    const submitVerdict = page.locator('text=Submit verdict');
    await expect(submitVerdict).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('text=100/100 pts (100%)')).toBeVisible();
    await expect(page.locator('text=✓').first()).toBeVisible();

    // Assert real calibration comparison renders:
    // "You said 80% confident — you scored 100/100"
    await expect(page.locator('text=You said 80% confident — you scored 100/100')).toBeVisible();

    // 10. Assert "Common Near-Misses" tab is now visible ONLY after genuine pass
    const nearMissesTab = page.getByRole('button', { name: /Common Near-Misses/i });
    await expect(nearMissesTab).toBeVisible();
    await nearMissesTab.click();

    // Verify bad patch score from validate.ts / meta.json (85/100 pts) and explanation render
    await expect(page.getByRole('heading', { name: 'Common Near-Misses & Pitfalls' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In-Memory Map Cache', exact: true })).toBeVisible();
    await expect(page.locator('text=85/100 pts').first()).toBeVisible();
    await expect(page.locator('text=Fails: H1').first()).toBeVisible();
    await expect(page.locator('text=The Flaw').first()).toBeVisible();
    await expect(page.locator('text=Which Hidden Check Catches It').first()).toBeVisible();
    await expect(page.locator('text=Not enough data yet').or(page.locator('text=% of submissions')).first()).toBeVisible();

    // 11. Navigate to candidate dashboard and verify real calibration gap stat
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Candidate Dashboard' })).toBeVisible();
    await expect(page.locator('text=Calibration gap').first()).toBeVisible();
    // 80% confidence - 100 actual = -20% -> Underconfident
    await expect(page.locator('text=Underconfident').first()).toBeVisible();
    await expect(page.locator('text=-20%')).toBeVisible();
  });
});
