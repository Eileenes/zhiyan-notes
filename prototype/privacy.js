// Third-party model consent and the in-app privacy policy page.
// Consent is per provider *and* its server origin: changing the address of a
// provider asks again. It is persisted with the other preferences (native
// app_meta / UserDefaults-backed prefs, or localStorage in the preview).
const Consent = {
  pref: "aiConsent",
  key(p) {
    let origin = "";
    try {
      origin = new URL(p.baseUrl || "").origin;
    } catch {}
    return `${p.id}|${origin}`;
  },
  all() {
    try {
      const v = JSON.parse(Prefs.get(this.pref, "{}") || "{}");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  },
  has(p) {
    return !!(p && this.all()[this.key(p)]);
  },
  async grant(p) {
    const all = this.all();
    all[this.key(p)] = Date.now();
    await Prefs.set(this.pref, JSON.stringify(all));
  },
  async revokeAll() {
    await Prefs.set(this.pref, "{}");
  },
  pending: null,
  // Resolves true once the user agrees (or already had), false on cancel.
  async ensure(p, purpose) {
    if (!p || this.has(p)) return true;
    if (this.pending) this.pending.resolve(false);
    return new Promise((resolve) => {
      this.pending = { provider: p, resolve };
      showConsent(p, purpose);
    });
  },
  async answer(agree) {
    const pending = this.pending;
    this.pending = null;
    document.getElementById("overlay").innerHTML = "";
    if (!pending) return;
    if (agree) {
      try {
        await this.grant(pending.provider);
      } catch (error) {
        toast(error.message, "error");
        return pending.resolve(false);
      }
    }
    pending.resolve(agree);
  },
};
function consentHost(p) {
  try {
    return new URL(p.baseUrl).host;
  } catch {
    return p.baseUrl || "";
  }
}
function showConsent(p, purpose) {
  const what = {
    summary: "这条记忆的文字内容",
    transcription: "这段录音的音频",
    gateway: "外部应用的提问，以及从你的记忆中检索到的相关内容",
  }[purpose] || "所选内容";
  document.getElementById("overlay").innerHTML =
    `<div class="recording-scrim"><section class="recording-panel consent-panel" role="dialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body"><h2 id="consent-title">发送到第三方模型服务前，请确认</h2><div id="consent-body"><p>只言将把<b>${esc(what)}</b>发送到「${esc(p.name || "未命名服务")}」（${esc(consentHost(p))}）进行处理。</p><p>该服务由第三方运营，只言无法控制其如何保存或使用这些内容。请只在你信任这个服务商时继续。</p><p class="service-help">同意后，对这个服务商（同一地址）不再询问；可在「设置 · 隐私」中撤回。</p></div><div class="recording-actions"><button class="text-link" data-act="nav-privacy">阅读隐私政策</button><button class="btn" data-act="consent-no">取消</button><button class="btn btn-primary" data-act="consent-yes">同意并继续</button></div></section></div>`;
  document.querySelector('[data-act="consent-yes"]')?.focus();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "consent-yes") Consent.answer(true);
  if (act === "consent-no") Consent.answer(false);
  if (act === "nav-privacy") {
    Consent.answer(false);
    navigate("privacy");
  }
  if (act === "consent-revoke")
    Consent.revokeAll().then(() => {
      toast("已撤回所有模型服务的发送授权。");
      render();
    });
});
function pagePrivacy() {
  const granted = Object.keys(Consent.all()).length;
  return `<section class="settings-page privacy-page"><div class="page-heading"><div><p class="eyebrow">只言 · 隐私政策</p><h1>你的记忆，归你所有</h1></div>${flowerSVG(1)}</div>
  <article class="service-card privacy-text">
  <p class="service-help">生效日期：2026 年 10 月 · 适用于只言 0.7 及以后版本</p>
  <h2>1. 默认只保存在本机</h2><p>你写下的文字、录音、标签和整理结果默认只保存在当前设备的本地数据库中。只言开发者不运营收集这些内容的服务器，也不包含广告或第三方统计 SDK。</p>
  <h2>2. 第三方模型服务（可选）</h2><p>只有当你在「模型服务」中添加了服务商，并主动点击「AI 整理」「转写录音」或开启带问答的对外接口时，相应内容才会直接从你的设备发送到你配置的服务商。首次发送到某个服务商前，只言会弹窗请求你的同意，并记录同意时间。这些服务商由第三方运营，其处理方式受其自身政策约束。API Key 仅保存在系统安全存储中，不会同步。</p>
  <h2>3. 同步服务（可选）</h2><p>登录同步账号后，记忆的文字、标签和录音会上传到你填写的同步服务，供你的其他设备使用。传输使用 HTTPS，但这不是端到端加密：同步服务的运营者在技术上可以读取内容。API Key、设备上的文件路径和搜索索引不会上传。</p>
  <h2>4. 对外接口（可选）</h2><p>对外接口只监听本机 127.0.0.1，需要访问密钥，退出应用后停止。</p>
  <h2>5. 你的权利</h2><p>你可以随时导出（Markdown / JSON）、编辑或删除记忆；在「账号与同步」中退出或删除同步账号，删除账号会移除服务器上该账号的全部记忆、录音、会话和设备记录；运营者的备份可能在其备份保留期内仍保留副本。你也可以在下方撤回对模型服务的授权。</p>
  <h2>6. 未成年人</h2><p>如果你未满 14 周岁，请在监护人同意和指导下使用。</p>
  <h2>7. 变更与联系</h2><p>本政策更新时会在应用内说明。问题与请求请通过项目主页反馈。</p>
  </article>
  <div class="settings-group"><h2>模型服务授权</h2><div class="settings-list"><div class="setting-row">${svg("shield")}<div><b>已授权的服务商</b><p>${granted ? `已对 ${granted} 个服务商（地址）同意发送内容。` : "尚未向任何服务商发送过内容。"}</p></div><button class="btn" data-act="consent-revoke" ${granted ? "" : "disabled"}>全部撤回</button></div></div></div>
  </section>`;
}
