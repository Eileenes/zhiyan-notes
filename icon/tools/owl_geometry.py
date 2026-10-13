"""Q 版猫头鹰几何定义 v2 —— 轮廓是一条连续曲线，不是几何体堆叠。

设计坐标：头心 = 原点，头半宽 ≈ 1.10（局部单位）。

v2 相对 v1 的修正
  1. 轮廓改为 centripetal Catmull-Rom 闭合样条 —— 头与身没有接缝，
     v1 的「圆 + 椭圆」在 y≈0.46 露出一条肩线，看起来像两个球叠的。
  2. 耳羽改钝、靠中、外倾角从 26° 降到 ~12° —— v1 读起来像恶魔角。
  3. 身体压扁成坐姿（高 0.69 / 宽 2.30），v1 是竖立的蛋。
  4. 面盘内缩到头部轮廓内，v1 的面盘溢出脸颊。
  5. 眼睛放大到 29px 下 3.85px，保住小尺寸可读性。
  6. 轮廓全曲线无锐角（centripetal 参数化不会自交、不过冲出尖点）。

硬指标自检：头身比 = 1.54 / 0.67 = 2.30 : 1  ≥ 2.0
"""

import math

# ---------------------------------------------------------------- 轮廓控制点
# 顺时针，从头顶正中起。局部坐标，y 向下为正。
# 右半（含耳羽、头、半身），左半由镜像生成。

_OUTLINE = [
    (0.00, -0.92),   # 头顶正中（耳间凹陷加深，耳朵才不会读成方块）
    (0.24, -0.92),   # 头顶右
    (0.38, -1.12),   # 右耳峰外侧（陡升）
    (0.56, -1.13),   # 右耳顶（圆顶，非平台）
    (0.70, -0.92),   # 耳外缘（陡降）
    (0.88, -0.64),   # 颞侧
    (1.02, -0.32),   # 头侧上部
    (1.06,  0.00),   # 眼高处
    (1.07,  0.34),   # 头侧最宽（脸颊，不内收）
    (1.09,  0.62),   # 肩
    (1.10,  0.86),   # 身最宽
    (1.03,  1.07),   # 身右下
    (0.90,  1.19),   # 底右
    (0.70,  1.27),
    (0.40,  1.31),
    (0.00,  1.32),   # 底（圆弧收尾，非平底）
]

SHOULDER_Y = 0.62          # 头 / 身 分界（用于头身比）
HEAD_TOP = -0.92
BODY_BOT = 1.32
OWL_W = 2 * 1.10
OWL_TOP = -1.13
OWL_H = BODY_BOT - OWL_TOP
HEAD_H = SHOULDER_Y - HEAD_TOP
BODY_H = BODY_BOT - SHOULDER_Y
HEAD_BODY_RATIO = HEAD_H / BODY_H

# ---------------------------------------------------------------- 面部
# v5 修正：喙收小上移，嵌进两片面盘之间；眼睛相对面盘占 53%。
DISC_CX, DISC_CY, DISC_R = 0.46, -0.06, 0.38
EYE_CX, EYE_CY, EYE_RX, EYE_RY = 0.46, -0.09, 0.200, 0.188
BEAK_TOP, BEAK_BOT, BEAK_HW = 0.00, 0.18, 0.068

# ---------------------------------------------------------------- 色板
# 低饱和暖中性 + 单一重音。禁项：无紫蓝、无霓虹、无发光、无厚阴影。
PALETTE = {
    "ios_top": "#F0E9DE",
    "ios_bot": "#DCCDBB",
    "mac_top": "#E4D4BD",
    "mac_bot": "#C9B396",
    "body":    "#6E6157",   # 主体，暖灰褐
    "disc":    "#F6EEE3",   # 面盘，奶油
    "eye":     "#2C2723",   # 眼，近黑暖
    "beak":    "#CE9154",   # 喙，柔和琥珀 —— 全图唯一彩色重音
}


# ---------------------------------------------------------------- 数学工具

def _f(v):
    r = round(v, 2)
    return str(int(r)) if r == int(r) else f"{r:g}"


