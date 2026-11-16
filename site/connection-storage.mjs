import { normalizeEndpoint, SearchError } from "./search-core.mjs";

export const CONNECTION_KEY = "pogo-provider-connection-v1";

function normalizeConnection(value) {
  if (!value || value.version !== 1 || typeof value.endpoint !== "string" || typeof value.token !== "string" || value.token.length > 8192 || /\s/.test(value.token) || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)) throw new SearchError("Invalid saved connection.");
  const endpoint = normalizeEndpoint(value.endpoint);
  if (!endpoint || endpoint !== value.endpoint) throw new SearchError("Invalid saved connection.");
  return { version: 1, endpoint, token: value.token, id: value.id };
}

export function parseSavedConnection(raw) {
  if (!raw) return null;
  try { return normalizeConnection(JSON.parse(raw)); }
  catch { return null; }
}

export function serializeConnection(endpoint, token, id = crypto.randomUUID()) {
  return JSON.stringify(normalizeConnection({ version: 1, endpoint, token, id }));
}
