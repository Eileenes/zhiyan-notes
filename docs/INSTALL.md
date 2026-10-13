# ZhiYan — Install & Verification Guide

**English** · [简体中文](INSTALL.zh-CN.md)

[← Back to README](README.md)

> v0.5 · 2026-10-13

---

## 1. What changed in this version

The previous build was a **UI prototype in a shell**: recording was an
animation, search was a string match over hardcoded fixtures, and a refresh
reset everything.

This version replaces all of that with working code:

| | Previous build (10-12) | This version (10-13) |
|---|---|---|
| Text notes | In memory, gone after refresh | **Written to SQLite, survives relaunch** |
| Search | String match over hardcoded data | **Real FTS5, two tables — 1- and 2-character Chinese queries work** |
| Export | An `alert()` with a sentence in it | **Real files** (Markdown / JSON); on macOS Finder reveals them |
| Recording | A playback animation | **Actual recording** to local `.m4a`, never uploaded |
| Data | 12 demo records | **Empty on first launch**; sample data is opt-in from Settings |

---

## 2. Install on macOS

1. Double-click `只言.dmg`
2. Drag `只言.app` into Applications
3. Open it from Applications

The app is **ad-hoc signed and not notarized**, so Gatekeeper blocks it on first
launch. Choose "Open Anyway".

If there is no dialog at all, or macOS reports the app is damaged:

```bash
xattr -dr com.apple.quarantine "/Applications/只言.app"
open "/Applications/只言.app"
```

To sign it properly so it runs on other people's Macs without friction, run this
yourself in a terminal (a non-interactive process cannot reach your keychain
private key):

```bash
APP="/Applications/只言.app"

# Sign the inner executable first, then the bundle. Never use --deep:
# it writes a corrupt CodeResources and breaks the bundle.
codesign --force --options runtime \
  --sign "Developer ID Application: Duke Tao (8RK3WCWST9)" "$APP/Contents/MacOS/只言"
codesign --force --options runtime \
  --sign "Developer ID Application: Duke Tao (8RK3WCWST9)" "$APP"

codesign --verify --strict --verbose=2 "$APP"
xcrun notarytool submit 只言.dmg --keychain-profile "YOUR_PROFILE" --wait
xcrun stapler staple "$APP"
```

> `--options runtime` is correct for macOS and wrong for the iOS Simulator —
> see section 6.

### Where the data lives

```
~/Library/Application Support/只言/notes.db       all records
~/Library/Application Support/只言/media/        recordings (.m4a) and exports
```

The path is also shown at runtime at the bottom of the Settings screen.
Deleting the app does not delete your data; deleting that directory does.

---

## 3. Install on the iOS Simulator

```bash
xcrun simctl list devices available          # pick a device
xcrun simctl boot "iPhone 17 Pro"            # adjust to yours
xcrun simctl install booted ZhiYan-sim.app
xcrun simctl launch  booted com.duketao.zhiyan.sim
```

You can also double-click `ZhiYan-sim.app` and drag it into Simulator.

**Limitations:** arm64 Apple Silicon simulators only, portrait only, and there is
no physical-device build yet (see section 5).

---

## 4. Verify it actually works

### Do it yourself

1. Open the app → an onboarding screen appears on first launch → tap "开始记录"
2. Type a sentence containing Chinese → tap "记下来"
3. **Quit the app completely and reopen it** → the note is still there.
   This single step proves the data reached disk.
4. Switch to "搜索" → type **two characters** from that sentence, e.g. `包子`
   → it finds the note. Two-character search means FTS5 is doing the work, not
   a substring scan.
5. Settings → Export Markdown → a `.md` file appears on the Desktop.

### What we have already run

```bash
./build/build.sh test    # 43 data-layer assertions
./build/build.sh all     # compile both platforms, package, sign, build the DMG
```

The app ships three self-checks that call the real native bridge from inside the
page — no mocks. They run from the command line:

```bash
# ① Retrieval: 11 assertions
./dist/只言.app/Contents/MacOS/只言 --act selftest
# expect: [selftest] RESULT=PASS   (passed 11 / failed 0)

# ② Recording: 6 assertions (records 2 seconds of real audio)
./dist/只言.app/Contents/MacOS/只言 --act rectest
# expect: [selftest] RESULT=PASS   (passed 6 / failed 0)

# ③ Page geometry diagnostics (for viewport scaling / layout bugs)
./dist/只言.app/Contents/MacOS/只言 --act probe
# also written to ~/Library/Application Support/只言/probe.txt
```

> The executable is named `只言`, so most shells need it quoted.

**What ① asserts:** record count; `包子` (2 chars); `李彦` (2 chars); `雨`
(1 char); `咖啡` (must correctly return **zero**); `包子店` (3 chars); `SOHO`
(Latin); a tag-only match on `早餐店`; `李彦 + 米线` (multi-term AND, must
match); `李彦 + 包子` (multi-term AND, must **not** match); statistics; export.

The negative assertions matter most — `咖啡` returning zero and the AND case
returning zero are what rule out "it is really just doing string matching."

**What ② asserts:** recording longer than 1 second; a file path returned; the
note written to the database; the audio path stored with it; the status set to
*pending transcription*; export landing in the expected directory.

### Running the same checks on iOS

The simulator needs to be run serially, and the microphone must be granted
first:

```bash
UDID=39889A4C-0419-40B0-B2B1-464B0F4A41B2      # your own device's UDID

xcrun simctl privacy "$UDID" grant microphone com.duketao.zhiyan.sim
xcrun simctl launch "$UDID" com.duketao.zhiyan.sim --act rectest
```

