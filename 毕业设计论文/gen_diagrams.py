#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate 4 module architecture diagrams for LLMHips thesis.
Style reference: professional academic paper flowchart with Chinese/English bilingual labels.
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, Wedge
import numpy as np
import os

# ── Font config ──────────────────────────────
plt.rcParams['font.family'] = ['STHeiti', 'Heiti TC', 'AppleGothic', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

SAVE_DIR = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture'
DPI = 220

# ── Color palette ────────────────────────────
RED    = '#8B3030'
GREEN  = '#2A6B3A'
BLUE   = '#1A4A7C'
AMBER  = '#C07818'
TEAL   = '#1E5F74'
PURPLE = '#5A3878'
SLATE  = '#3D5A80'
BROWN  = '#6B4218'
NAVY   = '#1A2D48'
GRAY   = '#555566'
LGRAY  = '#9090A0'
BG     = '#F8F7F2'
K_BG   = '#E8EDF7'
U_BG   = '#F6EFE4'
WHITE  = '#FFFFFF'

# ── Helpers ──────────────────────────────────

def rbox(ax, x, y, w, h, fc, title, subtitle=None, items=None,
         fs=9.5, ec='white', lw=1.8, alpha=1.0, zorder=4, tc='white'):
    """Rounded rectangle module box."""
    patch = FancyBboxPatch((x, y), w, h,
                            boxstyle='round,pad=0.012',
                            facecolor=fc, edgecolor=ec,
                            linewidth=lw, alpha=alpha, zorder=zorder)
    ax.add_patch(patch)
    if items:
        ty = y + h - 0.042
        ax.text(x+w/2, ty, title, ha='center', va='center',
                fontsize=fs, color=tc, fontweight='bold', zorder=zorder+1)
        if subtitle:
            ax.text(x+w/2, ty - 0.026, subtitle, ha='center', va='center',
                    fontsize=max(fs-2.5, 6), color='#BBCCDD',
                    fontstyle='italic', zorder=zorder+1)
        line_h = 0.030
        for i, item in enumerate(items):
            ax.text(x+0.013, ty - 0.058 - i*line_h, f'\u00b7 {item}',
                    ha='left', va='center',
                    fontsize=max(fs-2.5, 6.5), color='#DDE8F0', zorder=zorder+1)
    else:
        cy = y + h/2
        dy = 0.018 if subtitle else 0
        ax.text(x+w/2, cy+dy, title, ha='center', va='center',
                fontsize=fs, color=tc, fontweight='bold', zorder=zorder+1)
        if subtitle:
            ax.text(x+w/2, cy-dy, subtitle, ha='center', va='center',
                    fontsize=max(fs-2.5, 6.5), color='#BBCCDD',
                    fontstyle='italic', zorder=zorder+1)

def arw(ax, x1, y1, x2, y2, color=AMBER, label='',
        lw=1.6, rad=0.0, zorder=3, fs=7.2, ls='-'):
    """Arrow with optional label."""
    cs = f'arc3,rad={rad}'
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color=color, lw=lw,
                                linestyle=ls, connectionstyle=cs),
                zorder=zorder)
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx, my, label, ha='center', va='center',
                fontsize=fs, color=color, fontweight='bold', zorder=zorder+2,
                bbox=dict(boxstyle='round,pad=0.18', facecolor=WHITE,
                          edgecolor=color, alpha=0.93, linewidth=0.9))

def tag(ax, x, y, text, fc, tc='white', fs=7.2, zorder=6):
    """Small badge/tag label."""
    ax.text(x, y, text, ha='center', va='center', fontsize=fs,
            color=tc, fontweight='bold', zorder=zorder,
            bbox=dict(boxstyle='round,pad=0.22', facecolor=fc,
                      edgecolor=WHITE, linewidth=0.8, alpha=0.95))

def region(ax, x, y, w, h, fc, label, ec, ls='--', alpha=0.45, zorder=1):
    """Background region (kernel space / user space)."""
    patch = FancyBboxPatch((x, y), w, h,
                            boxstyle='round,pad=0.015',
                            facecolor=fc, edgecolor=ec,
                            linewidth=1.8, linestyle=ls,
                            alpha=alpha, zorder=zorder)
    ax.add_patch(patch)
    if label:
        ax.text(x+0.015, y+h-0.022, label, fontsize=8.5,
                color=ec, fontweight='bold', va='center')

def new_fig(w=13, h=9):
    fig, ax = plt.subplots(figsize=(w, h))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')
    return fig, ax

