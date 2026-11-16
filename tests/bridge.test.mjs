import test from "node:test";
import assert from "node:assert/strict";
import { handleBridge } from "../server/bridge.mjs";

const origin = "https://robert-gherman.github.io";
const request = (route, options = {}) => new Request(`https://test.vercel.app/api/bridge?route=${encodeURIComponent(route)}`, { headers: { Origin: origin }, ...options });
const post = (body, headers = {}) => ({ method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("only known origins, methods and fixed provider routes are allowed", async () => {
  let calls = 0;
  const upstream = async () => { calls++; throw new Error("must not fetch"); };
  for (const [req, status] of [
    [request("https://evil.example/"), 404], [request("../users/me"), 404],
    [request("reveal/%2e%2e%2fusers%2fme"), 404], [request("reveal/%252fusers"), 404],
    [request("search"), 405], [request("reveal/code", post({})), 405],
    [request("search", post({ cp_min: 0 }, { Origin: "https://evil.example" })), 403],
    [request("search", post([])), 400], [request("search", post({})), 400],
    [request("search", post({ large: "x".repeat(20000) })), 413],
  ]) assert.equal((await handleBridge(req, {}, upstream)).status, status);
  assert.equal(calls, 0);
});

test("GitHub Pages CORS preflight succeeds without contacting the provider", async () => {
  const response = await handleBridge(request("search", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } }), {}, () => { throw new Error("unexpected call"); });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});

test("a search forwards exactly one request and preserves all results", async () => {
  let calls = 0;
  const results = Array.from({ length: 25 }, (_, i) => ({ encounter_id: String(i), pokemon_id: 25 }));
  const response = await handleBridge(request("search", post({ shiny_only: true }, { Authorization: "Bearer visitor-token" })), {}, async (url, options) => {
    calls++;
    assert.equal(url, "https://coordinates-api.pokemongopro.com/search");
    assert.equal(options.headers.Authorization, "Bearer visitor-token");
    assert.equal(options.redirect, "manual");
    assert.deepEqual(JSON.parse(options.body), { shiny_only: true });
    return Response.json({ results, total_matches: 0 });
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results.length, 25);
  assert.equal(calls, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("provider redirects are rejected without another request or exposing their destination", async () => {
  let calls = 0;
  const response = await handleBridge(request("search", post({ cp_min: 0 }, { Authorization: "Bearer visitor-token" })), {}, async (url, options) => {
    calls++;
    assert.equal(url, "https://coordinates-api.pokemongopro.com/search");
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://unexpected.example/private" } });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("location"), null);
  assert.equal((await response.text()).includes("unexpected.example"), false);
});

test("anonymous reveal forwards no shared account token", async () => {
  const response = await handleBridge(request("reveal/test-code"), { SEARCH_AUTHORIZATION: "must-never-be-used" }, async (url, options) => {
    assert.equal(url, "https://coordinates-api.pokemongopro.com/reveal/test-code");
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ coords: "44.4268, 26.1025" });
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).coords, "44.4268, 26.1025");
});

test("provider failures remain failures and sensitive upstream details are suppressed", async () => {
  for (const status of [401, 403, 404, 410, 429, 500]) {
    const response = await handleBridge(request("reveal/test-code"), {}, async () => Response.json({ detail: { secret: "private", retry_after: 12 } }, { status }));
    assert.equal(response.status, status === 500 ? 502 : status);
    const body = await response.text();
    assert.equal(body.includes("private"), false);
    if (status === 429) assert.equal(JSON.parse(body).retry_after, 12);
  }
});

test("network and malformed provider replies do not become empty successful searches", async () => {
  for (const upstream of [async () => { throw new Error("private diagnostics"); }, async () => new Response("not json"), async () => Response.json({ total_matches: 0 })]) {
    const response = await handleBridge(request("search", post({ cp_min: 0 })), {}, upstream);
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes("private diagnostics"), false);
  }
});
