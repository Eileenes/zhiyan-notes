// 主题切换功能自测：用 CDP 真实点击，再刷新验证 localStorage 是否生效
// 用法: node theme-test.js
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, 'index.html') + '?still=1#settings';
const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-prof-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1400,1000', FILE,
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

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const ready = new Promise(r => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise(res => {
    const n = ++id;
    waiting.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { ready, send };
}

const evalJS = async (send, expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

// 等 app.js 渲染完（原型是 innerHTML 注入，脚本执行完才出现节点）
async function waitFor(send, expr, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await evalJS(send, expr)) return true;
    await sleep(150);
  }
  return false;
}

(async () => {
  const wsUrl = await endpoint();
  const { ready, send } = connect(wsUrl);
  await ready;

  const out = [];
  const check = (name, actual, expected) => {
    const ok = actual === expected;
    out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${actual}${ok ? '' : ` (期望 ${expected})`}`);
    return ok;
  };

  // 0. 等渲染完成
  const rendered = await waitFor(send, `!!document.querySelector('[data-act="theme"][data-v="dark"]')`);
  if (!rendered) { console.log('FAIL  页面未渲染出外观控件'); chrome.kill(); process.exit(2); }

  // 1. 默认：跟随系统（本机系统为浅色）
  let t = await evalJS(send, 'document.documentElement.dataset.theme');
  check('初始（无 localStorage，跟随系统→浅色）', t, 'light');

  // 2. 真实点击侧栏「深色」
  await evalJS(send, `[...document.querySelectorAll('[data-act="theme"]')]
    .find(b => b.dataset.v === 'dark').click()`);
  t = await evalJS(send, 'document.documentElement.dataset.theme');
  check('点击「深色」后 data-theme', t, 'dark');

  // 3. localStorage 是否落盘
  let stored = await evalJS(send, 'localStorage.getItem("mn-theme")');
  check('localStorage["mn-theme"]', stored, 'dark');

  // 4. 刷新后是否保持
  await send('Page.reload', { ignoreCache: true });
  await sleep(500);
  await waitFor(send, `!!document.querySelector('[data-act="theme"][data-v="dark"]')`);
  t = await evalJS(send, 'document.documentElement.dataset.theme');
  check('刷新后仍是深色', t, 'dark');

  // 5. color-scheme 是否跟着变
  let cs = await evalJS(send, 'document.documentElement.style.colorScheme');
  check('color-scheme', cs, 'dark');

  // 6. 切回「浅色」
  await evalJS(send, `[...document.querySelectorAll('[data-act="theme"]')]
    .find(b => b.dataset.v === 'light').click()`);
  t = await evalJS(send, 'document.documentElement.dataset.theme');
  check('点击「浅色」后 data-theme', t, 'light');
  cs = await evalJS(send, 'document.documentElement.style.colorScheme');
  check('color-scheme 跟随', cs, 'light');

  // 7. 选中的那一格是否高亮。
  //    侧栏的外观切换已移入设置页，现在全 App 只有一个外观控件，
  //    所以期望值从 'ok,ok' 改为 'ok'。
  const perCtrl = await evalJS(send, `
    [...document.querySelectorAll('.seg')].map(function (seg) {
      var on = seg.querySelectorAll('.seg-i.on');
      if (on.length !== 1) return 'bad:' + on.length;
      return on[0].dataset.v === 'light' ? 'ok' : 'bad:' + on[0].dataset.v;
    }).join(',')`);
  check('每个外观控件恰好一项高亮且选中浅色', perCtrl, 'ok');

  // 7b. 外观控件应当只存在于设置页（侧栏不再堆叠）
  const segCount = await evalJS(send, `document.querySelectorAll('.seg').length`);
  check('外观控件数量（侧栏已清空）', segCount, 1);

  // 7c. 侧栏底部只剩设置入口
  const sbFoot = await evalJS(send, `
    (function () {
      var f = document.querySelector('.sb-foot');
      if (!f) return 'missing';
      var labels = [...f.querySelectorAll('.sb-item span')].map(function (s) { return s.textContent.trim(); });
      return labels.join('|');
    })()`);
  check('侧栏底部只含设置入口', sbFoot, '设置');

  // 7d. 侧栏不应再出现重复的「本机」「可随时导出」
  const sbNoise = await evalJS(send, `
    (function () {
      var s = document.querySelector('.sidebar');
      return /可随时导出/.test(s.textContent) ? 'noise:sf-line'
           : /本机/.test(s.textContent) ? 'noise:sb-sub'
           : 'clean';
    })()`);
  check('侧栏无重复的说明文字', sbNoise, 'clean');

  // 8. 双端联动可见：时间线上来自另一台设备的条目必须带来源标记。
  //    注意：原型是 hash 路由，改 hash 不会重新 render()，
  //    必须走应用自己的导航入口（点击侧栏「记忆」），否则读到的是旧页面的 DOM。
  await evalJS(send, `
    [...document.querySelectorAll('.sb-item')]
      .find(function (b) { return b.dataset.p === 'timeline'; }).click()`);
  await sleep(300);
  await waitFor(send, `!!document.querySelector('.mem')`);
  const fromMarks = await evalJS(send, `
    (function () {
      var all = [...document.querySelectorAll('.mem')];
      var withFrom = all.filter(function (m) { return m.querySelector('.mem-from'); });
      if (!all.length) return 'no-cards';
      if (!withFrom.length) return 'no-marks';
      // 标记文案必须是中文设备名，不能是 ios / mac
      var txt = withFrom.map(function (m) { return m.querySelector('.mem-from').textContent.trim(); });
      var bad = txt.filter(function (t) { return t !== '手机' && t !== '电脑'; });
      return bad.length ? 'bad-text:' + bad.join('|') : 'ok:' + txt.length;
    })()`);
  check('时间线标出来源设备（中文文案）', fromMarks, 'ok:2');

  // 9. 系统主题变化监听是否挂上
  const listening = await evalJS(send, 'window.matchMedia("(prefers-color-scheme: dark)").matches');
  check('matchMedia 可读（监听已注册的前提）', typeof listening, 'boolean');

  // 10. 侧栏收起：真实点击顶栏按钮，验证宽度变化 + 落盘 + 刷新保持
  const w0 = await evalJS(send, `document.querySelector('.sidebar').offsetWidth`);
  await evalJS(send, `document.querySelector('[data-act="sb-toggle"]').click()`);
  await sleep(400);
  const w1 = await evalJS(send, `document.querySelector('.sidebar').offsetWidth`);
  check('点击收起后侧栏变窄', w1 < w0, true);
  check('收起后宽度为图标条', w1, 56);

  const sbStored = await evalJS(send, 'localStorage.getItem("mn-sidebar")');
  check('localStorage["mn-sidebar"]', sbStored, '0');

  await send('Page.reload', { ignoreCache: true });
  await sleep(600);
  await waitFor(send, `!!document.querySelector('.sidebar')`);
  const w2 = await evalJS(send, `document.querySelector('.sidebar').offsetWidth`);
  check('刷新后仍保持收起', w2, 56);

  // 收起态下品牌名必须不出现、标记必须出现，否则用户认不出这是哪个 App。
  // 现在的实现更彻底：收起态根本不渲染 <h1>，标记本身变成展开按钮。
  const collapsedBrand = await evalJS(send, `
    (function () {
      var h = document.querySelector('.sb-brand h1');
      var m = document.querySelector('.sb-mark');
      if (!m) return 'mark-missing';
      var hHidden = !h || getComputedStyle(h).display === 'none';
      var mShown = getComputedStyle(m).display !== 'none';
      return (hHidden && mShown) ? 'ok' : 'bad:h=' + hHidden + ',m=' + mShown;
    })()`);
  check('收起态品牌名不显示、标记显示', collapsedBrand, 'ok');

  // 收起态只能有一个展开入口。开关在这个状态下没有意义（它已经收起了），
  // 留着只会让 56px 的图标条挤两个控件。
  const collapsedEntries = await evalJS(send,
    `document.querySelectorAll('[data-act="sb-toggle"]').length`);
  check('收起态只剩一个展开入口（猫头鹰）', collapsedEntries, 1);

  // 展开回来，恢复默认状态
  await evalJS(send, `document.querySelector('[data-act="sb-toggle"]').click()`);
  await sleep(400);
  const w3 = await evalJS(send, `document.querySelector('.sidebar').offsetWidth`);
  check('再次点击恢复展开', w3, 212);

  // 11. 顶栏标题必须保持纯文字（不加图标），理由同上
  const navMark = await evalJS(send, `
    (function () {
      var t = document.querySelector('.mac-title');
      if (!t || t.textContent.trim() !== '只言') return 'bad';
      return t.querySelector('svg') ? 'has-icon' : 'ok';
    })()`);
  check('macOS 顶栏标题为纯文字产品名', navMark, 'ok');

  // iOS 导航标题必须保持纯文字。
  // 曾经试过在标题前放产品标记，15px 下两段弧线读不出来，像残缺符号——
  // 这条断言是为了防止以后又把它加回来。
  // 切到 iOS 端再验导航标题（原型顶部有平台切换按钮）
  await evalJS(send, `
    [...document.querySelectorAll('[data-plat]')]
      .find(function (b) { return b.dataset.plat === 'ios'; }).click()`);
  await sleep(400);
  const iosTitle = await evalJS(send, `
    (function () {
      var t = document.querySelector('.ios-nav-title');
      if (!t) return 'missing';
      var svg = t.querySelector('svg');
      if (svg) return 'has-icon';
      return t.textContent.trim() ? 'ok:' + t.textContent.trim() : 'empty';
    })()`);
  check('iOS 导航标题为纯文字（不加图标）', iosTitle, 'ok:记忆');

  // 12. 真机回归护栏 —— 这条断言是被一次真实 bug 逼出来的。
  //
  //     背景：app-embed.css 会把「演示外壳」整块 display:none（.mac-titlebar /
  //     .proto-bar / .iphone 机身 / .ios-statusbar …）。侧栏收起开关原本住在
  //     .mac-titlebar 里，真机上那个按钮整个不存在 —— 用户在真机里完全收起不了。
  //     而本文件跑在原型页面上，.mac-titlebar 是存在的，所以上面第 10 项的
  //     收起断言全程绿灯，结构性地抓不到这个 bug。
  //
  //     做法：直接读 build/mac/app-embed.css 把被隐藏的选择器抠出来，
  //     再回到真实 DOM 里查这些选择器底下有没有 [data-act]。
  //     两个平台的 DOM 都要查 —— 外壳是按平台整块换掉的。
  const embedPath = path.resolve(__dirname, '../build/mac/app-embed.css');
  function hiddenSelectors(css) {
    // 必须先剥注释：CSS 注释里没有花括号，不剥的话正则会把整段注释
    // 连同下一个选择器一起当成选择器。
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean))) {
      if (!/display\s*:\s*none\s*!important/.test(m[2])) continue;
      m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => out.push(s));
    }
    // .proto-bar 本身就是演示控制条 —— 它里面的平台切换 / 主题切换
    // 全是原型专用控件，真实 App 里理应不存在，不算「被困住的入口」。
    return out.filter(s => s !== '.proto-bar');
  }
  const hiddenSels = fs.existsSync(embedPath)
    ? hiddenSelectors(fs.readFileSync(embedPath, 'utf8'))
    : [];

  async function trappedInHiddenChrome(label) {
    if (!hiddenSels.length) return check(label + '：外壳清单可读', 'missing', hiddenSels.length);
    const trapped = await evalJS(send, `(function () {
      var sels = ${JSON.stringify(hiddenSels)};
      var bad = [];
      sels.forEach(function (s) {
        var found;
        try { found = document.querySelectorAll(s + ' [data-act]'); } catch (e) { return; }
        if (found.length) bad.push(s + '→' + found.length);
      });
      return bad.join(' ') || 'none';
    })()`);
    check(label + '：可交互元素没住进真机被隐藏的外壳', trapped, 'none');
  }

  await trappedInHiddenChrome('iOS');
  await evalJS(send, `
    [...document.querySelectorAll('[data-plat]')]
      .find(function (b) { return b.dataset.plat === 'mac'; }).click()`);
  await sleep(400);
  await trappedInHiddenChrome('macOS');

  // 13. 收起之后必须还够得着开关 —— 收起功能最容易出的错就是把自己关在里面。
  await evalJS(send, `document.querySelector('[data-act="sb-toggle"]').click()`);
  await sleep(400);
  const canExpand = await evalJS(send, `
    (function () {
      var b = document.querySelector('[data-act="sb-toggle"]');
      if (!b) return 'gone';
      var r = b.getBoundingClientRect();
      return r.width >= 20 && r.height >= 20 ? 'reachable' : 'too-small';
    })()`);
  check('收起后开关仍可见可点（没把自己关进去）', canExpand, 'reachable');
  await evalJS(send, `document.querySelector('[data-act="sb-toggle"]').click()`);
  await sleep(300);

  // 14. 侧栏与内容区的分界线必须用弱线。原实现用的是 --line-3（.26 alpha），
  //     注释却写着「更弱的一档」—— 注释和值是反的，合成到 #E4E9F0 上是
  //     RGB(180,183,187) 的硬边。断言直接量合成后的实际色差。
  const sep = await evalJS(send, `
    (function () {
      var s = document.querySelector('.sidebar');
      var c = document.querySelector('.content');
      if (!s || !c) return 'missing';
      return getComputedStyle(c).borderLeftWidth + ' ' + getComputedStyle(c).borderLeftColor;
    })()`);
  check('内容区分界线为 1px', String(sep).split(' ')[0], '1px');
  check('内容区分界线用的是弱线档（非 --line-3）',
    /rgba\(20,\s*23,\s*28,\s*0\.09\)|rgba\(255,\s*255,\s*255,\s*0\.09\)/.test(String(sep)), true);

  // 15. 侧栏三个入口必须完全一致 —— 这条是被用户指出来的。
  //     记一笔曾经带 .sb-primary：常驻青蓝字色、选中多一条青蓝左边线、
  //     下方多 8px 间距。同一个导航栏里于是出现两种选中态、两种间距、
  //     两种未选中色，切换页面时要先判断自己在第几组。
  //     这里把三者的计算样式逐项比对（未选中 / 选中各比一次），
  //     再量相邻项的真实像素间距。
  const navParity = await evalJS(send, `
    (function () {
      var items = [...document.querySelectorAll('.sb-nav .sb-item')];
      if (items.length < 3) return 'too-few:' + items.length;
      var sig = function (el) {
        var s = getComputedStyle(el);
        return [s.backgroundColor, s.color, s.fontWeight, s.fontSize,
                s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight,
                s.marginBottom, s.boxShadow, s.borderRadius].join('|');
      };
      var diff = function (on) {
        items.forEach(function (el) { el.classList.toggle('on', on); });
        var base = sig(items[0]);
        var bad = [];
        items.forEach(function (el, i) {
          if (i && sig(el) !== base) bad.push(i + ':' + sig(el));
        });
        return bad.length ? bad.join(' ; ') : 'same';
      };
      var unselected = diff(false);
      var selected = diff(true);
      // 还原
      items.forEach(function (el, i) { el.classList.toggle('on', i === 1); });
      var gaps = [];
      for (var i = 1; i < items.length; i++) {
        gaps.push(Math.round(items[i].getBoundingClientRect().top
                   - items[i - 1].getBoundingClientRect().bottom));
      }
      return { unselected: unselected, selected: selected, gaps: gaps.join(',') };
    })()`);
  check('三个导航项未选中态样式一致', navParity.unselected, 'same');
  check('三个导航项选中态样式一致', navParity.selected, 'same');
  // 不写死间距值，只断言三者相等 —— 间距本身（.sb-nav 的 gap）
  // 是可以调的，但绝不允许只有其中一项特殊（那正是 .sb-primary 的 8px margin）。
  check('三个导航项间距一致（彼此相等即可）',
    new Set(navParity.gaps.split(',')).size === 1, true);

  // 16. 「能记什么」必须是四条真实案例句，且真的能点开填入。
  //     原来的断言要求「5 个分类标签且不可点击」，理由是「示例句点了
  //     是代笔」。用户判定那不是他要的：分类标签说的是机器会抽出什么
  //     字段（输出侧），回答不了「我该写什么」（输入侧）。
  //     现在案例可点，但只是填进输入框让人接着改 —— 不自动保存，
  //     不替用户决定这条记什么，所以不构成代笔。
  //     四条而非五条：真机窗口装不下，被砍掉的「主题」类仍出现在
  //     下面「怎么用」那行的文案里，类别名没有消失。
  await evalJS(send, `
    [...document.querySelectorAll('[data-act="nav"]')]
      .find(function (b) { return b.dataset.p === 'capture'; }).click()`);
  await sleep(400);
  const capEx = await evalJS(send, `
    (function () {
      var ks = [...document.querySelectorAll('.cap-item')];
      if (ks.length !== 4) return 'count:' + ks.length;
      var txt = ks.map(function (k) { return k.querySelector('span').textContent.trim(); }).join('|');
      // 每条都必须带一个实体图标，否则「会被识别成什么」这句话就没兑现
      var noIcon = ks.filter(function (k) { return !k.querySelector('svg'); }).length;
      if (noIcon) return 'no-icon:' + noIcon;
      return txt;
    })()`);
  check('输入页有 4 条「能记什么」案例，每条带实体图标', capEx,
    '妈最近总说膝盖疼，找个骨科看看|巷子第二家面馆，汤头比第一家好|周四下午三点跟房东谈续租|周五前把护照照片重新拍一张');

  // 案例点一下要真的填进输入框、光标落在末尾，且不自动跳页。
  const capFill = await evalJS(send, `
    (function () {
      var before = location.hash;
      document.querySelectorAll('.cap-item')[2].click();
      var t = document.getElementById('cap-input');
      if (!t) return 'no-input';
      if (t.value !== '周四下午三点跟房东谈续租') return 'value:' + t.value;
      if (document.activeElement !== t) return 'not-focused';
      if (t.selectionStart !== t.value.length) return 'caret:' + t.selectionStart;
      // 光标在末尾 = 用户可以接着写，不覆盖已有内容
      t.value = ''; t.dispatchEvent(new Event('input'));
      if (location.hash !== before) return 'navigated:' + location.hash;
      return 'ok';
    })()`);
  check('案例点一下填入输入框、光标在末尾、不自动跳页', capFill, 'ok');

  // 17. 「怎么用」两行：动作 + 结果。这两件事界面自证不了，
  //     因为记下的那一刻摘要和标签还不存在。
  const capFlow = await evalJS(send, `
    (function () {
      var rows = [...document.querySelectorAll('.cap-flow-row')];
      if (rows.length !== 2) return 'count:' + rows.length;
      var out = rows.map(function (r) {
        var dt = r.querySelector('dt'), dd = r.querySelector('dd');
        if (!dt || !dd) return 'missing';
        if (!dd.textContent.trim()) return 'empty-dd';
        return dt.textContent.trim() + '=' + dd.textContent.trim();
      }).join('|');
      return out;
    })()`);
  check('输入页有 2 行「怎么用」，动作与结果都非空', capFlow,
    '记下来之后=自动转成文字、提炼摘要、标出人 / 地点 / 时间 / 待办|以后想找=在「记忆」看时间线，在「搜索」打关键词');

  // 17b. 两端「怎么用」的 dt 和 dd 都不能折行。
  //     折行会破坏两两对读的结构：「待办」掉到第二行后行间距被拉开，
  //     「记下来之」+「后」拆开后左列宽度也不再对齐。
  //     dt 也必须查 —— 只查 dd 漏掉了「dt 写死宽度导致左列折行」这个真 bug。
  //     判据：渲染高度不超过单行行高的 1.6 倍（留余量给字体行高）。
  for (const plat of ['macOS', 'iOS']) {
    await evalJS(send, `
      [...document.querySelectorAll('.proto-switch button')]
        .find(function (b) { return b.textContent.trim() === '${plat}'; }).click()`);
    await sleep(500);
    const wrapped = await evalJS(send, `
      (function () {
        var bad = [];
        ['dt', 'dd'].forEach(function (tag) {
          document.querySelectorAll('.cap-flow ' + tag).forEach(function (e, i) {
            var lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
            var rows = Math.round(e.getBoundingClientRect().height / lh);
            if (rows > 1) bad.push(tag + i + ':' + rows);
          });
        });
        // 两行左列宽度必须相等（都是五个字），否则右列起点不对齐
        var dts = [...document.querySelectorAll('.cap-flow dt')];
        var w0 = Math.round(dts[0].getBoundingClientRect().width);
        var w1 = Math.round(dts[1].getBoundingClientRect().width);
        if (Math.abs(w0 - w1) > 1) bad.push('dt-width:' + w0 + 'vs' + w1);
        return bad.length ? bad.join(',') : 'none';
      })()`);
    check(`${plat}：「怎么用」左右两列都不折行、左列等宽`, wrapped, 'none');
  }
  await evalJS(send, `
    [...document.querySelectorAll('.proto-switch button')]
      .find(function (b) { return b.textContent.trim() === 'macOS'; }).click()`);
  await sleep(400);

  // 18. 输入页整块内容必须在真机窗口高度内，不靠滚动才看得到「怎么用」。
  //     真机是 NSWindow(contentRect: 1120×760)，WebView 拿到 760px。
  //     这条断言在 1400×1000 的无头窗口里跑，只能守住结构不回归
  //     （条目数 + 总高度上限），真值仍以真机截图为准。
  const capFit = await evalJS(send, `
    (function () {
      var fl = document.querySelector('.cap-flow');
      if (!fl) return 'no-flow';
      var bottom = fl.getBoundingClientRect().bottom;
      // 用 .content 的可视底算，而不是 window.innerHeight：
      // 原型页顶部有演示控制条，真机没有，两者不能直接比
      var c = document.querySelector('.content') || document.body;
      var limit = c.getBoundingClientRect().bottom;
      return { bottom: +bottom.toFixed(0), limit: +limit.toFixed(0), gap: +(limit - bottom).toFixed(0) };
    })()`);
  check('「怎么用」落在内容区可视范围内（不需滚动）',
    capFit.gap >= 0, true);

  // 17. 首次引导：看完只出现一次，且落盘。
  const ob = await evalJS(send, `
    (function () {
      try { localStorage.removeItem('mn-onboarded'); } catch (e) {}
      return 'cleared';
    })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(700);
  await waitFor(send, `!!document.querySelector('.sidebar')`);
  // 重载后必须回到输入页（初��� page 就是 capture）
  const obShown = await evalJS(send, `!!document.querySelector('.ob-card')`);
  check('未看过时首次进入弹引导', obShown, true);

  await evalJS(send, `document.querySelector('[data-act="ob-start"]').click()`);
  await sleep(300);
  const obAfter = await evalJS(send, `
    (function () {
      var gone = !document.querySelector('.ob-card');
      var stored = localStorage.getItem('mn-onboarded');
      var focused = document.activeElement && document.activeElement.id === 'cap-input';
      return { gone: gone, stored: stored, focused: focused };
    })()`);
  check('点「开始记录」后引导消失', obAfter.gone, true);
  check('引导标记已落盘', obAfter.stored, '1');
  check('点完自动聚焦输入框', obAfter.focused, true);

  await send('Page.reload', { ignoreCache: true });
  await sleep(700);
  await waitFor(send, `!!document.querySelector('.sidebar')`);
  const obAgain = await evalJS(send, `!!document.querySelector('.ob-card')`);
  check('刷新后不再弹（只讲一次）', obAgain, false);

  console.log(out.join('\n'));
  console.log(out.every(l => l.startsWith('PASS')) ? '\n全部通过' : '\n有失败项');

  wsClose();
  chrome.kill();
  process.exit(out.every(l => l.startsWith('PASS')) ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); chrome.kill(); process.exit(2); });

function wsClose() { try { require('ws'); } catch (e) {} }