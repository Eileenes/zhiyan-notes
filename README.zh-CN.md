# 只言 ZhiYan

**一款面向中文场景的语音 + 文字记忆 App。**
记录先保存在设备；可选接入自己的模型服务和跨设备同步。

[English](README.md) · **简体中文**

`macOS` `iOS` `Windows / Android 适配中` `Rust + Swift + Tauri` `SQLite / PostgreSQL`

---

## 进展

v0.7 在记忆花园界面上恢复了真实模型配置，并加入共享 Rust 核心、多用户同步服务与 Windows / Android 应用壳。

- **模型服务**：自定义地址、模型和密钥，支持 OpenAI Chat Completions、Responses 与 Anthropic Messages；独立语音转写配置、真实连接测试、默认服务、任务重试。
- **多端同步**：注册 / 登录、离线队列、增量同步、录音上传及按需下载、多端修改冲突处理。服务器按账号隔离，部署使用 PostgreSQL。
- **本地体验**：保留花园界面、中文短词搜索、草稿、编辑、真实播放、删除撤销、分页和导出。
- **对外接口**：设置中可开启本机 MCP 和 OpenAI 兼容接口，支持记忆检索、读取、可选新增及模型问答；独立访问密钥和权限开关。接入示例见 **[对外接口说明](docs/EXTERNAL-API.md)**。

详细结构、构建步骤、测试及限制见 **[跨平台实现说明](docs/CROSS-PLATFORM-PLAN.md)**；部署见 **[同步服务说明](server/README.md)**。

| 平台 / 服务 | 当前交付状态 |
|---|---|
| macOS / iOS 模拟器 | 已构建并验证原生数据、播放、模型配置和 Keychain |
| Windows | Tauri 壳及构建流水线已加入；未在 Windows 构建和运行 |
| Android | 壳、权限、录音桥、安全存储及构建脚本已加入；按用户决定暂不安装 SDK，未生成 APK |
| 同步服务 | SQLite / PostgreSQL 本地测试通过，未部署到公网 |
| 模型调用 | 本地 HTTP 协议集成测试通过；未使用商业服务商真实凭据测试 |

公开使用仍需部署 HTTPS 同步服务、完成平台安装验证和发行签名。iOS 真机及商店发行尚未配置。每个本机资料库当前只能绑定一个同步账号，尚无资料库切换界面。

---

## 界面

| macOS 浏览器预览 | iOS 模拟器 · 原生应用 |
|---|---|
| ![Mac 记忆花园](docs/screenshots/garden-mac-home.png) | ![iOS 记忆花园](docs/screenshots/garden-ios-native.png) |

---

## 三个值得说明的决定

### 界面用 `WKWebView` 装 HTML，不是 SwiftUI

这个界面在做成这一版之前经历了三轮审美返工。改成 SwiftUI 意味着把这些工作逐像素重做一遍，
而且拖得越久越贵。`prototype/` 里的 HTML/CSS 原样保留，渲染结果完全一致；
数据层也隔离在一个小接口后面——将来要搬去 SwiftUI，数据与业务服务可以复用，但界面与界面状态仍需重新实现。

代价是真实的：多背一个 WebView 运行时，拿不到平台的原生控件。这一版我认为这笔交易划算。

### 共享数据与服务核心

`core/` 用 Rust 和 SQLite / FTS5 实现检索、模型协议、处理队列及同步。Apple 通过 C ABI 调用，Windows / Android 通过 Tauri 调用。保留旧 Swift 数据代码作为迁移兼容和原生诊断使用，不再把业务逻辑分别复制到四端。

### 中文检索需要两张 FTS5 表 —— 而最直觉的解法是静默失效的

SQLite 的 `unicode61` 分词器会把一整串汉字当成**一个 token**。`包子店` 变成单个 token，
于是查 `包子` 这种两字查询返回 0 行。

最直觉的修法——「短查询用 unigram 兜底」——如果你原样把 `unicode61` 喂进去，是**不成立**的。

真正可行的是：写入 unigram 表之前，逐字插空格（`包 子 店`），纯西文不插。
检索时按词长分流：

| 查询 | 走哪张表 | 合并方式 |
|---|---|---|
| 1–2 字 | unigram | — |
| 3 字及以上 | trigram（主查）+ unigram | 并集 |
| 多词 | 两张都走 | 交集（AND） |

两条容易漏、而且都是靠实测才发现的约束：

- unigram 表必须**同时索引标签和摘要**，不能只索引正文。否则一条标签写着 `咖啡`、
  正文里从没出现过咖啡的记录，搜「咖啡」是搜不出来的。
- 空值必须绑成 SQL `NULL`，不能绑成字符串 `"nil"`。Swift 里 `nil as Any` 得到的是
  `Optional<String>.none`，它既不匹配 `NSNull` 也不匹配 `String`，
  最后掉进 `String(describing:)`——把字面量 `"nil"` 六个字符写进了数据库。

---

## 架构

界面由 Apple 和 Tauri 壳共用，两种壳调用同一个 Rust 核心；核心处理 SQLite 检索、模型任务及同步，服务端使用 FastAPI / PostgreSQL。详见 [架构与协议说明](docs/CROSS-PLATFORM-PLAN.md)。

---

## 从源码构建

需要 Apple Silicon 的 Mac 和 Xcode 命令行工具（在 Xcode 26.2 上开发验证）。
另需 Rust 工具链和 `aarch64-apple-ios-sim` target；构建脚本通过 Cargo 编译共享核心。Windows / Android 的依赖及步骤见跨平台说明。

