# 只言 ZhiYan

**A Chinese-first voice and text memory app.**
Notes stay local first, with optional custom model providers and cross-device synchronization.

**English** · [简体中文](README.zh-CN.md)

`macOS` `iOS` `Windows / Android in progress` `Rust + Swift + Tauri` `SQLite / PostgreSQL`

---

## Status

v0.7 adds real custom model settings, a shared Rust core, account-isolated synchronization, and Tauri client sources for Windows and Android.

- Custom OpenAI Chat Completions / Responses and Anthropic Messages providers; separate transcription configuration; real connection tests, default providers and persistent jobs.
- Offline outbox, incremental sync, audio upload / on-demand download, idempotent retries and explicit edit-conflict resolution. FastAPI + PostgreSQL provides the multi-user backend.
- Existing Memory Garden UI, local drafts, Chinese retrieval, editing, native playback and export remain available.
- Settings now offers an authenticated loopback MCP server and OpenAI-compatible Chat Completions, with memory search, retrieval, optional creation and provider-backed Q&A. See [external API setup and limits](docs/EXTERNAL-API.md).

Mac and iOS Simulator builds have been verified locally. Windows and Android sources / build workflows are present, but Windows has not been built or run, and Android SDK installation was deferred at the user's request: **no APK has been produced**. Protocol tests use controlled local HTTP servers, not commercial provider credentials. The sync service has not been deployed publicly. Physical iOS signing and store distribution remain unconfigured.

See [implementation, build and verification notes](docs/CROSS-PLATFORM-PLAN.md) and [server deployment](server/README.md). Each local library currently binds to one sync account; switching libraries is not yet exposed in the UI.

---

## Screenshots

| macOS browser preview | iOS Simulator · native app |
|---|---|
| ![Memory Garden on Mac](docs/screenshots/garden-mac-home.png) | ![Memory Garden on iOS](docs/screenshots/garden-ios-native.png) |

---

## Three decisions worth explaining

### The UI is HTML in a `WKWebView`, not SwiftUI

The interface went through three rounds of design rework before this version. A
SwiftUI rewrite would mean reimplementing that work pixel by pixel, and the cost
grows the longer it is deferred. The HTML/CSS source in `prototype/` is kept
verbatim so the rendering is identical, and the data layer is isolated behind a
small interface — a future SwiftUI interface can reuse the data and service layers, while views and presentation state still require reimplementation.

The tradeoff is real: you pay for a WebView runtime, and you cannot use the
platform's native controls directly. For this version that was the right trade.

### Shared data and service core

`core/` uses Rust and SQLite / FTS5 for data, retrieval, model protocols, jobs and synchronization. The existing Apple shell calls it through a C ABI; Windows and Android use Tauri. The legacy Swift data layer remains for migration compatibility and native diagnostics.

### Chinese search needed two FTS5 tables — and the obvious solution silently fails

SQLite's `unicode61` tokenizer treats a run of Han characters as a **single
token**. `包子店` becomes one token, so a two-character query like `包子`
returns zero rows. The intuitive fix — "use unigram for short queries as a
fallback" — does not work if you feed `unicode61` the raw text.

What actually works is inserting a space between every Han character before
writing to the unigram table (`包 子 店`), and leaving pure Latin text alone.
Search then splits by length:

| Query | Table used | Combination |
|---|---|---|
| 1–2 characters | unigram | — |
| 3+ characters | trigram (primary) + unigram | union |
| Multiple terms | both | intersection (AND) |

Two constraints that are easy to miss and were both found by measurement:

- The unigram table must index **tags and summaries too**, not just the body.
  Otherwise a note tagged `咖啡` whose text never says 咖啡 is unsearchable.
- A missing value must bind as SQL `NULL`, not the string `"nil"`. In Swift,
  `nil as Any` is `Optional<String>.none`, which matches neither `NSNull` nor
  `String` and falls through to `String(describing:)` — writing a literal
  six-character `nil` into the database.

---

## Architecture

Apple and Tauri shells share the UI and the Rust data / service core. The core owns SQLite retrieval, model jobs and synchronization; FastAPI / PostgreSQL provides the server. See [architecture and protocol notes](docs/CROSS-PLATFORM-PLAN.md).

---

## Build from source

Requires macOS on Apple Silicon and the Xcode command line tools (built and
tested against Xcode 26.2), plus Rust and the `aarch64-apple-ios-sim` target. The build script compiles the shared core through Cargo. See the cross-platform guide for Windows and Android requirements.

```bash
git clone https://github.com/Eileenes/zhiyan-notes.git
cd zhiyan-notes

./build/build.sh test     # compile and run the data layer — expect 61/61
./build/build.sh all      # both platforms, signing, and the DMG
```

