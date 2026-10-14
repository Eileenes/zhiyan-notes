// Static guards for the Content Security Policy and HTML sinks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const root = path.resolve(dir, "..");

test("Tauri CSP forbids inline and eval scripts", () => {
  const conf = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const csp = conf.app.security.csp;
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
  assert.ok(script, "script-src must be explicit");
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval|\*/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
});

test("index.html has no inline scripts or handlers", () => {
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  for (const tag of html.match(/<script\b[^>]*>/g) || [])
    assert.match(tag, /\bsrc=/, "inline <script>: " + tag);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("UI templates contain no inline event handlers or javascript: URLs", () => {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".js") || name.includes("test") || name.startsWith(".")) continue;
    const src = fs.readFileSync(path.join(dir, name), "utf8");
    assert.doesNotMatch(src, /<[a-z][^<>]*\son(?:click|submit|error|load|input|change)=/i, name);
    assert.doesNotMatch(src, /javascript:/i, name);
  }
});
