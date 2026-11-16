import { buildSearchPayload } from "./search-core.mjs";

const defaults = Object.freeze({
  cp_min: "", cp_max: "", level_min: "", level_max: "", iv_percent_min: "", iv_percent_max: "",
  raw_iv_atk: "", raw_iv_def: "", raw_iv_sta: "", pvp_top_rank: "", pvp_min_cp: "",
  center_lat: "", center_lng: "", radius_km: "", min_ttl: "", location: "", shiny_account: "",
  shiny_only: false, background_only: false, sizes: [], sort: "DSP", gender: "", weather: "",
  iv_mode: "percent", pvp_league: "great", pvp_include_pre_evolutions: "true",
});
const choices = {
  sort: ["DSP", "IV", "CP", "LEVEL", "DISTANCE"], gender: ["", "Male", "Female", "Genderless"],
  weather: ["", "boosted", "unboosted", "1", "2", "3", "4", "5", "6", "7"],
  iv_mode: ["percent", "raw"], pvp_league: ["little", "great", "ultra"], pvp_include_pre_evolutions: ["true", "false"],
};

// Store only search inputs. Connection URLs, bearer tokens and result data are excluded.
export function normalizeSearchPreset(search) {
  if (!search || typeof search !== "object" || !search.values || typeof search.values !== "object" || Array.isArray(search.values)
    || !["area", "coords"].includes(search.locationMode) || typeof search.pvp !== "boolean"
    || !["include", "exclude"].includes(search.formMode) || !Array.isArray(search.forms) || search.forms.length > 1000
    || !search.forms.every(value => typeof value === "string" && value.length > 0 && value.length <= 100)) throw new Error("A saved search has invalid filters.");
  const values = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = search.values[key] ?? fallback;
    if (key === "sizes") {
      if (!Array.isArray(value) || !value.every(size => ["XXS", "XS", "S", "M", "L", "XL", "XXL"].includes(size))) throw new Error("A saved search has invalid sizes.");
      values[key] = [...new Set(value)];
    } else {
      if (typeof value !== typeof fallback || (typeof value === "string" && value.length > (key === "shiny_account" ? 100 : 200)) || (choices[key] && !choices[key].includes(value))) throw new Error("A saved search has invalid filters.");
      values[key] = value;
    }
  }
  const snapshot = { values, locationMode: search.locationMode, pvp: search.pvp, formMode: search.formMode, forms: [...new Set(search.forms)] };
  buildSearchPayload({ ...values, location_mode: snapshot.locationMode, pvp_mode: snapshot.pvp }, { formMode: snapshot.formMode, forms: snapshot.forms });
  return snapshot;
}
