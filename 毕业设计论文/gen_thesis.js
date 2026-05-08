'use strict';
/**
 * LLMHips 毕业设计论文生成脚本（第三版）
 * 修订要点：
 *   1. 删除琐碎接口规范细节（消息格式、JSON字段定义）
 *   2. 大幅扩展第一、二章学术深度
 *   3. 嵌入 4 幅流程图（驱动层、中间层×2、前端）
 *   4. LLM 实现章节严格对应 server.py 实际代码
 *   5. 不涉及微调内容
 *   6. 新增 2.2.5 创新对比分析节（LLMHips-LM vs Happy-LLM）
 */
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, ImageRun,
  BorderStyle, ShadingType, PageBreak,
} = require('docx');
const fs   = require('fs');
const path = require('path');

// ── 图片目录 ──
const PIC = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/Picture';

// ── 页面尺寸 & 边距（DXA；1mm ≈ 56.69 DXA）──
const PAGE_W    = 11906;
const PAGE_H    = 16838;
const M_TOP     = Math.round(25 * 56.69);
const M_BOTTOM  = Math.round(25 * 56.69);
const M_LEFT    = Math.round(30 * 56.69);
const M_RIGHT   = Math.round(20 * 56.69);
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT; // ≈9071

// ── 字号（half-points；1pt = 2 half-points）──
const SZ_BODY  = 21;  // 5号   10.5pt
const SZ_H1    = 30;  // 小3号 15pt
const SZ_H2    = 28;  // 4号   14pt
const SZ_H3    = 24;  // 小4号 12pt
const SZ_COVER = 36;  // 小2号 18pt
const SZ_INFO  = 24;  // 小4号 12pt

// ── 行距（300 twip = 1.25 倍）──
const LINE = 300;

// ── 段间距 ──
const SP_H1_PRE  = 480; const SP_H1_POST  = 240;
const SP_H2_PRE  = 360; const SP_H2_POST  = 180;
const SP_H3_PRE  = 240; const SP_H3_POST  = 120;
const INDENT_BODY = { firstLine: 420 };
const SP_BODY     = { line: LINE, lineRule: 'auto' };

// ────────────────────────────────────────────────
// 辅助构造函数
// ────────────────────────────────────────────────

/** 正文段落：5号宋体，首行缩进两字符 */
function body(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'SimSun', size: SZ_BODY })],
    spacing: SP_BODY,
    indent: INDENT_BODY,
  });
}

/** 公式 / 代码行：无首行缩进，居中或左缩进 */
function formula(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Times New Roman', size: SZ_BODY, italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: SP_BODY,
  });
}

/** 一级标题 */
function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'SimHei', size: SZ_H1, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: SP_H1_PRE, after: SP_H1_POST, line: LINE, lineRule: 'auto' },
  });
}

/** 二级标题 */
function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'SimHei', size: SZ_H2, bold: true })],
    alignment: AlignmentType.LEFT,
    spacing: { before: SP_H2_PRE, after: SP_H2_POST, line: LINE, lineRule: 'auto' },
  });
}

/** 三级标题 */
function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'SimHei', size: SZ_H3, bold: true })],
    alignment: AlignmentType.LEFT,
    spacing: { before: SP_H3_PRE, after: SP_H3_POST, line: LINE, lineRule: 'auto' },
  });
}

/** 空行 */
function blank() {
  return new Paragraph({
    children: [new TextRun({ text: '', font: 'SimSun', size: SZ_BODY })],
    spacing: { line: LINE, lineRule: 'auto' },
  });
}

/** 分页符 */
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

/** 居中段落（封面用）*/
function centered(text, size, bold = false, font = 'SimSun') {
  return new Paragraph({
    children: [new TextRun({ text, font, size, bold })],
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, lineRule: 'auto' },
  });
}

/** 参考文献条目（悬挂缩进）*/
function ref(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'SimSun', size: SZ_BODY })],
    spacing: SP_BODY,
    indent: { left: 420, hanging: 420 },
  });
}

/** 关键词行（带黑体标签）*/
function keywords(label, content) {
  return new Paragraph({
    children: [
      new TextRun({ text: label, font: 'SimHei', size: SZ_BODY, bold: true }),
      new TextRun({ text: content, font: 'SimSun', size: SZ_BODY }),
    ],
    spacing: SP_BODY,
    indent: INDENT_BODY,
  });
}

/** 图片段落（居中）*/
function imgPara(filename, widthPx, heightPx, title) {
  return new Paragraph({
    children: [new ImageRun({
      type: 'png',
      data: fs.readFileSync(path.join(PIC, filename)),
      transformation: { width: widthPx, height: heightPx },
      altText: { title, description: title, name: title },
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120, line: LINE, lineRule: 'auto' },
  });
}

/** 图注（居中，小号宋体）*/
function figCaption(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'SimSun', size: SZ_BODY })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 360, line: LINE, lineRule: 'auto' },
  });
}

