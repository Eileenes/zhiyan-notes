// 一次性布局测量脚本：注入 getBoundingClientRect() 实测，不靠估算。
// 用法: node measure-cap.js
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, 'index.html') + '?still=1&sb=1&ob=0#capture';
const PORT = 9334;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-meas-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1000,860', FILE,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome 没起来');
}

(async () => {
  const ws = new WebSocket(await endpoint());
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiting.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await sleep(1200);
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(function () {
      var out = {};
      // dt 是否溢出压到右列
      out.dt = [];
      document.querySelectorAll('.cap-flow dt').forEach(function (d) {
        var r = d.getBoundingClientRect();
        var dd = d.nextElementSibling.getBoundingClientRect();
        out.dt.push({
          text: d.textContent, fs: getComputedStyle(d).fontSize,
          boxW: +r.width.toFixed(1), scrollW: d.scrollWidth,
          overflowPx: +(d.scrollWidth - d.clientWidth).toFixed(1),
          ddLeft: +dd.left.toFixed(1), overlapPx: +(r.right - dd.left).toFixed(1),
        });
      });
      var lead = document.querySelector('.cap-lead');
      var item = document.querySelector('.cap-item');
      var dd = document.querySelector('.cap-flow dd');
      out.colors = {
        lead: getComputedStyle(lead).color,
        item: getComputedStyle(item).color,
        dt: getComputedStyle(document.querySelector('.cap-flow dt')).color,
        dd: getComputedStyle(dd).color,
      };
      out.itemFs = getComputedStyle(item).fontSize;
      out.itemH = +item.getBoundingClientRect().height.toFixed(1);
      out.leadToFirst = +(document.querySelector('.cap-item').getBoundingClientRect().top
                           - lead.getBoundingClientRect().bottom).toFixed(1);
      out.lastItemToFlow = +(document.querySelector('.cap-flow').getBoundingClientRect().top
                           - [...document.querySelectorAll('.cap-item')].pop().getBoundingClientRect().bottom).toFixed(1);
      out.docH = document.documentElement.scrollHeight;
      out.winH = window.innerHeight;
      out.contentBottom = +document.querySelector('.cap-flow').getBoundingClientRect().bottom.toFixed(1);
      return JSON.stringify(out);
    })()`,
  });
  console.log(JSON.stringify(JSON.parse(r.result.result.value), null, 2));
  ws.close();
  chrome.kill();
  process.exit(0);
})();
