'use strict';

/**
 * Hidden test suite — be-idempotency-001
 *
 * NOT in the session-runner image. Mounted into the grader container at runtime:
 *   HOST: packages/problems/be-idempotency-001/tests/hidden/
 *   → CONTAINER: /app/tests/hidden/
 *
 * Paths resolve against the container layout (/app/src/...).
 * Test IDs encode weight: [H1:15] = id=H1, 15 points. Total hidden: 40 pts.
 * Grand total: 60 (visible) + 40 (hidden) = 100 pts.
 */

jest.mock('stripe');

const request = require('supertest');
const { db }  = require('../../src/db/client');

let app;
beforeAll(() => {
  jest.resetModules();
  app = require('../../src/app');
});

beforeEach(() => {
  db._reset();
  const stripe = require('stripe');
  stripe.__create.mockClear();
  stripe.__create.mockResolvedValue({
    id:            `pi_mock_${Math.random().toString(36).slice(2, 10)}`,
    client_secret: `pi_mock_secret_${Math.random().toString(36).slice(2, 10)}`,
    amount: 5000,
    currency: 'usd',
  });
});

describe('PAY-482 — Checkout Idempotency (hidden)', () => {

  // ── H1: Concurrent duplicate requests ────────────────────────────────────
  // The db stub has setImmediate yields to expose the real race window between
  // "check if key exists" and "write the key". A correct implementation uses an
  // atomic DB-level unique constraint; an in-memory Map check-then-set is racy.
  test('[H1:15] Concurrent requests with same key: exactly one 201, rest return 409', async () => {
    const key  = `h1-concurrent-${Date.now()}`;
    const body = { cartId: 'cart-h1', amount: 12000 };

    const results = await Promise.all([
      request(app).post('/checkout').set('Idempotency-Key', key).send(body),
      request(app).post('/checkout').set('Idempotency-Key', key).send(body),
      request(app).post('/checkout').set('Idempotency-Key', key).send(body),
    ]);

    const statuses = results.map(r => r.status);
    const created   = statuses.filter(s => s === 201);
    const conflicts = statuses.filter(s => s === 409);

    // Exactly one request wins; the other two must be rejected
    expect(created.length).toBe(1);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    // Stripe must only have been called once (no double-charges)
    const stripe = require('stripe');
    expect(stripe.__create).toHaveBeenCalledTimes(1);
  });

  // ── H2: Transaction integrity under stripe failure ────────────────────────
  // If stripe.paymentIntents.create() throws, the idempotency key must NOT be
  // persisted as COMPLETE. A correct implementation rolls back (or never commits
  // the COMPLETE status). The in-memory Map implementation never cleans up.
  test('[H2:15] If Stripe throws, the idempotency key is NOT marked COMPLETE', async () => {
    const stripe = require('stripe');
    // Make stripe throw on this specific call
    stripe.__create.mockRejectedValueOnce(new Error('Stripe network error: connection refused'));

    const key  = `h2-tx-${Date.now()}`;
    const body = { cartId: 'cart-h2', amount: 5000 };

    // Request should fail — accept any 4xx or 5xx (reference returns 502)
    const res = await request(app)
      .post('/checkout').set('Idempotency-Key', key).send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Critical: the stored key must NOT be COMPLETE and must NOT have a responseBody
    const stored = await db.idempotencyKey.findUnique({ where: { key } });
    if (stored !== null) {
      // Key exists (e.g. IN_PROGRESS) — acceptable IF it has no committed response
      expect(stored.status).not.toBe('COMPLETE');
      expect(stored.responseBody).toBeFalsy();
    }
    // stored === null is also acceptable (key was rolled back entirely)
  });

  // ── H3: Three sequential retries return identical response ────────────────
  test('[H3:10] Three sequential retries with same key all return identical 200 response', async () => {
    const key  = `h3-seq-${Date.now()}`;
    const body = { cartId: 'cart-h3', amount: 3000 };

    const first  = await request(app).post('/checkout').set('Idempotency-Key', key).send(body);
    const second = await request(app).post('/checkout').set('Idempotency-Key', key).send(body);
    const third  = await request(app).post('/checkout').set('Idempotency-Key', key).send(body);

    expect(first.status).toBe(201);   // original
    expect(second.status).toBe(200);  // replay 1
    expect(third.status).toBe(200);   // replay 2

    // All three must return the exact same clientSecret
    expect(second.body.clientSecret).toBe(first.body.clientSecret);
    expect(third.body.clientSecret).toBe(first.body.clientSecret);

    // Stripe must only have been called once across all three
    const stripe = require('stripe');
    expect(stripe.__create).toHaveBeenCalledTimes(1);
  });

});
