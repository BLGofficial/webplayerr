import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi, loadEnvFiles } from "../lib/api.mjs";

loadEnvFiles();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ttf": "font/ttf", ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return;
  }
  let filePath;
  try {
    const decoded = decodeURIComponent(pathname);
    filePath = path.resolve(publicRoot, `.${decoded === "/" ? "/index.html" : decoded}`);
    if (!filePath.startsWith(`${publicRoot}${path.sep}`)) throw new Error("Path escape");
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mime[ext] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": pathname === "/sw.js" ? "no-store"
        : [".html", ".js", ".css", ".webmanifest"].includes(ext) ? "no-cache"
        : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    res.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`XYP3RN Music available on port ${server.address().port}\n`);
});
