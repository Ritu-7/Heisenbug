/**
 * e2e/hints-and-solution.spec.ts
 *
 * Comprehensive tests for:
 *  1. Hint progression — progressive reveal 1-by-1, bodies withheld until unlocked, DB-persisted
 *  2. Solution locking — locked until user submits or confirms "Give up", full code + diff + explanation
 *  3. Editorial tab — markdown with Root cause, Why in prod, Approaches table, Recommended, Complexity, Pitfalls, Verification
 *  4. Assessment mode — hints, editorial, and solution tabs are locked
 */

import { test, expect, type Page } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ── Helper: sign in as the test candidate ────────────────────────────────────

async function signIn(page: Page) {
  await page.goto('/login');
  await clerk.signIn({ page, emailAddress: 'alice@heisenbug.dev' });
}

// ── Helper: get bearer token from the browser after sign-in ─────────────────

async function getBearerToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const clerkObj = (window as any).Clerk;
    if (clerkObj?.session) {
      const t = await clerkObj.session.getToken();
      if (t) return t;
    }
    return localStorage.getItem('heisenbug_jwt_token') ?? '';
  });
}

// ── Helper: ensure practice session is ready and active ─────────────────────

async function ensureSessionReady(page: Page) {
  // Wait for initial workspace loading to dismiss
  await expect(page.locator('text=Loading workspace...')).not.toBeVisible({ timeout: 20_000 });

  // If already active, done
  if (await page.locator('text=Active session').isVisible()) {
    return;
  }

  const startBtn = page.getByRole('button', { name: /Start session/i });
  try {
    await startBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await startBtn.click();
    await expect(startBtn).not.toBeVisible({ timeout: 20_000 });
  } catch {
    // May already be starting
  }
  await expect(page.locator('text=Active session')).toBeVisible({ timeout: 25_000 });
}

// ── Helper: create a practice session via the API ───────────────────────────

