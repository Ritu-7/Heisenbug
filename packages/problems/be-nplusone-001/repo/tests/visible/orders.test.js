const request = require('supertest');
const { app, db } = require('../../src/orders');

describe('Visible Tests - Order History API', () => {
  beforeEach(() => {
    db.resetQueryCount();
  });

  test('[V1:30] should correctly list orders, handle pagination, and calculate totals', async () => {
    const res = await request(app).get('/orders?userId=u1&limit=2&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.orders).toHaveLength(2);

    // Verify first order
    const firstOrder = res.body.orders[0];
    expect(firstOrder.id).toBe('o1');
    expect(firstOrder.items).toHaveLength(2);
    expect(firstOrder.total).toBe(1100); // 1000*1 + 50*2

    // Verify second order
    const secondOrder = res.body.orders[1];
    expect(secondOrder.id).toBe('o2');
    expect(secondOrder.items).toHaveLength(1);
    expect(secondOrder.total).toBe(100); // 100*1
  });

  test('[V2:30] should optimize query count for repeated requests', async () => {
    // First request
    await request(app).get('/orders?userId=u1');
    
    // Reset query count to measure only the second request
    db.resetQueryCount();
    
    const res = await request(app).get('/orders?userId=u1');
    expect(res.status).toBe(200);
    
    // The second request should be optimized (either cached or batched)
    // Starter code does 6 queries (1 + 5 items).
    // Optimized/cached code does <= 2 queries.
    expect(db.getQueryCount()).toBeLessThanOrEqual(2);
  });
});