def big_title(ax, cn, en):
    ax.text(0.5, 0.975, cn, ha='center', va='center', fontsize=14,
            fontweight='bold', color=NAVY)
    ax.text(0.5, 0.955, en, ha='center', va='center', fontsize=9.5,
            color=GRAY, fontstyle='italic')

def save_fig(fig, name):
    path = os.path.join(SAVE_DIR, name)
    fig.savefig(path, dpi=DPI, bbox_inches='tight',
                facecolor=BG, pad_inches=0.15)
    plt.close(fig)
    print(f'  Saved -> {path}')


# ═══════════════════════════════════════════════
# Diagram 1 — Kernel Driver Module
# ═══════════════════════════════════════════════
def draw_kernel():
    fig, ax = new_fig(14, 9.5)
    big_title(ax,
              '\u56fe X  \u5185\u6838\u9a71\u52a8\u6a21\u5757\u67b6\u6784',
              'Fig. X  Kernel Driver Module Architecture')

    # Kernel Space region
    region(ax, 0.03, 0.06, 0.94, 0.84,
           K_BG, '\u5185\u6838\u7a7a\u95f4  Kernel Space',
           BLUE, ls='--', alpha=0.50, zorder=1)

    # OS Process Subsystem (top center)
    rbox(ax, 0.31, 0.78, 0.38, 0.10,
         '#4A6080',
         '\u64cd\u4f5c\u7cfb\u7edf\u8fdb\u7a0b\u5b50\u7cfb\u7edf',
         'OS Process Subsystem \u00b7 Ps* routines',
         fs=10, zorder=4)

    # ① Process Monitor (left-top)
    rbox(ax, 0.04, 0.52, 0.27, 0.22,
         RED, '\u2460 \u8fdb\u7a0b\u76d1\u63a7\u5b50\u6a21\u5757',
         'Process Monitor',
         items=['PsSetCreateProcessNotifyRoutineEx',
                '\u6ce8\u518c\u7cfb\u7edf\u56de\u8c03',
                '\u6355\u83b7\u8fdb\u7a0b\u521b\u5efa/\u7ec8\u6b62\u4e8b\u4ef6'],
         fs=9.5, zorder=4)

    # ② Feature Extractor (left-bottom)
    rbox(ax, 0.04, 0.19, 0.27, 0.22,
         GREEN, '\u2461 \u7279\u5f81\u63d0\u53d6\u5b50\u6a21\u5757',
         'Feature Extractor',
         items=['\u8fdb\u7a0b\u6620\u50cf\u8def\u5f84\u89e3\u6790',
                'Authenticode \u7b7e\u540d\u9a8c\u8bc1',
                '\u7236\u8fdb\u7a0b PID / \u7528\u6237 Token'],
         fs=9.5, zorder=4)

    # ③ Ring Buffer (center) — draw as segmented ring
    cx, cy, ro, ri = 0.50, 0.41, 0.120, 0.068
    n = 12
    for i in range(n):
        th1 = 90 - i*(360/n)
        th2 = th1 - (360/n) + 2
        filled = i < 5
        fc = '#D4922A' if filled else '#E2D8C8'
        w = Wedge((cx, cy), ro, th2, th1,
                   width=ro-ri,
                   facecolor=fc, edgecolor=WHITE,
                   linewidth=1.3, zorder=3)
        ax.add_patch(w)
    inner = plt.Circle((cx, cy), ri,
                        facecolor=WHITE, edgecolor=AMBER,
                        linewidth=1.8, zorder=4)
    ax.add_patch(inner)
    ax.text(cx, cy+0.022, '\u2462 \u4e8b\u4ef6\u7f13\u51b2',
            ha='center', va='center', fontsize=9,
            fontweight='bold', color=NAVY, zorder=5)
    ax.text(cx, cy-0.012, 'Ring Buffer',
            ha='center', va='center', fontsize=7.5,
            color=GRAY, fontstyle='italic', zorder=5)
    ax.text(cx, cy-0.036, 'lock-free SPSC',
            ha='center', va='center', fontsize=6.5, color=LGRAY, zorder=5)

    # PRODUCER / CONSUMER badges
    tag(ax, cx-0.145, cy+0.09, 'PRODUCER', GREEN)
    tag(ax, cx+0.115, cy+0.09, 'CONSUMER', BLUE)
    ax.text(cx-0.075, cy+0.130, 'tail', fontsize=7.5,
            color=RED, fontstyle='italic', ha='center')
    ax.text(cx+0.110, cy-0.130, 'head', fontsize=7.5,
            color=BLUE, fontstyle='italic', ha='center')

    # ④ IOCTL Channel (right-top)
    rbox(ax, 0.69, 0.52, 0.28, 0.22,
         BLUE, '\u2463 IOCTL \u901a\u4fe1\u5b50\u6a21\u5757',
         'IOCTL Channel',
         items=['IRP_MJ_DEVICE_CONTROL',
                'IOCTL \u8bf7\u6c42\u5206\u53d1\u5904\u7406',
                r'\u8bbe\u5907\u63a5\u53e3 \\Device\\LLMHips'],
         fs=9.5, zorder=4)

    # ⑤ Interception (right-bottom)
    rbox(ax, 0.69, 0.19, 0.28, 0.22,
         BROWN, '\u2464 \u62e6\u622a\u51b3\u7b56\u5b50\u6a21\u5757',
         'Interception & Enforcement',
         items=['\u51b3\u7b56\u961f\u5217 wait/signal',
                '\u57fa\u4e8e\u88c1\u51b3\u7ed3\u679c\u963b\u65ad\u6216\u653e\u884c',
                '\u963b\u65ad\u8c03\u7528 ZwTerminateProcess'],
         fs=9.5, zorder=4)

    # Strategy Engine box inside user-space right area
    region(ax, 0.69, 0.08, 0.28, 0.10,
           U_BG, '', BROWN, ls=':', alpha=0.7, zorder=2)
    ax.text(0.83, 0.14, '\u7b56\u7565\u5f15\u64ce  policy engine',
            ha='center', va='center', fontsize=8, color=BROWN, fontweight='bold')
    ax.text(0.83, 0.10, 'allow  /  block',
            ha='center', va='center', fontsize=7.5, color=GRAY)

    # User Space label
    ax.text(0.955, 0.16, '\u7528\u6237\u7a7a\u95f4\nUser Space',
            ha='center', va='center', fontsize=7.5, color=BROWN,
            fontweight='bold', linespacing=1.4)

    # ── Arrows ──
    # OS → ①
    arw(ax, 0.31, 0.83, 0.175, 0.74, NAVY, '\u2460 \u8fdb\u7a0b\u4e8b\u4ef6')
    # ① → ②
    arw(ax, 0.175, 0.52, 0.175, 0.41, GRAY, 'raw ctx')
    # ② → Ring Buffer (enqueue)
    arw(ax, 0.31, 0.295, 0.38, 0.365, GREEN,
        '\u2461 \u5bcc\u5316\u5165\u961f enqueue', lw=1.8)
    # Ring Buffer → ④ (dequeue)
    arw(ax, 0.622, 0.44, 0.69, 0.605, AMBER,
        '\u2462 \u51fa\u961f dequeue', lw=1.8)
    # Ring Buffer → ⑤ (signal)
    arw(ax, 0.620, 0.38, 0.69, 0.31, BLUE,
        '\u2465 signal', lw=1.5)
    # ④ → policy engine
    arw(ax, 0.83, 0.52, 0.83, 0.18, NAVY, 'dispatch', lw=1.5)
    # policy engine → ⑤
    ax.annotate('', xy=(0.83, 0.41), xytext=(0.83, 0.185),
                arrowprops=dict(arrowstyle='->', color=BROWN, lw=1.5,
                                connectionstyle='arc3,rad=0.0'), zorder=3)

    # ⑤ → OS (ZwTerminateProcess) — red curved
    ax.annotate('', xy=(0.66, 0.83), xytext=(0.83, 0.41),
                arrowprops=dict(arrowstyle='->', color=RED, lw=2.0,
                                connectionstyle='arc3,rad=-0.35'), zorder=3)
    ax.text(0.768, 0.68, '\u2466 ZwTerminateProcess',
            ha='center', va='center', fontsize=7.5, color=RED,
            fontweight='bold', rotation=-38,
            bbox=dict(boxstyle='round,pad=0.18', facecolor='#FFEEEE',
                      edgecolor=RED, alpha=0.93, linewidth=0.8))

    # IOCTL badge labels
    tag(ax, 0.83, 0.745, 'IOCTL_GET_EVENT', BLUE, fs=7)
    tag(ax, 0.83, 0.185, 'IOCTL_SET_VERDICT', BROWN, fs=7)

    # Legend
    ly = 0.087
    items = [
        (AMBER, '\u5df2\u5360\u7528\u69fd\u4f4d occupied'),
        ('#E2D8C8', '\u7a7a\u95f2\u69fd\u4f4d free'),
        (GREEN, '\u2192  \u5165\u961f/\u51fa\u961f'),
        (BLUE,  '\u2192  \u5185\u6838\u2192\u7528\u6237'),
        (RED,   '\u2192  \u62e6\u622a\u6267\u884c'),
    ]
    ax.text(0.04, ly+0.008, '\u56fe\u4f8b Legend',
            fontsize=8, color=NAVY, fontweight='bold')
    for i, (c, lbl) in enumerate(items):
        lx = 0.04 + i*0.19
        sq = FancyBboxPatch((lx, ly-0.010), 0.016, 0.014,
                             boxstyle='square,pad=0.001',
                             facecolor=c, edgecolor=GRAY,
                             linewidth=0.5, zorder=5)
        ax.add_patch(sq)
        ax.text(lx+0.022, ly-0.003, lbl,
                fontsize=6.8, color=NAVY, va='center')

    fig.tight_layout(pad=0.3)
    save_fig(fig, 'arch_01_kernel_driver.png')


