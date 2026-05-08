import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import matplotlib.patheffects as pe
import numpy as np

# ── Palette ───────────────────────────────────────────────────────
BLUE   = '#1565C0'; BL  = '#E3F2FD'; BM  = '#64B5F6'
PURPLE = '#6A1B9A'; PL  = '#F3E5F5'; PM  = '#AB47BC'
TEAL   = '#00695C'; TL  = '#E0F2F1'; TM  = '#4DB6AC'
GREEN  = '#2E7D32'; GL  = '#E8F5E9'
RED    = '#B71C1C'; RL  = '#FFEBEE'
ORANGE = '#E65100'; OL  = '#FFF3E0'
DARK   = '#212121'; MID = '#546E7A'; WHITE = '#FFFFFF'

W, H = 19.2, 10.8   # 16:9 canvas inches

def new_canvas():
    fig, ax = plt.subplots(figsize=(W, H))
    ax.set_xlim(0, W); ax.set_ylim(0, H)
    ax.axis('off')
    fig.patch.set_facecolor(WHITE)
    return fig, ax

def card(ax, x, y, w, h, title, ac, lc, fs=15, zorder=2):
    """Card with colored header bar"""
    # shadow
    ax.add_patch(FancyBboxPatch((x+.06, y-.06), w, h,
        boxstyle="round,pad=.15", facecolor='#CCCCCC',
        edgecolor='none', zorder=zorder-1, alpha=.45))
    # body
    ax.add_patch(FancyBboxPatch((x, y), w, h,
        boxstyle="round,pad=.12", facecolor=lc,
        edgecolor=ac, linewidth=2.8, zorder=zorder))
    # header
    ax.add_patch(FancyBboxPatch((x, y+h-.65), w, .65,
        boxstyle="round,pad=.05", facecolor=ac,
        edgecolor='none', zorder=zorder+1))
    ax.text(x+w/2, y+h-.32, title, fontsize=fs, fontweight='bold',
            color=WHITE, ha='center', va='center',
            fontfamily='STHeiti', zorder=zorder+2)

def box(ax, x, y, w, h, title, sub, fc, ec, tfs=12, sfs=9.5, zorder=4):
    ax.add_patch(FancyBboxPatch((x, y), w, h,
        boxstyle="round,pad=.1", facecolor=fc,
        edgecolor=ec, linewidth=2, zorder=zorder))
    ty = y+h*.64 if sub else y+h/2
    ax.text(x+w/2, ty, title, fontsize=tfs, fontweight='bold',
            color=ec, ha='center', va='center',
            fontfamily='STHeiti', zorder=zorder+1)
    if sub:
        ax.text(x+w/2, y+h*.28, sub, fontsize=sfs, color=MID,
                ha='center', va='center',
                fontfamily='STHeiti', zorder=zorder+1)

def arrow(ax, x1, y1, x2, y2, col, lw=2.2, ls='solid', rad=0):
    cs = f'arc3,rad={rad}' if rad else 'arc3,rad=0'
    ax.annotate('', xy=(x2,y2), xytext=(x1,y1),
        arrowprops=dict(arrowstyle='->', color=col, lw=lw,
                       linestyle=ls, connectionstyle=cs,
                       path_effects=[pe.withStroke(linewidth=lw+2.5,
                           foreground='white')]))

def label_between(ax, x, y, txt, col, fs=10.5):
    ax.text(x, y, txt, fontsize=fs, fontweight='bold', color=col,
            ha='center', fontfamily='STHeiti',
            bbox=dict(boxstyle='round,pad=.3', facecolor='white',
                      edgecolor=col, linewidth=1.5))

