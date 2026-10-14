// Real Chromium interaction tests with an isolated profile; no user data is touched.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhiyan-ui-"));
const output = path.resolve(__dirname, "../verify/garden");
fs.mkdirSync(output, { recursive: true });
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
const checks = [];
let errors = [];
(async () => {
  for (
    let i = 0;
    i < 60 && !fs.existsSync(path.join(profile, "DevToolsActivePort"));
    i++
  )
    await sleep(100);
  const port = fs
    .readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")
    .split("\n")[0];
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  ws = new WebSocket(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const entry = pending.get(m.id);
      if (entry) {
        pending.delete(m.id);
        m.error ? entry.reject(m.error) : entry.resolve(m.result);
      }
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expression)) return;
      await sleep(50);
    }
    throw new Error("Timeout: " + expression);
  };
  const check = async (label, expression) => {
    const pass = !!(await evaluate(expression));
    checks.push({ label, pass });
    if (!pass) throw new Error(label);
  };
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector, value) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1120,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", {
    url:
      "file://" +
      path.resolve(__dirname, "index.html") +
      "?still=1&theme=light",
  });
  await wait('typeof state!=="undefined" && state.loaded');
  const embed = () =>
    evaluate(
      `(()=>{const l=document.createElement('link');l.rel='stylesheet';l.href='app-embed.css';document.head.append(l);})()`,
    );
  await embed();
  await sleep(150);
  const screenshot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(output, name + ".png"),
      Buffer.from(r.data, "base64"),
    );
  };
  await screenshot("mac-home");
  await input("#cap-input", "测试草稿：路过一朵小花");
  await click('[data-p="settings"]');
  await click('[data-act="theme"][data-v="dark"]');
  await click('[data-p="capture"]');
  await check(
    "draft survives theme and navigation",
    'document.querySelector("#cap-input").value==="测试草稿：路过一朵小花"',
  );
  await screenshot("mac-dark");
  await send("Page.reload");
  await wait('typeof state!=="undefined" && state.loaded');
  await embed();
  await check(
    "draft survives reload",
    'state.draft==="测试草稿：路过一朵小花"',
  );
  await evaluate(
    'window.realSave=ZY.save; ZY.save=()=>Promise.reject(new Error("disk full"))',
  );
  await click('[data-act="save-text"]');
  await wait("!state.busy");
  await check(
    "failed save retains visible draft",
    'document.querySelector("#cap-input").value==="测试草稿：路过一朵小花"',
  );
  await evaluate("ZY.save=window.realSave");
  await click('[data-act="save-text"]');
  await wait("!state.busy && !state.draft");
  await check(
    "save stays on capture page",
    'state.page==="capture" && ZY.list[0].raw==="测试草稿：路过一朵小花"',
  );
  await click(".memory-card");
  await click('[data-act="edit"]');
  await input("#edit-text", "花园里的上海旅行");
  await input("#edit-tags", "旅行，花园");
  await click('[data-act="save-edit"]');
  await wait("!state.busy && state.edit===null");
  await check(
    "edit updates note and tags",
    'state.note.raw==="花园里的上海旅行" && state.note.tags.includes("旅行")',
  );
  await evaluate("window.editedID=state.note.id");
  await click('[data-act="delete"]');
  await wait("!state.busy");
  await check(
    "delete removes note",
    "!ZY.list.some(n=>n.id===window.editedID)",
  );
  await click('[data-act="undo"]');
  await wait("ZY.list.some(n=>n.id===window.editedID)");
  await check("undo restores note", "ZY.list.some(n=>n.id===window.editedID)");
  await click('[data-p="search"]');
  await input("#q", "上海");
  await wait("!state.searching && state.hits.length===1");
  await check(
    "search returns edited note",
    "state.hits[0].id===window.editedID",
  );
  await evaluate(
    'document.querySelector("#q").focus(); document.querySelector("#q").setSelectionRange(1,1)',
  );
  await evaluate("runSearch()");
  await check(
    "search preserves caret",
    'document.activeElement.id==="q" && document.querySelector("#q").selectionStart===1',
  );
  await click(".memory-card");
  await check(
    "desktop opens adjacent detail",
    '!!document.querySelector(".detail-pane")',
  );
  await screenshot("mac-search");
  await click('[data-p="settings"]');
  await check(
    "settings do not claim live AI or sync",
    '!document.querySelector("#root").textContent.includes("已开启") && !document.querySelector("#root").textContent.includes("使用中")',
  );
  await screenshot("mac-settings");
  await check(
    "desktop Settings stays at the bottom of the sidebar",
    `(()=>{const sidebar=document.querySelector('.sidebar').getBoundingClientRect(),settings=document.querySelector('.sidebar [data-p="settings"]').getBoundingClientRect();return settings.bottom<=sidebar.bottom && sidebar.bottom-settings.bottom<90 && settings.top>document.querySelector('.sidebar-garden').getBoundingClientRect().bottom;})()`,
  );
  await click('[data-p="providers"]');
  await click('[data-service="new-provider"]');
  await check(
    "desktop protocols use the app list instead of a system select",
    '!document.querySelector("select[data-provider-field=protocol]") && document.querySelectorAll("#protocol-options [role=option]").length===4',
  );
  await check(
    "preview never simulates a successful connection",
    'document.querySelector("[data-service=test-provider]").disabled && !Services.providerMessage.includes("连接成功")',
  );
  await input('[data-provider-field="name"]', "我的自定义服务");
  await input(
    '[data-provider-field="baseUrl"]',
    "https://models.example.com/v1",
  );
  await input('[data-provider-field="model"]', "my-model");
  await evaluate(
    'document.querySelector("[data-provider-field=name]").focus()',
  );
  await check(
    "text input does not show focus outline",
    'getComputedStyle(document.activeElement).outlineStyle==="none"',
  );
  await evaluate(
    'document.querySelector("#provider-protocol").scrollIntoView({block:"center"})',
  );
  await sleep(50);
  await click("#provider-protocol");
  await check(
    "protocol menu expands inside the app",
    '!document.querySelector("#protocol-options").hidden && document.querySelector("#provider-protocol").getAttribute("aria-expanded")==="true"',
  );
  await screenshot("mac-protocol-menu");
  await click('#protocol-options [data-value="anthropic"]');
  await check(
    "clicking protocol preserves the other form fields",
    'Services.providerDraft.protocol==="anthropic" && Services.providerDraft.name==="我的自定义服务" && Services.providerDraft.model==="my-model" && document.querySelector("#protocol-options").hidden && document.activeElement.id==="provider-protocol"',
  );
  const key = (key, code = key) =>
    send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await key("ArrowDown");
  await key("Home");
  await key("ArrowDown");
  await key("Enter");
  await check(
    "keyboard commits the highlighted protocol",
    'Services.providerDraft.protocol==="openai-responses" && document.querySelector("#protocol-options").hidden',
  );
  await key("ArrowDown");
  await key("End");
  await key("Escape");
  await check(
    "Escape dismisses without changing the selection",
    'Services.providerDraft.protocol==="openai-responses" && document.querySelector("#protocol-options").hidden',
  );
  await click("#provider-protocol");
  await click(".service-heading h1");
  await check(
    "clicking outside dismisses the protocol menu",
    'document.querySelector("#protocol-options").hidden',
  );
  await click("#provider-protocol");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  });
  await check(
    "Tab dismisses and moves to the next field",
    'document.querySelector("#protocol-options").hidden && document.activeElement.dataset.providerField==="baseUrl"',
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    'document.querySelector("#provider-protocol").scrollIntoView({block:"center"})',
  );
  await sleep(50);
  await click("#provider-protocol");
  await check(
    "menu and Settings remain visible at the minimum desktop size",
    `(()=>{const menu=document.querySelector('#protocol-options').getBoundingClientRect(),scroll=document.querySelector('.content-scroll').getBoundingClientRect(),settings=document.querySelector('.sidebar [data-p="settings"]').getBoundingClientRect();return menu.top>=scroll.top && menu.bottom<=scroll.bottom && settings.bottom<=innerHeight;})()`,
  );
  await evaluate('state.theme="dark";applyTheme()');
  await screenshot("mac-protocol-menu-dark");
  await evaluate('state.theme="light";applyTheme()');
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1120,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("Services.working=true;render()");
  await click("#provider-protocol");
  await check(
    "busy form cannot open or change protocol",
    'document.querySelector("#provider-protocol").disabled && document.querySelector("#protocol-options").hidden',
  );
  await evaluate("Services.working=false;render()");
  await screenshot("mac-providers");
  await evaluate('navigate("sync")');
  await check(
    "sync form contains account and server fields",
    '!!document.querySelector("[data-account-field=url]") && !!document.querySelector("[data-account-field=username]")',
  );
  await screenshot("mac-sync");
  await evaluate('navigate("settings")');
  await click('[data-p="integrations"]');
  await check(
    "external interfaces are reachable from Settings without enabling preview networking",
    'state.page==="integrations" && document.querySelector("[data-gateway=start]").disabled && !ExternalAPI.status.running',
  );
  await check(
    "external access defaults to read-only and loopback",
    'ExternalAPI.config.allow_write===false && document.querySelector(".gateway-page").textContent.includes("127.0.0.1") && document.querySelector(".sb-foot [aria-current=page]")?.dataset.p==="settings"',
  );
  await screenshot("mac-integrations");
  await evaluate('state.theme="dark";applyTheme()');
  await screenshot("mac-integrations-dark");
  await evaluate('state.theme="light";applyTheme()');
  await click('[data-p="capture"]');
  await evaluate('document.getElementById("zy-toast")?.remove()');
  await evaluate('state.platform="ios";mount()');
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(100);
  await screenshot("ios-home");
  await evaluate('navigate("providers")');
  await check(
    "mobile provider form has no horizontal overflow",
    'document.querySelector(".ios-content").scrollWidth<=innerWidth',
  );
  await check(
    "nested service pages keep Settings tab selected",
    'document.querySelector(".ios-tab[aria-current=page]")?.dataset.p==="settings"',
  );
  await check(
    "mobile keeps its four protocol choices and selected value",
    'document.querySelectorAll("select[data-provider-field=protocol] option").length===4 && document.querySelector("select[data-provider-field=protocol]").value==="openai-responses"',
  );
  await screenshot("ios-providers");
  await evaluate('navigate("sync")');
  await screenshot("ios-sync");
  await evaluate('navigate("integrations")');
  await check(
    "mobile explains the desktop host requirement and has no overflow",
    'document.querySelector("[data-gateway=start]").disabled && document.querySelector(".gateway-page").textContent.includes("Mac 或 Windows") && document.querySelector(".ios-content").scrollWidth<=innerWidth',
  );
  await screenshot("ios-integrations");
  await evaluate('navigate("capture")');
  await check(
    "mobile has no horizontal overflow",
    'document.documentElement.scrollWidth<=innerWidth && document.querySelector(".ios-content").scrollWidth<=innerWidth',
  );
  await click('[data-p="timeline"]');
  await screenshot("ios-timeline");
  await click(".memory-card");
  await check(
    "mobile opens full detail",
    'state.page==="detail" && !document.querySelector(".detail-pane")',
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('[data-p="capture"]');
  await check(
    "small mobile has no horizontal overflow",
    'document.querySelector(".ios-content").scrollWidth<=innerWidth',
  );
  await evaluate(
    `state.recording=true;ZY.rec.stop=async()=>({path:'preview-retry.wav',dur:2000});window.originalSave=ZY.save;ZY.save=()=>Promise.reject(new Error('disk full'));document.getElementById('overlay').innerHTML=recordingHTML()`,
  );
  await click('[data-act="rec-done"]');
  await wait("!state.busy");
  await check(
    "stopped recording remains retryable after save failure",
    `!!state.pendingRecording && !!document.querySelector('[data-act="rec-done"]')`,
  );
  await send("Page.reload");
  await wait('typeof state!=="undefined" && state.loaded');
  await check(
    "recording retry survives restart",
    `state.pendingRecording?.path==="preview-retry.wav" && !!document.querySelector('[data-act="rec-done"]')`,
  );
  await click('[data-act="rec-done"]');
  await wait("!state.busy && !state.pendingRecording");
  await check(
    "retry stores one recording without recording again",
    'ZY.list.filter(n=>n.audio==="preview-retry.wav").length===1',
  );
  await check(
    "recording duration is displayed in seconds",
    'ZY.list.find(n=>n.audio==="preview-retry.wav").dur===2',
  );
  // Account deletion: two confirmation steps, then local binding is cleared.
  await evaluate(
    `window.deleteCalls=[];Services.call=async(op,args)=>{deleteCalls.push([op,args]);if(op==="secretGet")return "tok";if(op==="accountDelete")return {account:null,enabled:false,pending:0,conflicts:0};if(op==="servicesGet")return {providers:[],sync:{account:null,enabled:false},jobs:[]};return null;};Services.sync={enabled:true,account:{username:"alice",url:"https://sync.example",user_id:"u1"},pending:0,conflicts:0};navigate("sync")`,
  );
  await click('[data-service="delete-account-start"]');
  await input('[data-delete-field="confirm"]', "bob");
  await input('[data-delete-field="password"]', "fixture-password-123");
  await click('[data-service="delete-account-next"]');
  await check(
    "wrong username blocks account deletion",
    'Services.deleteAccount.step===1 && !deleteCalls.some(c=>c[0]==="accountDelete")',
  );
  await input('[data-delete-field="confirm"]', "alice");
  await click('[data-service="delete-account-next"]');
  await check(
    "account deletion asks a second time",
    '!!document.querySelector(\'[data-service="delete-account-confirm"]\') && !deleteCalls.some(c=>c[0]==="accountDelete")',
  );
  await click('[data-service="delete-account-confirm"]');
  await wait("!Services.working");
  await check(
    "account deletion clears local binding and token",
    'deleteCalls.some(c=>c[0]==="accountDelete"&&c[1].confirm==="alice"&&c[1].token==="tok") && deleteCalls.some(c=>c[0]==="secretDelete"&&c[1].key==="sync.u1") && !Services.sync.enabled && Services.deleteAccount.password===""',
  );
  await check("no browser JS errors", JSON.stringify(errors.length === 0));
  console.log(JSON.stringify({ checks, screenshots: output }, null, 2));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    ws?.close();
    chrome.kill();
    setTimeout(() => {
      fs.rmSync(profile, { recursive: true, force: true });
      process.exit(process.exitCode || 0);
    }, 300);
  });
