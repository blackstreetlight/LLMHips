import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

fig, ax = plt.subplots(1, 1, figsize=(14, 10))
ax.set_xlim(0, 14)
ax.set_ylim(0, 10)
ax.axis('off')
fig.patch.set_facecolor('#0D1117')
ax.set_facecolor('#0D1117')

# ── Layer definitions (bottom to top) ──────────────────────────────────────
# Each layer: (y_bottom, height, x_left_indent, label, sublabel, lang_badge, color, ring_label)
layers = [
    # (y, h, indent, title, subtitle, lang, fill_color, text_color)
    (0.5,  1.6, 0.3,  "Windows 内核驱动",  "LLMHips.sys  |  进程拦截 · 风险决策 · 强制终止",
     "Lang: C", "#1A3A5C", "#4FC3F7"),   # deep blue
    (2.3,  1.6, 1.1,  "C# 安全桥接服务",   "SecurityBridge  |  IOCTL反序列化 · JSON转换 · WebSocket广播",
     "Lang: C#", "#1B3A2A", "#66BB6A"),   # dark green
    (4.1,  1.6, 1.9,  "React 前端控制台",  "Dashboard  |  实时流式输出 · 状态管理 · 手动拦截",
     "Lang: TypeScript", "#2A2A1A", "#FFF176"),  # dark yellow
    (5.9,  1.6, 2.7,  "Python 推理服务",   "FastAPI + LLMHips-LM  |  SSE流推理 · CoT分析 · 威胁评分",
     "Lang: Python", "#2A1A2A", "#CE93D8"),  # dark purple
]

ring_band_colors = ["#4FC3F7", "#66BB6A", "#FFF176", "#CE93D8"]

for i, (y, h, indent, title, subtitle, lang, fill, accent) in enumerate(layers):
    x_left = indent
    x_right = 14 - indent - 0.8   # right side reserved for annotation
    width = x_right - x_left

    # Trapezoid-ish box
    box = FancyBboxPatch((x_left, y), width, h,
                          boxstyle="round,pad=0.08",
                          linewidth=2, edgecolor=accent,
                          facecolor=fill, zorder=3)
    ax.add_patch(box)

    # Accent left bar
    bar = FancyBboxPatch((x_left, y), 0.18, h,
                          boxstyle="round,pad=0.02",
                          linewidth=0, facecolor=accent, zorder=4, alpha=0.9)
    ax.add_patch(bar)

    # Layer title
    ax.text(x_left + 0.42, y + h*0.68, title,
            fontsize=13.5, fontweight='bold', color=accent,
            fontfamily='STHeiti', va='center', zorder=5)

    # Subtitle
    ax.text(x_left + 0.42, y + h*0.32, subtitle,
            fontsize=8.5, color='#CCCCCC',
            fontfamily='STHeiti', va='center', zorder=5)

    # Language badge (top-right of box)
    badge_x = x_right - 0.15
    badge_y = y + h - 0.32
    badge_bg = FancyBboxPatch((badge_x - 1.3, badge_y - 0.18), 1.3, 0.36,
                               boxstyle="round,pad=0.05",
                               linewidth=1, edgecolor=accent, facecolor='#1E1E2E', zorder=6)
    ax.add_patch(badge_bg)
    ax.text(badge_x - 0.65, badge_y, lang,
            fontsize=7.5, color=accent, ha='center', va='center',
            fontfamily='STHeiti', fontweight='bold', zorder=7)

# ── Protocol arrows between layers ─────────────────────────────────────────
protocols = [
    (2.1, "IOCTL", "#FF7043"),          # between layer0 and layer1
    (3.9, "WebSocket  :9527", "#29B6F6"),  # between layer1 and layer2
    (5.7, "HTTP SSE  :8000", "#AB47BC"),   # between layer2 and layer3
]

for py, label, color in protocols:
    mid_x = 7.0
    # Arrow
    ax.annotate("", xy=(mid_x + 0.6, py + 0.05), xytext=(mid_x - 0.6, py + 0.05),
                arrowprops=dict(arrowstyle="<->", color=color, lw=2.0), zorder=6)
    # Label badge
    lbg = FancyBboxPatch((mid_x - 1.15, py - 0.22), 2.3, 0.44,
                          boxstyle="round,pad=0.06",
                          linewidth=1.5, edgecolor=color, facecolor='#161B22', zorder=7)
    ax.add_patch(lbg)
    ax.text(mid_x, py, label,
            fontsize=8.5, color=color, ha='center', va='center',
            fontfamily='STHeiti', fontweight='bold', zorder=8)

# ── Ring 0 / Ring 3 brace on the left ──────────────────────────────────────
# Ring 0 bracket (covers layer 0)
for bx, by, bh, blabel, bcol in [
    (0.05, 0.5, 1.6, "Ring 0\n(内核态)", "#FF5252"),
    (0.05, 2.3, 5.2, "Ring 3\n(用户态)", "#69F0AE"),
]:
    ax.plot([bx + 0.05, bx + 0.05], [by + 0.1, by + bh - 0.1],
            color=bcol, lw=2.5, solid_capstyle='round', zorder=6)
    ax.plot([bx + 0.05, bx + 0.18], [by + 0.1, by + 0.1],
            color=bcol, lw=2.5, solid_capstyle='round', zorder=6)
    ax.plot([bx + 0.05, bx + 0.18], [by + bh - 0.1, by + bh - 0.1],
            color=bcol, lw=2.5, solid_capstyle='round', zorder=6)
    ax.text(bx + 0.32, by + bh / 2, blabel,
            fontsize=8, color=bcol, va='center', ha='left',
            fontfamily='STHeiti', fontweight='bold', zorder=6)

# ── Right-side annotation panel ────────────────────────────────────────────
rx = 13.1
panel = FancyBboxPatch((rx - 0.1, 0.5), 0.85, 7.0,
                        boxstyle="round,pad=0.1",
                        linewidth=1.5, edgecolor='#444466', facecolor='#161B22', zorder=3)
ax.add_patch(panel)

anno_items = [
    ("4", "种编程语言", "#CE93D8"),
    ("3", "种通信协议", "#29B6F6"),
    ("2", "个CPU特权环", "#FF5252"),
    ("Ring 0", "→ Ring 3", "#69F0AE"),
]
for idx, (num, desc, col) in enumerate(anno_items):
    yy = 7.0 - idx * 1.55
    ax.text(rx + 0.32, yy, num,
            fontsize=16, fontweight='bold', color=col,
            ha='center', va='center', fontfamily='STHeiti', zorder=5)
    ax.text(rx + 0.32, yy - 0.45, desc,
            fontsize=7.5, color='#AAAAAA',
            ha='center', va='center', fontfamily='STHeiti', zorder=5)
    if idx < 3:
        ax.plot([rx, rx + 0.65], [yy - 0.75, yy - 0.75],
                color='#333355', lw=0.8, zorder=4)

# ── Title ───────────────────────────────────────────────────────────────────
ax.text(6.5, 9.6, "LLMHips 系统全景架构",
        fontsize=18, fontweight='bold', color='#FFFFFF',
        ha='center', va='center', fontfamily='STHeiti', zorder=5)
ax.text(6.5, 9.15, "4 种语言  ·  3 种通信协议  ·  横跨 Ring 0 至浏览器",
        fontsize=10, color='#888899',
        ha='center', va='center', fontfamily='STHeiti', zorder=5)

plt.tight_layout(pad=0)
out = "/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture/arch_pyramid.png"
plt.savefig(out, dpi=220, bbox_inches='tight', facecolor='#0D1117')
plt.close()
print("Saved:", out)
