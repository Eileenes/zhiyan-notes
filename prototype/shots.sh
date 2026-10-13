#!/bin/bash
# 只言原型 · 批量截图
# 用法: ./shots.sh [round]   例: ./shots.sh r1
set -u
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/shots/${1:-r1}"
mkdir -p "$OUT"

shot() { # shot <name> <query> <hash> [size]
  local name="$1" query="$2" hash="$3" size="${4:-1400,1000}"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$size" \
    --screenshot="$OUT/$name.png" \
    "file://$DIR/index.html?$query#$hash" >/dev/null 2>&1
}

for T in dark light; do
  shot "mac-capture-$T"      "theme=$T&still=1"              "capture"
  shot "mac-timeline-$T"     "theme=$T&still=1"              "timeline"
  shot "mac-detail-$T"       "theme=$T&still=1"              "detail/m6"
  shot "mac-settings-$T"     "theme=$T&still=1"              "settings"
  shot "mac-privacy-$T"      "theme=$T&still=1"              "privacy"
  shot "mac-search-$T"       "theme=$T&still=1"              "search/咖啡"
  shot "mac-search-empty-$T" "theme=$T&still=1"              "search/季度复盘"
  shot "mac-rec-$T"          "theme=$T&still=1&rec=1"        "capture"
  shot "mac-quota-$T"        "theme=$T&still=1&quota=used"   "settings"
  shot "ios-capture-$T"      "theme=$T&still=1&plat=ios"     "capture"      "720,1010"
  shot "ios-timeline-$T"     "theme=$T&still=1&plat=ios"     "timeline"     "720,1010"
  shot "ios-detail-$T"       "theme=$T&still=1&plat=ios"     "detail/m1"    "720,1010"
  shot "ios-settings-$T"     "theme=$T&still=1&plat=ios"     "settings"     "720,1010"
  shot "ios-rec-$T"          "theme=$T&still=1&plat=ios&rec=1" "capture"    "720,1010"
  shot "ios-search-$T"       "theme=$T&still=1&plat=ios"     "search/咖啡"  "720,1010"
done

echo "→ $OUT"
ls -1 "$OUT" | wc -l