| Target | Output |
|---|---|
| `build.sh mac` | `dist/只言.app`, `dist/只言.dmg` |
| `build.sh ios` | `dist/ZhiYan.app` (arm64 simulator, Debug build of apple/project.yml; needs xcodegen) |
| `build.sh test` | data-layer assertions only |

The script verifies each step rather than trusting it: web assets are
checksummed after being copied into the bundle, the binary's `LC_UUID` is
compared against the freshly compiled one, the simulator build is checked for
the `IOSSIMULATOR` platform marker, and `codesign --verify --strict` runs on
both.

> This guard exists because of a real failure mode: a build that compiles
> successfully, signs, installs, launches, and logs normally — while still
> running the **previous** binary, because the recompiled file was never copied
> into the bundle. The symptom is "I changed it and nothing happened," with no
> error anywhere.

### One thing to know about iOS signing

```bash
codesign --force --sign - ... --options runtime   # macOS: correct
codesign --force --sign - ...                    # iOS simulator: no runtime flag
```

Hardened Runtime must **not** be set on an iOS Simulator build. `codesign
--verify` passes, `hdiutil verify` passes, and the app still crashes on launch
inside the simulator with `DYLD_ROOT_PATH not set for simulator program`. Only
launching it catches this.

---

## Verify it works, rather than assuming

The app ships with native self-checks that drive the real native bridge from
inside the page — no mocks.

```bash
./dist/只言.app/Contents/MacOS/只言 --database /tmp/zhiyan-verification.db --act selftest   # → RESULT=PASS (11/11)
./dist/只言.app/Contents/MacOS/只言 --database /tmp/zhiyan-verification.db --act rectest    # → RESULT=PASS (6/6)
./dist/只言.app/Contents/MacOS/只言 --act probe      # page geometry diagnostics
```

> The executable is named `只言`, so it needs quoting on most shells.

`selftest` covers: record count, 1-character query, 2-character query,
3-character query, Latin query, tag-only query, a multi-term AND that must
match, a multi-term AND that must **not** match, statistics, and export. The two
negative cases are the important ones — they are what rules out "it is really
just doing string matching."

`rectest` covers: recording longer than 1 second, a returned file path, the
note landing in the database, the audio path stored alongside it, the status set
to *pending transcription*, and export landing in the expected directory.

Full walkthrough: **[docs/INSTALL.md](docs/INSTALL.md)** ·
**[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)**

---

## Data and privacy

**Local first, with optional network features.** Enabling sync sends notes and audio to your configured server. AI actions send the relevant text or audio directly to your chosen provider. API keys stay in each device’s secure storage and are not synced. This version does not provide end-to-end encryption.

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/只言/notes.db` |
| macOS media | `~/Library/Application Support/只言/media/` (recordings, exports) |
| iOS | App container → `Documents/只言/notes.db` |

Uninstalling a mobile app may remove its local data. Complete synchronization or export first. Windows and Android use Tauri’s private application data directory.

---

## Project layout

| Path | What it is |
|---|---|
| `core/` | Shared data, retrieval, model protocols and synchronization |
| `server/` | Multi-user sync API, deployment and tests |
| `src-tauri/` / `plugins/credentials/` | Windows / Android shell and secure storage |
| `build/Data.swift` | Apple compatibility access and diagnostics |
| `build/shell.swift` | WKWebView host, JS bridge, audio recording |
| `build/build.sh` | Build, package, sign, verify |
| `build/tests/` | 61 data-layer assertions |
| `prototype/` | The UI. Named "prototype" historically; it is the shipping interface now |
| `icon/` | Icon sources and exports |
| `docs/screenshots/` | Current garden screenshots and historical v0.5 screenshots |
| `PRODUCT-PLAN.md` | Product plan v3.3 (Chinese) |

`prototype/` is the UI source despite the folder name — the shell ships these
files verbatim. Renaming it would mean touching every path in `build.sh`, so
the name was left alone rather than churned.

---

## Next validation

Configure real providers, deploy the HTTPS sync service, and verify installation, recording permissions, restart and upgrades on Windows and Android. Public operation also needs account recovery, self-service deletion, library switching and data lifecycle management.

---

## Documents

- **[docs/INSTALL.md](docs/INSTALL.md)** — install, data paths, self-checks
- **[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)** — 安装与验证说明（中文）
- **[PRODUCT-PLAN.md](PRODUCT-PLAN.md)** — full product plan, v3.3 (Chinese)

The plan document records a correction: the original search design specified
"unigram handles 1–2 character Chinese as a fallback." That was implemented,
measured, and found not to work with `unicode61`. Section 3.6 documents what was
tried, what the numbers were, and what replaced it.
