# 只言 · Apple 正式工程（Xcode / XCFramework / 沙盒 / 隐私清单）

> **状态：等待 Mac 验证（awaiting Mac verification）。** 本目录在 Linux 上编写，xcodegen / xcodebuild / 签名 / 沙盒行为均未实际运行，见文末清单。

`build/build.sh mac` 仍是「脚本直编」的 ad-hoc 签名 Mac 包；`build/build.sh ios` 现在通过本工程（Debug、iOS 模拟器）构建，产出 `dist/ZhiYan.app`，bundle id 与正式版一致 `com.duketao.zhiyan`。旧的 `.sim` bundle id 与 `build/simulator.entitlements` 已移除。本目录提供上架与真机签名所需的正式工程，**引用**同一份源代码，不复制：

| 文件 | 作用 |
|---|---|
| `project.yml` | XcodeGen 工程描述：`ZhiYan-macOS`、`ZhiYan-iOS` 两个 App target + scheme |
| `Sources/main.swift` | 指向 `build/shell.swift` 的符号链接（含顶层代码，必须叫 main.swift） |
| `scripts/build-xcframework.sh` | 把 `core/` 编成 `apple/build/ZhiYanCore.xcframework`（macOS arm64+x86_64、iOS arm64、iOS 模拟器 arm64+x86_64） |
| `scripts/stage-web.sh` | 构建阶段脚本：运行 `tools/build-web.js`，把 `web-dist/` 拷进包内 `Web/` |
| `Config/ZhiYan-macOS.entitlements` | App Sandbox + 网络客户端 + 本机服务端（对外接口 127.0.0.1）+ 麦克风 + 钥匙串 |
| `Config/ZhiYan-iOS.entitlements` | 钥匙串访问组（模拟器与真机共用） |
| `Config/PrivacyInfo.xcprivacy` | 隐私清单：不追踪、无收集数据类型、Required-Reason API（文件时间戳 C617.1、系统启动时间 35F9.1） |
| `Config/Info-*.plist` | 与 build.sh 内联的 plist 一致，改为使用构建变量；加 `ITSAppUsesNonExemptEncryption=false` |
| `Assets.xcassets` | iOS AppIcon（单张 1024，符号链接到 `icon/icon-1024.png`） |
| `../core/include/` | Rust C ABI 头文件与 modulemap（随 XCFramework 分发） |

生成的 `apple/ZhiYan.xcodeproj/` 与 `apple/build/` 已加入 `.gitignore`。

## 在 Mac 上使用

```sh
brew install xcodegen
rustup target add aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
npm ci
apple/scripts/build-xcframework.sh
cd apple && xcodegen generate && open ZhiYan.xcodeproj
```

### 签名与 `DEVELOPMENT_TEAM`

`project.yml` 里 `DEVELOPMENT_TEAM: ""` 是**有意留空的占位符**：Team ID 属于具体开发者/组织，不进仓库。

- iOS 模拟器构建、`CODE_SIGNING_ALLOWED=NO` 的 macOS 构建不需要 Team。
- 真机 / Archive：在 Xcode 的 Signing & Capabilities 里选择 Team（写入的是生成的 `ZhiYan.xcodeproj`，已被 git 忽略，下次 `xcodegen generate` 会被重置），或在命令行传 `DEVELOPMENT_TEAM=ABCDE12345`。
- 不要把 Team ID 提交进 `project.yml`。

### Diagnostics（自检脚本）只在 Debug

`build/Diagnostics.swift`（`--act` 注入的交互自检）在 Release 配置中通过 `EXCLUDED_SOURCE_FILE_NAMES` 排除，文件本身也包在 `#if DEBUG` 里；Release 下 `shell.swift` 提供返回 `nil` 的空实现。`build.sh mac` 默认不编入，`ZY_DIAGNOSTICS=1 ./build/build.sh mac` 才编入（仅用于验证，勿分发）。

命令行：

```sh
xcodebuild -project apple/ZhiYan.xcodeproj -scheme ZhiYan-macOS -configuration Debug CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apple/ZhiYan.xcodeproj -scheme ZhiYan-iOS -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

修改 Rust 核心后用 `ZY_REBUILD_CORE=1` 重新构建，或手动重跑 `build-xcframework.sh`。

## ⚠️ 必须在 Mac 上验证（本 PR 在 Linux 上编写，均未运行）

1. `xcodegen generate` 能生成工程；两个 scheme 能编译、链接（`-lc++`、Security、SystemConfiguration、XCFramework 静态库；Rust 内置 SQLite 与系统 `SQLite3` 模块共存，与 build.sh 现状一致）。
2. 符号链接 `Sources/main.swift` 与 `AppIcon` 图片在 Xcode / actool 中能被正确跟随。
3. **macOS 沙盒数据迁移**：开启沙盒后已有用户的数据不会自动出现。方案见 [`docs/SANDBOX-MIGRATION.md`](../docs/SANDBOX-MIGRATION.md)（`container-migration.plist` + 应用内导入兜底），**实现并实测前不要向已有用户发布沙盒版**。
4. 沙盒内：录音（麦克风授权弹窗）、同步/模型 HTTPS 请求、对外接口在 127.0.0.1 监听、导出后在访达中选中、钥匙串读写。
5. iOS 真机：钥匙串访问组、麦克风、`Documents/只言/notes.db` 路径；隐私清单在 Xcode「Generate Privacy Report」中无缺失项（若链接的第三方 SDK 需要，额外合并）。
6. `stage-web.sh` 在 Xcode 构建环境中能找到 node（Homebrew 路径已兜底）。
7. Archive → Validate App（App Store Connect 校验加密声明、图标、隐私清单）。
8. `build.sh ios`（xcodegen + xcodebuild Debug 模拟器）产出 `dist/ZhiYan.app`，`build/tests/verify-simulator.py` 以 `com.duketao.zhiyan` 安装、启动并通过 `--act` 自检。
9. Release 构建不含 `actionScript` 自检脚本（`strings` 中搜不到 `garden-test` 等脚本文本）。
