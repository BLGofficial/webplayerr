import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createHash, createCipheriv, randomBytes } from "node:crypto";

import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleApi } from "../lib/api.mjs";

const environmentKeys = [
  "NODE_ENV", "APP_BASE_URL", "APP_SESSION_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_AUDIO_TABLE"
];
const seed = JSON.parse(await readFile(new URL("../data/tracks.seed.json", import.meta.url), "utf8"));
const nativeFetch = globalThis.fetch;

function setup(t, overrides = {}) {
  const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-only-client-secret",
    ...overrides
  });
}

async function api(t) {
  const server = createServer(handleApi);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_BASE_URL ||= origin;
  return { origin, get: (path, headers) => fetch(origin + path, { headers, redirect: "manual" }) };
}

function cookie(response, name) {
  const value = response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`));
  assert.ok(value, `Expected ${name} cookie`);
  return value.split(";")[0];
}

async function connect(t, get) {
  const start = await get("/api/auth/google");
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location"));
  assert.equal(location.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.readonly");
  assert.match(start.headers.getSetCookie().join(";"), /HttpOnly; SameSite=Lax/);
  assert.match(start.headers.getSetCookie().join(";"), /Secure/);
  const stateCookie = cookie(start, "xyp3rn_oauth_state");
  const callback = await get(`/api/auth/callback?state=${location.searchParams.get("state")}&code=test-code`, { Cookie: stateCookie });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/?connected=1");
  return cookie(callback, "xyp3rn_drive_session");
}

function mockGoogle(t, media, tokenNetworkFailure = false) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.origin === process.env.APP_BASE_URL) return nativeFetch(input, options);
    calls.push({ url, options });
    if (url.hostname === "oauth2.googleapis.com") {
      if (tokenNetworkFailure) throw new Error("Simulated offline Google token endpoint");
      return Response.json({ access_token: `access-${calls.length}`, refresh_token: "test-refresh", expires_in: 3600 });
    }
    if (url.hostname === "www.googleapis.com") return media(url, options, calls.length);
    throw new Error(`Unexpected external request: ${url.origin}`);
  });
  return calls;
}

test("runtime config exposes flags, never credentials", async (t) => {
  setup(t, { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-secret" });
  const { get } = await api(t);
  const response = await get("/api/config");
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { googleConfigured: true, catalogConfigured: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(body, /server-only-secret|test-only-client-secret/);
});

test("production catalog and media require a session; malformed cookies fail safely", async (t) => {
  setup(t);
  const { get } = await api(t);
  assert.equal((await get("/api/tracks")).status, 401);
  assert.equal((await get(`/api/drive/${seed.tracks[0].drive_file_id}`)).status, 401);
  const status = await get("/api/auth/status", { Cookie: "xyp3rn_drive_session=%E0%A4%A" });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).connected, false);
});

test("OAuth rejects a missing or mismatched state without exchanging a token", async (t) => {
  setup(t);
  const { get } = await api(t);
  const calls = mockGoogle(t, () => new Response("unexpected"));
  const response = await get("/api/auth/callback?state=wrong&code=test", { Cookie: "xyp3rn_oauth_state=expected" });
  assert.equal(response.headers.get("location"), "/?connection=failed");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(calls.length, 0);
});

test("OAuth establishes an encrypted session and the local catalog is available only after login", async (t) => {
  setup(t);
  const { get } = await api(t);
  mockGoogle(t, () => new Response("unexpected"));
  const session = await connect(t, get);
  assert.doesNotMatch(session, /access-|test-refresh/);
  const status = await get("/api/auth/status", { Cookie: session });
  assert.equal((await status.json()).connected, true);
  const catalog = await get("/api/tracks", { Cookie: session });
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), { source: "seed", tracks: seed.tracks });
  const logout = await fetch(`${process.env.APP_BASE_URL}/api/auth/logout`, { method: "POST", headers: { Cookie: session } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test("Drive streaming forwards ranges and preserves partial-response metadata", async (t) => {
  setup(t);
  const { get } = await api(t);
  const bytes = Buffer.from("test-audio-range");
  const calls = mockGoogle(t, () => new Response(bytes, {
    status: 206,
    headers: { "Content-Type": "audio/wav", "Content-Range": `bytes 0-15/${bytes.length}`, "Accept-Ranges": "bytes" }
  }));
  const session = await connect(t, get);
  const response = await get(`/api/drive/${seed.tracks[0].drive_file_id}`, { Cookie: session, Range: "bytes=0-15" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("content-range"), `bytes 0-15/${bytes.length}`);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const media = calls.find(({ url }) => url.hostname === "www.googleapis.com");
  assert.equal(media.options.headers.Range, "bytes=0-15");
  assert.match(media.options.headers.Authorization, /^Bearer access-/);
});

test("a listener disconnect aborts the upstream Drive request", async (t) => {
  setup(t);
  const { origin, get } = await api(t);
  let mediaSignal;
  let cancel;
  const cancelled = new Promise((resolve) => { cancel = resolve; });
  mockGoogle(t, (_url, options) => {
    mediaSignal = options.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from("audio")); },
      cancel() { cancel(); }
    }), { headers: { "Content-Type": "audio/wav" } });
  });
  const session = await connect(t, get);
  const request = httpRequest(`${origin}/api/drive/${seed.tracks[0].drive_file_id}`, { headers: { Cookie: session } });
  request.end();
  const [response] = await once(request, "response");
  response.once("data", () => request.destroy());
  await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(new Error("Upstream was not cancelled")), 2000).unref())]);
  assert.equal(mediaSignal.aborted, true);
});

test("expired sessions handle refresh-network failures without an unhandled rejection", async (t) => {
  setup(t);
  const { get } = await api(t);
  const calls = mockGoogle(t, () => { throw new Error("Simulated offline Google endpoint"); }, true);
  const key = createHash("sha256").update(process.env.APP_SESSION_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify({ accessToken: "expired-access", refreshToken: "test-refresh", expiresAt: Date.now() - 1000 });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const session = `xyp3rn_drive_session=${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
  const response = await get(`/api/drive/${seed.tracks[0].drive_file_id}`, { Cookie: session });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /session expired/);
  assert.equal(calls.length, 1, "Only the token refresh should run; expired media requests must not reach Drive.");
  assert.equal(calls[0].url.hostname, "oauth2.googleapis.com");
});

test("unknown API routes return JSON 404", async (t) => {
  setup(t);
  const { get } = await api(t);
  const response = await get("/api/not-a-route");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found." });
});