### Reading the iOS database directly

```bash
DB="$(xcrun simctl get_app_container "$UDID" com.duketao.zhiyan.sim data)/Documents/只言/notes.db"

sqlite3 "file:$DB?mode=ro" "SELECT count(*) FROM notes;"
sqlite3 "file:$DB?mode=ro" "SELECT text, source, process_state FROM notes;"
```

> `xcrun simctl launch --console-pty` hangs on some machines, which makes
> stderr unreliable for reading results. Get the container path with
> `simctl get_app_container` and read the file instead.

---

## 5. If you want a build for a physical iPhone

A signing certificate is present (Apple Development, team `H4YQZB7M2V`, paid
account). What is missing is a provisioning profile, and generating one
requires an iPhone connected to this Mac — Xcode cannot register a device it
cannot see.

```bash
xcrun devicectl list devices      # confirm the phone appears here first
```

Then:

```bash
# 1. Xcode → Settings → Accounts → sign in
# 2. Add the device and let Xcode auto-generate a profile
# 3. Change the build target in build/build.sh:
#      xcrun -sdk iphoneos swiftc -target arm64-apple-ios26.0 ...
#    and in Info.plist: drop UIRequiredDeviceCapabilities,
#    and change CFBundleIdentifier (currently com.duketao.zhiyan.sim)
# 4. Sign with a real certificate — DO NOT use --options runtime on a
#    device build either; use a provisioning profile instead.
```

---

## 6. Rebuild it yourself

```bash
./build/build.sh          # everything: test → compile → package → sign → DMG
./build/build.sh mac      # macOS only
./build/build.sh ios      # iOS Simulator only
./build/build.sh test     # data-layer tests only
```

Every step is verified rather than assumed: web assets are checksummed after
being copied into the bundle, the binary's `LC_UUID` is compared against the
freshly compiled one, the simulator build is checked for the `IOSSIMULATOR`
platform marker, and `codesign --verify --strict` runs on both.

This guard exists because of a real failure: a build can compile, sign,
install, launch, and log normally while still running the **previous** binary,
because the recompiled file was never copied into the bundle. Nothing errors.
The symptom is "I changed it and nothing happened."

---

## 7. Bugs fixed in this version

All found by measurement, not by inspection.

1. **`unicode61` is not a usable tokenizer for Chinese.** The plan said
   "the unigram table covers 1–2 character Chinese as a fallback." Implemented
   as written, it does not work — `unicode61` treats a run of Han characters as
   one token, so searching `包子` returns nothing. The fix is to insert a space
   between every Han character before writing to the unigram table. This was
   also corrected in `PRODUCT-PLAN.md`.
2. **The unigram table must index tags and summaries**, or a note tagged `咖啡`
   whose body never says 咖啡 cannot be found.
3. **Null binding.** In Swift, `nil as Any` is not `NSNull`. It falls through
   to `String(describing:)` and writes the literal string `"nil"` into the
   database. The list screen then renders a row of literal `nil`.
4. **Auto-focus on the iOS capture screen** raised the keyboard during the
   onboarding overlay, shrinking the visible viewport to 377 px and scaling
   the page by 6.7%, which left a system-rendered blue bar in the top-left
   corner. Fixed.
5. **`guard let path = opts.snapshotPath` silently disabled `--act`** — without
   a snapshot path, the action never ran and nothing was reported.
6. **`evaluateJavaScript` rejects a top-level `return`** (it becomes a
   SyntaxError). Self-check scripts must be wrapped in an IIFE.
7. **Self-checks were killed by their own screenshot logic.** Screenshots are
   taken 0.9 s after the action fires, and then the process exits — but
   recording takes 2 s. The symptom was "the script started, printed no
   assertions, and still exited 0." `selftest`, `rectest`, and `probe` now skip
   the screenshot branch.
8. **`WKUserContentController` holds message handlers weakly.** With nothing
   retaining it, `postMessage` fails silently, the promise never resolves, and
   the UI just says "the button did nothing." The handler is now a strong
   property on the app delegate.
9. **`--page` deep links were double-encoded**: `comps.fragment = h` encoded an
   already-`#`-prefixed value into `#%23/search`, so selfie mode left you on the
   home screen. The leading `#` is now stripped first.

### The shared lesson behind 5, 7, and 8

All three fail **silently** — no error, sometimes exit code 0, and the feature
simply does not work. When a command runs and nothing happens, do not add logs
and guess. **Run a control experiment first** (new build vs. old, one flag on vs.
off), then instrument.

---

## 8. Files

| File | What it is |
|---|---|
| `只言.dmg` | macOS install image (691 KB, ad-hoc signed, hardened runtime) |
| `只言.app` | Same content, no mounting needed |
| `ZhiYan-sim.app` | iOS Simulator app bundle |
| `ZhiYan-sim.zip` | Same content, compressed |
| `dist/README-安装说明.md` | The same document as this one, left in `dist/` by the build |

All build outputs are git-ignored. Rebuild with `./build/build.sh all`.

---

## 9. Known limitations in this version

| | |
|---|---|
| No speech transcription | Recordings are stored and marked *pending transcription* |
| No AI summaries or auto-tagging | Same blocker — needs a filed generative-AI provider |
| No sync | The screen exists, the logic does not |
| No physical-device build | Needs a provisioning profile |
| Portrait only | No landscape layout |
| Ad-hoc signed | Will be blocked by Gatekeeper on other people's Macs until properly signed |