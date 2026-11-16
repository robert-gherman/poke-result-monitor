import { buildSearchPayload, parseSearchResponse, parseCoordinates, remainingTime, normalizeEndpoint, SearchError } from "./search-core.mjs";
import { POKEMON_PRESETS_KEY, MAX_PRESETS, MAX_PRESET_NAME, matchPokemonOptions, parsePokemonPresets, serializePokemonPresets } from "./pokemon-lists.mjs";

const $ = selector => document.querySelector(selector);
const form = $("#search-form");
const state = { pokemonMode: "include", formMode: "include", pokemonIds: [], speciesForms: [], forms: [], locationMode: "area", pvp: false, catalog: [], formCatalog: [], options: [], picker: "pokemon", token: "", busy: false, generation: 0, cards: [] };
const pokemonLists = { presets: [], available: true, catalogReady: false, suggestions: [], active: -1 };
let toastTimer;
let endpoint = "";
let configuredEndpoint = window.POGO_CONFIG?.apiEndpoint || "";
try { configuredEndpoint = localStorage.getItem("pogo-api-endpoint") || configuredEndpoint; } catch { /* Use public configuration when browser storage is blocked. */ }
try { endpoint = normalizeEndpoint(configuredEndpoint, location.href); } catch { /* Invalid saved URL: use the connection dialog. */ }
if (!endpoint && !location.hostname.endsWith("github.io")) endpoint = new URL("./api/bridge", location.href).href;

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function announce(message, kind = "") {
  const box = $("#search-message");
  box.textContent = message;
  box.className = `notice ${kind}`;
  box.hidden = !message;
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 3500);
}

function setGroup(selector, enabled) {
  const group = $(selector);
  group.hidden = !enabled;
  for (const input of group.querySelectorAll("input,select")) input.disabled = !enabled;
}

function updateGroups() {
  setGroup("#coordinate-fields", state.locationMode === "coords");
  setGroup("#area-fields", state.locationMode === "area");
  setGroup("#stats-fields", !state.pvp);
  setGroup("#pvp-fields", state.pvp);
  const raw = form.elements.iv_mode.value === "raw";
  setGroup("#raw-fields", !state.pvp && raw);
  setGroup("#percent-fields", !state.pvp && !raw);
  for (const button of document.querySelectorAll("[data-location]")) button.setAttribute("aria-pressed", button.dataset.location === state.locationMode);
  for (const button of document.querySelectorAll("[data-stats]")) button.setAttribute("aria-pressed", (button.dataset.stats === "pvp") === state.pvp);
}

