import test from "node:test";
import assert from "node:assert/strict";
import { parseSavedConnection, serializeConnection } from "../site/connection-storage.mjs";

const endpoint = "https://personal.example/api/bridge";
const id = "fixture-account";

test("remembered access restores the token together with its original server", () => {
  assert.deepEqual(parseSavedConnection(serializeConnection(endpoint, "fixture-own-token", id)), { version: 1, endpoint, token: "fixture-own-token", id });
  assert.deepEqual(parseSavedConnection(serializeConnection(endpoint, "", id)), { version: 1, endpoint, token: "", id });
});

test("absent, corrupt and unsupported saved connections restore no credentials", () => {
  for (const raw of [null, "", "bad json", "null", "[]", '{"version":2}', JSON.stringify({ version: 1, token: "fixture-own-token" })]) assert.equal(parseSavedConnection(raw), null);
});

test("unsafe servers or malformed tokens cannot restore credentials", () => {
  for (const url of ["", "/api/bridge", "http://remote.example/", "javascript:alert(1)", "https://name:password@example.com/", `${endpoint}?other=server`, `${endpoint}#hash`]) {
    assert.equal(parseSavedConnection(JSON.stringify({ version: 1, endpoint: url, token: "fixture-own-token", id })), null);
  }
  for (const token of [null, 123, {}, "Bearer fixture-own-token", "token\nvalue", "a".repeat(8193)]) {
    assert.equal(parseSavedConnection(JSON.stringify({ version: 1, endpoint, token, id })), null);
    assert.throws(() => serializeConnection(endpoint, token), /Invalid saved connection/);
  }
  assert.equal(parseSavedConnection(serializeConnection("http://127.0.0.1:4173/api/bridge", "a".repeat(8192))).token.length, 8192);
  assert.equal(parseSavedConnection(JSON.stringify({ version: 1, endpoint, token: "fixture-own-token", id: "" })), null);
});
