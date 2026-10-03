// packages/problems/be-idempotency-001/bad_patches/in_memory_map.js
//
// BAD PATCH: "Fix" double-charges using an in-process Map.
//
// Why it passes visible tests:
//   V1 — correctly returns 400 for missing header.
//   V2 — correctly returns 201 with clientSecret on first call.
//   V3 — correctly returns 200 on replay (Map.has() returns true).
//
// Why it fails hidden tests:
//   H1 (FAIL) — in-memory Map has NO atomic check-then-set.
//     Between Map.has() returning false and Map.set() being called,
//     there is an `await stripe.paymentIntents.create()` call which
//     yields to the event loop. Concurrent requests can ALL observe
//     Map.has() = false, then all create PaymentIntents, returning
//     three 201s instead of one 201 + two 409s.
//
//   H2 (PASS incidentally) — stripe failure → Map.set() never called
//     → stored key is null → test accepts null as valid.
//
//   H3 (PASS) — sequential retries work because Map is set before
//     the function returns.
//
// Additional production flaws (not tested here):
//   - Map is per-process (not shared across replicas)
//   - Map is lost on restart (no durability)
//   - No transaction atomicity (no order row created)

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// MODULE-LEVEL Map — persists across requests in the same process lifetime
const idempotencyCache = new Map();

async function handleCheckout(req, res) {
  const { cartId, amount, currency = 'usd', customerId } = req.body;

  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  // Replay check — synchronous Map lookup (no yield here)
  if (idempotencyCache.has(idempotencyKey)) {
    return res.status(200).json(idempotencyCache.get(idempotencyKey));
  }

  // BUG: No atomic lock. The `await` below yields to the event loop.
  // Concurrent requests can all pass the Map.has() check above before
  // any of them has called Map.set(), creating duplicate PaymentIntents.
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    customer: customerId,
    metadata: { cartId },
  });

  const responseData = {
    clientSecret:    paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };

  // This set() races with concurrent requests — all may have already
  // passed the has() check above while this was awaiting stripe.
  idempotencyCache.set(idempotencyKey, responseData);

  return res.status(201).json(responseData);
}

module.exports = { handleCheckout };