# ═══════════════════════════════════════════════
# Diagram 2 — Middleware Module (SecurityBridge)
# ═══════════════════════════════════════════════
def draw_middleware():
    fig, ax = new_fig(13, 9)
    big_title(ax,
              '\u56fe X  C# \u4e2d\u95f4\u5c42\uff08SecurityBridge\uff09\u6a21\u5757\u67b6\u6784',
              'Fig. X  Middleware (SecurityBridge) Module Architecture')

    # ── External systems ──
    # Kernel Driver (left)
    rbox(ax, 0.02, 0.60, 0.16, 0.13,
         '#4A6080',
         '\u5185\u6838\u9a71\u52a8\u5c42',
         'LLMHips.sys',
         fs=9, zorder=4)
    # Frontend (right)
    rbox(ax, 0.82, 0.60, 0.16, 0.13,
         '#4A6080',
         'React \u524d\u7aef',
         'Frontend Console',
         fs=9, zorder=4)
    # Decision feedback right→left bottom
    rbox(ax, 0.82, 0.26, 0.16, 0.11,
         '#4A6080',
         '\u5206\u6790\u5e08\u51b3\u7b56',
         'Analyst Decision',
         fs=9, zorder=4)

    # ── SecurityBridge region ──
    region(ax, 0.21, 0.10, 0.58, 0.80,
           '#EBF0F8', 'SecurityBridge  C# \u4e2d\u95f4\u5c42',
           TEAL, ls='-', alpha=0.50, zorder=1)

    # ① Driver Comm Module
    rbox(ax, 0.24, 0.67, 0.24, 0.18,
         BLUE, '\u2460 \u9a71\u52a8\u901a\u4fe1\u6a21\u5757',
         'Driver Communication',
         items=['P/Invoke IOCTL \u5c01\u88c5',
                'DeviceIoControl \u8bfb\u5199',
                '\u540e\u53f0\u7ebf\u7a0b\u8f6e\u8be2\u4e8b\u4ef6'],
         fs=9, zorder=4)

    # ② Event Parser
    rbox(ax, 0.52, 0.67, 0.24, 0.18,
         TEAL, '\u2461 \u4e8b\u4ef6\u89e3\u6790\u6a21\u5757',
         'Event Parser',
         items=['\u4e8c\u8fdb\u5236\u201c\u53cd\u5e8f\u5217\u5316\u201d',
                '\u6784\u5efa ProcessEvent \u5bf9\u8c61',
                'JSON \u5e8f\u5217\u5316\u8f93\u51fa'],
         fs=9, zorder=4)

    # ③ WebSocket Server (center-bottom)
    rbox(ax, 0.24, 0.34, 0.24, 0.24,
         SLATE, '\u2462 WebSocket \u670d\u52a1\u6a21\u5757',
         'WebSocket Server \u00b7 :9527',
         items=['HttpListener \u5347\u7ea7\u5904\u7406',
                '\u591a\u5ba2\u6237\u7aef\u8fde\u63a5\u7ba1\u7406',
                'ConcurrentBag<WebSocket>',
                '\u5e7f\u64ad SendAsync'],
         fs=9, zorder=4)

    # ④ Decision Router
    rbox(ax, 0.52, 0.34, 0.24, 0.24,
         PURPLE, '\u2463 \u51b3\u7b56\u8def\u7531\u6a21\u5757',
         'Decision Router',
         items=['\u524d\u7aef\u6307\u4ee4\u63a5\u6536\u89e3\u6790',
                '\u6620\u5c04\u81f3\u9a71\u52a8\u5904\u7f6e\u961f\u5217',
                'IOCTL_SET_VERDICT \u5199\u5165',
                '\u6743\u9650\u6821\u9a8c\u4e0e\u9632\u8bef\u5904\u7406'],
         fs=9, zorder=4)

    # ── Arrows ──
    # Kernel → ①
    arw(ax, 0.18, 0.665, 0.24, 0.755, BLUE,
        'IOCTL\n\u4e8b\u4ef6\u4e0a\u62a5', fs=7.5, lw=1.8)
    # ① → ②
    arw(ax, 0.48, 0.755, 0.52, 0.755, TEAL,
        'ProcessEvent', fs=7.5, lw=1.8)
    # ② → WebSocket Server
    arw(ax, 0.64, 0.67, 0.64, 0.58, SLATE,
        'JSON', fs=7.5, lw=1.8)
    # ② → ③ (diagonal)
    arw(ax, 0.52, 0.71, 0.48, 0.575, AMBER,
        '', lw=1.5, rad=0.1)
    # ③ → Frontend
    arw(ax, 0.48, 0.44, 0.82, 0.665, SLATE,
        'WebSocket\n\u5e7f\u64ad', fs=7.5, lw=1.8)
    # ① → ③ (vertical)
    arw(ax, 0.36, 0.67, 0.36, 0.58, AMBER,
        '', lw=1.4)
    # Decision from right → ④
    arw(ax, 0.82, 0.305, 0.76, 0.44, RED,
        '\u5904\u7f6e\u6307\u4ee4', fs=7.5, lw=1.8)
    # ④ → ① (decision down to driver)
    arw(ax, 0.52, 0.43, 0.48, 0.43, PURPLE, '', lw=1.5)
    arw(ax, 0.36, 0.34, 0.18, 0.66, RED,
        'IOCTL\n\u62e6\u622a\u6307\u4ee4', fs=7.5, lw=1.8, rad=0.2)

    # Heartbeat / polling annotation
    ax.text(0.50, 0.22,
            '\u5fc3\u8df3\u5e7f\u64ad / \u4e3b\u52a8\u8f6e\u8be2  Heartbeat & Active Polling',
            ha='center', va='center', fontsize=7.5, color=LGRAY, fontstyle='italic',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='white',
                      edgecolor=LGRAY, linewidth=0.8, alpha=0.85))

    # Port badge
    tag(ax, 0.36, 0.625, ':9527', SLATE, fs=7)

    fig.tight_layout(pad=0.3)
    save_fig(fig, 'arch_02_middleware.png')