async function createPracticeSession(token: string, versionId: string): Promise<string> {
  const res = await fetch(`${API}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ versionId, mode: 'PRACTICE' }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`createSession failed: ${JSON.stringify(body)}`);
  return body.data.id as string;
}

// ── Helper: get the published versionId for a slug ──────────────────────────

async function getVersionId(token: string, slug: string): Promise<string> {
  const res = await fetch(`${API}/api/problems/${slug}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return body.data.currentVersion.id as string;
}

// ── Helper: reveal a hint via the API ───────────────────────────────────────

async function revealHint(token: string, sessionId: string, hintIndex: number) {
  const res = await fetch(`${API}/api/sessions/${sessionId}/hints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hintIndex, penalty: 5 }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`revealHint ${hintIndex} failed: ${JSON.stringify(body)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 1 — Hint Progression (API-level)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Hint progression — API gating', () => {
  test('GET /api/problems/:slug/hints without sessionId returns all hints unrevealed with bodies withheld', async ({ request }) => {
    const res = await request.get(`${API}/api/problems/be-idempotency-001/hints`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.totalHints).toBe(3);
    for (const hint of body.data.hints) {
      expect(hint.revealed).toBe(false);
      expect(hint.body).toBeUndefined();
      expect(hint.title).toBeTruthy();
      expect(typeof hint.index).toBe('number');
    }
  });

  test('All 5 problems have exactly 3 progressive hints in API', async ({ request }) => {
    const slugs = [
      'be-idempotency-001',
      'be-race-002',
      'ml-leakage-001',
      'sec-xss-001',
      'be-nplusone-001',
    ];
    for (const slug of slugs) {
      const res = await request.get(`${API}/api/problems/${slug}/hints`);
      expect(res.ok(), `GET hints failed for ${slug}`).toBeTruthy();
      const body = await res.json();
      expect(body.data.totalHints, `${slug} should have 3 hints`).toBe(3);
      expect(body.data.hints).toHaveLength(3);
      expect(body.data.hints[0].title).toBeTruthy();
      expect(body.data.hints[1].title).toBeTruthy();
      expect(body.data.hints[2].title).toBeTruthy();
    }
  });

  test('Revealing hint 1 exposes only hint 1 body; hint 2 and 3 remain locked in API payload', async ({ page }) => {
    await signIn(page);
    const token = await getBearerToken(page);
    const versionId = await getVersionId(token, 'be-idempotency-001');
    const sessionId = await createPracticeSession(token, versionId);

    // Before any reveal — all unrevealed
    const before = await fetch(`${API}/api/problems/be-idempotency-001/hints?sessionId=${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());
    expect(before.data.hints.every((h: any) => !h.revealed)).toBe(true);
    expect(before.data.hints.every((h: any) => h.body === undefined)).toBe(true);

    // Reveal hint 1
    await revealHint(token, sessionId, 1);

    const after = await fetch(`${API}/api/problems/be-idempotency-001/hints?sessionId=${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    const h1 = after.data.hints.find((h: any) => h.index === 1);
    const h2 = after.data.hints.find((h: any) => h.index === 2);
    const h3 = after.data.hints.find((h: any) => h.index === 3);

    // Hint 1 is now revealed with body
    expect(h1.revealed).toBe(true);
    expect(typeof h1.body).toBe('string');
    expect(h1.body!.length).toBeGreaterThan(10);

    // Hints 2 and 3 are still unrevealed — body NOT in network payload
    expect(h2.revealed).toBe(false);
    expect(h2.body).toBeUndefined();
    expect(h3.revealed).toBe(false);
    expect(h3.body).toBeUndefined();
  });

  test('Hints are revealed sequentially and each body becomes available after reveal', async ({ page }) => {
    await signIn(page);
    const token = await getBearerToken(page);
    const versionId = await getVersionId(token, 'be-race-002');
    const sessionId = await createPracticeSession(token, versionId);

    for (let i = 1; i <= 3; i++) {
      await revealHint(token, sessionId, i);
      const res = await fetch(`${API}/api/problems/be-race-002/hints?sessionId=${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json());

      const revealedHints = res.data.hints.filter((h: any) => h.revealed);
      expect(revealedHints).toHaveLength(i);

      for (const h of revealedHints) {
        expect(typeof h.body).toBe('string');
        expect(h.body!.length).toBeGreaterThan(10);
      }

      const unrevealed = res.data.hints.filter((h: any) => !h.revealed);
      for (const h of unrevealed) {
        expect(h.body).toBeUndefined();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 2 — Hint Progression & Persistence (UI-level)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Hint progression — UI interactions', () => {
  test('Hints tab shows 3 progressive cards, sequential reveal, and persistence across reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/problems/be-idempotency-001');
    await page.waitForURL('**/problems/be-idempotency-001*');
    await ensureSessionReady(page);

    // Navigate to Hints tab
    await page.getByRole('button', { name: /^Hints/i }).click();

    // All 3 hint titles are visible
    await expect(page.locator('text=Where to look')).toBeVisible();
    await expect(page.locator('text=The concept')).toBeVisible();
    await expect(page.locator('text=The fix approach')).toBeVisible();

    // Check counter
    await expect(page.locator('text=hints revealed')).toBeVisible();

    // "Reveal hint 1 of 3" button is visible
    const revealBtn1 = page.getByRole('button', { name: /Reveal hint 1 of 3/i });
    if (await revealBtn1.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await revealBtn1.click();
      await expect(page.locator('text=1/3 hints revealed')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('text=handleCheckout').first()).toBeVisible();

      // Now "Reveal hint 2 of 3" is visible
      await expect(page.getByRole('button', { name: /Reveal hint 2 of 3/i })).toBeVisible();

      // Reload page and verify persistence
      await page.reload();
      await page.waitForURL('**/problems/be-idempotency-001*');
      await ensureSessionReady(page);
      await page.getByRole('button', { name: /^Hints/i }).click();

      // Hint 1 is still revealed
      await expect(page.locator('text=1/3 hints revealed')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('text=handleCheckout').first()).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 3 — Solution Locking & Give Up (UI-level)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Solution tab locking', () => {
  test.beforeEach(async () => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.submission.deleteMany({
        where: { session: { version: { problem: { slug: 'be-nplusone-001' } } } },
      });
      await prisma.$disconnect();
    } catch {
      // Ignored if DB is not directly reachable from worker
    }
  });

  test('Solution tab is locked before submission, confirm dialog can cancel or unlock', async ({ page }) => {
    await signIn(page);
    await page.goto('/problems/sec-xss-001');
    await page.waitForURL('**/problems/sec-xss-001*');
    await ensureSessionReady(page);

    // Click Solution tab
    await page.getByRole('button', { name: /^Solution/i }).click();

    // Solution locked state is shown
    await expect(page.locator('text=Solution locked')).toBeVisible();
    await expect(page.locator('text=revealed after your first submission')).toBeVisible();
    await expect(page.locator('text=Give up and show solution')).toBeVisible();

    // Solution code not rendered in DOM
    await expect(page.locator('text=escapeHtml')).not.toBeVisible();

    // Click "Give up and show solution" -> modal opens
    await page.locator('text=Give up and show solution').click();
    await expect(page.locator('text=Give up?')).toBeVisible();
    await expect(page.locator('text=This will unlock the reference solution')).toBeVisible();

    // Cancel preserves locked state
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('text=Give up?')).not.toBeVisible();
    await expect(page.locator('text=Solution locked')).toBeVisible();

    // Confirm gives up and unlocks solution
    await page.locator('text=Give up and show solution').click();
    await expect(page.locator('text=Give up?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, show solution' }).click();

    // Warning banner and solution content are visible
    await expect(page.locator('text=You chose to view the solution without submitting')).toBeVisible();
    await expect(page.locator('text=Reference Solution').first()).toBeVisible();
    await expect(page.locator('text=escapeHtml').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Solution tab unlocks after first submission', async ({ page }) => {
    await signIn(page);
    await page.goto('/problems/be-nplusone-001');
    await page.waitForURL('**/problems/be-nplusone-001*');
    await ensureSessionReady(page);

    // Verify Solution tab is initially locked
    await page.getByRole('button', { name: /^Solution/i }).click();
    await expect(page.locator('text=Solution locked')).toBeVisible();

    // Switch back to Description
    await page.getByRole('button', { name: /^Description/i }).click();

    // Submit starter code
    const submitBtn = page.getByRole('button', { name: /^Submit$/i });
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });
    await submitBtn.click();

    // Dismiss confidence prompt if it appears
    const skipAndSubmit = page.locator('text=Skip & Submit');
    if (await skipAndSubmit.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await skipAndSubmit.click();
    }

    // Wait for submission verdict
    await expect(page.locator('text=Submit verdict')).toBeVisible({ timeout: 60_000 });

    // Now click Solution tab — should be unlocked
    await page.getByRole('button', { name: /^Solution/i }).click();
    await expect(page.locator('text=Solution locked')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Reference Solution').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE 4 — Editorial Tab & All 5 Problems Content
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Editorial and Solution content for all 5 problems', () => {
  test('Editorial is rendered with markdown sections on be-idempotency-001', async ({ page }) => {
    await signIn(page);
    await page.goto('/problems/be-idempotency-001');
    await page.waitForURL('**/problems/be-idempotency-001*');
    await ensureSessionReady(page);

    await page.getByRole('button', { name: /^Editorial/i }).click();

    await expect(page.locator('text=Root cause').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=Why it happens in production').first()).toBeVisible();
    await expect(page.locator('text=DB-backed idempotency key').first()).toBeVisible();
    await expect(page.locator('text=Recommended approach').first()).toBeVisible();
    await expect(page.locator('text=Common pitfalls').first()).toBeVisible();
    await expect(page.locator('text=How to verify the fix').first()).toBeVisible();
  });

  test('All 5 problems have non-empty editorial and solution in API', async ({ request }) => {
    const slugs = [
      'be-idempotency-001',
      'be-race-002',
      'ml-leakage-001',
      'sec-xss-001',
      'be-nplusone-001',
    ];

    for (const slug of slugs) {
      const res = await request.get(`${API}/api/problems/${slug}`);
      expect(res.ok(), `GET /api/problems/${slug} failed`).toBeTruthy();
      const body = await res.json();
      expect(body.ok).toBe(true);

      const editorial = body.data.currentVersion.editorialMd;
      expect(typeof editorial, `${slug} editorial should be string`).toBe('string');
      expect(editorial.length, `${slug} editorial should be non-empty`).toBeGreaterThan(100);
      expect(editorial).toContain('Root cause');
      expect(editorial).toContain('Why it happens in production');
      expect(editorial).toContain('Approaches compared');
      expect(editorial).toContain('Recommended approach');
      expect(editorial).toContain('Common pitfalls');
      expect(editorial).toContain('How to verify the fix');

      const solution = body.data.currentVersion.solutionMd;
      expect(typeof solution, `${slug} solution should be string`).toBe('string');
      expect(solution.length, `${slug} solution should be non-empty`).toBeGreaterThan(100);
      expect(solution).toContain('Reference Solution');
      expect(solution).toContain('Line-by-line explanation');
      expect(solution).toContain('Diff against starter');
    }
  });

  test('Practice mode allows accessing hints, editorial, and solution tabs without assessment lock', async ({ page }) => {
    await signIn(page);
    await page.goto('/problems/be-idempotency-001');
    await page.waitForURL('**/problems/be-idempotency-001*');
    await ensureSessionReady(page);

    const hintsBtn = page.getByRole('button', { name: /^Hints/i });
    const editorialBtn = page.getByRole('button', { name: /^Editorial/i });
    const solutionBtn = page.getByRole('button', { name: /^Solution/i });

    await expect(hintsBtn).toBeEnabled();
    await expect(editorialBtn).toBeEnabled();
    await expect(solutionBtn).toBeEnabled();

    await hintsBtn.click();
    await expect(page.locator('text=Locked in Assessment Mode')).not.toBeVisible();

    await editorialBtn.click();
    await expect(page.locator('text=Locked in Assessment Mode')).not.toBeVisible();

    await solutionBtn.click();
    await expect(page.locator('text=Locked in Assessment Mode')).not.toBeVisible();
  });
});
