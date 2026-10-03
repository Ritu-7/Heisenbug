// src/charge.js — Flash sale purchase handler
// FLASH-099: Inventory oversells during concurrent flash-sale purchases
//
// The problem: POST /purchase reads the current stock, checks it's > 0,
// then decrements — but without any locking. Under concurrent load (flash sale),
// multiple requests can ALL read the same positive stock value, ALL pass the
// check, and ALL decrement — pushing the counter below zero (oversell).
//
// YOUR JOB: fix the purchase handler so that concurrent requests can never
// oversell. The stock quantity must never go negative.
// See the Requirements section in the problem description for the full spec.

'use strict';

const { db } = require('./db/client'); // ← src/db/client.js

/**
 * POST /purchase
 *
 * Attempts to purchase one unit of `productId` from inventory.
 *
 * Current bug: non-atomic read-then-decrement — concurrent requests
 * can ALL see stock > 0 before any decrement, causing oversells.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handlePurchase(req, res) {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  // ── BUG: non-atomic check-then-decrement ─────────────────────────────────
  // Step 1: read stock
  const row = await db.stock.findUnique({ where: { productId } });

  if (!row) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Step 2: check
  if (row.quantity <= 0) {
    return res.status(409).json({ error: 'Out of stock' });
  }

  // ── RACE WINDOW: between the check above and the decrement below,
  //    another concurrent request can also pass the check and decrement.
  //    Under flash-sale load this causes stock to go negative. ──────────────

  // Step 3: decrement
  const updated = await db.stock.update({
    where: { productId },
    data:  { quantity: row.quantity - 1 },
  });

  return res.status(200).json({ productId, remaining: updated.quantity });
}

module.exports = { handlePurchase };