# ═══════════════════════════════════════════════
# Diagram 3 — Frontend Module
# ═══════════════════════════════════════════════
def draw_frontend():
    fig, ax = new_fig(13, 9)
    big_title(ax,
              '\u56fe X  React \u524d\u7aef\u63a7\u5236\u53f0\u6a21\u5757\u67b6\u6784',
              'Fig. X  React Frontend Console Module Architecture')

    # External: WebSocket server (left)
    rbox(ax, 0.02, 0.58, 0.14, 0.11,
         '#4A6080', 'SecurityBridge',
         'WebSocket :9527', fs=8.5, zorder=4)
    # External: LLM Service (right)
    rbox(ax, 0.84, 0.58, 0.14, 0.11,
         PURPLE, 'LLMHips-LM',
         '\u63a8\u7406\u670d\u52a1 :8000', fs=8.5, zorder=4)
    # LocalStorage (bottom center)
    rbox(ax, 0.38, 0.07, 0.24, 0.09,
         '#5A6060', 'localStorage',
         'Browser Persistent Store', fs=8.5, zorder=4)

    # ── Zustand Store (center large) ──
    region(ax, 0.20, 0.45, 0.60, 0.40,
           '#E8EDF5', 'Zustand \u5168\u5c40\u72b6\u6001\u5c42  Global State Store',
           SLATE, ls='-', alpha=0.55, zorder=1)

    # State fields inside Zustand
    fields = [
        'wsStatus  \u8fde\u63a5\u72b6\u6001\u679a\u4e3e',
        'events[ ]  \u8fdb\u7a0b\u4e8b\u4ef6\u6570\u7ec4',
        'selectedEvent  \u5f53\u524d\u5f85\u7814\u5224\u4e8b\u4ef6',
        'analysisRecords[ ]  \u7814\u5224\u5386\u53f2',
        'isMonitoring  \u76d1\u63a7\u5f00\u5173',
    ]
    for i, f in enumerate(fields):
        ax.text(0.50, 0.80 - i*0.058, f'\u2022  {f}',
                ha='center', va='center', fontsize=8, color=NAVY)

    # ── 5 sub-modules ──
    # ① WebSocket Client (left of zustand)
    rbox(ax, 0.03, 0.34, 0.22, 0.22,
         BLUE, '\u2460 WebSocket \u5ba2\u6237\u7aef',
         'WS Client',
         items=['\u8fde\u63a5\u751f\u547d\u5468\u671f\u7ba1\u7406',
                '\u6307\u6570\u9000\u907f\u91cd\u8fde',
                '\u6d88\u606f\u8def\u7531\u81f3 store'],
         fs=9, zorder=4)

    # ② Alert Monitor (left-bottom)
    rbox(ax, 0.03, 0.10, 0.22, 0.20,
         TEAL, '\u2461 \u544a\u8b66\u76d1\u63a7\u6a21\u5757',
         'Alert Monitor',
         items=['\u5b9e\u65f6\u4e8b\u4ef6\u5217\u8868\u5c55\u793a',
                '\u8fc7\u6ee4 / \u6392\u5e8f',
                '\u70b9\u51fb\u89e6\u53d1\u7814\u5224'],
         fs=9, zorder=4)

    # ③ LLM Assessment (right of zustand)
    rbox(ax, 0.75, 0.34, 0.23, 0.22,
         PURPLE, '\u2462 LLM \u7814\u5224\u6a21\u5757',
         'LLM Assessment',
         items=['SSE \u6d41\u5f0f\u5bf9\u8bdd',
                'AbortController \u53d6\u6d88',
                '\u95ed\u5305\u6d3b\u8dc3\u6807\u5fd7\u9632\u7ade\u6001',
                '\u6807\u7b7e\u89e3\u6790\u63d0\u53d6'],
         fs=9, zorder=4)

    # ④ History Manager (right-bottom)
    rbox(ax, 0.75, 0.10, 0.23, 0.20,
         SLATE, '\u2463 \u5386\u53f2\u7ba1\u7406\u6a21\u5757',
         'History Manager',
         items=['\u5de5\u5355\u5c55\u5f00/\u6298\u53e0\u63a7\u5236',
                '\u5173\u952e\u8bcd\u641c\u7d22\u8fc7\u6ee4',
                'useMemo \u6027\u80fd\u4f18\u5316'],
         fs=9, zorder=4)

    # ⑤ Persist Middleware (bottom of zustand)
    rbox(ax, 0.26, 0.18, 0.48, 0.11,
         '#5A6878', '\u2464 \u72b6\u6001\u6301\u4e45\u5316\u6a21\u5757  Zustand persist middleware',
         'partialize \u9009\u62e9\u6027\u5e8f\u5217\u5316  \u00b7  \u8fc7\u6ee4\u4e0d\u53ef\u5e8f\u5217\u5316\u503c\uff08WebSocket\uff09',
         fs=8.5, zorder=4)

    # ── Arrows ──
    # SecurityBridge → ①
    arw(ax, 0.16, 0.63, 0.07, 0.56, BLUE, 'WS\n\u4e8b\u4ef6', fs=7.5, lw=1.8)
    # ① → Zustand
    arw(ax, 0.14, 0.42, 0.20, 0.62, AMBER,
        '\u4e8b\u4ef6\u5165 store', fs=7.5, lw=1.8, rad=-0.1)
    # Zustand → ②
    arw(ax, 0.22, 0.48, 0.22, 0.30, TEAL,
        'events[ ]', fs=7.5, lw=1.8)
    # LLM Service → ③ (SSE)
    arw(ax, 0.84, 0.63, 0.98, 0.44, PURPLE,
        'SSE\u6d41', fs=7.5, lw=1.8, rad=0.1)
    ax.annotate('', xy=(0.975, 0.445), xytext=(0.975, 0.44))
    arw(ax, 0.975, 0.445, 0.975, 0.43, PURPLE, '', lw=1.0)
    # ③ → LLM Service (request)
    arw(ax, 0.98, 0.50, 0.84, 0.635, SLATE,
        'POST\n/chat', fs=7.5, lw=1.8, rad=-0.1)
    # Zustand → ③
    arw(ax, 0.80, 0.60, 0.80, 0.56, PURPLE,
        'selectedEvent', fs=7, lw=1.5)
    # Zustand → ④
    arw(ax, 0.80, 0.47, 0.80, 0.30, SLATE,
        'records', fs=7.5, lw=1.5)
    # ⑤ → localStorage
    arw(ax, 0.50, 0.18, 0.50, 0.16, '#5A6060', '', lw=1.5)
    arw(ax, 0.50, 0.18, 0.50, 0.16, '#5A6060', '\u6301\u4e45\u5316', fs=7.5, lw=1.5)
    arw(ax, 0.50, 0.182, 0.50, 0.16, '#5A6060', '\u6301\u4e45\u5316', fs=7.5, lw=1.5)
    ax.annotate('', xy=(0.50, 0.16), xytext=(0.50, 0.29),
                arrowprops=dict(arrowstyle='->', color='#5A6060', lw=1.5,
                                connectionstyle='arc3,rad=0'), zorder=3)
    ax.text(0.515, 0.225, '\u6301\u4e45\u5316',
            ha='left', va='center', fontsize=7.5, color='#5A6060', fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.15', facecolor=WHITE,
                      edgecolor='#5A6060', alpha=0.9, linewidth=0.8))

    # Page routing badge
    tag(ax, 0.50, 0.94,
        '\u9875\u9762\u8def\u7531: \u76d1\u63a7\u9762\u677f \u00b7 \u56fe\u8868 \u00b7 \u6700\u8fd1\u4e8b\u4ef6 \u00b7 LLM \u5bf9\u8bdd \u00b7 \u5386\u53f2\u8bb0\u5f55',
        NAVY, '#FFFFFF', fs=7.5)

    fig.tight_layout(pad=0.3)
    save_fig(fig, 'arch_03_frontend.png')


