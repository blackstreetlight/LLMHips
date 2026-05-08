import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
import matplotlib.patheffects as pe
import numpy as np

fig, ax = plt.subplots(figsize=(18, 10))
ax.set_xlim(0, 18)
ax.set_ylim(0, 10)
ax.axis('off')
fig.patch.set_facecolor('#FAFAFA')
ax.set_facecolor('#FAFAFA')

# ── Color palette ──────────────────────────────────────────────────────────
G_BG   = '#E8F5E9'; G_BD   = '#2E7D32'; G_DARK = '#1B5E20'
B_BG   = '#E3F2FD'; B_BD   = '#1565C0'; B_DARK = '#0D47A1'
P_BG   = '#F3E5F5'; P_BD   = '#7B1FA2'
RED    = '#C62828';  ORANGE = '#E65100'
GREY   = '#455A64'

# ══════════════════════════════════════════════════════════════════
# Section backgrounds
# ══════════════════════════════════════════════════════════════════
# Ring 0 top section
ring0_bg = FancyBboxPatch((0.3, 5.6), 17.4, 4.0,
    boxstyle="round,pad=0.2", facecolor=G_BG, edgecolor=G_BD,
    linewidth=2.5, zorder=1, alpha=0.7)
ax.add_patch(ring0_bg)

# Ring 3 bottom section
ring3_bg = FancyBboxPatch((0.3, 0.4), 17.4, 4.6,
    boxstyle="round,pad=0.2", facecolor=B_BG, edgecolor=B_BD,
    linewidth=2.5, zorder=1, alpha=0.7)
ax.add_patch(ring3_bg)

# Section labels (large watermark style)
ax.text(0.9, 9.3, 'Ring 0', fontsize=22, fontweight='bold', color=G_BD,
        alpha=0.9, fontfamily='STHeiti', zorder=2)
ax.text(0.9, 8.85, '内核态  ·  LLMHips.sys', fontsize=11, color=G_DARK,
        fontfamily='STHeiti', zorder=2)

ax.text(0.9, 4.75, 'Ring 3', fontsize=22, fontweight='bold', color=B_BD,
        alpha=0.9, fontfamily='STHeiti', zorder=2)
ax.text(0.9, 4.3, '用户态  ·  C# SecurityBridge', fontsize=11, color=B_DARK,
        fontfamily='STHeiti', zorder=2)

# ══════════════════════════════════════════════════════════════════
# Ring 0  components  (horizontal row at y≈7.6)
# ══════════════════════════════════════════════════════════════════
def draw_box(ax, x, y, w, h, title, subtitle, fc, ec, star=False, zorder=4):
    box = FancyBboxPatch((x, y - h/2), w, h,
        boxstyle="round,pad=0.12", facecolor=fc, edgecolor=ec,
        linewidth=2, zorder=zorder)
    ax.add_patch(box)
    ty = y + h*0.18 if subtitle else y
    ax.text(x + w/2, ty, title, fontsize=10.5, fontweight='bold',
            color=ec, ha='center', va='center', fontfamily='STHeiti', zorder=zorder+1)
    if subtitle:
        ax.text(x + w/2, y - h*0.22, subtitle, fontsize=8.5,
                color=GREY, ha='center', va='center',
                fontfamily='STHeiti', zorder=zorder+1)
    if star:
        ax.text(x + w - 0.18, y + h/2 - 0.18, '★', fontsize=11,
                color=ec, ha='right', va='top', zorder=zorder+2)
    return (x + w/2, y)   # center point

# Ring 0 boxes
k1 = draw_box(ax, 2.8, 7.6, 2.8, 1.2,
              '进程创建事件',
              'PsSetCreateProcessNotify\nRoutineEx 回调触发',
              '#C8E6C9', G_BD, star=True)

k2 = draw_box(ax, 6.3, 7.6, 2.8, 1.2,
              '填充 PROCESS_INFO',
              'PID · PPID · ImagePath\nCommandLine · SessionId',
              '#DCEDC8', '#388E3C')

k3 = draw_box(ax, 9.8, 7.6, 2.8, 1.2,
              'SPSC Ring Buffer',
              '无锁写入进程数据\nIRQL = DISPATCH_LEVEL 安全',
              '#C8E6C9', G_BD, star=True)

k4 = draw_box(ax, 13.3, 7.6, 2.8, 1.2,
              'KEVENT 内核事件',
              'KeSetEvent()\n通知用户态数据已就绪',
              '#DCEDC8', '#388E3C')

# Arrows between Ring 0 boxes
for src, dst in [(k1, k2), (k2, k3), (k3, k4)]:
    ax.annotate('', xy=(dst[0] - 1.4, dst[1]),
                xytext=(src[0] + 1.4, src[1]),
                arrowprops=dict(arrowstyle='->', color=G_BD, lw=2), zorder=5)

# ══════════════════════════════════════════════════════════════════
# Memory isolation barrier (dramatic center element)
# ══════════════════════════════════════════════════════════════════
barrier_y = 5.25

# Barrier hatching (diagonal red lines)
for xi in np.arange(0.3, 17.7, 0.45):
    ax.plot([xi, xi + 0.3], [barrier_y - 0.28, barrier_y + 0.28],
            color='#EF9A9A', lw=2.5, alpha=0.6, zorder=2)

# Barrier border
barrier_rect = FancyBboxPatch((0.3, barrier_y - 0.32), 17.4, 0.64,
    boxstyle="square,pad=0", facecolor='none',
    edgecolor=RED, linewidth=2.5, linestyle='--', zorder=3)
ax.add_patch(barrier_rect)

# Barrier center label
bl_bg = FancyBboxPatch((6.8, barrier_y - 0.52), 4.4, 1.04,
    boxstyle="round,pad=0.1", facecolor='#FFEBEE',
    edgecolor=RED, linewidth=2, zorder=6)
