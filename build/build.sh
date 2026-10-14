#!/bin/bash
# ============================================================================
# 只言 · 打包脚本
# ----------------------------------------------------------------------------
# 为什么要脚本化：之前每次改前端都要手工敲 swiftc → 组包 → 拷 Web 资源 → 签名，
# 中间漏拷过一次，编译全绿但跑的是旧二进制。手工流程步骤一多就一定会漏。
#
# 关键约束（每条都对应一次真实踩坑）：
#   · Web 资源拷完必须校验哈希，不相等直接失败 —— 漏拷不会有任何报错，
#     只会让你截图拍到旧界面还以为改对了
#   · 二进制进了包之后要比对 LC_UUID：签名会改 sha256 但不改 UUID，
#     只有 UUID 相同才能证明「包里那个就是刚编出来的那个」
#   · iOS 模拟器包**绝对不能**加 --options runtime，加了 codesign 校验全绿，
#     但 simctl launch 立刻崩在 dyld（DYLD_ROOT_PATH not set）
#   · macOS 可以加 --options runtime
#
# 用法：
#   ./build/build.sh              双端全打
#   ./build/build.sh mac          只打 mac
#   ./build/build.sh ios          只打 iOS 模拟器
#   ./build/build.sh test         跑数据层测试
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="只言"
MAC_BUNDLE_ID="com.duketao.zhiyan"
IOS_BUNDLE_ID="com.duketao.zhiyan.sim"
IOS_BIN="ZhiYan-sim"

TMP="$ROOT/build/tmp"
DIST="$ROOT/dist"
ICON_ICNS="$ROOT/icon/MemoryNotes.icns"
ICON_PNG="$ROOT/icon/icon-1024.png"

WEB_FILES=(tokens.css base.css platform.css app-embed.css data.js db.js icons.js garden.js views.js app.js garden.css services.js service-views.js service.css runtime.js gateway.js theme-init.js privacy.js)

say()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

TARGET="${1:-all}"

# ---------------------------------------------------------------------------
# 前置检查
# ---------------------------------------------------------------------------
preflight() {
  say "检查工具链"
  command -v swiftc >/dev/null || die "找不到 swiftc"
  [ -f "$ICON_ICNS" ] || die "缺少 $ICON_ICNS"
  [ -f "$ICON_PNG" ]  || die "缺少 $ICON_PNG"
  for f in "${WEB_FILES[@]}"; do
    [ -f "prototype/$f" ] || die "缺少 prototype/$f"
  done
  [ -f prototype/index.html ] || die "缺少 prototype/index.html"
  ok "工具链与资源齐备（Web 资源 ${#WEB_FILES[@]} 个）"
}

