#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""变体对比：同一套几何，只改「开口角度 / 开口朝向 / 弧线数量」，并排看。"""
import os
import importlib.util
import cairosvg
from PIL import Image, ImageDraw

ICON = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ICON, "_check")
spec = importlib.util.spec_from_file_location("b", os.path.join(ICON, "tools", "build_icon.py"))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

DARK = (11, 14, 18)
LIGHT = (245, 247, 249)

VARIANTS = [
    ("A 当前 40/68/100 开口朝上", [40, 68, 100], -90.0),
    ("B 收敛 34/54/76 开口朝上", [34, 54, 76], -90.0),
    ("C 40/68/100 开口右偏 30°", [40, 68, 100], -60.0),
    ("D 两极开口 30/60/90", [30, 60, 90], -90.0),
]


def two_gap(r, half, axis):
    """上下各一个开口，保证上下左右都对称（对照用）。"""
    rows = []
    for a in (axis, axis + 180.0):
        x0, y0 = B.pt(r, a + half)
        x1, y1 = B.pt(r, a - half + 360.0)
        span = (a - half + 360.0) - (a + half)
        rows.append(f'<path d="M {x0:.2f} {y0:.2f} A {r:.2f} {r:.2f} 0 1 1 {x1:.2f} {y1:.2f}" '
                    f'fill="none" stroke="{{C}}" stroke-width="{{W}}" stroke-linecap="round"/>')
    return rows


def make(opens, axis, two=False):
    cols = [B.C_A1, B.C_A2, B.C_A3]
    mark = [f'<circle cx="512" cy="512" r="{B.DOT_R}" fill="{B.C_DOT}"/>']
    if two:
        for i, r in enumerate(B.RADII):
            for p in two_gap(r, opens[i] / 2.0, axis):
                mark.append(p.replace("{C}", cols[i]).replace("{W}", str(B.STROKE[i])))
    else:
        B.OPEN, B.OPEN_AXIS = opens, axis
        for i, r in enumerate(B.RADII):
            mark.append(f'<path d="{B.arc_path(r, opens[i])}" fill="none" stroke="{cols[i]}" '
                        f'stroke-width="{B.STROKE[i]}" stroke-linecap="round"/>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{B.BG_TOP}"/><stop offset="1" stop-color="{B.BG_BOT}"/></linearGradient></defs>
<rect width="1024" height="1024" fill="url(#g)"/>{"".join(mark)}</svg>'''


rows = []
for name, op, ax in VARIANTS:
    rows.append((name, make(op, ax, two="两极" in name)))

try:
    FONT = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 15)
except Exception:
    from PIL import ImageFont
    FONT = ImageFont.load_default()
from PIL import ImageFont  # noqa

COLS = [340, 150, 90, 68, 44]
pad, lab = 30, 34
W = pad * 2 + sum(COLS) + pad * (len(COLS) - 1)
H = len(rows) * (lab + 44) + 44 + pad * 2
sheet = Image.new("RGB", (W, H), DARK)
d = ImageDraw.Draw(sheet)

y = pad
for name, svg in rows:
    p = os.path.join(OUT, "v.png")
    open(p, "w", encoding="utf-8").write(svg)
    x = pad
    for c in COLS:
        out = os.path.join(OUT, f"vx-{c}.png")
        cairosvg.svg2png(url=p, write_to=out, output_width=c, output_height=c)
        im = Image.open(out).convert("RGB")
        im2 = im.resize((c, c), Image.NEAREST)
        sheet.paste(im2, (x, y + lab))
        d.text((x, y + 14), f"{c}px", fill=(150, 160, 172), font=FONT)
        x += c + pad
    d.text((pad + sum(COLS) + pad * len(COLS), y + 14), name, fill=(200, 210, 220), font=FONT)
    y += lab + 44

sheet.save(os.path.join(OUT, "variants.png"))
print(os.path.join(OUT, "variants.png"))
