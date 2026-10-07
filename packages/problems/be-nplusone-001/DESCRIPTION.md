# Optimize N+1 Query in Order History API

Our order history API (`GET /orders`) is experiencing severe performance degradation as the number of orders per user grows. A performance audit revealed that the endpoint suffers from a classic **N+1 query problem**.

For every order retrieved, the application issues a separate database query to fetch its items. If a user has 50 orders, the server makes 51 database queries in total!

## Requirements

1. **Optimize Item Fetching**:
   - Instead of querying items individually for each order in a loop, batch the item fetching into a single query using the provided `db.getOrderItemsBatch(orderIds)` method.
   - The total number of database queries for a single request must be strictly $O(1)$ (exactly 2 queries: one for the orders, and one for the items batch).
   
2. **Handle Edge Cases**:
   - If a user has no orders, the endpoint should return an empty list and make exactly 1 query (only to fetch the orders). No item queries should be made.
   
3. **Maintain Correctness**:
   - The response structure, order details, pagination (`limit` and `offset`), and total order price calculations must remain completely correct.

## Database Client API

The mock database client (`db`) is available in the entry file and provides the following asynchronous methods:
- `db.getOrdersByUserId(userId, limit, offset)`: Fetches a page of orders for a user. (Counts as 1 query)
- `db.getOrderItems(orderId)`: Fetches items for a single order. (Counts as 1 query)
- `db.getOrderItemsBatch(orderIds)`: Fetches items for multiple order IDs in a single query. Returns an object mapping `orderId` to an array of items. (Counts as 1 query)
