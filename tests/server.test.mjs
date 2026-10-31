import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("local server serves the app and API while keeping server-only files private", async (t) => {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: "0", NODE_ENV: "test", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => { child.kill(); });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server did not start")), 5000);
    child.stdout.on("data", (data) => {
      const match = data.toString().match(/port (\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited early: ${code}`)); });
  });
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /XYP3RN Music/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("content-security-policy"), /script-src 'self'/);
  for (const [path, type, cache] of [
    ["/app.js", "text/javascript", "no-cache"],
    ["/app.css", "text/css", "no-cache"],
    ["/sw.js", "text/javascript", "no-store"],
    ["/manifest.webmanifest", "application/manifest+json", "no-cache"],
    ["/assets/app-icon-192.png", "image/png", "immutable"],
    ["/orb-motion.js", "text/javascript", "no-cache"],
    ["/assets/idle-orb.mp4", "video/mp4", "immutable"],
    ["/assets/active-orb.mp4", "video/mp4", "immutable"],
    ["/assets/active-orb.webm", "video/webm", "immutable"],
    ["/assets/active-orb-poster.jpg", "image/jpeg", "immutable"]
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-type").startsWith(type), path);
    assert.ok(response.headers.get("cache-control").includes(cache), path);
    await response.body.cancel();
  }
  const head = await fetch(origin + "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const path of ["/lib/api.mjs", "/data/tracks.seed.json", "/.env", "/%2e%2e/%2e%2e/etc/passwd"]) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  assert.equal((await fetch(`${origin}/api/config`)).status, 200);
  const catalog = await fetch(`${origin}/api/tracks`);
  assert.equal((await catalog.json()).tracks.length, 9);
});