```bash
git clone https://github.com/Eileenes/zhiyan-notes.git
cd zhiyan-notes

./build/build.sh test     # 编译并跑数据层 —— 期望 61/61
./build/build.sh all      # 双端编译、签名、打 DMG
```

| 目标 | 产物 |
|---|---|
| `build.sh mac` | `dist/只言.app`、`dist/只言.dmg` |
| `build.sh ios` | `dist/ZhiYan-sim.app`（arm64 模拟器） |
| `build.sh test` | 只跑数据层断言 |

脚本对每一步都做校验，而不是相信它：Web 资源进包后逐个比对哈希、二进制进包后比对
`LC_UUID`、模拟器包检查 `IOSSIMULATOR` 平台标记、两端都跑 `codesign --verify --strict`。

> 这个校验是被一个真实的坑逼出来的：一次构建可以编译成功、签名成功、安装成功、
> 启动成功、日志一切正常——**跑的还是上一次的二进制**，因为重新编译出来的文件
> 从来没被拷进 bundle。症状是「我明明改了却什么都没发生」，而且没有任何报错。

### iOS 签名有一个坑

```bash
codesign --force --sign - ... --options runtime   # macOS：正确
codesign --force --sign - ...                    # iOS 模拟器：不能加 runtime
```

模拟器包**绝对不能**加 Hardened Runtime。加了之后 `codesign --verify` 通过、
`hdiutil verify` 通过，App 一进模拟器启动就崩在
`DYLD_ROOT_PATH not set for simulator program`。只有真的启动一次才抓得住。

---

## 自己验，而不是靠假设

App 内置多套自检，在页面里调**真实**原生桥接，不走 mock。

```bash
./dist/只言.app/Contents/MacOS/只言 --database /tmp/zhiyan-verification.db --act selftest   # → RESULT=PASS（11/11）
./dist/只言.app/Contents/MacOS/只言 --database /tmp/zhiyan-verification.db --act rectest    # → RESULT=PASS（6/6）
./dist/只言.app/Contents/MacOS/只言 --act probe      # 页面几何诊断
```

> 可执行文件名叫 `只言`，多数 shell 里需要加引号。

`selftest` 覆盖：落库条数、1 字查询、2 字查询、3 字查询、西文查询、只靠标签命中、
多词 AND 该命中、多词 AND **不该命中**、统计、导出。
两个反向断言才是关键——正是它们排除了「其实只是字符串匹配」。

`rectest` 覆盖：录音时长 > 1 秒、返回文件路径、记录落库、音频路径一起存下、
状态为「待转写」、导出落在预期目录。

完整走查：**[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)** ·
**[docs/INSTALL.md](docs/INSTALL.md)**

---

## 数据与隐私

**默认本地保存，可选开启联网能力。** 开启同步后，文字和录音发送到所配置的同步服务；发起 AI 任务时，相关文字或录音发送到所配置的模型服务商。API Key 保存在各设备安全存储中，不上传到同步服务。此版不提供端到端加密。

| 平台 | 位置 |
|---|---|
| macOS | `~/Library/Application Support/只言/notes.db` |
| macOS 媒体 | `~/Library/Application Support/只言/media/`（录音、导出文件） |
| iOS | App 容器 → `Documents/只言/notes.db` |

卸载移动端应用可能删除本机数据，请先确认同步或导出完成。Windows / Android 数据保存在 Tauri 提供的应用私有数据目录中。

---

## 目录结构

| 路径 | 是什么 |
|---|---|
| `core/` | 共享数据、检索、模型协议与同步 |
| `server/` | 多用户同步服务、部署和测试 |
| `src-tauri/` / `plugins/credentials/` | Windows / Android 壳与安全存储 |
| `build/Data.swift` | Apple 兼容数据访问与诊断 |
| `build/shell.swift` | WKWebView 宿主、JS 桥接、录音 |
| `build/build.sh` | 编译、打包、签名、校验 |
| `build/tests/` | 61 项数据层断言 |
| `prototype/` | 界面源码。目录名叫 prototype 是历史遗留，它就是现在在用的界面 |
| `icon/` | 图标源文件与导出 |
| `docs/screenshots/` | 本轮花园截图与 v0.5 历史截图 |
| `PRODUCT-PLAN.md` | 产品方案 v3.3（中文） |

`prototype/` 虽然叫这个名字，但它是壳实际打包进去的界面源文件。
改名要动 `build.sh` 里每一处路径，所以留着了，没有为了整洁去折腾。

---

## 后续验证

下一步是填写真实服务商配置、部署 HTTPS 同步服务，并在 Windows 与 Android 环境完成安装、录音权限、重启及升级测试。公开运营需要补充账号找回、自助账号删除、资料库切换与数据生命周期管理。

---

## 文档

- **[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)** — 安装、数据路径、自检命令
- **[docs/INSTALL.md](docs/INSTALL.md)** — Install & verification guide (English)
- **[PRODUCT-PLAN.md](PRODUCT-PLAN.md)** — 完整产品方案 v3.3（中文）

产品方案里记了一次修正：原检索方案写的是「unigram 表负责 1-2 字中文兜底」。
按这个实现之后实测发现，用 `unicode61` 根本不成立。
第 3.6 节记录了试过什么、数字是多少、最后换成了什么做法。
