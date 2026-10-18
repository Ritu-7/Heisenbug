## Editorial — FLASH-099: Inventory oversells during a flash sale

### Root cause

The inventory purchase handler executes a classic **Time-of-Check to Time-of-Use (TOCTOU)** race condition:
1. It queries the database to read current stock: `SELECT quantity FROM stock WHERE productId = $1`
2. It checks whether `quantity > 0` in application memory.
3. It issues an update: `UPDATE stock SET quantity = quantity - 1 WHERE productId = $1`

Between step 1 and step 3, the Node.js event loop yields control during asynchronous database operations. Under concurrent load (such as a flash sale), dozens of requests read the exact same stock level (e.g., `quantity = 1`), pass the `> 0` check simultaneously, and execute their updates, driving inventory negative (e.g., `quantity = -4`).

### Why it happens in production

During local testing and automated unit tests, test suites execute sequential requests one after another. In production flash sales, marketing campaigns or drop notifications bring thousands of requests per second within the same millisecond. 

Crucially, **wrapping code in standard database transactions at `READ COMMITTED` isolation level does NOT prevent this bug**. In `READ COMMITTED`, each `SELECT` reads committed data; concurrent transactions all see committed stock of 10, proceed to decrement, and overwrite each other's changes without conflict unless explicit locking or atomic statements are used.

### Approaches compared

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **Atomic Conditional UPDATE (Recommended)** | Zero lock contention; works at default transaction isolation; single DB round-trip; maximum throughput. | Requires checking rows affected (0 rows = out of stock). | Most inventory & balance decrement operations. |
| **Pessimistic Locking (`SELECT FOR UPDATE`)** | Holds an exclusive lock across multiple steps or related tables; simple to reason about. | Queues transactions, increasing latency and deadlocks under high concurrency. | Multi-step purchase flows (e.g. reserving items across several warehouses). |
| **Optimistic Locking (`version` column)** | No DB row locks; scales well under low contention. | Heavy rollback and retry overhead under hot contention. | Low-to-medium contention systems; shopping carts before checkout. |
| **Distributed Cache Decrement (`Redis DECR`)** | Sub-millisecond latency; handles 100,000+ ops/sec easily on a single Redis node. | Distributed state consistency; requires reservation timeouts and reconciliation with primary DB. | Extreme traffic flash sales (e.g. sneakers, concert tickets). |

### Recommended approach

There are two primary industry standard approaches depending on your architecture:

1. **Atomic Conditional UPDATE:**
   ```sql
   UPDATE stock 
   SET quantity = quantity - $qty 
   WHERE product_id = $id AND quantity >= $qty;
   ```
   Inspect the number of rows affected. If `rowCount === 1`, the purchase succeeded. If `rowCount === 0`, it was sold out.

2. **Transaction with Row-Level Locking (`SELECT ... FOR UPDATE`):**
   ```sql
   BEGIN;
   SELECT quantity FROM stock WHERE product_id = $id FOR UPDATE;
   -- if quantity >= $qty:
   UPDATE stock SET quantity = quantity - $qty WHERE product_id = $id;
   COMMIT;
   ```
   In the problem's in-memory simulated database stub, executing inside `db.$transaction(async (tx) => { ... })` locks the record throughout the callback, ensuring synchronous atomic execution.

For ultra-high-volume flash sales (e.g. 50,000 requests/sec on a single SKU), companies place an in-memory counter in Redis (`DECR` or Lua script) with a reservation timeout (e.g., reserve for 10 minutes; restore if checkout isn't completed), and asynchronously sync to PostgreSQL.

### Complexity / performance notes

- **Time Complexity:** $O(1)$ indexed lookup and decrement.
- **Lock Contention:** `SELECT FOR UPDATE` serializes concurrent transactions on the same product ID. Atomic conditional `UPDATE` minimizes lock duration to the exact row-update operation.
- **Deadlock Potential:** When locking multiple items per order, always sort product IDs in a canonical order (e.g. ascending by ID) before acquiring locks to prevent circular deadlocks.

### Common pitfalls

- **Relying on `READ COMMITTED` transactions:** Simply wrapping `findUnique` and `update` inside `db.$transaction` without row locking (`FOR UPDATE`) does not protect against concurrent overwrites in real SQL databases.
- **Application-side balance calculations:** Calculating `newQuantity = oldQuantity - 1` in JavaScript and issuing `UPDATE stock SET quantity = ${newQuantity}` allows stale writes. Always use SQL relative updates (`quantity = quantity - 1`).
- **Missing index on `productId`:** If `productId` is not indexed, `FOR UPDATE` escalates to a full table lock, halting transactions for all unrelated products.
- **Not handling reservation timeouts:** In systems with two-phase reservations (cart hold -> payment -> finalize), failing to release expired reservations locks inventory permanently.

### How to verify the fix

1. **Concurrent stress test:** Seed a product with stock = 10. Fire 25 concurrent `POST /purchase` requests. Exactly 10 must succeed with `200 OK`, and exactly 15 must be rejected with `409 Conflict`.
2. **Invariant verification:** Assert that the final stock in the database is exactly `0`, and never `< 0`.
3. **Out-of-stock boundary:** Attempt to purchase when stock = 0. Verify immediate `409 Conflict` with `{"error": "Out of stock"}`.
