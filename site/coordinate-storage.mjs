import { ExpiringCache } from "./cache.mjs";
import { parseCoordinates } from "./search-core.mjs";

export const COORDINATES_KEY = "pogo-revealed-coordinates-v1";

// Store only the current connection's encounters; credentials never enter this record.
export class RememberedCoordinates {
  constructor(storage = () => localStorage, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
    this.cache = new ExpiringCache(500, now);
    this.scope = "";
    this.storageAvailable = true;
  }
  connect(endpoint, accountId, restore = true) {
    this.cache.clear();
    this.scope = JSON.stringify([endpoint, accountId]);
    if (restore) this.restore();
  }
  restore() {
    let raw;
    try { raw = this.storage().getItem(COORDINATES_KEY); }
    catch { this.storageAvailable = false; return; }
    if (!raw || raw.length > 512000) return;
    let saved;
    try { saved = JSON.parse(raw); } catch { return; }
    if (saved?.version !== 1 || saved.scope !== this.scope || !Array.isArray(saved.entries) || saved.entries.length > 500) return;
    for (const entry of saved.entries) {
      try {
        if (!entry || typeof entry.key !== "string" || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= this.now() || entry.expiresAt > this.now() + 3600000) continue;
        const key = JSON.parse(entry.key);
        if (!Array.isArray(key) || key.length !== 2 || !Number.isInteger(key[0]) || key[0] <= 0 || typeof key[1] !== "string" || !key[1].trim()) continue;
        const coords = parseCoordinates({ coords: entry.coords });
        this.cache.set(entry.key, { coords, expiresAt: entry.expiresAt }, entry.expiresAt);
      } catch { /* Ignore damaged entries without making a provider request. */ }
    }
  }
  get(key) { return this.cache.get(key); }
  set(key, value, expiresAt) {
    const previous = this.cache.get(key);
    this.cache.set(key, value, expiresAt);
    if (previous?.coords === value.coords && previous?.expiresAt === expiresAt) return;
    const entries = [];
    for (const [key, entry] of this.cache.entries) {
      if (entry.expiresAt <= this.now()) continue;
      entries.push({ key, coords: entry.value.coords, expiresAt: entry.expiresAt });
    }
    try {
      this.storage().setItem(COORDINATES_KEY, JSON.stringify({ version: 1, scope: this.scope, entries }));
      this.storageAvailable = true;
    } catch { this.storageAvailable = false; }
  }
  clear() {
    this.cache.clear();
    try { this.storage().removeItem(COORDINATES_KEY); this.storageAvailable = true; }
    catch { this.storageAvailable = false; }
  }
}