async function requestApi(route, payload, signal) {
  if (!endpoint) throw new SearchError("Connect your API server using the settings button to start searching.");
  const url = new URL(endpoint);
  url.searchParams.set("route", route);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 25000);
  try {
    const headers = { Accept: "application/json" };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(url, { method: payload === undefined ? "GET" : "POST", headers, body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error" });
    let data;
    try { data = await response.json(); } catch { throw new SearchError("The API server returned an invalid response. Check its URL in connection settings."); }
    if (!response.ok) {
      const error = new SearchError(response.status === 401 || response.status === 403 ? "Access was rejected. Check your provider token and API server settings." : response.status === 429 ? `Provider limit reached. Try again${Number.isFinite(data.retry_after) ? ` in ${Math.max(1, Math.ceil(data.retry_after))} seconds` : " later"}.` : response.status === 404 || response.status === 410 ? "This encounter has expired or is no longer available." : "The search service is unavailable. Try again in a moment.");
      error.status = response.status;
      error.retryAfter = data.retry_after;
      throw error;
    }
    return data;
  } catch (error) {
    if (error instanceof SearchError) throw error;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new SearchError(controller.signal.aborted ? "The request timed out. Try again when the service is available." : "Cannot connect to the API server. Check your connection and server URL, then try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function loadCatalog() {
  try {
    const responses = await Promise.all([fetch("./data/pokemon.json"), fetch("./data/forms.json")]);
    if (responses.some(r => !r.ok)) throw new Error("catalog");
    const [catalog, forms] = await Promise.all(responses.map(r => r.json()));
    if (!Array.isArray(catalog) || !Array.isArray(forms)) throw new Error("catalog");
    state.catalog = catalog;
    state.formCatalog = forms;
    const seen = new Set();
    for (const p of catalog) {
      if (!seen.has(p.pokemon_id)) {
        state.options.push({ key: `p${p.pokemon_id}`, label: p.species_name || `Pokémon #${p.pokemon_id}`, pokemon_id: p.pokemon_id, species: true });
        seen.add(p.pokemon_id);
      }
      if (p.form_suffix || p.costume_id != null) {
        const label = `${p.species_name} (${p.costume_name || p.form_suffix?.replaceAll("_", " ") || "Costume"})`;
        state.options.push({ key: `p${p.pokemon_id}f${p.form_id}c${p.costume_id ?? ""}`, label, pokemon_id: p.pokemon_id, form_id: p.form_id, costume_id: p.costume_id ?? null });
      }
    }
    $("#pokemon-picker").disabled = false;
    $("#pokemon-search").disabled = false;
    $("#forms-picker").disabled = false;
    pokemonLists.catalogReady = true;
    updatePresetControls();
  } catch {
    announce("Pokémon filter options could not load. Reload the page to try again; the other filters remain available.", "error");
  }
}

function optionSelected(option) {
  return option.species ? state.pokemonIds.includes(option.pokemon_id) : state.speciesForms.some(s => s.pokemon_id === option.pokemon_id && s.form_id === option.form_id && (s.costume_id ?? null) === option.costume_id);
}

function selectedPokemonOptions() { return state.options.filter(optionSelected); }

function setPokemonSelected(option, selected) {
  if (option.species) state.pokemonIds = selected ? [...new Set([...state.pokemonIds, option.pokemon_id])] : state.pokemonIds.filter(id => id !== option.pokemon_id);
  else {
    state.speciesForms = state.speciesForms.filter(s => !(s.pokemon_id === option.pokemon_id && s.form_id === option.form_id && (s.costume_id ?? null) === option.costume_id));
    if (selected) state.speciesForms.push({ pokemon_id: option.pokemon_id, form_id: option.form_id, costume_id: option.costume_id });
  }
}

function updateSelection() {
  const options = selectedPokemonOptions();
  const excluded = state.pokemonMode === "exclude";
  $("#pokemon-summary").textContent = options.length ? `${options.length} Pokémon ${excluded ? "excluded" : "selected"}` : "Any Pokémon";
  $("#forms-summary").textContent = state.forms.length ? `${state.forms.length} ${state.formMode === "exclude" ? "excluded" : "selected"} · ${state.forms.join(", ")}` : "Any form";
  $("#pokemon-chips").replaceChildren(...options.map(option => {
    const chip = node("li", "pokemon-chip");
    const remove = node("button", "remove-pokemon", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${option.label}`);
    remove.addEventListener("click", () => {
      setPokemonSelected(option, false);
      updateSelection();
      $("#pokemon-search").focus();
    });
    chip.append(node("span", "", `${excluded ? "− " : ""}${option.label}`), remove);
    return chip;
  }));
  $("#selection-count").textContent = `${state.picker === "pokemon" ? options.length : state.forms.length} selected`;
  updatePresetControls();
}

function closePokemonSuggestions() {
  $("#pokemon-suggestions").hidden = true;
  $("#pokemon-search").setAttribute("aria-expanded", "false");
  $("#pokemon-search").removeAttribute("aria-activedescendant");
  $("#pokemon-suggestion-status").textContent = "";
  pokemonLists.active = -1;
}

function renderPokemonSuggestions() {
  const input = $("#pokemon-search");
  if (!input.value.trim() || !pokemonLists.catalogReady) { closePokemonSuggestions(); return; }
  const matches = matchPokemonOptions(state.options, input.value).filter(option => !optionSelected(option));
  pokemonLists.suggestions = matches.slice(0, 12);
  pokemonLists.active = -1;
  input.removeAttribute("aria-activedescendant");
  const items = pokemonLists.suggestions.map((option, index) => {
    const item = node("li", "pokemon-suggestion");
    item.id = `pokemon-suggestion-${index}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.append(node("span", "", option.label), node("small", "", `#${String(option.pokemon_id).padStart(3, "0")}`));
    item.addEventListener("pointerdown", event => event.preventDefault());
    item.addEventListener("click", () => addPokemonSuggestion(option));
    return item;
  });
  if (!items.length) {
    const empty = node("li", "picker-empty", "No more matches. Try another Pokémon name or number.");
    empty.setAttribute("role", "presentation");
    items.push(empty);
  }
  $("#pokemon-suggestions").replaceChildren(...items);
  $("#pokemon-suggestions").hidden = false;
  input.setAttribute("aria-expanded", "true");
  $("#pokemon-suggestion-status").textContent = matches.length > 12 ? `${matches.length} matches. Showing the first 12; keep typing to narrow them down.` : `${matches.length} matches. Use the arrow keys to choose and Enter to add.`;
}

function addPokemonSuggestion(option) {
  setPokemonSelected(option, true);
  $("#pokemon-search").value = "";
  closePokemonSuggestions();
  updateSelection();
  $("#pokemon-search").focus();
}

function updatePresetControls() {
  const selected = pokemonLists.presets.some(preset => preset.id === $("#pokemon-preset").value);
  $("#save-pokemon-preset").disabled = !pokemonLists.available || !selectedPokemonOptions().length;
  $("#pokemon-preset").disabled = !pokemonLists.available || !pokemonLists.presets.length;
  $("#load-pokemon-preset").disabled = !pokemonLists.available || !pokemonLists.catalogReady || !selected;
  $("#delete-pokemon-preset").disabled = !pokemonLists.available || !selected;
}

function renderPokemonPresets(selectedId = $("#pokemon-preset").value) {
  const placeholder = node("option", "", pokemonLists.presets.length ? "Choose a saved Pokémon list…" : "No saved presets yet");
  placeholder.value = "";
  $("#pokemon-preset").replaceChildren(placeholder, ...pokemonLists.presets.map(preset => {
    const option = node("option", "", `${preset.name} (${preset.keys.length})`);
    option.value = preset.id;
    return option;
  }));
  $("#pokemon-preset").value = pokemonLists.presets.some(preset => preset.id === selectedId) ? selectedId : "";
  updatePresetControls();
}

function readPokemonPresets() {
  try {
    pokemonLists.presets = parsePokemonPresets(localStorage.getItem(POKEMON_PRESETS_KEY));
    pokemonLists.available = true;
    $("#pokemon-preset-message").textContent = "Presets are saved in this browser.";
  } catch (error) {
    pokemonLists.available = false;
    $("#pokemon-preset-message").textContent = error instanceof DOMException ? "Saved presets are unavailable because browser storage is blocked. You can still select Pokémon and search." : error.message;
  }
  renderPokemonPresets();
  if ($("#pokemon-preset-dialog").open) updatePresetSaveHint();
}

function writePokemonPresets(presets) {
  const serialized = serializePokemonPresets(presets);
  try { localStorage.setItem(POKEMON_PRESETS_KEY, serialized); }
  catch { throw new Error("Could not save presets. Browser storage may be full or blocked. Your selected Pokémon have been kept."); }
  pokemonLists.presets = presets;
}

function updatePresetSaveHint() {
  const name = $("#pokemon-preset-name").value.trim().toLowerCase();
  const exists = pokemonLists.presets.some(preset => preset.name.toLowerCase() === name);
  $("#confirm-pokemon-preset").textContent = exists ? "Update preset" : "Save preset";
  $("#pokemon-preset-hint").textContent = exists ? "A preset with this name exists. Update replaces its saved Pokémon list." : "Saved in this browser, ready for your next visit.";
  $("#pokemon-preset-error").textContent = "";
}

function renderPicker() {
  const search = $("#picker-search").value;
  const options = state.picker === "pokemon" ? state.options : state.formCatalog.map(value => ({ key: value, label: value.replaceAll("_", " ") }));
  const matches = matchPokemonOptions(options, search);
  const fragment = document.createDocumentFragment();
  for (const option of matches) {
    const label = node("label", "picker-option");
    const input = node("input");
    input.type = "checkbox";
    input.checked = state.picker === "pokemon" ? optionSelected(option) : state.forms.includes(option.key);
    input.addEventListener("change", () => {
      if (state.picker === "forms") state.forms = input.checked ? [...state.forms, option.key] : state.forms.filter(f => f !== option.key);
      else setPokemonSelected(option, input.checked);
      updateSelection();
    });
    label.append(input, node("span", "", option.label));
    if (option.pokemon_id) label.append(node("small", "", `#${String(option.pokemon_id).padStart(3, "0")}`));
    fragment.append(label);
  }
  if (!matches.length) fragment.append(node("p", "picker-empty", "No matches. Try another name or Pokédex number."));
  $("#picker-options").replaceChildren(fragment);
  updateSelection();
}

function openPicker(type) {
  closePokemonSuggestions();
  state.picker = type;
  $("#picker-title").textContent = type === "pokemon" ? "Select Pokémon" : "Select forms";
  $("#picker-search").value = "";
  $("#picker-search").placeholder = type === "pokemon" ? "Search by name or Pokédex number" : "Search forms";
  renderPicker();
  $("#picker-dialog").showModal();
  $("#picker-search").focus();
}

function stat(label, value, perfect = false, detail = "") {
  const box = node("div");
  box.append(node("span", "stat-label", label), node("span", `stat-value${perfect ? " perfect" : ""}`, value));
  if (detail) box.append(node("span", "iv-detail", detail));
  return box;
}

function value(value, suffix = "") { return typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : "—"; }
function text(value, fallback = "") { return typeof value === "string" ? value : fallback; }

async function copyCoordinates(coords) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(coords);
    toast("Coordinates copied. Happy hunting!");
    return true;
  } catch {
    $("#manual-coords").value = coords;
    if (!$("#copy-dialog").open) $("#copy-dialog").showModal();
    $("#manual-coords").focus();
    $("#manual-coords").select();
    return false;
  }
}

function createResult(result) {
  const card = node("li", "result-card");
  const image = node("img", "pokemon-image");
  image.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${result.shiny ? "shiny/" : ""}${result.pokemon_id}.png`;
  image.alt = "";
  image.width = image.height = 64;
  image.loading = "lazy";
  image.addEventListener("error", () => image.replaceWith(node("span", "pokemon-monogram", `#${result.pokemon_id}`)), { once: true });
  const main = node("div", "result-main");
  const title = node("div", "result-title");
  title.append(node("h3", "", text(result.pokemon_name, `Pokémon #${result.pokemon_id}`)), node("span", "dex-number", `#${String(result.pokemon_id).padStart(3, "0")}`));
  const badges = node("div", "result-badges");
  for (const label of [result.shiny ? "✧ Shiny" : "", result.background ? "▧ Background" : "", text(result.form), text(result.size), text(result.gender), result.weather_boosted ? "Weather boosted" : ""]) {
    if (label && label !== "NORMAL") badges.append(node("span", "result-badge", label));
  }
  const locationText = [text(result.location, "Location unavailable"), typeof result.distance_km === "number" ? `${result.distance_km} km away` : ""].filter(Boolean).join(" · ");
  const stats = node("div", "result-stats");
  const raw = typeof result.raw_iv === "string" ? result.raw_iv : Array.isArray(result.raw_iv) ? result.raw_iv.join("/") : "";
  stats.append(stat("IV", value(result.iv_percent, "%"), result.iv_percent === 100, raw), stat("CP", value(result.cp)), stat("Level", value(result.level)), stat("Size", text(result.size, "—")));
  main.append(title, badges, node("p", "result-location", locationText), stats);
  const actions = node("div", "result-actions");
  const countdown = node("span", "countdown");
  const find = node("button", "primary-button find-button", "⌖ Find");
  find.type = "button";
  find.setAttribute("aria-label", `Find ${text(result.pokemon_name, "Pokémon")} and copy coordinates`);
  let coords = "";
  let busy = false;
  let retryAt = 0;
  const errorBox = node("div", "card-error");
  errorBox.setAttribute("role", "status");
  errorBox.hidden = true;
  const coordBox = node("div", "revealed-coords");
  coordBox.hidden = true;
  const tick = () => {
    const time = remainingTime(result.despawn_at);
    card.classList.toggle("is-expired", time.expired);
    countdown.textContent = `${time.expired ? "" : "◷ "}${time.text}${result.despawn_verified === false ? " · estimated" : ""}`;
    countdown.classList.toggle("urgent", time.urgent);
    const waiting = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    find.disabled = busy || time.expired || waiting > 0 || (!coords && !result.reveal_code);
    if (!busy) find.textContent = time.expired ? "Despawned" : waiting ? `Retry in ${waiting}s` : coords ? "Copy again" : !result.reveal_code ? "Unavailable" : "⌖ Find";
  };
  find.addEventListener("click", async () => {
    if (find.disabled || busy) return;
    if (coords) { await copyCoordinates(coords); return; }
    busy = true;
    find.disabled = true;
    find.textContent = "Finding…";
    errorBox.hidden = true;
    try {
      coords = parseCoordinates(await requestApi(`reveal/${encodeURIComponent(result.reveal_code)}`));
      coordBox.textContent = coords;
      coordBox.hidden = false;
      await copyCoordinates(coords);
    } catch (error) {
      errorBox.textContent = error instanceof SearchError ? error.message : "Unable to find coordinates. Try again.";
      errorBox.hidden = false;
      if (error.status === 429) retryAt = Date.now() + Math.max(1, Number(error.retryAfter) || 60) * 1000;
      if (error.status === 404 || error.status === 410) result.despawn_at = new Date(0).toISOString();
    } finally { busy = false; tick(); }
  });
  actions.append(countdown, find);
  card.append(image, main, actions, coordBox, errorBox);
  tick();
  state.cards.push({ tick });
  return card;
}

function renderResults(data) {
  state.cards = [];
  $("#result-count").textContent = data.results.length;
  const timestamp = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
  $("#results-meta").textContent = `${data.results.length} returned · updated ${timestamp}`;
  if (!data.results.length) {
    const empty = node("div", "empty-state");
    empty.append(node("span", "empty-icon", "⌕"), node("h3", "", "No spawns match just yet"), node("p", "", "Try a wider area or relax a filter, then search again."));
    $("#results").replaceChildren(empty);
    return;
  }
  const list = node("ol", "result-list");
  const fragment = document.createDocumentFragment();
  for (const result of data.results) fragment.append(createResult(result));
  list.append(fragment);
  $("#results").replaceChildren(list);
  if (data.cap && data.results.length >= data.cap) announce(`Showing all ${data.results.length} results returned. The provider reports a ${data.cap}-result account limit; more matches may exist.`);
}

let activeSearch;
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (state.busy) return;
  const raw = Object.fromEntries(new FormData(form));
  raw.sizes = new FormData(form).getAll("sizes");
  raw.location_mode = state.locationMode;
  raw.pvp_mode = state.pvp;
  let payload;
  try { payload = buildSearchPayload(raw, state); }
  catch (error) { announce(error.message, "error"); $("#search-message").focus(); return; }
  if (!endpoint) { openConnection(); return; }
  state.busy = true;
  const generation = ++state.generation;
  activeSearch = new AbortController();
  $("#search-button").disabled = true;
  $("#search-button span").textContent = "Searching…";
  $(".results-section").setAttribute("aria-busy", "true");
  announce("Searching for live spawns…");
  try {
    const data = parseSearchResponse(await requestApi("search", payload, activeSearch.signal));
    if (generation !== state.generation) return;
    announce("");
    renderResults(data);
  } catch (error) {
    if (generation !== state.generation || error.name === "AbortError") return;
    announce(`${error instanceof SearchError ? error.message : "Search failed. Please try again."}${state.cards.length ? " Previous results are still shown." : ""}`, "error");
  } finally {
    if (generation === state.generation) {
      state.busy = false;
      $("#search-button").disabled = false;
      $("#search-button span").textContent = "Search Pokémon";
      $(".results-section").setAttribute("aria-busy", "false");
    }
  }
});

form.addEventListener("reset", () => {
  activeSearch?.abort();
  state.generation++;
  state.busy = false;
  state.pokemonIds = []; state.speciesForms = []; state.forms = [];
  state.pokemonMode = state.formMode = "include";
  state.locationMode = "area"; state.pvp = false;
  closePokemonSuggestions();
  $("#search-button").disabled = false;
  $("#search-button span").textContent = "Search Pokémon";
  $(".results-section").setAttribute("aria-busy", "false");
  announce(state.cards.length ? "Filters reset. Results from your last search are still shown; search again to update them." : "");
  queueMicrotask(() => { updateGroups(); updateSelection(); });
});

for (const button of document.querySelectorAll("[data-location]")) button.addEventListener("click", () => { state.locationMode = button.dataset.location; updateGroups(); });
for (const button of document.querySelectorAll("[data-stats]")) button.addEventListener("click", () => { state.pvp = button.dataset.stats === "pvp"; updateGroups(); });
for (const radio of form.querySelectorAll("[name=iv_mode]")) radio.addEventListener("change", updateGroups);
$("#pokemon-mode").addEventListener("change", e => { state.pokemonMode = e.target.value; updateSelection(); });
$("#form-mode").addEventListener("change", e => { state.formMode = e.target.value; updateSelection(); });
$("#pokemon-picker").addEventListener("click", () => openPicker("pokemon"));
$("#forms-picker").addEventListener("click", () => openPicker("forms"));
$("#picker-search").addEventListener("input", renderPicker);
$("#clear-selection").addEventListener("click", () => { if (state.picker === "pokemon") { state.pokemonIds = []; state.speciesForms = []; } else state.forms = []; renderPicker(); });
$("#pokemon-search").addEventListener("input", renderPokemonSuggestions);
$("#pokemon-search").addEventListener("focus", renderPokemonSuggestions);
$("#pokemon-autocomplete").addEventListener("focusout", event => { if (!event.currentTarget.contains(event.relatedTarget)) closePokemonSuggestions(); });
document.addEventListener("pointerdown", event => { if (!$("#pokemon-autocomplete").contains(event.target)) closePokemonSuggestions(); });
$("#pokemon-search").addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); closePokemonSuggestions(); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!$("#pokemon-suggestions").hidden && pokemonLists.suggestions.length) addPokemonSuggestion(pokemonLists.suggestions[Math.max(0, pokemonLists.active)]);
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  if ($("#pokemon-suggestions").hidden) renderPokemonSuggestions();
  if (!pokemonLists.suggestions.length || $("#pokemon-suggestions").hidden) return;
  const direction = event.key === "ArrowDown" ? 1 : -1;
  pokemonLists.active = pokemonLists.active < 0 ? (direction > 0 ? 0 : pokemonLists.suggestions.length - 1) : (pokemonLists.active + direction + pokemonLists.suggestions.length) % pokemonLists.suggestions.length;
  for (const [index, item] of [...$("#pokemon-suggestions").children].entries()) item.setAttribute("aria-selected", String(index === pokemonLists.active));
  const active = $(`#pokemon-suggestion-${pokemonLists.active}`);
  $("#pokemon-search").setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
});