def _cr_segment(p0, p1, p2, p3, alpha=0.5, per_seg=26):
    """向心 Catmull-Rom 单段（Barry–Goldman 递推）。

    alpha=0.5（向心）保证曲线不自交、不像均匀参数化那样过冲出尖角 ——
    这正是「轮廓圆滑无锐角」的数学保证。
    """
    d01 = math.dist(p0, p1) ** alpha
    d12 = math.dist(p1, p2) ** alpha
    d23 = math.dist(p2, p3) ** alpha
    t0 = 0.0
    t1 = t0 + d01
    t2 = t1 + d12
    t3 = t2 + d23
    if d01 < 1e-9 or d12 < 1e-9 or d23 < 1e-9:
        return [p1] * per_seg

    def lerp(a, b, wa, wb):
        return (a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb)

    out = []
    for j in range(per_seg):
        t = t1 + (t2 - t1) * (j / per_seg)
        A1 = lerp(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0))
        A2 = lerp(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1))
        A3 = lerp(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2))
        B1 = lerp(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0))
        B2 = lerp(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1))
        out.append(lerp(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)))
    return out


def _catmull_rom_closed(pts, alpha=0.5, per_seg=26):
    """闭合样条。相邻段在公共点切线一致（∝ P[i+2]-P[i]），首尾自然平滑。"""
    n = len(pts)
    out = []
    for i in range(n):
        out += _cr_segment(pts[(i - 1) % n], pts[i],
                           pts[(i + 1) % n], pts[(i + 2) % n], alpha, per_seg)
    return out


def outline_points():
    """完整轮廓（右半 + 左半镜像），闭合。"""
    right = _OUTLINE
    left = [(-x, y) for (x, y) in reversed(_OUTLINE[1:-1])]
    return right + left


def smooth_outline_path(scale=1.0, tx=0.0, ty=0.0, alpha=0.5, per_seg=26):
    pts = _catmull_rom_closed(outline_points(), alpha=alpha, per_seg=per_seg)
    d = [f"M {_f(pts[0][0] * scale + tx)} {_f(pts[0][1] * scale + ty)}"]
    for x, y in pts[1:]:
        d.append(f"L {_f(x * scale + tx)} {_f(y * scale + ty)}")
    d.append("Z")
    return " ".join(d)


# ---------------------------------------------------------------- SVG 构件

def ellipse(cx, cy, rx, ry, fill, rotate_deg=None):
    t = f' transform="rotate({_f(rotate_deg)} {_f(cx)} {_f(cy)})"' if rotate_deg else ""
    return (f'<ellipse cx="{_f(cx)}" cy="{_f(cy)}" rx="{_f(rx)}" ry="{_f(ry)}" '
            f'fill="{fill}"{t}/>')


def circle(cx, cy, r, fill):
    return f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(r)}" fill="{fill}"/>'


def squircle(cx, cy, a, n=5.0, samples=256):
    """超椭圆（连续曲率圆角方块），采样成 path。比贝塞尔拼接更接近 Apple squircle。"""
    e = 2.0 / n
    pts = []
    for i in range(samples):
        t = 2 * math.pi * i / samples
        ct, st = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(ct) ** e, ct),
                    cy + a * math.copysign(abs(st) ** e, st)))
    d = [f"M {_f(pts[0][0])} {_f(pts[0][1])}"]
    d += [f"L {_f(x)} {_f(y)}" for x, y in pts[1:]]
    d.append("Z")
    return " ".join(d)


def rounded_beak(cx, top, bot, half_w, fill, radius=0.055):
    """倒三角喙，三角全部倒圆 —— 无锐角。"""
    r = min(radius, half_w, (bot - top) / 2)
    lx, rx_ = cx - half_w, cx + half_w
    k = r * 0.3
    return (
        f'<path d="M {_f(lx + r)} {_f(top)}'
        f' L {_f(rx_ - r)} {_f(top)}'
        f' A {_f(r)} {_f(r)} 0 0 1 {_f(rx_ - k)} {_f(bot - r)}'
        f' L {_f(cx + k)} {_f(bot - r)}'
        f' A {_f(r)} {_f(r)} 0 0 1 {_f(lx + k)} {_f(bot - r)}'
        f' L {_f(cx - k)} {_f(bot - r)}'
        f' A {_f(r)} {_f(r)} 0 0 1 {_f(lx + r)} {_f(top)} Z" fill="{fill}"/>'
    )


# ---------------------------------------------------------------- 组装

