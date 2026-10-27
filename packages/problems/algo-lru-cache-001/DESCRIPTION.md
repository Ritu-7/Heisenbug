# ALGO-001 — LRU Cache: O(1) get and put with correct eviction order

**Track:** Algorithms · **Difficulty:** Medium · **Est. time:** 25 min  
**Skills:** data-structures · algorithms  
**Stack:** JavaScript

> **Fully transparent problem** — All 10 test cases are visible to you from the start.
> This problem has **no hidden test tier by design, not as an oversight.**
> Your code runs in a sandboxed Node.js `vm` context — it executes, but cannot
> access `process`, `require`, `fs`, or any network API.

---

## Ticket context

**Reported by:** Senior engineer (design review)  
**Severity:** 🟡 Medium  
**Component:** `src/lru_cache.js` — in-memory cache for hot API responses

### The task

Implement a **fixed-capacity LRU (Least-Recently-Used) cache** with two operations:

- `get(key)` → returns the cached value for `key`, or `-1` if absent
- `put(key, value)` → inserts or updates `key`; if the cache exceeds `capacity`, evicts the **least-recently-used** entry

**Both operations must run in O(1) average time.**

"Recently used" means: any `get` **or** `put` on a key makes that key
the most recently used. The next eviction candidate is the key that
has gone the longest without being touched.

---

## Codebase tour

```
src/
  lru_cache.js     ← the file you will edit
```

---

## Requirements

### R1 — Correct eviction order (LRU semantics)

When `put()` would exceed `capacity`, the **least-recently-used** key is
evicted — the one whose last `get` or `put` is oldest. A `get` on an existing
key makes that key the most-recently-used and therefore the **last** to be
evicted.

### R2 — O(1) average time for both `get` and `put`

A solution that scans the whole cache on every operation will timeout on the
large-sequence tests (V7, V10). Use a data structure that keeps track of
access order efficiently.

### R3 — Preserve the class interface

`class LRUCache` with `constructor(capacity)`, `get(key)`, and `put(key, value)`
must remain. The VM test harness instantiates `new LRUCache(n)` directly.

---

## Acceptance criteria — all 10 tests are visible

| ID | Check | Weight |
|----|-------|--------|
| V1 | `get` on empty cache returns `-1` | 10 pts |
| V2 | `get` returns value after `put` | 10 pts |
| V3 | evicted key returns `-1` | 10 pts |
| V4 | most-recently-put key survives eviction | 10 pts |
| V5 | `get` promotes key — accessed key survives subsequent eviction | 10 pts |
| V6 | `get` promotes key — *un*-accessed key is evicted instead | 10 pts |
| V7 | Classic LeetCode 146 full sequence | 10 pts |
| V8 | `put` on existing key updates value and promotes to MRU | 10 pts |
| V9 | capacity-1 cache evicts immediately on second put | 10 pts |
| V10 | Large sequence maintains correct LRU order throughout | 10 pts |

**Total: 100 pts**

> This problem is graded by running your code inside a `vm`-sandboxed
> JavaScript context. Your code **executes**, but is subject to a 2-second
> timeout. There is no Docker container and no hidden test tier.
