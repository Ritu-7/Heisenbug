'use strict';

/**
 * Visible test suite — be-idempotency-001
 * Baked into the session-runner image.
 * Uses the shared stripe.__create mock so call-count assertions are reliable.
 *
 * Test IDs encode weight: [V1:10] = id=V1, weight=10 points. Total: 60 pts.
 */

jest.mock('stripe');

const request = require('supertest');
const { db }  = require('../../src/db/client');

let app;
beforeAll(() => {
  app = require('../../src/app');
});

beforeEach(() => {
  db._reset();
  // Reset the shared stripe mock between tests
  const stripe = require('stripe');
  stripe.__create.mockClear();
  stripe.__create.mockResolvedValue({
    id:            `pi_mock_${Math.random().toString(36).slice(2, 10)}`,
    client_secret: `pi_mock_secret_${Math.random().toString(36).slice(2, 10)}`,
    amount: 1000,
    currency: 'usd',
  });
});

describe('PAY-482 — Checkout Idempotency (visible)', () => {

  // ── V1: Missing header ────────────────────────────────────────────────────
  test('[V1:10] Returns 400 if Idempotency-Key header is missing', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({ cartId: 'cart-001', amount: 5000, currency: 'usd' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  // ── V2: First call returns 201 ────────────────────────────────────────────
  test('[V2:20] Returns 201 with clientSecret on first call', async () => {
    const res = await request(app)
      .post('/checkout')
      .set('Idempotency-Key', 'v2-unique-key-abc')
      .send({ cartId: 'cart-001', amount: 5000, currency: 'usd' });

    expect(res.status).toBe(201);
    expect(typeof res.body.clientSecret).toBe('string');
    expect(res.body.clientSecret.length).toBeGreaterThan(0);
  });

  // ── V3: Replay returns 200, stripe called only once ───────────────────────
  test('[V3:30] Returns 200 (not 201) on replay; stripe called only once', async () => {
    const key  = 'v3-replay-key-xyz';
    const body = { cartId: 'cart-002', amount: 8000, currency: 'usd' };

    const first = await request(app)
      .post('/checkout').set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/checkout').set('Idempotency-Key', key).send(body);
    expect(second.status).toBe(200);
    expect(second.body.clientSecret).toBe(first.body.clientSecret);

    // Stripe must have been called exactly once — not on replay
    const stripe = require('stripe');
    expect(stripe.__create).toHaveBeenCalledTimes(1);
  });

});
