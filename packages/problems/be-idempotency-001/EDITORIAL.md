## Editorial — PAY-482: Checkout double-charges on client retry

### Root cause

The `handleCheckout` handler executes `stripe.paymentIntents.create()` unconditionally whenever a `POST /checkout` request is received. It has no mechanism to identify whether an incoming HTTP request is an initial checkout or a retry of an earlier request. When mobile or network clients encounter dropped connections, packet timeouts, or HTTP 5xx errors and retry their request, the server treats each attempt as a brand-new checkout, creating a separate Stripe `PaymentIntent` and charging the customer's card multiple times.

### Why it happens in production

In local development, HTTP requests operate over near-zero latency loopback connections (`localhost`) that rarely drop packets or time out. In production:
1. **Unreliable mobile networks:** A client sends a request, the server charges the card and writes to the DB, but the connection drops before the HTTP response reaches the mobile device.
2. **Aggressive client retries:** Modern mobile networking libraries (like OkHttp, Alamofire, or Axios retry interceptors) automatically re-issue non-responsive POST requests.
3. **Payment gateways are non-idempotent by default:** Stripe APIs require explicit idempotency keys to deduplicate charges; without one, every API call is a distinct financial transaction.

### Approaches compared

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **DB-backed idempotency key** (recommended) | Correct under concurrency via `UNIQUE` constraints; durable across server restarts; auditable record of requests and responses. | Requires database schema migration and disk writes. | Financial transactions, order checkouts, external API mutations. |
| **In-Memory Cache (e.g. Map / LRU)** | Extremely fast; zero additional infrastructure. | Lost on process restart or deploy; fails in multi-instance / autoscaled deployments. | Never for financial payments or mutations. |
| **Redis Key-Value with Atomic SETNX / TTL** | High throughput; built-in TTL expiration; works across horizontally scaled nodes. | Potential data loss if Redis restarts without persistence; extra infrastructure dependency. | High-volume non-financial idempotent endpoints (e.g., webhook processing). |

### Recommended approach

Implement a database-backed idempotency table (`idempotency_keys`) with a `UNIQUE` constraint on the `key` column.

1. **Header validation:** Require an `Idempotency-Key` header (e.g. client-generated UUIDv4) on `POST /checkout`; return `400 Bad Request` if omitted.
2. **Replay check:** Look up the key in the database. If already marked `COMPLETE`, return the stored response immediately with status `200 OK` (replaying the cached payload without re-charging).
3. **Atomic lock:** Insert a row with `status = 'IN_PROGRESS'` using atomic semantics (`INSERT ... ON CONFLICT DO NOTHING` or catching `UNIQUE` constraint violations). If insertion fails because the key already exists and is `IN_PROGRESS`, return `409 Conflict` (`Request already in progress — retry after 1s`).
4. **Payload validation:** Optionally store a SHA-256 hash of the request body and verify that retries with the same key don't supply mismatched payloads; return `422 Unprocessable Entity` if the key is reused with a different cart or amount.
5. **Gateway integration:** Pass the idempotency key down to Stripe via `{ idempotencyKey }` request options so Stripe also deduplicates at their layer.
6. **Atomic completion:** In a database transaction (`db.$transaction`), update the idempotency record to `COMPLETE` with the serialized response and insert the new order record. If Stripe throws, leave the status `IN_PROGRESS` or record the error so retries can proceed cleanly.
7. **TTL:** Configure a TTL (e.g., 24 hours) after which idempotency records expire.

### Complexity / performance notes

- **Time Complexity:** $O(1)$ lookup and insert utilizing the unique index on `key`.
- **Concurrency Safety:** Using the database `UNIQUE` constraint guarantees that even if 5 identical requests arrive within the same millisecond across 5 different Node processes, exactly 1 will obtain the lock while 4 receive `409 Conflict`.
- **Storage Overhead:** Small footprint (a few hundred bytes per checkout key) that can be pruned daily via TTL or a scheduled background worker.

### Common pitfalls

- **Check-then-insert race:** Writing `SELECT ... WHERE key = ?` followed by `INSERT` in application code without a database constraint creates its own race condition under concurrent requests. Always enforce atomicity at the DB level (`UNIQUE` constraint or conditional insert).
- **Returning 201 on replay:** Replays of idempotent requests should return `200 OK` (or the exact original cached response status code), not `201 Created`, to signal to the client that no new entity was produced.
- **Marking complete before payment succeeds:** If you mark the key `COMPLETE` before calling Stripe, an unexpected crash or gateway rejection will cause subsequent retries to falsely report success without a charge.
- **Ignoring payload mismatch:** If a client accidentally reuses an idempotency key for two different purchases, the server must reject the second with `422 Unprocessable Entity` rather than silently returning the first purchase's receipt.

### How to verify the fix

1. **Sequential retry:** Send `POST /checkout` with `Idempotency-Key: uuid-1`. Expect `201 Created`. Re-send the exact request with `Idempotency-Key: uuid-1`. Expect `200 OK` with identical response body, and assert Stripe `paymentIntents.create` was invoked only once.
2. **Concurrent race:** Fire 10 simultaneous `POST /checkout` requests sharing `Idempotency-Key: uuid-2`. Exactly 1 must return `201 Created` and 9 must return `409 Conflict`. Verify that only 1 `PaymentIntent` and 1 `order` exist in the database.
3. **Header validation:** Send `POST /checkout` without `Idempotency-Key`. Expect `400 Bad Request`.
