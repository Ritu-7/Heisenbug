const request = require('supertest');
const { app, db } = require('../../src/orders');

describe('Hidden Tests - Order History API Performance', () => {
  beforeEach(() => {
    db.resetQueryCount();
  });

  test('[H1:20] should scale with O(1) query count for large number of orders on first request', async () => {
    // Querying User 2 who has 50 orders.
    // This must be strictly O(1) query count (exactly 2 queries: 1 for orders, 1 for batch items).
    // Naive cache will fail here because it's the first request for User 2.
    const res = await request(app).get('/orders?userId=u2&limit=50');
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(50);
    expect(res.body.count).toBe(50);

    // Verify total calculation for one of the orders
    const sampleOrder = res.body.orders[0];
    expect(sampleOrder.total).toBe(11); // 10 + 1

    // Query count must be exactly 2
    expect(db.getQueryCount()).toBe(2);
  });

  test('[H2:20] should handle empty orders with exactly 1 query', async () => {
    // User 3 has 0 orders.
    const res = await request(app).get('/orders?userId=u3');
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(res.body.count).toBe(0);

    // Query count must be exactly 1 (only the orders query, no items query)
    expect(db.getQueryCount()).toBe(1);
  });
});
