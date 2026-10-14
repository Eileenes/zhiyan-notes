#!/bin/bash
# Before/after screenshots for CSS changes, rendered with the SAME interaction
# script (prototype/garden-test.js of the working tree) against:
#   proto: prototype/index.html (source CSS, preview frame)       base vs HEAD
#   app:   the bundle the shells ship (index + app-embed, no frame)
#          base: raw prototype CSS  vs  HEAD: web-dist (PurgeCSS + minified)
# Usage: tools/visual-regression.sh [BASE_REF] [OUT_DIR]
# Needs Node 22 (or 20 with --experimental-websocket), Chrome (CHROME_PATH),
# npm ci, python3 + Pillow. Writes OUT_DIR/{before,after,diff}/<variant>/*.png
# and OUT_DIR/report.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-origin/main}"
OUT="$(mkdir -p "${2:-$ROOT/verify/visual-regression}" && cd "${2:-$ROOT/verify/visual-regression}" && pwd)"
TMP="$(mktemp -d)"
trap 'git -C "$ROOT" worktree remove --force "$TMP/base" >/dev/null 2>&1 || true' EXIT
NODE_FLAGS=()
node -e 'process.exit(typeof WebSocket==="function"?0:1)' || NODE_FLAGS=(--experimental-websocket)

git -C "$ROOT" worktree add --detach "$TMP/base" "$BASE" >/dev/null
# App bundle for the base revision: same HTML transform as build-web, raw CSS.
mkdir -p "$TMP/base-app"
cp "$TMP/base/prototype/"*.js "$TMP/base/prototype/"*.css "$TMP/base-app/"
python3 - "$TMP/base/prototype/index.html" "$TMP/base-app/index.html" <<'PY'
import sys
s = open(sys.argv[1], encoding="utf-8").read()
s = s.replace('<link rel="stylesheet" href="preview.css">\n', '')
s = s.replace('<link rel="stylesheet" href="platform.css">',
              '<link rel="stylesheet" href="platform.css">\n<link rel="stylesheet" href="app-embed.css">', 1)
open(sys.argv[2], "w", encoding="utf-8").write(s)
PY
(cd "$ROOT" && node tools/build-web.js)

rm -rf "$OUT/before" "$OUT/after" "$OUT/diff"
run() { # variant side index
  GARDEN_INDEX="$3" GARDEN_OUT="$OUT/$2/$1" node "${NODE_FLAGS[@]}" "$ROOT/prototype/garden-test.js" > "$OUT/$2-$1.json" \
    || echo "WARN: checks failed for $2/$1 (screenshots still compared)" >&2
}
run proto before "$TMP/base/prototype/index.html"
run proto after  "$ROOT/prototype/index.html"
run app   before "$TMP/base-app/index.html"
run app   after  "$ROOT/web-dist/index.html"

python3 - "$OUT" "$BASE" "$(git -C "$ROOT" rev-parse --short HEAD)" "$(git -C "$ROOT" rev-parse --short "$BASE")" <<'PY'
import sys, pathlib
from PIL import Image, ImageChops
out, base, head, base_sha = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
rows, worst = [], 0.0
for variant in ("proto", "app"):
    for b in sorted((out / "before" / variant).glob("*.png")):
        a = out / "after" / variant / b.name
        if not a.exists():
            rows.append((variant, b.stem, "missing after", "")); continue
        x, y = Image.open(b).convert("RGB"), Image.open(a).convert("RGB")
        if x.size != y.size:
            rows.append((variant, b.stem, f"size {x.size} → {y.size}", "")); worst = 100; continue
        d = ImageChops.difference(x, y)
        mask = d.convert("L").point(lambda v: 255 if v > 24 else 0)
        changed = sum(1 for v in (mask.get_flattened_data() if hasattr(mask, "get_flattened_data") else mask.getdata()) if v) / (x.size[0] * x.size[1]) * 100
        worst = max(worst, changed)
        link = ""
        if changed:
            (out / "diff" / variant).mkdir(parents=True, exist_ok=True)
            Image.composite(Image.new("RGB", x.size, (255, 0, 80)), x.convert("RGB").point(lambda v: v // 3 + 170), mask).save(out / "diff" / variant / b.name)
            link = f"[diff](diff/{variant}/{b.name})"
        rows.append((variant, b.stem, f"{changed:.3f}%", link))
lines = [f"# Visual regression: `{base}` ({base_sha}) → HEAD ({head})", "",
         "Same interaction script (prototype/garden-test.js) for both sides. Pixels counted as changed when any channel differs by > 24/255.", "",
         "| variant | screen | changed pixels | before | after | diff |", "|---|---|---|---|---|---|"]
for v, n, c, l in rows:
    lines.append(f"| {v} | {n} | {c} | ![](before/{v}/{n}.png) | ![](after/{v}/{n}.png) | {l} |")
lines += ["", f"Max changed: **{worst:.3f}%** across {len(rows)} screenshots."]
(out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines[-1:]))
PY
echo "Report: $OUT/report.md"
