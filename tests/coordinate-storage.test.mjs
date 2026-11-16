import test from "node:test";
import assert from "node:assert/strict";
import { RememberedCoordinates, COORDINATES_KEY } from "../site/coordinate-storage.mjs";
import { encounterKey } from "../site/cache.mjs";

const endpoint = "https://personal.example/api/bridge";
const key = encounterKey({ pokemon_id: 147, encounter_id: "spawn-one" });
function fixture() {
  let now = 100000;
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const open = (server = endpoint, account = "account-one") => {
    const cache = new RememberedCoordinates(() => storage, () => now);
    cache.connect(server, account);
    return cache;
  };
  return { values, storage, open, advance: ms => { now += ms; } };
}

test("revealed coordinates survive reopening for the same account/server and individual encounter", () => {
  const f = fixture();
  f.open().set(key, { coords: "44.4268, 26.1025", expiresAt: 120000 }, 120000);
  assert.deepEqual(f.open().get(key), { coords: "44.4268, 26.1025", expiresAt: 120000 });
  assert.equal(f.open().get(encounterKey({ pokemon_id: 147, encounter_id: "different-spawn" })), undefined);
  assert.equal(f.open(endpoint, "other-account").get(key), undefined);
  assert.equal(f.open("https://other.example/", "account-one").get(key), undefined);
  assert.equal(f.open(endpoint, "guest").get(key), undefined);
  assert.doesNotMatch(f.values.get(COORDINATES_KEY), /token|Authorization|reveal_code/);
});

test("reload cannot extend expiry, including corrected earlier despawn times", () => {
  const f = fixture();
  f.open().set(key, { coords: "0, 0", expiresAt: 120000 }, 120000);
  f.advance(10000);
  const reopened = f.open();
  assert.equal(reopened.get(key).expiresAt, 120000);
  reopened.set(key, { coords: "0, 0", expiresAt: 111000 }, 111000);
  f.advance(1000);
  assert.equal(f.open().get(key), undefined);
});

test("corrupt coordinates, invalid keys and unsafe expiry never restore usable results", () => {
  const f = fixture();
  f.open().set(key, { coords: "0, 0", expiresAt: 120000 }, 120000);
  const original = JSON.parse(f.values.get(COORDINATES_KEY));
  for (const change of [{ coords: "<script>" }, { coords: "91, 0" }, { expiresAt: 100000 }, { expiresAt: 3700001 }, { key: "broken" }, { key: "[147,null]" }]) {
    f.values.set(COORDINATES_KEY, JSON.stringify({ ...original, entries: [{ ...original.entries[0], ...change }] }));
    assert.equal(f.open().get(key), undefined);
  }
  f.values.set(COORDINATES_KEY, "broken json");
  assert.equal(f.open().get(key), undefined);
});

test("full/blocked storage retains revealed coordinates in memory without claiming persistence", () => {
  const f = fixture();
  const cache = f.open();
  f.storage.setItem = () => { throw new Error("full"); };
  cache.set(key, { coords: "0, 0", expiresAt: 120000 }, 120000);
  assert.equal(cache.storageAvailable, false);
  assert.equal(cache.get(key).coords, "0, 0");
  assert.equal(f.open().get(key), undefined);
  f.storage.getItem = () => { throw new Error("blocked"); };
  assert.equal(f.open().storageAvailable, false);
});

test("a bounded remembered list evicts old encounters and clear removes saved copies", () => {
  const f = fixture();
  const cache = f.open();
  for (let i = 0; i < 501; i++) cache.set(encounterKey({ pokemon_id: 147, encounter_id: String(i) }), { coords: "0, 0", expiresAt: 120000 }, 120000);
  assert.equal(JSON.parse(f.values.get(COORDINATES_KEY)).entries.length, 500);
  assert.equal(f.open().get(encounterKey({ pokemon_id: 147, encounter_id: "0" })), undefined);
  assert.equal(f.open().get(encounterKey({ pokemon_id: 147, encounter_id: "500" })).coords, "0, 0");
  cache.clear();
  assert.equal(f.values.has(COORDINATES_KEY), false);
  assert.equal(cache.get(encounterKey({ pokemon_id: 147, encounter_id: "500" })), undefined);
});
