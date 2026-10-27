// solutions/reference.js — Reference solution for algo-lru-cache-001
//
// Uses JavaScript's Map, which preserves insertion order with O(1)
// get/set/delete. The trick: on every access (get or put), delete-and-reinsert
// the key so it moves to the "most recent" tail of the Map's iteration order.
// The LRU entry is always at Map.keys().next().value (the head / first key).

class LRUCache {
  /**
   * @param {number} capacity
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * @param {number} key
   * @returns {number}
   */
  get(key) {
    if (!this.cache.has(key)) return -1;
    const val = this.cache.get(key);
    // Promote to most-recently-used by reinserting at tail
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  /**
   * @param {number} key
   * @param {number} value
   */
  put(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key); // remove old position
    }
    this.cache.set(key, value); // insert at tail (most-recently-used)
    if (this.cache.size > this.capacity) {
      // Map.keys().next().value = first key inserted = least-recently-used
      this.cache.delete(this.cache.keys().next().value);
    }
  }
}
