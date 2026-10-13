/* ==========================================================================
   只言 · 原生数据桥接
   --------------------------------------------------------------------------
   这个文件是「界面原型」和「真 App」之间唯一的接缝。

   在浏览器里直接打开时（无壳），ZY.native = false，退回 data.js 的写死数据，
   所以原型仍然能在浏览器里单独调版式 —— 这条路不能被破坏。

   在 App 里（WKWebView 注入了 window.zyNative）时，ZY.native = true，
   所有增删查走 SQLite：中文检索是 FTS5 双表真检索，不是字符串匹配。

   ⚠️ 为什么不用 async/await 顶层写法：WKWebView 的用户脚本注入时机是
      documentStart，跑在页面其它脚本之前，此时 Promise 微任务队列的行为
      在部分系统版本上不稳。全程用 then 链，不依赖顶层 await。
   ========================================================================== */

const ZY = (() => {

  const native = typeof window.zyNative !== 'undefined' && typeof window.zyNative.call === 'function';

  // 有壳 → 真数据；无壳 → 原型假数据
  let seed = [];
  if (!native) {
    try { seed = JSON.parse(localStorage.getItem('zy-seed') || 'null') || MEMORIES.slice(); }
    catch (e) { seed = MEMORIES.slice(); }
  }

  /* —— 数据集合 ————————————————————————————————
     data.js 里 MEMORIES 是 const 数组，app.js 有 6 处直接引用它。
     这里**就地**替换内容而不是重新赋值：改动最小，且不会漏掉任何一处引用。 */
  const list = [];

  function setAll(items) {
    list.length = 0;
    items.forEach(m => list.push(normalize(m)));
  }

  /* 原生侧字段名与原型渲染层期望的名字对不上（raw/summary/tags/dur/day/time），
     在这里统一一次，渲染层不必知道数据库长什么样。 */
  function normalize(m) {
    return {
      id: m.id,
      day: m.day,
      time: m.time,
      source: m.source || 'text',
      dur: typeof m.dur === 'number' ? m.dur : 0,
      state: m.state || 'ready',
      raw: m.raw || '',
      summary: m.summary === null || m.summary === undefined ? null : m.summary,
      tags: Array.isArray(m.tags) ? m.tags : [],
      entities: (m.entities && typeof m.entities === 'object') ? m.entities : {},
      audio: m.audio || null,
    };
  }

  /* —— 调用 ——————————————————————————————————— */
  function call(op, payload = {}) {
    if (!native) return Promise.reject(new Error('no-native'));
    return window.zyNative.call(Object.assign({ op }, payload));
  }

  /* —— 生命周期 ———————————————————————————————— */

  function load() {
    if (!native) { setAll(seed); return Promise.resolve({ native: false }); }
    return call('load').then(r => {
      setAll(r.notes || []);
      return { native: true, stats: r.stats };
    });
  }

  function save(text, extra = {}) {
    if (!native) {
      const m = normalize({
        id: 'x' + Date.now(),
        day: todayKey(), time: '刚刚',
        source: 'text', state: 'done',
        raw: text, tags: [], entities: {},
      });
      list.unshift(m);
      return Promise.resolve({ id: m.id });
    }
    return call('save', Object.assign({ text, source: 'text', state: 'done' }, extra))
      .then(r => load().then(() => r));
  }

  function remove(id) {
    if (!native) return Promise.resolve();
    return call('delete', { id }).then(() => load());
  }

  function search(q) {
    if (!native) {
      const t = q.trim();
      if (!t) return Promise.resolve({ hits: [], count: 0 });
      const hits = list.filter(m =>
        (m.raw && m.raw.includes(t)) || (m.summary && m.summary.includes(t)) ||
        m.tags.some(x => x.includes(t)) ||
        Object.values(m.entities).flat().some(e => e.includes(t))
      );
      return Promise.resolve({ hits, count: hits.length });
    }
    return call('search', { q });
  }

  function stats() {
    if (!native) return Promise.resolve({ total: list.length });
    return call('stats');
  }

  function exportAs(format) {
    if (!native) return Promise.reject(new Error('导出需要在 App 里使用'));
    return call('export', { format });
  }

  /* —— 录音 —— 真录，不做转写 ——————————————————
     转写依赖云端服务商与生成式 AI 备案（PRODUCT-PLAN 第七章），
     这一版没接。所以录音是真的、转写没有，记录落库为「待转写」。 */
  const rec = {
    async start() {
      if (!native) return { fake: true };
      const r = await call('recStart');
      return r;
    },
    async stop() {
      if (!native) return { fake: true };
      return call('recStop');
    },
    async cancel() {
      if (!native) return { fake: true };
      return call('recCancel');
    },
  };

  /* —— 示例数据 ————————————————————————————————
     真实用户第一次打开是空库（空状态本身就是产品设计，方案 3.4）。
     这几个入口只给评审/演示用，设置页里能点到。 */
  const SAMPLES = [
    { id: 's1', raw: '今天早上在楼下买包子，老板随口说租金明年要翻一倍，他大概撑不过这个冬天。回来的路上一直在想这件事——小生意最先被租金吃掉。', source: 'voice', tags: ['念头', '早餐店'], dur: 18 },
    { id: 's2', raw: '跟李彦在望京 SOHO 楼下那家云南米线聊了二十分钟，他说下个月要从现在的组调过去做增长，还没跟家里说。', source: 'voice', tags: ['李彦', '职业变动'], dur: 32 },
    { id: 's3', raw: '周三 15:00 产品评审，材料周一晚上发群里。', source: 'text', tags: [], dur: 0 },
    { id: 's4', raw: '楼下新开的那家咖啡，用的是云南的豆子，老板说一周换一次，烘焙日期写在黑板上。喝了杯手冲，酸得挺明显，但是有劲。', source: 'voice', tags: ['咖啡', '云南豆'], dur: 26 },
    { id: 's5', raw: '雨大，地铁站里全是伞。', source: 'text', tags: [], dur: 0 },
    { id: 's6', raw: '烘焙豆子这事真不能省。同一支豆子，烘得深一点浅一点，喝起来完全是两个东西。今天试了三种曲线，终于有一版自己愿意天天喝的。', source: 'voice', tags: ['咖啡', '烘焙'], dur: 47 },
    { id: 's7', raw: '周会定了：下季度先做 iOS，安卓放到 Q4。理由是安卓的设计稿到现在还是去年那版。', source: 'text', tags: ['会议', '排期'], dur: 0 },
  ];

  function seedSamples() {
    if (!native) return Promise.resolve({ imported: 0 });
    return call('seed', { items: SAMPLES }).then(r => load().then(() => r));
  }

  function wipe() {
    if (!native) { list.length = 0; return Promise.resolve(); }
    return call('wipe').then(() => load());
  }

  /* —— 日期工具 ————————————————————————————————— */
  function todayKey() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** 从数据反向生成分组，天数不写死 —— 真实数据可以是任意一天 */
  function rebuildDays() {
    const byDay = new Map();
    list.forEach(m => {
      if (!byDay.has(m.day)) byDay.set(m.day, []);
      byDay.get(m.day).push(m);
    });
    const keys = Array.from(byDay.keys()).sort().reverse();
    const today = todayKey();
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yestKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;

    return keys.map(k => {
      let label;
      if (k === today) label = '今天';
      else if (k === yestKey) label = '昨天';
      else label = weekName(k);
      const [, m, d] = k.split('-');
      return { key: k, label: label + ` · ${Number(m)} 月 ${Number(d)} 日`, items: byDay.get(k) };
    }).filter(g => g.items.length);
  }

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekName(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `${m} 月 ${d} 日 · ${WEEK[new Date(y, m - 1, d).getDay()]}`;
  }

  return {
    native, list, load, save, remove, search, stats,
    exportAs, rec, seedSamples, wipe, rebuildDays, todayKey,
    setAll, normalize, SAMPLES,
  };
})();

/* ==========================================================================
   轻提示
   —— 导出成功/失败这类结果必须有反馈，否则用户会以为按钮坏了。
   —— 文案规则：不解释、不铺垫，只说发生了什么。
   ========================================================================== */
function toast(msg, kind = 'ok') {
  let el = document.getElementById('zy-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'zy-toast';
    document.body.appendChild(el);
  }
  el.className = 'zy-toast ' + kind;
  el.textContent = msg;
  // 重新触发一次过渡：连续两次同样文案时不清空 class 就不会有动画
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.className = 'zy-toast ' + kind + ' out'; }, kind === 'ok' ? 2600 : 4200);
}
