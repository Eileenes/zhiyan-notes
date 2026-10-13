#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MemoryNotes 应用图标 —— 源文件生成 + 栅格化 + 打包

意象：声音的余波。
一次发声是一个实心点；向外是三道同心弧。
衰减同时由两个变量表达：颜色/线宽（变暗变细）**以及**开口角度（由内向外张得更大）。
后者是这套图形的识别点 —— 同心弧张开＝余波在散，不是靶子、不是 Wi-Fi。

运行：python3 tools/build_icon.py
依赖：cairosvg、Pillow（macOS 自带 sips / iconutil 兜底）
"""

import math
import os
import shutil
import subprocess

import cairosvg
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ICON = os.path.dirname(HERE)

S = 1024                      # 画布
C = S / 2.0                   # 圆心

# ── 底：中性冷调，同色相 210° 明度渐变 ───────────────────────────────
BG_TOP = "#232E3A"            # hsl(210 25% 18%)
BG_BOT = "#121920"            # hsl(210 28% 10%)

# ── 标记：同一色相 187° 的四级明度阶梯，不跨色相 ───────────────────────
# 小尺寸下颜色衰减会被抗锯齿吃掉，真正撑住「衰减」的是几何。
# 所以色阶只做温和递降，几何（开口角度 + 线宽）做强对比。
C_DOT = "#6FDDEB"             # 发声本身，最亮
C_A1 = "#3ECBDE"              # 第一道余波
C_A2 = "#30B6C8"              # 第二道
C_A3 = "#27A0B4"              # 第三道，最淡但仍高于感知下限
# 色阶末端刻意留了余量：外圈线宽在 29px 下只有 1.13px，会被抗锯齿摊到两行像素上
# 只剩约一半强度，太暗就会在最小尺寸上消失。

# ── 几何 ────────────────────────────────────────────────────────────
# 关键比例：线宽 ≈ 间隙（第一版 3:1 直接糊成实心环，第二版 1:1 能分开但偏小）。
# 第三版把内容从 70.7% 推到 75.4%，间隙抬到 58（略大于最粗的线宽 54）。
# 换算到 29px：圆点直径 4.1px、间隙 1.64px、线宽 1.53/1.30/1.13px —— 全部在可分辨区间。
DOT_R = 72.0
STROKE = [54.0, 46.0, 40.0]   # 线宽由内向外递减
GAP = 58.0                    # 相邻元素净间隙
RADII = []                    # 由几何推出，不手填

_gap_acc = DOT_R
for _w in STROKE:
    _inner = _gap_acc + GAP      # 净间隙从上一元素的「外沿」起算
    RADII.append(_inner + _w / 2.0)
    _gap_acc = _inner + _w       # 下一圈的起点是本笔画的外沿，不是中线

# 开口角度（度）。内层接近整圆，越外层裂得越开 —— 这是「衰减」的主表达
OPEN = [40.0, 68.0, 100.0]
OPEN_AXIS = -90.0             # 开口朝向正上方；底重上轻，重心稳

# ── macOS 方形底 ────────────────────────────────────────────────────
MAC_TILE = 824.0              # 占画布 80.5%，四周留透明给系统的投影
MAC_R = 184.0                 # 22.3%，Big Sur 起官方 squircle 比例
MAC_MARK_SCALE = 0.80         # 内容占 tile 约 75%，兼顾 16/32pt 下不糊


def pt(r, deg):
    """圆上一点，SVG 的 y 轴朝下，角度顺时针增大。"""
    a = math.radians(deg)
    return (C + r * math.cos(a), C + r * math.sin(a))


def arc_path(r, open_deg):
    """以 OPEN_AXIS 为中心、开口 open_deg 的一段圆弧（走长边）。"""
    half = open_deg / 2.0
    a0 = OPEN_AXIS + half
    a1 = OPEN_AXIS - half + 360.0
    x0, y0 = pt(r, a0)
    x1, y1 = pt(r, a1)
    span = a1 - a0
    large = 1 if span > 180.0 else 0
    return f"M {x0:.2f} {y0:.2f} A {r:.2f} {r:.2f} 0 {large} 1 {x1:.2f} {y1:.2f}"


def mark_group(indent="    "):
    """标记本体。iOS 与 macOS 共用同一段几何。"""
    rows = [f'{indent}<circle cx="{C:.1f}" cy="{C:.1f}" r="{DOT_R:.1f}" fill="{C_DOT}"/>']
    for i, (r, w, col) in enumerate(zip(RADII, STROKE, [C_A1, C_A2, C_A3])):
        rows.append(
            f'{indent}<path d="{arc_path(r, OPEN[i])}" fill="none" stroke="{col}" '
            f'stroke-width="{w:.1f}" stroke-linecap="round"/>'
        )
    return "\n".join(rows)


def svg_square():
    """iOS 主文件：不画圆角（系统套 mask），满幅不透明底。"""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <!-- MemoryNotes 图标 · iOS 主文件
       1024x1024 满幅不透明，系统自行套圆角 mask。
       标记内容外接直径 {2*(RADII[-1]+STROKE[-1]/2):.0f}px，四周留白约 {(C-RADII[-1]-STROKE[-1]/2)/S*100:.1f}%。 -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{BG_TOP}"/>
      <stop offset="1" stop-color="{BG_BOT}"/>
    </linearGradient>
  </defs>

  <rect width="{S}" height="{S}" fill="url(#bg)"/>

  <g id="mark">
{mark_group("    ")}
  </g>
</svg>
"""