# ---------------------------------------------------------------------------
# App 专用 index.html
# 说明：prototype/index.html 是**预览版**，控制条、模拟标题栏都在里面，
#       那是给人调版式用的。直接拷进 App 会让「原型演示，非最终设计」
#       那条控制条出现在真窗口顶部 —— 之前就是这么翻车的。
#       这里生成一个副本，只多引一个 app-embed.css（它负责把演示外壳摘掉）。
#       app-embed.css 必须排在 platform.css 之后。
# ---------------------------------------------------------------------------
write_app_index() {
  local dest="$1"
  python3 - "$ROOT/prototype/index.html" "$dest" "$ROOT/build/apple-csp.txt" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
tag = '<link rel="stylesheet" href="app-embed.css">\n'
if 'app-embed.css' in s:
    sys.stderr.write('WARN: index.html 已含 app-embed.css，未重复注入\n')
else:
    anchor = '<link rel="stylesheet" href="platform.css">\n'
    if anchor not in s:
        sys.stderr.write('ERROR: index.html 里找不到 platform.css 锚点\n')
        sys.exit(1)
    s = s.replace(anchor, anchor + tag)
# preview.css 只给浏览器原型用（控制条 / 窗口外框 / 手机机身），App 不加载
s = s.replace('<link rel="stylesheet" href="preview.css">\n', '')
# Apple shells load index.html from file://, so there is no response header to
# carry a CSP: put it in a <meta>. The native bridge is a WKScriptMessageHandler
# (not fetch), so connect-src stays closed. frame-ancestors is ignored in <meta>.
# Single source of truth: build/apple-csp.txt (also used by apple/scripts/stage-web.sh).
CSP = open(sys.argv[3], encoding='utf-8').read().strip()
meta = '<meta http-equiv="Content-Security-Policy" content="%s">\n' % CSP
if 'Content-Security-Policy' not in s:
    head = s.index('<head>') + len('<head>\n')
    s = s[:head] + meta + s[head:]
open(dst, 'w', encoding='utf-8').write(s)
PY
  [ $? -eq 0 ] || die "生成 App 版 index.html 失败"
  grep -q 'app-embed.css' "$dest" || die "App 版 index.html 没有引用 app-embed.css"
  # title 也换掉：窗口标题栏和浏览器标签页里写着「界面原型」是误导
  sed -i '' 's|<title>只言 · 界面原型</title>|<title>只言</title>|' "$dest"
  ok "已生成 App 版 index.html（剥离演示外壳）"
}

# ---------------------------------------------------------------------------
# 编译
# 说明：shell.swift 里有顶层代码（NSApplication.run / UIApplicationMain），
#       Swift 只允许名为 main.swift 的文件带顶层代码，所以编译时复制一份改名。
#       Data.swift 和它一起编译成同一个 module —— 分开编译成 .o 再链接会
#       出现「找不到 DataStore 类型」。
# ---------------------------------------------------------------------------
compile() {
  local plat="$1" out="$2"
  mkdir -p "$TMP"
  cp "$ROOT/build/shell.swift" "$TMP/main.swift"
  cp "$ROOT/build/Data.swift"  "$TMP/Data.swift"

  if [ "$plat" = "ios" ]; then
    say "编译 iOS 模拟器目标 (arm64)"
    IPHONEOS_DEPLOYMENT_TARGET=26.0 cargo build --manifest-path "$ROOT/core/Cargo.toml" --release --lib --target aarch64-apple-ios-sim
    xcrun -sdk iphonesimulator swiftc \
      -target arm64-apple-ios26.0-simulator \
      -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements -Xlinker "$ROOT/build/simulator.entitlements" \
      -O "$TMP/Data.swift" "$ROOT/build/Audio.swift" "$ROOT/build/Services.swift" "$ROOT/build/NativeBridge.swift" "$ROOT/build/WebPolicy.swift" "$ROOT/build/Diagnostics.swift" "$TMP/main.swift" "$ROOT/core/target/aarch64-apple-ios-sim/release/libzhiyan_core.a" -framework Security -framework SystemConfiguration -lc++ -o "$out"
  else
    say "编译 macOS 目标"
    cargo build --manifest-path "$ROOT/core/Cargo.toml" --release --lib
    swiftc -O "$TMP/Data.swift" "$ROOT/build/Audio.swift" "$ROOT/build/Services.swift" "$ROOT/build/NativeBridge.swift" "$ROOT/build/WebPolicy.swift" "$ROOT/build/Diagnostics.swift" "$TMP/main.swift" "$ROOT/core/target/release/libzhiyan_core.a" -framework Security -framework SystemConfiguration -lc++ -o "$out"
  fi
  [ -f "$out" ] || die "编译没有产出二进制：$out"
  ok "$(basename "$out") $(wc -c < "$out" | tr -d ' ') bytes"
}

