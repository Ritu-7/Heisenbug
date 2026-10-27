# Bad Patch: Insertion-order eviction (get() doesn't promote the key)

## What it does

Implements `get()` as a plain `Map.get()` without the delete-and-reinsert
step. The `put()` implementation is correct — it deletes-and-reinserts on
update and evicts the map-head on overflow. But `get()` leaves the accessed
key at its **original insertion position**, so the cache evicts by insertion
order rather than access order.

## Why it fails

### The LRU contract: a `get()` is a use

An LRU cache must treat *any access* — read or write — as "recently used."
If you call `cache.get(2)` on key `2`, key `2` should become the
**most-recently-used** entry and be the last to be evicted.

This patch does not do that. After `cache.get(2)`, key `2` remains at its
original position in the `Map`. If a subsequent `put()` overflows the
cache, the Map evicts the head — which might be key `2` even though it was
just accessed.

### Which tests it fails

| Test | Expected | Got | Why |
|------|----------|-----|-----|
| V5   | `get(1) → 1` (key 1 promoted, survives eviction) | `-1` | key 1 not promoted on get |
| V6   | `get(2) → -1` (key 2 evicted because key 1 promoted) | `2` | key 2 incorrectly preserved |
| V7   | `[1,-1,-1,3,4]` (classic LeetCode 146 sequence) | incorrect | intermediate gets do not promote |
| V10  | `[-1, -1]` (large sequence access-order test) | incorrect | access-order desynchronized |

Tests V1, V2, V3, V4, V8, and V9 pass because basic get/put, put-updates (which re-insert on write), and simple capacity overflows work.

### The correct fix

In `get()`, after reading the value, do:

```javascript
this.cache.delete(key);
this.cache.set(key, val); // reinserts at tail = most-recently-used
```

This one delete-and-reinsert makes the entire LRU semantic correct at O(1)
because `Map` preserves insertion order and all three operations are O(1).

## Score: 60 / 100

The basic get/put, overflow, and update mechanics work. Only the LRU promotion
(access-order) tests fail (4 tests × 10 pts = 40 pts deducted).
