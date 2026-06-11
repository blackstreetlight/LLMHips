import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSystemStore } from '../../store/useSystemStore';
import type { AnalysisChatMessage } from '../../types/index';
import {
  Bot, X, ShieldAlert, Sparkles, CheckCircle, Activity, Send,
  User, Lock, LockOpen, HelpCircle, Terminal, GitFork, WifiOff,
} from 'lucide-react';
import { BlockSuccessModal } from '../../components/BlockSuccessModal';
import { buildSystemPrompt } from '../skills/systemPrompt';
import { streamWithSkills } from '../skills/streamWithSkills';

const LLM_URL = (import.meta.env.VITE_LLM_URL as string | undefined) || 'http://localhost:8000';

interface ChatMessage {
  id: string;
  /** ai: AI 正常回复  user: 用户消息  skill: 技能调用状态卡片 */
  role: 'ai' | 'user' | 'skill';
  content: string;
  isStreaming?: boolean;
  /** role === 'skill' 时有效 */
  skillInfo?: {
    name:    string;
    cmd:     string;
    status:  'running' | 'done' | 'disabled';
    result?: string;
  };
}

/**
 * 清理模型输出：
 *  - 移除仅包含 XML 标签的 markdown 代码块（```xml ... ```）
 *  - 移除裸 XML 标签
 *  - 合并多余空行（3+ → 2）
 */
function cleanModelOutput(text: string): string {
  return text
    // 移除只含 risk_score / action 标签的代码块，同时保留语言标记
    // 捕获组1 = 语言标记（如 python/java/powershell），捕获组2 = 代码内容
    .replace(/```(\w*)\s*\n?([\s\S]*?)```/g, (_, lang: string, inner: string) => {
      const stripped = inner
        .replace(/<risk_score>\d+<\/risk_score>/g, '')
        .replace(/<action>(?:BLOCK|WATCH|ALLOW)<\/action>/g, '')
        .trim();
      // 代码块里除了 XML 标签还有其他内容 → 保留，并还原语言标记
      if (!stripped) return '';
      return lang ? `\`\`\`${lang}\n${stripped}\n\`\`\`` : `\`\`\`\n${stripped}\n\`\`\``;
    })
    // 移除残留的裸标签
    .replace(/<risk_score>\d+<\/risk_score>/g, '')
    .replace(/<action>(?:BLOCK|WATCH|ALLOW)<\/action>/g, '')
    .replace(/<summary>[\s\S]*?<\/summary>/g, '')
    // 3+ 连续空行 → 2 行
    .replace(/\n{3,}/g, '\n')
    .trim();
}

/** 根据引擎预设构建发送给后端的 engine 配置对象 */
function buildEnginePayload(
  preset: string,
  apiKey: string,
  baseUrl: string,
  model: string,
) {
  if (preset === 'local') return { provider: 'local' };
  if (preset === 'openai') return {
    provider: 'openai',
    api_key: apiKey,
    model: model || 'gpt-4o',
  };
  if (preset === 'deepseek') return {
    provider: 'openai',                        // DeepSeek 兼容 OpenAI 格式
    api_key: apiKey,
    base_url: 'https://api.deepseek.com/v1',
    model: model || 'deepseek-chat',
  };
  if (preset === 'anthropic') return {
    provider: 'anthropic',
    api_key: apiKey,
    model: model || 'claude-3-5-sonnet-20241022',
  };
  // custom
  return {
    provider: 'openai',
    api_key: apiKey,
    base_url: baseUrl,
    model: model,
  };
}

/** 根据引擎预设生成显示标签 */
function engineLabel(preset: string, model: string) {
  if (preset === 'local')     return 'Qwen2.5-7B · Local';
  if (preset === 'openai')    return `${model || 'gpt-4o'} · OpenAI`;
  if (preset === 'deepseek')  return `${model || 'deepseek-chat'} · DeepSeek`;
  if (preset === 'anthropic') return `${model || 'claude-3-5-sonnet'} · Anthropic`;
  return `${model || 'Custom'} · Cloud`;
}

