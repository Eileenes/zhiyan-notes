"""生成 Q 版猫头鹰图标全套产物（覆盖上一版同心弧方案）。

用法：python3 build_owl.py
产物：icon.svg / icon-mac.svg / icon-1024.png / icon.iconset/ / MemoryNotes.icns
"""

import os
import shutil
import subprocess
import sys

import cairosvg
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import owl_geometry as G

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
CHECK = os.path.join(OUT, "_check")

HEADER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
    'viewBox="0 0 1024 1024">\n'
)


def _bg(pid, top, bot):
    """纵向极轻微渐变。刻意控制两端色差，避免任何'渐变'观感。"""
    return (
        f'  <defs>\n'
        f'    <linearGradient id="{pid}" x1="0" y1="0" x2="0" y2="1">\n'
        f'      <stop offset="0" stop-color="{top}"/>\n'
        f'      <stop offset="1" stop-color="{bot}"/>\n'
        f'    </linearGradient>\n'
        f'  </defs>\n'
    )


def build_ios_svg(path):
    p = G.PALETTE
    s, tx, ty = G.ios_mapping()
    shapes = G.owl_shapes(scale=s, tx=tx, ty=ty)
    margin_lr = 100 * G.OWL_LEFT * s / 1024 * -1
    doc = (
        HEADER
        + f'  <!-- 只言 MemoryNotes · iOS 图标源文件\n'
          f'       1024x1024 满幅不透明，系统自行套圆角 mask（此处不画圆角）。\n'
          f'       Q 版猫头鹰：头身比 {G.HEAD_BODY_RATIO:.2f}:1；'
          f'内容上下留白 {G.SAFE_TOP * 100:.0f}%，左右 {margin_lr:.1f}%。 -->\n'
        + _bg("bg", p["ios_top"], p["ios_bot"])
        + f'  <rect width="1024" height="1024" fill="url(#bg)"/>\n'
        + f'  <g id="owl">\n    {shapes}\n  </g>\n'
        + '</svg>\n'
    )
    with open(path, "w") as f:
        f.write(doc)


def build_mac_svg(path):
    p = G.PALETTE
    s, tx, ty = G.mac_mapping()
    shapes = G.owl_shapes(scale=s, tx=tx, ty=ty)
    squircle = G.squircle(512, 512, 512, n=5.0)
    doc = (
        HEADER
        + f'  <!-- 只言 MemoryNotes · macOS 图标源文件\n'
          f'       圆角方形底板（超椭圆 n=5 连续曲率）+ 内嵌同一只猫头鹰。\n'
          f'       与 iOS 版共用 owl_geometry 的同一份几何，仅底板与内缩不同。 -->\n'
        + _bg("bg", p["mac_top"], p["mac_bot"])
        + f'  <path d="{squircle}" fill="url(#bg)"/>\n'
        + f'  <g id="owl">\n    {shapes}\n  </g>\n'
        + '</svg>\n'
    )
    with open(path, "w") as f:
        f.write(doc)


def render(src, dst, size=1024, keep_alpha=False):
    cairosvg.svg2png(url=src, write_to=dst, output_width=size,
                     output_height=size, background_color=None if keep_alpha else "#ffffff")
    if keep_alpha:
        return
    im = Image.open(dst)
    if im.mode in ("RGBA", "LA", "P"):
        bgim = Image.new("RGB", im.size, (255, 255, 255))
        bgim.paste(im, mask=im.convert("RGBA").split()[-1])
        im = bgim
    im.convert("RGB").save(dst, "PNG")


ICNS = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]


def build_iconset(mac_svg, iconset_dir):
    if os.path.isdir(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir)
    tmp = os.path.join(iconset_dir, "_tmp_1024.png")
    render(mac_svg, tmp, 1024, keep_alpha=True)          # macOS 圆角外需透明
    base = Image.open(tmp).convert("RGBA")
    for name, size in ICNS:
        im = base if size == 1024 else base.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(iconset_dir, name), "PNG")
    os.remove(tmp)
    icns = os.path.join(OUT, "MemoryNotes.icns")
    if os.path.exists(icns):
        os.remove(icns)
    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", icns], check=True)
    return icns


def main():
    os.makedirs(CHECK, exist_ok=True)
    ios_svg = os.path.join(OUT, "icon.svg")
    mac_svg = os.path.join(OUT, "icon-mac.svg")

    build_ios_svg(ios_svg)
    build_mac_svg(mac_svg)
    print(f"✓ {ios_svg}")
    print(f"✓ {mac_svg}")

    png = os.path.join(OUT, "icon-1024.png")
    render(ios_svg, png, 1024)
    shutil.copy(png, os.path.join(CHECK, "owl-ios-1024.png"))
    im = Image.open(png)
    print(f"✓ {png}  {im.size} mode={im.mode} alpha={'A' in im.mode}")

    # macOS 各尺寸源图留存，供小尺寸验收
    tmp = os.path.join(CHECK, "_mac_tmp.png")
    render(mac_svg, tmp, 1024, keep_alpha=True)
    shutil.copy(tmp, os.path.join(CHECK, "owl-mac-1024.png"))
    os.remove(tmp)

    icns = build_iconset(mac_svg, os.path.join(OUT, "icon.iconset"))
    print(f"✓ {icns}  ({os.path.getsize(icns) // 1024} KB)")
    print(f"✓ {os.path.join(OUT, 'icon.iconset')}/  {len(ICNS)} files")


if __name__ == "__main__":
    main()