# ---------------------------------------------------------------------------
# Web 资源：拷完校验，不一致就炸
# ---------------------------------------------------------------------------
copy_web() {
  local dest="$1" css_src="prototype"
  mkdir -p "$dest"
  # CSS 走 build-web（PurgeCSS + 压缩，≤55KB 预算）；没有 node 依赖时退回源文件
  if command -v node >/dev/null && [ -d node_modules/purgecss ]; then
    node tools/build-web.js >/dev/null || die "build-web 失败（CSS 预算或压缩出错）"
    css_src="web-dist"
  else
    say "未安装 node 依赖（npm ci），App 内 CSS 使用未压缩源文件"
  fi
  for f in "${WEB_FILES[@]}"; do
    local src="prototype/$f"
    [[ "$f" == *.css ]] && src="$css_src/$f"
    cp "$src" "$dest/$f"
    local a b
    a=$(shasum -a 256 "$src" | cut -d' ' -f1)
    b=$(shasum -a 256 "$dest/$f"   | cut -d' ' -f1)
    [ "$a" = "$b" ] || die "Web 资源拷坏了：$f（$a != $b）"
  done
  ok "Web 资源已拷贝并逐个校验（${#WEB_FILES[@]}/${#WEB_FILES[@]}）"
}

write_mac_plist() {
  cat > "$1" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
	<key>CFBundleExecutable</key><string>只言</string>
	<key>CFBundleIdentifier</key><string>com.duketao.zhiyan</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>CFBundleName</key><string>只言</string>
	<key>CFBundleDisplayName</key><string>只言</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.7</string>
	<key>CFBundleVersion</key><string>7</string>
	<key>CFBundleIconFile</key><string>MemoryNotes</string>
	<key>LSMinimumSystemVersion</key><string>26.0</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSPrincipalClass</key><string>NSApplication</string>
	<key>NSSupportsSuddenTermination</key><false/>
	<key>NSSupportsAutomaticTermination</key><false/>
	<key>NSMicrophoneUsageDescription</key>
	<string>只言在你按下麦克风时录制你的语音并存到本机。开启同步后会上传到你选择的同步服务；发起转写时发送到你配置的模型服务。</string>
</dict>
</plist>
PLIST
}

write_ios_plist() {
  cat > "$1" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
	<key>CFBundleExecutable</key><string>ZhiYan-sim</string>
	<key>CFBundleIdentifier</key><string>com.duketao.zhiyan.sim</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>CFBundleName</key><string>ZhiYan-sim</string>
	<key>CFBundleDisplayName</key><string>只言</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.7</string>
	<key>CFBundleVersion</key><string>7</string>
	<key>CFBundleIcons</key>
	<dict>
		<key>CFBundlePrimaryIcon</key>
		<dict>
			<key>CFBundleIconFiles</key><array><string>icon-1024</string></array>
			<key>UIPrerenderedIcon</key><false/>
		</dict>
	</dict>
	<key>UILaunchScreen</key><dict/>
	<key>UIRequiredDeviceCapabilities</key><array><string>arm64</string></array>
	<key>UISupportedInterfaceOrientations</key>
	<array><string>UIInterfaceOrientationPortrait</string></array>
	<key>UIUserInterfaceStyle</key><string>Automatic</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>只言在你按下麦克风时录制你的语音并存到本机。开启同步后会上传到你选择的同步服务；发起转写时发送到你配置的模型服务。</string>
</dict>
</plist>
PLIST
}

# ---------------------------------------------------------------------------
# macOS 包
# ---------------------------------------------------------------------------
build_mac() {
  local APP="$TMP/$APP_NAME.app"
  rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Web"

  compile mac "$APP/Contents/MacOS/$APP_NAME"
  write_mac_plist "$APP/Contents/Info.plist"
  printf 'APPL????' > "$APP/Contents/PkgInfo"
  cp "$ICON_ICNS" "$APP/Contents/Resources/MemoryNotes.icns"
  write_app_index "$APP/Contents/Resources/Web/index.html"
  copy_web "$APP/Contents/Resources/Web"

  ok "包内二进制 UUID=$(dwarfdump --uuid "$APP/Contents/MacOS/$APP_NAME" | awk '{print $2}')"

  # 先内后外；macOS 可以带 --options runtime
  # ⚠️ 不要加 --deep：会写出损坏的 CodeResources，
  #    codesign --verify --strict 报「code has no resources but signature indicates」
  codesign --force --options runtime --sign - "$APP/Contents/MacOS/$APP_NAME" 2>/dev/null
  codesign --force --options runtime --sign - "$APP" 2>/dev/null
  codesign --verify --strict "$APP" || die "macOS 签名校验失败"
  ok "macOS 签名通过（ad-hoc + hardened runtime）"

  mkdir -p "$DIST"
  rm -rf "$DIST/$APP_NAME.app"
  cp -R "$APP" "$DIST/"
  ok "已放入 dist/$APP_NAME.app"
}

