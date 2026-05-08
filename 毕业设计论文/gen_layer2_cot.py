import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

# ─── helpers ────────────────────────────────────────────────────────
def box(ax, x, y, w, h, fc, ec, lw=1.5, ls='solid', r=0.008, z=3):
    p = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad={r}",
                       facecolor=fc, edgecolor=ec, linewidth=lw,
                       linestyle=ls, zorder=z)
    ax.add_patch(p)

def hdr(ax, x, y, w, h, text, fc, fs=11, z=4):
    box(ax, x, y, w, h, fc=fc, ec=fc, r=0.005, z=z)
    ax.text(x+w/2, y+h/2, text, fontsize=fs, fontweight='bold',
            color='white', ha='center', va='center',
            fontfamily='STHeiti', zorder=z+1)

def tx(ax, x, y, text, fs=9.5, c='#212121', ha='left', va='center',
       bold=False, z=5):
    ax.text(x, y, text, fontsize=fs, color=c, ha=ha, va=va,
            fontfamily='STHeiti', fontweight='bold' if bold else 'normal',
            zorder=z)

def arr_down(ax, x, y_top, y_bot, c='#757575', lw=1.8):
    ax.annotate('', xy=(x, y_bot+0.002), xytext=(x, y_top-0.002),
                arrowprops=dict(arrowstyle='->', color=c, lw=lw), zorder=6)

# ─── figure ─────────────────────────────────────────────────────────
fig = plt.figure(figsize=(18, 10))
fig.patch.set_facecolor('white')
ax_l = fig.add_axes([0.012, 0.01, 0.474, 0.98])
ax_r = fig.add_axes([0.516, 0.01, 0.474, 0.98])
for ax in [ax_l, ax_r]:
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')
    ax.set_facecolor('white')
fig.add_artist(plt.Line2D([0.499, 0.499], [0.01, 0.99],
               transform=fig.transFigure, color='#BDBDBD', lw=1.5))

# ════════════════════════════════════════════════════════════════════
# LEFT PANEL: CoT 五维推理链
# ════════════════════════════════════════════════════════════════════

# Column title
box(ax_l, 0.01, 0.953, 0.98, 0.040, '#F5F5F5', '#BDBDBD', r=0.010)
tx(ax_l, 0.5, 0.973, 'CoT 五维推理链  ·  LLM 逐步推导（Chain-of-Thought）',
   fs=12, c='#212121', ha='center', bold=True)

# Prompt context note bar
box(ax_l, 0.01, 0.900, 0.98, 0.044, '#FFF8E1', '#F9A825', lw=1.5, r=0.008)
tx(ax_l, 0.5, 0.922,
   '多维特征（进程溯源 · 父子进程链 · 命令行扫描）= Prompt 上下文输入，非推理步骤  ·  Agent 工具调用层规划扩展',
   fs=8.8, c='#E65100', ha='center', bold=True)

# ─── 5 CoT steps ────────────────────────────────────────────────────
# Available: y=0.018 to y=0.894  →  total=0.876
# 5 steps × 0.158h + 4 gaps × 0.012 = 0.790 + 0.048 = 0.838  →  bottom offset 0.038/2=0.019
SH = 0.158
SG = 0.012
S0 = 0.019   # y of bottom of step ⑤ (i=4, last drawn)

steps = [
    ('#1565C0', '#E3F2FD',
     '① 特征解构',
     '解析多维输入特征，提取关键行为指标  ·  建立进程行为画像',
     'e.g.  powershell.exe -EncodedCommand ABCD...  →  识别 Base64 混淆特征',
     '→ 结构化特征向量'),
    ('#1565C0', '#E3F2FD',
     '② 模式识别',
     '对比少样本历史案例，匹配已知攻击模式  ·  计算行为相似度',
     'e.g.  行为特征与案例库中 Cobalt Strike Beacon 注入特征高度匹配',
     '→ 候选攻击模式集合'),
    ('#6A1B9A', '#EDE7F6',
     '③ 因果推断',
     '溯因进程调用意图，分析父子链异常路径  ·  检测横向移动企图',
     'e.g.  WINWORD → cmd.exe → net user /add  →  Office 宏 + 账户操控',
     '→ 攻击意图置信度'),
    ('#B71C1C', '#FFEBEE',
     '④ ATT&CK 映射',
     '定位 MITRE 战术 & 技术节点  ·  输出 Technique 编号与战术阶段归类',
     'e.g.  T1059.001 PowerShell  ·  T1027 混淆  ·  TA0002 Execution  ·  TA0005 Evasion',
     '→ Technique 编号列表'),
    ('#4A148C', '#EDE7F6',
     '⑤ 综合研判  ★',
     '汇聚五维推理结论，输出风险等级评分  ·  生成处置建议指令',
     'risk_score: 0.93 (HIGH)  ·  action: KILL  ·  reason: C2信道 + 横移企图确认',
     '→ 结构化 JSON 决策输出'),
]

