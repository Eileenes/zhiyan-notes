# 只言 · 安装与验证说明

[English](INSTALL.md) · **简体中文**

[← 返回 README（中文）](../README.zh-CN.md)

> v0.5 · 2026-10-13
> 上一版是「界面原型壳」，这一版是**接上真实数据库的可用 App**。

---

## 一、这一版和上一版的区别

上一版包里的一切都是假的（录音是动画、搜索是字符串匹配、数据刷新即还原）。
**这一版这些都换成真的了**：

| 功能 | 上一版（10-12） | 这一版（10-13） |
|---|---|---|
| 记文字 | 存内存，刷新即没 | **写进 SQLite，退出重开还在** |
| 搜索 | 写死数据里做字符串匹配 | **FTS5 双表真检索，1 字/2 字中文都能搜** |
| 导出 | `alert()` 弹一句话 | **真的生成文件**（MD / JSON），mac 还会用访达定位 |
| 录音 | 播放动画，不录音 | **真录音**，m4a 存到本地，不上传 |
| 数据 | 12 条演示数据 | **首次打开是空库**，示例数据在设置页按需载入 |

### 没有做的（诚实说明）

| 功能 | 状态 | 为什么 |
|---|---|---|
| 语音转写 | ❌ 没有 | 依赖云端服务商与生成式 AI 备案，这条链路还没打通。录音存下来了，标为「待转写」 |
| AI 摘要 / 自动打标 | ❌ 没有 | 同上 |
| iCloud 双端同步 | ❌ 没有 | 界面画了，逻辑没接 |
| iOS 真机包 | ❌ 没有 | 需要生成 provisioning profile（见第五节） |
| 横屏 | ❌ 只有竖屏 | |

**换句话说：这一版验证的是「记录 → 检索 → 导出」这条主干，以及中文短查询检索的可行性。
AI 链路和同步都还没接。**

---

## 二、macOS 安装

1. 双击 `只言.dmg`
2. 把 `只言.app` 拖进「应用程序」
3. 从「应用程序」双击打开

首次打开被拦（包是 ad-hoc 签名，未公证）：点「仍要打开」即可。
没有弹窗或提示"已损坏"时：

```bash
xattr -dr com.apple.quarantine "/Applications/只言.app"
open "/Applications/只言.app"
```

### 数据在哪

```
~/Library/Application Support/只言/notes.db      全部记忆
~/Library/Application Support/只言/media/       录音 m4a + 导出文件
```

设置页底部有一行显示这个路径。删掉 App 不会删数据，删掉这个目录才会。

---

## 三、iOS 模拟器安装

```bash
xcrun simctl list devices available                    # 找一个已启动或可启动的机型
xcrun simctl boot "iPhone 17 Pro"                     # 按你的机型改
xcrun simctl install booted ZhiYan.app
xcrun simctl launch  booted com.duketao.zhiyan
```

也可以直接双击 `ZhiYan.app` 丢进模拟器。

只适配 arm64 Apple Silicon 模拟器，仅竖屏。

---

## 四、怎么确认它真的能用（而不是看着像）

### 自己验

1. 打开 App → 首次会弹引导，点「开始记录」
2. 在输入框写一句带中文的话 → 点「记下来」
3. 关掉 App → 重新打开 → **记忆还在**（这一条就能证明落库了）
4. 切到「搜索」→ 输入刚才那句话里的**两个字**，比如「包子」
   → **能搜到**（两个字能搜到，说明走的是 FTS5 不是字符串匹配）
5. 设置 → 导出 Markdown → 桌面上出现一个 `.md` 文件

### 我们已经跑过的验证

```bash
./build/build.sh test    # 数据层 43 项断言
./build/build.sh all     # 编译双端 + 组包 + 签名 + DMG
```

App 内置了三套端到端自检，在页面里真调原生桥接（不是 mock），可以从命令行直接跑：

```bash
# ① 检索链路：11 项
./dist/只言.app/Contents/MacOS/只言 --act selftest
# 期望输出：[selftest] RESULT=PASS（通过 11 / 失败 0）

# ② 录音链路：6 项（真录 2 秒音频，验文件、入库、导出）
./dist/只言.app/Contents/MacOS/只言 --act rectest
# 期望输出：[selftest] RESULT=PASS（通过 6 / 失败 0）

# ③ 页面几何诊断（排查 iOS 视口缩放/布局错位用）
./dist/只言.app/Contents/MacOS/只言 --act probe
# 结果同时写进 ~/Library/Application Support/只言/probe.txt
```

①的断言：落库条数、搜「包子」(2字)、「李彦」(2字)、「雨」(1字)、
「咖啡」(不该命中时确实 0)、「包子店」(3字)、「SOHO」(西文)、
按标签「早餐店」检索、「李彦+米线」(AND 命中)、
「李彦+包子」(AND 不该命中时确实 0)、统计条数、导出落盘。
其中「咖啡」和两个 AND 反例是关键——它们能证伪"其实是字符串匹配"。

②的断言：录音时长 > 1 秒、返回文件路径、语音记录已入库、
入库带音频路径、状态为「待转写」、导出落在预期目录。

iOS 侧跑同一套（需串行，且先预授权麦克风）：

```bash
UDID=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys;print(json.load(sys.stdin)["devices"][next(iter(json.load(sys.stdin)["devices"]))])[0]["udid"])' 2>/dev/null)
xcrun simctl privacy "$UDID" grant microphone com.duketao.zhiyan
xcrun simctl launch "$UDID" com.duketao.zhiyan --act rectest
```