export const LLMAnalysisView: React.FC = () => {
  const {
    selectedEvent, setSelectedEvent,
    createAnalysisRecord, updateAnalysisChat, updateAnalysisVerdict, finalizeAnalysis,
    blockEvent, addToWhitelist,
    writebackEnabled,
    enginePreset, engineApiKey, engineBaseUrl, engineModel,
    inferMaxTokens, inferTemperature, inferTopP, inferMaxHistory,
  } = useSystemStore();

  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [showActions,  setShowActions]  = useState(false);
  const [question,     setQuestion]     = useState('');
  const [llmOffline,   setLlmOffline]   = useState(false);
  // AI 研判结果缓存，供处置按钮写回时使用
  const [lastAnalysis, setLastAnalysis] = useState<{
    summary: string;
    attackTechnique: string | null;
    aiScore: number;
  } | null>(null);
  const [blockSuccess, setBlockSuccess] = useState<{
    processName: string; pid: number; blockedAt: number;
  } | null>(null);

  const currentRecordIdRef  = useRef<string | null>(null);
  const abortControllerRef  = useRef<AbortController | null>(null);
  const messagesEndRef       = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────
  // 持久化同步
  // ─────────────────────────────────────────────────────────
  const syncChatToStore = (msgs: ChatMessage[]) => {
    const recordId = currentRecordIdRef.current;
    if (!recordId) return;
    const persistable: AnalysisChatMessage[] = msgs
      .filter(m => !m.isStreaming)
      .map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: Date.now() }));
    updateAnalysisChat(recordId, persistable);
  };

  // ─────────────────────────────────────────────────────────
  // 核心流式请求
  //
  //  isActive  : () => boolean
  //    由调用方提供的「本次会话是否仍有效」判断函数。
  //    useEffect cleanup 会将其置为 false，从而让
  //    已被切换/关闭的旧请求不再写入任何 React state，
  //    彻底避免快速切换时的竞态卡死。
  // ─────────────────────────────────────────────────────────
  // 当前 AI 消息 ID 的可变引用，技能多轮时会在 onNewAITurn 里更新
  const activeMsgIdRef = useRef('');

  const streamFromLLM = async (
    apiMessages: { role: string; content: string }[],
    systemExtra: string,
    targetMsgId: string,
    isActive: () => boolean,
    onDone: (fullText: string) => void,
    eventContext?: Record<string, unknown>,
  ) => {
    activeMsgIdRef.current = targetMsgId;
    setLlmOffline(false);

    await streamWithSkills({
      url:         LLM_URL,
      messages:    apiMessages,
      systemExtra,
      fetchExtra:  {
        event_context:  eventContext ?? null,
        max_new_tokens: inferMaxTokens,
        temperature:    inferTemperature,
        top_p:          inferTopP,
        engine:         buildEnginePayload(enginePreset, engineApiKey, engineBaseUrl, engineModel),
      },
      abortRef: abortControllerRef,
      callbacks: {
        isActive,

        // 追加文本到当前 AI 消息气泡
        onChunk: (text) => {
          setMessages(prev => prev.map(m =>
            m.id === activeMsgIdRef.current
              ? { ...m, content: m.content + text }
              : m,
          ));
        },

        // 技能开始执行：插入"执行中"状态卡片
        onSkillStart: (skillName, displayCmd) => {
          const skillMsgId = `skill-${Date.now()}`;
          // 先把当前 AI 消息标记为非流式（暂停游标）
          setMessages(prev => [
            ...prev.map(m =>
              m.id === activeMsgIdRef.current ? { ...m, isStreaming: false } : m,
            ),
            {
              id:        skillMsgId,
              role:      'skill' as const,
              content:   '',
              skillInfo: { name: skillName, cmd: displayCmd, status: 'running' as const },
            },
          ]);
          activeMsgIdRef.current = skillMsgId; // 临时指向技能卡片
        },

        // 技能执行完成：更新卡片状态
        onSkillResult: (skillName, result) => {
          const isDisabled = result.startsWith('[SKILL_DISABLED]');
          setMessages(prev => prev.map(m =>
            m.role === 'skill' && m.skillInfo?.name === skillName && m.skillInfo?.status === 'running'
              ? {
                  ...m,
                  skillInfo: {
                    ...m.skillInfo!,
                    status: isDisabled ? 'disabled' as const : 'done' as const,
                    result: isDisabled ? '技能已禁用' : result,
                  },
                }
              : m,
          ));
        },

        // 技能完成后：新建 AI 消息气泡，供后续回复写入
        onNewAITurn: () => {
          const newId = `ai-skill-turn-${Date.now()}`;
          activeMsgIdRef.current = newId;
          setMessages(prev => [
            ...prev,
            { id: newId, role: 'ai' as const, content: '', isStreaming: true },
          ]);
        },

        // 全部轮次完成
        onDone: (fullText) => {
          setMessages(prev => {
            const updated = prev.map(m =>
              m.id === activeMsgIdRef.current
                ? { ...m, isStreaming: false }
                : m,
            );
            syncChatToStore(updated);
            return updated;
          });
          setShowActions(true);
          if (isActive()) setIsAiThinking(false);
          onDone(fullText);
        },

        // 错误处理
        onError: (errMsg) => {
          if (!isActive()) return;
          setLlmOffline(true);
          setMessages(prev => {
            const updated = prev.map(m =>
              m.id === activeMsgIdRef.current
                ? { ...m, content: errMsg, isStreaming: false }
                : m,
            );
            syncChatToStore(updated);
            return updated;
          });
          setShowActions(true);
          if (isActive()) setIsAiThinking(false);
          onDone(errMsg);
        },
      },
    });
  };

  // ─────────────────────────────────────────────────────────
  // 构建进程事件上下文
  // ─────────────────────────────────────────────────────────
  const buildEventContext = () => {
    if (!selectedEvent) return '';
    const ev = selectedEvent;
    const signedText = ev.isSigned === 2 ? '已签名（Authenticode 验证通过）'
                     : ev.isSigned === 1 ? '未签名（缺少数字签名）'
                     : '签名状态未知';

    const baseContext = [
      `进程名: ${ev.processName} (PID: ${ev.pid})`,
      `进程路径: ${ev.processPath}`,
      `命令行参数: ${ev.cmdLine || '（无参数）'}`,
      `父进程: ${ev.parentProcessName} (PID: ${ev.parentPid})`,
      `父进程路径: ${ev.parentProcessPath || '未知'}`,
      `数字签名: ${signedText}`,
      `驱动层触发规则: ${ev.ruleTriggered}`,
      `驱动层风险等级: ${ev.riskLevel.toUpperCase()}`,
      `事件状态: ${ev.status.toUpperCase()}`,
      ev.fileCreateTime > 0
        ? `文件创建时间: ${new Date(ev.fileCreateTime).toLocaleString('zh-CN')}`
        : '',
    ].filter(Boolean);

    // ── 注入 ETW 行为链（全量，时间升序） ──
    // 直接从 ProcessEvent.etwEvents 取，无需 PID 查表
    // 格式分两层：① 统计摘要（让 AI 快速掌握全貌）② 逐条明细（高危完整展示，其余紧凑单行）
    const pidEtwEvents = ev.etwEvents ?? [];
    if (pidEtwEvents.length > 0) {
      // ── ① 统计摘要 ──
      const countByCategory = { File: 0, Registry: 0, Network: 0 } as Record<string, number>;
      const countBySeverity = { high: 0, medium: 0, low: 0 } as Record<string, number>;
      for (const e of pidEtwEvents) {
        countByCategory[e.category] = (countByCategory[e.category] ?? 0) + 1;
        countBySeverity[e.severity] = (countBySeverity[e.severity] ?? 0) + 1;
      }
      baseContext.push('');
      baseContext.push(
        `运行时 ETW 行为链（共 ${pidEtwEvents.length} 条）` +
        ` | 文件:${countByCategory.File} 注册表:${countByCategory.Registry} 网络:${countByCategory.Network}` +
        ` | 高危:${countBySeverity.high} 中危:${countBySeverity.medium} 低危:${countBySeverity.low}`,
      );

      // ── ② 逐条明细（时间升序） ──
      pidEtwEvents.forEach((e, i) => {
        const t = new Date(e.timestamp).toLocaleTimeString('zh-CN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        if (e.severity === 'high') {
          // 高危：完整展示（含规则描述）
          baseContext.push(
            `  ${i + 1}. [${t}][⚠高危] ${e.category}.${e.action} → ${e.target}` +
            (e.ruleDescription ? ` // ${e.ruleDescription}` : ''),
          );
        } else {
          // 中/低危：紧凑单行，不输出规则描述以节省 token
          const sev = e.severity === 'medium' ? '[中]' : '';
          baseContext.push(`  ${i + 1}. [${t}]${sev} ${e.category}.${e.action} → ${e.target}`);
        }
      });
    }

    return baseContext.join('\n');
  };

  // ─────────────────────────────────────────────────────────
  // 初始分析：selectedEvent 变化时触发
  //
  // cleanup 函数负责：
  //   1. 将 active 置 false → 让正在进行的流立即停止写 state
  //   2. abort 网络请求
  // 这样无论用户切换多快都不会卡死或状态错乱
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    // ── 每次 effect 运行时先中止上一个 ──
    abortControllerRef.current?.abort();

    if (!selectedEvent) {
      setMessages([]);
      setShowActions(false);
      setQuestion('');
      setIsAiThinking(false);
      setLlmOffline(false);
      setLastAnalysis(null);
      currentRecordIdRef.current = null;
      return;
    }

    // active 标记：只有本次 effect 实例能写 state
    let active = true;
    const isActive = () => active;

    const recordId    = createAnalysisRecord(selectedEvent);
    currentRecordIdRef.current = recordId;

    const initialMsgId = 'ai-init-' + Date.now();
    setMessages([{ id: initialMsgId, role: 'ai', content: '', isStreaming: true }]);
    setIsAiThinking(true);
    setShowActions(false);

    const initPrompt = '请对以上进程事件进行完整的安全研判，给出风险分析、行为评估，以及最终的风险评分和处置建议。';

    streamFromLLM(
      [{ role: 'user', content: initPrompt }],
      buildSystemPrompt({ skills: ['terminal'], contextBlock: buildEventContext() }),
      initialMsgId,
      isActive,
      (fullText) => {
        const scoreMatch   = fullText.match(/<risk_score>(\d+)<\/risk_score>/);
        const actionMatch  = fullText.match(/<action>(BLOCK|WATCH|ALLOW)<\/action>/);
        const summaryMatch = fullText.match(/<summary>([\s\S]*?)<\/summary>/);
        const attackMatch  = fullText.match(/T\d{4}(?:\.\d{3})?/);

        const score = scoreMatch
          ? parseInt(scoreMatch[1])
          : (selectedEvent.riskLevel === 'high' ? 85 : selectedEvent.riskLevel === 'medium' ? 55 : 25);
        const action = actionMatch?.[1];
        const recommendation: 'block' | 'allow' | 'investigate' =
          action === 'BLOCK' ? 'block' : action === 'ALLOW' ? 'allow' : 'investigate';

        // 缓存 AI 研判结果供处置按钮写回时使用
        setLastAnalysis({
          summary:        summaryMatch?.[1]?.trim() ?? '',
          attackTechnique: attackMatch?.[0] ?? null,
          aiScore:        score,
        });

        updateAnalysisVerdict(recordId, {
          aiRiskLevel:      score >= 75 ? 'high' : score >= 40 ? 'medium' : 'low',
          aiConfidence:     score,
          aiRecommendation: recommendation,
        });
      },
      {
        processName:       selectedEvent.processName,
        processPath:       selectedEvent.processPath,
        parentProcessName: selectedEvent.parentProcessName,
        cmdLine:           selectedEvent.cmdLine,
        isSigned:          selectedEvent.isSigned === 2,
      },
    );

    // cleanup：让本次流失效 + 中止请求
    return () => {
      active = false;
      abortControllerRef.current?.abort();
    };
  // 只依赖事件 ID：ETW 行为链更新会创建新的 selectedEvent 对象引用，
  // 但不应重启整轮分析；只有用户切换到不同进程事件时才重新分析。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiThinking]);

  // ─────────────────────────────────────────────────────────
  // 写回案例库（人工处置后调用）
  //  verdict   : 人工动作决定（BLOCK / ALLOW）
  //  riskScore : 由动作推算（BLOCK → max(aiScore,75)，ALLOW → min(aiScore,39)）
  //  summary / attackTechnique : 来自 AI 研判输出
  // ─────────────────────────────────────────────────────────
  const triggerWriteback = async (verdict: 'BLOCK' | 'ALLOW') => {
    if (!writebackEnabled || !selectedEvent || !lastAnalysis) return;
    const riskScore = verdict === 'BLOCK'
      ? Math.max(lastAnalysis.aiScore, 75)
      : Math.min(lastAnalysis.aiScore, 39);
    try {
      await fetch(`${LLM_URL}/writeback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_context: {
            processName:       selectedEvent.processName,
            processPath:       selectedEvent.processPath,
            parentProcessName: selectedEvent.parentProcessName,
            cmdLine:           selectedEvent.cmdLine,
            isSigned:          selectedEvent.isSigned === 2,
          },
          verdict,
          risk_score:       riskScore,
          summary:          lastAnalysis.summary,
          attack_technique: lastAnalysis.attackTechnique,
        }),
      });
    } catch (e) {
      console.warn('[LLMHips] 回写请求失败', e);
    }
  };

  // ─────────────────────────────────────────────────────────
  // 用户追问
  // ─────────────────────────────────────────────────────────
  const handleFollowUp = () => {
    if (!question.trim() || isAiThinking || !selectedEvent) return;

    const userMsgId   = 'usr-' + Date.now();
    const aiMsgId     = 'ai-'  + Date.now();
    const userContent = question.trim();
    setQuestion('');

    // 用户消息入队
    let snapshotHistory: ChatMessage[] = [];
    setMessages(prev => {
      snapshotHistory = prev;
      const updated = [...prev, { id: userMsgId, role: 'user' as const, content: userContent }];
      syncChatToStore(updated);
      return updated;
    });

    setIsAiThinking(true);

    // 构造历史对话记录成为新对话的上下文
    // inferMaxHistory=0 表示保留全部，否则取最近 N 轮（每轮 = 1 user + 1 ai，共 2 条消息）
    // skill 类型消息是 UI 技能卡片，不传给 API；转换 role 时也过滤掉
    const historyMessages = snapshotHistory.filter(m => !m.isStreaming && m.content && m.role !== 'skill');
    const trimmed = inferMaxHistory > 0
      ? historyMessages.slice(-inferMaxHistory * 2)
      : historyMessages;
    const apiMessages = [
      ...trimmed.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: userContent },
    ];

    // 占位 AI 消息
    setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', isStreaming: true }]);

    // 追问没有 effect cleanup，用 active=true 保持活跃（不会被切换中断）
    let active = true;
    streamFromLLM(
      apiMessages,
      buildSystemPrompt({ skills: ['terminal'], contextBlock: buildEventContext() }),
      aiMsgId,
      () => active,
      () => {},
    );
  };

  if (!selectedEvent) return null;

  // ── 样式工具 ──
  const riskBadgeClass = (level: string) => {
    if (level === 'high')   return 'bg-red-500/20 text-red-400 border border-red-500/30';
    if (level === 'medium') return 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
    return 'bg-green-500/20 text-green-400 border border-green-500/30';
  };
  const statusBadgeClass = (status: string) => {
    if (status === 'blocked')  return 'bg-red-900/50 text-red-400 border border-red-800/60';
    if (status === 'watching') return 'bg-orange-900/30 text-orange-400 border border-orange-800/50';
    return 'bg-green-900/30 text-green-400 border border-green-800/50';
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {/* ── 内核阻断成功弹窗（z-60 覆盖在面板之上） ── */}
      {blockSuccess && (
        <div className="absolute inset-0 z-60 flex items-center justify-center">
          <BlockSuccessModal
            processName={blockSuccess.processName}
            pid={blockSuccess.pid}
            blockedAt={blockSuccess.blockedAt}
            onConfirm={() => {
              setBlockSuccess(null);
              setSelectedEvent(null); // 弹窗确认后才关闭 LLM 面板
            }}
          />
        </div>
      )}
      <div className="bg-[#161b22] border border-[#30363d] w-full max-w-3xl h-[85vh] rounded-xl shadow-[0_0_40px_rgba(0,212,255,0.15)] flex flex-col overflow-hidden relative">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#0d1117] shrink-0">
          <h2 className="flex items-center gap-2 text-[#00d4ff] font-bold text-lg font-mono">
            <Bot size={24} /> 交互式威胁研判沙箱
          </h2>
          <div className="flex items-center gap-3">
            {llmOffline ? (
              <span className="flex items-center gap-1 text-xs text-red-400 font-mono">
                <WifiOff size={12} /> LLM 离线
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-green-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_#4ade80]" />
                {engineLabel(enginePreset, engineModel)}
              </span>
            )}
<button
              onClick={() => setSelectedEvent(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* 事件摘要 */}
        <div className="px-6 py-3 bg-[#0a0d12] border-b border-[#30363d] shrink-0 relative overflow-hidden">
          {selectedEvent.riskLevel === 'high' && (
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(239,68,68,0.07) 0%, transparent 70%)' }} />
          )}
          <div className="space-y-2 relative">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {selectedEvent.riskLevel === 'high'
                  ? <ShieldAlert className="text-red-500 animate-pulse-fast shrink-0" size={20} />
                  : <Activity className="text-orange-500 shrink-0" size={20} />}
                <span className="text-white font-mono font-medium">{selectedEvent.processName}</span>
                <span className="text-gray-500 text-sm font-mono">PID: {selectedEvent.pid}</span>
                {selectedEvent.isSigned === 2 && <span className="flex items-center gap-1 text-xs text-green-500"><Lock size={12} />已签名</span>}
                {selectedEvent.isSigned === 1 && <span className="flex items-center gap-1 text-xs text-red-400"><LockOpen size={12} />未签名</span>}
                {selectedEvent.isSigned === 0 && <span className="flex items-center gap-1 text-xs text-gray-600"><HelpCircle size={12} />签名未知</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${riskBadgeClass(selectedEvent.riskLevel)}`}>
                  {selectedEvent.riskLevel.toUpperCase()}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${statusBadgeClass(selectedEvent.status)}`}>
                  {selectedEvent.status.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {new Date(selectedEvent.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 font-mono truncate pl-8" title={selectedEvent.processPath}>
              {selectedEvent.processPath}
            </p>
            {selectedEvent.cmdLine && (
              <div className="flex items-start gap-1.5 pl-8">
                <Terminal size={12} className="text-gray-600 shrink-0 mt-0.5" />
                <p className="text-xs text-gray-400 font-mono truncate" title={selectedEvent.cmdLine}>
                  {selectedEvent.cmdLine}
                </p>
              </div>
            )}
            <div className="flex items-center gap-1.5 pl-8">
              <GitFork size={12} className="text-gray-600 shrink-0" />
              <p className="text-xs text-gray-500 font-mono truncate">
                父进程: {selectedEvent.parentProcessName || '未知'}
                <span className="text-gray-600 ml-1">(PID: {selectedEvent.parentPid})</span>
                {selectedEvent.parentProcessPath && (
                  <span className="text-gray-600 ml-2" title={selectedEvent.parentProcessPath}>{selectedEvent.parentProcessPath}</span>
                )}
              </p>
            </div>
            <div className="flex items-center justify-between pl-8">
              <p className="text-xs text-gray-400">
                <span className="text-gray-500">触发规则:</span> {selectedEvent.ruleTriggered}
              </p>
              {selectedEvent.fileCreateTime > 0 && (
                <p className="text-xs text-gray-600 font-mono shrink-0">
                  文件创建: {new Date(selectedEvent.fileCreateTime).toLocaleDateString('zh-CN')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0d1117] font-sans relative">
          {isAiThinking && (
            <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-10">
              <div className="h-full w-1/4 bg-[#00d4ff] opacity-80 animate-progress-slide" />
            </div>
          )}

          <div className="flex justify-start">
            <span className="font-mono text-xs text-gray-600 border border-gray-700/80 rounded px-2 py-0.5">
              {engineLabel(enginePreset, engineModel)}
            </span>
          </div>

          {messages.map(msg => {
            // ── 技能调用状态卡片 ──────────────────────────────────
            if (msg.role === 'skill' && msg.skillInfo) {
              const { name, cmd, status, result } = msg.skillInfo;
              const isRunning  = status === 'running';
              const isDisabled = status === 'disabled';
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className={`w-full max-w-[88%] rounded-lg border text-xs font-mono overflow-hidden
                    ${isDisabled
                      ? 'bg-gray-800/40 border-gray-700'
                      : isRunning
                      ? 'bg-[#00d4ff]/5 border-[#00d4ff]/20'
                      : 'bg-green-500/5 border-green-500/20'}`}
                  >
                    {/* 头部：技能名 + 状态 */}
                    <div className={`flex items-center gap-2 px-3 py-2 border-b
                      ${isDisabled ? 'border-gray-700' : isRunning ? 'border-[#00d4ff]/15' : 'border-green-500/15'}`}>
                      <Terminal size={11} className={isDisabled ? 'text-gray-600' : isRunning ? 'text-[#00d4ff]' : 'text-green-400'} />
                      <span className={isDisabled ? 'text-gray-500' : isRunning ? 'text-[#00d4ff]' : 'text-green-400'}>
                        {name}
                      </span>
                      <span className="text-gray-600">·</span>
                      {isRunning  && <span className="text-[#00d4ff] animate-pulse">执行中…</span>}
                      {!isRunning && !isDisabled && <span className="text-green-400">✓ 执行完成</span>}
                      {isDisabled && <span className="text-gray-500">⊘ 已禁用</span>}
                    </div>
                    {/* 命令 */}
                    <div className="px-3 py-1.5 text-gray-500">
                      <span className="text-gray-700">$ </span>{cmd}
                    </div>
                    {/* 结果（执行完成后显示） */}
                    {result && !isDisabled && (
                      <div className="px-3 py-2 border-t border-green-500/10 text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {result.length > 500 ? result.slice(0, 500) + '\n…（输出已截断）' : result}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // ── 普通消息气泡 ──────────────────────────────────────
            return (
            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center shrink-0">
                  <Bot size={16} className="text-[#00d4ff]" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-lg p-4 text-sm leading-relaxed relative overflow-hidden select-text
                ${msg.role === 'user'
                  ? 'bg-[#1f6feb]/20 text-[#c9d1d9] border border-[#1f6feb]/30 font-mono whitespace-pre-wrap'
                  : 'bg-[#161b22] text-gray-300 border border-[#30363d]'}`}
              >
                {msg.role === 'user' ? (
                  cleanModelOutput(msg.content)
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="text-base font-bold text-gray-100 mb-2 mt-3 first:mt-0">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-bold text-gray-100 mb-2 mt-3 first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold text-[#00d4ff] mb-1 mt-2 first:mt-0">{children}</h3>,
                      h4: ({ children }) => <h4 className="text-xs font-semibold text-gray-300 mb-1 mt-2">{children}</h4>,
                      p:  ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5 pl-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5 pl-1">{children}</ol>,
                      li: ({ children }) => <li className="text-gray-300 leading-snug">{children}</li>,
                      strong: ({ children }) => <strong className="font-bold text-gray-100">{children}</strong>,
                      em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
                      // pre 包裹块级代码区域（带/不带语言标记都走这里）
                      pre: ({ children }) => (
                        <pre className="bg-[#0d1117] border border-[#30363d] rounded p-3 overflow-x-auto mb-2 text-xs font-mono text-gray-300 whitespace-pre">
                          {children}
                        </pre>
                      ),
                      // code：在 pre 内部 → 只负责字体，外框由 pre 提供
                      //        行内 → 渲染青色小标签
                      // 判断依据：有 className（language-xxx）或内容含换行 → 块级
                      code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
                        const isBlock = !!className || String(children ?? '').includes('\n');
                        return isBlock
                          ? <code className="font-mono">{children}</code>
                          : <code className="bg-[#0d1117] text-[#00d4ff] px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>;
                      },
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-[#00d4ff]/50 pl-3 my-2 text-gray-400 italic">{children}</blockquote>
                      ),
                      table: ({ children }) => (
                        <div className="overflow-x-auto mb-2">
                          <table className="text-xs border-collapse w-full">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-[#0d1117]">{children}</thead>,
                      th: ({ children }) => <th className="border border-[#30363d] px-2 py-1 text-left text-gray-300 font-semibold">{children}</th>,
                      td: ({ children }) => <td className="border border-[#30363d] px-2 py-1 text-gray-400">{children}</td>,
                      hr: () => <hr className="border-[#30363d] my-3" />,
                    }}
                  >
                    {cleanModelOutput(msg.content)}
                  </ReactMarkdown>
                )}
                {msg.isStreaming && (
                  <span className="inline-block w-2 h-4 bg-[#00d4ff] animate-pulse ml-1 align-middle" />
                )}
                {msg.role === 'ai' && msg.isStreaming && (
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[#00d4ff]/5 to-transparent animate-scan" />
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                  <User size={16} className="text-gray-300" />
                </div>
              )}
            </div>
            );
          })}

          {isAiThinking && messages.every(m => !m.content) && (
            <div className="flex gap-4 justify-start">
              <div className="w-8 h-8 rounded-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 flex items-center justify-center">
                <Sparkles size={16} className="text-[#00d4ff] animate-pulse" />
              </div>
              <div className="text-[#00d4ff] text-sm font-mono flex items-center animate-pulse">
                正在调用本地模型分析...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
        <div className="p-4 bg-[#161b22] border-t border-[#30363d] shrink-0">
          <div className="flex gap-2 mb-4">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={2}
              placeholder="继续追问 AI，例如：该进程是否已横向移动？"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFollowUp(); }
              }}
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-[#00d4ff] transition-colors resize-none placeholder-gray-600"
            />
            <button
              onClick={handleFollowUp}
              disabled={!question.trim() || isAiThinking}
              className="px-3 rounded-lg bg-[#00d4ff]/10 text-[#00d4ff] hover:bg-[#00d4ff]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end h-9 flex items-center"
            >
              <Send size={16} />
            </button>
          </div>

          <div className={`flex justify-end gap-3 transition-all duration-500 ${showActions ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <button
              onClick={async () => {
                await triggerWriteback('ALLOW');
                if (currentRecordIdRef.current) finalizeAnalysis(currentRecordIdRef.current, 'allowed');
                addToWhitelist({
                  matchType: 'processName',
                  value: selectedEvent.processName,
                  note: `LLM研判放行 — ${new Date().toLocaleString('zh-CN')}`,
                });
                setSelectedEvent(null);
              }}
              className="px-4 py-2 rounded text-gray-300 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors text-sm"
            >
              加入白名单并放行
            </button>
            <button
              onClick={async () => {
                await triggerWriteback('BLOCK');
                if (currentRecordIdRef.current) finalizeAnalysis(currentRecordIdRef.current, 'blocked');
                // blockEvent 负责：① 发送 WebSocket kill 指令到 C# 中间层 → IOCTL → 驱动终止进程
                //                  ② 从 events[] 删除该进程
                //                  ③ 写入阻断历史 blockRecords[]
                const blockedAt = Date.now();
                blockEvent(selectedEvent.id);
                // 先弹成功弹窗，用户点「确认」后再关闭面板（与进程详情页行为一致）
                setBlockSuccess({ processName: selectedEvent.processName, pid: selectedEvent.pid, blockedAt });
              }}
              className="px-5 py-2 rounded text-white bg-red-600 hover:bg-red-700 flex items-center gap-2 shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-all text-sm font-bold"
            >
              <CheckCircle size={16} />
              执行内核阻断 (Kill)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
