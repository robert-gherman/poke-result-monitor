import test from "node:test";
import assert from "node:assert/strict";
import { ExpiringCache, searchKey, searchExpiry, coordinateExpiry, encounterKey } from "../site/cache.mjs";
import { DEFAULT_FILTERS } from "../site/search-core.mjs";

test("search keys include every filter and preserve array order while ignoring object key order", () => {
  assert.equal(searchKey({ b: [{ y: 1, x: 2 }], a: 0 }), searchKey({ a: 0, b: [{ x: 2, y: 1 }] }));
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    assert.notEqual(searchKey(DEFAULT_FILTERS), searchKey({ ...DEFAULT_FILTERS, [key]: ["changed"] }), key);
  }
  assert.notEqual(searchKey({ pokemon_ids: [1, 2] }), searchKey({ pokemon_ids: [2, 1] }));
});

test("expiry is exact, reads do not extend life, and least recently used entries are evicted", () => {
  let now = 100;
  const cache = new ExpiringCache(2, () => now);
  cache.set("a", 1, 200); cache.set("b", 2, 200);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3, 300);
  assert.equal(cache.get("b"), undefined);
  now = 199; assert.equal(cache.get("a"), 1);
  now = 200; assert.equal(cache.get("a"), undefined);
  cache.set("expired", 4, now);
  assert.equal(cache.get("expired"), undefined);
  cache.clear(); assert.equal(cache.get("c"), undefined);
});

test("search lifetimes respect empty results and the earliest known despawn", () => {
  const now = 100000;
  assert.equal(searchExpiry([], now), now + 5000);
  assert.equal(searchExpiry([{}], now), now + 15000);
  assert.equal(searchExpiry([{ despawn_at: new Date(now + 1200).toISOString() }, {}], now), now + 1200);
  assert.equal(searchExpiry([{ despawn_at: new Date(now - 1).toISOString() }], now), now - 1);
});

test("coordinates survive code changes only for the same encounter and have bounded lifetimes", () => {
  const row = { pokemon_id: 147, encounter_id: "123", reveal_code: "old" };
  assert.equal(encounterKey(row), encounterKey({ ...row, reveal_code: "new" }));
  assert.notEqual(encounterKey(row), encounterKey({ ...row, encounter_id: "124" }));
  assert.notEqual(encounterKey(row), encounterKey({ ...row, pokemon_id: 1 }));
  assert.equal(coordinateExpiry(row, 100000), 160000);
  assert.equal(coordinateExpiry({ ...row, despawn_at: new Date(101000).toISOString() }, 100000), 101000);
  assert.equal(coordinateExpiry({ ...row, despawn_at: new Date(99999999).toISOString() }, 100000), 3700000);
});
