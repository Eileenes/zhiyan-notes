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
    assert.doesNotMatch(src, /<[a-z][^<>]*\son[a-z]+\s*=/i, name);
    assert.doesNotMatch(src, /javascript:/i, name);
  }
});

test("Apple shell index gets a CSP meta without inline scripts", () => {
  const { execFileSync } = require("node:child_process");
  const os = require("node:os");
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "csp-")), "index.html");
  const sh = fs.readFileSync(path.join(root, "build/build.sh"), "utf8");
  const py = sh.match(/<<'PY'\n([\s\S]*?)\nPY/)[1];
  execFileSync("python3", ["-", path.join(dir, "index.html"), out], { input: py });
  const html = fs.readFileSync(out, "utf8");
  const m = html.match(/<head>\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, "CSP meta must be the first element in <head>");
  const script = m[1].split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
  assert.doesNotMatch(script, /unsafe-|\*|file:|https?:|data:|blob:/);
  assert.doesNotMatch(m[1], /file:/, "no blanket file: sources");
  assert.match(m[1], /object-src 'none'/);
  assert.match(m[1], /base-uri 'none'/);
});

test("handler regex catches every on* attribute", () => {
  const re = /<[a-z][^<>]*\son[a-z]+\s*=/i;
  for (const a of ["onclick", "onmouseover", "onfocus", "onpointerdown", "onanimationend", "ONKEYUP"])
    assert.match(`<div ${a}="x()">`, re, a);
  assert.match('<img src=x onerror = "y">', re);
  assert.doesNotMatch('<div data-on="x" class="button">', re);
});