# ═══════════════════════════════════════════════
# Diagram 4 — LLMHips-LM Inference Service
# ═══════════════════════════════════════════════
def draw_llm_service():
    fig, ax = new_fig(13, 9)
    big_title(ax,
              '\u56fe X  LLMHips-LM \u63a8\u7406\u670d\u52a1\u6a21\u5757\u67b6\u6784',
              'Fig. X  LLMHips-LM Inference Service Module Architecture')

    # ── FastAPI App region ──
    region(ax, 0.04, 0.08, 0.92, 0.82,
           '#EEE8F5', 'FastAPI \u5e94\u7528\u5c42  FastAPI Application',
           PURPLE, ls='-', alpha=0.45, zorder=1)

    # CORS Middleware (top banner)
    rbox(ax, 0.06, 0.83, 0.88, 0.065,
         '#8A6898', 'CORS \u4e2d\u95f4\u4ef6  CORS Middleware',
         'allow_origins=["http://localhost:5173"]  \u00b7  \u652f\u6301\u8de8\u57df\u8bbf\u95ee',
         fs=9, ec='white', lw=1.2, zorder=4)

    # Lifespan startup region
    region(ax, 0.06, 0.64, 0.40, 0.17,
           '#E0E8F0', 'lifespan \u542f\u52a8\u9636\u6bb5  Startup Phase',
           BLUE, ls='--', alpha=0.55, zorder=2)

    # Model loading box
    rbox(ax, 0.08, 0.66, 0.36, 0.13,
         BLUE, '\u6a21\u578b\u9884\u52a0\u8f7d  Model Pre-loading',
         None,
         items=['AutoTokenizer.from_pretrained()',
                'AutoModelForCausalLM \u00b7 float16',
                'device_map="auto" \u2192 MPS / CPU',
                'app.state.model / .tokenizer'],
         fs=9, zorder=4)

    # /health endpoint
    rbox(ax, 0.54, 0.72, 0.24, 0.11,
         GREEN, 'GET  /health',
         'Health Check Endpoint',
         items=['\u8fd4\u56de status / model / device'],
         fs=9, zorder=4)

    # /chat endpoint region
    region(ax, 0.06, 0.10, 0.87, 0.52,
           '#EDE8F8', 'POST /chat  \u6d41\u5f0f\u8d77\u59cb\u7aef\u70b9  SSE Streaming Endpoint',
           PURPLE, ls='-', alpha=0.40, zorder=2)

    # Request in (left)
    rbox(ax, 0.08, 0.44, 0.20, 0.14,
         SLATE, '\u8bf7\u6c42\u8f93\u5165',
         'ChatRequest',
         items=['messages[ ]',
                'max_new_tokens=1024',
                'temperature=0.7 / top_p=0.9',
                'repetition_penalty=1.1'],
         fs=8.5, zorder=4)

    # Tokenizer
    rbox(ax, 0.08, 0.26, 0.18, 0.12,
         TEAL, '\u5206\u8bcd\u5668  Tokenizer',
         None,
         items=['\u6784\u5efa input_ids \u5f20\u91cf',
                '\u8f93\u5165\u8bbe\u5907\u8f6c\u79fb'],
         fs=8.5, zorder=4)

    # Thread box
    rbox(ax, 0.32, 0.26, 0.26, 0.29,
         RED, 'Thread  \u540e\u53f0\u63a8\u7406\u7ebf\u7a0b',
         'model.generate( )',
         items=['TextIteratorStreamer',
                'skip_prompt=True',
                'skip_special_tokens=True',
                'thread.start()',
                'Thread \u4e0d\u963b\u585e ASGI \u4e8b\u4ef6\u5faa\u73af'],
         fs=8.5, zorder=4)

    # System Prompt box
    rbox(ax, 0.62, 0.12, 0.30, 0.38,
         '#4A4060', '\u7cfb\u7edf\u63d0\u793a\u8bcd\u6846\u67b6',
         'System Prompt Engineering',
         items=['\u89d2\u8272\u5b9a\u4e49: EDR AI \u5206\u6790\u5f15\u64ce',
                '\u5f3a\u5236\u5206\u6790\u6846\u67b6 (CoT 5\u6b65)',
                '\u8fdb\u7a0b\u6e90\u6e90 \u2192 \u7236\u5b50\u94fe \u2192',
                '\u547d\u4ee4\u884c \u2192 ATT&CK \u2192 \u7efc\u5408',
                '\u98ce\u9669\u8bc4\u5206 0-100',
                '\u8f93\u51fa <risk_score> <action>',
                '\u88c2\u8f93\u51fa\uff0c\u4e0d\u52a0 Markdown \u5305\u88f9'],
         fs=8.5, zorder=4)

    # SSE output (right)
    rbox(ax, 0.32, 0.12, 0.28, 0.10,
         AMBER, 'SSE \u6d41\u5f0f\u8f93\u51fa',
         'StreamingResponse  text/event-stream',
         fs=8.5, zorder=4)
    ax.text(0.46, 0.115,
            'data: {"text": "..."}\ndata: [DONE]',
            ha='center', va='center', fontsize=7.5,
            color='white', fontfamily='monospace')

    # gen_kwargs badge
    tag(ax, 0.45, 0.585,
        'gen_kwargs: max_new_tokens=1024 \u00b7 temp=0.7 \u00b7 top_p=0.9 \u00b7 rep_penalty=1.1 \u00b7 do_sample=True',
        NAVY, fs=7.2)

    # ── Arrows ──
    # Request → Tokenizer
    arw(ax, 0.17, 0.44, 0.17, 0.38, SLATE, '\u5f85\u5206\u6790\u6587\u672c', fs=7.5, lw=1.8)
    # Tokenizer → Thread
    arw(ax, 0.26, 0.32, 0.32, 0.40, TEAL, 'input_ids', fs=7.5, lw=1.8, rad=-0.2)
    # Thread → SSE output
    arw(ax, 0.46, 0.26, 0.46, 0.22, AMBER, 'tokens', fs=7.5, lw=1.8)
    # System Prompt → Thread
    arw(ax, 0.62, 0.30, 0.58, 0.40, '#4A4060',
        '\u7cfb\u7edf\u63d0\u793a\u8bcd', fs=7.5, lw=1.8, rad=0.15)
    # Request → Thread
    arw(ax, 0.28, 0.50, 0.32, 0.50, SLATE, '', lw=1.5)
    # gen_kwargs → Thread
    ax.annotate('', xy=(0.45, 0.55), xytext=(0.45, 0.585),
                arrowprops=dict(arrowstyle='->', color=NAVY, lw=1.3,
                                connectionstyle='arc3,rad=0'), zorder=3)
    # asyncio.sleep(0) annotation
    ax.text(0.46, 0.22,
            'asyncio.sleep(0)  \u2014  \u4e3b\u52a8\u8c26\u51fa\u4e8b\u4ef6\u5faa\u73af',
            ha='center', va='top', fontsize=7, color=LGRAY, fontstyle='italic')

    # Frontend client (outside right)
    rbox(ax, 0.84, 0.50, 0.13, 0.09,
         '#4A6080', 'React\n\u524d\u7aef', None, fs=8.5, zorder=4)
    arw(ax, 0.84, 0.55, 0.60, 0.19, AMBER,
        'SSE \u6d41', fs=7.5, lw=2.0, rad=-0.2)
    arw(ax, 0.84, 0.54, 0.83, 0.76, GREEN,
        'GET /health', fs=7.5, lw=1.5, rad=0.1)

    fig.tight_layout(pad=0.3)
    save_fig(fig, 'arch_04_llm_service.png')


# ═══════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════
if __name__ == '__main__':
    os.makedirs(SAVE_DIR, exist_ok=True)
    print('\nGenerating architecture diagrams...')
    draw_kernel()
    draw_middleware()
    draw_frontend()
    draw_llm_service()
    print('\nAll diagrams saved successfully.')
