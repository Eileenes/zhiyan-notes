/* ==========================================================================
   只言 · 原型渲染层
   —— 组件复用 macOS / iOS 两端，只换外壳
   —— 文案规则：界面上每一句中文都必须功能性。描述功能不超过三个字，
      不解释为什么这样设计，不讲故事。没有文案的地方就留空。
   ========================================================================== */

/* —— 图标 —————————————————————————————————————
   全部手绘，统一 24 网格、统一 stroke-width 1.7、统一圆头圆角。
   几何对齐规则：单个图形的视觉中心落在 (12,12)，光学的比几何的更重要。 */
const ICONS = {
  // 麦克风：胶囊体居中于上半，下方托架圆弧与立杆同轴，三段严格共轴
  mic:      '<rect x="9" y="2.6" width="6" height="10.4" rx="3"/><path d="M5.6 10.6v1.6a6.4 6.4 0 0 0 12.8 0v-1.6"/><path d="M12 18.6v2.8"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  timeline: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  // 齿轮：外圈用等分虚线画齿 —— 之前的手写齿形路径左右不对称。
  // 6 齿（不是 8 齿）：周期更长，齿才拉得开，16px 下才读得出是齿轮而不是点阵圆
  gear:     '<circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="12" r="8.6" stroke-dasharray="3.8 5.2"/>',
  // 盾牌：上下左右严格对称，顶点 2.8 / 底点 21.2，中心 12
  shield:   '<path d="M12 2.8 4.6 5.6v6.1c0 4.5 3.1 7.7 7.4 9.5 4.3-1.8 7.4-5 7.4-9.5V5.6L12 2.8Z"/>',
  // 标签：方形角在左下、尖端在右上，圆角半径统一 2
  tag:      '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><circle cx="7" cy="7" r="1.25"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  sparkle:  '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  send:     '<path d="m22 2-7 20-4-9-9-4 20-7Z"/>',
  check:    '<path d="M20 6 9 17l-5-5"/>',
  play:     '<path d="M6 3.5 19 12 6 20.5v-17Z"/>',
  pause:    '<path d="M8 4v16M16 4v16"/>',
  x:        '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron:  '<path d="m9 18 6-6-6-6"/>',
  arrowL:   '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowR:   '<path d="M5 12h14M12 5l7 7-7 7"/>',
  refresh:  '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  alert:    '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  note:     '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  phone:    '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  laptop:   '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M2 20h20"/>',
  bolt:     '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  cloud:    '<path d="M18 10a4 4 0 0 0-8 .5A3.5 3.5 0 0 0 6.5 17H18a4 4 0 0 0 0-8Z"/>',
  link:     '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/>',
  empty:    '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>',

  /* —— 侧栏收起 / 展开 ————————————————————
     两个图标只差竖线的位置：收起=面板+左竖线，展开=面板+右竖线。
     竖线画在面板内侧 1/3 处，与边框留出可见间距 */
  panelClose: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',

  /* —— 产品标记 ————————————————————————————
     三道同心弧向右上张开，与同名应用图标同源但更简（去掉圆心、减到三道）。
     用在各端导航栏应用名前，让「打开 App」和「在 App 里」有同一个视觉锚点 */
  mark:    '<path d="M5.4 15.6a7.4 7.4 0 0 1 0-10.5"/><path d="M10.2 18.6a10.6 10.6 0 0 1 0-15"/>',

  /* —— 破坏性操作与实体类型 ————————————————————
     trash 原来用的是 x（关闭），语义错：x 是「收起」，trash 才是「不可逆」。
     桶身收口不夸张（底 5.8 / 顶 11.4），16px 下才读得出是垃圾桶不是水桶；
     竖向占位 3.2–20.5，中心 11.85 */
  trash:    '<path d="M3.6 6.2h16.8"/><path d="M9.2 6.2V4.8a1.6 1.6 0 0 1 1.6-1.6h2.4a1.6 1.6 0 0 1 1.6 1.6v1.4"/><path d="M6.3 6.2 7.2 18.7a1.9 1.9 0 0 0 1.9 1.8h5.8a1.9 1.9 0 0 0 1.9-1.8l.9-12.5"/>',
  // 人：头 + 肩，头与肩之间留 2.2 的气口，13px 下不会粘成一个块
  user:     '<circle cx="12" cy="7.8" r="3.7"/><path d="M5.2 20c0-3.6 3.04-6.5 6.8-6.5s6.8 2.9 6.8 6.5"/>',
  // 地点：图钉。头圆心 (12,9) r=6.2，尖角 (12,21.4)，占位 2.8–21.4，中心 12.1
  // 内圈取 r=2 而不是 3：外圈描边内缘在 5.3，两圈之间留出 1.25px 才不会被描边糊死
  pin:      '<path d="M18.2 9a6.2 6.2 0 1 0-12.4 0c0 5.7 3.3 10.9 6.2 12.4 2.9-1.5 6.2-6.7 6.2-12.4Z"/><circle cx="12" cy="9" r="2"/>',
  // 可调项：三条横轨 + 三个实心滑块。
  // 滑块必须明显大于描边（r=2.6 对 1.7 的线宽），否则 16px 下整块读成
  // 「三行带污点的线」。为此把轨距从 6/12/18 压到 5.6/12/18.4，滑块上下留 1.2 的缝。
  // 轨道在滑块两侧断开而不是从圆里穿过去，13px 下不会串成一根带珠子的线
  sliders:  '<path d="M3.6 5.6h1.8M9.4 5.6h11M3.6 12h9.8M16.8 12h3.6M3.6 18.4h4.4M11.6 18.4h8.8"/><circle cx="8" cy="5.6" r="2.6" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="10.4" cy="18.4" r="2.6" fill="currentColor" stroke="none"/>',

  /* —— 外观：系统 / 浅色 / 深色 ————————————————
     半填充圆 = 「跟随系统」，是 iOS/macOS 通用的自动态符号 */
  auto:     '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none"/>',
  sun:      '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.7v2.1M12 19.2v2.1M2.7 12h2.1M19.2 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5"/>',
  moon:     '<path d="M20.6 14.4A8.7 8.7 0 0 1 9.6 3.4 9 9 0 1 0 20.6 14.4Z"/>',
};
const svg = (n, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* 产品标记：专供小尺寸的猫头鹰剪影（icon/mark-small.svg，源在 icon/tools/mark_small.py）。
   不能塞进 ICONS —— 它的 viewBox 是 16 而不是 24，塞进去会被缩到左上角 2/3。
   画法也完全不同：纯剪影 + 眼睛用 evenodd 镂空，所以是 fill 不是 stroke；
   渐变、描边、橘喙、圆角底块四样在小尺寸下都是噪点，全部不要了。
   取色跟 --tx-1（中性文字色），不抢青蓝强调色：浅底 14.72:1，深底 17.36:1。 */
const MARK_PATH = 'M 8 2.93 C 8.44 2.93 8.96 2.63 9.32 2.34 C 9.68 2.04 9.81 1.41 10.15 1.14 C 10.49 0.87 10.95 0.76 11.35 0.72 C 11.75 0.68 12.17 0.68 12.55 0.9 C 12.93 1.12 13.32 1.6 13.62 2.04 C 13.92 2.47 14.13 2.92 14.34 3.53 C 14.55 4.14 14.77 4.91 14.88 5.69 C 14.99 6.46 15.01 7.44 15 8.2 C 14.99 8.96 14.91 9.61 14.82 10.23 C 14.73 10.85 14.64 11.41 14.46 11.91 C 14.28 12.41 14.08 12.87 13.74 13.22 C 13.4 13.57 12.97 13.81 12.43 14 C 11.89 14.19 11.25 14.28 10.51 14.36 C 9.77 14.44 8.84 14.48 8 14.48 C 7.16 14.48 6.23 14.44 5.49 14.36 C 4.75 14.28 4.11 14.19 3.57 14 C 3.03 13.81 2.6 13.57 2.26 13.22 C 1.92 12.87 1.72 12.41 1.54 11.91 C 1.36 11.41 1.27 10.85 1.18 10.23 C 1.09 9.61 1.01 8.96 1 8.2 C 0.99 7.44 1.01 6.46 1.12 5.69 C 1.23 4.91 1.45 4.14 1.66 3.53 C 1.87 2.92 2.08 2.47 2.38 2.04 C 2.68 1.6 3.07 1.12 3.45 0.9 C 3.83 0.68 4.25 0.68 4.65 0.72 C 5.05 0.76 5.51 0.87 5.85 1.14 C 6.19 1.41 6.32 2.04 6.68 2.34 C 7.04 2.63 7.56 2.93 8 2.93 Z M 2.99 6.88a 1.9 1.9 0 1 0 3.81 0a 1.9 1.9 0 1 0 -3.81 0Z M 9.21 6.88a 1.9 1.9 0 1 0 3.81 0a 1.9 1.9 0 1 0 -3.81 0Z';
const markSvg = () => `<svg class="mark-svg" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="${MARK_PATH}"/></svg>`;

/* 实体类型 → 图标。
   类型名（「人」「地点」）本身只有两个字，但四类的形态完全不同：
   人名是专名、地点是场所、时间是时刻、待办要勾。
   图标让人不读字就能分出行属于哪一类 —— 这是识别锚点，不是填空。 */
const ENT_ICON = { 人: 'user', 地点: 'pin', 时间: 'clock', 待办: 'check', 主题: 'tag' };

/* 额度项 → 图标。两根进度条形状完全一样，不加图标只能靠左边两个字区分 */
const QUOTA_ICON = { asr: 'mic', summary: 'sparkle' };

/* —— 工具 ——————————————————————————————————————— */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* 确定性伪随机：同一 seed 永远同一结果，保证截图可复现 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const terms = q.trim().split(/\s+/).filter(t => t.length >= 1);
  if (!terms.length) return safe;
  let out = safe;
  terms.forEach(t => {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    out = out.replace(re, '<span class="hit">$1</span>');
  });
  return out;
}

