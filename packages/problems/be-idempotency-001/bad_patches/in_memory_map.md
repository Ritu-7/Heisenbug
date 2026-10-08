# Near-Miss: In-Memory Map Cache (`in_memory_map.js`)

### The Flaw
This implementation attempts to prevent duplicate checkouts by storing seen `Idempotency-Key` headers in a local Node.js `Map`.

While this appears to work during sequential testing, the check-then-set sequence is non-atomic:
```javascript
if (idempotencyCache.has(idempotencyKey)) {
  return res.status(200).json(idempotencyCache.get(idempotencyKey));
}
const paymentIntent = await stripe.paymentIntents.create(...);
idempotencyCache.set(idempotencyKey, responseData);
```
Between checking `Map.has()` and setting `Map.set()`, the `await stripe.paymentIntents.create()` call yields control back to the Node.js event loop. If two or more concurrent requests arrive with the same idempotency key, they will all observe `Map.has() === false` before any request sets the cache, resulting in multiple charges on Stripe.

### Why It Fools Visible Tests
- **V1 (10 pts)**: Correctly validates and rejects missing `Idempotency-Key` headers.
- **V2 (20 pts)**: Successfully creates a `PaymentIntent` and responds with `201 Created` on the initial request.
- **V3 (30 pts)**: Correctly returns `200 OK` on subsequent sequential requests because the map entry is already populated.
- **Visible Score**: 60/60.

### Which Hidden Check Catches It
- **Fails H1 (15 pts)**: `[H1:15] Concurrent requests with same key: exactly one 201, rest return 409`. Under concurrent burst requests, all requests slip past the cache check and call Stripe multiple times instead of locking atomically.
- **Passes H2 (15 pts) & H3 (10 pts)**: Incidental rollback and sequential replay pass.
- **Final Grader Score**: 85/100 (Passes visible tests [V1, V2, V3] and [H2, H3], fails H1).