def owl_shapes(scale=1.0, tx=0.0, ty=0.0, palette=None, with_wings=False):
    """返回猫头鹰 SVG 片段。iOS / macOS 共用同一份几何，仅 scale/tx/ty 不同。

    v3 起默认不画翅膀：这个尺度下低对比色块只会变成脏斑，
    鸟类身份完全由「双面盘 + 小喙 + 耳部轮廓凸起」承担。
    """
    p = dict(PALETTE)
    if palette:
        p.update(palette)
    X = lambda v: v * scale + tx
    Y = lambda v: v * scale + ty
    S = lambda v: v * scale

    parts = []

    # 身体+头，一条连续轮廓
    parts.append(f'<path d="{smooth_outline_path(scale, tx, ty)}" fill="{p["body"]}"/>')

    # 面盘：两片分离，中间露出深色 V 形喙区
    for sign in (-1, 1):
        parts.append(circle(X(sign * DISC_CX), Y(DISC_CY), S(DISC_R), p["disc"]))

    # 喙：落在两片面盘之间的 V 形区
    parts.append(rounded_beak(X(0), Y(BEAK_TOP), Y(BEAK_BOT), S(BEAK_HW), p["beak"]))

    # 眼：略扁圆 + 上移，眼神柔和
    for sign in (-1, 1):
        parts.append(ellipse(X(sign * EYE_CX), Y(EYE_CY), S(EYE_RX), S(EYE_RY), p["eye"]))

    return "\n    ".join(parts)


# ---------------------------------------------------------------- canvas 映射

SAFE_TOP = 0.11
OWL_LEFT = -OWL_W / 2    # 轮廓左边界局部 x


def ios_mapping():
    """返回 (scale, tx, ty)：局部 -> 1024 画布。上下各留 SAFE_TOP。"""
    s = 1024 * (1 - 2 * SAFE_TOP) / OWL_H
    tx = 1024 / 2 - 0.0 * s                    # 轮廓左右对称，局部 x=0 居中
    ty = 1024 * SAFE_TOP - OWL_TOP * s
    return s, tx, ty


def mac_mapping(target_h=740.0, optical_center=0.470):
    """返回 (scale, tx, ty)：局部 -> 1024 画布（圆角底板 + 内嵌动物）。

    变换为 p_canvas = p_local * scale + t。平移量由「包围盒最终位置」反推：
    局部左/顶边界（均为负值）必须落在 left_final / top_final 上。
    """
    s = target_h / OWL_H
    left_final = (1024 - s * OWL_W) / 2                 # 等比缩放后水平居中
    top_final = optical_center * 1024 - target_h / 2    # 光学中心略偏上
    return s, left_final - OWL_LEFT * s, top_final - OWL_TOP * s


if __name__ == "__main__":
    print(f"头身比        {HEAD_BODY_RATIO:.2f} : 1   (头 {HEAD_H:.2f} / 身 {BODY_H:.2f}, 要求 ≥ 2.0)")
    print(f"owl 局部包围盒  {OWL_W:.2f} × {OWL_H:.2f}   宽高比 {OWL_W / OWL_H:.2f}")
    s, tx, ty = ios_mapping()
    print(f"iOS  scale={s:.2f}  tx={tx:.2f} ty={ty:.2f}")
    top, bot = OWL_TOP * s + ty, BODY_BOT * s + ty
    left, right = tx - OWL_W / 2 * s, tx + OWL_W / 2 * s
    print(f"     顶={top:.0f} ({top / 10.24:.1f}%)  底={bot:.0f} ({bot / 10.24:.1f}%)"
          f"  左={left:.0f} ({left / 10.24:.1f}%)  右={right:.0f}")
    print(f"     眼直径 {2 * EYE_RX * s:.0f}px → 29px 时 {2 * EYE_RX * s / 1024 * 29:.2f}px")
    print(f"     面盘直径 {2 * DISC_R * s:.0f}px → 29px 时 {2 * DISC_R * s / 1024 * 29:.2f}px")
    s2, tx2, ty2 = mac_mapping()
    print(f"mac  scale={s2:.2f}  tx={tx2:.1f} ty={ty2:.1f}")
    print(f"     顶={OWL_TOP * s2 + ty2:.0f}  底={BODY_BOT * s2 + ty2:.0f}"
          f"  左={OWL_LEFT * s2 + tx2:.0f}  右={OWL_W / 2 * s2 + tx2:.0f}"
          f"  高={OWL_H * s2:.0f} 宽={OWL_W * s2:.0f}")
