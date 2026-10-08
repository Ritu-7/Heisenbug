// solutions/reference.js — Reference solution for be-race-002
//
// The fix: wrap the read-check-decrement in db.$transaction() so the
// in-memory stub executes the operation atomically (no event-loop yields
// between read and write). On a real Postgres database this corresponds to
// using SELECT FOR UPDATE inside a transaction.
//
// NOTE: This file is volume-mounted at /app/src/charge.js inside Docker.
// All require() paths must be relative to /app/src/ (same as the starter).

'use strict';

const { db } = require('./db/client');

async function handlePurchase(req, res) {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      // Inside the transaction the stub reads synchronously (no yield),
      // preventing concurrent requests from interleaving here.
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
