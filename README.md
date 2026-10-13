# 只言 ZhiYan

**A Chinese-first voice and text memory app for macOS and iOS.**
Speak or type a thought once — it stays searchable forever, on your own device.

**English** · [简体中文](README.zh-CN.md)

`macOS` `iOS Simulator` `Swift + WKWebView` `SQLite3 / FTS5` `zero third-party dependencies`

---

## Status

v0.5. The data path is real end to end — what you record is on disk, survives a
relaunch, and can be found again by searching Chinese text.

### What actually works

| | How it was verified |
|---|---|
| Text notes persist in SQLite | Close and relaunch — data is still there |
| Chinese full-text search, including **1- and 2-character** queries | `selftest`, 11 assertions |
| Audio recording to local `.m4a` | `rectest`, 6 assertions; AAC mono 44.1 kHz, 2.0 s, real ambient audio |
| Export to Markdown and JSON files | Both produced and inspected |
| Tags and summaries are searchable | `selftest` asserts a tag-only match |
| First launch is an empty database, not demo data | Verified by opening a clean install |

Automated coverage: **43/43** data-layer assertions, **11/11** retrieval assertions,
**6/6** recording assertions.

### What is not built

Listed plainly because a feature list that hides its gaps is not useful to anyone.

| Feature | Status | Why |
|---|---|---|
| Speech transcription | **Not built** | Needs a cloud provider and a filed generative-AI registration in China. Recordings are stored as-is and marked *pending transcription*. |
| AI summaries / auto-tagging | **Not built** | Same blocker. |
| iCloud sync | **Not built** | The screen exists; no logic is behind it. |
| iOS device (physical iPhone) build | **Not built** | Requires a provisioning profile, which requires an iPhone connected to the build machine. |
| Landscape layout | **Not built** | Portrait only. |
| App Store distribution | **Not built** | Ad-hoc signed and not notarized. |

What this version validates is the core loop — **record → retrieve → export** —
and the feasibility of Chinese short-query search. The AI layer and sync are
not connected.

---

## Screenshots

| macOS | iOS Simulator |
|---|---|
| ![macOS capture](docs/screenshots/mac-capture.png) | ![iOS capture](docs/screenshots/ios-capture.png) |
| ![macOS timeline](docs/screenshots/mac-timeline.png) | ![iOS timeline](docs/screenshots/ios-timeline.png) |
| ![macOS search](docs/screenshots/mac-search.png) | ![iOS search](docs/screenshots/ios-search.png) |
| ![macOS settings](docs/screenshots/mac-settings.png) | |

---

## Three decisions worth explaining

### The UI is HTML in a `WKWebView`, not SwiftUI

The interface went through three rounds of design rework before this version. A
SwiftUI rewrite would mean reimplementing that work pixel by pixel, and the cost
grows the longer it is deferred. The HTML/CSS source in `prototype/` is kept
verbatim so the rendering is identical, and the data layer is isolated behind a
small interface — porting to SwiftUI later means rewriting one file
(`build/Data.swift`), not the app.

The tradeoff is real: you pay for a WebView runtime, and you cannot use the
platform's native controls directly. For this version that was the right trade.

### The data layer is raw SQLite3, not an ORM

`build/Data.swift` calls the system SQLite3 C API directly. No GRDB, no
Core Data, no SwiftData, no SPM dependencies, no CocoaPods. `swiftc` plus the
platform SDK is the entire toolchain.

GRDB would have been faster to write and is a perfectly good choice. It was
skipped because a zero-dependency build stays auditable and small, and because
the choice is reversible at exactly one seam.

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

```
prototype/            HTML + CSS + JS — the entire UI
  app.js              views, state, actions
  base.css            design tokens and layout
  db.js               ZY module: talks to the shell, falls back to fixtures in a browser
  data.js             demo fixtures, used only when running outside the shell
        │
        │  window.zyNative.call({ op, ...payload })  →  Promise
        ▼
build/shell.swift     WKWebView host
                      WKScriptMessageHandler  ("native")
                      AVAudioRecorder          (real .m4a capture)
                      AVAudioSession           (iOS microphone permission)
        │
        │  op: load · save · delete · search · stats
        │      export · rebuild · wipe · seed
        │      recStart · recStop · recCancel · micPerm · log · dump
        ▼
build/Data.swift      SQLite3 C API
                      notes · notes_fts_trigram · notes_fts_unigram
                      3 write triggers, kept in sync by SQLite itself
        ▼
notes.db
```

