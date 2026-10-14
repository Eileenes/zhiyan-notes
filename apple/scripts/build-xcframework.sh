#!/bin/bash
# Builds core/ (Rust staticlib) into apple/build/ZhiYanCore.xcframework with
# slices for macOS (arm64+x86_64), iOS device (arm64) and iOS Simulator
# (arm64+x86_64). Requires Xcode command line tools and rustup.
#
#   apple/scripts/build-xcframework.sh            # release
#   PROFILE=debug apple/scripts/build-xcframework.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PROFILE="${PROFILE:-release}"
OUT="$ROOT/apple/build"
LIB=libzhiyan_core.a
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-26.0}"
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-26.0}"
# Xcode sets SDKROOT etc. for the app target; cargo must not inherit them.
unset SDKROOT PLATFORM_NAME

TARGETS=(aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios)
command -v rustup >/dev/null && rustup target add "${TARGETS[@]}" >/dev/null
flag=(); [ "$PROFILE" = release ] && flag=(--release)
for t in "${TARGETS[@]}"; do
  echo "▸ cargo build $t ($PROFILE)"
  cargo build --manifest-path core/Cargo.toml --lib --locked "${flag[@]}" --target "$t"
done

lib() { echo "core/target/$1/$PROFILE/$LIB"; }
mkdir -p "$OUT/macos" "$OUT/ios-sim"
lipo -create "$(lib aarch64-apple-darwin)" "$(lib x86_64-apple-darwin)" -output "$OUT/macos/$LIB"
lipo -create "$(lib aarch64-apple-ios-sim)" "$(lib x86_64-apple-ios)" -output "$OUT/ios-sim/$LIB"

FW="$OUT/ZhiYanCore.xcframework"
rm -rf "$FW"
xcodebuild -create-xcframework \
  -library "$OUT/macos/$LIB" -headers core/include \
  -library "$(lib aarch64-apple-ios)" -headers core/include \
  -library "$OUT/ios-sim/$LIB" -headers core/include \
  -output "$FW"
echo "✓ $FW"
