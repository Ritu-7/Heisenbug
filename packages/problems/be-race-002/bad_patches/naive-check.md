# Near-Miss: Double-Check Without Transaction Locking (`naive-check.js`)

### The Flaw
This implementation attempts to prevent negative inventory overselling by performing a secondary stock check immediately before decrementing:
```javascript
const fresh = await db.stock.findUnique({ where: { productId } });
if (!fresh || fresh.quantity <= 0) {
  return res.status(409).json({ error: 'Out of stock' });
}
const updated = await db.stock.update({
  where: { productId },
  data:  { quantity: fresh.quantity - 1 },
});
```
The developer assumed re-checking the stock right before the update eliminates the race condition. However, because both operations are non-transactional and asynchronous, each `await` yields to the event loop. The race window between the `fresh` read and the `db.stock.update` remains wide open under concurrent requests.

### Why It Fools Visible Tests
- **V1 (10 pts)**: Sequential purchases decrement stock by 1 as expected.
- **V2 (20 pts)**: Out-of-stock products correctly return 409 Conflict sequentially.
- **V3 (30 pts)**: Purchasing the exact remaining stock sequentially completes without error.
- **Visible Score**: 60/60.

### Which Hidden Check Catches It
- **Fails H1 (25 pts)**: `[H1:25] N concurrent requests with stock N-1: exactly one rejected, stock never negative`. When 5 simultaneous requests hit stock of 4, all 5 read `quantity > 0` and update, causing the stock to drop to negative values.
- **Fails H2 (15 pts)**: `[H2:15] Stress: 20 concurrent requests against stock of 10, stock never goes negative`.
- **Final Grader Score**: 60/100 (Passes all visible tests [V1, V2, V3], fails both hidden concurrency checks [H1, H2]).
