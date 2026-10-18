## Reference Solution — FLASH-099: Inventory oversells during a flash sale

### Full corrected code

```javascript
'use strict';

const { db } = require('./db/client');

async function handlePurchase(req, res) {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      // Inside transaction, the read is held exclusively without yielding,
      // preventing concurrent requests from interleaving.
      const row = await tx.stock.findUnique({ where: { productId } });

      if (!row) {
        const err = new Error('Product not found');
        err.status = 404;
        throw err;
      }

      if (row.quantity <= 0) {
        const err = new Error('Out of stock');
        err.status = 409;
        throw err;
      }

      return tx.stock.update({
        where: { productId },
        data:  { quantity: row.quantity - 1 },
      });
    });

    return res.status(200).json({ productId, remaining: updated.quantity });
  } catch (err) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message });
  }
}

module.exports = { handlePurchase };
```

### Line-by-line explanation

- **Lines 8-10:** Check that `productId` is provided in the request body; return `400 Bad Request` if missing.
- **Lines 13:** Wrap the read-check-decrement sequence in `db.$transaction()`.
- **Lines 16:** Query `tx.stock.findUnique` inside the transaction. The simulated client stub executes without event loop yields inside transactions (mirroring a SQL `SELECT ... FOR UPDATE`).
- **Lines 18-28:** Perform stock checks: throw an error with `err.status = 404` if the product does not exist, and `err.status = 409` if `quantity <= 0`.
- **Lines 30-33:** Safely decrement the stock quantity by 1 via `tx.stock.update` and return the updated row.
- **Lines 36-39:** Return `200 OK` with the remaining inventory count, or catch thrown status errors and respond with appropriate HTTP status codes (404/409).

### Diff against starter code

```diff
@@ -32,27 +32,37 @@
   if (!productId) {
     return res.status(400).json({ error: 'productId is required' });
   }
 
-  // ── BUG: non-atomic check-then-decrement ─────────────────────────────────
-  // Step 1: read stock
-  const row = await db.stock.findUnique({ where: { productId } });
-
-  if (!row) {
-    return res.status(404).json({ error: 'Product not found' });
-  }
-
-  // Step 2: check
-  if (row.quantity <= 0) {
-    return res.status(409).json({ error: 'Out of stock' });
-  }
-
-  // ── RACE WINDOW: between the check above and the decrement below,
-  //    another concurrent request can also pass the check and decrement.
-  //    Under flash-sale load this causes stock to go negative. ──────────────
-
-  // Step 3: decrement
-  const updated = await db.stock.update({
-    where: { productId },
-    data:  { quantity: row.quantity - 1 },
-  });
-
-  return res.status(200).json({ productId, remaining: updated.quantity });
+  try {
+    const updated = await db.$transaction(async (tx) => {
+      const row = await tx.stock.findUnique({ where: { productId } });
+
+      if (!row) {
+        const err = new Error('Product not found');
+        err.status = 404;
+        throw err;
+      }
+
+      if (row.quantity <= 0) {
+        const err = new Error('Out of stock');
+        err.status = 409;
+        throw err;
+      }
+
+      return tx.stock.update({
+        where: { productId },
+        data:  { quantity: row.quantity - 1 },
+      });
+    });
+
+    return res.status(200).json({ productId, remaining: updated.quantity });
+  } catch (err) {
+    const status = err.status ?? 500;
+    return res.status(status).json({ error: err.message });
+  }
```