# ══════════════════════════════════════════════════════════════════
# PAGE 1 — 三层架构总览
# ══════════════════════════════════════════════════════════════════
def page1():
    fig, ax = new_canvas()

    # title
    ax.text(W/2, 10.45, '安全分析引擎  ·  三层处置架构',
            fontsize=27, fontweight='bold', color=DARK,
            ha='center', fontfamily='STHeiti')
    ax.text(W/2, 9.88, '三级过滤流水线  →  LLM 深度研判  →  响应与可视化',
            fontsize=13, color=MID, ha='center', fontfamily='STHeiti')

    # ── Trigger ──
    ax.add_patch(FancyBboxPatch((.4, 8.9), 3.4, .72,
        boxstyle="round,pad=.1", facecolor=OL,
        edgecolor=ORANGE, linewidth=2.2, zorder=3))
    ax.text(2.1, 9.26, '进程创建事件触发', fontsize=13,
            fontweight='bold', color=ORANGE, ha='center',
            fontfamily='STHeiti', zorder=4)
    arrow(ax, 2.1, 8.9, 2.1, 8.56, ORANGE, lw=2.5)

    # ── LAYER 1 ──
    card(ax, .4, 6.1, 18.4, 2.35, '第一层：快速过滤  ·  进程行为图谱', BLUE, BL, fs=16)

    box(ax, .7,  6.3, 3.6, 1.75, 'L1  白名单核查',
        '系统进程 / 可信签名\n→ 直接放行（~95%）', GL, GREEN)
    arrow(ax, 4.3, 7.17, 4.8, 7.17, MID)
    ax.text(4.55, 7.42, '未命中', fontsize=9, color=MID,
            ha='center', fontfamily='STHeiti')

    box(ax, 4.85, 6.3, 3.6, 1.75, 'L2  规则引擎',
        '父进程 / 命令行 / 路径\n行为规则匹配过滤', BL, BLUE)
    arrow(ax, 8.45, 7.17, 8.95, 7.17, MID)
    ax.text(8.7, 7.42, '规则\n不确定', fontsize=9, color=MID,
            ha='center', fontfamily='STHeiti')

    box(ax, 9.0, 6.3, 3.6, 1.75, 'L3  → 送入 LLM',
        '语义模糊 / 新型攻击\n规则无法判定 → LLM', RL, RED)

    # process tree (right)
    ax.text(14.6, 8.2, '进程行为图谱  ·  父子关系链路', fontsize=12,
            fontweight='bold', color=BLUE, ha='center', fontfamily='STHeiti')
    nodes = [(13.4,7.7,'explorer.exe',MID),
             (12.6,7.2,'notepad.exe [正常]','#2E7D32'),
             (14.5,7.2,'cmd.exe  [警告]',ORANGE),
             (14.5,6.65,'powershell -enc  🔴',RED)]
    for nx,ny,nl,nc in nodes:
        ax.text(nx,ny,nl,fontsize=10.5,color=nc,fontweight='bold',
                fontfamily='STHeiti')
    ax.plot([13.6,12.7,12.7],[7.67,7.67,7.28],color=MID,lw=1.3)
    ax.plot([13.6,14.6,14.6],[7.67,7.67,7.28],color=ORANGE,lw=1.8)
    ax.plot([14.6,14.6],[7.18,6.73],color=RED,lw=2,linestyle='--')

    # risk score badge
    ax.add_patch(FancyBboxPatch((16.4, 6.3), 2.2, 1.75,
        boxstyle="round,pad=.1", facecolor=RL,
        edgecolor=RED, linewidth=2.2, zorder=3))
    ax.text(17.5, 7.75, '链路风险评分', fontsize=11, fontweight='bold',
            color=RED, ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(17.5, 7.38, 'cmd.exe', fontsize=10, color=MID,
            ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(17.5, 7.02, '87 / 100', fontsize=16, fontweight='bold',
            color=RED, ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(17.5, 6.65, '→ 进入 L3 LLM', fontsize=9.5, color='#880E4F',
            ha='center', fontfamily='STHeiti', zorder=4)

    # ── Arrow 1→2 ──
    arrow(ax, W/2, 6.1, W/2, 5.62, PURPLE, lw=3.5)
    label_between(ax, W/2+1.8, 5.86, '可疑进程  ·  规则无法判定', PURPLE, fs=11)

    # ── LAYER 2 ──
    card(ax, .4, 3.2, 18.4, 2.35, '第二层：LLM 深度研判  ★  （核心创新层）', PURPLE, PL, fs=16)

    cot = ['① 进程溯源','② 父子进程链','③ 命令行扫描','④ ATT&CK映射','⑤ 综合研判']
    cols = [BM, BM, PM, '#EF9A9A', PURPLE]
    for i,(s,c) in enumerate(zip(cot,cols)):
        sx = .7 + i*2.9
        box(ax, sx, 3.4, 2.7, 1.75, s, None, PL, c, tfs=12)
        if i<4:
            arrow(ax, sx+2.7, 4.28, sx+2.9, 4.28, PURPLE)

    # few-shot
    ax.add_patch(FancyBboxPatch((15.5, 3.4), 3.1, 1.75,
        boxstyle="round,pad=.1", facecolor=GL,
        edgecolor=GREEN, linewidth=2, linestyle='--', zorder=3))
    ax.text(17.05, 4.85, '动态少样本增强', fontsize=11, fontweight='bold',
            color=GREEN, ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(17.05, 4.52, '历史案例库检索', fontsize=10, color=MID,
            ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(17.05, 4.22, '相似攻击样本注入', fontsize=10, color=MID,
            ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(17.05, 3.9, '越用越准 +ACC', fontsize=10, fontweight='bold',
            color=GREEN, ha='center', fontfamily='STHeiti', zorder=4)
    arrow(ax, 15.5, 4.28, 14.1, 4.28, GREEN, lw=1.8, ls='dashed')

    # ── Arrow 2→3 ──
    arrow(ax, W/2, 3.2, W/2, 2.72, TEAL, lw=3.5)
    label_between(ax, W/2+2.0, 2.96, '风险评分  +  ATT&CK 编号', TEAL, fs=11)

    # ── LAYER 3 ──
    card(ax, .4, .45, 18.4, 2.2, '第三层：响应与可视化', TEAL, TL, fs=16)
    resp = [('实时告警推送','WebSocket :9527\n前端即时展示'),
            ('手动/自动拦截','ZwTerminateProcess\n内核级强制终止'),
            ('ATT&CK 热力图','攻击技术矩阵\n可视化展示'),
            ('Playbook 生成','标准化响应流程\n自动生成报告'),
            ('少样本库积累','越用越准\n持续优化研判')]
    for i,(t,s) in enumerate(resp):
        box(ax, .7+i*3.7, .65, 3.4, 1.6, t, s, TL, TEAL)

    plt.tight_layout(pad=0)
    out = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture/defense_p1_overview.png'
    plt.savefig(out, dpi=180, bbox_inches='tight', facecolor=WHITE)
    plt.close(); print('✓', out)

# ══════════════════════════════════════════════════════════════════
# PAGE 2 — 第一层详解：三级流水线 + 进程行为图谱
# ══════════════════════════════════════════════════════════════════
def page2():
    fig, ax = new_canvas()

    ax.text(W/2, 10.45, '第一层详解：三级分析流水线  ·  进程行为图谱',
            fontsize=24, fontweight='bold', color=DARK,
            ha='center', fontfamily='STHeiti')
    ax.text(W/2, 9.88, '绝大多数正常进程在 L1/L2 快速放行，仅模糊案例进入 L3 LLM',
            fontsize=13, color=MID, ha='center', fontfamily='STHeiti')

    # ── Left: Pipeline ──
    card(ax, .4, .4, 10.8, 9.2, 'L1 → L2 → L3  三级分析流水线', BLUE, BL, fs=15)

    # L1
    ax.add_patch(FancyBboxPatch((.7, 7.15), 10.2, 1.95,
        boxstyle="round,pad=.1", facecolor=GL, edgecolor=GREEN, linewidth=2.2, zorder=3))
    ax.text(5.8, 8.78, 'L1  白名单核查', fontsize=14, fontweight='bold',
            color=GREEN, ha='center', fontfamily='STHeiti', zorder=4)
    checks = ['Windows 系统进程 (svchost / lsass / …)',
              '微软数字签名验证通过',
              '路径在系统白名单目录内']
    for i,c in enumerate(checks):
        ax.text(1.1, 8.42-i*.33, f'  ✓  {c}', fontsize=11, color=GREEN,
                fontfamily='STHeiti', zorder=4)
    ax.add_patch(FancyBboxPatch((7.6, 7.35), 3.0, .88,
        boxstyle="round,pad=.08", facecolor=GL, edgecolor=GREEN, linewidth=2, zorder=4))
    ax.text(9.1, 7.8, '→ 直接放行 (~95%)', fontsize=11, fontweight='bold',
            color=GREEN, ha='center', fontfamily='STHeiti', zorder=5)

    arrow(ax, 5.8, 7.15, 5.8, 6.72, BLUE, lw=2.8)
    label_between(ax, 5.8, 6.94, '未命中白名单', BLUE, fs=10)

    # L2
    ax.add_patch(FancyBboxPatch((.7, 4.85), 10.2, 1.75,
        boxstyle="round,pad=.1", facecolor=BL, edgecolor=BLUE, linewidth=2.2, zorder=3))
    ax.text(5.8, 6.3, 'L2  规则引擎', fontsize=14, fontweight='bold',
            color=BLUE, ha='center', fontfamily='STHeiti', zorder=4)
    rules = [('父进程异常','Word.exe 启动 cmd.exe'),
             ('命令行特征','包含 -enc / -nop / IEX 等'),
             ('路径异常','从 Temp/AppData 运行'),
             ('权限提升','非预期的权限请求')]
    for i,(rt,rv) in enumerate(rules):
        col_i = i%2
        bx = 1.0 + (i%2)*4.8
        by = 5.82 - (i//2)*.55
        ax.text(bx, by, f'• {rt}：', fontsize=10.5, color=BLUE,
                fontweight='bold', fontfamily='STHeiti', zorder=4)
        ax.text(bx+1.6, by, rv, fontsize=10.5, color=MID,
                fontfamily='STHeiti', zorder=4)

    arrow(ax, 5.8, 4.85, 5.8, 4.42, RED, lw=2.8)
    label_between(ax, 5.8, 4.64, '规则不确定 / 无法判定', RED, fs=10)

    # L3
    ax.add_patch(FancyBboxPatch((.7, 2.5), 10.2, 1.75,
        boxstyle="round,pad=.1", facecolor=RL, edgecolor=RED, linewidth=2.5, zorder=3))
    ax.text(5.8, 3.95, 'L3  → 送入 LLM 深度研判', fontsize=14, fontweight='bold',
            color=RED, ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(5.8, 3.55, '进程信息 JSON 封装  →  发送 Python 推理服务',
            fontsize=11, color=MID, ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(5.8, 3.18, '触发 CoT 五维分析  ·  输出 <risk_score> + <action>',
            fontsize=11, color=RED, ha='center', fontfamily='STHeiti', zorder=4)
    ax.text(5.8, 2.78, '预计首 Token 延迟 < 500ms  ·  完整研判 ~3s',
            fontsize=11, color=MID, ha='center', fontfamily='STHeiti', zorder=4)

    # throughput bar
    ax.add_patch(FancyBboxPatch((.7, .6), 10.2, 1.65,
        boxstyle="round,pad=.1", facecolor='#F9FBE7', edgecolor='#9E9D24',
        linewidth=1.8, zorder=3))
    ax.text(5.8, 1.9, '过滤效率示意', fontsize=12, fontweight='bold',
            color='#827717', ha='center', fontfamily='STHeiti', zorder=4)
    # bar chart (simple)
    bars = [('所有进程\n(100%)', 9.6, '#90CAF9'),
            ('L2审查\n(~20%)', 3.2, BM),
            ('L3→LLM\n(~5%)', 0.8, '#EF9A9A')]
    for i,(lbl,bw,col) in enumerate(bars):
        bx = 1.2 + i*3.2
        ax.add_patch(FancyBboxPatch((bx, .75), bw, .78,
            boxstyle="square,pad=0", facecolor=col,
            edgecolor='none', zorder=4))
        ax.text(bx+bw/2, 1.6, lbl, fontsize=9.5, color=MID,
                ha='center', fontfamily='STHeiti', zorder=5)

    # ── Right: Process Behavior Graph ──
    card(ax, 11.7, .4, 7.1, 9.2, '进程行为图谱  ·  父子关系链路', BLUE, BL, fs=15)

    # tree
    ax.text(15.25, 9.1, '示例：Word 启动 PowerShell 攻击链', fontsize=11,
            color=MID, ha='center', fontfamily='STHeiti')

    tree_nodes = [
        (15.25, 8.4, 'System (PID 4)', MID, 11, False),
        (15.25, 7.7, 'explorer.exe (PID 3421)', MID, 11, False),
        (13.4,  6.9, 'WINWORD.EXE (PID 6012)', BLUE, 11, False),
        (17.1,  6.9, 'chrome.exe  [正常]', GREEN, 11, False),
        (13.4,  6.1, 'cmd.exe  [警告]  (PID 7834)', ORANGE, 12, True),
        (13.4,  5.2, 'powershell.exe  [危险] (PID 8901)', RED, 12, True),
        (13.4,  4.3, '-EncodedCommand BASE64PAYLOAD...', RED, 10, True),
    ]
    for nx,ny,nl,nc,nf,bold in tree_nodes:
        ax.text(nx, ny, nl, fontsize=nf, color=nc,
                fontweight='bold' if bold else 'normal',
                fontfamily='STHeiti')

    # tree lines
    ax.plot([15.25,15.25],[8.35,7.78],color=MID,lw=1.5)
    ax.plot([15.25,13.5,13.5],[7.7,7.7,6.98],color=BLUE,lw=1.5)
    ax.plot([15.25,17.1,17.1],[7.7,7.7,6.98],color=GREEN,lw=1.5)
    ax.plot([13.5,13.5],[6.88,6.18],color=ORANGE,lw=2)
    ax.plot([13.5,13.5],[6.08,5.28],color=RED,lw=2.5,linestyle='--')
    ax.plot([13.5,13.5],[5.18,4.38],color=RED,lw=2.5,linestyle='--')

    # risk annotation boxes
    risks = [(13.4, 6.05, '风险分: 62', ORANGE),
             (13.4, 5.12, '风险分: 91', RED),
             (13.4, 4.22, '风险分: 97 → 触发 L3', RED)]
    for rx,ry,rt,rc in risks:
        ax.text(rx+2.9, ry, rt, fontsize=10, color=rc, fontweight='bold',
                fontfamily='STHeiti',
                bbox=dict(boxstyle='round,pad=.25', facecolor='white',
                          edgecolor=rc, linewidth=1.5))

    # link risk score formula
    ax.add_patch(FancyBboxPatch((11.9, .6), 6.7, 2.75,
        boxstyle="round,pad=.12", facecolor=RL,
        edgecolor=RED, linewidth=2, zorder=3))
    ax.text(15.25, 3.08, '链路风险评分  =  Σ  节点权重 × 链路深度因子',
            fontsize=12, fontweight='bold', color=RED,
            ha='center', fontfamily='STHeiti', zorder=4)
    details = ['• 节点权重：进程类型 / 签名状态 / 路径评分',
               '• 深度因子：链路层数越深、风险系数越高',
               '• 超过阈值 → 整条链路标记为高危 → 进入 L3']
    for i,d in enumerate(details):
        ax.text(12.1, 2.62-i*.5, d, fontsize=10.5, color=MID,
                fontfamily='STHeiti', zorder=4)

    plt.tight_layout(pad=0)
    out = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture/defense_p2_layer1.png'
    plt.savefig(out, dpi=180, bbox_inches='tight', facecolor=WHITE)
    plt.close(); print('✓', out)

# ══════════════════════════════════════════════════════════════════
# PAGE 3 — 第二三层详解：CoT + 少样本增强 + 响应处置
# ══════════════════════════════════════════════════════════════════
def page3():
    fig, ax = new_canvas()

    ax.text(W/2, 10.45, '第二层  ·  第三层详解：LLM 研判  +  响应处置',
            fontsize=24, fontweight='bold', color=DARK,
            ha='center', fontfamily='STHeiti')

    # ── CoT 5-dim (top 60%) ──
    card(ax, .4, 4.2, 18.4, 5.85, '第二层：CoT 五维分析  ·  动态少样本增强', PURPLE, PL, fs=16)

    cot_data = [
        ('① 进程溯源', '追踪进程的完整\n创建链路来源\n识别异常父进程', BM),
        ('② 父子进程链', '构建 N 层父子\n关系调用树\n识别异常嵌套', BM),
        ('③ 命令行扫描', '扫描命令行参数\n-enc / -nop / IEX\n混淆特征识别', PM),
        ('④ ATT&CK 映射', '对齐 MITRE 框架\n提取技术编号\nTxxxx 标注', '#EF9A9A'),
        ('⑤ 综合研判', '整合四维结论\n输出风险评分\n决定处置动作', PURPLE),
    ]
    for i,(title,desc,col) in enumerate(cot_data):
        cx = .7 + i*3.05
        # box
        ax.add_patch(FancyBboxPatch((cx, 6.5), 2.8, 3.2,
            boxstyle="round,pad=.12", facecolor=PL,
            edgecolor=col, linewidth=2.5, zorder=3))
        # number circle
        circle = plt.Circle((cx+1.4, 9.35), .38, color=col, zorder=4)
        ax.add_patch(circle)
        ax.text(cx+1.4, 9.35, title[:1]+title[1], fontsize=13,
                fontweight='bold', color=WHITE,
                ha='center', va='center', fontfamily='STHeiti', zorder=5)
        ax.text(cx+1.4, 8.78, title[3:], fontsize=13, fontweight='bold',
                color=col, ha='center', fontfamily='STHeiti', zorder=4)
        ax.text(cx+1.4, 8.08, desc, fontsize=10.5, color=MID,
                ha='center', va='center', fontfamily='STHeiti',
                linespacing=1.5, zorder=4)
        # arrow between steps
        if i < 4:
            arrow(ax, cx+2.8, 8.1, cx+3.05, 8.1, PURPLE, lw=2.2)

    # few-shot panel
    ax.add_patch(FancyBboxPatch((.7, 4.45), 18.0, 1.82,
        boxstyle="round,pad=.12", facecolor=GL,
        edgecolor=GREEN, linewidth=2.2, linestyle='--', zorder=3))
    ax.text(9.7, 6.0, '动态少样本增强机制', fontsize=13, fontweight='bold',
            color=GREEN, ha='center', fontfamily='STHeiti', zorder=4)

    steps_fs = [
        ('新进程信息输入', '1.1', BLUE),
        ('历史案例库检索\n(语义相似度)', '1.1', BLUE),
        ('Top-K 相似案例\n注入 Prompt', '1.1', PURPLE),
        ('LLM 参考样本\n输出更精准', '1.1', PURPLE),
        ('结论写回案例库\n持续积累', '1.1', GREEN),
    ]
    for i,(s,_,c) in enumerate(steps_fs):
        sx = 1.2 + i*3.6
        ax.add_patch(FancyBboxPatch((sx, 4.62), 3.2, 1.18,
            boxstyle="round,pad=.08", facecolor=WHITE,
            edgecolor=c, linewidth=1.8, zorder=4))
        ax.text(sx+1.6, 5.22, s, fontsize=10.5, color=c, fontweight='bold',
                ha='center', va='center', fontfamily='STHeiti', zorder=5)
        if i < 4:
            arrow(ax, sx+3.2, 5.22, sx+3.6, 5.22, c, lw=1.8)

    ax.text(19.0, 5.22, '越用越准 +ACC', fontsize=11, fontweight='bold',
            color=GREEN, ha='right', fontfamily='STHeiti', zorder=4)

    # output tags
    ax.add_patch(FancyBboxPatch((.4, 3.65), 18.4, .42,
        boxstyle="round,pad=.06", facecolor=RL,
        edgecolor=RED, linewidth=1.8, zorder=3))
    ax.text(W/2, 3.86,
            '输出：<risk_score>87</risk_score>  ·  <action>block</action>  '
            '·  ATT&CK T1059.001  ·  完整 CoT 分析报告',
            fontsize=12, fontweight='bold', color=RED,
            ha='center', fontfamily='STHeiti', zorder=4)

    arrow(ax, W/2, 3.65, W/2, 3.22, TEAL, lw=3.2)
    label_between(ax, W/2+2.2, 3.43, '风险评分 + ATT&CK 编号 → 第三层', TEAL, fs=10.5)

    # ── Layer 3 (bottom) ──
    card(ax, .4, .35, 18.4, 2.75, '第三层：响应与可视化', TEAL, TL, fs=16)

    resp3 = [
        ('实时告警推送', 'WebSocket :9527\n前端毫秒级展示', TL, TEAL),
        ('ZwTerminateProcess', '内核级强制终止\nPatchGuard 合规', RL, RED),
        ('ATT&CK 热力图', 'T-编号可视化\n攻击面全景展示', BL, BLUE),
        ('自动 Playbook', '标准化响应流程\n一键生成报告', GL, GREEN),
        ('少样本库积累', '案例持久化存储\n模型自主进化', PL, PURPLE),
    ]
    for i,(t,s,lc,ec) in enumerate(resp3):
        box(ax, .65+i*3.72, .55, 3.5, 2.1, t, s, lc, ec, tfs=12, sfs=10)

    plt.tight_layout(pad=0)
    out = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture/defense_p3_layer23.png'
    plt.savefig(out, dpi=180, bbox_inches='tight', facecolor=WHITE)
    plt.close(); print('✓', out)

# run
page1()
page2()
page3()
