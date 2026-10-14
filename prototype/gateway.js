// Settings and lifecycle for the native loopback gateway. Keys never enter preferences.
const ExternalAPI = {
  status: { supported: true, running: false, requests: 0 },
  config: { port: 17321, mcp: true, openai: true, allow_write: false },
  busy: false,
  message: "",
  ready: false,
  async refresh(initial = false) {
    if (!ZY.native) {
      this.ready = true;
      return;
    }
    const previous = this.status.last_change || 0;
    this.status = await ZY.call("gatewayStatus");
    if (initial) this.config = { ...this.status.config };
    this.ready = true;
    // External writes use the same DB/outbox. Refresh idle views without disturbing edits.
    const editing =
      state.edit ||
      state.busy ||
      state.recording ||
      Services.working ||
      document.activeElement?.matches("input, textarea, [role=combobox]");
    if (!editing && this.status.last_change > previous) {
      await ZY.load();
      Services.scheduleSync();
      if (["capture", "timeline", "search"].includes(state.page)) {
        if (state.page === "search") await runSearch();
        else render();
      }
    } else if (editing && this.status.last_change > previous) {
      this.status.last_change = previous;
    }
    const count = document.getElementById("gateway-request-count");
    if (count) count.textContent = this.status.requests || 0;
  },
  poll() {
    clearInterval(this.timer);
    if (!this.status.running) return;
    this.timer = setInterval(async () => {
      if (document.hidden || this.refreshing || this.busy) return;
      this.refreshing = true;
      try {
        await this.refresh();
      } catch {
        /* Retry on the next visible interval. */
      } finally {
        this.refreshing = false;
      }
    }, 5000);
  },
  async start() {
    try {
      await this.refresh(true);
      this.poll();
    } catch (error) {
      this.message = error.message;
    }
    if (["settings", "integrations"].includes(state.page)) render();
  },
  async control(action) {
    if (this.busy || !ZY.native || state.platform === "ios") return;
    if (action === "start") {
      // Q&A sends questions and matching memories to the default text model.
      const qa = Services.providers.find(
        (p) => p.protocol !== "transcription" && Services.isDefault(p),
      );
      if (qa && !(await Consent.ensure(qa, "gateway"))) return;
    }
    this.busy = true;
    this.message = "";
    render();
    try {
      const op = {
        start: "gatewayStart",
        stop: "gatewayStop",
        rotate: "gatewayRotate",
      }[action];
      this.status = await ZY.call(
        op,
        action === "start" ? { config: this.config } : {},
      );
      this.config = { ...this.status.config };
      this.message = {
        start: "已开启，可以使用下方地址连接。",
        stop: "已停止对外接口。",
        rotate: "访问密钥已重置，旧密钥立即失效，请更新调用方的配置。",
      }[action];
      this.poll();
    } catch (error) {
      this.message = "未完成：" + error.message;
    } finally {
      this.busy = false;
      render();
    }
  },
  async copy(kind) {
    try {
      const base = `http://127.0.0.1:${this.config.port}`;
      let value;
      if (kind === "key" || kind === "mcp") {
        const key = await ZY.call("gatewayKey");
        if (!key) throw new Error("请先开启接口，生成访问密钥。");
        value =
          kind === "key"
            ? key
            : JSON.stringify(
                {
                  mcpServers: {
                    zhiyan: {
                      type: "http",
                      url: `${base}/mcp`,
                      headers: { Authorization: `Bearer ${key}` },
                    },
                  },
                },
                null,
                2,
              );
      } else {
        value = base + (kind === "mcp-url" ? "/mcp" : "/v1");
      }
      if (window.zyNative && !window.__TAURI_INTERNALS__)
        await ZY.call("clipboardWrite", { text: value });
      else await navigator.clipboard.writeText(value);
      toast(kind === "key" ? "访问密钥已复制" : "连接配置已复制");
    } catch (error) {
      toast("复制未完成：" + error.message, "error");
    }
  },
};
document.addEventListener("input", (event) => {
  if (
    event.target.id === "gateway-port" &&
    !ExternalAPI.status.running &&
    !ExternalAPI.busy
  )
    ExternalAPI.config.port = Number(event.target.value);
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-gateway]");
  if (!button || button.disabled) return;
  const action = button.dataset.gateway;
  if (["start", "stop", "rotate"].includes(action)) ExternalAPI.control(action);
  if (action === "copy") ExternalAPI.copy(button.dataset.copy);
  if (action === "toggle" && !ExternalAPI.status.running && !ExternalAPI.busy) {
    const field = button.dataset.field;
    if (!["mcp", "openai", "allow_write"].includes(field)) return;
    ExternalAPI.config[field] = !ExternalAPI.config[field];
    button.setAttribute("aria-checked", String(ExternalAPI.config[field]));
  }
});
function pageIntegrations() {
  const api = ExternalAPI,
    config = api.config,
    running = api.status.running;
  const mobile = state.platform === "ios" || api.status.supported === false;
  const unavailable = !ZY.native || mobile || !api.ready;
  const locked = api.busy || running || unavailable;
  const base = `http://127.0.0.1:${config.port}`;
  const toggle = (field, label, copy) =>
    `<div class="setting-row"><div><b id="gateway-${field}-label">${label}</b><p>${copy}</p></div><button type="button" class="garden-switch" role="switch" aria-labelledby="gateway-${field}-label" aria-checked="${config[field]}" data-gateway="toggle" data-field="${field}" ${locked ? "disabled" : ""}><span></span></button></div>`;
  return `<section class="settings-page services-page gateway-page">${serviceNav("对外接口", "让其他应用，也能找到你种下的小记忆。")}
    ${mobile ? '<p class="service-notice">请在 Mac 或 Windows 版开启本机接口。手机端仍可通过账号同步使用同一份记忆。</p>' : !ZY.native ? '<p class="service-notice">这里是界面预览。请在桌面应用内开启真实接口。</p>' : ""}
    <article class="service-card gateway-overview"><div><span class="status-pill">${running ? "正在运行 · 仅限本机" : "尚未开启"}</span><h2>${running ? "花园的小门，已经打开" : "给记忆，留一扇小门"}</h2><p class="service-help">仅监听 127.0.0.1，所有请求都需要访问密钥。退出应用后停止，重新打开只言时需手动开启。</p></div>${flowerSVG(2)}<div class="service-actions"><button class="btn btn-primary" data-gateway="${running ? "stop" : "start"}" ${api.busy || unavailable ? "disabled" : ""}>${api.busy ? "正在处理…" : running ? "停止接口" : "开启接口"}</button>${running ? `<span class="gateway-requests">本次已接收 <b id="gateway-request-count">${api.status.requests || 0}</b> 个请求</span>` : ""}</div></article>
    ${api.message ? `<p class="service-result" role="status">${esc(api.message)}</p>` : ""}
    <div class="settings-group"><h2>开放哪些能力</h2><div class="settings-list">
      ${toggle("mcp", "MCP", "搜索、读取记忆；开启写入后可新增文字记忆。")}
      ${toggle("openai", "OpenAI 兼容 API", "用 OpenAI 客户端检索记忆，或向记忆库提问。")}
      ${toggle("allow_write", "允许 MCP 新增记忆", "默认只读。开启后，持有密钥的应用可以新增记录。")}
    </div><p class="service-help">${running ? "修改能力或端口前，请先停止接口。" : "原文和标签可被读取；密钥、录音文件和设备路径不会通过接口提供。"}</p></div>
    <div class="service-form gateway-connection"><label for="gateway-port">本机端口<input id="gateway-port" type="number" min="1024" max="65535" step="1" value="${config.port}" ${locked ? "disabled" : ""}></label><div class="gateway-secret"><div><b>访问密钥</b><p class="service-help">保存在本机安全存储。重置后，旧密钥立即失效。</p></div><button class="btn" data-gateway="copy" data-copy="key" ${!running || api.busy ? "disabled" : ""}>复制密钥</button><button class="text-link" data-gateway="rotate" ${!running || api.busy ? "disabled" : ""}>重置密钥</button></div></div>
    <div class="settings-group"><h2>连接到其他应用</h2>
      <article class="service-card gateway-endpoint"><span class="eyebrow">MCP · Streamable HTTP</span><h2>把记忆带给 AI 助手</h2><code>${esc(base)}/mcp</code><p class="service-help">在支持 HTTP MCP 的客户端添加服务，使用 Bearer 访问密钥。配置示例已包含认证请求头。</p><div class="service-actions"><button class="btn" data-gateway="copy" data-copy="mcp" ${!running || !config.mcp || api.busy ? "disabled" : ""}>复制 MCP 配置</button><button class="text-link" data-gateway="copy" data-copy="mcp-url" ${!running || !config.mcp ? "disabled" : ""}>复制地址</button></div></article>
      <article class="service-card gateway-endpoint"><span class="eyebrow">OpenAI · Chat Completions</span><h2>用熟悉的客户端，问问你的记忆</h2><code>${esc(base)}/v1</code><p class="service-help">将 Base URL 填为上方地址，API Key 填入只言的访问密钥。</p><div class="gateway-model"><b>zhiyan-memory-search</b><p>发送关键词，返回相关记忆的 JSON；无需模型服务。</p></div><div class="gateway-model"><b>zhiyan-memory</b><p>${api.status.provider_name ? "问答使用「" + esc(api.status.provider_name) + "」，会将问题和相关记忆发送到该服务。" : "配置默认文字模型后，重启接口即可启用记忆问答。"} 修改模型配置后需重启接口。</p></div><p class="service-help">支持文字消息和 SSE 响应格式；问答在生成完成后返回内容。</p><div class="service-actions"><button class="btn" data-gateway="copy" data-copy="openai" ${!running || !config.openai ? "disabled" : ""}>复制 Base URL</button><button class="text-link" data-act="nav" data-p="providers">配置问答模型 ${svg("arrowR")}</button></div>
      <details class="gateway-example"><summary>查看调用示例</summary><pre><code>${esc(`curl ${base}/v1/chat/completions \\\n  -H 'Authorization: Bearer YOUR_ZHIYAN_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"model":"zhiyan-memory-search","messages":[{"role":"user","content":"旅行"}]}'`)}</code></pre></details></article>
    </div></section>`;
}