# ---------------------------------------------------------------------------
# iOS 模拟器包
# ---------------------------------------------------------------------------
build_ios() {
  local APP="$TMP/ZhiYan-sim.app"
  rm -rf "$APP"; mkdir -p "$APP/Web"

  compile ios "$APP/$IOS_BIN"
  write_ios_plist "$APP/Info.plist"
  cp "$ICON_PNG" "$APP/icon-1024.png"
  write_app_index "$APP/Web/index.html"
  copy_web "$APP/Web"

  codesign --force --sign - "$APP" 2>/dev/null
  codesign --verify --strict "$APP" || die "iOS 签名校验失败"
  # 平台标记必须是 IOSSIMULATOR：编成真机 arm64 的包装不进模拟器，
  # 而且这个错误在安装时才会报，编译期完全看不出来
  vtool -show-build-version "$APP/$IOS_BIN" | grep -q IOSSIMULATOR \
    || die "二进制不是模拟器目标（缺 IOSSIMULATOR 标记）"
  ok "iOS 模拟器包签名通过 · 平台标记 IOSSIMULATOR 正确 · 未加 --options runtime"

  mkdir -p "$DIST"
  rm -rf "$DIST/ZhiYan-sim.app"
  cp -R "$APP" "$DIST/"
  ok "已放入 dist/ZhiYan-sim.app"
}

# ---------------------------------------------------------------------------
# DMG
# ---------------------------------------------------------------------------
build_dmg() {
  local DMG="$DIST/$APP_NAME.dmg"
  say "打包 DMG"
  rm -f "$DMG"
  hdiutil create -volname "$APP_NAME" -srcfolder "$DIST/$APP_NAME.app" \
    -ov -format UDZO "$DMG" >/dev/null
  hdiutil verify "$DMG" >/dev/null || die "DMG 校验失败"
  ok "$APP_NAME.dmg  $(du -h "$DMG" | cut -f1)"
}

# ---------------------------------------------------------------------------
# 测试
# ---------------------------------------------------------------------------
run_tests() {
  say "跑数据层测试"
  mkdir -p "$TMP"
  cp "$ROOT/build/shell.swift" "$TMP/main.swift"
  swiftc -O "$ROOT/build/Data.swift" "$ROOT/build/tests/TestData.swift" -o "$TMP/testdata" || die "测试编译失败"
  "$TMP/testdata"
  say "跑 WebPolicy 测试（CSP 解析 + 导航策略）"
  mkdir -p "$TMP/twp" && cp "$ROOT/build/tests/TestWebPolicy.swift" "$TMP/twp/main.swift"
  swiftc -O "$ROOT/build/WebPolicy.swift" "$TMP/twp/main.swift" -o "$TMP/testwebpolicy" || die "WebPolicy 测试编译失败"
  "$TMP/testwebpolicy"
}

# ---------------------------------------------------------------------------
preflight

case "$TARGET" in
  test) run_tests ;;
  mac)  build_mac ;;
  ios)  build_ios ;;
  all)  run_tests; build_mac; build_ios; build_dmg ;;
  *)    die "未知目标：$TARGET（可用：all / mac / ios / test）" ;;
esac

echo
ok "完成"
