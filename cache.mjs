export const SEARCH_TTL = 15000;

// Object key order is irrelevant; array order retains the provider's semantics.
export function searchKey(payload) {
  return JSON.stringify(payload, (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export function searchExpiry(results, fetchedAt) {
  let expiresAt = fetchedAt + (results.length ? SEARCH_TTL : 5000);
  for (const result of results) {
    const despawn = typeof result.despawn_at === "string" ? Date.parse(result.despawn_at) : NaN;
    if (Number.isFinite(despawn)) expiresAt = Math.min(expiresAt, despawn);
  }
  return expiresAt;
}

export function encounterKey(result) {
  return JSON.stringify([result.pokemon_id, String(result.encounter_id)]);
}

export function coordinateExpiry(result, now = Date.now()) {
  const despawn = typeof result.despawn_at === "string" ? Date.parse(result.despawn_at) : NaN;
  return Math.min(Number.isFinite(despawn) ? despawn : now + 60000, now + 3600000);
}

export class ExpiringCache {
  constructor(limit, now = () => Date.now()) { this.limit = limit; this.now = now; this.entries = new Map(); }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) { this.entries.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value, expiresAt) {
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) return;
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key);
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }
  clear() { this.entries.clear(); }
}
