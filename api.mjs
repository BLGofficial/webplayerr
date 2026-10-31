import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Readable } from "node:stream";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = path.join(projectRoot, "data", "tracks.seed.json");
const cookieName = "xyp3rn_drive_session";
const stateCookieName = "xyp3rn_oauth_state";
const driveScope = "https://www.googleapis.com/auth/drive.readonly";
let cachedTracks = null;
let cachedTracksUntil = 0;

export function loadEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(projectRoot, fileName);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function originFrom(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${protocol}://${host}`;
}

function redirectURI(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${originFrom(req)}/api/auth/callback`;
}

function secureCookie(req) {
  return originFrom(req).startsWith("https://") || process.env.NODE_ENV === "production";
}

function cookieHeader(req, name) {
  const raw = req.headers.cookie || "";
  const match = raw.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function makeCookie(req, name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie(req) ? "; Secure" : ""}`;
}

function clearCookie(req, name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie(req) ? "; Secure" : ""}`;
}

function sessionKey() {
  const secret = process.env.APP_SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("APP_SESSION_SECRET must contain at least 32 characters.");
  return createHash("sha256").update(secret, "utf8").digest();
}

function sealSession(session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function openSession(value) {
  if (!value) return null;
  try {
    const data = Buffer.from(value, "base64url");
    if (data.length < 29) return null;
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
  } catch { return null; }
}

function readSession(req) {
  return openSession(cookieHeader(req, cookieName));
}

function setSessionCookie(req, res, session) {
  try {
    const value = sealSession(session);
    res.setHeader("Set-Cookie", makeCookie(req, cookieName, value, 60 * 60 * 24 * 30));
  } catch { /* A missing encryption secret leaves playback disconnected. */ }
}

function getSeedTracks() {
  try {
    const payload = JSON.parse(readFileSync(seedPath, "utf8"));
    return Array.isArray(payload.tracks) ? payload.tracks : [];
  } catch { return []; }
}

async function fetchSupabaseTracks() {
  const base = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const table = (process.env.SUPABASE_AUDIO_TABLE || "audio_assets").replace(/[^a-zA-Z0-9_]/g, "");
  if (!base || !key || !table) return null;
  if (cachedTracks && cachedTracksUntil > Date.now()) return cachedTracks;
  const url = new URL(`${base}/rest/v1/${table}`);
  url.searchParams.set("select", "drive_file_id,drive_folder_id,drive_view_url,source_filename,track_title,artist,album,mime_type,file_size_bytes,duration_seconds,codec,sample_rate_hz,channels,bit_depth,bit_rate_bps,drive_created_at");
  url.searchParams.set("order", "track_title.asc");
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Supabase catalog returned ${response.status}.`);
  const rows = await response.json();
  cachedTracks = Array.isArray(rows) ? rows : [];
  cachedTracksUntil = Date.now() + 20_000;
  return cachedTracks;
}

async function listTracks(req, res) {
  if (process.env.NODE_ENV === "production" && !readSession(req)?.accessToken) {
    return json(res, 401, { error: "Connect Google Drive to view the private library." });
  }
  try {
    const tracks = await fetchSupabaseTracks();
    if (tracks) return json(res, 200, { source: "supabase", tracks });
  } catch {
    return json(res, 503, { error: "Supabase catalog is unavailable." });
  }
  return json(res, 200, { source: "seed", tracks: getSeedTracks() });
}

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.APP_SESSION_SECRET || "").length >= 32);
}

function sendRuntimeConfig(req, res) {
  json(res, 200, {
    googleConfigured: googleConfigured(),
    catalogConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}

function startGoogleOAuth(req, res) {
  if (!googleConfigured()) return json(res, 503, { error: "Google OAuth is not configured." });
  const state = randomBytes(28).toString("base64url");
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  authorization.searchParams.set("redirect_uri", redirectURI(req));
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", driveScope);
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("state", state);
  res.writeHead(302, { Location: authorization.toString(), "Cache-Control": "no-store", "Set-Cookie": makeCookie(req, stateCookieName, state, 600) });
  res.end();
}

async function exchangeGoogleCode(req, code) {
  const form = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: redirectURI(req),
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error("Google OAuth token exchange failed.");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 90) * 1000,
  };
}

