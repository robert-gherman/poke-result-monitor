import { ExpiringCache, searchKey, searchExpiry } from "../site/cache.mjs";
import { parseSearchResponse } from "../site/search-core.mjs";

const UPSTREAM = "https://coordinates-api.pokemongopro.com";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_ORIGINS = ["https://robert-gherman.github.io", "http://localhost:4173", "http://127.0.0.1:4173"];

export function createSearchCache(now = () => Date.now()) {
  return { entries: new ExpiringCache(8, now), pending: new Map(), now };
}
const guestSearches = createSearchCache();

function cacheHeaders(entry, now, hit) {
  return { "X-Pokesearch-Cache": hit ? "hit" : "miss", "X-Pokesearch-Age-Ms": String(Math.max(0, now - entry.fetchedAt)), "X-Pokesearch-TTL-Ms": String(Math.max(0, entry.expiresAt - now)) };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

function retrySeconds(header, detail) {
  const seconds = value => (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()))) && Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(86400, Math.ceil(Number(value))) : null;
  return seconds(header) || (header && Number.isFinite(Date.parse(header)) ? seconds((Date.parse(header) - Date.now()) / 1000) : null) || seconds(detail?.retry_after);
}

async function boundedBody(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) throw new RangeError("Response too large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RangeError("Response too large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}

// Web-standard handler shared by Vercel, Cloudflare Workers, and the local server.
export async function handleBridge(request, env = {}, fetchUpstream = fetch, cache = guestSearches) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const origins = new Set([...DEFAULT_ORIGINS, ...String(env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean), url.origin]);
  if (origin && !origins.has(origin)) return json({ error: "Origin is not allowed." }, 403);
  const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Expose-Headers": "X-Pokesearch-Cache, X-Pokesearch-Age-Ms, X-Pokesearch-TTL-Ms", "Access-Control-Max-Age": "600" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const route = url.searchParams.get("route");
  if (route === "health" && request.method === "GET") return json({ status: "ok" }, 200, cors);
  let revealCode = "";
  try { if (route?.startsWith("reveal/")) revealCode = decodeURIComponent(route.slice(7)); } catch { /* Invalid escaping is rejected below. */ }
  const reveal = /^[a-zA-Z0-9._~-]{1,2048}={0,2}$/.test(revealCode);
  const account = route === "account";
  if (route !== "search" && !reveal && !account) return json({ error: "Unknown route." }, 404, cors);
  if ((route === "search" && request.method !== "POST") || ((reveal || account) && request.method !== "GET")) return json({ error: "Method not allowed." }, 405, { ...cors, Allow: route === "search" ? "POST" : "GET" });
  const authorization = request.headers.get("authorization");
  if (authorization && !/^Bearer [^\s]{1,8192}$/.test(authorization)) return json({ error: "Invalid authorization header." }, 400, cors);
  if (account && !authorization) return json({ error: "Enter your provider access token to verify your account." }, 401, cors);
  let body;
  let payload;
  if (route === "search") {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Expected JSON." }, 415, cors);
    try {
      body = await boundedBody(request, MAX_BODY_BYTES);
      payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.keys(payload).length) throw new TypeError("Invalid filters");
    } catch (error) { return json({ error: error instanceof RangeError ? "Search filters are too large." : "Invalid search filters." }, error instanceof RangeError ? 413 : 400, cors); }
  }
  const headers = { Accept: "application/json", "Content-Type": "application/json", Origin: "https://pogocoordinates.com", Referer: "https://pogocoordinates.com/", "User-Agent": "RobertPokesearch/1.0" };
  // Only the visitor's optional token is forwarded. No shared account secrets.
  if (authorization) headers.Authorization = authorization;
  let key = null;
  try { if (route === "search" && !authorization && !payload.shiny_account) key = searchKey(payload); }
  catch { return json({ error: "Invalid search filters." }, 400, cors); }
  if (key) {
    const cached = cache.entries.get(key);
    if (cached) return json(cached.body, 200, { ...cors, ...cacheHeaders(cached, cache.now(), true) });
    const pending = cache.pending.get(key);
    if (pending) {
      const result = await pending;
      return json(result.body, result.status, { ...cors, ...(result.fetchedAt === undefined ? {} : cacheHeaders(result, cache.now(), true)) });
    }
  }
  // Only a few anonymous searches may be coalesced at once; no unbounded pending map.
  const operation = fetchProvider(request.method, route, revealCode, account, body, headers, fetchUpstream, cache.now);
  const tracked = key && cache.pending.size < 4;
  if (tracked) cache.pending.set(key, operation);
  try {
    const result = await operation;
    if (key && result.status === 200 && result.cacheable) cache.entries.set(key, result, result.expiresAt);
    return json(result.body, result.status, { ...cors, ...(result.fetchedAt === undefined ? {} : cacheHeaders(result, cache.now(), false)) });
  } finally { if (tracked) cache.pending.delete(key); }
}

async function fetchProvider(method, route, revealCode, account, body, headers, fetchUpstream, now) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const fetchedAt = now();
  try {
    const upstreamPath = account ? "users/me" : revealCode ? `reveal/${encodeURIComponent(revealCode)}` : "search";
    // Workers supports manual redirects only; reject 3xx below without following them.
    const response = await fetchUpstream(`${UPSTREAM}/${upstreamPath}`, { method, headers, body, signal: controller.signal, redirect: "manual" });
    if (!response.ok) {
      const status = [400, 401, 403, 404, 410, 422, 429].includes(response.status) ? response.status : 502;
      let detail;
      if (status === 429) {
        try { detail = JSON.parse(await boundedBody(response, 8192))?.detail; } catch { /* Retry guidance is optional. */ }
      }
      const retryAfter = status === 429 ? retrySeconds(response.headers.get("retry-after"), detail) : null;
      return { body: { error: status === 429 ? "Provider rate limit reached." : "Provider request failed.", ...(status === 429 ? { error_code: "provider_rate_limited" } : {}), ...(retryAfter ? { retry_after: retryAfter } : {}) }, status };
    }
    let data;
    let responseText;
    try { responseText = await boundedBody(response, MAX_RESPONSE_BYTES); data = JSON.parse(responseText); }
    catch { return { body: { error: "Invalid provider response." }, status: 502 }; }
    // Account verification returns no profile, trainer information or credentials.
    if (account) return typeof data?.is_vip === "boolean" ? { body: { authenticated: true, tier: data.is_vip ? "vip" : "free" }, status: 200 } : { body: { error: "Incomplete provider response." }, status: 502 };
    try { if (route === "search") parseSearchResponse(data); else if (typeof data?.coords !== "string") throw new TypeError(); }
    catch { return { body: { error: "Incomplete provider response." }, status: 502 }; }
    // Large valid replies still reach callers; avoid retaining them in each warm isolate.
    return { body: data, status: 200, ...(route === "search" ? { fetchedAt, expiresAt: searchExpiry(data.results, fetchedAt), cacheable: responseText.length <= 256 * 1024 } : {}) };
  } catch { return { body: { error: controller.signal.aborted ? "Provider request timed out." : "Provider connection failed." }, status: controller.signal.aborted ? 504 : 502 }; }
  finally { clearTimeout(timeout); }
}
