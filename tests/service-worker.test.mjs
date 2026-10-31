import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://xyp3rn.example";

async function worker(t, online) {
  const listeners = new Map();
  const stores = new Map([["xyp3rn-music-shell-v1", new Map()], ["unrelated-app-cache", new Map()]]);
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(request, response) { store.set(new URL(typeof request === "string" ? request : request.url, origin).pathname, response); },
        async match(request) { return store.get(new URL(typeof request === "string" ? request : request.url, origin).pathname)?.clone(); },
        async addAll(paths) { for (const path of paths) await this.put(path, new Response(`cached:${path}`)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) {
        const response = store.get(new URL(request.url).pathname);
        if (response) return response.clone();
      }
    }
  };
  const context = vm.createContext({
    self: { location: new URL(origin), addEventListener: (name, callback) => listeners.set(name, callback), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches, URL, Response,
    fetch: async (request) => {
      if (!online) throw new Error("offline");
      const response = new Response(`network:${new URL(request.url).pathname}`);
      Object.defineProperty(response, "type", { value: "basic" });
      return response;
    }
  });
  vm.runInContext(source, context);
  for (const name of ["install", "activate"]) {
    let pending;
    listeners.get(name)({ waitUntil: (promise) => { pending = promise; } });
    await pending;
  }
  assert.equal(stores.has("xyp3rn-music-shell-v1"), false);
  assert.equal(stores.has("unrelated-app-cache"), true);
  return {
    stores,
    request(path, mode = "") {
      let pending;
      let handled = false;
      listeners.get("fetch")({
        request: { url: origin + path, method: "GET", mode },
        respondWith(promise) { handled = true; pending = promise; }
      });
      return { handled, response: pending };
    }
  };
}

test("service worker revalidates app code and preserves an offline shell", async (t) => {
  const sw = await worker(t, true);
  assert.equal(await (await sw.request("/app.js").response).text(), "network:/app.js");
  assert.equal(await sw.stores.get("xyp3rn-music-shell-v3").get("/app.js").text(), "network:/app.js");
  assert.equal(await (await sw.request("/orb-motion.js").response).text(), "network:/orb-motion.js");
  assert.ok(sw.stores.get("xyp3rn-music-shell-v3").has("/assets/active-orb-poster.jpg"));
  assert.ok(!sw.stores.get("xyp3rn-music-shell-v3").has("/assets/active-orb.mp4"), "Do not download video during shell installation");
  assert.equal(sw.request("/api/tracks").handled, false, "Never cache authenticated API responses");
  assert.equal(sw.request("/api/drive/test-file").handled, false, "Never cache private audio");
  const offline = await worker(t, false);
  assert.equal(await (await offline.request("/app.js").response).text(), "cached:/app.js");
  assert.equal(await (await offline.request("/?connection=failed", "navigate").response).text(), "cached:/");
});

test("video range requests bypass the shell cache", async (t) => {
  const sw = await worker(t, false);
  for (const path of ["/assets/idle-orb.mp4", "/assets/active-orb.mp4", "/assets/active-orb.webm"]) {
    const result = sw.request(path);
    assert.equal(result.handled, false, `${path} is owned by the browser media stack`);
    assert.equal(result.response, undefined);
  }
});
