// Visual-regression scenes: renders specific UI states in light and dark with
// headless Chrome and writes <OUT>/<theme>-<scene>.png. Used by
// tools/visual-regression.sh for before/after comparisons.
//   VR_INDEX=path/to/index.html VR_OUT=dir node tools/vr-scenes.js
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const index = path.resolve(process.env.VR_INDEX || path.join(__dirname, "../prototype/index.html"));
const out = path.resolve(process.env.VR_OUT || path.join(__dirname, "../verify/vr-scenes"));
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-vr-"));
const chrome = spawn(
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared fixtures (strings evaluated in the page).
const RICH = `(()=>{const n=ZY.list.find(n=>n.id==="m1");n.raw="周六在上海的花园咖啡店坐了一下午，桂花拿铁很好喝。";n.summary="上海花园咖啡店的周末午后，推荐桂花拿铁。";n.transcript="周六在上海的花园咖啡店坐了一下午，桂花拿铁很好喝，下次带朋友来。";n.ai_tags=["咖啡","上海"];n.tags=["旅行"];return n.id;})()`;
const PROVIDER = `{id:"p1",name:"示例模型服务",protocol:"openai",baseUrl:"https://api.example.com/v1",model:"m",enabled:true}`;
const SYNC = `Services.sync={enabled:true,account:{username:"alice",url:"https://sync.example.com",user_id:"u1"},pending:2,conflicts:1,last_synced:Date.parse("2026-10-12T10:00:00Z")};Services.call=async()=>null;`;
const MAC = { width: 1120, height: 760, mobile: false };
const IOS = { width: 390, height: 844, mobile: true, plat: "ios" };
const scenes = {
  "detail-read": [MAC, `openMemory(${RICH})`],
  "detail-edit": [MAC, `openMemory(${RICH}).then(()=>document.querySelector('[data-act="edit"]').click())`],
  "recording": [MAC, `state.recording=true;document.getElementById("overlay").innerHTML=recordingHTML()`],
  "toast-ok": [MAC, `toast("已复制到剪贴板","ok")`],
  "toast-error": [MAC, `toast("同步失败：网络不可用","error")`],
  "toast-bloom": [MAC, `toast("记下了，花开了一点点。","bloom")`],
  "consent": [MAC, `showConsent(${PROVIDER},"summary")`],
  "delete-account-1": [MAC, `${SYNC}navigate("sync");document.querySelector('[data-service="delete-account-start"]').click();
     const c=document.querySelector('[data-delete-field="confirm"]');c.value="alice";c.dispatchEvent(new Event("input",{bubbles:true}));
     const p=document.querySelector('[data-delete-field="password"]');p.value="fixture-password";p.dispatchEvent(new Event("input",{bubbles:true}));
     document.querySelector(".danger-zone").scrollIntoView()`],
  "delete-account-2": [MAC, `${SYNC}navigate("sync");document.querySelector('[data-service="delete-account-start"]').click();
     const c=document.querySelector('[data-delete-field="confirm"]');c.value="alice";c.dispatchEvent(new Event("input",{bubbles:true}));
     const p=document.querySelector('[data-delete-field="password"]');p.value="fixture-password";p.dispatchEvent(new Event("input",{bubbles:true}));
     document.querySelector('[data-service="delete-account-next"]').click();document.querySelector(".danger-zone").scrollIntoView()`],
  "sync-conflict": [MAC, `${SYNC}Services.conflicts=[{id:"m3",local:{raw:"本机：周末去植物园看银杏。"},remote:{note:{raw:"云端：周末去植物园看银杏，记得带相机。"}}}];navigate("sync");document.querySelector(".conflict-card").scrollIntoView()`],
  "api-running": [MAC, `ExternalAPI.status={supported:true,running:true,requests:3,config:{port:17321,mcp:true,openai:true,allow_write:false},provider_name:"示例模型服务"};ExternalAPI.config={...ExternalAPI.status.config};ExternalAPI.ready=true;navigate("integrations")`],
  "search-hits": [MAC, `navigate("search");state.q="咖啡";document.getElementById("q").value="咖啡";runSearch()`],
  "search-empty": [MAC, `navigate("search");state.q="不存在的词";document.getElementById("q").value="不存在的词";runSearch()`],
  "sb-collapsed": [MAC, `document.documentElement.classList.add("sb-collapsed");render()`],
  "ios-search": [IOS, `navigate("search");state.q="咖啡";document.getElementById("q").value="咖啡";runSearch()`],
  "ios-settings": [IOS, `navigate("settings")`],
  "ios-privacy": [IOS, `navigate("privacy")`],
  "ios-detail": [IOS, `openMemory(${RICH})`],
};

(async () => {
  for (let i = 0; i < 60 && !fs.existsSync(path.join(profile, "DevToolsActivePort")); i++) await sleep(100);
  const port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const failed = [];
  for (const theme of ["light", "dark"]) {
    for (const [name, [vp, setup]] of Object.entries(scenes)) {
      await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
      await send("Page.navigate", { url: `file://${index}?still=1&theme=${theme}${vp.plat ? "&plat=" + vp.plat : ""}` });
      for (let i = 0; i < 100 && !(await evaluate('typeof state!=="undefined" && state.loaded').catch(() => false)); i++) await sleep(50);
      await evaluate(`localStorage.clear();0`);
      try {
        await evaluate(`(async()=>{${setup}})()`);
      } catch (error) {
        failed.push(`${theme}-${name}: ${error.message}`);
      }
      await sleep(350);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(out, `${theme}-${name}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  console.log(JSON.stringify({ scenes: Object.keys(scenes).length * 2, failed, errors, out }, null, 2));
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  chrome.kill();
  process.exit(1);
});
