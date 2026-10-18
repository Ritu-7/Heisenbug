## Editorial — PERF-101: Optimize N+1 Query in Order History API

### Root cause

The `GET /orders` route exhibits an **N+1 query problem**. 

When a user requests their order history:
1. The server issues **1 query** to retrieve the user's orders:
   ```sql
   SELECT * FROM orders WHERE user_id = $1 LIMIT 10 OFFSET 0;
   ```
2. For each of the $N$ returned orders, the handler loops and executes a separate query to fetch associated items:
   ```javascript
   for (const order of orders) {
     const items = await db.getOrderItems(order.id); // 1 query per order!
   }
   ```

For a customer with 50 orders, the endpoint issues $1 + 50 = 51$ independent database round-trips.

### Why it happens in production

In local test environments with 1-3 seed orders and zero network latency (sub-millisecond localhost calls), an N+1 query is virtually imperceptible (3 queries taking ~0.5ms total).

In production:
- Network round-trip latency between application containers and the database cluster adds 1-5ms per query.
- For 50 orders, 50 queries add 50-250ms of pure network round-trip overhead.
- Under peak web traffic, concurrent users executing N+1 queries saturate the database connection pool, driving CPU spikes, queuing delays, and eventual request timeouts.

### Approaches compared

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **Batch Query with In-Memory Grouping (Recommended)** | Exactly 2 queries regardless of $N$; straightforward SQL (`WHERE order_id = ANY($1)`); clean memory structure. | Requires batch query support or `IN / ANY` clause. | Standard REST APIs with 1-to-many relationships. |
| **SQL JOIN with JSON Aggregation** | Single query returns assembled nested JSON directly from PostgreSQL (`json_agg`). | Requires raw SQL or specialized ORM mapping; harder to maintain. | Read-heavy performance-critical endpoints. |
| **DataLoader (Batch & Deduplicate)** | Decouples querying from application logic; automatically batches within tick; caches per-request. | Overkill for simple endpoints; requires DataLoader abstraction. | GraphQL resolvers and microservice gateways. |
| **Promise.all on N Individual Queries** | Runs queries concurrently in Node. | Still fires $N$ queries; overwhelms the DB connection pool. | **Anti-pattern — never use as a fix for N+1.** |

### Recommended approach

Batch the item queries into a single round-trip using the collected array of order IDs:

1. **Paginate orders first:** Fetch the target page of orders using `limit` and `offset`.
2. **Collect IDs:** Extract `orderIds = orders.map(o => o.id)`. If `orders` is empty, short-circuit and return immediately without querying items.
3. **Single batch query:** Query all items for the given IDs in a single query:
   ```sql
   SELECT * FROM order_items WHERE order_id = ANY($1);
   ```
   (Or in this problem's stub: `await db.getOrderItemsBatch(orderIds)`).
4. **Group in memory:** Map each order to its corresponding items using a lookup dictionary/map in $O(M)$ time, where $M$ is total items.

```javascript
// Step 1: Paginate orders (1 query)
const orders = await db.getOrdersByUserId(userId, parsedLimit, parsedOffset);
if (orders.length === 0) return res.json({ orders: [], count: 0 });

// Step 2: Batch items (1 query)
const orderIds = orders.map(o => o.id);
const itemsMap = await db.getOrderItemsBatch(orderIds);

// Step 3: Map in memory
const ordersWithItems = orders.map(order => {
  const items = itemsMap[order.id] || [];
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { ...order, items, total };
});
```

### Complexity / performance notes

- **Query Count:**
  - Before: $N + 1$ queries. For $N=50$, 51 queries.
  - After: Always **2 queries** (1 for orders, 1 for items), irrespective of $N$.
- **Index Requirements:** Ensure an index exists on `order_items.order_id`. Without an index, the batch `WHERE order_id IN (...)` triggers a full table scan.
- **Cartesian Product Warning:** Avoid resolving multiple 1-to-many relationships (e.g., `orders -> items` and `orders -> payments`) with multiple `LEFT JOIN`s in a single query. Multiple joins produce a cartesian multiplication of rows. Two targeted batch queries are faster and transfer far less bandwidth.

### Common pitfalls

- **Wrapping `Promise.all` around per-item queries:** Executing `await Promise.all(orders.map(o => db.getOrderItems(o.id)))` executes concurrently, but still sends $N$ separate network requests, quickly exhausting the connection pool.
- **Querying items before pagination:** Fetching all items across all lifetime orders and paginating afterwards wastes database I/O and memory. Always paginate the parent entity first.
- **Missing empty array check:** Attempting to run `WHERE order_id IN ()` with an empty array produces SQL syntax errors in some engines; always short-circuit if `orders.length === 0`.

### How to verify the fix

1. **Verify query counts:** Count database round-trips via `db.getQueryCount()`:
   - For a user with 5 orders: before = 6 queries, after = 2 queries.
   - For a user with 50 orders: before = 51 queries, after = 2 queries.
   - For a user with 0 orders: before = 1 query, after = 1 query.
2. **Data integrity:** Confirm that item totals, quantities, and order details match the unoptimized version identically.
