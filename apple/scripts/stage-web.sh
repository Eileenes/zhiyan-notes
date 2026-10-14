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
# file:// has no response headers: carry the CSP in a <meta>. The policy is
# read from build/apple-csp.txt, the same file build/build.sh uses, so both
# Apple build paths ship an identical CSP that shell.swift's WebPolicy accepts.
python3 - "$DEST/index.html" "$ROOT/build/apple-csp.txt" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
CSP = open(sys.argv[2], encoding="utf-8").read().strip()
if "Content-Security-Policy" not in s:
    i = s.index("<head>") + len("<head>\n")
    s = s[:i] + '<meta http-equiv="Content-Security-Policy" content="%s">\n' % CSP + s[i:]
open(p, "w", encoding="utf-8").write(s)
PY
grep -q 'app-embed.css' "$DEST/index.html" || { echo "error: index.html lacks app-embed.css" >&2; exit 1; }
echo "Staged web UI into $DEST"
