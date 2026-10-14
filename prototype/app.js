// Application state and actions. Views are in views.js; persistence is in db.js.
const params = new URLSearchParams(location.search);
const state = {
  page: "capture",
  platform:
    params.get("plat") === "ios" ||
    /Android|iPhone|iPad/i.test(navigator.userAgent)
      ? "ios"
      : "mac",
  theme: params.get("theme") || Prefs.get("theme", "system"),
  loaded: false,
  busy: false,
  draft: Prefs.get("draft"),
  q: "",
  hits: [],
  searching: false,
  searchError: "",
  source: "",
  note: null,
  edit: null,
  recording: false,
  pendingRecording: null,
  loadError: "",
  returnPage: "timeline",
  listScroll: 0,
  draftID: crypto.randomUUID(),
};
if (!["light", "dark", "system"].includes(state.theme)) state.theme = "system";
let openVersion = 0;
let searchVersion = 0,
  searchTimer,
  recordTimer,
  audioTimer,
  toastTimer,
  pendingNavigation,
  draftVersion = 0;
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const theme =
    state.theme === "system"
      ? darkMQ.matches
        ? "dark"
        : "light"
      : state.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelectorAll('[data-act="theme"]')
    .forEach((b) => b.classList.toggle("on", b.dataset.v === state.theme));
}
darkMQ.addEventListener("change", applyTheme);
function toast(message, kind = "ok", undoID) {
  clearTimeout(toastTimer);
  document.getElementById("zy-toast")?.remove();
  const el = document.createElement("div");
  el.id = "zy-toast";
  el.className = kind;
  el.role = kind === "error" ? "alert" : "status";
  // Error messages can echo provider/server responses: set them as text only.
  if (kind === "bloom") el.innerHTML = flowerSVG(1);
  const text = document.createElement("span");
  text.textContent = String(message ?? "");
  el.append(text);
  if (undoID) {
    const undo = document.createElement("button");
    undo.dataset.act = "undo";
    undo.dataset.id = undoID;
    undo.textContent = "撤销删除";
    el.append(undo);
  }
  document.body.append(el);
  toastTimer = setTimeout(
    () => el.remove(),
    undoID ? 12000 : kind === "error" ? 7000 : 3500,
  );
}
function rootHTML() {
  return (
    {
      capture: pageCapture,
      timeline: pageTimeline,
      search: pageSearch,
      detail: pageDetail,
      settings: pageSettings,
      providers: pageProviders,
      sync: pageSync,
      integrations: pageIntegrations,
    }[state.page]?.() || pageCapture()
  );
}
function render() {
  const active = document.activeElement,
    focusedID = active?.id;
  const selection =
    active && ["INPUT", "TEXTAREA"].includes(active.tagName)
      ? [active.selectionStart, active.selectionEnd]
      : null;
  const scroll = document.querySelector(".content,.ios-content");
  const top = scroll?.scrollTop || 0;
  if (!document.getElementById("root"))
    document.getElementById("stage").innerHTML = shellHTML();
  document.getElementById("root").innerHTML = rootHTML();
  document.querySelectorAll('[data-act="nav"]').forEach((b) => {
    const selected =
      b.dataset.p === state.page ||
      (["providers", "sync", "integrations"].includes(state.page) &&
        b.dataset.p === "settings") ||
      (state.page === "detail" && b.dataset.p === state.returnPage);
    b.classList.toggle("on", selected);
    if (selected) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const count = document.getElementById("nav-count");
  if (count) {
    count.textContent = ZY.stats().total || "";
    count.hidden = !ZY.stats().total;
  }
  const sc = document.querySelector(".content,.ios-content");
  if (sc) sc.scrollTop = top;
  const fresh = focusedID && document.getElementById(focusedID);
  if (fresh && selection && selection[0] !== null) {
    fresh.focus({ preventScroll: true });
    fresh.setSelectionRange(...selection);
  }
  applyTheme();
  updateAudioControls();
}
function mount() {
  document.body.className =
    `proto-stage-${state.platform}` + (params.has("still") ? " still" : "");
  document.getElementById("stage").innerHTML = shellHTML();
  render();
}
function setRoute() {
  history.replaceState(
    null,
    "",
    "#" +
      state.page +
      (state.page === "search" && state.q
        ? "/" + encodeURIComponent(state.q)
        : state.page === "detail" && state.note
          ? "/" + encodeURIComponent(state.note.id)
          : ""),
  );
}
function readRoute() {
  const [page, arg] = location.hash.replace(/^#\/?/, "").split("/");
  if (
    [
      "capture",
      "timeline",
      "search",
      "detail",
      "settings",
      "providers",
      "sync",
      "integrations",
    ].includes(page)
  )
    state.page = page;
  if (page === "search" && arg) {
    try {
      state.q = decodeURIComponent(arg);
    } catch {
      state.q = arg;
    }
  }
  return page === "detail" ? arg : null;
}
function navigate(page) {
  if (state.busy || state.recording) return;
  if (state.edit) {
    pendingNavigation = () => {
      state.edit = null;
      navigate(page);
    };
    showDiscard();
    return;
  }
  openVersion++;
  stopAudio();
  state.note = null;
  state.page = page;
  setRoute();
  render();
  const sc = document.querySelector(".content,.ios-content");
  if (sc) sc.scrollTop = 0;
  if (page === "capture" && state.platform === "mac")
    document.getElementById("cap-input")?.focus();
  if (page === "search") document.getElementById("q")?.focus();
}
function showDiscard() {
  document.getElementById("overlay").innerHTML =
    '<div class="recording-scrim"><section class="recording-panel" role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">还有没保存的修改</h2><p>离开前，可以先把这段记忆留下。</p><div class="recording-actions"><button class="btn" data-act="keep-editing">继续编辑</button><button class="btn" data-act="discard-edit">放弃修改</button></div></section></div>';
  document.querySelector('[data-act="keep-editing"]')?.focus();
}
async function runSearch() {
  const version = ++searchVersion,
    q = state.q;
  state.searchError = "";
  state.searching = !!q.trim();
  updateSearch();
  if (!q.trim()) {
    state.hits = [];
    updateSearch();
    return;
  }
  try {
    const r = await ZY.search(q, state.source);
    if (version !== searchVersion) return;
    state.hits = r.hits;
  } catch (error) {
    if (version !== searchVersion) return;
    state.hits = [];
    state.searchError = "检索失败：" + error.message;
  } finally {
    if (version === searchVersion) {
      state.searching = false;
      updateSearch();
    }
  }
}
function updateSearch() {
  const el = document.getElementById("search-results");
  if (el) el.innerHTML = searchResultsHTML();
}
async function openMemory(id) {
  if (state.edit) {
    pendingNavigation = () => {
      state.edit = null;
      openMemory(id);
    };
    showDiscard();
    return;
  }
  stopAudio();
  try {
    const version = ++openVersion;
    const n = await ZY.get(id);
    if (version !== openVersion) return;
    if (!n) throw new Error("这条记忆已不存在");
    state.returnPage = ["search", "timeline", "capture"].includes(state.page)
      ? state.page
      : state.returnPage;
    state.note = n;
    state.edit = null;
    const fullPage = state.platform === "ios" || state.page === "capture";
    if (fullPage && state.page !== "detail") {
      state.listScroll =
        document.querySelector(".content,.ios-content")?.scrollTop || 0;
      state.page = "detail";
    }
    setRoute();
    render();
    if (fullPage) {
      const sc = document.querySelector(".content,.ios-content");
      if (sc) sc.scrollTop = 0;
    }
  } catch (error) {
    toast(error.message, "error");
  }
}
function closeDetail() {
  if (state.edit) {
    pendingNavigation = () => {
      state.edit = null;
      closeDetail();
    };
    showDiscard();
    return;
  }
  openVersion++;
  const wasFullPage = state.page === "detail";
  stopAudio();
  state.note = null;
  if (state.page === "detail") state.page = state.returnPage;
  setRoute();
  render();
  if (wasFullPage) {
    const sc = document.querySelector(".content,.ios-content");
    if (sc) sc.scrollTop = state.listScroll;
  }
}
async function saveText() {
  if (state.busy || !state.loaded || !state.draft.trim()) {
    document.getElementById("cap-input")?.focus();
    return;
  }
  const text = state.draft;
  state.busy = true;
  render();
  try {
    await ZY.save(text, { id: state.draftID });
    // Clear the persisted draft only after a confirmed database write.
    await Prefs.set("draft", "");
    state.draft = "";
    state.draftID = crypto.randomUUID();
    toast("记下了，花开了一点点。", "bloom");
  } catch (error) {
    toast("保存未完成，草稿还在：" + error.message, "error");
  } finally {
    state.busy = false;
    render();
    if (state.page === "capture" && state.platform === "mac")
      document.getElementById("cap-input")?.focus();
  }
}
async function saveEdit() {
  if (state.busy || !state.note || !state.edit) return;
  if (!state.edit.text.trim() && !state.note.audio) {
    toast("先写下一点内容吧。", "error");
    return;
  }
  state.busy = true;
  render();
  try {
    const { id } = state.note;
    await ZY.update(id, state.edit.text, [
      ...new Set(
        state.edit.tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ]);
    state.note = await ZY.get(id);
    state.edit = null;
    toast("修改已保存。");
    if (state.q) await runSearch();
  } catch (error) {
    toast("修改未保存：" + error.message, "error");
  } finally {
    state.busy = false;
    render();
  }
}
async function removeNote(id) {
  if (state.busy) return;
  state.busy = true;
  try {
    stopAudio();
    await ZY.remove(id);
    state.edit = null;
    state.note = null;
    if (state.page === "detail") state.page = state.returnPage;
    setRoute();
    if (state.q) await runSearch();
    toast("已移走这条记忆。", "ok", id);
  } catch (error) {
    toast("删除失败：" + error.message, "error");
  } finally {
    state.busy = false;
    render();
  }
}
async function startRecording() {
  if (state.recording || state.busy) return;
  if (state.pendingRecording) {
    document.getElementById("overlay").innerHTML = recordingHTML();
    return;
  }
  state.busy = true;
  try {
    stopAudio();
    await ZY.rec.start();
    state.recording = true;
    document.getElementById("overlay").innerHTML = recordingHTML();
    document.querySelector('[data-act="rec-done"]').focus();
    pollRecording();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.busy = false;
  }
}
async function pollRecording() {
  if (!state.recording) return;
  try {
    const r = await ZY.rec.status();
    const t = document.getElementById("rec-time");
    if (t) t.textContent = mmss(r.seconds);
    document
      .querySelectorAll(".recording-meter i")
      .forEach(
        (el, i) =>
          (el.style.height =
            5 +
            Math.min(1, r.level * 8) *
              30 *
              (0.4 + 0.6 * Math.sin(i * 1.7) ** 2) +
            "px"),
      );
  } catch {
  } finally {
    if (state.recording) recordTimer = setTimeout(pollRecording, 180);
  }
}
async function endRecording(save) {
  if ((!state.recording && !state.pendingRecording) || state.busy) return;
  state.busy = true;
  document
    .querySelectorAll(".recording-actions button")
    .forEach((b) => (b.disabled = true));
  try {
    if (save) {
      if (!state.pendingRecording) {
        const recorded = await ZY.rec.stop();
        state.recording = false;
        state.pendingRecording = { ...recorded, id: crypto.randomUUID() };
      }
      await Prefs.set("recordingDraft", JSON.stringify(state.pendingRecording));
      const r = state.pendingRecording;
      await ZY.save("", {
        id: r.id,
        source: "voice",
        audio: r.path,
        dur: r.dur,
        state: "pending",
      });
      await Prefs.set("recordingDraft", "");
      state.pendingRecording = null;
      toast("声音已保存，可在详情中转写。", "bloom");
    } else {
      await ZY.rec.cancel();
      await Prefs.set("recordingDraft", "");
      state.pendingRecording = null;
    }
    state.recording = false;
    document.getElementById("overlay").innerHTML = "";
  } catch (error) {
    toast("录音尚未保存：" + error.message, "error");
    if (state.pendingRecording)
      document.getElementById("overlay").innerHTML = recordingHTML();
  } finally {
    state.busy = false;
    clearTimeout(recordTimer);
    document
      .querySelectorAll(".recording-actions button")
      .forEach((b) => (b.disabled = false));
    if (state.recording) pollRecording();
    render();
  }
}
let audioState = { playing: false, seconds: 0 };
function updateAudioControls() {
  const b = document.querySelector(".audio-play");
  if (b) {
    b.innerHTML = svg(audioState.playing ? "pause" : "play");
    b.setAttribute("aria-label", audioState.playing ? "暂停录音" : "播放录音");
  }
  const current = document.getElementById("audio-current");
  if (current) current.textContent = mmss(audioState.seconds);
  const seek = document.getElementById("audio-seek");
  if (seek && document.activeElement !== seek)
    seek.value = audioState.seconds || 0;
}
async function pollAudio() {
  try {
    audioState = await ZY.audio.status();
    updateAudioControls();
    if (audioState.playing) audioTimer = setTimeout(pollAudio, 300);
  } catch (error) {
    toast(error.message, "error");
  }
}
function stopAudio() {
  clearTimeout(audioTimer);
  if (ZY.native) ZY.audio.stop().catch(() => {});
  audioState = { playing: false, seconds: 0 };
}
async function toggleAudio() {
  try {
    clearTimeout(audioTimer);
    audioState = audioState.playing
      ? await ZY.audio.pause()
      : await ZY.audio.play(state.note.id);
    updateAudioControls();
    if (audioState.playing) pollAudio();
  } catch (error) {
    toast(error.message, "error");
  }
}
async function doExport(format, id) {
  try {
    await ZY.exportAs(format, id);
    toast("已导出 " + (format === "md" ? "Markdown" : "JSON") + " 文件。");
  } catch (error) {
    toast(error.message, "error");
  }
}

document.addEventListener("input", (e) => {
  if (e.target.id === "cap-input") {
    state.draft = e.target.value;
    const version = ++draftVersion;
    const status = document.getElementById("draft-state");
    if (status) status.textContent = "正在保留草稿…";
    Prefs.set("draft", state.draft)
      .then(() => {
        if (version === draftVersion) {
          const el = document.getElementById("draft-state");
          if (el)
            el.textContent = state.draft ? "草稿已保留" : "只记你愿意记的";
        }
      })
      .catch(() => {
        if (version === draftVersion) {
          const el = document.getElementById("draft-state");
          if (el) el.textContent = "草稿未存盘，请保留此页";
        }
      });
  }
  if (e.target.id === "q" && !e.isComposing) {
    state.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setRoute();
      runSearch();
    }, 180);
  }
  if (e.target.id === "edit-text" && state.edit)
    state.edit.text = e.target.value;
  if (e.target.id === "edit-tags" && state.edit)
    state.edit.tags = e.target.value;
});
document.addEventListener("compositionend", (e) => {
  if (e.target.id === "q") {
    state.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setRoute();
      runSearch();
    }, 180);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "audio-seek")
    ZY.audio
      .seek(Number(e.target.value))
      .then((r) => {
        audioState = r;
        updateAudioControls();
      })
      .catch((error) => toast(error.message, "error"));
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act],[data-plat]");
  if (!el || el.disabled) return;
  if (el.dataset.plat) {
    if (state.recording) return;
    state.platform = el.dataset.plat;
    mount();
    return;
  }
  const { act, id } = el.dataset;
  if (act === "nav") navigate(el.dataset.p);
  if (act === "open-mem") openMemory(id);
  if (act === "close-detail") closeDetail();
  if (act === "save-text") saveText();
  if (act === "edit") {
    state.edit = { text: state.note.raw, tags: state.note.tags.join("，") };
    stopAudio();
    render();
    document.getElementById("edit-text")?.focus();
  }
  if (act === "cancel-edit") {
    state.edit = null;
    render();
  }
  if (act === "save-edit") saveEdit();
  if (act === "delete") removeNote(id);
  if (act === "undo") {
    try {
      await ZY.restore(id);
      if (state.q) await runSearch();
      render();
      toast("记忆回来了。", "bloom");
    } catch (error) {
      toast(error.message, "error");
    }
  }
  if (act === "keep-editing") {
    pendingNavigation = null;
    document.getElementById("overlay").innerHTML = "";
    document.getElementById("edit-text")?.focus();
  }
  if (act === "discard-edit") {
    document.getElementById("overlay").innerHTML = "";
    const action = pendingNavigation;
    pendingNavigation = null;
    action?.();
  }
  if (act === "theme") {
    state.theme = el.dataset.v;
    try {
      await Prefs.set("theme", state.theme);
    } catch (error) {
      toast(error.message, "error");
    }
    render();
  }
  if (act === "filter") {
    state.source = el.dataset.source;
    render();
    runSearch();
  }
  if (act === "clear-q") {
    state.q = "";
    state.hits = [];
    state.note = null;
    searchVersion++;
    state.searching = false;
    state.searchError = "";
    setRoute();
    render();
    document.getElementById("q")?.focus();
  }
  if (act === "search-retry") runSearch();
  if (act === "reload") location.reload();
  if (act === "load-more") {
    state.busy = true;
    render();
    try {
      await ZY.more();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      state.busy = false;
      render();
    }
  }
  if (act === "export") doExport(el.dataset.fmt || "md", id);
  if (act === "rec-start") startRecording();
  if (act === "rec-done") endRecording(true);
  if (act === "rec-cancel") endRecording(false);
  if (act === "play") toggleAudio();
});
document.addEventListener("keydown", (e) => {
  const modal = document.querySelector('[role="dialog"]');
  if (modal && e.key === "Tab") {
    const controls = [
      ...modal.querySelectorAll("button:not(:disabled),input,textarea"),
    ];
    const first = controls[0],
      last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  if (e.key === "Escape") {
    if (state.recording || state.pendingRecording) {
      e.preventDefault();
      endRecording(false);
      return;
    }
    if (pendingNavigation) {
      document.querySelector('[data-act="keep-editing"]')?.click();
      return;
    }
    if (state.note) closeDetail();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    if (state.edit) saveEdit();
    else if (state.page === "capture") saveText();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    navigate("capture");
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    navigate("search");
  }
});
window.addEventListener("hashchange", () => {
  if (state.recording) return;
  readRoute();
  render();
  if (state.page === "search") runSearch();
});
try {
  state.pendingRecording = JSON.parse(Prefs.get("recordingDraft") || "null");
} catch {}
const initialNote = readRoute();
mount();
ZY.load()
  .then(async () => {
    state.loaded = true;
    if (window.__TAURI_INTERNALS__) state.draft = Prefs.get("draft");
    render();
    Services.start();
    if (state.pendingRecording)
      document.getElementById("overlay").innerHTML = recordingHTML();
    if (state.q || params.get("q")) {
      state.q = params.get("q") || state.q;
      state.page = "search";
      render();
      await runSearch();
    }
    if (initialNote) await openMemory(decodeURIComponent(initialNote));
  })
  .catch((error) => {
    state.loadError = error.message;
    render();
    toast("记忆载入失败：" + error.message, "error");
  });
