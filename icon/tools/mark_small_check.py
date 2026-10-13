"""mark-small.svg 的可读性验证板 → icon/mark-small-check.png

栅格化路径（关键，不是随便缩小）
--------------------------------
所有档位都走：**8 倍像素比渲染 → LANCZOS 降到目标尺寸**。
直接让矢量在 16px 上光栅化会骗人 —— 它等价于每次渲染都拿到完美的 @8x，
而 macOS 侧栏实际给的是 @2x（Retina）或 @1x。
对照栏用 icon-1024.png 这张真实位图走 LANCZOS 直接降级，复现原有验证方法。

版式：横向排开 16 / 20 / 24 / 32 px，每档浅底 + 深底各一，
外加侧栏品牌行实景与取色对照。
"""

import io
import os
import sys

import cairosvg
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mark_small as ms

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
CHECK = os.path.join(OUT, "_mark")
os.makedirs(CHECK, exist_ok=True)

NOTO = os.path.expanduser("~/Library/Fonts/NotoSansCJKsc-%s.otf")
SIZES = [16, 20, 24, 32]
SS = 8          # 超采样倍数
ZN = 12         # 最近邻放大倍数（只用于逐像素检查）

# 取自 prototype/tokens.css
BG_SIDE_L, BG_SIDE_D = (0xE4, 0xE9, 0xF0), (0x10, 0x13, 0x18)
FG_L, FG_D = (0x14, 0x17, 0x1C), (0xF6, 0xF7, 0xF9)
FG2_L, FG2_D = (0x45, 0x4E, 0x5E), (0xC4, 0xCC, 0xD8)
FG3_L, FG3_D = (0x56, 0x61, 0x75), (0x97, 0xA2, 0xB3)
FG4_L, FG4_D = (0x6F, 0x7C, 0x91), (0x6F, 0x7C, 0x91)
ACC_L, ACC_D = (0x0A, 0x73, 0x87), (0x2A, 0xD4, 0xE9)
HOVER_L, HOVER_D = (0xE2, 0xE8, 0xF0), (0x2E, 0x34, 0x3D)

SHEET_BG = (0xF7, 0xF8, 0xFA)
INK = (0x1A, 0x1F, 0x27)
MUTE = (0x6C, 0x77, 0x86)
LINE = (0xD6, 0xDB, 0xE3)

THEMES = {
    "light": dict(bg=BG_SIDE_L, fg=FG_L, fg2=FG2_L, fg3=FG3_L, fg4=FG4_L,
                  acc=ACC_L, hover=HOVER_L, mark=FG_L, mark_hex="#14171C"),
    "dark":  dict(bg=BG_SIDE_D, fg=FG_D, fg2=FG2_D, fg3=FG3_D, fg4=FG4_D,
                  acc=ACC_D, hover=HOVER_D, mark=FG_D, mark_hex="#F6F7F9"),
}

_fc = {}


def F(size, bold=False):
    key = (size, bold)
    if key not in _fc:
        _fc[key] = ImageFont.truetype(NOTO % ("Bold" if bold else "Regular"), size)
    return _fc[key]


def render_mark(svg_d, color, px):
    """8 倍超采样 → LANCZOS 降到 px。cairosvg 不认 currentColor，先换实色。"""
    png = cairosvg.svg2png(bytestring=svg_d.replace("currentColor", color).encode(),
                           output_width=px * SS, output_height=px * SS)
    return Image.open(io.BytesIO(png)).convert("RGBA").resize((px, px), Image.LANCZOS)


def on_bg(im, bgc):
    c = Image.new("RGB", im.size, bgc)
    c.paste(im.convert("RGB"), mask=im.split()[-1])
    return c


