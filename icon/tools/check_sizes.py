"""小尺寸验证对照板 + 深/浅底对照。

缩放路径：1024 母版 → LANCZOS 降到目标尺寸（贴近系统/App Store 真实缩放），
再用 NEAREST 放大回统一格子 —— 放大后能直接判断有没有糊成色块。
"""

import os

import cairosvg
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
CHECK = os.path.join(OUT, "_check")

CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"
CJK_BOLD = 2
CJK_REG = 0

# (目标尺寸, 最近邻放大倍数, 场景说明)
ROWS = [
    (180, 1, "iOS 主屏图标 / macOS Dock 常态"),
    (120, 2, "iPhone 状态栏应用索引"),
    (60,  4, "iPad 主屏 2× 图标"),
    (40,  6, "iPad 主屏 1× / 设置列表"),
    (32,  8, "iOS 分享面板 / 邮件附件"),
    (29,  9, "iOS 设置列表 · 最小常规尺寸"),
]

CELL = 264          # 放大格统一边长
PREVIEW = 300       # 大图展示边长

BG_DARK = (26, 28, 32)
BG_LIGHT = (243, 242, 239)
PANEL_DARK = (39, 41, 47)
PANEL_LIGHT = (255, 255, 255)
LINE_DARK = (72, 75, 82)
LINE_LIGHT = (216, 214, 209)
FG_DARK = (233, 233, 231)
FG_LIGHT = (52, 50, 48)
MUTE_DARK = (148, 151, 158)
MUTE_LIGHT = (143, 141, 137)


def font(size, bold=False):
    try:
        return ImageFont.truetype(CJK, size, index=CJK_BOLD if bold else CJK_REG)
    except Exception:
        return ImageFont.load_default()


def master(svg_path, tmp):
    cairosvg.svg2png(url=svg_path, write_to=tmp, output_width=1024, output_height=1024)
    return Image.open(tmp).convert("RGBA")


def on_bg(im, bgc):
    """把图标合成到底色上（macOS 图标带透明底）。"""
    c = Image.new("RGB", im.size, bgc)
    c.paste(im.convert("RGB"), mask=im.split()[-1])
    return c


def build_sheet(ios, mac, dark, path, title, subtitle):
    bgc = BG_DARK if dark else BG_LIGHT
    panel = PANEL_DARK if dark else PANEL_LIGHT
    line = LINE_DARK if dark else LINE_LIGHT
    fg = FG_DARK if dark else FG_LIGHT
    mute = MUTE_DARK if dark else MUTE_LIGHT

    lab_w, mid_w = 260, PREVIEW + 24
    W = lab_w + mid_w + CELL + 80
    row_h = CELL + 30
    H = 118 + PREVIEW + 34 + row_h * len(ROWS) + 56

    sheet = Image.new("RGB", (W, H), bgc)
    d = ImageDraw.Draw(sheet)

    d.text((36, 30), title, font=font(26, True), fill=fg)
    d.text((36, 68), subtitle, font=font(14), fill=mute)
    d.line([(36, 104), (W - 36, 104)], fill=line, width=1)

    # ---- 大图区：iOS 满幅 + macOS 圆角底板
    y0 = 126
    d.rectangle([36, y0, 36 + PREVIEW, y0 + PREVIEW], fill=panel, outline=line)
    sheet.paste(ios.convert("RGB").resize((PREVIEW, PREVIEW), Image.LANCZOS), (36, y0))

    mx = 36 + PREVIEW + 40
    d.rectangle([mx, y0, mx + PREVIEW, y0 + PREVIEW], fill=panel, outline=line)
    sheet.paste(on_bg(mac, bgc).resize((PREVIEW, PREVIEW), Image.LANCZOS), (mx, y0))
    d.text((44, y0 + PREVIEW + 8), "iOS 1024（满幅，系统套 mask）", font=font(13), fill=mute)
    d.text((mx + 8, y0 + PREVIEW + 8), "macOS 1024（圆角底板 + 内嵌）", font=font(13), fill=mute)

    # ---- 逐尺寸行
    ry = y0 + PREVIEW + 46
    for size, zoom, note in ROWS:
        small = ios.resize((size, size), Image.LANCZOS)

        d.text((36, ry + 6), f"{size} px", font=font(22, True), fill=fg)
        d.text((36, ry + 40), note, font=font(13), fill=mute)
        d.text((36, ry + 62), f"最近邻 ×{zoom}", font=font(13), fill=mute)

        # 中：真实渲染，标出实际像素边界
        bx, by = lab_w + 36, ry
        d.rectangle([bx, by, bx + PREVIEW, by + PREVIEW], fill=panel, outline=line)
        px, py = bx + (PREVIEW - size) // 2, by + (PREVIEW - size) // 2
        sheet.paste(small.convert("RGB"), (px, py))
        d.rectangle([px - 1, py - 1, px + size, py + size], outline=mute)

        # 右：最近邻放大
        zx = lab_w + mid_w + 44
        d.rectangle([zx, by, zx + CELL, by + CELL], fill=panel, outline=line)
        big = small.resize((size * zoom, size * zoom), Image.NEAREST)
        sheet.paste(big, (zx + (CELL - size * zoom) // 2, by + (CELL - size * zoom) // 2))

        d.line([(36, ry + row_h - 8), (W - 36, ry + row_h - 8)], fill=line, width=1)
        ry += row_h

    d.text((36, H - 32),
           "中列为 1024 母版经 LANCZOS 降至该尺寸（贴近系统真实缩放）；"
           "右列为同一结果以最近邻放大，用于检查小尺寸下是否糊成色块。",
           font=font(13), fill=mute)
    sheet.save(path, "PNG")
    return sheet.size


def main():
    os.makedirs(CHECK, exist_ok=True)
    tmp = os.path.join(CHECK, "_master.png")
    ios = master(os.path.join(OUT, "icon.svg"), tmp)
    mac = master(os.path.join(OUT, "icon-mac.svg"), tmp)
    os.remove(tmp)

    for name, dark in (("preview.png", True), ("preview-light.png", False)):
        p = os.path.join(OUT, name)
        size = build_sheet(ios, mac, dark, p,
                           f"只言 MemoryNotes · Q 版猫头鹰 · 小尺寸验证（{'深色底' if dark else '浅色底'}）",
                           "1024 母版 → 180 / 120 / 60 / 40 / 32 / 29 px，逐档核对辨识度")
        print(f"✓ {p}  {size[0]}×{size[1]}")

    for tag, im in (("ios", ios), ("mac", mac)):
        for size, _, _ in ROWS:
            on_bg(im, BG_DARK).resize((size, size), Image.LANCZOS).save(
                os.path.join(CHECK, f"owl-{tag}-{size}.png"), "PNG")
    print("✓ _check/ 逐尺寸留痕")


if __name__ == "__main__":
    main()
