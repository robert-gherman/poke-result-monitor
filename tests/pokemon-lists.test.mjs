import test from "node:test";
import assert from "node:assert/strict";
import { matchPokemonOptions, parsePokemonPresets, serializePokemonPresets, MAX_PRESETS } from "../site/pokemon-lists.mjs";

const options = [
  { key: "p147", pokemon_id: 147, label: "Dratini" },
  { key: "p25f1c", pokemon_id: 25, label: "Pikachu (COSTUME)" },
  { key: "p25", pokemon_id: 25, label: "Pikachu" },
  { key: "p122", pokemon_id: 122, label: "Mr. Mime" },
  { key: "p669", pokemon_id: 669, label: "Flabébé" },
  { key: "p26f50c", pokemon_id: 26, label: "Raichu (ALOLA)" },
];
const preset = { id: "test-id", name: "My targets", mode: "exclude", keys: ["p147", "p25f1c"] };

test("suggestions update for each letter, prefer exact species, and leave the catalogue intact", () => {
  for (const search of ["p", "pi", "pik", "pika", "pikac", "pikach", "pikachu"]) {
    assert.ok(matchPokemonOptions(options, search).every(option => option.pokemon_id === 25));
  }
  assert.equal(matchPokemonOptions(options, "Pikachu")[0].key, "p25");
  assert.deepEqual(matchPokemonOptions(options, "no-such-pokemon"), []);
  assert.deepEqual(matchPokemonOptions(options, ""), options);
  assert.equal(options[1].key, "p25f1c");
});

test("suggestions support Pokédex numbers, accents, punctuation and species forms", () => {
  assert.equal(matchPokemonOptions(options, "#025")[0].pokemon_id, 25);
  assert.equal(matchPokemonOptions(options, "flabebe")[0].key, "p669");
  assert.equal(matchPokemonOptions(options, "mr mime")[0].key, "p122");
  assert.equal(matchPokemonOptions(options, "raichu alola")[0].key, "p26f50c");
});

test("presets persist multiple species and forms, mode and Unicode names without unrelated fields", () => {
  const saved = parsePokemonPresets(serializePokemonPresets([{ ...preset, name: " My Pokémon ♀ ", token: "must-not-save", keys: [...preset.keys, "p147"] }]));
  assert.deepEqual(saved, [{ ...preset, name: "My Pokémon ♀" }]);
  assert.equal(serializePokemonPresets(saved).includes("token"), false);
  assert.deepEqual(parsePokemonPresets(null), []);
  assert.deepEqual(parsePokemonPresets(serializePokemonPresets([])), []);
});

test("malformed or unsupported storage is reported instead of becoming an empty preset list", () => {
  for (const raw of ["", "broken json", "null", "[]", '{"version":3,"presets":[]}', '{"version":1,"presets":{}}']) assert.throws(() => parsePokemonPresets(raw));
  assert.throws(() => parsePokemonPresets("x".repeat(2 * 1024 * 1024 + 1)));
});

test("invalid preset names, keys, modes and duplicate names or IDs are rejected", () => {
  for (const invalid of [{ name: " " }, { name: "a".repeat(61) }, { mode: "other" }, { keys: [] }, { keys: ["p0"] }, { keys: ["p25<script>"] }, { keys: [null] }, { id: "" }]) assert.throws(() => serializePokemonPresets([{ ...preset, ...invalid }]));
  assert.throws(() => serializePokemonPresets([preset, { ...preset, id: "other-id", name: "MY TARGETS" }]));
  assert.throws(() => serializePokemonPresets([preset, { ...preset, name: "Other name" }]));
});

test("preset count and name boundaries preserve the largest supported valid list", () => {
  const presets = Array.from({ length: MAX_PRESETS }, (_, i) => ({ ...preset, id: `preset-${i}`, name: `Preset ${i}` }));
  assert.equal(parsePokemonPresets(serializePokemonPresets(presets)).length, MAX_PRESETS);
  assert.throws(() => serializePokemonPresets([...presets, { ...preset, id: "extra" }]));
  assert.equal(parsePokemonPresets(serializePokemonPresets([{ ...preset, name: "a".repeat(60) }]))[0].name.length, 60);
});