for i, (hc, fc, title, desc, ex, out) in enumerate(steps):
    yb = S0 + (4 - i) * (SH + SG)   # bottom y of this step
    yt = yb + SH                      # top y

    # Outer box (thicker border for ⑤)
    lw = 2.8 if i == 4 else 1.8
    box(ax_l, 0.01, yb, 0.98, SH, fc=fc, ec=hc, lw=lw, r=0.010)

    # Header bar
    hdr(ax_l, 0.01, yt - 0.034, 0.98, 0.034, title, hc, fs=11)

    # Description text
    tx(ax_l, 0.045, yt - 0.056, desc, fs=9.5, c='#212121')

    # Example box
    ey = yb + 0.065
    box(ax_l, 0.025, ey, 0.95, 0.030, 'white', hc, lw=1.0, r=0.005)
    tx(ax_l, 0.048, ey + 0.015, ex, fs=8.5, c=hc)

    # Output badge
    box(ax_l, 0.025, yb + 0.005, 0.95, 0.028, hc, hc, r=0.005, z=4)
    tx(ax_l, 0.5, yb + 0.019, out, fs=9, c='white', ha='center', bold=True)

    # Arrow to next step
    if i < 4:
        arr_down(ax_l, 0.5, yb, yb - SG)


# ════════════════════════════════════════════════════════════════════
# RIGHT PANEL: 动态少样本增强 + ATT&CK 映射输出
# ════════════════════════════════════════════════════════════════════

# Column title
box(ax_r, 0.01, 0.953, 0.98, 0.040, '#F5F5F5', '#BDBDBD', r=0.010)
tx(ax_r, 0.5, 0.973, '动态少样本增强  ·  ATT&CK 映射输出',
   fs=12, c='#212121', ha='center', bold=True)

# ─── Few-shot section  y: 0.500 → 0.945 ────────────────────────────
FS_BOT = 0.500
FS_TOP = 0.945

box(ax_r, 0.01, FS_BOT, 0.98, FS_TOP - FS_BOT, '#E8F5E9', '#2E7D32', lw=2, r=0.010)
hdr(ax_r, 0.01, FS_TOP - 0.036, 0.98, 0.036,
    '动态少样本增强  ·  历史案例库检索注入  ·  越用越准', '#2E7D32', fs=10)

# 5 horizontal mini-steps
BW, BH, BG = 0.158, 0.118, 0.018
bx0 = 0.026
by_center = FS_BOT + (FS_TOP - FS_BOT - 0.036) / 2 + FS_BOT - FS_BOT + 0.04
# center of usable area:
usable_mid = FS_BOT + (FS_TOP - 0.036 - FS_BOT) / 2
by = usable_mid - BH / 2 + 0.025   # shift slightly up

fs_items = [
    ('进程特征\n向量化',    '#C8E6C9', '#388E3C', False, 'solid'),
    ('案例库检索\nTop-K相似', '#C8E6C9', '#388E3C', False, 'solid'),
    ('Few-shot\n注入Prompt', '#A5D6A7', '#2E7D32', True,  'solid'),
    ('LLM\n推理输出',      '#C8E6C9', '#388E3C', False, 'solid'),
    ('结论写回\n[规划扩展]', '#FFF9C4', '#F9A825', False, 'dashed'),
]

for k, (label, bfc, bec, bold, ls) in enumerate(fs_items):
    bx = bx0 + k * (BW + BG)
    lw2 = 2.5 if bold else 1.5
    box(ax_r, bx, by, BW, BH, fc=bfc, ec=bec, lw=lw2, ls=ls, r=0.007)
    ax_r.text(bx + BW/2, by + BH/2, label,
              fontsize=9, ha='center', va='center',
              fontfamily='STHeiti', color='#1B5E20',
              fontweight='bold' if bold else 'normal', zorder=5)
    # Right arrow
    if k < 4:
        ax_bx = bx + BW + BG/2
        ax_r.annotate('', xy=(ax_bx + 0.001, by + BH/2),
                      xytext=(ax_bx - 0.001, by + BH/2),
                      arrowprops=dict(arrowstyle='->', color='#388E3C', lw=1.5), zorder=6)

