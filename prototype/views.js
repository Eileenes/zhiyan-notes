// Pure view functions. Drafts, asynchronous work and navigation live in app.js.
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const mmss = (value) => {
  const s = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
function highlight(text, q = "") {
  const terms = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return esc(text);
  const re = new RegExp(
    "(" +
      terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
      ")",
    "gi",
  );
  return String(text || "")
    .split(re)
    .map((s, i) => (i % 2 ? `<mark>${esc(s)}</mark>` : esc(s)))
    .join("");
}
const NAV = [
  ["capture", "mic", "记一笔"],
  ["timeline", "timeline", "记忆"],
  ["search", "search", "搜索"],
  ["settings", "gear", "设置"],
];
function shellHTML() {
  const ios = state.platform === "ios";
  const navItem = ([key, icon, label]) =>
    `<button class="${ios ? "ios-tab" : "sb-item"}" data-act="nav" data-p="${key}">${svg(icon)}<span>${label}</span>${key === "timeline" && !ios ? '<span id="nav-count" class="badge"></span>' : ""}</button>`;
  const navigation = NAV.filter(([key]) => ios || key !== "settings")
    .map(navItem)
    .join("");
  return ios
    ? `<div class="iphone"><header class="mobile-header"><span class="mobile-brand">${markSvg()}只言</span><span>你的小小记忆花园</span></header><main class="ios-content"><div class="ios-scroll"><div id="root"></div></div></main><nav class="ios-tabbar" aria-label="主导航">${navigation}</nav><div id="overlay"></div></div>`
    : `<div class="mac-window"><div class="mac-body"><aside class="sidebar"><div class="sb-brand"><span class="sb-mark">${markSvg()}</span><div><h1>只言</h1><span class="brand-caption">记忆慢慢，长成花园</span></div></div><nav class="sb-nav" aria-label="主导航">${navigation}</nav><div class="sidebar-garden">${gardenSVG("small")}<p>一点一滴，都值得留下。</p></div><div class="sb-foot">${navItem(NAV.find(([key]) => key === "settings"))}<p class="sb-storage"><span class="local-dot"></span> 安心存在这台设备</p></div></aside><main class="content"><div class="content-scroll"><div id="root"></div></div></main></div><div id="overlay"></div></div>`;
}
function emptyHTML(title, copy, action = true) {
  return `<div class="garden-empty">${flowerSVG(1)}<h2>${esc(title)}</h2><p>${esc(copy)}</p>${action ? `<button class="btn btn-primary" data-act="nav" data-p="capture">${svg("mic")} 记下第一件小事</button>` : ""}</div>`;
}
function pageCapture() {
  const recent = ZY.list.slice(0, 4);
  const date = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  return `<section class="home-page"><div class="garden-welcome"><div><p class="eyebrow">${esc(date)} <span class="little-sun">${svg("sun")}</span></p><h1>让记忆，<br>慢慢长出<span class="title-flower">花${flowerSVG(1)}</span>。</h1><p class="welcome-copy">一个念头、一句碎碎念，都可以种在这里。</p></div>${gardenSVG()}</div>
    ${state.loadError ? `<p class="search-error" role="alert">记忆暂时打不开：${esc(state.loadError)} <button class="btn" data-act="reload">重新打开</button></p>` : ""}<section class="composer" aria-labelledby="composer-title"><div class="composer-top"><label id="composer-title" for="cap-input">今天，想留下什么？</label><span class="paper-corner">随手记</span></div>
      <textarea id="cap-input" class="sheet-input" placeholder="路过一家喜欢的小店，或突然冒出的小想法……" ${!state.loaded || state.busy ? "disabled" : ""}>${esc(state.draft)}</textarea>
      <div class="sheet-foot"><span class="sheet-hint" id="draft-state">${state.draft ? "草稿已保留" : "只记你愿意记的"}</span><div class="sheet-actions"><button class="btn btn-mic" data-act="rec-start" ${state.busy || !state.loaded ? "disabled" : ""}>${svg("mic")} 说一句</button><button class="btn btn-primary" data-act="save-text" ${state.busy || !state.loaded ? "disabled" : ""}>${svg("send")} ${state.busy ? "保存中…" : "记下来"}</button></div></div>
    </section>
    <div class="recent-heading"><div><h2>最近种下的小事 <span class="section-sprout">${svg("sun")}</span></h2><p>不必写得完整，先把这一刻留下。</p></div><button class="text-link" data-act="nav" data-p="timeline">全部记忆 ${svg("arrowR")}</button></div>
    ${!state.loaded ? '<p class="loading" role="status">正在打开你的花园…</p>' : recent.length ? `<div class="recent-grid">${recent.map((n) => memoryCard(n, "", true)).join("")}</div>` : emptyHTML("第一颗种子，留给今天", "在上面写一句话，你的小花园就开始了。", false)}
    <p class="home-foot">${svg("shield")} 文字与录音先保存在本机</p>
  </section>`;
}
function memoryCard(n, q = "", compact = false) {
  const title = n.raw || "一段还没变成文字的声音";
  return `<button class="memory-card ${compact ? "compact" : ""} ${state.note?.id === n.id ? "selected" : ""}" data-act="open-mem" data-id="${esc(n.id)}">
    <div class="memory-meta"><span>${esc(n.day)} <span>${esc(n.time)}</span></span>${noteFlower(n.id)}</div>
    <p class="memory-text">${highlight(title, q)}</p>${n.summary && !compact ? `<p class="memory-summary">${highlight(n.summary, q)}</p>` : ""}
    <div class="memory-bottom"><span class="memory-source">${svg(n.source === "voice" ? "mic" : "keyboard")} ${n.source === "voice" ? mmss(n.dur) + " · " + (!(n.raw || n.transcript) ? "待转写" : "语音") : "文字"}</span><span class="memory-tags">${n.tags
      .slice(0, 3)
      .map((t) => `<span>${highlight(t, q)}</span>`)
      .join("")}</span></div>
  </button>`;
}
function pageTimeline() {
  const total = ZY.stats().total || 0;
  const groups = new Map();
  ZY.list.forEach((n) => {
    if (!groups.has(n.day)) groups.set(n.day, []);
    groups.get(n.day).push(n);
  });
  return `<section class="library-page"><div class="page-heading"><div><p class="eyebrow">一点一滴，长在这里</p><h1>我的记忆 <span>${total} 条</span></h1></div><button class="btn btn-primary" data-act="nav" data-p="capture">${svg("send")} 记一笔</button></div>
    <div class="memory-layout ${state.note ? "with-detail" : ""}"><div class="memory-list">${!total ? emptyHTML("这里会慢慢热闹起来", "从一句话开始，记下值得留下的小事。") : Array.from(groups, ([day, items]) => `<div class="date-heading">${esc(day === ZY.todayKey() ? "今天" : day)}<span></span></div>${items.map((n) => memoryCard(n)).join("")}`).join("")}
    ${ZY.list.length < total ? `<button class="btn load-more" data-act="load-more" ${state.busy ? "disabled" : ""}>${state.busy ? "正在打开…" : "看看更早的记忆"}</button>` : ""}</div>${state.note ? `<aside class="detail-pane">${pageDetail(true)}</aside>` : ""}</div></section>`;
}
function searchResultsHTML() {
  if (state.searching)
    return '<p class="loading" role="status">正在找回记忆…</p>';
  if (state.searchError)
    return `<div class="search-error" role="alert">${esc(state.searchError)}<button class="btn" data-act="search-retry">重试</button></div>`;
  if (!state.q.trim())
    return `<div class="search-intro">${flowerSVG(2)}<h2>想找回哪一件小事？</h2><p>试试一个人名、一家店，或当时记下的关键词。</p><span class="search-example">多个关键词用空格隔开</span></div>`;
  const hits = state.hits.filter(
    (n) => !state.source || n.source === state.source,
  );
  if (!hits.length)
    return emptyHTML(
      "还没找到这朵小花",
      "换个关键词试试，或调整记录类型。",
      false,
    );
  return `<p class="result-count">找到 ${hits.length} 条记忆${state.hits.length === 200 ? " · 显示前 200 条，请缩小关键词范围" : ""}</p>${hits.map((n) => memoryCard(n, state.q)).join("")}`;
}
function pageSearch() {
  return `<section class="search-page"><div class="page-heading"><div><p class="eyebrow">有些小事，再想起来也很美好</p><h1>找回一段记忆</h1></div></div>
    <div class="memory-layout ${state.note ? "with-detail" : ""}"><div><label class="search-box" for="q">${svg("search")}<input id="q" placeholder="搜索记忆里的关键词" autocomplete="off" value="${esc(state.q)}"><button data-act="clear-q" aria-label="清空搜索">${svg("x")}</button></label>
    <div class="search-filters" role="group" aria-label="记录类型">${[
      ["", "全部"],
      ["text", "文字"],
      ["voice", "语音"],
    ]
      .map(
        ([v, l]) =>
          `<button data-act="filter" data-source="${v}" aria-pressed="${state.source === v}" class="filter-chip ${state.source === v ? "on" : ""}">${l}</button>`,
      )
      .join(
        "",
      )}</div><div id="search-results" aria-live="polite">${searchResultsHTML()}</div></div>${state.note ? `<aside class="detail-pane">${pageDetail(true)}</aside>` : ""}</div></section>`;
}
function pageDetail(inline = false) {
  const n = state.note;
  if (!n)
    return emptyHTML("这条记忆已不在这里", "回到记忆列表，再看看其他小事。");
  const editing = state.edit !== null;
  return `<article class="detail-view"><div class="detail-heading"><button class="icon-button" data-act="close-detail" aria-label="${inline ? "关闭详情" : "返回列表"}">${svg(inline ? "x" : "arrowL")}</button><span>${esc(n.day)} · ${esc(n.time)}</span>${noteFlower(n.id)}</div>
    ${editing ? `<label class="field-label" for="edit-text">记忆正文</label><textarea id="edit-text" class="edit-text" ${state.busy ? "disabled" : ""}>${esc(state.edit.text)}</textarea><label class="field-label" for="edit-tags">标签 <span>用逗号隔开</span></label><input id="edit-tags" class="edit-tags" value="${esc(state.edit.tags)}" ${state.busy ? "disabled" : ""}>` : `<p class="detail-raw">${esc(n.raw || (n.transcript ? "" : "这段声音已留在本机，可选择转写录音。"))}</p>${n.summary ? `<div class="summary"><p>${esc(n.summary)}</p></div>` : ""}<div class="mem-tags">${n.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`}
    ${!editing && n.transcript ? `<div class="ai-output"><h3>语音转写</h3><p>${esc(n.transcript)}</p></div>` : ""}
    ${!editing && n.ai_tags?.length ? `<div class="mem-tags">${n.ai_tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    ${!n.audio && n.attachment_id ? `<button class="btn" data-service="download-audio" data-id="${esc(n.id)}">${svg("download")} 下载录音到本机</button>` : ""}
    ${n.audio ? `<div class="real-audio"><button class="icon-button audio-play" data-act="play" aria-label="播放录音">${svg("play")}</button><div><label for="audio-seek" class="sr-only">播放进度</label><input type="range" id="audio-seek" min="0" max="${Math.max(1, n.dur)}" step="0.1" value="0"><div class="audio-labels"><span id="audio-current">00:00</span><span>${mmss(n.dur)}</span></div></div></div>` : ""}
    <div class="detail-actions">${editing ? `<button class="btn btn-primary" data-act="save-edit" ${state.busy ? "disabled" : ""}>${state.busy ? "保存中…" : "保存修改"}</button><button class="btn" data-act="cancel-edit" ${state.busy ? "disabled" : ""}>取消</button>` : `<button class="btn" data-service="summary" data-id="${esc(n.id)}">${svg("sparkle")} AI 整理</button>${n.audio ? `<button class="btn" data-service="transcription" data-id="${esc(n.id)}">转写录音</button>` : ""}<button class="btn" data-act="edit">${svg("note")} 编辑</button><button class="btn" data-act="export" data-fmt="md" data-id="${esc(n.id)}">${svg("download")} 导出</button><button class="btn btn-ghost" data-act="delete" data-id="${esc(n.id)}">${svg("trash")} 删除</button>`}</div>
    <p class="detail-foot">${svg("shield")} 这段记忆，安心留在你的设备里。</p></article>`;
}
function pageSettings() {
  return `<section class="settings-page"><div class="page-heading"><div><p class="eyebrow">照顾好你的记忆花园</p><h1>设置</h1></div>${flowerSVG(0)}</div>
    <div class="settings-group"><h2>花园的光线</h2><div class="theme-options seg" role="radiogroup" aria-label="外观">${[
      ["system", "auto", "跟随系统"],
      ["light", "sun", "白日花园"],
      ["dark", "moon", "夜间花园"],
    ]
      .map(
        ([v, ic, label]) =>
          `<button class="seg-i ${state.theme === v ? "on" : ""}" data-act="theme" data-v="${v}" role="radio" aria-checked="${state.theme === v}">${svg(ic)}${label}</button>`,
      )
      .join("")}</div></div>
    <div class="settings-group"><h2>我的数据</h2><div class="settings-list"><div class="setting-row">${svg("shield")}<div><b>保存在这台设备</b><p>${ZY.native ? "离线也能记录。开启同步或 AI 时，内容会发送到你配置的服务。" : "当前为浏览器预览，数据仅用于演示。"}</p></div><span class="status-pill">本机</span></div>
      <button class="setting-row" data-act="nav" data-p="privacy">${svg("shield")}<div><b>隐私政策与授权</b><p>哪些内容会离开这台设备，以及如何撤回。</p></div>${svg("chevron")}</button>
      ${[
        ["md", "Markdown", "便于阅读的文字文件"],
        ["json", "JSON", "结构化记录，不包含音频文件"],
      ]
        .map(
          ([fmt, label, sub]) =>
            `<button class="setting-row" data-act="export" data-fmt="${fmt}">${svg("download")}<div><b>导出 ${label}</b><p>${sub}</p></div>${svg("chevron")}</button>`,
        )
        .join("")}</div></div>
    <div class="settings-group"><h2>记忆的照料</h2><div class="settings-list"><button class="setting-row" data-act="nav" data-p="providers">${svg("sparkle")}<div><b>模型服务</b><p>自定义服务商 · OpenAI / Anthropic 协议</p></div><span class="status-pill">${Services.providers.length ? Services.providers.length + " 个服务" : "未配置"}</span>${svg("chevron")}</button><button class="setting-row" data-act="nav" data-p="sync">${svg("cloud")}<div><b>账号与四端同步</b><p>iOS、Mac、Windows 与 Android 的同一座花园。</p></div><span class="status-pill">${Services.sync.enabled ? (Services.sync.pending ? "待同步" : "已开启") : "未开启"}</span>${svg("chevron")}</button></div></div>
    <div class="settings-group"><h2>连接更多可能</h2><div class="settings-list"><button class="setting-row" data-act="nav" data-p="integrations">${svg("sparkle")}<div><b>对外接口</b><p>MCP · OpenAI 兼容 API · 本机访问</p></div><span class="status-pill">${ExternalAPI.status.running ? "运行中" : "未开启"}</span>${svg("chevron")}</button></div></div>
    <div class="settings-about">${markSvg()}<span>只言 · 0.7<br><small>让每一件小事，都有生长的地方。</small></span></div></section>`;
}
function recordingHTML() {
  return `<div class="recording-scrim"><section class="recording-panel" role="dialog" aria-modal="true" aria-labelledby="rec-title"><div class="recording-flower">${flowerSVG(0)}</div><span class="rec-live">${state.pendingRecording ? "等待保存" : '<i class="rec-dot"></i> 正在录音'}</span><h2 id="rec-title">${state.pendingRecording ? "声音还在，试着再存一次。" : "慢慢说，我在听。"}</h2><p class="rec-time" id="rec-time">${mmss((state.pendingRecording?.dur || 0) / 1000)}</p><div class="recording-meter" aria-hidden="true">${Array.from({ length: 21 }, (_, i) => `<i style="--bar:${i}"></i>`).join("")}</div><p>声音先保存在本机，可在详情中选择转写。</p><div class="recording-actions"><button class="btn" data-act="rec-cancel">放弃这次录音</button><button class="btn btn-primary" data-act="rec-done">${svg("check")} 保存录音</button></div></section></div>`;
}