$("#pokemon-preset").addEventListener("change", updatePresetControls);
$("#save-pokemon-preset").addEventListener("click", () => {
  $("#pokemon-preset-name").value = "";
  updatePresetSaveHint();
  $("#pokemon-preset-dialog").showModal();
  $("#pokemon-preset-name").focus();
});
$("#pokemon-preset-name").addEventListener("input", updatePresetSaveHint);
$("#pokemon-preset-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const name = $("#pokemon-preset-name").value.trim();
    const keys = selectedPokemonOptions().map(option => option.key);
    if (!name || name.length > MAX_PRESET_NAME) throw new Error(`Enter a preset name from 1 to ${MAX_PRESET_NAME} characters.`);
    if (!keys.length) throw new Error("Select at least one Pokémon before saving a preset.");
    const presets = parsePokemonPresets(localStorage.getItem(POKEMON_PRESETS_KEY));
    const existing = presets.find(preset => preset.name.toLowerCase() === name.toLowerCase());
    if (!existing && presets.length >= MAX_PRESETS) throw new Error(`You can save up to ${MAX_PRESETS} presets. Delete one before adding another.`);
    const preset = { id: existing?.id || crypto.randomUUID(), name, mode: state.pokemonMode, keys };
    writePokemonPresets(existing ? presets.map(item => item.id === existing.id ? preset : item) : [...presets, preset]);
    renderPokemonPresets(preset.id);
    $("#pokemon-preset-dialog").close();
    toast(existing ? "Pokémon preset updated." : "Pokémon preset saved in this browser.");
  } catch (error) {
    $("#pokemon-preset-error").textContent = error instanceof DOMException ? "Could not access browser storage. Your Pokémon list is still available." : error.message;
  }
});
$("#load-pokemon-preset").addEventListener("click", () => {
  const preset = pokemonLists.presets.find(item => item.id === $("#pokemon-preset").value);
  if (!preset || !pokemonLists.catalogReady) return;
  const keys = new Set(preset.keys);
  const options = state.options.filter(option => keys.has(option.key));
  if (options.length !== keys.size) { $("#pokemon-preset-message").textContent = "This preset contains Pokémon missing from the current catalogue. Your selection has been kept."; return; }
  state.pokemonIds = [];
  state.speciesForms = [];
  for (const option of options) setPokemonSelected(option, true);
  state.pokemonMode = preset.mode;
  $("#pokemon-mode").value = preset.mode;
  $("#pokemon-search").value = "";
  closePokemonSuggestions();
  updateSelection();
  $("#pokemon-preset-message").textContent = `Loaded “${preset.name}”. Other search filters are unchanged. Tap Search Pokémon when ready.`;
});
$("#delete-pokemon-preset").addEventListener("click", () => {
  const id = $("#pokemon-preset").value;
  try {
    const presets = parsePokemonPresets(localStorage.getItem(POKEMON_PRESETS_KEY));
    writePokemonPresets(presets.filter(preset => preset.id !== id));
    renderPokemonPresets("");
    $("#pokemon-preset-message").textContent = "Preset deleted. Your current Pokémon selection has been kept.";
  } catch (error) { $("#pokemon-preset-message").textContent = error instanceof DOMException ? "Could not access browser storage. The preset has been kept." : error.message; }
});
window.addEventListener("storage", event => { if (event.key === POKEMON_PRESETS_KEY || event.key === null) readPokemonPresets(); });
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => button.closest("dialog").close());

