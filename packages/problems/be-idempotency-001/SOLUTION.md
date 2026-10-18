## Reference Solution — PAY-482: Checkout double-charges on client retry

### Full corrected code

```javascript
'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const { db } = require('./db/client');

async function handleCheckout(req, res) {
  const { cartId, amount, currency = 'usd', customerId } = req.body;

  // R1: Validate Idempotency-Key header
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  // R2: Replay check — return stored response on retry
  const existing = await db.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  if (existing && existing.responseBody) {
    return res
      .status(200) // 200 on replay, not 201
      .json(JSON.parse(existing.responseBody));
  }

  // R3: Atomic lock via DB unique constraint
  try {
    await db.idempotencyKey.create({
      data: { key: idempotencyKey, status: 'IN_PROGRESS' },
    });
  } catch (e) {
    // Unique constraint violation means another request is already processing this key
    return res.status(409).json({ error: 'Request already in progress — retry after 1s' });
  }

  // Call payment gateway (Stripe)
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      metadata: { cartId },
    });
  } catch (stripeErr) {
    // If Stripe fails, do NOT commit the key as COMPLETE
    return res.status(502).json({ error: 'Payment gateway error — please retry' });
  }

  const responseData = {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };

  // R4: Persist response and order atomically in a transaction
  await db.$transaction(async (tx) => {
    await tx.idempotencyKey.update({
      where: { key: idempotencyKey },
      data: {
        status: 'COMPLETE',
        responseStatus: 201,
        responseBody: JSON.stringify(responseData),
      },
    });
    await tx.order.create({
      data: { cartId, paymentIntentId: paymentIntent.id },
    });
  });

  return res.status(201).json(responseData);
}

module.exports = { handleCheckout };
```

### Line-by-line explanation

- **Lines 10-13:** Extract and validate the `idempotency-key` request header. If missing, immediately reject with `400 Bad Request`.
- **Lines 16-21:** Query `db.idempotencyKey.findUnique` for the key. If an entry exists with a populated `responseBody`, parse and return the saved JSON payload with HTTP `200 OK` without contacting Stripe.
- **Lines 24-31:** Attempt to insert a new row with `status: 'IN_PROGRESS'`. The database table enforces a `UNIQUE` index on the `key` column. Under concurrent execution, only one request will successfully insert; concurrent duplicates throw a unique constraint error, caught and returned as `409 Conflict`.
- **Lines 34-45:** Invoke `stripe.paymentIntents.create()`. If this call throws an error, the catch block halts execution and leaves the key record uncommitted, preventing partial state bugs.
- **Lines 53-66:** Run `db.$transaction` to atomically mark the key as `COMPLETE` with its cached response payload and insert the new `order` record in the database.
- **Line 68:** Return `201 Created` with the payment intent details for the first successful execution.

### Diff against starter code

```diff
@@ -29,32 +29,58 @@
   const { cartId, amount, currency = 'usd', customerId } = req.body;
 
-  // TODO R1: Read and validate the Idempotency-Key header.
+  // R1: Validate header
+  const idempotencyKey = req.headers['idempotency-key'];
+  if (!idempotencyKey) {
+    return res.status(400).json({ error: 'Idempotency-Key header is required' });
+  }
 
-  // TODO R2: Check if this idempotency key was already processed.
+  // R2: Replay check — return stored response on retry
+  const existing = await db.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
+  if (existing && existing.responseBody) {
+    return res
+      .status(200) // 200 on replay, not 201
+      .json(JSON.parse(existing.responseBody));
+  }
 
-  // TODO R3: Prevent concurrent duplicate processing.
+  // R3: Atomic lock via DB unique constraint
+  try {
+    await db.idempotencyKey.create({
+      data: { key: idempotencyKey, status: 'IN_PROGRESS' },
+    });
+  } catch (e) {
+    return res.status(409).json({ error: 'Request already in progress — retry after 1s' });
+  }
 
-  // BUG: no idempotency check — a new PaymentIntent is created on every call!
-  const paymentIntent = await stripe.paymentIntents.create({
-    amount,
-    currency,
-    customer: customerId,
-    metadata: { cartId },
-  });
+  let paymentIntent;
+  try {
+    paymentIntent = await stripe.paymentIntents.create({
+      amount,
+      currency,
+      customer: customerId,
+      metadata: { cartId },
+    });
+  } catch (stripeErr) {
+    return res.status(502).json({ error: 'Payment gateway error — please retry' });
+  }
 
-  // TODO R4: Wrap the DB writes in a single transaction...
+  const responseData = {
+    clientSecret: paymentIntent.client_secret,
+    paymentIntentId: paymentIntent.id,
+  };
+
+  // R4: Persist response and order atomically in a transaction
+  await db.$transaction(async (tx) => {
+    await tx.idempotencyKey.update({
+      where: { key: idempotencyKey },
+      data: {
+        status: 'COMPLETE',
+        responseStatus: 201,
+        responseBody: JSON.stringify(responseData),
+      },
+    });
+    await tx.order.create({
+      data: { cartId, paymentIntentId: paymentIntent.id },
+    });
+  });
 
-  return res.status(201).json({
-    clientSecret: paymentIntent.client_secret,
-    paymentIntentId: paymentIntent.id,
-  });
+  return res.status(201).json(responseData);
```
