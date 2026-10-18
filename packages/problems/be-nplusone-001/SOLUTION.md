## Reference Solution — PERF-101: Optimize N+1 Query in Order History API

### Full corrected code

```javascript
app.get('/orders', async (req, res) => {
  const { userId, limit = 10, offset = 0 } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);

    // Query 1: Fetch paginated orders
    const orders = await db.getOrdersByUserId(userId, parsedLimit, parsedOffset);

    // Short-circuit if user has no orders for this page
    if (orders.length === 0) {
      return res.json({ orders: [], count: 0 });
    }

    // Query 2: Fetch all items for all orders in a single batch query
    const orderIds = orders.map((o) => o.id);
    const itemsMap = await db.getOrderItemsBatch(orderIds);

    // Group items into their respective orders in memory (O(N))
    const ordersWithItems = orders.map((order) => {
      const items = itemsMap[order.id] || [];
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return {
        ...order,
        items,
        total,
      };
    });

    res.json({
      orders: ordersWithItems,
      count: ordersWithItems.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### Line-by-line explanation

- **Lines 1-5:** Validate presence of `userId` in query params, returning `400 Bad Request` if absent.
- **Lines 8-12:** Parse pagination parameters `limit` and `offset`, and issue **Query 1** to fetch the current slice of orders.
- **Lines 15-17:** Guard against empty order lists. If zero orders exist, immediately respond with `{ orders: [], count: 0 }`, avoiding an unnecessary database query.
- **Lines 20-21:** Map over the retrieved orders to collect their IDs into `orderIds`, and issue **Query 2** via `db.getOrderItemsBatch(orderIds)` to fetch all associated items in a single round-trip.
- **Lines 24-32:** Assemble the response in application memory: attach items from `itemsMap[order.id]` and compute each order's total sum using `reduce()`.
- **Lines 34-37:** Respond with the consolidated `ordersWithItems` array and total count.

### Diff against starter code

```diff
@@ -83,16 +83,18 @@
     const parsedOffset = parseInt(offset, 10);
     const orders = await db.getOrdersByUserId(userId, parsedLimit, parsedOffset);
 
-    const ordersWithItems = [];
-    for (const order of orders) {
-      const items = await db.getOrderItems(order.id);
+    if (orders.length === 0) {
+      return res.json({ orders: [], count: 0 });
+    }
+
+    const orderIds = orders.map((o) => o.id);
+    const itemsMap = await db.getOrderItemsBatch(orderIds);
+
+    const ordersWithItems = orders.map((order) => {
+      const items = itemsMap[order.id] || [];
       const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
-      ordersWithItems.push({
-        ...order,
-        items,
-        total
-      });
-    }
+      return { ...order, items, total };
+    });
 
     res.json({
       orders: ordersWithItems,
```