$("#geolocate").addEventListener("click", () => {
  if (!navigator.geolocation) { announce("Location is unavailable in this browser. Enter coordinates manually.", "error"); return; }
  const button = $("#geolocate");
  button.disabled = true;
  button.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(position => {
    form.elements.center_lat.value = position.coords.latitude.toFixed(6);
    form.elements.center_lng.value = position.coords.longitude.toFixed(6);
    if (!form.elements.radius_km.value) form.elements.radius_km.value = "10";
    button.disabled = false; button.textContent = "⌖ Use my location";
  }, () => {
    announce("Your location could not be accessed. Allow location access or enter coordinates manually.", "error");
    button.disabled = false; button.textContent = "⌖ Use my location";
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
});

for (const button of document.querySelectorAll("[data-preset]")) button.addEventListener("click", () => {
  form.reset();
  queueMicrotask(() => {
    if (button.dataset.preset === "hundo") form.elements.iv_percent_min.value = "100";
    if (button.dataset.preset === "high-level") form.elements.level_min.value = "30";
    form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    $("#search-button").focus({ preventScroll: true });
    toast("Filters ready. Tap Search Pokémon.");
  });
});

function openConnection() {
  $("#api-endpoint").value = endpoint;
  $("#api-token").value = state.token;
  $("#connection-error").textContent = "";
  $("#connection-dialog").showModal();
}

$("#connection-button").addEventListener("click", openConnection);
$("#setup-button").addEventListener("click", openConnection);
$("#connection-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const nextEndpoint = normalizeEndpoint($("#api-endpoint").value, location.href);
    if (!nextEndpoint) throw new SearchError("Enter the URL of your API server.");
    const token = $("#api-token").value.trim().replace(/^Bearer\s+/i, "");
    if (/\s/.test(token)) throw new SearchError("The provider token cannot contain spaces or new lines.");
    endpoint = nextEndpoint;
    state.token = token;
    let saved = true;
    try { localStorage.setItem("pogo-api-endpoint", endpoint); } catch { saved = false; }
    $("#connection-dialog").close();
    $("#api-token").value = "";
    $("#connection-notice").hidden = true;
    toast(saved ? "Connection settings saved." : "Connection ready for this tab. Browser storage is unavailable.");
  } catch (error) { $("#connection-error").textContent = error.message; }
});
$("#clear-connection").addEventListener("click", () => {
  state.token = ""; endpoint = "";
  try { localStorage.removeItem("pogo-api-endpoint"); } catch { /* Storage may be disabled. */ }
  $("#api-endpoint").value = "";
  $("#api-token").value = "";
  $("#connection-notice").hidden = false;
  $("#connection-dialog").close();
  toast("Disconnected. Token cleared.");
});
$("#manual-copy").addEventListener("click", async () => { if (await copyCoordinates($("#manual-coords").value)) $("#copy-dialog").close(); });
$("#connection-notice").hidden = Boolean(endpoint);
$("#pokemon-picker").disabled = true;
$("#forms-picker").disabled = true;
updateGroups();
readPokemonPresets();
loadCatalog();
setInterval(() => { for (const card of state.cards) card.tick(); }, 1000);
