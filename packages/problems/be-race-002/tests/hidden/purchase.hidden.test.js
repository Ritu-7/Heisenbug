'use strict';

/**
 * Hidden test suite — be-race-002
 * Mounted at runtime into the grader-runner container.
 * NEVER baked into the session-runner image.
 *
 * Test IDs encode weight: [H1:25] = id=H1, weight=25 points. Total: 40 pts.
 *   H1:25  N concurrent requests against stock of N-1 → exactly 1 rejection, stock never negative
 *   H2:15  stress: 20 concurrent against stock of 10 → stock never goes below 0
 */

const request = require('supertest');
const { db }  = require('../../src/db/client');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

beforeEach(() => {
  db._reset();
});

describe('FLASH-099 — Inventory Purchase (hidden concurrency)', () => {

  // ── H1: N concurrent requests against stock of N-1 ───────────────────────
  // With stock = 4 and 5 simultaneous requests:
  //   - Exactly 4 must succeed (200)
  //   - Exactly 1 must fail (409)
  //   - Final stock must be exactly 0, never negative
  test('[H1:25] N concurrent requests with stock N-1: exactly one rejected, stock never negative', async () => {
    const N = 5;
    const STOCK = N - 1; // 4
    db._seedStock('product-flash', STOCK);

    // Fire N requests simultaneously
    const requests = Array.from({ length: N }, () =>
      request(app).post('/purchase').send({ productId: 'product-flash' })
    );
    const responses = await Promise.all(requests);

    const successes = responses.filter(r => r.status === 200);
    const rejections = responses.filter(r => r.status === 409);

    // Exactly STOCK successes, exactly 1 rejection
    expect(successes.length).toBe(STOCK);
    expect(rejections.length).toBe(1);

    // Verify remaining values reported in successful responses are all >= 0
    for (const r of successes) {
      expect(r.body.remaining).toBeGreaterThanOrEqual(0);
    }

    // The last reported remaining should be 0 (no oversell)
    const remainingValues = successes.map(r => r.body.remaining).sort((a, b) => a - b);
    expect(remainingValues[0]).toBe(0); // minimum remaining must be 0, not negative
  });

  // ── H2: Stress — 20 concurrent against stock of 10 ───────────────────────
  // Stock can never go negative regardless of concurrency level.
  test('[H2:15] Stress: 20 concurrent requests against stock of 10, stock never goes negative', async () => {
    const CONCURRENT = 20;
    const STOCK = 10;
    db._seedStock('product-stress', STOCK);

    const requests = Array.from({ length: CONCURRENT }, () =>
      request(app).post('/purchase').send({ productId: 'product-stress' })
    );
    const responses = await Promise.all(requests);

    const successes = responses.filter(r => r.status === 200);
    const rejections = responses.filter(r => r.status === 409);

    // Total responses must equal CONCURRENT
    expect(successes.length + rejections.length).toBe(CONCURRENT);

    // Must not oversell: no more than STOCK successes
    expect(successes.length).toBeLessThanOrEqual(STOCK);

    // All successful remaining values must be non-negative
    for (const r of successes) {
      expect(r.body.remaining).toBeGreaterThanOrEqual(0);
    }

    // The minimum reported remaining value must be 0 (not -1, -2, etc.)
    if (successes.length > 0) {
      const minRemaining = Math.min(...successes.map(r => r.body.remaining));
      expect(minRemaining).toBeGreaterThanOrEqual(0);
    }
  });

});
