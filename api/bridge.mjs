import { handleBridge } from "../server/bridge.mjs";

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, `https://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
  let body;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (Number(req.headers["content-length"]) > 16384) { res.statusCode = 413; res.setHeader("Content-Type", "application/json"); res.end('{"error":"Search filters are too large."}'); return; }
    if (req.body !== undefined) body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    else {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 16384) { res.statusCode = 413; res.end('{"error":"Search filters are too large."}'); return; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
  }
  const response = await handleBridge(new Request(requestUrl, { method: req.method, headers, ...(body !== undefined ? { body } : {}) }), process.env);
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(await response.text());
}