/* ==========================================================================
   主题：跟随系统 / 浅色 / 深色
   --------------------------------------------------------------------------
   优先级：URL 参数 ?theme= > localStorage['mn-theme'] > 'system'
   · data-theme 始终写到 <html>，CSS 里 :root 和 [data-theme="light"] 二选一生效
   · color-scheme 同步写，让滚动条、文本光标、原生控件一起换主题
   · 监听 matchMedia，用户在系统设置里切深浅色时 App 实时跟随
   · ?theme= 存在时不落 localStorage，避免演示参数污染用户偏好
   ========================================================================== */
const THEME_KEY = 'mn-theme';
const SB_KEY = 'mn-sidebar';
const OB_KEY = 'mn-onboarded';
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

/* 首次引导只出现一次：看完点「开始记录」就写入标记，之后永不再来。
   用户主动关掉也算看过 —— 引导的职责是告知，不是拦路。 */
let onboarded = (() => {
  try { return localStorage.getItem(OB_KEY) === '1'; } catch (e) { return false; }
})();
/* 截图用：ob=1 强制显示（默认不出），ob=0 强制隐藏 */
{ const v = new URLSearchParams(location.search).get('ob');
  if (v === '1') onboarded = false; else if (v === '0') onboarded = true; }

/* 侧栏收起状态要跨启动保持：用户收起一次是主动选择，不该每次开 App 都重置 */
let sidebarOpen = (() => {
  const v = localStorage.getItem(SB_KEY);
  return v === null ? true : v === '1';
})();
try {
  document.documentElement.classList.toggle('sb-collapsed', !sidebarOpen);
} catch (e) { /* 隐私模式忽略 */ }

/* 侧栏开关的唯一切换入口：按钮和 ⌃⌘S 都走这里。
   之前开关只存在于 .mac-titlebar 里，而真实 App 把标题栏 display:none 掉了
   （app-embed.css，为避免和原生标题栏重复），结果真机上完全没有收起入口。
   开关现在住在 .sb-brand 里 —— 原型和真机用的是同一份结构。 */
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  try { localStorage.setItem(SB_KEY, sidebarOpen ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
  render();
}

const urlTheme = (() => {
  const t = (new URLSearchParams(location.search).get('theme') || '').toLowerCase();
  return ['system', 'light', 'dark'].includes(t) ? t : null;
})();

let themePref = urlTheme || localStorage.getItem(THEME_KEY) || 'system';

function applyTheme() {
  const resolved = themePref === 'system' ? (darkMQ.matches ? 'dark' : 'light') : themePref;
  document.documentElement.dataset.theme = resolved;
  // 原生控件（滚动条 / 光标 / 日期选择器）跟着主题变 —— 最容易漏但最影响完成度
  document.documentElement.style.colorScheme = resolved;
  document.querySelectorAll('[data-act="theme"]').forEach(b => {
    b.classList.toggle('on', b.dataset.v === themePref);
  });
}

function setTheme(v) {
  if (!['system', 'light', 'dark'].includes(v)) return;
  themePref = v;
  if (!urlTheme) { try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* 隐私模式忽略 */ } }
  applyTheme();
}

const onSystemThemeChange = () => { if (themePref === 'system') applyTheme(); };
if (darkMQ.addEventListener) darkMQ.addEventListener('change', onSystemThemeChange);
else darkMQ.addListener(onSystemThemeChange);

/* 外观三选一。紧凑参数已不再需要（侧栏只留设置入口），
   保留签名是为了不改动两个调用点的调用形式。 */
function segTheme() {
  const items = [
    { v: 'system', ic: 'auto', label: '跟随系统' },
    { v: 'light', ic: 'sun',  label: '浅色' },
    { v: 'dark',  ic: 'moon', label: '深色' },
  ];
  return `<div class="seg" role="radiogroup" aria-label="外观">
    ${items.map(i => `
      <button class="seg-i ${themePref === i.v ? 'on' : ''}" data-act="theme" data-v="${i.v}"
              role="radio" aria-checked="${themePref === i.v}" title="${i.label}">
        ${svg(i.ic)}<span>${i.label}</span>
      </button>`).join('')}
  </div>`;
}

/* ==========================================================================
   页面：捕获（首屏）
   没有宣传语。视觉重量由「输入面 + 实体键帽麦克风」两个体量差建立
   ========================================================================== */
/* 输入页只有两样东西：标题和输入面。
   原来下面还有一组「示例」和右上角的条数 —— 示例是三段别人写的句子，
   和用户自己想记的东西没关系，放在最显眼的页面上只是替产品回答
   「你该记什么」。真需要提示的话，入口是空的输入面本身。
   条数同理：记了多少条属于「记忆」那一页的信息，摆在输入页是错位。 */
/* 输入页只有两样东西：标题、输入面，再加一行能力边界。
   原来下面还有一组「示例」和右上角的条数 —— 示例是三段别人写的句子，
   和用户自己想记的东西没关系，放在最显眼的页面上只是替产品回答
   「你该记什么」。条数同理：记了多少条属于「记忆」那一页的信息。

   「能记什么」用四条真实案例回答，不用分类标签。
   分类标签说的是机器会抽出什么字段（输出侧），用户问的是自己该写什么
   （输入侧）—— 四个抽象名词回答不了「我不知道写什么」。
   每条案例左边点出它会被识别成什么类别，图标复用 ENT_ICON，
   和详情页、搜索页是同一套 taxonomy。
   案例可点：点一下填进输入框、光标落在末尾 —— 它要解决的是
   冷启动那句「我不知道写什么」，能填进去才算真的解决。
   但填进去只是给人一个起点，不自动保存、不替用户把话说完。

   为什么是四条不是五条：真机窗口装不下五条案例 +「怎么用」两行，
   而「主题 / 记一个想法」恰好是唯一一个靠例子说不清的类别 ——
   「记一个点子」这个行为本身不需要示范，另外四类是日常真会忘的碎片。
   被砍掉的类别名仍然出现在下面「怎么用」那行里，没有消失。

   「怎么用」只说界面无法自证的那一段：记下来之后会发生什么、
   之后怎么找回来。打字和语音这两步输入框和按钮已经摆在眼前了，
   再写一遍是重复。 */
const CAP_EXAMPLES = [
  { kind: '人',   text: '妈最近总说膝盖疼，找个骨科看看' },
  { kind: '地点', text: '巷子第二家面馆，汤头比第一家好' },
  { kind: '时间', text: '周四下午三点跟房东谈续租' },
  { kind: '待办', text: '周五前把护照照片重新拍一张' },
];

const CAP_STEPS = [
  ['记下来之后', '自动转成文字、提炼摘要、标出人 / 地点 / 时间 / 待办'],
  ['以后想找',   '在「记忆」看时间线，在「搜索」打关键词'],
];

