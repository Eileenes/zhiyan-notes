// Shared orchestration for native Apple and Tauri clients. Secrets never enter preferences.
const Services = {
  providers: [],
  jobs: [],
  sync: {},
  ready: false,
  working: false,
  syncing: false,
  providerDraft: null,
  providerKey: "",
  providerMessage: "",
  syncMessage: "",
  accountForm: { url: "", username: "", password: "", invite_code: "" },
  conflicts: [],
  call(op, value = {}) {
    return ZY.call(op, value);
  },
  async refresh() {
    if (!ZY.native) {
      this.ready = true;
      return;
    }
    const data = await this.call("servicesGet");
    this.providers = data.providers;
    this.jobs = data.jobs;
    this.sync = data.sync;
    this.deviceID = await this.call("deviceID");
    this.ready = true;
    if (this.sync.account && !this.accountForm.url)
      this.accountForm.url = this.sync.account.url;
  },
  async start() {
    ExternalAPI.start();
    try {
      await this.refresh();
      this.processQueue();
      this.scheduleSync();
    } catch (error) {
      this.syncMessage = error.message;
    }
    if (["settings", "providers", "sync"].includes(state.page)) render();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.processQueue();
        this.scheduleSync();
      }
    });
    window.addEventListener("online", () => this.scheduleSync());
    this.timer = setInterval(() => {
      if (!document.hidden) {
        this.processQueue();
        this.scheduleSync();
      }
    }, 60000);
  },
  newProvider() {
    this.providerDraft = {
      id: crypto.randomUUID(),
      name: "",
      protocol: "openai",
      baseUrl: "",
      model: "",
      enabled: true,
    };
    this.providerKey = "";
    this.providerMessage = "";
    render();
  },
  editProvider(id) {
    this.providerDraft = { ...this.providers.find((p) => p.id === id) };
    this.providerKey = "";
    this.providerMessage = "";
    render();
  },
  async providerAction(testOnly) {
    if (this.working) return;
    this.working = true;
    this.providerMessage = testOnly
      ? "正在向这个服务发送测试请求…"
      : "正在保存…";
    render();
    try {
      const p = { ...this.providerDraft };
      const key =
        this.providerKey ||
        (await this.call("secretGet", { key: "provider." + p.id }));
      if (!key) throw new Error("请填写 API Key");
      if (testOnly) {
        const result = await this.call("providerTest", { provider: p, key });
        this.providerMessage = `连接成功 · ${result.model} · ${result.milliseconds} ms`;
      } else {
        // Validate metadata first; credentials are persisted only via native secure storage.
        const next = this.providers.some((item) => item.id === p.id)
          ? this.providers.map((item) => (item.id === p.id ? p : item))
          : this.providers.concat(p);
        await this.call("providersValidate", { providers: next });
        if (this.providerKey)
          await this.call("secretSet", { key: "provider." + p.id, value: key });
        this.providers = await this.call("providersSave", { providers: next });
        this.providerKey = "";
        this.providerMessage = "已保存，密钥保存在这台设备的安全存储中。";
      }
    } catch (error) {
      this.providerMessage = "未完成：" + error.message;
    } finally {
      this.working = false;
      render();
    }
  },
  async defaultProvider(id) {
    try {
      const item = this.providers.find((p) => p.id === id);
      if (!item) return;
      this.providers = await this.call("providersSave", {
        providers: [
          { ...item, enabled: true },
          ...this.providers.filter((p) => p.id !== id),
        ],
      });
      render();
    } catch (error) {
      toast(error.message, "error");
    }
  },
  isDefault(item) {
    return (
      this.providers.find(
        (p) =>
          p.enabled &&
          (p.protocol === "transcription") ===
            (item.protocol === "transcription"),
      )?.id === item.id
    );
  },
  async removeProvider(id) {
    if (this.working) return;
    try {
      this.providers = await this.call("providersSave", {
        providers: this.providers.filter((p) => p.id !== id),
      });
      await this.call("secretDelete", { key: "provider." + id });
      if (this.providerDraft?.id === id) this.providerDraft = null;
      render();
    } catch (error) {
      toast(error.message, "error");
    }
  },
  async enqueue(kind, id) {
    const provider = this.providers.find(
      (p) =>
        p.enabled &&
        (kind === "transcription"
          ? p.protocol === "transcription"
          : p.protocol !== "transcription"),
    );
    if (!provider) {
      navigate("providers");
      toast(
        kind === "transcription"
          ? "先添加一个语音转写服务。"
          : "先添加一个文字模型服务。",
        "error",
      );
      return;
    }
    if (!(await Consent.ensure(provider, kind))) {
      toast("已取消，内容没有发送。");
      return;
    }
    try {
      this.jobs = await this.call("aiEnqueue", {
        id,
        kind,
        provider_id: provider.id,
      });
      toast("任务已加入，可在设置中查看进度。");
      this.processQueue();
    } catch (error) {
      toast(error.message, "error");
    }
  },
  async processQueue() {
    if (this.processing || !ZY.native || !this.ready) return;
    this.processing = true;
    try {
      await this.refresh();
      for (const job of this.jobs.filter((j) => j.status === "pending")) {
        try {
          const key = await this.call("secretGet", {
            key: "provider." + job.provider_id,
          });
          await this.call("aiRun", { id: job.id, key });
          await ZY.load();
          if (state.note?.id === job.note_id)
            state.note = await ZY.get(job.note_id);
          this.scheduleSync();
        } catch (error) {
          this.providerMessage = error.message;
        }
        await this.refresh();
        if (
          !state.edit &&
          document.activeElement?.getAttribute("role") !== "combobox" &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName,
          )
        )
          render();
      }
    } catch (error) {
      this.providerMessage = error.message;
    } finally {
      this.processing = false;
    }
  },
  tokenKey() {
    const a = this.sync.account;
    return a ? "sync." + a.user_id : "sync.none";
  },
  async authenticate(register) {
    if (this.working) return;
    this.working = true;
    this.syncMessage = register ? "正在创建账号…" : "正在登录…";
    render();
    try {
      const form = {
        ...this.accountForm,
        register,
        device_id: this.deviceID,
        device_name:
          (navigator.userAgent.includes("Android")
            ? "Android"
            : state.platform === "ios"
              ? "iPhone"
              : navigator.userAgent.includes("Windows")
                ? "Windows"
                : "Mac") + " · 只言",
      };
      const result = await this.call("syncAuth", form);
      // Account binding refuses to mix different accounts' local data.
      this.sync = await this.call("syncBind", {
        url: form.url,
        user: result.user,
        device_id: this.deviceID,
      });
      await this.call("secretSet", {
        key: this.tokenKey(),
        value: result.token,
      });
      this.accountForm.password = "";
      this.accountForm.invite_code = "";
      this.syncMessage = "已登录，本机记忆将同步到这个账号。";
      this.scheduleSync();
    } catch (error) {
      this.syncMessage = "未完成：" + error.message;
    } finally {
      this.working = false;
      render();
    }
  },
  scheduleSync() {
    if (!this.ready || !this.sync.enabled || this.syncing) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.runSync(false), 1500);
  },
  async runSync(show = true) {
    if (this.syncing) return;
    this.syncing = true;
    this.syncMessage = "正在同步文字和录音…";
    if (show) render();
    try {
      const token = await this.call("secretGet", { key: this.tokenKey() });
      this.sync = await this.call("syncRun", { token });
      this.syncMessage = this.sync.conflicts
        ? `有 ${this.sync.conflicts} 条记忆需要处理修改冲突。`
        : this.sync.pending
          ? `还有 ${this.sync.pending} 条待同步，正在继续。`
          : "同步完成。";
      await ZY.load();
      if (state.note && !state.edit)
        state.note = await ZY.get(state.note.id).catch(() => null);
      if (this.sync.conflicts)
        this.conflicts = await this.call("syncConflicts");
      if (this.sync.more || this.sync.pending > this.sync.conflicts)
        setTimeout(() => this.runSync(false), 2000);
    } catch (error) {
      this.syncMessage = "同步未完成：" + error.message;
    } finally {
      this.syncing = false;
      if (
        show ||
        state.page === "sync" ||
        (!state.edit &&
          !state.recording &&
          ["capture", "timeline", "detail", "settings"].includes(state.page))
      )
        render();
      if (state.page === "search" && !state.edit) runSearch();
    }
  },
  async logout() {
    try {
      const token = await this.call("secretGet", { key: this.tokenKey() });
      const result = await this.call("syncLogout", { token });
      await this.call("secretDelete", { key: this.tokenKey() });
      await this.refresh();
      this.syncMessage = result.revoked
        ? "已退出同步，本机记录仍可使用。"
        : "已停止本机同步并移除凭据。服务暂时不可达，远端会话将在到期后失效。";
      render();
    } catch (error) {
      toast(error.message, "error");
    }
  },
  async download(id) {
    const token = await this.call("secretGet", { key: this.tokenKey() });
    await this.call("audioDownload", { id, token });
    await ZY.load();
    state.note = await ZY.get(id);
    render();
  },
  async resolve(id, choice) {
    try {
      this.sync = await this.call("syncResolve", { id, choice });
      this.conflicts = await this.call("syncConflicts");
      await ZY.load();
      render();
      this.scheduleSync();
    } catch (error) {
      toast(error.message, "error");
    }
  },
};
// Desktop choices reuse the settings list; focus stays on the combobox so
// keyboard navigation, dismissal and form drafts do not require a full render.
const ProviderProtocol = {
  get trigger() {
    return document.getElementById("provider-protocol");
  },
  get menu() {
    return document.getElementById("protocol-options");
  },
  close() {
    if (!this.trigger || !this.menu) return;
    this.menu.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.removeAttribute("aria-activedescendant");
  },
  highlight(option) {
    this.menu.querySelectorAll('[role="option"]').forEach((item) => {
      item.classList.toggle("active", item === option);
    });
    this.trigger.setAttribute("aria-activedescendant", option.id);
    // Scroll only the option list, without moving the surrounding form.
    const top = option.offsetTop,
      bottom = top + option.offsetHeight;
    if (top < this.menu.scrollTop) this.menu.scrollTop = top;
    else if (bottom > this.menu.scrollTop + this.menu.clientHeight)
      this.menu.scrollTop = bottom - this.menu.clientHeight;
  },
  open() {
    if (!this.trigger || this.trigger.disabled || !this.menu) return;
    const trigger = this.trigger,
      menu = this.menu;
    menu.hidden = false;
    menu.style.maxHeight = "";
    const bounds = trigger.getBoundingClientRect();
    const scroll = trigger.closest(".content-scroll").getBoundingClientRect();
    const below = Math.min(scroll.bottom, innerHeight) - bounds.bottom - 12;
    const above = bounds.top - Math.max(scroll.top, 0) - 12;
    const upwards = below < menu.scrollHeight && above > below;
    menu.classList.toggle("opens-up", upwards);
    menu.style.maxHeight = `${Math.max(0, upwards ? above : below)}px`;
    trigger.setAttribute("aria-expanded", "true");
    this.highlight(menu.querySelector('[aria-selected="true"]'));
    trigger.focus({ preventScroll: true });
  },
  choose(option) {
    if (!this.trigger || this.trigger.disabled || !option) return;
    this.trigger.value = option.dataset.value;
    this.trigger.querySelector(".protocol-value").textContent =
      option.textContent;
    this.menu.querySelectorAll('[role="option"]').forEach((item) => {
      item.setAttribute("aria-selected", String(item === option));
    });
    this.trigger.dispatchEvent(new Event("change", { bubbles: true }));
    this.close();
    this.trigger.focus({ preventScroll: true });
  },
};
document.addEventListener("click", (event) => {
  const picker = event.target.closest(".protocol-picker");
  if (!picker) return ProviderProtocol.close();
  if (event.target.closest(".service-select")) {
    if (ProviderProtocol.menu.hidden) ProviderProtocol.open();
    else ProviderProtocol.close();
  } else {
    ProviderProtocol.choose(event.target.closest('[role="option"]'));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.target !== ProviderProtocol.trigger || event.target.disabled)
    return;
  if (event.key === "Tab") return ProviderProtocol.close();
  if (
    !["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(
      event.key,
    )
  )
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === "Escape") return ProviderProtocol.close();
  const menu = ProviderProtocol.menu;
  if (menu.hidden) {
    ProviderProtocol.open();
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
  } else if (["Enter", " "].includes(event.key)) {
    return ProviderProtocol.choose(menu.querySelector(".active"));
  }
  const options = Array.from(menu.querySelectorAll('[role="option"]'));
  const current = options.findIndex((item) =>
    item.classList.contains("active"),
  );
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (current + (event.key === "ArrowUp" ? -1 : 1) + options.length) %
          options.length;
  ProviderProtocol.highlight(options[next]);
});
document.addEventListener("focusin", (event) => {
  if (!event.target.closest(".protocol-picker")) ProviderProtocol.close();
});
document.addEventListener(
  "scroll",
  (event) => {
    if (!event.target.closest?.(".protocol-menu")) ProviderProtocol.close();
  },
  true,
);
window.addEventListener("resize", () => ProviderProtocol.close());
document.addEventListener("input", (e) => {
  const target = e.target;
  if (target.dataset.providerField && Services.providerDraft)
    Services.providerDraft[target.dataset.providerField] = target.value;
  if (target.id === "provider-key") Services.providerKey = target.value;
  if (target.dataset.accountField)
    Services.accountForm[target.dataset.accountField] = target.value;
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.providerField && Services.providerDraft)
    Services.providerDraft[e.target.dataset.providerField] =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-service]");
  if (!el || el.disabled) return;
  const action = el.dataset.service,
    id = el.dataset.id;
  if (action === "new-provider") Services.newProvider();
  if (action === "edit-provider") Services.editProvider(id);
  if (action === "close-provider") {
    Services.providerDraft = null;
    Services.providerKey = "";
    render();
  }
  if (action === "save-provider") Services.providerAction(false);
  if (action === "test-provider") Services.providerAction(true);
  if (action === "default-provider") Services.defaultProvider(id);
  if (action === "remove-provider") Services.removeProvider(id);
  if (action === "login" || action === "register")
    Services.authenticate(action === "register");
  if (action === "sync") Services.runSync();
  if (action === "logout") Services.logout();
  if (action === "summary" || action === "transcription")
    Services.enqueue(action, id);
  if (action === "retry-job") {
    try {
      await Services.call("aiRetry", { id });
      Services.processQueue();
    } catch (error) {
      toast(error.message, "error");
    }
  }
  if (action === "download-audio") {
    try {
      await Services.download(id);
    } catch (error) {
      toast(error.message, "error");
    }
  }
  if (action === "resolve") Services.resolve(id, el.dataset.choice);
});
