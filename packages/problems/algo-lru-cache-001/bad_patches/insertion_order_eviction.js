// bad_patches/insertion_order_eviction.js
// Near-miss bad patch: get() does NOT promote the key.
// This is the same bug as the starter — eviction is by insertion order,
// not access order. Passes basic get/put and overflow tests, but fails
// all "get promotes key" test cases (V5, V6, V7, V8, V9).

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return -1;
    // NEAR-MISS BUG: returns value WITHOUT promoting the key.
    // Looks plausible — candidate "knows" Map.get is O(1) — but omits the
    // delete-and-reinsert step that makes LRU semantically correct.
    return this.cache.get(key);
  }

  put(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > this.capacity) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }
}
