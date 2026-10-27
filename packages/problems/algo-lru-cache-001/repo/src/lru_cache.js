// src/lru_cache.js — LRU Cache implementation
// ALGO-001: Fix the eviction order bug
//
// An LRU (Least-Recently-Used) cache keeps the most recently accessed entries
// and evicts the least-recently-used entry when the cache is full.
//
// Operations required:
//   get(key)        → returns the value if key exists, else -1
//   put(key, value) → inserts or updates; if over capacity, evicts LRU entry
//
// Both get and put must run in O(1) average time.
//
// THIS IMPLEMENTATION HAS A BUG:
// The eviction logic runs on insertion order, not access order.
// `get()` does NOT promote a key to most-recently-used.
// Fix it so that a `get()` on an existing key makes that key the
// MOST recently used (last to be evicted), not the least.

class LRUCache {
  /**
   * @param {number} capacity - maximum number of entries the cache holds
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Return the value for key, or -1 if not present.
   *
   * BUG: this does NOT promote the accessed key to most-recently-used.
   * After a get(), the key stays in its original insertion position,
   * so it may be incorrectly evicted before keys that were never accessed.
   *
   * @param {number} key
   * @returns {number}
   */
  get(key) {
    if (!this.cache.has(key)) return -1;
    // ── BUG: should delete-and-reinsert to promote to MRU ──────────────────
    return this.cache.get(key); // wrong: key stays at its original position
    // ───────────────────────────────────────────────────────────────────────
  }

  /**
   * Insert or update the value for key.
   * If the cache exceeds capacity after this insert, evict the LRU entry.
   *
   * @param {number} key
   * @param {number} value
   */
  put(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.capacity) {
      // Evict the first (least-recently-inserted) key
      this.cache.delete(this.cache.keys().next().value);
    }
  }
}