async function finishGoogleOAuth(req, res, url) {
  const queryState = url.searchParams.get("state") || "";
  const cookieState = cookieHeader(req, stateCookieName);
  const clearState = clearCookie(req, stateCookieName);
  if (!queryState || !cookieState || queryState !== cookieState || !url.searchParams.get("code")) {
    res.writeHead(302, { Location: "/?connection=failed", "Set-Cookie": clearState, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  try {
    if (!googleConfigured()) throw new Error("Google OAuth is not configured.");
    const session = await exchangeGoogleCode(req, url.searchParams.get("code"));
    const sessionCookie = makeCookie(req, cookieName, sealSession(session), 60 * 60 * 24 * 30);
    res.writeHead(302, { Location: "/?connected=1", "Set-Cookie": [clearState, sessionCookie], "Cache-Control": "no-store" });
    res.end();
  } catch {
    res.writeHead(302, { Location: "/?connection=failed", "Set-Cookie": clearState, "Cache-Control": "no-store" });
    res.end();
  }
}

async function refreshSession(session) {
  if (!session?.refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const form = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: session.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) return null;
  return {
    accessToken: payload.access_token,
    refreshToken: session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 90) * 1000,
  };
}

async function authStatus(req, res) {
  const session = readSession(req);
  json(res, 200, { connected: Boolean(session?.accessToken), googleConfigured: googleConfigured() });
}

function logout(req, res) {
  res.writeHead(204, { "Set-Cookie": clearCookie(req, cookieName), "Cache-Control": "no-store" });
  res.end();
}

async function findTrackByDriveId(id) {
  if (!id || !/^[a-zA-Z0-9_-]{10,150}$/.test(id)) return null;
  try {
    const tracks = await fetchSupabaseTracks();
    if (tracks) return tracks.find((track) => track.drive_file_id === id) || null;
  } catch { return null; }
  return getSeedTracks().find((track) => track.drive_file_id === id) || null;
}

async function requestDriveMedia(id, token, range) {
  const headers = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
    headers,
    signal: AbortSignal.timeout(45000),
  });
}

async function streamDriveFile(req, res, id) {
  const track = await findTrackByDriveId(id);
  if (!track) return json(res, 404, { error: "Track is not in the XYP3RN catalog." });
  let session = readSession(req);
  if (!session?.accessToken) return json(res, 401, { error: "Connect Google Drive before streaming private tracks." });

  if (session.expiresAt && session.expiresAt < Date.now() + 15000) {
    const renewed = await refreshSession(session);
    if (renewed) { session = renewed; setSessionCookie(req, res, session); }
    else if (session.expiresAt < Date.now()) return json(res, 401, { error: "Google Drive session expired. Reconnect Drive." });
  }

  let upstream;
  try { upstream = await requestDriveMedia(id, session.accessToken, req.headers.range); }
  catch { return json(res, 502, { error: "Google Drive could not be reached." }); }

  if (upstream.status === 401 && session.refreshToken) {
    const renewed = await refreshSession(session);
    if (renewed) {
      session = renewed;
      setSessionCookie(req, res, session);
      try { upstream = await requestDriveMedia(id, session.accessToken, req.headers.range); }
      catch { return json(res, 502, { error: "Google Drive could not be reached." }); }
    }
  }
  if (!upstream.ok && upstream.status !== 206) {
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    const status = upstream.status === 401 ? 401 : upstream.status === 403 ? 403 : upstream.status === 404 ? 404 : 502;
    return json(res, status, { error: status === 403 ? "Google denied access to this Drive file." : status === 401 ? "Reconnect Google Drive to continue playback." : "Drive media request failed." });
  }

  const headers = {
    "Content-Type": track.mime_type || upstream.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
}

export async function handleApi(req, res) {
  const url = new URL(req.url || "/", originFrom(req));
  if (req.method === "GET" && url.pathname === "/api/tracks") return listTracks(req, res);
  if (req.method === "GET" && url.pathname === "/api/config") return sendRuntimeConfig(req, res);
  if (req.method === "GET" && url.pathname === "/api/auth/status") return authStatus(req, res);
  if (req.method === "GET" && url.pathname === "/api/auth/google") return startGoogleOAuth(req, res);
  if (req.method === "GET" && url.pathname === "/api/auth/callback") return finishGoogleOAuth(req, res, url);
  if (req.method === "POST" && url.pathname === "/api/auth/logout") return logout(req, res);
  const driveMatch = url.pathname.match(/^\/api\/drive\/([^/]+)$/);
  if (req.method === "GET" && driveMatch) return streamDriveFile(req, res, decodeURIComponent(driveMatch[1]));
  return json(res, 404, { error: "Not found." });
}

