#!/bin/bash
# Xcode build phase: copy the shared UI (built by tools/build-web.js, the same
# bundle Tauri ships) into the app's resources as Web/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
NODE="$(command -v node || true)"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -n "$NODE" ] || { [ -x "$candidate" ] && NODE="$candidate"; }
done
[ -n "$NODE" ] || { echo "error: node not found; install Node.js 22 and run npm ci" >&2; exit 1; }
[ -d node_modules ] || { echo "error: run 'npm ci' in $ROOT first" >&2; exit 1; }
"$NODE" tools/build-web.js
DEST="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/Web"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R web-dist/. "$DEST/"
# file:// has no response headers: carry the CSP in a <meta> (same policy as
# build/build.sh write_app_index; the shell refuses pages without it once #3 lands).
python3 - "$DEST/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
CSP = ("default-src 'self' file:; script-src 'self' file:; "
       "style-src 'self' file: 'unsafe-inline'; img-src 'self' file: data: blob:; "
       "media-src 'self' file: data: blob:; connect-src 'none'; "
       "object-src 'none'; base-uri 'none'; form-action 'none'")
if "Content-Security-Policy" not in s:
    i = s.index("<head>") + len("<head>")
    s = s[:i] + '\n<meta http-equiv="Content-Security-Policy" content="%s">' % CSP + s[i:]
open(p, "w", encoding="utf-8").write(s)
PY
grep -q 'app-embed.css' "$DEST/index.html" || { echo "error: index.html lacks app-embed.css" >&2; exit 1; }
echo "Staged web UI into $DEST"