iOS 侧的数据也直接查过库：

```bash
sqlite3 "$(xcrun simctl get_app_container booted com.duketao.zhiyan data)/Documents/只言/notes.db" \
  "SELECT count(*) FROM notes;"
```

---

## 五、要 iOS 真机包的话

**证书是有的**（本机有 Apple Development 证书，团队 `H4YQZB7M2V`，付费账号），
只差一份 provisioning profile。生成之后重新打包即可，代码不用改：

```bash
# 1. 在 Xcode 里登录账号（Xcode → Settings → Accounts）
# 2. 打开 build/ios/（临时建个工程）或用 Xcode 的 Account 管理面板添加设备，
#    勾选自动生成 profile
# 3. 改 build/build.sh 里的编译目标为真机：
#    xcrun -sdk iphoneos swiftc -target arm64-apple-ios26.0 ...
#    并且 Info.plist 要去掉 UIRequiredDeviceCapabilities / 改 CFBundleIdentifier
```

---

## 六、自行重新打包

```bash
./build/build.sh          # 全流程：测试 → 双端编译 → 组包 → 签名 → DMG
./build/build.sh mac      # 只打 mac
./build/build.sh ios      # 只打 iOS 模拟器
./build/build.sh test     # 只跑数据层测试
```

脚本里每一步都带校验，漏一步会直接失败而不是产出一个看着没问题的包：
Web 资源拷完逐个比对哈希、二进制进包后比对 LC_UUID、模拟器包检查
`IOSSIMULATOR` 平台标记、签名后 `codesign --verify --strict`。

---

## 七、本次修掉的问题（都是实测发现的，不是猜的）

1. **`unicode61` 分词器对中文不是开箱可用。** 方案里写的「unigram 表负责 1-2 字符兜底」
   直接照做是不成立的——它把整串汉字当一个 token，查「包子」永远 0 命中。
   解法是写入 unigram 表时**逐字插空格**。这条已同步修正到 `PRODUCT-PLAN.md`。
2. **unigram 表必须同时索引标签和摘要**，否则「标签叫咖啡、正文不写咖啡」的记录搜不到。
3. **空值绑定**：Swift 里 `nil as Any` 得到的不是 `NSNull`，
   会走 `String(describing:)` 把字面量 `"nil"` 写进数据库。列表页会渲染出一行字面量 nil。
4. **iOS 采集页自动聚焦导致引导弹层期间拉起键盘**，
   iOS 把可视视口压到 377px、页面放大 6.7%，屏幕左上角留下一条系统渲染残留的蓝色竖条。已修。
5. **壳里 `guard let path = opts.snapshotPath` 让 `--act` 静默失效**——
   不传截图路径时 action 根本不执行，且没有任何报错。
6. **`evaluateJavaScript` 不接受顶层 `return`**（当成 SyntaxError），
   自检脚本必须包在 IIFE 里。
7. **自检 action 也走截图逻辑，会被自己杀掉。** 截图固定在 action 触发 0.9 秒后
   截图并 `exit`，而录音自检要录 2 秒——表现是"脚本启动了但一条断言都没输出，退出码还是 0"。
   现在 `selftest` / `rectest` / `probe` 三者跳过截图分支。
8. **`WKUserContentController` 对 message handler 只持弱引用**，没人强持有时
   `postMessage` 静默失败、Promise 永不 resolve，页面表现就是"按钮点了没反应"。
   handler 已存为 AppDelegate 的强引用属性。
9. **`--page` 深链被双重编码**：`comps.fragment = h` 把已含 `#` 的值编成
   `#%23/search`，结果自拍后停在首页。已改为先剥前导 `#`。

### 三个静默失败点的共同教训

第 5、7、8 条都是**不报错、有时退出码还是 0，但功能没生效**。
遇到"命令跑了、什么都没发生"，不要靠加日志猜——**先做对照实验**
（新旧包、两种参数各跑一次），再补日志。

---

## 八、文件清单

| 文件 | 说明 |
|---|---|
| `只言.dmg` | macOS 安装包（691 KB，ad-hoc 签名 + hardened runtime） |
| `只言.app` | 同上内容，免挂载直接运行 |
| `ZhiYan.app` | iOS 模拟器 App bundle |
| `ZhiYan-iOS-sim.zip` | 同上内容的压缩包，方便传输 |
| `README-安装说明.md` | 本文件 |
| `MemoryNotes-sim.app` | **旧包，已作废**，请勿使用 |

## 九、这一版的自检结果（2026-10-13 实跑）

| 项目 | 结果 |
|---|---|
| 数据层单元测试 | **43 / 43 通过** |
| mac 端检索自检 | **11 / 11 PASS** |
| mac 端录音自检 | **6 / 6 PASS** |
| iOS 端录音实测 | **2014 ms**，落库 `source=voice / state=pending`；`afinfo` 确认 AAC 单声道 44.1kHz 2.0187 秒；`ffmpeg volumedetect` 得 mean −52.3 dB / max −36.0 dB（真实环境音） |
| iOS 库直查 | 3 条记录，双 FTS 索引齐全，1字/2字/标签/3字检索全部命中 |
| iOS 蓝色竖条回归 | 381 px → **0 px** |
| DMG 完整性 | `hdiutil verify` 通过 |

**唯一没做的是 iOS 真机包**——需要你把 iPhone 用数据线连到这台 Mac，
Xcode 才能读到 UDID、注册设备、生成 provisioning profile。
插上之后告诉我一声，剩下的我来跑，代码一行都不用改。