function pageCapture() {
  const ios = state.platform === 'ios';
  return `
  <div class="capture">
    ${ios ? '' : '<div class="capture-head"><h1 class="capture-title">记一笔</h1></div>'}

    <div class="sheet">
      <textarea class="sheet-input" id="cap-input" rows="3" placeholder="说点什么"></textarea>
      <div class="sheet-foot">
        <span class="sheet-hint">${ios
          /* iOS 没有硬件键盘，⌘N 是伪信息。换成打字时真正需要的字数计数 */
          ? '<span id="cap-count">0 字</span>'
          : '<span class="kbd">⌘</span><span class="kbd">N</span> 快速记录'}</span>
        <div class="sheet-actions">
          <button class="btn btn-mic" data-act="rec-start">${svg('mic')} 语音</button>
          <button class="btn btn-primary" data-act="save-text">${svg('send')} 记下来</button>
        </div>
      </div>
    </div>

    <section class="cap-block">
      <h2 class="cap-lead">能记什么</h2>
      <ul class="cap-list">
        ${CAP_EXAMPLES.map(e => `
          <li>
            <button class="cap-item" data-act="use-example" data-text="${esc(e.text)}">
              ${svg(ENT_ICON[e.kind], 'icon-sm')}<span>${esc(e.text)}</span>
            </button>
          </li>`).join('')}
      </ul>
    </section>

    <dl class="cap-flow">
      ${CAP_STEPS.map(([k, v]) => `
        <div class="cap-flow-row">
          <dt>${esc(k)}</dt><dd>${esc(v)}</dd>
        </div>`).join('')}
    </dl>
  </div>`;
}

/* ==========================================================================
   录音浮层
   波形 = 已录过的段落（青蓝 + 实时起伏）+ 未录到的段落（压暗）
        + 一根发丝播放头随时间推进。静帧模式冻结在 58% 处，保证截图可复现。
   ========================================================================== */
let recTimer = null, recRaf = null, recStart = 0, recIdx = 0;
const REC_BARS = 56;
const REC_SPAN = 24;      // 播放头走完一屏的名义时长（秒）

function recWaveHTML() {
  const rnd = seeded(20261012);
  let bars = '';
  for (let i = 0; i < REC_BARS; i++) {
    // 能量包络：中间高、两端低，接近真实语音的起伏，不做随机锯齿
    const env = 0.3 + 0.7 * Math.pow(Math.sin((i + 0.5) / REC_BARS * Math.PI), 0.5);
    const h = 5 + rnd() * 64 * env;
    bars += `<i class="wave-bar" style="--i:${i};height:${h.toFixed(0)}px"></i>`;
  }
  return `<div class="wave" data-wave>${bars}<span class="wave-head"></span></div>`;
}

/* 把播放头画到进度 p（0–1），并把已过的柱子点亮 */
function paintWave(p) {
  const wrap = document.querySelector('[data-wave]');
  if (!wrap) return;
  const head = wrap.querySelector('.wave-head');
  if (head) head.style.setProperty('--p', (p * 100).toFixed(2) + '%');
  const bars = wrap.querySelectorAll('.wave-bar');
  const lit = Math.min(bars.length, Math.round(p * bars.length));
  bars.forEach((b, i) => {
    b.classList.toggle('lit', i < lit);
    b.classList.toggle('head', i === lit);
  });
}

function pageRec(platform) {
  // 真录音但这一版**不转写**：逐句浮现的转写文本是假的，
  // 留着比不给更糟 —— 用户会以为已经有文字了。改成只说事实：录音在本机、不上传。
  const note = ZY.native
    ? `${svg('shield','icon-sm')} 本机录音 · 不上传`
    : `${svg('shield','icon-sm')} 本机转写 · <span id="rec-count">0 字</span>`;
  return platform === 'ios'
    ? `<div class="ios-rec-scrim">
         <div class="ios-rec-top">
           <span class="rec-live"><i class="rec-dot"></i>正在录音</span>
           <span class="rec-time rec-time-sm" id="rec-time">00:00</span>
         </div>
         <div class="ios-rec-body">
           <div class="ios-rec-panel">
             ${recWaveHTML()}
             <div class="rec-transcript" id="rec-transcript"></div>
             <div class="rec-foot">
               <span class="rec-note">${note}</span>
             </div>
           </div>
         </div>
         <div class="ios-rec-stop">
           <button class="btn-stop" data-act="rec-done" aria-label="停止录音"><i></i></button>
         </div>
       </div>`
    : `<div class="rec-scrim">
         <div class="rec-panel">
           <div class="rec-head">
             <span class="rec-live"><i class="rec-dot"></i>正在录音</span>
             <span class="rec-time" id="rec-time">00:00</span>
           </div>
           ${recWaveHTML()}
           <div class="rec-transcript" id="rec-transcript"></div>
           <div class="rec-foot">
             <span class="rec-note">${note}</span>
             <div class="rec-actions">
               <button class="btn btn-quiet" data-act="rec-cancel">取消</button>
               <button class="btn-stop" data-act="rec-done" aria-label="停止录音"><i></i></button>
             </div>
           </div>
         </div>
       </div>`;
}

function recElapsed() { return (Date.now() - recStart) / 1000; }

function pushLine(xEl, text) {
  xEl.innerHTML += `<span class="said latest">${esc(text)}</span>`;
  const all = xEl.querySelectorAll('.said');
  if (all.length > 1) all[all.length - 2].classList.remove('latest');
  xEl.scrollTop = xEl.scrollHeight;
  const c = document.getElementById('rec-count');
  if (c) c.textContent = xEl.textContent.replace(/\s/g, '').length + ' 字';
}

function startRecSim() {
  stopRecSim();
  recStart = Date.now(); recIdx = 0;
  const tEl = document.getElementById('rec-time');
  const xEl = document.getElementById('rec-transcript');

  if (STILL) {
    // 静帧：冻结在 58%，先落 4 句，截图每次都一样
    paintWave(0.58);
    if (tEl) tEl.textContent = mmss(Math.round(REC_SPAN * 0.58));
    if (xEl) {
      REC_SCRIPT.slice(0, 4).forEach((s, i) => pushLine(xEl, s));
      xEl.querySelectorAll('.said').forEach((el, i, a) => {
        if (i !== a.length - 1) el.classList.remove('latest');
      });
      xEl.scrollTop = xEl.scrollHeight;
    }
    return;
  }

  const loop = () => {
    const s = recElapsed();
    paintWave(Math.min(0.995, s / REC_SPAN));
    if (tEl) tEl.textContent = mmss(Math.floor(s));
    recRaf = requestAnimationFrame(loop);
  };
  recRaf = requestAnimationFrame(loop);

  recTimer = setInterval(() => {
    // 没有原生环境（浏览器预览）才演逐句转写；有壳时这段是假的，一律不演
    if (!ZY.native && recIdx < REC_SCRIPT.length && xEl) pushLine(xEl, REC_SCRIPT[recIdx++]);
  }, 1100);
}

function stopRecSim() {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  if (recRaf) { cancelAnimationFrame(recRaf); recRaf = null; }
}

/* ==========================================================================
   时间线
   AI 产物 = 次级文字色 + 2px 青蓝左边框；用户原话 = 主文字色
   --------------------------------------------------------------------------
   每条记忆带 from 字段标来源设备。这是「双端联动可见」的关键：
   用户在电脑上看到手机记的东西，靠的是这个标记，而不是一个扫码动作。
   ========================================================================== */
