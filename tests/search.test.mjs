import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchPayload, parseSearchResponse, parseCoordinates, remainingTime, normalizeEndpoint } from "../site/search-core.mjs";

test("an empty search uses optional null bounds and supports zero-valued filters", () => {
  const p = buildSearchPayload({ cp_min: "0", iv_percent_min: "0" });
  assert.equal(p.cp_min, 0);
  assert.equal(p.iv_percent_min, 0);
  assert.equal(p.cp_max, null);
  assert.deepEqual(p.pokemon_ids, []);
  assert.equal(p.pvp_include_pre_evolutions, true);
});

test("all returned results survive an inaccurate total count and a ten-item cap", () => {
  const results = Array.from({ length: 37 }, (_, i) => ({ encounter_id: String(i), pokemon_id: 25, pokemon_name: "Pikachu" }));
  const parsed = parseSearchResponse({ results, total_matches: 0, cap: 10 });
  assert.equal(parsed.results.length, 37);
  assert.equal(parsed.results[36].encounter_id, "36");
  assert.equal(parseSearchResponse({ results: [] }).results.length, 0);
  assert.equal(parseSearchResponse({ results: results.slice(0, 1) }).results.length, 1);
});

test("missing or malformed results remain failures, distinct from an empty search", () => {
  for (const data of [null, {}, { results: null }, { results: [{}] }, { results: [null] }]) assert.throws(() => parseSearchResponse(data));
});

test("species, costumes and form exclusions map to their API fields", () => {
  const selected = { pokemonMode: "exclude", pokemonIds: [25, 25, 147], speciesForms: [{ pokemon_id: 6, form_id: 178, costume_id: null }], formMode: "exclude", forms: ["ALOLA"] };
  const p = buildSearchPayload({ sizes: ["XXL", "XXS"], shiny_only: "on", weather: "unboosted" }, selected);
  assert.deepEqual(p.pokemon_ids, []);
  assert.deepEqual(p.blacklist_pokemon_ids, [25, 147]);
  assert.deepEqual(p.blacklist_species_forms, selected.speciesForms);
  assert.deepEqual(p.blacklist_forms, ["ALOLA"]);
  assert.deepEqual(p.sizes, ["XXL", "XXS"]);
  assert.equal(p.shiny_only, true);
  assert.equal(p.boosted, false);
});

test("numeric bounds, half levels, inverted ranges and incomplete coordinates", () => {
  assert.equal(buildSearchPayload({ level_min: "30.5", level_max: "50" }).level_min, 30.5);
  for (const values of [{ cp_min: "10", cp_max: "9" }, { raw_iv_atk: "16" }, { level_max: "51" }, { cp_min: "1.5" }, { iv_percent_min: "NaN" }, { location_mode: "coords", center_lat: "0" }, { sort: "DISTANCE" }]) assert.throws(() => buildSearchPayload(values));
  const p = buildSearchPayload({ location_mode: "coords", center_lat: "0", center_lng: "0", radius_km: "1", sort: "DISTANCE" });
  assert.equal(p.center_lat, 0);
  assert.equal(p.center_lng, 0);
  assert.equal(p.sort, "DISTANCE");
});

test("inactive IV modes and stats do not constrain PvP searches", () => {
  const raw = buildSearchPayload({ iv_mode: "raw", raw_iv_atk: "0", raw_iv_def: "15", raw_iv_sta: "15", iv_percent_min: "100" });
  assert.equal(raw.iv_percent_min, null);
  assert.equal(raw.raw_iv_atk, 0);
  const pvp = buildSearchPayload({ pvp_mode: true, pvp_league: "ultra", pvp_top_rank: "1", iv_percent_min: "100", level_min: "40" });
  assert.equal(pvp.level_min, null);
  assert.equal(pvp.iv_percent_min, null);
  assert.equal(pvp.pvp_top_rank, 1);
});

test("coordinates reject invalid locations and script-shaped provider data", () => {
  assert.equal(parseCoordinates({ coords: "-90.000, 180" }), "-90.000, 180");
  for (const coords of ["91, 20", "0, -181", "", "<script>alert(1)</script>", null]) assert.throws(() => parseCoordinates({ coords }));
});

test("expiry changes at the exact despawn boundary, unknown time is explicit", () => {
  assert.equal(remainingTime("2026-11-16T12:00:00Z", Date.parse("2026-11-16T12:00:00Z")).expired, true);
  assert.equal(remainingTime("2026-11-16T12:00:01Z", Date.parse("2026-11-16T12:00:00Z")).text, "0m 01s left");
  assert.equal(remainingTime(null).text, "Despawn time unknown");
});

test("connection settings require secure destinations without embedded credentials", () => {
  assert.equal(normalizeEndpoint("https://example.vercel.app/api/bridge"), "https://example.vercel.app/api/bridge");
  assert.equal(normalizeEndpoint("http://localhost:4173/api/bridge"), "http://localhost:4173/api/bridge");
  for (const url of ["http://example.com", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com?token=secret"]) assert.throws(() => normalizeEndpoint(url));
});
