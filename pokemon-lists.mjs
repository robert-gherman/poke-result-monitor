import { normalizeSearchPreset } from "./search-presets.mjs";

export const POKEMON_PRESETS_KEY = "pogo-pokemon-presets-v1";
export const MAX_PRESETS = 50;
export const MAX_PRESET_NAME = 60;

const fold = value => String(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9♀♂]/g, "");

export function matchPokemonOptions(options, query) {
  const search = fold(query);
  if (!search) return [...options];
  const rank = option => {
    const label = fold(option.label);
    const number = option.pokemon_id == null ? "" : String(option.pokemon_id).padStart(3, "0");
    if (label === search || number === search) return 0;
    if (label.startsWith(search)) return 1;
    return label.includes(search) || number.includes(search) ? 2 : 3;
  };
  return options.map(option => ({ option, rank: rank(option) })).filter(item => item.rank < 3).sort((a, b) => a.rank - b.rank).map(item => item.option);
}

function validatePresets(presets) {
  if (!Array.isArray(presets) || presets.length > MAX_PRESETS) throw new Error("Saved Pokémon presets have an unsupported format.");
  const ids = new Set();
  const names = new Set();
  return presets.map(preset => {
    if (!preset || typeof preset !== "object" || typeof preset.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(preset.id) || ids.has(preset.id)) throw new Error("A saved Pokémon preset is invalid.");
    const name = typeof preset.name === "string" ? preset.name.trim() : "";
    if (!name || name.length > MAX_PRESET_NAME || names.has(name.toLowerCase())) throw new Error("A saved Pokémon preset has an invalid or duplicate name.");
    const search = preset.search === undefined ? undefined : normalizeSearchPreset(preset.search);
    if (!["include", "exclude"].includes(preset.mode) || !Array.isArray(preset.keys) || (!preset.keys.length && !search) || preset.keys.length > 5000 || !preset.keys.every(key => typeof key === "string" && key.length <= 80 && /^p[1-9]\d*(?:f\d+c\d*)?$/.test(key))) throw new Error("A saved Pokémon list is invalid.");
    ids.add(preset.id);
    names.add(name.toLowerCase());
    return { id: preset.id, name, mode: preset.mode, keys: [...new Set(preset.keys)], ...(search ? { search } : {}) };
  });
}

export function parsePokemonPresets(raw) {
  if (raw === null) return [];
  if (typeof raw !== "string" || raw.length > 2 * 1024 * 1024) throw new Error("Saved Pokémon presets are too large to read.");
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("Saved Pokémon presets could not be read. Existing saved data has been kept."); }
  if (![1, 2].includes(data?.version)) throw new Error("Saved Pokémon presets use an unsupported version.");
  return validatePresets(data.presets);
}

export function serializePokemonPresets(presets) {
  // Version 2 makes older open tabs reject new data instead of discarding full filters.
  const raw = JSON.stringify({ version: 2, presets: validatePresets(presets) });
  if (raw.length > 2 * 1024 * 1024) throw new Error("Saved Pokémon presets are too large. Remove a preset before saving another.");
  return raw;
}
