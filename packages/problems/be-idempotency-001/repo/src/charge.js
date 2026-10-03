// src/charge.js — Checkout payment processing
// PAY-482: Fix double-charges on client retry
//
// The problem: when a client retries a failed checkout request, the server
// creates a NEW PaymentIntent instead of returning the original result.
// This causes duplicate charges on the customer's card.
//
// YOUR JOB: implement idempotency so retries are safe.
// See the Requirements section in the problem description for full spec.

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const { db } = require('./db/client'); // ← src/db/client.js

/**
 * POST /checkout
 *
 * Creates a PaymentIntent and an Order row for the given cart.
 *
 * Current bug: no idempotency — every retry creates a NEW PaymentIntent,
 * resulting in duplicate charges.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleCheckout(req, res) {
  const { cartId, amount, currency = 'usd', customerId } = req.body;

  // ─────────────────────────────────────────────────────────────────────────
  // TODO R1: Read and validate the Idempotency-Key header.
  //
  // const idempotencyKey = req.headers['idempotency-key'];
  // if (!idempotencyKey) {
  //   return res.status(400).json({ error: 'Idempotency-Key header is required' });
  // }
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // TODO R2: Check if this idempotency key was already processed.
  //
  // const existing = await db.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  // if (existing?.responseBody) {
  //   return res
  //     .status(existing.responseStatus)          // 200 on replay (not 201)
  //     .json(JSON.parse(existing.responseBody));
  // }
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // TODO R3: Prevent concurrent duplicate processing.
  //   If two retries arrive simultaneously, one must win; the other gets 409.
  //
  // try {
  //   await db.idempotencyKey.create({
  //     data: { key: idempotencyKey, status: 'IN_PROGRESS' },
  //   });
  // } catch (e) {
  //   // Unique constraint → concurrent duplicate
  //   return res.status(409).json({ error: 'Request in progress' });
  // }
  // ─────────────────────────────────────────────────────────────────────────

  // BUG: no idempotency check — a new PaymentIntent is created on every call!
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    customer: customerId,
    metadata: { cartId },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TODO R4: Wrap the DB writes in a single transaction so that if
  //   paymentService throws, the idempotency key row is rolled back.
  //
  // await db.$transaction(async (tx) => {
  //   await tx.idempotencyKey.update({
  //     where: { key: idempotencyKey },
  //     data: {
  //       status: 'COMPLETE',
  //       responseStatus: 201,
  //       responseBody: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
  //     },
  //   });
  //   await tx.order.create({
  //     data: { cartId, paymentIntentId: paymentIntent.id },
  //   });
  // });
  // ─────────────────────────────────────────────────────────────────────────

  return res.status(201).json({
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
}

module.exports = { handleCheckout };
