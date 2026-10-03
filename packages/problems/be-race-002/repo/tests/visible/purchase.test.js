'use strict';

/**
 * Visible test suite — be-race-002
 * Baked into the session-runner image.
 *
 * Test IDs encode weight: [V1:10] = id=V1, weight=10 points. Total: 60 pts.
 *   V1:10  single purchase decrements stock
 *   V2:20  purchase when out-of-stock returns 409
 *   V3:30  purchasing exactly the remaining stock succeeds
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

describe('FLASH-099 — Inventory Purchase (visible)', () => {

  // ── V1: Single purchase decrements stock ───────────────────────────────────
  test('[V1:10] Single purchase decrements stock by 1', async () => {
    db._seedStock('product-A', 5);

    const res = await request(app)
      .post('/purchase')
      .send({ productId: 'product-A' });

    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(4);
  });

  // ── V2: Out-of-stock returns 409 ───────────────────────────────────────────
  test('[V2:20] Returns 409 when stock is 0', async () => {
    db._seedStock('product-B', 0);

    const res = await request(app)
      .post('/purchase')
      .send({ productId: 'product-B' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  // ── V3: Exactly the remaining stock succeeds ───────────────────────────────
  test('[V3:30] Purchasing exactly the remaining stock succeeds', async () => {
    db._seedStock('product-C', 1);

    const res = await request(app)
      .post('/purchase')
      .send({ productId: 'product-C' });

    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(0);
  });

});
