const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  source = path.join(root, "prototype"),
  dest = path.join(root, "web-dist");
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(source))
  if (
    /\.(css|js)$/.test(name) &&
    !name.includes("test") &&
    !name.includes("measure-")
  )
    fs.copyFileSync(path.join(source, name), path.join(dest, name));
let html = fs.readFileSync(path.join(source, "index.html"), "utf8");
html = html
  .replace("<title>只言 · 界面原型</title>", "<title>只言</title>")
  .replace(
    '<link rel="stylesheet" href="platform.css">',
    '<link rel="stylesheet" href="platform.css">\n<link rel="stylesheet" href="app-embed.css">',
  );
fs.writeFileSync(path.join(dest, "index.html"), html);
console.log("Prepared shared UI in web-dist");
