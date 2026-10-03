// bad_patches/naive-check.js — Plausible-but-wrong "fix" for be-race-002
//
// This patch passes visible tests (sequential) but fails the hidden
// concurrency tests because the check-then-decrement is still non-atomic —
// it just re-queries inside the same non-transactional flow, which still
// yields to the event loop between read and write.
//
// The candidate might think: "I'll just re-read stock right before decrementing
// to be sure." But this doesn't help — the race window is between the last
// read and the update, which still exists here.

'use strict';

const { db } = require('./db/client');

async function handlePurchase(req, res) {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  // Plausible-but-wrong: double-check without a transaction
  const row = await db.stock.findUnique({ where: { productId } });

  if (!row) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (row.quantity <= 0) {
    return res.status(409).json({ error: 'Out of stock' });
  }

  // "I'll re-read right before update to be safe" — still races!
  const fresh = await db.stock.findUnique({ where: { productId } });
  if (!fresh || fresh.quantity <= 0) {
    return res.status(409).json({ error: 'Out of stock' });
  }

  // RACE WINDOW STILL EXISTS: between fresh read and the update below
  const updated = await db.stock.update({
    where: { productId },
    data:  { quantity: fresh.quantity - 1 },
  });

  return res.status(200).json({ productId, remaining: updated.quantity });
}

module.exports = { handlePurchase };
