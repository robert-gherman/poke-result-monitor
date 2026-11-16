import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchPreset } from "../site/search-presets.mjs";
import { parsePokemonPresets, serializePokemonPresets } from "../site/pokemon-lists.mjs";
import { buildSearchPayload } from "../site/search-core.mjs";

const search = (values = {}, extra = {}) => ({ values, locationMode: "area", pvp: false, formMode: "include", forms: [], ...extra });
const preset = snapshot => ({ id: "search-1", name: "My search", keys: [], mode: "include", search: snapshot });

test("full search presets save any-Pokémon filters, raw IV, forms, weather, location and sorting", () => {
  const snapshot = normalizeSearchPreset(search({ cp_min: "0", cp_max: "2000", level_min: "20.5", iv_mode: "raw", raw_iv_atk: "0", raw_iv_def: "15", raw_iv_sta: "14", weather: "unboosted", sizes: ["XXS", "XXL"], gender: "Female", location: "Bucharest", sort: "CP", shiny_only: true, background_only: true, min_ttl: "0", shiny_account: "my-trainer" }, { formMode: "exclude", forms: ["ALOLA"] }));
  const restored = parsePokemonPresets(serializePokemonPresets([preset(snapshot)]))[0];
  assert.deepEqual(restored.search, snapshot);
  const payload = buildSearchPayload({ ...snapshot.values, location_mode: snapshot.locationMode, pvp_mode: snapshot.pvp }, { formMode: snapshot.formMode, forms: snapshot.forms });
  assert.equal(payload.cp_min, 0); assert.equal(payload.raw_iv_atk, 0); assert.equal(payload.boosted, false);
  assert.equal(payload.iv_percent_min, null); assert.equal(payload.level_min, 20.5);
  assert.deepEqual(payload.blacklist_forms, ["ALOLA"]); assert.deepEqual(payload.pokemon_ids, []);
});

test("coordinates and PvP preset round trips preserve zero, league and exclusions", () => {
  const snapshot = normalizeSearchPreset(search({ center_lat: "0", center_lng: "0", radius_km: "10", sort: "DISTANCE", pvp_league: "ultra", pvp_top_rank: "1", pvp_min_cp: "0", pvp_include_pre_evolutions: "false" }, { locationMode: "coords", pvp: true }));
  const restored = parsePokemonPresets(serializePokemonPresets([{ ...preset(snapshot), mode: "exclude", keys: ["p25", "p26f50c"] }]))[0];
  assert.deepEqual(restored.search, snapshot); assert.equal(restored.mode, "exclude");
  const payload = buildSearchPayload({ ...restored.search.values, location_mode: restored.search.locationMode, pvp_mode: restored.search.pvp });
  assert.equal(payload.center_lat, 0); assert.equal(payload.center_lng, 0); assert.equal(payload.pvp_mode, true);
  assert.equal(payload.pvp_include_pre_evolutions, false); assert.equal(payload.pvp_league, "ultra");
});

test("legacy Pokémon lists remain readable; connection tokens and results never enter saved searches", () => {
  const legacy = { id: "legacy", name: "Old list", keys: ["p25"], mode: "include" };
  assert.deepEqual(parsePokemonPresets(JSON.stringify({ version: 1, presets: [legacy] })), [legacy]);
  const raw = serializePokemonPresets([preset(search({ token: "secret", endpoint: "private", results: [], cp_min: "10" }, { token: "secret" }))]);
  assert.equal(JSON.parse(raw).version, 2);
  assert.equal(raw.includes("secret"), false); assert.equal(raw.includes("endpoint"), false); assert.equal(raw.includes("results"), false);
});

test("malformed or invalid searches are rejected instead of losing saved filters", () => {
  for (const snapshot of [null, {}, search({ cp_min: "-1" }), search({ cp_min: "100", cp_max: "0" }), search({ shiny_only: "true" }), search({ sizes: ["bad"] }), search({ sort: "bad" }), search({ center_lat: "1" }, { locationMode: "coords" }), search({}, { pvp: "true" }), search({}, { forms: [null] })]) {
    assert.throws(() => serializePokemonPresets([preset(snapshot)]));
  }
});
