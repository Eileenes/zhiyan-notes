// Runs before first paint (loaded synchronously in <head>); kept external so
// the CSP can forbid inline scripts.
/* 首屏前定好主题，避免浅底闪一下深底。
   优先级与 app.js 内保持一致：URL 参数 > localStorage > 跟随系统 */
(function () {
  try {
    var u = new URLSearchParams(location.search).get('theme');
    var p = ['system','light','dark'].indexOf(u) >= 0 ? u
          : (localStorage.getItem('mn-theme') || 'system');
    var d = p === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : p;
    document.documentElement.dataset.theme = d;
    document.documentElement.style.colorScheme = d;
  } catch (e) { /* 隐私模式下 localStorage 不可用，忽略 */ }
})();