def svg_mac():
    """macOS 主文件：圆角方形底 + 内容内缩，四周透明交给系统投影。"""
    t = MAC_TILE
    x = (S - t) / 2.0
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <!-- MemoryNotes 图标 · macOS 主文件
       圆角方形底 {t:.0f}px（{t/S*100:.1f}% 画布），圆角 {MAC_R:.0f}px = {MAC_R/t*100:.1f}%。
       标记沿用 iOS 几何，等比缩到 {MAC_MARK_SCALE:.3f}，在 tile 内约占 72%。 -->
  <defs>
    <linearGradient id="bgm" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{BG_TOP}"/>
      <stop offset="1" stop-color="{BG_BOT}"/>
    </linearGradient>
  </defs>

  <rect x="{x:.1f}" y="{x:.1f}" width="{t:.1f}" height="{t:.1f}" rx="{MAC_R:.1f}" fill="url(#bgm)"/>

  <g id="mark" transform="translate({C} {C}) scale({MAC_MARK_SCALE}) translate({-C} {-C})">
{mark_group("    ")}
  </g>
</svg>
"""


def render(svg_path, png_path, px):
    cairosvg.svg2png(url=svg_path, write_to=png_path,
                     output_width=px, output_height=px)


def main():
    ios_svg = os.path.join(ICON, "icon.svg")
    mac_svg = os.path.join(ICON, "icon-mac.svg")
    with open(ios_svg, "w", encoding="utf-8") as f:
        f.write(svg_square())
    with open(mac_svg, "w", encoding="utf-8") as f:
        f.write(svg_mac())

    os.makedirs(os.path.join(ICON, "_check"), exist_ok=True)
    render(ios_svg, os.path.join(ICON, "_check", "icon-1024-src.png"), 1024)

    # ── iOS 1024：RGB、无 alpha 通道、sRGB ────────────────────────────
    im = Image.open(os.path.join(ICON, "_check", "icon-1024-src.png")).convert("RGB")
    im.save(os.path.join(ICON, "icon-1024.png"), "PNG",
            color_profile=None, optimize=True)

    # ── macOS iconset ────────────────────────────────────────────────
    iconset = os.path.join(ICON, "icon.iconset")
    if os.path.isdir(iconset):
        shutil.rmtree(iconset)
    os.makedirs(iconset)
    for base, scale in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1),
                        (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]:
        px = base * scale
        out = os.path.join(iconset, f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png")
        render(mac_svg, out, px)
        Image.open(out).save(out, "PNG", optimize=True)

    icns = os.path.join(ICON, "MemoryNotes.icns")
    if os.path.exists(icns):
        os.remove(icns)
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)

    print("built:", sorted(os.listdir(ICON)))


if __name__ == "__main__":
    main()
