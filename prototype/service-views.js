const protocolName = (p) =>
  ({
    openai: "OpenAI · Chat Completions",
    "openai-responses": "OpenAI · Responses",
    anthropic: "Anthropic · Messages",
    transcription: "语音转写 · OpenAI 兼容",
  })[p] || p;
function serviceNav(title, copy) {
  return `<div class="service-heading"><button class="text-link" data-act="nav" data-p="settings">${svg("arrowL")} 设置</button><p class="eyebrow">让记忆，得到一点照顾</p><h1>${title}</h1><p>${copy}</p></div>`;
}
function providerProtocolHTML(provider) {
  const protocols = [
    "openai",
    "openai-responses",
    "anthropic",
    "transcription",
  ];
  const disabled = Services.working ? "disabled" : "";
  if (state.platform === "ios")
    return `<label>接口协议<select data-provider-field="protocol" ${disabled}>${protocols.map((value) => `<option value="${value}" ${provider.protocol === value ? "selected" : ""}>${protocolName(value)}</option>`).join("")}</select></label>`;
  return `<div class="service-field"><span id="protocol-label">接口协议</span><div class="protocol-picker">
    <button type="button" id="provider-protocol" class="service-select" data-provider-field="protocol" value="${esc(provider.protocol)}" role="combobox" aria-labelledby="protocol-label" aria-controls="protocol-options" aria-haspopup="listbox" aria-expanded="false" ${disabled}><span class="protocol-value">${esc(protocolName(provider.protocol))}</span>${svg("chevron")}</button>
    <div id="protocol-options" class="settings-list protocol-menu" role="listbox" aria-labelledby="protocol-label" hidden>${protocols.map((value, index) => `<div id="protocol-option-${index}" class="setting-row protocol-option" role="option" data-value="${value}" aria-selected="${provider.protocol === value}"><span>${protocolName(value)}</span>${svg("check")}</div>`).join("")}</div>
  </div></div>`;
}
function pageProviders() {
  const p = Services.providerDraft;
  return `<section class="settings-page services-page">${serviceNav("模型服务", "接入你自己的服务商。文字整理与语音转写可以各选一家。")}
 ${!ZY.native ? '<p class="service-notice">浏览器预览展示配置界面。请在应用里保存密钥和调用服务。</p>' : ""}
 <div class="service-list">${Services.providers.map((item) => `<article class="service-card"><div class="service-card-top">${flowerSVG(item.protocol === "anthropic" ? 2 : 0)}<div><h2>${esc(item.name)}</h2><p>${esc(protocolName(item.protocol))}</p></div><button class="btn" data-service="edit-provider" data-id="${esc(item.id)}">编辑</button></div><p class="service-model">${esc(item.model)}</p><p class="service-url">${esc(item.baseUrl)}</p><span class="status-pill">${Services.isDefault(item) ? "默认服务" : item.enabled ? "已启用" : "已停用"}</span>${!Services.isDefault(item) ? `<button class="text-link" data-service="default-provider" data-id="${esc(item.id)}">设为默认</button>` : ""}<button class="text-link service-remove" data-service="remove-provider" data-id="${esc(item.id)}">移除</button></article>`).join("")}</div>
 ${
   !p
     ? `<button class="btn btn-primary" data-service="new-provider">${svg("sparkle")} 添加自定义服务商</button>`
     : `<form class="service-form"><div class="service-form-title"><h2>${Services.providers.some((x) => x.id === p.id) ? "编辑服务" : "添加自定义服务商"}</h2><button type="button" class="icon-button" data-service="close-provider" aria-label="关闭编辑">${svg("x")}</button></div>
 <label>服务名称<input data-provider-field="name" value="${esc(p.name)}" placeholder="给这个服务起个名字" maxlength="80" ${Services.working ? "disabled" : ""}></label>
 ${providerProtocolHTML(p)}
 <label>服务地址<input data-provider-field="baseUrl" type="url" value="${esc(p.baseUrl)}" placeholder="https://你的服务地址/v1" autocapitalize="none" spellcheck="false" ${Services.working ? "disabled" : ""}></label>
 <label>模型名称<input data-provider-field="model" value="${esc(p.model)}" placeholder="填写服务商提供的模型 ID" autocapitalize="none" spellcheck="false" ${Services.working ? "disabled" : ""}></label>
 <label>API Key<input id="provider-key" type="password" value="${esc(Services.providerKey)}" autocomplete="new-password" placeholder="${Services.providers.some((x) => x.id === p.id) ? "留空保留已保存的密钥" : "填写你的 API Key"}" ${Services.working ? "disabled" : ""}></label>
 <label class="service-check"><input data-provider-field="enabled" type="checkbox" ${p.enabled ? "checked" : ""}> 启用这个服务</label>
 <p class="service-help">测试会向此地址发出真实请求，可能产生少量费用；转写测试使用一秒静音。密钥仅保存在本机安全存储，不随记忆同步。</p>
 <div class="service-actions"><button type="button" class="btn" data-service="test-provider" ${Services.working || !ZY.native ? "disabled" : ""}>测试连接</button><button type="button" class="btn btn-primary" data-service="save-provider" ${Services.working || !ZY.native ? "disabled" : ""}>保存配置</button></div></form>`
 }
 ${Services.providerMessage ? `<p class="service-result" role="status">${esc(Services.providerMessage)}</p>` : ""}
 <div class="settings-group"><h2>处理中的记忆</h2><p class="service-help">在记忆详情中选择“AI 整理”或“转写录音”。内容会直接发送到所选服务商，原始记录会保留。</p>${Services.jobs.length ? Services.jobs.map((j) => `<div class="job-row"><div><b>${j.kind === "transcription" ? "语音转写" : "摘要与标签"}</b><p>${esc({ pending: "等待处理", running: "正在处理", failed: "处理失败", stale: "原文已修改，请从详情重新发起" }[j.status] || j.status)}${j.error ? " · " + esc(j.error) : ""}</p></div>${j.status === "failed" ? `<button class="btn" data-service="retry-job" data-id="${esc(j.id)}">重试</button>` : ""}</div>`).join("") : '<p class="service-help">目前没有待处理的任务。</p>'}</div></section>`;
}
function pageSync() {
  const a = Services.sync.account,
    f = Services.accountForm;
  return `<section class="settings-page services-page">${serviceNav("账号与同步", "在手机和电脑上，照顾同一座记忆花园。")}
 ${
   Services.sync.enabled
     ? `<article class="service-card sync-overview">${gardenSVG("small")}<h2>${esc(a.username)}</h2><p>${esc(a.url)}</p><div class="sync-counts"><span><b>${Services.sync.pending || 0}</b> 等待同步</span><span><b>${Services.sync.conflicts || 0}</b> 修改冲突</span></div><p class="service-help">${Services.sync.last_synced ? "最近同步：" + new Date(Services.sync.last_synced).toLocaleString("zh-CN") : "还没有完成首次同步"}</p><div class="service-actions"><button class="btn btn-primary" data-service="sync" ${Services.syncing ? "disabled" : ""}>${Services.syncing ? "同步中…" : "立即同步"}</button><button class="btn" data-service="logout">退出同步</button></div></article>`
     : `<form class="service-form"><label>同步服务地址<input data-account-field="url" type="url" value="${esc(f.url)}" placeholder="https://你的同步服务地址" autocapitalize="none" spellcheck="false"></label><label>用户名<input data-account-field="username" value="${esc(f.username)}" placeholder="3–50 位字母、数字、下划线" autocomplete="username" autocapitalize="none"></label><label>密码<input data-account-field="password" type="password" value="${esc(f.password)}" placeholder="至少 12 个字符" autocomplete="current-password"></label><label>邀请码 <span>注册时按服务要求填写</span><input data-account-field="invite_code" value="${esc(f.invite_code)}" autocomplete="off"></label><p class="service-help">登录并开启后，当前资料库里的文字、标签与录音会上传至这个服务，供你的其他设备使用。离线记录仍保存在本机。</p><div class="service-actions"><button type="button" class="btn btn-primary" data-service="login" ${Services.working || !ZY.native ? "disabled" : ""}>登录并开启同步</button><button type="button" class="btn" data-service="register" ${Services.working || !ZY.native ? "disabled" : ""}>注册账号</button></div></form>`
 }
 ${Services.syncMessage ? `<p class="service-result" role="status">${esc(Services.syncMessage)}</p>` : ""}
 ${Services.conflicts
   .map(
     (c) =>
       `<article class="service-card conflict-card"><h2>这条记忆在两台设备上都有修改</h2><div class="conflict-options"><div><h3>本机版本${c.local?.deleted ? " · 已删除" : ""}</h3><p>${esc(c.local?.raw || c.local?.transcript || "录音记忆")}</p></div><div><h3>云端版本${c.remote.note.deleted ? " · 已删除" : ""}</h3><p>${esc(c.remote.note.raw || c.remote.note.transcript || "录音记忆")}</p></div></div><div class="service-actions">${[
         ["both", "两份都保留"],
         ["local", "使用本机版本"],
         ["remote", "使用云端版本"],
       ]
         .map(
           ([v, l]) =>
             `<button class="btn ${v === "both" ? "btn-primary" : ""}" data-service="resolve" data-id="${esc(c.id)}" data-choice="${v}">${l}</button>`,
         )
         .join("")}</div></article>`,
   )
   .join("")}
 <p class="service-help">文字按变更同步；录音上传后可在另一端按需下载。API Key、设备上的文件路径和搜索索引不会上传。</p></section>`;
}
