"""只言 MemoryNotes · 小尺寸专用标记 mark-small.svg。

为什么要另画一版
----------------
1024 母版是为「有底色的应用图标」画的：暖米渐变底 + 圆角面盘 + 橘喙。
它靠颜色分层，不靠形。缩小到 16–20px 后，三层颜色各自退化成 1–2px 灰阶，
边界互相混叠，结果是糊成色块 —— 这跟母版本身画得好不好无关，
是小尺寸栅格化的物理下限。所以小尺寸必须换一套「只靠形」的字形。

设计取舍（与大图的关系）
------------------------
保留：耳羽双角、圆脸轮廓、眼睛。与大图标同源识别特征。
去掉：渐变、描边、橘喙、圆角方形底色块。四样在小尺寸下都是噪点。

与 owl_geometry.py 的关键差异 —— 这是**有意的光学放大**，不是风格改动：
  1. 形制矮胖：高宽比 0.98（母版 1.11）。16px 方格里纵向寸土寸金，
     压扁后眼区才放得下两颗直径 3.8px 的眼 —— 这才是可读性的来源。
  2. 耳羽加宽变钝：顶点抬到全高 17%（母版 8.6%），基座从 0.36 放宽到 0.58。
     窄而尖的角在 16px 下读成猫耳，钝而宽的角才读成猫头鹰。
  3. 眼半径 0.318，眼直径占头宽 54%（母版 18%）。
     16px 下眼直径 3.8px —— 这是还能被识别为眼睛的最小尺寸。
  4. 纯剪影：单一 currentColor 填充，眼睛是 **evenodd 镂空**。
     镂空是真透明、不是白色填充，所以同一份文件压任何底色都成立，
     前端只要用 CSS 切 color，不用维护两份文件，也就不会漏改某一版。

喙：做过、带孔版本一起栅格化对比过，16px 下完全消失，
在 20px 下只会把右眼糊大一圈。判定为噪点，**放弃**。
代码保留 beak 参数仅为可复现该结论，默认 None。

几何构造沿用 owl_geometry.py 的同一套思路：闭合 Catmull-Rom 转三次贝塞尔，
头与身一条连续轮廓（不是圆 + 椭圆叠出来的，接缝在小尺寸会变成一道假线）。
坐标：局部单位，头心 = 原点，头半宽 1.17。最终映射到 16×16 viewBox。
"""

import math

# ---------------------------------------------------------------- 轮廓控制点
# 顺时针，从头顶正中起（仅右半，左半镜像生成）。y 向下为正。
_OUTLINE = [
    (0.00, -0.78),   # 头顶正中（耳间凹陷最深处）
    (0.22, -0.88),   # 耳间凹陷右缘 —— 凹陷把双角分开，否则连成一块方顶
    (0.36, -1.08),   # 右耳内侧陡升
    (0.56, -1.15),   # 右耳峰（偏外 = 外倾 ~10°，与母版同向）
    (0.76, -1.12),   # 右耳顶（钝圆顶。尖角在 16px 会炸成一根噪点）
    (0.94, -0.93),   # 耳外缘，顺势续进头侧，不做竖直掉落
    (1.06, -0.68),   # 颞侧
    (1.15, -0.32),   # 头侧上部
    (1.17,  0.10),   # 头侧最宽（眼高一线）
    (1.14,  0.44),   # 颧下收
    (1.08,  0.72),   # 肩
    (0.96,  0.94),   # 身右下
    (0.74,  1.07),   # 底右
    (0.42,  1.13),
    (0.00,  1.15),   # 底（圆弧收尾，非平底 —— 平底在 16px 像一块砖）
]

# ---------------------------------------------------------------- 镂空
EYE_CX, EYE_CY, EYE_R = 0.52, -0.12, 0.318

# 喙形：(半宽, 顶 y, 底 y)。默认关闭 —— 见模块说明「喙」段。
BEAK = None

OWL_W = 2 * max(p[0] for p in _OUTLINE)
OWL_TOP = min(p[1] for p in _OUTLINE)
OWL_BOT = max(p[1] for p in _OUTLINE)
OWL_H = OWL_BOT - OWL_TOP

# ---------------------------------------------------------------- 画布映射
CANVAS = 16.0            # viewBox 边长
MARK_BOX = 14.0          # 标记在 16 格里的最大边（留 1px 呼吸，不顶满槽位）
OPTICAL_CENTER = 0.475   # 光学中心略偏上：尖顶留白多、圆底贴边（沿用 mac 底板同一原则）


def scale_tx_ty():
    """局部 -> 16 格画布。ty 必须再减 OWL_TOP*s：耳峰在 y=-1.15（负值），
    不补这一项整只猫头鹰会被顶出画布上沿。"""
    s = MARK_BOX / max(OWL_W, OWL_H)
    top = CANVAS * OPTICAL_CENTER - OWL_H * s / 2.0
    return s, CANVAS / 2.0, top - OWL_TOP * s


