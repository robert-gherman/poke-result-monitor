const UPSTREAM = "https://coordinates-api.pokemongopro.com";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_ORIGINS = ["https://robert-gherman.github.io", "http://localhost:4173", "http://127.0.0.1:4173"];

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
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
export async function handleBridge(request, env = {}, fetchUpstream = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const origins = new Set([...DEFAULT_ORIGINS, ...String(env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean), url.origin]);
  if (origin && !origins.has(origin)) return json({ error: "Origin is not allowed." }, 403);
  const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "600" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const route = url.searchParams.get("route");
  if (route === "health" && request.method === "GET") return json({ status: "ok" }, 200, cors);
  let revealCode = "";
  try { if (route?.startsWith("reveal/")) revealCode = decodeURIComponent(route.slice(7)); } catch { /* Invalid escaping is rejected below. */ }
  const reveal = /^[a-zA-Z0-9._~-]{1,2048}={0,2}$/.test(revealCode);
  if (route !== "search" && !reveal) return json({ error: "Unknown route." }, 404, cors);
  if ((route === "search" && request.method !== "POST") || (reveal && request.method !== "GET")) return json({ error: "Method not allowed." }, 405, { ...cors, Allow: reveal ? "GET" : "POST" });
  const authorization = request.headers.get("authorization");
  if (authorization && !/^Bearer [^\s]{1,8192}$/.test(authorization)) return json({ error: "Invalid authorization header." }, 400, cors);
  let body;
  if (route === "search") {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Expected JSON." }, 415, cors);
    try {
      body = await boundedBody(request, MAX_BODY_BYTES);
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.keys(payload).length) throw new TypeError("Invalid filters");
    } catch (error) { return json({ error: error instanceof RangeError ? "Search filters are too large." : "Invalid search filters." }, error instanceof RangeError ? 413 : 400, cors); }
  }
  const headers = { Accept: "application/json", "Content-Type": "application/json", Origin: "https://pogocoordinates.com", Referer: "https://pogocoordinates.com/", "User-Agent": "RobertPokesearch/1.0" };
  // Only the visitor's optional token is forwarded. No shared account secrets.
  if (authorization) headers.Authorization = authorization;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const upstreamPath = reveal ? `reveal/${encodeURIComponent(revealCode)}` : "search";
    const response = await fetchUpstream(`${UPSTREAM}/${upstreamPath}`, { method: request.method, headers, body, signal: controller.signal, redirect: "error" });
    if (!response.ok) {
      const status = [400, 401, 403, 404, 410, 422, 429].includes(response.status) ? response.status : 502;
      let retryAfter = Number(response.headers.get("retry-after")) || null;
      if (status === 429 && !retryAfter) {
        try { const data = JSON.parse(await boundedBody(response, 8192)); retryAfter = Number(data.detail?.retry_after) || null; } catch { /* Retry guidance is optional. */ }
      }
      return json({ error: status === 429 ? "Provider rate limit reached." : "Provider request failed.", ...(retryAfter && Number.isFinite(retryAfter) && retryAfter > 0 ? { retry_after: Math.min(retryAfter, 86400) } : {}) }, status, cors);
    }
    let data;
    try { data = JSON.parse(await boundedBody(response, MAX_RESPONSE_BYTES)); }
    catch { return json({ error: "Invalid provider response." }, 502, cors); }
    if (route === "search" ? !Array.isArray(data?.results) : typeof data?.coords !== "string") return json({ error: "Incomplete provider response." }, 502, cors);
    return json(data, 200, cors);
  } catch { return json({ error: controller.signal.aborted ? "Provider request timed out." : "Provider connection failed." }, controller.signal.aborted ? 504 : 502, cors); }
  finally { clearTimeout(timeout); }
}
