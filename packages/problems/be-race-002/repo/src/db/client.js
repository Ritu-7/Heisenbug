'use strict';

/**
 * src/db/client.js — Stateful in-memory stock counter stub with setImmediate yields.
 *
 * The setImmediate calls are CRITICAL for the concurrency test (H1):
 * they let the Node.js event loop process other incoming HTTP requests
 * between the "read stock" and "decrement stock" steps, exactly
 * simulating the race window that exists with real PostgreSQL I/O
 * when no row-level locking (SELECT FOR UPDATE) is used.
 *
 * Without yields, all concurrent requests would execute their
 * read-then-write atomically in the same sync slice, hiding the race.
 */

const _store = {
  stock: new Map(), // productId → { productId, quantity }
};

/** Pause and let the event loop process pending I/O before continuing. */
function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

const db = {
  stock: {
    /**
     * findUnique({ where: { productId } })
     * Returns { productId, quantity } or null.
     */
    findUnique: async ({ where } = {}) => {
      await yieldToEventLoop(); // simulate real DB round-trip
      const row = _store.stock.get(where?.productId);
      return row ? { ...row } : null;
    },

    /**
     * update({ where: { productId }, data: { quantity } })
     * Throws if row does not exist.
     */
    update: async ({ where, data } = {}) => {
      await yieldToEventLoop(); // simulate real DB round-trip
      const existing = _store.stock.get(where?.productId);
      if (!existing) throw new Error(`Stock row not found: productId=${where?.productId}`);
      const updated = { ...existing, ...data };
      _store.stock.set(where.productId, updated);
      return updated;
    },

    /**
     * upsert({ where: { productId }, create, update })
     * Inserts if absent, updates if present.
     */
    upsert: async ({ where, create, update } = {}) => {
      await yieldToEventLoop();
      const existing = _store.stock.get(where?.productId);
      if (existing) {
        const updated = { ...existing, ...update };
        _store.stock.set(where.productId, updated);
        return updated;
      }
      const row = { ...create };
      _store.stock.set(where.productId, row);
      return row;
    },
  },

  /**
   * $transaction(fn) — runs fn(db) where db operations use the same
   * in-memory store, but atomically: no extra yields inside the callback.
   *
   * The transaction proxy uses synchronous versions of operations so that
   * a correct check-then-update inside a transaction does NOT yield to the
   * event loop mid-operation (matching the semantics of a real DB transaction
   * with FOR UPDATE locking).
   */
  $transaction: async (fn) => {
    // Provide a transactional client that reads/writes synchronously
    const txClient = {
      stock: {
        findUnique: ({ where } = {}) => {
          // Synchronous read — no yield — inside a transaction
          const row = _store.stock.get(where?.productId);
          return Promise.resolve(row ? { ...row } : null);
        },
        update: ({ where, data } = {}) => {
          const existing = _store.stock.get(where?.productId);
          if (!existing) throw new Error(`Stock row not found: productId=${where?.productId}`);
          const updated = { ...existing, ...data };
          _store.stock.set(where.productId, updated);
          return Promise.resolve(updated);
        },
      },
    };
    return fn(txClient);
  },

  /** Test helper — seed stock for a product. */
  _seedStock(productId, quantity) {
    _store.stock.set(productId, { productId, quantity });
  },

  /** Test helper — reset all state between test cases. */
  _reset() {
    _store.stock.clear();
  },
};

module.exports = { db };
