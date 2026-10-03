'use strict';

/**
 * src/db/client.js — Stateful in-memory stub with setImmediate yields.
 *
 * The setImmediate calls are CRITICAL for the concurrency test (H1):
 * they let the Node.js event loop process other incoming HTTP requests
 * between the "check if key exists" and "write the key" steps, exactly
 * simulating the race window that exists with real PostgreSQL I/O.
 *
 * Without yields, all three concurrent requests would atomically check
 * and write within the same synchronous execution slice, making the
 * concurrency test meaningless.
 */
'use strict';

const _store = {
  idempotencyKeys: new Map(), // key → row
  orders: [],
};

/** Pause and let the event loop process pending I/O before continuing. */
function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

const db = {
  idempotencyKey: {
    /** findUnique({ where: { key } }) */
    findUnique: async ({ where } = {}) => {
      await yieldToEventLoop(); // simulate real DB round-trip latency
      return _store.idempotencyKeys.get(where?.key) ?? null;
    },

    /** create({ data: { key, status, ... } }) — throws on duplicate key */
    create: async ({ data } = {}) => {
      await yieldToEventLoop(); // simulate real DB round-trip latency
      if (_store.idempotencyKeys.has(data.key)) {
        const err = new Error(`Unique constraint failed on field: key`);
        err.code  = 'P2002'; // Prisma unique constraint code
        throw err;
      }
      const row = { createdAt: new Date(), ...data };
      _store.idempotencyKeys.set(data.key, row);
      return row;
    },

    /** update({ where: { key }, data }) */
    update: async ({ where, data } = {}) => {
      await yieldToEventLoop();
      const existing = _store.idempotencyKeys.get(where?.key);
      if (!existing) throw new Error(`Record not found: key=${where?.key}`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      _store.idempotencyKeys.set(where.key, updated);
      return updated;
    },

    /** upsert({ where, create, update }) */
    upsert: async ({ where, create, update } = {}) => {
      await yieldToEventLoop();
      const existing = _store.idempotencyKeys.get(where?.key);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        _store.idempotencyKeys.set(where.key, updated);
        return updated;
      }
      const row = { createdAt: new Date(), ...create };
      _store.idempotencyKeys.set(where.key, row);
      return row;
    },
  },

  order: {
    create: async ({ data } = {}) => {
      await yieldToEventLoop();
      const row = { id: `order_${Date.now()}`, createdAt: new Date(), ...data };
      _store.orders.push(row);
      return row;
    },
  },

  $transaction: async (fn) => fn(db),

  /** Test helper — reset all state between test cases. */
  _reset() {
    _store.idempotencyKeys.clear();
    _store.orders.length = 0;
  },
};

module.exports = { db };