function memCard(m, q) {
  const long = m.raw && m.raw.length > 68;
  const rail = `
    <div class="mem-rail">
      <span class="mem-time">${m.time}</span>
      ${m.from && m.from !== state.platform ? `
        <span class="mem-from" title="这条是在${m.from === 'ios' ? '手机' : '电脑'}上记的，已同步到这台设备">
          ${svg(m.from === 'ios' ? 'phone' : 'laptop', 'icon-sm')}${m.from === 'ios' ? '手机' : '电脑'}
        </span>` : ''}
    </div>`;

  let body = '';
  if (m.state === 'error') {
    body = `
      <div class="mem-error">
        ${svg('alert', 'icon-sm')}
        <span style="flex:1">${esc(m.error)}</span>
        <button class="btn" data-act="retry" data-id="${m.id}">${svg('refresh', 'icon-sm')} 重试</button>
      </div>`;
  } else if (m.state === 'audioOnly') {
    body = `
      <div class="audio-pending">
        ${svg('clock', 'icon-sm')}
        <span style="flex:1">未转写</span>
        <span class="dur">${mmss(m.dur)}</span>
      </div>`;
  } else {
    body = `
      <p class="mem-raw ${long ? 'is-clamped' : ''}">${highlight(m.raw, q)}</p>
      ${long ? `<span class="mem-more">展开全文 ${svg('chevron','icon-sm')}</span>` : ''}
      ${m.summary ? `<div class="summary"><p class="summary-text">${highlight(m.summary, q)}</p></div>` : ''}
      ${m.state === 'summarizing' ? `
        <div class="ai-pending">${svg('sparkle','icon-sm')}
          <span>正在整理</span><span class="dots"><i></i><i></i><i></i></span>
        </div>
        <div class="ai-bar"><i></i></div>` : ''}
      ${m.state === 'transcribing' ? `
        <div class="ai-pending">${svg('mic','icon-sm')}
          <span>正在转写</span><span class="dots"><i></i><i></i><i></i></span>
        </div>` : ''}
      ${m.tags.length ? `<div class="mem-tags">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="mem-foot">
        ${m.source === 'voice' ? `${svg('mic','icon-sm')} ${mmss(m.dur)} 语音` : `${svg('keyboard','icon-sm')} 文字`}
      </div>`;
  }
  return `<div class="mem">${rail}
    <button class="mem-card" data-act="open-mem" data-id="${m.id}">${body}</button>
  </div>`;
}

function pageTimeline() {
  const ios = state.platform === 'ios';
  const groups = ZY.list.length ? ZY.rebuildDays() : [];
  const count = ZY.list.length;

  // 空库是真实首屏，不是异常。按方案 3.4：不写「暂无数据」这种死话，
  // 直接给「记一笔」的入口 —— 用户要的不是状态说明，是一个能立刻动手的地方。
  if (!count) {
    return `
    <div class="page">
      <div class="page-head">
        ${ios ? '' : `<h1 class="page-title">记忆</h1>`}
      </div>
      <div class="empty">
        <div class="empty-mark">${svg('note','icon-lg')}</div>
        <h2 class="empty-title">还没有记录</h2>
        <button class="btn btn-primary" data-act="nav" data-p="capture">${svg('mic')} 记一笔</button>
      </div>
    </div>`;
  }

  return `
  <div class="page">
    <div class="page-head">
      ${ios
        ? `<span class="page-sub">${count} 条</span>`
        : `<h1 class="page-title">记忆</h1><span class="page-sub">${count} 条</span>`}
    </div>
    ${groups.map(g => `
      <div class="day-head">
        <span class="day-title">${esc(g.label)}</span>
        <span class="day-count">${g.items.length}</span>
        <span class="day-rule"></span>
      </div>
      <div class="timeline ${ios ? 'ios-mem' : ''}">${g.items.map(m => memCard(m, '')).join('')}</div>
    `).join('')}
  </div>`;
}

/* ==========================================================================
   搜索
   ========================================================================== */
function searchFieldHTML() {
  return `
  <div class="search-field">
    ${svg('search')}
    <input id="q" placeholder="搜索，或整句问它" value="${esc(state.q)}" autocomplete="off">
    ${state.q ? `<button class="search-clear" data-act="clear-q" aria-label="清空">${svg('x','icon-sm')}</button>` : ''}
  </div>`;
}

/* 搜索框两端都要有：macOS 上它是这一页唯一的输入控件，
   iOS 上它挨着导航栏。少任何一端，搜索页就变成一张静态结果清单 */
function searchBar(ios) {
  return `<div class="${ios ? 'ios-searchbar' : 'mac-searchbar'}">${searchFieldHTML()}</div>`;
}

/* 原生检索回来的顺序就是结果顺序（bm25 排的），不能按 MEMORIES 的原顺序重排，
   否则「最相关的排最前」这个已经被验证过的信息密度就丢了 */
function hitsByIds(ids) {
  const byId = new Map(ZY.list.map(m => [m.id, m]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function askListHTML(asks) {
  return `
  <div class="ask">
    <div class="ask-head">${svg('sparkle','icon-sm')} 问</div>
    ${asks.map(a => `<button class="ask-item" data-act="ask" data-q="${esc(a)}">${svg('arrowR','icon-sm')} ${esc(a)}</button>`).join('')}
  </div>`;
}

function pageSearch(q = '') {
  const ios = state.platform === 'ios';
  // App 里走原生 FTS5 的结果（1-2 字靠 unigram 表命中，字符串匹配做不到这一点）；
  // 浏览器里没有壳，退回本地匹配，保证原型还能单独调版式。
  const hits = q ? (state.hitIds ? hitsByIds(state.hitIds) : []) : [];

  const head = `
    <div class="page-head">
      ${ios ? '' : `<h1 class="page-title">搜索</h1>`}
      ${q ? `<span class="page-sub">${esc(q)}</span>` : ''}
    </div>`;

  if (!q) {
    return `<div class="page">
      ${head}
      ${searchBar(ios)}
      ${askListHTML(['我什么时候说过要做复盘？', '李彦最近怎么了？', '那家咖啡店豆子多少钱一包？', '哪几个想法是关于扩张的？'])}
    </div>`;
  }

  if (!hits.length) {
    const s = SEARCH_SUGGEST[q] || { alts: [q + '相关', q.slice(0, Math.max(1, q.length - 1))], asks: [`我说过什么关于「${q}」的？`] };
    return `<div class="page">
      ${head}
      ${searchBar(ios)}
      <div class="empty">
        <div class="empty-mark">${svg('search','icon-lg')}</div>
        <h2 class="empty-title">没找到「${esc(q)}」</h2>
        <div class="result-meta">
          ${s.alts.map(a => `<button class="meta-chip" data-act="search" data-q="${esc(a)}">${esc(a)}</button>`).join('')}
        </div>
        ${askListHTML(s.asks)}
        <button class="btn btn-primary" data-act="nav" data-p="capture">${svg('mic')} 记一笔</button>
      </div>
    </div>`;
  }

  return `<div class="page">
    ${head}
    ${searchBar(ios)}
    <div class="result-meta">
      <span><b>${hits.length}</b> 条结果</span>
      ${(SEARCH_HIT_META[q] || {}).summary ? `<span class="meta-chip">${svg('sparkle','icon-sm')} ${SEARCH_HIT_META[q].summary} 条摘要命中</span>` : ''}
    </div>
    <div class="timeline ${ios ? 'ios-mem' : ''}">${hits.map(m => memCard(m, q)).join('')}</div>
  </div>`;
}

/* ==========================================================================
   详情
   ========================================================================== */
const RELATED = {
  m6: [
    { why: '同一话题', text: '楼下新开的那家咖啡，用的是云南的豆子，老板说一周换一次，烘焙日期写在黑板上。' },
    { why: '同样在聊烘焙', text: '烘焙豆子这事真不能省。同一支豆子，烘得深一点浅一点，喝起来完全是两个东西。' },
  ],
  m1: [
    { why: '提到成本', text: '半夜睡不着，把这几天关于咖啡的念头捋了一遍。问题其实不在咖啡本身……' },
  ],
};

function pageDetail(id) {
  const m = ZY.list.find(x => x.id === id) || ZY.list[0] || MEMORIES[0];
  // 真实数据可能落在 DAYS 之外的日期（DAYS 现在是从数据反推的，但详情页被深链打开时
  // 仍可能拿不到对应分组）——.label 直接取会抛 undefined，整个页面白掉。
  const dayLabel = (DAYS.find(d => d.key === m.day) || {}).label || m.day;
  const ents = Object.entries(m.entities).filter(([, v]) => v.length);
  const rel = RELATED[m.id] || [];
  const rnd = seeded(77);
  // iOS 的返回在导航栏，页内再放一个就成了两个「返回」
  const ios = state.platform === 'ios';

  return `
  <div class="page">
    ${ios ? '' : `<button class="back-link" data-act="nav" data-p="timeline">${svg('arrowL','icon-sm')} 返回</button>`}

    <p class="detail-raw">${esc(m.raw || '（无文字内容）')}</p>

    <div class="detail-meta">
      <span>${m.source === 'voice' ? svg('mic','icon-sm') + ' 语音 ' + mmss(m.dur) : svg('keyboard','icon-sm') + ' 文字'}</span>
      <span class="dot-sep">·</span>
      <span>${dayLabel}</span>
      <span class="dot-sep">·</span>
      <span class="mono">${m.time}</span>
      <span class="dot-sep">·</span>
      <span>${svg('shield','icon-sm')} 本机</span>
    </div>

    ${m.summary ? `
    <div class="section">
      <div class="summary" style="margin-top:0">
        <p class="summary-text">${esc(m.summary)}</p>
      </div>
    </div>` : ''}

    ${m.source === 'voice' ? `
    <div class="section">
      <div class="audio-bar">
        <button class="audio-play" data-act="play" aria-label="播放">${svg('play')}</button>
        <div class="audio-track">
          <div class="audio-wave">
            ${Array.from({ length: 44 }, (_, i) => `<i class="${i < 12 ? 'played' : ''}" style="height:${(4 + rnd() * 22).toFixed(0)}px"></i>`).join('')}
          </div>
          <div class="audio-times"><span>00:04</span><span>${mmss(m.dur)}</span></div>
        </div>
        <span class="audio-speed">1×</span>
        <span class="audio-local">${svg('shield','icon-sm')} 本机</span>
      </div>
    </div>` : ''}

    ${m.tags.length ? `
    <div class="section">
      <div class="mem-tags" style="margin-top:0">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>` : ''}

    ${ents.length ? `
    <div class="section">
      <div class="entity-rows">
        ${ents.map(([k, v]) => `
          <div class="entity-row">
            <span class="entity-kind">${svg(ENT_ICON[k] || 'tag', 'icon-sm')}${esc(k)}</span>
            <span class="entity-vals">
              ${v.map(x => k === '待办'
                ? `<span class="entity-todo"><i class="entity-check"></i>${esc(x)}</span>`
                : `<span class="entity-val">${esc(x)}</span>`).join('')}
            </span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${rel.length ? `
    <div class="section">
      <div class="section-head">${svg('link')} 相关</div>
      <div class="related">
        ${rel.map(r => `
          <button class="related-item" data-act="nav" data-p="timeline">
            <span class="related-why">${esc(r.why)}</span>
            <span class="related-text">${esc(r.text)}</span>
          </button>`).join('')}
      </div>
    </div>` : ''}

    <div class="detail-actions">
      <button class="btn">${svg('tag')} 编辑</button>
      <button class="btn">${svg('download')} 导出</button>
      <button class="btn btn-ghost">${svg('trash')} 删除</button>
    </div>
  </div>`;
}

/* ==========================================================================
   同步状态（模拟）
   --------------------------------------------------------------------------
   当前包里没有真实 CloudKit 同步。这里只演示「双端联动应该被看见」这件事：
   记一条 → 另一端能看到时间戳标记 → 点同步页能看到两台设备各自的状态。
   真机版接入 CKSyncEngine 后，把 SYNC.at 更新为真实的对端可见时间即可。
   ========================================================================== */
const SYNC = {
  at: Date.now() - 1000 * 60 * 3,   // 最近一次对端可见时间
  /* on=false 时展示降级路径：未登录 iCloud 时本地照常用，只是不同步。
     绝不能让 App 因为没连上就不可用。 */
  on: !new URLSearchParams(location.search).has('offline'),
  devices: [
    { name: 'MacBook Pro', role: '这台', on: true,  last: '刚刚' },
    { name: 'iPhone 17 Pro', role: '另一台', on: true, last: '3 分钟前' },
  ],
};

function justNow(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return '刚刚同步';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' 分钟前同步';
  return Math.round(m / 60) + ' 小时前同步';
}

function pageSync() {
  const ios = state.platform === 'ios';
  return `
  <div class="page">
    ${ios ? '' : `<button class="back-link" data-act="nav" data-p="settings">${svg('arrowL','icon-sm')} 返回</button>`}
    ${ios ? '' : '<div class="page-head"><h1 class="page-title">双端同步</h1></div>'}

    <div class="sync-hero">
      ${SYNC.on ? svg('cloud', 'icon-lg') : svg('alert', 'icon-lg')}
      <div class="sync-hero-title">${SYNC.on ? 'iCloud 私有空间' : '未连接 iCloud'}</div>
      <div class="sync-hero-sub">${SYNC.on
        ? justNow(SYNC.at)
        : '记、搜、导出照常可用，只是不跨设备'}</div>
    </div>

    ${SYNC.on ? `
    <div class="section">
      <div class="section-head">${svg('laptop')} 这几台设备</div>
      <div class="plist">
        ${SYNC.devices.map(d => `
          <div class="pitem">
            ${svg(d.role === '这台' ? 'laptop' : 'phone', 'icon-sm')}
            ${esc(d.name)}
            <span class="pstamp oncall">${esc(d.last)}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head">${svg('check')} 同步什么</div>
      <div class="plist">
        ${[['文字原文', '已同步'], ['语音转写文本', '已同步'], ['标签与实体', '已同步'],
           ['音频文件', '只在本机'], ['搜索索引', '各端重建']]
          .map(([a, b]) => `<div class="pitem">${svg('check','icon-sm')} ${a}<span class="pstamp never">${b}</span></div>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="rows">
        <button class="row" data-act="sync-now">${svg('refresh')}<span class="row-label">立即同步</span></button>
      </div>
    </div>` : `
    <div class="section">
      <div class="rows">
        <button class="row" data-act="toggle-sync">${svg('refresh')}<span class="row-label">重新连接 iCloud</span></button>
      </div>
    </div>`}

    <div class="section">
      <div class="rows">
        <button class="row" data-act="nav" data-p="privacy">${svg('shield')}<span class="row-label">数据与隐私</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   设置
   ========================================================================== */
function pageSettings(exhausted = false) {
  const q = QUOTA;
  const pct = k => Math.min(100, Math.round(q[k].used / q[k].total * 100));
  const cls = k => pct(k) >= 100 ? 'empty' : pct(k) > 70 ? 'warn' : '';
  const bar = k => `
    <div class="quota-row">
      <div class="quota-head">
        <span class="quota-label">${svg(QUOTA_ICON[k], 'icon-sm')}${q[k].label}</span>
        <span class="val"><b>${q[k].used}</b> / ${q[k].total} ${q[k].unit}</span>
      </div>
      <div class="quota-track"><div class="quota-fill ${cls(k)}" style="width:${pct(k)}%"></div></div>
    </div>`;

  // iOS 顶部导航已经写了页面名，页内再写一次就是同一个词出现两遍
  const ios = state.platform === 'ios';

  return `
  <div class="page">
    ${ios ? '' : '<div class="page-head"><h1 class="page-title">设置</h1></div>'}

    <div class="brand-row">
      <span class="brand-icon">${markSvg()}</span>
      <span class="brand-text">
        <span class="brand-name">只言</span>
        <span class="brand-ver">版本 1.0</span>
      </span>
    </div>

    ${exhausted ? `
    <div class="banner">
      ${svg('alert','icon-lg')}
      <div>
        <div class="banner-title">额度已用完</div>
        <p class="banner-text"><b>${ZY.list.length} 条记忆不受影响</b>，照常记、搜、导出。</p>
        <div class="banner-actions">
          <button class="btn btn-solid">升级 Pro</button>
          <button class="btn btn-quiet" data-act="nav" data-p="privacy">数据位置</button>
        </div>
      </div>
    </div>` : ''}

    <div class="settings-group">
      <div class="settings-label">外观</div>
      <div class="rows">
        <div class="row row-stacked">
          ${svg('auto')}
          <span class="row-label">主题</span>
          <div class="row-seg">${segTheme()}</div>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-label">双端同步</div>
      <div class="rows">
        <button class="row row-stacked" data-act="nav" data-p="sync">
          ${SYNC.on ? svg('laptop') : svg('cloud')}
          <div class="row-text">
            <span class="row-label">iCloud 同步</span>
            <span class="row-sub">${SYNC.on
              ? `${SYNC.devices.length} 台设备 · ${justNow(SYNC.at)}`
              : '未连接 · 记录仍存在本机'}</span>
          </div>
          <span class="row-val">${SYNC.on ? '已开启' : '未连接'}</span>
          <span class="chev">${svg('chevron','icon-sm')}</span>
        </button>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-label">AI 服务</div>
      <div class="provider-card">
        <div class="provider-top">
          <div class="provider-logo">${svg('sparkle')}</div>
          <div>
            <div class="provider-name">只言</div>
            <div class="provider-meta">默认服务</div>
          </div>
          <span class="status-pill"><i></i>使用中</span>
        </div>
        <div class="quota">
          ${bar('asr')}${bar('summary')}
          <div class="quota-foot">
            <span>${q.resetAt}</span>
            <button class="btn btn-quiet">升级 Pro</button>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-label">高级</div>
      <button class="disclosure" data-act="toggle-adv" aria-expanded="false">
        ${svg('link')}
        <span class="disclosure-text">
          <span class="disclosure-title">接入自己的模型服务</span>
          <span class="disclosure-sub">内容不经过我们</span>
        </span>
        <span class="chev">${svg('chevron')}</span>
      </button>
      <div id="adv-panel"></div>
    </div>

    <div class="settings-group">
      <div class="settings-label">数据</div>
      <div class="rows">
        <button class="row" data-act="nav" data-p="privacy">${svg('shield')}<span class="row-label">数据与隐私</span><span class="row-val">本机</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row" data-act="export" data-fmt="md">${svg('download')}<span class="row-label">导出 Markdown</span><span class="row-val">可读</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row" data-act="export" data-fmt="json">${svg('download')}<span class="row-label">导出 JSON</span><span class="row-val">完整</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row">${svg('phone')}<span class="row-label">双端同步</span><span class="row-val">iCloud</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-label">本机</div>
      <div class="rows">
        <button class="row" data-act="seed">${svg('note')}<span class="row-label">载入示例数据</span><span class="row-val">7 条</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row" data-act="wipe">${svg('trash')}<span class="row-label">清空全部数据</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
      </div>
      <p class="settings-hint">库文件：<span class="mono">${ZY.native ? '~/Library/Application Support/只言/notes.db' : '（浏览器预览，未落盘）'}</span></p>
    </div>
  </div>`;
}

function advPanelHTML() {
  return `
  <div class="advanced-panel">
    <div class="field">
      <label>服务商</label>
      <input value="https://api.deepseek.com/v1" spellcheck="false">
    </div>
    <div class="field">
      <label>API Key</label>
      <input value="sk-••••••••••••••••••••••" spellcheck="false">
      <div class="field-hint">存入系统钥匙串</div>
    </div>
    <div class="field">
      <label>模型</label>
      <input value="deepseek-chat" spellcheck="false">
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn" data-act="test">${svg('bolt','icon-sm')} 测试连接</button>
      <button class="btn btn-primary">保存</button>
    </div>
    <div id="test-out"></div>
  </div>`;
}

/* ==========================================================================
   数据与隐私 —— 条目式。图示替代长文，不解释行业
   ========================================================================== */
function pagePrivacy() {
  // 同设置页：iOS 导航已有标题，页内不再重复
  const ios = state.platform === 'ios';
  return `
  <div class="page">
    ${ios ? '' : `<button class="back-link" data-act="nav" data-p="settings">${svg('arrowL','icon-sm')} 返回</button>`}
    ${ios ? '' : '<div class="page-head"><h1 class="page-title">数据与隐私</h1></div>'}

    <p class="privacy-note">原文与标签存在你的设备。开启 iCloud 同步后进入你的 iCloud 私有空间，我们无权访问。音频文件与搜索索引不上云。</p>

    <div class="flow">
      <div class="flow-node">
        <div class="flow-icon local">${svg('laptop','icon-lg')}</div>
        <div class="flow-title">本机</div>
        <div class="flow-sub">原文 · 音频</div>
      </div>
      <div class="flow-arrow">
        <span class="line"></span>
        <span class="cap">仅调用时</span>
      </div>
      <div class="flow-node">
        <div class="flow-icon cloud">${svg('cloud','icon-lg')}</div>
        <div class="flow-title">服务商</div>
        <div class="flow-sub">转写 · 摘要</div>
      </div>
      <div class="flow-arrow">
        <span class="line"></span>
        <span class="cap">不留存</span>
      </div>
      <div class="flow-node">
        <div class="flow-icon local">${svg('shield','icon-lg')}</div>
        <div class="flow-title">不落库</div>
        <div class="flow-sub">仅回结果</div>
      </div>
    </div>

    <div class="section">
      <div class="section-head">${svg('check')} 存在哪</div>
      <div class="plist">
        ${[['文字原文', '同步到你的 iCloud'],
           ['语音转写文本', '同步到你的 iCloud'],
           ['标签与实体', '同步到你的 iCloud'],
           ['音频文件', '只留在录音的那台设备'],
           ['搜索索引', '各端本地重建，不上传']]
          .map(([a, b]) => `<div class="pitem">${svg('check','icon-sm')} ${a}<span class="pstamp never">${b}</span></div>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head">${svg('cloud')} 调用时发送</div>
      <div class="plist">
        ${[['语音转写', '音频'], ['摘要与标签', '本条原文']]
          .map(([a, b]) => `<div class="pitem">${svg('cloud','icon-sm')} ${a}<span style="color:var(--tx-4)">（${b}）</span><span class="pstamp oncall">用到才发</span></div>`).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-head">${svg('sliders')} 随时可做</div>
      <div class="rows">
        <button class="row" data-act="export" data-fmt="md">${svg('download')}<span class="row-label">导出全部记忆</span><span class="row-val">Markdown</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row" data-act="export" data-fmt="json">${svg('download')}<span class="row-label">导出结构化数据</span><span class="row-val">JSON</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row" data-act="nav" data-p="settings">${svg('link')}<span class="row-label">接入自己的服务</span><span class="row-val">内容不经过我们</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
        <button class="row">${svg('shield')}<span class="row-label">关闭 iCloud</span><span class="row-val">数据仍在本机</span><span class="chev">${svg('chevron','icon-sm')}</span></button>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   页面注册表
   ========================================================================== */
const PAGES = {
  capture:  { title: '记一笔',    render: pageCapture,  wide: false },
  timeline: { title: '记忆',      render: pageTimeline, wide: false },
  search:   { title: '搜索',      render: () => pageSearch(state.q), wide: false },
  detail:   { title: '详情',      render: () => pageDetail(state.memId), wide: true },
  settings: { title: '设置',      render: () => pageSettings(QUOTA.exhausted), wide: true },
  privacy:  { title: '数据与隐私', render: pagePrivacy,  wide: false },
  sync:     { title: '双端同步',   render: pageSync,     wide: false },
};

let state = { page: 'capture', platform: 'mac', q: '', memId: 'm1', advOpen: false, hitIds: null };

/* —— URL 路由：无头截图可直接定位到某一页 ————————— */
const STILL = new URLSearchParams(location.search).has('still');

function readHash() {
  const h = (location.hash || '').replace('#', '');
  if (!h) return null;
  const [p, arg] = h.split('/');
  if (!['capture', 'timeline', 'search', 'detail', 'settings', 'privacy', 'sync'].includes(p)) return null;
  if (p === 'search' && arg) state.q = decodeURIComponent(arg);
  if (p === 'detail' && arg) state.memId = arg;
  return p;
}
const p0 = readHash();
if (p0) state.page = p0;
const qs = new URLSearchParams(location.search);
if (qs.get('plat') === 'ios') state.platform = 'ios';
if (qs.get('adv') === '1') state.advOpen = true;
if (qs.get('quota') === 'used') QUOTA.exhausted = true;
/* 截图用：直接进入收起态的侧栏，和 sb=1/0 一样只是覆盖 localStorage，
   真实用户路径仍然是点开关或按 ⌃⌘S */
if (qs.get('sb') === '0') sidebarOpen = false;
if (qs.get('sb') === '1') sidebarOpen = true;
/* 截图用：直接进入录音浮层 */
const OPEN_REC = qs.get('rec') === '1';

function writeHash() {
  const q = state.page === 'search' && state.q ? '/' + encodeURIComponent(state.q) : '';
  location.hash = state.page + q;
}

/* —— macOS 外壳 ——————————————————————————————— */
function shellMac() {
  const nav = [
    { k: 'capture',  icon: 'mic',      label: '记一笔' },
    { k: 'timeline', icon: 'timeline', label: '记忆', badge: ZY.list.length },
    { k: 'search',   icon: 'search',   label: '搜索' },
  ];
  return `
  <div class="mac-window">
    <div class="mac-titlebar">
      <div class="lights"><i class="light r"></i><i class="light y"></i><i class="light g"></i></div>
      <div class="mac-title">只言</div>
      <div class="mac-title-right"><span class="mac-idx">⌘N</span></div>
    </div>
    <div class="mac-body">
      <aside class="sidebar">
        <div class="sb-brand">
          ${sidebarOpen
            /* 展开态：标记只是品牌标识，旁边有独立开关 */
            ? `<span class="sb-mark">${markSvg()}</span>
               <h1>只言</h1>
               <button class="sb-toggle" data-act="sb-toggle" aria-label="收起侧栏"
                       title="收起侧栏" aria-expanded="true">${svg('panelClose')}</button>`
            /* 收起态：开关撤掉，标记本身就是展开入口。
               56px 图标条里放两个控件太挤，而且此时唯一需要的操作就是「展开」。 */
            : `<button class="sb-mark sb-expand" data-act="sb-toggle" aria-label="展开侧栏"
                     title="展开侧栏" aria-expanded="false">${markSvg()}</button>`}
        </div>
        <nav class="sb-nav">
          <button class="sb-item ${state.page === 'capture' ? 'on' : ''}" data-act="nav" data-p="capture">
            ${svg('mic')}<span>记一笔</span>
          </button>
          ${nav.filter(n => n.k !== 'capture').map(n => `
            <button class="sb-item ${state.page === n.k ? 'on' : ''}" data-act="nav" data-p="${n.k}">
              ${svg(n.icon)}<span>${n.label}</span>
              ${n.badge ? `<span class="badge">${n.badge}</span>` : ''}
            </button>`).join('')}
        </nav>
        <div class="sb-foot">
          <button class="sb-item sb-set ${['settings', 'privacy', 'sync'].includes(state.page) ? 'on' : ''}" data-act="nav" data-p="settings">
            ${svg('gear')}<span>设置</span>
          </button>
        </div>
      </aside>
      <main class="content"><div class="content-scroll"><div id="root"></div></div></main>
    </div>
    <div id="overlay"></div>
  </div>`;
}

/* —— iPhone 外壳 —————————————————————————————— */
function shellIOS() {
  const tabs = [
    { k: 'capture',  icon: 'mic',      label: '记一笔' },
    { k: 'timeline', icon: 'timeline', label: '记忆' },
    { k: 'search',   icon: 'search',   label: '搜索' },
    { k: 'settings', icon: 'gear',     label: '设置' },
  ];
  const p = PAGES[state.page];
  const showBack = ['detail', 'privacy', 'sync'].includes(state.page);
  return `
  <div class="iphone">
    <div class="ios-notch"></div>
    <div class="ios-statusbar">
      <span class="mono">9:41</span>
      <span class="sb-r">${svg('bolt','icon-sm')} ▮▮▮</span>
    </div>
    <div class="ios-nav">
      <span class="ios-nav-btn left">${showBack
        ? `<button data-act="back">${svg('arrowL','icon-sm')} 返回</button>` : ''}</span>
      <span class="ios-nav-title">${esc(p.title)}</span>
      <span class="ios-nav-btn right"></span>
    </div>
    <div class="ios-content"><div class="ios-scroll"><div id="root"></div></div></div>
    <div class="ios-tabbar">
      ${tabs.map(t => `
        <button class="ios-tab ${state.page === t.k ? 'on' : ''}" data-act="nav" data-p="${t.k}">
          ${svg(t.icon)}<span>${t.label}</span>
        </button>`).join('')}
    </div>
    <div class="ios-home"><i></i></div>
    <div id="overlay"></div>
  </div>`;
}

/* ==========================================================================
   检索 / 导出
   ========================================================================== */

/* 结果回来后再重绘，中间这一帧不出画面 —— 本地 SQLite 查询在毫秒级，
   先画「没找到」再画结果会比直接等一下更难看。 */
function runSearch() {
  const q = state.q;
  // 记录用户是不是正在这个框里打字。全页重渲染会换掉输入框节点，
  // 不记下来就没法判断该不该把焦点抢回来。
  const hadFocus = !!document.activeElement && document.activeElement.id === 'q';
  if (!q || !q.trim()) { state.hitIds = null; render(); if (hadFocus) restoreCaret(); return; }
  ZY.search(q).then(r => {
    if (state.q !== q) return;          // 用户又改了查询，丢掉这一批，别闪回去
    state.hitIds = (r.hits || []).map(h => h.id);
    render();
    if (hadFocus) restoreCaret();
  }).catch(err => {
    state.hitIds = [];
    render();
    console.warn('[只言] 检索失败', err);
  });
}

/* ⚠️ 只在用户本来就在输入时才 focus。
   无条件 focus 会在 iOS 上拉起软键盘，可视视口收缩、页面被整体放大 6.7%，
   内容横向被推出画面（实测 verify/v05/ios-search.png：左半边整页被切掉）。
   同理，采集页在引导弹层打开时也不能抢焦点，见 render() 里的判断。 */
function restoreCaret() {
  const n = document.getElementById('q');
  if (!n) return;
  n.focus();
  const p = n.value.length;
  n.setSelectionRange(p, p);
}

function doExport(format) {
  ZY.exportAs(format).then(r => {
    toast(`已导出到 ${r.path.split('/').pop()}`);
  }).catch(err => {
    toast(String(err.message || err), 'err');
  });
}

/* ========================================================================== */

function render() {
  stopRecSim();
  document.body.className = `proto-stage-${state.platform}` + (STILL ? ' still' : '');
  document.documentElement.classList.toggle('sb-collapsed', !sidebarOpen);
  document.getElementById('stage').innerHTML = state.platform === 'mac' ? shellMac() : shellIOS();

  const p = PAGES[state.page];
  const root = document.getElementById('root');
  const wide = p.wide || state.page === 'detail';
  root.innerHTML = `<div class="${state.platform === 'ios' ? 'ios-content-wrap' : ''}">
      <div class="${state.platform === 'mac' ? (wide ? 'content-inner wide' : 'content-inner') : ''}">
        ${p.render()}
      </div></div>`;

  if (state.page === 'settings' && state.advOpen) {
    const btn = document.querySelector('[data-act="toggle-adv"]');
    const panel = document.getElementById('adv-panel');
    if (btn && panel) { btn.setAttribute('aria-expanded', 'true'); panel.innerHTML = advPanelHTML(); }
  }

  if (OPEN_REC && !document.querySelector('[data-wave]')) openRec();

  const qEl = document.getElementById('q');
  if (qEl) {
    qEl.addEventListener('input', e => {
      state.q = e.target.value;
      clearTimeout(window.__qt);
      window.__qt = setTimeout(() => {
        const pos = e.target.selectionStart;
        // 先把输入框还回去（保持焦点与光标），再等原生检索结果
        state.hitIds = null;
        runSearch();
      }, 180);
    });
  }

  const cap = document.getElementById('cap-input');
  if (cap) {
    /* ⚠️ 弹层开着时**不要**抢焦点。
       iOS 上 focus() 会立刻拉起软键盘，把可视视口压到 377x697、
       页面被整体放大到 107%，输入框被顶出可视区 —— 实测会在屏幕左上角
       留下一条系统渲染残留的蓝色竖条（见 verify/v05/ios-*.png 对比）。
       引导卡/录音浮层都是全屏遮罩，此时聚焦既没意义也破坏版式。
       另外 render() 现在会在数据加载完成后再跑一次，不加这个判断就会
       在引导卡已经弹出的情况下再次 focus，把键盘顶起来。 */
    const ov = document.getElementById('overlay');
    /* 引导是在下面才 openOnboarding() 的，所以这里不能只看 overlay 当下有没有内容，
       还得把「这一帧将会弹引导」算进去 —— 否则首次 render 照样抢焦点。 */
    const willOnboard = !onboarded && state.page === 'capture';
    const modalOpen = willOnboard || (ov && ov.innerHTML.trim().length > 0);
    if (!modalOpen) cap.focus();
    if (state.platform === 'ios') {
      const cnt = document.getElementById('cap-count');
      const sync = () => { if (cnt) cnt.textContent = cap.value.trim().length + ' 字'; };
      cap.addEventListener('input', sync);
      sync();
    }
  }

  applyTheme();
  syncSwitch();
  /* 引导只在首次启动出现，且只在「记一笔」页弹 —— 用户还没到输入页时
     弹引导等于让他对着一个空界面接受介绍，没有意义。 */
  if (!onboarded && state.page === 'capture') openOnboarding();
}

function openRec() {
  const ov = document.getElementById('overlay');
  if (!ov) return;
  ov.innerHTML = pageRec(state.platform);
  startRecSim();
}

function closeRec() { stopRecSim(); const ov = document.getElementById('overlay'); if (ov) ov.innerHTML = ''; }

/* 首次引导：一屏到底的轻量卡，不做多屏轮播。
   内容只有三行 —— 品牌、一句定位、一个按钮。
   不写「本应用支持以下功能」这类说明段落：那句话本身就是废话，
   引导的职责是让用户知道「打开就能记」，不是罗列特性。
   写完点「开始记录」落盘标记，之后永不再出现；
   右上角的关闭同样落盘 —— 主动关掉也算看过，引导不该拦路。 */
function openOnboarding() {
  const ov = document.getElementById('overlay');
  if (!ov) return;
  ov.innerHTML = `
    <div class="ob-scrim">
      <div class="ob-card">
        <button class="ob-close" data-act="ob-close" aria-label="关闭">${svg('x','icon-sm')}</button>
        <span class="ob-mark">${markSvg()}</span>
        <h2 class="ob-title">只言</h2>
        <p class="ob-lead">想到什么，打字或说一句。</p>
        <button class="btn btn-primary ob-go" data-act="ob-start">开始记录</button>
      </div>
    </div>`;
}

function dismissOnboarding(focusInput) {
  onboarded = true;
  try { localStorage.setItem(OB_KEY, '1'); } catch (e) { /* 隐私模式忽略 */ }
  const ov = document.getElementById('overlay');
  if (ov) ov.innerHTML = '';
  if (focusInput) { const t = document.getElementById('cap-input'); if (t) t.focus(); }
}

function syncSwitch() {
  document.querySelectorAll('.proto-switch button').forEach(b => {
    b.classList.toggle('on', b.dataset.plat === state.platform);
  });
  const title = document.querySelector('.pb-title');
  if (title) title.textContent = state.platform === 'mac' ? 'macOS' : 'iOS';
}

/* ==========================================================================
   事件
   ========================================================================== */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-plat],[data-p]');
  if (!el) return;

  if (el.dataset.plat) { state.platform = el.dataset.plat; render(); return; }
  if (el.dataset.act === 'sb-toggle') { toggleSidebar(); return; }
  if (el.dataset.act === 'theme') { setTheme(el.dataset.v); render(); return; }

  const act = el.dataset.act;

  if (act === 'nav') {
    state.page = el.dataset.p; state.q = ''; state.hitIds = null; writeHash(); render();
    const c = document.querySelector('.content, .ios-content'); if (c) c.scrollTop = 0;
    return;
  }
  if (act === 'open-mem') { state.page = 'detail'; state.memId = el.dataset.id; state.hitIds = null; writeHash(); render(); return; }
  if (act === 'back')   {
    state.page = ['privacy', 'sync'].includes(state.page) ? 'settings' : 'timeline';
    writeHash(); render(); return;
  }
  if (act === 'sync-now') {
    SYNC.at = Date.now();
    render();
    return;
  }
  if (act === 'toggle-sync') {
    SYNC.on = true; SYNC.at = Date.now();
    render();
    return;
  }
  if (act === 'ob-start') { dismissOnboarding(true); return; }
  if (act === 'ob-close') { dismissOnboarding(false); return; }
  if (act === 'clear-q') { state.q = ''; state.hitIds = null; render(); return; }
  if (act === 'search')  { state.q = el.dataset.q; state.page = 'search'; state.hitIds = null; writeHash(); render(); runSearch(); return; }
  if (act === 'ask')     { state.q = el.dataset.q; state.page = 'search'; state.hitIds = null; writeHash(); render(); runSearch(); return; }
  if (act === 'play')    { el.innerHTML = svg('pause'); return; }
  if (act === 'export')  { doExport(el.dataset.fmt || 'md'); return; }
  /* —— 录音 ————————————————————————————————
     真录音、不转写。转写要等服务商与备案（PRODUCT-PLAN 第七章）。
     所以停止录音存下来的是一条「待转写」的记录 —— 音频在本地，文字还没有。 */
  if (act === 'rec-start') {
    ZY.rec.start().then(() => openRec()).catch(err => toast(String(err.message || err), 'err'));
    return;
  }
  if (act === 'rec-done') {
    ZY.rec.stop().then(r => {
      closeRec();
      if (!r || r.fake) { toast('浏览器里不能录音'); return; }
      return ZY.save('', { source: 'voice', audio: r.path, dur: r.dur, state: 'pending' })
        .then(() => { state.page = 'timeline'; state.hitIds = null; render(); toast('已保存 · 待转写'); });
    }).catch(err => { closeRec(); toast(String(err.message || err), 'err'); });
    return;
  }
  if (act === 'rec-cancel') {
    ZY.rec.cancel().then(() => closeRec()).catch(() => closeRec());
    return;
  }
  if (act === 'retry')   { el.closest('.mem-error').outerHTML = '<div class="ai-pending">' + svg('refresh','icon-sm') + '<span>重试中</span><span class="dots"><i></i><i></i><i></i></span></div>'; return; }
  if (act === 'seed')    {
    ZY.seedSamples().then(r => {
      toast(`已载入 ${r.imported || 0} 条示例`);
      state.page = 'timeline'; render();
    }).catch(err => toast(String(err.message || err), 'err'));
    return;
  }
  if (act === 'wipe')    {
    ZY.wipe().then(() => { toast('已清空'); state.page = 'capture'; render(); })
             .catch(err => toast(String(err.message || err), 'err'));
    return;
  }
  if (act === 'save-text') {
    const t = document.getElementById('cap-input');
    if (!t.value.trim()) { t.focus(); return; }
    const text = t.value;
    t.value = '';                       // 先清掉，避免连点两条把同一句存两次
    ZY.save(text).then(() => {
      state.page = 'timeline'; state.hitIds = null; render();
    }).catch(err => { t.value = text; render(); toast(String(err.message || err), 'err'); });
    return;
  }
  /* 案例只是给一个起点：填进去、光标落在末尾，让人接着改自己的话。
     不自动保存 —— 替用户按下保存键就等于替他决定这条记什么。 */
  if (act === 'use-example') {
    const t = document.getElementById('cap-input');
    if (!t) return;
    t.value = el.dataset.text || '';
    t.dispatchEvent(new Event('input'));
    t.focus();
    const n = t.value.length;
    t.setSelectionRange(n, n);
    return;
  }
  if (act === 'toggle-adv') {
    state.advOpen = !state.advOpen;
    const panel = document.getElementById('adv-panel');
    el.setAttribute('aria-expanded', String(state.advOpen));
    if (panel) panel.innerHTML = state.advOpen ? advPanelHTML() : '';
    return;
  }
  if (act === 'test') {
    const out = document.getElementById('test-out');
    if (out) out.innerHTML = `<div class="test-result ok">${svg('check','icon-sm')} 已连接 · deepseek-chat</div>`;
    return;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeRec(); if (state.page !== 'capture') { state.page = 'timeline'; render(); } }
  if (e.key === '/' && state.page === 'search') { const q = document.getElementById('q'); if (q) q.focus(); }
  // ⌃⌘S 收起/展开侧栏。macOS 上这个组合已经留给「侧栏开关」，
  // 放在键盘上是为了不让收起功能只依赖那一个 24px 的按钮。
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    toggleSidebar();
  }
});

/* ==========================================================================
   启动
   --------------------------------------------------------------------------
   先画一帧（用的是 data.js 的兜底数据，界面不会是空的），
   再等真数据回来覆盖。真数据回来之前用户已经能点能输了，
   这比转菊花转 200ms 体验好 —— 本地 SQLite 打开通常就是几毫秒。
   ========================================================================== */
render();
ZY.load().then(() => {
  state.hitIds = null;
  DAYS = ZY.rebuildDays();
  render();
  // URL 里带了 ?q= 的（无头截图用）在这里补跑一次检索
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { state.q = q0; state.page = 'search'; render(); runSearch(); }
}).catch(err => {
  console.warn('[只言] 载入数据失败，用原型数据兜底', err);
  toast('数据载入失败', 'err');
});