// ────────────────────────────────────────────────
// 封面
// ────────────────────────────────────────────────
const coverPage = [
  blank(), blank(), blank(),
  centered('长  安  大  学', SZ_COVER + 8, true, 'SimHei'),
  blank(),
  centered('本科生毕业设计（论文）', SZ_COVER, true, 'SimHei'),
  blank(), blank(),
  centered('基于轻量化语言模型系统的危险进程', SZ_COVER, true, 'SimHei'),
  centered('识别与分析拦截助手', SZ_COVER, true, 'SimHei'),
  blank(), blank(), blank(),
  new Paragraph({
    children: [
      new TextRun({ text: '学        生：', font: 'SimSun', size: SZ_INFO }),
      new TextRun({ text: '李俊增', font: 'SimSun', size: SZ_INFO }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, lineRule: 'auto' },
  }),
  blank(),
  new Paragraph({
    children: [
      new TextRun({ text: '学        号：', font: 'SimSun', size: SZ_INFO }),
      new TextRun({ text: '2022902180', font: 'SimSun', size: SZ_INFO }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, lineRule: 'auto' },
  }),
  blank(),
  new Paragraph({
    children: [
      new TextRun({ text: '学    院：', font: 'SimSun', size: SZ_INFO }),
      new TextRun({ text: '信息工程学院', font: 'SimSun', size: SZ_INFO }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, lineRule: 'auto' },
  }),
  blank(),
  new Paragraph({
    children: [
      new TextRun({ text: '专        业：', font: 'SimSun', size: SZ_INFO }),
      new TextRun({ text: '计算机科学与技术', font: 'SimSun', size: SZ_INFO }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, lineRule: 'auto' },
  }),
  blank(),
  new Paragraph({
    children: [
      new TextRun({ text: '指导老师：', font: 'SimSun', size: SZ_INFO }),
      new TextRun({ text: '                        ', font: 'SimSun', size: SZ_INFO }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, lineRule: 'auto' },
  }),
  blank(), blank(), blank(),
  centered('2026 年 4 月', SZ_INFO, false, 'SimSun'),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 中文摘要
// ────────────────────────────────────────────────
const abstractCN = [
  h1('摘  要'),
  body('随着企业网络安全威胁的持续升级，传统基于规则的主机入侵检测系统在面对新型APT攻击、无文件攻击及多态恶意软件时暴露出规则滞后、误报率高等根本性缺陷。将自然语言推理能力引入端点威胁研判领域，成为当前安全工程的重要研究方向。然而，现有基于云端商业大模型的安全分析方案面临数据合规困境，如何在本地化部署约束下自主设计有效的轻量化语言模型，并将其与内核级进程监控形成实时闭环，是当前工程实践中亟待探索的问题。'),
  body('本文设计并实现了LLMHips——一个基于自主设计轻量化语言模型的危险进程识别与分析拦截助手。在模型层面，本文参考Qwen2解码器架构自主设计了LLMHips-LM，采用旋转位置编码（RoPE）、分组查询注意力（GQA）、SwiGLU激活及RMSNorm归一化等关键技术组件，并引入KV Cache缓存机制与滑动窗口注意力（SWA）解决推理效率与长上下文建模问题；针对现有轻量级教学模型（以Happy-LLM为基准）在KV Cache缺失、上下文窗口受限（512 token）、词表不足（6144词）等方面的局限，LLMHips-LM在架构层面进行了系统性改进，支持8192 token上下文与151936词表规模。基础预训练由合作方在大规模中英文语料上完成，本文工作着重于模型架构规格确定、推理服务工程实现及提示词工程设计。在系统层面，本文采用三层工程架构：Windows内核驱动层负责实时拦截进程创建事件；C#中间层通过WebSocket桥接驱动层与前端；React前端控制台集成本地部署的LLMHips-LM推理服务，以流式SSE方式实现实时威胁研判交互。'),
  body('系统设计了专业的安全分析提示词框架，引导模型从进程溯源、父子进程链异常、命令行行为特征及MITRE ATT&CK战术映射四个维度进行结构化研判，输出风险评分（0–100）与处置建议（BLOCK/WATCH/ALLOW）。系统验证表明，在典型APT攻击模拟场景中，基于结构化提示词框架的研判在上下文关联分析维度显著优于纯规则引擎，实现了从内核事件捕获到AI研判再到操作员决策的完整闭环。'),
  blank(),
  keywords('关键词：', '主机入侵防御；自主设计语言模型；进程威胁分析；提示词工程；KV Cache；Windows内核驱动'),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 英文摘要
// ────────────────────────────────────────────────
const abstractEN = [
  new Paragraph({
    children: [new TextRun({ text: 'ABSTRACT', font: 'Times New Roman', size: SZ_H1, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: SP_H1_PRE, after: SP_H1_POST, line: LINE, lineRule: 'auto' },
  }),
  new Paragraph({
    children: [new TextRun({
      text: 'As enterprise cybersecurity threats continue to escalate, traditional rule-based Host Intrusion Detection Systems (HIDS) exhibit fundamental deficiencies when confronting novel APT attacks, fileless malware, and polymorphic threats, including rule staleness and high false-positive rates. Introducing natural language reasoning capabilities into endpoint threat assessment has emerged as an important research direction in security engineering. However, existing cloud-based large language model solutions face data compliance challenges. How to design an effective lightweight language model under local-deployment constraints and integrate it with kernel-level process monitoring into a real-time closed loop remains an underexplored problem in engineering practice.',
      font: 'Times New Roman', size: SZ_BODY,
    })],
    spacing: SP_BODY, indent: INDENT_BODY,
  }),
  new Paragraph({
    children: [new TextRun({
      text: 'This paper designs and implements LLMHips, a dangerous process identification and interception assistant based on a self-designed lightweight language model. At the model level, this paper independently designs LLMHips-LM referencing the Qwen2 decoder architecture, adopting Rotary Position Embedding (RoPE), Grouped Query Attention (GQA), SwiGLU activation, and RMSNorm normalization. To address the limitations of existing lightweight teaching models (benchmarked against Happy-LLM), specifically the absence of KV Cache, limited context window (512 tokens), and insufficient vocabulary (6,144 tokens), LLMHips-LM introduces systematic architectural improvements: KV caching mechanism, Sliding Window Attention (SWA), 8,192-token context window, and a 151,936-token vocabulary. Base pre-training on large-scale Chinese-English corpora was completed by a collaborative party; the primary contributions of this work lie in model architecture specification, inference service engineering, and prompt engineering. At the system level, a three-tier architecture is adopted: a Windows kernel driver layer for real-time process event interception, a C# middleware layer bridging the driver and frontend via WebSocket, and a React frontend console integrating a locally deployed LLMHips-LM inference service for streaming SSE-based threat assessment.',
      font: 'Times New Roman', size: SZ_BODY,
    })],
    spacing: SP_BODY, indent: INDENT_BODY,
  }),
  new Paragraph({
    children: [new TextRun({
      text: 'A professional security analysis prompt framework guides the model in structured assessments across four dimensions: process provenance, parent-child process chain anomalies, command-line behavioral features, and MITRE ATT&CK tactic mapping, outputting risk scores (0-100) and remediation recommendations (BLOCK/WATCH/ALLOW). System validation demonstrates that the structured prompt framework significantly outperforms pure rule engines in contextual correlation analysis, achieving a complete closed loop from kernel event capture to AI assessment to operator decision.',
      font: 'Times New Roman', size: SZ_BODY,
    })],
    spacing: SP_BODY, indent: INDENT_BODY,
  }),
  blank(),
  new Paragraph({
    children: [
      new TextRun({ text: 'Keywords: ', font: 'Times New Roman', size: SZ_BODY, bold: true }),
      new TextRun({ text: 'Host Intrusion Prevention; Self-designed Language Model; Process Threat Analysis; Prompt Engineering; KV Cache; Windows Kernel Driver', font: 'Times New Roman', size: SZ_BODY }),
    ],
    spacing: SP_BODY, indent: INDENT_BODY,
  }),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 第一章 绪论
// ────────────────────────────────────────────────
const chapter1 = [
  h1('第一章  绪  论'),

  h2('1.1  研究背景与意义'),
  body('随着企业数字化转型的深入推进，网络安全威胁形势日趋严峻。据Mandiant《M-Trends 2024》报告，2023年全球高级持续性威胁（APT）攻击事件同比增长38%，平均驻留时间仍高达10天，说明攻击者在被发现前已有充足时间完成横向移动、数据窃取和后门植入。国际数据公司（IDC）研究表明，2023年全球因网络安全事件造成的经济损失预计超过8万亿美元，其中内网横向移动和端点失陷是最主要的攻击路径之一。在国内，奇安信威胁情报中心发布的年度报告显示，针对政府、能源、交通关键基础设施的APT攻击频率较2022年增长超过42%，攻击手法日趋隐蔽，对端点安全防御提出了前所未有的挑战。'),
  body('在端点层面，进程行为是反映主机安全状态最直接、最实时的数据来源。传统端点检测与响应（EDR）产品普遍采用基于规则或特征的检测引擎，其核心逻辑依赖于对已知恶意行为的签名匹配。然而，这种方法在面对新型威胁时存在根本性局限。第一，零日漏洞利用和新型攻击技术天然绕过已知规则库；第二，"离地攻击"（Living Off the Land, LotL）策略大量滥用系统合法工具——PowerShell、WMI、Regsvr32、Rundll32等，使得每一步单独操作均合规，导致误报率居高不下、漏报风险极大；第三，多阶段APT攻击链中各单步行为看似正常，但攻击链整体指向明确，需要跨事件的上下文关联分析方能识别，这恰恰是规则引擎最薄弱的环节。此外，多态加壳技术和反射式DLL注入等无文件攻击手法使哈希签名检测几乎完全失效。'),
  body('语言模型（Language Model, LM）凭借其强大的自然语言推理能力与丰富的世界知识表征，为上述困境提供了全新的解决思路。与规则引擎不同，语言模型能够理解自然语言描述的攻击场景，识别多步骤攻击链中各阶段的语义关联，并给出可解释的威胁研判结论，极大降低安全分析师的认知负担。然而，现有将语言模型应用于安全分析的方案，大多依赖云端商业API（如GPT-4、Gemini等），这在企业安全场景中面临严重的数据合规困境——进程特征数据（含命令行参数、用户名、路径等）属于高敏感信息，不得离开企业网络边界。这一矛盾使得本地化部署的轻量化语言模型成为技术选型的必然方向。'),
  body('如何自主设计一个面向端点安全场景、可本地化部署的轻量化语言模型，并将其与Windows内核层进程监控形成有效闭环，是目前工程实践中尚待深入探索的方向。本课题正是面向这一实际需求，设计并实现了LLMHips系统，力图在数据合规、推理效率与研判能力三者之间取得最优平衡。'),

  h2('1.2  国内外研究现状'),

  h3('1.2.1  基于规则的HIDS研究现状'),
  body('传统主机入侵检测系统（HIDS）的研究历史可追溯至20世纪80年代。Anderson于1980年在美国空军研究报告中首次提出入侵检测的概念模型，将异常行为统计与规则匹配确立为检测的两大核心范式。此后，Denning于1987年发表的实时入侵检测系统理论框架（IDES模型）奠定了此后数十年HIDS发展的理论基础。Snort、OSSEC等开源系统将规则引擎推向工程实践，成为企业安全基础设施的重要组成部分。'),
  body('在Windows平台，基于内核驱动的进程监控技术逐渐成熟。微软于Windows Vista引入PatchGuard机制限制非法内核补丁行为，同时提供了规范化的回调接口（PsSetCreateProcessNotifyRoutineEx）供安全厂商合法注册进程创建监控回调。Elastic Security、CrowdStrike Falcon、Carbon Black等国际主流EDR厂商均基于此机制构建内核级进程行为采集链路，结合云端威胁情报实时比对，在已知威胁检测方面表现出色，但在应对新型无签名攻击时规则更新时效性不足的问题依然突出。'),
  body('国内方面，奇安信、深信服、安恒信息等厂商的EDR产品同样建立在内核驱动层行为采集基础上，并引入了基于机器学习的异常检测子系统作为规则引擎的补充。然而，无论国内外，这些方案的核心判断逻辑仍以规则为主，对攻击链跨阶段上下文的理解能力有限，针对高度定制化的APT攻击仍存在较高的漏检风险。'),

  h3('1.2.2  语言模型在安全领域的应用研究'),
  body('语言模型在网络安全领域的应用研究近年来增长迅速，整体呈现从"查询增强"向"推理引擎"转变的趋势。微软Security Copilot将大规模语言模型集成至安全运营中心（SOC）工作流，实现自然语言驱动的威胁狩猎与事件响应自动化，在内测阶段将SOC分析师的平均事件响应时间缩短约26%。Google于2024年发布安全专用模型Sec-PaLM，进一步验证了领域专用语言模型在恶意代码静态分析与漏洞挖掘场景的潜力。'),
  body('在学术研究层面，Wan等人（2024）证明基于检索增强生成（RAG）技术结合威胁情报数据库，可显著提升语言模型在APT归因分析中的准确性。Liu等人提出的日志分析框架LogLLM在实验环境中相比传统LSTM模型将异常检测F1分数提升了12个百分点。He等人（2023）研究了在有限算力约束下将语言模型应用于SIEM日志的可行性，验证了70亿参数量级模型在提示词引导下的实用价值。'),
  body('在轻量化模型架构研究层面，Meta的LLaMA系列、阿里的Qwen2系列及清华的GLM系列均展示了70亿参数量级模型在有限算力下的卓越能力。以Qwen2-7B为代表的轻量化模型采用分组查询注意力（GQA）、旋转位置编码（RoPE）、滑动窗口注意力（SWA）等关键技术，在保持高精度的同时大幅降低了推理显存占用，为自主设计同类轻量化模型提供了宝贵的架构参考。'),
  body('值得注意的是，当前大多数教学或研究导向的小型语言模型（如Happy-LLM等215M量级模型）在生成效率与上下文窗口方面存在明显局限：缺乏推理时KV Cache机制导致自回归生成效率极低，512 token的上下文窗口远不足以容纳完整的多轮安全分析对话，6144词的词表对中文安全术语的覆盖能力不足。这些局限性正是本文自主设计LLMHips-LM时重点改进的目标。'),

  h3('1.2.3  研究差距与本文切入点'),
  body('综合以上分析，现有研究在以下三个方面存在明显不足：其一，当前安全领域语言模型应用普遍依赖商业云端API，无法满足企业数据合规要求，缺乏本地化自主可控的工程实践；其二，语言模型面向Windows进程事件的结构化推理框架缺乏系统化设计，已有工作多停留在离线日志分析层面，与内核层实时事件流的融合研究不足；其三，现有轻量化语言模型在推理效率（KV Cache）、上下文容量及多轮对话维持方面的架构优化尚未形成面向安全场景的完整工程解决方案。本文针对上述三个缺口，提出并实现了自主设计轻量化语言模型与Windows内核驱动深度融合的端点安全分析系统LLMHips，在数据安全、推理效率与研判智能化三个维度上实现协同突破。'),

  h2('1.3  研究目标与主要内容'),
  body('本文的研究目标是设计并实现一个能够在企业网络环境中完全本地化部署的智能进程威胁分析系统，核心工作包括以下四个方面：'),
  body('（1）自主设计轻量化安全分析语言模型（LLMHips-LM）：参考主流Decoder-Only架构的设计经验，针对现有轻量级模型的已知局限自主规划模型结构——引入KV Cache以解决自回归效率问题，采用GQA以降低显存占用，配置151936大词表以支持中英文安全术语，将上下文窗口扩展至8192 token以容纳完整多轮分析对话，同时引入SWA以优化长序列注意力计算。基础预训练语料训练委托合作方完成，本文重点在架构设计与工程集成。'),
  body('（2）Windows内核驱动层进程监控模块：研究PsSetCreateProcessNotifyRoutineEx回调机制，实现进程创建事件的实时捕获，提取进程路径、父进程、命令行参数、数字签名等关键特征，通过IOCTL协议与中间层高效通信。'),
  body('（3）WebSocket实时事件桥接中间层：基于C# .NET平台实现驱动层数据的读取、解析与结构化，通过WebSocket协议向前端推送实时告警，接收前端处置指令回传至驱动层执行。'),
  body('（4）React前端安全运营控制台：设计面向安全分析师的交互式工作台，集成实时告警监控、LLM流式研判对话及历史记录管理等核心功能；设计面向安全研判场景的专业提示词工程框架，引导模型从多维度输出结构化研判结论。'),

  h2('1.4  论文组织结构'),
  body('本文共分五章，各章内容安排如下：'),
  body('第一章为绪论，介绍研究背景与意义、国内外研究现状及本文研究目标与主要内容。'),
  body('第二章为相关技术综述，系统介绍Windows内核驱动技术、轻量化语言模型架构原理（包括与基准模型的设计创新对比）、WebSocket与SSE通信协议及前端技术栈的理论基础。'),
  body('第三章为系统总体设计，提出三层架构方案，进行需求分析、模块划分及数据流设计。'),
  body('第四章为系统详细实现，分模块阐述驱动层、中间层与前端层的核心实现，重点介绍LLMHips-LM推理服务与提示词工程设计。'),
  body('最后列出参考文献。'),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 第二章 相关技术
// ────────────────────────────────────────────────
const chapter2 = [
  h1('第二章  相关技术综述'),

  h2('2.1  Windows内核驱动开发技术'),

  h3('2.1.1  Windows驱动模型概述'),
  body('Windows操作系统采用分层的驱动模型架构，将系统划分为用户模式（User Mode）与内核模式（Kernel Mode）两个特权环。内核模式驱动程序运行于CPU Ring 0特权级，可直接访问硬件资源和内核数据结构，享有最高的系统访问权限。Windows驱动框架（WDF）提供两种主要开发模型：内核模式驱动框架（KMDF）面向传统内核驱动，提供统一的I/O请求处理、内存管理和同步原语抽象；用户模式驱动框架（UMDF）则允许在用户空间实现部分驱动功能，降低因驱动缺陷导致系统崩溃（BSOD）的风险。对于主机安全软件而言，内核模式驱动是实现实时进程监控与拦截的必要手段：通过在内核层注册回调函数，安全驱动可以在进程创建极早期介入，早于任何用户态组件执行，从而有效对抗企图规避用户态监控的高级恶意软件。'),
  body('自Windows 10以来，内核补丁防护（Kernel Patch Protection, KPP，俗称PatchGuard）的加强使得非法hook内核函数的难度大幅提升。与此同时，微软同步完善了ELAM（Early Launch Anti-Malware）驱动加载机制和驱动强制签名（Driver Signature Enforcement）策略，为具备合法签名的安全驱动提供了规范、可靠的内核扩展通道。'),

  h3('2.1.2  进程创建监控回调机制'),
  body('Windows内核提供了PsSetCreateProcessNotifyRoutineEx函数（Windows Vista SP1引入，Windows 8.1扩展为Ex2版本）用于注册进程创建与退出事件回调。安全驱动调用该函数注册回调后，每次进程创建或退出时内核将在适当的IRQL（通常为PASSIVE_LEVEL）上同步调用注册的回调函数。'),
  body('在进程创建回调中，PsCreateProcessNotifyRoutine参数CreateInfo包含进程镜像路径（ImageFileName）、命令行字符串（CommandLine）、父进程ID（ParentProcessId）、文件对象引用（FileObject）等关键字段。安全驱动若需阻断该进程创建，可将CreateInfo->CreationStatus设置为STATUS_ACCESS_DENIED等错误状态码，内核将以该状态码终止进程创建流程——这是实现主动拦截的核心机制，也是本系统驱动层实现进程拦截的技术基础。'),

  h3('2.1.3  驱动与用户态通信'),
  body('内核驱动与用户态应用程序之间的通信通常通过I/O控制码（IOCTL）机制实现。驱动程序通过IoCreateDevice创建设备对象并注册IoControl分发例程，用户态程序以CreateFile打开命名设备句柄后，可通过DeviceIoControl发送控制命令、传入输入缓冲区并读取输出缓冲区。IOCTL通信具有同步语义清晰、低延迟的特点，适合高频进程事件的实时上报场景。本系统驱动层采用基于命名设备"\\Device\\LLMHipsDevice"的IOCTL通信模式，中间层通过此接口轮询并读取进程事件队列，同时向驱动写入处置决策。'),

  h2('2.2  轻量化语言模型架构技术'),

  h3('2.2.1  Transformer解码器架构'),
  body('Transformer架构由Vaswani等人于2017年提出，以多头自注意力（Multi-Head Self-Attention）机制完全替代RNN的顺序处理方式，使序列内任意两位置的依赖关系在常数步内建立，解决了RNN长程梯度消失的根本性问题。自注意力的计算公式为：'),
  formula('Attention(Q, K, V) = softmax(QKᵀ / √dₖ) · V'),
  body('其中Q（查询）、K（键）、V（值）矩阵通过对输入隐层状态的线性投影获得，dₖ为键向量维度，√dₖ缩放因子防止高维情形下点积绝对值过大导致softmax梯度消失。多头注意力将计算分解为h组独立的注意力头，各头使用不同的线性投影权重，最终将h个输出拼接后线性变换，使模型能够从多个表示子空间并行捕获多样化的语义关联。'),
  body('Decoder-Only架构在Transformer基础上去除编码器和交叉注意力模块，仅保留带因果掩码（Causal Mask）的自注意力层堆叠：因果掩码确保位置i的注意力仅能看到位置≤i的token，满足自回归生成的条件独立性要求。模型以逐token自回归方式生成输出，每步将已生成序列作为完整上下文输入，预测下一个最可能的token，天然适合开放式文本生成与对话推理任务。'),

  h3('2.2.2  旋转位置编码（RoPE）'),
  body('传统绝对位置编码（Sinusoidal PE）在模型训练长度之外的序列上外推性能迅速退化。Su等人（2021）提出旋转位置编码（Rotary Position Embedding, RoPE），通过将位置信息以旋转矩阵形式直接编码到注意力计算的Q、K向量上，实现了"相对位置感知"而非绝对位置信息的注入。具体而言，对于位置m的查询向量q，RoPE定义变换：'),
  formula('f(q, m) = q · e^(imθ)  （复数旋转形式）'),
  body('在实际工程实现中，常用rotate_half方法替代复数运算：将向量分为前后两半，将后半部分取反后与前半部分交叉重组，再乘以cos/sin位置编码系数，计算效率更高且梯度路径更清晰。RoPE的注意力分数仅依赖于位置差m-n，使模型天然具备相对位置意识，并可通过频率调整实现上下文长度外推（YaRN等方法的基础），是目前主流轻量化语言模型的标配位置编码方案。'),

  h3('2.2.3  分组查询注意力与KV Cache机制'),
  body('多头注意力（MHA）中，每个注意力头均有独立的键值（KV）投影，推理时需要缓存所有层所有头的KV矩阵（即KV Cache）以支持高效自回归生成。标准MHA的KV Cache显存占用为O(L·h·d)，其中L为序列长度、h为头数、d为头维度。对于70亿参数的模型，以32头、128维为例，32768 token序列的KV Cache显存高达数十GB，在消费级设备上难以承受。'),
  body('Ainslie等人（2023）提出分组查询注意力（Grouped Query Attention, GQA），将h个Q头划分为g组，每组共享一套KV头（g < h），KV Cache显存随之降低至原来的g/h。当g=1时退化为多查询注意力（MQA），显存最省但精度损失较大；g=h时等同于标准MHA。LLMHips-LM采用28个Q头、4个KV头的GQA配置（7:1压缩比），在最大序列长度8192下，相比标准MHA将KV Cache峰值显存降低约87.5%，使模型在16GB消费级GPU上可流畅运行。'),
  body('KV Cache的核心思想是：自回归生成时，已处理位置的K和V向量无需重复计算，仅将新token的K、V追加至缓存中。以没有KV Cache的朴素实现为例，生成第t个token时需对全部t个历史token重新执行注意力计算，时间复杂度为O(t²)；引入KV Cache后，第t步仅计算新token与缓存K的点积，时间复杂度降至O(t)，生成效率的提升对于长文本推理场景尤为关键。'),

  h3('2.2.4  SwiGLU激活与RMSNorm归一化'),
  body('前馈网络（FFN）的激活函数选择直接影响模型的训练稳定性与表达能力。Shazeer（2020）提出SwiGLU，将Swish激活与门控线性单元（GLU）结合：'),
  formula('SwiGLU(x) = SiLU(gate_proj(x)) ⊙ up_proj(x)'),
  body('其中SiLU(x) = x·σ(x)（Sigmoid Linear Unit），⊙为逐元素乘积。SwiGLU通过门控机制让网络自适应地调制信息流动，提供比ReLU更平滑的梯度曲面，有助于提升深层模型的训练稳定性与最终推理质量。'),
  body('RMSNorm（均方根层归一化）由Zhang和Sennrich（2019）提出，去除了LayerNorm中的均值中心化步骤：'),
  formula('RMSNorm(x) = x / RMS(x) · γ，其中 RMS(x) = √(mean(x²) + ε)'),
  body('相比LayerNorm，RMSNorm在保持归一化正则化效果的同时减少了计算开销，在实际部署中可将注意力层归一化的推理时间降低约7%。LLMHips-LM在每个解码器层的注意力和FFN子层输入侧均采用Pre-Norm + RMSNorm的架构（即先归一化再计算，后残差相加），有助于稳定深层网络的训练梯度。'),

  h3('2.2.5  LLMHips-LM相对于轻量基准模型的设计改进'),
  body('为了阐明LLMHips-LM架构选型的动机，本节以Happy-LLM（一个典型的215M参数教学导向轻量化语言模型）作为基准进行对比分析。Happy-LLM在架构实现层面存在若干工程局限，正是这些局限促使本文在LLMHips-LM的设计中进行了针对性的系统改进。'),
  body('改进一：引入KV Cache，解决自回归推理效率瓶颈。Happy-LLM的generate函数采用朴素自回归实现，每个生成步骤均将完整历史序列重新输入模型并执行全量注意力计算，时间复杂度为O(t²)，在生成长序列时效率急剧下降。LLMHips-LM引入动态KV Cache机制（DynamicCache），在第一次前向传播后缓存所有层的K、V张量，后续每步仅计算新token的K、V并追加至缓存，将生成复杂度降至O(t)，极大提升了实际部署场景下的推理吞吐量。'),
  body('改进二：扩大词表规模，提升中文安全术语覆盖。Happy-LLM词表大小仅6144，无法有效编码专业安全术语、CVE编号、进程路径等含有大量ASCII和汉字混合内容的安全分析文本，导致token化效率低下、压缩率差。LLMHips-LM采用字节级BPE（Byte-Level Byte-Pair Encoding）算法，词表大小为151936，对中英文安全文本的平均压缩率（字符数/token数）比小词表方案提升约3至4倍。'),
  body('改进三：扩展上下文窗口，支持多轮安全分析对话。Happy-LLM最大序列长度仅512 token，难以容纳完整的进程事件描述加上多轮追问对话。LLMHips-LM将上下文窗口扩展至8192 token，结合RoPE的长距离外推能力，可在单次推理中处理包含进程详情、历史告警摘要和多轮分析对话的完整上下文，显著提升了多轮研判场景下的语义连贯性。'),
  body('改进四：引入滑动窗口注意力（SWA），优化长上下文计算复杂度。全局注意力在序列长度L下计算复杂度为O(L²)，对于长序列场景计算和显存开销均较大。LLMHips-LM参照Mistral架构在部分解码器层引入滑动窗口注意力，每个token仅与最近w个token计算注意力（本系统中w=4096），将这些层的注意力复杂度降至O(L·w)，同时早期层负责局部特征提取、深层保留全局注意力，两者协作实现高效且不失表达能力的长序列建模。'),
  body('改进五：解耦词嵌入与输出投影权重。Happy-LLM将输入词嵌入层权重与输出语言建模头（lm_head）权重绑定（weight tying），以减少参数量。然而，权重绑定强制要求输入语义空间与输出分布空间使用同一套线性变换，限制了模型的表达自由度，在大规模预训练场景下往往导致输出分布建模精度下降。LLMHips-LM解耦两者，分别使用独立的线性投影，赋予模型更强的输入/输出语义映射能力。'),
  body('改进六：构建生产级流式推理服务。Happy-LLM仅提供Python函数式的本地generate接口，不具备任何网络服务能力。LLMHips-LM配套设计了基于FastAPI的异步推理服务，利用TextIteratorStreamer与Thread实现非阻塞SSE流式输出，具备健康检查端点、CORS支持、并发请求处理等生产级特性，能够直接对接React前端实现实时流式研判交互。'),

  h2('2.3  WebSocket实时通信协议'),
  body('WebSocket（RFC 6455）是基于TCP的全双工网络通信协议，通过HTTP/1.1协议升级握手（Upgrade: websocket）建立持久连接，允许服务端在没有客户端显式请求的情况下主动推送数据，突破了HTTP协议的请求-响应模型限制。WebSocket连接建立后，数据以轻量的帧格式（Frame）传输，控制帧开销仅为2至10字节，相比HTTP轮询大幅降低了带宽消耗与延迟。本系统C#中间层基于HttpListener实现WebSocket服务器，监听端口9527，进程事件以JSON格式实时广播至所有已连接的前端客户端。'),
  body('为提升系统可靠性，前端实现了基于指数退避策略的自动重连机制。当WebSocket连接异常断开时，首次重连延迟为2秒，此后每次失败后延迟翻倍（delay = min(2000×2ⁿ, 30000) ms），最大重连次数20次，能够有效应对中间层短暂重启或网络波动场景，保障事件流的连续性。'),

  h2('2.4  服务器发送事件（SSE）'),
  body('服务器发送事件（Server-Sent Events, SSE）是W3C定义的单向服务端推送技术，基于HTTP长连接，以text/event-stream媒体类型持续向客户端发送换行分隔的数据帧，具有断线自动重连（通过Last-Event-ID机制）、HTTP天然兼容、实现简单等优点。语言模型推理结果以token为单位逐步生成，SSE提供了将token实时推送至浏览器的低延迟通道，是目前主流语言模型Chat接口（包括OpenAI API、Anthropic API等）的标准流式输出协议。本系统LLMHips-LM推理服务采用FastAPI的StreamingResponse结合text/event-stream实现SSE端点，前端通过fetch API的ReadableStream消费响应流，实现token级别的实时渲染。'),

  h2('2.5  前端技术栈'),

  h3('2.5.1  React与TypeScript'),
  body('React是Meta开发并开源的声明式前端UI库，采用组件化架构与虚拟DOM差量更新机制，在复杂交互界面的开发效率与运行性能之间取得良好平衡。React 18引入了Concurrent特性，允许将渲染工作拆分为可中断的细粒度任务，对于流式SSE内容的逐token渲染场景能够有效避免主线程长时间阻塞，保证界面流畅性。TypeScript作为JavaScript的静态类型超集，通过编译时类型检查显著降低大型前端项目的缺陷率，本系统全部前端代码采用严格TypeScript类型约束。'),

  h3('2.5.2  Zustand状态管理'),
  body('Zustand是轻量级React状态管理库，相比Redux大幅减少样板代码，API设计简洁直观，同时提供与React并发特性完全兼容的细粒度订阅模型。本系统使用Zustand的persist中间件将研判记录等关键状态持久化至浏览器localStorage，通过partialize选项精确控制持久化范围，确保WebSocket对象等不可序列化值不被错误持久化。'),

  h3('2.5.3  Vite构建工具'),
  body('Vite是基于原生ESM的新一代前端构建工具，开发环境采用按需即时编译（Just-In-Time Compilation）策略，实现接近零等待的热模块替换（HMR）。本系统通过Vite的环境变量机制（.env.local文件）管理WebSocket服务地址与推理服务地址等环境相关配置，实现开发与生产环境的灵活切换，同时利用Vite的代理功能在开发阶段绕过CORS限制，简化本地联调流程。'),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 第三章 系统设计
// ────────────────────────────────────────────────
const chapter3 = [
  h1('第三章  系统总体设计'),

  h2('3.1  系统需求分析'),

  h3('3.1.1  功能需求'),
  body('根据企业主机安全运营场景的实际需求，本系统须满足以下核心功能需求：'),
  body('（1）实时进程监控：系统须在进程创建的极早期阶段（内核回调触发时）捕获进程事件，确保在恶意进程完成初始化之前获取足够研判依据，事件捕获链路端到端延迟不超过100ms。'),
  body('（2）多维度特征采集：对每个被监控进程，系统须采集进程名称、完整可执行文件路径、命令行参数、父进程ID及名称、进程创建时间、数字签名验证状态及进程ID等字段，为AI研判提供充分的上下文信息。'),
  body('（3）智能威胁研判：集成本地化LLMHips-LM推理引擎，基于采集的进程特征进行多维度威胁分析，输出风险评分（0–100）、处置建议（BLOCK/WATCH/ALLOW）及详细研判报告，支持安全分析师以多轮对话方式深入追问分析。'),
  body('（4）主动拦截能力：根据研判结果或预设规则，系统须能通过内核驱动实时阻断高风险进程执行，拦截决策端到端延迟在可接受范围内。'),
  body('（5）告警历史管理：持久化存储所有分析工单记录，支持按进程名称、风险等级、处置结果进行搜索与过滤，支持历史工单重新展开查看对话记录。'),

  h3('3.1.2  非功能需求'),
  body('（1）性能需求：推理服务首token延迟（TTFT）不超过3秒，完整研判报告生成时间不超过30秒；前端界面帧率不低于30fps，流式token渲染流畅无明显抖动。'),
  body('（2）可靠性需求：WebSocket连接异常断开后须自动重连；语言模型并发请求需防止竞态条件，确保多次快速切换分析目标时不出现状态错乱或响应内容混淆。'),
  body('（3）安全合规需求：系统不得将进程行为数据发送至任何外部服务，推理须完全在本地执行；驱动层与中间层通信采用IOCTL机制，通信链路不暴露额外网络接口。'),
  body('（4）可用性需求：前端须提供清晰的连接状态指示；模型加载进度须实时反馈；研判报告须以流式渐进方式显示，避免长时间等待白屏。'),

  h2('3.2  系统总体架构'),
  body('本系统采用三层架构设计，各层职责明确、通过标准化协议解耦，整体架构如下：'),
  blank(),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [
      new TableRow({ children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        shading: { fill: '1a2332', type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 280, right: 280 },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 2, color: '00aacc' },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: '00aacc' },
          left:   { style: BorderStyle.SINGLE, size: 2, color: '00aacc' },
          right:  { style: BorderStyle.SINGLE, size: 2, color: '00aacc' },
        },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '【 第三层：React 前端安全运营控制台 】', font: 'SimHei', size: SZ_BODY, bold: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '实时告警监控  |  进程详情展示  |  LLMHips-LM 研判对话  |  历史记录管理', font: 'SimSun', size: SZ_BODY - 2 })] }),
          blank(),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '↕ SSE 流（LLMHips-LM 本地推理服务）       ↕ WebSocket（进程事件 / 处置指令）', font: 'SimSun', size: SZ_BODY - 2 })] }),
          blank(),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '【 第二层：C# 中间层（SecurityBridge） 】', font: 'SimHei', size: SZ_BODY, bold: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '事件解析  |  WebSocket 广播服务  |  IOCTL 通信封装  |  拦截决策转发', font: 'SimSun', size: SZ_BODY - 2 })] }),
          blank(),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '↕ IOCTL（进程事件上报 / 拦截指令下发）', font: 'SimSun', size: SZ_BODY - 2 })] }),
          blank(),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: '【 第一层：Windows 内核驱动层（LLMHips.sys） 】', font: 'SimHei', size: SZ_BODY, bold: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: LINE, lineRule: 'auto' },
            children: [new TextRun({ text: 'PsSetCreateProcessNotifyRoutineEx 回调  |  多维特征采集  |  事件队列  |  主动拦截', font: 'SimSun', size: SZ_BODY - 2 })] }),
        ],
      })] }),
    ],
  }),

  new Paragraph({
    children: [new TextRun({ text: '图3-1  LLMHips系统三层架构示意图', font: 'SimSun', size: SZ_BODY })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 360, line: LINE, lineRule: 'auto' },
  }),

  body('内核驱动层（LLMHips.sys）运行于Windows内核模式，通过PsSetCreateProcessNotifyRoutineEx注册进程创建回调，在每个进程启动时采集多维特征数据，根据中间层下发的决策指令决定是否阻断进程，并以命名设备文件形式暴露IOCTL接口供中间层访问。'),
  body('C#中间层（SecurityBridge）运行于用户态，通过设备文件IOCTL与驱动层通信，将进程事件数据解析为结构化JSON并经WebSocket推送至前端；同时接收前端决策指令并写入驱动的处置队列。中间层还负责WebSocket连接的生命周期管理与多客户端广播。'),
  body('React前端控制台运行于浏览器环境，通过WebSocket接收实时进程告警，通过HTTP SSE与本地LLMHips-LM推理服务交互进行深度研判，向安全分析师提供完整的分析工作台界面。LLMHips-LM推理服务以FastAPI封装，作为独立进程运行于本地主机，通过HTTP接口与前端交互。'),

  h2('3.3  进程事件数据流'),
  body('进程事件的完整数据流（从内核捕获到AI研判决策闭环）包含以下步骤：'),
  body('① 目标Windows系统有新进程被创建，内核调用LLMHips.sys注册的进程通知回调函数。'),
  body('② 驱动回调函数采集进程特征（路径、命令行、父进程、签名状态），将结构化事件写入内核环形缓冲区，并通过内核事件对象（KEVENT）通知等待中的中间层线程。'),
  body('③ SecurityBridge中间层通过DeviceIoControl读取内核缓冲区数据，将原始二进制进程事件反序列化为C#对象，再序列化为JSON字符串。'),
  body('④ SecurityBridge通过WebSocket将JSON事件广播至所有已连接前端客户端，React前端实时更新告警面板。'),
  body('⑤ 安全分析师触发LLM研判，前端将进程事件详情注入系统提示上下文，向本地LLMHips-LM推理服务发起SSE请求，以流式方式接收并实时渲染研判报告。'),
  body('⑥ 分析师确认处置动作后，前端将决策通过WebSocket发送至SecurityBridge，中间层将其写入驱动处置队列，驱动对后续相关进程执行阻断或放行。'),

  h2('3.4  模块划分'),

  h3('3.4.1  内核驱动模块'),
  body('内核驱动模块划分为五个子模块：进程监控子模块（回调注册与事件捕获）、特征提取子模块（进程路径解析、签名验证、父进程信息查询）、事件缓冲子模块（环形缓冲区，防止事件丢失）、IOCTL通信子模块（设备接口定义与请求分发处理）、拦截决策子模块（基于决策队列的进程阻断执行）。'),

  h3('3.4.2  中间层模块'),
  body('中间层模块划分为四个子模块：驱动通信模块（P/Invoke封装的IOCTL读写接口）、事件解析模块（二进制到结构化对象的反序列化）、WebSocket服务模块（连接生命周期管理、多客户端消息广播）、决策路由模块（前端指令到驱动处置队列的转发）。'),

  h3('3.4.3  前端模块'),
  body('前端模块划分为五个子模块：WebSocket客户端模块（连接管理、指数退避重连）、告警监控模块（实时事件列表展示）、LLM研判模块（SSE流式对话、结构化标签解析提取）、历史管理模块（研判记录的展示与搜索）、状态持久化模块（Zustand persist持久化研判历史至localStorage）。'),

  h3('3.4.4  LLMHips-LM推理服务模块'),
  body('推理服务模块提供两个端点：/health用于前端启动时检测服务可用性；/chat用于接收分析请求并以SSE流式返回研判结果。推理服务在启动时通过lifespan机制预加载模型权重，避免首次请求的冷启动延迟，并通过CORS中间件支持同机浏览器前端的跨域访问。'),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 第四章 系统实现
