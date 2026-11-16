// Standalone Chromium over its native DevTools protocol. No Playwright or embedded browser.
// Start Chromium with --headless=new --remote-debugging-port=9222 and npm run dev first.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";

const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = pages.find(p => p.type === "page");
assert.ok(target, "Standalone Chromium must have an open page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
const errors = [];
let mode = "many";
let searchCount = 0;
let searchHeaders = [];
let revealCount = 0;
let lastPayload;
let delayedRequest;
let revealMode = "success";
let delayedReveal;
let accountMode = "free";
let lastAuthorization;
const results = Array.from({ length: 23 }, (_, i) => ({ encounter_id: `fixture-${i}`, pokemon_id: 147, pokemon_name: i === 0 ? "Dratini with a particularly long form name" : "Dratini", cp: 745, level: 30, iv_percent: 100, raw_iv: "15/15/15", gender: "Female", size: "XXL", location: "Bucharest, Romania · a long location that should wrap on narrow phones", shiny: true, weather_boosted: true, despawn_at: new Date(Date.now() + 1200000).toISOString(), reveal_code: `fixture-${i}` }));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
const fulfill = (requestId, body, responseCode = 200, headers = []) => send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }, ...headers], body: Buffer.from(JSON.stringify(body)).toString("base64") });
ws.addEventListener("message", async event => {
  const data = JSON.parse(event.data);
  if (data.id) {
    const promise = pending.get(data.id);
    if (!promise) return;
    clearTimeout(promise.timer); pending.delete(data.id);
    data.error ? promise.reject(new Error(data.error.message)) : promise.resolve(data.result);
  } else if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.text);
  else if (data.method === "Fetch.requestPaused") {
    try {
      const { requestId, request } = data.params;
      if (new URL(request.url).pathname.endsWith("/config.js")) {
        await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/javascript" }], body: Buffer.from('window.POGO_CONFIG={apiEndpoint:"http://127.0.0.1:4173/api/bridge"};').toString("base64") });
        return;
      }
      const route = new URL(request.url).searchParams.get("route");
      lastAuthorization = Object.entries(request.headers).find(([name]) => name.toLowerCase() === "authorization")?.[1];
      if (route === "account") {
        if (accountMode === "invalid") await fulfill(requestId, { error: "Provider request failed" }, 401);
        else await fulfill(requestId, { authenticated: true, tier: "free" });
        return;
      }
      if (route === "search") {
        searchCount++;
        lastPayload = JSON.parse(request.postData);
        if (mode === "delay") { delayedRequest = requestId; return; }
        if (mode === "error") { await fulfill(requestId, { error: "Provider failed" }, 502); return; }
        if (mode === "malformed") { await fulfill(requestId, { results: [null] }); return; }
        await fulfill(requestId, { results: mode === "zero" ? [] : mode === "one" ? results.slice(0, 1) : results, cap: 10, total_matches: 0 }, 200, searchHeaders);
      } else if (route?.startsWith("reveal/")) {
        revealCount++;
        if (revealMode === "limit") { await fulfill(requestId, { error_code: "provider_rate_limited", retry_after: 8 }, 429); return; }
        if (revealMode === "auth") { await fulfill(requestId, { error: "Provider request failed" }, 401); return; }
        if (revealMode === "delay") { delayedReveal = requestId; return; }
        await fulfill(requestId, { coords: "44.4268, 26.1025" });
      } else await send("Fetch.continueRequest", { requestId });
    } catch (error) { errors.push(error.message); }
  }
});