# Feedback arc: step5 bottom → step2 bottom
fb_x1 = bx0 + 4 * (BW + BG) + BW/2   # center of step 5
fb_x2 = bx0 + 1 * (BW + BG) + BW/2   # center of step 2
ax_r.annotate('', xy=(fb_x2, by),
              xytext=(fb_x1, by),
              arrowprops=dict(arrowstyle='->', color='#F9A825', lw=1.8,
                              connectionstyle='arc3,rad=-0.45'), zorder=6)
tx(ax_r, 0.5, FS_BOT + 0.055, '案例反馈积累（□ 持久化积累 — 规划扩展）',
   fs=8.5, c='#F9A825', ha='center', bold=True)

# ─── ATT&CK output section  y: 0.010 → 0.493 ───────────────────────
AT_BOT = 0.010
AT_TOP = 0.493

box(ax_r, 0.01, AT_BOT, 0.98, AT_TOP - AT_BOT, '#FFEBEE', '#B71C1C', lw=2, r=0.010)
hdr(ax_r, 0.01, AT_TOP - 0.036, 0.98, 0.036,
    'ATT&CK 映射输出  ·  结构化决策结果', '#B71C1C', fs=10)

# Technique grid (2 cols × 3 rows)
TW = 0.455
TH = 0.050
TG = 0.008
tx0 = 0.022
ty0 = AT_TOP - 0.044   # top of grid (just below header, moving downward)

techs = [
    ('T1059.001', 'PowerShell 脚本执行', False),
    ('T1027',     '混淆文件 / 信息',     False),
    ('T1055',     '进程注入',            False),
    ('T1047',     'WMI 命令执行',        False),
    ('TA0002',    'Execution 阶段',      True),
    ('TA0005',    'Defense Evasion',     True),
]

for k, (tid, tname, is_tactic) in enumerate(techs):
    row, col = divmod(k, 2)
    tbx = tx0 + col * (TW + TG)
    tby = ty0 - row * (TH + TG) - TH   # bottom of this cell
    bfc = '#EF9A9A' if is_tactic else '#FFCDD2'
    box(ax_r, tbx, tby, TW, TH, fc=bfc, ec='#B71C1C', lw=1.2, r=0.005)
    tx(ax_r, tbx + 0.008, tby + TH/2, tid, fs=9, c='#B71C1C', bold=True)
    tx(ax_r, tbx + 0.118, tby + TH/2, tname, fs=9, c='#212121')

# Grid bottom y
grid_bot = ty0 - 3 * (TH + TG) - TH   # bottom of row 2

# Structured output fields
FH = 0.038
FG = 0.007
fy0 = grid_bot - 0.012  # top of first field

fields = [
    ('risk_score:', '0.93  (HIGH)',
     '#F48FB1', '#880E4F'),
    ('action:',
     'KILL  →  ZwTerminateProcess(PID)',
     '#F48FB1', '#880E4F'),
    ('attck:',
     '[T1059.001, T1027, T1055, TA0002, TA0005]',
     '#FCE4EC', '#880E4F'),
    ('reason:',
     'Office宏 → cmd → net user  |  C2信道 + 横移企图  |  置信度 0.93',
     '#FCE4EC', '#880E4F'),
]

for k, (key, val, bfc, bec) in enumerate(fields):
    fy = fy0 - k * (FH + FG) - FH   # bottom of this field
    box(ax_r, 0.022, fy, 0.956, FH, fc=bfc, ec=bec, lw=1.2, r=0.005)
    tx(ax_r, 0.040, fy + FH/2, key, fs=9.5, c=bec, bold=True)
    tx(ax_r, 0.168, fy + FH/2, val, fs=9.0, c='#212121')

# ZwTerminateProcess bar
zw_bot = fy0 - 4 * (FH + FG) - FH - 0.008
box(ax_r, 0.022, zw_bot, 0.956, 0.040, '#EF9A9A', '#880E4F', lw=2.2, r=0.006)
tx(ax_r, 0.5, zw_bot + 0.020,
   'ZwTerminateProcess(PID)  →  内核强制终止  [★ 已实现]',
   fs=10, c='#880E4F', ha='center', bold=True)

# ─── Save ───────────────────────────────────────────────────────────
out_path = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture/layer2_cot_detail.png'
plt.savefig(out_path, dpi=180, bbox_inches='tight', facecolor='white')
plt.close()
print('Saved:', out_path)