def lum(rgb):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# ---------------------------------------------------------------- 品牌行实景
def brand_row(theme, mark_hex, scale=2):
    """复刻 platform.css 的 .sb-brand：20px 标记 + 8px 间距 + 14px/700「只言」
    + 右侧收起开关。scale=2 即 Retina 实际栅格密度。"""
    t = THEMES[theme]
    svg = ms.mark_svg().replace("currentColor", mark_hex)
    W, H = 212 * scale, 132 * scale
    im = Image.new("RGB", (W, H), t["bg"])
    d = ImageDraw.Draw(im)

    pad_l, gap = 8 * scale, 8 * scale
    rowh = 28 * scale
    mark_px = 20 * scale

    # 品牌行
    my = (rowh - mark_px) // 2
    m = render_mark(svg, mark_hex, mark_px)
    im.paste(m, (pad_l, my))

    tx = pad_l + mark_px + gap
    d.text((tx, rowh // 2), "只言", font=F(14 * scale, True), fill=t["fg"], anchor="lm")

    # 收起开关：24×24 圆角方块 + 分栏图标
    tg = 24 * scale
    tgx, tgy = W - 4 * scale - tg, (rowh - tg) // 2
    ix = tgx + tg // 2
    iy = tgy + tg // 2
    fw, fh = 11 * scale, 10 * scale
    d.rectangle([ix - fw // 2, iy - fh // 2, ix + fw // 2, iy + fh // 2],
                outline=t["fg4"], width=max(1, scale))
    d.line([ix, iy - fh // 2, ix, iy + fh // 2], fill=t["fg4"], width=max(1, scale))

    # 导航项占位，让品牌行有真实的上下语境
    y = rowh + 10 * scale
    for i, w in enumerate((0.42, 0.30, 0.36)):
        bh = 12 * scale
        if i == 0:
            d.rounded_rectangle([6 * scale, y, W - 6 * scale, y + 24 * scale],
                                radius=6 * scale, fill=t["hover"])
            d.rectangle([6 * scale, y, 8 * scale, y + 24 * scale], fill=t["acc"])
        d.rounded_rectangle([14 * scale, y + 6 * scale,
                             14 * scale + (W - 34 * scale) * w, y + 6 * scale + bh],
                            radius=bh // 2, fill=t["fg4"] if i else t["fg3"])
        y += 24 * scale + 2 * scale

    d.rectangle([0, 0, W - 1, H - 1], outline=LINE if theme == "light" else (0x2A, 0x30, 0x3A))
    return im


def collapsed_panel(theme, mark_hex, scale=2):
    """收起态：--sidebar-mini 56px 宽，品牌行竖排（标记在上、开关在下），无文字。
    platform.css 中 html.sb-collapsed .sb-mark 用 --accent。"""
    t = THEMES[theme]
    W, H = 56 * scale, 132 * scale
    im = Image.new("RGB", (W, H), t["bg"])
    d = ImageDraw.Draw(im)
    m = render_mark(ms.mark_svg().replace("currentColor", mark_hex), mark_hex, 20 * scale)
    im.paste(m, ((W - 20 * scale) // 2, 8 * scale))
    tg = 24 * scale
    tgx, tgy = (W - tg) // 2, 8 * scale + 20 * scale + 4 * scale
    ix, iy = tgx + tg // 2, tgy + tg // 2
    fw, fh = 11 * scale, 10 * scale
    d.rectangle([ix - fw // 2, iy - fh // 2, ix + fw // 2, iy + fh // 2],
                outline=t["fg4"], width=max(1, scale))
    d.line([ix, iy - fh // 2, ix, iy + fh // 2], fill=t["fg4"], width=max(1, scale))
    y = tgy + tg + 12 * scale
    for i, w in enumerate((0.60, 0.46)):
        bh = 12 * scale
        d.rounded_rectangle([(W - 34 * scale) // 2, y,
                             (W - 34 * scale) // 2 + (W - 22 * scale) * w, y + bh],
                            radius=bh // 2, fill=t["fg4"] if i else t["fg3"])
        y += bh + 8 * scale
    d.rectangle([0, 0, W - 1, H - 1], outline=(0xC3, 0xC9, 0xD2))
    return im


# ---------------------------------------------------------------- 主流程
def main():
    svg = ms.mark_svg()
    m = ms.metrics()

    LAB = 168
    BOX = max(SIZES) * ZN          # 定尺格
    gap_x = 22
    grid_w = len(SIZES) * BOX + (len(SIZES) - 1) * gap_x
    brand_w = 212 * 2              # 品牌行面板 2 倍栅格宽
    content_w = max(grid_w, brand_w * 3 + 2 * 48)

    W = LAB + content_w + 96
    GRID_H = 2 * (BOX + 74)        # 一组（浅+深）的总高

    y = 128
    secA_y = y;   band_h = GRID_H;  y += GRID_H + 54
    secB_y = y;   band_h = GRID_H;  y += GRID_H + 54
    secC_y = y;   band_h = 264 + 96 + 264 + 88; y += band_h + 64
    secD_y = y;   band_h = 4 * (32 * 5 + 52); y += band_h + 60
    foot_y = y

    sheet = Image.new("RGB", (W, foot_y + 76), SHEET_BG)
    d = ImageDraw.Draw(sheet)

    # ---- 头部
    d.text((48, 36), "只言 · mark-small.svg 小尺寸可读性验证", font=F(30, True), fill=INK)
    d.text((48, 82), f"栅格化路径：{SS} 倍像素比渲染 → LANCZOS 降至目标尺寸（不复用矢量直出）"
                     f" · 最近邻 ×{ZN} 仅用于逐像素检查",
           font=F(16), fill=MUTE)
    d.line([(48, 116), (W - 48, 116)], fill=LINE, width=1)

    def grid_head(dy, title, note):
        d.text((48, dy), title, font=F(22, True), fill=INK)
        d.text((48, dy + 32), note, font=F(15), fill=MUTE)
        return dy + 58

    def draw_grid(dy0, cells, label):
        """cells: theme -> {size: RGB Image}。定尺格子，标记居中，避免阶梯状错位。"""
        for r, theme in enumerate(("light", "dark")):
            ry = dy0 + r * (BOX + 74)
            d.text((48, ry + BOX // 2 - 30), label if r == 0 else "",
                   font=F(16, True), fill=MUTE)
            bgname = "#E4E9F0" if theme == "light" else "#101318"
            d.text((48, ry + BOX // 2 - 6), f"{'浅' if theme=='light' else '深'}底",
                   font=F(17, True), fill=INK)
            d.text((48, ry + BOX // 2 + 20), bgname, font=F(15), fill=MUTE)
            for ci, size in enumerate(SIZES):
                cx = LAB + ci * (BOX + gap_x)
                d.rectangle([cx, ry, cx + BOX, ry + BOX], fill=THEMES[theme]["bg"])
                b = size * ZN
                sheet.paste(cells[theme][size].resize((b, b), Image.NEAREST),
                            (cx + (BOX - b) // 2, ry + (BOX - b) // 2))
                d.rectangle([cx, ry, cx + BOX, ry + BOX], outline=(0xC3, 0xC9, 0xD2))
                # 1:1 实际像素
                oy = ry + BOX + 12
                d.rectangle([cx, oy, cx + size, oy + size], fill=THEMES[theme]["bg"])
                sheet.paste(cells[theme][size], (cx, oy))
                d.rectangle([cx, oy, cx + size, oy + size], outline=(0xC3, 0xC9, 0xD2))
                d.text((cx + size + 10, oy), f"{size}px", font=F(15, True),
                       fill=MUTE, anchor="lm")
                d.text((cx, oy + size + 8), "1:1", font=F(13), fill=(0xA8, 0xB0, 0xBC))

    # ---- A：新标记
    top = grid_head(secA_y, "A · 新标记 mark-small.svg",
                    f"纯剪影 · 眼为 evenodd 镂空 · 眼直径 {m['眼直径']:.1f}px / 眼间距 "
                    f"{m['眼间距']:.1f}px / 眼到脸侧 {m['眼到脸侧']:.1f}px / 耳峰高 "
                    f"{m['耳峰高出头顶']:.1f}px（均按 16px 计）")
    a_cells = {t: {s: on_bg(render_mark(svg, THEMES[t]["mark_hex"], s), THEMES[t]["bg"])
                   for s in SIZES} for t in THEMES}
    draw_grid(top, a_cells, "新标记")

    # ---- B：母版对照
    top = grid_head(secB_y, "B · 对照：icon-1024.png 直接缩放",
                    "同一缩放路径，用于验证「母版不能直接缩小」")
    src = Image.open(os.path.join(OUT, "icon-1024.png")).convert("RGB")
    b_cells = {}
    for t in THEMES:
        b_cells[t] = {}
        for s in SIZES:
            b_cells[t][s] = src.resize((s, s), Image.LANCZOS)
    draw_grid(top, b_cells, "母版缩放")

    # ---- C：品牌行实景
    top = grid_head(secC_y, "C · 侧栏品牌行实景（20px 标记 + 只言）",
                    "复刻 .sb-brand：标记 20px / 间距 8px / 只言 14px·700 / 右侧收起开关；"
                    "面板底色 = --bg-side，Retina 2 倍栅格")
    PH, PW = 132 * 2, 212 * 2
    for i, theme in enumerate(("light", "dark")):
        cx = 48 + i * (PW + 48)
        t = THEMES[theme]
        d.rectangle([cx - 2, top - 2, cx + PW + 1, top + PH + 1],
                    fill=t["bg"], outline=(0xC3, 0xC9, 0xD2))
        sheet.paste(brand_row(theme, t["mark_hex"]), (cx, top))
        d.text((cx, top + PH + 16), f"{'浅色' if theme == 'light' else '深色'}主题",
               font=F(17, True), fill=INK)
        d.text((cx, top + PH + 42),
               f"标记 {t['mark_hex']}（--tx-1） · 对 --bg-side "
               f"{contrast(t['mark'], t['bg']):.2f}:1", font=F(15), fill=MUTE)
        d.text((cx, top + PH + 62),
               "platform.css 现为 .sb-mark { color: var(--accent) }",
               font=F(15), fill=MUTE)

    # 收起态：只剩标记，platform.css 用 --accent
    cy2 = top + PH + 96
    cw, ch = 56 * 2, 132 * 2
    for i, theme in enumerate(("light", "dark")):
        t = THEMES[theme]
        col = hex_of(t["acc"])
        cx = 48 + i * (PW + 48)
        sheet.paste(collapsed_panel(theme, col), (cx, cy2))
        d.text((cx, cy2 + ch + 16), f"收起态 · --accent {col}",
               font=F(17, True), fill=INK)
        d.text((cx, cy2 + ch + 42),
               f"对 --bg-side {contrast(t['acc'], t['bg']):.2f}:1",
               font=F(15), fill=MUTE)

    # ---- D：取色对照
    top = grid_head(secD_y, "D · 标记取色对照",
                    "同一形状只换填色，每档浅/深并排；确认各色档在 16px 下是否仍成立")
    ZD = 5
    ROWH = 32 * ZD + 52
    OPW = ZD * sum(SIZES) + 3 * 10
    names = [("tx-1", "fg"), ("tx-2", "fg2"), ("tx-3", "fg3"), ("accent", "acc")]
    for ri, (name, key) in enumerate(names):
        ry = top + ri * ROWH
        for ci, theme in enumerate(("light", "dark")):
            t = THEMES[theme]
            col = hex_of(t[key])
            cx = 48 + ci * (OPW + 40)
            d.rectangle([cx - 2, ry - 2, cx + OPW + 1, ry + 32 * ZD + 1],
                        fill=t["bg"], outline=(0xC3, 0xC9, 0xD2))
            bx = cx
            for s in SIZES:
                im = on_bg(render_mark(ms.mark_svg().replace("currentColor", col), col, s),
                           t["bg"])
                b = s * ZD
                byy = ry + (32 * ZD - b) // 2
                sheet.paste(im.resize((b, b), Image.NEAREST), (bx, byy))
                d.rectangle([bx, byy, bx + b, byy + b], outline=(0xC3, 0xC9, 0xD2))
                bx += b + 10
            d.text((cx, ry + 32 * ZD + 10),
                   f"{'浅' if theme == 'light' else '深'} · --{name} {col} · "
                   f"{contrast(t[key], t['bg']):.2f}:1", font=F(15), fill=MUTE)


    # ---- 页脚
    d.line([(48, foot_y), (W - 48, foot_y)], fill=LINE, width=1)
    d.text((48, foot_y + 20),
           f"尺寸栏为 {SS}x 渲染后 LANCZOS 降至目标尺寸，再以最近邻 ×{ZN} 放大，仅用于逐像素检查；"
           f"每档下方为 1:1 实际像素。",
           font=F(15), fill=MUTE)
    d.text((48, foot_y + 44),
           "B 栏为 icon-1024.png 真实位图走同一缩放路径，用于对照母版在小尺寸下的退化结果。",
           font=F(15), fill=MUTE)

    path = os.path.join(OUT, "mark-small-check.png")
    sheet.save(path, "PNG")
    print(f"✓ {path}  {sheet.size[0]}×{sheet.size[1]}")

    # ---- 对比度数值
    print("\n对比度（WCAG，标记填色 vs --bg-side）")
    for theme in ("light", "dark"):
        t = THEMES[theme]
        bgn = "#E4E9F0" if theme == "light" else "#101318"
        for name, rgb in (("tx-1", t["fg"]), ("tx-2", t["fg2"]), ("tx-3", t["fg3"]),
                          ("accent", t["acc"])):
            print(f"  {theme:<5} {name:<7} {hex_of(rgb)}  vs {bgn}  {contrast(rgb, t['bg']):5.2f}:1")

    # ---- 留痕
    for theme in ("light", "dark"):
        for s in SIZES:
            a_cells[theme][s].save(os.path.join(CHECK, f"mark-{theme}-{s}.png"))
            b_cells[theme][s].save(os.path.join(CHECK, f"master-{theme}-{s}.png"))
    print(f"✓ {CHECK}/ 逐档留痕")


def hex_of(rgb):
    return "#%02X%02X%02X" % rgb


if __name__ == "__main__":
    main()