#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预览图：1024 / 180 / 60 / 40 / 29 并排 + 最近邻放大条 + macOS 壁纸适配检查。
同一版式出深/浅两张，底色只换、文字色跟着换，其余完全一致，便于直接对比。"""
import os
import cairosvg
from PIL import Image, ImageDraw, ImageFont

ICON = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ICON, "_check")
os.makedirs(OUT, exist_ok=True)

FONTP = "/System/Library/Fonts/Hiragino Sans GB.ttc"
F = ImageFont.truetype(FONTP, 17)
F_S = ImageFont.truetype(FONTP, 13)

SIZES = [1024, 180, 60, 40, 29]
DISP = {1024: 300}
PAD = 34
MAG = 210

ios = os.path.join(ICON, "icon.svg")
mac = os.path.join(ICON, "icon-mac.svg")
_cache = {}


def render(svg, px):
    key = (svg, px)
    if key not in _cache:
        p = os.path.join(OUT, f"pr-{px}-{os.path.basename(svg)}.png")
        cairosvg.svg2png(url=svg, write_to=p, output_width=px, output_height=px)
        _cache[key] = Image.open(p).convert("RGBA")
    return _cache[key]


tiles = {s: render(ios, s) for s in SIZES}
row_w = sum(DISP.get(s, s) for s in SIZES) + PAD * (len(SIZES) - 1)
W = row_w + PAD * 2
H = PAD * 2 + 30 + 300 + 52 + 54 + MAG + 54 + 168 + 46

THEMES = {
    "preview.png": {"bg": (13, 16, 21), "fg": (150, 160, 174), "dim": (74, 84, 96), "line": (38, 42, 48)},
    "preview-light.png": {"bg": (245, 247, 249), "fg": (92, 100, 112), "dim": (166, 172, 180), "line": (214, 218, 224)},
}


def build(name, T):
    sheet = Image.new("RGB", (W, H), T["bg"])
    d = ImageDraw.Draw(sheet)

    y = PAD
    d.text((PAD, y), "iOS 图标 · 真实显示尺寸", font=F, fill=T["fg"])
    y += 30

    base = y + 300
    x = PAD
    for s in SIZES:
        c = tiles[s]
        w = DISP.get(s, s)
        im = c.resize((w, w), Image.LANCZOS) if s in DISP else c
        sheet.paste(im, (x, base - w), im)
        d.text((x, base + 10), f"{s}px", font=F_S, fill=T["fg"])
        if s in DISP:
            d.text((x + d.textlength(f"{s}px", font=F_S) + 18, base + 11), "缩小展示", font=F_S, fill=T["dim"])
        x += w + PAD

    y = base + 52
    d.text((PAD, y), "最近邻放大 · 不插值，糊就是真糊", font=F, fill=T["fg"])
    y += 30
    x = PAD
    for s in (60, 40, 29):
        m = tiles[s].resize((MAG, MAG), Image.NEAREST)
        sheet.paste(m, (x, y), m)
        d.text((x, y + MAG + 10), f"{s}px → ×{MAG/s:.1f}", font=F_S, fill=T["fg"])
        x += MAG + 18

    y += MAG + 46
    d.text((PAD, y), "macOS 壁纸适配", font=F, fill=T["fg"])
    y += 30
    x = PAD
    for label, bg in [("浅色壁纸", (242, 244, 247)), ("中灰壁纸", (128, 132, 138)), ("深色壁纸", (32, 34, 38))]:
        cell = Image.new("RGB", (168, 168), bg)
        ic = render(mac, 128).resize((128, 128), Image.LANCZOS)
        cell.paste(ic, (20, 14), ic)
        sheet.paste(cell, (x, y))
        d.rectangle([x, y, x + 167, y + 167], outline=T["line"])
        d.text((x, y + 174), label, font=F_S, fill=T["fg"])
        x += 186

    p = os.path.join(ICON, name)
    sheet.save(p, "PNG", optimize=True)
    print(p, os.path.getsize(p), sheet.size)


for n, t in THEMES.items():
    build(n, t)
