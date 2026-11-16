export const DEFAULT_FILTERS = Object.freeze({
  shiny_only: false, shiny_account: null, background_only: false,
  pvp_mode: false, pvp_league: "great", pvp_top_rank: null,
  pvp_include_pre_evolutions: true, pvp_min_cp: null,
  pokemon_ids: [], species_forms: [], location: null,
  cp_min: null, cp_max: null, level_min: null, level_max: null,
  iv_mode: "percent", iv_percent_min: null, iv_percent_max: null,
  raw_iv_atk: null, raw_iv_def: null, raw_iv_sta: null,
  sizes: [], forms: [], gender: null, boosted: null, weather_id: null,
  min_ttl: null, sort: "DSP", center_lat: null, center_lng: null,
  radius_km: null, blacklist_pokemon_ids: [], blacklist_species_forms: [], blacklist_forms: [],
});

const NUMBERS = {
  cp_min: [0, 10000, true], cp_max: [0, 10000, true],
  level_min: [1, 50], level_max: [1, 50],
  iv_percent_min: [0, 100], iv_percent_max: [0, 100],
  raw_iv_atk: [0, 15, true], raw_iv_def: [0, 15, true], raw_iv_sta: [0, 15, true],
  pvp_top_rank: [1, 50, true], pvp_min_cp: [0, 10000, true],
  center_lat: [-90, 90], center_lng: [-180, 180], radius_km: [0.1, Infinity],
  min_ttl: [0, 60, true],
};

export class SearchError extends Error {}

export function buildSearchPayload(values, selection = {}) {
  const p = structuredClone(DEFAULT_FILTERS);
  for (const [key, [min, max, integer]] of Object.entries(NUMBERS)) {
    const raw = values[key];
    if (raw === "" || raw === undefined || raw === null) continue;
    const number = Number(raw);
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
      throw new SearchError(`Check ${key.replaceAll("_", " ")}: enter ${integer ? "a whole number" : "a number"} from ${min}${max === Infinity ? " or higher" : ` to ${max}`}.`);
    }
    p[key] = number;
  }
  for (const key of ["shiny_only", "background_only", "pvp_mode"]) p[key] = values[key] === true || values[key] === "on";
  p.pvp_include_pre_evolutions = values.pvp_include_pre_evolutions !== "false";
  p.pvp_league = ["little", "great", "ultra"].includes(values.pvp_league) ? values.pvp_league : "great";
  p.iv_mode = values.iv_mode === "raw" ? "raw" : "percent";
  p.sort = ["DSP", "IV", "CP", "LEVEL", "DISTANCE"].includes(values.sort) ? values.sort : "DSP";
  p.gender = ["Male", "Female", "Genderless"].includes(values.gender) ? values.gender : null;
  p.sizes = (values.sizes || []).filter(s => ["XXS", "XS", "S", "M", "L", "XL", "XXL"].includes(s));
  p.shiny_account = String(values.shiny_account || "").trim() || null;
  p.boosted = values.weather === "boosted" ? true : values.weather === "unboosted" ? false : null;
  p.weather_id = /^[1-7]$/.test(values.weather || "") ? Number(values.weather) : null;
  if (values.location_mode !== "coords") {
    p.location = String(values.location || "").trim() || null;
    p.center_lat = p.center_lng = p.radius_km = null;
  } else {
    const count = [p.center_lat, p.center_lng, p.radius_km].filter(v => v !== null).length;
    if (count > 0 && count < 3) throw new SearchError("Enter latitude, longitude, and radius together, or clear all three to search everywhere.");
  }
  if (p.sort === "DISTANCE" && p.center_lat === null) throw new SearchError("Set coordinates and a radius to sort by distance.");
  for (const prefix of ["cp", "level", "iv_percent"]) {
    if (p[`${prefix}_min`] !== null && p[`${prefix}_max`] !== null && p[`${prefix}_min`] > p[`${prefix}_max`]) {
      throw new SearchError(`Minimum ${prefix.replaceAll("_", " ")} cannot exceed the maximum.`);
    }
  }
  if (p.iv_mode === "raw") p.iv_percent_min = p.iv_percent_max = null;
  else p.raw_iv_atk = p.raw_iv_def = p.raw_iv_sta = null;
  if (p.pvp_mode) {
    for (const key of ["cp_min", "cp_max", "level_min", "level_max", "iv_percent_min", "iv_percent_max", "raw_iv_atk", "raw_iv_def", "raw_iv_sta"]) p[key] = null;
  }
  const excluded = selection.pokemonMode === "exclude";
  const speciesKey = excluded ? "blacklist_pokemon_ids" : "pokemon_ids";
  const formsKey = excluded ? "blacklist_species_forms" : "species_forms";
  p[speciesKey] = [...new Set(selection.pokemonIds || [])];
  p[formsKey] = (selection.speciesForms || []).map(s => ({ ...s }));
  p[selection.formMode === "exclude" ? "blacklist_forms" : "forms"] = [...(selection.forms || [])];
  return p;
}

export function parseSearchResponse(data) {
  if (!data || !Array.isArray(data.results)) throw new SearchError("The provider returned an invalid response. Try the search again.");
  if (!data.results.every(r => r && typeof r === "object" && !Array.isArray(r) && Number.isInteger(r.pokemon_id) && r.pokemon_id > 0 && ["string", "number"].includes(typeof r.encounter_id) && String(r.encounter_id).trim())) {
    throw new SearchError("The provider returned an incomplete result. Try the search again.");
  }
  // total_matches may be zero despite nonempty results. Never paginate or slice this array.
  return { results: data.results };
}

export function parseCoordinates(data) {
  const coords = typeof data?.coords === "string" ? data.coords.trim() : "";
  const match = coords.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match || Math.abs(Number(match[1])) > 90 || Math.abs(Number(match[2])) > 180) {
    throw new SearchError("The provider did not return valid coordinates. You can try Find again.");
  }
  return `${match[1]}, ${match[2]}`;
}

export function remainingTime(despawnAt, now = Date.now()) {
  const timestamp = typeof despawnAt === "string" ? Date.parse(despawnAt) : NaN;
  if (!Number.isFinite(timestamp)) return { expired: false, text: "Despawn time unknown", urgent: false };
  const seconds = Math.max(0, Math.ceil((timestamp - now) / 1000));
  if (!seconds) return { expired: true, text: "Despawned", urgent: false };
  const minutes = Math.floor(seconds / 60);
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s left`;
  return { expired: false, text, urgent: seconds <= 180 };
}

export function normalizeEndpoint(value, base = "https://localhost/") {
  const input = value.trim();
  if (!input) return "";
  let url;
  try { url = new URL(input, base); } catch { throw new SearchError("Enter a valid API server URL."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new SearchError("Use HTTPS for the API server (HTTP is allowed for localhost).");
  if (url.username || url.password || url.search || url.hash) throw new SearchError("Use a server URL without credentials, query parameters, or a fragment.");
  return url.href;
}
