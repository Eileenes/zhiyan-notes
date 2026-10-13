"""生成 verify/mark-preview/index.html —— 用 prototype 的真实 CSS/tokens
渲染新标记在 macOS 侧栏品牌行的实际效果。

**不改 prototype/ 下任何文件。** 这里只从 ../../prototype/*.css 引入样式表，
用与 app.js 中 .sb-brand 完全一致的 DOM 结构复刻品牌行，
标记 path 从 icon/mark-small.svg 读进来（保证与交付文件同源，不是另画一份）。

配色两种取值都出图：
  --tx-1（中性文字色）与 --accent（platform.css 现值），
方便主线直接对比后决定改哪一档。
"""

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ICON = os.path.dirname(HERE)
ROOT = os.path.dirname(ICON)
OUT = os.path.join(ROOT, "verify", "mark-preview")

PANEL_OPEN = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
              'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
              'class="icon"><rect x="3" y="4" width="18" height="16" rx="2"/>'
              '<path d="M9 4v16"/></svg>')
PANEL_CLOSE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
               'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
               'class="icon"><rect x="3" y="4" width="18" height="16" rx="2"/>'
               '<path d="M9 4v16M15 9l-3 3 3 3"/></svg>')


def mark_path_d():
    src = open(os.path.join(ICON, "mark-small.svg"), encoding="utf-8").read()
    m = re.search(r'\sd="([^"]+)"', src)
    if not m:
        raise SystemExit("mark-small.svg 里没找到 path 的 d")
    return m.group(1)


NAV = [
    ("记一笔", True), ("时间线", False), ("搜索", False),
    ("同步", False), ("设置", False),
]


def sidebar(d, mark_color, collapsed=False):
    cls = "sidebar" + (" mini" if collapsed else "")
    mark = (f'<span class="sb-mark" style="color:{mark_color}">'
            f'<svg viewBox="0 0 16 16" aria-label="只言" fill="currentColor">'
            f'<path fill-rule="evenodd" d="{d}"/></svg></span>')
    h1 = "" if collapsed else "<h1>只言</h1>"
    toggle = (f'<button class="sb-toggle" tabindex="-1">'
              f'{PANEL_OPEN if collapsed else PANEL_CLOSE}</button>')
    items = []
    for name, on in NAV:
        if collapsed:
            items.append(
                f'<div class="sb-item{" on" if on else ""}">'
                f'<span class="badge">{name[0]}</span></div>')
        else:
            items.append(
                f'<div class="sb-item{" on" if on else ""}">'
                f'<span class="sb-ico"></span><span>{name}</span></div>')
    return f"""      <aside class="{cls}">
        <div class="sb-brand">{mark}{h1}{toggle}</div>
        <nav class="sb-nav">{''.join(items)}</nav>
      </aside>"""


def window(theme, collapsed, mark_color, label, d):
    root = "sb-collapsed" if collapsed else ""
    return f"""  <section class="cap">
    <h3>{label}</h3>
    <div class="mac-window">
      <div class="mac-titlebar">
        <div class="lights"><i class="light r"></i><i class="light y"></i><i class="light g"></i></div>
        <div class="mac-title">只言</div>
        <div class="mac-title-right"><span class="mac-idx">20px 标记</span></div>
      </div>
      <div class="mac-body">
{sidebar(d, mark_color, collapsed)}
        <div class="stub"></div>
      </div>
    </div>
  </section>"""


def main():
    os.makedirs(OUT, exist_ok=True)
    d = mark_path_d()
    html = f"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<title>只言 · 标记在侧栏品牌行的实际效果</title>
<link rel="stylesheet" href="../../prototype/tokens.css">
<link rel="stylesheet" href="../../prototype/base.css">
<link rel="stylesheet" href="../../prototype/platform.css">
<style>
/* 仅本页排版：把窗口裁到只看侧栏顶部，并排 4 种组合。
   不覆盖任何产品样式，只改窗口尺寸与栅格。 */
body {{ background: var(--stage-bg); }}
.wrap {{ display: grid; grid-template-columns: repeat(2, max-content);
         gap: 34px 30px; padding: 34px 30px; }}
.cap h3 {{ font-size: 13px; font-weight: 600; color: var(--tx-3);
           margin: 0 0 8px; letter-spacing: .02em; }}
.mac-window {{ width: 268px; height: 236px; box-shadow: none;
               border: 1px solid var(--win-ring); }}
.mac-body .sidebar {{ --sidebar: 212px; }}
html.sb-collapsed .mac-body .sidebar {{ --sidebar: var(--sidebar-mini); }}
.stub {{ flex: 1; background: var(--bg-0); }}
.sb-ico {{ width: 15px; height: 15px; border-radius: 3px; background: var(--tx-4);
           flex: none; display: block; }}
.sb-item.on .sb-ico {{ background: var(--accent); }}
.sb-item span:not(.badge) {{ font-size: 13px; }}
</style>
</head>
<body class="still">
<div class="wrap">
{window("light", False, "var(--tx-1)", "浅色 · 展开 · 标记 --tx-1", d)}
{window("light", True, "var(--accent)", "浅色 · 收起 · 标记 --accent", d)}
{window("dark", False, "var(--tx-1)", "深色 · 展开 · 标记 --tx-1", d)}
{window("dark", True, "var(--accent)", "深色 · 收起 · 标记 --accent", d)}
</div>

<script>
/* 每格按自己的 data-theme 上色：把主题写到各自的容器上，
   避免污染全页（tokens.css 的选择器是 [data-theme]）。 */
document.querySelectorAll('.cap').forEach(function (cap, i) {{
  cap.setAttribute('data-theme', i < 2 ? 'light' : 'dark');
}});
</script>
</body>
</html>
"""
    p = os.path.join(OUT, "index.html")
    open(p, "w", encoding="utf-8").write(html)
    print(f"✓ {p}")


if __name__ == "__main__":
    main()
