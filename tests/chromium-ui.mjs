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
let revealCount = 0;
let lastPayload;
let delayedRequest;
const results = Array.from({ length: 23 }, (_, i) => ({ encounter_id: `fixture-${i}`, pokemon_id: 147, pokemon_name: i === 0 ? "Dratini with a particularly long form name" : "Dratini", cp: 745, level: 30, iv_percent: 100, raw_iv: "15/15/15", gender: "Female", size: "XXL", location: "Bucharest, Romania · a long location that should wrap on narrow phones", shiny: true, weather_boosted: true, despawn_at: new Date(Date.now() + 1200000).toISOString(), reveal_code: `fixture-${i}` }));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
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
      const route = new URL(request.url).searchParams.get("route");
      if (route === "search") {
        searchCount++;
        lastPayload = JSON.parse(request.postData);
        if (mode === "delay") { delayedRequest = requestId; return; }
        if (mode === "error") { await fulfill(requestId, { error: "Provider failed" }, 502); return; }
        await fulfill(requestId, { results: mode === "zero" ? [] : mode === "one" ? results.slice(0, 1) : results, cap: 10, total_matches: 0 });
      } else if (route?.startsWith("reveal/")) {
        revealCount++;
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
async function until(expression) {
  const deadline = Date.now() + 10000;
  do { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${expression}`);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`, true);
async function viewport(width, height = 844, mobile = width < 600) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
async function noOverflow(label) {
  const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('input,select,button,.range-inputs,.size-options')].filter(e=>e.getBoundingClientRect().width && !e.closest('dialog:not([open])') && (e.getBoundingClientRect().right>innerWidth+1 || e.getBoundingClientRect().left < -1)).map(e=>e.id||e.className)})`);
  assert.ok(layout.scroll <= layout.width + 1, `${label}: horizontal overflow ${JSON.stringify(layout)}`);
  assert.equal(layout.offenders.length, 0, `${label}: clipped controls ${JSON.stringify(layout)}`);
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*api/bridge*", requestStage: "Request" }] });
  await send("Browser.grantPermissions", { origin: "http://127.0.0.1:4173", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await send("Page.navigate", { url: "http://127.0.0.1:4173/" });
  await until("document.querySelector('#pokemon-picker') && !document.querySelector('#pokemon-picker').disabled");
  await send("Page.bringToFront");
  for (const width of [320, 360, 375, 390, 430, 520, 768, 850, 1024, 1280]) {
    await viewport(width);
    await noOverflow(`initial ${width}`);
  }
  console.log("PASS: initial layout at 10 widths, 320–1280px");
  await viewport(390);
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
  await evaluate("navigator.clipboard.writeText=async()=>{throw new Error('Permission denied')} ");
  await click(".find-button");
  await until("document.querySelector('#copy-dialog').open");
  assert.equal(await evaluate("document.querySelector('#manual-coords').value"), "44.4268, 26.1025");
  await noOverflow("390px manual clipboard fallback");
  await click("#copy-dialog [data-close]");
  console.log("PASS: denied clipboard permission shows manual coordinates");
  mode = "error";
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
  await click("#search-button");
  await until("document.querySelector('#result-count').textContent==='0'");
  assert.match(await evaluate("document.querySelector('#results').textContent"), /No spawns/);
  mode = "delay";
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
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(`PASS: no uncaught browser exceptions; ${searchCount} fixture searches, ${revealCount} reveal; screenshots saved`);
} finally { ws.close(); }