async function evaluate(expression, userGesture = false) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const advanceTime = ms => evaluate(`globalThis.fixtureOriginalNow ||= Date.now; globalThis.fixtureClockOffset=(globalThis.fixtureClockOffset||0)+${ms}; Date.now=()=>globalThis.fixtureOriginalNow()+globalThis.fixtureClockOffset`);
async function until(expression) {
  const deadline = Date.now() + 10000;
  do { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${expression}`);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`, true);
const ready = () => until('location.origin === "http://127.0.0.1:4173" && document.readyState === "complete" && !document.documentElement.dataset.reloading && window.POGO_CONFIG && !document.querySelector("#pokemon-search").disabled');
async function reload() {
  await evaluate('document.documentElement.dataset.reloading="true"');
  await send("Page.reload");
  await ready();
}
async function key(key) {
  const windowsVirtualKeyCode = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 }[key];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode });
}
async function typePokemon(text) {
  await evaluate('document.querySelector("#pokemon-search").scrollIntoView({block:"center"});document.querySelector("#pokemon-search").focus();document.querySelector("#pokemon-search").value="";document.querySelector("#pokemon-search").dispatchEvent(new Event("input"))');
  await send("Input.insertText", { text });
}
async function tap(selector) {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function savePreset(name) {
  await click("#save-pokemon-preset");
  await evaluate(`document.querySelector('#pokemon-preset-name').value=${JSON.stringify(name)};document.querySelector('#pokemon-preset-name').dispatchEvent(new Event('input'))`);
  await click("#confirm-pokemon-preset");
}
async function viewport(width, height = 844, mobile = width < 600) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
async function noOverflow(label) {
  const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('input,select,button,.range-inputs,.size-options')].filter(e=>e.getBoundingClientRect().width && !e.closest('dialog:not([open])') && (e.getBoundingClientRect().right>innerWidth+1 || e.getBoundingClientRect().left < -1)).map(e=>e.id||e.className)})`);
  assert.ok(layout.scroll <= layout.width + 1, `${label}: horizontal overflow ${JSON.stringify(layout)}`);
  assert.equal(layout.offenders.length, 0, `${label}: clipped controls ${JSON.stringify(layout)}`);
}
async function screenshot(name) {
  await mkdir(new URL("../.test-artifacts/", import.meta.url), { recursive: true });
  const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(new URL(`../.test-artifacts/${name}.png`, import.meta.url), Buffer.from(capture.data, "base64"));
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*api/bridge*", requestStage: "Request" }, { urlPattern: "*/config.js", requestStage: "Request" }] });
  await send("Browser.grantPermissions", { origin: "http://127.0.0.1:4173", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await send("Storage.clearDataForOrigin", { origin: "http://127.0.0.1:4173", storageTypes: "local_storage" });
  await evaluate('document.documentElement.dataset.reloading="true"');
  await send("Page.navigate", { url: "http://127.0.0.1:4173/" });
  await ready();
  await send("Page.bringToFront");
  for (const width of [320, 360, 375, 390, 430, 520, 768, 850, 1024, 1280]) {
    await viewport(width);
    await noOverflow(`initial ${width}`);
  }
  console.log("PASS: initial layout at 10 widths, 320–1280px");
  await viewport(390);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await typePokemon("");
  for (const letter of "dratini") {
    await send("Input.insertText", { text: letter });
    assert.match(await evaluate('document.querySelector("#pokemon-suggestions").textContent'), /Dratini/);
    assert.equal(await evaluate('document.querySelector("#pokemon-search").getAttribute("aria-expanded")'), "true");
  }
  for (const width of [320, 390, 430, 768, 1280]) { await viewport(width); await noOverflow(`autocomplete ${width}`); }
  await viewport(390);
  await key("ArrowDown");
  assert.equal(await evaluate('document.querySelector("#pokemon-search").getAttribute("aria-activedescendant")'), "pokemon-suggestion-0");
  await key("Enter");
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 1);
  await typePokemon("pika");
  await tap("#pokemon-suggestion-0");
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 2);
  await typePokemon("raichu alola");
  await key("ArrowUp");
  await key("Enter");
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 3);
  await typePokemon("no-such-pokemon");
  assert.match(await evaluate('document.querySelector("#pokemon-suggestions").textContent'), /No more matches/);
  await key("Escape");
  assert.equal(await evaluate('document.querySelector("#pokemon-suggestions").hidden'), true);
  assert.equal(searchCount, 0, "Typing, selecting and Enter must not send a spawn search");
  console.log("PASS: per-letter suggestions, touch selection, keyboard selection, empty matches and multiple species/forms use no API requests");
  await evaluate('document.querySelector("#pokemon-mode").value="exclude";document.querySelector("#pokemon-mode").dispatchEvent(new Event("change"))');
  const presetName = "My favorite Pokémon targets";
  await click("#save-pokemon-preset");
  for (const width of [320, 390, 768]) { await viewport(width); await noOverflow(`preset dialog ${width}`); }
  await viewport(390);
  await evaluate(`document.querySelector('#pokemon-preset-name').value=${JSON.stringify(presetName)};document.querySelector('#pokemon-preset-name').dispatchEvent(new Event('input'))`);
  await click("#confirm-pokemon-preset");
  const presetId = await evaluate('document.querySelector("#pokemon-preset").value');
  assert.ok(presetId);
  await click("button[type=reset]");
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 0);
  assert.equal(await evaluate('document.querySelector("#pokemon-preset").options.length'), 2, "Reset keeps saved presets");
  await reload();
  await evaluate(`document.querySelector('[name=cp_min]').value='111';document.querySelector('#pokemon-preset').value=${JSON.stringify(presetId)};document.querySelector('#pokemon-preset').dispatchEvent(new Event('change'))`);
  await click("#load-pokemon-preset");
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 3);
  assert.equal(await evaluate('document.querySelector("#pokemon-mode").value'), "exclude");
  assert.equal(await evaluate('document.querySelector("[name=cp_min]").value'), "111");
  assert.equal(searchCount, 0, "Loading a preset must not search automatically");
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled && document.querySelectorAll(".result-card").length===23');
  assert.deepEqual(lastPayload.blacklist_pokemon_ids, [25, 147]);
  assert.equal(lastPayload.blacklist_species_forms[0].pokemon_id, 26);
  assert.equal(lastPayload.blacklist_species_forms[0].form_id, 50);
  assert.deepEqual(lastPayload.pokemon_ids, []);
  assert.equal(lastPayload.cp_min, 111);
  console.log("PASS: a saved list survives reload, restores species/forms and exclusion mode, preserves other filters and submits the correct payload");
  await click('[aria-label="Remove Pikachu"]');
  await click("#save-pokemon-preset");
  await evaluate(`document.querySelector('#pokemon-preset-name').value=${JSON.stringify(presetName)};document.querySelector('#pokemon-preset-name').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate('document.querySelector("#confirm-pokemon-preset").textContent'), "Update preset");
  await click("#confirm-pokemon-preset");
  const savedPresets = await evaluate('localStorage.getItem("pogo-pokemon-presets-v1")');
  assert.equal(JSON.parse(savedPresets).presets.length, 1);
  assert.equal(JSON.parse(savedPresets).presets[0].keys.length, 2);
  await typePokemon("pika");
  await mkdir(new URL("../.test-artifacts/", import.meta.url), { recursive: true });
  const suggestionsImage = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(new URL("../.test-artifacts/pokemon-lists-mobile.png", import.meta.url), Buffer.from(suggestionsImage.data, "base64"));
  await key("Escape");
  await click("#save-pokemon-preset");
  await evaluate('globalThis.originalPresetSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==="pogo-pokemon-presets-v1")throw new DOMException("Quota exceeded","QuotaExceededError");return globalThis.originalPresetSetItem.call(this,key,value)};document.querySelector("#pokemon-preset-name").value="Quota failure"');
  await click("#confirm-pokemon-preset");
  assert.equal(await evaluate('document.querySelector("#pokemon-preset-dialog").open'), true);
  assert.match(await evaluate('document.querySelector("#pokemon-preset-error").textContent'), /Could not save/);
  assert.equal(await evaluate('localStorage.getItem("pogo-pokemon-presets-v1")'), savedPresets);
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 2);
  await evaluate('Storage.prototype.setItem=globalThis.originalPresetSetItem;delete globalThis.originalPresetSetItem;document.querySelector("#pokemon-preset-dialog").close();localStorage.setItem("pogo-pokemon-presets-v1","invalid saved data")');
  await reload();
  assert.match(await evaluate('document.querySelector("#pokemon-preset-message").textContent'), /could not be read/);
  assert.equal(await evaluate('localStorage.getItem("pogo-pokemon-presets-v1")'), "invalid saved data");
  assert.equal(await evaluate('document.querySelector("#pokemon-search").disabled'), false);
  await evaluate(`localStorage.setItem('pogo-pokemon-presets-v1',${JSON.stringify(savedPresets)})`);
  await reload();
  await evaluate(`document.querySelector('#pokemon-preset').value=${JSON.stringify(presetId)};document.querySelector('#pokemon-preset').dispatchEvent(new Event('change'))`);
  await click("#load-pokemon-preset");
  await click("#delete-pokemon-preset");
  assert.equal(await evaluate('document.querySelectorAll(".pokemon-chip").length'), 2);
  assert.deepEqual(JSON.parse(await evaluate('localStorage.getItem("pogo-pokemon-presets-v1")')).presets, []);
  console.log("PASS: removing a Pokémon, updating/deleting a preset, quota failure and corrupt storage preserve the correct saved/current data");
  const blockedStorageScript = await send("Page.addScriptToEvaluateOnNewDocument", { source: 'Storage.prototype.getItem=function(){throw new DOMException("Storage blocked","SecurityError")}' });
  await reload();
  assert.match(await evaluate('document.querySelector("#pokemon-preset-message").textContent'), /storage is blocked/);
  assert.equal(await evaluate('document.querySelector("#connection-notice").hidden'), true);
  await typePokemon("dratini");
  await key("Enter");
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled && document.querySelectorAll(".result-card").length===23');
  assert.deepEqual(lastPayload.pokemon_ids, [147]);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: blockedStorageScript.identifier });
  console.log("PASS: blocked browser storage disables saved presets while Pokémon selection and the configured search service still work");
  await reload();
  await click("#pokemon-picker");
  await evaluate("document.querySelector('#picker-search').value='Dratini';document.querySelector('#picker-search').dispatchEvent(new Event('input'))");
  await click(".picker-option input");
  assert.match(await evaluate("document.querySelector('#selection-count').textContent"), /1 selected/);
  await noOverflow("390px species picker");
  await click("#picker-dialog [data-close]");
  await evaluate("document.querySelector('[name=iv_percent_min]').value='100'");
  await click("#search-button");
  await until("document.querySelectorAll('.result-card').length===23");
  assert.equal(lastPayload.iv_percent_min, 100);
  assert.deepEqual(lastPayload.pokemon_ids, [147]);
  assert.match(await evaluate("document.querySelector('#search-message').textContent"), /all 23 results/);
  for (const width of [320, 360, 375, 390, 430, 520, 768, 850, 1024, 1280]) { await viewport(width); await noOverflow(`23 results ${width}`); }
  console.log("PASS: all 23 results rendered despite cap 10 / total_matches 0, at all 10 widths");
  await viewport(390);
  await evaluate("document.querySelector('.find-button').scrollIntoView({block:'center'})");
  await click(".find-button");
  await until("document.querySelector('.revealed-coords').textContent==='44.4268, 26.1025'");
  await until("document.querySelector('#toast').textContent.includes('Coordinates copied')");
  const clipboard = await evaluate("navigator.clipboard.readText()", true);
  assert.equal(clipboard, "44.4268, 26.1025");
  await click(".find-button");
  assert.equal(revealCount, 1);
  console.log("PASS: Find copies to the real Chromium clipboard; copy again does not re-reveal");
  const beforeCachedSearch = searchCount;
  const originalMeta = await evaluate('document.querySelector("#results-meta").textContent');
  await evaluate('globalThis.fixtureCopies=0;globalThis.fixtureWrite=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async text=>{globalThis.fixtureCopies++;return globalThis.fixtureWrite(text)}');
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled');
  assert.equal(searchCount, beforeCachedSearch);
  assert.equal(await evaluate('document.querySelector("#results-meta").textContent'), `${originalMeta} · cached`);
  assert.equal(await evaluate('document.querySelector(".find-button").textContent'), "Copy again");
  assert.equal(await evaluate('globalThis.fixtureCopies'), 0, "Search must not automatically copy cached coordinates");
  await advanceTime(15001);
  results[0].reveal_code = "replacement-code";
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled');
  assert.equal(searchCount, beforeCachedSearch + 1);
  await click(".find-button");
  assert.equal(revealCount, 1, "A changed reveal code for the same encounter reuses coordinates");
  assert.equal(await evaluate('globalThis.fixtureCopies'), 1);
  console.log("PASS: identical searches stay local for 15s without changing fetched time or copying; expired searches fetch again and reuse encounter coordinates across code changes");
  revealMode = "limit";
  await click(".result-card:nth-child(2) .find-button");
  await until('!document.querySelector("#provider-notice").hidden');
  assert.equal(revealCount, 2);
  assert.match(await evaluate('document.querySelector("#provider-guidance").textContent'), /Guest.*Cloudflare.*account/);
  assert.equal(await evaluate('document.querySelectorAll(".find-button:disabled").length'), 22);
  await click(".result-card:nth-child(3) .find-button");
  await click(".find-button");
  assert.equal(revealCount, 2, "Cooldown blocks other results but copying revealed coordinates remains local");
  for (const width of [320, 390, 768, 1280]) { await viewport(width); await noOverflow(`provider limit ${width}`); }
  await viewport(320);
  await evaluate('document.querySelector("#provider-notice").scrollIntoView({block:"start"})');
  await screenshot("provider-limit-mobile");
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled');
  assert.equal(await evaluate('document.querySelectorAll(".find-button:disabled").length'), 22, "A new search retains cooldown and cached coordinates");
  await until('!document.querySelector(".result-card:nth-child(2) .find-button").disabled');
  assert.equal(revealCount, 2, "Cooldown expiry must not retry automatically");
  revealMode = "delay";
  await click(".result-card:nth-child(2) .find-button");
  await until('document.querySelector(".result-card:nth-child(2) .find-button").textContent === "Finding…"');
  assert.equal(await evaluate('document.querySelectorAll(".find-button:disabled").length'), 22);
  await click(".result-card:nth-child(2) .find-button");
  assert.equal(revealCount, 3);
  await fulfill(delayedReveal, { coords: "44.4268, 26.1025" });
  await until('document.querySelector(".result-card:nth-child(2) .find-button").textContent === "Copy again"');
  assert.equal(await evaluate('document.querySelector("#provider-notice").hidden'), true);
  revealMode = "success";
  console.log("PASS: one shared cooldown survives a new search, preserves local copies, never auto-retries, and prevents simultaneous reveals");
  await click("#connection-button");
  await click(".account-help summary");
  for (const width of [320, 390, 768]) { await viewport(width); await noOverflow(`account connection ${width}`); }
  await viewport(320);
  await screenshot("provider-account-mobile");
  await evaluate('document.querySelector("#api-token").value="invalid-fixture-token"');
  accountMode = "invalid";
  await click("#save-connection");
  await until('document.querySelector("#connection-error").textContent.includes("rejected")');
  assert.equal(await evaluate('document.querySelector("#connection-dialog").open'), true);
  assert.equal(await evaluate('document.querySelectorAll(".result-card").length'), 23);
  accountMode = "free";
  await evaluate('document.querySelector("#api-token").value="Bearer fixture-own-token"');
  await click("#save-connection");
  await until('!document.querySelector("#connection-dialog").open');
  assert.equal(lastAuthorization, "Bearer fixture-own-token");
  assert.equal(await evaluate('document.querySelector("#api-token").value'), "");
  assert.equal(await evaluate('JSON.stringify(localStorage).includes("fixture-own-token") || JSON.stringify(sessionStorage).includes("fixture-own-token")'), false);
  assert.equal(await evaluate('document.querySelectorAll(".result-card").length'), 0, "New account requires a fresh search");
  await click("#search-button");
  await until('document.querySelectorAll(".result-card").length===23');
  assert.equal(lastAuthorization, "Bearer fixture-own-token");
  await click(".find-button");
  await until('document.querySelector(".find-button").textContent === "Copy again"');
  assert.equal(lastAuthorization, "Bearer fixture-own-token");
  revealMode = "auth";
  await click(".result-card:nth-child(2) .find-button");
  await until('document.querySelector("#provider-status").textContent === "Provider access rejected"');
  assert.equal(await evaluate('document.querySelectorAll(".find-button:disabled").length'), 22);
  await click("#provider-connect");
  assert.match(await evaluate('document.querySelector("#provider-account-state").textContent'), /needs verification/);
  await click("#save-connection");
  await until('!document.querySelector("#connection-dialog").open');
  assert.equal(await evaluate('document.querySelectorAll(".result-card").length'), 0);
  revealMode = "success";
  await click("#search-button");
  await until('document.querySelectorAll(".result-card").length===23');
  await click(".find-button");
  await until('document.querySelector(".find-button").textContent === "Copy again"');
  console.log("PASS: invalid account verification preserves results; verified visitor tokens reach search/reveal without storage; expired-token recovery requires fresh results");
  revealMode = "delay";
  delayedReveal = null;
  await click(".result-card:nth-child(2) .find-button");
  await until('document.querySelector(".result-card:nth-child(2) .find-button").textContent === "Finding…"');
  assert.ok(delayedReveal);
  await click("#connection-button");
  await evaluate('document.querySelector("#api-token").value="fixture-next-token"');
  await click("#save-connection");
  await until('!document.querySelector("#connection-dialog").open');
  try { await fulfill(delayedReveal, { coords: "1, 2" }); } catch { /* The cancelled interception may already have been removed by Chromium. */ }
  assert.equal(await evaluate('document.querySelectorAll(".revealed-coords").length'), 0);
  assert.match(await evaluate('document.querySelector("#toast").textContent'), /account verified/);
  revealMode = "success";
  await click("#search-button");
  await until('document.querySelectorAll(".result-card").length===23');
  assert.equal(lastAuthorization, "Bearer fixture-next-token");
  await click(".find-button");
  await until('document.querySelector(".find-button").textContent === "Copy again"');
  console.log("PASS: changing accounts cancels an outstanding reveal; its late response cannot display or copy old-account coordinates");
  await evaluate("navigator.clipboard.writeText=async()=>{throw new Error('Permission denied')} ");
  await click(".find-button");
  await until("document.querySelector('#copy-dialog').open");
  assert.equal(await evaluate("document.querySelector('#manual-coords').value"), "44.4268, 26.1025");
  await noOverflow("390px manual clipboard fallback");
  await click("#copy-dialog [data-close]");
  console.log("PASS: denied clipboard permission shows manual coordinates");
  mode = "error";
  await advanceTime(15001);
  await click("#search-button");
  await until("document.querySelector('#search-message').classList.contains('error')");
  assert.equal(await evaluate("document.querySelectorAll('.result-card').length"), 23);
  console.log("PASS: failed search keeps previous results and shows a settled error");
  await click("[data-location=coords]");
  await click("[data-stats=pvp]");
  for (const width of [320, 390, 768, 1280]) { await viewport(width); await noOverflow(`PvP/coordinates ${width}`); }
  mode = "one";
  await evaluate("document.querySelector('#center_lat').value='0';document.querySelector('#center_lng').value='0';document.querySelector('#radius_km').value='10';document.querySelector('#pvp_top_rank').value='1'");
  await click("#search-button");
  await until("document.querySelectorAll('.result-card').length===1");
  assert.equal(lastPayload.pvp_mode, true);
  assert.equal(lastPayload.iv_percent_min, null);
  assert.equal(lastPayload.center_lat, 0);
  console.log("PASS: PvP and coordinates include zero latitude, omit inactive stats, and remain responsive");
  mode = "zero";
  await advanceTime(15001);
  await click("#search-button");
  await until("document.querySelector('#result-count').textContent==='0'");
  assert.match(await evaluate("document.querySelector('#results').textContent"), /No spawns/);
  mode = "delay";
  await advanceTime(5001);
  await click("#search-button");
  while (!delayedRequest) await new Promise(resolve => setTimeout(resolve, 20));
  await click("button[type=reset]");
  try { await fulfill(delayedRequest, { results }); } catch { /* An aborted Chromium interception may already be gone. */ }
  await evaluate("new Promise(resolve=>setTimeout(resolve,100))");
  assert.equal(await evaluate("document.querySelectorAll('.result-card').length"), 0);
  assert.equal(await evaluate("document.querySelector('#search-button').disabled"), false);
  console.log("PASS: zero results are explicit; reset cancels a pending search and prevents stale replacement");
  mode = "many";
  await click("#search-button");
  await until("document.querySelectorAll('.result-card').length===23");
  await mkdir(new URL("../.test-artifacts/", import.meta.url), { recursive: true });
  for (const [width, name] of [[390, "mobile"], [1280, "desktop"]]) {
    await viewport(width);
    await evaluate("scrollTo(0,0)");
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(new URL(`../.test-artifacts/${name}.png`, import.meta.url), Buffer.from(screenshot.data, "base64"));
  }
  for (const failure of ["error", "malformed"]) {
    mode = failure;
    await evaluate(`document.querySelector('[name=cp_min]').value=${JSON.stringify(failure === "error" ? "1" : "2")}`);
    const before = searchCount;
    for (let i = 0; i < 2; i++) {
      await click("#search-button");
      await until('!document.querySelector("#search-button").disabled && document.querySelector("#search-message").classList.contains("error")');
      assert.equal(searchCount, before + i + 1);
      assert.equal(await evaluate('document.querySelectorAll(".result-card").length'), 23);
    }
  }
  mode = "many";
  searchHeaders = [{ name: "X-Pokesearch-Cache", value: "hit" }, { name: "X-Pokesearch-Age-Ms", value: "14000" }, { name: "X-Pokesearch-TTL-Ms", value: "1000" }];
  await evaluate('document.querySelector("[name=cp_min]").value="3"');
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled');
  const beforeAgedHit = searchCount;
  assert.match(await evaluate('document.querySelector("#results-meta").textContent'), /cached/);
  await click("#search-button");
  assert.equal(searchCount, beforeAgedHit);
  await advanceTime(1001);
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled');
  assert.equal(searchCount, beforeAgedHit + 1, "Aged bridge data must not start another 15-second browser lifetime");
  searchHeaders = [];
  console.log("PASS: failed/malformed searches are never cached; bridge cache age and remaining lifetime are respected");

  await click("#connection-button");
  await evaluate('document.querySelector("#api-endpoint").value="http://127.0.0.1:4173/api/bridge/"');
  await click("#save-connection");
  await until('!document.querySelector("#connection-dialog").open');
  const beforeEndpointSearch = searchCount;
  await click("#search-button");
  await until('!document.querySelector("#search-button").disabled');
  assert.equal(searchCount, beforeEndpointSearch + 1);
  assert.equal(await evaluate('document.querySelector(".revealed-coords").hidden'), true);
  await click(".find-button");
  await until('document.querySelector("#copy-dialog").open');
  await click("#copy-dialog [data-close]");
  const beforeExpiryReveals = revealCount;
  const millisecondsToDespawn = await evaluate(`Date.parse(${JSON.stringify(results[0].despawn_at)})-Date.now()+1`);
  await advanceTime(millisecondsToDespawn);
  await until('document.querySelector(".find-button").textContent==="Despawned"');
  assert.equal(await evaluate('document.querySelector(".revealed-coords").hidden'), true);
  await click(".find-button");
  assert.equal(revealCount, beforeExpiryReveals);
  console.log("PASS: changing endpoints clears both caches; despawn removes cached coordinates and prevents copying or revealing expired encounters");
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(`PASS: no uncaught browser exceptions; ${searchCount} fixture searches, ${revealCount} reveal; screenshots saved`);
} finally { ws.close(); }
