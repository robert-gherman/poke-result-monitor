import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import bridge from "../api/bridge.mjs";

const root = fileURLToPath(new URL("../site/", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:4173");
  if (url.pathname === "/api/bridge") {
    try { await bridge(req, res); }
    catch { res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end('{"error":"Local server error."}'); }
    return;
  }
  let path;
  try { path = resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`); }
  catch { res.writeHead(400); res.end(); return; }
  if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(path); res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); }
  catch { res.writeHead(404); res.end("Not found"); }
}).listen(4173, "127.0.0.1", () => console.log("Pokésearch: http://127.0.0.1:4173"));
