// Native persistence and browser preview implement the same small interface.
const ZY = (() => {
  const native = typeof window.zyNative?.call === "function";
  const list = [];
  let totals = { total: 0, with_audio: 0, pending: 0 };
  let preview;
  try {
    preview =
      JSON.parse(localStorage.getItem("zy-preview-notes")) ||
      MEMORIES.map((m) => ({ ...m }));
  } catch {
    preview = MEMORIES.map((m) => ({ ...m }));
  }
  const normalize = (m) => ({
    ...m,
    raw: m.raw || "",
    summary: m.summary || null,
    tags: m.tags || [],
    entities: m.entities || {},
    dur: Number(m.dur) || 0,
    audio: m.audio || null,
  });
  function setAll(items) {
    list.splice(0, list.length, ...items.map(normalize));
  }
  function call(op, payload = {}) {
    if (!native) return Promise.reject(new Error("请在只言 App 中使用此功能"));
    return window.zyNative.call({ op, ...payload });
  }
  function persist() {
    localStorage.setItem("zy-preview-notes", JSON.stringify(preview));
  }
  async function load() {
    await (window.runtimeReady || Promise.resolve());
    if (native) {
      const r = await call("page");
      setAll(r.notes);
      totals = r.stats;
    } else {
      setAll(preview.filter((m) => !m.deleted));
      totals = { total: list.length, pending: 0, with_audio: 0 };
    }
    return { native, stats: totals };
  }
  async function more() {
    if (!native || !list.length) return;
    const last = list[list.length - 1];
    const r = await call("page", {
      before: last.created_at,
      beforeID: last.id,
    });
    const ids = new Set(list.map((n) => n.id));
    list.push(...r.notes.filter((n) => !ids.has(n.id)).map(normalize));
    totals = r.stats;
  }
  async function save(text, extra = {}) {
    let result;
    if (native)
      result = await call("save", {
        text,
        source: "text",
        state: "done",
        ...extra,
      });
    else {
      const now = new Date();
      const n = normalize({
        id: extra.id || crypto.randomUUID(),
        raw: text,
        day: todayKey(),
        time: now.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        created_at: Date.now(),
        source: "text",
        state: "done",
        ...extra,
        dur: Number(extra.dur || 0) / 1000,
      });
      preview.unshift(n);
      persist();
      result = { id: n.id };
    }
    await load();
    if (typeof Services !== "undefined") Services.scheduleSync();
    return result;
  }
  async function get(id) {
    return native
      ? normalize(await call("get", { id }))
      : list.find((n) => n.id === id);
  }
  async function update(id, text, tags) {
    if (native) await call("update", { id, text, tags });
    else {
      const n = preview.find((n) => n.id === id);
      if (!n) throw new Error("这条记忆已不存在");
      Object.assign(n, { raw: text, tags, summary: null });
      persist();
    }
    await load();
    if (typeof Services !== "undefined") Services.scheduleSync();
  }
  async function remove(id) {
    if (native) await call("delete", { id });
    else {
      preview.find((n) => n.id === id).deleted = true;
      persist();
    }
    await load();
    if (typeof Services !== "undefined") Services.scheduleSync();
  }
  async function restore(id) {
    if (native) await call("restore", { id });
    else {
      preview.find((n) => n.id === id).deleted = false;
      persist();
    }
    await load();
    if (typeof Services !== "undefined") Services.scheduleSync();
  }
  async function search(q, source = "") {
    if (native) {
      const r = await call("search", { q, source });
      return { ...r, hits: r.hits.map(normalize) };
    }
    const terms = q.trim().toLowerCase().split(/\s+/);
    const hits = list.filter((m) =>
      terms.every((t) =>
        [m.raw, m.summary || "", ...m.tags].some((f) =>
          f.toLowerCase().includes(t),
        ),
      ),
    );
    return { hits, count: hits.length };
  }
  const rec = {
    start: () => call("recStart"),
    stop: () => call("recStop"),
    cancel: () => call("recCancel"),
    status: () => call("recStatus"),
  };
  const audio = {
    play: (id) => call("audioPlay", { id }),
    pause: () => call("audioPause"),
    stop: () => call("audioStop"),
    seek: (seconds) => call("audioSeek", { seconds }),
    status: () => call("audioStatus"),
  };
  const exportAs = (format, id) => call("export", { format, id });
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return {
    native,
    list,
    load,
    more,
    save,
    get,
    update,
    remove,
    restore,
    search,
    rec,
    audio,
    exportAs,
    call,
    normalize,
    setAll,
    todayKey,
    stats: () => totals,
  };
})();

const Prefs = {
  get(key, fallback = "") {
    if (ZY.native) return window.zyPreferences?.[key] ?? fallback;
    try {
      return localStorage.getItem("zy-" + key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  async set(key, value) {
    if (ZY.native) {
      await ZY.call("prefsSet", { key, value });
      window.zyPreferences[key] = value;
    } else localStorage.setItem("zy-" + key, value);
  },
};
