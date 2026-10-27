# Editorial — algo-lru-cache-001

## The Key Insight

A doubly-linked list + hashmap gives O(1) for all operations. In JavaScript,
`Map` already is both: it stores key→value in O(1) and **preserves insertion
order** with O(1) `delete`. The trick is using delete-and-reinsert to "move"
a key to the most-recently-used position (the tail of Map's iteration order).

## Why the Starter Breaks

The starter's `get()` returns the value without deleting and reinserting the
key. After `get(k)`, key `k` is still at its **original insertion position**
in the Map. The next eviction removes the Map's head — which could be `k`
even though it was just accessed.

## The Fix (One Line in `get`)

```javascript
get(key) {
  if (!this.cache.has(key)) return -1;
  const val = this.cache.get(key);
  this.cache.delete(key);   // ← remove from current position
  this.cache.set(key, val); // ← reinsert at tail (most-recently-used)
  return val;
}
```

`put()` already does this correctly for new keys (inserts at tail) and for
updates (delete-old-position + reinsert). The LRU eviction then evicts
`this.cache.keys().next().value` — the first key in Map iteration order =
the least-recently-used.

## Complexity

| Operation | Time | Space |
|-----------|------|-------|
| `get(key)` | O(1) avg | — |
| `put(key, val)` | O(1) avg | O(capacity) |

## The Classic Mistake (Bad Patch)

The classic near-miss is implementing `get()` as a plain read, without the
promote step. This makes the cache evict by **insertion order** (FIFO)
rather than **access order** (LRU). It passes basic tests but fails every
test that exercises the promotion invariant (V5, V6, V7, V8, V9).
