# Solution — algo-lru-cache-001

The complete fix is adding two lines to `get()`:

```javascript
get(key) {
  if (!this.cache.has(key)) return -1;
  const val = this.cache.get(key);
  this.cache.delete(key);   // remove from current (old) position
  this.cache.set(key, val); // reinsert at tail = most-recently-used
  return val;
}
```

`put()` is already correct — it deletes before reinserting (promotes on
update) and evicts `this.cache.keys().next().value` on overflow (the
Map's head = LRU entry). No other changes needed.
