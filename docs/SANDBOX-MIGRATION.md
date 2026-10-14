# macOS 沙盒：旧数据迁移方案

> 状态：**方案文档，尚未实现，待 Mac 上验证**。属于 PR #6（feat/t2-xcode-project）的后续工作；在实现并实测之前，不要发布开启 App Sandbox 的 macOS 版本给已有用户。

## 1. 问题

`build/build.sh` 产出的现有 macOS 版本**未开沙盒**，数据位于：

| 内容 | 位置 |
|---|---|
| 数据库 | `~/Library/Application Support/只言/notes.db`（+ `-wal`、`-shm`） |
| 录音等附件 | `~/Library/Application Support/只言/media/` |
| 界面偏好（草稿、主题、侧栏、录音草稿、引导、隐私同意 `aiConsent`） | `~/Library/Application Support/只言/preferences.json`（与 `notes.db` 同目录，由 `build/NativeBridge.swift` 直接读写；随目录一起迁移）。PR #4 起 `aiConsent` 另外镜像写入数据库 `app_meta.preferences`，启动时从 preferences.json 重新同步 |
| API Key、同步令牌、对外接口密钥 | 登录钥匙串，service 前缀 `com.duketao.zhiyan.credentials.` |

开启 App Sandbox 后，`FileManager.urls(for: .applicationSupportDirectory)` 返回容器内路径
`~/Library/Containers/com.duketao.zhiyan/Data/Library/Application Support/只言/`。
沙盒 App **读不到**旧路径，用户升级后会看到空的资料库（旧数据仍在磁盘上，但对 App 不可见）。

## 2. 方案（推荐：系统容器迁移 + 应用内校验）

### 2.1 `container-migration.plist`（首选，零交互）

macOS 在沙盒 App **第一次启动、容器尚未创建时**，会按 App 包内 `Contents/Resources/container-migration.plist` 把列出的文件**移动**进容器。

```xml
<plist version="1.0"><dict>
  <key>Move</key>
  <array>
    <string>${ApplicationSupport}/只言</string>
  </array>
</dict></plist>
```

- 加入 `ZhiYan-macOS` target 的 resources（只 macOS）。
- 只在容器首次创建时生效一次；容器已存在（例如之前装过沙盒测试版）时**不会**再迁移 → 需要 2.2 兜底。
- 是“移动”而非复制：迁移后旧版（非沙盒）App 将看到空目录。发布说明里要写清楚“升级后不要再打开旧版”。

### 2.2 应用内兜底：首次启动检查 + 用户授权导入

在 `Data.swift` 打开数据库前：

1. 若容器内 `只言/notes.db` 不存在或为空库，且 `UserDefaults` 未标记 `legacyMigrationDone`：
2. 弹出说明：“检测到可能存在旧版数据，请选择旧数据文件夹以导入”，用 `NSOpenPanel` 预置到 `~/Library/Application Support/只言`（entitlement `com.apple.security.files.user-selected.read-only` 已在 `apple/Config/ZhiYan-macOS.entitlements` 声明，用户选择即授权，不申请任意读权限）。
3. 校验所选目录：`notes.db` 可用 `PRAGMA integrity_check` 打开；`PRAGMA user_version` 不高于当前版本。
4. **复制**（不移动）`preferences.json`、`notes.db`、`-wal`、`-shm`（先在源库上 `wal_checkpoint(TRUNCATE)` 不可行，因为只读——改为用 SQLite backup API 从源库备份到容器内新文件，保证一致性）与 `media/`。
5. 成功后写 `legacyMigrationDone=true`，提示用户旧目录可手动删除（App 不自动删除）。
6. 用户取消：写 `legacyMigrationDone=declined`，设置页提供“从旧版导入…”入口可再次触发。

### 2.3 钥匙串

- 现有条目由未签名/ad-hoc 签名 App 写入，访问控制绑定旧签名；沙盒正式签名的 App 读取时可能失败或弹授权框。
- 处理：读取失败时视为“未保存”——模型服务显示“请重新填写 API Key”，同步显示“请重新登录”，对外接口重新生成访问密钥。**不**尝试绕过钥匙串访问控制。
- 新条目写入 `keychain-access-groups`（`$(AppIdentifierPrefix)com.duketao.zhiyan`），与 iOS 一致。

### 2.4 同步用户

已开启同步的用户即使本地迁移失败，也可重新登录同步账号拉回文字和录音；迁移失败提示里应给出这一选项。但同步不是端到端加密、且未同步的修改（`sync_outbox`）只在本地，因此仍以本地迁移为主。

## 3. 验证清单（Mac）

1. 用当前 `build.sh mac` 版本写入：若干文字记忆、带录音的记忆、草稿、主题、模型服务 + Key、同步登录。
2. 安装沙盒版（Release，正式签名）→ 首次启动：数据、录音可播放、草稿与主题保留；Key/令牌按 2.3 的预期表现。
3. 删除容器（`~/Library/Containers/com.duketao.zhiyan`）后，先启动一次沙盒版造空容器，再放回旧数据 → 验证 2.2 兜底导入。
4. 损坏的 `notes.db`、更高 `user_version` 的库 → 拒绝导入、不覆盖容器内数据。
5. 迁移后启动旧版（非沙盒）→ 行为符合发布说明。

## 4. 不做的事

- 不申请 `com.apple.security.temporary-exception.files.home-relative-path.read-write`（审核风险，且是长期越权）。
- 不自动删除旧目录。
