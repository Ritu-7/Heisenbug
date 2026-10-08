# Near-Miss: In-Memory Request Caching (`naive_solution.js`)

### The Flaw
This implementation tries to eliminate N+1 queries by caching individual order item lookups in an in-memory dictionary (`cache[order.id]`).

While a cache reduces database hits on repeated requests for the *same* orders, it completely fails to optimize the initial query load for any new user or uncached order list. For a user with 50 orders on their first page load, it still fires 1 query to fetch orders plus 50 individual queries to fetch items (51 total queries instead of 2).

### Why It Fools Visible Tests
- **V1 & V2**: Visible tests verify that basic order data is returned correctly with valid item calculations, and sequential repeat calls benefit from the in-memory cache.
- **Visible Score**: 60/60.

### Which Hidden Check Catches It
- **Fails H1 (20 pts)**: `[H1:20] should scale with O(1) query count for large number of orders on first request`. Hidden check tests User 2 who has 50 orders. A correct solution must batch item fetches (`db.getOrderItemsBatch`) using an `IN (...)` strategy to achieve exactly 2 queries total (O(1) query count). The naive cache performs 51 queries and is rejected.
- **Passes H2 (20 pts)**: Empty order queries only issue 1 query and pass.
- **Final Grader Score**: 80/100 (Passes visible tests and H2, fails H1).
