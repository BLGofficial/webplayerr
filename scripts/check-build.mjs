import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const exists = async (file) => Boolean(await stat(path.join(root, file)).catch(() => null));
const required = [
  "api/config.js", "api/tracks.js", "api/auth/callback.js", "api/auth/google.js",
  "api/auth/logout.js", "api/auth/status.js", "api/drive/[id].js",
  "lib/api.mjs", "server/index.mjs", "data/tracks.seed.json",
  "public/index.html", "public/app.js", "public/app.css", "public/sw.js",
  "public/manifest.webmanifest"
];
for (const file of required) assert.ok(await exists(file), `Missing required project file: ${file}`);

const config = JSON.parse(await read("vercel.json"));
const pkg = JSON.parse(await read("package.json"));
assert.equal(config.framework, null, "This is a static frontend with Node API routes, not a framework app.");
assert.equal(config.outputDirectory, "public");
assert.equal(config.buildCommand, "npm run build");
assert.ok(pkg.scripts.build, "The configured Vercel build command must exist.");
assert.ok(config.functions["api/**/*.js"], "Keep the API function configuration.");

const apiFiles = (await readdir(path.join(root, "api"), { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
assert.equal(apiFiles.length, 7, "Expected seven Vercel API entry points.");
for (const file of apiFiles) {
  assert.match(file, /^api\/(?:[^/]+\/)*[^/]+\.js$/, "The functions glob must match every API entry point.");
  const entry = await import(pathToFileURL(path.join(root, file)));
  assert.equal(typeof entry.default, "function", `${file} must export a Vercel handler.`);
}

const html = await read("public/index.html");
const css = await read("public/app.css");
const manifest = JSON.parse(await read("public/manifest.webmanifest"));
const worker = await read("public/sw.js");
const references = new Set(manifest.icons.map((icon) => icon.src));
for (const match of html.matchAll(/\b(?:src|href|poster)="(\/[^"#]*)"/g)) references.add(match[1]);
for (const match of css.matchAll(/url\(["']?(\/[^"')]+)["']?\)/g)) references.add(match[1]);
const shellList = worker.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
assert.ok(shellList, "The service worker must declare its app shell.");
for (const match of shellList.matchAll(/"(\/[^"]*)"/g)) references.add(match[1]);
for (const reference of references) {
  if (reference.startsWith("/api/")) continue;
  const file = `public${reference === "/" ? "/index.html" : reference}`;
  assert.ok(await exists(file), `Broken public asset reference: ${reference}`);
}

const publicFiles = await readdir(path.join(root, "public"), { recursive: true });
for (const file of publicFiles) {
  assert.ok(!path.basename(file).startsWith(".env"), `Environment file must not be public: ${file}`);
  assert.notEqual(path.basename(file), "tracks.seed.json", "The fallback catalog belongs in data/, not public/.");
}
const seed = JSON.parse(await read("data/tracks.seed.json"));
assert.ok(Array.isArray(seed.tracks) && seed.tracks.length > 0, "The bundled fallback catalog must contain tracks.");
console.log(`Build checks passed: ${apiFiles.length} API handlers, ${references.size} public references, static output in public/.`);
