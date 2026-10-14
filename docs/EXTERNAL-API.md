# 只言对外接口（本机）

入口：**设置 → 对外接口**。在 Mac 或 Windows 桌面版点击“开启接口”，复制访问密钥，再复制客户端需要的连接配置。默认端口 `17321`，仅监听 IPv4 回环地址 `127.0.0.1`。

开关和端口保存在本机，不参与账号同步；每次启动应用后需要手动开启接口，退出应用后接口停止。iOS / Android 设置页提供说明，不在移动端启动后台服务器。不要将本机接口通过代理、隧道或端口转发公开到外网；本次实现没有远程账号授权流程。

## MCP

地址：`http://127.0.0.1:17321/mcp`。使用 **Streamable HTTP**，返回 JSON，不提供旧版 `/sse` 传输。支持协商 `2025-03-26`、`2025-06-18`、`2025-11-25`。无服务端会话 ID；每次请求都需要 Bearer 认证。

适用于接受 `mcpServers` 配置的 HTTP MCP 客户端；不同客户端的配置入口可能不同：

```json
{
  "mcpServers": {
    "zhiyan": {
      "type": "http",
      "url": "http://127.0.0.1:17321/mcp",
      "headers": { "Authorization": "Bearer YOUR_ZHIYAN_KEY" }
    }
  }
}
```

设置里的“复制 MCP 配置”会填入真实访问密钥。不要将复制出来的配置提交到代码仓库或发给不需要访问记忆的应用。

| 工具 | 参数 | 能力 |
| --- | --- | --- |
| `search_memories` | `query`，可选 `limit`（1–50，默认 10） | 本机全文关键词检索，多关键词用空格隔开 |
| `get_memory` | `id` | 读取文字、转写、摘要、标签和时间 |
| `create_memory` | `text`，可选 `tags`、`request_id` | 新增文字记忆，需单独开启写入权限 |

默认只开放前两个工具。写入工具不允许编辑、删除或恢复现有记忆。`request_id` 接受 UUID：同一个 ID 和相同内容重复提交不会重复创建；相同 ID 换成不同内容会报错，已删除记录不会被恢复。新增记录走现有数据库和同步待办，可在只言中查看，并在开启账号同步后同步到其他设备。页面在空闲时每 5 秒检测外部写入，编辑草稿时延后刷新。

低层客户端先 `initialize`，再发送 `notifications/initialized`。POST 请求需使用 `Content-Type: application/json`，`Accept: application/json, text/event-stream`；初始化之后发送协商后的 `MCP-Protocol-Version`。GET / DELETE 返回 405，因为没有独立 SSE 订阅或服务端会话。

## OpenAI 兼容接口

- Base URL：`http://127.0.0.1:17321/v1`
- API Key：**只言对外接口的访问密钥**，不是模型服务商的密钥
- `GET /v1/models`
- `POST /v1/chat/completions`

| 模型 ID | 行为 |
| --- | --- |
| `zhiyan-memory-search` | 将最后一条用户消息作为关键词查询，返回包含 `memories` 的 JSON 文字；无需外部模型 |
| `zhiyan-memory` | 从自然语言问题提取搜索词，检索相关记忆，再交给配置的默认文字模型回答并引用记忆 ID |

问答模型只在启动接口时存在可用的默认文字模型及本机密钥时出现在模型列表里。默认文字模型可以使用 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 上游协议。修改模型服务后停止、重新开启接口，才会载入新配置及密钥。

问答会把用户问题发给模型服务提取关键词，再把相关记忆与对话发给同一服务生成回答，可能产生两次请求费用；没有检索到资料时直接返回未找到的说明。不通过问答执行写入或删除。

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:17321/v1",
    api_key="YOUR_ZHIYAN_KEY",
)
result = client.chat.completions.create(
    model="zhiyan-memory-search",
    messages=[{"role": "user", "content": "旅行"}],
)
print(result.choices[0].message.content)
```

支持普通文字 `messages`、单个 completion、`stream: false/true`。SSE 返回标准 `chat.completion.chunk` 与 `[DONE]`；当前共享模型适配器先取得完整回答，再用 SSE 格式发送，**不是上游逐 token 流式输出**。当前未实现对外 Responses API、工具调用、多模态、embeddings、结构化输出和 token 用量统计。温度、token 上限等尚未支持的参数会明确返回 400，不会静默忽略调用方的限制；客户端请只传示例中的参数和可选的 `stream`。

## 访问与限制

- 所有端点要求 `Authorization: Bearer …`，密钥保存在 Apple Keychain / Windows Credential Manager。
- 重置密钥后旧密钥失效，不影响记忆和上游模型密钥。
- 返回内容不包含本地录音路径、附件文件、模型凭据或账号凭据。
- 校验 Host 和 Origin；不提供跨域授权，不允许从任意网页跨域访问。
- 每分钟最多 120 个已认证请求，同时最多 4 个请求，请求体最多 128 KiB；超限分别返回 429 / 413。
- 上游问答失败返回 502；没有配置问答模型返回 503；未知模型返回 404。
- 端口被占用时会明确报错，可在停止状态修改端口。

## 开发与验证

核心与两种桌面壳共用 `core/src/gateway.rs`。Swift / Tauri 从系统凭据库读取密钥，将启动时的模型配置快照传给核心；数据库只保存非敏感配置。后台请求独立于界面线程执行。

```sh
cargo test --manifest-path core/Cargo.toml
cargo build --manifest-path core/Cargo.toml --bin zhiyan-core
uv run --with 'mcp>=1.20,<2' --with openai build/tests/verify-gateway-sdk.py
npm run test:ui
```

SDK 验证脚本使用临时资料库、临时端口和测试密钥。Rust 集成测试覆盖认证、协议协商、读写权限、幂等写入、密钥轮换、关闭与重启、限流、OpenAI JSON/SSE 和模拟模型问答。Mac 原生自检 `--act gateway-test` 必须搭配独立 `--database`。

协议参考：[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP 工具](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI SSE 格式](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)。