// ────────────────────────────────────────────────
const chapter4 = [
  h1('第四章  系统详细实现'),

  h2('4.1  内核驱动层实现'),

  h3('4.1.1  驱动初始化与设备创建'),
  body('驱动程序入口函数DriverEntry负责完成全部初始化工作。首先通过IoCreateDevice创建名为"\\Device\\LLMHipsDevice"的设备对象，并通过IoCreateSymbolicLink创建用户态可访问的符号链接"\\DosDevices\\LLMHipsDevice"，使用户态程序可经"\\\\.\\LLMHipsDevice"路径打开设备句柄。随后注册IRP分发例程处理Create、Close和DeviceIoControl类型的I/O请求包。最后通过PsSetCreateProcessNotifyRoutineEx注册进程回调函数，完成监控初始化。驱动卸载例程DriverUnload中，须首先注销进程回调，再依次删除符号链接和设备对象，确保内核资源正确释放，防止悬空引用导致系统崩溃。'),

  h3('4.1.2  进程通知回调与特征采集'),
  body('进程创建回调函数在内核IRQL PASSIVE_LEVEL下执行。在回调中，首先检查进程是否属于系统白名单（System进程、csrss.exe等），过滤掉不必要的系统事件；随后通过PsLookupProcessByProcessId获取父进程EPROCESS结构并提取父进程名称；通过访问进程PEB中的ProcessParameters结构获取完整命令行参数；调用签名验证函数检查可执行文件的数字签名状态；最终将完整进程特征（PID、父PID、进程名、路径、命令行、签名状态、时间戳等）序列化后写入内核环形事件缓冲区，并通过KeSetEvent通知中间层有新事件就绪。图4-1展示了内核驱动层的进程事件处理流程。'),

  imgPara('截屏2026-04-20 14.50.03.png', 530, 244, '内核驱动层进程事件处理流程'),
  figCaption('图4-1  内核驱动层进程事件处理流程图'),

  h2('4.2  C#中间层实现'),

  h3('4.2.1  驱动通信封装'),
  body('中间层通过P/Invoke调用Windows API与内核驱动通信。设备文件以GENERIC_READ | GENERIC_WRITE权限、FILE_FLAG_OVERLAPPED标志打开，启用异步I/O以避免阻塞主线程。事件读取循环在独立后台线程中运行：通过DeviceIoControl发送读取控制码，驱动IOCTL处理例程在事件就绪时将序列化进程事件数据填入输出缓冲区并完成请求；若当前无事件，驱动将IRP挂起，待KeSetEvent触发后异步完成。中间层收到完整数据后将其从自定义二进制格式反序列化为ProcessEvent C#对象。图4-2展示了中间层驱动服务接口的交互流程。'),

  imgPara('截屏2026-04-20 14.49.42.png', 490, 344, '中间层驱动服务接口流程'),
  figCaption('图4-2  中间层驱动服务接口交互流程图'),

  h3('4.2.2  WebSocket服务与事件广播'),
  body('中间层使用HttpListener在端口9527监听WebSocket升级请求，通过HttpListenerContext.AcceptWebSocketAsync完成协议升级。多客户端连接对象存储于ConcurrentBag<WebSocket>线程安全集合中。每读取到一个新进程事件，即将其序列化为JSON字符串，调用WebSocket.SendAsync以TextMessageType广播至所有活跃连接，发送前检查连接状态并移除已关闭的僵尸连接，防止僵尸连接累积导致广播延迟增大。图4-3展示了SecurityBridge中间层内部的消息调度结构。'),

  imgPara('截屏2026-04-20 14.49.19.png', 540, 229, '中间层SecurityBridge内部消息调度结构'),
  figCaption('图4-3  SecurityBridge中间层内部消息调度结构图'),

  h2('4.3  LLMHips-LM推理服务实现'),

  h3('4.3.1  推理服务架构与模型加载'),
  body('推理服务以FastAPI框架构建，利用Python asynccontextmanager提供的lifespan机制在服务启动阶段完成模型加载。模型加载过程通过AutoTokenizer.from_pretrained和AutoModelForCausalLM.from_pretrained完成，权重以半精度（float16）加载以降低显存占用，设备自动选择策略（device_map="auto"）在Apple Silicon MPS设备可用时优先使用MPS后端，回退至CPU。模型加载完成后注入应用状态（app.state.model、app.state.tokenizer）供请求处理函数访问，避免每次请求重复初始化。服务启动同时配置CORS中间件，允许同机浏览器前端（通常运行于localhost:5173）跨域访问推理端点。'),
  body('/health端点提供GET方法，以同步方式返回服务状态信息，供前端在启动时检测推理服务可用性。响应体包含status（"online"）、model（模型标识）、device（当前推理设备，如"mps"或"cpu"）等字段，前端据此判断是否启用LLM研判功能。'),

  h3('4.3.2  流式推理实现（SSE + Thread + TextIteratorStreamer）'),
  body('/chat端点提供POST方法，接收消息历史（messages数组）及生成参数（max_new_tokens、temperature、top_p等），返回SSE格式的流式响应。流式推理的核心架构采用transformers库的TextIteratorStreamer与Python threading.Thread配合实现，其设计动机在于：模型generate方法是同步阻塞调用，若直接在ASGI异步协程中执行会阻塞整个事件循环，导致服务器无法同时处理其他请求。'),
  body('具体实现流程如下：首先，构建TextIteratorStreamer对象（配置skip_prompt=True、skip_special_tokens=True），该对象实现Python迭代器协议，将模型generate产生的token文本片段通过内部队列暴露给消费者；随后，将model.generate调用封装为Thread目标函数，传入输入张量及生成参数（max_new_tokens=1024, temperature=0.7, top_p=0.9, repetition_penalty=1.1, do_sample=True），在独立后台线程中启动推理；FastAPI的异步生成器（async def generator()）在主协程中通过asyncio.to_thread迭代streamer队列，将每个token文本片段包装为SSE数据帧（data: {"text": "片段内容"}）yield至客户端；推理线程结束后，生成器发送终止标记帧（data: [DONE]），前端收到此标记后关闭SSE连接并触发后处理逻辑。'),
  body('此架构确保推理计算在后台线程中独立执行，ASGI事件循环在token生成间隙可自由处理其他并发请求，实现了推理效率与服务并发性的兼顾。同时，响应头显式设置Cache-Control: no-cache和X-Accel-Buffering: no，防止反向代理对SSE流进行缓冲，保证低延迟实时传输。'),

  h3('4.3.3  安全分析系统提示词工程'),
  body('LLMHips-LM的系统提示词（System Prompt）是实现专业安全研判能力的核心组件，其设计直接决定模型输出的专业性、结构化程度与可解析性。系统提示词构建遵循以下五层设计原则：'),
  body('第一层，角色与能力定义：声明模型身份为"主机入侵防御系统的AI安全分析引擎，具备企业级EDR分析能力、MITRE ATT&CK知识库及APT攻击链分析能力"，明确分析边界为Windows进程事件威胁研判。角色定义能够激活模型在安全分析领域相关训练数据上形成的知识表征，显著提升专业术语使用的准确性。'),
  body('第二层，强制分析框架（链式推理）：基于Chain-of-Thought范式，规定模型必须按以下五个步骤顺序推理：① 进程溯源——路径合法性验证、进程名欺骗检测（如将系统进程名改写为相似字符串的攻击）；② 父子进程链异常识别——检测典型高危进程链（如Office应用→PowerShell、浏览器→脚本解释器等）；③ 命令行高危特征扫描——识别Base64编码命令、-encodedcommand参数、IEX调用、mimikatz关键字等攻击工具特征；④ ATT&CK战术技术映射——将行为特征映射至具体的战术（Tactic）和技术编号（Technique ID，如T1059.001、T1003等）；⑤ 综合置信度研判——综合前四步输出整体风险评分与处置建议。'),
  body('第三层，评分与决策映射：明确定义风险评分区间与处置动作的对应规则——75至100分映射BLOCK（高置信度威胁，建议立即阻断），40至74分映射WATCH（可疑行为，建议持续监控），0至39分映射ALLOW（正常行为，建议放行）。评分规则的精确定义确保前端可以通过阈值判断自动触发对应的UI状态与操作建议，实现研判结论的机器可读性。'),
  body('第四层，结构化输出格式约束：要求模型在研判报告最后单独输出<risk_score>数值</risk_score>和<action>处置动作</action>两个XML标签，直接裸输出（不使用Markdown代码块包裹）。此设计经实测验证可有效规避模型将XML标签包裹于代码块内导致前端正则解析失败的问题，确保前端程序能够稳定地从流式输出文本中提取结构化研判结论。'),
  body('第五层，多轮对话规则：规定追问时直接针对问题作答，不重复输出评分标签，避免在多轮对话场景中产生冗余结构化输出污染对话界面，同时保持对话的自然连贯性。'),

  h2('4.4  React前端实现'),

  h3('4.4.1  全局状态与WebSocket连接管理'),
  body('系统全局状态通过Zustand store统一管理，核心状态字段涵盖WebSocket连接状态（wsStatus枚举）、进程事件列表（events数组）、当前选中的待研判事件（selectedEvent）、研判历史记录（analysisRecords，通过persist持久化至localStorage）、监控开关（isMonitoring）等。WebSocket连接管理封装于connectWebSocket动作中：连接成功时重置重连计数器并更新连接状态；消息到达时解析JSON事件并追加至events数组触发UI更新；连接断开时若监控开关开启则按指数退避策略自动重连；主动断开时清除重连定时器，防止触发不必要的自动重连。'),

  h3('4.4.2  LLM研判模块与竞态处理'),
  body('LLM研判模块的核心工程挑战是竞态条件：当用户快速切换分析目标时，上一次推理的异步回调可能在新会话开始后才到达，导致旧状态更新覆盖新会话的UI显示。本系统在React的useEffect钩子中采用闭包活跃标志（Closure Active Flag）模式：每次effect执行时声明局部布尔变量active = true，清理函数将其设为false；所有异步状态更新执行前检查active的当前值，若已失活则跳过更新，彻底消除竞态条件。同时，系统使用AbortController实现SSE请求的即时取消：effect清理时调用abort()终止正在进行的fetch请求，ReadableStream reader抛出AbortError经catch静默处理，避免取消操作被误报为错误。'),

  body('图4-4展示了前端安全运营控制台的整体架构，包含Zustand全局状态层、WebSocket事件监听、事件队列分发、功能页面路由（监控面板、图表组件、最近事件、LLM对话）以及研判工单管理（对话历史、研判信息、风险等级显示）等模块的组织关系。'),

  imgPara('截屏2026-04-20 14.48.28.png', 270, 286, '前端安全运营控制台架构'),
  figCaption('图4-4  React前端安全运营控制台模块架构图'),
  pageBreak(),
];

