// Prepares the shared UI for the Tauri shells in web-dist/.
// CSS: preview-only frame styles are left out, unused selectors are purged
// against the shipped templates, and the result is minified.
const fs = require("node:fs"),
  path = require("node:path");
const { PurgeCSS } = require("purgecss");
const CleanCSS = require("clean-css");
const root = path.resolve(__dirname, ".."),
  source = path.join(root, "prototype"),
  dest = path.join(root, "web-dist");
// Preview-only: prototype frame (control bar, stage, window/phone chrome).
const PREVIEW_ONLY = new Set(["preview.css"]);
// Class names that are built at runtime and never appear literally.
const SAFELIST = {
  standard: [/^proto-stage-(mac|ios)$/, "still", "sb-collapsed", "ok", "error", "bloom"],
  greedy: [/focus-visible/, /data-theme/],
};
const CSS_BUDGET = 55 * 1024;

async function main() {
  // Start clean so files removed from prototype/ never linger in the bundle.
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const names = fs
    .readdirSync(source)
    .filter(
      (name) =>
        /\.(css|js)$/.test(name) &&
        !name.includes("test") &&
        !name.includes("measure-") &&
        !name.startsWith(".") &&
        !PREVIEW_ONLY.has(name),
    );
  for (const name of names)
    if (name.endsWith(".js"))
      fs.copyFileSync(path.join(source, name), path.join(dest, name));

  let html = fs.readFileSync(path.join(source, "index.html"), "utf8");
  html = html
    .replace("<title>只言 · 界面原型</title>", "<title>只言</title>")
    .replace(/<link rel="stylesheet" href="preview\.css">\n?/, "")
    .replace(
      '<link rel="stylesheet" href="platform.css">',
      '<link rel="stylesheet" href="platform.css">\n<link rel="stylesheet" href="app-embed.css">',
    );
  fs.writeFileSync(path.join(dest, "index.html"), html);

  const cssNames = names.filter((n) => n.endsWith(".css"));
  const purged = await new PurgeCSS().purge({
    content: [
      ...names.filter((n) => n.endsWith(".js")).map((n) => path.join(dest, n)),
      { raw: html, extension: "html" },
    ],
    css: cssNames.map((n) => path.join(source, n)),
    safelist: SAFELIST,
    keyframes: true,
    variables: false,
  });
  const minifier = new CleanCSS({ level: 1, returnPromise: false });
  let total = 0;
  for (const result of purged) {
    const name = path.basename(result.file);
    const out = minifier.minify(result.css);
    if (out.errors.length) throw new Error(name + ": " + out.errors.join("; "));
    fs.writeFileSync(path.join(dest, name), out.styles);
    total += Buffer.byteLength(out.styles);
  }
  console.log(
    `Prepared shared UI in web-dist (CSS ${(total / 1024).toFixed(1)} KB)`,
  );
  if (total > CSS_BUDGET)
    throw new Error(`CSS ${total} bytes exceeds budget ${CSS_BUDGET}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