# ---------------------------------------------------------------- 样条 → 贝塞尔
def _bezier_closed(pts, tension=6.0):
    """闭合 Catmull-Rom → 三次贝塞尔。控制点间距均匀、无自交，
    输出比采样折线短一个数量级，小尺寸 mark 用它不丢精度。"""
    n = len(pts)
    segs = []
    for i in range(n):
        p0, p1 = pts[(i - 1) % n], pts[i]
        p2, p3 = pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / tension, p1[1] + (p2[1] - p0[1]) / tension)
        c2 = (p2[0] - (p3[0] - p1[0]) / tension, p2[1] - (p3[1] - p1[1]) / tension)
        segs.append((p1, c1, c2, p2))
    return segs


def outline_points():
    right = _OUTLINE
    left = [(-x, y) for (x, y) in reversed(_OUTLINE[1:-1])]
    return right + left


def _f(v):
    r = round(v, 2)
    return str(int(r)) if r == int(r) else f"{r:g}"


def mark_path(beak=BEAK, s=None, tx=None, ty=None):
    """返回一条 path：外轮廓 + 眼镂空 + 可选喙镂空。
    必须配 fill-rule="evenodd" —— 镂空是真透明，压任何底色都成立。"""
    if s is None:
        s, tx, ty = scale_tx_ty()
    X = lambda v: v * s + tx
    Y = lambda v: v * s + ty
    R = lambda v: v * s

    segs = _bezier_closed(outline_points())
    p0 = segs[0][0]
    d = [f"M {_f(X(p0[0]))} {_f(Y(p0[1]))}"]
    for p1, c1, c2, p2 in segs:
        d.append(f"C {_f(X(c1[0]))} {_f(Y(c1[1]))}"
                 f" {_f(X(c2[0]))} {_f(Y(c2[1]))}"
                 f" {_f(X(p2[0]))} {_f(Y(p2[1]))}")
    d.append("Z")

    # 眼：整圆子路径，evenodd 下成为镂空
    for sign in (-1, 1):
        cx, cy, r = X(sign * EYE_CX), Y(EYE_CY), R(EYE_R)
        d.append(f"M {_f(cx - r)} {_f(cy)}"
                 f"a {_f(r)} {_f(r)} 0 1 0 {_f(2 * r)} 0"
                 f"a {_f(r)} {_f(r)} 0 1 0 {_f(-2 * r)} 0Z")

    # 喙：倒三角，三边全倒圆（默认不启用）
    if beak:
        hw, top, bot = beak
        r = min(R(hw) * 0.34, (Y(bot) - Y(top)) / 2)
        lx, rx = X(-hw), X(hw)
        ty2, by = Y(top), Y(bot)
        k = r * 0.28
        d.append(f"M {_f(lx + r)} {_f(ty2)}L {_f(rx - r)} {_f(ty2)}"
                 f"A {_f(r)} {_f(r)} 0 0 1 {_f(rx - k)} {_f(by - r)}"
                 f"L {_f(k + lx)} {_f(by - r)}"
                 f"A {_f(r)} {_f(r)} 0 0 1 {_f(lx + r)} {_f(ty2)}Z")

    return " ".join(d)


def mark_svg(beak=BEAK):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_f(CANVAS)}" '
        f'height="{_f(CANVAS)}" viewBox="0 0 {_f(CANVAS)} {_f(CANVAS)}" '
        'role="img" aria-label="只言">\n'
        f'  <path fill-rule="evenodd" fill="currentColor" d="{mark_path(beak=beak)}"/>\n'
        '</svg>\n'
    )


# ---------------------------------------------------------------- 自检
def metrics():
    """按 16px 实际栅格尺寸报告各关键特征的像素数。"""
    s, _, _ = scale_tx_ty()
    return {
        "眼直径": 2 * EYE_R * s,
        "眼间距": 2 * (EYE_CX - EYE_R) * s,
        "眼到脸侧": (OWL_W / 2 - (EYE_CX + EYE_R)) * s,
        "耳峰高出头顶": (_OUTLINE[3][1] - _OUTLINE[0][1]) * -1 * s,
        "宽": OWL_W * s,
        "高": OWL_H * s,
    }


if __name__ == "__main__":
    s, tx, ty = scale_tx_ty()
    m = metrics()
    print(f"局部包围盒 {OWL_W:.2f} × {OWL_H:.2f}   高宽比 {OWL_H / OWL_W:.2f}（母版 1.11）")
    print(f"scale={s:.3f}  tx={tx:.2f}  ty={ty:.2f}")
    print(f"→ 16 格内实际：{m['宽']:.2f} × {m['高']:.2f} px")
    for k in ("眼直径", "眼间距", "眼到脸侧", "耳峰高出头顶"):
        print(f"  {k:<12}{m[k]:.2f} px")
    print(f"  path 长度      {len(mark_path())} 字符")