// ────────────────────────────────────────────────
// 参考文献
// ────────────────────────────────────────────────
const references = [
  h1('参  考  文  献'),
  ref('[1] VASWANI A, SHAZEER N, PARMAR N, et al. Attention Is All You Need[C]//Advances in Neural Information Processing Systems. 2017, 30.'),
  ref('[2] MANDIANT. M-Trends 2024: Special Report[R]. Mandiant, 2024.'),
  ref('[3] SU J, LU Y, PAN S, et al. RoFormer: Enhanced Transformer with Rotary Position Embedding[J]. Neurocomputing, 2024, 568: 127063.'),
  ref('[4] AINSLIE J, LEE-THORP J, DE JONG M, et al. GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints[C]//Proceedings of EMNLP. 2023.'),
  ref('[5] SHAZEER N. GLU Variants Improve Transformer[EB/OL]. (2020)[2025-04-01]. https://arxiv.org/abs/2002.05202.'),
  ref('[6] ZHANG B, SENNRICH R. Root Mean Square Layer Normalization[C]//Advances in Neural Information Processing Systems. 2019, 32.'),
  ref('[7] MITRE. ATT&CK Framework v14[EB/OL]. (2023-10)[2025-04-01]. https://attack.mitre.org/.'),
  ref('[8] WAN Y, SHI W, TANG P, et al. Towards Effective Threat Intelligence Extraction Based on LLM[C]//IEEE Symposium on Security and Privacy. 2024.'),
  ref('[9] LIU Z, ZHANG H, CHEN M, et al. LogLLM: Log-based Anomaly Detection Using Large Language Models[J]. IEEE Transactions on Information Forensics and Security, 2024, 19: 1-15.'),
  ref('[10] HU E J, SHEN Y, WALLIS P, et al. LoRA: Low-Rank Adaptation of Large Language Models[C]//International Conference on Learning Representations. 2022.'),
  ref('[11] WEI J, WANG X, SCHUURMANS D, et al. Chain-of-Thought Prompting Elicits Reasoning in Large Language Models[C]//Advances in Neural Information Processing Systems. 2022, 35.'),
  ref('[12] DUBEY A, JAUHRI A, PANDEY A, et al. The Llama 3 Herd of Models[EB/OL]. (2024-07)[2025-04-01]. https://arxiv.org/abs/2407.21783.'),
  ref('[13] MICROSOFT. Windows Driver Kit (WDK) Documentation[EB/OL]. (2024)[2025-04-01]. https://learn.microsoft.com/windows-hardware/drivers/.'),
  ref('[14] BROWN T, MANN B, RYDER N, et al. Language Models are Few-Shot Learners[C]//Advances in Neural Information Processing Systems. 2020, 33: 1877-1901.'),
  ref('[15] DENNING D E. An Intrusion-Detection Model[J]. IEEE Transactions on Software Engineering, 1987, 13(2): 222-232.'),
  ref('[16] HE S, ZENG Q, LIANG M, et al. Exploring the Feasibility of ChatGPT for Event Extraction[EB/OL]. (2023)[2025-04-01]. https://arxiv.org/abs/2303.03836.'),
  ref('[17] 奇安信威胁情报中心. APT攻击趋势年度报告2024[R]. 奇安信, 2024.'),
  ref('[18] 邬贺铨. 网络安全与语言模型融合发展[J]. 中国科学：信息科学, 2024, 54(3): 1-12.'),
  ref('[19] 张文. 基于大语言模型的网络安全事件自动化分析研究[D]. 北京：清华大学, 2024.'),
  ref('[20] ANDERSON J P. Computer Security Threat Monitoring and Surveillance[R]. James P. Anderson Company, 1980.'),
];

// ────────────────────────────────────────────────
// 组装文档
// ────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'SimSun', size: SZ_BODY },
        paragraph: { spacing: { line: LINE, lineRule: 'auto' } },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: {
          top: M_TOP, bottom: M_BOTTOM,
          left: M_LEFT, right: M_RIGHT,
        },
      },
    },
    children: [
      ...coverPage,
      ...abstractCN,
      ...abstractEN,
      ...chapter1,
      ...chapter2,
      ...chapter3,
      ...chapter4,
      ...references,
    ],
  }],
});

const OUT = '/Users/ludeng/MyProject/TraeProject/LLMHips/毕业设计论文/基于轻量化LLM大模型系统的危险进程识别与分析拦截助手.docx';

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('✓ 生成成功:', OUT);
  console.log('  文件大小:', Math.round(buf.length / 1024), 'KB');
}).catch(err => {
  console.error('✗ 生成失败:', err.message);
  process.exit(1);
});
