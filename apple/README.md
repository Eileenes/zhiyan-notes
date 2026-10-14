# 只言 · Apple 正式工程（Xcode / XCFramework / 沙盒 / 隐私清单）

`build/build.sh` 仍是现有的「脚本直编」流程（模拟器包 + ad-hoc 签名 Mac 包）。本目录提供上架与真机签名所需的正式工程，**引用**同一份源代码，不复制：

| 文件 | 作用 |
|---|---|
| `project.yml` | XcodeGen 工程描述：`ZhiYan-macOS`、`ZhiYan-iOS` 两个 App target + scheme |
| `Sources/main.swift` | 指向 `build/shell.swift` 的符号链接（含顶层代码，必须叫 main.swift） |
| `scripts/build-xcframework.sh` | 把 `core/` 编成 `apple/build/ZhiYanCore.xcframework`（macOS arm64+x86_64、iOS arm64、iOS 模拟器 arm64+x86_64） |
| `scripts/stage-web.sh` | 构建阶段脚本：运行 `tools/build-web.js`，把 `web-dist/` 拷进包内 `Web/` |
| `Config/ZhiYan-macOS.entitlements` | App Sandbox + 网络客户端 + 本机服务端（对外接口 127.0.0.1）+ 麦克风 + 钥匙串 |
| `Config/ZhiYan-iOS.entitlements` | 钥匙串访问组（替代仅限模拟器的 `build/simulator.entitlements`） |
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

在 Xcode 的 Signing & Capabilities 中选择自己的 Team（或在本地 xcconfig 中设置 `DEVELOPMENT_TEAM`，**不要提交**）。命令行：

```sh
xcodebuild -project apple/ZhiYan.xcodeproj -scheme ZhiYan-macOS -configuration Debug CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apple/ZhiYan.xcodeproj -scheme ZhiYan-iOS -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

修改 Rust 核心后用 `ZY_REBUILD_CORE=1` 重新构建，或手动重跑 `build-xcframework.sh`。

## ⚠️ 必须在 Mac 上验证（本 PR 在 Linux 上编写，均未运行）

1. `xcodegen generate` 能生成工程；两个 scheme 能编译、链接（`-lc++`、Security、SystemConfiguration、XCFramework 静态库；Rust 内置 SQLite 与系统 `SQLite3` 模块共存，与 build.sh 现状一致）。
2. 符号链接 `Sources/main.swift` 与 `AppIcon` 图片在 Xcode / actool 中能被正确跟随。
3. **macOS 沙盒数据迁移**：开启沙盒后 `Application Support/只言` 指向容器 `~/Library/Containers/com.duketao.zhiyan/Data/...`，**已有用户的数据不会自动出现**。上架前需要决定迁移方案（如 `container-migration.plist` 或首次启动引导导入），并用旧版数据实测。
4. 沙盒内：录音（麦克风授权弹窗）、同步/模型 HTTPS 请求、对外接口在 127.0.0.1 监听、导出后在访达中选中、钥匙串读写。
5. iOS 真机：钥匙串访问组、麦克风、`Documents/只言/notes.db` 路径；隐私清单在 Xcode「Generate Privacy Report」中无缺失项（若链接的第三方 SDK 需要，额外合并）。
6. `stage-web.sh` 在 Xcode 构建环境中能找到 node（Homebrew 路径已兜底）。
7. Archive → Validate App（App Store Connect 校验加密声明、图标、隐私清单）。