ax.add_patch(bl_bg)
ax.text(9.0, barrier_y + 0.2, '!!  内核态 / 用户态  内存完全隔离',
        fontsize=10.5, fontweight='bold', color=RED,
        ha='center', fontfamily='STHeiti', zorder=7)
ax.text(9.0, barrier_y - 0.2, '不可直接传递指针  ·  必须经由系统调用',
        fontsize=9, color='#B71C1C',
        ha='center', fontfamily='STHeiti', zorder=7)

# ══════════════════════════════════════════════════════════════════
# Ring 3  components (two rows)
# ══════════════════════════════════════════════════════════════════
u1 = draw_box(ax, 2.8,  3.4, 2.8, 1.2,
              'KeWaitForSingleObject',
              '阻塞等待 KEVENT 唤醒\n零 CPU 占用挂起',
              '#BBDEFB', B_BD)

u2 = draw_box(ax, 6.3, 3.4, 2.8, 1.2,
              'DeviceIoControl()',
              'P/Invoke 调用 Win32 API\n\\Device\\LLMHips 句柄',
              '#90CAF9', B_DARK, star=True)

u3 = draw_box(ax, 9.8, 3.4, 2.8, 1.2,
              'METHOD_BUFFERED',
              '内核全程代管内存拷贝\n用户态无法访问内核地址',
              '#90CAF9', B_DARK, star=True)

u4 = draw_box(ax, 13.3, 3.4, 2.8, 1.2,
              'BinaryReader 反序列化',
              '结构体字段类型安全提取\nPID / 路径 / 命令行还原',
              '#BBDEFB', B_BD)

# JSON → WebSocket  (bottom row, centered)
u5 = draw_box(ax, 6.8, 1.5, 6.4, 1.0,
              'JSON 序列化  →  WebSocket 广播 :9527',
              '进程数据实时推送至 React 前端控制台',
              P_BG, P_BD)

# Arrows between Ring 3 boxes (top row)
for src, dst in [(u1, u2), (u2, u3), (u3, u4)]:
    ax.annotate('', xy=(dst[0] - 1.4, dst[1]),
                xytext=(src[0] + 1.4, src[1]),
                arrowprops=dict(arrowstyle='->', color=B_BD, lw=2), zorder=5)

# u4 → u5 (down then left)
ax.annotate('', xy=(u5[0] + 0.5, u5[1] + 0.5),
            xytext=(u4[0], u4[1] - 0.6),
            arrowprops=dict(arrowstyle='->', color=P_BD, lw=2,
                           connectionstyle='arc3,rad=0.3'), zorder=5)

# ══════════════════════════════════════════════════════════════════
# Cross-boundary arrows  (the dramatic part)
# ══════════════════════════════════════════════════════════════════

# 1. KEVENT → KeWaitForSingleObject  (diagonal, long, orange)
ax.annotate('', xy=(u1[0], u1[1] + 0.6),
            xytext=(k4[0], k4[1] - 0.6),
            arrowprops=dict(
                arrowstyle='->', color=ORANGE, lw=2.5,
                connectionstyle='arc3,rad=-0.25',
                path_effects=[pe.withStroke(linewidth=4.5, foreground='#FFF3E0')]
            ), zorder=8)

# KEVENT arrow label
ax.text(6.3, 4.62, 'KEVENT 唤醒', fontsize=9, fontweight='bold',
        color=ORANGE, ha='center', fontfamily='STHeiti',
        bbox=dict(boxstyle='round,pad=0.25', facecolor='#FFF8E1',
                  edgecolor=ORANGE, linewidth=1.5), zorder=9)

# 2. Ring Buffer → METHOD_BUFFERED  (vertical, thick red, main data transfer)
ax.annotate('', xy=(u3[0], u3[1] + 0.6),
            xytext=(k3[0], k3[1] - 0.6),
            arrowprops=dict(
                arrowstyle='->', color=RED, lw=3.5,
                path_effects=[pe.withStroke(linewidth=6, foreground='#FFCDD2')]
            ), zorder=8)

ax.text(12.3, 5.25, 'IOCTL\n数据穿越', fontsize=9, fontweight='bold',
        color=RED, ha='center', fontfamily='STHeiti',
        bbox=dict(boxstyle='round,pad=0.25', facecolor='#FFEBEE',
                  edgecolor=RED, linewidth=1.5), zorder=9)

# ══════════════════════════════════════════════════════════════════
# Title
# ══════════════════════════════════════════════════════════════════
ax.text(9.0, 9.7, 'Ring 0  →  Ring 3  跨特权级数据穿越',
        fontsize=17, fontweight='bold', color='#212121',
        ha='center', fontfamily='STHeiti', zorder=5)

# ══════════════════════════════════════════════════════════════════
# Bottom conclusion bar
# ══════════════════════════════════════════════════════════════════
conc_bg = FancyBboxPatch((0.3, 0.05), 17.4, 0.48,
    boxstyle="round,pad=0.08", facecolor='#E8EAF6',
    edgecolor='#3F51B5', linewidth=1.5, zorder=3)
ax.add_patch(conc_bg)
ax.text(9.0, 0.29,
        'METHOD_BUFFERED 由 Windows 内核全程代管内存拷贝，'
        '用户态程序无法也无需直接访问内核地址空间，从根本上保证跨特权级数据传输的安全性',
        fontsize=9.5, color='#1A237E', ha='center', va='center',
        fontfamily='STHeiti', fontweight='bold', zorder=5)

plt.tight_layout(pad=0.2)
out = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture/ioctl_flow.png'
plt.savefig(out, dpi=220, bbox_inches='tight', facecolor='#FAFAFA')
plt.close()
print('Saved:', out)