```
notes.db
├── notes                    all records, incl. soft-deleted (deleted = 1)
├── notes_fts_trigram        3+ character Chinese / Latin, native FTS5
├── notes_fts_unigram        per-character, space-separated — short queries
└── trg_notes_ai / _au / _ad triggers fire on every write
```

---

## Build from source

Requires macOS on Apple Silicon and the Xcode command line tools (built and
tested against Xcode 26.2). No package manager step exists — there are no
dependencies to install.

```bash
git clone https://github.com/Eileenes/zhiyan-notes.git
cd zhiyan-notes

./build/build.sh test     # compile and run the data layer — expect 43/43
./build/build.sh all      # both platforms, signing, and the DMG
```

| Target | Output |
|---|---|
| `build.sh mac` | `dist/只言.app`, `dist/只言.dmg` |
| `build.sh ios` | `dist/ZhiYan-sim.app` (arm64 simulator) |
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

The app ships with three self-checks that drive the real native bridge from
inside the page — no mocks.

```bash
./dist/只言.app/Contents/MacOS/只言 --act selftest   # → RESULT=PASS (11/11)
./dist/只言.app/Contents/MacOS/只言 --act rectest    # → RESULT=PASS (6/6)
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

**Nothing leaves the device.** There is no network code, no account, no server,
no analytics, and no crash reporting.

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/只言/notes.db` |
| macOS media | `~/Library/Application Support/只言/media/` (recordings, exports) |
| iOS | App container → `Documents/只言/notes.db` |

The settings screen shows the exact path at runtime. Deleting the app does not
delete your data; deleting that directory does.

---

## Project layout

| Path | What it is |
|---|---|
| `build/Data.swift` | SQLite schema, FTS5, queries, export — the whole data layer |
| `build/shell.swift` | WKWebView host, JS bridge, audio recording |
| `build/build.sh` | Build, package, sign, verify |
| `build/tests/` | 43 data-layer assertions |
| `prototype/` | The UI. Named "prototype" historically; it is the shipping interface now |
| `icon/` | Icon sources and exports |
| `docs/screenshots/` | The 8 screenshots used above |
| `PRODUCT-PLAN.md` | Product plan v3.3 (Chinese) |

`prototype/` is the UI source despite the folder name — the shell ships these
files verbatim. Renaming it would mean touching every path in `build.sh`, so
the name was left alone rather than churned.

---

## Roadmap

Three things decide whether this project has a future. None of them is done.

1. **Speech transcription and AI summaries.** The actual differentiator. Right
   now a recording is an audio file labelled *pending transcription*.
2. **Sync between phone and Mac.** The foundation of a two-device product.
   CloudKit and a self-hosted server are mutually exclusive choices, and the
   CloudKit option ties the product to Apple's platform. **This decision is
   deliberately still open.**
3. **The "no vendor dependency" angle.** It is only a real advantage where
   iCloud is unavailable. So it is a consequence of decision 2, not an
   independent feature.

Until those land, v0.5 is a working capture-and-retrieve loop, not a
differentiated product. It is honest about that on purpose.

---

## Documents

- **[docs/INSTALL.md](docs/INSTALL.md)** — install, data paths, self-checks
- **[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)** — 安装与验证说明（中文）
- **[PRODUCT-PLAN.md](PRODUCT-PLAN.md)** — full product plan, v3.3 (Chinese)

The plan document records a correction: the original search design specified
"unigram handles 1–2 character Chinese as a fallback." That was implemented,
measured, and found not to work with `unicode61`. Section 3.6 documents what was
tried, what the numbers were, and what replaced it.